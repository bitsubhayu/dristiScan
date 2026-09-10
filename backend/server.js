const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const port = process.env.PORT || 5000;
const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL || 'http://127.0.0.1:8000';

app.use(cors());
app.use(express.json());

// Set up Multer to handle multipart/form-data (store in memory for proxying)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Health check endpoint
app.get('/api/health', async (req, res) => {
    try {
        const response = await axios.get(`${OCR_SERVICE_URL}/health`, { timeout: 5000 });
        res.json({
            backend: 'ok',
            ocrService: 'reachable',
            ocrServiceHealth: response.data
        });
    } catch (error) {
        res.status(503).json({
            backend: 'ok',
            ocrService: 'unreachable',
            error: error.message
        });
    }
});

// Proxy OCR requests
app.post('/api/ocr', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image file uploaded.' });
    }

    try {
        // Create form data to forward to Python service
        const formData = new FormData();
        formData.append('image', req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype,
        });

        const response = await axios.post(`${OCR_SERVICE_URL}/ocr`, formData, {
            headers: {
                ...formData.getHeaders(),
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity
        });

        res.json(response.data);
    } catch (error) {
        console.error('OCR Proxy Error:', error.message);
        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ error: 'Failed to communicate with OCR service.' });
        }
    }
});

app.listen(port, () => {
    console.log(`Backend server listening at http://localhost:${port}`);
    console.log(`Proxying OCR requests to ${OCR_SERVICE_URL}`);
});
