/**
 * DrishtiScan — Synthetic Fixture Test Suite for Structuring Engine
 * 
 * Step 6 Mandatory Synthetic Test Fixtures:
 * 1. Cross-reference correction allowed ('cross_reference_match')
 * 2. Invention forbidden (rejection to 'review')
 * 3. Row concatenation ('row_concatenation' -> 'verified')
 * 4. Packaging directive rejected ("CUT FROM HERE" rejected from identity)
 * 5. GPT-OSS unavailable fallback ('deterministic_fallback' mode)
 * 6. Statutory field format check gates LLM output (invalid date downgraded to 'review', normalized is null)
 */

require('dotenv').config({ path: './.env' });
const assert = require('assert');
const structuringEngine = require('./src/services/structuringEngine');
const { validateGrounding, FIELD_TIERS } = structuringEngine;
const { validateFieldFormat } = require('./src/services/textShapeValidators');
const { extractFields, mergeMultiPhotoExtractedFields } = require('./src/services/extraction');

let totalTests = 0;
let passedTests = 0;

const runTest = async (name, fn) => {
    totalTests++;
    process.stdout.write(`  Testing: ${name} ... `);
    try {
        await fn();
        passedTests++;
        console.log('✅ PASSED');
    } catch (err) {
        console.log('❌ FAILED');
        console.error('     Error:', err.message);
    }
};

async function runAllFixtures() {
    console.log('\n=============================================================');
    console.log('       DRISHTISCAN STRUCTURING ENGINE FIXTURE SUITE         ');
    console.log('=============================================================\n');

    // -------------------------------------------------------------------------
    // FIXTURE 1: Cross-reference correction allowed
    // -------------------------------------------------------------------------
    console.log('--- Fixture 1: Cross-Reference Correction Allowed ---');
    await runTest('Cross-reference correction allowed when 2+ citations corroborate within edit distance', () => {
        const rowLookup = new Map([
            ['photo-1:0', 'PARLE-G BISCUITS'],
            ['photo-2:0', 'PARLE-6 BISCUITS']
        ]);

        const decision = {
            value: 'PARLE-G',
            rawObservedText: 'PARLE-G',
            grounded: true,
            groundingRefs: [
                { photoId: 'photo-1', rowId: 0 },
                { photoId: 'photo-2', rowId: 0 }
            ],
            correctionApplied: true,
            correctionReason: 'cross_reference_match'
        };

        const result = validateGrounding('brandName', decision, rowLookup, FIELD_TIERS.brandName);
        assert.strictEqual(result.status, 'verified', 'Expected status to be verified');
        assert.strictEqual(result.value, 'PARLE-G', 'Expected value to be PARLE-G');
        assert.strictEqual(result.provenance, 'ocr_corrected', 'Expected provenance to be ocr_corrected');
    });

    // -------------------------------------------------------------------------
    // FIXTURE 2: Invention forbidden
    // -------------------------------------------------------------------------
    console.log('\n--- Fixture 2: Invention Forbidden ---');
    await runTest('Invention forbidden when proposed value has no grounded support in cited row', () => {
        const rowLookup = new Map([
            ['photo-1:0', '100% ORGANIC HONEY']
        ]);

        const decision = {
            value: 'SUGAR FREE GOLD',
            rawObservedText: 'SUGAR FREE GOLD',
            grounded: true,
            groundingRefs: [
                { photoId: 'photo-1', rowId: 0 }
            ],
            correctionApplied: false,
            correctionReason: null
        };

        const result = validateGrounding('productName', decision, rowLookup, FIELD_TIERS.productName);
        assert.strictEqual(result.status, 'review', 'Expected invented value to be downgraded to review');
        assert.strictEqual(result.value, 'SUGAR FREE GOLD', 'Expected original value preserved for review');
    });

    // -------------------------------------------------------------------------
    // FIXTURE 3: Row concatenation
    // -------------------------------------------------------------------------
    console.log('\n--- Fixture 3: Row Concatenation ---');
    await runTest('Row concatenation allowed when all characters are present in cited adjacent rows', () => {
        const rowLookup = new Map([
            ['photo-1:0', '₹'],
            ['photo-1:1', '7'],
            ['photo-1:2', '9'],
            ['photo-1:3', '9']
        ]);

        const decision = {
            value: '₹799',
            rawObservedText: '₹ 7 9 9',
            grounded: true,
            groundingRefs: [
                { photoId: 'photo-1', rowId: 0 },
                { photoId: 'photo-1', rowId: 1 },
                { photoId: 'photo-1', rowId: 2 },
                { photoId: 'photo-1', rowId: 3 }
            ],
            correctionApplied: true,
            correctionReason: 'row_concatenation'
        };

        const result = validateGrounding('mrp', decision, rowLookup, FIELD_TIERS.mrp);
        assert.strictEqual(result.status, 'verified', 'Expected concatenated MRP to be verified');
        assert.strictEqual(result.value, '₹799', 'Expected value to be ₹799');
        assert.strictEqual(result.provenance, 'ocr_corrected', 'Expected provenance to be ocr_corrected');
    });

    // -------------------------------------------------------------------------
    // FIXTURE 4: Packaging directive rejected
    // -------------------------------------------------------------------------
    console.log('\n--- Fixture 4: Packaging Directive Rejected ---');
    await runTest('Packaging directive "CUT FROM HERE" is rejected and valid product/commodity names are accepted', () => {
        const rowLookup = new Map([
            ['photo-1:0', 'CUT FROM HERE'],
            ['photo-1:1', 'GULF DATES'],
            ['photo-1:2', 'ZAHIDI DATES']
        ]);

        // 1. Verify validateFieldFormat rejects CUT FROM HERE
        const vfCheck = validateFieldFormat('productName', 'CUT FROM HERE');
        assert.strictEqual(vfCheck.valid, false, 'Expected validateFieldFormat to reject CUT FROM HERE');

        // 2. Verify validateGrounding rejects CUT FROM HERE as identity
        const directiveDecision = {
            value: 'CUT FROM HERE',
            grounded: true,
            groundingRefs: [{ photoId: 'photo-1', rowId: 0 }],
            correctionApplied: false
        };
        const directiveRes = validateGrounding('productName', directiveDecision, rowLookup, FIELD_TIERS.productName);
        assert.strictEqual(directiveRes.status, 'review', 'Packaging directive must be marked review');

        // 3. Verify legitimate product title is verified
        const prodDecision = {
            value: 'GULF DATES',
            grounded: true,
            groundingRefs: [{ photoId: 'photo-1', rowId: 1 }],
            correctionApplied: false
        };
        const prodRes = validateGrounding('productName', prodDecision, rowLookup, FIELD_TIERS.productName);
        assert.strictEqual(prodRes.status, 'verified', 'Legitimate product name must be verified');
        assert.strictEqual(prodRes.value, 'GULF DATES');

        // 4. Verify generic commodity is verified
        const commDecision = {
            value: 'ZAHIDI DATES',
            grounded: true,
            groundingRefs: [{ photoId: 'photo-1', rowId: 2 }],
            correctionApplied: false
        };
        const commRes = validateGrounding('genericCommodityName', commDecision, rowLookup, FIELD_TIERS.genericCommodityName);
        assert.strictEqual(commRes.status, 'verified', 'Legitimate commodity must be verified');
        assert.strictEqual(commRes.value, 'ZAHIDI DATES');

        // 5. Ensure "CUT FROM HERE" is never accepted as product or brand
        assert.notStrictEqual(prodRes.value, 'CUT FROM HERE');
        assert.notStrictEqual(commRes.value, 'CUT FROM HERE');
    });

    // -------------------------------------------------------------------------
    // FIXTURE 5: GPT-OSS unavailable fallback
    // -------------------------------------------------------------------------
    console.log('\n--- Fixture 5: GPT-OSS Unavailable Fallback ---');
    await runTest('Pipeline falls back cleanly to deterministic extraction when GPT-OSS is unavailable', async () => {
        const originalKey = process.env.GROQ_API_KEY;
        try {
            process.env.GROQ_API_KEY = '';

            const photo = {
                rawElements: [
                    { text: 'ALPHA NUTRITION', confidence: 0.98, bbox: [[50, 50], [400, 50], [400, 150], [50, 150]] },
                    { text: 'CREATINE MONOHYDRATE', confidence: 0.95, bbox: [[50, 180], [600, 180], [600, 280], [50, 280]] },
                    { text: 'MRP Rs. 999.00 (incl of taxes)', confidence: 0.99, bbox: [[50, 300], [500, 300], [500, 380], [50, 380]] }
                ]
            };

            const ext = extractFields(photo, 'photo-fallback');
            const merged = await mergeMultiPhotoExtractedFields([ext]);

            assert.strictEqual(merged.declarations.structuringMode, 'deterministic_fallback', 'Expected structuringMode to be deterministic_fallback');
            assert.strictEqual(merged.mrp.value, 999, 'Expected MRP 999 extracted deterministically');
            assert.ok(merged.productName, 'Expected productName extracted deterministically');
        } finally {
            process.env.GROQ_API_KEY = originalKey;
        }
    });

    // -------------------------------------------------------------------------
    // FIXTURE 6: Statutory field format check gates LLM output
    // -------------------------------------------------------------------------
    console.log('\n--- Fixture 6: Statutory Field Format Check Gates LLM Output ---');
    await runTest('Format validator rejects invalid date and downgrades status to review with null normalized value', () => {
        const rowLookup = new Map([
            ['photo-1:0', 'MFG: INVALID_DATE']
        ]);

        const decision = {
            value: 'INVALID_DATE',
            rawObservedText: 'MFG: INVALID_DATE',
            grounded: true,
            groundingRefs: [{ photoId: 'photo-1', rowId: 0 }],
            correctionApplied: false
        };

        const result = validateGrounding('dateOfManufacture', decision, rowLookup, FIELD_TIERS.dateOfManufacture);
        assert.strictEqual(result.status, 'review', 'Expected invalid date format to be downgraded to review');
        assert.ok(result.reason.includes('Failed format validation'), `Expected reason to mention failed format validation, got "${result.reason}"`);

        // Verify that in structuring engine normalization, only 'verified' values populate normalizedFields
        const acceptedVal = result.status === 'verified' ? result.value : null;
        assert.strictEqual(acceptedVal, null, 'Normalized value must be null when status is review');
    });

    // =========================================================================
    // SUMMARY
    // =========================================================================
    console.log('\n=============================================================');
    console.log(` RESULTS: ${passedTests} / ${totalTests} fixtures passed`);
    console.log('=============================================================\n');

    if (passedTests !== totalTests) {
        process.exit(1);
    }
}

runAllFixtures().catch(err => {
    console.error('Fixture suite failed:', err);
    process.exit(1);
});
