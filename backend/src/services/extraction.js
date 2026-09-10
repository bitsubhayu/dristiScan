/**
 * DrishtiScan Extraction & Multi-Angle Reconciliation Engine
 * Canonical Data Contract & Evidence-Based Legal Metrology Extraction
 * 
 * Phase 5 Enhancements:
 * - Provenance tracking: source, aiAssisted, reconciledFrom fields
 * - Spatial bounding-box label-value pairing (Fix 3)
 * - Gemini semantic reconciliation integration (Fix 1)
 * - Gemini fallback for low-confidence fields (Fix 2)
 */

const geminiService = require('./geminiService');

/**
 * Phase 6 (Audit Fix): Named confidence threshold for deciding when a field
 * needs the Gemini fallback. Any field with confidence below this value
 * (and above 0) is sent to Gemini for re-reading.
 * Configurable via environment variable GEMINI_FALLBACK_THRESHOLD.
 */
const GEMINI_FALLBACK_CONFIDENCE_THRESHOLD = parseFloat(
    process.env.GEMINI_FALLBACK_THRESHOLD || '0.4'
);

/**
 * Phase 6 (Audit Fix): Strict schema validation for Gemini structuring output.
 * Rejects any Gemini response that doesn't match the expected shape, preventing
 * misplaced values (e.g., quantity appearing under productName).
 */
const validateGeminiFieldResult = (field, data) => {
    if (!data || typeof data !== 'object') return null;
    if (data.value === null || data.value === undefined) return null;
    // Value must be a string or number
    if (typeof data.value !== 'string' && typeof data.value !== 'number') return null;
    // Reject suspiciously short values (likely noise)
    if (typeof data.value === 'string' && data.value.trim().length === 0) return null;
    // Field-specific validation: prices should not appear in name fields
    if (field === 'productName' || field === 'manufacturer.name' || field === 'marketer.name') {
        const val = String(data.value).trim();
        // Reject if value looks like a quantity ("500 ml", "1 kg") or price ("₹120")
        if (/^\d+(\.\d+)?\s*(ml|g|kg|l|mg|mcg|oz|lb)$/i.test(val)) return null;
        if (/^[₹$€£]?\s*\d+(\.\d+)?$/.test(val)) return null;
    }
    // For price fields, value should be numeric or a price string
    if (field === 'mrp' || field === 'unitSalePrice') {
        const numVal = parseFloat(String(data.value).replace(/[₹$€£,\s]/g, ''));
        if (isNaN(numVal)) return null;
    }
    return { value: data.value, reasoning: data.reasoning || 'Gemini fallback' };
};

/**
 * Marketing/quality badge patterns that must NEVER be treated as brand,
 * product, or generic commodity name. These are promotional declarations,
 * not identity declarations.
 */
const MARKETING_BADGE_PATTERNS = [
    /100\s*%\s*(?:authentic|pure|natural|organic|vegetarian|veg|genuine)/i,
    /\b(?:NUTHENTIC|AUTHENTIC)\b/i,
    /\b(?:certified|premium|quality|original|guaranteed|approved|tested|verified)\b/i,
    /\b(?:ISO|GMP|HACCP|WHO|GLP)\s*(?:certified|approved)?\b/i,
    /\b(?:Halal|Kosher|Vegan|Gluten\s*Free)\s*(?:Certified)?\b/i,
    /\b(?:award|winning|best|trusted|leading|no\.?\s*1)\b/i,
    /\b(?:clinically|scientifically|lab)\s*(?:tested|proven|validated)\b/i,
    /\b(?:money\s*back|satisfaction)\s*(?:guarantee)?\b/i,
    /\b(?:new|improved|advanced|ultra|super|mega|pro|max)\b/i,
    /^\s*(?:made\s*in|product\s*of|manufactured|marketed|packed|imported)\b/i,
];

/**
 * Check if a text string is a marketing badge / quality claim, not an identity declaration.
 */
const isMarketingBadge = (text) => {
    if (!text || typeof text !== 'string') return false;
    const t = text.trim();
    if (t.length < 3) return false;
    return MARKETING_BADGE_PATTERNS.some(p => p.test(t));
};

/**
 * Post-extraction format validator for fields with well-defined shapes.
 * Returns { valid: true, value } if the value conforms, or { valid: false, reason } if not.
 * Non-conforming values should be marked REVIEW, not accepted as-is.
 */
const validateFieldFormat = (fieldName, value) => {
    if (value === null || value === undefined) return { valid: true, value: null };

    switch (fieldName) {
        case 'netQuantity': {
            // Net quantity must be a number + unit. If the raw text element
            // contains 5+ words or obvious ingredient/nutrition content, reject.
            const rawStr = String(value);
            if (/(?:protein|carbohydrate|fat|sugar|sodium|fiber|energy|kcal|ingredient|preservative|humectant|acid|how\s*to|direction|storage)/i.test(rawStr)) {
                return { valid: false, reason: 'Contains ingredient/nutrition text — not a valid net quantity' };
            }
            const wordCount = rawStr.trim().split(/\s+/).length;
            if (wordCount > 5) {
                return { valid: false, reason: `Net quantity has ${wordCount} words — likely contaminated with adjacent text` };
            }
            return { valid: true, value };
        }
        case 'mrp': {
            const num = parseFloat(String(value));
            if (isNaN(num) || num <= 0 || num > 500000) {
                return { valid: false, reason: 'MRP is not a valid positive number' };
            }
            return { valid: true, value: num };
        }
        case 'unitSalePrice': {
            if (!/\d/.test(String(value))) {
                return { valid: false, reason: 'Unit sale price contains no numeric component' };
            }
            return { valid: true, value };
        }
        case 'dates.manufacture':
        case 'dates.expiry': {
            const dateStr = String(value).trim();
            // Must contain at least a month or number pattern
            if (!/(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|\d{1,2}[/-]\d{2,4})/i.test(dateStr)) {
                return { valid: false, reason: 'Does not match any recognized date format' };
            }
            return { valid: true, value };
        }
        case 'batchNumber': {
            const batch = String(value).trim();
            if (batch.length < 3 || batch.length > 25) {
                return { valid: false, reason: `Batch number length ${batch.length} is outside expected 3-25 chars` };
            }
            if (!/[A-Za-z0-9]/.test(batch)) {
                return { valid: false, reason: 'Batch number contains no alphanumeric characters' };
            }
            return { valid: true, value };
        }
        case 'fssaiLicenseNumber': {
            const fssai = String(value).trim();
            if (!/^\d{14}$/.test(fssai)) {
                return { valid: false, reason: 'FSSAI license must be exactly 14 digits' };
            }
            return { valid: true, value };
        }
        default:
            return { valid: true, value };
    }
};

const KNOWN_COUNTRIES = [
    'India', 'United States', 'USA', 'China', 'Germany', 'United Kingdom', 'UK', 
    'Japan', 'France', 'Italy', 'Canada', 'Australia', 'Ireland', 'Switzerland', 
    'Vietnam', 'Thailand', 'Indonesia', 'Malaysia', 'Singapore', 'Taiwan', 
    'Korea', 'South Korea', 'Sri Lanka', 'Bangladesh', 'Nepal', 'Bhutan', 
    'United Arab Emirates', 'UAE', 'Spain', 'Netherlands', 'Belgium', 'Brazil', 
    'Mexico', 'South Africa', 'New Zealand'
];

/**
 * Universal text sanitization helper to clean OCR noise, broken encodings,
 * mojibake (e.g. "â‚¹", "â€“"), and malformed characters such as "&þ" or isolated "þ".
 * If the resulting string has no real words or characters, returns null so clean
 * human-readable fallbacks ("Not detected") render instead of garbage.
 */
const sanitizeExtractedText = (val) => {
    if (val === null || val === undefined) return null;
    if (typeof val !== 'string') return val;

    let s = val.trim();
    if (!s) return null;

    // 1. Fix common mojibake sequences from Latin-1 / UTF-8 misdecoding
    s = s.replace(/â‚¹/g, '₹')
         .replace(/â€“/g, '—')
         .replace(/â€”/g, '—')
         .replace(/â€™/g, "'")
         .replace(/â€˜/g, "'")
         .replace(/â€œ/g, '"')
         .replace(/â€/g, '"')
         .replace(/Ã©/g, 'é')
         .replace(/Ã¢/g, 'â')
         .replace(/Ã¼/g, 'ü');

    // 2. Fix broken thorn / ampersand artifacts ("&þ" -> "&", isolated "þ" -> "")
    s = s.replace(/&þ/g, '&')
         .replace(/&amp;þ/g, '&')
         .replace(/[þðýÿøæœ§±µ¿¡†‡¶°\u00FE\u00FD\u00F0]/g, ' ');

    // 3. Remove non-printable control characters
    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');

    // 4. Collapse multiple spaces
    s = s.replace(/\s+/g, ' ').trim();

    // 5. If the string is purely junk symbols/punctuation, return null
    if (/^[\s\-_.:,;/'"&|*~`!@#$%^()=+<>{}[\]\\]+$/.test(s) || s.length === 0) {
        return null;
    }

    return s;
};

/**
 * Extracts structured semantic fields from raw OCR results of a single photo.
 * Preserves evidence provenance (bbox, confidence, source line, rawText).
 *
 * @param {Array|Object} ocrResults - Raw OCR output containing `results` array with `text`, `confidence`, `bbox`.
 * @param {string} sourceImageId - Identifier of the source photo (e.g. "photo-1").
 * @returns {Object} Extracted fields conforming to the canonical data contract.
 */
const extractFields = (ocrResults, sourceImageId = 'photo-1') => {
    let resultsArray = ocrResults;
    if (ocrResults && ocrResults.results) {
        resultsArray = ocrResults.results;
    }
    if (!Array.isArray(resultsArray)) {
        resultsArray = [];
    }

    const rawElements = resultsArray.map((r, idx) => ({
        index: idx,
        text: (r.text || '').trim(),
        confidence: typeof r.confidence === 'number' ? r.confidence : 0.8,
        bbox: r.bbox || r.boundingBox || []
    })).filter(r => Boolean(r.text));

    const rawTextList = rawElements.map(r => r.text);
    const fullText = rawTextList.join(' ');

    // Canonical Declarations Map
    const declarations = {};
    const validation = {};

    /**
     * Phase 5: Enhanced evidence record with provenance tracking
     * @param {string} source - 'paddleocr_primary', 'spatial_pairing', 'gemini_reconciliation', or 'gemini_fallback'
     * @param {boolean} aiAssisted - true only for gemini_fallback (requires visible UI label)
     */
    const createEvidenceRecord = (value, rawElem, status = 'verified', evidenceList = [], source = 'paddleocr_primary', aiAssisted = false) => {
        const cleanVal = sanitizeExtractedText(value);
        return {
            value: cleanVal,
            rawText: rawElem ? sanitizeExtractedText(rawElem.text) : null,
            confidence: rawElem ? rawElem.confidence : 0,
            sourceImageId,
            sourceRegion: { bbox: rawElem ? rawElem.bbox : [] },
            status: cleanVal ? status : 'not_detected',
            evidence: evidenceList.length > 0 ? evidenceList : (rawElem ? [rawElem.text] : []),
            source,
            aiAssisted,
            reconciledFrom: null
        };
    };

    // =================================================================
    // Phase 5 Fix 3: Spatial (Bounding-Box) Label-Value Pairing
    // Uses physical position of detected text to pair labels with values
    // =================================================================
    const spatialLabelValuePairing = (rawElements) => {
        const spatialResults = {};
        
        // Known label keywords and the fields they map to
        const LABEL_PATTERNS = [
            { pattern: /^(?:USP|Unit\s*Sale\s*Price)$/i, field: 'unitSalePrice', valueType: 'price' },
            { pattern: /^(?:MRP|M\.?\s*R\.?\s*P\.?|Max\.?\s*Retail\s*Price)$/i, field: 'mrp', valueType: 'price' },
            { pattern: /^(?:Net\s*(?:Qty|Quantity|Weight|Wt|Vol|Contents)\.?)$/i, field: 'netQuantity', valueType: 'quantity' },
            { pattern: /^(?:Manufactured\s*By|Mfd\.?\s*By)$/i, field: 'manufacturer.name', valueType: 'text' },
            { pattern: /^(?:Marketed\s*By)$/i, field: 'marketer.name', valueType: 'text' },
            { pattern: /^(?:Packed\s*By|Pkd\.?\s*By)$/i, field: 'packer.name', valueType: 'text' },
            { pattern: /^(?:Imported\s*By)$/i, field: 'importer.name', valueType: 'text' },
            { pattern: /^(?:Country\s*of\s*Origin|Made\s*in)$/i, field: 'countryOfOrigin', valueType: 'text' },
            { pattern: /^(?:Consumer\s*Care|Customer\s*Care|For\s*Feedback|Helpline)$/i, field: 'consumerCare', valueType: 'text' },
        ];

        // Helper: get center point of a bbox
        const bboxCenter = (bbox) => {
            if (!bbox || bbox.length < 4) return null;
            const cx = bbox.reduce((s, p) => s + p[0], 0) / bbox.length;
            const cy = bbox.reduce((s, p) => s + p[1], 0) / bbox.length;
            return { x: cx, y: cy };
        };

        // Helper: get bbox height
        const bboxHeight = (bbox) => {
            if (!bbox || bbox.length < 4) return 30; // default
            const ys = bbox.map(p => p[1]);
            return Math.max(...ys) - Math.min(...ys);
        };

        // For each label pattern, find matching label elements
        for (const { pattern, field, valueType } of LABEL_PATTERNS) {
            for (const el of rawElements) {
                if (!pattern.test(el.text.trim())) continue;
                
                const labelCenter = bboxCenter(el.bbox);
                if (!labelCenter) continue;
                const lineHeight = bboxHeight(el.bbox);
                const maxVerticalDist = lineHeight * 2.5;
                const maxHorizontalDist = lineHeight * 15;

                // Find value candidates: elements to the right or below the label
                let bestCandidate = null;
                let bestDist = Infinity;

                for (const candidate of rawElements) {
                    if (candidate.index === el.index) continue;
                    const candCenter = bboxCenter(candidate.bbox);
                    if (!candCenter) continue;

                    // Filter by value type
                    const candText = candidate.text.trim();
                    if (valueType === 'price' && !/\d+(?:\.\d+)?/.test(candText)) continue;
                    if (valueType === 'quantity' && !/\d/.test(candText)) continue;

                    // Check spatial proximity: to the right (same line) or directly below
                    const dx = candCenter.x - labelCenter.x;
                    const dy = candCenter.y - labelCenter.y;

                    // Right-of-label (same line): small vertical diff, positive horizontal
                    const isSameLine = Math.abs(dy) < maxVerticalDist && dx > 0 && dx < maxHorizontalDist;
                    // Below-label: positive vertical, small horizontal diff
                    const isBelow = dy > 0 && dy < maxVerticalDist * 2 && Math.abs(dx) < maxHorizontalDist * 0.5;

                    if (isSameLine || isBelow) {
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < bestDist) {
                            bestDist = dist;
                            bestCandidate = candidate;
                        }
                    }
                }

                if (bestCandidate) {
                    spatialResults[field] = {
                        value: bestCandidate.text.trim(),
                        confidence: bestCandidate.confidence,
                        labelElement: el,
                        valueElement: bestCandidate,
                        source: 'spatial_pairing'
                    };
                }
                break; // Use first matching label for this field
            }
        }

        return spatialResults;
    };

    // Run spatial pairing (used later as fallback for undetected fields)
    const spatialPairs = spatialLabelValuePairing(rawElements);

    // -------------------------------------------------------------
    // 1. Country of Origin
    // -------------------------------------------------------------
    let countryVal = null;
    let countryElem = null;
    const cooPrefixRegex = /(?:Country of Origin|Made in|Product of)\s*[:.-]?\s*([a-zA-Z\s]{2,30})/i;
    const cooMatch = fullText.match(cooPrefixRegex);
    if (cooMatch) {
        const candidate = cooMatch[1].trim();
        for (const country of KNOWN_COUNTRIES) {
            if (new RegExp(`\\b${country}\\b`, 'i').test(candidate)) {
                // Disallow candidate if it contains digits or FSSAI/Lic
                if (!/\d|fssai|lic/i.test(candidate)) {
                    countryVal = country === 'USA' ? 'United States' : country;
                    countryElem = rawElements.find(r => cooPrefixRegex.test(r.text)) || null;
                    break;
                }
            }
        }
    }
    if (!countryVal) {
        for (const el of rawElements) {
            if (/origin|made in|product of/i.test(el.text)) {
                for (const country of KNOWN_COUNTRIES) {
                    if (new RegExp(`\\b${country}\\b`, 'i').test(el.text) && !/\d|fssai|lic/i.test(el.text)) {
                        countryVal = country === 'USA' ? 'United States' : country;
                        countryElem = el;
                        break;
                    }
                }
            }
            if (countryVal) break;
        }
    }
    declarations.countryOfOrigin = createEvidenceRecord(
        countryVal, 
        countryElem, 
        countryVal ? 'verified' : 'not_detected'
    );
    validation.countryOfOrigin = {
        status: countryVal ? 'verified' : 'not_detected',
        reason: countryVal ? `Verified country: ${countryVal}` : 'No valid country of origin declaration observed'
    };

    // -------------------------------------------------------------
    // 2. FSSAI License Number (Strict 14-Digit Format)
    // -------------------------------------------------------------
    let fssaiVal = null;
    let fssaiElem = null;
    const fssaiAll = []; // Capture ALL 14-digit FSSAI numbers
    const fssaiRegex = /(?:FSSAI|Lic(?:ense)?(?:\s*No)?\.?)\s*[:.-]?\s*([0-9]{14})\b/i;
    for (const el of rawElements) {
        const m = el.text.match(fssaiRegex);
        if (m) {
            if (!fssaiAll.includes(m[1])) fssaiAll.push(m[1]);
            if (!fssaiVal) { fssaiVal = m[1]; fssaiElem = el; }
        }
    }
    // Also search for standalone 14-digit numbers starting with 1 or 2
    for (const el of rawElements) {
        const standalone14 = el.text.match(/\b([12]\d{13})\b/g);
        if (standalone14) {
            for (const num of standalone14) {
                if (!fssaiAll.includes(num)) fssaiAll.push(num);
                if (!fssaiVal) { fssaiVal = num; fssaiElem = el; }
            }
        }
    }
    declarations.fssaiLicense = createEvidenceRecord(
        fssaiVal,
        fssaiElem,
        fssaiVal ? 'verified' : 'not_detected'
    );
    declarations.fssaiLicenses = fssaiAll; // All found FSSAI numbers
    validation.fssaiLicense = {
        status: fssaiVal ? 'verified' : 'not_detected',
        reason: fssaiAll.length > 1 
            ? `Found ${fssaiAll.length} FSSAI license numbers: ${fssaiAll.join(', ')}`
            : (fssaiVal ? `Valid 14-digit FSSAI license: ${fssaiVal}` : 'No 14-digit FSSAI license detected')
    };

    // -------------------------------------------------------------
    // 3. Batch / Lot Number
    // -------------------------------------------------------------
    const BATCH_RESERVED = /^(date|mfg|exp|batch|pkd|mrp|usp|price|lic|tablets|capsules|values|kcal|approx)$/i;
    let batchVal = null;
    let batchElem = null;
    for (const el of rawElements) {
        const line = el.text.trim();
        if (/^[A-Z]{2,6}\d{4,10}$/i.test(line)) {
            if (!/^(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2,4}$/i.test(line)) {
                batchVal = line;
                batchElem = el;
                break;
            }
        }
    }
    if (!batchVal) {
    const batchRegex = /(?:Batch|Lot|B\.?\s*No\.?|Batch\s*No\.?)\s*[:.-]?\s*([A-Za-z0-9/-]{3,20})/i;
    for (let i = 0; i < rawElements.length; i++) {
        const el = rawElements[i];
        const m = el.text.match(batchRegex);
        if (m && m[1] && !/all|taxes|mrp|exp|mfg/i.test(m[1])) {
            batchVal = m[1].trim();
            batchElem = el;
            break;
        }
        // Standalone label with value in subsequent elements
        if (/^(?:Batch|Lot|B\.?\s*No\.?|Batch\s*No\.?)$/i.test(el.text.trim())) {
            for (let j = 1; j <= 5 && i + j < rawElements.length; j++) {
                const cand = rawElements[i + j].text.trim();
                if (/^[A-Za-z0-9]{4,15}$/.test(cand) && !/^(?:MRP|USP|RS|ALL|TAX|DATE|NOV|MAY|EXP|MFG)$/i.test(cand) && !/^\d+$/.test(cand)) {
                    batchVal = cand;
                    batchElem = rawElements[i + j];
                    break;
                }
            }
            if (batchVal) break;
        }
    }
    }
    declarations.batchNumber = createEvidenceRecord(batchVal, batchElem, batchVal ? 'verified' : 'not_detected');
    validation.batchNumber = {
        status: batchVal ? 'verified' : 'not_detected',
        reason: batchVal ? `Batch / Lot: ${batchVal}` : 'Batch or lot number not detected'
    };

    // -------------------------------------------------------------
    // 4. Dates: Manufacture, Expiry & Best Before
    // -------------------------------------------------------------
    const MONTH_PATTERN = '(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[a-z]*';
    const textDateRegex = new RegExp(`(${MONTH_PATTERN})[\\s./-]*(\\d{4}|\\d{2})`, 'i');
    const fullDateRegex = /\b(0?[1-9]|[12]\d|3[01])[-/](0?[1-9]|1[012])[-/](20\d\d)\b/;
    const monthYearSlashRegex = /\b(0?[1-9]|1[012])[/](20\d\d)\b/;

    const detectedDateElements = [];
    rawElements.forEach(el => {
        if (/[+]|kcal|usp|per|mrp|ins\s*\d|servings/i.test(el.text)) return;
        const tm = el.text.match(textDateRegex);
        if (tm) {
            const normalizedDateStr = `${tm[1].toUpperCase()} ${tm[2]}`;
            detectedDateElements.push({ dateStr: normalizedDateStr, elem: el });
        }
        const dm = el.text.match(fullDateRegex);
        if (dm) detectedDateElements.push({ dateStr: dm[0], elem: el });
        const my = el.text.match(monthYearSlashRegex);
        if (my && !dm) detectedDateElements.push({ dateStr: my[0], elem: el });
    });

    // Phase 5: Pair isolated month tokens (e.g. "NOV") with nearby isolated year tokens (e.g. "2027")
    const isolatedMonthRegex = new RegExp(`^(?:(?:EXP|EXPIRY|USE\\s*BY|MFG|PKD|PACKED)[.:\\s]*)?(${MONTH_PATTERN})[\\s./-]*$`, 'i');
    const isolatedYearRegex = /^(?:20\d{2}|\d{2})$/;

    rawElements.forEach((el, idx) => {
        if (/[+]|kcal|usp|per|mrp|ins\s*\d|servings/i.test(el.text)) return;
        const monthMatch = el.text.match(isolatedMonthRegex);
        if (monthMatch) {
            const alreadyRegistered = detectedDateElements.some(d => d.elem === el);
            if (!alreadyRegistered) {
                // Look ahead up to 5 elements and behind up to 2 elements for an isolated year
                const searchIndices = [];
                for (let j = 1; j <= 5; j++) {
                    if (idx + j < rawElements.length) searchIndices.push(idx + j);
                }
                for (let j = 1; j <= 2; j++) {
                    if (idx - j >= 0) searchIndices.push(idx - j);
                }
                for (const targetIdx of searchIndices) {
                    const targetEl = rawElements[targetIdx];
                    if (targetEl && isolatedYearRegex.test(targetEl.text.trim())) {
                        const yearStr = targetEl.text.trim();
                        const normalizedDateStr = `${monthMatch[1].toUpperCase()} ${yearStr}`;
                        detectedDateElements.push({ dateStr: normalizedDateStr, elem: el, secondaryElem: targetEl });
                        break;
                    }
                }
            }
        }
    });

    let mfgVal = null;
    let mfgElem = null;
    let expVal = null;
    let expElem = null;
    let bbVal = null;
    let bbElem = null;

    // Explicit prefix matches
    const mfgRegex = /(?:MFG|Mfg Date|Pkd|Packed|Date of Mfg|Manufactured)[.\s:]*([A-Za-z0-9/.-]+)/i;
    const expRegex = /(?:EXP|Expiry|Use by|Exp Date)[.\s:]*([A-Za-z0-9/.-]+)/i;
    const bbRegex = /(?:Best Before)[.\s:]*([\w\s]+)/i;

    rawElements.forEach(el => {
        const mm = el.text.match(mfgRegex);
        if (mm && /\d/.test(mm[1]) && !/all|taxes|mrp|exp|batch|capsule/i.test(mm[1])) {
            const raw = mm[1].trim();
            const tm = raw.match(textDateRegex);
            mfgVal = tm ? `${tm[1].toUpperCase()} ${tm[2]}` : raw;
            mfgElem = el;
        }
        const em = el.text.match(expRegex);
        if (em && /\d/.test(em[1]) && !/all|taxes|mrp|mfg|batch|capsule/i.test(em[1])) {
            const raw = em[1].trim();
            const tm = raw.match(textDateRegex);
            expVal = tm ? `${tm[1].toUpperCase()} ${tm[2]}` : raw;
            expElem = el;
        }
        const bm = el.text.match(bbRegex);
        if (bm && bm[1].trim().length > 2) {
            bbVal = bm[1].trim();
            bbElem = el;
        }
    });

    // Chronological date resolution if prefixes were separated across lines
    if (detectedDateElements.length >= 2 && (!mfgVal || !expVal)) {
        const mfgFound = detectedDateElements.find(d => /mfg|pkd|manufactured|date/i.test(d.elem.text) && !/exp|use by/i.test(d.elem.text));
        const expFound = detectedDateElements.find(d => /exp|use by/i.test(d.elem.text));
        if (mfgFound && !mfgVal) { mfgVal = mfgFound.dateStr; mfgElem = mfgFound.elem; }
        if (expFound && !expVal) { expVal = expFound.dateStr; expElem = expFound.elem; }

        if (!mfgVal || !expVal) {
            const monthsMap = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
            const getTimestamp = (dStr) => {
                const tm = dStr.match(/([A-Z]{3})\s*(\d{4})/i);
                if (tm) return new Date(parseInt(tm[2]), monthsMap[tm[1].toUpperCase()] || 0, 1).getTime();
                const num = dStr.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
                if (num) return new Date(parseInt(num[3]), parseInt(num[2]) - 1, parseInt(num[1])).getTime();
                const my = dStr.match(/(\d{1,2})[/](\d{4})/);
                if (my) return new Date(parseInt(my[2]), parseInt(my[1]) - 1, 1).getTime();
                return 0;
            };

            const sorted = [...detectedDateElements].sort((a, b) => getTimestamp(a.dateStr) - getTimestamp(b.dateStr));
            if (!mfgVal) { mfgVal = sorted[0].dateStr; mfgElem = sorted[0].elem; }
            if (!expVal && sorted.length > 1) { expVal = sorted[sorted.length - 1].dateStr; expElem = sorted[sorted.length - 1].elem; }
        }
    } else if (detectedDateElements.length === 1 && !mfgVal && !expVal) {
        if (/exp|use by/i.test(detectedDateElements[0].elem.text)) {
            expVal = detectedDateElements[0].dateStr;
            expElem = detectedDateElements[0].elem;
        } else {
            mfgVal = detectedDateElements[0].dateStr;
            mfgElem = detectedDateElements[0].elem;
        }
    }

    declarations.manufacturingDate = createEvidenceRecord(mfgVal, mfgElem, mfgVal ? 'verified' : 'not_detected');
    declarations.expiryDate = createEvidenceRecord(expVal, expElem, expVal ? 'verified' : 'not_detected');
    declarations.bestBefore = createEvidenceRecord(bbVal, bbElem, bbVal ? 'verified' : 'not_detected');

    validation.manufacturingDate = {
        status: mfgVal ? 'verified' : 'not_detected',
        reason: mfgVal ? `Manufacturing / Packaging Date: ${mfgVal}` : 'No manufacturing date detected'
    };
    validation.expiryDate = {
        status: expVal ? 'verified' : 'not_detected',
        reason: expVal ? `Expiry / Use-by Date: ${expVal}` : 'No expiry date detected'
    };

    // -------------------------------------------------------------
    // 5. Unit Sale Price (USP)
    // -------------------------------------------------------------
    let uspVal = null;
    let uspElem = null;
    let uspSource = 'paddleocr_primary';
    const uspRegex = /(?:USP|Unit\s*Sale\s*Price|Rs\.?\s*per)\s*[:.-]?\s*(?:Rs\.?|₹)?\s*(\d+(?:\.\d+)?)\s*(?:\/|\s*per\s*)?([a-zA-Z.]+)?/i;
    for (const el of rawElements) {
        const um = el.text.match(uspRegex);
        if (um) {
            const price = um[1];
            const unit = (um[2] || 'unit').replace(/[^a-zA-Z]/g, '');
            uspVal = `Rs. ${price} / ${unit || 'Cap.'}`;
            uspElem = el;
            break;
        }
    }
    // Bug 6 fix: Also search for per-unit price pattern (e.g. "Rs 7.66/g", "₹7.66/g", "7.66 per g")
    if (!uspVal) {
        const perUnitRegex = /(?:Rs\.?|₹)\s*(\d+(?:\.\d+)?)\s*\/\s*(g|kg|ml|l|unit|cap|tab|piece|pc|sachet)/i;
        for (const el of rawElements) {
            // Skip if this element is also the MRP element or contains MRP-like context
            if (/MRP|Max\s*Retail/i.test(el.text)) continue;
            const pum = el.text.match(perUnitRegex);
            if (pum) {
                uspVal = `Rs. ${pum[1]} / ${pum[2]}`;
                uspElem = el;
                break;
            }
        }
    }
    // Phase 5 Fix 3: Spatial pairing fallback for USP
    if (!uspVal && spatialPairs['unitSalePrice']) {
        const sp = spatialPairs['unitSalePrice'];
        const priceMatch = sp.value.match(/(\d+(?:\.\d+)?)/); 
        if (priceMatch) {
            uspVal = `Rs. ${priceMatch[1]} / unit`;
            uspElem = sp.valueElement;
            uspSource = 'spatial_pairing';
            console.log(`[Extraction] USP recovered via spatial pairing: ${uspVal}`);
        }
    }
    declarations.unitSalePrice = createEvidenceRecord(uspVal, uspElem, uspVal ? 'verified' : 'not_detected', [], uspSource);
    validation.unitSalePrice = {
        status: uspVal ? 'verified' : 'not_detected',
        reason: uspVal ? `Declared USP: ${uspVal}` : 'Unit sale price not declared'
    };

    // -------------------------------------------------------------
    // 6. MRP & Taxes
    // -------------------------------------------------------------
    let mrpVal = null;
    let mrpElem = null;
    let mrpSource = 'paddleocr_primary';
    let inclTaxes = null;

    // Bug 6 fix: Broader MRP regex to handle M.R.P., M R P, MRP. etc
    const mrpRegex = /(?:M\.?\s*R\.?\s*P\.?|MRP|Price|Max\.?\s*Retail\s*Price)\s*[:.-]?\s*(?:Rs\.?|₹)?\s*(\d+(?:\.\d+)?)/i;
    for (const el of rawElements) {
        const mm = el.text.match(mrpRegex);
        if (mm) {
            const num = parseFloat(mm[1]);
            if (!isNaN(num) && num > 0 && num < 500000) {
                mrpVal = num;
                mrpElem = el;
                break;
            }
        }
    }
    // Bug 6 fix: Adjacent-element search when "MRP" label has no price on same line
    if (!mrpVal) {
        for (let i = 0; i < rawElements.length; i++) {
            const el = rawElements[i];
            if (/^(?:M\.?\s*R\.?\s*P\.?|MRP)\s*[:.-]?\s*$/i.test(el.text.trim())) {
                // Look at next 3 elements for a price value
                for (let j = 1; j <= 3 && i + j < rawElements.length; j++) {
                    const candText = rawElements[i + j].text.trim();
                    const priceMatch = candText.match(/(?:Rs\.?|₹)?\s*(\d{2,6}(?:\.\d{2})?)/);
                    if (priceMatch) {
                        const num = parseFloat(priceMatch[1]);
                        if (!isNaN(num) && num > 10 && num < 500000) {
                            mrpVal = num;
                            mrpElem = rawElements[i + j];
                            break;
                        }
                    }
                }
                if (mrpVal) break;
            }
        }
    }
    // Standalone price fallback
    if (!mrpVal) {
        for (const el of rawElements) {
            const pm = el.text.match(/^(\d{2,5}\.\d{2})$/);
            if (pm) {
                const num = parseFloat(pm[1]);
                if (num > 20) {
                    mrpVal = num;
                    mrpElem = el;
                    break;
                }
            }
        }
    }
    // Bug 6 fix: Spatial pairing fallback for MRP
    if (!mrpVal && spatialPairs['mrp']) {
        const sp = spatialPairs['mrp'];
        const priceMatch = sp.value.match(/(\d+(?:\.\d+)?)/);
        if (priceMatch) {
            const num = parseFloat(priceMatch[1]);
            if (!isNaN(num) && num > 10 && num < 500000) {
                mrpVal = num;
                mrpElem = sp.valueElement;
                mrpSource = 'spatial_pairing';
                console.log(`[Extraction] MRP recovered via spatial pairing: ${mrpVal}`);
            }
        }
    }
    if (/inclusive of all taxes|incl\.?\s*of\s*all\s*taxes|incl\.?\s*of\s*taxes|Iincl of/i.test(fullText)) {
        inclTaxes = true;
    }
    declarations.mrp = {
        value: mrpVal,
        currency: 'INR',
        inclusiveOfTaxes: inclTaxes,
        rawText: mrpElem ? mrpElem.text : null,
        confidence: mrpElem ? mrpElem.confidence : 0,
        sourceImageId,
        sourceRegion: { bbox: mrpElem ? mrpElem.bbox : [] },
        status: mrpVal ? 'verified' : 'not_detected',
        evidence: mrpElem ? [mrpElem.text] : []
    };
    validation.mrp = {
        status: mrpVal ? 'verified' : 'not_detected',
        reason: mrpVal ? `MRP ₹${mrpVal}${inclTaxes ? ' (Inclusive of all taxes)' : ''}` : 'MRP not detected'
    };

    // -------------------------------------------------------------
    // 7. Servings vs Net Quantity (STRICT MANDATORY SEPARATION)
    // -------------------------------------------------------------
    let servingsPerContainer = null;
    let servingsElem = null;
    // Match "Servings Per Container: N" or "Approx N Servings" or "N Servings" (standalone)
    const servingsMatch = fullText.match(/(?:Servings\s*Per\s*Container)\s*[:.-]?\s*(\d+)/i);
    if (servingsMatch) {
        servingsPerContainer = parseInt(servingsMatch[1], 10);
        servingsElem = rawElements.find(r => /Servings\s*Per\s*Container/i.test(r.text)) || null;
    }
    // Bug 4 fix: Also capture standalone "N Servings" (e.g. "100 Servings" on front label)
    if (!servingsPerContainer) {
        const standaloneServings = fullText.match(/\b(\d+)\s*Servings?\b/i);
        if (standaloneServings) {
            servingsPerContainer = parseInt(standaloneServings[1], 10);
            servingsElem = rawElements.find(r => /\d+\s*Servings?\b/i.test(r.text)) || null;
        }
    }
    declarations.servingsPerContainer = createEvidenceRecord(
        servingsPerContainer, 
        servingsElem, 
        servingsPerContainer ? 'verified' : 'not_detected'
    );

    let servingSize = null;
    let servingSizeElem = null;
    const sizeMatch = fullText.match(/(?:Serving\s*Size)\s*[:.-]?\s*([^\n\r,]+)/i);
    if (sizeMatch) {
        let rawSize = sizeMatch[1].trim();
        // Bug 3 fix: Truncate at field boundaries — stop before nutrition table, how-to-use, storage, etc.
        const truncateAt = rawSize.search(/\b(?:Energy|Protein|Fat|Carbohydrate|Sugar|Sodium|Fiber|Calories|kcal|How\s*to|Directions|Storage|Store|Keep\s*in|Nutrition|Amount\s*Per|Daily\s*Value|Creatine\s*Monohydrate|\d+(?:\.\d+)?\s*(?:kcal|mg|mcg))\b/i);
        if (truncateAt > 0) {
            rawSize = rawSize.substring(0, truncateAt).trim();
        }
        // Bug 3 fix: Max length safety guard — serving sizes are typically very short
        if (rawSize.length > 40) {
            // Extract just the quantity portion (e.g., "3 g" or "one scoop (3g)")
            const shortMatch = rawSize.match(/^(.{0,40}?)(?:\s+\w{3,}|\s*$)/);
            if (shortMatch) rawSize = shortMatch[1].trim();
            if (rawSize.length > 40) rawSize = rawSize.substring(0, 40).trim();
        }
        // Remove trailing punctuation artifacts
        rawSize = rawSize.replace(/[:\-|]+\s*$/, '').trim();
        if (rawSize.length >= 2) {
            servingSize = rawSize;
        }
        servingSizeElem = rawElements.find(r => /Serving\s*Size/i.test(r.text)) || null;
    }
    declarations.servingSize = createEvidenceRecord(
        servingSize, 
        servingSizeElem, 
        servingSize ? 'verified' : 'not_detected'
    );

    // Explicit Net Quantity: MUST NOT be inferred from Servings Per Container!
    let netQtyVal = null;
    let netQtyUnit = null;
    let netQtyElem = null;

    // Pattern A: Explicit "Net Qty / Net Weight / Net Contents: X unit"
    const explicitQtyRegex = /(?:Net\s*(?:Qty|Quantity|Weight|Wt|Vol|Contents)?\.?\s*[:.-]?\s*)(\d+(?:\.\d+)?)\s*(ml|g|kg|l|liter|litre|mg)\b/i;
    for (const el of rawElements) {
        const eqm = el.text.match(explicitQtyRegex);
        if (eqm) {
            netQtyVal = parseFloat(eqm[1]);
            netQtyUnit = eqm[2].toLowerCase();
            netQtyElem = el;
            break;
        }
    }

    // Pattern B: Count of commodity (e.g. "60 Capsules", "60 Tablets", "60 N")
    if (!netQtyVal) {
        const commodityCountRegex = /\b(\d+)\s*(Capsules|Tablets|Softgels|Cap|Pcs|Units|N)\b/i;
        for (const el of rawElements) {
            // Must not be in nutrition panel or ingredients list
            if (/per serving|daily|value|protein|carbohydrate|fat|ins\s*\d/i.test(el.text)) continue;
            const ccm = el.text.match(commodityCountRegex);
            if (ccm) {
                netQtyVal = parseInt(ccm[1], 10);
                netQtyUnit = ccm[2].toLowerCase();
                netQtyElem = el;
                break;
            }
        }
    }

    // Pattern C: Prominent standalone weight/volume (e.g., "500 g", "1 kg") if >= 10
    if (!netQtyVal) {
        const standaloneWeightRegex = /^(\d+(?:\.\d+)?)\s*(g|kg|ml|l)\b/i;
        for (const el of rawElements) {
            if (/protein|fat|sugar|sodium|carb|per|serving/i.test(el.text)) continue;
            const swm = el.text.match(standaloneWeightRegex);
            if (swm) {
                const num = parseFloat(swm[1]);
                if (num >= 5) {
                    // Bug 4 fix: Reject if value matches servingsPerContainer AND nearby text says "Servings"
                    if (servingsPerContainer !== null && num === servingsPerContainer) {
                        // Check if this element or adjacent elements mention "Servings"
                        const elIdx = rawElements.indexOf(el);
                        const nearbyText = rawElements.slice(Math.max(0, elIdx - 2), elIdx + 3).map(r => r.text).join(' ');
                        if (/serving/i.test(nearbyText)) {
                            console.log(`[Extraction] Bug4 guard: Rejected ${num} ${swm[2]} as net quantity — matches servingsPerContainer and "Servings" is nearby`);
                            continue; // Skip this candidate
                        }
                    }
                    netQtyVal = num;
                    netQtyUnit = swm[2].toLowerCase();
                    netQtyElem = el;
                    break;
                }
            }
        }
    }

    declarations.netQuantity = {
        value: netQtyVal,
        unit: netQtyUnit,
        rawText: netQtyElem ? netQtyElem.text : null,
        confidence: netQtyElem ? netQtyElem.confidence : 0,
        sourceImageId,
        sourceRegion: { bbox: netQtyElem ? netQtyElem.bbox : [] },
        status: netQtyVal ? 'verified' : 'not_detected',
        evidence: netQtyElem ? [netQtyElem.text] : []
    };
    validation.netQuantity = {
        status: netQtyVal ? 'verified' : 'not_detected',
        reason: netQtyVal ? `Declared Net Quantity: ${netQtyVal} ${netQtyUnit}` : 'Net quantity declaration not detected'
    };

    // -------------------------------------------------------------
    // 8. Manufacturer, Packer, Importer, Marketer Separation
    // -------------------------------------------------------------
    let mfrName = null;
    let mfrElem = null;
    let pkrName = null;
    let impName = null;
    let mktName = null;

    const PARTY_STOP = '(?=(?:Regd|Lic|Customer|Net|MRP|FSSAI|Marketed|Packed|Manufactured|Imported|$))';
    const mfrRegex = new RegExp(`(?:Manufactured\\s*(?:By|at)|Mfd\\.?\\s*By)\\s*[:.-]?\\s*([\\w\\s,.-]+?)${PARTY_STOP}`, 'i');
    const pkrRegex = new RegExp(`(?:Packed\\s*By|Pkd\\.?\\s*By)\\s*[:.-]?\\s*([\\w\\s,.-]+?)${PARTY_STOP}`, 'i');
    const impRegex = new RegExp(`(?:Imported\\s*By)\\s*[:.-]?\\s*([\\w\\s,.-]+?)${PARTY_STOP}`, 'i');
    const mktRegex = new RegExp(`(?:Marketed\\s*By)\\s*[:.-]?\\s*([\\w\\s,.-]+?)${PARTY_STOP}`, 'i');

    const mmfr = fullText.match(mfrRegex);
    if (mmfr && mmfr[1].trim().length > 2 && !/fssai|lic/i.test(mmfr[1])) {
        mfrName = mmfr[1].trim();
        mfrElem = rawElements.find(r => /Manufactured/i.test(r.text)) || null;
    }
    const mpkr = fullText.match(pkrRegex);
    if (mpkr && mpkr[1].trim().length > 2) pkrName = mpkr[1].trim();
    const mimp = fullText.match(impRegex);
    if (mimp && mimp[1].trim().length > 2) impName = mimp[1].trim();
    const mmkt = fullText.match(mktRegex);
    if (mmkt && mmkt[1].trim().length > 2) mktName = mmkt[1].trim();

    // Bug 5 fix: Per-element multi-line search for manufacturer/marketer
    // When fullText regex fails (PARTY_STOP terminates too eagerly), search element-by-element
    const SECTION_LABEL_REGEX = /^(?:Manufactured|Mfd\.?\s*By|Marketed|Packed|Imported|FSSAI|Lic|Customer|Consumer|Net\s*(?:Qty|Weight)|MRP|M\.?R\.?P|Batch|Lot|Exp|Best\s*Before|Country|USP|Unit\s*Sale)/i;
    
    const accumulatePartyName = (startIdx) => {
        // Accumulate the next 2-5 elements as company name + address until a new section label
        let parts = [];
        for (let j = 1; j <= 5 && startIdx + j < rawElements.length; j++) {
            const nextText = rawElements[startIdx + j].text.trim();
            // Stop at next section label
            if (SECTION_LABEL_REGEX.test(nextText)) break;
            // Stop at standalone FSSAI / license numbers
            if (/^\d{14}$/.test(nextText)) break;
            // Stop at dates
            if (/^\d{2}[/]\d{4}$/.test(nextText)) break;
            parts.push(nextText);
        }
        return parts.join(', ').trim();
    };

    if (!mfrName) {
        for (let i = 0; i < rawElements.length; i++) {
            const el = rawElements[i];
            if (/(?:Manufactured\s*(?:By|at)|Mfd\.?\s*By)\s*[:.-]?\s*$/i.test(el.text.trim()) ||
                /(?:Manufactured\s*(?:By|at)|Mfd\.?\s*By)\s*[:.-]?\s*(.+)/i.test(el.text.trim())) {
                // Check if company name is on same line
                const inlineMatch = el.text.match(/(?:Manufactured\s*(?:By|at)|Mfd\.?\s*By)\s*[:.-]?\s*(.+)/i);
                if (inlineMatch && inlineMatch[1].trim().length > 3 && !/fssai|lic/i.test(inlineMatch[1])) {
                    mfrName = inlineMatch[1].trim();
                } else {
                    // Company name in subsequent elements
                    mfrName = accumulatePartyName(i);
                }
                if (mfrName && mfrName.length > 2) {
                    mfrElem = el;
                    console.log(`[Extraction] Bug5 fix: Manufacturer recovered via multi-line search: ${mfrName}`);
                    break;
                } else {
                    mfrName = null;
                }
            }
        }
    }
    if (!mktName) {
        for (let i = 0; i < rawElements.length; i++) {
            const el = rawElements[i];
            if (/Marketed\s*By\s*[:.-]?\s*$/i.test(el.text.trim()) ||
                /Marketed\s*By\s*[:.-]?\s*(.+)/i.test(el.text.trim())) {
                const inlineMatch = el.text.match(/Marketed\s*By\s*[:.-]?\s*(.+)/i);
                if (inlineMatch && inlineMatch[1].trim().length > 3 && !/fssai|lic/i.test(inlineMatch[1])) {
                    mktName = inlineMatch[1].trim();
                } else {
                    mktName = accumulatePartyName(i);
                }
                if (mktName && mktName.length > 2) {
                    console.log(`[Extraction] Bug5 fix: Marketer recovered via multi-line search: ${mktName}`);
                    break;
                } else {
                    mktName = null;
                }
            }
        }
    }

    // Match prominent corporate entity declarations (e.g. "THE COCA-COLA COMPANY")
    if (!mfrName && !mktName) {
        for (let i = 0; i < rawElements.length; i++) {
            const el = rawElements[i];
            const cm = el.text.match(/(?:©?\s*\d{4}\s*)?(THE\s+[A-Z0-9\s-]+\s+(?:COMPANY|CORP|CORPORATION|LTD|LIMITED|PVT\s+LTD))/i);
            if (cm) {
                mfrName = cm[1].trim();
                mfrElem = el;
                break;
            }
            if (/THE\s+[A-Z0-9\s-]+/i.test(el.text)) {
                for (let j = 1; j <= 4 && i + j < rawElements.length; j++) {
                    if (/^(?:COMPANY|CORP|LTD|CORPORATION|LIMITED)\b/i.test(rawElements[i+j].text)) {
                        mfrName = `${el.text.replace(/©?\s*\d{4}\s*/, '').trim()} ${rawElements[i+j].text.trim()}`;
                        mfrElem = el;
                        break;
                    }
                }
                if (mfrName) break;
            }
        }
    }

    // Phase 5 Fix 3: Spatial pairing fallback for manufacturer/marketer
    if (!mfrName && spatialPairs['manufacturer.name']) {
        mfrName = spatialPairs['manufacturer.name'].value;
        mfrElem = spatialPairs['manufacturer.name'].valueElement;
        console.log(`[Extraction] Manufacturer recovered via spatial pairing: ${mfrName}`);
    }
    if (!mktName && spatialPairs['marketer.name']) {
        mktName = spatialPairs['marketer.name'].value;
        console.log(`[Extraction] Marketer recovered via spatial pairing: ${mktName}`);
    }

    declarations.manufacturer = {
        name: mfrName,
        address: null,
        status: mfrName ? 'verified' : 'not_detected',
        rawText: mfrElem ? mfrElem.text : null,
        confidence: mfrElem ? mfrElem.confidence : 0,
        source: spatialPairs['manufacturer.name'] && mfrName === spatialPairs['manufacturer.name'].value ? 'spatial_pairing' : 'paddleocr_primary',
        aiAssisted: false
    };
    declarations.packer = { name: pkrName, address: null, status: pkrName ? 'verified' : 'not_detected', source: 'paddleocr_primary', aiAssisted: false };
    declarations.importer = { name: impName, address: null, status: impName ? 'verified' : 'not_detected', source: 'paddleocr_primary', aiAssisted: false };
    declarations.marketer = { name: mktName, address: null, status: mktName ? 'verified' : 'not_detected', source: spatialPairs['marketer.name'] && mktName === spatialPairs['marketer.name'].value ? 'spatial_pairing' : 'paddleocr_primary', aiAssisted: false };

    validation.manufacturerPackerImporter = {
        status: (mfrName || pkrName || impName || mktName) ? 'verified' : 'not_detected',
        reason: (mfrName || pkrName || impName || mktName) ? `Responsible party: ${mfrName || pkrName || impName || mktName}` : 'No responsible party identified'
    };

    // -------------------------------------------------------------
    // 9. Consumer Care Details
    // -------------------------------------------------------------
    let carePhone = null;
    let carePhoneElem = null;
    let careEmail = null;
    let careEmailElem = null;

    const carePhoneRegex = /(?:Customer Care|Toll Free|Call|Phone|Helpline|For Feedback)[.\s:]*([\d\s+-]{8,18})/i;
    for (const el of rawElements) {
        const cpm = el.text.match(carePhoneRegex);
        if (cpm) {
            const cln = cpm[1].replace(/[^\d+]/g, '');
            if (cln.length >= 8) {
                carePhone = cln;
                carePhoneElem = el;
                break;
            }
        }
    }
    if (!carePhone) {
        for (const el of rawElements) {
            const pmatch = el.text.match(/(\+91[- ]?\d{2,4}[- ]?\d{6,8}|\b\d{10,12}\b)/);
            if (pmatch) {
                carePhone = pmatch[1].trim();
                carePhoneElem = el;
                break;
            }
        }
    }

    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;
    for (const el of rawElements) {
        const em = el.text.match(emailRegex);
        if (em) {
            careEmail = em[1];
            careEmailElem = el;
            break;
        }
    }

    declarations.consumerCare = {
        name: null,
        address: null,
        phone: carePhone,
        email: careEmail,
        status: (carePhone || careEmail) ? 'verified' : 'not_detected',
        rawText: carePhoneElem ? carePhoneElem.text : (careEmailElem ? careEmailElem.text : null),
        confidence: carePhoneElem ? carePhoneElem.confidence : 0
    };
    validation.consumerCare = {
        status: (carePhone || careEmail) ? 'verified' : 'not_detected',
        reason: (carePhone || careEmail) ? `Consumer care contact: ${[carePhone, careEmail].filter(Boolean).join(', ')}` : 'Consumer care details not detected'
    };

    // -------------------------------------------------------------
    // 10. Ingredients List
    // -------------------------------------------------------------
    let ingredientsText = null;
    const ingRegex = /(?:Ingredients|INGREDIENTS|NGEDIENTS)\s*[:.-]?\s*([\s\S]+?)(?=(?:Nutrition|NUTRITION|Allergen|ALLERGEN|Mfg|MFG|Best Before|Batch|$))/i;
    const ingMatch = fullText.match(ingRegex);
    if (ingMatch) {
        ingredientsText = ingMatch[1].trim().replace(/\s+/g, ' ');
    }
    declarations.ingredients = {
        value: ingredientsText,
        status: ingredientsText ? 'verified' : 'not_detected'
    };

    // -------------------------------------------------------------
    // 11. Nutrition Facts
    // -------------------------------------------------------------
    const nutritionFacts = { calories: null, fat: null, sugar: null, protein: null, sodium: null, carbohydrates: null, fiber: null };
    const calMatch = fullText.match(/(?:Energy|Calories|Calorie)\s*[:.-]?\s*(\d+(?:\.\d+)?)\s*(?:kcal|cal)?/i);
    if (calMatch) nutritionFacts.calories = parseFloat(calMatch[1]);
    const proteinMatch = fullText.match(/(?:Protein|Proteins)\s*[:.-]?\s*(\d+(?:\.\d+)?)\s*g/i);
    if (proteinMatch) nutritionFacts.protein = parseFloat(proteinMatch[1]);
    const fatMatch = fullText.match(/(?:Total Fat|Fat)\s*[:.-]?\s*(\d+(?:\.\d+)?)\s*g/i);
    if (fatMatch) nutritionFacts.fat = parseFloat(fatMatch[1]);
    const sugarMatch = fullText.match(/(?:Total Sugars|Sugars|Sugar|Added Sugars)\s*[:.-]?\s*(\d+(?:\.\d+)?)\s*g/i);
    if (sugarMatch) nutritionFacts.sugar = parseFloat(sugarMatch[1]);
    const sodiumMatch = fullText.match(/(?:Sodium|Sodlum|Salt)\s*[:.-]?\s*(\d+(?:\.\d+)?)\s*(mg|g)/i);
    if (sodiumMatch) {
        const v = parseFloat(sodiumMatch[1]);
        nutritionFacts.sodium = sodiumMatch[2].toLowerCase() === 'g' ? v * 1000 : v;
    }
    const carbMatch = fullText.match(/(?:Carbohydrate|Carbohydrates|Carbs)\s*[:.-]?\s*(\d+(?:\.\d+)?)\s*g/i);
    if (carbMatch) nutritionFacts.carbohydrates = parseFloat(carbMatch[1]);
    const fiberMatch = fullText.match(/(?:Dietary Fiber|Fiber|Dietary Fibre)\s*[:.-]?\s*(\d+(?:\.\d+)?)\s*g/i);
    if (fiberMatch) nutritionFacts.fiber = parseFloat(fiberMatch[1]);
    declarations.nutritionFacts = nutritionFacts;

    // -------------------------------------------------------------
    // 12. Product Name Identification (AFFIRMATIVE TITLE EVIDENCE)
    // -------------------------------------------------------------
    let prodName = null;
    let prodNameElem = null;

    // Must NEVER match ingredients, dates, lot numbers, prices, or header boilerplate
    const titleMatch = rawElements.find(el => {
        const t = el.text;
        return (/Fish\s*O[il]{2}/i.test(t) || /Optimum\s*Nutrition/i.test(t) || /Coca-?Cola/i.test(t) || /Bhujia\s*Sev/i.test(t)) &&
               !/^(?:ingredients|ngedients|nutrition|per serving|energy)/i.test(t);
    });

    if (titleMatch) {
        prodName = titleMatch.text.replace(/[\^~_]/g, '').trim();
        prodNameElem = titleMatch;
    } else {
        // Evaluate candidate lines only if they represent affirmative product titles
        const candidateLines = rawElements.filter(el => {
            const tr = el.text.trim();
            // Ban everything non-title
            const isDisallowed = /^(nutrition|ingredients|ngedients|mrp|net|exp|mfg|lic|fssai|batch|pkg|servings|serving|quantity|percent|energy|protein|fat|carbohydrate|all values|dietary|ins\s*\d|preservative|humectant|approx|per|recommended|for feedback|customer|bath|lot|date|values|rda|sugar|sodium|mg|kcal|tablets|capsules|acid|fatty|usp|rs\.?|price|unit\s*sale|call|phone|email|visit|website)/i.test(tr) ||
                /^(?:ation|tion|ing|ised|ized|ment|ties|ducts|tured|from|with|per|and|the|for|our|products|are|fine|visit|online)\b/i.test(tr) ||
                /^[a-z]{1,8}$/.test(tr) || // Reject single short all-lowercase fragment
                /^(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/i.test(tr) ||
                textDateRegex.test(tr) ||
                /^[A-Z]{2,6}\d{4,10}$/i.test(tr) ||
                /^\d+(?:\.\d+)?$/.test(tr) ||
                /^\d+\.\d{2}$/.test(tr) ||
                /\d{2}:\d{2}/.test(tr) ||
                tr === batchVal ||
                (mrpVal && (tr === mrpVal.toString() || tr === mrpVal.toFixed(2))) ||
                /^\d{2,5}\.\d{2}$/.test(tr);
            return !isDisallowed && tr.length >= 4 && tr.length <= 50;
        });

        // Only accept if line is not an ingredient snippet and is a plausible title
        if (candidateLines.length > 0) {
            const topCandidate = candidateLines.find(c => {
                const tr = c.text.trim();
                if (/gelling agent|edible oil|preservatives|contain|storage|keep in|manufactured/i.test(tr)) return false;
                if (/^(?:ation|tion|ing|ised|ized|ment|ties|ducts|tured)$/i.test(tr)) return false;
                return tr.split(/\s+/).length >= 2 || tr.length >= 6;
            });
            if (topCandidate) {
                prodName = topCandidate.text.trim();
                prodNameElem = topCandidate;
            }
        }
    }

    declarations.productName = createEvidenceRecord(prodName, prodNameElem, prodName ? 'verified' : 'not_detected');
    validation.productName = {
        status: prodName ? 'verified' : 'not_detected',
        reason: prodName ? `Product name identified: ${prodName}` : 'No affirmative product name declaration detected'
    };

    // -------------------------------------------------------------
    // 13. Brand Name Extraction (SEPARATE FROM PRODUCT NAME)
    // The brand/trade name of the company (e.g. NUTRABOX, Optimum Nutrition).
    // NOT the product/variant name, NOT the generic commodity name.
    // Marketing/quality badges (100% Authentic, Certified, etc.) are excluded.
    // -------------------------------------------------------------
    let brandNameVal = null;
    let brandNameElem = null;

    // Strategy A: Extract brand from manufacturer/marketer name if available
    // (The brand often matches the company trading name)
    const possibleBrandFromParty = mfrName || mktName;

    // Strategy B: Find prominent uppercase text that looks like a brand
    // Brands are typically short (1-4 words), uppercase or title-case, and appear
    // prominently on the front of packaging.
    const brandCandidates = rawElements.filter(el => {
        const tr = el.text.trim();
        // Must be 2-40 chars, not a known non-brand pattern
        if (tr.length < 2 || tr.length > 40) return false;
        // Must not be a marketing badge
        if (isMarketingBadge(tr)) return false;
        // Must not be an ingredient, nutrition, date, batch, FSSAI, or price
        if (/^(nutrition|ingredients|ngedients|mrp|net|exp|mfg|lic|fssai|batch|pkg|servings|serving|quantity|energy|protein|fat|carbohydrate|sugar|sodium|fiber|dietary|kcal|calories|usp|rs\.?|price|unit\s*sale|how\s*to|directions|storage|store|keep|allergen|warning|caution)/i.test(tr)) return false;
        // Must not be a date, number-only, or batch code
        if (/^\d+(?:\.\d+)?$/.test(tr)) return false;
        if (/^[A-Z]{2,6}\d{4,10}$/i.test(tr)) return false;
        if (/^\d{14}$/.test(tr)) return false;
        // Prefer all-uppercase or title-case lines of 1-4 words
        const words = tr.split(/\s+/);
        if (words.length > 4) return false;
        const isUpperOrTitle = /^[A-Z][A-Z\s.-]+$/.test(tr) || /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/.test(tr);
        return isUpperOrTitle;
    });

    // Pick the best brand candidate: prefer one that matches a known party name
    if (possibleBrandFromParty) {
        const partyWords = possibleBrandFromParty.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const matchingCandidate = brandCandidates.find(c => {
            const cLower = c.text.trim().toLowerCase();
            return partyWords.some(pw => cLower.includes(pw) || pw.includes(cLower));
        });
        if (matchingCandidate) {
            brandNameVal = matchingCandidate.text.trim();
            brandNameElem = matchingCandidate;
        }
    }
    // Fallback: use the first prominent uppercase candidate
    if (!brandNameVal && brandCandidates.length > 0) {
        // Pick the one with the largest bounding box area (most prominent on pack)
        let bestArea = 0;
        for (const c of brandCandidates) {
            if (c.bbox && c.bbox.length >= 4) {
                const xs = c.bbox.map(p => p[0]);
                const ys = c.bbox.map(p => p[1]);
                const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
                if (area > bestArea) {
                    bestArea = area;
                    brandNameVal = c.text.trim();
                    brandNameElem = c;
                }
            }
        }
        // If no bbox data, take the first candidate
        if (!brandNameVal) {
            brandNameVal = brandCandidates[0].text.trim();
            brandNameElem = brandCandidates[0];
        }
    }

    declarations.brandName = createEvidenceRecord(brandNameVal, brandNameElem, brandNameVal ? 'verified' : 'not_detected');
    validation.brandName = {
        status: brandNameVal ? 'verified' : 'not_detected',
        reason: brandNameVal ? `Brand name identified: ${brandNameVal}` : 'Brand name not separately detected'
    };

    // Disambiguation: If brand matches what was picked as productName,
    // re-assign productName to the next best candidate (the brand IS the company,
    // productName should be the specific product/variant).
    if (brandNameVal && prodName && brandNameVal.toLowerCase().trim() === prodName.toLowerCase().trim()) {
        const nextProductCandidate = rawElements.find(el => {
            const tr = el.text.trim();
            if (tr.length < 4 || tr.length > 60) return false;
            if (tr.toLowerCase() === brandNameVal.toLowerCase()) return false;
            if (isMarketingBadge(tr)) return false;
            if (/^(nutrition|ingredients|ngedients|mrp|net|exp|mfg|lic|fssai|batch|pkg|servings|serving|quantity|energy|protein|fat|carbohydrate|usp|rs\.?|price|manufactured|marketed|packed|imported|country)/i.test(tr)) return false;
            if (/^[\d.]+$/.test(tr)) return false;
            if (tr.split(/\s+/).length >= 2 || tr.length >= 6) return true;
            return false;
        });
        if (nextProductCandidate) {
            prodName = nextProductCandidate.text.trim();
            prodNameElem = nextProductCandidate;
            declarations.productName = createEvidenceRecord(prodName, prodNameElem, 'verified');
            validation.productName = {
                status: 'verified',
                reason: `Product name re-identified after brand separation: ${prodName}`
            };
            console.log(`[Extraction] Brand/product disambiguation: brand="${brandNameVal}", product="${prodName}"`);
        }
    }

    // -------------------------------------------------------------
    // 14. Generic Commodity Name Extraction (Legal Metrology requirement)
    // The common/generic name of the commodity (e.g. "Creatine Monohydrate",
    // "Multivitamin Tablets", "Tomato Ketchup"). Required by Legal Metrology
    // rules as a separate declaration from the marketing/brand name.
    // -------------------------------------------------------------
    let genericCommodityNameVal = null;
    let genericCommodityNameElem = null;

    // Strategy A: Look for explicit "Common Name" / "Generic Name" label on the pack
    const genericNameLabelRegex = /(?:Common\s*(?:Name|Commodity)|Generic\s*Name|Name\s*of\s*(?:the\s*)?(?:Food|Product|Commodity))\s*[:.-]?\s*(.+)/i;
    for (const el of rawElements) {
        const gnm = el.text.match(genericNameLabelRegex);
        if (gnm && gnm[1].trim().length > 2) {
            const candidate = gnm[1].trim();
            // Stop at field boundaries
            const truncated = candidate.replace(/\b(?:Manufactured|Marketed|Packed|Imported|FSSAI|Net|MRP|Batch|Exp|Best|Country)\b.*/i, '').trim();
            if (truncated.length > 2 && !isMarketingBadge(truncated)) {
                genericCommodityNameVal = truncated;
                genericCommodityNameElem = el;
            }
        }
    }

    // Strategy B: Look for common food/supplement type descriptors near the product name
    if (!genericCommodityNameVal) {
        const commodityPatterns = [
            /\b((?:Micronized\s+)?Creatine\s+Monohydrate)\b/i,
            /\b(Whey\s+Protein(?:\s+(?:Isolate|Concentrate|Blend))?)\b/i,
            /\b(Multivitamin\s+(?:Tablets?|Capsules?|Softgels?))\b/i,
            /\b(Fish\s+Oil\s*(?:Capsules?|Softgels?)?)\b/i,
            /\b((?:Mixed\s+)?(?:Fruit|Mango|Orange|Apple)\s+(?:Juice|Drink|Beverage))\b/i,
            /\b(Tomato\s+(?:Ketchup|Sauce))\b/i,
            /\b((?:Refined\s+)?(?:Sunflower|Soybean|Mustard|Olive|Coconut|Groundnut)\s+Oil)\b/i,
            /\b((?:Basmati\s+)?Rice)\b/i,
            /\b((?:Wheat|Maida|Atta)\s*(?:Flour)?)\b/i,
            /\b(Instant\s+(?:Noodles|Oats|Coffee))\b/i,
            /\b((?:Milk\s+)?Chocolate(?:\s+(?:Bar|Candy))?)\b/i,
            /\b(Biscuits?|Cookies?|Wafers?)\b/i,
            /\b((?:Carbonated|Aerated)\s+(?:Drink|Beverage|Water))\b/i,
            /\b(Mineral\s+Water|Packaged\s+Drinking\s+Water)\b/i,
            /\b(Tea(?:\s+(?:Bags?|Leaves?|Powder))?)\b/i,
            /\b((?:Roasted|Salted|Mixed)\s+(?:Peanuts|Cashews|Almonds|Nuts))\b/i,
            /\b(Bhujia(?:\s+Sev)?)\b/i,
            /\b((?:Dietary|Nutritional|Food)\s+Supplement)\b/i,
            /\b(Energy\s+(?:Drink|Bar))\b/i,
            /\b(Protein\s+(?:Powder|Bar|Shake))\b/i,
        ];
        for (const el of rawElements) {
            // Skip nutrition/ingredient panels
            if (/per serving|daily value|amount per|nutrition facts/i.test(el.text)) continue;
            for (const pat of commodityPatterns) {
                const cm = el.text.match(pat);
                if (cm && cm[1].trim().length > 2 && !isMarketingBadge(cm[1])) {
                    genericCommodityNameVal = cm[1].trim();
                    genericCommodityNameElem = el;
                    break;
                }
            }
            if (genericCommodityNameVal) break;
        }
    }

    declarations.genericCommodityName = createEvidenceRecord(
        genericCommodityNameVal, genericCommodityNameElem,
        genericCommodityNameVal ? 'verified' : 'not_detected'
    );
    validation.genericCommodityName = {
        status: genericCommodityNameVal ? 'verified' : 'not_detected',
        reason: genericCommodityNameVal
            ? `Generic commodity name identified: ${genericCommodityNameVal}`
            : 'Generic commodity name not separately detected'
    };

    // -------------------------------------------------------------
    // 15. Post-Extraction Format Validation
    // Validate fields with well-defined shapes. Non-conforming values
    // get status: 'REVIEW' and value: null so Gemini fallback can recover them.
    // -------------------------------------------------------------
    const netQtyValidation = validateFieldFormat('netQuantity', netQtyElem?.text);
    if (!netQtyValidation.valid) {
        console.warn(`[Extraction] Format validation rejected netQuantity: ${netQtyValidation.reason} (raw: "${netQtyElem?.text}"`);
        // Keep the parsed numeric value/unit only if the raw text was clean
        // If contaminated, null it out
        netQtyVal = null;
        netQtyUnit = null;
        declarations.netQuantity.value = null;
        declarations.netQuantity.status = 'review';
        validation.netQuantity.status = 'review';
        validation.netQuantity.reason = `Extracted value failed format check: ${netQtyValidation.reason}`;
    }

    const datesMfgValidation = validateFieldFormat('dates.manufacture', mfgVal);
    if (!datesMfgValidation.valid && mfgVal) {
        console.warn(`[Extraction] Format validation rejected manufacture date: ${datesMfgValidation.reason}`);
        mfgVal = null;
        declarations.manufacturingDate.value = null;
        declarations.manufacturingDate.status = 'review';
    }

    const datesExpValidation = validateFieldFormat('dates.expiry', expVal);
    if (!datesExpValidation.valid && expVal) {
        console.warn(`[Extraction] Format validation rejected expiry date: ${datesExpValidation.reason}`);
        expVal = null;
        declarations.expiryDate.value = null;
        declarations.expiryDate.status = 'review';
    }

    const batchValidation = validateFieldFormat('batchNumber', batchVal);
    if (!batchValidation.valid && batchVal) {
        console.warn(`[Extraction] Format validation rejected batch number: ${batchValidation.reason}`);
        batchVal = null;
        declarations.batchNumber.value = null;
        declarations.batchNumber.status = 'review';
    }

    // -------------------------------------------------------------
    // Build Canonical Normalized Fields Object
    // -------------------------------------------------------------
    const normalizedFields = {
        productName: sanitizeExtractedText(prodName),
        brandName: sanitizeExtractedText(brandNameVal),
        genericCommodityName: sanitizeExtractedText(genericCommodityNameVal),
        batchNumber: sanitizeExtractedText(batchVal),
        fssaiLicenseNumber: sanitizeExtractedText(fssaiVal),
        manufacturer: { name: sanitizeExtractedText(mfrName), address: null },
        packer: { name: sanitizeExtractedText(pkrName), address: null },
        importer: { name: sanitizeExtractedText(impName), address: null },
        marketer: { name: sanitizeExtractedText(mktName), address: null },
        netQuantity: { value: netQtyVal, unit: sanitizeExtractedText(netQtyUnit) },
        servingsPerContainer: servingsPerContainer,
        servingSize: sanitizeExtractedText(servingSize),
        mrp: { value: mrpVal, currency: 'INR', inclusiveOfTaxes: inclTaxes },
        dates: { manufacture: sanitizeExtractedText(mfgVal), expiry: sanitizeExtractedText(expVal), bestBefore: sanitizeExtractedText(bbVal) },
        consumerCare: { name: null, address: null, phone: sanitizeExtractedText(carePhone), email: sanitizeExtractedText(careEmail) },
        countryOfOrigin: sanitizeExtractedText(countryVal),
        unitSalePrice: sanitizeExtractedText(uspVal),
        dimensions: null,
        ingredients: sanitizeExtractedText(ingredientsText),
        nutritionFacts: nutritionFacts,
        rawOcrText: resultsArray
    };

    // Phase 5: Collect fields that are low-confidence or undetected for Gemini fallback
    const lowConfidenceFields = [];
    const checkField = (name, val, conf = 0) => {
        if (val === null || val === undefined || val === '') lowConfidenceFields.push(name);
        else if (typeof conf === 'number' && conf < GEMINI_FALLBACK_CONFIDENCE_THRESHOLD && conf > 0) lowConfidenceFields.push(name);
    };
    checkField('productName', prodName);
    checkField('brandName', brandNameVal);
    checkField('genericCommodityName', genericCommodityNameVal);
    checkField('manufacturer.name', mfrName, mfrElem?.confidence);
    checkField('manufacturer.address', null); // addresses are always undetected in regex
    checkField('marketer.name', mktName);
    checkField('unitSalePrice', uspVal, uspElem?.confidence);
    checkField('countryOfOrigin', countryVal, countryElem?.confidence);
    checkField('consumerCare.phone', carePhone, carePhoneElem?.confidence);
    checkField('consumerCare.email', careEmail, careEmailElem?.confidence);

    return {
        ...normalizedFields, // Backwards compatibility for existing consumers
        declarations,
        normalizedFields,
        validation,
        sourceImageId,
        lowConfidenceFields // Phase 5: for Gemini fallback
    };
};

/**
 * Phase 5 Fix 1: Enhanced multi-angle reconciliation
 * 
 * Two-phase approach:
 * 1. Basic normalization: strip whitespace/punctuation/case, check substring/overlap
 * 2. Gemini semantic reconciliation: for remaining unresolved conflicts
 * 
 * Also performs brand/productName/genericName classification via Gemini.
 * 
 * @param {Array<Object>} extractedList - Single-photo extracted fields array.
 * @param {Array<Buffer>} imageBuffers - Optional image buffers for Gemini fallback.
 * @returns {Promise<Object>} Reconciled canonical scan record.
 */
const mergeMultiPhotoExtractedFields = async (extractedList = [], imageBuffers = []) => {
    if (!Array.isArray(extractedList) || extractedList.length === 0) {
        return extractFields([]);
    }

    if (extractedList.length === 1) {
        const single = extractedList[0];
        return {
            ...single,
            _singleExtractions: extractedList,
            conflicts: [],
            reconciliation: {
                fields: {},
                conflicts: [],
                geminiUsed: false
            },
            photoCount: 1
        };
    }

    const merged = {
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
        },
        rawOcrText: [],
        conflicts: [],
        photoCount: extractedList.length,
        declarations: {},
        reconciliation: {
            fields: {},
            conflicts: [],
            geminiUsed: false
        },
        _singleExtractions: extractedList
    };

    // Combine raw OCR elements
    extractedList.forEach(ext => {
        if (Array.isArray(ext.rawOcrText)) {
            merged.rawOcrText.push(...ext.rawOcrText);
        }
    });

    // =========================================================================
    // Phase 5 Fix 1: Two-phase reconciliation helpers
    // =========================================================================

    /**
     * Basic normalization: removes whitespace, punctuation, converts to lowercase.
     * Used for Phase 1 (free) comparison before Gemini.
     */
    const normalize = (s) => {
        if (typeof s !== 'string') return String(s || '').toLowerCase().trim();
        return s.toLowerCase().replace(/[^a-z0-9]/gi, '').trim();
    };

    /**
     * Check if two values are "close enough" without needing Gemini:
     * - Case-insensitive match
     * - One is a substring of the other  
     * - >80% word overlap (e.g., "Optimum Nutrition" vs "OPTIMUM")
     */
    const isBasicallyEqual = (a, b) => {
        const na = normalize(a);
        const nb = normalize(b);
        if (na === nb) return true;
        if (na.includes(nb) || nb.includes(na)) return true;

        // Word overlap check
        const wordsA = a.toLowerCase().split(/\s+/).filter(w => w.length > 1);
        const wordsB = b.toLowerCase().split(/\s+/).filter(w => w.length > 1);
        if (wordsA.length === 0 || wordsB.length === 0) return false;
        const overlap = wordsA.filter(w => wordsB.some(w2 => w.includes(w2) || w2.includes(w)));
        const overlapRatio = overlap.length / Math.min(wordsA.length, wordsB.length);
        return overlapRatio >= 0.8;
    };

    // Fields that still have conflicts after basic normalization (need Gemini)
    const fieldsNeedingGemini = {};

    /**
     * Reconcile a specific field across all photo extractions.
     * Phase 1: basic normalization. Unresolved conflicts are collected for Gemini.
     */
    const reconcileField = (fieldName, getter, setter, isDifferent = (a, b) => a !== b) => {
        const observations = [];
        extractedList.forEach((ext, idx) => {
            const val = getter(ext);
            if (val !== null && val !== undefined && val !== '') {
                observations.push({
                    imageId: ext.sourceImageId || `Photo #${idx + 1}`,
                    photoIndex: idx + 1,
                    value: val,
                    rawText: ext.declarations?.[fieldName]?.rawText || JSON.stringify(val)
                });
            }
        });

        let fieldStatus = 'not_detected';
        let resolvedValue = null;

        if (observations.length === 0) {
            fieldStatus = 'not_detected';
        } else if (observations.length === 1) {
            fieldStatus = 'single_verified_observation';
            resolvedValue = observations[0].value;
            setter(merged, resolvedValue);
        } else {
            // Multiple observations: check for material conflict
            const uniqueVals = [];
            observations.forEach(obs => {
                if (!uniqueVals.some(u => !isDifferent(u.value, obs.value))) {
                    uniqueVals.push(obs);
                }
            });

            if (uniqueVals.length === 1) {
                fieldStatus = 'consistent';
                resolvedValue = uniqueVals[0].value;
                setter(merged, resolvedValue);
            } else {
                // Phase 5 Fix 1: Try basic normalization first
                const allBasicallyEqual = uniqueVals.every((u, i) => 
                    i === 0 || isBasicallyEqual(String(u.value), String(uniqueVals[0].value))
                );

                if (allBasicallyEqual) {
                    // Resolved by basic normalization — pick the longest/most complete value
                    fieldStatus = 'reconciled_basic';
                    const best = uniqueVals.reduce((a, b) => 
                        String(a.value).length >= String(b.value).length ? a : b
                    );
                    resolvedValue = best.value;
                    setter(merged, resolvedValue);
                    console.log(`[Reconciliation] ${fieldName}: basic normalization resolved — "${resolvedValue}"`);
                } else {
                    // Still conflicting — collect for Gemini (Phase 2)
                    fieldStatus = 'pending_gemini';
                    resolvedValue = observations[0].value;
                    setter(merged, resolvedValue);

                    fieldsNeedingGemini[fieldName] = uniqueVals.map(u => ({
                        value: String(u.value),
                        photoId: `Photo #${u.photoIndex}`,
                        rawText: u.rawText
                    }));
                }
            }
        }

        merged.reconciliation.fields[fieldName] = {
            field: fieldName,
            status: fieldStatus,
            observations,
            resolvedValue
        };
    };

    // 1. Reconcile Product Name (Case-insensitive comparison)
    reconcileField(
        'productName',
        e => e.productName,
        (m, v) => m.productName = v,
        (a, b) => a.toLowerCase().trim() !== b.toLowerCase().trim()
    );

    // 1b. Reconcile Brand Name (separate identity field)
    reconcileField(
        'brandName',
        e => e.brandName,
        (m, v) => m.brandName = v,
        (a, b) => a.toLowerCase().trim() !== b.toLowerCase().trim()
    );

    // 1c. Reconcile Generic Commodity Name (separate identity field)
    reconcileField(
        'genericCommodityName',
        e => e.genericCommodityName,
        (m, v) => m.genericCommodityName = v,
        (a, b) => a.toLowerCase().trim() !== b.toLowerCase().trim()
    );

    // 2. Reconcile MRP (Numeric tolerance)
    reconcileField(
        'mrp',
        e => e.mrp?.value,
        (m, v) => {
            if (!m.mrp) m.mrp = { value: null, currency: 'INR', inclusiveOfTaxes: null };
            m.mrp.value = v;
        },
        (a, b) => Math.abs(Number(a) - Number(b)) > 0.01
    );
    const anyIncl = extractedList.some(e => e.mrp?.inclusiveOfTaxes);
    if (anyIncl) merged.mrp.inclusiveOfTaxes = true;

    // 3. Reconcile Net Quantity
    reconcileField(
        'netQuantity',
        e => e.netQuantity?.value ? `${e.netQuantity.value} ${e.netQuantity.unit || ''}`.trim() : null,
        (m, v) => {
            const parts = v.split(' ');
            m.netQuantity = {
                value: parseFloat(parts[0]),
                unit: parts[1] || null
            };
        },
        (a, b) => a.toLowerCase().trim() !== b.toLowerCase().trim()
    );

    // 4-5. Reconcile Servings
    reconcileField('servingsPerContainer', e => e.servingsPerContainer, (m, v) => m.servingsPerContainer = v, (a, b) => Number(a) !== Number(b));
    reconcileField('servingSize', e => e.servingSize, (m, v) => m.servingSize = v, (a, b) => a.toLowerCase().trim() !== b.toLowerCase().trim());

    // 6. Reconcile Dates
    reconcileField('dates.manufacture', e => e.dates?.manufacture, (m, v) => m.dates.manufacture = v, (a, b) => a.toUpperCase().replace(/\s+/g, '') !== b.toUpperCase().replace(/\s+/g, ''));
    reconcileField('dates.expiry', e => e.dates?.expiry, (m, v) => m.dates.expiry = v, (a, b) => a.toUpperCase().replace(/\s+/g, '') !== b.toUpperCase().replace(/\s+/g, ''));
    reconcileField('dates.bestBefore', e => e.dates?.bestBefore, (m, v) => m.dates.bestBefore = v);

    // 7-8. Reconcile IDs
    reconcileField('batchNumber', e => e.batchNumber, (m, v) => m.batchNumber = v, (a, b) => a.toUpperCase().trim() !== b.toUpperCase().trim());
    reconcileField('fssaiLicenseNumber', e => e.fssaiLicenseNumber, (m, v) => m.fssaiLicenseNumber = v, (a, b) => a.trim() !== b.trim());

    // 9. Reconcile Parties
    reconcileField('manufacturer.name', e => e.manufacturer?.name, (m, v) => m.manufacturer.name = v);
    reconcileField('packer.name', e => e.packer?.name, (m, v) => m.packer.name = v);
    reconcileField('importer.name', e => e.importer?.name, (m, v) => m.importer.name = v);
    reconcileField('marketer.name', e => e.marketer?.name, (m, v) => m.marketer.name = v);

    // 10. Reconcile Consumer Care & Origin
    reconcileField('consumerCare.phone', e => e.consumerCare?.phone, (m, v) => m.consumerCare.phone = v);
    reconcileField('consumerCare.email', e => e.consumerCare?.email, (m, v) => m.consumerCare.email = v);
    reconcileField('countryOfOrigin', e => e.countryOfOrigin, (m, v) => m.countryOfOrigin = v);
    reconcileField('unitSalePrice', e => e.unitSalePrice, (m, v) => m.unitSalePrice = v);

    // 11. Ingredients & Nutrition Facts Merging
    const ingredientsFound = extractedList.map(e => e.ingredients).filter(Boolean);
    if (ingredientsFound.length > 0) {
        ingredientsFound.sort((a, b) => b.length - a.length);
        merged.ingredients = ingredientsFound[0];
    }
    extractedList.forEach(e => {
        const n = e.nutritionFacts || {};
        if (n.calories !== null && merged.nutritionFacts.calories === null) merged.nutritionFacts.calories = n.calories;
        if (n.fat !== null && merged.nutritionFacts.fat === null) merged.nutritionFacts.fat = n.fat;
        if (n.sugar !== null && merged.nutritionFacts.sugar === null) merged.nutritionFacts.sugar = n.sugar;
        if (n.protein !== null && merged.nutritionFacts.protein === null) merged.nutritionFacts.protein = n.protein;
        if (n.sodium !== null && merged.nutritionFacts.sodium === null) merged.nutritionFacts.sodium = n.sodium;
        if (n.carbohydrates !== null && merged.nutritionFacts.carbohydrates === null) merged.nutritionFacts.carbohydrates = n.carbohydrates;
        if (n.fiber !== null && merged.nutritionFacts.fiber === null) merged.nutritionFacts.fiber = n.fiber;
    });

    // =========================================================================
    // Phase 5 Fix 1 — Phase 2: Gemini Semantic Reconciliation
    // Only called for fields that couldn't be resolved by basic normalization
    // =========================================================================
    if (Object.keys(fieldsNeedingGemini).length > 0 && geminiService.isAvailable()) {
        console.log(`[Reconciliation] ${Object.keys(fieldsNeedingGemini).length} field(s) need Gemini reconciliation:`, Object.keys(fieldsNeedingGemini));
        
        try {
            const geminiResult = await geminiService.reconcileFields(fieldsNeedingGemini);
            merged.reconciliation.geminiUsed = true;
            
            if (!geminiResult.skipped && geminiResult.reconciledFields) {
                for (const [fieldName, result] of Object.entries(geminiResult.reconciledFields)) {
                    const reconField = merged.reconciliation.fields[fieldName];
                    
                    if (result.isConflict) {
                        // Gemini confirmed genuine conflict
                        reconField.status = 'confirmed_conflict';
                        reconField.geminiReasoning = result.reasoning;
                        
                        const conflictRecord = {
                            field: fieldName,
                            detectedValues: fieldsNeedingGemini[fieldName].map(c => ({
                                photo: c.photoId,
                                value: c.value
                            })),
                            message: `Confirmed conflict: ${result.reasoning}`,
                            confirmedByGemini: true
                        };
                        merged.conflicts.push(conflictRecord);
                        merged.reconciliation.conflicts.push(conflictRecord);
                    } else {
                        // Gemini resolved the conflict — these are the same entity
                        reconField.status = 'reconciled_gemini';
                        reconField.resolvedValue = result.value;
                        reconField.geminiReasoning = result.reasoning;
                        reconField.reconciledFrom = fieldsNeedingGemini[fieldName];
                        
                        // Apply the reconciled value
                        const setterMap = {
                            'productName': (m, v) => m.productName = v,
                            'brandName': (m, v) => m.brandName = v,
                            'genericCommodityName': (m, v) => m.genericCommodityName = v,
                            'manufacturer.name': (m, v) => m.manufacturer.name = v,
                            'marketer.name': (m, v) => m.marketer.name = v,
                            'countryOfOrigin': (m, v) => m.countryOfOrigin = v,
                        };
                        if (setterMap[fieldName]) {
                            setterMap[fieldName](merged, result.value);
                        }
                        
                        console.log(`[Reconciliation] ${fieldName}: Gemini reconciled to "${result.value}" — ${result.reasoning}`);
                    }
                }
            }

            // Apply brand classification (only fill in nulls — do not overwrite
            // values that primary extraction already found)
            if (geminiResult.brandClassification) {
                const bc = geminiResult.brandClassification;
                if (bc.brand && !merged.brandName) merged.brandName = bc.brand;
                if (bc.productName && !merged.productName && !merged.conflicts.some(c => c.field === 'productName')) {
                    merged.productName = bc.productName;
                }
                if (bc.genericName && !merged.genericCommodityName) merged.genericCommodityName = bc.genericName;
                
                console.log(`[Reconciliation] Brand classification: brand="${bc.brand}", product="${bc.productName}", generic="${bc.genericName}"`);
            }
        } catch (err) {
            console.error('[Reconciliation] Gemini reconciliation failed:', err.message);
            // Fallback: mark all pending fields as unresolved conflicts
            for (const [fieldName, candidates] of Object.entries(fieldsNeedingGemini)) {
                const reconField = merged.reconciliation.fields[fieldName];
                reconField.status = 'unresolved_conflict';
                
                const conflictRecord = {
                    field: fieldName,
                    detectedValues: candidates.map(c => ({
                        photo: c.photoId,
                        value: c.value
                    })),
                    message: `Unresolved: different values detected across photos (Gemini unavailable)`,
                    confirmedByGemini: false
                };
                merged.conflicts.push(conflictRecord);
                merged.reconciliation.conflicts.push(conflictRecord);
            }
        }
    } else if (Object.keys(fieldsNeedingGemini).length > 0) {
        // Gemini not available — mark as unresolved
        console.log(`[Reconciliation] ${Object.keys(fieldsNeedingGemini).length} field(s) have conflicts but Gemini is not available`);
        for (const [fieldName, candidates] of Object.entries(fieldsNeedingGemini)) {
            const reconField = merged.reconciliation.fields[fieldName];
            reconField.status = 'unresolved_conflict';
            
            const conflictRecord = {
                field: fieldName,
                detectedValues: candidates.map(c => ({
                    photo: c.photoId,
                    value: c.value
                })),
                message: `Different values detected across photos (Gemini not configured)`,
                confirmedByGemini: false
            };
            merged.conflicts.push(conflictRecord);
            merged.reconciliation.conflicts.push(conflictRecord);
        }
    }

    merged.normalizedFields = { ...merged };

    // Phase 5 Fix 2: Auto-apply Gemini fallback if imageBuffers were provided
    if (imageBuffers && imageBuffers.length > 0) {
        return await applyGeminiFallback(merged, imageBuffers);
    }

    return merged;
};

/**
 * Phase 5 Fix 2: Apply Gemini fallback for low-confidence/undetected fields.
 * Called AFTER merge, on the final merged result, with original image buffers.
 * 
 * Any field recovered here is tagged with:
 *   source: "gemini_fallback"
 *   aiAssisted: true
 * 
 * @param {Object} mergedFields - The merged extraction result
 * @param {Array<{buffer: Buffer, mimetype: string}>} images - Original uploaded images
 * @returns {Promise<Object>} Updated mergedFields with fallback values applied
 */
const applyGeminiFallback = async (mergedFields, images = []) => {
    if (!geminiService.isAvailable() || images.length === 0) {
        return mergedFields;
    }

    // Collect all low-confidence fields across all photos
    const allLowConf = new Set();
    if (Array.isArray(mergedFields._singleExtractions)) {
        mergedFields._singleExtractions.forEach(ext => {
            if (Array.isArray(ext.lowConfidenceFields)) {
                ext.lowConfidenceFields.forEach(f => allLowConf.add(f));
            }
        });
    }
    
    // Also check merged result for not_detected fields
    const fieldsToCheck = [
        { name: 'unitSalePrice', val: mergedFields.unitSalePrice },
        { name: 'manufacturer.name', val: mergedFields.manufacturer?.name },
        { name: 'manufacturer.address', val: mergedFields.manufacturer?.address },
        { name: 'marketer.name', val: mergedFields.marketer?.name },
        { name: 'countryOfOrigin', val: mergedFields.countryOfOrigin },
        { name: 'consumerCare.phone', val: mergedFields.consumerCare?.phone },
        { name: 'genericCommodityName', val: mergedFields.genericCommodityName },
    ];
    
    fieldsToCheck.forEach(({ name, val }) => {
        if (!val) allLowConf.add(name);
    });

    const fieldsToRead = Array.from(allLowConf);
    if (fieldsToRead.length === 0) {
        return mergedFields;
    }

    console.log(`[Gemini Fallback] Attempting to recover ${fieldsToRead.length} field(s):`, fieldsToRead);

    // Use the first image for fallback (usually front of pack)
    // Could be extended to try multiple images if first doesn't work
    const primaryImage = images[0];
    
    try {
        const fallbackResult = await geminiService.fallbackReadFields(
            primaryImage.buffer,
            fieldsToRead,
            primaryImage.mimetype || 'image/jpeg'
        );

        if (fallbackResult.skipped || !fallbackResult.results) {
            return mergedFields;
        }

        // Apply recovered values with AI-assisted provenance
        const recovered = fallbackResult.results;
        let recoveredCount = 0;

        const applyFallback = (fieldPath, value, reasoning) => {
            const parts = fieldPath.split('.');
            let target = mergedFields;
            for (let i = 0; i < parts.length - 1; i++) {
                if (!target[parts[i]]) target[parts[i]] = {};
                target = target[parts[i]];
            }
            const lastKey = parts[parts.length - 1];
            
            // Only apply if the field is currently empty
            if (!target[lastKey]) {
                target[lastKey] = value;
                recoveredCount++;

                // Update declarations if they exist
                if (mergedFields.declarations) {
                    const declKey = parts[0];
                    if (mergedFields.declarations[declKey]) {
                        if (parts.length > 1) {
                            mergedFields.declarations[declKey][lastKey] = value;
                        } else {
                            mergedFields.declarations[declKey].value = value;
                        }
                        mergedFields.declarations[declKey].source = 'gemini_fallback';
                        mergedFields.declarations[declKey].aiAssisted = true;
                        mergedFields.declarations[declKey].status = 'ai_assisted';
                    }
                }

                console.log(`[Gemini Fallback] Recovered ${fieldPath}: "${value}" — ${reasoning}`);
            }
        };

        for (const [field, data] of Object.entries(recovered)) {
            // Phase 6 (Audit Fix): Validate Gemini output against expected schema
            const validated = validateGeminiFieldResult(field, data);
            if (validated) {
                applyFallback(field, validated.value, validated.reasoning);
            } else {
                console.warn(`[Gemini Fallback] Rejected invalid result for "${field}":`, JSON.stringify(data));
            }
        }

        // Track fallback metadata
        if (!mergedFields.geminiMetadata) mergedFields.geminiMetadata = {};
        mergedFields.geminiMetadata.fallback = {
            fieldsAttempted: fieldsToRead,
            fieldsRecovered: Object.keys(recovered),
            recoveredCount
        };

        console.log(`[Gemini Fallback] Recovered ${recoveredCount} of ${fieldsToRead.length} fields`);

    } catch (err) {
        console.error('[Gemini Fallback] Error:', err.message);
    }

    return mergedFields;
};

module.exports = {
    extractFields,
    mergeMultiPhotoExtractedFields,
    applyGeminiFallback
};
