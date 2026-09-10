const fs = require('fs');
const path = require('path');
const { runOCR } = require('./src/services/ocrClient');

async function inspectImages() {
    const imgDir = path.join(__dirname, '..', 'test_images');
    for (const f of ['bottle_1.jpeg', 'bottle_2.jpeg', 'bottle_3.jpg']) {
        const p = path.join(imgDir, f);
        if (!fs.existsSync(p)) continue;
        const buf = fs.readFileSync(p);
        console.log(`\n================== ${f} (${buf.length} bytes) ==================`);
        try {
            const res = await runOCR(buf, f, 'image/jpeg');
            console.log(`Detected ${res.results.length} elements:`);
            res.results.forEach((r, idx) => {
                console.log(`[${idx}] "${r.text}" (conf: ${r.confidence.toFixed(2)})`);
            });
        } catch (e) {
            console.error(`Error for ${f}:`, e.message);
        }
    }
    process.exit(0);
}

inspectImages();
