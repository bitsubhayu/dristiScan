/**
 * DrishtiScan — Lightweight Multi-Photo Evidence Fusion Service
 * 
 * Consolidates per-photo OCR rows across multiple angles prior to LLM structuring:
 * - Deterministic deduplication of exact and near-identical rows across photos
 * - Preserves ALL unique rows from every photo angle (never drops unique evidence)
 * - Retains best confidence, canonical text, and all supporting photoId/rowId references
 * - A duplicate or low-quality row in one photo NEVER erases a clearer declaration in another
 * - Purely evidence management — zero field inference, zero LLM calls
 */

/**
 * Normalizes text conservatively for duplicate detection:
 * lowercase, collapses whitespace, standardizes punctuation and quotes.
 * Does NOT alter semantic content.
 */
const normalizeTextForDeduplication = (text) => {
    if (!text || typeof text !== 'string') return '';
    return text
        .toLowerCase()
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/[^\w\s₹$€£%./\-:+]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

/**
 * Levenshtein distance for conservative near-identical row grouping.
 */
const quickLevenshtein = (a, b) => {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    if (Math.abs(m - n) > 5) return Infinity;

    const row0 = new Array(n + 1);
    const row1 = new Array(n + 1);

    for (let j = 0; j <= n; j++) row0[j] = j;

    for (let i = 0; i < m; i++) {
        row1[0] = i + 1;
        const aChar = a[i];
        for (let j = 0; j < n; j++) {
            const cost = (aChar === b[j]) ? 0 : 1;
            row1[j + 1] = Math.min(row1[j] + 1, row0[j + 1] + 1, row0[j] + cost);
        }
        for (let j = 0; j <= n; j++) row0[j] = row1[j];
    }
    return row0[n];
};

/**
 * Check if two normalized text strings are near-identical.
 * Conservative threshold: <= 1 edit for short strings (<=15 chars), <= 2 for longer.
 */
const areNearIdentical = (normA, normB) => {
    if (!normA || !normB) return false;
    if (normA === normB) return true;
    const lenA = normA.length;
    const lenB = normB.length;
    const maxLen = Math.max(lenA, lenB);
    if (maxLen < 4) return false;
    if (Math.abs(lenA - lenB) > 3) return false;

    const maxDistance = maxLen <= 15 ? 1 : 2;
    return quickLevenshtein(normA, normB) <= maxDistance;
};

/**
 * Fuses multi-photo evidence packages deterministically.
 * 
 * @param {Array<Object>} photoRowsList - Array of { photoId, rows }
 * @returns {Object} { fusedPhotoRows, rowLookupMap, allGroundingRefs, stats }
 */
const fuseMultiPhotoEvidence = (photoRowsList = []) => {
    if (!Array.isArray(photoRowsList) || photoRowsList.length === 0) {
        return {
            fusedPhotoRows: [],
            rowLookupMap: new Map(),
            allGroundingRefs: new Map(),
            stats: { totalInputRows: 0, fusedRowCount: 0, deduplicatedCount: 0 }
        };
    }

    // If only one photo, preserve all rows as-is while populating lookup
    const rowLookupMap = new Map();
    const allGroundingRefs = new Map(); // `${photoId}:${rowId}` -> Array of corroborating refs

    let totalInputRows = 0;
    const flatRows = [];

    photoRowsList.forEach(({ photoId, rows }) => {
        (rows || []).forEach((row, rowId) => {
            totalInputRows++;
            const text = (row.text || (row.elements && row.elements.map(e => e.text).join(' ')) || '').trim();
            const confidence = typeof row.confidence === 'number'
                ? row.confidence
                : (Array.isArray(row.elements) && row.elements.length > 0
                    ? row.elements.reduce((acc, el) => acc + (el.confidence || 0.8), 0) / row.elements.length
                    : 0.8);

            const normText = normalizeTextForDeduplication(text);
            const key = `${photoId}:${rowId}`;
            rowLookupMap.set(key, text);

            flatRows.push({
                photoId,
                rowId,
                text,
                normText,
                confidence: Math.round(confidence * 100) / 100,
                rowRef: row,
                cells: row.cells || row.elements || [],
                normalizedBbox: row.normalizedBbox || []
            });
        });
    });

    if (photoRowsList.length <= 1) {
        // Single photo — no cross-photo deduplication needed
        return {
            fusedPhotoRows: photoRowsList,
            rowLookupMap,
            allGroundingRefs,
            stats: { totalInputRows, fusedRowCount: totalInputRows, deduplicatedCount: 0 }
        };
    }

    // Multi-photo fusion: cluster repeated rows across photos
    const clusters = []; // Array of { canonicalText, bestConfidence, bestCells, bestBbox, primaryPhotoId, primaryRowId, refs: [{ photoId, rowId }] }

    for (const item of flatRows) {
        if (!item.normText || item.normText.length < 2) {
            // Keep very short or empty rows without clustering
            clusters.push({
                canonicalText: item.text,
                bestConfidence: item.confidence,
                bestCells: item.cells,
                bestBbox: item.normalizedBbox,
                primaryPhotoId: item.photoId,
                primaryRowId: item.rowId,
                refs: [{ photoId: item.photoId, rowId: item.rowId }],
                originalRow: item.rowRef
            });
            continue;
        }

        // Search for existing cluster match
        let matchedCluster = null;
        for (const cluster of clusters) {
            const clusterNorm = normalizeTextForDeduplication(cluster.canonicalText);
            if (areNearIdentical(item.normText, clusterNorm)) {
                matchedCluster = cluster;
                break;
            }
        }

        if (matchedCluster) {
            // Add supporting ref
            matchedCluster.refs.push({ photoId: item.photoId, rowId: item.rowId });

            // Update canonical text if item is higher confidence or longer/clearer
            if (item.confidence > matchedCluster.bestConfidence || 
               (Math.abs(item.confidence - matchedCluster.bestConfidence) < 0.1 && item.text.length > matchedCluster.canonicalText.length)) {
                matchedCluster.canonicalText = item.text;
                matchedCluster.bestConfidence = Math.max(matchedCluster.bestConfidence, item.confidence);
                if (item.cells && item.cells.length > 0) {
                    matchedCluster.bestCells = item.cells;
                }
                if (item.normalizedBbox && item.normalizedBbox.length > 0) {
                    matchedCluster.bestBbox = item.normalizedBbox;
                }
            } else {
                matchedCluster.bestConfidence = Math.max(matchedCluster.bestConfidence, item.confidence);
            }
        } else {
            // New unique row cluster
            clusters.push({
                canonicalText: item.text,
                bestConfidence: item.confidence,
                bestCells: item.cells,
                bestBbox: item.normalizedBbox,
                primaryPhotoId: item.photoId,
                primaryRowId: item.rowId,
                refs: [{ photoId: item.photoId, rowId: item.rowId }],
                originalRow: item.rowRef
            });
        }
    }

    // Build cross-reference lookup so every photoId:rowId resolves to its canonical text
    for (const cluster of clusters) {
        for (const ref of cluster.refs) {
            const refKey = `${ref.photoId}:${ref.rowId}`;
            allGroundingRefs.set(refKey, cluster.refs);
            // Ensure lookup has the canonical text in addition to original
            if (!rowLookupMap.has(refKey) || rowLookupMap.get(refKey).length < cluster.canonicalText.length) {
                rowLookupMap.set(refKey, cluster.canonicalText);
            }
        }
    }

    // Reassemble fusedPhotoRows grouped by primaryPhotoId to preserve photo awareness
    const photoGroupMap = new Map();
    photoRowsList.forEach(p => photoGroupMap.set(p.photoId, []));

    for (const cluster of clusters) {
        const targetPhotoId = cluster.primaryPhotoId;
        const targetList = photoGroupMap.get(targetPhotoId) || [];

        const consolidatedRow = {
            ...(cluster.originalRow || {}),
            text: cluster.canonicalText,
            confidence: cluster.bestConfidence,
            cells: cluster.bestCells,
            normalizedBbox: cluster.bestBbox,
            corroboratedIn: cluster.refs.filter(r => !(r.photoId === cluster.primaryPhotoId && r.rowId === cluster.primaryRowId))
        };

        targetList.push(consolidatedRow);
        photoGroupMap.set(targetPhotoId, targetList);
    }

    const fusedPhotoRows = [];
    for (const [photoId, rows] of photoGroupMap.entries()) {
        fusedPhotoRows.push({
            photoId,
            rows
        });
    }

    const fusedRowCount = clusters.length;
    const deduplicatedCount = totalInputRows - fusedRowCount;

    return {
        fusedPhotoRows,
        rowLookupMap,
        allGroundingRefs,
        stats: {
            totalInputRows,
            fusedRowCount,
            deduplicatedCount
        }
    };
};

module.exports = {
    normalizeTextForDeduplication,
    areNearIdentical,
    fuseMultiPhotoEvidence
};
