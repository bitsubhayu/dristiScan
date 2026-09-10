const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

const officerController = require('../controllers/officerController');
const { authenticateToken, requireAuth } = require('../middleware/auth');
const { validateUploads } = require('../middleware/uploadValidator');
const { scanLimiter } = require('../middleware/rateLimiter');

// Multer upload fields for scan: multiple product images
const scanUpload = upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'image', maxCount: 10 }
]);

// 1. Scan Endpoint (Token checked if present; saving requires officer/admin role)
//    Phase 6: Added upload validation and rate limiting
router.post('/scan', authenticateToken, scanLimiter, scanUpload, validateUploads(), officerController.scan);

// 2. Mismatch Check
router.post('/mismatch-check', officerController.mismatchCheck);

// 3. Inspection Repository (Officer/Admin only)
router.get('/repository', authenticateToken, requireAuth(['officer', 'admin']), officerController.getRepository);
router.get('/repository/:id', authenticateToken, requireAuth(['officer', 'admin']), officerController.getInspectionById);
router.delete('/repository/:id', authenticateToken, requireAuth(['officer', 'admin']), officerController.deleteInspection);

// 4. Enforcement Dashboard (Officer/Admin only)
router.get('/dashboard', authenticateToken, requireAuth(['officer', 'admin']), officerController.getDashboard);

// 5. Report Generators (Phase 6: Now requires authentication)
router.post('/report/pdf', authenticateToken, requireAuth(['officer', 'admin', 'guest']), officerController.exportPDF);
router.post('/report/docx', authenticateToken, requireAuth(['officer', 'admin', 'guest']), officerController.exportDOCX);

module.exports = router;
