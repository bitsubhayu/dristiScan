const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

const { runOCR } = require('../services/ocrClient');
const { extractFields, mergeMultiPhotoExtractedFields } = require('../services/extraction');
const { evaluatePreferences } = require('../services/preferenceMatcher');
const { evaluateRules } = require('../services/ruleEngine');
const { createScanTracker } = require('../services/debugScanLogger');
const { validateUploads } = require('../middleware/uploadValidator');
const { scanLimiter } = require('../middleware/rateLimiter');

// Generate a plain-language compliance one-liner for the consumer
const generateComplianceOneLiner = (overallStatus, findings = []) => {
    const violations = findings.filter(f => f.status === 'POTENTIAL_NON_COMPLIANCE' || f.status === 'FAIL');
    const passes = findings.filter(f => f.status === 'PASS');
    const insuff = findings.filter(f => f.status === 'INSUFFICIENT_EVIDENCE');

    if (overallStatus === 'COMPLIANT' || overallStatus === 'PASS') {
        return `✅ This product appears compliant — all ${passes.length} mandatory label declarations were detected on the package.`;
    } else if (overallStatus === 'NON_COMPLIANT' || overallStatus === 'POTENTIAL_NON_COMPLIANCE') {
        const flaggedFields = violations.map(v => v.field).join(', ');
        return `⚠️ Potential compliance issue — ${violations.length} declaration(s) flagged (${flaggedFields}). Consider checking the physical package carefully.`;
    } else if (overallStatus === 'INSUFFICIENT_EVIDENCE') {
        const missing = insuff.map(f => f.field).slice(0, 3).join(', ');
        return `ℹ️ Insufficient evidence: Mandatory packaging declarations (${missing || 'key fields'}) could not be verified from available photos. Please capture closer photos of the label.`;
    }
    return `ℹ️ Some label checks require visual verification. Please inspect the package visually for complete details.`;
};

// POST /api/consumer/scan (Supports single or multiple package photos)
// Phase 6: Added upload validation and rate limiting
router.post('/scan', scanLimiter, upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'image', maxCount: 10 }
]), validateUploads(), async (req, res) => {
    try {
        const imageFiles = (req.files && (req.files['images'] || req.files['image'])) 
            || (req.file ? [req.file] : []);

        if (imageFiles.length === 0) {
            return res.status(400).json({ error: 'No image files provided for scanning.' });
        }

        // Initialize comprehensive debug tracker for this scan
        const tracker = createScanTracker('consumer', imageFiles);

        // 1. Run OCR on each uploaded photo
        const singlePhotoExtractions = [];
        for (let i = 0; i < imageFiles.length; i++) {
            const file = imageFiles[i];
            const sourceImageId = `photo-${i + 1}`;
            const ocrResult = await runOCR(file.buffer, file.originalname, file.mimetype);
            tracker.recordOcrResult(i + 1, ocrResult);

            // Section 2: Stop immediately if OCR fails — never silently produce empty reports
            if (ocrResult.success === false) {
                console.error(`[Consumer Scan] OCR failed for photo ${i + 1}: ${ocrResult.error}`);
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

        // 3. Run regulatory rule engine
        let overallStatus = 'INSUFFICIENT_EVIDENCE';
        let findings = [];
        let summary = '';
        let complianceOneLiner = '';

        try {
            const ruleResult = await evaluateRules(mergedExtractedFields);
            overallStatus = ruleResult.overallStatus || 'INSUFFICIENT_EVIDENCE';
            findings = Array.isArray(ruleResult) ? ruleResult : (ruleResult.findings || []);
            summary = ruleResult.summary || '';
            complianceOneLiner = generateComplianceOneLiner(overallStatus, findings);
        } catch (ruleErr) {
            console.warn('[Consumer Rule Engine Warning]:', ruleErr.message);
            complianceOneLiner = 'ℹ️ Compliance check is temporarily unavailable. Please verify the label visually.';
        }
        tracker.recordCompliance(findings);

        // 4. Evaluate consumer dietary, allergen & health preferences
        let userPreferences = {};
        if (req.body.dietaryPreferences || req.body.preferences) {
            try {
                const prefInput = req.body.dietaryPreferences || req.body.preferences;
                userPreferences = typeof prefInput === 'string' ? JSON.parse(prefInput) : prefInput;
            } catch (e) {
                console.warn('Preference parse warning:', e.message);
            }
        }

        const preferenceEvaluation = evaluatePreferences(mergedExtractedFields, userPreferences);

        const finalDecision = {
            overallStatus,
            summary: summary || complianceOneLiner,
            complianceOneLiner,
            missingMandatoryFields: findings.filter(f => f.status === 'INSUFFICIENT_EVIDENCE').map(f => f.field),
            violationCount: findings.filter(f => f.status === 'FAIL' || f.status === 'POTENTIAL_NON_COMPLIANCE').length,
            reviewCount: findings.filter(f => f.status === 'REVIEW').length,
            passCount: findings.filter(f => f.status === 'PASS').length
        };

        const responsePayload = {
            status: 'success',
            scanId: tracker.scanId,
            complianceOneLiner,
            overallStatus,
            summary,
            findings,
            extractedFields: mergedExtractedFields,
            declarations: mergedExtractedFields.declarations,
            normalizedFields: mergedExtractedFields.normalizedFields || mergedExtractedFields,
            reconciliation: mergedExtractedFields.reconciliation,
            finalDecision,
            preferences: preferenceEvaluation,
            photoCount: imageFiles.length
        };

        const isDebugRequested = req.query.debug === 'true' || req.headers['x-debug-mode'] === 'true';
        tracker.finalize(responsePayload);
        if (isDebugRequested) {
            responsePayload.debugTraceUrl = `/api/debug/scan/${tracker.scanId}`;
        }

        res.json(responsePayload);
    } catch (error) {
        console.error('[Consumer Scan Error]:', error);
        res.status(500).json({ error: error.message || 'Internal server error during consumer scan.' });
    }
});

module.exports = router;
