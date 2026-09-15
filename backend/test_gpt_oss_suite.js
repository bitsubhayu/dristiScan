/**
 * DrishtiScan — Comprehensive Test Suite for GPT-OSS 120B Integration (Groq API)
 * 
 * Tests:
 * 1. Direct Service Integration & Structured JSON Output
 * 2. Ambiguity Disambiguation (Brand vs Product Name vs Generic Commodity)
 * 3. Null on Insufficient / Irrelevant Evidence (Zero Hallucination)
 * 4. Negative Constraint Enforcement (Dosages, Prices, Dates, Nutrition)
 * 5. Multi-Photo 3-Angle Reconciled Input
 * 6. Error, Timeout, and Missing Key Fallback Resilience
 */

require('dotenv').config({ path: './.env' });
const assert = require('assert');
const gptOssService = require('./src/services/gptOssService');
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
    console.log('       DRISHTISCAN GPT-OSS 120B COMPREHENSIVE TEST SUITE     ');
    console.log('=============================================================\n');

    // =========================================================================
    // SUITE 1: Service Availability & Structured JSON Output
    // =========================================================================
    console.log('--- Suite 1: Service Availability & Structured JSON Output ---');

    await runTest('gptOssService should be available when GROQ_API_KEY is configured', () => {
        assert.strictEqual(gptOssService.isAvailable(), true, 'Expected GROQ_API_KEY to be available in environment');
    });

    await runTest('Direct resolveIdentityFields call should return valid structured output', async () => {
        const rawOcrTokens = [
            { text: 'ALPHA NUTRITION', confidence: 0.98, bbox: [[50, 50], [400, 50], [400, 150], [50, 150]] },
            { text: 'PURE CREATINE 2000', confidence: 0.95, bbox: [[50, 180], [600, 180], [600, 280], [50, 280]] },
            { text: 'Micronized Creatine Monohydrate Powder', confidence: 0.93, bbox: [[50, 300], [700, 300], [700, 360], [50, 360]] }
        ];

        const deterministicCandidates = [
            { field: 'brandName', text: 'ALPHA NUTRITION', confidence: 0.98, score: 75 },
            { field: 'productName', text: 'PURE CREATINE 2000', confidence: 0.95, score: 80 },
            { field: 'genericCommodityName', text: 'Micronized Creatine Monohydrate Powder', confidence: 0.93, score: 70 }
        ];

        const res = await gptOssService.resolveIdentityFields({
            unresolvedFields: ['productName', 'brandName', 'genericCommodityName'],
            deterministicCandidates,
            rawOcrTokens,
            imageMeta: { width: 1000, height: 1000 }
        });

        assert.strictEqual(res.success, true, `Expected success: true, got ${JSON.stringify(res)}`);
        assert.ok(res.decisions, 'Expected decisions object in response');
        assert.ok(res.decisions.productName, 'Expected productName decision');
        assert.ok(res.decisions.brandName, 'Expected brandName decision');
        assert.ok(res.decisions.genericCommodityName, 'Expected genericCommodityName decision');
        assert.ok(typeof res.latencyMs === 'number', 'Expected latencyMs metric');
    });

    // =========================================================================
    // SUITE 2: Ambiguity Disambiguation (Brand vs Product vs Commodity)
    // =========================================================================
    console.log('\n--- Suite 2: Ambiguity Disambiguation ---');

    await runTest('Disambiguates corporate brand from variant marketing title', async () => {
        const rawOcrTokens = [
            { text: 'ZENITH BOTANICALS', confidence: 0.97, bbox: [[100, 50], [500, 50], [500, 150], [100, 150]] },
            { text: 'GOLDEN HARVEST HONEY', confidence: 0.94, bbox: [[100, 200], [700, 200], [700, 300], [100, 300]] },
            { text: 'Pure Organic Honey', confidence: 0.92, bbox: [[100, 320], [600, 320], [600, 380], [100, 380]] }
        ];

        const deterministicCandidates = [
            { field: 'brandName', text: 'ZENITH BOTANICALS', confidence: 0.97, score: 70 },
            { field: 'productName', text: 'GOLDEN HARVEST HONEY', confidence: 0.94, score: 75 }
        ];

        const res = await gptOssService.resolveIdentityFields({
            unresolvedFields: ['productName', 'brandName', 'genericCommodityName'],
            deterministicCandidates,
            rawOcrTokens,
            imageMeta: { width: 1000, height: 1000 }
        });

        assert.strictEqual(res.success, true);
        const brand = res.decisions.brandName?.value?.toLowerCase() || '';
        const prod = res.decisions.productName?.value?.toLowerCase() || '';
        
        assert.ok(brand.includes('zenith'), `Expected brand to contain "zenith", got "${brand}"`);
        assert.ok(prod.includes('golden') || prod.includes('harvest') || prod.includes('honey'), `Expected product to contain variant name, got "${prod}"`);
        assert.notStrictEqual(brand, prod, 'Brand and Product Name must be distinct');
    });

    // =========================================================================
    // SUITE 3: Null on Insufficient / Irrelevant Evidence (Zero Hallucination)
    // =========================================================================
    console.log('\n--- Suite 3: Zero Hallucination on Insufficient Evidence ---');

    await runTest('Returns null for productName and brandName when evidence contains only fine print storage text', async () => {
        const rawOcrTokens = [
            { text: 'Store in a cool, dry place away from direct sunlight.', confidence: 0.95, bbox: [] },
            { text: 'Keep out of reach of children.', confidence: 0.94, bbox: [] },
            { text: 'Best before 24 months from packaging.', confidence: 0.92, bbox: [] }
        ];

        const res = await gptOssService.resolveIdentityFields({
            unresolvedFields: ['productName', 'brandName'],
            deterministicCandidates: [],
            rawOcrTokens,
            imageMeta: { width: 1000, height: 1000 }
        });

        assert.strictEqual(res.success, true);
        assert.strictEqual(res.decisions.productName, null, 'Expected productName to be null when only storage text is present');
        assert.strictEqual(res.decisions.brandName, null, 'Expected brandName to be null when only storage text is present');
    });

    // =========================================================================
    // SUITE 4: Negative Constraint Enforcement
    // =========================================================================
    console.log('\n--- Suite 4: Negative Constraint Enforcement ---');

    await runTest('Rejects dosages (300 mg), prices (Rs. 499), and dates from productName', async () => {
        const rawOcrTokens = [
            { text: '300 mg', confidence: 0.99, bbox: [[100, 50], [300, 50], [300, 150], [100, 150]] },
            { text: 'Rs. 499.00', confidence: 0.99, bbox: [[100, 160], [300, 160], [300, 260], [100, 260]] },
            { text: '13-05-2026', confidence: 0.99, bbox: [[100, 270], [300, 270], [300, 360], [100, 360]] },
            { text: 'SUPERIOR WHEY BLEND', confidence: 0.95, bbox: [[100, 380], [700, 380], [700, 480], [100, 480]] }
        ];

        const deterministicCandidates = [
            { field: 'productName', text: 'SUPERIOR WHEY BLEND', confidence: 0.95, score: 85 }
        ];

        const res = await gptOssService.resolveIdentityFields({
            unresolvedFields: ['productName'],
            deterministicCandidates,
            rawOcrTokens,
            imageMeta: { width: 1000, height: 1000 }
        });

        assert.strictEqual(res.success, true);
        const prodVal = res.decisions.productName?.value || '';
        assert.ok(!prodVal.includes('300 mg'), 'productName must never be 300 mg');
        assert.ok(!prodVal.includes('499'), 'productName must never be Rs. 499');
        assert.ok(!prodVal.includes('2026'), 'productName must never be date');
        assert.ok(prodVal.toLowerCase().includes('whey') || prodVal.toLowerCase().includes('blend'), `Expected legitimate product name, got "${prodVal}"`);
    });

    // =========================================================================
    // SUITE 5: Multi-Photo 3-Angle Reconciled Input
    // =========================================================================
    console.log('\n--- Suite 5: Multi-Photo 3-Angle Reconciliation ---');

    await runTest('mergeMultiPhotoExtractedFields arbitrates 3 photos in a single combined call', async () => {
        // Short pause to ensure on-demand TPM quota is clear
        await new Promise(r => setTimeout(r, 4000));

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
                { text: 'MFG: JAN 2026', confidence: 0.98, bbox: [[100, 200], [400, 200], [400, 280], [100, 280]] },
                { text: 'EXP: DEC 2027', confidence: 0.98, bbox: [[100, 300], [400, 300], [400, 380], [100, 380]] },
                { text: 'Batch No: NL2601', confidence: 0.96, bbox: [[100, 400], [400, 400], [400, 480], [100, 480]] }
            ]
        };

        const ext1 = extractFields(photo1, 'photo-1');
        const ext2 = extractFields(photo2, 'photo-2');
        const ext3 = extractFields(photo3, 'photo-3');

        const mergedResult = await mergeMultiPhotoExtractedFields([ext1, ext2, ext3]);

        // Verify Statutory Declarations remained 100% deterministic
        assert.strictEqual(mergedResult.mrp.value, 2499, 'MRP must be preserved deterministically as 2499');
        assert.strictEqual(mergedResult.dates.manufacture, 'JAN 2026', 'Mfg date must be preserved deterministically');
        assert.strictEqual(mergedResult.dates.expiry, 'DEC 2027', 'Expiry date must be preserved deterministically');
        assert.strictEqual(mergedResult.batchNumber, 'NL2601', 'Batch number must be preserved deterministically');

        // Verify Semantic Identity Fields were arbitrated
        assert.ok(mergedResult.productName, 'Expected productName to be populated');
        assert.ok(mergedResult.brandName, 'Expected brandName to be populated');
        assert.ok(mergedResult.reconciliation.gptOssUsed, 'Expected gptOssUsed flag to be true');
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
            assert.strictEqual(merged.reconciliation.gptOssUsed, undefined, 'GPT-OSS should not be used when key is missing');
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
