const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Rule = require('../models/Rule');
const { connectDB } = require('../config/db');

router.get('/', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            console.log('[RuleRoutes] Mongoose disconnected. Attempting reconnect before query...');
            await connectDB();
        }
        const rules = await Rule.find();
        res.json(rules);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
