const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');
const {
    loginLimiter,
    signupLimiter,
    forgotPasswordLimiter,
    resetPasswordLimiter
} = require('../middleware/rateLimiter');

router.post('/signup', signupLimiter, authController.signup);
router.post('/login', loginLimiter, authController.login);
router.post('/guest', authController.guest);
router.post('/forgot-password', forgotPasswordLimiter, authController.forgotPassword);
router.post('/reset-password', resetPasswordLimiter, authController.resetPassword);
router.post('/logout', authController.logout);
router.get('/me', authenticateToken, authController.getMe);

module.exports = router;
