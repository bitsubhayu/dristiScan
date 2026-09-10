const mongoose = require('mongoose');
const { getOperationalDb } = require('../config/db');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    passwordHash: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['officer', 'admin'],
        default: 'officer',
        required: true
    },
    otp: {
        codeHash: {
            type: String,
            default: null
        },
        expiresAt: {
            type: Date,
            default: null
        }
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const opDb = getOperationalDb();
const User = opDb.model('User', userSchema);

module.exports = User;
