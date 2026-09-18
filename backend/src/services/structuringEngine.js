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
    sanitizeExtractedText,
    isGenericCommodityTerm,
    isExplicitCountryDeclaration,
    extractExplicitCountryFromDeclaration,
    KNOWN_COUNTRIES
} = require('./textShapeValidators');

/**
 * 3b. The Legal Metrology packaging structuring system prompt.
 */
const STRUCTURING_SYSTEM_PROMPT = `You are a Legal Metrology packaging structuring engine. You receive OCR
evidence extracted from photos of a packaged product — organized by
photo, then by row (a row is a set of text fragments the reconstruction
layer determined are visually aligned on the same horizontal line or
table row), then by cell within that row (left to right).

Each visual row contains:
- "rowId": stable integer identifying the visual row.
- "cells": array of word cells with text, confidence, and normalized bounding box [minX, minY, maxX, maxY].
- "normalizedBbox": overall row bounding box.
- "sourceRefs": array of {"photoId", "rowId"} pairs identifying all original OCR rows supporting that canonical evidence across photo angles.

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
    every row your value/correction is based on. When a value is supported
    by multiple photos (as indicated in sourceRefs or across photos), cite
    all relevant {"photoId", "rowId"} references. Do not invent references.
    Do not cite a row that does not contain the evidence.
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
  (c) "row_concatenation" — a value (e.g. a price, a date, a title, an
      ingredient declaration) is visibly split across adjacent cells/rows
      and you are joining fragments that are already present, not adding
      new characters beyond what joining requires.
  (d) "generic_classification" — for genericCommodityName ONLY, you may
      state the standard common-noun category of the product (e.g.
      "Whey Protein Supplement") even if that exact phrase is not
      printed anywhere, based on the product's other identity evidence.
      This is the ONLY field where this kind of inference is allowed.
You must NEVER invent a value that is not a minor, evidenced correction
of the kind above. When you cannot find corroborating evidence for completing a
fragment, return the fragment itself as "value" with
"correctionApplied": false, or return null — never substitute a
different, unevidenced name.

BRAND NAME VS GENERIC COMMODITY SEPARATION:
- brandName is the proprietary trade name or umbrella brand of the product.
- genericCommodityName is the common-noun category of the good (e.g. "Whey Protein Supplement", "Edible Vegetable Oil", "Biscuit").
- A generic commodity noun or category descriptor (such as "protein", "whey", "milk", "juice", "oil", "flour", "soap", "shampoo", "rice", "dal", "tea", "coffee", "biscuit", "water") must NEVER be output as brandName, even if printed in large bold text, all-caps, or repeatedly across photos.
- If no distinct proprietary brand name is visible in the evidence, you MUST output "value": null for brandName. Never convert a generic commodity into a brand name.

COUNTRY OF ORIGIN RULES:
- countryOfOrigin must be extracted from explicit manufacturing/origin declarations such as "Country of Origin", "Made in", "Manufactured in", "Country of Manufacture", "Country Manufactured In", "Product of", "Origin:".
- "Made in X" / "Manufactured in X" / "Country of Origin: X" are valid evidence.
- A country mentioned only inside an unrelated corporate address is NOT automatically a country-of-origin declaration.
- A country mentioned only inside a URL or email (e.g. .in, .uk) must NEVER be treated as country of origin.
- A country may be accepted when corroborated across photos. Never invent a country.

INGREDIENT DECLARATION RULES:
- Look for explicit ingredient headings: "Ingredients", "Ingredients:", "Ingredient", and OCR variants.
- Support ingredient declarations spanning multiple rows. Join adjacent rows when they clearly form one continuous ingredient declaration using "row_concatenation" and cite all contributing rows in groundingRefs.
- Preserve the actual observed ingredient text as faithfully as possible.
- Do NOT confuse or merge ingredients with the nutrition facts table, storage instructions, dosage/directions, marketing claims, manufacturing address, or customer care.
- Never invent missing ingredients. If only part of the declaration is visible, return only supported evidence.
- Ground the ingredient declaration to every relevant row used.

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
 * Preserves lightweight normalized cell bounding boxes [minX, minY, maxX, maxY].
 */
const buildRowContext = (photoRowsList = []) => {
    return photoRowsList.map(({ photoId, rows }) => ({
        photoId,
        rows: (rows || []).map((row, rowIndex) => {
            const stableRowId = row.rowId !== undefined ? row.rowId : rowIndex;
            const rawCells = Array.isArray(row.cells)
                ? row.cells
                : (Array.isArray(row.elements) && row.elements.length > 0)
                    ? row.elements
                    : (row.text ? [{ text: row.text, confidence: 0.9 }] : []);

            const cells = rawCells.map(el => {
                const cell = {
                    text: (el.text || '').trim(),
                    confidence: typeof el.confidence === 'number' ? Math.round(el.confidence * 100) / 100 : 0.8
                };
                const bbox = el.normalizedBbox || el.bbox;
                if (Array.isArray(bbox) && bbox.length >= 4) {
                    if (typeof bbox[0] === 'number') {
                        cell.normalizedBbox = bbox.map(v => Math.round(v * 1000) / 1000);
                    } else if (Array.isArray(bbox[0])) {
                        const xs = bbox.map(p => p[0]);
                        const ys = bbox.map(p => p[1]);
                        cell.normalizedBbox = [
                            Math.round(Math.min(...xs) * 1000) / 1000,
                            Math.round(Math.min(...ys) * 1000) / 1000,
                            Math.round(Math.max(...xs) * 1000) / 1000,
                            Math.round(Math.max(...ys) * 1000) / 1000
                        ];
                    }
                }
                return cell;
            });

            const rowBbox = row.normalizedBbox || (Array.isArray(row.elements?.[0]?.bbox) ? [row.minX, row.minY, row.maxX, row.maxY] : []);

            const sourceRefs = Array.isArray(row.sourceRefs) && row.sourceRefs.length > 0
                ? row.sourceRefs
                : [{ photoId, rowId: stableRowId }];

            return {
                rowId: stableRowId,
                cells,
                normalizedBbox: Array.isArray(rowBbox) ? rowBbox : [],
                sourceRefs
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
 * Normalizes text into clean lowercase linguistic/numeric tokens.
 */
const normalizeEvidenceTokens = (text = '') =>
    String(text)
        .toLowerCase()
        .replace(/ingredients?\s*[:.-]?/gi, ' ')
        .replace(/[^\p{L}\p{N}%]+/gu, ' ')
        .split(/\s+/)
        .filter(Boolean);

/**
 * Validates that proposed tokens are grounded in cited evidence rows
 * using token multiplicity containment and ordered subsequence checks.
 */
const isTokenSequenceGrounded = (value, evidenceTexts = []) => {
    const valTokens = normalizeEvidenceTokens(value);
    if (valTokens.length === 0) {
        return { valid: false, reason: 'Empty token sequence' };
    }

    const combinedEvidence = evidenceTexts.join(' ');
    const evidenceTokens = normalizeEvidenceTokens(combinedEvidence);
    if (evidenceTokens.length === 0) {
        return { valid: false, reason: 'No evidence tokens found in cited rows' };
    }

    // 1. Token Multiplicity Containment (Frequency Map)
    const evidenceFreq = new Map();
    for (const tok of evidenceTokens) {
        evidenceFreq.set(tok, (evidenceFreq.get(tok) || 0) + 1);
    }

    const missingTokens = [];
    for (const tok of valTokens) {
        const count = evidenceFreq.get(tok) || 0;
        if (count <= 0) {
            // Check if it's a minor OCR variant of an evidence token
            const hasSimilar = evidenceTokens.some(eTok => {
                if (Math.abs(eTok.length - tok.length) > 2) return false;
                return levenshtein(eTok, tok) <= 1;
            });
            if (!hasSimilar) {
                missingTokens.push(tok);
            }
        } else {
            evidenceFreq.set(tok, count - 1);
        }
    }

    if (missingTokens.length > 0) {
        return {
            valid: false,
            reason: `Proposed text contains tokens not present in cited rows: ${missingTokens.slice(0, 5).join(', ')}`
        };
    }

    // 2. Ordered Subsequence Check
    let evIdx = 0;
    let inOrderMatches = 0;
    for (const vTok of valTokens) {
        while (evIdx < evidenceTokens.length) {
            const eTok = evidenceTokens[evIdx];
            evIdx++;
            if (eTok === vTok || (Math.abs(eTok.length - vTok.length) <= 1 && levenshtein(eTok, vTok) <= 1)) {
                inOrderMatches++;
                break;
            }
        }
    }

    const orderRatio = inOrderMatches / valTokens.length;
    if (orderRatio < 0.70) {
        return {
            valid: false,
            reason: `Proposed text violates the token order of cited rows (${Math.round(orderRatio * 100)}% ordered)`
        };
    }

    return { valid: true };
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

    // Generic Commodity vs Brand Identity Separation
    if (fieldName === 'brandName') {
        if (isGenericCommodityTerm(value)) {
            return { status: 'review', value: null, reason: `Generic category/commodity descriptor cannot be brandName: "${value}"` };
        }
    }

    // Explicit Country of Origin Validation
    if (fieldName === 'countryOfOrigin') {
        const explicitCountries = refs
            .map(ref => rowLookup.get(`${ref.photoId}:${ref.rowId}`) || '')
            .map(extractExplicitCountryFromDeclaration)
            .filter(Boolean);

        if (explicitCountries.length === 0) {
            return {
                status: 'review',
                value: decision.value,
                reason: 'Country of origin requires explicit manufacturing/origin declaration evidence'
            };
        }

        const candidate = String(value).trim().toLowerCase();
        const candidateMapped = candidate === 'usa' ? 'united states' : candidate;

        const matched = explicitCountries.some(country => {
            const normC = country.toLowerCase();
            const normCMapped = normC === 'usa' ? 'united states' : normC;
            return normCMapped === candidateMapped || normCMapped === candidate;
        });

        if (!matched) {
            return {
                status: 'review',
                value: decision.value,
                reason: 'Proposed country does not match explicit origin/manufacturing declaration'
            };
        }

        const countryCheck = validateFieldFormat('countryOfOrigin', value);
        if (!countryCheck.valid) {
            return { status: 'review', value: decision.value, reason: countryCheck.reason };
        }
        return { status: 'verified', value: countryCheck.value, provenance: decision.correctionApplied ? 'ocr_corrected' : 'ocr_verbatim' };
    }

    // Ingredients Safety Validation
    if (fieldName === 'ingredients') {
        const lowerVal = value.toLowerCase();
        if (/^(?:nutrition\s*(?:information|facts)?|nutritional\s*information|supplement\s*facts)\b/i.test(lowerVal) ||
            /^(?:energy\s*[:.-]?\s*\d|total\s*fat\s*[:.-]?\s*\d|cholesterol\s*[:.-]?\s*\d)/i.test(lowerVal)) {
            return { status: 'review', value: decision.value, reason: `Nutrition facts panel cited as ingredients: "${value}"` };
        }
        if (/^(?:directions?\s*for\s*use|how\s*to\s*use|storage|store\s*in\s*a\s*cool|keep\s*out\s*of\s*reach)\b/i.test(lowerVal)) {
            return { status: 'review', value: decision.value, reason: `Storage or usage instructions cited as ingredients: "${value}"` };
        }

        const evidenceTexts = refs.map(r => rowLookup.get(`${r.photoId}:${r.rowId}`) || '').filter(Boolean);
        if (evidenceTexts.length === 0) {
            return { status: 'review', value: decision.value, reason: 'No cited row evidence found for ingredients' };
        }

        const tokenCheck = isTokenSequenceGrounded(value, evidenceTexts);
        if (!tokenCheck.valid) {
            return { status: 'review', value: decision.value, reason: tokenCheck.reason };
        }

        return {
            status: 'verified',
            value: decision.value,
            provenance: refs.length > 1 || decision.correctionApplied ? 'ocr_corrected' : 'ocr_verbatim'
        };
    }

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
        // Value must match cited row(s). For multi-row ingredients or descriptions, check collective coverage.
        let matches = false;
        if (refs.length > 1) {
            const combined = refs.map(r => rowLookup.get(`${r.photoId}:${r.rowId}`) || '').join(' ');
            if (combined.toLowerCase().includes(value.toLowerCase()) || value.toLowerCase().includes(combined.toLowerCase()) || normalizedEditDistance(value, combined) <= 0.25) {
                matches = true;
            }
        }
        if (!matches) {
            matches = refs.some(r => {
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
        }
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
        const evidenceTexts = refs.map(r => rowLookup.get(`${r.photoId}:${r.rowId}`) || '').filter(Boolean);
        if (fieldName === 'ingredients') {
            const tokenCheck = isTokenSequenceGrounded(value, evidenceTexts);
            if (!tokenCheck.valid) {
                return { status: 'review', value: decision.value, reason: tokenCheck.reason };
            }
        } else {
            const tokenCheck = isTokenSequenceGrounded(value, evidenceTexts);
            if (!tokenCheck.valid) {
                // Character-level containment fallback for character-split text (e.g. ₹ 7 9 9)
                const combined = evidenceTexts.join('');
                const combinedChars = combined.toLowerCase().replace(/[^a-z0-9]/g, '').split('').sort().join('');
                const valueChars = value.toLowerCase().replace(/[^a-z0-9]/g, '').split('').sort().join('');
                const missing = [...new Set(valueChars)].filter(c => !combinedChars.includes(c));
                if (missing.length > 0) {
                    return { status: 'review', value: decision.value, reason: `Concatenation introduces characters not present in cited rows: ${missing.join('')}` };
                }
            }
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
const structureFields = async (photoRowsList = [], deterministicHints = [], precomputedRowLookup = null) => {
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

    let rowLookup;
    if (precomputedRowLookup instanceof Map) {
        rowLookup = precomputedRowLookup;
    } else {
        rowLookup = new Map();
        photoRowsList.forEach(({ photoId, rows }) => {
            (rows || []).forEach((row, rowIndex) => {
                const stableRowId = row.rowId !== undefined ? row.rowId : rowIndex;
                const text = row.text || (row.elements && row.elements.length > 0
                    ? row.elements.map(e => e.text).join(' ')
                    : '');

                rowLookup.set(`${photoId}:${stableRowId}`, text);

                const refs = Array.isArray(row.sourceRefs) && row.sourceRefs.length > 0
                    ? row.sourceRefs
                    : [{ photoId, rowId: stableRowId }];

                refs.forEach(ref => {
                    rowLookup.set(`${ref.photoId}:${ref.rowId}`, text);
                });
            });
        });
    }

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
        mrp: { value: null, currency: 'INR', inclusiveOfTaxes: null },
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
    const diagnostics = {};

    const FIELD_EVIDENCE_PATTERNS = {
        mrp: /(?:mrp|m\.?\s*r\.?\s*p|max.*retail|rs\.?|₹|\b\d{2,5}\b)/i,
        netQuantity: /(?:net\s*(?:qty|quantity|weight|wt|vol|contents)|\b\d+(?:\.\d+)?\s*(?:g|gm|kg|ml|l|ltr|pcs|pieces|tablets|capsules))\b/i,
        batchNumber: /(?:batch|lot|b\.?\s*no)/i,
        fssaiLicenseNumber: /(?:fssai|lic.*no|\b\d{14}\b)/i,
        countryOfOrigin: /(?:country\s*of\s*origin|country\s*of\s*manufacture|made\s*in|manufactured\s*in|product\s*of|origin)/i,
        dateOfManufacture: /(?:mfg|mfd|pkd|packed|date\s*of\s*mfg)/i,
        dateOfExpiry: /(?:exp|expiry|best\s*before|use\s*by)/i,
        ingredients: /(?:ingredients?|ingredents?)/i,
        consumerCarePhone: /(?:helpline|care|phone|tel|contact|\b\d{10,12}\b)/i,
        consumerCareEmail: /@/,
        unitSalePrice: /(?:usp|unit\s*sale)/i,
        nutritionFacts: /(?:nutrition|energy|protein|fat|carbohydrate)/i,
        manufacturer: /(?:manufactured\s*by|mfd\.?\s*by|mfg\.?\s*by)/i,
        packer: /(?:packed\s*by|pkd\.?\s*by)/i,
        importer: /(?:imported\s*by)/i,
        marketer: /(?:marketed\s*by|mkt\.?\s*by)/i,
        servingsPerContainer: /(?:servings?\s*per\s*container|\bservings?\b)/i,
        servingSize: /(?:serving\s*size)/i
    };

    const allRowTexts = Array.from(rowLookup.values()).join(' ');

    // Validate all 20 fields explicitly
    const allFieldKeys = Object.keys(FIELD_TIERS);
    for (const fieldKey of allFieldKeys) {
        const tier = FIELD_TIERS[fieldKey];
        const decision = parsedContent[fieldKey] || { value: null };

        // Handle nested nutritionFacts sub-values with evidence grounding
        if (fieldKey === 'nutritionFacts' && decision.value && typeof decision.value === 'object') {
            const subFacts = decision.value;
            const validNutrition = {};
            const rejectedNutrition = {};

            // Collect evidence texts from nutrition grounding refs
            const nutritionRefs = Array.isArray(decision.groundingRefs) ? decision.groundingRefs : [];
            const nutritionEvidenceTexts = nutritionRefs
                .map(r => rowLookup.get(`${r.photoId}:${r.rowId}`) || '')
                .filter(Boolean);
            // Also check all row evidence for nutrition-related content
            const allNutritionEvidence = Array.from(rowLookup.values())
                .filter(t => /(?:nutrition|energy|protein|fat|carbohydrate|sugar|sodium|fiber|fibre|calori)/i.test(t));
            const combinedNutritionEvidence = [...nutritionEvidenceTexts, ...allNutritionEvidence]
                .join(' ').toLowerCase();

            for (const [nutrKey, nutrVal] of Object.entries(subFacts)) {
                if (nutrVal === null || nutrVal === undefined) continue;

                const rawValue = typeof nutrVal === 'object' ? nutrVal.value : nutrVal;
                if (rawValue === null || rawValue === undefined) continue;

                // Ground each nutrition sub-value against OCR evidence
                const valStr = String(rawValue).toLowerCase().replace(/[^a-z0-9.%]/g, '');
                const keyStr = nutrKey.toLowerCase();

                // Accept if: (a) the nutrient key appears in evidence, AND
                //             (b) the numeric portion of the value appears near it
                const keyPresent = combinedNutritionEvidence.includes(keyStr) ||
                    (keyStr === 'calories' && /(?:calori|energy|kcal)/i.test(combinedNutritionEvidence)) ||
                    (keyStr === 'fiber' && /(?:fib[re]|fibre)/i.test(combinedNutritionEvidence)) ||
                    (keyStr === 'fat' && /\bfat\b/i.test(combinedNutritionEvidence)) ||
                    (keyStr === 'sodium' && /sodium/i.test(combinedNutritionEvidence));

                const numericPart = String(rawValue).match(/[\d]+(?:\.[\d]+)?/);
                const numericPresent = numericPart
                    ? combinedNutritionEvidence.includes(numericPart[0])
                    : false;

                if (keyPresent && (numericPresent || !numericPart)) {
                    validNutrition[nutrKey] = rawValue;
                } else if (combinedNutritionEvidence.length === 0) {
                    // No nutrition evidence at all — reject everything
                    rejectedNutrition[nutrKey] = { value: rawValue, reason: 'No nutrition evidence in OCR rows' };
                } else {
                    rejectedNutrition[nutrKey] = { value: rawValue, reason: `Nutrient "${nutrKey}" value "${rawValue}" not grounded in OCR evidence` };
                }
            }

            normalizedFields.nutritionFacts = validNutrition;
            const hasAccepted = Object.keys(validNutrition).length > 0;
            const hasRejected = Object.keys(rejectedNutrition).length > 0;
            declarations.nutritionFacts = {
                value: validNutrition,
                rawText: decision.rawObservedText || null,
                confidence: typeof decision.confidence === 'number' ? decision.confidence : 0.85,
                status: hasAccepted ? 'verified' : 'not_detected',
                provenance: 'gpt_oss',
                source: 'gpt_oss_structuring',
                diagnostics: {
                    stage: hasAccepted ? 'value_accepted' : 'ocr_evidence_absent',
                    detail: hasAccepted
                        ? (hasRejected ? `Partially grounded: accepted ${Object.keys(validNutrition).join(', ')}; rejected ${Object.keys(rejectedNutrition).join(', ')}` : 'All nutrition values grounded against OCR evidence')
                        : 'No nutrition values could be grounded against OCR evidence',
                    rejectedValues: hasRejected ? rejectedNutrition : undefined
                }
            };
            diagnostics.nutritionFacts = declarations.nutritionFacts.diagnostics;
            continue;
        }

        const grounded = validateGrounding(fieldKey, decision, rowLookup, tier);

        const pat = FIELD_EVIDENCE_PATTERNS[fieldKey];
        const rowHasEvidence = pat ? pat.test(allRowTexts) : false;

        let diagnosticStage = 'ocr_evidence_absent';
        let diagnosticDetail = 'No evidence found for this field in OCR results';

        if (grounded.status === 'verified') {
            diagnosticStage = 'value_accepted';
            diagnosticDetail = 'Verified against grounded OCR evidence';
        } else if (decision.value !== null && decision.value !== undefined && decision.value !== '') {
            diagnosticStage = 'grounding_rejected';
            diagnosticDetail = grounded.reason || 'Grounding gate rejected proposed value';
        } else if (decision.value === null || decision.value === undefined) {
            if (rowHasEvidence) {
                diagnosticStage = 'gpt_returned_null';
                diagnosticDetail = 'Evidence was present in reconstructed rows but GPT-OSS returned null';
            } else {
                diagnosticStage = 'ocr_evidence_absent';
                diagnosticDetail = 'No evidence found in OCR text or rows';
            }
        }

        const fieldDiagnostics = {
            stage: diagnosticStage,
            detail: diagnosticDetail,
            proposedValue: decision.value !== undefined ? decision.value : null
        };
        diagnostics[fieldKey] = fieldDiagnostics;

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
            reason: grounded.reason || null,
            diagnostics: fieldDiagnostics
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
                    // Determine tax inclusion from OCR evidence, not assumption
                    const mrpRefs = Array.isArray(decision.groundingRefs) ? decision.groundingRefs : [];
                    const mrpEvidenceText = mrpRefs
                        .map(r => rowLookup.get(`${r.photoId}:${r.rowId}`) || '')
                        .join(' ').toLowerCase();
                    let taxInclusion = null;
                    if (/\b(?:inclusive|incl\.?)\s*(?:of\s*)?(?:all\s*)?tax/i.test(mrpEvidenceText)) {
                        taxInclusion = true;
                    } else if (/\b(?:exclusive|excl\.?)\s*(?:of\s*)?(?:all\s*)?tax/i.test(mrpEvidenceText) ||
                               /\bexcluding\s*tax/i.test(mrpEvidenceText)) {
                        taxInclusion = false;
                    }
                    normalizedFields.mrp = {
                        value: !isNaN(num) ? num : null,
                        currency: acceptedVal.currency || 'INR',
                        inclusiveOfTaxes: taxInclusion
                    };
                } else if (acceptedVal) {
                    const m = String(acceptedVal).match(/\d+(?:\.\d+)?/);
                    const num = m ? parseFloat(m[0]) : NaN;
                    if (!isNaN(num)) {
                        // Check row evidence for tax inclusion/exclusion language
                        const mrpRefsFlat = Array.isArray(decision.groundingRefs) ? decision.groundingRefs : [];
                        const mrpEvText = mrpRefsFlat
                            .map(r => rowLookup.get(`${r.photoId}:${r.rowId}`) || '')
                            .join(' ').toLowerCase();
                        let taxIncl = null;
                        if (/\b(?:inclusive|incl\.?)\s*(?:of\s*)?(?:all\s*)?tax/i.test(mrpEvText)) {
                            taxIncl = true;
                        } else if (/\b(?:exclusive|excl\.?)\s*(?:of\s*)?(?:all\s*)?tax/i.test(mrpEvText) ||
                                   /\bexcluding\s*tax/i.test(mrpEvText)) {
                            taxIncl = false;
                        }
                        normalizedFields.mrp = {
                            value: num,
                            currency: 'INR',
                            inclusiveOfTaxes: taxIncl
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
        diagnostics,
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
