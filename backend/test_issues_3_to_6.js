/**
 * DrishtiScan — Verification Suite for Issues 3, 4, 5, 6 & Statutory Determinism
 */

require('dotenv').config({ path: './.env' });
const assert = require('assert');
const { 
    extractFields, 
    mergeMultiPhotoExtractedFields, 
    validateFieldFormat, 
    isNonProductTitleCandidate 
} = require('./src/services/extraction');
const { evaluateRules } = require('./src/services/ruleEngine');

let passedTests = 0;
let totalTests = 0;

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
    console.log('   DRISHTISCAN ISSUES 3-6 & STATUTORY DETERMINISM SUITE    ');
    console.log('=============================================================\n');

    // -------------------------------------------------------------------------
    // ISSUE 3: RuleEngine LM-03 Never Passes with Instructional Text
    // -------------------------------------------------------------------------
    console.log('--- Issue 3 Verification: LM-03 Rule Engine Outcome ---');
    await runTest('LM-03 does not PASS with instructional text on Gulf Dates fixture', async () => {
        const fixture = {
            rawElements: [
                { text: 'CUT FROM HERE', confidence: 0.95, bbox: [[50,30],[350,30],[350,150],[50,150]] },
                { text: 'GULF DATES', confidence: 0.90, bbox: [[60,300],[500,300],[500,400],[60,400]] },
                { text: 'ZAHIDI DATES', confidence: 0.88, bbox: [[60,420],[520,420],[520,500],[60,500]] },
                { text: 'Net Wt. 500g', confidence: 0.93, bbox: [[60,700],[300,700],[300,760],[60,760]] }
            ]
        };

        const extracted = extractFields(fixture, 'photo-1');
        assert.notStrictEqual(extracted.productName, 'CUT FROM HERE');

        const evalResult = await evaluateRules(extracted);
        const lm03 = (evalResult.findings || []).find(r => r.ruleCode === 'LM-03');
        assert.ok(lm03, 'Expected LM-03 rule to be evaluated');
        assert.notStrictEqual(lm03.extractedValue, 'CUT FROM HERE', 'LM-03 must never have instructional text as extractedValue');
        console.log(`    LM-03 status: ${lm03.status}, value: "${lm03.extractedValue}"`);
    });

    await runTest('LM-03 is INSUFFICIENT_EVIDENCE when only instructional text is present (no product name)', async () => {
        const fixtureOnlyInstruction = {
            rawElements: [
                { text: 'TEAR ALONG DOTTED LINE', confidence: 0.95, bbox: [[50,30],[350,30],[350,150],[50,150]] },
                { text: 'Net Wt. 500g', confidence: 0.93, bbox: [[60,700],[300,700],[300,760],[60,760]] }
            ]
        };

        const extracted = extractFields(fixtureOnlyInstruction, 'photo-1');
        assert.strictEqual(extracted.productName, null, 'productName should be null when only instructional text exists');

        const evalResult = await evaluateRules(extracted);
        const lm03 = (evalResult.findings || []).find(r => r.ruleCode === 'LM-03');
        assert.ok(lm03, 'Expected LM-03 rule to be evaluated');
        assert.strictEqual(lm03.status, 'INSUFFICIENT_EVIDENCE', 'LM-03 should be INSUFFICIENT_EVIDENCE, not PASS');
    });

    // -------------------------------------------------------------------------
    // ISSUE 4: Bbox Normalization in rawOcrText
    // -------------------------------------------------------------------------
    console.log('\n--- Issue 4 Verification: Bbox Normalization ---');
    await runTest('rawOcrText bounding boxes are normalized to 0-1 fractions of image dimensions', async () => {
        const ocrResults = {
            imageWidth: 4000,
            imageHeight: 3000,
            results: [
                { text: 'BRAND NAME', confidence: 0.95, bbox: [[400, 300], [2000, 300], [2000, 600], [400, 600]] },
                { text: 'PRODUCT TITLE', confidence: 0.92, bbox: [[400, 700], [3600, 700], [3600, 1200], [400, 1200]] }
            ]
        };

        const extracted = extractFields(ocrResults, 'photo-1');
        assert.ok(extracted.rawOcrText, 'Expected rawOcrText array');
        assert.strictEqual(extracted.rawOcrText.length, 2);

        for (const token of extracted.rawOcrText) {
            assert.ok(Array.isArray(token.bbox) && token.bbox.length === 4, 'Expected 4-point bbox');
            for (const [x, y] of token.bbox) {
                assert.ok(x >= 0 && x <= 1, `Expected x between 0 and 1, got ${x}`);
                assert.ok(y >= 0 && y <= 1, `Expected y between 0 and 1, got ${y}`);
            }
        }

        // Token 0 check: [400/4000, 300/3000] = [0.1, 0.1]
        assert.strictEqual(extracted.rawOcrText[0].bbox[0][0], 0.1);
        assert.strictEqual(extracted.rawOcrText[0].bbox[0][1], 0.1);
    });

    await runTest('rawOcrText safely degrades to empty bbox if imageWidth/imageHeight is missing or zero', async () => {
        const ocrResultsNoMeta = {
            imageWidth: 0,
            imageHeight: 0,
            results: [
                { text: 'SOME TEXT', confidence: 0.9, bbox: [[100, 100], [200, 100], [200, 200], [100, 200]] }
            ]
        };

        const extracted = extractFields(ocrResultsNoMeta, 'photo-1');
        assert.deepStrictEqual(extracted.rawOcrText[0].bbox, [], 'Missing dimensions should degrade to [] without throw');
    });

    // -------------------------------------------------------------------------
    // ISSUE 5: Uniform Validation via isNonProductTitleCandidate
    // -------------------------------------------------------------------------
    console.log('\n--- Issue 5 Verification: Validation Alignment ---');
    await runTest('isNonProductTitleCandidate is exported and correctly rejects invalid titles', async () => {
        assert.strictEqual(typeof isNonProductTitleCandidate, 'function');
        assert.strictEqual(isNonProductTitleCandidate('CUT FROM HERE'), true, 'Should reject cut directive');
        assert.strictEqual(isNonProductTitleCandidate('PEEL TO OPEN'), true, 'Should reject peel directive');
        assert.strictEqual(isNonProductTitleCandidate('Store in a cool dry place'), true, 'Should reject storage');
        assert.strictEqual(isNonProductTitleCandidate('Batch No: 12345'), true, 'Should reject batch');
        assert.strictEqual(isNonProductTitleCandidate('GOLD STANDARD 100% WHEY'), false, 'Should accept valid product title');
    });

    await runTest('validateFieldFormat rejects instructional packaging text for identity fields', async () => {
        const vfProd = validateFieldFormat('productName', 'CUT FROM HERE');
        assert.strictEqual(vfProd.valid, false, 'validateFieldFormat should reject CUT FROM HERE for productName');

        const vfBrand = validateFieldFormat('brandName', 'PEEL TAB TO OPEN');
        assert.strictEqual(vfBrand.valid, false, 'validateFieldFormat should reject PEEL TAB TO OPEN for brandName');

        const vfValid = validateFieldFormat('productName', 'GOLD STANDARD WHEY');
        assert.strictEqual(vfValid.valid, true, 'validateFieldFormat should accept valid productName');
    });

    // -------------------------------------------------------------------------
    // ISSUE 6: Dot-path Setter for Non-Whitelisted Scalar Fields
    // -------------------------------------------------------------------------
    console.log('\n--- Issue 6 Verification: Reconciled Non-Whitelist Fields Applied ---');
    await runTest('reconciled scalar fields outside the old 6-entry whitelist are applied to merged', async () => {
        // photo 1 has packer.name "Alpha Packing Ltd", photo 2 has "Alpha Packing Pvt Ltd"
        const ext1 = {
            sourceImageId: 'photo-1',
            packer: { name: 'Alpha Packing Ltd' },
            consumerCare: { phone: '1800-111-222', email: 'care@example.com' },
            rawOcrText: []
        };
        const ext2 = {
            sourceImageId: 'photo-2',
            packer: { name: 'Alpha Packing Pvt Ltd' },
            consumerCare: { phone: '1800-111-222', email: 'care@example.com' },
            rawOcrText: []
        };

        const merged = await mergeMultiPhotoExtractedFields([ext1, ext2]);

        // packer.name was NOT in the old 6-entry setterMap!
        // With setNestedField, it should now be properly set on merged.packer.name!
        assert.ok(merged.packer, 'Expected merged.packer to exist');
        assert.ok(merged.packer.name, 'Expected merged.packer.name to be populated');
        console.log(`    merged.packer.name resolved to: "${merged.packer.name}"`);
        assert.strictEqual(merged.consumerCare.phone, '1800-111-222');
        assert.strictEqual(merged.consumerCare.email, 'care@example.com');
    });

    // -------------------------------------------------------------------------
    // RULE 4: Statutory Fields Stay Fully Deterministic
    // -------------------------------------------------------------------------
    console.log('\n--- Rule 4 Check: Statutory Fields Determinism ---');
    await runTest('statutory fields are never modified by Gemini reconciliation setter', async () => {
        const statutoryFields = [
            'mrp',
            'unitSalePrice',
            'netQuantity',
            'dates.manufacture',
            'dates.expiry',
            'dates.bestBefore',
            'batchNumber',
            'fssaiLicenseNumber',
            'servingsPerContainer',
            'servingSize',
            'ingredients',
            'nutritionFacts'
        ];

        // All statutory fields must be protected from overwrite
        const photo1 = {
            sourceImageId: 'photo-1',
            mrp: { value: 999, currency: 'INR', inclusiveOfTaxes: true },
            unitSalePrice: 'Rs. 1.99 / g',
            netQuantity: { value: 500, unit: 'g' },
            dates: { manufacture: '01/2026', expiry: '01/2028', bestBefore: null },
            batchNumber: 'B123',
            fssaiLicenseNumber: '10012345678901',
            servingsPerContainer: 25,
            servingSize: '20g',
            ingredients: ['Whey Protein Concentrate', 'Cocoa Powder', 'Sucralose'],
            nutritionFacts: { calories: 120, protein: 24, fat: 1.5, carbohydrates: 3 },
            rawElements: []
        };

        const merged = await mergeMultiPhotoExtractedFields([photo1]);

        assert.strictEqual(merged.mrp.value, 999);
        assert.strictEqual(merged.unitSalePrice, 'Rs. 1.99 / g');
        assert.strictEqual(merged.netQuantity.value, 500);
        assert.strictEqual(merged.dates.manufacture, '01/2026');
        assert.strictEqual(merged.dates.expiry, '01/2028');
        assert.strictEqual(merged.batchNumber, 'B123');
        assert.strictEqual(merged.fssaiLicenseNumber, '10012345678901');
        assert.strictEqual(merged.servingsPerContainer, 25);
        assert.strictEqual(merged.servingSize, '20g');
        assert.strictEqual(merged.ingredients.length, 3);
        assert.strictEqual(merged.nutritionFacts.protein, 24);
    });

    console.log(`\n=============================================================`);
    console.log(` RESULTS: ${passedTests} / ${totalTests} tests passed`);
    console.log(`=============================================================\n`);
}

run().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
