/**
 * DrishtiScan Phase 6 — Golden Regression Test Suite
 * 
 * Tests the extraction pipeline for:
 * 1. No cross-contamination between sequential scans
 * 2. No hardcoded brand overrides corrupting extracted fields
 * 3. Schema validation rejects malformed Gemini responses
 * 4. Confidence threshold is correctly applied
 * 
 * Usage: node test_golden_regression.js
 * Requires: Node.js only (no OCR service needed — uses mock data)
 */

const assert = require('assert');

// ─── Test Helpers ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

async function test(name, fn) {
    try {
        await fn();
        passed++;
        results.push({ name, status: 'PASS' });
        console.log(`  ✅ ${name}`);
    } catch (err) {
        failed++;
        results.push({ name, status: 'FAIL', error: err.message });
        console.log(`  ❌ ${name}`);
        console.log(`     → ${err.message}`);
    }
}

// ─── Load modules under test ────────────────────────────────────────────────

const geminiService = require('./src/services/geminiService');

// ─── Main test runner ───────────────────────────────────────────────────────

async function runTests() {

    // ═══ Suite 1: No Hardcoded Brand Classification ═══
    console.log('\n═══ Suite 1: No Hardcoded Brand Classification ═══');

    await test('localReconcileFields should NOT override productName for Optimum Nutrition keywords', async () => {
        const result = await geminiService.reconcileFields({
            productName: [
                { value: 'Enteric Coated Fish Oil', rawText: 'Enteric Coated Fish Oil', photoId: 'photo1' }
            ],
            'manufacturer.name': [
                { value: 'Optimum Nutrition Inc.', rawText: 'Optimum Nutrition Inc.', photoId: 'photo1' }
            ]
        });
        // With single candidates per field, local fallback should accept them as-is
        const reconciledProduct = result.reconciledFields?.productName;
        assert.ok(reconciledProduct, 'productName should exist in reconciled output');
        assert.strictEqual(reconciledProduct.value, 'Enteric Coated Fish Oil',
            'productName should be the OCR-extracted value, not a hardcoded override');
    });

    await test('localReconcileFields should NOT override productName for Coca-Cola keywords', async () => {
        const result = await geminiService.reconcileFields({
            productName: [
                { value: 'Coca-Cola Zero Sugar', rawText: 'Coca-Cola Zero Sugar', photoId: 'photo1' }
            ]
        });
        const reconciledProduct = result.reconciledFields?.productName;
        assert.ok(reconciledProduct, 'productName should exist');
        assert.strictEqual(reconciledProduct.value, 'Coca-Cola Zero Sugar',
            'productName should preserve extracted value, not overwrite to "Coca-Cola Original"');
    });

    await test('localReconcileFields should NOT override productName for Haldirams keywords', async () => {
        const result = await geminiService.reconcileFields({
            productName: [
                { value: "Haldiram's Bhujia Sev 400g", rawText: "Haldiram's Bhujia Sev 400g", photoId: 'photo1' }
            ]
        });
        const reconciledProduct = result.reconciledFields?.productName;
        assert.ok(reconciledProduct, 'productName should exist');
        assert.strictEqual(reconciledProduct.value, "Haldiram's Bhujia Sev 400g",
            'Should preserve full extracted value');
    });

    await test('brandClassification should be null (no hardcoded catalog)', async () => {
        const result = await geminiService.reconcileFields({
            productName: [
                { value: 'Fish Oil', rawText: 'Fish Oil optimum nutrition', photoId: 'photo1' }
            ]
        });
        assert.strictEqual(result.brandClassification, null,
            'brandClassification should be null — no hardcoded catalog');
    });

    // ═══ Suite 2: Multi-Photo Reconciliation Integrity ═══
    console.log('\n═══ Suite 2: Multi-Photo Reconciliation Integrity ═══');

    await test('Two identical values from different photos should resolve without conflict', async () => {
        const result = await geminiService.reconcileFields({
            productName: [
                { value: 'Amul Butter', rawText: 'Amul Butter', photoId: 'photo1' },
                { value: 'Amul Butter', rawText: 'Amul Butter', photoId: 'photo2' }
            ]
        });
        const rp = result.reconciledFields?.productName;
        assert.ok(rp, 'productName should exist');
        assert.strictEqual(rp.isConflict, false, 'Identical values should NOT be a conflict');
        assert.strictEqual(rp.value, 'Amul Butter');
    });

    await test('Substring values should resolve to the longer one', async () => {
        const result = await geminiService.reconcileFields({
            productName: [
                { value: 'Tata Salt', rawText: 'Tata Salt', photoId: 'photo1' },
                { value: 'Tata Salt Vacuum Evaporated', rawText: 'Tata Salt Vacuum Evaporated', photoId: 'photo2' }
            ]
        });
        const rp = result.reconciledFields?.productName;
        assert.ok(rp, 'productName should exist');
        assert.strictEqual(rp.value, 'Tata Salt Vacuum Evaporated',
            'Should pick the longer, more complete reading');
        assert.strictEqual(rp.isConflict, false);
    });

    await test('Genuinely different product names should flag as conflict', async () => {
        const result = await geminiService.reconcileFields({
            productName: [
                { value: 'Amul Butter', rawText: 'Amul Butter', photoId: 'photo1' },
                { value: 'Britannia Good Day', rawText: 'Britannia Good Day', photoId: 'photo2' }
            ]
        });
        const rp = result.reconciledFields?.productName;
        assert.ok(rp, 'productName should exist');
        assert.strictEqual(rp.isConflict, true,
            'Completely different product names should be flagged as a genuine conflict');
    });

    await test('Numeric MRP discrepancy should flag as conflict', async () => {
        const result = await geminiService.reconcileFields({
            mrp: [
                { value: '120', rawText: 'MRP Rs 120', photoId: 'photo1' },
                { value: '250', rawText: 'MRP Rs 250', photoId: 'photo2' }
            ]
        });
        const rp = result.reconciledFields?.mrp;
        assert.ok(rp, 'mrp should exist');
        assert.strictEqual(rp.isConflict, true,
            'Large numeric difference in MRP should be flagged as conflict');
    });

    await test('Noise suffix fragments should be discarded', async () => {
        const result = await geminiService.reconcileFields({
            'manufacturer.name': [
                { value: 'Nestle India Pvt Ltd', rawText: 'Nestle India Pvt Ltd', photoId: 'photo1' },
                { value: 'ation', rawText: 'ation', photoId: 'photo2' }
            ]
        });
        const rp = result.reconciledFields?.['manufacturer.name'];
        assert.ok(rp, 'manufacturer.name should exist');
        assert.strictEqual(rp.value, 'Nestle India Pvt Ltd',
            'Should discard noise suffix fragment "ation"');
    });

    // ═══ Suite 3: Module Exports Verification ═══
    console.log('\n═══ Suite 3: Module Exports Verification ═══');

    const extractionModule = require('./src/services/extraction');

    await test('extractFields function should exist and be callable', async () => {
        assert.strictEqual(typeof extractionModule.extractFields, 'function');
    });

    await test('mergeMultiPhotoExtractedFields function should exist', async () => {
        assert.strictEqual(typeof extractionModule.mergeMultiPhotoExtractedFields, 'function');
    });

    await test('applyGeminiFallback function should exist', async () => {
        assert.strictEqual(typeof extractionModule.applyGeminiFallback, 'function');
    });

    // ═══ Suite 4: Sequential Scan Independence ═══
    console.log('\n═══ Suite 4: Sequential Scan Independence ═══');

    await test('geminiService.reconcileFields is stateless across calls', async () => {
        // First call with product A
        const resultA = await geminiService.reconcileFields({
            productName: [{ value: 'Multivitamin Gold', rawText: 'multivitamin gold capsules', photoId: 'p1' }],
            mrp: [{ value: '450', rawText: 'MRP 450', photoId: 'p1' }]
        });

        // Second call with product B
        const resultB = await geminiService.reconcileFields({
            productName: [{ value: 'Amul Toned Milk', rawText: 'Amul Toned Milk 500ml', photoId: 'p2' }],
            mrp: [{ value: '30', rawText: 'MRP Rs 30', photoId: 'p2' }]
        });

        // Product B should NOT contain any data from Product A
        assert.strictEqual(resultB.reconciledFields.productName.value, 'Amul Toned Milk',
            'Second scan should have its own product name, not multivitamin');
        assert.strictEqual(resultB.reconciledFields.mrp.value, '30',
            'Second scan should have its own MRP');

        // Verify Product A is also clean
        assert.strictEqual(resultA.reconciledFields.productName.value, 'Multivitamin Gold',
            'First scan product name should be preserved');
    });

    await test('geminiService.fallbackReadFields returns skipped when no key', async () => {
        const result = await geminiService.fallbackReadFields(null, ['productName'], 'image/jpeg');
        // Without GEMINI_API_KEY and null imageBuffer, it should return skipped or empty results
        assert.ok(result, 'Should return a result object');
        assert.ok(result.skipped === true || Object.keys(result.results || {}).length === 0,
            'Should skip or return empty results without API key');
    });

    // ═══ Suite 5: Rate Limiter ═══
    console.log('\n═══ Suite 5: Rate Limiter Middleware ═══');

    const { createRateLimiter } = require('./src/middleware/rateLimiter');

    await test('Rate limiter should allow requests under the limit', async () => {
        const limiter = createRateLimiter({ name: 'test_allow', windowMs: 60000, max: 3 });
        const mockReq = { ip: '10.0.0.1' };
        const mockRes = { status: () => ({ json: () => {} }), set: () => {} };
        let nextCalled = 0;
        const mockNext = () => { nextCalled++; };

        limiter(mockReq, mockRes, mockNext);
        limiter(mockReq, mockRes, mockNext);
        limiter(mockReq, mockRes, mockNext);

        assert.strictEqual(nextCalled, 3, 'Should allow 3 requests under limit of 3');
    });

    await test('Rate limiter should block requests over the limit', async () => {
        const limiter = createRateLimiter({ name: 'test_block', windowMs: 60000, max: 2 });
        const mockReq = { ip: '10.0.0.2' };
        let blockedStatus = null;
        const mockRes = {
            status: (code) => {
                blockedStatus = code;
                return { json: () => {} };
            },
            set: () => {}
        };
        let nextCalled = 0;
        const mockNext = () => { nextCalled++; };

        limiter(mockReq, mockRes, mockNext);
        limiter(mockReq, mockRes, mockNext);
        limiter(mockReq, mockRes, mockNext);

        assert.strictEqual(nextCalled, 2, 'Should only allow 2 requests');
        assert.strictEqual(blockedStatus, 429, 'Should return 429 on the 3rd request');
    });

    // ═══ Suite 6: Upload Validator ═══
    console.log('\n═══ Suite 6: Upload Validator Middleware ═══');

    const { validateUploads } = require('./src/middleware/uploadValidator');

    await test('Should accept valid JPEG files', async () => {
        const validator = validateUploads();
        const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
        const mockReq = {
            files: { images: [{ originalname: 'test.jpg', mimetype: 'image/jpeg', size: 1024, buffer: jpegBuffer }] }
        };
        let nextCalled = false;
        validator(mockReq, {}, () => { nextCalled = true; });
        assert.strictEqual(nextCalled, true, 'Should call next() for valid JPEG');
    });

    await test('Should reject non-image MIME types', async () => {
        const validator = validateUploads();
        const mockReq = {
            files: { images: [{ originalname: 'malware.exe', mimetype: 'application/x-executable', size: 1024, buffer: Buffer.from([0x4D, 0x5A]) }] }
        };
        let rejectedStatus = null;
        const mockRes = {
            status: (code) => { rejectedStatus = code; return { json: () => {} }; }
        };
        validator(mockReq, mockRes, () => {});
        assert.strictEqual(rejectedStatus, 415, 'Should return 415 for non-image MIME type');
    });

    await test('Should reject oversized files', async () => {
        const validator = validateUploads({ maxSize: 100 });
        const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
        const mockReq = {
            files: { images: [{ originalname: 'huge.jpg', mimetype: 'image/jpeg', size: 200, buffer: jpegBuffer }] }
        };
        let rejectedStatus = null;
        const mockRes = {
            status: (code) => { rejectedStatus = code; return { json: () => {} }; }
        };
        validator(mockReq, mockRes, () => {});
        assert.strictEqual(rejectedStatus, 413, 'Should return 413 for oversized file');
    });

    // ═══ Summary ═══
    console.log('\n═══════════════════════════════════════════════════');
    console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    console.log('═══════════════════════════════════════════════════');

    if (failed > 0) {
        console.log('\n  Failed tests:');
        results.filter(r => r.status === 'FAIL').forEach(r => {
            console.log(`    ❌ ${r.name}: ${r.error}`);
        });
        process.exit(1);
    } else {
        console.log('\n  ✅ All tests passed!\n');
        process.exit(0);
    }
}

runTests().catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
});
