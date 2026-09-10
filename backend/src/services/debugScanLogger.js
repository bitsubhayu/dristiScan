const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEBUG_DIR = path.join(__dirname, '../../debug_scans');

// Ensure debug directory exists
try {
    if (!fs.existsSync(DEBUG_DIR)) {
        fs.mkdirSync(DEBUG_DIR, { recursive: true });
    }
} catch (e) {
    console.warn('[DebugLogger] Could not create debug_scans directory:', e.message);
}

/**
 * Creates a new debug scan tracker for an incoming scan request.
 * @param {string} endpoint - 'consumer' | 'officer'
 * @param {Array} imageFiles - Array of Express Multer file objects
 * @returns {Object} Tracker object with logging methods
 */
const createScanTracker = (endpoint, imageFiles = []) => {
    const timestamp = new Date().toISOString();
    const scanId = `scan_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    const imagesMetadata = imageFiles.map((f, idx) => {
        const hash = crypto.createHash('sha256').update(f.buffer || Buffer.alloc(0)).digest('hex');
        return {
            index: idx + 1,
            originalName: f.originalname,
            mimeType: f.mimetype,
            sizeBytes: f.size || (f.buffer ? f.buffer.length : 0),
            sha256: hash,
            dimensions: null, // Populated after OCR
            rawOcrResult: null
        };
    });

    const debugRecord = {
        scanId,
        timestamp,
        endpoint,
        totalImagesInScan: imageFiles.length,
        images: imagesMetadata,
        singlePhotoExtractions: [],
        mergedExtractedFields: null,
        complianceFindings: null,
        finalApiResponse: null
    };

    console.log(`\n[Scan Tracker: ${scanId}] Initialized ${endpoint} scan with ${imageFiles.length} image(s).`);
    imagesMetadata.forEach(img => {
        console.log(`  └─ Photo #${img.index}: "${img.originalName}" (${img.sizeBytes} bytes, sha256:${img.sha256.substring(0, 12)}...)`);
    });

    return {
        scanId,

        recordOcrResult(index, ocrResponse) {
            const imgMeta = imagesMetadata.find(i => i.index === index);
            if (imgMeta) {
                imgMeta.dimensions = {
                    width: ocrResponse.imageWidth || null,
                    height: ocrResponse.imageHeight || null
                };
                imgMeta.rawOcrResult = {
                    success: ocrResponse.success,
                    model: ocrResponse.model,
                    processingTimeMs: ocrResponse.processingTimeMs,
                    resultsCount: ocrResponse.results ? ocrResponse.results.length : 0,
                    results: ocrResponse.results || []
                };
                console.log(`[Scan Tracker: ${scanId}] Recorded OCR for Photo #${index}: ${ocrResponse.results?.length || 0} text elements detected in ${ocrResponse.processingTimeMs}ms.`);
            }
        },

        recordExtraction(singleExtractions, mergedFields) {
            debugRecord.singlePhotoExtractions = singleExtractions;
            debugRecord.mergedExtractedFields = mergedFields;
        },

        recordCompliance(findings) {
            debugRecord.complianceFindings = findings;
        },

        finalize(apiResponse) {
            debugRecord.finalApiResponse = apiResponse;
            const filePath = path.join(DEBUG_DIR, `${scanId}.json`);
            try {
                fs.writeFileSync(filePath, JSON.stringify(debugRecord, null, 2), 'utf8');
                console.log(`[Scan Tracker: ${scanId}] Debug trace saved to ${filePath}`);
            } catch (err) {
                console.warn(`[Scan Tracker: ${scanId}] Could not save debug file:`, err.message);
            }
            return debugRecord;
        }
    };
};

module.exports = {
    createScanTracker
};
