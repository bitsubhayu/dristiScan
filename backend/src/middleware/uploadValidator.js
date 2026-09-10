/**
 * Phase 6 (Audit Fix): Upload validation middleware.
 * Validates uploaded files are actual images by checking both MIME type
 * and magic bytes. Enforces maximum file size per image.
 *
 * This runs AFTER multer has parsed the multipart request and placed
 * files in memory. It rejects requests with invalid files before they
 * reach the controller/route handler.
 */

// Maximum file size per image: 10 MB
const MAX_FILE_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE_BYTES || String(10 * 1024 * 1024), 10);

// Allowed MIME types
const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/tiff'
]);

// Magic byte signatures for image formats
const IMAGE_MAGIC_BYTES = [
    { signature: [0xFF, 0xD8, 0xFF], format: 'JPEG' },                          // JPEG
    { signature: [0x89, 0x50, 0x4E, 0x47], format: 'PNG' },                     // PNG
    { signature: [0x52, 0x49, 0x46, 0x46], format: 'WebP/RIFF' },               // WebP (RIFF container)
    { signature: [0x47, 0x49, 0x46], format: 'GIF' },                           // GIF
    { signature: [0x42, 0x4D], format: 'BMP' },                                 // BMP
    { signature: [0x49, 0x49, 0x2A, 0x00], format: 'TIFF (LE)' },               // TIFF (little endian)
    { signature: [0x4D, 0x4D, 0x00, 0x2A], format: 'TIFF (BE)' }                // TIFF (big endian)
];

/**
 * Check if a buffer starts with known image magic bytes
 */
const hasImageMagicBytes = (buffer) => {
    if (!buffer || buffer.length < 4) return false;
    return IMAGE_MAGIC_BYTES.some(({ signature }) =>
        signature.every((byte, index) => buffer[index] === byte)
    );
};

/**
 * Middleware: Validate uploaded image files.
 * Checks all files in req.files (multer fields mode) or req.file (single mode).
 *
 * @param {Object} [options]
 * @param {number} [options.maxSize] - Override max file size in bytes
 * @param {boolean} [options.required] - If true, require at least one image file
 */
const validateUploads = (options = {}) => {
    const maxSize = options.maxSize || MAX_FILE_SIZE;
    const required = options.required || false;

    return (req, res, next) => {
        // Collect all files from multer fields mode
        let files = [];
        if (req.files) {
            if (Array.isArray(req.files)) {
                files = req.files;
            } else {
                // req.files is an object with field names as keys
                for (const fieldName of Object.keys(req.files)) {
                    files = files.concat(req.files[fieldName]);
                }
            }
        } else if (req.file) {
            files = [req.file];
        }

        if (required && files.length === 0) {
            return res.status(400).json({
                error: 'At least one image file is required.'
            });
        }

        for (const file of files) {
            // Check file size
            const fileSize = file.size || (file.buffer ? file.buffer.length : 0);
            if (fileSize > maxSize) {
                return res.status(413).json({
                    error: `File "${file.originalname}" exceeds maximum size of ${Math.round(maxSize / 1024 / 1024)}MB.`,
                    maxSizeBytes: maxSize,
                    actualSizeBytes: fileSize
                });
            }

            // Check MIME type
            if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
                return res.status(415).json({
                    error: `File "${file.originalname}" has unsupported type "${file.mimetype}". Only image files are accepted.`,
                    allowedTypes: Array.from(ALLOWED_MIME_TYPES)
                });
            }

            // Check magic bytes (defense against MIME spoofing)
            if (file.buffer && !hasImageMagicBytes(file.buffer)) {
                return res.status(415).json({
                    error: `File "${file.originalname}" does not appear to be a valid image file (magic bytes check failed).`
                });
            }
        }

        next();
    };
};

module.exports = {
    validateUploads,
    MAX_FILE_SIZE,
    ALLOWED_MIME_TYPES
};
