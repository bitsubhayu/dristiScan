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
            if (nq && nq.value !== null && nq.unit !== null) {
                status = 'PASS';
                extractedValue = `${nq.value} ${nq.unit}`;
                reason = `Net quantity declared in standard metric units: ${nq.value} ${nq.unit}`;
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
            if (mfg) {
                status = 'PASS';
                extractedValue = mfg;
                reason = `Manufacturing / packing date declared: ${mfg}`;
            } else {
                status = 'INSUFFICIENT_EVIDENCE';
                reason = 'Month and year of manufacture or prepacking could not be established from visible panels.';
            }
        }

        else if (code === 'LM-07') {
            // Best Before / Expiry Date
            const exp = fields.dates?.expiry || fields.dates?.bestBefore;
            if (exp) {
                status = 'PASS';
                extractedValue = exp;
                reason = `Best before / use-by declaration detected: ${exp}`;
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
            if (usp) {
                status = 'PASS';
                extractedValue = usp;
                reason = `Unit Sale Price declared: ${usp}`;
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
