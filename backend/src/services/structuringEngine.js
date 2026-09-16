/**
 * DrishtiScan — Structuring Engine
 * 
 * Central grounded intelligence layer for packaged product Legal Metrology declarations.
 * Replaces per-field ad-hoc regex with a unified, grounded GPT-OSS structuring call
 * across all scan angles, protected by a deterministic Levenshtein grounding gate.
 */

const gptOssService = require('./gptOssService');
const {
    isDateShaped,
    isMarketingBadge,
    isNonProductTitleCandidate,
    isValidQuantityUnit,
    validateFieldFormat,
    sanitizeExtractedText
} = require('./textShapeValidators');

/**
 * 3b. The Legal Metrology packaging structuring system prompt (verbatim).
 */
const STRUCTURING_SYSTEM_PROMPT = `You are a Legal Metrology packaging structuring engine. You receive OCR
evidence extracted from photos of a packaged product — organized by
photo, then by row (a row is a set of text fragments the reconstruction
layer determined are visually aligned on the same horizontal line or
table row), then by cell within that row (left to right).

Your job is to produce a single structured JSON object describing every
field listed below. You are reading fragmented, possibly reordered,
possibly OCR-noisy evidence — some rows may contain a label and its
value together, some may have the value split across cells or across an
adjacent row, and identical information may appear on more than one
photo with varying completeness or clarity.

FIELDS TO PRODUCE:
productName, brandName, genericCommodityName, netQuantity (amount +
unit), mrp (amount + currency), unitSalePrice (amount + unit),
dateOfManufacture, dateOfExpiry, batchNumber, fssaiLicenseNumber,
servingsPerContainer, servingSize, manufacturer (name + address), packer
(name + address), importer (name + address), marketer (name + address),
consumerCarePhone, consumerCareEmail, countryOfOrigin, ingredients (full
text), nutritionFacts (an object with whichever of calories, fat, sugar,
protein, sodium, carbohydrates, fiber are present, each as its own
grounded sub-value).

CRITICAL — GROUNDING, NEVER INVENT A VALUE:
Every value you output must be traceable to actual evidence given to
you. For every field, return:
  - "value": your final answer.
  - "rawObservedText": the literal text of the evidence you based this
    on, exactly as given to you, before any correction.
  - "correctionApplied": true only if "value" differs from
    "rawObservedText".
  - "correctionReason": one of "cross_reference_match",
    "character_confusion_fix", "row_concatenation", "generic_classification",
    or null if no correction was applied. Do not use any other reason string.
  - "groundingRefs": an array of {"photoId", "rowId"} pairs identifying
    every row your value/correction is based on.
  - "confidence": 0.0-1.0.
If a field has no supporting evidence anywhere in the input, return
"value": null with an empty "groundingRefs" — never guess, never
substitute a plausible but unevidenced answer.

CORRECTION VS INVENTION — READ THIS CAREFULLY:
You MAY correct a value when:
  (a) "cross_reference_match" — a fragment appears incomplete or garbled
      in one row, and a more complete or clearer version of the SAME
      text appears in a different row or photo (cite BOTH rows in
      groundingRefs). Example: one row reads "AMU" and a different row
      elsewhere reads "AMUL" or "AMUL DAIRY" or contains "amul" as part
      of a website/email — you may output "AMUL", citing both rows.
  (b) "character_confusion_fix" — a single character is a well-known OCR
      confusion of another (0/O, 1/I/l, 5/S, 8/B, rn/m) and fixing it
      does not change the word's length or meaning materially.
  (c) "row_concatenation" — a value (e.g. a price, a date, a title) is
      visibly split across adjacent cells/rows and you are joining
      fragments that are already present, not adding new characters
      beyond what joining requires.
  (d) "generic_classification" — for genericCommodityName ONLY, you may
      state the standard common-noun category of the product (e.g.
      "Whey Protein Supplement") even if that exact phrase is not
      printed anywhere, based on the product's other identity evidence.
      This is the ONLY field where this kind of inference is allowed.
You must NEVER invent a value that is not a minor, evidenced correction
of the kind above. Example of what is FORBIDDEN: evidence shows only
"AMU" with no corroborating fuller mention anywhere in any photo, and
you output "Sunrise" or any other brand name — this is strictly
forbidden even if such a brand is common or plausible for this product
category. When you cannot find corroborating evidence for completing a
fragment, return the fragment itself as "value" with
"correctionApplied": false, or return null — never substitute a
different, unevidenced name.

OTHER EXCLUSION RULES:
- Never select packaging-handling directives (cut/tear/open/peel/press/
  twist/fold/snip + here/along/dotted line/to open/tab), marketing
  slogans, or URLs as productName, brandName, or genericCommodityName.
- Never select dosage quantities, prices, dates, or batch/lot numbers as
  productName or brandName.
- Statutory numeric/date fields (netQuantity, mrp, unitSalePrice, dates,
  batchNumber, fssaiLicenseNumber, servingsPerContainer, servingSize)
  must never use "generic_classification" as a correction reason —
  reason (d) is reserved for genericCommodityName only.

Respond with a single JSON object only, no prose.`;

/**
 * 3a. Row-based context builder.
 * Consumes groupIntoRows output per photo and builds a compact row structure.
 */
const buildRowContext = (photoRowsList = []) => {
    return photoRowsList.map(({ photoId, rows }) => ({
        photoId,
        rows: (rows || []).map((row, rowId) => {
            const cells = Array.isArray(row.cells)
                ? row.cells
                : (Array.isArray(row.elements) && row.elements.length > 0)
                    ? row.elements.map(el => ({
                        text: el.text || '',
                        confidence: Math.round((el.confidence || 0.8) * 100) / 100
                    }))
                    : (row.text ? [{ text: row.text, confidence: 0.9 }] : []);

            return {
                rowId,
                cells,
                normalizedBbox: row.normalizedBbox || (Array.isArray(row.elements?.[0]?.bbox) ? [row.minX, row.minY, row.maxX, row.maxY] : [])
            };
        })
    }));
};

/**
 * Standard Levenshtein distance
 */
const levenshtein = (a, b) => {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
        }
    }
    return dp[m][n];
};

const normalizedEditDistance = (a, b) => {
    if (!a && !b) return 0;
    const maxLen = Math.max(a.length, b.length, 1);
    return levenshtein(a.toLowerCase(), b.toLowerCase()) / maxLen;
};

/**
 * Safely stringify complex values (e.g. { amount, unit }, { name, address })
 * for text distance comparisons.
 */
const stringifyValue = (val) => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') {
        if (val.amount !== undefined) {
            return `${val.amount} ${val.unit || val.currency || ''}`.trim();
        }
        if (val.value !== undefined) {
            return `${val.value} ${val.unit || val.currency || ''}`.trim();
        }
        if (val.name !== undefined) {
            return `${val.name} ${val.address || ''}`.trim();
        }
        return Object.values(val).map(v => typeof v === 'object' ? stringifyValue(v) : String(v)).join(' ');
    }
    return String(val).trim();
};

/**
 * 3c. Deterministic grounding validator (no LLM — safety gate).
 * 
 * @param {string} fieldName - Canonical field key
 * @param {Object} decision - LLM decision object
 * @param {Map<string, string>} rowLookup - Map from `${photoId}:${rowId}` -> concatenated row text
 * @param {string} tier - 'strict' | 'verbatim' | 'generic_inferred' | 'descriptive'
 */
const validateGrounding = (fieldName, decision, rowLookup, tier = 'strict') => {
    if (!decision || decision.value === null || decision.value === undefined) {
        return { status: 'not_detected', value: null };
    }
    const value = stringifyValue(decision.value);
    if (!value || value.toLowerCase() === 'null') {
        return { status: 'not_detected', value: null };
    }
    const raw = String(decision.rawObservedText || '').trim();
    const refs = Array.isArray(decision.groundingRefs) ? decision.groundingRefs : [];

    if (tier === 'generic_inferred') {
        // genericCommodityName only — no strict char grounding required,
        // but still require it's not empty and not obviously a rejected shape.
        if (isDateShaped(value) || isMarketingBadge(value) || isNonProductTitleCandidate(value)) {
            return { status: 'review', value: decision.value, reason: `Inferred generic commodity matches rejected shape: "${value}"` };
        }
        return { status: value ? 'verified' : 'not_detected', value: decision.value, provenance: 'llm_inferred' };
    }

    if (tier === 'verbatim') {
        // Exclude packaging directives, dates, slogans, and marketing badges from identity fields
        if (isDateShaped(value) || isMarketingBadge(value) || isNonProductTitleCandidate(value)) {
            return { status: 'review', value: decision.value, reason: `Rejected identity candidate shape: "${value}"` };
        }
    }

    if (refs.length === 0) {
        return { status: 'review', value: decision.value, reason: 'No grounding references provided' };
    }

    if (!decision.correctionApplied) {
        // Value must closely match at least one cited row's actual text.
        const matches = refs.some(r => {
            const rowText = rowLookup.get(`${r.photoId}:${r.rowId}`) || '';
            if (rowText.toLowerCase().includes(value.toLowerCase()) || value.toLowerCase().includes(rowText.toLowerCase())) return true;
            const cleanRow = rowText.toLowerCase().replace(/[₹$€£\s,]/g, '');
            const cleanVal = value.toLowerCase().replace(/[₹$€£\s,]/g, '');
            if (cleanRow.includes(cleanVal) || cleanVal.includes(cleanRow)) return true;
            const valDigits = value.replace(/[^0-9]/g, '');
            const rowDigits = rowText.replace(/[^0-9]/g, '');
            if (valDigits.length >= 2 && rowDigits.includes(valDigits)) return true;
            return normalizedEditDistance(value, rowText) <= 0.2;
        });
        if (!matches) {
            return { status: 'review', value: decision.value, reason: 'Uncorrected value does not match its cited row' };
        }

        if (tier === 'strict') {
            const fmtCheck = validateFieldFormat(fieldName, decision.value);
            if (!fmtCheck.valid) {
                return { status: 'review', value: decision.value, reason: `Failed format validation: ${fmtCheck.reason}` };
            }
        }
        return { status: 'verified', value: decision.value, provenance: 'ocr_verbatim' };
    }

    // A correction was applied — check it against its stated reason.
    const dist = normalizedEditDistance(value, raw);

    if (decision.correctionReason === 'character_confusion_fix') {
        if (dist > 0.2) {
            return { status: 'review', value: decision.value, reason: `Correction too large for character_confusion_fix (distance ${dist.toFixed(2)})` };
        }
        if (tier === 'strict') {
            const fmtCheck = validateFieldFormat(fieldName, decision.value);
            if (!fmtCheck.valid) {
                return { status: 'review', value: decision.value, reason: `Failed format validation: ${fmtCheck.reason}` };
            }
        }
        return { status: 'verified', value: decision.value, provenance: 'ocr_corrected' };
    }

    if (decision.correctionReason === 'cross_reference_match') {
        if (refs.length < 2) {
            return { status: 'review', value: decision.value, reason: 'cross_reference_match requires 2+ grounding refs' };
        }
        const corroborated = refs.some(r => {
            const rowText = rowLookup.get(`${r.photoId}:${r.rowId}`) || '';
            return normalizedEditDistance(value, rowText) <= 0.15 || rowText.toLowerCase().includes(value.toLowerCase());
        });
        if (!corroborated) {
            return { status: 'review', value: decision.value, reason: 'No cited row closely matches the corrected value' };
        }
        if (tier === 'strict') {
            const fmtCheck = validateFieldFormat(fieldName, decision.value);
            if (!fmtCheck.valid) {
                return { status: 'review', value: decision.value, reason: `Failed format validation: ${fmtCheck.reason}` };
            }
        }
        return { status: 'verified', value: decision.value, provenance: 'ocr_corrected' };
    }

    if (decision.correctionReason === 'row_concatenation') {
        // The claimed value's characters should be a superset built from the cited rows' text.
        const combined = refs.map(r => rowLookup.get(`${r.photoId}:${r.rowId}`) || '').join('');
        const combinedChars = combined.toLowerCase().replace(/[^a-z0-9]/g, '').split('').sort().join('');
        const valueChars = value.toLowerCase().replace(/[^a-z0-9]/g, '').split('').sort().join('');
        const missing = [...new Set(valueChars)].filter(c => !combinedChars.includes(c));
        if (missing.length > 0) {
            return { status: 'review', value: decision.value, reason: `Concatenation introduces characters not present in cited rows: ${missing.join('')}` };
        }
        if (tier === 'strict') {
            const fmtCheck = validateFieldFormat(fieldName, decision.value);
            if (!fmtCheck.valid) {
                return { status: 'review', value: decision.value, reason: `Failed format validation: ${fmtCheck.reason}` };
            }
        }
        return { status: 'verified', value: decision.value, provenance: 'ocr_corrected' };
    }

    return { status: 'review', value: decision.value, reason: `Unrecognized correctionReason: ${decision.correctionReason}` };
};

/**
 * Field tier assignments based on Step 3c
 */
const FIELD_TIERS = {
    productName: 'verbatim',
    brandName: 'verbatim',
    genericCommodityName: 'generic_inferred',
    netQuantity: 'strict',
    mrp: 'strict',
    unitSalePrice: 'strict',
    dateOfManufacture: 'strict',
    dateOfExpiry: 'strict',
    batchNumber: 'strict',
    fssaiLicenseNumber: 'strict',
    servingsPerContainer: 'strict',
    servingSize: 'strict',
    manufacturer: 'descriptive',
    packer: 'descriptive',
    importer: 'descriptive',
    marketer: 'descriptive',
    consumerCarePhone: 'descriptive',
    consumerCareEmail: 'descriptive',
    countryOfOrigin: 'descriptive',
    ingredients: 'descriptive',
    nutritionFacts: 'descriptive'
};

/**
 * 3d. The main export function.
 * Orchestrates LLM structuring and deterministic grounding validation.
 */
const structureFields = async (photoRowsList = [], deterministicHints = []) => {
    if (!gptOssService.isAvailable()) {
        return { success: false, skipped: true, reason: 'GROQ_API_KEY is not configured' };
    }

    const rowContext = buildRowContext(photoRowsList);
    const totalRows = rowContext.reduce((acc, p) => acc + (Array.isArray(p.rows) ? p.rows.length : 0), 0);
    if (totalRows === 0) {
        return { success: false, reason: 'no_rows' };
    }

    const userPayload = { photos: rowContext, deterministicHints };
    const result = await gptOssService.callGroqJson(STRUCTURING_SYSTEM_PROMPT, userPayload);
    if (!result.success) return result;

    const rowLookup = new Map();
    photoRowsList.forEach(({ photoId, rows }) => {
        (rows || []).forEach((row, rowId) => {
            const text = (row.elements && row.elements.length > 0)
                ? row.elements.map(e => e.text).join(' ')
                : (row.text || '');
            rowLookup.set(`${photoId}:${rowId}`, text);
        });
    });

    const parsedContent = result.content || {};

    // Build the final canonical fields and declarations objects
    const normalizedFields = {
        productName: null,
        brandName: null,
        genericCommodityName: null,
        batchNumber: null,
        fssaiLicenseNumber: null,
        manufacturer: { name: null, address: null },
        packer: { name: null, address: null },
        importer: { name: null, address: null },
        marketer: { name: null, address: null },
        netQuantity: { value: null, unit: null },
        servingsPerContainer: null,
        servingSize: null,
        mrp: { value: null, currency: 'INR', inclusiveOfTaxes: true },
        dates: { manufacture: null, expiry: null, bestBefore: null },
        consumerCare: { name: null, address: null, phone: null, email: null },
        countryOfOrigin: null,
        unitSalePrice: null,
        dimensions: null,
        ingredients: null,
        nutritionFacts: {
            calories: null,
            fat: null,
            sugar: null,
            protein: null,
            sodium: null,
            carbohydrates: null,
            fiber: null
        }
    };

    const declarations = {};
    const validation = {};

    // Validate all 20 fields explicitly
    const allFieldKeys = Object.keys(FIELD_TIERS);
    for (const fieldKey of allFieldKeys) {
        const tier = FIELD_TIERS[fieldKey];
        const decision = parsedContent[fieldKey] || { value: null };

        // Handle nested nutritionFacts sub-values or flat object
        if (fieldKey === 'nutritionFacts' && decision.value && typeof decision.value === 'object') {
            const subFacts = decision.value;
            const validNutrition = {};
            for (const [nutrKey, nutrVal] of Object.entries(subFacts)) {
                if (nutrVal !== null && nutrVal !== undefined) {
                    validNutrition[nutrKey] = typeof nutrVal === 'object' ? nutrVal.value : nutrVal;
                }
            }
            normalizedFields.nutritionFacts = validNutrition;
            declarations.nutritionFacts = {
                value: validNutrition,
                rawText: decision.rawObservedText || null,
                confidence: typeof decision.confidence === 'number' ? decision.confidence : 0.85,
                status: Object.keys(validNutrition).length > 0 ? 'verified' : 'not_detected',
                provenance: 'gpt_oss',
                source: 'gpt_oss_structuring'
            };
            continue;
        }

        const grounded = validateGrounding(fieldKey, decision, rowLookup, tier);

        declarations[fieldKey] = {
            value: grounded.value,
            rawText: decision.rawObservedText ? sanitizeExtractedText(decision.rawObservedText) : null,
            confidence: typeof decision.confidence === 'number' ? decision.confidence : 0.85,
            status: grounded.status,
            provenance: grounded.provenance || 'gpt_oss',
            correctionApplied: Boolean(decision.correctionApplied),
            correctionReason: decision.correctionReason || null,
            groundingRefs: decision.groundingRefs || [],
            source: 'gpt_oss_structuring',
            aiAssisted: true,
            reason: grounded.reason || null
        };

        validation[fieldKey] = {
            status: grounded.status,
            reason: grounded.reason || (grounded.status === 'verified' ? 'Verified with OCR evidence' : 'Not detected')
        };

        const acceptedVal = grounded.status === 'verified' ? grounded.value : null;

        // Map into canonical normalizedFields shape
        switch (fieldKey) {
            case 'productName':
                normalizedFields.productName = sanitizeExtractedText(acceptedVal);
                break;
            case 'brandName':
                normalizedFields.brandName = sanitizeExtractedText(acceptedVal);
                break;
            case 'genericCommodityName':
                normalizedFields.genericCommodityName = sanitizeExtractedText(acceptedVal);
                break;
            case 'batchNumber':
                if (acceptedVal) {
                    const cleanedBatch = String(acceptedVal).replace(/^(?:batch(?:\s*no\.?)?|lot(?:\s*no\.?)?|b\.?\s*no\.?)[:\s-]*/i, '').trim();
                    normalizedFields.batchNumber = sanitizeExtractedText(cleanedBatch || acceptedVal);
                }
                break;
            case 'fssaiLicenseNumber':
                if (acceptedVal) {
                    const cleanedFssai = String(acceptedVal).replace(/^(?:fssai(?:\s*lic(?:\s*no\.?)?)?|lic(?:\s*no\.?)?)[:\s-]*/i, '').trim();
                    normalizedFields.fssaiLicenseNumber = sanitizeExtractedText(cleanedFssai || acceptedVal);
                }
                break;
            case 'countryOfOrigin':
                normalizedFields.countryOfOrigin = sanitizeExtractedText(acceptedVal);
                break;
            case 'unitSalePrice':
                if (acceptedVal && typeof acceptedVal === 'object') {
                    normalizedFields.unitSalePrice = `${acceptedVal.amount || acceptedVal.value} ${acceptedVal.unit || ''}`.trim();
                } else {
                    normalizedFields.unitSalePrice = sanitizeExtractedText(acceptedVal);
                }
                break;
            case 'servingsPerContainer':
                normalizedFields.servingsPerContainer = acceptedVal ? parseFloat(acceptedVal) : null;
                break;
            case 'servingSize':
                normalizedFields.servingSize = sanitizeExtractedText(acceptedVal);
                break;
            case 'ingredients':
                normalizedFields.ingredients = sanitizeExtractedText(acceptedVal);
                break;
            case 'netQuantity':
                if (acceptedVal && typeof acceptedVal === 'object') {
                    normalizedFields.netQuantity = {
                        value: parseFloat(acceptedVal.amount || acceptedVal.value) || null,
                        unit: sanitizeExtractedText(acceptedVal.unit)
                    };
                } else if (acceptedVal) {
                    const match = String(acceptedVal).match(/(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/);
                    if (match) {
                        normalizedFields.netQuantity = {
                            value: parseFloat(match[1]),
                            unit: match[2].toLowerCase()
                        };
                    }
                }
                break;
            case 'mrp':
                if (acceptedVal && typeof acceptedVal === 'object') {
                    const num = parseFloat(acceptedVal.amount || acceptedVal.value);
                    normalizedFields.mrp = {
                        value: !isNaN(num) ? num : null,
                        currency: acceptedVal.currency || 'INR',
                        inclusiveOfTaxes: true
                    };
                } else if (acceptedVal) {
                    const m = String(acceptedVal).match(/\d+(?:\.\d+)?/);
                    const num = m ? parseFloat(m[0]) : NaN;
                    if (!isNaN(num)) {
                        normalizedFields.mrp = {
                            value: num,
                            currency: 'INR',
                            inclusiveOfTaxes: true
                        };
                    }
                }
                break;
            case 'dateOfManufacture':
                if (acceptedVal) {
                    const cleanedMfg = String(acceptedVal).replace(/^(?:mfg|pkd|packed|pkg|manufacture[d]?)[:\s-]*/i, '').trim();
                    normalizedFields.dates.manufacture = sanitizeExtractedText(cleanedMfg || acceptedVal);
                }
                declarations.manufacturingDate = { ...declarations[fieldKey] };
                break;
            case 'dateOfExpiry':
                if (acceptedVal) {
                    const cleanedExp = String(acceptedVal).replace(/^(?:exp|expiry|use\s*by|best\s*before)[:\s-]*/i, '').trim();
                    normalizedFields.dates.expiry = sanitizeExtractedText(cleanedExp || acceptedVal);
                }
                declarations.expiryDate = { ...declarations[fieldKey] };
                break;
            case 'manufacturer':
                if (acceptedVal && typeof acceptedVal === 'object') {
                    normalizedFields.manufacturer = {
                        name: sanitizeExtractedText(acceptedVal.name),
                        address: sanitizeExtractedText(acceptedVal.address)
                    };
                } else {
                    normalizedFields.manufacturer.name = sanitizeExtractedText(acceptedVal);
                }
                break;
            case 'packer':
                if (acceptedVal && typeof acceptedVal === 'object') {
                    normalizedFields.packer = {
                        name: sanitizeExtractedText(acceptedVal.name),
                        address: sanitizeExtractedText(acceptedVal.address)
                    };
                } else {
                    normalizedFields.packer.name = sanitizeExtractedText(acceptedVal);
                }
                break;
            case 'importer':
                if (acceptedVal && typeof acceptedVal === 'object') {
                    normalizedFields.importer = {
                        name: sanitizeExtractedText(acceptedVal.name),
                        address: sanitizeExtractedText(acceptedVal.address)
                    };
                } else {
                    normalizedFields.importer.name = sanitizeExtractedText(acceptedVal);
                }
                break;
            case 'marketer':
                if (acceptedVal && typeof acceptedVal === 'object') {
                    normalizedFields.marketer = {
                        name: sanitizeExtractedText(acceptedVal.name),
                        address: sanitizeExtractedText(acceptedVal.address)
                    };
                } else {
                    normalizedFields.marketer.name = sanitizeExtractedText(acceptedVal);
                }
                break;
            case 'consumerCarePhone':
                normalizedFields.consumerCare.phone = sanitizeExtractedText(acceptedVal);
                break;
            case 'consumerCareEmail':
                normalizedFields.consumerCare.email = sanitizeExtractedText(acceptedVal);
                break;
            default:
                break;
        }
    }

    // Set compound consumerCare declaration
    declarations.consumerCare = {
        value: normalizedFields.consumerCare,
        status: (normalizedFields.consumerCare.phone || normalizedFields.consumerCare.email) ? 'verified' : 'not_detected',
        source: 'gpt_oss_structuring'
    };

    return {
        success: true,
        normalizedFields,
        declarations,
        validation,
        rawResult: parsedContent,
        latencyMs: result.latencyMs,
        usage: result.usage
    };
};

module.exports = {
    STRUCTURING_SYSTEM_PROMPT,
    FIELD_TIERS,
    buildRowContext,
    levenshtein,
    normalizedEditDistance,
    validateGrounding,
    structureFields
};
