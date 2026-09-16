/**
 * DrishtiScan — Deterministic Fallback Extractor
 * 
 * Degraded fallback pipeline used ONLY when GPT-OSS structuring is unavailable or failed.
 * Contains the deterministic regex rules (sections 1-15) moved from extraction.js.
 * Results are explicitly marked with structuringMode: 'deterministic_fallback'.
 */

const {
    isDateShaped,
    isMarketingBadge,
    isNonProductTitleCandidate,
    isValidQuantityUnit,
    validateFieldFormat,
    KNOWN_COUNTRIES,
    sanitizeExtractedText,
    isGenericCommodityTerm,
    isExplicitCountryDeclaration,
    extractExplicitCountryFromDeclaration
} = require('./textShapeValidators');

const {
    generateCandidateTitles
} = require('./ocrReconstruction');

const COMMODITY_NOUNS = /\b(?:oil|whey|protein|creatine|seeds?|capsules?|tablets?|softgels?|syrup|sauce|ketchup|juice|drink|tea|coffee|biscuit|cookies?|snack|chips|noodles|pasta|flour|atta|rice|dal|salt|sugar|water|cola|soda|paste|spread|jam|butter|ghee|paneer|cheese|milk|curd|yogurt|cereal|oats|muesli|honey|vinegar|shampoo|soap|wash|lotion|cream|powder)\b/i;

/**
 * Extracts structured semantic fields using deterministic regex matching across OCR elements.
 * 
 * @param {Array<Object>} rawElements - Spatially sorted OCR elements
 * @param {Object} structuredRows - Reconstructed visual rows { rows, orderedElements, fullText }
 * @param {Object} imageDimensions - { imageWidth, imageHeight }
 * @param {string} sourceImageId - Photo identifier
 * @returns {Object} { normalizedFields, declarations, validation }
 */
const extractFieldsDeterministic = (rawElements = [], structuredRows = { rows: [] }, imageDimensions = {}, sourceImageId = 'photo-1') => {
    const sourceImageWidth = imageDimensions.imageWidth || 0;
    const sourceImageHeight = imageDimensions.imageHeight || 0;
    const fullText = structuredRows.fullText || rawElements.map(r => r.text || '').join(' ');

    const declarations = {};
    const validation = {};

    const createEvidenceRecord = (value, rawElem, status = 'verified', evidenceList = [], source = 'deterministic_fallback', aiAssisted = false) => {
        const cleanVal = sanitizeExtractedText(value);
        return {
            value: cleanVal,
            rawText: rawElem ? sanitizeExtractedText(rawElem.text) : null,
            confidence: rawElem ? Math.max(0.1, (rawElem.confidence || 0.8) * 0.7) : 0.5, // Visibly lower confidence for fallback
            sourceImageId,
            sourceRegion: { bbox: rawElem ? rawElem.bbox : [] },
            status: cleanVal ? status : 'not_detected',
            evidence: evidenceList.length > 0 ? evidenceList : (rawElem ? [rawElem.text] : []),
            source,
            aiAssisted,
            structuringMode: 'deterministic_fallback',
            reconciledFrom: null
        };
    };

    // Spatial (Bounding-Box) Label-Value Pairing
    const spatialLabelValuePairing = (elements) => {
        const spatialResults = {};
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

        const bboxCenter = (bbox) => {
            if (!bbox || bbox.length < 4) return null;
            const cx = bbox.reduce((s, p) => s + p[0], 0) / bbox.length;
            const cy = bbox.reduce((s, p) => s + p[1], 0) / bbox.length;
            return { x: cx, y: cy };
        };

        const bboxHeight = (bbox) => {
            if (!bbox || bbox.length < 4) return 30;
            const ys = bbox.map(p => p[1]);
            return Math.max(...ys) - Math.min(...ys);
        };

        for (const { pattern, field, valueType } of LABEL_PATTERNS) {
            for (const el of elements) {
                if (!pattern.test(el.text.trim())) continue;
                const labelCenter = bboxCenter(el.bbox);
                if (!labelCenter) continue;
                const lineHeight = bboxHeight(el.bbox);
                const maxVerticalDist = lineHeight * 2.5;
                const maxHorizontalDist = lineHeight * 15;

                let bestCandidate = null;
                let bestDist = Infinity;

                for (const candidate of elements) {
                    if (candidate.index === el.index) continue;
                    const candCenter = bboxCenter(candidate.bbox);
                    if (!candCenter) continue;

                    const candText = candidate.text.trim();
                    if (valueType === 'price') {
                        if (!/\d+(?:\.\d+)?/.test(candText)) continue;
                        if (isDateShaped(candText) || /\d{1,2}:\d{2}/.test(candText) || /^[+\d\s\-().]{7,25}$/.test(candText)) continue;
                    }
                    if (valueType === 'quantity') {
                        if (!/\d/.test(candText) || isDateShaped(candText)) continue;
                    }

                    const dx = candCenter.x - labelCenter.x;
                    const dy = candCenter.y - labelCenter.y;
                    const isSameLine = Math.abs(dy) < maxVerticalDist && dx > 0 && dx < maxHorizontalDist;
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
                break;
            }
        }
        return spatialResults;
    };

    const spatialPairs = spatialLabelValuePairing(rawElements);

    // 1. Country of Origin
    let countryVal = null;
    let countryElem = null;

    for (const el of rawElements) {
        const country = extractExplicitCountryFromDeclaration(el.text);
        if (country) {
            countryVal = country;
            countryElem = el;
            break;
        }
    }
    if (!countryVal && structuredRows?.rows) {
        for (const r of structuredRows.rows) {
            const country = extractExplicitCountryFromDeclaration(r.text);
            if (country) {
                countryVal = country;
                countryElem = r.elements?.[0] || null;
                break;
            }
        }
    }
    if (!countryVal) {
        const country = extractExplicitCountryFromDeclaration(fullText);
        if (country) {
            countryVal = country;
        }
    }
    declarations.countryOfOrigin = createEvidenceRecord(countryVal, countryElem, countryVal ? 'verified' : 'not_detected');
    validation.countryOfOrigin = {
        status: countryVal ? 'verified' : 'not_detected',
        reason: countryVal ? `Verified country: ${countryVal}` : 'No valid country of origin declaration observed'
    };

    // 2. FSSAI License Number (Strict 14-Digit Format)
    let fssaiVal = null;
    let fssaiElem = null;
    const fssaiAll = [];
    const fssaiRegex = /(?:FSSAI|Lic(?:ense)?(?:\s*No)?\.?)\s*[:.-]?\s*([0-9]{14})\b/i;
    for (const el of rawElements) {
        const m = el.text.match(fssaiRegex);
        if (m) {
            if (!fssaiAll.includes(m[1])) fssaiAll.push(m[1]);
            if (!fssaiVal) { fssaiVal = m[1]; fssaiElem = el; }
        }
    }
    for (const el of rawElements) {
        const standalone14 = el.text.match(/\b([12]\d{13})\b/g);
        if (standalone14) {
            for (const num of standalone14) {
                if (!fssaiAll.includes(num)) fssaiAll.push(num);
                if (!fssaiVal) { fssaiVal = num; fssaiElem = el; }
            }
        }
    }
    declarations.fssaiLicense = createEvidenceRecord(fssaiVal, fssaiElem, fssaiVal ? 'verified' : 'not_detected');
    declarations.fssaiLicenseNumber = createEvidenceRecord(fssaiVal, fssaiElem, fssaiVal ? 'verified' : 'not_detected');
    declarations.fssaiLicenses = fssaiAll;
    validation.fssaiLicense = {
        status: fssaiVal ? 'verified' : 'not_detected',
        reason: fssaiAll.length > 1 
            ? `Found ${fssaiAll.length} FSSAI license numbers: ${fssaiAll.join(', ')}`
            : (fssaiVal ? `Valid 14-digit FSSAI license: ${fssaiVal}` : 'No 14-digit FSSAI license detected')
    };

    // 3. Batch / Lot Number
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
        if (/^B\d{4,}$/i.test(line)) {
            batchVal = line;
            batchElem = el;
            break;
        }
        const bMatch = line.match(/(?:Batch(?:\s*No)?|Lot(?:\s*No)?|B\.?\s*No\.?)\s*[:.-]?\s*([A-Za-z0-9/\-_]{3,20})/i);
        if (bMatch) {
            const candidate = bMatch[1].trim();
            if (!BATCH_RESERVED.test(candidate)) {
                batchVal = candidate;
                batchElem = el;
                break;
            }
        }
    }
    declarations.batchNumber = createEvidenceRecord(batchVal, batchElem, batchVal ? 'verified' : 'not_detected');
    validation.batchNumber = {
        status: batchVal ? 'verified' : 'not_detected',
        reason: batchVal ? `Batch: ${batchVal}` : 'Batch/Lot number not detected'
    };

    // 4. Dates: Manufacture, Expiry, Best Before
    let mfgVal = null, expVal = null, bbVal = null;
    let mfgElem = null, expElem = null, bbElem = null;

    for (let i = 0; i < rawElements.length; i++) {
        const text = rawElements[i].text;
        const mfgMatch = text.match(/(?:MFG|MFD|Mfd\.?\s*Date|Packed|PKD|Pkd\.?\s*Date|Date\s*of\s*Mfg|Date\s*of\s*Packaging)\s*[:.-]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}[/]\d{2,4}|[A-Za-z]{3,9}[\s./-]+\d{2,4}|\d{1,2}[\s./-]+[A-Za-z]{3,9}[\s./-]+\d{2,4})/i);
        if (mfgMatch && !mfgVal) {
            mfgVal = mfgMatch[1].trim();
            mfgElem = rawElements[i];
        }
        const expMatch = text.match(/(?:EXP|EXPIRY|Expiry\s*Date|EXP\.?\s*Date|Use\s*By|Use\s*before)\s*[:.-]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}[/]\d{2,4}|[A-Za-z]{3,9}[\s./-]+\d{2,4}|\d{1,2}[\s./-]+[A-Za-z]{3,9}[\s./-]+\d{2,4})/i);
        if (expMatch && !expVal) {
            expVal = expMatch[1].trim();
            expElem = rawElements[i];
        }
        const bbMatch = text.match(/(?:Best\s*Before)\s*[:.-]?\s*([^\n\r,]+)/i);
        if (bbMatch && !bbVal) {
            bbVal = bbMatch[1].trim();
            bbElem = rawElements[i];
        }
    }

    // Two-element date parsing
    for (let i = 0; i < rawElements.length - 1; i++) {
        const current = rawElements[i].text.trim();
        const next = rawElements[i + 1].text.trim();
        const datePattern = /^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}[/]\d{2,4}|[A-Za-z]{3,9}[\s./-]+\d{2,4}|\d{1,2}[\s./-]+[A-Za-z]{3,9}[\s./-]+\d{2,4})$/i;

        if (/(?:MFG|MFD|Packed|PKD)\s*[:.-]?$/i.test(current) && datePattern.test(next) && !mfgVal) {
            mfgVal = next;
            mfgElem = rawElements[i + 1];
        }
        if (/(?:EXP|EXPIRY|Use\s*By)\s*[:.-]?$/i.test(current) && datePattern.test(next) && !expVal) {
            expVal = next;
            expElem = rawElements[i + 1];
        }
    }

    declarations.manufacturingDate = createEvidenceRecord(mfgVal, mfgElem, mfgVal ? 'verified' : 'not_detected');
    declarations.expiryDate = createEvidenceRecord(expVal, expElem, expVal ? 'verified' : 'not_detected');
    declarations.bestBefore = createEvidenceRecord(bbVal, bbElem, bbVal ? 'verified' : 'not_detected');

    validation.manufacturingDate = { status: mfgVal ? 'verified' : 'not_detected', reason: mfgVal ? `Mfg: ${mfgVal}` : 'Mfg date not detected' };
    validation.expiryDate = { status: expVal ? 'verified' : 'not_detected', reason: expVal ? `Exp: ${expVal}` : 'Expiry date not detected' };
    validation.bestBefore = { status: bbVal ? 'verified' : 'not_detected', reason: bbVal ? `Best before: ${bbVal}` : 'Best before not detected' };

    // 5. Unit Sale Price (USP)
    let uspVal = null;
    let uspElem = null;
    const uspRegex = /(?:USP|Unit\s*Sale\s*Price)\s*[:.-]?\s*(?:Rs\.?|INR|₹)?\s*(\d+(?:\.\d+)?\s*(?:\/|\s*per\s*)\s*(?:g|gm|kg|ml|l|ltr|unit|piece|capsule|tablet|tab|cap|softgel))\b/i;
    for (const el of rawElements) {
        const m = el.text.match(uspRegex);
        if (m) {
            uspVal = m[1].trim();
            uspElem = el;
            break;
        }
    }
    if (!uspVal && spatialPairs['unitSalePrice']) {
        const sp = spatialPairs['unitSalePrice'];
        const m = sp.value.match(/(\d+(?:\.\d+)?\s*(?:\/|\s*per\s*)\s*(?:g|gm|kg|ml|l|ltr|unit|piece|capsule|tablet|tab|cap|softgel))\b/i);
        if (m) {
            uspVal = m[1].trim();
            uspElem = sp.valueElement;
        }
    }
    declarations.unitSalePrice = createEvidenceRecord(uspVal, uspElem, uspVal ? 'verified' : 'not_detected');
    validation.unitSalePrice = { status: uspVal ? 'verified' : 'not_detected', reason: uspVal ? `USP: ${uspVal}` : 'USP not detected' };

    // 6. Maximum Retail Price (MRP)
    let mrpVal = null;
    let mrpElem = null;
    let inclTaxes = false;

    const mrpRegex = /(?:MRP|M\.?\s*R\.?\s*P\.?|Max\.?\s*Retail\s*Price)\s*[:.-]?\s*(?:Rs\.?|INR|₹)?\s*(\d{2,5}(?:\.\d{1,2})?)/i;
    for (const el of rawElements) {
        const m = el.text.match(mrpRegex);
        if (m) {
            const num = parseFloat(m[1]);
            if (!isNaN(num) && num > 10 && num < 500000) {
                mrpVal = num;
                mrpElem = el;
                break;
            }
        }
    }
    if (!mrpVal) {
        for (let i = 0; i < rawElements.length; i++) {
            if (/(?:MRP|M\.?\s*R\.?\s*P\.?)\s*[:.-]?$/i.test(rawElements[i].text.trim())) {
                for (let j = 1; j <= 3 && (i + j) < rawElements.length; j++) {
                    const priceMatch = rawElements[i + j].text.match(/(?:Rs\.?|INR|₹)?\s*(\d{2,5}(?:\.\d{1,2})?)/);
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
    if (!mrpVal && spatialPairs['mrp']) {
        const sp = spatialPairs['mrp'];
        const priceMatch = sp.value.match(/(\d+(?:\.\d+)?)/);
        if (priceMatch) {
            const num = parseFloat(priceMatch[1]);
            if (!isNaN(num) && num > 10 && num < 500000) {
                mrpVal = num;
                mrpElem = sp.valueElement;
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
        confidence: mrpElem ? Math.max(0.1, (mrpElem.confidence || 0.8) * 0.7) : 0.5,
        sourceImageId,
        sourceRegion: { bbox: mrpElem ? mrpElem.bbox : [] },
        status: mrpVal ? 'verified' : 'not_detected',
        evidence: mrpElem ? [mrpElem.text] : [],
        structuringMode: 'deterministic_fallback'
    };
    validation.mrp = {
        status: mrpVal ? 'verified' : 'not_detected',
        reason: mrpVal ? `MRP ₹${mrpVal}${inclTaxes ? ' (Inclusive of all taxes)' : ''}` : 'MRP not detected'
    };

    // 7. Servings vs Net Quantity
    let servingsPerContainer = null;
    let servingsElem = null;
    const servingsMatch = fullText.match(/(?:Servings\s*Per\s*Container)\s*[:.-]?\s*(\d+)/i);
    if (servingsMatch) {
        servingsPerContainer = parseInt(servingsMatch[1], 10);
        servingsElem = rawElements.find(r => /Servings\s*Per\s*Container/i.test(r.text)) || null;
    }
    if (!servingsPerContainer) {
        const cleanServingsText = fullText.replace(/(?:net\s*wt\.?|net\s*weight|net\s*quantity)\s*[:.-]?\s*\d+/gi, ' ');
        const standaloneServings = cleanServingsText.match(/\b(\d+)\s*Servings?\b/i);
        if (standaloneServings) {
            servingsPerContainer = parseInt(standaloneServings[1], 10);
            servingsElem = rawElements.find(r => /\d+\s*Servings?\b/i.test(r.text)) || null;
        }
    }
    declarations.servingsPerContainer = createEvidenceRecord(servingsPerContainer, servingsElem, servingsPerContainer ? 'verified' : 'not_detected');

    let servingSize = null;
    let servingSizeElem = null;
    const sizeMatch = fullText.match(/(?:Serving\s*Size)\s*[:.-]?\s*([^\n\r,]+)/i);
    if (sizeMatch) {
        let rawSize = sizeMatch[1].trim();
        const truncateAt = rawSize.search(/\b(?:Energy|Protein|Fat|Carbohydrate|Sugar|Sodium|Fiber|Calories|kcal|How\s*to|Directions|Storage|Store|Keep\s*in|Nutrition|Amount\s*Per|Daily\s*Value|\d+(?:\.\d+)?\s*(?:kcal|mg|mcg))\b/i);
        if (truncateAt > 0) rawSize = rawSize.substring(0, truncateAt).trim();
        if (rawSize.length > 40) {
            const shortMatch = rawSize.match(/^(.{0,40}?)(?:\s+\w{3,}|\s*$)/);
            if (shortMatch) rawSize = shortMatch[1].trim();
            if (rawSize.length > 40) rawSize = rawSize.substring(0, 40).trim();
        }
        rawSize = rawSize.replace(/[:\-|]+\s*$/, '').trim();
        if (rawSize.length >= 2) servingSize = rawSize;
        servingSizeElem = rawElements.find(r => /Serving\s*Size/i.test(r.text)) || null;
    }
    declarations.servingSize = createEvidenceRecord(servingSize, servingSizeElem, servingSize ? 'verified' : 'not_detected');

    let netQtyVal = null;
    let netQtyUnit = null;
    let netQtyElem = null;

    const explicitQtyRegex = /(?:Net\s*(?:Qty|Quantity|Weight|Wt|Vol|Contents)?\.?\s*[:.-]?\s*)(\d+(?:\.\d+)?)(?:\s*(ml|g|kg|l|liter|litre|mg))?\b/i;
    const qtySearchItems = (structuredRows?.rows && structuredRows.rows.length > 0)
        ? structuredRows.rows.map(r => ({ text: r.text, elem: r.elements?.[0] || null })).concat(rawElements.map(e => ({ text: e.text, elem: e })))
        : rawElements.map(e => ({ text: e.text, elem: e }));

    for (const item of qtySearchItems) {
        if (/per\s*serving|amount\s*per|nutrition/i.test(item.text)) continue;
        const eqm = item.text.match(explicitQtyRegex);
        if (eqm) {
            const valCandidate = parseFloat(eqm[1]);
            if (/(?:Net|Weight|Wt|Contents)/i.test(item.text)) {
                netQtyVal = valCandidate;
                netQtyUnit = eqm[2] ? eqm[2].toLowerCase() : null;
                netQtyElem = item.elem;
                break;
            }
        }
    }

    if (!netQtyUnit && netQtyVal) {
        for (const el of rawElements) {
            const um = el.text.match(new RegExp(`(?:${netQtyVal}|Net)\\s*([a-zA-Z]+)`, 'i'));
            if (um && isValidQuantityUnit(um[1])) {
                netQtyUnit = um[1].toLowerCase();
                break;
            }
        }
    }

    if (!netQtyVal && spatialPairs['netQuantity']) {
        const sp = spatialPairs['netQuantity'];
        const eqm = sp.value.match(/(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?/);
        if (eqm) {
            netQtyVal = parseFloat(eqm[1]);
            if (eqm[2] && isValidQuantityUnit(eqm[2])) {
                netQtyUnit = eqm[2].toLowerCase();
            }
            netQtyElem = sp.valueElement;
        }
    }

    declarations.netQuantity = {
        value: netQtyVal ? { value: netQtyVal, unit: netQtyUnit } : null,
        rawText: netQtyElem ? netQtyElem.text : null,
        confidence: netQtyElem ? Math.max(0.1, (netQtyElem.confidence || 0.8) * 0.7) : 0.5,
        sourceImageId,
        sourceRegion: { bbox: netQtyElem ? netQtyElem.bbox : [] },
        status: (netQtyVal && netQtyUnit) ? 'verified' : (netQtyVal ? 'review' : 'not_detected'),
        evidence: netQtyElem ? [netQtyElem.text] : [],
        structuringMode: 'deterministic_fallback'
    };
    validation.netQuantity = {
        status: (netQtyVal && netQtyUnit) ? 'verified' : (netQtyVal ? 'review' : 'not_detected'),
        reason: (netQtyVal && netQtyUnit)
            ? `Net quantity: ${netQtyVal} ${netQtyUnit}`
            : (netQtyVal ? `Net quantity value ${netQtyVal} detected, unit missing or non-standard` : 'Net quantity not detected')
    };

    // 8. Responsible Parties
    let mfrName = null, pkrName = null, impName = null, mktName = null;
    let mfrElem = null;

    const findPartyAfterPrefix = (regex) => {
        for (let i = 0; i < rawElements.length; i++) {
            const m = rawElements[i].text.match(regex);
            if (m && m[1].trim().length > 3) {
                return { name: m[1].trim(), elem: rawElements[i] };
            }
            if (regex.test(rawElements[i].text.trim()) && (i + 1) < rawElements.length) {
                const nextText = rawElements[i + 1].text.trim();
                if (nextText.length > 3 && !/^(?:fssai|lic|batch|mfg|exp|mrp|net)/i.test(nextText)) {
                    return { name: nextText, elem: rawElements[i + 1] };
                }
            }
        }
        return null;
    };

    const mfrRes = findPartyAfterPrefix(/(?:Manufactured\s*By|Mfd\.?\s*By|Mfg\.?\s*By)\s*[:.-]?\s*([^\n\r,]+)/i);
    if (mfrRes) { mfrName = mfrRes.name; mfrElem = mfrRes.elem; }
    const pkrRes = findPartyAfterPrefix(/(?:Packed\s*By|Pkd\.?\s*By)\s*[:.-]?\s*([^\n\r,]+)/i);
    if (pkrRes) { pkrName = pkrRes.name; }
    const impRes = findPartyAfterPrefix(/(?:Imported\s*By|Imp\.?\s*By)\s*[:.-]?\s*([^\n\r,]+)/i);
    if (impRes) { impName = impRes.name; }
    const mktRes = findPartyAfterPrefix(/(?:Marketed\s*By|Mkt\.?\s*By)\s*[:.-]?\s*([^\n\r,]+)/i);
    if (mktRes) { mktName = mktRes.name; }

    declarations.manufacturer = createEvidenceRecord(mfrName, mfrElem, mfrName ? 'verified' : 'not_detected');
    declarations.packer = createEvidenceRecord(pkrName, null, pkrName ? 'verified' : 'not_detected');
    declarations.importer = createEvidenceRecord(impName, null, impName ? 'verified' : 'not_detected');
    declarations.marketer = createEvidenceRecord(mktName, null, mktName ? 'verified' : 'not_detected');

    // 9. Consumer Care
    let carePhone = null, careEmail = null;
    let carePhoneElem = null, careEmailElem = null;

    for (const el of rawElements) {
        const phoneMatch = el.text.match(/(?:(?:Tel|Phone|Call|Ph|Helpline|Toll\s*Free|Care|Contact)\s*[:.-]?\s*)?(\+?91[\s.-]?[6-9]\d{9}|1800[\s.-]?\d{3}[\s.-]?\d{3,4}|0\d{2,4}[\s.-]?\d{6,8}|\b[6-9]\d{9}\b)/i);
        if (phoneMatch && !carePhone && !el.text.includes('14') && phoneMatch[1].length >= 10 && phoneMatch[1].length <= 14) {
            carePhone = phoneMatch[1].replace(/[\s.-]/g, '');
            carePhoneElem = el;
        }
        const emailMatch = el.text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (emailMatch && !careEmail) {
            careEmail = emailMatch[1];
            careEmailElem = el;
        }
    }

    declarations.consumerCare = {
        value: (carePhone || careEmail) ? { phone: carePhone, email: careEmail } : null,
        phone: createEvidenceRecord(carePhone, carePhoneElem, carePhone ? 'verified' : 'not_detected'),
        email: createEvidenceRecord(careEmail, careEmailElem, careEmail ? 'verified' : 'not_detected'),
        status: (carePhone || careEmail) ? 'verified' : 'not_detected',
        structuringMode: 'deterministic_fallback'
    };

    // 10. Ingredients
    let ingredientsText = null;
    if (structuredRows && Array.isArray(structuredRows.rows) && structuredRows.rows.length > 0) {
        const ingRowIndex = structuredRows.rows.findIndex(r => /(?:Ingredients?|Ingredents?|Ngedients?)\s*[:.-]?/i.test(r.text || ''));
        if (ingRowIndex !== -1) {
            const firstRow = structuredRows.rows[ingRowIndex].text;
            const stripped = firstRow.replace(/.*?(?:Ingredients?|Ingredents?|Ngedients?)\s*[:.-]?\s*/i, '').trim();
            let accumulated = stripped;
            for (let i = ingRowIndex + 1; i < structuredRows.rows.length && i < ingRowIndex + 6; i++) {
                const nextRow = (structuredRows.rows[i].text || '').trim();
                if (/\b(?:Manufactured|Marketed|Packed|Imported|Net\s*(?:Qty|Quantity|Wt|Weight)|MRP|Batch|Exp|Best\s*Before|Mfg|Mfd|Nutrition|Storage|Directions|Usage|Caution)\b/i.test(nextRow)) {
                    break;
                }
                if (accumulated.endsWith(',') || accumulated.endsWith(';') || nextRow.includes(',')) {
                    accumulated += ' ' + nextRow;
                } else {
                    break;
                }
            }
            if (accumulated.length > 3) {
                ingredientsText = accumulated.replace(/\b(?:Net\s*(?:Qty|Quantity|Wt|Weight)|MRP|Batch|Exp|Best\s*Before|Mfg|Mfd|Packed|Nutrition|Storage)\b.*/i, '').trim();
            }
        }
    }
    if (!ingredientsText) {
        const ingMatch = fullText.match(/(?:Ingredients?|Ingredents?|Ngedients?)\s*[:.-]?\s*([^\n\r]+)/i);
        if (ingMatch && ingMatch[1].trim().length > 3) {
            ingredientsText = ingMatch[1].replace(/\b(?:Net\s*(?:Qty|Quantity|Wt|Weight)|MRP|Batch|Exp|Best\s*Before|Mfg|Mfd|Packed|Nutrition|Storage|Directions|Usage)\b.*/i, '').trim();
        }
    }
    declarations.ingredients = createEvidenceRecord(ingredientsText, null, ingredientsText ? 'verified' : 'not_detected');

    // 11. Nutrition Facts
    const nutritionFacts = { calories: null, fat: null, sugar: null, protein: null, sodium: null, carbohydrates: null, fiber: null };
    const calMatch = fullText.match(/(?:Energy|Calories|Calorie)\s*[:.-]?\s*(\d+(?:\.\d+)?)\s*(?:kcal|cal)?/i);
    if (calMatch) nutritionFacts.calories = parseFloat(calMatch[1]);
    const proteinMatch = fullText.match(/(?:Protein|Proteins)\s*[:.-]?\s*(\d+(?:\.\d+)?)\s*g/i);
    if (proteinMatch) nutritionFacts.protein = parseFloat(proteinMatch[1]);
    const fatMatch = fullText.match(/(?:Total Fat|Fat)\s*[:.-]?\s*(\d+(?:\.\d+)?)\s*g/i);
    if (fatMatch) nutritionFacts.fat = parseFloat(fatMatch[1]);
    const sugarMatch = fullText.match(/(?:Total Sugars|Sugars|Sugar|Added Sugars)\s*[:.-]?\s*(\d+(?:\.\d+)?)\s*g/i);
    if (sugarMatch) nutritionFacts.sugar = parseFloat(sugarMatch[1]);
    const sodiumMatch = fullText.match(/(?:Sod[il1]um|Salt)\s*[:.-]?\s*(\d+(?:\.\d+)?)\s*(mg|g)/i);
    if (sodiumMatch) {
        const v = parseFloat(sodiumMatch[1]);
        nutritionFacts.sodium = sodiumMatch[2].toLowerCase() === 'g' ? v * 1000 : v;
    }
    const carbMatch = fullText.match(/(?:Carbohydrate|Carbohydrates|Carbs)\s*[:.-]?\s*(\d+(?:\.\d+)?)\s*g/i);
    if (carbMatch) nutritionFacts.carbohydrates = parseFloat(carbMatch[1]);
    const fiberMatch = fullText.match(/(?:Dietary Fiber|Fiber|Dietary Fibre)\s*[:.-]?\s*(\d+(?:\.\d+)?)\s*g/i);
    if (fiberMatch) nutritionFacts.fiber = parseFloat(fiberMatch[1]);
    declarations.nutritionFacts = nutritionFacts;

    // 12. Product Name
    let prodName = null;
    let prodNameElem = null;

    const scoreProductCandidate = (elem) => {
        const text = elem.text.trim();
        let score = 0;
        score += (elem.confidence || 0.8) * 15;

        const heights = rawElements.map(e => {
            if (!e.bbox || e.bbox.length < 4) return 20;
            const ys = e.bbox.map(p => p[1]);
            return Math.max(...ys) - Math.min(...ys);
        }).filter(h => h > 5);
        heights.sort((a, b) => a - b);
        const medianHeight = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 20;
        
        let elemHeight = 20;
        let elemCenterY = 0;
        if (elem.bbox && elem.bbox.length >= 4) {
            const ys = elem.bbox.map(p => p[1]);
            elemHeight = Math.max(...ys) - Math.min(...ys);
            elemCenterY = (Math.max(...ys) + Math.min(...ys)) / 2;
        }
        const heightRatio = elemHeight / medianHeight;
        score += Math.min(heightRatio, 3.5) * 10;

        const words = text.split(/\s+/);
        if (words.length >= 2 && words.length <= 6) score += 20;
        else if (words.length === 1) score += 8;
        else if (words.length > 6) score -= 15;

        if (/^[A-Z][a-z0-9%]+(?:\s+[A-Z0-9%][a-z0-9%]*)*$/.test(text)) score += 10;
        else if (/^[A-Z0-9\s&'%.-]+$/.test(text)) score += 8;

        if (COMMODITY_NOUNS.test(text)) score += 25;
        if (/\b(?:foods|labs|pharma|nutrition|mills|beverages|industries|farms|grains|enterprises|brands|corporation|company)\b/i.test(text)) {
            score -= 15;
        }

        const maxImgY = Math.max(...rawElements.flatMap(e => (e.bbox || []).map(p => p[1])), 1000);
        if (elemCenterY > 0 && maxImgY > 0) {
            const relY = elemCenterY / maxImgY;
            if (relY < 0.60) score += 10;
            else if (relY > 0.80) score -= 10;
        }

        return { text, score, heightRatio, elemHeight };
    };

    const validTitleCandidates = generateCandidateTitles(structuredRows, rawElements);
    if (validTitleCandidates.length > 0) {
        const scoredCandidates = validTitleCandidates.map(c => ({
            candidate: c,
            ...scoreProductCandidate(c)
        }));
        scoredCandidates.sort((a, b) => b.score - a.score);
        if (scoredCandidates[0].score >= 60) {
            prodName = scoredCandidates[0].candidate.text.trim();
            prodNameElem = scoredCandidates[0].candidate;
        }
    }

    if (prodName && (isDateShaped(prodName) || isMarketingBadge(prodName) || isNonProductTitleCandidate(prodName))) {
        prodName = null;
        prodNameElem = null;
    }

    // 13. Brand Name
    let brandNameVal = null;
    let brandNameElem = null;
    const possibleBrandFromParty = mfrName || mktName;

    const brandCandidates = rawElements.filter(el => {
        const tr = el.text.trim();
        if (tr.length < 4 || tr.length > 40) return false;
        if (isMarketingBadge(tr) || isDateShaped(tr) || isNonProductTitleCandidate(tr) || isGenericCommodityTerm(tr)) return false;
        if (/^(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/i.test(tr)) return false;
        if (/^(?:COMPANY|CORP|CORPORATION|LIMITED|LTD|PVT|LLC|INC)$/i.test(tr)) return false;
        if (/servings?$/i.test(tr) || /ingredients?$/i.test(tr) || /ingredents?$/i.test(tr) || /ceutical/i.test(tr)) return false;
        if (/\b(?:and|or|with|of|for|the|in|on|at|to)$/i.test(tr)) return false;
        if (/^(?:and|or|with|of|for|the|in|on|at|to)\b/i.test(tr)) return false;
        if (/\b(?:heart|skin|joints?|bones?|immunity|brain|eyes?|hair|muscle)\b/i.test(tr)) return false;
        if (/\b(?:fat|sugars?|carbohydrates?|protein|energy|cholesterol|potassium|calcium|iron|vitamin|mineral|capsules?|tablets?|softgels?|nutraceutical|rda)\b/i.test(tr)) return false;
        if (/\b(?:sod[il1]um|potass[il1]um|calc[il1]um|magn[il1]es[il1]um)\b/i.test(tr)) return false;
        if (/\b(?:total|added|trans|saturated|monounsaturated|polyunsaturated)\b/i.test(tr)) return false;
        if (/^(?:nutrition|ingredients?|ngedients?|mrp|net|exp|mfg|lic|fssai|batch|pkg|servings?|quantity|energy|protein|fat|carbohydrate|sugar|sod[il1]um|cholesterol|acid|fatty|fiber|dietary|kcal|calories|usp|rs\.?|price|unit\s*sale|how\s*to|directions?|storage|store|keep|allergen|warning|caution|recommen|usage|dosage|suggested|guideline|supplement|customer|consumer|care|contact|feedback|process|facility|manufactur|product|contain|council|percent|table|approx|capsule|tablet|softgel|bottle|pack)/i.test(tr)) return false;
        if (/^\d+(?:\.\d+)?$/.test(tr)) return false;
        if (/^[A-Z]{2,6}\d{4,10}$/i.test(tr)) return false;
        if (/^\d{14}$/.test(tr)) return false;
        const words = tr.split(/\s+/);
        if (words.length > 4) return false;
        const isUpperOrTitle = /^[A-Z][A-Z\s.-]+$/.test(tr) || /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/.test(tr);
        return isUpperOrTitle;
    });

    if (possibleBrandFromParty) {
        const partyWords = possibleBrandFromParty.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const matchingCandidate = brandCandidates.find(c => {
            const cLower = c.text.trim().toLowerCase();
            return partyWords.some(pw => cLower.includes(pw) || pw.includes(cLower));
        });
        if (matchingCandidate) {
            brandNameVal = matchingCandidate.text.trim();
            brandNameElem = matchingCandidate;
        } else {
            const cleanPartyBrand = possibleBrandFromParty
                .replace(/^(?:the|©?\s*\d{4})\s+/i, '')
                .replace(/\s+(?:company|corp|corporation|ltd|limited|pvt|llc|inc)\b.*/i, '')
                .trim();
            if (cleanPartyBrand.length >= 3 && !isMarketingBadge(cleanPartyBrand) && !isDateShaped(cleanPartyBrand)) {
                brandNameVal = cleanPartyBrand;
                brandNameElem = mfrElem;
            }
        }
    }

    if (!brandNameVal && brandCandidates.length > 0) {
        const elemHeights = rawElements.map(e => {
            if (!e.bbox || e.bbox.length < 4) return 20;
            const ys = e.bbox.map(p => p[1]);
            return Math.max(...ys) - Math.min(...ys);
        }).filter(h => h > 5);
        elemHeights.sort((a, b) => a - b);
        const medianH = elemHeights.length > 0 ? elemHeights[Math.floor(elemHeights.length / 2)] : 20;

        let bestArea = 0;
        for (const c of brandCandidates) {
            if (c.bbox && c.bbox.length >= 4) {
                const xs = c.bbox.map(p => p[0]);
                const ys = c.bbox.map(p => p[1]);
                const cHeight = Math.max(...ys) - Math.min(...ys);
                if (cHeight < medianH * 1.25 && cHeight < 24) continue;
                const area = (Math.max(...xs) - Math.min(...xs)) * cHeight;
                if (area > bestArea) {
                    bestArea = area;
                    brandNameVal = c.text.trim();
                    brandNameElem = c;
                }
            }
        }
    }

    if (brandNameVal && (isDateShaped(brandNameVal) || isMarketingBadge(brandNameVal) || isNonProductTitleCandidate(brandNameVal) || isGenericCommodityTerm(brandNameVal))) {
        brandNameVal = null;
        brandNameElem = null;
    }

    // Brand / Product collision separation
    if (brandNameVal && prodName && brandNameVal.toLowerCase().trim() === prodName.toLowerCase().trim()) {
        const nextProductCandidates = rawElements.filter(el => {
            const tr = el.text.trim();
            if (tr.length < 3 || tr.length > 60) return false;
            if (tr.toLowerCase() === brandNameVal.toLowerCase()) return false;
            if (isMarketingBadge(tr) || isDateShaped(tr) || isNonProductTitleCandidate(tr)) return false;
            return true;
        }).map(c => ({ candidate: c, ...scoreProductCandidate(c) }));
        
        nextProductCandidates.sort((a, b) => b.score - a.score);
        if (nextProductCandidates.length > 0 && nextProductCandidates[0].score >= 45) {
            prodName = nextProductCandidates[0].candidate.text.trim();
            prodNameElem = nextProductCandidates[0].candidate;
        }
    }

    if (brandNameVal && prodName) {
        const brandNorm = brandNameVal.toLowerCase().trim();
        const prodNorm = prodName.toLowerCase().trim();
        if (prodNorm.startsWith(brandNorm) && prodNorm.length > brandNorm.length) {
            const stripped = prodName.slice(brandNameVal.length).replace(/^[\s:-]+/, '').trim();
            if (stripped.length >= 3 && !isDateShaped(stripped) && !isMarketingBadge(stripped) && !isNonProductTitleCandidate(stripped)) {
                prodName = stripped;
            }
        }
    }

    declarations.productName = createEvidenceRecord(prodName, prodNameElem, prodName ? 'verified' : 'not_detected');
    declarations.brandName = createEvidenceRecord(brandNameVal, brandNameElem, brandNameVal ? 'verified' : 'not_detected');

    // 14. Generic Commodity Name
    let genericCommodityNameVal = null;
    let genericCommodityNameElem = null;
    const genericNameLabelRegex = /(?:Common\s*(?:Name|Commodity)|Generic\s*Name|Name\s*of\s*(?:the\s*)?(?:Food|Product|Commodity))\s*[:.-]?\s*(.+)/i;
    for (const el of rawElements) {
        const gnm = el.text.match(genericNameLabelRegex);
        if (gnm && gnm[1].trim().length > 2) {
            const candidate = gnm[1].trim();
            const truncated = candidate.replace(/\b(?:Manufactured|Marketed|Packed|Imported|FSSAI|Net|MRP|Batch|Exp|Best|Country)\b.*/i, '').trim();
            if (truncated.length > 2 && !isMarketingBadge(truncated) && !isDateShaped(truncated)) {
                genericCommodityNameVal = truncated;
                genericCommodityNameElem = el;
                break;
            }
        }
    }
    declarations.genericCommodityName = createEvidenceRecord(genericCommodityNameVal, genericCommodityNameElem, genericCommodityNameVal ? 'verified' : 'not_detected');

    // 15. Post-Extraction Format Validation
    const netQtyValidation = validateFieldFormat('netQuantity', netQtyVal ? { value: netQtyVal, unit: netQtyUnit } : netQtyElem?.text);
    if (!netQtyValidation.valid) {
        netQtyVal = null;
        netQtyUnit = null;
        declarations.netQuantity.value = null;
        declarations.netQuantity.status = 'review';
    }

    const datesMfgValidation = validateFieldFormat('dates.manufacture', mfgVal);
    if (!datesMfgValidation.valid && mfgVal) {
        mfgVal = null;
        declarations.manufacturingDate.value = null;
        declarations.manufacturingDate.status = 'review';
    }

    const datesExpValidation = validateFieldFormat('dates.expiry', expVal);
    if (!datesExpValidation.valid && expVal) {
        expVal = null;
        declarations.expiryDate.value = null;
        declarations.expiryDate.status = 'review';
    }

    const batchValidation = validateFieldFormat('batchNumber', batchVal);
    if (!batchValidation.valid && batchVal) {
        batchVal = null;
        declarations.batchNumber.value = null;
        declarations.batchNumber.status = 'review';
    }

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
        structuringMode: 'deterministic_fallback'
    };

    declarations.structuringMode = 'deterministic_fallback';

    return {
        ...normalizedFields,
        normalizedFields,
        declarations,
        validation
    };
};

module.exports = {
    extractFieldsDeterministic
};
