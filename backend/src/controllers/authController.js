const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { sendOTPEmail } = require('../services/emailService');

const JWT_SECRET = process.env.JWT_SECRET || 'drishtiscan_default_secret_key_2026';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '7d';
const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10);

const generateToken = (payload, expiresIn = JWT_EXPIRY) => {
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
};

const setAuthCookie = (res, token, maxAgeMs = 7 * 24 * 60 * 60 * 1000) => {
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
        httpOnly: true,
        // In cross-site production deployments (e.g. Vercel frontend + Cloud Run backend),
        // sameSite must be 'none' paired with secure: true so browsers send cookies on cross-origin requests.
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: maxAgeMs
    });
};

// POST /api/auth/signup
const signup = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required.' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters.' });
        }

        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.status(409).json({ error: 'An account with this email already exists.' });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const newUser = await User.create({
            name: name.trim(),
            email: normalizedEmail,
            passwordHash,
            role: 'officer'
        });

        const tokenPayload = {
            id: newUser._id.toString(),
            name: newUser.name,
            email: newUser.email,
            role: newUser.role
        };

        const token = generateToken(tokenPayload);
        setAuthCookie(res, token);

        res.status(201).json({
            status: 'success',
            message: 'Officer account created successfully.',
            token,
            user: tokenPayload
        });
    } catch (error) {
        console.error('[Auth Signup Error]:', error);
        res.status(500).json({ error: 'Internal server error during registration.' });
    }
};

// POST /api/auth/login
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const user = await User.findOne({ email: normalizedEmail });

        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const tokenPayload = {
            id: user._id.toString(),
            name: user.name,
            email: user.email,
            role: user.role
        };

        const token = generateToken(tokenPayload);
        setAuthCookie(res, token);

        res.json({
            status: 'success',
            message: 'Signed in successfully.',
            token,
            user: tokenPayload
        });
    } catch (error) {
        console.error('[Auth Login Error]:', error);
        res.status(500).json({ error: 'Internal server error during login.' });
    }
};

// POST /api/auth/guest
const guest = async (req, res) => {
    try {
        const guestPayload = {
            id: `guest_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            name: 'Guest Officer',
            role: 'guest'
        };

        // Short lived token: 24h
        const token = generateToken(guestPayload, '24h');
        setAuthCookie(res, token, 24 * 60 * 60 * 1000);

        res.json({
            status: 'success',
            message: 'Guest session initialized.',
            token,
            user: guestPayload
        });
    } catch (error) {
        console.error('[Auth Guest Error]:', error);
        res.status(500).json({ error: 'Internal server error initializing guest session.' });
    }
};

// POST /api/auth/forgot-password
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required.' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const user = await User.findOne({ email: normalizedEmail });

        if (!user) {
            // For security, return friendly message even if email not found
            return res.json({
                status: 'success',
                message: 'If this email is registered, a 6-digit verification code has been dispatched.'
            });
        }

        // Generate 6-digit OTP using cryptographically secure random
        const otpCode = crypto.randomInt(100000, 999999).toString();
        const codeHash = await bcrypt.hash(otpCode, 8);
        const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

        user.otp = {
            codeHash,
            expiresAt
        };
        await user.save();

        await sendOTPEmail(user.email, otpCode);

        res.json({
            status: 'success',
            message: 'If this email is registered, a 6-digit verification code has been dispatched.'
        });
    } catch (error) {
        console.error('[Forgot Password Error]:', error);
        res.status(500).json({ error: 'Internal server error processing reset request.' });
    }
};

// POST /api/auth/reset-password
const resetPassword = async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;

        if (!email || !otp || !newPassword) {
            return res.status(400).json({ error: 'Email, OTP code, and new password are required.' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters.' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const user = await User.findOne({ email: normalizedEmail });

        if (!user || !user.otp || !user.otp.codeHash || !user.otp.expiresAt) {
            return res.status(400).json({ error: 'Invalid or expired OTP code. Please request a new one.' });
        }

        if (new Date() > new Date(user.otp.expiresAt)) {
            return res.status(400).json({ error: 'OTP code has expired. Please request a new code.' });
        }

        const isMatch = await bcrypt.compare(otp.trim(), user.otp.codeHash);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid verification code.' });
        }

        // Phase 6 (Audit Fix): Atomically clear OTP BEFORE resetting password
        // to enforce one-time use — prevents race conditions where two concurrent
        // requests could both pass the compare check.
        const atomicClear = await User.findOneAndUpdate(
            { email: normalizedEmail, 'otp.codeHash': user.otp.codeHash },
            { $set: { 'otp.codeHash': null, 'otp.expiresAt': null } }
        );
        if (!atomicClear) {
            // Another request already consumed this OTP
            return res.status(400).json({ error: 'OTP code has already been used. Please request a new one.' });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        user.passwordHash = newHash;
        await user.save();

        res.json({
            status: 'success',
            message: 'Password has been reset successfully. You can now log in.'
        });
    } catch (error) {
        console.error('[Reset Password Error]:', error);
        res.status(500).json({ error: 'Internal server error resetting password.' });
    }
};

// POST /api/auth/logout
const logout = (req, res) => {
    const isProduction = process.env.NODE_ENV === 'production';
    const clearCookieOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax'
    };
    res.clearCookie('token', clearCookieOptions);
    res.clearCookie('jwt', clearCookieOptions);
    res.json({ status: 'success', message: 'Logged out successfully.' });
};

// GET /api/auth/me
const getMe = (req, res) => {
    if (!req.user) {
        return res.status(401).json({ user: null });
    }
    res.json({ user: req.user });
};

module.exports = {
    signup,
    login,
    guest,
    forgotPassword,
    resetPassword,
    logout,
    getMe
};
