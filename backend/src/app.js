require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const { connectDB } = require('./config/db');

// Connect to MongoDB (both Rules and Operational DBs)
connectDB();

const app = express();
const port = process.env.PORT || 5000;

// Phase 6 (Audit Fix): Configurable CORS origins via environment variable
const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:5173', 'http://127.0.0.1:5173'];

app.use(cors({
    origin: corsOrigins,
    credentials: true
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static uploads directory for local evidence storage fallback
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Register Routes
const authRoutes = require('./routes/authRoutes');
const consumerRoutes = require('./routes/consumerRoutes');
const officerRoutes = require('./routes/officerRoutes');
const ruleRoutes = require('./routes/ruleRoutes');
const debugRoutes = require('./routes/debugRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/consumer', consumerRoutes);
app.use('/api/officer', officerRoutes);
app.use('/api/rules', ruleRoutes);
app.use('/api/debug', debugRoutes);

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'DrishtiScan backend is running', 
        timestamp: new Date().toISOString() 
    });
});

// Phase 6 (Audit Fix): Global error-sanitizing middleware.
// In production, strips stack traces and internal error details from responses.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
    console.error('[Unhandled Error]:', err);
    const statusCode = err.status || err.statusCode || 500;
    const isProduction = process.env.NODE_ENV === 'production';
    res.status(statusCode).json({
        error: isProduction
            ? 'An unexpected error occurred. Please try again.'
            : (err.message || 'Internal server error.'),
        ...(isProduction ? {} : { stack: err.stack })
    });
});

app.listen(port, () => {
    console.log(`Backend server listening at http://localhost:${port}`);
    console.log(`CORS origins: ${corsOrigins.join(', ')}`);
});
