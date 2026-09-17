/**
 * DrishtiScan — Extraction & Multi-Angle Reconciliation Engine
 * Canonical Data Contract & Evidence-Based Legal Metrology Extraction
 * 
 * Redesigned Architecture:
 * - extractFields: single-photo evidence reconstruction (groupIntoRows, candidateHints, normalized bboxes)
 * - mergeMultiPhotoExtractedFields: consolidated multi-angle structuring via structuringEngine (GPT-OSS)
 *   with deterministicFallbackExtractor as degraded safety fallback.
 */

const structuringEngine = require('./structuringEngine');
const { extractFieldsDeterministic } = require('./deterministicFallbackExtractor');
const { fuseMultiPhotoEvidence } = require('./multiPhotoEvidenceFusion');
const {
    isDateShaped,
    VALID_MASS_VOLUME_UNITS,
    VALID_COUNT_UNITS,
    isValidQuantityUnit,
    MARKETING_BADGE_PATTERNS,
    isMarketingBadge,
    isNonProductTitleCandidate,
    validateFieldFormat,
    KNOWN_COUNTRIES,
    sanitizeExtractedText
} = require('./textShapeValidators');
const {
    groupIntoRows,
    generateCandidateTitles
} = require('./ocrReconstruction');

/**
 * Extracts structured evidence from raw OCR results of a single photo.
 * Normalizes bounding boxes and reconstructs visual rows without premature field interpretation.
 *
 * @param {Array|Object} ocrResults - Raw OCR output containing `results` or `rawElements`.
 * @param {string} sourceImageId - Identifier of the source photo (e.g. "photo-1").
 * @returns {Object} Evidence package for downstream multi-angle structuring.
 */
const extractFields = (ocrResults, sourceImageId = 'photo-1', options = {}) => {
    let resultsArray = ocrResults;
    if (ocrResults && ocrResults.results) {
        resultsArray = ocrResults.results;
    } else if (ocrResults && ocrResults.rawElements) {
        resultsArray = ocrResults.rawElements;
    }
    if (!Array.isArray(resultsArray)) {
        resultsArray = [];
    }

    const sourceImageWidth = ocrResults?.imageWidth || 0;
    const sourceImageHeight = ocrResults?.imageHeight || 0;

    const initialElements = resultsArray.map((r, idx) => ({
        index: idx,
        text: (r.text || '').trim(),
        confidence: typeof r.confidence === 'number' ? r.confidence : 0.8,
        bbox: r.bbox || r.boundingBox || []
    })).filter(r => Boolean(r.text));

    // Spatial line and row reconstruction
    const structuredRows = groupIntoRows(initialElements);
    const rawElements = structuredRows.orderedElements;
    const candidateHints = generateCandidateTitles(structuredRows, rawElements);

    // Normalize bounding boxes to 0-1 fractions using photo dimensions (Issue 4)
    const normalizedRawOcr = rawElements.map(r => {
        const entry = {
            text: (r.text || '').trim(),
            confidence: typeof r.confidence === 'number' ? r.confidence : 0.8,
            bbox: r.bbox || r.boundingBox || []
        };
        if (sourceImageWidth > 0 && sourceImageHeight > 0 && Array.isArray(entry.bbox) && entry.bbox.length >= 4) {
            entry.bbox = entry.bbox.map(pt => [
                pt[0] / sourceImageWidth,
                pt[1] / sourceImageHeight
            ]);
        } else if (Array.isArray(entry.bbox) && entry.bbox.length >= 4) {
            entry.bbox = [];
        }
        return entry;
    }).filter(r => Boolean(r.text));

    // Attach normalizedBbox to row elements
    const normalizedRows = (structuredRows.rows || []).map(r => ({
        ...r,
        elements: (r.elements || []).map(el => {
            const elEntry = { ...el };
            if (sourceImageWidth > 0 && sourceImageHeight > 0 && Array.isArray(el.bbox) && el.bbox.length >= 4) {
                if (typeof el.bbox[0] === 'number') {
                    elEntry.normalizedBbox = [
                        Math.round((el.bbox[0] / sourceImageWidth) * 1000) / 1000,
                        Math.round((el.bbox[1] / sourceImageHeight) * 1000) / 1000,
                        Math.round((el.bbox[2] / sourceImageWidth) * 1000) / 1000,
                        Math.round((el.bbox[3] / sourceImageHeight) * 1000) / 1000
                    ];
                } else if (Array.isArray(el.bbox[0])) {
                    const xs = el.bbox.map(pt => pt[0] / sourceImageWidth);
                    const ys = el.bbox.map(pt => pt[1] / sourceImageHeight);
                    elEntry.normalizedBbox = [
                        Math.round(Math.min(...xs) * 1000) / 1000,
                        Math.round(Math.min(...ys) * 1000) / 1000,
                        Math.round(Math.max(...xs) * 1000) / 1000,
                        Math.round(Math.max(...ys) * 1000) / 1000
                    ];
                }
            }
            return elEntry;
        }),
        normalizedBbox: (sourceImageWidth > 0 && sourceImageHeight > 0 && r.minX !== undefined)
            ? [
                Math.round((r.minX / sourceImageWidth) * 1000) / 1000,
                Math.round((r.minY / sourceImageHeight) * 1000) / 1000,
                Math.round((r.maxX / sourceImageWidth) * 1000) / 1000,
                Math.round((r.maxY / sourceImageHeight) * 1000) / 1000
              ]
            : (r.normalizedBbox || [])
    }));

    const emptyNormalized = {
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
        structuredRows: normalizedRows,
        rawOcrText: normalizedRawOcr
    };

    if (options.deterministic) {
        return extractFieldsDeterministic(rawElements, structuredRows, { imageWidth: sourceImageWidth, imageHeight: sourceImageHeight }, sourceImageId);
    }

    return {
        ...emptyNormalized,
        normalizedFields: emptyNormalized,
        declarations: {},
        validation: {},
        sourceImageId,
        structuredRows: normalizedRows,
        _structuredRowsObj: { ...structuredRows, rows: normalizedRows },
        candidateHints,
        rawOcrText: normalizedRawOcr,
        imageWidth: sourceImageWidth,
        imageHeight: sourceImageHeight
    };
};

/**
 * Consolidates multiple photo extractions into a single structured packaging record.
 * Executes unified structuring through structuringEngine (GPT-OSS), falling back
 * gracefully to deterministic regex extraction if GPT-OSS is unavailable.
 *
 * @param {Array<Object>} singlePhotoExtractions - Evidence packages from extractFields.
 * @param {Array<Object>} imageFiles - Optional uploaded file references.
 * @returns {Promise<Object>} Canonical packaged product scan record for ruleEngine.
 */
const mergeMultiPhotoExtractedFields = async (singlePhotoExtractions = [], imageFiles = []) => {
    if (!Array.isArray(singlePhotoExtractions) || singlePhotoExtractions.length === 0) {
        return extractFields([]);
    }

    const photoRowsList = singlePhotoExtractions.map((ext, idx) => ({
        photoId: ext.sourceImageId || `photo-${idx + 1}`,
        rows: ext._structuredRowsObj?.rows || (Array.isArray(ext.structuredRows) ? ext.structuredRows : [])
    }));

    const deterministicHints = [];
    singlePhotoExtractions.forEach(ext => {
        if (Array.isArray(ext.candidateHints)) {
            deterministicHints.push(...ext.candidateHints);
        }
    });

    const combinedRawOcr = [];
    singlePhotoExtractions.forEach(ext => {
        if (Array.isArray(ext.rawOcrText)) {
            combinedRawOcr.push(...ext.rawOcrText);
        }
    });

    // Step 2 & 5: Lightweight deterministic multi-photo evidence fusion
    const fusionStart = Date.now();
    const fusionResult = fuseMultiPhotoEvidence(photoRowsList);
    const fusionLatencyMs = Date.now() - fusionStart;

    // Attempt unified structuring via structuringEngine (GPT-OSS) exactly ONCE
    const structureResult = await structuringEngine.structureFields(
        fusionResult.fusedPhotoRows,
        deterministicHints,
        fusionResult.rowLookupMap
    );

    if (structureResult.success) {
        const normalizedFields = {
            ...structureResult.normalizedFields,
            rawOcrText: combinedRawOcr
        };

        return {
            ...normalizedFields,
            declarations: structureResult.declarations,
            validation: structureResult.validation,
            photoCount: singlePhotoExtractions.length,
            conflicts: fusionResult.conflicts || [],
            reconciliation: {
                fields: {},
                conflicts: fusionResult.conflicts || [],
                gptOssUsed: true,
                photoCount: singlePhotoExtractions.length,
                inputRows: fusionResult.stats.totalInputRows,
                fusedRows: fusionResult.stats.fusedRowCount,
                deduplicatedRows: fusionResult.stats.deduplicatedCount,
                preservedUniqueRows: fusionResult.stats.preservedUniqueRows,
                fusionStats: fusionResult.stats,
                fusionLatencyMs,
                diagnostics: structureResult.diagnostics || {}
            },
            normalizedFields
        };
    }

    // Degraded Fallback Mode: Execute deterministic extraction per photo
    console.warn(`[Extraction] GPT-OSS structuring unavailable (${structureResult.reason || structureResult.error}) — falling back to deterministic extractor.`);

    const fallbackSingleExtractions = singlePhotoExtractions.map((ext, idx) => {
        const rawElements = ext._structuredRowsObj?.orderedElements || ext.rawOcrText || [];
        const sRows = ext._structuredRowsObj || { rows: ext.structuredRows || [] };
        const dims = { imageWidth: ext.imageWidth, imageHeight: ext.imageHeight };
        const photoId = ext.sourceImageId || `photo-${idx + 1}`;
        const detExt = (rawElements.length > 0 || (sRows.rows && sRows.rows.length > 0))
            ? extractFieldsDeterministic(rawElements, sRows, dims, photoId)
            : { normalizedFields: {}, declarations: {}, validation: {} };

        const detNorm = detExt.normalizedFields || {};
        const extNorm = ext.normalizedFields || {};
        const mergedNorm = { ...detNorm };

        // Overlay any explicit non-null values from ext/extNorm (e.g. mock test objects)
        for (const [key, val] of Object.entries(extNorm)) {
            if (val !== null && val !== undefined) {
                if (Array.isArray(val) && val.length > 0) {
                    mergedNorm[key] = val;
                } else if (typeof val === 'object' && val !== null) {
                    if (val.value !== undefined) {
                        if (val.value !== null) {
                            mergedNorm[key] = val;
                        }
                    } else if (Object.values(val).some(v => v !== null && v !== undefined && v !== '')) {
                        mergedNorm[key] = { ...(detNorm[key] || {}), ...val };
                    }
                } else if (val !== '') {
                    mergedNorm[key] = val;
                }
            }
        }
        for (const [key, val] of Object.entries(ext)) {
            if (['structuredRows', '_structuredRowsObj', 'candidateHints', 'rawOcrText', 'imageWidth', 'imageHeight', 'sourceImageId', 'declarations', 'validation', 'normalizedFields'].includes(key)) continue;
            if (val !== null && val !== undefined) {
                if (Array.isArray(val) && val.length > 0) {
                    mergedNorm[key] = val;
                } else if (typeof val === 'object' && val !== null) {
                    if (val.value !== undefined) {
                        if (val.value !== null) {
                            mergedNorm[key] = val;
                        }
                    } else if (Object.values(val).some(v => v !== null && v !== undefined && v !== '')) {
                        mergedNorm[key] = { ...(detNorm[key] || {}), ...val };
                    }
                } else if (val !== '') {
                    mergedNorm[key] = val;
                }
            }
        }

        return {
            ...detExt,
            ...mergedNorm,
            normalizedFields: mergedNorm,
            declarations: { ...(detExt.declarations || {}), ...(ext.declarations || {}) },
            validation: { ...(detExt.validation || {}), ...(ext.validation || {}) }
        };
    });

    // Merge with simple first non-null rule
    const mergedNormalized = {
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
            calories: null, fat: null, sugar: null, protein: null,
            sodium: null, carbohydrates: null, fiber: null
        },
        rawOcrText: combinedRawOcr,
        structuringMode: 'deterministic_fallback'
    };

    const mergedDeclarations = {};
    const mergedValidation = {};

    for (const ext of fallbackSingleExtractions) {
        const f = ext.normalizedFields || ext;
        if (!mergedNormalized.productName && f.productName) mergedNormalized.productName = f.productName;
        if (!mergedNormalized.brandName && f.brandName) mergedNormalized.brandName = f.brandName;
        if (!mergedNormalized.genericCommodityName && f.genericCommodityName) mergedNormalized.genericCommodityName = f.genericCommodityName;
        if (!mergedNormalized.batchNumber && f.batchNumber) mergedNormalized.batchNumber = f.batchNumber;
        if (!mergedNormalized.fssaiLicenseNumber && f.fssaiLicenseNumber) mergedNormalized.fssaiLicenseNumber = f.fssaiLicenseNumber;
        if (!mergedNormalized.countryOfOrigin && f.countryOfOrigin) mergedNormalized.countryOfOrigin = f.countryOfOrigin;
        if (!mergedNormalized.unitSalePrice && f.unitSalePrice) mergedNormalized.unitSalePrice = f.unitSalePrice;
        if (!mergedNormalized.ingredients && f.ingredients) mergedNormalized.ingredients = f.ingredients;
        if (!mergedNormalized.servingsPerContainer && f.servingsPerContainer) mergedNormalized.servingsPerContainer = f.servingsPerContainer;
        if (!mergedNormalized.servingSize && f.servingSize) mergedNormalized.servingSize = f.servingSize;

        if (!mergedNormalized.netQuantity.value && f.netQuantity?.value) {
            mergedNormalized.netQuantity = { ...f.netQuantity };
        }
        if (!mergedNormalized.mrp.value && f.mrp?.value) {
            mergedNormalized.mrp = { ...f.mrp };
        }
        if (!mergedNormalized.dates.manufacture && f.dates?.manufacture) mergedNormalized.dates.manufacture = f.dates.manufacture;
        if (!mergedNormalized.dates.expiry && f.dates?.expiry) mergedNormalized.dates.expiry = f.dates.expiry;
        if (!mergedNormalized.dates.bestBefore && f.dates?.bestBefore) mergedNormalized.dates.bestBefore = f.dates.bestBefore;

        if (!mergedNormalized.manufacturer.name && f.manufacturer?.name) mergedNormalized.manufacturer = { ...f.manufacturer };
        if (!mergedNormalized.packer.name && f.packer?.name) mergedNormalized.packer = { ...f.packer };
        if (!mergedNormalized.importer.name && f.importer?.name) mergedNormalized.importer = { ...f.importer };
        if (!mergedNormalized.marketer.name && f.marketer?.name) mergedNormalized.marketer = { ...f.marketer };

        if (!mergedNormalized.consumerCare.phone && f.consumerCare?.phone) mergedNormalized.consumerCare.phone = f.consumerCare.phone;
        if (!mergedNormalized.consumerCare.email && f.consumerCare?.email) mergedNormalized.consumerCare.email = f.consumerCare.email;

        if (f.nutritionFacts) {
            for (const [k, v] of Object.entries(f.nutritionFacts)) {
                if (mergedNormalized.nutritionFacts[k] === null && v !== null) {
                    mergedNormalized.nutritionFacts[k] = v;
                }
            }
        }

        if (ext.declarations) {
            Object.entries(ext.declarations).forEach(([k, decl]) => {
                if (!mergedDeclarations[k] || (decl && decl.status === 'verified' && mergedDeclarations[k].status !== 'verified')) {
                    mergedDeclarations[k] = { ...decl };
                }
            });
        }
        if (ext.validation) {
            Object.entries(ext.validation).forEach(([k, v]) => {
                if (!mergedValidation[k] || (v && v.status === 'verified' && mergedValidation[k].status !== 'verified')) {
                    mergedValidation[k] = { ...v };
                }
            });
        }
    }

    mergedDeclarations.structuringMode = 'deterministic_fallback';

    return {
        ...mergedNormalized,
        declarations: mergedDeclarations,
        validation: mergedValidation,
        photoCount: singlePhotoExtractions.length,
        conflicts: fusionResult.conflicts || [],
        reconciliation: {
            fields: {},
            conflicts: fusionResult.conflicts || [],
            gptOssUsed: false,
            structuringMode: 'deterministic_fallback'
        },
        normalizedFields: mergedNormalized
    };
};

/**
 * Deprecated Gemini fallback retained as a signature-compatible no-op for existing controllers.
 */
const applyGeminiFallback = async (mergedFields) => {
    return mergedFields;
};

module.exports = {
    groupIntoRows,
    generateCandidateTitles,
    extractFields,
    extractFieldsDeterministic,
    mergeMultiPhotoExtractedFields,
    applyGeminiFallback,
    validateFieldFormat,
    isValidQuantityUnit,
    isDateShaped,
    isMarketingBadge,
    isNonProductTitleCandidate,
    sanitizeExtractedText,
    KNOWN_COUNTRIES
};
