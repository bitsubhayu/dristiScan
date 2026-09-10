const mongoose = require('mongoose');
const dns = require('dns');

// DNS server override for Windows/Node environments
try { 
    dns.setServers(['8.8.8.8', '1.1.1.1']); 
} catch (e) {
    // Ignore if not supported
}

let rulesDbConnection = mongoose.connection;
let operationalDbConnection = null;

const connectDB = async () => {
    // 1. Connect to Rules Database
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            family: 4,
            serverSelectionTimeoutMS: 8000
        });
        console.log(`[DB] Rules MongoDB Connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
    } catch (error) {
        console.error(`[DB] Rules MongoDB Connection Error: ${error.message}`);
    }

    // 2. Connect to Operational Database (Users & Inspections)
    const operationalUri = process.env.OPERATIONAL_MONGODB_URI || 
        process.env.MONGODB_URI?.replace('/DrishtiScan', '/DrishtiScan_Operational');

    if (operationalUri) {
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
        const operationalUri = process.env.OPERATIONAL_MONGODB_URI || 
            process.env.MONGODB_URI?.replace('/DrishtiScan', '/DrishtiScan_Operational');
        operationalDbConnection = mongoose.createConnection(operationalUri, {
            family: 4,
            serverSelectionTimeoutMS: 8000
        });
    }
    return operationalDbConnection;
};

module.exports = {
    connectDB,
    getOperationalDb,
    rulesDbConnection
};
