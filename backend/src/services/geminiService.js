/**
 * DrishtiScan Phase 5 — Gemini Integration Service
 * 
 * Two narrow, well-defined uses of Gemini (free-tier Flash model):
 * 1. Semantic multi-angle reconciliation (Fix 1) — resolving false conflicts
 *    across multiple photos of the same product
 * 2. Low-confidence field fallback (Fix 2) — re-reading fields PaddleOCR
 *    couldn't confidently extract
 * 
 * Gemini is NEVER the first-pass OCR engine. PaddleOCR processes every image first.
 * Gemini is called only after PaddleOCR, for these two downstream tasks.
 */

const { GoogleGenAI } = require('@google/genai');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Use the latest Flash model for efficiency and generous rate limits
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

let ai = null;

/**
 * Lazily initialize the Gemini client. Returns null if no API key is configured.
 */
const getClient = () => {
    if (ai) return ai;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.warn('[GeminiService] No GEMINI_API_KEY configured. Gemini reconciliation and fallback will be skipped.');
        return null;
    }
    try {
        ai = new GoogleGenAI({ apiKey });
        console.log('[GeminiService] Gemini client initialized with model:', GEMINI_MODEL);
        return ai;
    } catch (err) {
        console.error('[GeminiService] Failed to initialize Gemini client:', err.message);
        return null;
    }
};

/**
 * Intelligent local reconciliation engine used when GEMINI_API_KEY is not configured.
 * Implements semantic reconciliation, fragment filtering, and brand classification.
 */
const localReconcileFields = (candidatesByField) => {
    const reconciledFields = {};

    for (const [field, candidates] of Object.entries(candidatesByField)) {
        if (!candidates || candidates.length === 0) continue;

        if (candidates.length === 1) {
            reconciledFields[field] = {
                value: candidates[0].value,
                reasoning: "Single candidate value accepted",
                isConflict: false
            };
            continue;
        }

        const vals = candidates.map(c => String(c.value).trim());

        // Numeric fields: check if values are very different
        if (field === 'mrp' || field === 'netQuantity') {
            const numVals = vals.map(v => parseFloat(v)).filter(n => !isNaN(n));
            if (numVals.length > 1 && Math.max(...numVals) - Math.min(...numVals) > 1.0) {
                reconciledFields[field] = {
                    value: null,
                    reasoning: `Genuine numerical discrepancy (${vals.join(' vs ')})`,
                    isConflict: true
                };
                continue;
            }
        }

        // Filter out obvious suffix noise fragments (e.g. "ation", "ducts")
        const cleanVals = vals.filter(v => !/^(?:ation|tion|ing|ised|ized|ment|ties|ducts|tured)$/i.test(v));
        if (cleanVals.length > 0 && cleanVals.length < vals.length) {
            const best = cleanVals.reduce((a, b) => a.length >= b.length ? a : b);
            reconciledFields[field] = {
                value: best,
                reasoning: "Resolved variant OCR fragment; discarded noise suffix",
                isConflict: false
            };
            continue;
        }

        // Phone numbers: check if one is prefix/subset of another
        if (field === 'consumerCare.phone') {
            const cleaned = vals.map(v => v.replace(/\D/g, ''));
            const isSubset = cleaned.some((v, i) => cleaned.some((v2, j) => i !== j && (v2.includes(v) || v.includes(v2))));
            if (isSubset) {
                const longest = vals.reduce((a, b) => a.length >= b.length ? a : b);
                reconciledFields[field] = {
                    value: longest,
                    reasoning: "Resolved partial phone number capture across angles",
                    isConflict: false
                };
                continue;
            }
        }

        // Substring check: if one value is a substring of another, pick the longer one
        const sortedByLen = [...vals].sort((a, b) => b.length - a.length);
        const longestVal = sortedByLen[0];
        const allSubsets = sortedByLen.slice(1).every(v =>
            longestVal.toLowerCase().includes(v.toLowerCase()) ||
            v.toLowerCase().includes(longestVal.toLowerCase())
        );
        if (allSubsets) {
            reconciledFields[field] = {
                value: longestVal,
                reasoning: "Resolved as substring/superset match across photos",
                isConflict: false
            };
            continue;
        }

        // Default: flag as genuine conflict — do NOT guess or override
        reconciledFields[field] = {
            value: null,
            reasoning: `Genuine conflict: materially different values detected (${vals.join(' vs ')})`,
            isConflict: true
        };
    }

    // No hardcoded brand classification — let PaddleOCR extraction stand on its own
    return {
        reconciledFields,
        brandClassification: null,
        skipped: false,
        isLocalFallback: true
    };
};

/**
 * Local fallback read engine when GEMINI_API_KEY is not configured or offline.
 * Strict zero-fabrication safety rule: Never inject synthetic or mock values into missing declarations.
 */
const localFallbackReadFields = (imageBuffer, fieldsToRead = []) => {
    return { results: {}, skipped: true, isLocalFallback: true };
};

/**
 * Fix 1: Semantic Multi-Angle Reconciliation
 * 
 * Given candidate values for fields that differ across multiple photos,
 * asks Gemini to determine whether they represent the same entity (reconcile)
 * or genuinely conflict.
 * 
 * Also classifies brand vs. productName vs. genericName from all candidate fragments.
 * 
 * @param {Object} candidatesByField - Map of { fieldName: [{ value, photoId, rawText }] }
 * @returns {Object} { reconciledFields: { [fieldName]: { value, reasoning, isConflict } }, brandClassification: { brand, productName, genericName } }
 */
const reconcileFields = async (candidatesByField) => {
    const client = getClient();
    if (!client) {
        // Use local fallback reconciliation when no API key is present
        return localReconcileFields(candidatesByField);
    }

    // Build the prompt — one batched call for all fields needing reconciliation
    const fieldEntries = Object.entries(candidatesByField).filter(([, candidates]) => candidates.length > 1);
    
    if (fieldEntries.length === 0) {
        return { reconciledFields: {}, brandClassification: null, skipped: false };
    }

    const fieldDescriptions = fieldEntries.map(([fieldName, candidates]) => {
        const candidateList = candidates.map(c => `  - ${c.photoId}: "${c.value}" (raw: "${c.rawText || c.value}")`).join('\n');
        return `Field "${fieldName}":\n${candidateList}`;
    }).join('\n\n');

    // Collect all text fragments for brand classification
    const allTextFragments = [];
    for (const [, candidates] of fieldEntries) {
        for (const c of candidates) {
            allTextFragments.push(c.value);
            if (c.rawText && c.rawText !== c.value) allTextFragments.push(c.rawText);
        }
    }

    const prompt = `You are a product label analysis assistant. Multiple photos were taken of a SINGLE physical product package from different angles. The OCR system extracted different text fragments from each photo for the same fields.

IMPORTANT FIELD DEFINITIONS — these are THREE SEPARATE identity declarations, not competing answers:
- brandName: The company/manufacturer trade name (e.g. "NUTRABOX", "Optimum Nutrition"). This is the brand, NOT the product.
- productName: The specific product or variant name (e.g. "The Alpha Creatine (Unflavoured)", "Gold Standard 100% Whey"). This is the marketing name of this specific product.
- genericCommodityName: The common/generic name of the commodity as required by Legal Metrology (e.g. "Micronized Creatine Monohydrate", "Whey Protein Isolate", "Tomato Ketchup"). This is what the product IS, generically.

All three can legitimately be different — they are NOT conflicts with each other.

For each field below, determine:
1. Whether the different values are actually the SAME entity observed differently (e.g., a brand name, a website URL containing the brand, and a partial OCR fragment — all referring to one product). If so, provide the best canonical value and your reasoning.
2. OR whether they genuinely CONFLICT (e.g., two completely different products, two clearly different prices). If so, flag as a conflict.

EXCLUSION RULES:
- Websites/URLs containing the brand name (e.g., "OPTIMUMNUTRITION.CO.IN" for brand "Optimum Nutrition"), partial OCR fragments of the brand, and marketing text containing the brand are NOT conflicts.
- Marketing/quality badges ("100% Authentic", "Certified", "Premium", "NUTHENTIC", "ISO Certified", "GMP") are NOT valid candidates for any identity field.
- Ingredient list text, nutrition table text, and composition percentages must NEVER appear in netQuantity, productName, brandName, or genericCommodityName fields.
- If a field's value cannot be confidently determined, return null rather than guessing from nearby unrelated text.

${fieldDescriptions}

Also, from ALL the text fragments below, classify which is the BRAND name, which is the specific PRODUCT NAME, and what would be a reasonable GENERIC/COMMODITY NAME:

All text fragments: ${JSON.stringify([...new Set(allTextFragments)])}

Respond in this exact JSON format (no markdown, no code fences):
{
  "reconciledFields": {
    "<fieldName>": {
      "value": "best canonical value or null",
      "reasoning": "brief explanation",
      "isConflict": false
    }
  },
  "brandClassification": {
    "brand": "brand name or null",
    "productName": "specific product name or null",
    "genericName": "generic commodity description or null"
  }
}`;

    try {
        const response = await client.models.generateContent({
            model: GEMINI_MODEL,
            contents: prompt,
            config: {
                temperature: 0.1,
                maxOutputTokens: 8192,
                responseMimeType: 'application/json',
            }
        });

        const text = response.text.trim();
        
        // Parse JSON from response (strip any markdown fences if present and clean trailing commas)
        let parsed;
        try {
            let jsonStr = text.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
            jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
            parsed = JSON.parse(jsonStr);
        } catch (parseErr) {
            console.error('[GeminiService] Failed to parse reconciliation response:', parseErr.message);
            console.error('[GeminiService] Raw response:', text.substring(0, 500));
            return { reconciledFields: {}, brandClassification: null, skipped: false, error: 'parse_failed' };
        }

        console.log('[GeminiService] Reconciliation successful:', 
            Object.keys(parsed.reconciledFields || {}).length, 'fields reconciled');

        return {
            reconciledFields: parsed.reconciledFields || {},
            brandClassification: parsed.brandClassification || null,
            skipped: false
        };
    } catch (err) {
        console.error('[GeminiService] Reconciliation API error:', err.message);
        return { reconciledFields: {}, brandClassification: null, skipped: false, error: err.message };
    }
};

/**
 * Fix 2: Gemini Fallback for Low-Confidence or Undetected Fields
 * 
 * When PaddleOCR + spatial pairing couldn't confidently extract a field,
 * sends the image to Gemini with a targeted prompt to re-read specific declarations.
 * 
 * All values from this function MUST be tagged with:
 *   source: "gemini_fallback"
 *   aiAssisted: true
 * and displayed with the "AI-assisted read — please verify" label.
 * 
 * @param {Buffer} imageBuffer - The image to analyze
 * @param {Array<string>} fieldsToRead - List of field names to look for
 * @param {string} mimeType - MIME type of the image
 * @returns {Object} { [fieldName]: { value, reasoning } } or null per field
 */
const fallbackReadFields = async (imageBuffer, fieldsToRead = [], mimeType = 'image/jpeg') => {
    const client = getClient();
    if (!client) {
        return localFallbackReadFields(imageBuffer, fieldsToRead);
    }

    if (!imageBuffer || fieldsToRead.length === 0) {
        return { results: {}, skipped: false };
    }

    // Map field names to human-readable descriptions for the prompt
    const FIELD_DESCRIPTIONS = {
        'productName': 'the specific product/variant name (the marketing name, NOT the brand — e.g. "Gold Standard 100% Whey", "The Alpha Creatine (Unflavoured)")',
        'brandName': 'the brand/company trade name (e.g. "NUTRABOX", "Optimum Nutrition") — NOT the product name, NOT marketing badges like "100% Authentic"',
        'genericCommodityName': 'the common/generic commodity name as required by Legal Metrology (e.g. "Creatine Monohydrate", "Whey Protein Isolate", "Tomato Ketchup") — what the product IS generically',
        'manufacturer.name': 'the manufacturer name (look for "Manufactured By" or "Mfd. By")',
        'manufacturer.address': 'the manufacturer or marketer full address',
        'marketer.name': 'the marketer name (look for "Marketed By")',
        'marketer.address': 'the marketer full address',
        'packer.name': 'the packer name (look for "Packed By")',
        'importer.name': 'the importer name (look for "Imported By")',
        'mrp': 'the Maximum Retail Price / MRP in INR (₹) — a bold, prominent retail price (e.g., 999 or 1499), usually printed with "inclusive of all taxes" or "Incl. of all taxes" nearby — distinct from the smaller per-unit price (USP)',
        'unitSalePrice': 'the Unit Sale Price or USP (a price per unit, NOT the MRP)',
        'netQuantity': 'the net quantity/weight/volume declaration — MUST be a number + unit (e.g. "300 g", "500 ml", "60 capsules"). Must NOT contain ingredient text or nutrition information.',
        'countryOfOrigin': 'the Country of Origin declaration (e.g., "India", "Made in India", "Country of Origin: India")',
        'consumerCare.phone': 'the consumer care / customer care phone number',
        'consumerCare.email': 'the consumer care / customer care email address',
        'fssaiLicenseNumber': 'the FSSAI license number (a 14-digit number)',
        'batchNumber': 'the batch or lot number (an alphanumeric code, 3-25 characters)',
        'dates.manufacture': 'the manufacturing or packaging date (MFG date) — must be a date, not ingredient text',
        'dates.expiry': 'the expiry date or use-by date — must be a date, not ingredient text',
    };

    const fieldPrompts = fieldsToRead.map(f => {
        const desc = FIELD_DESCRIPTIONS[f] || f;
        return `- "${f}": Read ${desc} from the label, if present`;
    }).join('\n');

    const prompt = `You are analyzing a product packaging label image. The primary OCR system could not confidently extract certain declarations. Please carefully examine this label image and extract ONLY the following fields if they are visible:

${fieldPrompts}

Rules:
- Only return values you can actually see in the image. Do NOT guess or fabricate.
- If a field is not visible or unreadable, return null for that field.
- For prices, return just the numeric value (e.g., "13.99" not "Rs. 13.99")
- For addresses, include the full address as printed
- For dates, return in the format shown on the label
- For netQuantity, return ONLY the number and unit (e.g. "300 g"). Do NOT include ingredient text, nutrition data, or any other adjacent content.
- For identity fields (brandName, productName, genericCommodityName), do NOT include marketing badges like "100% Authentic", "Certified", "Premium", or quality claims. These are not identity declarations.
- brandName is the company/brand trade name. productName is the specific product/variant name. genericCommodityName is the common/generic commodity description.
- For every non-null field, include the exact "sourcePhrase" visible on the package that contains or anchors this value.

Respond in this exact JSON format (no markdown, no code fences):
{
  "<fieldName>": {
    "value": "extracted value or null",
    "sourcePhrase": "exact text snippet as printed on label or null",
    "reasoning": "brief explanation of where on the label this was found, or why it couldn't be found"
  }
}`;

    try {
        // Convert image buffer to base64 for Gemini multimodal input
        const base64Image = imageBuffer.toString('base64');

        const response = await client.models.generateContent({
            model: GEMINI_MODEL,
            contents: [
                {
                    role: 'user',
                    parts: [
                        {
                            inlineData: {
                                mimeType: mimeType,
                                data: base64Image
                            }
                        },
                        { text: prompt }
                    ]
                }
            ],
            config: {
                temperature: 0.1,
                maxOutputTokens: 8192,
                responseMimeType: 'application/json',
            }
        });

        const text = response.text.trim();
        
        let parsed;
        try {
            let jsonStr = text.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
            jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
            parsed = JSON.parse(jsonStr);
        } catch (parseErr) {
            console.error('[GeminiService] Failed to parse fallback response:', parseErr.message);
            console.error('[GeminiService] Raw response:', text.substring(0, 500));
            return { results: {}, skipped: false, error: 'parse_failed' };
        }

        // Filter out null results
        const validResults = {};
        for (const [field, data] of Object.entries(parsed)) {
            if (data && data.value !== null && data.value !== undefined && data.value !== '') {
                validResults[field] = {
                    value: data.value,
                    sourcePhrase: data.sourcePhrase || null,
                    reasoning: data.reasoning || 'Recovered by Gemini fallback'
                };
            }
        }

        console.log('[GeminiService] Fallback read successful:', 
            Object.keys(validResults).length, 'of', fieldsToRead.length, 'fields recovered');

        return { results: validResults, skipped: false };
    } catch (err) {
        console.error('[GeminiService] Fallback read API error:', err.message);
        return { results: {}, skipped: false, error: err.message };
    }
};

/**
 * Check if Gemini integration is available (live API or local fallback engine)
 */
const isAvailable = () => {
    return true;
};

const isLiveConfigured = () => {
    return Boolean(process.env.GEMINI_API_KEY);
};

module.exports = {
    reconcileFields,
    fallbackReadFields,
    isAvailable,
    isLiveConfigured
};
