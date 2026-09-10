const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { extractFields, mergeMultiPhotoExtractedFields } = require('./src/services/extraction');

async function run() {
    console.log("Testing Extraction on Bottle Images...");
    const extractions = [];

    for (const file of ['bottle_1.jpeg', 'bottle_2.jpeg', 'bottle_3.jpg']) {
        const imagePath = path.join(__dirname, '../test_images', file);
        if (!fs.existsSync(imagePath)) {
            console.warn(`File not found: ${imagePath}`);
            continue;
        }
        const form = new FormData();
        form.append('image', fs.createReadStream(imagePath));
        const res = await axios.post('http://127.0.0.1:8000/ocr', form, { headers: form.getHeaders(), timeout: 90000 });
        const fields = extractFields(res.data, file);
        console.log(`\n=== Extraction for ${file} ===`);
        console.log("Product Name:", fields.productName);
        console.log("Brand Name:", fields.brandName);
        console.log("Generic Commodity Name:", fields.genericCommodityName);
        console.log("Batch No:", fields.batchNumber);
        console.log("Net Qty:", fields.netQuantity);
        console.log("MRP:", fields.mrp);
        console.log("USP:", fields.unitSalePrice);
        console.log("Dates:", fields.dates);
        console.log("Manufacturer:", fields.manufacturer);
        console.log("Consumer Care:", fields.consumerCare);
        console.log("Country of Origin:", fields.countryOfOrigin);
        console.log("FSSAI Lic:", fields.fssaiLicenseNumber);
        extractions.push(fields);
    }

    const merged = await mergeMultiPhotoExtractedFields(extractions);
    console.log("\n================ MERGED SCAN (2 ANGLES) ================");
    console.log("Product Name:", merged.productName);
    console.log("Batch No:", merged.batchNumber);
    console.log("Net Qty:", merged.netQuantity);
    console.log("MRP:", merged.mrp);
    console.log("USP:", merged.unitSalePrice);
    console.log("Dates:", merged.dates);
    console.log("Consumer Care:", merged.consumerCare);
    console.log("Country of Origin:", merged.countryOfOrigin);
    console.log("Conflicts:", merged.conflicts);
}

run().catch(console.error);
