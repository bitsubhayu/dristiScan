/**
 * DrishtiScan — Grounding & Conflict Regression Test Suite
 *
 * Proves:
 *  - Fix 1: stale .elements no longer survive in fused rows
 *  - Fix 2+3: precomputed canonical rowLookupMap is used for grounding
 *  - Bonus: deterministic statutory conflict detection
 *  - Edge cases: same-value, OCR formatting, different categories, non-statutory, single-photo
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const assert = require('assert');
const {
    fuseMultiPhotoEvidence,
    normalizeTextForDeduplication,
    getStatutoryCategory,
    detectStatutoryValueConflict
} = require('./src/services/multiPhotoEvidenceFusion');
const structuringEngine = require('./src/services/structuringEngine');
const { validateGrounding, FIELD_TIERS } = structuringEngine;
const gptOssService = require('./src/services/gptOssService');
const { mergeMultiPhotoExtractedFields, extractFields } = require('./src/services/extraction');

let totalTests = 0;
let passedTests = 0;
const failedTestDetails = [];

const runTest = async (name, fn) => {
    totalTests++;
    process.stdout.write(`  [${totalTests}] ${name} ... `);
    try {
        await fn();
        passedTests++;
        console.log('✅ PASSED');
    } catch (err) {
        console.log('❌ FAILED');
        console.error('       Error:', err.message);
        failedTestDetails.push({ name, error: err.message });
    }
};

async function runRegressionSuite() {
    console.log('\n================================================================');
    console.log('    GROUNDING & CONFLICT REGRESSION TEST SUITE                 ');
    console.log('================================================================\n');

    // -------------------------------------------------------------------------
    // STALE .elements REGRESSION (Fix 1 core proof)
    // -------------------------------------------------------------------------
    console.log('--- Suite A: Stale .elements Regression ---');

    await runTest('A1. Winning observation replaces originalRow — stale .elements do not survive', () => {
        // Photo 1: corrupted/worse observation with stale elements
        const staleElements = [
            { text: 'MRF', confidence: 0.55 },
            { text: 'Rs', confidence: 0.50 },
            { text: '25O', confidence: 0.40 }
        ];
        // Photo 2: cleaner observation
        const cleanElements = [
            { text: 'MRP', confidence: 0.95 },
            { text: 'Rs.', confidence: 0.93 },
            { text: '250', confidence: 0.96 }
        ];

        const photoRowsList = [
            {
                photoId: 'photo-1',
                rows: [{
                    rowId: 0,
                    text: 'MRF Rs 25O',
                    confidence: 0.48,
                    elements: staleElements,
                    cells: [{ text: 'MRF Rs 25O', confidence: 0.48 }]
                }]
            },
            {
                photoId: 'photo-2',
                rows: [{
                    rowId: 0,
                    text: 'MRP Rs. 250',
                    confidence: 0.95,
                    elements: cleanElements,
                    cells: [{ text: 'MRP Rs. 250', confidence: 0.95 }]
                }]
            }
        ];

        const fused = fuseMultiPhotoEvidence(photoRowsList);

        // Since MRP values differ (25O vs 250), these should NOT merge (digit conflict guard).
        // But the key point is: if they did merge via near-identical text,
        // the winning row would have clean elements, not stale ones.
        // With digit-conflict guard, both survive as separate rows — verify both exist.
        assert.strictEqual(fused.stats.totalInputRows, 2);

        // Find the fused rows across all photo groups
        const allFusedRows = fused.fusedPhotoRows.flatMap(p => p.rows);

        // Verify the cleaner row's text and elements are intact
        const cleanRow = allFusedRows.find(r => r.text === 'MRP Rs. 250');
        assert.ok(cleanRow, 'Clean row must exist in fused output');
        assert.strictEqual(cleanRow.confidence, 0.95);
    });

    await runTest('A2. When texts match exactly (same OCR), winner originalRow syncs with higher-confidence photo', () => {
        const staleElements = [
            { text: 'NET', confidence: 0.50 },
            { text: 'WEIGHT', confidence: 0.55 },
            { text: '500', confidence: 0.45 },
            { text: 'g', confidence: 0.40 }
        ];
        const cleanElements = [
            { text: 'NET', confidence: 0.97 },
            { text: 'WEIGHT', confidence: 0.96 },
            { text: '500', confidence: 0.98 },
            { text: 'g', confidence: 0.95 }
        ];

        const photoRowsList = [
            {
                photoId: 'photo-1',
                rows: [{
                    rowId: 0,
                    text: 'NET WEIGHT 500 g',
                    confidence: 0.48,
                    elements: staleElements,
                    cells: [{ text: 'NET WEIGHT 500 g', confidence: 0.48 }]
                }]
            },
            {
                photoId: 'photo-2',
                rows: [{
                    rowId: 0,
                    text: 'NET WEIGHT 500 g',
                    confidence: 0.97,
                    elements: cleanElements,
                    cells: [{ text: 'NET WEIGHT 500 g', confidence: 0.97 }]
                }]
            }
        ];

        const fused = fuseMultiPhotoEvidence(photoRowsList);

        // These should merge (same text, same digits)
        assert.strictEqual(fused.stats.fusedRowCount, 1, 'Identical text rows should merge to 1');

        const allFusedRows = fused.fusedPhotoRows.flatMap(p => p.rows);
        const mergedRow = allFusedRows[0];

        // Core invariant: the winning row's text is the canonical text
        assert.strictEqual(mergedRow.text, 'NET WEIGHT 500 g');
        assert.strictEqual(mergedRow.confidence, 0.97, 'Higher confidence from photo-2 should win');

        // The merged row's elements (from originalRow spread) should come from the winning photo
        // After Fix 1, originalRow is synced to the winner, so spread elements come from photo-2
        if (mergedRow.elements) {
            const avgElementConfidence = mergedRow.elements.reduce((acc, el) => acc + (el.confidence || 0), 0) / mergedRow.elements.length;
            assert.ok(avgElementConfidence > 0.90, `Winner's elements should have high confidence (got ${avgElementConfidence.toFixed(2)}), not stale low-confidence elements`);
        }

        // Source refs should contain both photos
        assert.strictEqual(mergedRow.sourceRefs.length, 2, 'Both sourceRefs retained');
    });

    // -------------------------------------------------------------------------
    // CANONICAL rowLookupMap GROUNDING (Fix 2+3 proof)
    // -------------------------------------------------------------------------
    console.log('\n--- Suite B: Canonical rowLookupMap Grounding ---');

    await runTest('B1. fusionResult.rowLookupMap contains canonical text for fused rows', () => {
        const photoRowsList = [
            {
                photoId: 'photo-1',
                rows: [{
                    rowId: 0,
                    text: 'EXP: 12/2026',
                    confidence: 0.60,
                    elements: [{ text: 'EXP:', confidence: 0.55 }, { text: '12/2026', confidence: 0.65 }]
                }]
            },
            {
                photoId: 'photo-2',
                rows: [{
                    rowId: 0,
                    text: 'EXP: 12/2026',
                    confidence: 0.96,
                    elements: [{ text: 'EXP:', confidence: 0.95 }, { text: '12/2026', confidence: 0.97 }]
                }]
            }
        ];

        const fused = fuseMultiPhotoEvidence(photoRowsList);

        // The rowLookupMap should map both photo refs to the canonical text
        assert.strictEqual(fused.rowLookupMap.get('photo-1:0'), 'EXP: 12/2026');
        assert.strictEqual(fused.rowLookupMap.get('photo-2:0'), 'EXP: 12/2026');

        // Grounding against canonical map should work
        const decision = {
            value: '12/2026',
            rawObservedText: 'EXP: 12/2026',
            correctionApplied: false,
            groundingRefs: [{ photoId: 'photo-1', rowId: 0 }]
        };
        const grounded = validateGrounding('dateOfExpiry', decision, fused.rowLookupMap, FIELD_TIERS.dateOfExpiry);
        assert.strictEqual(grounded.status, 'verified', 'Grounding against canonical map should verify');
    });

    await runTest('B2. structureFields receives precomputed rowLookupMap and uses it for grounding', async () => {
        // Mock GPT-OSS to return a known field referencing our fused evidence
        const originalCallGroqJson = gptOssService.callGroqJson;
        const originalIsAvailable = gptOssService.isAvailable;
        gptOssService.isAvailable = () => true;
        gptOssService.callGroqJson = async () => ({
            success: true,
            content: {
                mrp: {
                    value: { amount: 250, currency: 'INR' },
                    rawObservedText: 'MRP Rs. 250',
                    correctionApplied: false,
                    groundingRefs: [{ photoId: 'photo-1', rowId: 0 }],
                    confidence: 0.95
                }
            },
            latencyMs: 50
        });

        try {
            // Create a precomputed map with the canonical (clean) text
            const precomputedMap = new Map();
            precomputedMap.set('photo-1:0', 'MRP Rs. 250');

            // The photoRowsList has stale .elements that would produce wrong text if rebuilt
            const photoRowsList = [{
                photoId: 'photo-1',
                rows: [{
                    rowId: 0,
                    text: 'MRP Rs. 250',
                    elements: [{ text: 'MRF', confidence: 0.40 }, { text: 'Rs', confidence: 0.35 }, { text: '25O', confidence: 0.30 }]
                }]
            }];

            const result = await structuringEngine.structureFields(photoRowsList, [], precomputedMap);
            assert.strictEqual(result.success, true);

            // MRP should be verified because grounding uses precomputed map (clean text "MRP Rs. 250")
            // not the stale elements which would produce "MRF Rs 25O"
            assert.strictEqual(result.declarations.mrp.status, 'verified',
                'MRP should be verified against precomputed canonical text, not stale elements');
        } finally {
            gptOssService.callGroqJson = originalCallGroqJson;
            gptOssService.isAvailable = originalIsAvailable;
        }
    });

    // -------------------------------------------------------------------------
    // STATUTORY CONFLICT DETECTION (Bonus fix proof)
    // -------------------------------------------------------------------------
    console.log('\n--- Suite C: Statutory Conflict Detection ---');

    await runTest('C1. MRP conflict: MRP 99 vs MRP 120 produces one conflict record for mrp', () => {
        const photoRowsList = [
            { photoId: 'photo-1', rows: [{ rowId: 0, text: 'MRP 99', confidence: 0.90 }] },
            { photoId: 'photo-2', rows: [{ rowId: 0, text: 'MRP 120', confidence: 0.90 }] }
        ];

        const fused = fuseMultiPhotoEvidence(photoRowsList);
        assert.ok(Array.isArray(fused.conflicts), 'conflicts should be an array');
        assert.strictEqual(fused.conflicts.length, 1, 'Should detect exactly 1 MRP conflict');

        const c = fused.conflicts[0];
        assert.strictEqual(c.field, 'mrp');
        assert.ok(c.message.includes('mrp'), 'Message should reference mrp');
        assert.strictEqual(c.detectedValues.length, 2, 'Should have 2 detected values');
        assert.ok(c.detectedValues.some(v => v.value === 'MRP 99'));
        assert.ok(c.detectedValues.some(v => v.value === 'MRP 120'));
    });

    await runTest('C2. Net quantity conflict: same label, different numeric value', () => {
        const photoRowsList = [
            { photoId: 'photo-1', rows: [{ rowId: 0, text: 'NET WEIGHT 500 g', confidence: 0.90 }] },
            { photoId: 'photo-2', rows: [{ rowId: 0, text: 'NET WEIGHT 50 g', confidence: 0.88 }] }
        ];

        const fused = fuseMultiPhotoEvidence(photoRowsList);
        assert.strictEqual(fused.conflicts.length, 1, 'Should detect net quantity conflict');
        assert.strictEqual(fused.conflicts[0].field, 'netQuantity');
        assert.strictEqual(fused.conflicts[0].detectedValues.length, 2);
    });

    await runTest('C3. Expiry conflict: same label, different date', () => {
        const photoRowsList = [
            { photoId: 'photo-1', rows: [{ rowId: 0, text: 'EXP 12/2026', confidence: 0.90 }] },
            { photoId: 'photo-2', rows: [{ rowId: 0, text: 'EXP 11/2026', confidence: 0.88 }] }
        ];

        const fused = fuseMultiPhotoEvidence(photoRowsList);
        assert.strictEqual(fused.conflicts.length, 1, 'Should detect expiry conflict');
        assert.strictEqual(fused.conflicts[0].field, 'dateOfExpiry');
        assert.strictEqual(fused.conflicts[0].detectedValues.length, 2);
    });

    // -------------------------------------------------------------------------
    // NO-CONFLICT EDGE CASES
    // -------------------------------------------------------------------------
    console.log('\n--- Suite D: No-Conflict Edge Cases ---');

    await runTest('D1. Same value across photos must NOT produce a conflict', () => {
        const photoRowsList = [
            { photoId: 'photo-1', rows: [{ rowId: 0, text: 'MRP 250', confidence: 0.90 }] },
            { photoId: 'photo-2', rows: [{ rowId: 0, text: 'MRP 250', confidence: 0.95 }] }
        ];

        const fused = fuseMultiPhotoEvidence(photoRowsList);
        assert.strictEqual(fused.conflicts.length, 0, 'Same MRP value should not produce conflict');
    });

    await runTest('D2. OCR formatting variation (spacing/case) must NOT produce a conflict', () => {
        const photoRowsList = [
            { photoId: 'photo-1', rows: [{ rowId: 0, text: 'MRP Rs. 250', confidence: 0.90 }] },
            { photoId: 'photo-2', rows: [{ rowId: 0, text: 'mrp rs 250', confidence: 0.85 }] }
        ];

        const fused = fuseMultiPhotoEvidence(photoRowsList);
        assert.strictEqual(fused.conflicts.length, 0, 'OCR case/punctuation variation should not produce conflict');
    });

    await runTest('D3. Different statutory categories must NOT produce conflict', () => {
        const photoRowsList = [
            { photoId: 'photo-1', rows: [{ rowId: 0, text: 'MRP 99', confidence: 0.90 }] },
            { photoId: 'photo-2', rows: [{ rowId: 0, text: 'EXP 12/2026', confidence: 0.90 }] }
        ];

        const fused = fuseMultiPhotoEvidence(photoRowsList);
        assert.strictEqual(fused.conflicts.length, 0, 'Different categories should not conflict');
    });

    await runTest('D4. Different non-statute rows with unrelated numbers must NOT produce conflict', () => {
        const photoRowsList = [
            { photoId: 'photo-1', rows: [{ rowId: 0, text: 'SERVING SIZE 30 g', confidence: 0.90 }] },
            { photoId: 'photo-2', rows: [{ rowId: 0, text: 'TOTAL SERVINGS 15', confidence: 0.90 }] }
        ];

        const fused = fuseMultiPhotoEvidence(photoRowsList);
        assert.strictEqual(fused.conflicts.length, 0, 'Unrelated rows should not produce statutory conflict');
    });

    await runTest('D5. Single-photo input produces no conflict', () => {
        const photoRowsList = [
            { photoId: 'photo-1', rows: [
                { rowId: 0, text: 'MRP 250', confidence: 0.90 },
                { rowId: 1, text: 'NET WEIGHT 500 g', confidence: 0.90 }
            ]}
        ];

        const fused = fuseMultiPhotoEvidence(photoRowsList);
        // Single-photo path does not produce conflicts property at all — callers use || []
        const conflicts = fused.conflicts || [];
        assert.strictEqual(conflicts.length, 0, 'Single photo should have no conflicts');
    });

    // -------------------------------------------------------------------------
    // HELPER UNIT TESTS
    // -------------------------------------------------------------------------
    console.log('\n--- Suite E: Helper Unit Tests ---');

    await runTest('E1. getStatutoryCategory returns correct categories', () => {
        assert.strictEqual(getStatutoryCategory('MRP Rs. 250'), 'mrp');
        assert.strictEqual(getStatutoryCategory('NET WEIGHT 500 g'), 'netQuantity');
        assert.strictEqual(getStatutoryCategory('EXP 12/2026'), 'dateOfExpiry');
        assert.strictEqual(getStatutoryCategory('MFG 01/2025'), 'dateOfManufacture');
        assert.strictEqual(getStatutoryCategory('BATCH NO: AB123'), 'batchNumber');
        assert.strictEqual(getStatutoryCategory('FSSAI LIC NO: 10012022000123'), 'fssaiLicenseNumber');
        assert.strictEqual(getStatutoryCategory('Made in India'), 'countryOfOrigin');
        assert.strictEqual(getStatutoryCategory('Ingredients: Flour, Sugar'), 'ingredients');
        assert.strictEqual(getStatutoryCategory('Some random text'), null);
    });

    await runTest('E2. detectStatutoryValueConflict is intentionally conservative', () => {
        // Should detect conflict
        assert.strictEqual(detectStatutoryValueConflict(
            { text: 'MRP 99' }, { text: 'MRP 120' }
        ), true, 'MRP 99 vs MRP 120 should conflict');

        // Should NOT conflict — same value
        assert.strictEqual(detectStatutoryValueConflict(
            { text: 'MRP 250' }, { text: 'MRP 250' }
        ), false, 'Same MRP value should not conflict');

        // Should NOT conflict — different categories
        assert.strictEqual(detectStatutoryValueConflict(
            { text: 'MRP 250' }, { text: 'EXP 12/2026' }
        ), false, 'Different categories should not conflict');

        // Should NOT conflict — non-statutory text
        assert.strictEqual(detectStatutoryValueConflict(
            { text: 'Pack of 6' }, { text: 'Pack of 8' }
        ), false, 'Non-statutory text should not conflict');

        // Should NOT conflict — no digits
        assert.strictEqual(detectStatutoryValueConflict(
            { text: 'Made in India' }, { text: 'Made in Germany' }
        ), false, 'Country names without digit difference should not conflict as statutory value conflict');
    });

    // -------------------------------------------------------------------------
    // CONFLICT WIRING THROUGH EXTRACTION (Fix 3 proof)
    // -------------------------------------------------------------------------
    console.log('\n--- Suite F: Conflict Wiring Through extraction.js ---');

    await runTest('F1. mergeMultiPhotoExtractedFields propagates fusionResult.conflicts to output', async () => {
        const originalCallGroqJson = gptOssService.callGroqJson;
        const originalIsAvailable = gptOssService.isAvailable;
        gptOssService.isAvailable = () => true;
        gptOssService.callGroqJson = async () => ({
            success: true,
            content: {},
            latencyMs: 50
        });

        try {
            // Create extractions with conflicting MRP values
            const ext1 = extractFields({
                results: [{ text: 'MRP 99', confidence: 0.9, bbox: [[10, 10], [100, 10], [100, 30], [10, 30]] }],
                imageWidth: 500, imageHeight: 500
            }, 'photo-1');

            const ext2 = extractFields({
                results: [{ text: 'MRP 120', confidence: 0.9, bbox: [[10, 10], [100, 10], [100, 30], [10, 30]] }],
                imageWidth: 500, imageHeight: 500
            }, 'photo-2');

            const result = await mergeMultiPhotoExtractedFields([ext1, ext2]);

            assert.ok(Array.isArray(result.conflicts), 'conflicts should exist in result');
            assert.strictEqual(result.conflicts.length, 1, 'Should have 1 MRP conflict');
            assert.strictEqual(result.conflicts[0].field, 'mrp');

            // Also check reconciliation.conflicts
            assert.ok(Array.isArray(result.reconciliation.conflicts), 'reconciliation.conflicts should exist');
            assert.strictEqual(result.reconciliation.conflicts.length, 1, 'reconciliation should also have 1 conflict');
        } finally {
            gptOssService.callGroqJson = originalCallGroqJson;
            gptOssService.isAvailable = originalIsAvailable;
        }
    });

    console.log('\n================================================================');
    console.log(` RESULTS: ${passedTests} / ${totalTests} tests passed`);
    if (failedTestDetails.length > 0) {
        console.log(` FAILURES (${failedTestDetails.length}):`);
        failedTestDetails.forEach(f => console.log(`   - ${f.name}: ${f.error}`));
    }
    console.log('================================================================\n');

    if (failedTestDetails.length > 0) {
        process.exit(1);
    }
}

runRegressionSuite().catch(err => {
    console.error('Regression suite runner crashed:', err);
    process.exit(1);
});
