const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
});

const isCloudinaryConfigured = () => {
    return !!(
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
    );
};

/**
 * Upload image buffer to Cloudinary with local disk fallback
 * @param {Buffer} buffer - image buffer
 * @param {string} originalName - filename
 * @param {string} folder - subfolder in Cloudinary
 * @returns {Promise<{ url: string, publicId: string, isLocal: boolean }>}
 */
const uploadImageBuffer = async (buffer, originalName = 'image.jpg', folder = 'drishtiscan/evidence') => {
    if (isCloudinaryConfigured()) {
        try {
            const uploadResult = await new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    {
                        folder: folder,
                        resource_type: 'image'
                    },
                    (error, result) => {
                        if (error) reject(error);
                        else resolve(result);
                    }
                );
                stream.end(buffer);
            });

            return {
                url: uploadResult.secure_url,
                publicId: uploadResult.public_id,
                isLocal: false
            };
        } catch (cloudinaryError) {
            console.warn(`[Cloudinary] Upload failed (${cloudinaryError.message}), falling back to local storage.`);
        }
    }

    // Local Disk Fallback
    const localUploadsDir = path.join(__dirname, '..', '..', 'uploads', 'evidence');
    if (!fs.existsSync(localUploadsDir)) {
        fs.mkdirSync(localUploadsDir, { recursive: true });
    }

    const ext = path.extname(originalName) || '.jpg';
    const filename = `evidence_${Date.now()}_${Math.random().toString(36).substring(2, 9)}${ext}`;
    const filePath = path.join(localUploadsDir, filename);

    await fs.promises.writeFile(filePath, buffer);
    const localUrl = `/uploads/evidence/${filename}`;

    return {
        url: localUrl,
        publicId: filename,
        isLocal: true
    };
};

/**
 * Delete image from Cloudinary or local disk
 * @param {string} publicId - Cloudinary public_id or local filename
 */
const deleteImage = async (publicId) => {
    if (!publicId) return;

    // Check if it's local
    const localFilePath = path.join(__dirname, '..', '..', 'uploads', 'evidence', publicId);
    if (fs.existsSync(localFilePath)) {
        try {
            await fs.promises.unlink(localFilePath);
            console.log(`[Storage] Deleted local evidence file: ${publicId}`);
            return;
        } catch (e) {
            console.error(`[Storage] Error deleting local file: ${e.message}`);
        }
    }

    // Delete from Cloudinary
    if (isCloudinaryConfigured()) {
        try {
            const res = await cloudinary.uploader.destroy(publicId);
            console.log(`[Cloudinary] Deleted publicId ${publicId}:`, res);
        } catch (error) {
            console.error(`[Cloudinary] Error deleting ${publicId}:`, error.message);
        }
    }
};

module.exports = {
    uploadImageBuffer,
    deleteImage,
    isCloudinaryConfigured
};
