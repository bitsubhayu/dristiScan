const fs = require('fs');
const path = require('path');
const { runOCR } = require('./src/services/ocrClient');
const { extractFields } = require('./src/services/extraction');

async function testSingle() {
    console.log('Testing single image OCR with DrishtiScan backend...');
    const imgPath = path.join(__dirname, '../test_images/bottle_1.jpeg');
    const buf = fs.readFileSync(imgPath);
    console.log(`Image bottle_1.jpeg read (${buf.length} bytes). Sending to OCR service...`);
    
    const t0 = Date.now();
    const ocrRes = await runOCR(buf, 'bottle_1.jpeg');
    const elapsed = Date.now() - t0;
    
    console.log(`\n=== OCR Response in ${elapsed}ms ===`);
    console.log('Success:', ocrRes.success);
    console.log('Model:', ocrRes.model);
    console.log('Processing Time (server):', ocrRes.processingTimeMs, 'ms');
    console.log('Total Detected Lines:', ocrRes.results ? ocrRes.results.length : 0);
    
    if (ocrRes.results && ocrRes.results.length > 0) {
        console.log('\nTop 15 Detected Lines:');
        ocrRes.results.slice(0, 15).forEach((r, i) => {
            console.log(`  ${i + 1}. "${r.text}" (conf: ${(r.confidence * 100).toFixed(1)}%)`);
        });
    }

    console.log('\nRunning semantic extraction...');
    const fields = extractFields(ocrRes, 'bottle_1.jpeg');
    console.log('Extracted Product Name:', fields.productName);
    console.log('Extracted Brand Name:', fields.brandName);
    console.log('Extracted MRP:', fields.mrp);
    console.log('Extracted Unit Sale Price:', fields.unitSalePrice);
    console.log('Extracted Net Qty:', fields.netQuantity);
    console.log('Extracted Dates:', fields.dates);
    console.log('Extracted Batch:', fields.batchNumber);
    console.log('Extracted FSSAI:', fields.fssaiLicenseNumber);
    console.log('Extracted Manufacturer:', fields.manufacturer);
    console.log('Extracted Low-Confidence Fields:', fields.lowConfidenceFields);
    process.exit(0);
}

testSingle().catch(err => {
    console.error(err);
    process.exit(1);
});
