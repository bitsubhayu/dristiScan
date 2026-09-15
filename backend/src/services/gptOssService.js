/**
 * DrishtiScan — GPT-OSS 120B Integration Service (Groq API)
 * 
 * Downstream semantic arbitration layer for packaged product identity fields:
 * - productName
 * - brandName
 * - genericCommodityName
 * 
 * PaddleOCR performs 100% of OCR text detection. Raw images are NEVER sent to Groq.
 * GPT-OSS 120B receives structured OCR tokens, bounding-box geometry, and deterministic
 * candidate evidence to resolve genuine semantic ambiguity across package angles.
 * 
 * Statutory declarations (MRP, Net Quantity, Dates, Batch Number, etc.) remain
 * strictly deterministic and are never modified by the LLM.
 */

const axios = require('axios');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_TIMEOUT_MS = parseInt(process.env.GROQ_TIMEOUT_MS || '12000', 10);

/**
 * Check if Groq API key is configured and available in environment.
 * @returns {boolean}
 */
const isAvailable = () => {
    return Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 0);
};

/**
 * System prompt establishing strict Legal Metrology identity ontology and anti-hallucination rules.
 * Contains ZERO product-specific or brand-specific examples.
 */
const SYSTEM_PROMPT = `You are an expert Legal Metrology product identity arbitrator.
You analyze OCR text tokens extracted from physical product packaging photos to resolve identity declarations.

UNDER LEGAL METROLOGY AND CONSUMER PACKAGING STANDARDS, THERE ARE THREE SEPARATE IDENTITY DECLARATIONS:

1. "brandName":
   - The trade name, brand mark, or manufacturer house mark under which the product line is sold.
   - Typically displayed prominently in large display typography or logos on the front panel, or in corporate responsible-party declarations ("Manufactured by...").
   - This is the brand identity, NOT the specific product variant name.

2. "productName":
   - The specific commercial marketing title or variant name of the packaged item.
   - Denotes the exact offering (e.g. flavor, formulation, or variant descriptor).
   - This is the commercial product title, NOT the company/brand name, and NOT the generic commodity name.

3. "genericCommodityName":
   - The standard generic or common descriptive name of the commodity as mandated by consumer protection and packaging regulations (what the product IS generically).
   - Must be the common noun classification of the good, separate from promotional or brand naming.

CRITICAL EXCLUSION AND SAFETY RULES:
- NEVER fabricate, invent, or hallucinate a value. Every returned string MUST be grounded in the provided OCR evidence.
- If OCR evidence is insufficient, occluded, or absent for a field, return null for that field. Never guess or substitute nearby unrelated text.
- Marketing slogans, promotional directives, and calls-to-action (e.g. sharing slogans, recycling notices, website links, social media handles) must NEVER be selected as productName, brandName, or genericCommodityName.
- Dosage quantities, net weights, piece counts, volume measurements (e.g. grams, milliliters, milligrams, capsule counts) must NEVER appear as productName or brandName.
- Prices, tax statements (MRP, Rs., inclusive of taxes) must NEVER appear in any identity field.
- Calendar dates, timestamps, batch numbers, lot numbers must NEVER appear in any identity field.
- Nutrition facts table rows (e.g. Energy, Protein, Fat, Carbohydrates, Sodium, RDA percentages) must NEVER appear in any identity field.
- Ingredient list excipients, chemical additives, and INS numbers must NEVER appear as productName or brandName.

OUTPUT FORMAT:
Respond with a strict JSON object conforming exactly to this structure:
{
  "productName": {
    "value": "exact product variant name or null",
    "confidence": 0.0 to 1.0,
    "sourceCandidate": "exact text from OCR evidence or null",
    "reason": "concise explanation of spatial/semantic evidence"
  },
  "brandName": {
    "value": "exact brand name or null",
    "confidence": 0.0 to 1.0,
    "sourceCandidate": "exact text from OCR evidence or null",
    "reason": "concise explanation of spatial/semantic evidence"
  },
  "genericCommodityName": {
    "value": "generic commodity description or null",
    "confidence": 0.0 to 1.0,
    "sourceCandidate": "exact text from OCR evidence or null",
    "reason": "concise explanation of spatial/semantic evidence"
  }
}`;

/**
 * Filter OCR context to keep payload compact and focused.
 * Omits tabular nutrition rows, pure barcode numbers, and fine-print legal disclaimers.
 */
const buildCompactOcrContext = (ocrTokens = [], maxTokens = 30) => {
    if (!Array.isArray(ocrTokens)) return [];
    
    return ocrTokens
        .filter(t => {
            if (!t || !t.text) return false;
            const s = t.text.trim();
            if (s.length < 2) return false;
            // Exclude pure numbers, barcodes, timestamps
            if (/^\d+(?:\.\d+)?$/.test(s) || /^\d{10,14}$/.test(s)) return false;
            // Exclude pure nutrition table percentage rows
            if (/^\d+(?:\.\d+)?\s*(?:%|kcal|mg|g)\b/i.test(s)) return false;
            return true;
        })
        .slice(0, maxTokens)
        .map(t => ({
            text: t.text.trim(),
            confidence: typeof t.confidence === 'number' ? Math.round(t.confidence * 100) / 100 : 0.8,
            normalizedBbox: Array.isArray(t.bbox) && t.bbox.length >= 4 ? t.bbox : []
            // ^ These are 0–1 fractions of that token's own source photo dimensions,
            //   pre-normalized in extractFields using imageWidth/imageHeight from OCR.
        }));
};

/**
 * Grounding verification: confirms that a proposed value is physically grounded in OCR text.
 * Prevents hallucinations.
 */
const isGroundedInOcr = (val, ocrTokens = []) => {
    if (!val || typeof val !== 'string') return false;
    const vLower = val.toLowerCase().trim();
    if (vLower.length === 0) return false;
    
    // Check if value or its major words appear in any OCR token
    const words = vLower.split(/\s+/).filter(w => w.length > 2);
    return ocrTokens.some(t => {
        const tLower = (t.text || '').toLowerCase();
        if (tLower.includes(vLower) || vLower.includes(tLower)) return true;
        if (words.length > 0 && words.every(w => tLower.includes(w))) return true;
        return false;
    });
};

/**
 * Perform semantic identity field resolution via Groq API (openai/gpt-oss-120b).
 * 
 * @param {Object} options
 * @param {Array<string>} options.unresolvedFields - e.g. ['productName', 'brandName', 'genericCommodityName']
 * @param {Array<Object>} options.deterministicCandidates - Pre-scored candidates from deterministic phase
 * @param {Array<Object>} options.rawOcrTokens - OCR tokens across photos
 * @param {Object} options.imageMeta - Image width/height metadata
 * @returns {Promise<Object>} Reconciled field decisions or failure record
 */
const resolveIdentityFields = async ({
    unresolvedFields = ['productName', 'brandName', 'genericCommodityName'],
    deterministicCandidates = [],
    rawOcrTokens = [],
    imageMeta = {}
}, retryCount = 0) => {
    if (!isAvailable()) {
        return {
            success: false,
            skipped: true,
            reason: 'GROQ_API_KEY is not configured in backend environment'
        };
    }

    const fieldsToResolve = unresolvedFields.filter(f => 
        ['productName', 'brandName', 'genericCommodityName'].includes(f)
    );

    if (fieldsToResolve.length === 0) {
        return {
            success: false,
            skipped: true,
            reason: 'No identity fields require arbitration'
        };
    }

    const compactContext = buildCompactOcrContext(rawOcrTokens, 35);
    
    const userPayload = {
        unresolvedFields: fieldsToResolve,
        imageMetadata: {
            width: imageMeta.width || 1000,
            height: imageMeta.height || 1000
        },
        deterministicCandidates: (deterministicCandidates || []).map(c => ({
            field: c.field,
            text: c.text,
            confidence: c.confidence,
            fontHeightRatio: c.fontHeightRatio || 1.0,
            score: c.score || 0
        })),
        ocrContextTokens: compactContext,
        negativeConstraints: [
            "Do not select nutrition table facts, ingredients, or RDA percentages",
            "Do not select dates, timestamps, batch codes, or MRP prices",
            "Do not select packaging directives, slogans, or URLs",
            "If evidence is insufficient or absent for any field, return null (never fabricate)"
        ]
    };

    try {
        const startTime = Date.now();
        const response = await axios.post(
            GROQ_API_URL,
            {
                model: GROQ_MODEL,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: JSON.stringify(userPayload) }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.1,
                max_tokens: 2048
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: GROQ_TIMEOUT_MS
            }
        );

        const latencyMs = Date.now() - startTime;
        const rawContent = response.data?.choices?.[0]?.message?.content;
        if (!rawContent) {
            return {
                success: false,
                reason: 'Empty response received from Groq API',
                latencyMs
            };
        }

        let parsedOutput = null;
        try {
            parsedOutput = JSON.parse(rawContent);
        } catch (parseErr) {
            console.warn('[GptOssService] Failed to parse JSON from Groq response:', parseErr.message);
            return {
                success: false,
                reason: `Malformed JSON response: ${parseErr.message}`,
                latencyMs
            };
        }

        // Post-validation & Anti-Hallucination verification
        const validatedDecisions = {};
        for (const field of fieldsToResolve) {
            const decision = parsedOutput[field];
            if (!decision || decision.value === null || decision.value === undefined) {
                validatedDecisions[field] = null;
                continue;
            }

            const valStr = String(decision.value).trim();
            if (valStr.length === 0 || valStr.toLowerCase() === 'null') {
                validatedDecisions[field] = null;
                continue;
            }

            // Verify grounding against OCR tokens (except genericCommodityName which can be inferred from commodity nouns)
            if (field !== 'genericCommodityName' && !isGroundedInOcr(valStr, rawOcrTokens)) {
                console.warn(`[GptOssService] Anti-hallucination check rejected ungrounded ${field}: "${valStr}"`);
                validatedDecisions[field] = null;
                continue;
            }

            // Verify negative constraints: must not look like date, price, unit, or badge
            if (/\b\d{1,2}[/-]\d{2,4}\b/.test(valStr) || /[₹$€£]/.test(valStr) || /^\d+\s*(?:mg|g|ml|kg)\b/i.test(valStr)) {
                console.warn(`[GptOssService] Negative constraint rejected invalid ${field}: "${valStr}"`);
                validatedDecisions[field] = null;
                continue;
            }

            // Packaging-handling directives must never be selected as identity fields
            if (/\b(?:cut|tear|open|peel|pull|press|push|twist|fold|snip)\b.{0,20}\b(?:here|along|dotted\s*line|to\s*open|tab)\b/i.test(valStr)) {
                console.warn(`[GptOssService] Negative constraint rejected packaging directive ${field}: "${valStr}"`);
                validatedDecisions[field] = null;
                continue;
            }

            validatedDecisions[field] = {
                value: valStr,
                confidence: typeof decision.confidence === 'number' ? decision.confidence : 0.85,
                sourceCandidate: decision.sourceCandidate || valStr,
                reason: decision.reason || 'Semantic arbitration via GPT-OSS 120B'
            };
        }

        return {
            success: true,
            model: GROQ_MODEL,
            latencyMs,
            decisions: validatedDecisions,
            usage: response.data.usage || {}
        };

    } catch (err) {
        if (err.response?.status === 429 && retryCount < 1) {
            let waitMs = 3000;
            const msg = err.response?.data?.error?.message || '';
            const match = msg.match(/try again in ([\d\.]+)s/i);
            if (match) {
                waitMs = Math.ceil(parseFloat(match[1]) * 1000) + 400;
            }
            if (waitMs <= 8500) {
                console.log(`[GptOssService] Rate limit (429) reached. Waiting ${waitMs}ms before retry...`);
                await new Promise(r => setTimeout(r, waitMs));
                return resolveIdentityFields({ unresolvedFields, deterministicCandidates, rawOcrTokens, imageMeta }, retryCount + 1);
            }
        }

        const errorDetail = err.response ? JSON.stringify(err.response.data) : err.message;
        console.warn(`[GptOssService] Groq API call failed (${err.code || 'HTTP_ERROR'}): ${errorDetail}`);
        return {
            success: false,
            error: err.message,
            statusCode: err.response?.status || 500,
            rateLimited: err.response?.status === 429,
            detail: errorDetail
        };
    }
};

module.exports = {
    isAvailable,
    resolveIdentityFields,
    buildCompactOcrContext,
    isGroundedInOcr,
    GROQ_MODEL
};
