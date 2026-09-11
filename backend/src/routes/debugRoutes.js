const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const DEBUG_DIR = path.join(__dirname, '../../debug_scans');

// GET /api/debug/scans - List all saved debug scan traces
router.get('/scans', (req, res) => {
    try {
        if (!fs.existsSync(DEBUG_DIR)) {
            return res.json({ scans: [] });
        }
        const files = fs.readdirSync(DEBUG_DIR).filter(f => f.endsWith('.json'));
        const traces = [];

        for (const file of files) {
            try {
                const fullPath = path.join(DEBUG_DIR, file);
                const stats = fs.statSync(fullPath);
                const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                traces.push({
                    scanId: content.scanId || path.basename(file, '.json'),
                    timestamp: content.timestamp || stats.mtime,
                    endpoint: content.endpoint || 'unknown',
                    totalImages: content.totalImagesInScan || 0,
                    sizeBytes: stats.size,
                    productName: content.mergedExtractedFields?.productName || null,
                    mrp: content.mergedExtractedFields?.mrp?.value || null
                });
            } catch (err) {
                // skip corrupted file
            }
        }

        // Sort descending by timestamp / creation
        traces.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        res.json({ count: traces.length, scans: traces });
    } catch (error) {
        console.error('[Debug Scans List Error]:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/debug/scan/:scanId - Return full detailed debug trace
router.get('/scan/:scanId', (req, res) => {
    try {
        const { scanId } = req.params;
        const sanitizedId = scanId.replace(/[^a-zA-Z0-9_-]/g, '');
        const filePath = path.join(DEBUG_DIR, `${sanitizedId}.json`);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: `Debug scan trace "${sanitizedId}" not found.` });
        }

        const trace = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        res.json(trace);
    } catch (error) {
        console.error('[Debug Scan Fetch Error]:', error);
        res.status(500).json({ error: error.message });
    }
});

const dns = require('dns');
const tls = require('tls');
const mongoose = require('mongoose');

function safeParseMongoUri(uri) {
    if (!uri || typeof uri !== 'string') return { exists: false };
    const match = uri.match(/^(mongodb(?:\+srv)?:\/\/)(?:([^:]+):([^@]+)@)?([^/?]+)(?:\/([^?]+))?(?:\?(.*))?$/);
    if (!match) return { exists: true, validFormat: false };
    return {
        exists: true,
        validFormat: true,
        protocol: match[1],
        hasAuth: Boolean(match[2] && match[3]),
        usernameLength: match[2] ? match[2].length : 0,
        host: match[4],
        database: match[5] || null,
        query: match[6] || null,
        isExpectedHost: match[4] === 'compliance.ygkkvkd.mongodb.net',
        isExpectedDb: (match[5] || '').split('?')[0] === 'DrishtiScan'
    };
}

// GET /api/debug/db-diagnostic - Comprehensive diagnostic of Cloud Run -> MongoDB connection
router.get('/db-diagnostic', async (req, res) => {
    const diagnostic = {
        timestamp: new Date().toISOString(),
        platform: process.platform,
        nodeVersion: process.version,
        activeDnsServers: dns.getServers(),
        env: {
            MONGODB_URI: safeParseMongoUri(process.env.MONGODB_URI),
            OPERATIONAL_MONGODB_URI: safeParseMongoUri(process.env.OPERATIONAL_MONGODB_URI),
            NODE_ENV: process.env.NODE_ENV || 'unspecified'
        },
        mongooseState: {
            readyState: mongoose.connection.readyState,
            readyStateText: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState],
            host: mongoose.connection.host || null,
            name: mongoose.connection.name || null
        },
        dnsTests: {},
        tlsTests: [],
        mongoTest: null
    };

    // 1. Container default DNS SRV lookup
    try {
        const srv = await dns.promises.resolveSrv('_mongodb._tcp.compliance.ygkkvkd.mongodb.net');
        diagnostic.dnsTests.containerDnsSrv = { success: true, count: srv.length, records: srv };
    } catch (e) {
        diagnostic.dnsTests.containerDnsSrv = { success: false, error: e.message, code: e.code };
    }

    // 2. Public DNS (8.8.8.8) SRV lookup
    try {
        const resolver = new dns.promises.Resolver();
        resolver.setServers(['8.8.8.8', '1.1.1.1']);
        const srv8888 = await resolver.resolveSrv('_mongodb._tcp.compliance.ygkkvkd.mongodb.net');
        diagnostic.dnsTests.publicDnsSrv = { success: true, count: srv8888.length, records: srv8888 };
    } catch (e) {
        diagnostic.dnsTests.publicDnsSrv = { success: false, error: e.message, code: e.code };
    }

    // 3. DNS TXT lookup
    try {
        const txt = await dns.promises.resolveTxt('compliance.ygkkvkd.mongodb.net');
        diagnostic.dnsTests.txt = { success: true, records: txt };
    } catch (e) {
        diagnostic.dnsTests.txt = { success: false, error: e.message, code: e.code };
    }

    // 4. TLS Connectivity to Shards
    const shards = (diagnostic.dnsTests.publicDnsSrv?.records || diagnostic.dnsTests.containerDnsSrv?.records || []).map(r => r.name);
    if (shards.length === 0) {
        shards.push('ac-fdyibbw-shard-00-00.ygkkvkd.mongodb.net', 'ac-fdyibbw-shard-00-01.ygkkvkd.mongodb.net', 'ac-fdyibbw-shard-00-02.ygkkvkd.mongodb.net');
    }

    for (const shard of shards) {
        const t0 = Date.now();
        try {
            await new Promise((resolve, reject) => {
                const socket = tls.connect({
                    host: shard,
                    port: 27017,
                    servername: shard,
                    timeout: 4000
                }, () => {
                    socket.destroy();
                    resolve();
                });
                socket.on('error', (err) => {
                    socket.destroy();
                    reject(err);
                });
                socket.on('timeout', () => {
                    socket.destroy();
                    reject(new Error('TLS handshake timeout after 4000ms'));
                });
            });
            diagnostic.tlsTests.push({ host: shard, port: 27017, success: true, latencyMs: Date.now() - t0 });
        } catch (err) {
            diagnostic.tlsTests.push({ host: shard, port: 27017, success: false, latencyMs: Date.now() - t0, error: err.message, code: err.code });
        }
    }

    // 5. Test MongoDB connection or reconnect if requested
    const mongoUri = process.env.MONGODB_URI;
    if (mongoUri) {
        try {
            if (req.query.usePublicDns === 'true') {
                dns.setServers(['8.8.8.8', '1.1.1.1']);
            }
            const testConn = await mongoose.createConnection(mongoUri, {
                serverSelectionTimeoutMS: 6000
            }).asPromise();
            const ping = await testConn.db.command({ ping: 1 });
            const count = await testConn.db.collection('rules').countDocuments();
            diagnostic.mongoTest = { success: true, ping, rulesCount: count, dbName: testConn.name, host: testConn.host };
            await testConn.close();

            if (req.query.reconnect === 'true') {
                await mongoose.disconnect();
                await mongoose.connect(mongoUri, {
                    serverSelectionTimeoutMS: 6000
                });
                diagnostic.mongooseState = {
                    readyState: mongoose.connection.readyState,
                    readyStateText: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState],
                    host: mongoose.connection.host || null,
                    name: mongoose.connection.name || null
                };
            }
        } catch (err) {
            diagnostic.mongoTest = {
                success: false,
                error: err.message,
                name: err.name,
                reason: err.reason ? String(err.reason) : null,
                code: err.code
            };
        }
    }

    res.json(diagnostic);
});

module.exports = router;
