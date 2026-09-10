const PDFDocument = require('pdfkit');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Fetch image buffer from URL or local file path
 */
const getImageBuffer = async (imgUrl) => {
    if (!imgUrl) return null;
    try {
        if (imgUrl.startsWith('http://') || imgUrl.startsWith('https://')) {
            const res = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 5000 });
            return Buffer.from(res.data);
        } else if (imgUrl.startsWith('/uploads/')) {
            const localPath = path.join(__dirname, '..', '..', imgUrl);
            if (fs.existsSync(localPath)) {
                return await fs.promises.readFile(localPath);
            }
        }
    } catch (e) {
        console.warn(`[Report Image Warning] Could not load image: ${imgUrl} (${e.message})`);
    }
    return null;
};

/**
 * Generate a clean, compact PDF Compliance Report (2 to 4 pages typical)
 * Avoids raw OCR line dumps and formats photos in a compact 2-column grid.
 */
const generatePDF = async (reportData) => {
    return new Promise(async (resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 40, size: 'A4', autoFirstPage: true });
            const buffers = [];
            
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const pdfData = Buffer.concat(buffers);
                resolve(pdfData);
            });

            // Colors
            const PRIMARY = '#1E293B';
            const SECONDARY = '#475569';
            const BORDER = '#E2E8F0';
            const BG_LIGHT = '#F8FAFC';
            const PASS_COLOR = '#16A34A';
            const FAIL_COLOR = '#DC2626';
            const WARN_COLOR = '#D97706';

            // Helper: Section Header
            const drawSectionHeader = (title) => {
                // Check if near bottom of page
                if (doc.y > 680) {
                    doc.addPage();
                }
                doc.moveDown(0.8);
                doc.fillColor(PRIMARY).fontSize(12).font('Helvetica-Bold').text(title);
                doc.moveTo(40, doc.y + 3).lineTo(555, doc.y + 3).strokeColor('#CBD5E1').stroke();
                doc.moveDown(0.6);
            };

            // 1. Header Banner
            doc.rect(40, 40, 515, 50).fill(PRIMARY);
            doc.fillColor('#FFFFFF').fontSize(18).font('Helvetica-Bold').text('DRISHTISCAN COMPLIANCE REPORT', 55, 52);
            doc.fontSize(9).font('Helvetica').text('Legal Metrology (Packaged Commodities) Rules, 2011 · Government of India', 55, 73);

            doc.y = 102;

            // 2. Metadata Box
            const status = reportData.overallStatus || 'UNKNOWN';
            const statusColor = (status === 'PASS' || status === 'COMPLIANT') 
                ? PASS_COLOR 
                : ((status === 'POTENTIAL_NON_COMPLIANCE' || status === 'NON_COMPLIANT' || status === 'FAIL') ? FAIL_COLOR : WARN_COLOR);
            
            doc.rect(40, doc.y, 515, 48).fillAndStroke(BG_LIGHT, BORDER);
            const metaY = doc.y + 10;
            
            doc.fillColor(SECONDARY).fontSize(9).font('Helvetica-Bold').text('Product Name:', 55, metaY);
            doc.fillColor(PRIMARY).font('Helvetica').text(reportData.productName || reportData.extractedFields?.productName || 'Unlabeled Product', 140, metaY, { width: 230 });

            doc.fillColor(SECONDARY).font('Helvetica-Bold').text('Scan Date:', 380, metaY);
            doc.fillColor(PRIMARY).font('Helvetica').text(new Date(reportData.scanTimestamp || Date.now()).toLocaleDateString(), 440, metaY);

            doc.fillColor(SECONDARY).font('Helvetica-Bold').text('Verdict:', 55, metaY + 18);
            doc.fillColor(statusColor).font('Helvetica-Bold').fontSize(11).text(status, 140, metaY + 16);

            doc.fillColor(SECONDARY).fontSize(9).font('Helvetica-Bold').text('Photos Scanned:', 380, metaY + 18);
            doc.fillColor(PRIMARY).font('Helvetica').text(`${reportData.extractedFields?.photoCount || 1} angle(s)`, 460, metaY + 18);

            doc.y = metaY + 45;

            // 3. Section 1: Extracted Declarations Table
            drawSectionHeader('1. Extracted Package Declarations');
            
            const fields = reportData.extractedFields || {};

            const isFieldAiAssisted = (fieldKey) => {
                if (!fieldKey) return false;
                if (fields.geminiMetadata?.fallback?.fieldsRecovered?.includes(fieldKey)) return true;
                const declKey = fieldKey.split('.')[0];
                const decl = fields.declarations?.[declKey];
                if (!decl) return false;
                if (decl.aiAssisted === true || decl.source === 'gemini_fallback') return true;
                if (fieldKey.includes('.') && decl[fieldKey.split('.')[1]]?.aiAssisted) return true;
                return false;
            };

            const displayFields = [
                ['Product Name', fields.productName || 'Not detected', 'productName'],
                ...(fields.brandName ? [['Brand Name', fields.brandName, 'brandName']] : []),
                ...(fields.genericCommodityName ? [['Generic Commodity Name', fields.genericCommodityName, 'genericCommodityName']] : []),
                ['Declared Net Quantity', fields.netQuantity?.value ? `${fields.netQuantity.value} ${fields.netQuantity.unit || ''}` : 'Not detected', 'netQuantity'],
                ['Servings per Container', fields.servingsPerContainer !== null && fields.servingsPerContainer !== undefined ? `${fields.servingsPerContainer} servings` : 'Not declared', 'servingsPerContainer'],
                ['Serving Size', fields.servingSize || 'Not declared', 'servingSize'],
                ['Maximum Retail Price (MRP)', fields.mrp?.value ? `Rs. ${fields.mrp.value} ${fields.mrp.inclusiveOfTaxes ? '(Incl. of all taxes)' : ''}` : 'Not detected', 'mrp'],
                ['Unit Sale Price (USP)', fields.unitSalePrice ? `Rs. ${fields.unitSalePrice}` : 'Not declared', 'unitSalePrice'],
                ['Mfg / Packing Date', fields.dates?.manufacture || 'Not detected', 'dates.manufacture'],
                ['Expiry / Best Before', fields.dates?.expiry || fields.dates?.bestBefore || 'Not detected', 'dates.expiry'],
                ['Batch / Lot Number', fields.batchNumber || 'Not detected', 'batchNumber'],
                ['FSSAI License No.', fields.fssaiLicenseNumber || 'Not detected', 'fssaiLicenseNumber'],
                ['Manufacturer Name', fields.manufacturer?.name || 'Not detected', 'manufacturer.name'],
                ...(fields.manufacturer?.address ? [['Manufacturer Address', fields.manufacturer.address, 'manufacturer.address']] : []),
                ['Marketer / Importer / Packer', fields.marketer?.name || fields.importer?.name || fields.packer?.name || 'Not detected', 'marketer.name'],
                ['Country of Origin', fields.countryOfOrigin || 'Not detected', 'countryOfOrigin'],
                ['Consumer Care Contact', [fields.consumerCare?.phone, fields.consumerCare?.email].filter(Boolean).join(' | ') || 'Not detected', 'consumerCare.phone']
            ];

            displayFields.forEach(([label, val, key], idx) => {
                const aiAssisted = isFieldAiAssisted(key);
                const rowHeight = aiAssisted ? 27 : 18;
                if (doc.y + rowHeight > 720) doc.addPage();
                const rowY = doc.y;
                const rowBg = idx % 2 === 0 ? '#FFFFFF' : BG_LIGHT;
                doc.rect(40, rowY, 515, rowHeight).fill(rowBg);
                doc.fillColor(SECONDARY).fontSize(8.5).font('Helvetica-Bold').text(label, 48, rowY + 4, { width: 170 });
                doc.fillColor(PRIMARY).font('Helvetica').text(val, 220, rowY + 4, { width: 325 });
                if (aiAssisted) {
                    doc.fillColor(WARN_COLOR).fontSize(7).font('Helvetica-Bold').text("Couldn't be read clearly from the photo -- please double-check this value.", 220, rowY + 15, { width: 325 });
                }
                doc.y = rowY + rowHeight;
            });

            // Conflict Warning if present
            if (fields.conflicts && fields.conflicts.length > 0) {
                doc.moveDown(0.5);
                fields.conflicts.forEach(c => {
                    doc.rect(40, doc.y, 515, 22).fillAndStroke('#FEF2F2', '#FCA5A5');
                    doc.fillColor(FAIL_COLOR).fontSize(8.5).font('Helvetica-Bold').text(`⚠️ MULTI-PHOTO DISCREPANCY: ${c.message}`, 48, doc.y + 5, { width: 500 });
                    doc.y += 24;
                });
            }

            // 4. Section 2: Legal Metrology Rule Evaluations Table
            drawSectionHeader('2. Regulatory Compliance Findings');

            const findings = reportData.findings || [];
            if (findings.length === 0) {
                doc.fillColor(SECONDARY).fontSize(9).font('Helvetica-Oblique').text('No specific rule findings recorded for this session.', 50, doc.y);
            } else {
                // Table Header
                const thY = doc.y;
                doc.rect(40, thY, 515, 18).fill('#E2E8F0');
                doc.fillColor(PRIMARY).fontSize(8.5).font('Helvetica-Bold');
                doc.text('Rule Code', 45, thY + 4, { width: 75 });
                doc.text('Field', 125, thY + 4, { width: 85 });
                doc.text('Status', 215, thY + 4, { width: 75 });
                doc.text('Finding / Value', 295, thY + 4, { width: 155 });
                doc.text('Citation', 455, thY + 4, { width: 95 });
                doc.y = thY + 20;

                findings.forEach((f, idx) => {
                    if (doc.y > 720) {
                        doc.addPage();
                    }
                    const rowY = doc.y;
                    const fColor = f.status === 'PASS' ? PASS_COLOR : (f.status === 'POTENTIAL_NON_COMPLIANCE' ? FAIL_COLOR : SECONDARY);
                    const rowBg = idx % 2 === 0 ? '#FFFFFF' : BG_LIGHT;
                    
                    doc.rect(40, rowY, 515, 20).fill(rowBg);
                    doc.fillColor(PRIMARY).fontSize(8).font('Helvetica').text(f.ruleCode || 'PCR-GEN', 45, rowY + 5, { width: 75 });
                    doc.text(f.field || 'General', 125, rowY + 5, { width: 85 });
                    doc.fillColor(fColor).font('Helvetica-Bold').text(f.status || 'N/A', 215, rowY + 5, { width: 75 });
                    doc.fillColor(PRIMARY).font('Helvetica').text(f.reason || f.extractedValue || 'Compliant', 295, rowY + 5, { width: 155 });
                    doc.fillColor(SECONDARY).fontSize(7.5).text(f.sourceReference || 'PCR 2011, R.6', 455, rowY + 5, { width: 95 });
                    doc.y = rowY + 20;
                });
            }

            // 5. Section 3: E-Commerce Mismatch Analysis
            if (reportData.listingMismatchCheck && reportData.listingMismatchCheck.performed) {
                drawSectionHeader('3. E-Commerce Listing Cross-Verification');
                const mismatches = reportData.listingMismatchCheck.mismatches || [];
                if (mismatches.length === 0) {
                    doc.fillColor(PASS_COLOR).fontSize(9).font('Helvetica-Bold').text('✓ Pass: All listed e-commerce attributes match physical package declarations.', 50, doc.y);
                    doc.y += 15;
                } else {
                    mismatches.forEach(m => {
                        doc.fillColor(FAIL_COLOR).fontSize(8.5).font('Helvetica-Bold').text(`[MISMATCH] ${m.field}:`, 50, doc.y);
                        doc.fillColor(PRIMARY).font('Helvetica').text(`Listed = "${m.listedValue}" vs Package = "${m.extractedValue}" (${m.description})`, 140, doc.y, { width: 400 });
                        doc.y += 15;
                    });
                }
            }

            // 6. Section 4: Compact Evidence Media Grid (Images resized, max 4 per page, 2-column)
            const evidenceImages = reportData.evidenceImages || [];
            if (evidenceImages.length > 0) {
                drawSectionHeader('4. Evidence Media Documentation');

                let imgCol = 0;
                let gridY = doc.y;

                for (let i = 0; i < evidenceImages.length; i++) {
                    const imgItem = evidenceImages[i];
                    const imgBuffer = await getImageBuffer(imgItem.url);

                    if (gridY > 600) {
                        doc.addPage();
                        gridY = 50;
                    }

                    const posX = imgCol === 0 ? 45 : 300;
                    const cardWidth = 240;
                    const cardHeight = 140;

                    // Draw image border card
                    doc.rect(posX, gridY, cardWidth, cardHeight).fillAndStroke('#F1F5F9', '#CBD5E1');

                    if (imgBuffer) {
                        try {
                            doc.image(imgBuffer, posX + 5, gridY + 5, { fit: [cardWidth - 10, cardHeight - 25], align: 'center', valign: 'center' });
                        } catch (imgErr) {
                            doc.fillColor(SECONDARY).fontSize(8).text('[Image Preview Error]', posX + 10, gridY + 50);
                        }
                    } else {
                        doc.fillColor(SECONDARY).fontSize(8).text(`[Media: ${imgItem.type}]`, posX + 10, gridY + 50);
                    }

                    // Caption
                    doc.fillColor(PRIMARY).fontSize(7.5).font('Helvetica-Bold').text(
                        `Photo #${i+1} · ${imgItem.caption || 'Evidence'}`,
                        posX + 5,
                        gridY + cardHeight - 16,
                        { width: cardWidth - 10, align: 'center' }
                    );

                    if (imgCol === 1 || i === evidenceImages.length - 1) {
                        imgCol = 0;
                        gridY += cardHeight + 12;
                    } else {
                        imgCol = 1;
                    }
                }
                doc.y = gridY + 10;
            }

            // 7. Footer
            if (doc.y > 740) doc.addPage();
            doc.y = Math.max(doc.y, 740);
            doc.fontSize(7.5).fillColor('#94A3B8').text(
                'DrishtiScan Metrology Enforcement Engine · Automated Legal Inspection Certificate',
                40,
                755,
                { align: 'center', width: 515 }
            );

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
};

/**
 * Generate Compact DOCX Report
 */
const generateDOCX = async (reportData) => {
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } = require('docx');

    const fields = reportData.extractedFields || {};
    const findings = reportData.findings || [];
    const mismatch = reportData.listingMismatchCheck;

    const BORDER_LIGHT = { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' };
    const cellBorders = { top: BORDER_LIGHT, bottom: BORDER_LIGHT, left: BORDER_LIGHT, right: BORDER_LIGHT };

    const p = (text, opts = {}) => new Paragraph({
        children: [new TextRun({ text: text || '', size: opts.size || 18, bold: opts.bold, color: opts.color, font: 'Calibri', italics: opts.italics })],
        spacing: { after: opts.after || 60 },
        alignment: opts.align,
    });

    const isFieldAiAssisted = (fieldKey) => {
        if (!fieldKey) return false;
        if (fields.geminiMetadata?.fallback?.fieldsRecovered?.includes(fieldKey)) return true;
        const declKey = fieldKey.split('.')[0];
        const decl = fields.declarations?.[declKey];
        if (!decl) return false;
        if (decl.aiAssisted === true || decl.source === 'gemini_fallback') return true;
        if (fieldKey.includes('.') && decl[fieldKey.split('.')[1]]?.aiAssisted) return true;
        return false;
    };

    const kvRow = (label, value, fieldKey = null) => {
        const aiAssisted = isFieldAiAssisted(fieldKey);
        const cellChildren = [p(value || 'Not detected', { size: 17 })];
        if (aiAssisted) {
            cellChildren.push(p("Couldn't be read clearly from the photo -- please double-check this value.", {
                size: 13,
                color: 'D97706',
                bold: true,
                after: 20
            }));
        }
        return new TableRow({
            children: [
                new TableCell({ children: [p(label, { bold: true, size: 17, color: '475569' })], width: { size: 35, type: WidthType.PERCENTAGE }, borders: cellBorders }),
                new TableCell({ children: cellChildren, width: { size: 65, type: WidthType.PERCENTAGE }, borders: cellBorders }),
            ]
        });
    };

    const isCompliant = reportData.overallStatus === 'PASS' || reportData.overallStatus === 'COMPLIANT';
    const isNonCompliant = reportData.overallStatus === 'POTENTIAL_NON_COMPLIANCE' || reportData.overallStatus === 'NON_COMPLIANT';

    const fieldsRows = [
        kvRow('Product Name', fields.productName, 'productName'),
        ...(fields.brandName ? [kvRow('Brand Name', fields.brandName, 'brandName')] : []),
        ...(fields.genericCommodityName ? [kvRow('Generic Commodity Name', fields.genericCommodityName, 'genericCommodityName')] : []),
        kvRow('Declared Net Quantity', fields.netQuantity?.value ? `${fields.netQuantity.value} ${fields.netQuantity.unit || ''}` : null, 'netQuantity'),
        kvRow('Servings per Container', fields.servingsPerContainer ? `${fields.servingsPerContainer} servings` : null, 'servingsPerContainer'),
        kvRow('Serving Size', fields.servingSize, 'servingSize'),
        kvRow('MRP', fields.mrp?.value ? `Rs. ${fields.mrp.value} ${fields.mrp.inclusiveOfTaxes ? '(Incl. taxes)' : ''}` : null, 'mrp'),
        kvRow('Unit Sale Price', fields.unitSalePrice, 'unitSalePrice'),
        kvRow('Mfg Date', fields.dates?.manufacture, 'dates.manufacture'),
        kvRow('Expiry Date', fields.dates?.expiry || fields.dates?.bestBefore, 'dates.expiry'),
        kvRow('Batch / Lot No.', fields.batchNumber, 'batchNumber'),
        kvRow('FSSAI License No.', fields.fssaiLicenseNumber, 'fssaiLicenseNumber'),
        kvRow('Manufacturer Name', fields.manufacturer?.name, 'manufacturer.name'),
        ...(fields.manufacturer?.address ? [kvRow('Manufacturer Address', fields.manufacturer.address, 'manufacturer.address')] : []),
        kvRow('Responsible Party (Packer/Marketer)', fields.packer?.name || fields.marketer?.name || fields.importer?.name, 'marketer.name'),
        kvRow('Country of Origin', fields.countryOfOrigin, 'countryOfOrigin'),
        kvRow('Customer Care', [fields.consumerCare?.phone, fields.consumerCare?.email].filter(Boolean).join(' | '), 'consumerCare.phone'),
    ];

    const fieldsTable = new Table({
        rows: fieldsRows,
        width: { size: 100, type: WidthType.PERCENTAGE },
    });

    const findingsTable = new Table({
        rows: [
            new TableRow({
                children: ['Rule Code', 'Field', 'Status', 'Finding / Reason'].map(h =>
                    new TableCell({
                        children: [p(h, { bold: true, size: 16, color: '1E293B' })],
                        borders: cellBorders,
                        shading: { fill: 'F1F5F9' },
                    })
                )
            }),
            ...findings.map(f => {
                const statusColor = (f.status === 'PASS' || f.status === 'COMPLIANT') ? '16A34A' : ((f.status === 'FAIL' || f.status === 'POTENTIAL_NON_COMPLIANCE') ? 'DC2626' : 'D97706');
                return new TableRow({
                    children: [
                        new TableCell({ children: [p(f.ruleCode || '-', { size: 16 })], borders: cellBorders }),
                        new TableCell({ children: [p(f.field || '-', { size: 16 })], borders: cellBorders }),
                        new TableCell({ children: [p(f.status || '-', { size: 16, bold: true, color: statusColor })], borders: cellBorders }),
                        new TableCell({ children: [p(f.reason || f.extractedValue || '-', { size: 16 })], borders: cellBorders }),
                    ]
                });
            })
        ],
        width: { size: 100, type: WidthType.PERCENTAGE },
    });

    const doc = new Document({
        sections: [{
            properties: {},
            children: [
                new Paragraph({
                    children: [new TextRun({ text: 'DRISHTISCAN COMPLIANCE REPORT', bold: true, size: 30, font: 'Calibri', color: '1E293B' })],
                    spacing: { after: 30 },
                }),
                p('Legal Metrology (Packaged Commodities) Rules, 2011 Inspection', { size: 16, color: '64748B', after: 140 }),
                p(`Product: ${reportData.productName || fields.productName || 'Unlabeled Product'} · Scan Date: ${new Date(reportData.scanTimestamp || Date.now()).toLocaleDateString()}`, { size: 16 }),
                p(`Overall Status: ${reportData.overallStatus || 'UNKNOWN'}`, { size: 20, bold: true, color: isCompliant ? '16A34A' : (isNonCompliant ? 'DC2626' : 'D97706'), after: 160 }),
                p('1. Extracted Package Declarations', { bold: true, size: 22, after: 80 }),
                fieldsTable,
                p('', { after: 140 }),
                p('2. Regulatory Compliance Findings', { bold: true, size: 22, after: 80 }),
                findingsTable,
                p('', { after: 180 }),
                p('Generated by DrishtiScan Metrology Enforcement Engine', { size: 13, color: '94A3B8', align: AlignmentType.CENTER }),
            ]
        }]
    });

    return await Packer.toBuffer(doc);
};

module.exports = { generatePDF, generateDOCX };
