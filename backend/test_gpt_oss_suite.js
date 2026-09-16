/**
 * DrishtiScan — Comprehensive Test Suite for GPT-OSS Structuring Engine (Groq API)
 * 
 * Tests:
 * 1. Direct Service Availability & structuringEngine.structureFields Output
 * 2. Ambiguity Disambiguation (Brand vs Product Name vs Generic Commodity)
 * 3. Null on Insufficient / Irrelevant Evidence (Zero Hallucination)
 * 4. Negative Constraint Enforcement (Dosages, Prices, Dates, Nutrition)
 * 5. Multi-Photo 3-Angle Reconciled Input via mergeMultiPhotoExtractedFields
 * 6. Error, Timeout, and Missing Key Fallback Resilience
 */

require('dotenv').config({ path: './.env' });
const assert = require('assert');
const gptOssService = require('./src/services/gptOssService');
const structuringEngine = require('./src/services/structuringEngine');
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

async function runAllTests() {
    console.log('\n=============================================================');
    console.log('       DRISHTISCAN GPT-OSS STRUCTURING COMPREHENSIVE SUITE    ');
    console.log('=============================================================\n');

    // =========================================================================
    // SUITE 1: Service Availability & Structured JSON Output
    // =========================================================================
    console.log('--- Suite 1: Service Availability & Structured JSON Output ---');

    await runTest('gptOssService should be available when GROQ_API_KEY is configured', () => {
        assert.strictEqual(gptOssService.isAvailable(), true, 'Expected GROQ_API_KEY to be available in environment');
    });

    await runTest('structuringEngine.structureFields should return valid 20-field structured output', async () => {
        const photoRowsList = [{
            photoId: 'photo-1',
            rows: [
                { rowId: 0, text: 'ALPHA NUTRITION', elements: [{ text: 'ALPHA NUTRITION' }] },
                { rowId: 1, text: 'PURE CREATINE 2000', elements: [{ text: 'PURE CREATINE 2000' }] },
                { rowId: 2, text: 'Micronized Creatine Monohydrate Powder', elements: [{ text: 'Micronized Creatine Monohydrate Powder' }] }
            ]
        }];

        const deterministicHints = [
            { field: 'brandName', text: 'ALPHA NUTRITION', confidence: 0.98 },
            { field: 'productName', text: 'PURE CREATINE 2000', confidence: 0.95 },
            { field: 'genericCommodityName', text: 'Micronized Creatine Monohydrate Powder', confidence: 0.93 }
        ];

        const res = await structuringEngine.structureFields(photoRowsList, deterministicHints);

        assert.strictEqual(res.success, true, `Expected success: true, got ${JSON.stringify(res)}`);
        assert.ok(res.normalizedFields, 'Expected normalizedFields in response');
        assert.ok(res.declarations, 'Expected declarations in response');
        assert.ok(res.validation, 'Expected validation in response');
        assert.ok(res.normalizedFields.productName, 'Expected productName to be populated');
        assert.ok(res.normalizedFields.brandName, 'Expected brandName to be populated');
        assert.ok(typeof res.latencyMs === 'number', 'Expected latencyMs metric');
    });

    // =========================================================================
    // SUITE 2: Ambiguity Disambiguation (Brand vs Product vs Commodity)
    // =========================================================================
    console.log('\n--- Suite 2: Ambiguity Disambiguation ---');
    await new Promise(r => setTimeout(r, 1500));

    await runTest('Disambiguates corporate brand from variant marketing title', async () => {
        const photoRowsList = [{
            photoId: 'photo-1',
            rows: [
                { rowId: 0, text: 'ZENITH BOTANICALS', elements: [{ text: 'ZENITH BOTANICALS' }] },
                { rowId: 1, text: 'GOLDEN HARVEST HONEY', elements: [{ text: 'GOLDEN HARVEST HONEY' }] },
                { rowId: 2, text: 'Pure Organic Honey', elements: [{ text: 'Pure Organic Honey' }] }
            ]
        }];

        const res = await structuringEngine.structureFields(photoRowsList);

        assert.strictEqual(res.success, true);
        const brand = (res.normalizedFields.brandName || '').toLowerCase();
        const prod = (res.normalizedFields.productName || '').toLowerCase();
        
        assert.ok(brand.includes('zenith'), `Expected brand to contain "zenith", got "${brand}"`);
        assert.ok(prod.includes('golden') || prod.includes('harvest') || prod.includes('honey'), `Expected product to contain variant name, got "${prod}"`);
        assert.notStrictEqual(brand, prod, 'Brand and Product Name must be distinct');
    });

    // =========================================================================
    // SUITE 3: Null on Insufficient / Irrelevant Evidence (Zero Hallucination)
    // =========================================================================
    console.log('\n--- Suite 3: Zero Hallucination on Insufficient Evidence ---');
    await new Promise(r => setTimeout(r, 1500));

    await runTest('Returns null for productName and brandName when evidence contains only fine print storage text', async () => {
        const photoRowsList = [{
            photoId: 'photo-1',
            rows: [
                { rowId: 0, text: 'Store in a cool, dry place away from direct sunlight.', elements: [{ text: 'Store in a cool, dry place away from direct sunlight.' }] },
                { rowId: 1, text: 'Keep out of reach of children.', elements: [{ text: 'Keep out of reach of children.' }] },
                { rowId: 2, text: 'Best before 24 months from packaging.', elements: [{ text: 'Best before 24 months from packaging.' }] }
            ]
        }];

        const res = await structuringEngine.structureFields(photoRowsList);

        assert.strictEqual(res.success, true);
        assert.strictEqual(res.normalizedFields.productName, null, 'Expected productName to be null when only storage text is present');
        assert.strictEqual(res.normalizedFields.brandName, null, 'Expected brandName to be null when only storage text is present');
    });

    // =========================================================================
    // SUITE 4: Negative Constraint Enforcement
    // =========================================================================
    console.log('\n--- Suite 4: Negative Constraint Enforcement ---');
    await new Promise(r => setTimeout(r, 1500));

    await runTest('Rejects dosages (300 mg), prices (Rs. 499), and dates from productName', async () => {
        const photoRowsList = [{
            photoId: 'photo-1',
            rows: [
                { rowId: 0, text: '300 mg', elements: [{ text: '300 mg' }] },
                { rowId: 1, text: 'Rs. 499.00', elements: [{ text: 'Rs. 499.00' }] },
                { rowId: 2, text: '13-05-2026', elements: [{ text: '13-05-2026' }] },
                { rowId: 3, text: 'SUPERIOR WHEY BLEND', elements: [{ text: 'SUPERIOR WHEY BLEND' }] }
            ]
        }];

        const res = await structuringEngine.structureFields(photoRowsList);

        assert.strictEqual(res.success, true);
        const prodVal = res.normalizedFields.productName || '';
        assert.ok(!prodVal.includes('300 mg'), 'productName must never be 300 mg');
        assert.ok(!prodVal.includes('499'), 'productName must never be Rs. 499');
        assert.ok(!prodVal.includes('2026'), 'productName must never be date');
        assert.ok(prodVal.toLowerCase().includes('whey') || prodVal.toLowerCase().includes('blend'), `Expected legitimate product name, got "${prodVal}"`);
    });

    // =========================================================================
    // SUITE 5: Multi-Photo 3-Angle Reconciled Input
    // =========================================================================
    console.log('\n--- Suite 5: Multi-Photo 3-Angle Reconciliation ---');
    await new Promise(r => setTimeout(r, 2000));

    await runTest('mergeMultiPhotoExtractedFields arbitrates 3 photos in a single combined call', async () => {
        // Angle 1: Front Panel with Brand and Product Title
        const photo1 = {
            rawElements: [
                { text: 'NEXUS LABS', confidence: 0.98, bbox: [[100, 50], [500, 50], [500, 150], [100, 150]] },
                { text: 'NITRO WHEY ISOLATE', confidence: 0.96, bbox: [[100, 200], [700, 200], [700, 300], [100, 300]] }
            ]
        };

        // Angle 2: Side Panel with Generic Commodity Declaration
        const photo2 = {
            rawElements: [
                { text: 'Generic Name: Whey Protein Dietary Supplement', confidence: 0.94, bbox: [[100, 100], [700, 100], [700, 180], [100, 180]] },
                { text: 'Net Qty: 1 kg', confidence: 0.97, bbox: [[100, 220], [400, 220], [400, 300], [100, 300]] }
            ]
        };

        // Angle 3: Back Legal Metrology Panel (MRP, Dates, Batch)
        const photo3 = {
            rawElements: [
                { text: 'MRP Rs. 2499.00 (incl of taxes)', confidence: 0.99, bbox: [[100, 100], [600, 100], [600, 180], [100, 180]] },
                { text: 'MFG: 01/2026', confidence: 0.98, bbox: [[100, 200], [400, 200], [400, 280], [100, 280]] },
                { text: 'EXP: 12/2027', confidence: 0.98, bbox: [[100, 300], [400, 300], [400, 380], [100, 380]] },
                { text: 'Batch No: NL2601', confidence: 0.96, bbox: [[100, 400], [400, 400], [400, 480], [100, 480]] }
            ]
        };

        const ext1 = extractFields(photo1, 'photo-1');
        const ext2 = extractFields(photo2, 'photo-2');
        const ext3 = extractFields(photo3, 'photo-3');

        const mergedResult = await mergeMultiPhotoExtractedFields([ext1, ext2, ext3]);

        // Verify Statutory Declarations structured and verified
        assert.strictEqual(mergedResult.mrp.value, 2499, 'MRP must be 2499');
        assert.ok(mergedResult.dates.manufacture.includes('2026'), 'Mfg date must include 2026');
        assert.ok(mergedResult.dates.expiry.includes('2027'), 'Expiry date must include 2027');
        assert.strictEqual(mergedResult.batchNumber, 'NL2601', 'Batch number must be NL2601');

        // Verify Semantic Identity Fields were arbitrated
        assert.ok(mergedResult.productName, 'Expected productName to be populated');
        assert.ok(mergedResult.brandName, 'Expected brandName to be populated');
        assert.strictEqual(mergedResult.reconciliation.gptOssUsed, true, 'Expected gptOssUsed flag to be true');
    });

    // =========================================================================
    // SUITE 6: Error, Timeout, and Missing Key Fallback
    // =========================================================================
    console.log('\n--- Suite 6: Graceful Fallback & Error Resilience ---');

    await runTest('Falls back seamlessly to deterministic extraction when GROQ_API_KEY is temporarily unset', async () => {
        const originalKey = process.env.GROQ_API_KEY;
        try {
            process.env.GROQ_API_KEY = '';

            const photo = {
                rawElements: [
                    { text: 'Creatine Monohydrate', confidence: 0.96, bbox: [[100, 100], [600, 100], [600, 200], [100, 200]] },
                    { text: 'MRP Rs. 499.00', confidence: 0.99, bbox: [[100, 300], [500, 300], [500, 380], [100, 380]] }
                ]
            };

            const ext = extractFields(photo, 'photo-1');
            const merged = await mergeMultiPhotoExtractedFields([ext]);

            assert.strictEqual(merged.mrp.value, 499);
            assert.strictEqual(merged.productName, 'Creatine Monohydrate', 'Expected deterministic productName preserved');
            assert.strictEqual(merged.declarations.structuringMode, 'deterministic_fallback');
        } finally {
            process.env.GROQ_API_KEY = originalKey;
        }
    });

    // =========================================================================
    // SUMMARY
    // =========================================================================
    console.log('\n=============================================================');
    console.log(` RESULTS: ${passedTests} / ${totalTests} tests passed`);
    console.log('=============================================================\n');

    if (passedTests !== totalTests) {
        process.exit(1);
    }
}

runAllTests().catch(err => {
    console.error('Test suite failed with unhandled error:', err);
    process.exit(1);
});
