const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

async function testScanAndRepository() {
    const API = 'http://localhost:5000/api';

    console.log('--- Logging in Officer ---');
    const testEmail = `officer_scan_${Date.now()}@metrology.gov.in`;
    const signupRes = await axios.post(`${API}/auth/signup`, {
        name: 'Officer Rajesh Sen',
        email: testEmail,
        password: 'Password123'
    });
    const token = signupRes.data.token;
    console.log('Officer logged in:', signupRes.data.user.name);

    // Create a 1x1 dummy PNG buffer to test upload
    // Base64 of a minimal 1x1 red PNG
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const imageBuffer = Buffer.from(pngBase64, 'base64');

    console.log('\n--- Testing Officer Scan with saveToRepository = true ---');
    const form = new FormData();
    form.append('image', imageBuffer, { filename: 'test_product_label.png', contentType: 'image/png' });
    form.append('saveToRepository', 'true');
    form.append('productName', 'Haldirams Bhujia 400g');

    const scanRes = await axios.post(`${API}/officer/scan`, form, {
        headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${token}`
        }
    });

    console.log('Scan Status:', scanRes.data.status);
    console.log('Overall Status:', scanRes.data.overallStatus);
    console.log('Saved Inspection ID:', scanRes.data.savedInspection?._id);
    console.log('Evidence Images:', scanRes.data.savedInspection?.evidenceImages);

    const inspectionId = scanRes.data.savedInspection?._id;
    if (!inspectionId) {
        throw new Error('Inspection was not saved!');
    }

    console.log('\n--- Testing /api/officer/repository ---');
    const repoRes = await axios.get(`${API}/officer/repository`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Repository Total:', repoRes.data.total);
    console.log('First Inspection in Repo:', repoRes.data.inspections[0]?.productName);

    console.log('\n--- Testing /api/officer/repository/:id ---');
    const detailRes = await axios.get(`${API}/officer/repository/${inspectionId}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Fetched Detail ID:', detailRes.data.inspection._id);

    console.log('\n--- Testing /api/officer/dashboard ---');
    const dashRes = await axios.get(`${API}/officer/dashboard`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Dashboard Summary:', dashRes.data.summary);
    console.log('Recent Inspections count:', dashRes.data.recentInspections.length);

    console.log('\n--- Testing DOCX Export ---');
    const docxRes = await axios.post(`${API}/officer/report/docx`, {
        scanTimestamp: new Date().toISOString(),
        productName: 'Haldirams Bhujia 400g',
        overallStatus: 'POTENTIAL_NON_COMPLIANCE',
        extractedFields: { productName: 'Haldirams Bhujia', mrp: { value: '120' } },
        findings: [{ ruleCode: 'PCR-01', field: 'mrp', status: 'PASS', reason: 'MRP printed' }]
    }, { responseType: 'arraybuffer' });
    console.log('DOCX Buffer received bytes:', docxRes.data.length);

    console.log('\n--- Testing Delete Inspection ---');
    const deleteRes = await axios.delete(`${API}/officer/repository/${inspectionId}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Delete Response:', deleteRes.data);

    const repoAfterDelete = await axios.get(`${API}/officer/repository`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Repository Total after delete:', repoAfterDelete.data.total);

    console.log('\n✅ ALL SCAN, CLOUDINARY, REPOSITORY, DASHBOARD & DOCX TESTS PASSED!');
}

testScanAndRepository().catch(err => {
    console.error('Scan & Repo test failed:', err.response?.data || err.message);
});
