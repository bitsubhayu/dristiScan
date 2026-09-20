/**
 * DrishtiScan — Synthetic Multi-Photo Evidence Fusion & Accuracy Test Suite
 * 
 * Tests all required scenarios using purely synthetic, product-agnostic data:
 * - Multi-Photo Fusion (stable row IDs, conflict-safe statutory preservation, deduplication, single GPT call)
 * - Country of Origin Contextual Grounding (Made in, Manufactured in, address/email/URL rejection, cross-photo)
 * - Identity Separation (brand vs generic commodity, no product name handling, generic classification)
 * - Ingredients Token-Sequence Grounding (single-row, multi-row, non-swallowing of nutrition/storage, anti-invention)
 * - Regression & Consumer Preference Integration
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: './.env' });
const assert = require('assert');
const {
    fuseMultiPhotoEvidence,
    normalizeTextForDeduplication,
    areNearIdentical,
    isPotentialStatutoryRow,
    areSafeToMergeRows
} = require('./src/services/multiPhotoEvidenceFusion');
const structuringEngine = require('./src/services/structuringEngine');
const { validateGrounding, FIELD_TIERS } = structuringEngine;
const {
    isGenericCommodityTerm,
    isExplicitCountryDeclaration,
    extractExplicitCountryFromDeclaration,
    validateFieldFormat,
    KNOWN_COUNTRIES
} = require('./src/services/textShapeValidators');
const { extractFields, mergeMultiPhotoExtractedFields } = require('./src/services/extraction');
const { extractFieldsDeterministic } = require('./src/services/deterministicFallbackExtractor');
const { evaluatePreferences } = require('./src/services/preferenceMatcher');
const gptOssService = require('./src/services/gptOssService');

let totalTests = 0;
let passedTests = 0;
const failedTestDetails = [];

const runTest = async (name, fn) => {
    totalTests++;
    process.stdout.write(`  [${totalTests}] ${name} ... `);
    try {
        await fn();
        passedTests++;
        console.log('✅ PASSED');
    } catch (err) {
        console.log('❌ FAILED');
        console.error('       Error:', err.message);
        failedTestDetails.push({ name, error: err.message });
    }
};

async function runTestSuite() {
    console.log('\n================================================================');
    console.log('    DRISHTISCAN MULTI-PHOTO FUSION & ACCURACY TEST SUITE       ');
    console.log('================================================================\n');

    // -------------------------------------------------------------------------
    // 1-6: MULTI-PHOTO FUSION & STABLE ROW ID TESTS
    // -------------------------------------------------------------------------
    console.log('--- Suite 1: Multi-Photo Evidence Fusion & Stable Row IDs ---');

    await runTest('1. Test A: Same declaration on two photos produces one fused row, original stable rowIds, and both sourceRefs', () => {
        const photoRowsList = [
            {
                photoId: 'photo-1',
                rows: [
                    { rowId: 0, text: 'NET WEIGHT: 500 g', confidence: 0.88, elements: [{ text: 'NET WEIGHT: 500 g', confidence: 0.88 }] },
                    { rowId: 1, text: 'MRP Rs. 250.00', confidence: 0.90, elements: [{ text: 'MRP Rs. 250.00', confidence: 0.90 }] }
                ]
            },
            {
                photoId: 'photo-2',
                rows: [
                    { rowId: 0, text: 'NET WEIGHT: 500 g', confidence: 0.95, elements: [{ text: 'NET WEIGHT: 500 g', confidence: 0.95 }] },
                    { rowId: 1, text: 'BATCH NO: BATCH994', confidence: 0.85, elements: [{ text: 'BATCH NO: BATCH994', confidence: 0.85 }] }
                ]
            }
        ];

        const fused = fuseMultiPhotoEvidence(photoRowsList);
        assert.strictEqual(fused.stats.totalInputRows, 4, 'Total input rows should be 4');
        assert.strictEqual(fused.stats.fusedRowCount, 3, 'Fused row count should be 3 (1 duplicate collapsed)');
        assert.strictEqual(fused.stats.deduplicatedCount, 1, '1 duplicate deduplicated');

        // Check that photo-1:0 has both sourceRefs
        const p1Refs = fused.allGroundingRefs.get('photo-1:0');
        assert.ok(Array.isArray(p1Refs), 'Grounding refs for photo-1:0 should exist');
        assert.strictEqual(p1Refs.length, 2, 'Should contain 2 supporting references for deduplicated row');
        assert.ok(p1Refs.some(r => r.photoId === 'photo-1' && r.rowId === 0));
        assert.ok(p1Refs.some(r => r.photoId === 'photo-2' && r.rowId === 0));

        // Grounding lookup resolves BOTH photo-1:0 and photo-2:0
        assert.strictEqual(fused.rowLookupMap.get('photo-1:0'), 'NET WEIGHT: 500 g');
        assert.strictEqual(fused.rowLookupMap.get('photo-2:0'), 'NET WEIGHT: 500 g');
    });

    await runTest('2. Test B: Conflicting statutory declarations (MRP 99 vs MRP 98) are NOT deduplicated; both survive', () => {
        const photoRowsList = [
            {
                photoId: 'photo-1',
                rows: [
                    { rowId: 0, text: 'MRP: 99', confidence: 0.90 }
                ]
            },
            {
                photoId: 'photo-2',
                rows: [
                    { rowId: 0, text: 'MRP: 98', confidence: 0.90 }
                ]
            }
        ];

        assert.strictEqual(isPotentialStatutoryRow('MRP: 99'), true, 'MRP: 99 should be statutory');
        assert.strictEqual(isPotentialStatutoryRow('MRP: 98'), true, 'MRP: 98 should be statutory');
        assert.strictEqual(areSafeToMergeRows({ text: 'MRP: 99' }, { text: 'MRP: 98' }), false, 'Conflicting MRP values must NOT be safe to merge');

        const fused = fuseMultiPhotoEvidence(photoRowsList);
        assert.strictEqual(fused.stats.fusedRowCount, 2, 'Both conflicting MRP rows must survive');
        assert.strictEqual(fused.stats.deduplicatedCount, 0, 'No deduplication on conflicting MRP');
    });

    await runTest('3. Test C: Unique evidence survives across 3 photos without loss', () => {
        const photoRowsList = [
            {
                photoId: 'photo-1',
                rows: [
                    { rowId: 0, text: 'PRODUCT TITLE: SYNTHETIC ITEM', confidence: 0.90 }
                ]
            },
            {
                photoId: 'photo-2',
                rows: [
                    { rowId: 0, text: 'FSSAI LIC NO: 10012022000123', confidence: 0.92 }
                ]
            },
            {
                photoId: 'photo-3',
                rows: [
                    { rowId: 0, text: 'INGREDIENTS: SYNTHETIC INGREDIENT ALPHA, SYNTHETIC INGREDIENT BETA', confidence: 0.91 }
                ]
            }
        ];

        const fused = fuseMultiPhotoEvidence(photoRowsList);
        assert.strictEqual(fused.stats.fusedRowCount, 3, 'All 3 unique evidence groups must survive');
        const allText = Array.from(fused.rowLookupMap.values()).join(' ');
        assert.ok(allText.includes('PRODUCT TITLE: SYNTHETIC ITEM'));
        assert.ok(allText.includes('10012022000123'));
        assert.ok(allText.includes('SYNTHETIC INGREDIENT ALPHA'));
    });

    await runTest('4. Test D: Noisy + clear duplicate retains canonical row, clearer confidence, and both sourceRefs', () => {
        const photoRowsList = [
            {
                photoId: 'photo-1',
                rows: [
                    { rowId: 0, text: 'EXP: 12/2026', confidence: 0.60 }
                ]
            },
            {
                photoId: 'photo-2',
                rows: [
                    { rowId: 0, text: 'EXP: 12/2026', confidence: 0.96 }
                ]
            }
        ];

        const fused = fuseMultiPhotoEvidence(photoRowsList);
        assert.strictEqual(fused.stats.fusedRowCount, 1, 'Near-identical rows collapsed to 1');
        const p1Rows = fused.fusedPhotoRows.find(p => p.photoId === 'photo-1').rows;
        assert.strictEqual(p1Rows[0].confidence, 0.96, 'Highest confidence retained from clear photo');
        assert.strictEqual(p1Rows[0].sourceRefs.length, 2, 'Both sourceRefs retained');
    });

    await runTest('5. Reindexing cannot break grounding: stable rowIds preserved after deduplication', () => {
        // Photo 1: row 0 = unique A, row 1 = shared row
        // Photo 2: row 0 = shared row, row 1 = unique B
        const photoRowsList = [
            {
                photoId: 'photo-1',
                rows: [
                    { rowId: 0, text: 'UNIQUE HEADER ROW', confidence: 0.90 },
                    { rowId: 1, text: 'SHARED MIDDLE ROW', confidence: 0.92 }
                ]
            },
            {
                photoId: 'photo-2',
                rows: [
                    { rowId: 0, text: 'SHARED MIDDLE ROW', confidence: 0.93 },
                    { rowId: 1, text: 'UNIQUE FOOTER ROW', confidence: 0.89 }
                ]
            }
        ];

        const fused = fuseMultiPhotoEvidence(photoRowsList);
        assert.strictEqual(fused.stats.fusedRowCount, 3, '3 unique logical rows');

        // Build context via buildRowContext
        const rowContext = structuringEngine.buildRowContext(fused.fusedPhotoRows);

        // Photo 1 row 0 has rowId 0, row 1 has rowId 1
        const p1 = rowContext.find(p => p.photoId === 'photo-1');
        assert.strictEqual(p1.rows[0].rowId, 0);
        assert.strictEqual(p1.rows[1].rowId, 1);

        // Photo 2 has only row 1 (unique footer) with its ORIGINAL rowId 1
        const p2 = rowContext.find(p => p.photoId === 'photo-2');
        assert.strictEqual(p2.rows.length, 1);
        assert.strictEqual(p2.rows[0].rowId, 1, 'Photo-2 unique row must retain its original rowId: 1, NOT reindexed to 0');

        // Check lookup maps both photo-1:1 and photo-2:0 to the shared text
        assert.strictEqual(fused.rowLookupMap.get('photo-1:1'), 'SHARED MIDDLE ROW');
        assert.strictEqual(fused.rowLookupMap.get('photo-2:0'), 'SHARED MIDDLE ROW');
    });

    await runTest('6. Exactly ONE GPT-OSS structuring call occurs for 1, 2, or 3 photos', async () => {
        let groqCallCount = 0;
        const originalCallGroqJson = gptOssService.callGroqJson;
        const originalIsAvailable = gptOssService.isAvailable;
        gptOssService.isAvailable = () => true;
        gptOssService.callGroqJson = async () => {
            groqCallCount++;
            return {
                success: true,
                content: {
                    productName: { value: 'SYNTHETIC BISCUITS', rawObservedText: 'SYNTHETIC BISCUITS', correctionApplied: false, groundingRefs: [{ photoId: 'photo-1', rowId: 0 }] }
                },
                latencyMs: 100
            };
        };

        try {
            const ext1 = extractFields({ results: [{ text: 'SYNTHETIC BISCUITS', confidence: 0.9, bbox: [[10, 10], [200, 10], [200, 30], [10, 30]] }], imageWidth: 1000, imageHeight: 1000 }, 'photo-1');
            const ext2 = extractFields({ results: [{ text: 'MRP Rs. 50', confidence: 0.9, bbox: [[10, 40], [150, 40], [150, 60], [10, 60]] }], imageWidth: 1000, imageHeight: 1000 }, 'photo-2');
            const ext3 = extractFields({ results: [{ text: 'NET WEIGHT: 100 g', confidence: 0.9, bbox: [[10, 70], [180, 70], [180, 90], [10, 90]] }], imageWidth: 1000, imageHeight: 1000 }, 'photo-3');

            // 1 Photo
            groqCallCount = 0;
            await mergeMultiPhotoExtractedFields([ext1]);
            assert.strictEqual(groqCallCount, 1, '1 photo should make exactly 1 GPT call');

            // 2 Photos
            groqCallCount = 0;
            await mergeMultiPhotoExtractedFields([ext1, ext2]);
            assert.strictEqual(groqCallCount, 1, '2 photos should make exactly 1 GPT call');

            // 3 Photos
            groqCallCount = 0;
            await mergeMultiPhotoExtractedFields([ext1, ext2, ext3]);
            assert.strictEqual(groqCallCount, 1, '3 photos should make exactly 1 GPT call');
        } finally {
            gptOssService.callGroqJson = originalCallGroqJson;
            gptOssService.isAvailable = originalIsAvailable;
        }
    });

    // -------------------------------------------------------------------------
    // 7-14: COUNTRY OF ORIGIN TESTS
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 2: Country of Origin Contextual Grounding ---');

    await runTest('7. Explicit "Made in <country>" is detected and extracted', () => {
        assert.strictEqual(extractExplicitCountryFromDeclaration('Made in Germany'), 'Germany');
        assert.strictEqual(extractExplicitCountryFromDeclaration('Made in USA'), 'United States');
    });

    await runTest('8. Explicit "Manufactured in <country>" is detected and extracted', () => {
        assert.strictEqual(extractExplicitCountryFromDeclaration('Manufactured in India'), 'India');
        assert.strictEqual(extractExplicitCountryFromDeclaration('Manufactured in France'), 'France');
    });

    await runTest('9. "Country of Origin: <country>" is detected and extracted', () => {
        assert.strictEqual(extractExplicitCountryFromDeclaration('Country of Origin: Japan'), 'Japan');
        assert.strictEqual(extractExplicitCountryFromDeclaration('Country of Origin - Australia'), 'Australia');
    });

    await runTest('10. Country appearing only inside an unrelated corporate address is rejected in validateGrounding', () => {
        const addressText = 'Industrial Area, Phase II, New Delhi - 110020, India';
        assert.strictEqual(extractExplicitCountryFromDeclaration(addressText), null, 'Address without origin prefix must return null');

        const rowLookup = new Map([
            ['photo-1:0', addressText]
        ]);
        const decision = {
            value: 'India',
            rawObservedText: addressText,
            correctionApplied: false,
            groundingRefs: [{ photoId: 'photo-1', rowId: 0 }]
        };

        const grounded = validateGrounding('countryOfOrigin', decision, rowLookup, FIELD_TIERS.countryOfOrigin);
        assert.strictEqual(grounded.status, 'review', 'Address-only country must be rejected to review');
        assert.ok(grounded.reason.toLowerCase().includes('explicit'), 'Reason must specify explicit declaration requirement');
    });

    await runTest('11. Country appearing only in a URL or email is NOT accepted', () => {
        assert.strictEqual(extractExplicitCountryFromDeclaration('support@example.in'), null);
        assert.strictEqual(extractExplicitCountryFromDeclaration('visit www.example.co.in for info'), null);
    });

    await runTest('12. Positive Grounding: "Made in Germany" produces verified status', () => {
        const rowLookup = new Map([
            ['photo-1:0', 'Made in Germany']
        ]);
        const decision = {
            value: 'Germany',
            rawObservedText: 'Made in Germany',
            correctionApplied: false,
            groundingRefs: [{ photoId: 'photo-1', rowId: 0 }]
        };
        const grounded = validateGrounding('countryOfOrigin', decision, rowLookup, FIELD_TIERS.countryOfOrigin);
        assert.strictEqual(grounded.status, 'verified');
        assert.strictEqual(grounded.value, 'Germany');
    });

    await runTest('13. Positive Grounding: "Manufactured in Germany" produces verified status', () => {
        const rowLookup = new Map([
            ['photo-1:0', 'Manufactured in Germany']
        ]);
        const decision = {
            value: 'Germany',
            rawObservedText: 'Manufactured in Germany',
            correctionApplied: false,
            groundingRefs: [{ photoId: 'photo-1', rowId: 0 }]
        };
        const grounded = validateGrounding('countryOfOrigin', decision, rowLookup, FIELD_TIERS.countryOfOrigin);
        assert.strictEqual(grounded.status, 'verified');
        assert.strictEqual(grounded.value, 'Germany');
    });

    await runTest('14. Multi-photo country grounding: corroborated across photos produces verified', () => {
        const rowLookup = new Map([
            ['photo-1:0', 'COUNTRY OF ORIGIN: Germany'],
            ['photo-2:0', 'COUNTRY OF ORIGIN: Germany']
        ]);
        const decision = {
            value: 'Germany',
            rawObservedText: 'COUNTRY OF ORIGIN: Germany',
            correctionApplied: false,
            groundingRefs: [
                { photoId: 'photo-1', rowId: 0 },
                { photoId: 'photo-2', rowId: 0 }
            ]
        };
        const grounded = validateGrounding('countryOfOrigin', decision, rowLookup, FIELD_TIERS.countryOfOrigin);
        assert.strictEqual(grounded.status, 'verified');
        assert.strictEqual(grounded.value, 'Germany');
    });

    // -------------------------------------------------------------------------
    // 15-17: IDENTITY SEPARATION TESTS
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 3: Identity Separation (Brand vs Generic Commodity) ---');

    await runTest('15. Generic commodity-only term (e.g. "protein", "whey") rejected from brandName with null value', () => {
        assert.strictEqual(isGenericCommodityTerm('protein'), true);
        assert.strictEqual(isGenericCommodityTerm('100% Whey Protein Isolate'), true);
        assert.strictEqual(isGenericCommodityTerm('Edible Mustard Oil'), true);

        const rowLookup = new Map([
            ['photo-1:0', 'PROTEIN']
        ]);
        const decision = {
            value: 'PROTEIN',
            rawObservedText: 'PROTEIN',
            correctionApplied: false,
            groundingRefs: [{ photoId: 'photo-1', rowId: 0 }]
        };

        const grounded = validateGrounding('brandName', decision, rowLookup, FIELD_TIERS.brandName);
        assert.strictEqual(grounded.status, 'review');
        assert.strictEqual(grounded.value, null, 'Rejected generic brandName must become null');
        assert.ok(grounded.reason.includes('Generic category/commodity descriptor'));
    });

    await runTest('16. No product name case: evidence contains only storage/dosage/nutrition/generic text -> brandName and productName are null', () => {
        const rowLookup = new Map([
            ['photo-1:0', 'STORE IN A COOL DRY PLACE'],
            ['photo-1:1', 'DOSAGE: TAKE 1 TABLET DAILY WITH WATER'],
            ['photo-1:2', 'NUTRITION FACTS: ENERGY 100 KCAL']
        ]);
        const decisionBrand = {
            value: null,
            rawObservedText: null,
            groundingRefs: []
        };
        const groundedBrand = validateGrounding('brandName', decisionBrand, rowLookup, FIELD_TIERS.brandName);
        assert.strictEqual(groundedBrand.status, 'not_detected');
        assert.strictEqual(groundedBrand.value, null);

        const decisionProd = {
            value: null,
            rawObservedText: null,
            groundingRefs: []
        };
        const groundedProd = validateGrounding('productName', decisionProd, rowLookup, FIELD_TIERS.productName);
        assert.strictEqual(groundedProd.status, 'not_detected');
        assert.strictEqual(groundedProd.value, null);
    });

    await runTest('17. Generic commodity classification still works under generic_classification rule', () => {
        const rowLookup = new Map([
            ['photo-1:0', 'INSTANT NOODLES WITH TASTEMAKER']
        ]);
        const decision = {
            value: 'Instant Noodles',
            rawObservedText: 'INSTANT NOODLES WITH TASTEMAKER',
            correctionApplied: true,
            correctionReason: 'generic_classification',
            groundingRefs: [{ photoId: 'photo-1', rowId: 0 }]
        };
        const grounded = validateGrounding('genericCommodityName', decision, rowLookup, FIELD_TIERS.genericCommodityName);
        assert.strictEqual(grounded.status, 'verified');
        assert.strictEqual(grounded.value, 'Instant Noodles');
        assert.strictEqual(grounded.provenance, 'llm_inferred');
    });

    // -------------------------------------------------------------------------
    // 18-23: INGREDIENTS TOKEN-SEQUENCE GROUNDING TESTS
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 4: Ingredients Token-Sequence Grounding ---');

    await runTest('18. Single-row ingredient declaration is extracted and token-grounded', () => {
        const rowLookup = new Map([
            ['photo-1:0', 'Ingredients: Whole Wheat Flour, Water, Yeast, Salt.']
        ]);
        const decision = {
            value: 'Whole Wheat Flour, Water, Yeast, Salt.',
            rawObservedText: 'Ingredients: Whole Wheat Flour, Water, Yeast, Salt.',
            correctionApplied: false,
            groundingRefs: [{ photoId: 'photo-1', rowId: 0 }]
        };
        const grounded = validateGrounding('ingredients', decision, rowLookup, FIELD_TIERS.ingredients);
        assert.strictEqual(grounded.status, 'verified');
        assert.strictEqual(grounded.value, 'Whole Wheat Flour, Water, Yeast, Salt.');
    });

    await runTest('19. Multi-row ingredient declaration is concatenated and token-sequence validated', () => {
        const rowLookup = new Map([
            ['photo-1:0', 'Ingredients: Rolled Oats, Brown Sugar, Raisins,'],
            ['photo-1:1', 'Almonds, Chia Seeds, Cinnamon, Salt.']
        ]);
        const decision = {
            value: 'Rolled Oats, Brown Sugar, Raisins, Almonds, Chia Seeds, Cinnamon, Salt.',
            rawObservedText: 'Ingredients: Rolled Oats, Brown Sugar, Raisins, Almonds, Chia Seeds, Cinnamon, Salt.',
            correctionApplied: true,
            correctionReason: 'row_concatenation',
            groundingRefs: [
                { photoId: 'photo-1', rowId: 0 },
                { photoId: 'photo-1', rowId: 1 }
            ]
        };
        const grounded = validateGrounding('ingredients', decision, rowLookup, FIELD_TIERS.ingredients);
        assert.strictEqual(grounded.status, 'verified');
        assert.strictEqual(grounded.provenance, 'ocr_corrected');
    });

    await runTest('20. Nutrition facts panel cited as ingredients is rejected', () => {
        const rowLookup = new Map([
            ['photo-1:0', 'Nutrition Facts: Energy 450 kcal, Total Fat 15g, Protein 8g']
        ]);
        const decision = {
            value: 'Energy 450 kcal, Total Fat 15g, Protein 8g',
            rawObservedText: 'Nutrition Facts: Energy 450 kcal, Total Fat 15g, Protein 8g',
            groundingRefs: [{ photoId: 'photo-1', rowId: 0 }]
        };
        const grounded = validateGrounding('ingredients', decision, rowLookup, FIELD_TIERS.ingredients);
        assert.strictEqual(grounded.status, 'review');
        assert.ok(grounded.reason.includes('Nutrition facts panel cited as ingredients'));
    });

    await runTest('21. Storage or usage instructions cited as ingredients is rejected', () => {
        const rowLookup = new Map([
            ['photo-1:0', 'Storage: Store in a cool and dry place away from moisture']
        ]);
        const decision = {
            value: 'Store in a cool and dry place away from moisture',
            rawObservedText: 'Storage: Store in a cool and dry place away from moisture',
            groundingRefs: [{ photoId: 'photo-1', rowId: 0 }]
        };
        const grounded = validateGrounding('ingredients', decision, rowLookup, FIELD_TIERS.ingredients);
        assert.strictEqual(grounded.status, 'review');
        assert.ok(grounded.reason.includes('Storage or usage instructions cited as ingredients'));
    });

    await runTest('22. Invented ingredient tokens (not in evidence) are rejected by token containment', () => {
        const rowLookup = new Map([
            ['photo-1:0', 'Ingredients: Wheat Flour, Sugar, Edible Veg...']
        ]);
        const decision = {
            value: 'Wheat Flour, Sugar, Edible Vegetable Oil, Cocoa Solids, Salt',
            rawObservedText: 'Ingredients: Wheat Flour, Sugar, Edible Veg...',
            correctionApplied: true,
            correctionReason: 'row_concatenation',
            groundingRefs: [{ photoId: 'photo-1', rowId: 0 }]
        };
        const grounded = validateGrounding('ingredients', decision, rowLookup, FIELD_TIERS.ingredients);
        assert.strictEqual(grounded.status, 'review');
        assert.ok(grounded.reason.includes('tokens not present in cited rows'));
    });

    await runTest('23. Token sequence order scramble is rejected', () => {
        const rowLookup = new Map([
            ['photo-1:0', 'Ingredients: Flour, Sugar, Butter, Milk, Salt, Vanilla.']
        ]);
        // Reordered tokens completely backwards
        const decision = {
            value: 'Vanilla, Salt, Milk, Butter, Sugar, Flour',
            rawObservedText: 'Ingredients: Flour, Sugar, Butter, Milk, Salt, Vanilla.',
            correctionApplied: true,
            correctionReason: 'row_concatenation',
            groundingRefs: [{ photoId: 'photo-1', rowId: 0 }]
        };
        const grounded = validateGrounding('ingredients', decision, rowLookup, FIELD_TIERS.ingredients);
        assert.strictEqual(grounded.status, 'review');
        assert.ok(grounded.reason.includes('violates the token order'));
    });

    // -------------------------------------------------------------------------
    // 24-27: REGRESSION & INTEGRATION TESTS
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 5: Regression & Preference Matcher Integration ---');

    await runTest('24. Existing structuring tier mapping remains intact', () => {
        assert.strictEqual(FIELD_TIERS.productName, 'verbatim');
        assert.strictEqual(FIELD_TIERS.brandName, 'verbatim');
        assert.strictEqual(FIELD_TIERS.genericCommodityName, 'generic_inferred');
        assert.strictEqual(FIELD_TIERS.netQuantity, 'strict');
        assert.strictEqual(FIELD_TIERS.mrp, 'strict');
        assert.strictEqual(FIELD_TIERS.countryOfOrigin, 'descriptive');
        assert.strictEqual(FIELD_TIERS.ingredients, 'descriptive');
    });

    await runTest('25. Cell normalized bounding boxes and sourceRefs preserved in buildRowContext', () => {
        const photoRowsList = [
            {
                photoId: 'photo-1',
                rows: [
                    {
                        rowId: 4,
                        text: 'NET QTY 500g',
                        elements: [
                            { text: 'NET', confidence: 0.95, normalizedBbox: [0.1, 0.2, 0.2, 0.25] },
                            { text: 'QTY 500g', confidence: 0.92, normalizedBbox: [0.22, 0.2, 0.45, 0.25] }
                        ],
                        normalizedBbox: [0.1, 0.2, 0.45, 0.25],
                        sourceRefs: [
                            { photoId: 'photo-1', rowId: 4 },
                            { photoId: 'photo-2', rowId: 1 }
                        ]
                    }
                ]
            }
        ];
        const rowContext = structuringEngine.buildRowContext(photoRowsList);
        assert.strictEqual(rowContext.length, 1);
        assert.strictEqual(rowContext[0].rows[0].rowId, 4);
        assert.strictEqual(rowContext[0].rows[0].cells.length, 2);
        assert.deepStrictEqual(rowContext[0].rows[0].cells[0].normalizedBbox, [0.1, 0.2, 0.2, 0.25]);
        assert.strictEqual(rowContext[0].rows[0].sourceRefs.length, 2);
    });

    await runTest('26. Deterministic fallback extractor works with country of origin and ingredients', () => {
        const elements = [
            { text: 'Country of Origin: India', confidence: 0.95 },
            { text: 'Ingredients: Milk Solids, Sugar, Cocoa Butter', confidence: 0.9 },
            { text: 'Net Qty: 150 g', confidence: 0.9 },
            { text: 'MRP Rs. 85', confidence: 0.9 }
        ];
        const sRows = { rows: [
            { text: 'Country of Origin: India' },
            { text: 'Ingredients: Milk Solids, Sugar, Cocoa Butter' }
        ] };
        const res = extractFieldsDeterministic(elements, sRows);
        assert.strictEqual(res.normalizedFields.countryOfOrigin, 'India');
        assert.strictEqual(res.normalizedFields.ingredients, 'Milk Solids, Sugar, Cocoa Butter');
        assert.strictEqual(res.normalizedFields.netQuantity.value, 150);
        assert.strictEqual(res.normalizedFields.mrp.value, 85);
    });

    await runTest('27. Consumer preference matcher evaluates dietary/allergen rules using ingredients', () => {
        const extractedFields = {
            productName: 'SYNTHETIC CHOCOLATE',
            ingredients: 'Sugar, Milk Solids, Cocoa Butter, Soy Lecithin',
            nutritionFacts: { sugar: 45, fat: 28, protein: 6 }
        };

        const prefs = {
            milk: true,
            vegan: true
        };

        const evalResult = evaluatePreferences(extractedFields, prefs);
        assert.ok(evalResult);
        assert.strictEqual(evalResult.isSuitable, false);
        assert.strictEqual(evalResult.details.vegan.status, 'FAIL');
        assert.strictEqual(evalResult.details.milk.status, 'FAIL');
        assert.ok(evalResult.warnings.length >= 1);
    });

    // -------------------------------------------------------------------------
    // 28-31: SHORT/NON-STATUTORY CONFLICT SAFETY TESTS
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 6: Short/Non-Statutory Conflict Safety ---');

    await runTest('28. Short numeric variant labels are NOT merged (Pack of 6 vs Pack of 8)', () => {
        const { areSafeToMergeRows, normalizeTextForDeduplication } = require('./src/services/multiPhotoEvidenceFusion');
        const mk = (t) => ({ text: t, normText: normalizeTextForDeduplication(t) });
        assert.strictEqual(areSafeToMergeRows(mk('Pack of 6'), mk('Pack of 8')), false);
    });

    await runTest('29. Short letter-variant labels are NOT merged (Type A vs Type B)', () => {
        const { areSafeToMergeRows, normalizeTextForDeduplication } = require('./src/services/multiPhotoEvidenceFusion');
        const mk = (t) => ({ text: t, normText: normalizeTextForDeduplication(t) });
        assert.strictEqual(areSafeToMergeRows(mk('Type A'), mk('Type B')), false);
    });

    await runTest('30. Legitimate short exact duplicates still merge (regression guard)', () => {
        const { areSafeToMergeRows, normalizeTextForDeduplication } = require('./src/services/multiPhotoEvidenceFusion');
        const mk = (t) => ({ text: t, normText: normalizeTextForDeduplication(t) });
        assert.strictEqual(areSafeToMergeRows(mk('NET WEIGHT: 500 g'), mk('NET WEIGHT: 500 g')), true);
    });

    await runTest('31. Full fusion: three photos with a Pack-of-6/Pack-of-8 conflict both survive', () => {
        const { fuseMultiPhotoEvidence } = require('./src/services/multiPhotoEvidenceFusion');
        const fused = fuseMultiPhotoEvidence([
            { photoId: 'photo-1', rows: [{ text: 'Pack of 6' }] },
            { photoId: 'photo-2', rows: [{ text: 'Pack of 8' }] }
        ]);
        assert.strictEqual(fused.stats.fusedRowCount, 2, 'Both conflicting pack-count rows must survive as 2 distinct rows');
    });

    console.log('\n================================================================');
    console.log(` RESULTS: ${passedTests} / ${totalTests} tests passed`);
    if (failedTestDetails.length > 0) {
        console.log(` FAILURES (${failedTestDetails.length}):`);
        failedTestDetails.forEach(f => console.log(`   - ${f.name}: ${f.error}`));
    }
    console.log('================================================================\n');

    if (failedTestDetails.length > 0) {
        process.exit(1);
    }
}

runTestSuite().catch(err => {
    console.error('Test suite runner crashed:', err);
    process.exit(1);
});
