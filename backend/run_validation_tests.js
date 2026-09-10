const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

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

function createBlankImage(filePath) {
    // Generate a solid gray 200x200 unreadable dummy image
    // Minimal valid BMP/JPEG
    // Or we can use sharp / jimp if available, or write a raw minimal PNG buffer
    // 1x1 gray PNG buffer
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

async function runAllTests() {
    console.log("=================================================================");
    console.log("          DRISHTISCAN PIPELINE VERIFICATION SUITE                 ");
    console.log("=================================================================\n");

    const testResults = {
        testA: { passed: false, details: null },
        testB: { passed: false, details: null },
        testC: { passed: false, details: null },
        testD: { passed: false, details: null },
        testE: { passed: false, details: null }
    };

    // -------------------------------------------------------------
    // TEST A: Scan supplement bottle images (bottle_1.jpeg & bottle_2.jpeg)
    // Expected: NO Haldiram data. Actual bottle data present (666.00, ONFO26005, MAY 2026, NOV 2027).
    // -------------------------------------------------------------
    console.log(">>> [TEST A] Scanning supplement bottle images...");
    try {
        const bottlePaths = [
            path.join(__dirname, '../test_images/bottle_1.jpeg'),
            path.join(__dirname, '../test_images/bottle_2.jpeg')
        ];
        const resA = await scanImages('consumer', bottlePaths, '?debug=true');

        const fieldsA = resA.extractedFields;
        const resAString = JSON.stringify(resA);

        const hasHaldiram = /haldiram|bhujia|sev|400\s*g|₹120|customercare@haldirams/i.test(resAString);
        const hasBottleData = (fieldsA.mrp?.value === 666) &&
                              (fieldsA.batchNumber === 'ONFO26005') &&
                              (fieldsA.dates?.manufacture === 'MAY 2026') &&
                              (fieldsA.dates?.expiry === 'NOV 2027');

        console.log("  Scan ID:", resA.scanId);
        console.log("  Product Name:", fieldsA.productName);
        console.log("  Batch No:", fieldsA.batchNumber);
        console.log("  MRP:", fieldsA.mrp);
        console.log("  USP:", fieldsA.unitSalePrice);
        console.log("  Dates:", fieldsA.dates);
        console.log("  Haldiram Data Detected?", hasHaldiram ? "YES (FAILED)" : "NO (PASSED)");
        console.log("  Actual Bottle Data Extracted?", hasBottleData ? "YES (PASSED)" : "NO (FAILED)");

        if (!hasHaldiram && hasBottleData) {
            testResults.testA = { passed: true, details: fieldsA, scanId: resA.scanId };
            console.log("✅ TEST A PASSED: Zero Haldiram data; supplement bottle fields accurately extracted!\n");
        } else {
            testResults.testA = { passed: false, details: { fieldsA, hasHaldiram, hasBottleData } };
            console.log("❌ TEST A FAILED.\n");
        }
    } catch (err) {
        console.error("❌ TEST A ERROR:", err.message);
        testResults.testA = { passed: false, error: err.message };
    }

    // -------------------------------------------------------------
    // TEST B: Scan a completely different product (bottle_3.jpg - Coca-Cola)
    // Expected: Results from TEST A (ONFO26005, 666, Fish Oil) must NOT appear!
    // -------------------------------------------------------------
    console.log(">>> [TEST B] Scanning completely different product (Coca-Cola)...");
    try {
        const cokePath = [path.join(__dirname, '../test_images/bottle_3.jpg')];
        const resB = await scanImages('consumer', cokePath, '?debug=true');
        const fieldsB = resB.extractedFields;
        const resBString = JSON.stringify(resB);

        const hasTestAData = /ONFO26005|Fish\s*O[il]|666/i.test(resBString);
        const hasHaldiramB = /haldiram|bhujia/i.test(resBString);

        console.log("  Scan ID:", resB.scanId);
        console.log("  Product Name:", fieldsB.productName);
        console.log("  Batch No:", fieldsB.batchNumber);
        console.log("  MRP:", fieldsB.mrp);
        console.log("  Contains TEST A Data (Fish Oil / ONFO26005 / 666)?", hasTestAData ? "YES (FAILED)" : "NO (PASSED)");
        console.log("  Contains Haldiram Data?", hasHaldiramB ? "YES (FAILED)" : "NO (PASSED)");

        if (!hasTestAData && !hasHaldiramB) {
            testResults.testB = { passed: true, details: fieldsB, scanId: resB.scanId };
            console.log("✅ TEST B PASSED: Clean scan of Coca-Cola, no residual data from TEST A or Haldiram!\n");
        } else {
            testResults.testB = { passed: false, details: { fieldsB, hasTestAData, hasHaldiramB } };
            console.log("❌ TEST B FAILED.\n");
        }
    } catch (err) {
        console.error("❌ TEST B ERROR:", err.message);
        testResults.testB = { passed: false, error: err.message };
    }

    // -------------------------------------------------------------
    // TEST C: Scan the same product with two angles (bottle_1 and bottle_2)
    // Expected: Results merged ONLY from those two images. Photo count is 2.
    // -------------------------------------------------------------
    console.log(">>> [TEST C] Multi-angle scan merging verification...");
    try {
        const twoAnglePaths = [
            path.join(__dirname, '../test_images/bottle_1.jpeg'),
            path.join(__dirname, '../test_images/bottle_2.jpeg')
        ];
        const resC = await scanImages('consumer', twoAnglePaths);
        const fieldsC = resC.extractedFields;

        const isMergedProperly = (resC.photoCount === 2) &&
                                 (fieldsC.photoCount === 2) &&
                                 (fieldsC.mrp?.value === 666) && // from photo 2
                                 (fieldsC.netQuantity?.value === 60) && // from photo 1
                                 (fieldsC.batchNumber === 'ONFO26005'); // from photo 2

        console.log("  Photo Count:", resC.photoCount);
        console.log("  Merged Net Qty (from Photo 1):", fieldsC.netQuantity);
        console.log("  Merged MRP (from Photo 2):", fieldsC.mrp);
        console.log("  Merged Batch (from Photo 2):", fieldsC.batchNumber);
        console.log("  Conflicts Detected:", fieldsC.conflicts);

        if (isMergedProperly) {
            testResults.testC = { passed: true, details: fieldsC, scanId: resC.scanId };
            console.log("✅ TEST C PASSED: Multi-angle photos merged seamlessly across faces without crosstalk!\n");
        } else {
            testResults.testC = { passed: false, details: { fieldsC, photoCount: resC.photoCount } };
            console.log("❌ TEST C FAILED.\n");
        }
    } catch (err) {
        console.error("❌ TEST C ERROR:", err.message);
        testResults.testC = { passed: false, error: err.message };
    }

    // -------------------------------------------------------------
    // TEST D: Clean state between independent scans (no residual session contamination)
    // Expected: Scan Coca-Cola immediately after Bottle scan. Zero state survives.
    // -------------------------------------------------------------
    console.log(">>> [TEST D] Session & State Isolation Verification...");
    try {
        // Run bottle scan first
        const bottlePaths = [path.join(__dirname, '../test_images/bottle_2.jpeg')];
        await scanImages('consumer', bottlePaths);

        // Run fresh Coke scan immediately
        const cokePath = [path.join(__dirname, '../test_images/bottle_3.jpg')];
        const resD = await scanImages('consumer', cokePath);
        const resDStr = JSON.stringify(resD);

        const hasLeakedBottleData = /ONFO26005|11\.10|glanbia/i.test(resDStr);

        console.log("  Scan ID D:", resD.scanId);
        console.log("  Leaked Previous Data?", hasLeakedBottleData ? "YES (FAILED)" : "NO (PASSED)");

        if (!hasLeakedBottleData) {
            testResults.testD = { passed: true, scanId: resD.scanId };
            console.log("✅ TEST D PASSED: Backend is fully stateless; no prior scan data leaks into next scan!\n");
        } else {
            testResults.testD = { passed: false, leaked: true };
            console.log("❌ TEST D FAILED.\n");
        }
    } catch (err) {
        console.error("❌ TEST D ERROR:", err.message);
        testResults.testD = { passed: false, error: err.message };
    }

    // -------------------------------------------------------------
    // TEST E: Upload an image with unreadable text / blank image
    // Expected: Fields become null / "Not detected", ZERO fabricated values!
    // -------------------------------------------------------------
    console.log(">>> [TEST E] Blank/Unreadable image safety rule verification...");
    try {
        const blankPath = path.join(__dirname, 'blank_test.png');
        createBlankImage(blankPath);

        const resE = await scanImages('consumer', [blankPath]);
        const fieldsE = resE.extractedFields;

        const hasFabricatedMRP = fieldsE.mrp?.value !== null;
        const hasFabricatedName = fieldsE.productName !== null;
        const hasFabricatedCountry = fieldsE.countryOfOrigin !== null;
        const hasFabricatedDates = fieldsE.dates?.manufacture !== null || fieldsE.dates?.expiry !== null;

        console.log("  Scan ID E:", resE.scanId);
        console.log("  Product Name:", fieldsE.productName);
        console.log("  MRP:", fieldsE.mrp);
        console.log("  Country of Origin:", fieldsE.countryOfOrigin);
        console.log("  Dates:", fieldsE.dates);
        console.log("  Overall Compliance Status:", resE.overallStatus);
        console.log("  Any Fabricated Values?", (hasFabricatedMRP || hasFabricatedName || hasFabricatedCountry || hasFabricatedDates) ? "YES (FAILED)" : "NO (PASSED)");

        if (!hasFabricatedMRP && !hasFabricatedName && !hasFabricatedCountry && !hasFabricatedDates) {
            testResults.testE = { passed: true, scanId: resE.scanId };
            console.log("✅ TEST E PASSED: Unreadable image safely returned null / unverified; ZERO fabricated values!\n");
        } else {
            testResults.testE = { passed: false, details: fieldsE };
            console.log("❌ TEST E FAILED: Safety rule violated (fabricated values generated).\n");
        }

        // Clean up temporary blank image
        try { fs.unlinkSync(blankPath); } catch (e) {}
    } catch (err) {
        console.error("❌ TEST E ERROR:", err.message);
        testResults.testE = { passed: false, error: err.message };
    }

    console.log("=================================================================");
    console.log("                     SUITE SUMMARY                                ");
    console.log("=================================================================");
    console.log("TEST A (Bottle Data Accurate, No Haldiram):", testResults.testA.passed ? "PASSED" : "FAILED");
    console.log("TEST B (Different Product Isolated):       ", testResults.testB.passed ? "PASSED" : "FAILED");
    console.log("TEST C (Multi-angle Scan Merged Cleanly):  ", testResults.testC.passed ? "PASSED" : "FAILED");
    console.log("TEST D (No State Contamination on Fresh):  ", testResults.testD.passed ? "PASSED" : "FAILED");
    console.log("TEST E (Unreadable Image: Zero Fabrication):", testResults.testE.passed ? "PASSED" : "FAILED");
    console.log("=================================================================");

    fs.writeFileSync(path.join(__dirname, 'validation_summary.json'), JSON.stringify(testResults, null, 2), 'utf8');
}

runAllTests().catch(console.error);
