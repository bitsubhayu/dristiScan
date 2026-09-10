const Rule = require('../models/Rule');

/**
 * Evaluates extracted package declarations against Legal Metrology Rules (2011 + Amendments).
 * 
 * Strict compliance states:
 * - COMPLIANT: All mandatory declarations are present, valid, and satisfy applicable rules.
 * - NON_COMPLIANT: A rule has a clear, evidence-backed violation.
 * - POTENTIAL_NON_COMPLIANCE: Meaningful evidence of discrepancy across photos or potential violation.
 * - REVIEW: Ambiguity, glare, or uncertainty requiring human officer verification.
 * - INSUFFICIENT_EVIDENCE: Mandatory declarations are missing or image is unreadable.
 *
 * @param {Object} extracted - The structured canonical JSON from the extraction service.
 * @returns {Promise<Object>} Evaluated regulatory findings and overall compliance status.
 */
const mongoose = require('mongoose');

const DEFAULT_FALLBACK_RULES = [
    { ruleCode: 'LM-01', field: 'manufacturerPackerImporterDetails', validation: { type: 'party_details' } },
    { ruleCode: 'LM-02', field: 'countryOfOrigin', validation: { type: 'country_of_origin' } },
    { ruleCode: 'LM-03', field: 'commonGenericCommodityName', validation: { type: 'generic_name' } },
    { ruleCode: 'LM-04', field: 'netQuantity', validation: { type: 'net_quantity' } },
    { ruleCode: 'LM-05', field: 'mrp', validation: { type: 'mrp' } },
    { ruleCode: 'LM-06', field: 'manufacturePrepackingImportDate', validation: { type: 'conditional_date' } },
    { ruleCode: 'LM-07', field: 'expiryDate', validation: { type: 'conditional_presence' } },
    { ruleCode: 'LM-08', field: 'consumerCareDetails', validation: { type: 'consumer_care' } },
    { ruleCode: 'LM-09', field: 'unitSalePrice', validation: { type: 'unit_sale_price' } },
    { ruleCode: 'LM-10', field: 'batchLotNumber', validation: { type: 'presence' } },
    { ruleCode: 'EX-01', field: 'exemptionSmallPackage', validation: { type: 'exemption' } },
];

/**
 * Parses date string (e.g. "03/2026", "MAR 2026", "15-03-2026") to month and year indices
 * for chronological cross-validation.
 */
const parseDateToMonthYear = (dStr) => {
    if (!dStr) return null;
    const months = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
    const tm = String(dStr).match(/([A-Za-z]{3})[\s./-]*(\d{2,4})/);
    if (tm) {
        const m = months[tm[1].toUpperCase()];
        let y = parseInt(tm[2], 10);
        if (y < 100) y += 2000;
        if (m && y) return { month: m, year: y, totalMonths: y * 12 + m };
    }
    const my = String(dStr).match(/(\d{1,2})[/](\d{4})/);
    if (my) {
        const m = parseInt(my[1], 10);
        const y = parseInt(my[2], 10);
        if (m >= 1 && m <= 12 && y) return { month: m, year: y, totalMonths: y * 12 + m };
    }
    const full = String(dStr).match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (full) {
        const m = parseInt(full[2], 10);
        const y = parseInt(full[3], 10);
        if (m >= 1 && m <= 12 && y) return { month: m, year: y, totalMonths: y * 12 + m };
    }
    return null;
};

const evaluateRules = async (extracted) => {
    let rules = [];
    try {
        if (mongoose.connection && mongoose.connection.readyState === 1) {
            rules = await Rule.find({
                $or: [
                    { effectiveTo: null },
                    { effectiveTo: { $gte: new Date() } }
                ],
                effectiveFrom: { $lte: new Date() }
            });
        }
    } catch (err) {
        console.error('[Rule Engine DB Error]:', err.message);
    }

    if (!rules || rules.length === 0) {
        rules = DEFAULT_FALLBACK_RULES;
    }

    const findings = [];
    const fields = extracted.normalizedFields || extracted;
    const rawOcr = extracted.rawOcrText || [];
    const totalDetectedElements = Array.isArray(rawOcr) ? rawOcr.length : 0;
    const declarations = extracted.declarations || fields.declarations || {};

    // Safety check: Completely unreadable or blank image with zero OCR text
    const isUnreadable = totalDetectedElements === 0;

    for (const rule of rules) {
        let status = 'NOT_APPLICABLE';
        let extractedValue = null;
        let reason = '';
        let confidence = 0.85;
        let evidenceBbox = [];

        const code = rule.ruleCode;
        const valType = rule.validation?.type;

        // ---------------------------------------------------------
        // A. Rule 26 Exemptions (EX-01 through EX-07)
        // ---------------------------------------------------------
        if (code.startsWith('EX-') || valType === 'exemption') {
            if (code === 'EX-01') {
                // Net weight/vol <= 10g / 10ml
                if (fields.netQuantity?.value !== null && fields.netQuantity?.value <= 10 && ['g', 'ml'].includes(fields.netQuantity?.unit)) {
                    status = 'PASS';
                    extractedValue = `${fields.netQuantity.value} ${fields.netQuantity.unit}`;
                    reason = 'Package is <= 10g / 10ml; Rule 26 small package exemption applies.';
                } else {
                    status = 'NOT_APPLICABLE';
                    reason = 'Standard package size; small package exemption does not apply.';
                }
            } else if (code === 'EX-06') {
                // Package > 25 kg / 25 l
                if (fields.netQuantity?.value !== null && fields.netQuantity?.value > 25 && ['kg', 'l'].includes(fields.netQuantity?.unit)) {
                    status = 'PASS';
                    extractedValue = `${fields.netQuantity.value} ${fields.netQuantity.unit}`;
                    reason = 'Package exceeds 25kg/25L; wholesale exemption applies.';
                } else {
                    status = 'NOT_APPLICABLE';
                    reason = 'Standard consumer retail size; wholesale exemption does not apply.';
                }
            } else {
                // Non-standard exemptions (hotel food, handloom, DPCO, loose garment)
                status = 'NOT_APPLICABLE';
                reason = 'Condition not triggered for standard retail packaged commodity.';
            }
        }

        // ---------------------------------------------------------
        // B. Mandatory Legal Metrology Declarations (LM-01 to LM-17)
        // ---------------------------------------------------------
        else if (code === 'LM-01' || valType === 'party_details') {
            // Manufacturer / Packer / Importer Name & Address
            const mfr = fields.manufacturer?.name;
            const pkr = fields.packer?.name;
            const imp = fields.importer?.name;
            const mkt = fields.marketer?.name;
            const party = mfr || pkr || imp || mkt;

            if (party) {
                status = 'PASS';
                extractedValue = party;
                reason = `Declared responsible party: ${party}`;
            } else {
                status = isUnreadable ? 'INSUFFICIENT_EVIDENCE' : 'INSUFFICIENT_EVIDENCE';
                reason = 'Manufacturer, packer, or importer declaration could not be established from available evidence.';
            }
        }

        else if (code === 'LM-02' || (code === 'LM-02' && valType === 'conditional_presence')) {
            // Country of Origin
            const coo = fields.countryOfOrigin;
            if (coo) {
                status = 'PASS';
                extractedValue = coo;
                reason = `Country of Origin declared as ${coo}`;
            } else {
                status = 'INSUFFICIENT_EVIDENCE';
                reason = 'Country of origin declaration not detected on visible packaging panels.';
            }
        }

        else if (code === 'LM-03') {
            // Generic / Common Name (Legal Metrology requires a generic commodity declaration)
            const genericName = fields.genericCommodityName || fields.productName;
            if (genericName) {
                status = 'PASS';
                extractedValue = genericName;
                reason = `Common / Generic commodity name declared as: ${genericName}`;
                if (!fields.genericCommodityName && fields.productName) {
                    reason += ' (using product name as fallback — separate generic name not detected)';
                }
            } else {
                status = 'INSUFFICIENT_EVIDENCE';
                reason = 'Common or generic name of commodity not established from title evidence.';
            }
        }

        else if (code === 'LM-04' || valType === 'net_quantity') {
            // Net Quantity (Weight, Volume, or Count of Commodity)
            const nq = fields.netQuantity;
            const servings = fields.servingsPerContainer;
            const servingSize = fields.servingSize;

            if (nq && nq.value !== null && nq.unit !== null) {
                status = 'PASS';
                extractedValue = `${nq.value} ${nq.unit}`;
                reason = `Net quantity declared in standard metric units: ${nq.value} ${nq.unit}`;

                // Cross-field arithmetic validation: netQuantity vs servingSize & servingsPerContainer
                if (servings !== null && servings !== undefined) {
                    let servingSizeNum = null;
                    if (typeof servingSize === 'number') {
                        servingSizeNum = servingSize;
                    } else if (typeof servingSize === 'string') {
                        const m = servingSize.match(/(\d+(?:\.\d+)?)/);
                        if (m) servingSizeNum = parseFloat(m[1]);
                    }

                    if (servingSizeNum && servingSizeNum > 0 && ['g', 'ml'].includes((nq.unit || '').toLowerCase())) {
                        const expectedServings = nq.value / servingSizeNum;
                        const ratio = servings / expectedServings;
                        // Discrepancy > 25% (i.e. ratio < 0.75 or ratio > 1.25)
                        if (ratio < 0.75 || ratio > 1.25) {
                            status = 'REVIEW';
                            reason = `Discrepancy detected: Servings per container (${servings}) does not match net quantity (${nq.value}${nq.unit}) / serving size (${servingSizeNum}g) = ~${Math.round(expectedServings)} expected servings.`;
                        } else {
                            reason += ` (Plausibility verified: ${nq.value}${nq.unit} ÷ ${servingSizeNum}g ≈ ${Math.round(expectedServings)} servings, matching declared ${servings})`;
                        }
                    }
                }
            } else if (fields.servingsPerContainer !== null && (!nq || nq.value === null)) {
                // Servings was detected, but standard net quantity is missing!
                status = 'INSUFFICIENT_EVIDENCE';
                reason = 'Package declares dietary servings, but standard net quantity (weight/count/volume) is missing or unverified.';
            } else {
                status = 'INSUFFICIENT_EVIDENCE';
                reason = 'Net quantity declaration could not be established from available package photos.';
            }
        }

        else if (code === 'LM-05' || valType === 'mrp') {
            // Maximum Retail Price
            const mrp = fields.mrp;
            if (mrp && mrp.value !== null) {
                if (mrp.inclusiveOfTaxes) {
                    status = 'PASS';
                    extractedValue = `₹${mrp.value} (Inclusive of all taxes)`;
                    reason = `MRP declared compliant with tax inclusion statement.`;
                } else {
                    status = 'REVIEW';
                    extractedValue = `₹${mrp.value}`;
                    reason = 'MRP detected, but "Inclusive of all taxes" statement was not explicitly observed in available views.';
                }
            } else {
                status = 'INSUFFICIENT_EVIDENCE';
                reason = 'MRP declaration could not be established from available evidence.';
            }
        }

        else if (code === 'LM-06' || valType === 'conditional_date') {
            // Date of Manufacture / Packing / Import
            const mfg = fields.dates?.manufacture;
            const exp = fields.dates?.expiry || fields.dates?.bestBefore;
            if (mfg) {
                status = 'PASS';
                extractedValue = mfg;
                reason = `Manufacturing / packing date declared: ${mfg}`;

                // Chronological validation if expiry date is also present
                if (exp) {
                    const mfgParsed = parseDateToMonthYear(mfg);
                    const expParsed = parseDateToMonthYear(exp);
                    if (mfgParsed && expParsed) {
                        if (mfgParsed.totalMonths >= expParsed.totalMonths) {
                            status = 'POTENTIAL_NON_COMPLIANCE';
                            reason = `Invalid chronological sequence: Manufacturing date (${mfg}) is equal to or later than expiry date (${exp}).`;
                        } else {
                            const shelfLifeMonths = expParsed.totalMonths - mfgParsed.totalMonths;
                            if (shelfLifeMonths > 60) {
                                status = 'REVIEW';
                                reason = `Unusually long shelf life (${shelfLifeMonths} months) between mfg (${mfg}) and exp (${exp}). Officer review required.`;
                            }
                        }
                    }
                }
            } else {
                status = 'INSUFFICIENT_EVIDENCE';
                reason = 'Month and year of manufacture or prepacking could not be established from visible panels.';
            }
        }

        else if (code === 'LM-07') {
            // Best Before / Expiry Date
            const exp = fields.dates?.expiry || fields.dates?.bestBefore;
            const mfg = fields.dates?.manufacture;
            if (exp) {
                status = 'PASS';
                extractedValue = exp;
                reason = `Best before / use-by declaration detected: ${exp}`;

                // Chronological validation if mfg date is also present
                if (mfg) {
                    const mfgParsed = parseDateToMonthYear(mfg);
                    const expParsed = parseDateToMonthYear(exp);
                    if (mfgParsed && expParsed) {
                        if (mfgParsed.totalMonths >= expParsed.totalMonths) {
                            status = 'POTENTIAL_NON_COMPLIANCE';
                            reason = `Invalid chronological sequence: Expiry date (${exp}) is before or equal to manufacturing date (${mfg}).`;
                        } else {
                            const shelfLifeMonths = expParsed.totalMonths - mfgParsed.totalMonths;
                            if (shelfLifeMonths > 60) {
                                status = 'REVIEW';
                                reason = `Unusually long shelf life (${shelfLifeMonths} months) between mfg (${mfg}) and exp (${exp}).`;
                            }
                        }
                    }
                }
            } else {
                status = 'INSUFFICIENT_EVIDENCE';
                reason = 'Best before or use-by declaration not detected on scanned panels.';
            }
        }

        else if (code === 'LM-08' || valType === 'consumer_care') {
            // Consumer Care Details
            const phone = fields.consumerCare?.phone;
            const email = fields.consumerCare?.email;
            if (phone || email) {
                status = 'PASS';
                extractedValue = [phone, email].filter(Boolean).join(', ');
                reason = `Consumer care contact provided: ${extractedValue}`;
            } else {
                status = 'INSUFFICIENT_EVIDENCE';
                reason = 'Consumer care telephone or email contact details could not be established.';
            }
        }

        else if (code === 'LM-09' || valType === 'unit_sale_price') {
            // Unit Sale Price (USP)
            const usp = fields.unitSalePrice;
            const mrp = fields.mrp;
            const nq = fields.netQuantity;

            if (usp) {
                status = 'PASS';
                extractedValue = usp;
                reason = `Unit Sale Price declared: ${usp}`;

                // Cross-field arithmetic validation against MRP ÷ Net Qty
                if (mrp?.value && nq?.value && nq.value > 0) {
                    const uspMatch = String(usp).match(/(?:₹|Rs\.?|INR)?\s*(\d+(?:\.\d+)?)/i);
                    if (uspMatch) {
                        const declaredUspVal = parseFloat(uspMatch[1]);
                        const isPer100g = /100\s*(?:g|ml)/i.test(usp);
                        const isPerGram = /\b(?:g|gm|gram|ml)\b/i.test(usp) && !isPer100g;
                        const isPerKg = /\b(?:kg|kilo|liter|l)\b/i.test(usp);

                        let expectedUsp = null;
                        if (isPer100g) {
                            expectedUsp = (mrp.value / nq.value) * 100;
                        } else if (isPerGram) {
                            expectedUsp = mrp.value / nq.value;
                        } else if (isPerKg) {
                            const nqInKg = ['g', 'ml'].includes((nq.unit || '').toLowerCase()) ? nq.value / 1000 : nq.value;
                            expectedUsp = mrp.value / nqInKg;
                        }

                        if (expectedUsp !== null && declaredUspVal > 0) {
                            const diffRatio = Math.abs(declaredUspVal - expectedUsp) / expectedUsp;
                            if (diffRatio > 0.15) { // more than 15% discrepancy
                                status = 'REVIEW';
                                reason = `Unit Sale Price discrepancy: Declared (${usp}) differs from calculated rate (₹${expectedUsp.toFixed(2)} based on MRP ₹${mrp.value} and ${nq.value}${nq.unit}).`;
                            } else {
                                reason += ` (Verified: matches calculated ₹${expectedUsp.toFixed(2)} within tolerance)`;
                            }
                        }
                    }
                }
            } else {
                // If package contains > 1 unit or weight > 100g, USP is recommended/required
                status = 'REVIEW';
                reason = 'Unit sale price declaration not observed on visible package panels.';
            }
        }

        else if (code === 'LM-12' || valType === 'visual_readability') {
            // Legibility & Character Readability
            if (isUnreadable) {
                status = 'INSUFFICIENT_EVIDENCE';
                reason = 'Image is unreadable or contains no detectable text declarations.';
            } else {
                status = 'PASS';
                extractedValue = `${totalDetectedElements} elements legible`;
                reason = 'Package text lines are legible and clear for automated reading.';
            }
        }

        else {
            // Generic rules not applicable to this physical retail form
            status = 'NOT_APPLICABLE';
            reason = 'Rule requirement does not apply to this packaged commodity form.';
        }

        // ---------------------------------------------------------
        // C. Uncertainty & Provenance Propagation from Declarations
        // ---------------------------------------------------------
        const RULE_DECLARATION_MAP = {
            'LM-01': ['manufacturer', 'packer', 'importer'],
            'LM-02': ['countryOfOrigin'],
            'LM-03': ['genericCommodityName', 'productName'],
            'LM-04': ['netQuantity'],
            'LM-05': ['mrp'],
            'LM-06': ['manufactureDate'],
            'LM-07': ['expiryDate'],
            'LM-08': ['consumerCare'],
            'LM-09': ['unitSalePrice'],
            'LM-10': ['batchNumber']
        };

        const declKeys = RULE_DECLARATION_MAP[code] || [];
        const declObj = declKeys.map(k => declarations[k]).find(Boolean);
        if (declObj && status === 'PASS') {
            if (declObj.status === 'unverified' || declObj.needsReview === true || (typeof declObj.confidence === 'number' && declObj.confidence < 0.65)) {
                status = 'REVIEW';
                const confDisplay = typeof declObj.confidence === 'number' ? `${Math.round(declObj.confidence * 100)}%` : 'unverified';
                reason += ` [Officer Review Required: Field declaration carries uncertainty (${confDisplay} confidence).]`;
            }
        }

        findings.push({
            ruleCode: rule.ruleCode,
            field: rule.field,
            status: status,
            confidence: confidence,
            extractedValue: extractedValue,
            reason: reason,
            sourceReference: rule.sourceReference || 'Legal Metrology (Packaged Commodities) Rules, 2011',
            severity: rule.severity || 'medium'
        });
    }

    // -------------------------------------------------------------
    // Logical Overall Status Calculation
    // -------------------------------------------------------------
    let overallStatus = 'COMPLIANT';

    const failFindings = findings.filter(f => f.status === 'FAIL');
    const potentialFailFindings = findings.filter(f => f.status === 'POTENTIAL_NON_COMPLIANCE');
    const reviewFindings = findings.filter(f => f.status === 'REVIEW');
    const insufficientFindings = findings.filter(f => f.status === 'INSUFFICIENT_EVIDENCE');
    const passFindings = findings.filter(f => f.status === 'PASS');

    // Multi-photo conflicts force POTENTIAL_NON_COMPLIANCE
    const hasConflicts = Array.isArray(extracted.conflicts) && extracted.conflicts.length > 0;

    if (failFindings.length > 0) {
        overallStatus = 'NON_COMPLIANT';
    } else if (hasConflicts || potentialFailFindings.length > 0) {
        overallStatus = 'POTENTIAL_NON_COMPLIANCE';
    } else if (isUnreadable || (passFindings.length === 0 && insufficientFindings.length > 0)) {
        overallStatus = 'INSUFFICIENT_EVIDENCE';
    } else if (insufficientFindings.length > 0 || reviewFindings.length > 0) {
        // If core mandatory declarations (MRP, Net Qty, Mfg Date) are missing
        const coreMissing = findings.some(f => 
            ['mrp', 'netQuantity', 'manufacturePrepackingImportDate'].includes(f.field) && 
            f.status === 'INSUFFICIENT_EVIDENCE'
        );
        overallStatus = coreMissing ? 'INSUFFICIENT_EVIDENCE' : 'REVIEW';
    } else {
        overallStatus = 'COMPLIANT';
    }

    // Generate concise summary
    let summary = '';
    if (overallStatus === 'COMPLIANT') {
        summary = `All applicable Legal Metrology declarations verified (${passFindings.length} rules passed).`;
    } else if (overallStatus === 'NON_COMPLIANT') {
        summary = `Critical non-compliance detected: ${failFindings.map(f => f.field).join(', ')}.`;
    } else if (overallStatus === 'POTENTIAL_NON_COMPLIANCE') {
        summary = `Potential non-compliance or cross-photo discrepancy detected.`;
    } else if (overallStatus === 'INSUFFICIENT_EVIDENCE') {
        summary = `Insufficient evidence: Mandatory packaging declarations could not be verified from available photos.`;
    } else {
        summary = `Human inspection review required for packaging declarations.`;
    }

    return {
        scanTimestamp: new Date().toISOString(),
        overallStatus: overallStatus,
        summary: summary,
        findings: findings,
        listingMismatchCheck: {
            performed: false,
            mismatches: []
        }
    };
};

module.exports = { evaluateRules };
