/**
 * Generic Synthetic Test Suite for Spatial Reconstruction & Identity Structuring
 * 
 * Verifies all 20 required categories using strictly generic synthetic fixtures.
 * Zero real product names or real photo values are used.
 */

const assert = require('assert');
const {
    groupIntoRows,
    generateCandidateTitles,
    extractFields,
    mergeMultiPhotoExtractedFields
} = require('./src/services/extraction');
const ruleEngine = require('./src/services/ruleEngine');

console.log('=============================================================');
console.log('  DRISHTISCAN SPATIAL RECONSTRUCTION & STRUCTURING SUITE    ');
console.log('=============================================================\n');

let passedTests = 0;
let totalTests = 0;

const runTest = async (name, fn) => {
    totalTests++;
    process.stdout.write(`  [${totalTests.toString().padStart(2, '0')}/20] Testing: ${name} ... `);
    try {
        await fn();
        console.log('✅ PASSED');
        passedTests++;
    } catch (err) {
        console.log(`❌ FAILED: ${err.message}`);
        console.error(err);
    }
};

(async () => {
    // 1. Confidence-scrambled OCR elements -> output must be spatially ordered
    await runTest('confidence-scrambled OCR elements -> output spatially ordered', () => {
        const scrambled = [
            { text: 'Row 3 Left', confidence: 0.99, bbox: [[20, 200], [100, 200], [100, 220], [20, 220]] },
            { text: 'Row 1 Left', confidence: 0.60, bbox: [[20, 50], [100, 50], [100, 70], [20, 70]] },
            { text: 'Row 2 Left', confidence: 0.95, bbox: [[20, 120], [100, 120], [100, 140], [20, 140]] },
            { text: 'Row 1 Right', confidence: 0.70, bbox: [[150, 50], [230, 50], [230, 70], [150, 70]] },
            { text: 'Row 2 Right', confidence: 0.40, bbox: [[150, 120], [230, 120], [230, 140], [150, 140]] }
        ];

        const grouped = groupIntoRows(scrambled);
        assert.strictEqual(grouped.rows.length, 3, 'Expected exactly 3 rows');
        assert.strictEqual(grouped.rows[0].text, 'Row 1 Left Row 1 Right');
        assert.strictEqual(grouped.rows[1].text, 'Row 2 Left Row 2 Right');
        assert.strictEqual(grouped.rows[2].text, 'Row 3 Left');
        assert.strictEqual(grouped.orderedElements[0].text, 'Row 1 Left');
        assert.strictEqual(grouped.orderedElements[1].text, 'Row 1 Right');
        assert.strictEqual(grouped.orderedElements[2].text, 'Row 2 Left');
        assert.strictEqual(grouped.orderedElements[3].text, 'Row 2 Right');
        assert.strictEqual(grouped.orderedElements[4].text, 'Row 3 Left');
    });

    // 2. Fragmented words belonging to one row
    await runTest('fragmented words belonging to one row', () => {
        const fragments = [
            { text: 'FLOUR', confidence: 0.90, bbox: [[220, 100], [300, 100], [300, 125], [220, 125]] },
            { text: 'ORGANIC', confidence: 0.85, bbox: [[20, 100], [110, 100], [110, 125], [20, 125]] },
            { text: 'WHEAT', confidence: 0.88, bbox: [[120, 100], [210, 100], [210, 125], [120, 125]] }
        ];

        const grouped = groupIntoRows(fragments);
        assert.strictEqual(grouped.rows.length, 1);
        assert.strictEqual(grouped.rows[0].text, 'ORGANIC WHEAT FLOUR');
        assert.strictEqual(grouped.orderedElements.map(e => e.text).join(' '), 'ORGANIC WHEAT FLOUR');
    });

    // 3. Multi-line product identity
    await runTest('multi-line product identity', () => {
        const elements = [
            { text: 'ZENITH FOODS', confidence: 0.95, bbox: [[50, 20], [400, 20], [400, 65], [50, 65]] },
            { text: 'ORGANIC ROLLED', confidence: 0.92, bbox: [[100, 80], [380, 80], [380, 115], [100, 115]] },
            { text: 'OATS POWDER', confidence: 0.91, bbox: [[100, 125], [360, 125], [360, 160], [100, 160]] },
            { text: 'Net Quantity: 500 g', confidence: 0.90, bbox: [[100, 300], [300, 300], [300, 320], [100, 320]] }
        ];

        const extracted = extractFields({ results: elements, imageWidth: 500, imageHeight: 800 });
        assert.strictEqual(extracted.productName, 'ORGANIC ROLLED OATS POWDER');
        assert.strictEqual(extracted.brandName, 'ZENITH FOODS');
    });

    // 4. Different font sizes in same visual row
    await runTest('different font sizes in same visual row', () => {
        // Large price "450" (height 40px, Y: 100..140) next to small "MRP Rs." (height 16px, Y: 112..128)
        const elements = [
            { text: '450', confidence: 0.96, bbox: [[120, 100], [180, 100], [180, 140], [120, 140]] },
            { text: 'MRP Rs.', confidence: 0.88, bbox: [[30, 112], [110, 112], [110, 128], [30, 128]] }
        ];

        const grouped = groupIntoRows(elements);
        assert.strictEqual(grouped.rows.length, 1);
        assert.strictEqual(grouped.rows[0].text, 'MRP Rs. 450');
    });

    // 5. Nearby unrelated text is not merged into row or identity
    await runTest('nearby unrelated text is not merged into product identity', () => {
        const elements = [
            { text: 'PEANUT BUTTER', confidence: 0.95, bbox: [[50, 80], [250, 80], [250, 110], [50, 110]] },
            { text: 'Allergen Warning: Contains Nuts', confidence: 0.85, bbox: [[50, 130], [350, 130], [350, 145], [50, 145]] }
        ];

        const structured = groupIntoRows(elements);
        assert.strictEqual(structured.rows.length, 2, 'Must remain separate rows');
        const candidates = generateCandidateTitles(structured, structured.orderedElements);
        const multiLineCandidates = candidates.filter(c => c.isMultiLine);
        assert.strictEqual(multiLineCandidates.length, 0, 'Must NOT create multi-line candidate merging allergen warning');
    });

    // 6. Two-column layout preservation
    await runTest('two-column layout preservation', () => {
        const elements = [
            // Left Column: Net Qty: 500 g at Y: 200..220, X: 40..160
            { text: 'Net Qty: 500 g', confidence: 0.92, bbox: [[40, 200], [160, 200], [160, 220], [40, 220]] },
            // Right Column: MRP Rs. 299 at Y: 202..222, X: 400..520
            { text: 'MRP Rs. 299', confidence: 0.94, bbox: [[400, 202], [520, 202], [520, 222], [400, 222]] }
        ];

        const grouped = groupIntoRows(elements);
        assert.strictEqual(grouped.rows.length, 1);
        assert.strictEqual(grouped.rows[0].columns.length, 2, 'Expected 2 distinct columns identified by horizontal gap');
        assert.strictEqual(grouped.rows[0].columns[0][0].text, 'Net Qty: 500 g');
        assert.strictEqual(grouped.rows[0].columns[1][0].text, 'MRP Rs. 299');
    });

    // 7. Dense declaration block
    await runTest('dense declaration block maintains row-by-row structure', () => {
        const elements = [
            { text: 'Batch No: SYN-902', confidence: 0.90, bbox: [[30, 200], [180, 200], [180, 218], [30, 218]] },
            { text: 'Mfg Date: 01/2025', confidence: 0.92, bbox: [[30, 225], [170, 225], [170, 243], [30, 243]] },
            { text: 'Exp Date: 01/2027', confidence: 0.91, bbox: [[30, 250], [170, 250], [170, 268], [30, 268]] },
            { text: 'FSSAI Lic: 10020030040050', confidence: 0.95, bbox: [[30, 275], [230, 275], [230, 293], [30, 293]] }
        ];

        const grouped = groupIntoRows(elements);
        assert.strictEqual(grouped.rows.length, 4, 'Expected exactly 4 distinct rows for dense statutory declarations');
        assert.strictEqual(grouped.rows[0].text, 'Batch No: SYN-902');
        assert.strictEqual(grouped.rows[1].text, 'Mfg Date: 01/2025');
        assert.strictEqual(grouped.rows[2].text, 'Exp Date: 01/2027');
        assert.strictEqual(grouped.rows[3].text, 'FSSAI Lic: 10020030040050');
    });

    // 8. Split quantity + unit
    await runTest('split quantity + unit in same row', () => {
        const elements = [
            { text: 'g', confidence: 0.88, bbox: [[180, 152], [195, 152], [195, 168], [180, 168]] },
            { text: 'Net Qty:', confidence: 0.90, bbox: [[40, 150], [120, 150], [120, 170], [40, 170]] },
            { text: '750', confidence: 0.95, bbox: [[130, 148], [175, 148], [175, 172], [130, 172]] }
        ];

        const extracted = extractFields({ results: elements, imageWidth: 400, imageHeight: 400 });
        assert.strictEqual(extracted.netQuantity.value, 750);
        assert.strictEqual(extracted.netQuantity.unit, 'g');
    });

    // 9. Split date fragments in same row
    await runTest('split date fragments in same row', () => {
        const elements = [
            { text: '2026', confidence: 0.91, bbox: [[160, 180], [210, 180], [210, 200], [160, 200]] },
            { text: 'EXP:', confidence: 0.89, bbox: [[40, 180], [80, 180], [80, 200], [40, 200]] },
            { text: '15/08/', confidence: 0.93, bbox: [[90, 180], [150, 180], [150, 200], [90, 200]] }
        ];

        const extracted = extractFields({ results: elements, imageWidth: 400, imageHeight: 400 });
        assert.strictEqual(extracted.dates.expiry, '15/08/2026');
    });

    // 10. Multiple dates (mfg and expiry) preserved separately
    await runTest('multiple dates preserved without cross-contamination', () => {
        const elements = [
            { text: 'MFG: 10/2024', confidence: 0.92, bbox: [[40, 100], [150, 100], [150, 120], [40, 120]] },
            { text: 'EXP: 10/2026', confidence: 0.94, bbox: [[40, 140], [150, 140], [150, 160], [40, 160]] }
        ];

        const extracted = extractFields({ results: elements, imageWidth: 400, imageHeight: 400 });
        assert.strictEqual(extracted.dates.manufacture, '10/2024');
        assert.strictEqual(extracted.dates.expiry, '10/2026');
    });

    // 11. Multiple numeric values (MRP, USP, Net Quantity)
    await runTest('multiple numeric values paired correctly', () => {
        const elements = [
            { text: 'MRP: Rs. 400', confidence: 0.95, bbox: [[40, 80], [160, 80], [160, 100], [40, 100]] },
            { text: 'USP: Rs. 0.80 / g', confidence: 0.92, bbox: [[40, 120], [180, 120], [180, 140], [40, 140]] },
            { text: 'Net Quantity: 500 g', confidence: 0.94, bbox: [[40, 160], [200, 160], [200, 180], [40, 180]] }
        ];

        const extracted = extractFields({ results: elements, imageWidth: 400, imageHeight: 400 });
        assert.strictEqual(extracted.mrp.value, 400);
        assert.strictEqual(extracted.unitSalePrice, 'Rs. 0.80 / g');
        assert.strictEqual(extracted.netQuantity.value, 500);
        assert.strictEqual(extracted.netQuantity.unit, 'g');
    });

    // 12. Address near product identity
    await runTest('address near product identity is not selected as identity', () => {
        const elements = [
            { text: 'ALMOND FLOUR', confidence: 0.95, bbox: [[40, 50], [220, 50], [220, 80], [40, 80]] },
            { text: 'Plot 25 Industrial Estate Pin 560048', confidence: 0.90, bbox: [[40, 100], [380, 100], [380, 120], [40, 120]] }
        ];

        const structured = groupIntoRows(elements);
        const candidates = generateCandidateTitles(structured, structured.orderedElements);
        const multiLineCandidates = candidates.filter(c => c.isMultiLine);
        assert.strictEqual(multiLineCandidates.length, 0, 'Address row must NOT be combined into multi-line identity candidate');
    });

    // 13. Nutrition near identity
    await runTest('nutrition near identity is rejected from identity candidates', () => {
        const elements = [
            { text: 'SOYA CHUNKS', confidence: 0.95, bbox: [[40, 50], [200, 50], [200, 80], [40, 80]] },
            { text: 'Protein 52g per 100g', confidence: 0.90, bbox: [[40, 95], [260, 95], [260, 120], [40, 120]] }
        ];

        const structured = groupIntoRows(elements);
        const candidates = generateCandidateTitles(structured, structured.orderedElements);
        const combined = candidates.find(c => c.text.includes('Protein 52g'));
        assert.strictEqual(combined, undefined, 'Nutrition row must never be combined into identity candidate');
    });

    // 14. Instruction text near identity
    await runTest('instruction text near identity is rejected', () => {
        const elements = [
            { text: 'Tear here along line to open', confidence: 0.92, bbox: [[40, 30], [280, 30], [280, 48], [40, 48]] },
            { text: 'OAT BRAN', confidence: 0.96, bbox: [[40, 70], [180, 70], [180, 100], [40, 100]] }
        ];

        const extracted = extractFields({ results: elements, imageWidth: 400, imageHeight: 400 });
        assert.strictEqual(extracted.productName, 'OAT BRAN');
        assert.notStrictEqual(extracted.productName, 'Tear here along line to open');
    });

    // 15. Multiple-photo identity consistency
    await runTest('multiple-photo identity consistency resolves cleanly', async () => {
        const photo1 = extractFields({
            results: [
                { text: 'AURORA FOODS', confidence: 0.95, bbox: [[40, 30], [250, 30], [250, 60], [40, 60]] },
                { text: 'CHIA SEEDS', confidence: 0.94, bbox: [[40, 80], [200, 80], [200, 110], [40, 110]] }
            ]
        }, 'photo-1');

        const photo2 = extractFields({
            results: [
                { text: 'AURORA FOODS', confidence: 0.96, bbox: [[50, 40], [260, 40], [260, 70], [50, 70]] },
                { text: 'CHIA SEEDS', confidence: 0.95, bbox: [[50, 90], [210, 90], [210, 120], [50, 120]] }
            ]
        }, 'photo-2');

        const merged = await mergeMultiPhotoExtractedFields([photo1, photo2]);
        assert.strictEqual(merged.brandName, 'AURORA FOODS');
        assert.strictEqual(merged.productName, 'CHIA SEEDS');
        assert.strictEqual(merged.reconciliation.conflicts.length, 0);
    });

    // 16. Unresolved identity collision
    await runTest('unresolved identity collision resets to not_detected when AI arbitration unavailable', async () => {
        // Photo with same text selected as both brand and product triggering internal disambiguation flag
        const photo = extractFields({
            results: [
                { text: 'GENERIC COLLISION BRAND', confidence: 0.95, bbox: [[40, 30], [300, 30], [300, 60], [40, 60]] },
                { text: 'GENERIC COLLISION PRODUCT', confidence: 0.90, bbox: [[40, 80], [320, 80], [320, 110], [40, 110]] }
            ]
        }, 'photo-1');

        // Force identityCollisionResolved = true to simulate unarbitrated collision
        photo.identityCollisionResolved = true;

        // Force both AI providers unavailable
        const originalGeminiKey = process.env.GEMINI_API_KEY;
        const originalGroqKey = process.env.GROQ_API_KEY;
        delete process.env.GEMINI_API_KEY;
        delete process.env.GROQ_API_KEY;

        try {
            const merged = await mergeMultiPhotoExtractedFields([photo]);
            assert.strictEqual(merged.productName, null, 'Unresolved collision must reset productName to null');
            assert.strictEqual(merged.brandName, null, 'Unresolved collision must reset brandName to null');
            assert.strictEqual(merged.declarations.productName.status, 'not_detected');
            assert.strictEqual(merged.declarations.brandName.status, 'not_detected');
        } finally {
            if (originalGeminiKey) process.env.GEMINI_API_KEY = originalGeminiKey;
            if (originalGroqKey) process.env.GROQ_API_KEY = originalGroqKey;
        }
    });

    // 17. Valid single candidate preserved normally
    await runTest('valid single candidate preserved normally without collision', async () => {
        const photo = extractFields({
            results: [
                { text: 'SOLAR ORGANICS', confidence: 0.95, bbox: [[40, 30], [280, 30], [280, 60], [40, 60]] },
                { text: 'SESAME OIL', confidence: 0.92, bbox: [[40, 80], [220, 80], [220, 110], [40, 110]] }
            ]
        }, 'photo-1');

        assert.strictEqual(photo.identityCollisionResolved, false);

        const originalGeminiKey = process.env.GEMINI_API_KEY;
        const originalGroqKey = process.env.GROQ_API_KEY;
        delete process.env.GEMINI_API_KEY;
        delete process.env.GROQ_API_KEY;

        try {
            const merged = await mergeMultiPhotoExtractedFields([photo]);
            assert.strictEqual(merged.brandName, 'SOLAR ORGANICS');
            assert.strictEqual(merged.productName, 'SESAME OIL');
        } finally {
            if (originalGeminiKey) process.env.GEMINI_API_KEY = originalGeminiKey;
            if (originalGroqKey) process.env.GROQ_API_KEY = originalGroqKey;
        }
    });

    // 18. GPT-OSS unavailable safe fallback
    await runTest('GPT-OSS unavailable falls back gracefully to deterministic reconciliation', async () => {
        const originalGroqKey = process.env.GROQ_API_KEY;
        delete process.env.GROQ_API_KEY;

        try {
            const photo1 = extractFields({
                results: [
                    { text: 'NORDIC GRAINS', confidence: 0.95, bbox: [[40, 30], [260, 30], [260, 60], [40, 60]] },
                    { text: 'RYE FLOUR', confidence: 0.92, bbox: [[40, 80], [200, 80], [200, 110], [40, 110]] }
                ]
            }, 'photo-1');

            const merged = await mergeMultiPhotoExtractedFields([photo1]);
            assert.strictEqual(merged.brandName, 'NORDIC GRAINS');
            assert.strictEqual(merged.productName, 'RYE FLOUR');
        } finally {
            if (originalGroqKey) process.env.GROQ_API_KEY = originalGroqKey;
        }
    });

    // 19. Safe unresolved fallback when both AI services unavailable and evidence ambiguous
    await runTest('safe unresolved fallback when evidence is ambiguous and AI unavailable', async () => {
        const originalGeminiKey = process.env.GEMINI_API_KEY;
        const originalGroqKey = process.env.GROQ_API_KEY;
        delete process.env.GEMINI_API_KEY;
        delete process.env.GROQ_API_KEY;

        try {
            const photo1 = extractFields({
                results: [
                    { text: 'AMBIGUOUS ALPHA', confidence: 0.85, bbox: [[40, 30], [250, 30], [250, 60], [40, 60]] }
                ]
            }, 'photo-1');
            photo1.identityCollisionResolved = true;

            const merged = await mergeMultiPhotoExtractedFields([photo1]);
            assert.strictEqual(merged.productName, null);
            assert.strictEqual(merged.declarations.productName.status, 'not_detected');
        } finally {
            if (originalGeminiKey) process.env.GEMINI_API_KEY = originalGeminiKey;
            if (originalGroqKey) process.env.GROQ_API_KEY = originalGroqKey;
        }
    });

    // 20. LM-03 must NOT PASS from ungrounded identity
    await runTest('LM-03 must NOT PASS from ungrounded identity', async () => {
        // Case A: Both productName and genericCommodityName are null/not_detected
        const fieldsNoIdentity = {
            productName: null,
            genericCommodityName: null,
            brandName: 'SOME BRAND',
            netQuantity: { value: 500, unit: 'g' }
        };

        const reportNoIdentity = await ruleEngine.evaluateRules(fieldsNoIdentity);
        const lm03NoIdentity = reportNoIdentity.findings.find(f => f.ruleCode === 'LM-03');
        assert.notStrictEqual(lm03NoIdentity.status, 'PASS', 'LM-03 must NOT PASS when identity is ungrounded/null');
        assert.strictEqual(lm03NoIdentity.status, 'INSUFFICIENT_EVIDENCE');

        // Case B: Valid genericCommodityName with explicit label provenance PASSES LM-03
        const fieldsExplicit = {
            productName: 'MULTI GRAIN ATTA',
            genericCommodityName: 'Wheat Flour Blend',
            declarations: {
                genericCommodityName: {
                    value: 'Wheat Flour Blend',
                    source: 'ocr_explicit_label',
                    status: 'verified'
                }
            }
        };

        const reportExplicit = await ruleEngine.evaluateRules(fieldsExplicit);
        const lm03Explicit = reportExplicit.findings.find(f => f.ruleCode === 'LM-03');
        assert.strictEqual(lm03Explicit.status, 'PASS');
        assert.strictEqual(lm03Explicit.extractedValue, 'Wheat Flour Blend');
    });

    // Provenance verification test: OCR explicit label vs LLM inferred
    await runTest('genericCommodityName provenance distinguishes explicit OCR vs LLM inferred', async () => {
        // Explicit label on package
        const photoExplicit = extractFields({
            results: [
                { text: 'SUNRISE FOODS', confidence: 0.95, bbox: [[40, 30], [250, 30], [250, 60], [40, 60]] },
                { text: 'COLD PRESSED OIL', confidence: 0.90, bbox: [[40, 80], [280, 80], [280, 110], [40, 110]] },
                { text: 'Generic Name: Edible Mustard Oil', confidence: 0.92, bbox: [[40, 150], [350, 150], [350, 175], [40, 175]] }
            ]
        });

        assert.strictEqual(photoExplicit.genericCommodityName, 'Edible Mustard Oil');
        assert.strictEqual(photoExplicit.declarations.genericCommodityName.source, 'ocr_explicit_label');
        assert.strictEqual(photoExplicit.declarations.genericCommodityName.status, 'verified');

        // No explicit label on package -> should remain null and not_detected
        const photoNoExplicit = extractFields({
            results: [
                { text: 'SUNRISE FOODS', confidence: 0.95, bbox: [[40, 30], [250, 30], [250, 60], [40, 60]] },
                { text: 'COLD PRESSED OIL', confidence: 0.90, bbox: [[40, 80], [280, 80], [280, 110], [40, 110]] }
            ]
        });

        assert.strictEqual(photoNoExplicit.genericCommodityName, null);
        assert.strictEqual(photoNoExplicit.declarations.genericCommodityName.status, 'not_detected');
    });

    console.log('\n=============================================================');
    console.log(` RESULTS: ${passedTests} / ${totalTests} tests passed`);
    console.log('=============================================================\n');

    if (passedTests !== totalTests) {
        process.exit(1);
    }
})();
