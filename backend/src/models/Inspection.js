const mongoose = require('mongoose');
const { getOperationalDb } = require('../config/db');

const evidenceImageSchema = new mongoose.Schema({
    url: {
        type: String,
        required: true
    },
    publicId: {
        type: String,
        default: null
    },
    type: {
        type: String,
        enum: ['product_photo'],
        default: 'product_photo'
    },
    caption: {
        type: String,
        default: ''
    }
}, { _id: false });

const inspectionSchema = new mongoose.Schema({
    savedBy: {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        name: {
            type: String,
            required: true
        },
        role: {
            type: String,
            enum: ['officer', 'admin'],
            required: true
        }
    },
    scanTimestamp: {
        type: String,
        required: true
    },
    productName: {
        type: String,
        default: 'Unknown Product'
    },
    extractedFields: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    findings: {
        type: Array,
        default: []
    },
    overallStatus: {
        type: String,
        enum: ['PASS', 'POTENTIAL_NON_COMPLIANCE', 'NEEDS_REVIEW', 'COMPLIANT', 'NON_COMPLIANT', 'REVIEW', 'INSUFFICIENT_EVIDENCE'],
        default: 'NEEDS_REVIEW'
    },
    listingMismatchCheck: {
        performed: {
            type: Boolean,
            default: false
        },
        mismatches: {
            type: Array,
            default: []
        }
    },
    evidenceImages: [evidenceImageSchema],
    createdAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

// Create indexes for efficient searching & aggregations
inspectionSchema.index({ 'savedBy.userId': 1 });
inspectionSchema.index({ overallStatus: 1 });
inspectionSchema.index({ createdAt: -1 });
inspectionSchema.index({ productName: 'text' });

const opDb = getOperationalDb();
const Inspection = opDb.model('Inspection', inspectionSchema);

module.exports = Inspection;
