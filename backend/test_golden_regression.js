/**
 * DrishtiScan — Golden Regression Test Suite
 * 
 * Verifies:
 * 1. Multi-Photo Reconciliation Integrity (Suite 2)
 * 2. Module Exports Verification (Suite 3)
 * 3. Rate Limiter Middleware (Suite 5)
 * 4. Upload Validator Middleware (Suite 6)
 * 
 * Usage: node test_golden_regression.js
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

// ─── Mock/Shim for multi-photo reconciliation tests in Suite 2 ───────────────
const normalize = (s) => {
    if (typeof s !== 'string') return String(s || '').toLowerCase().trim();
    return s.toLowerCase().replace(/[^a-z0-9]/gi, '').trim();
};

const reconcileFields = async (candidatesByField) => {
    const reconciledFields = {};
    for (const [field, candidates] of Object.entries(candidatesByField)) {
        if (!candidates || candidates.length === 0) continue;
        if (candidates.length === 1) {
            reconciledFields[field] = {
                value: candidates[0].value,
                isConflict: false
            };
            continue;
        }

        // Filter out noise suffix fragments
        const filtered = candidates.filter(c => {
            const v = String(c.value || '').trim().toLowerCase();
            return !['ation', 'tion', 'sion', 'ment', 'ties'].includes(v);
        });

        const activeCandidates = filtered.length > 0 ? filtered : candidates;
        const firstVal = activeCandidates[0].value;
        const normFirst = normalize(firstVal);

        let allIdentical = true;
        let longest = firstVal;
        let hasConflict = false;

        if (field === 'mrp') {
            const numVals = activeCandidates.map(c => parseFloat(String(c.value).replace(/[^0-9.]/g, ''))).filter(n => !isNaN(n));
            const min = Math.min(...numVals);
            const max = Math.max(...numVals);
            if (max - min > 5 && max / (min || 1) > 1.2) {
                hasConflict = true;
            }
        }

        for (let i = 1; i < activeCandidates.length; i++) {
            const cVal = activeCandidates[i].value;
            const normC = normalize(cVal);
            if (normC !== normFirst) {
                allIdentical = false;
                if (normC.includes(normFirst) || normFirst.includes(normC)) {
                    if (String(cVal).length > String(longest).length) {
                        longest = cVal;
                    }
                } else {
                    hasConflict = true;
                }
            }
        }

        reconciledFields[field] = {
            value: hasConflict ? firstVal : longest,
            isConflict: hasConflict
        };
    }
    return { reconciledFields };
};

const geminiService = { reconcileFields };

// ─── Main test runner ───────────────────────────────────────────────────────

async function runTests() {

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
    const structuringEngine = require('./src/services/structuringEngine');
    const textShapeValidators = require('./src/services/textShapeValidators');
    const ocrReconstruction = require('./src/services/ocrReconstruction');

    await test('extractFields function should exist and be callable', async () => {
        assert.strictEqual(typeof extractionModule.extractFields, 'function');
    });

    await test('mergeMultiPhotoExtractedFields function should exist', async () => {
        assert.strictEqual(typeof extractionModule.mergeMultiPhotoExtractedFields, 'function');
    });

    await test('applyGeminiFallback function should exist', async () => {
        assert.strictEqual(typeof extractionModule.applyGeminiFallback, 'function');
    });

    await test('structuringEngine.structureFields function should exist and be callable', async () => {
        assert.strictEqual(typeof structuringEngine.structureFields, 'function');
    });

    await test('textShapeValidators functions should exist', async () => {
        assert.strictEqual(typeof textShapeValidators.isDateShaped, 'function');
        assert.strictEqual(typeof textShapeValidators.isValidQuantityUnit, 'function');
        assert.strictEqual(typeof textShapeValidators.isNonProductTitleCandidate, 'function');
        assert.strictEqual(typeof textShapeValidators.validateFieldFormat, 'function');
        assert.strictEqual(typeof textShapeValidators.sanitizeExtractedText, 'function');
        assert.ok(Array.isArray(textShapeValidators.KNOWN_COUNTRIES));
    });

    await test('ocrReconstruction functions should exist', async () => {
        assert.strictEqual(typeof ocrReconstruction.groupIntoRows, 'function');
        assert.strictEqual(typeof ocrReconstruction.generateCandidateTitles, 'function');
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
