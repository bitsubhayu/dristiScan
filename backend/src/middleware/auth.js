const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'drishtiscan_default_secret_key_2026';

/**
 * Extract and verify JWT token from Authorization header or cookies
 */
const authenticateToken = (req, res, next) => {
    let token = null;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && (req.cookies.jwt || req.cookies.token)) {
        token = req.cookies.jwt || req.cookies.token;
    }

    if (!token) {
        req.user = null;
        return next();
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        // Token invalid or expired
        req.user = null;
        next();
    }
};

/**
 * Require logged in user with specific roles
 * @param {string[]} allowedRoles - array of allowed roles, e.g. ['officer', 'admin']
 */
const requireAuth = (allowedRoles = ['officer', 'admin']) => {
    return (req, res, next) => {
        // Ensure authenticateToken was executed or extract now
        if (req.user === undefined) {
            authenticateToken(req, res, () => {
                checkRole();
            });
        } else {
            checkRole();
        }

        function checkRole() {
            if (!req.user) {
                return res.status(401).json({
                    error: 'Authentication required. Please sign in.'
                });
            }

            if (req.user.role === 'guest' && !allowedRoles.includes('guest')) {
                return res.status(403).json({
                    error: 'Guests cannot perform this operation. Please sign in with an officer or admin account.'
                });
            }

            if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.role)) {
                return res.status(403).json({
                    error: 'Access forbidden: Insufficient privileges.'
                });
            }

            next();
        }
    };
};

module.exports = {
    authenticateToken,
    requireAuth
};
