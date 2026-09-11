const axios = require('axios');
const http = require('http');
const FormData = require('form-data');
const crypto = require('crypto');

const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL || 'http://127.0.0.1:8000';
const ipv4Agent = new http.Agent({ family: 4 });

/**
 * Sends an image buffer to the Python OCR microservice.
 * @param {Buffer} imageBuffer - The image to process.
 * @param {String} originalname - The original filename.
 * @param {String} mimetype - The MIME type of the file.
 * @returns {Object} The JSON result from the OCR service.
 */
const runOCR = async (imageBuffer, originalname = 'label.jpg', mimetype = 'image/jpeg') => {
    const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex').substring(0, 12);
    const startTime = Date.now();

    try {
        const formData = new FormData();
        formData.append('image', imageBuffer, {
            filename: originalname,
            contentType: mimetype,
        });

        const formBuffer = formData.getBuffer();
        const response = await axios.post(`${OCR_SERVICE_URL}/ocr`, formBuffer, {
            headers: {
                ...formData.getHeaders(),
                'Content-Length': formBuffer.length
            },
            httpAgent: ipv4Agent,
            timeout: 300000, // 300 seconds to allow thorough CPU inference on large packaging photos
            maxBodyLength: Infinity,
            maxContentLength: Infinity
        });

        const elapsed = Date.now() - startTime;
        console.log(`[OCR Client] OCR successful for "${originalname}" (hash: ${hash}, size: ${imageBuffer.length} bytes) in ${elapsed}ms. Detected ${response.data.results?.length || 0} text elements.`);

        return response.data;
    } catch (error) {
        const elapsed = Date.now() - startTime;
        console.error(`[OCR Client Error] Failed for "${originalname}" (hash: ${hash}) after ${elapsed}ms: ${error.message}`);
        
        // Return structured failure response with ZERO fabricated data
        return {
            success: false,
            error: error.message,
            model: "PP-OCRv6",
            processingTimeMs: elapsed,
            results: [] // Strict safety rule: Never invent mock or demo values!
        };
    }
};

module.exports = { runOCR };
