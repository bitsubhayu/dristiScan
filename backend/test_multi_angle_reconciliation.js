/**
 * Multi-Angle Cross-Panel Reconciliation Test Suite
 * 
 * Verifies:
 * 1. Single-angle authentic extraction from bottle_1, bottle_2, and bottle_3.
 * 2. Cross-panel reconciliation across bottle_1 (Nutrition/NetQty) + bottle_2 (Identity/MRP/Dates/Mfr).
 * 3. Accurate field-level provenance (sourceImageId) for all 12 required fields.
 * 4. Legal Metrology rule engine evaluation on reconciled multi-panel product.
 * 5. Incompatible product conflict detection (bottle_1 + bottle_2 + bottle_3).
 * 6. Strict regulatory separation between Legal Metrology and FSSAI.
 */

const fs = require('fs');
const path = require('path');
const { extractFields, mergeMultiPhotoExtractedFields } = require('./src/services/extraction');
const { evaluateRules } = require('./src/services/ruleEngine');

// Colors for clean CLI output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let passedTotal = 0;
let failedTotal = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ${GREEN}✅ PASS${RESET}: ${message}`);
        passedTotal++;
    } else {
        console.error(`  ${RED}❌ FAIL${RESET}: ${message}`);
        failedTotal++;
    }
}

async function runTests() {
    console.log(`\n${BOLD}${CYAN}═════════════════════════════════════════════════════════════════${RESET}`);
    console.log(`${BOLD}${CYAN}   DRISHTISCAN MULTI-ANGLE CROSS-PANEL RECONCILIATION SUITE       ${RESET}`);
    console.log(`${BOLD}${CYAN}═════════════════════════════════════════════════════════════════${RESET}\n`);

    const fixturesDir = path.resolve(__dirname, '../ocr-service/test_fixtures');
    const b1Data = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'google_vision_bottle_1.json'), 'utf8'));
    const b2Data = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'google_vision_bottle_2.json'), 'utf8'));
    const b3Data = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'google_vision_bottle_3.json'), 'utf8'));

    // -------------------------------------------------------------
    // Test 1: Single Panel Authentic Extractions
    // -------------------------------------------------------------
    console.log(`${BOLD}Test 1: Single-Panel Authentic Extraction Checks${RESET}`);
    const ext1 = extractFields(b1Data, 'bottle_1');
    const ext2 = extractFields(b2Data, 'bottle_2');
    const ext3 = extractFields(b3Data, 'bottle_3');

    assert(ext1.netQuantity?.value === 60 && ext1.netQuantity?.unit === 'capsules', 'bottle_1 contains Net Quantity 60 capsules');
    assert(ext1.mrp?.value === null, 'bottle_1 does NOT contain fabricated MRP (authentic clean fixture)');
    assert(ext1.batchNumber === null, 'bottle_1 does NOT contain fabricated batch (authentic clean fixture)');
    assert(ext1.dates?.manufacture === null, 'bottle_1 does NOT contain fabricated dates (authentic clean fixture)');
    assert(ext1.declarations?.netQuantity?.sourceImageId === 'bottle_1', 'bottle_1 netQuantity has sourceImageId="bottle_1"');

    assert(ext2.brandName === 'Optimum Nutrition', 'bottle_2 correctly extracts brandName="Optimum Nutrition"');
    assert(ext2.productName === 'Fish Oil Dietary Supplement Softgels', 'bottle_2 correctly extracts productName="Fish Oil Dietary Supplement Softgels"');
    assert(ext2.mrp?.value === 666 && ext2.mrp?.inclusiveOfTaxes === true, 'bottle_2 extracts MRP=666.00 (inclusive of all taxes)');
    assert(ext2.batchNumber === 'ONFO26005', 'bottle_2 extracts batchNumber="ONFO26005"');
    assert(ext2.dates?.manufacture === 'MAY 2026', 'bottle_2 extracts mfg date="MAY 2026"');
    assert(ext2.dates?.expiry === 'NOV 2027', 'bottle_2 extracts exp date="NOV 2027"');
    assert(ext2.manufacturer?.name === 'Tirupati Lifesciences Pvt. Ltd.', 'bottle_2 extracts manufacturer="Tirupati Lifesciences Pvt. Ltd."');
    assert(ext2.packer?.name === 'Glanbia Performance Nutrition India Pvt. Ltd.', 'bottle_2 extracts packer="Glanbia Performance Nutrition India Pvt. Ltd."');
    assert(ext2.importer?.name === 'Glanbia Performance Nutrition India Pvt. Ltd.', 'bottle_2 extracts importer="Glanbia Performance Nutrition India Pvt. Ltd."');
    assert(ext2.consumerCare?.phone === '+91-11-49594959', 'bottle_2 extracts consumerCare.phone="+91-11-49594959"');
    assert(ext2.consumerCare?.email === 'indiacustomercare@glanbia.com', 'bottle_2 extracts consumerCare.email="indiacustomercare@glanbia.com"');
    assert(ext2.unitSalePrice !== null, 'bottle_2 extracts unitSalePrice');

    assert(ext3.brandName === 'Coca-Cola', 'bottle_3 correctly extracts brandName="Coca-Cola"');
    assert(ext3.genericCommodityName === 'Carbonated Beverage', 'bottle_3 correctly extracts genericCommodityName="Carbonated Beverage"');
    assert(ext3.manufacturer?.name === 'THE COCA-COLA COMPANY', 'bottle_3 extracts manufacturer="THE COCA-COLA COMPANY"');

    // -------------------------------------------------------------
    // Test 2: Cross-Panel Reconciliation (bottle_1 + bottle_2)
    // -------------------------------------------------------------
    console.log(`\n${BOLD}Test 2: Same-Product Cross-Panel Reconciliation (bottle_1 + bottle_2)${RESET}`);
    const merged = await mergeMultiPhotoExtractedFields([ext1, ext2]);

    assert(Array.isArray(merged.conflicts) && merged.conflicts.length === 0, 'No false conflicts generated for complementary package panels');
    assert(merged.brandName === 'Optimum Nutrition', 'Merged brandName is "Optimum Nutrition"');
    assert(merged.productName === 'Fish Oil Dietary Supplement Softgels', 'Merged productName is "Fish Oil Dietary Supplement Softgels"');
    assert(merged.genericCommodityName === 'Dietary Supplement Softgels', 'Merged genericCommodityName is "Dietary Supplement Softgels"');
    assert(merged.mrp?.value === 666 && merged.mrp?.inclusiveOfTaxes === true, 'Merged MRP is 666 (inclusive of all taxes)');
    assert(merged.netQuantity?.value === 60 && merged.netQuantity?.unit === 'capsules', 'Merged netQuantity is 60 capsules (from bottle_1)');
    assert(merged.dates?.manufacture === 'MAY 2026', 'Merged mfg date is "MAY 2026" (from bottle_2)');
    assert(merged.dates?.expiry === 'NOV 2027', 'Merged expiry date is "NOV 2027" (from bottle_2)');
    assert(merged.batchNumber === 'ONFO26005', 'Merged batchNumber is "ONFO26005" (from bottle_2)');
    assert(merged.manufacturer?.name === 'Tirupati Lifesciences Pvt. Ltd.', 'Merged manufacturer is "Tirupati Lifesciences Pvt. Ltd."');
    assert(merged.packer?.name === 'Glanbia Performance Nutrition India Pvt. Ltd.', 'Merged packer is "Glanbia Performance Nutrition India Pvt. Ltd."');
    assert(merged.importer?.name === 'Glanbia Performance Nutrition India Pvt. Ltd.', 'Merged importer is "Glanbia Performance Nutrition India Pvt. Ltd."');
    assert(merged.consumerCare?.phone === '+91-11-49594959', 'Merged consumerCare.phone is "+91-11-49594959"');
    assert(merged.consumerCare?.email === 'indiacustomercare@glanbia.com', 'Merged consumerCare.email is "indiacustomercare@glanbia.com"');
    assert(merged.countryOfOrigin === 'India', 'Merged countryOfOrigin is "India"');

    // -------------------------------------------------------------
    // Test 3: Field-Level Provenance Across All 12 Required Fields
    // -------------------------------------------------------------
    console.log(`\n${BOLD}Test 3: Field-Level Provenance on merged.declarations (All 12 Required Fields)${RESET}`);
    const REQUIRED_12_FIELDS = [
        { key: 'brandName', expectedSource: 'bottle_2', name: 'Brand Name' },
        { key: 'productName', expectedSource: 'bottle_2', name: 'Product Name' },
        { key: 'genericCommodityName', expectedSource: 'bottle_2', name: 'Generic Commodity Name' },
        { key: 'mrp', expectedSource: 'bottle_2', name: 'Maximum Retail Price (MRP)' },
        { key: 'netQuantity', expectedSource: 'bottle_1', name: 'Net Quantity' },
        { key: 'manufacturingDate', expectedSource: 'bottle_2', name: 'Date of Manufacture' },
        { key: 'expiryDate', expectedSource: 'bottle_2', name: 'Expiry Date' },
        { key: 'batchNumber', expectedSource: 'bottle_2', name: 'Batch / Lot Number' },
        { key: 'manufacturer', expectedSource: 'bottle_2', name: 'Manufacturer Details' },
        { key: 'packer', expectedSource: 'bottle_2', name: 'Packer Details' },
        { key: 'importer', expectedSource: 'bottle_2', name: 'Importer Details' },
        { key: 'consumerCare', expectedSource: 'bottle_2', name: 'Consumer Care Contact' },
        { key: 'countryOfOrigin', expectedSource: 'bottle_1', name: 'Country of Origin' }
    ];

    for (const item of REQUIRED_12_FIELDS) {
        const decl = merged.declarations[item.key];
        const hasDecl = Boolean(decl);
        const sourceMatches = decl?.sourceImageId === item.expectedSource || (item.key === 'countryOfOrigin' && (decl?.sourceImageId === 'bottle_1' || decl?.sourceImageId === 'bottle_2'));
        const isVerified = decl?.status === 'verified';
        assert(hasDecl && isVerified && sourceMatches, 
            `${item.name} [${item.key}]: verified with provenance sourceImageId="${decl?.sourceImageId}" (expected: ${item.expectedSource})`
        );
    }

    // -------------------------------------------------------------
    // Test 4: Legal Metrology Rule Engine Evaluation
    // -------------------------------------------------------------
    console.log(`\n${BOLD}Test 4: Legal Metrology Rule Engine Evaluation (evaluateRules)${RESET}`);
    const evalResult = await evaluateRules(merged);

    assert(evalResult.overallStatus === 'COMPLIANT', `Overall compliance status is "COMPLIANT" (got: "${evalResult.overallStatus}")`);
    
    const passedCodes = evalResult.findings.filter(f => f.status === 'PASS').map(f => f.ruleCode);
    const expectedRules = ['LM-01', 'LM-02', 'LM-03', 'LM-04', 'LM-05', 'LM-06', 'LM-07', 'LM-08', 'LM-09', 'LM-10'];
    for (const code of expectedRules) {
        assert(passedCodes.includes(code), `Legal Metrology Rule ${code} passed`);
    }

    // -------------------------------------------------------------
    // Test 5: Conflict Detection on Mismatched Products (bottle_1 + bottle_2 + bottle_3)
    // -------------------------------------------------------------
    console.log(`\n${BOLD}Test 5: Cross-Product Conflict Detection (bottle_1 + bottle_2 + bottle_3)${RESET}`);
    const conflictingMerged = await mergeMultiPhotoExtractedFields([ext1, ext2, ext3]);

    assert(conflictingMerged.conflicts.length > 0, `Conflicts detected across mismatched commodities (found: ${conflictingMerged.conflicts.length})`);
    
    const conflictFields = conflictingMerged.conflicts.map(c => c.field);
    assert(conflictFields.includes('brandName'), 'Brand name conflict flagged (Optimum Nutrition vs Coca-Cola)');
    assert(conflictFields.includes('productName'), 'Product name conflict flagged (Supplement vs Beverage)');
    assert(conflictFields.includes('manufacturer.name'), 'Manufacturer conflict flagged (Tirupati vs The Coca-Cola Company)');
    assert(conflictFields.includes('netQuantity'), 'Net quantity conflict flagged (60 capsules vs 591 ml)');

    const conflictEval = await evaluateRules(conflictingMerged);
    assert(conflictEval.overallStatus === 'POTENTIAL_NON_COMPLIANCE', `Rule engine flags conflicting product scan as "POTENTIAL_NON_COMPLIANCE" (got: "${conflictEval.overallStatus}")`);

    // -------------------------------------------------------------
    // Test 6: Strict Legal Metrology and FSSAI Separation
    // -------------------------------------------------------------
    console.log(`\n${BOLD}Test 6: Strict Legal Metrology / FSSAI Rule System Separation${RESET}`);
    const fssaiFindings = evalResult.findings.filter(f => f.ruleCode.startsWith('FSSAI-') || f.field === 'fssaiLicenseNumber');
    assert(fssaiFindings.length === 0, 'Legal Metrology rule findings do NOT include FSSAI rules or evaluate FSSAI compliance');
    assert(merged.fssaiLicenseNumber === '10012011000123', 'FSSAI License is extracted into its designated domain attribute');

    // -------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------
    console.log(`\n${BOLD}═════════════════════════════════════════════════════════════════${RESET}`);
    console.log(`  ${BOLD}Results: ${GREEN}${passedTotal} passed${RESET}, ${failedTotal > 0 ? RED : GREEN}${failedTotal} failed${RESET}, ${passedTotal + failedTotal} total`);
    console.log(`${BOLD}═════════════════════════════════════════════════════════════════${RESET}\n`);

    if (failedTotal > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Fatal error running reconciliation test suite:', err);
    process.exit(1);
});
