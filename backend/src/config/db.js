const mongoose = require('mongoose');
const dns = require('dns');

// DNS server override for all environments to ensure SRV resolution works reliably across platforms and containers
try { 
    dns.setServers(['8.8.8.8', '1.1.1.1']); 
} catch (e) {
    // Ignore if not supported
}

let rulesDbConnection = mongoose.connection;
let operationalDbConnection = null;

// Helper to convert compliance cluster SRV URI to standard direct replica-set seedlist if needed
const toDirectUri = (srvUri) => {
    if (!srvUri || typeof srvUri !== 'string') return srvUri;
    if (srvUri.includes('compliance.ygkkvkd.mongodb.net') && srvUri.startsWith('mongodb+srv://')) {
        const match = srvUri.match(/^mongodb\+srv:\/\/([^:]+):([^@]+)@compliance\.ygkkvkd\.mongodb\.net(?:\/([^?]+))?(?:\?(.*))?$/);
        if (match) {
            const [_, user, pass, dbName, query] = match;
            const db = dbName || 'DrishtiScan';
            const extra = query ? `&${query}` : '&retryWrites=true&w=majority';
            return `mongodb://${user}:${pass}@ac-fdyibbw-shard-00-00.ygkkvkd.mongodb.net:27017,ac-fdyibbw-shard-00-01.ygkkvkd.mongodb.net:27017,ac-fdyibbw-shard-00-02.ygkkvkd.mongodb.net:27017/${db}?ssl=true&replicaSet=atlas-h37c65-shard-0&authSource=admin${extra}`;
        }
    }
    return srvUri;
};

const connectDB = async () => {
    // 1. Connect to Rules Database
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.warn('[DB] MONGODB_URI is not set. Rules DB connection skipped.');
        return;
    }

    try {
        await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 8000
        });
        console.log(`[DB] Rules MongoDB Connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
    } catch (error) {
        console.warn(`[DB] Rules MongoDB SRV Connection failed (${error.message}). Attempting direct replica-set fallback...`);
        try {
            const directUri = toDirectUri(mongoUri);
            await mongoose.connect(directUri, {
                serverSelectionTimeoutMS: 8000
            });
            console.log(`[DB] Rules MongoDB Connected (direct fallback): ${mongoose.connection.host}/${mongoose.connection.name}`);
        } catch (fallbackError) {
            console.error(`[DB] Rules MongoDB Connection Error: ${fallbackError.message}`);
        }
    }

    // 2. Connect to Operational Database (Users & Inspections)
    const operationalUri = process.env.OPERATIONAL_MONGODB_URI || 
        (mongoUri.includes('/') ? mongoUri.replace('/DrishtiScan', '/DrishtiScan_Operational') : null);

    if (operationalUri && !operationalDbConnection) {
        try {
            operationalDbConnection = mongoose.createConnection(operationalUri, {
                serverSelectionTimeoutMS: 8000
            });
            operationalDbConnection.on('connected', () => {
                console.log(`[DB] Operational MongoDB Connected: ${operationalDbConnection.host}/${operationalDbConnection.name}`);
            });
            operationalDbConnection.on('error', (err) => {
                console.error(`[DB] Operational MongoDB Error: ${err.message}`);
            });
        } catch (error) {
            console.warn(`[DB] Operational MongoDB SRV setup failed (${error.message}). Attempting direct replica-set fallback...`);
            try {
                const directOpUri = toDirectUri(operationalUri);
                operationalDbConnection = mongoose.createConnection(directOpUri, {
                    serverSelectionTimeoutMS: 8000
                });
                operationalDbConnection.on('connected', () => {
                    console.log(`[DB] Operational MongoDB Connected (direct fallback): ${operationalDbConnection.host}/${operationalDbConnection.name}`);
                });
                operationalDbConnection.on('error', (err) => {
                    console.error(`[DB] Operational MongoDB Error: ${err.message}`);
                });
            } catch (fallbackErr) {
                console.error(`[DB] Operational MongoDB Setup Error: ${fallbackErr.message}`);
            }
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
                    serverSelectionTimeoutMS: 8000
                });
                operationalDbConnection.on('connected', () => {
                    console.log(`[DB] Operational MongoDB Connected: ${operationalDbConnection.host}/${operationalDbConnection.name}`);
                });
                operationalDbConnection.on('error', (err) => {
                    console.error(`[DB] Operational MongoDB Error: ${err.message}`);
                });
            } catch (err) {
                try {
                    const directOpUri = toDirectUri(operationalUri);
                    operationalDbConnection = mongoose.createConnection(directOpUri, {
                        serverSelectionTimeoutMS: 8000
                    });
                    operationalDbConnection.on('connected', () => {
                        console.log(`[DB] Operational MongoDB Connected (direct fallback): ${operationalDbConnection.host}/${operationalDbConnection.name}`);
                    });
                    operationalDbConnection.on('error', (e) => {
                        console.error(`[DB] Operational MongoDB Error: ${e.message}`);
                    });
                } catch (fallbackErr) {
                    console.error(`[DB] Failed to create operational connection: ${fallbackErr.message}`);
                    return mongoose.connection;
                }
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
    rulesDbConnection,
    toDirectUri
};
