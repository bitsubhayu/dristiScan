/**
 * DrishtiScan — OCR Reconstruction Layer
 * 
 * Generic 2D geometry and row reconstruction from bounding boxes:
 * - groupIntoRows: reconstructs visual reading rows from bounding boxes
 * - generateCandidateTitles: produces single-line and multi-line candidate titles
 */

const {
    isDateShaped,
    isMarketingBadge,
    isNonProductTitleCandidate
} = require('./textShapeValidators');

/**
 * Generic Spatial Line & Row Reconstruction Layer
 *
 * Reconstructs visual reading rows from bounding boxes using generic 2D geometry:
 * - Sorts elements top-to-bottom and left-to-right
 * - Groups elements belonging to the same visual row based on vertical overlap and height tolerance
 * - Dynamically adapts to varying font sizes (e.g. large numbers next to small units)
 * - Preserves separate visual rows for multi-line text
 * - Preserves two-column layouts and split tokens
 * - Discards zero OCR evidence
 *
 * @param {Array<Object>} rawElements - Array of { index, text, confidence, bbox }
 * @returns {Object} { rows: Array<Object>, orderedElements: Array<Object>, fullText: string }
 */
const groupIntoRows = (rawElements = []) => {
    if (!Array.isArray(rawElements) || rawElements.length === 0) {
        return { rows: [], orderedElements: [], fullText: '' };
    }

    const parseBBox = (bbox) => {
        if (!bbox || !Array.isArray(bbox) || bbox.length < 4) return null;
        let xs, ys;
        if (Array.isArray(bbox[0]) || (bbox[0] && typeof bbox[0] === 'object')) {
            xs = bbox.map(p => Array.isArray(p) ? p[0] : (typeof p?.x === 'number' ? p.x : 0));
            ys = bbox.map(p => Array.isArray(p) ? p[1] : (typeof p?.y === 'number' ? p.y : 0));
        } else if (bbox.length === 4 && typeof bbox[0] === 'number') {
            xs = [bbox[0], bbox[2]];
            ys = [bbox[1], bbox[3]];
        } else {
            return null;
        }
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const height = Math.max(1, maxY - minY);
        const width = Math.max(1, maxX - minX);
        const centerY = (minY + maxY) / 2;
        const centerX = (minX + maxX) / 2;
        return { minX, maxX, minY, maxY, height, width, centerY, centerX };
    };

    const positioned = [];
    const unpositioned = [];

    for (const el of rawElements) {
        const geo = parseBBox(el.bbox || el.boundingBox);
        if (geo) {
            positioned.push({
                ...geo,
                originalElement: el,
                text: (el.text || '').trim(),
                confidence: typeof el.confidence === 'number' ? el.confidence : 0.8,
                index: el.index
            });
        } else {
            unpositioned.push(el);
        }
    }

    // Coarse sort top-to-bottom then left-to-right
    positioned.sort((a, b) => {
        if (Math.abs(a.minY - b.minY) > 2) {
            return a.minY - b.minY;
        }
        return a.minX - b.minX;
    });

    const rows = [];

    for (const elem of positioned) {
        let bestRow = null;
        let minCenterDiff = Infinity;

        for (const row of rows) {
            const verticalOverlap = Math.max(0, Math.min(row.maxY, elem.maxY) - Math.max(row.minY, elem.minY));
            const minH = Math.min(row.height, elem.height);
            const maxH = Math.max(row.height, elem.height);
            const overlapRatio = verticalOverlap / minH;
            const diffCenterY = Math.abs(elem.centerY - row.centerY);

            // Same visual row if:
            // 1. Substantial vertical overlap (>= 35% of the shorter element)
            // 2. OR center of one falls within the bounding vertical span of the other
            //    and vertical center difference is within 0.55 * maxH (handles large font next to small font)
            const withinBounds = (elem.centerY >= row.minY && elem.centerY <= row.maxY) ||
                                 (row.centerY >= elem.minY && row.centerY <= elem.maxY);

            if ((overlapRatio >= 0.35 || (withinBounds && diffCenterY <= maxH * 0.55)) && diffCenterY < maxH * 0.75) {
                if (diffCenterY < minCenterDiff) {
                    minCenterDiff = diffCenterY;
                    bestRow = row;
                }
            }
        }

        if (bestRow) {
            bestRow.elements.push(elem);
            bestRow.minY = Math.min(bestRow.minY, elem.minY);
            bestRow.maxY = Math.max(bestRow.maxY, elem.maxY);
            bestRow.minX = Math.min(bestRow.minX, elem.minX);
            bestRow.maxX = Math.max(bestRow.maxX, elem.maxX);
            bestRow.height = bestRow.maxY - bestRow.minY;
            bestRow.centerY = bestRow.elements.reduce((sum, e) => sum + e.centerY, 0) / bestRow.elements.length;
        } else {
            rows.push({
                minY: elem.minY,
                maxY: elem.maxY,
                minX: elem.minX,
                maxX: elem.maxX,
                height: elem.height,
                centerY: elem.centerY,
                elements: [elem]
            });
        }
    }

    // Sort rows top-to-bottom by centerY
    rows.sort((a, b) => a.centerY - b.centerY);

    // Sort elements within each row left-to-right by minX
    for (const row of rows) {
        row.elements.sort((a, b) => a.minX - b.minX);

        // Detect columns if large horizontal gap exists between adjacent elements
        const columns = [];
        let currentColumn = [];
        for (let i = 0; i < row.elements.length; i++) {
            const el = row.elements[i];
            if (currentColumn.length === 0) {
                currentColumn.push(el);
            } else {
                const prevEl = currentColumn[currentColumn.length - 1];
                const gap = el.minX - prevEl.maxX;
                const threshold = Math.max(prevEl.height, el.height) * 2.0;
                if (gap > threshold) {
                    columns.push(currentColumn);
                    currentColumn = [el];
                } else {
                    currentColumn.push(el);
                }
            }
        }
        if (currentColumn.length > 0) {
            columns.push(currentColumn);
        }
        row.columns = columns.map(col => col.map(e => e.originalElement));
        let rowText = '';
        for (let i = 0; i < row.elements.length; i++) {
            const t = (row.elements[i].text || '').trim();
            if (i === 0) {
                rowText = t;
            } else {
                const prev = (row.elements[i - 1].text || '').trim();
                if (/[/-]$/.test(prev) || /^[/-]/.test(t)) {
                    rowText += t;
                } else {
                    rowText += ' ' + t;
                }
            }
        }
        row.text = rowText;
    }

    const orderedElements = [];
    for (const row of rows) {
        for (const el of row.elements) {
            orderedElements.push(el.originalElement);
        }
    }
    orderedElements.push(...unpositioned);

    const formattedRows = rows.map(r => ({
        text: r.text,
        elements: r.elements.map(e => e.originalElement),
        minY: r.minY,
        maxY: r.maxY,
        minX: r.minX,
        maxX: r.maxX,
        centerY: r.centerY,
        height: r.height,
        columns: r.columns || []
    }));

    return {
        rows: formattedRows,
        orderedElements,
        fullText: formattedRows.map(r => r.text).join('\n')
    };
};

/**
 * Generic Candidate Title Generation (Single-line & Multi-line)
 *
 * Combines visually adjacent rows in the upper display area that share
 * alignment and similar font height into multi-line candidates, while
 * strictly enforcing negative constraints against dates, marketing slogans,
 * instructions, nutrition, addresses, and statutory declarations.
 */
const generateCandidateTitles = (structuredRows, rawElements) => {
    const candidates = [];
    const rows = structuredRows?.rows || [];

    // 1. Single-line candidates from rawElements
    for (const el of rawElements) {
        const tr = (el.text || '').trim();
        if (!tr || isDateShaped(tr) || isMarketingBadge(tr) || isNonProductTitleCandidate(tr)) continue;
        if (tr.length >= 3 && tr.length <= 60) {
            candidates.push(el);
        }
    }

    // Helper to disqualify rows from multi-line title formation
    const isDisqualifiedRow = (text) => {
        if (!text || typeof text !== 'string') return true;
        const t = text.trim();
        if (t.length < 2) return true;
        if (isDateShaped(t) || isMarketingBadge(t) || isNonProductTitleCandidate(t)) return true;
        // Administrative / statutory prefixes
        if (/^(?:MRP|M\.?\s*R\.?\s*P\.?|Net\s*(?:Qty|Wt|Weight|Vol|Contents)|Mfg|Mfd|Exp|Best\s*Before|Batch|Lic|FSSAI|Servings?|Ingredients?|Nutritio|Storage|Directions?|Caution|Warning|Marketed|Manufactured|Packed|Imported|Consumer|Customer)\b/i.test(t)) return true;
        // Instruction keywords
        if (/\b(?:tear|cut|open|peel|fold|pull|press|push|twist)\b.{0,20}\b(?:here|along|line|tab)/i.test(t)) return true;
        // Address keywords
        if (/\b(?:road|street|nagar|plot|industrial|dist|district|pin\s*code|\b\d{6}\b)\b/i.test(t)) return true;
        // Nutrition declaration line
        if (/^(?:Total\s*Fat|Protein|Carbohydrates?|Energy|Calories|Sodium|Sugar)\s*[:.-]?\s*\d+/i.test(t)) return true;
        // Corporate / brand indicator lines should not form multi-line product titles
        if (/\b(?:foods|organics|labs|pharma|nutrition|mills|beverages|brewing|industries|farms|grains|enterprises|brands|corporation|company|pvt|ltd|inc|llc)\b/i.test(t)) return true;
        return false;
    };

    // 2. Multi-line candidates from visually adjacent rows (pairs)
    const maxImgY = Math.max(...rows.map(r => r.maxY), 1000);

    for (let i = 0; i < rows.length - 1; i++) {
        const rowA = rows[i];
        const rowB = rows[i + 1];

        if (isDisqualifiedRow(rowA.text) || isDisqualifiedRow(rowB.text)) continue;

        // Must be in upper 75% of package
        if (rowA.centerY / maxImgY > 0.75) continue;

        // Vertical gap
        const verticalGap = rowB.minY - rowA.maxY;
        const maxH = Math.max(rowA.height, rowB.height);
        const minH = Math.min(rowA.height, rowB.height);

        // Gap must not be excessive
        if (verticalGap < -0.25 * maxH || verticalGap > 1.35 * maxH) continue;

        // Font heights must be comparable
        if (minH / maxH < 0.40) continue;

        // Horizontal relationship: overlap or horizontal proximity
        const hOverlap = Math.max(0, Math.min(rowA.maxX, rowB.maxX) - Math.max(rowA.minX, rowB.minX));
        const leftAlignDiff = Math.abs(rowA.minX - rowB.minX);
        const centerDiff = Math.abs(rowA.centerX - rowB.centerX);
        const hasHorizontalRelation = hOverlap > 0 || leftAlignDiff < maxH * 2.5 || centerDiff < maxH * 2.5;
        if (!hasHorizontalRelation) continue;

        const combinedText = `${rowA.text.trim()} ${rowB.text.trim()}`;
        if (combinedText.length < 5 || combinedText.length > 70) continue;
        const words = combinedText.split(/\s+/);
        if (words.length < 2 || words.length > 7) continue;

        if (isNonProductTitleCandidate(combinedText) || isMarketingBadge(combinedText) || isDateShaped(combinedText)) continue;

        const combinedBBox = [
            [Math.min(rowA.minX, rowB.minX), rowA.minY],
            [Math.max(rowA.maxX, rowB.maxX), rowA.minY],
            [Math.max(rowA.maxX, rowB.maxX), rowB.maxY],
            [Math.min(rowA.minX, rowB.minX), rowB.maxY]
        ];

        candidates.push({
            text: combinedText,
            confidence: Math.min(...rowA.elements.concat(rowB.elements).map(e => e.confidence || 0.8)),
            bbox: combinedBBox,
            isMultiLine: true,
            constituentElements: [...rowA.elements, ...rowB.elements]
        });
    }

    return candidates;
};

module.exports = {
    groupIntoRows,
    generateCandidateTitles
};
