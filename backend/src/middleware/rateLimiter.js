/**
 * Phase 6 (Audit Fix): In-memory rate limiter middleware.
 * Protects auth endpoints from brute-force attacks without requiring
 * an external dependency like express-rate-limit.
 *
 * Uses a simple sliding-window approach per IP address.
 * NOTE: In a multi-instance deployment, replace with Redis-backed limiter.
 */

const rateLimitStores = {};

/**
 * Create a rate limiter middleware
 * @param {Object} options
 * @param {string} options.name - Unique name for this limiter (used as store key)
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.max - Maximum requests per window
 * @param {string} [options.message] - Custom error message
 * @returns {Function} Express middleware
 */
const createRateLimiter = ({ name, windowMs, max, message }) => {
    if (!rateLimitStores[name]) {
        rateLimitStores[name] = new Map();
    }
    const store = rateLimitStores[name];

    // Periodic cleanup of expired entries (every windowMs)
    setInterval(() => {
        const now = Date.now();
        for (const [key, record] of store) {
            if (now - record.windowStart > windowMs * 2) {
                store.delete(key);
            }
        }
    }, windowMs).unref(); // .unref() so the interval doesn't prevent process exit

    return (req, res, next) => {
        const key = req.ip || req.connection.remoteAddress || 'unknown';
        const now = Date.now();

        let record = store.get(key);
        if (!record || now - record.windowStart > windowMs) {
            record = { windowStart: now, count: 0 };
            store.set(key, record);
        }

        record.count++;

        if (record.count > max) {
            const retryAfterSec = Math.ceil((record.windowStart + windowMs - now) / 1000);
            res.set('Retry-After', String(retryAfterSec));
            return res.status(429).json({
                error: message || 'Too many requests. Please try again later.',
                retryAfterSeconds: retryAfterSec
            });
        }

        next();
    };
};

// Pre-configured limiters for auth endpoints
const loginLimiter = createRateLimiter({
    name: 'login',
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,                   // 10 attempts per 15 min
    message: 'Too many login attempts. Please try again in 15 minutes.'
});

const signupLimiter = createRateLimiter({
    name: 'signup',
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,                    // 5 signups per hour per IP
    message: 'Too many account creation attempts. Please try again later.'
});

const forgotPasswordLimiter = createRateLimiter({
    name: 'forgotPassword',
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,                    // 5 attempts per 15 min
    message: 'Too many password reset requests. Please try again in 15 minutes.'
});

const resetPasswordLimiter = createRateLimiter({
    name: 'resetPassword',
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,                    // 5 attempts per 15 min
    message: 'Too many password reset attempts. Please try again in 15 minutes.'
});

const scanLimiter = createRateLimiter({
    name: 'scan',
    windowMs: 60 * 1000,      // 1 minute
    max: 10,                   // 10 scans per minute per IP
    message: 'Too many scan requests. Please wait before scanning again.'
});

module.exports = {
    createRateLimiter,
    loginLimiter,
    signupLimiter,
    forgotPasswordLimiter,
    resetPasswordLimiter,
    scanLimiter
};
