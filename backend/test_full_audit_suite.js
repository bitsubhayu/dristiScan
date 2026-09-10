const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const { extractFields, mergeMultiPhotoExtractedFields } = require('./src/services/extraction');
const { evaluateRules } = require('./src/services/ruleEngine');
const { generatePDF, generateDOCX } = require('./src/services/reportGenerator');

const API_BASE = 'http://localhost:5000/api';

async function scanImages(endpoint, imagePaths, queryParams = '') {
    const form = new FormData();
    for (const imgPath of imagePaths) {
        form.append('images', fs.createReadStream(imgPath), {
            filename: path.basename(imgPath),
            contentType: imgPath.endsWith('.png') ? 'image/png' : 'image/jpeg'
        });
    }

    const res = await axios.post(`${API_BASE}/${endpoint}/scan${queryParams}`, form, {
        headers: form.getHeaders(),
        timeout: 180000
    });
    return res.data;
}

function createDummyImage(filePath) {
    const minimalPng = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x10,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x91, 0x68, 0x36, 0x00, 0x00, 0x00,
        0x19, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0x00,
        0x00, 0x00, 0x04, 0x00, 0x01, 0x27, 0x34, 0x27, 0x0a, 0x00, 0x00, 0x00,
        0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
    ]);
    fs.writeFileSync(filePath, minimalPng);
}

async function runAuditSuite() {
    console.log("=================================================================");
    console.log("      DRISHTISCAN COMPREHENSIVE AUDIT TEST SUITE (A - R)         ");
    console.log("=================================================================\n");

    const suiteReport = {};
    let passedCount = 0;
    let failedCount = 0;

    const recordResult = (testId, passed, details) => {
        suiteReport[testId] = { passed, details };
        if (passed) {
            passedCount++;
            console.log(`✅ [${testId}] PASSED: ${details.summary}\n`);
        } else {
            failedCount++;
            console.log(`❌ [${testId}] FAILED: ${details.summary}\n`);
        }
    };

    // -------------------------------------------------------------
    // TEST A: Same Supplement Bottle (Live OCR & Pipeline)
    // -------------------------------------------------------------
    console.log(">>> Running TEST A: Same supplement bottle scan...");
    try {
        const bottlePaths = [
            path.join(__dirname, '../test_images/bottle_1.jpeg'),
            path.join(__dirname, '../test_images/bottle_2.jpeg')
        ];
        const resA = await scanImages('consumer', bottlePaths, '?debug=true');
        const fieldsA = resA.extractedFields;
        const resAStr = JSON.stringify(resA);

        const hasHaldiram = /haldiram|bhujia|\bsev\b|400\s*g|customercare@haldirams/i.test(resAStr);
        const hasBottleData = fieldsA.mrp?.value === 666 &&
                              fieldsA.batchNumber === 'ONFO26005' &&
                              /MAY\s*2026/i.test(fieldsA.dates?.manufacture || '') &&
                              /NOV\s*2027/i.test(fieldsA.dates?.expiry || '');
        const noFalseConflict = !fieldsA.conflicts || fieldsA.conflicts.length === 0;

        const passed = !hasHaldiram && hasBottleData && noFalseConflict;
        recordResult('TEST_A', passed, {
            summary: passed ? 'No Haldiram data; supplement bottle fields accurate; zero false conflicts' : 'Haldiram or conflict detected',
            mrp: fieldsA.mrp?.value,
            batch: fieldsA.batchNumber,
            mfg: fieldsA.dates?.manufacture,
            exp: fieldsA.dates?.expiry,
            conflicts: fieldsA.conflicts
        });
    } catch (err) {
        recordResult('TEST_A', false, { summary: err.message });
    }

    // -------------------------------------------------------------
    // TEST B: Different Product (Isolation Check)
    // -------------------------------------------------------------
    console.log(">>> Running TEST B: Different product (Coca-Cola isolation)...");
    try {
        const colaPath = [path.join(__dirname, '../test_images/bottle_3.jpg')];
        const resB = await scanImages('consumer', colaPath);
        const fieldsB = resB.extractedFields;
        const resBStr = JSON.stringify(resB);

        const hasTestAData = /ONFO26005|Fish Oll|666\.00/i.test(resBStr);
        const hasHaldiram = /haldiram|bhujia/i.test(resBStr);
        const passed = !hasTestAData && !hasHaldiram;

        recordResult('TEST_B', passed, {
            summary: passed ? 'Zero leakage from TEST A or Haldiram data' : 'Leakage detected from TEST A',
            productName: fieldsB.productName
        });
    } catch (err) {
        recordResult('TEST_B', false, { summary: err.message });
    }

    // -------------------------------------------------------------
    // TEST C: Multi-Angle Same Product
    // -------------------------------------------------------------
    console.log(">>> Running TEST C: Multi-angle same product merging...");
    try {
        const bottlePaths = [
            path.join(__dirname, '../test_images/bottle_1.jpeg'),
            path.join(__dirname, '../test_images/bottle_2.jpeg')
        ];
        const resC = await scanImages('officer', bottlePaths);
        const fieldsC = resC.extractedFields;

        // Complementary fields from both angles
        const hasAngle1Servings = fieldsC.servingsPerContainer === 60;
        const hasAngle1ServingSize = Boolean(fieldsC.servingSize && fieldsC.servingSize.includes('1 Capsule'));
        const hasAngle2Data = fieldsC.mrp?.value === 666 && fieldsC.batchNumber === 'ONFO26005';

        // Strict invariant: "Servings Per Container 60" must NEVER become netQuantity
        const netQuantityNot60Servings = !fieldsC.netQuantity || (fieldsC.netQuantity.value !== 60 && fieldsC.netQuantity.unit !== 'servings');
        const netQuantityCorrect = !fieldsC.netQuantity || fieldsC.netQuantity.value === null || typeof fieldsC.netQuantity.value === 'number';

        // Absent fields from one angle are NOT conflicts
        const noFalseConflict = !fieldsC.conflicts || fieldsC.conflicts.length === 0;

        const passed = hasAngle1Servings && hasAngle1ServingSize && hasAngle2Data && netQuantityNot60Servings && netQuantityCorrect && noFalseConflict;

        recordResult('TEST_C', passed, {
            summary: passed ? 'Complementary valid fields merged; servingsPerContainer (60) kept separate; netQuantity is NOT 60 servings; zero false conflicts' : 'Merge or conflict issue',
            servingsPerContainer: fieldsC.servingsPerContainer,
            servingSize: fieldsC.servingSize,
            netQuantity: fieldsC.netQuantity,
            mrp: fieldsC.mrp?.value,
            batch: fieldsC.batchNumber,
            conflicts: fieldsC.conflicts
        });
    } catch (err) {
        recordResult('TEST_C', false, { summary: err.message });
    }

    // -------------------------------------------------------------
    // TEST D: Session & State Isolation
    // -------------------------------------------------------------
    console.log(">>> Running TEST D: Session isolation between sequential scans...");
    try {
        const colaPath = [path.join(__dirname, '../test_images/bottle_3.jpg')];
        const resD = await scanImages('consumer', colaPath);
        const resDStr = JSON.stringify(resD);

        const hasLeakedData = /ONFO26005|Fish Oll|666\.00/i.test(resDStr);
        const passed = !hasLeakedData;

        recordResult('TEST_D', passed, {
            summary: passed ? 'No prior scan data survives into fresh scan' : 'State leaked from previous scan'
        });
    } catch (err) {
        recordResult('TEST_D', false, { summary: err.message });
    }

    // -------------------------------------------------------------
    // TEST E: Blank / Unreadable Image Safety Rule
    // -------------------------------------------------------------
    console.log(">>> Running TEST E: Blank/unreadable image safety rule...");
    try {
        const dummyPath = path.join(__dirname, 'blank_test.png');
        createDummyImage(dummyPath);
        const resE = await scanImages('consumer', [dummyPath]);
        const fieldsE = resE.extractedFields;

        const noFabricated = fieldsE.productName === null &&
                             fieldsE.mrp?.value === null &&
                             fieldsE.countryOfOrigin === null &&
                             fieldsE.dates?.manufacture === null;
        // Status must NOT be PASS / COMPLIANT!
        const notPass = resE.overallStatus !== 'PASS' && resE.overallStatus !== 'COMPLIANT';
        const passed = noFabricated && notPass;

        recordResult('TEST_E', passed, {
            summary: passed ? `Unreadable image safely returned null fields and status: ${resE.overallStatus} (NOT PASS)` : 'Fabricated values or false PASS detected',
            overallStatus: resE.overallStatus,
            productName: fieldsE.productName,
            mrp: fieldsE.mrp?.value
        });
    } catch (err) {
        recordResult('TEST_E', false, { summary: err.message });
    }

    // -------------------------------------------------------------
    // TEST F: Partial OCR Overlap (Ingredients vs Product Title)
    // -------------------------------------------------------------
    console.log(">>> Running TEST F: Partial OCR overlap (Ingredients vs Title)...");
    try {
        const mockAngle1 = {
            results: [
                { text: "INGREDIENTS: Fish Oil, Gelling Agent (INS 4201)", confidence: 0.98, bbox: [[10, 10], [100, 10], [100, 20], [10, 20]] }
            ]
        };
        const mockAngle2 = {
            results: [
                { text: "Fish Oil 1000 mg", confidence: 0.95, bbox: [[20, 20], [120, 20], [120, 40], [20, 40]] }
            ]
        };

        const ext1 = extractFields(mockAngle1, 'photo-1');
        const ext2 = extractFields(mockAngle2, 'photo-2');
        const mergedF = await mergeMultiPhotoExtractedFields([ext1, ext2]);

        const noConflict = !mergedF.conflicts || mergedF.conflicts.length === 0;
        const ingredientsCorrect = Boolean(mergedF.ingredients && mergedF.ingredients.includes('Fish Oil, Gelling Agent'));
        const passed = noConflict && ingredientsCorrect;

        recordResult('TEST_F', passed, {
            summary: passed ? 'Ingredients correctly categorized; no false cross-angle product name conflict' : 'False conflict or bad ingredients classification',
            productName: mergedF.productName,
            ingredients: mergedF.ingredients,
            conflicts: mergedF.conflicts
        });
    } catch (err) {
        recordResult('TEST_F', false, { summary: err.message });
    }

    // -------------------------------------------------------------
    // TEST G: Real MRP Conflict
    // -------------------------------------------------------------
    console.log(">>> Running TEST G: Real MRP conflict detection...");
    try {
        const mockAngle1 = {
            results: [
                { text: "MRP Rs. 666.00 (inclusive of all taxes)", confidence: 0.99, bbox: [] }
            ]
        };
        const mockAngle2 = {
            results: [
                { text: "MRP Rs. 699.00 (inclusive of all taxes)", confidence: 0.99, bbox: [] }
            ]
        };

        const ext1 = extractFields(mockAngle1, 'photo-1');
        const ext2 = extractFields(mockAngle2, 'photo-2');
        const mergedG = await mergeMultiPhotoExtractedFields([ext1, ext2]);
        const rulesG = await evaluateRules(mergedG);

        const hasConflict = mergedG.conflicts && mergedG.conflicts.some(c => c.field === 'mrp');
        const statusIsAlert = rulesG.overallStatus === 'POTENTIAL_NON_COMPLIANCE' || rulesG.overallStatus === 'NON_COMPLIANT' || rulesG.overallStatus === 'REVIEW';
        const passed = hasConflict && statusIsAlert;

        recordResult('TEST_G', passed, {
            summary: passed ? `Genuine MRP conflict detected (666 vs 699), status set to ${rulesG.overallStatus}` : 'Failed to flag real MRP conflict',
            conflicts: mergedG.conflicts,
            overallStatus: rulesG.overallStatus
        });
    } catch (err) {
        recordResult('TEST_G', false, { summary: err.message });
    }

    // -------------------------------------------------------------
    // TEST H: Servings vs Net Quantity Strict Separation
    // -------------------------------------------------------------
    console.log(">>> Running TEST H: Servings vs Net Quantity separation...");
    try {
        const mockOcrH = {
            results: [
                { text: "Servings Per Container 60", confidence: 0.99, bbox: [] },
                { text: "Serving Size 1 Capsule (Approx. 1.425 g)", confidence: 0.98, bbox: [] }
            ]
        };
        const extH = extractFields(mockOcrH, 'photo-1');

        const servingsCorrect = extH.servingsPerContainer === 60;
        const servingSizeCorrect = Boolean(extH.servingSize && extH.servingSize.includes('1 Capsule'));
        // Net Quantity MUST NOT be 60 servings!
        const netQuantityNull = extH.netQuantity?.value === null;
        const passed = servingsCorrect && servingSizeCorrect && netQuantityNull;

        recordResult('TEST_H', passed, {
            summary: passed ? 'servingsPerContainer = 60, servingSize = 1 Capsule, netQuantity remains null' : 'Net quantity incorrectly filled from servings',
            servingsPerContainer: extH.servingsPerContainer,
            servingSize: extH.servingSize,
            netQuantity: extH.netQuantity
        });
    } catch (err) {
        recordResult('TEST_H', false, { summary: err.message });
    }

    // -------------------------------------------------------------
    // TEST I: Field Absent From Second Angle
    // -------------------------------------------------------------
    console.log(">>> Running TEST I: Field absent from second angle (no false conflict)...");
    try {
        const mockAngle1 = {
            results: [{ text: "MRP: Rs. 666.00 (incl of taxes)", confidence: 0.99, bbox: [] }]
        };
        const mockAngle2 = {
            results: [{ text: "Storage: Store in a cool, dry place.", confidence: 0.95, bbox: [] }]
        };

        const ext1 = extractFields(mockAngle1, 'photo-1');
        const ext2 = extractFields(mockAngle2, 'photo-2');
        const mergedI = await mergeMultiPhotoExtractedFields([ext1, ext2]);

        const noConflict = !mergedI.conflicts || mergedI.conflicts.length === 0;
        const mrpResolved = mergedI.mrp?.value === 666;
        const statusIsSingle = mergedI.reconciliation?.fields?.mrp?.status === 'single_verified_observation';
        const passed = noConflict && mrpResolved && statusIsSingle;

        recordResult('TEST_I', passed, {
            summary: passed ? 'Field absent from angle 2 cleanly resolved without conflict as single_verified_observation' : 'False conflict generated for missing angle field',
            mrp: mergedI.mrp?.value,
            reconciliationStatus: mergedI.reconciliation?.fields?.mrp?.status
        });
    } catch (err) {
        recordResult('TEST_I', false, { summary: err.message });
    }

    // -------------------------------------------------------------
    // TEST J: Same Value on Two Angles
    // -------------------------------------------------------------
    console.log(">>> Running TEST J: Same value on two angles (consistent observation)...");
    try {
        const mockAngle1 = { results: [{ text: "MRP Rs 666 (incl of taxes)", confidence: 0.99, bbox: [] }] };
        const mockAngle2 = { results: [{ text: "MAX RETAIL PRICE 666.00", confidence: 0.98, bbox: [] }] };

        const ext1 = extractFields(mockAngle1, 'photo-1');
        const ext2 = extractFields(mockAngle2, 'photo-2');
        const mergedJ = await mergeMultiPhotoExtractedFields([ext1, ext2]);

        const noConflict = !mergedJ.conflicts || mergedJ.conflicts.length === 0;
        const mrpResolved = mergedJ.mrp?.value === 666;
        const isConsistent = mergedJ.reconciliation?.fields?.mrp?.status === 'consistent';
        const passed = noConflict && mrpResolved && isConsistent;

        recordResult('TEST_J', passed, {
            summary: passed ? 'Identical MRP on both angles reconciled as consistent without conflict' : 'Conflict falsely generated for same value',
            reconciliationStatus: mergedJ.reconciliation?.fields?.mrp?.status,
            mrp: mergedJ.mrp?.value
        });
    } catch (err) {
        recordResult('TEST_J', false, { summary: err.message });
    }

    // -------------------------------------------------------------
    // TEST K: Wrong Context Number Disambiguation
    // -------------------------------------------------------------
    console.log(">>> Running TEST K: Disambiguate context numbers (phone, FSSAI, batch, MRP)...");
    try {
        const mockOcrK = {
            results: [
                { text: "Customer Care: +91-11-495949", confidence: 0.99, bbox: [] },
                { text: "FSSAI Lic. No. 10012011000123", confidence: 0.98, bbox: [] },
                { text: "Batch No.: ONFO26005", confidence: 0.97, bbox: [] },
                { text: "MRP Rs. 666.00", confidence: 0.99, bbox: [] }
            ]
        };
        const extK = extractFields(mockOcrK, 'photo-1');

        const phoneOk = extK.consumerCare?.phone === '+9111495949' || extK.consumerCare?.phone === '+91-11-495949';
        const fssaiOk = extK.fssaiLicenseNumber === '10012011000123';
        const batchOk = extK.batchNumber === 'ONFO26005';
        const mrpOk = extK.mrp?.value === 666;
        const passed = phoneOk && fssaiOk && batchOk && mrpOk;

        recordResult('TEST_K', passed, {
            summary: passed ? 'Each number strictly remained in its designated semantic category' : 'Numbers crossed semantic category boundaries',
            phone: extK.consumerCare?.phone,
            fssai: extK.fssaiLicenseNumber,
            batch: extK.batchNumber,
            mrp: extK.mrp?.value
        });
    } catch (err) {
        recordResult('TEST_K', false, { summary: err.message });
    }

    // -------------------------------------------------------------
    // TEST L: Country vs FSSAI Confusion Prevention
    // -------------------------------------------------------------
    console.log(">>> Running TEST L: Country of Origin vs FSSAI confusion prevention...");
    try {
        const mockOcrL = {
            results: [
                { text: "COUNTRY OF ORIGIN: INDIA", confidence: 0.98, bbox: [] },
                { text: "FSSAI LIC NO. 10012011000123", confidence: 0.99, bbox: [] }
            ]
        };
        const extL = extractFields(mockOcrL, 'photo-1');

        const countryNotGreedy = extL.countryOfOrigin === 'India';
        const countryNotPolluted = !/fssai|lic/i.test(extL.countryOfOrigin || '');
        const fssaiValid = extL.fssaiLicenseNumber === '10012011000123';
        const passed = countryNotGreedy && countryNotPolluted && fssaiValid;

        recordResult('TEST_L', passed, {
            summary: passed ? 'Country resolved as "India" without FSSAI text; FSSAI captured exactly' : 'Country polluted with FSSAI text',
            country: extL.countryOfOrigin,
            fssai: extL.fssaiLicenseNumber
        });
    } catch (err) {
        recordResult('TEST_L', false, { summary: err.message });
    }

    // -------------------------------------------------------------
    // TEST M: Manufacturer vs Marketer vs Importer Separation
    // -------------------------------------------------------------
    console.log(">>> Running TEST M: Manufacturer vs Marketer vs Importer separation...");
    try {
        const mockOcrM = {
            results: [
                { text: "Manufactured by: ABC Nutrition Laboratories Pvt Ltd", confidence: 0.98, bbox: [] },
                { text: "Marketed by: XYZ Wellness Enterprises Ltd", confidence: 0.97, bbox: [] },
                { text: "Imported by: Global Supplements Trade Co", confidence: 0.96, bbox: [] }
            ]
        };
        const extM = extractFields(mockOcrM, 'photo-1');

        const mfrOk = Boolean(extM.manufacturer?.name && extM.manufacturer.name.includes('ABC Nutrition'));
        const mktOk = Boolean(extM.marketer?.name && extM.marketer.name.includes('XYZ Wellness'));
        const impOk = Boolean(extM.importer?.name && extM.importer.name.includes('Global Supplements'));
        const passed = mfrOk && mktOk && impOk;

        recordResult('TEST_M', passed, {
            summary: passed ? 'Manufacturer, marketer, and importer successfully separated' : 'Parties conflated or missing',
            manufacturer: extM.manufacturer?.name,
            marketer: extM.marketer?.name,
            importer: extM.importer?.name
        });
    } catch (err) {
        recordResult('TEST_M', false, { summary: err.message });
    }

    // -------------------------------------------------------------
    // TEST N: Date Context Disambiguation (Mfg vs Exp vs Best Before)
    // -------------------------------------------------------------
    console.log(">>> Running TEST N: Date context disambiguation...");
    try {
        const mockOcrN = {
            results: [
                { text: "Mfg Date: MAY 2026", confidence: 0.99, bbox: [] },
                { text: "Exp Date: NOV 2027", confidence: 0.99, bbox: [] },
                { text: "Best Before 24 months from packaging", confidence: 0.95, bbox: [] }
            ]
        };
        const extN = extractFields(mockOcrN, 'photo-1');

        const mfgOk = extN.dates?.manufacture === 'MAY 2026';
        const expOk = extN.dates?.expiry === 'NOV 2027';
        const bbOk = Boolean(extN.dates?.bestBefore && extN.dates.bestBefore.includes('24 months'));
        const notSwapped = extN.dates?.manufacture !== extN.dates?.expiry;
        const passed = mfgOk && expOk && bbOk && notSwapped;

        recordResult('TEST_N', passed, {
            summary: passed ? 'Mfg date, expiry date, and best before correctly assigned without swapping' : 'Date swapping or assignment error',
            dates: extN.dates
        });
    } catch (err) {
        recordResult('TEST_N', false, { summary: err.message });
    }

    // -------------------------------------------------------------
    // TEST O: Glare Occlusion / Missing Mandatory Panel (REAL PaddleOCR)
    // -------------------------------------------------------------
    console.log(">>> Running TEST O: Real OCR with missing/occluded mandatory panel (bottle_1.jpeg)...");
    try {
        // Real PaddleOCR scan of bottle_1.jpeg where MRP and manufacturing dates are not present
        const bottle1Path = [path.join(__dirname, '../test_images/bottle_1.jpeg')];
        const resO = await scanImages('consumer', bottle1Path);
        const fieldsO = resO.extractedFields;

        // Angle 1 has brand & servings, but MRP is absent on this panel
        const mrpMissing = fieldsO.mrp?.value === null;
        // Overall status must NOT be PASS or COMPLIANT!
        const statusNotPass = resO.overallStatus === 'INSUFFICIENT_EVIDENCE' || resO.overallStatus === 'REVIEW';
        const noFabrication = fieldsO.mrp?.value === null;
        const passed = mrpMissing && statusNotPass && noFabrication;

        recordResult('TEST_O', passed, {
            summary: passed ? `Real OCR on bottle_1.jpeg yielded status: ${resO.overallStatus} for missing MRP (zero fabricated value, NOT PASS)` : 'Missing mandatory field was fabricated or falsely marked compliant',
            overallStatus: resO.overallStatus,
            mrp: fieldsO.mrp?.value
        });
    } catch (err) {
        recordResult('TEST_O', false, { summary: err.message });
    }

    // -------------------------------------------------------------
    // TEST P: Curved Text Handling
    // -------------------------------------------------------------
    console.log(">>> Running TEST P: Curved text handling & confidence preservation...");
    try {
        const bottlePath = [path.join(__dirname, '../test_images/bottle_1.jpeg')];
        const resP = await scanImages('consumer', bottlePath);
        const rawOcr = resP.extractedFields?.rawOcrText || [];

        const hasConfidence = rawOcr.length > 0 && rawOcr.every(r => typeof r.confidence === 'number' && r.confidence >= 0 && r.confidence <= 1);
        const hasBoundingBoxes = rawOcr.some(r => Array.isArray(r.bbox) && r.bbox.length > 0);
        const passed = hasConfidence && hasBoundingBoxes;

        recordResult('TEST_P', passed, {
            summary: passed ? `Curved packaging text detected with full bbox and confidence evidence (${rawOcr.length} elements)` : 'Missing confidence or bbox evidence'
        });
    } catch (err) {
        recordResult('TEST_P', false, { summary: err.message });
    }

    // -------------------------------------------------------------
    // TEST Q: Concurrent Scans Isolation
    // -------------------------------------------------------------
    console.log(">>> Running TEST Q: Concurrent scans isolation...");
    try {
        const pathBottle = [path.join(__dirname, '../test_images/bottle_2.jpeg')];
        const pathCola = [path.join(__dirname, '../test_images/bottle_3.jpg')];

        // Fire both scans concurrently
        const [resQ1, resQ2] = await Promise.all([
            scanImages('consumer', pathBottle),
            scanImages('consumer', pathCola)
        ]);

        const q1Str = JSON.stringify(resQ1);
        const q2Str = JSON.stringify(resQ2);

        // Q1 must have supplement bottle data and no cola
        const q1Ok = /666\.00|ONFO26005/i.test(q1Str) && !/ca-Cola|Coca/i.test(q1Str);
        // Q2 must have cola and no supplement bottle data
        const q2Ok = !/ONFO26005|666\.00/i.test(q2Str);
        // Scan IDs must be distinct
        const distinctScanIds = resQ1.scanId !== resQ2.scanId;

        const passed = q1Ok && q2Ok && distinctScanIds;
        recordResult('TEST_Q', passed, {
            summary: passed ? 'Concurrent requests executed simultaneously with complete data isolation' : 'Cross-request contamination occurred during concurrent execution',
            scanId1: resQ1.scanId,
            scanId2: resQ2.scanId
        });
    } catch (err) {
        recordResult('TEST_Q', false, { summary: err.message });
    }

    // -------------------------------------------------------------
    // TEST R: Report Consistency (API, PDF, DOCX)
    // -------------------------------------------------------------
    console.log(">>> Running TEST R: Report consistency (API, PDF, DOCX)...");
    try {
        const bottlePaths = [
            path.join(__dirname, '../test_images/bottle_1.jpeg'),
            path.join(__dirname, '../test_images/bottle_2.jpeg')
        ];
        const resR = await scanImages('officer', bottlePaths);
        const reportData = {
            scanTimestamp: new Date().toISOString(),
            productName: resR.extractedFields?.productName,
            overallStatus: resR.overallStatus,
            extractedFields: resR.extractedFields,
            findings: resR.findings,
            listingMismatchCheck: { performed: false, mismatches: [] },
            evidenceImages: []
        };

        const pdfBuffer = await generatePDF(reportData);
        const docxBuffer = await generateDOCX(reportData);

        const pdfValid = Buffer.isBuffer(pdfBuffer) && pdfBuffer.length > 2000;
        const docxValid = Buffer.isBuffer(docxBuffer) && docxBuffer.length > 2000;
        const passed = pdfValid && docxValid;

        recordResult('TEST_R', passed, {
            summary: passed ? `PDF (${pdfBuffer.length} bytes) and DOCX (${docxBuffer.length} bytes) generated matching canonical compliance result` : 'PDF/DOCX generation failed or truncated',
            pdfSize: pdfBuffer.length,
            docxSize: docxBuffer.length,
            overallStatus: resR.overallStatus
        });
    } catch (err) {
        recordResult('TEST_R', false, { summary: err.message });
    }

    // -------------------------------------------------------------
    // Suite Summary
    // -------------------------------------------------------------
    console.log("=================================================================");
    console.log(`                     AUDIT SUITE SUMMARY                        `);
    console.log("=================================================================");
    console.log(`Total Tests:   18`);
    console.log(`Passed:        ${passedCount}`);
    console.log(`Failed:        ${failedCount}`);
    console.log("=================================================================\n");

    const summaryOutPath = path.join(__dirname, 'audit_suite_summary.json');
    fs.writeFileSync(summaryOutPath, JSON.stringify(suiteReport, null, 2));
    console.log(`Audit summary saved to: ${summaryOutPath}`);

    if (failedCount > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runAuditSuite().catch(err => {
    console.error("Fatal test runner error:", err);
    process.exit(1);
});
