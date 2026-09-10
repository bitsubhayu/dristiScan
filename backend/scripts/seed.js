require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const Rule = require('../src/models/Rule');

const seedDB = async () => {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI, {
            family: 4,
            serverSelectionTimeoutMS: 5000
        });
        console.log('Connected.');

        console.log('Clearing existing rules...');
        await Rule.deleteMany({});

        const seedDataPath = path.join(__dirname, '../../rules-data/seed-rules.json');
        const seedData = JSON.parse(fs.readFileSync(seedDataPath, 'utf-8'));

        console.log('Inserting seed rules...');
        await Rule.insertMany(seedData);

        console.log('Database seeded successfully!');
        process.exit(0);
    } catch (error) {
        console.error('Error seeding database:', error);
        process.exit(1);
    }
};

seedDB();
