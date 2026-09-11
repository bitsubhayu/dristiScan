require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const { connectDB } = require('./config/db');

// Connect to MongoDB (both Rules and Operational DBs)
connectDB();

const app = express();
// Cloud Run injects PORT (default 8080). Support process.env.PORT with 8080 as fallback.
const port = parseInt(process.env.PORT, 10) || 8080;
const host = '0.0.0.0';

// Phase 6 (Audit & Cross-Origin Fix): Configurable CORS origins with explicit rejection logging
const normalizeOrigin = (o) => (o ? o.trim().replace(/\/+$/, '') : '');

const defaultOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://frontend-bitsubhayus-projects.vercel.app',
    'https://frontend-git-main-bitsubhayus-projects.vercel.app',
    'https://frontend-nnaxpe7h4-bitsubhayus-projects.vercel.app'
];

const envOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(normalizeOrigin).filter(Boolean)
    : [];

// Deduplicated list of allowed origins (environment variable takes precedence, default fallback included)
const corsOrigins = Array.from(new Set([...envOrigins, ...defaultOrigins.map(normalizeOrigin)]));

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (such as server-to-server health checks, curl, mobile clients)
        if (!origin) {
            return callback(null, true);
        }

        const normalizedIncoming = normalizeOrigin(origin);
        if (corsOrigins.includes(normalizedIncoming)) {
            return callback(null, true);
        }

        // Explicit server-side visibility into CORS rejections for rapid Cloud Run diagnostics
        console.warn(`[CORS REJECTED] Origin "${origin}" is not allowed by CORS_ORIGINS. Allowed list:`, corsOrigins);
        return callback(null, false);
    },
    credentials: true
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static uploads directory for local evidence storage fallback
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Health check endpoints for Cloud Run / load balancers
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'DrishtiScan Backend API', 
        timestamp: new Date().toISOString() 
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'DrishtiScan backend is running', 
        timestamp: new Date().toISOString() 
    });
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'DrishtiScan backend is running', 
        timestamp: new Date().toISOString() 
    });
});

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

app.listen(port, host, () => {
    console.log(`Backend server listening on ${host}:${port} (Cloud Run compatible)`);
    console.log(`CORS origins: ${corsOrigins.join(', ')}`);
});

module.exports = app;
