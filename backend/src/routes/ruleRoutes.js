const express = require('express');
const router = express.Router();
const Rule = require('../models/Rule');

router.get('/', async (req, res) => {
    try {
        const rules = await Rule.find();
        res.json(rules);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
