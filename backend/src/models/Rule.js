const mongoose = require('mongoose');

const ruleSchema = new mongoose.Schema({
    ruleCode: {
        type: String,
        required: true,
        unique: true
    },
    field: {
        type: String,
        required: true
    },
    category: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    validation: {
        type: {
            type: String,
            required: true,
            enum: ['presence', 'format', 'range', 'crossField']
        },
        params: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    effectiveFrom: {
        type: Date,
        required: true
    },
    effectiveTo: {
        type: Date,
        default: null
    },
    sourceReference: {
        type: String,
        required: true
    },
    severity: {
        type: String,
        required: true,
        enum: ['high', 'medium', 'low']
    }
}, { timestamps: true });

const Rule = mongoose.model('Rule', ruleSchema);

module.exports = Rule;
