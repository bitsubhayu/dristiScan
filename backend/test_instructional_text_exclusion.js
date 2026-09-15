/**
 * DrishtiScan — Issue 2: Instructional Text Exclusion Test
 * 
 * Verifies that imperative packaging directives ("CUT FROM HERE", etc.)
 * are never selected as productName or brandName, regardless of font prominence / bounding box height.
 */

const { extractFields } = require('./src/services/extraction');
const assert = require('assert');

function buildFixture(instructionHeight) {
    return {
        rawElements: [
            { text: 'CUT FROM HERE', confidence: 0.95, bbox: [[50,30],[350,30],[350,30+instructionHeight],[50,30+instructionHeight]] },
            { text: 'GULF DATES', confidence: 0.90, bbox: [[60,300],[500,300],[500,400],[60,400]] },
            { text: 'ZAHIDI DATES', confidence: 0.88, bbox: [[60,420],[520,420],[520,500],[60,500]] },
            { text: 'Net Wt. 500g', confidence: 0.93, bbox: [[60,700],[300,700],[300,760],[60,760]] },
            { text: 'Product of Saudi Arabia', confidence: 0.92, bbox: [[60,900],[400,900],[400,950],[60,950]] }
        ]
    };
}

console.log('Running Issue 2: Instructional text exclusion test across heights [60, 100, 140, 200]...');

[60, 100, 140, 200].forEach(h => {
    const ext = extractFields(buildFixture(h), 'photo-1');
    assert.notStrictEqual(ext.productName, 'CUT FROM HERE', `Failed at instruction height ${h}px: productName is CUT FROM HERE`);
    assert.notStrictEqual(ext.brandName, 'CUT FROM HERE', `Failed at instruction height ${h}px: brandName is CUT FROM HERE`);
    console.log(`  Height ${h}px: brandName="${ext.brandName}", productName="${ext.productName}"`);
});

console.log('PASSED: instructional text never selected across all tested sizes');
