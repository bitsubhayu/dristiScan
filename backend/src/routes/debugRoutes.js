const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const DEBUG_DIR = path.join(__dirname, '../../debug_scans');

// GET /api/debug/scans - List all saved debug scan traces
router.get('/scans', (req, res) => {
    try {
        if (!fs.existsSync(DEBUG_DIR)) {
            return res.json({ scans: [] });
        }
        const files = fs.readdirSync(DEBUG_DIR).filter(f => f.endsWith('.json'));
        const traces = [];

        for (const file of files) {
            try {
                const fullPath = path.join(DEBUG_DIR, file);
                const stats = fs.statSync(fullPath);
                const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                traces.push({
                    scanId: content.scanId || path.basename(file, '.json'),
                    timestamp: content.timestamp || stats.mtime,
                    endpoint: content.endpoint || 'unknown',
                    totalImages: content.totalImagesInScan || 0,
                    sizeBytes: stats.size,
                    productName: content.mergedExtractedFields?.productName || null,
                    mrp: content.mergedExtractedFields?.mrp?.value || null
                });
            } catch (err) {
                // skip corrupted file
            }
        }

        // Sort descending by timestamp / creation
        traces.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        res.json({ count: traces.length, scans: traces });
    } catch (error) {
        console.error('[Debug Scans List Error]:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/debug/scan/:scanId - Return full detailed debug trace
router.get('/scan/:scanId', (req, res) => {
    try {
        const { scanId } = req.params;
        const sanitizedId = scanId.replace(/[^a-zA-Z0-9_-]/g, '');
        const filePath = path.join(DEBUG_DIR, `${sanitizedId}.json`);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: `Debug scan trace "${sanitizedId}" not found.` });
        }

        const trace = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        res.json(trace);
    } catch (error) {
        console.error('[Debug Scan Fetch Error]:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
