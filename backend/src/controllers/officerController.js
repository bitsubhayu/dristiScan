const Inspection = require('../models/Inspection');
const { runOCR } = require('../services/ocrClient');
const { extractFields, mergeMultiPhotoExtractedFields, applyGeminiFallback } = require('../services/extraction');
const { evaluateRules } = require('../services/ruleEngine');
const { checkMismatch } = require('../services/mismatchCheck');
const { generatePDF, generateDOCX } = require('../services/reportGenerator');
const { uploadImageBuffer, deleteImage } = require('../services/cloudinaryService');
const { createScanTracker } = require('../services/debugScanLogger');
const mongoose = require('mongoose');

// Determine overall status from findings array
const computeOverallStatus = (findings = []) => {
    if (!findings || findings.length === 0) return 'NEEDS_REVIEW';
    const hasViolation = findings.some(f => f.status === 'POTENTIAL_NON_COMPLIANCE');
    if (hasViolation) return 'POTENTIAL_NON_COMPLIANCE';
    const hasPass = findings.some(f => f.status === 'PASS');
    if (hasPass) return 'PASS';
    return 'NEEDS_REVIEW';
};

// POST /api/officer/scan (Supports Multiple Photos)
const scan = async (req, res) => {
    try {
        const imageFiles = (req.files && (req.files['images'] || req.files['image'])) 
            || (req.file ? [req.file] : []);

        if (imageFiles.length === 0) {
            return res.status(400).json({ error: 'No product images provided.' });
        }

        // Initialize comprehensive debug tracker for this scan
        const tracker = createScanTracker('officer', imageFiles);

        // 1. Run OCR on each uploaded photo
        const singlePhotoExtractions = [];
        for (let i = 0; i < imageFiles.length; i++) {
            const file = imageFiles[i];
            const sourceImageId = `photo-${i + 1}`;
            const ocrResult = await runOCR(file.buffer, file.originalname, file.mimetype);
            tracker.recordOcrResult(i + 1, ocrResult);

            // Section 2: Stop immediately if OCR fails — never silently produce empty reports
            if (ocrResult.success === false) {
                console.error(`[Officer Scan] OCR failed for photo ${i + 1}: ${ocrResult.error}`);
                return res.status(503).json({
                    status: 'error',
                    error: 'OCR service temporarily unavailable — please try again in a moment.',
                    detail: `Photo ${i + 1} ("${file.originalname}") failed OCR: ${ocrResult.error}`,
                    scanId: tracker.scanId
                });
            }

            const fields = extractFields(ocrResult, sourceImageId);
            singlePhotoExtractions.push(fields);
        }

        // 2. Merge multi-photo extractions and detect conflicts (Phase 5: Fix 1 semantic reconciliation)
        let mergedExtractedFields = await mergeMultiPhotoExtractedFields(singlePhotoExtractions, imageFiles);

        // Phase 5 Fix 2: Gemini fallback is already applied inside mergeMultiPhotoExtractedFields
        // when imageFiles are passed — no separate call needed.
        tracker.recordExtraction(singlePhotoExtractions, mergedExtractedFields);

        // 3. Evaluate regulatory compliance rules
        const ruleResult = await evaluateRules(mergedExtractedFields);
        const findings = Array.isArray(ruleResult) ? ruleResult : (ruleResult.findings || []);

        // 4. If genuine multi-photo conflicts were found, add an explicit compliance finding
        // Phase 5 Fix 1: Only flag true conflicts (Gemini-confirmed or unresolved genuine conflicts)
        const genuineConflicts = (mergedExtractedFields.conflicts || []).filter(c => {
            return c.confirmedByGemini !== false || c.message.includes('Conflicting');
        });

        if (genuineConflicts.length > 0) {
            genuineConflicts.forEach(c => {
                findings.unshift({
                    ruleCode: 'PCR-MULTI-PHOTO-CONFLICT',
                    field: c.field,
                    status: 'POTENTIAL_NON_COMPLIANCE',
                    confidence: 0.95,
                    extractedValue: c.detectedValues.map(v => `${v.photo}: ${JSON.stringify(v.value)}`).join(' | '),
                    reason: c.message,
                    sourceReference: 'PCR 2011, Declaration Consistency Across Packaging Faces',
                    severity: 'high'
                });
            });
        }

        let overallStatus = ruleResult.overallStatus || computeOverallStatus(findings);
        if (genuineConflicts.length > 0) {
            overallStatus = 'POTENTIAL_NON_COMPLIANCE';
        }

        // 5. Check if saving to repository is requested
        const shouldSave = (req.body.saveToRepository === 'true' || req.body.saveToRepository === true);
        const user = req.user;
        let savedInspection = null;

        if (shouldSave && user && (user.role === 'officer' || user.role === 'admin')) {
            const evidenceImages = [];

            // Upload all product photos to Cloudinary
            for (let i = 0; i < imageFiles.length; i++) {
                const img = imageFiles[i];
                try {
                    const uploadResult = await uploadImageBuffer(
                        img.buffer,
                        img.originalname,
                        'drishtiscan/product_photos'
                    );
                    evidenceImages.push({
                        url: uploadResult.url,
                        publicId: uploadResult.publicId,
                        type: 'product_photo',
                        caption: `Package Photo #${i + 1} (${img.originalname})`
                    });
                } catch (err) {
                    console.error(`[Upload Error Photo #${i+1}]:`, err);
                }
            }



            // Check listing mismatch data
            let listingMismatchCheck = { performed: false, mismatches: [] };
            if (req.body.listingDetails) {
                try {
                    const listing = typeof req.body.listingDetails === 'string' 
                        ? JSON.parse(req.body.listingDetails) 
                        : req.body.listingDetails;
                    listingMismatchCheck = checkMismatch(mergedExtractedFields, listing);
                } catch (e) {
                    console.warn('Listing details parse warning:', e.message);
                }
            }

            const productName = req.body.productName || mergedExtractedFields.productName || 'Unlabeled / Scanned Product';

            // Create MongoDB Inspection Document
            savedInspection = await Inspection.create({
                savedBy: {
                    userId: user.id,
                    name: user.name,
                    role: user.role
                },
                scanTimestamp: new Date().toISOString(),
                productName: productName,
                extractedFields: mergedExtractedFields,
                findings: findings,
                overallStatus: overallStatus,
                listingMismatchCheck: listingMismatchCheck,
                evidenceImages: evidenceImages
            });

            console.log(`[Repository] Multi-photo inspection saved with ID: ${savedInspection._id}`);
        }

        tracker.recordCompliance(findings);

        const finalDecision = {
            overallStatus,
            summary: ruleResult.summary || '',
            missingMandatoryFields: findings.filter(f => f.status === 'INSUFFICIENT_EVIDENCE').map(f => f.field),
            violationCount: findings.filter(f => f.status === 'FAIL' || f.status === 'POTENTIAL_NON_COMPLIANCE').length,
            reviewCount: findings.filter(f => f.status === 'REVIEW').length,
            passCount: findings.filter(f => f.status === 'PASS').length
        };

        const responsePayload = {
            status: 'success',
            scanId: tracker.scanId,
            overallStatus,
            summary: ruleResult.summary || '',
            extractedFields: mergedExtractedFields,
            declarations: mergedExtractedFields.declarations,
            normalizedFields: mergedExtractedFields.normalizedFields || mergedExtractedFields,
            reconciliation: mergedExtractedFields.reconciliation,
            findings,
            finalDecision,
            savedInspection,
            photoCount: imageFiles.length
        };

        const isDebugRequested = req.query.debug === 'true' || req.headers['x-debug-mode'] === 'true';
        tracker.finalize(responsePayload);
        if (isDebugRequested) {
            responsePayload.debugTraceUrl = `/api/debug/scan/${tracker.scanId}`;
        }

        res.json(responsePayload);
    } catch (error) {
        console.error('[Officer Scan Error]:', error);
        res.status(500).json({ error: error.message || 'Internal server error processing scan.' });
    }
};

// POST /api/officer/mismatch-check
const mismatchCheck = (req, res) => {
    try {
        const { extractedFields, listingDetails } = req.body;
        if (!extractedFields || !listingDetails) {
            return res.status(400).json({ error: 'Missing extractedFields or listingDetails' });
        }
        const mismatchResult = checkMismatch(extractedFields, listingDetails);
        res.json(mismatchResult);
    } catch (error) {
        console.error('[Mismatch Check Error]:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// GET /api/officer/repository
const getRepository = async (req, res) => {
    try {
        const user = req.user;
        const { productName, status, startDate, endDate, page = 1, limit = 20 } = req.query;

        const query = {};

        // Scope to officer's own records unless admin
        if (user.role === 'officer') {
            query['savedBy.userId'] = new mongoose.Types.ObjectId(user.id);
        } else if (user.role === 'admin' && req.query.officerId) {
            query['savedBy.userId'] = new mongoose.Types.ObjectId(req.query.officerId);
        }

        // Filters
        if (productName) {
            query.productName = { $regex: productName.trim(), $options: 'i' };
        }

        if (status && status !== 'ALL') {
            query.overallStatus = status;
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.createdAt.$lte = end;
            }
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const total = await Inspection.countDocuments(query);
        const inspections = await Inspection.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .lean();

        res.json({
            status: 'success',
            total,
            page: parseInt(page, 10),
            totalPages: Math.ceil(total / parseInt(limit, 10)) || 1,
            inspections
        });
    } catch (error) {
        console.error('[Get Repository Error]:', error);
        res.status(500).json({ error: error.message || 'Internal server error fetching repository.' });
    }
};

// GET /api/officer/repository/:id
const getInspectionById = async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid inspection ID' });
        }

        const inspection = await Inspection.findById(id).lean();
        if (!inspection) {
            return res.status(404).json({ error: 'Inspection not found' });
        }

        // Authorization check: Officer can only view own inspections
        if (user.role === 'officer' && inspection.savedBy.userId.toString() !== user.id) {
            return res.status(403).json({ error: 'Access denied: You can only view your own saved inspections.' });
        }

        res.json({
            status: 'success',
            inspection
        });
    } catch (error) {
        console.error('[Get Inspection Details Error]:', error);
        res.status(500).json({ error: error.message || 'Internal server error fetching inspection.' });
    }
};

// DELETE /api/officer/repository/:id
const deleteInspection = async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid inspection ID' });
        }

        const inspection = await Inspection.findById(id);
        if (!inspection) {
            return res.status(404).json({ error: 'Inspection not found' });
        }

        // Authorization check: Officer can only delete own inspections
        if (user.role === 'officer' && inspection.savedBy.userId.toString() !== user.id) {
            return res.status(403).json({ error: 'Access denied: You can only delete your own saved inspections.' });
        }

        // Delete associated evidence images from Cloudinary / disk
        if (inspection.evidenceImages && inspection.evidenceImages.length > 0) {
            for (const img of inspection.evidenceImages) {
                if (img.publicId) {
                    await deleteImage(img.publicId);
                }
            }
        }

        await Inspection.findByIdAndDelete(id);

        res.json({
            status: 'success',
            message: 'Inspection record and associated evidence media deleted successfully.'
        });
    } catch (error) {
        console.error('[Delete Inspection Error]:', error);
        res.status(500).json({ error: error.message || 'Internal server error deleting inspection.' });
    }
};

// GET /api/officer/dashboard
const getDashboard = async (req, res) => {
    try {
        const user = req.user;
        const matchStage = {};

        if (user.role === 'officer') {
            matchStage['savedBy.userId'] = new mongoose.Types.ObjectId(user.id);
        } else if (user.role === 'admin' && req.query.officerId) {
            matchStage['savedBy.userId'] = new mongoose.Types.ObjectId(req.query.officerId);
        }

        // 1. Overall Status Counts
        const statusCountsAgg = await Inspection.aggregate([
            { $match: matchStage },
            { $group: { _id: '$overallStatus', count: { $sum: 1 } } }
        ]);

        let totalInspections = 0;
        let compliantCount = 0;
        let nonCompliantCount = 0;
        let reviewCount = 0;

        statusCountsAgg.forEach(item => {
            totalInspections += item.count;
            if (item._id === 'PASS') compliantCount = item.count;
            else if (item._id === 'POTENTIAL_NON_COMPLIANCE') nonCompliantCount = item.count;
            else if (item._id === 'NEEDS_REVIEW') reviewCount = item.count;
        });

        // 2. Most Common Violations
        const topViolationsAgg = await Inspection.aggregate([
            { $match: matchStage },
            { $unwind: '$findings' },
            { $match: { 'findings.status': 'POTENTIAL_NON_COMPLIANCE' } },
            {
                $group: {
                    _id: {
                        ruleCode: '$findings.ruleCode',
                        field: '$findings.field',
                        reason: '$findings.reason'
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 5 },
            {
                $project: {
                    _id: 0,
                    ruleCode: '$_id.ruleCode',
                    field: '$_id.field',
                    reason: '$_id.reason',
                    count: 1
                }
            }
        ]);

        // 3. Recent Inspections
        const recentInspections = await Inspection.find(matchStage)
            .sort({ createdAt: -1 })
            .limit(6)
            .select('productName overallStatus scanTimestamp savedBy createdAt')
            .lean();

        // 4. Trend View (last 14 days)
        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);
        fourteenDaysAgo.setHours(0, 0, 0, 0);

        const trendMatch = {
            ...matchStage,
            createdAt: { $gte: fourteenDaysAgo }
        };

        const trendAgg = await Inspection.aggregate([
            { $match: trendMatch },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                    },
                    total: { $sum: 1 },
                    compliant: {
                        $sum: { $cond: [{ $eq: ['$overallStatus', 'PASS'] }, 1, 0] }
                    },
                    nonCompliant: {
                        $sum: { $cond: [{ $eq: ['$overallStatus', 'POTENTIAL_NON_COMPLIANCE'] }, 1, 0] }
                    }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        const trendData = [];
        for (let i = 13; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const found = trendAgg.find(t => t._id === dateStr);
            trendData.push({
                date: dateStr,
                total: found ? found.total : 0,
                compliant: found ? found.compliant : 0,
                nonCompliant: found ? found.nonCompliant : 0
            });
        }

        res.json({
            status: 'success',
            summary: {
                total: totalInspections,
                compliant: compliantCount,
                nonCompliant: nonCompliantCount,
                needsReview: reviewCount,
                complianceRate: totalInspections > 0 ? Math.round((compliantCount / totalInspections) * 100) : 0
            },
            topViolations: topViolationsAgg,
            recentInspections,
            trendData
        });
    } catch (error) {
        console.error('[Dashboard Aggregation Error]:', error);
        res.status(500).json({ error: error.message || 'Internal server error computing dashboard.' });
    }
};

// Report PDF
const exportPDF = async (req, res) => {
    try {
        const reportData = req.body;
        if (!reportData || !reportData.scanTimestamp) {
            return res.status(400).json({ error: 'Invalid report data' });
        }
        const pdfBuffer = await generatePDF(reportData);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=compliance_report.pdf');
        res.send(pdfBuffer);
    } catch (error) {
        console.error('[Export PDF Error]:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Report DOCX
const exportDOCX = async (req, res) => {
    try {
        const reportData = req.body;
        if (!reportData || !reportData.scanTimestamp) {
            return res.status(400).json({ error: 'Invalid report data' });
        }
        const docxBuffer = await generateDOCX(reportData);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', 'attachment; filename=compliance_report.docx');
        res.send(docxBuffer);
    } catch (error) {
        console.error('[Export DOCX Error]:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = {
    scan,
    mismatchCheck,
    getRepository,
    getInspectionById,
    deleteInspection,
    getDashboard,
    exportPDF,
    exportDOCX
};
