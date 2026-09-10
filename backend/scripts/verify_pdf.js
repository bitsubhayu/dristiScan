const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function verifyPdfDownloads() {
    const API = 'http://localhost:5000/api';
    const outputDir = path.join(__dirname, '..', 'test_downloads');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const sampleInspectionData = {
        scanTimestamp: new Date().toISOString(),
        productName: 'NutriPure Pure Cow Ghee 500ml',
        overallStatus: 'PASS',
        extractedFields: {
            productName: 'NutriPure Pure Cow Ghee 500ml',
            brandName: 'NutriPure',
            netQuantity: { value: '500', unit: 'ml' },
            servingsPerContainer: 33,
            servingSize: '15ml',
            mrp: { value: '420', inclusiveOfTaxes: true },
            unitSalePrice: '0.84/ml',
            dates: { manufacture: '02/2026', expiry: '02/2027' },
            batchNumber: 'LOT-GHEE-2026-X',
            fssaiLicenseNumber: '10019022009876',
            manufacturer: { name: 'NutriPure Dairy Ltd', address: 'Plot 12, Gujarat Industrial Estate' },
            countryOfOrigin: 'India',
            consumerCare: { phone: '1800-222-3333', email: 'support@nutripure.in' }
        },
        findings: [
            { ruleCode: 'PCR-R6-1-A', field: 'productName', status: 'PASS', reason: 'Product name clearly declared on principal display panel', sourceReference: 'PCR 2011, R.6(1)(a)' },
            { ruleCode: 'PCR-R6-1-B', field: 'netQuantity', status: 'PASS', reason: 'Net quantity declared in standard metric units (ml)', sourceReference: 'PCR 2011, R.6(1)(b)' },
            { ruleCode: 'PCR-R6-1-C', field: 'mrp', status: 'PASS', reason: 'MRP declared inclusive of all taxes', sourceReference: 'PCR 2011, R.6(1)(c)' },
            { ruleCode: 'PCR-R6-1-D', field: 'dates.manufacture', status: 'PASS', reason: 'Month and year of manufacture declared', sourceReference: 'PCR 2011, R.6(1)(d)' },
            { ruleCode: 'PCR-R6-1-E', field: 'unitSalePrice', status: 'PASS', reason: 'USP calculated and declared properly', sourceReference: 'PCR 2011, R.6(1)(e)' }
        ],
        listingMismatchCheck: {
            performed: true,
            mismatches: []
        }
    };

    console.log('====================================================');
    console.log('PDF VERIFICATION: TEST 1 - GUEST SESSION');
    console.log('====================================================');
    const guestRes = await axios.post(API + '/auth/guest');
    const guestToken = guestRes.data.token;
    console.log('1. Guest session established:', guestRes.data.user);

    const guestPdfRes = await axios.post(API + '/officer/report/pdf', sampleInspectionData, {
        headers: { Authorization: 'Bearer ' + guestToken },
        responseType: 'arraybuffer'
    });

    console.log('2. HTTP Status:', guestPdfRes.status);
    console.log('3. Content-Type Header:', guestPdfRes.headers['content-type']);
    console.log('4. Content-Disposition Header:', guestPdfRes.headers['content-disposition']);
    
    const guestFilename = 'Compliance_Report_Guest_' + Date.now() + '.pdf';
    const guestFilePath = path.join(outputDir, guestFilename);
    fs.writeFileSync(guestFilePath, Buffer.from(guestPdfRes.data));
    console.log('5. Saved downloaded file:', guestFilename, '(' + guestPdfRes.data.length + ' bytes)');
    
    const guestMagic = Buffer.from(guestPdfRes.data).slice(0, 5).toString();
    console.log('6. Magic bytes verification:', guestMagic, '-> Valid PDF:', guestMagic === '%PDF-');

    console.log('\n====================================================');
    console.log('PDF VERIFICATION: TEST 2 - SIGNED-IN OFFICER SESSION');
    console.log('====================================================');
    const officerEmail = 'officer_audit_' + Date.now() + '@metrology.gov.in';
    await axios.post(API + '/auth/signup', {
        name: 'Senior Inspector R. Sharma',
        email: officerEmail,
        password: 'SecurePassword123'
    });
    const officerLoginRes = await axios.post(API + '/auth/login', {
        email: officerEmail,
        password: 'SecurePassword123'
    });
    const officerToken = officerLoginRes.data.token;
    console.log('1. Officer logged in:', officerLoginRes.data.user);

    const officerPdfRes = await axios.post(API + '/officer/report/pdf', sampleInspectionData, {
        headers: { Authorization: 'Bearer ' + officerToken },
        responseType: 'arraybuffer'
    });

    console.log('2. HTTP Status:', officerPdfRes.status);
    console.log('3. Content-Type Header:', officerPdfRes.headers['content-type']);
    console.log('4. Content-Disposition Header:', officerPdfRes.headers['content-disposition']);

    const officerFilename = 'Compliance_Report_Officer_' + Date.now() + '.pdf';
    const officerFilePath = path.join(outputDir, officerFilename);
    fs.writeFileSync(officerFilePath, Buffer.from(officerPdfRes.data));
    console.log('5. Saved downloaded file:', officerFilename, '(' + officerPdfRes.data.length + ' bytes)');

    const officerMagic = Buffer.from(officerPdfRes.data).slice(0, 5).toString();
    console.log('6. Magic bytes verification:', officerMagic, '-> Valid PDF:', officerMagic === '%PDF-');

    // Inspect decompressed text stream within the PDF
    let pos = 0;
    let decodedSnippets = [];
    const zlib = require('zlib');
    while ((pos = officerPdfRes.data.indexOf(Buffer.from('stream'), pos)) !== -1) {
        const start = pos + 6 + (officerPdfRes.data[pos + 6] === 13 && officerPdfRes.data[pos + 7] === 10 ? 2 : (officerPdfRes.data[pos + 6] === 10 ? 1 : 0));
        const end = officerPdfRes.data.indexOf(Buffer.from('endstream'), start);
        if (end === -1) break;
        try {
            const inflated = zlib.inflateSync(officerPdfRes.data.slice(start, end)).toString('utf-8');
            const hexMatches = inflated.match(/<([0-9a-fA-F]+)>/g) || [];
            hexMatches.forEach(h => {
                const text = Buffer.from(h.replace(/<|>/g, ''), 'hex').toString('utf-8');
                if (text.trim()) decodedSnippets.push(text.trim());
            });
        } catch (_) {}
        pos = end + 9;
    }

    const allDecoded = decodedSnippets.join('');
    const hasReportTitle = allDecoded.includes('DRISHTISCAN COMPLIANCE REPORT');
    const hasMetrologyRef = allDecoded.includes('Legal Metrology');
    const hasGhee = allDecoded.includes('NutriPure Pure Cow Ghee');
    console.log('\n7. Content inspection:');
    console.log('   - Has "DRISHTISCAN COMPLIANCE REPORT":', hasReportTitle);
    console.log('   - Has "Legal Metrology":', hasMetrologyRef);
    console.log('   - Has product name "NutriPure Pure Cow Ghee":', hasGhee);
    console.log('   - Extracted snippets sample:', decodedSnippets.slice(0, 8).join(' | '));

    console.log('\n✅ PDF VERIFICATION COMPLETE FOR BOTH GUEST AND OFFICER SESSIONS!');
}

verifyPdfDownloads().catch(e => console.error('Verification error:', e.message));
