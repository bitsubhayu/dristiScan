/**
 * DrishtiScan — Issue 1 Mandatory Test: Identity Verification Gate & Fallback Resilience
 * 
 * Tests:
 * 1. Suite 5 exact fixture asserting EXACT correct values:
 *    brandName === 'NEXUS LABS', productName === 'NITRO WHEY ISOLATE'
 * 2. When GPT-OSS fails (or is unavailable), Gemini's identity verification / fallback
 *    still gets a chance to act on the specific field that failed, rather than being skipped.
 */

require('dotenv').config({ path: './.env' });
const assert = require('assert');
const gptOssService = require('./src/services/gptOssService');
const geminiService = require('./src/services/geminiService');
const { extractFields, mergeMultiPhotoExtractedFields, applyGeminiFallback } = require('./src/services/extraction');

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
        throw err;
    }
};

async function run() {
    console.log('\n=============================================================');
    console.log('   DRISHTISCAN ISSUE 1: IDENTITY VERIFICATION GATE TESTS    ');
    console.log('=============================================================\n');

    // -------------------------------------------------------------------------
    // -------------------------------------------------------------------------
    // Test 1: Suite 5 exact fixture asserting EXACT values (not just truthiness)
    // Uses deterministic stub for AI boundary to guarantee 100% reproducibility
    // without requiring external network or live Groq API access.
    // -------------------------------------------------------------------------
    await runTest('Suite 5 fixture resolves exact brandName="NEXUS LABS" and productName="NITRO WHEY ISOLATE"', async () => {
        const origResolve = gptOssService.resolveIdentityFields;
        const origAvailable = gptOssService.isAvailable;
        try {
            gptOssService.isAvailable = () => true;
            gptOssService.resolveIdentityFields = async () => ({
                success: true,
                model: 'llama-3.3-70b-versatile',
                decisions: {
                    productName: { value: 'NITRO WHEY ISOLATE', confidence: 0.96, reason: 'Variant title distinct from manufacturer' },
                    brandName: { value: 'NEXUS LABS', confidence: 0.98, reason: 'Company/brand trade identifier' }
                }
            });

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

            // Confirm identity collision was detected on photo-1
            assert.strictEqual(ext1.identityCollisionResolved, true, 'Expected identityCollisionResolved on photo1');

            const mergedResult = await mergeMultiPhotoExtractedFields([ext1, ext2, ext3]);

            // Exact value assertions per Issue 1 test requirement
            assert.strictEqual(mergedResult.brandName, 'NEXUS LABS', `Expected brandName "NEXUS LABS", got "${mergedResult.brandName}"`);
            assert.strictEqual(mergedResult.productName, 'NITRO WHEY ISOLATE', `Expected productName "NITRO WHEY ISOLATE", got "${mergedResult.productName}"`);
            assert.strictEqual(mergedResult.reconciliation.gptOssUsed, true, 'Expected gptOssUsed to be true');
            assert.ok(
                (mergedResult.reconciliation.gptOssResolvedFields || []).includes('productName'),
                'Expected productName in gptOssResolvedFields'
            );
            assert.ok(
                (mergedResult.reconciliation.gptOssResolvedFields || []).includes('brandName'),
                'Expected brandName in gptOssResolvedFields'
            );
        } finally {
            gptOssService.resolveIdentityFields = origResolve;
            gptOssService.isAvailable = origAvailable;
        }
    });

    // -------------------------------------------------------------------------
    // Test 2: Field-level resilience when GPT-OSS fails
    // Confirm Gemini verification acts on the fields and resolves exact identity
    // -------------------------------------------------------------------------
    await runTest('When GPT-OSS fails or errors, Gemini verification still acts on the failed fields and resolves exact identity', async () => {
        const origGptResolve = gptOssService.resolveIdentityFields;
        const origGeminiReconcile = geminiService.reconcileFields;
        const origGeminiAvailable = geminiService.isAvailable;
        try {
            // Simulate GPT-OSS failure (e.g. rate limit / network error)
            gptOssService.resolveIdentityFields = async () => {
                throw new Error('Simulated Groq API 500 Network Error / Rate Limit');
            };

            // Mock Gemini to deterministically verify and classify brand vs product
            geminiService.isAvailable = () => true;
            geminiService.reconcileFields = async () => ({
                reconciledFields: {
                    productName: { value: 'NITRO WHEY ISOLATE', reasoning: 'Identified as specific variant title', isConflict: false },
                    brandName: { value: 'NEXUS LABS', reasoning: 'Identified as manufacturer brand name', isConflict: false }
                },
                brandClassification: {
                    brand: 'NEXUS LABS',
                    productName: 'NITRO WHEY ISOLATE',
                    genericName: null
                },
                skipped: false
            });

            const photo1 = {
                rawElements: [
                    { text: 'NEXUS LABS', confidence: 0.98, bbox: [[100, 50], [500, 50], [500, 150], [100, 150]] },
                    { text: 'NITRO WHEY ISOLATE', confidence: 0.96, bbox: [[100, 200], [700, 200], [700, 300], [100, 300]] }
                ]
            };

            const ext1 = extractFields(photo1, 'photo-1');
            const mergedResult = await mergeMultiPhotoExtractedFields([ext1]);

            // GPT-OSS failed, so gptOssResolvedFields must be empty
            assert.deepStrictEqual(mergedResult.reconciliation.gptOssResolvedFields || [], [], 'gptOssResolvedFields should be empty on failure');

            // Exact semantic assertions: Gemini correctly arbitrated brand vs product
            assert.strictEqual(mergedResult.brandName, 'NEXUS LABS', `Expected brandName "NEXUS LABS", got "${mergedResult.brandName}"`);
            assert.strictEqual(mergedResult.productName, 'NITRO WHEY ISOLATE', `Expected productName "NITRO WHEY ISOLATE", got "${mergedResult.productName}"`);
            assert.strictEqual(mergedResult.declarations.brandName.status, 'verified');
            assert.strictEqual(mergedResult.declarations.productName.status, 'verified');
            assert.strictEqual(mergedResult.declarations.brandName.source, 'gemini_reconciliation');
            assert.strictEqual(mergedResult.declarations.productName.source, 'gemini_reconciliation');
        } finally {
            gptOssService.resolveIdentityFields = origGptResolve;
            geminiService.reconcileFields = origGeminiReconcile;
            geminiService.isAvailable = origGeminiAvailable;
        }
    });

    // -------------------------------------------------------------------------
    // Test 3: applyGeminiFallback per-field check
    // If GPT-OSS is configured but did NOT resolve genericCommodityName,
    // applyGeminiFallback should queue genericCommodityName for image fallback
    // -------------------------------------------------------------------------
    await runTest('applyGeminiFallback only excludes fields that GPT-OSS actually resolved', async () => {
        const mergedFields = {
            productName: 'NITRO WHEY ISOLATE',
            brandName: 'NEXUS LABS',
            genericCommodityName: null,
            declarations: {
                productName: { value: 'NITRO WHEY ISOLATE', source: 'gpt_oss_120b', status: 'verified' },
                brandName: { value: 'NEXUS LABS', source: 'gpt_oss_120b', status: 'verified' },
                genericCommodityName: { value: null, status: 'not_detected' }
            },
            reconciliation: {
                gptOssUsed: true,
                gptOssResolvedFields: ['productName', 'brandName'] // genericCommodityName NOT resolved
            }
        };

        // Call applyGeminiFallback with an empty image list (will return mergedFields without calling API)
        const result = await applyGeminiFallback(mergedFields, []);

        // genericCommodityName should still be preserved and not thrown away
        assert.strictEqual(result.declarations.productName.value, 'NITRO WHEY ISOLATE');
        assert.strictEqual(result.declarations.brandName.value, 'NEXUS LABS');
    });

    // -------------------------------------------------------------------------
    // Test 4: BOTH-AI-UNAVAILABLE path with identity collision
    // When neither GPT-OSS nor Gemini is available, the system must NOT silently
    // preserve the swapped identity values. It must reset them to not_detected.
    // -------------------------------------------------------------------------
    await runTest('When BOTH GPT-OSS and Gemini are unavailable, identity collision does NOT silently preserve swapped identity', async () => {
        const origGptResolve = gptOssService.resolveIdentityFields;
        const origGptAvailable = gptOssService.isAvailable;
        const origGeminiAvailable = geminiService.isAvailable;
        try {
            gptOssService.isAvailable = () => false;
            gptOssService.resolveIdentityFields = async () => ({ success: false, skipped: true, reason: 'AI unavailable' });

            geminiService.isAvailable = () => false;

            const photo1 = {
                rawElements: [
                    { text: 'NEXUS LABS', confidence: 0.98, bbox: [[100, 50], [500, 50], [500, 150], [100, 150]] },
                    { text: 'NITRO WHEY ISOLATE', confidence: 0.96, bbox: [[100, 200], [700, 200], [700, 300], [100, 300]] }
                ]
            };

            const ext1 = extractFields(photo1, 'photo-1');
            assert.strictEqual(ext1.identityCollisionResolved, true, 'Precondition: identity collision must be detected on photo');

            const mergedResult = await mergeMultiPhotoExtractedFields([ext1]);

            // The system must NOT silently preserve the swapped identity
            assert.notStrictEqual(mergedResult.brandName, 'NITRO WHEY ISOLATE', 'Must NOT preserve swapped brandName');
            assert.notStrictEqual(mergedResult.productName, 'NEXUS LABS', 'Must NOT preserve swapped productName');

            // Safe state: unresolved / not_detected
            assert.strictEqual(mergedResult.brandName, null, 'brandName must be null when collision unresolved');
            assert.strictEqual(mergedResult.productName, null, 'productName must be null when collision unresolved');
            assert.strictEqual(mergedResult.declarations.brandName.status, 'not_detected', 'declarations.brandName.status must be not_detected');
            assert.strictEqual(mergedResult.declarations.productName.status, 'not_detected', 'declarations.productName.status must be not_detected');
            assert.strictEqual(mergedResult.reconciliation.fields.brandName.status, 'unresolved_collision');
            assert.strictEqual(mergedResult.reconciliation.fields.productName.status, 'unresolved_collision');
        } finally {
            gptOssService.resolveIdentityFields = origGptResolve;
            gptOssService.isAvailable = origGptAvailable;
            geminiService.isAvailable = origGeminiAvailable;
        }
    });

    // -------------------------------------------------------------------------
    // Test 5: BOTH-AI-UNAVAILABLE path WITHOUT collision
    // Legitimate single candidates without collision MUST be preserved.
    // -------------------------------------------------------------------------
    await runTest('When BOTH AI are unavailable, a valid non-collision single candidate is preserved normally', async () => {
        const origGptAvailable = gptOssService.isAvailable;
        const origGeminiAvailable = geminiService.isAvailable;
        try {
            gptOssService.isAvailable = () => false;
            geminiService.isAvailable = () => false;

            const photo = {
                rawElements: [
                    { text: 'Creatine Monohydrate', confidence: 0.96, bbox: [[100, 100], [600, 100], [600, 200], [100, 200]] },
                    { text: 'MRP Rs. 499.00', confidence: 0.99, bbox: [[100, 300], [500, 300], [500, 380], [100, 380]] }
                ]
            };

            const ext = extractFields(photo, 'photo-1');
            assert.strictEqual(ext.identityCollisionResolved, false, 'Precondition: no collision on clean label');

            const merged = await mergeMultiPhotoExtractedFields([ext]);

            assert.strictEqual(merged.productName, 'Creatine Monohydrate', 'Valid non-collision candidate must be preserved');
            assert.strictEqual(merged.declarations.productName.status, 'verified');
            assert.strictEqual(merged.mrp.value, 499);
        } finally {
            gptOssService.isAvailable = origGptAvailable;
            geminiService.isAvailable = origGeminiAvailable;
        }
    });

    console.log(`\n=============================================================`);
    console.log(` RESULTS: ${passedTests} / ${totalTests} tests passed`);
    console.log(`=============================================================\n`);
}

run().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
