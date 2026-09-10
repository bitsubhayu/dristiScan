const mongoose = require('mongoose');
const dns = require('dns');

// DNS server override for Windows local environments only (avoid overriding in Linux / Cloud Run)
if (process.platform === 'win32' && process.env.NODE_ENV !== 'production') {
    try { 
        dns.setServers(['8.8.8.8', '1.1.1.1']); 
    } catch (e) {
        // Ignore if not supported
    }
}

let rulesDbConnection = mongoose.connection;
let operationalDbConnection = null;

const connectDB = async () => {
    // 1. Connect to Rules Database
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.warn('[DB] MONGODB_URI is not set. Rules DB connection skipped.');
        return;
    }

    try {
        await mongoose.connect(mongoUri, {
            family: 4,
            serverSelectionTimeoutMS: 8000
        });
        console.log(`[DB] Rules MongoDB Connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
    } catch (error) {
        console.error(`[DB] Rules MongoDB Connection Error: ${error.message}`);
    }

    // 2. Connect to Operational Database (Users & Inspections)
    const operationalUri = process.env.OPERATIONAL_MONGODB_URI || 
        (mongoUri.includes('/') ? mongoUri.replace('/DrishtiScan', '/DrishtiScan_Operational') : null);

    if (operationalUri && !operationalDbConnection) {
        try {
            operationalDbConnection = mongoose.createConnection(operationalUri, {
                family: 4,
                serverSelectionTimeoutMS: 8000
            });
            operationalDbConnection.on('connected', () => {
                console.log(`[DB] Operational MongoDB Connected: ${operationalDbConnection.host}/${operationalDbConnection.name}`);
            });
            operationalDbConnection.on('error', (err) => {
                console.error(`[DB] Operational MongoDB Error: ${err.message}`);
            });
        } catch (error) {
            console.error(`[DB] Operational MongoDB Setup Error: ${error.message}`);
        }
    }
};

const getOperationalDb = () => {
    if (!operationalDbConnection) {
        const mongoUri = process.env.MONGODB_URI;
        const operationalUri = process.env.OPERATIONAL_MONGODB_URI || 
            (mongoUri && mongoUri.includes('/') ? mongoUri.replace('/DrishtiScan', '/DrishtiScan_Operational') : null);

        if (operationalUri && typeof operationalUri === 'string' && operationalUri.trim().length > 0) {
            try {
                operationalDbConnection = mongoose.createConnection(operationalUri, {
                    family: 4,
                    serverSelectionTimeoutMS: 8000
                });
                operationalDbConnection.on('connected', () => {
                    console.log(`[DB] Operational MongoDB Connected: ${operationalDbConnection.host}/${operationalDbConnection.name}`);
                });
                operationalDbConnection.on('error', (err) => {
                    console.error(`[DB] Operational MongoDB Error: ${err.message}`);
                });
            } catch (err) {
                console.error(`[DB] Failed to create operational connection: ${err.message}`);
                return mongoose.connection;
            }
        } else {
            // If operational URI is not configured, fallback to default mongoose connection
            // to allow model registration without throwing a fatal startup error
            return mongoose.connection;
        }
    }
    return operationalDbConnection;
};

module.exports = {
    connectDB,
    getOperationalDb,
    rulesDbConnection
};
