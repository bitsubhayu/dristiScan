/**
 * DrishtiScan — Lightweight Multi-Photo Evidence Fusion Service
 * 
 * Consolidates per-photo OCR rows across multiple angles prior to LLM structuring:
 * - Preserves STABLE original row IDs across all downstream pipeline stages
 * - Conflict-safe: never collapses conflicting statutory values (MRP, dates, qty, batch, country)
 * - Retains 100% of unique rows from every photo angle
 * - Stores complete supporting sourceRefs on each fused row
 * - Purely evidence management — zero field inference, zero LLM calls
 */

const { extractExplicitCountryFromDeclaration } = require('./textShapeValidators');

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
 * Identifies whether a text line contains statutory / regulatory declaration concepts.
 */
const STATUTORY_PATTERNS = [
    /\b(?:mrp|m\.?\s*r\.?\s*p|max(?:imum)?\s*retail\s*price)\b/i,
    /\b(?:usp|unit\s*sale\s*price)\b/i,
    /\b(?:net\s*(?:qty|quantity|weight|wt|vol|volume|contents))\b/i,
    /\b(?:exp|expiry|use\s*by|best\s*before)\b/i,
    /\b(?:mfg|mfd|packed|pkd|manufactured|date\s*of\s*(?:mfg|pkd|packaging))\b/i,
    /\b(?:batch|lot|b\.?\s*no)\b/i,
    /\b(?:fssai|lic(?:ense)?\s*no)\b/i,
    /\b(?:country\s*of\s*origin|country\s*of\s*manufacture|made\s*in|manufactured\s*in|product\s*of|origin)\b/i,
    /\b(?:ingredients?|ingredents?)\b/i
];

const isPotentialStatutoryRow = (text) => {
    if (!text || typeof text !== 'string') return false;
    return STATUTORY_PATTERNS.some(pat => pat.test(text));
};

/**
 * Determines whether two rows are safe to merge without destroying conflicting statutory evidence.
 * Safety Principle: FALSE DUPLICATE < FALSE UNIQUE.
 */
const areSafeToMergeRows = (rowA, rowB) => {
    const textA = rowA.text || '';
    const textB = rowB.text || '';
    const normA = rowA.normText || normalizeTextForDeduplication(textA);
    const normB = rowB.normText || normalizeTextForDeduplication(textB);

    // 1. If exact normalized text matches: SAFE to merge
    if (normA === normB) return true;

    const isStatA = isPotentialStatutoryRow(textA);
    const isStatB = isPotentialStatutoryRow(textB);

    // If one is statutory and the other is not: DO NOT merge
    if (isStatA !== isStatB) return false;

    // 2. If both are statutory: check numeric/date tokens, batch, country, etc.
    if (isStatA && isStatB) {
        // Numeric tokens check (e.g. MRP 99 vs MRP 98, NET QTY 500g vs 50g, EXP 12/2026 vs 11/2026)
        const digitsA = (textA.match(/\d+(?:\.\d+)?/g) || []).join(' ');
        const digitsB = (textB.match(/\d+(?:\.\d+)?/g) || []).join(' ');
        if (digitsA !== digitsB) {
            return false; // Numbers differ materially!
        }

        // Country declaration check
        const isCountryA = /^(?:country\s*of\s*origin|country\s*of\s*manufacture|made\s*in|manufactured\s*in|product\s*of|origin)/i.test(textA.trim());
        const isCountryB = /^(?:country\s*of\s*origin|country\s*of\s*manufacture|made\s*in|manufactured\s*in|product\s*of|origin)/i.test(textB.trim());
        if (isCountryA || isCountryB) {
            if (isCountryA !== isCountryB) return false;
            const countryA = extractExplicitCountryFromDeclaration(textA);
            const countryB = extractExplicitCountryFromDeclaration(textB);
            if (!countryA || !countryB || countryA.toLowerCase() !== countryB.toLowerCase()) {
                return false;
            }
        }

        // Batch / License alphanumeric code check
        const isBatchA = /\b(?:batch|lot|b\.?\s*no|fssai|lic)\b/i.test(textA);
        const isBatchB = /\b(?:batch|lot|b\.?\s*no|fssai|lic)\b/i.test(textB);
        if (isBatchA || isBatchB) {
            if (isBatchA !== isBatchB) return false;
            const codeA = textA.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            const codeB = textB.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            if (codeA !== codeB) return false;
        }

        // If they passed all statutory token checks, check near-identical
        return areNearIdentical(normA, normB);
    }

    // For ordinary descriptive prose, retain conservative near-identical logic
    return areNearIdentical(normA, normB);
};

/**
 * Fuses multi-photo evidence packages deterministically.
 * Preserves stable original rowId from primary source photo and tracks all sourceRefs.
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
            stats: { totalInputRows: 0, fusedRowCount: 0, deduplicatedCount: 0, preservedUniqueRows: 0 }
        };
    }

    const rowLookupMap = new Map();
    const allGroundingRefs = new Map(); // `${photoId}:${rowId}` -> Array of corroborating refs

    let totalInputRows = 0;
    const flatRows = [];

    photoRowsList.forEach(({ photoId, rows }) => {
        (rows || []).forEach((row, rowIndex) => {
            totalInputRows++;
            // STABLE ROW ID: preserve existing row.rowId or use original rowIndex
            const stableRowId = row.rowId !== undefined ? row.rowId : rowIndex;

            const text = (row.text || (row.elements && row.elements.map(e => e.text).join(' ')) || '').trim();
            const confidence = typeof row.confidence === 'number'
                ? row.confidence
                : (Array.isArray(row.elements) && row.elements.length > 0
                    ? row.elements.reduce((acc, el) => acc + (el.confidence || 0.8), 0) / row.elements.length
                    : 0.8);

            const normText = normalizeTextForDeduplication(text);
            const key = `${photoId}:${stableRowId}`;
            rowLookupMap.set(key, text);

            flatRows.push({
                photoId,
                rowId: stableRowId,
                text,
                normText,
                confidence: Math.round(confidence * 100) / 100,
                rowRef: row,
                cells: row.cells || row.elements || [],
                normalizedBbox: row.normalizedBbox || [],
                sourceRefs: Array.isArray(row.sourceRefs) && row.sourceRefs.length > 0
                    ? row.sourceRefs
                    : [{ photoId, rowId: stableRowId }]
            });
        });
    });

    if (photoRowsList.length <= 1) {
        // Single photo — ensure stable rowId and sourceRefs on each row
        const singleFusedPhotoRows = photoRowsList.map(p => ({
            photoId: p.photoId,
            rows: (p.rows || []).map((row, rowIndex) => {
                const stableRowId = row.rowId !== undefined ? row.rowId : rowIndex;
                const refs = Array.isArray(row.sourceRefs) && row.sourceRefs.length > 0
                    ? row.sourceRefs
                    : [{ photoId: p.photoId, rowId: stableRowId }];
                allGroundingRefs.set(`${p.photoId}:${stableRowId}`, refs);
                return {
                    ...row,
                    rowId: stableRowId,
                    sourceRefs: refs
                };
            })
        }));

        return {
            fusedPhotoRows: singleFusedPhotoRows,
            rowLookupMap,
            allGroundingRefs,
            stats: { totalInputRows, fusedRowCount: totalInputRows, deduplicatedCount: 0, preservedUniqueRows: totalInputRows }
        };
    }

    // Multi-photo fusion: cluster repeated rows across photos with conflict safety
    const clusters = [];

    for (const item of flatRows) {
        if (!item.normText || item.normText.length < 2) {
            // Keep very short or empty rows as standalone unique clusters
            clusters.push({
                canonicalText: item.text,
                bestConfidence: item.confidence,
                bestCells: item.cells,
                bestBbox: item.normalizedBbox,
                primaryPhotoId: item.photoId,
                primaryRowId: item.rowId,
                refs: [...item.sourceRefs],
                originalRow: item.rowRef
            });
            continue;
        }

        // Search for existing cluster match using conflict-safe merge criteria
        let matchedCluster = null;
        for (const cluster of clusters) {
            if (areSafeToMergeRows(item, { text: cluster.canonicalText, normText: normalizeTextForDeduplication(cluster.canonicalText) })) {
                matchedCluster = cluster;
                break;
            }
        }

        if (matchedCluster) {
            // Add all supporting refs from item to the matched cluster
            for (const ref of item.sourceRefs) {
                if (!matchedCluster.refs.some(r => r.photoId === ref.photoId && r.rowId === ref.rowId)) {
                    matchedCluster.refs.push(ref);
                }
            }

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
                refs: [...item.sourceRefs],
                originalRow: item.rowRef
            });
        }
    }

    // Populate cross-reference lookups so every photoId:rowId resolves to its canonical text
    for (const cluster of clusters) {
        for (const ref of cluster.refs) {
            const refKey = `${ref.photoId}:${ref.rowId}`;
            allGroundingRefs.set(refKey, cluster.refs);
            if (!rowLookupMap.has(refKey) || rowLookupMap.get(refKey).length < cluster.canonicalText.length) {
                rowLookupMap.set(refKey, cluster.canonicalText);
            }
        }
        // Ensure primary key also resolves
        const primaryKey = `${cluster.primaryPhotoId}:${cluster.primaryRowId}`;
        rowLookupMap.set(primaryKey, cluster.canonicalText);
        allGroundingRefs.set(primaryKey, cluster.refs);
    }

    // Reassemble fusedPhotoRows grouped by primaryPhotoId
    // Each row retains its original primary rowId explicitly
    const photoGroupMap = new Map();
    photoRowsList.forEach(p => photoGroupMap.set(p.photoId, []));

    for (const cluster of clusters) {
        const targetPhotoId = cluster.primaryPhotoId;
        const targetList = photoGroupMap.get(targetPhotoId) || [];

        const consolidatedRow = {
            ...(cluster.originalRow || {}),
            rowId: cluster.primaryRowId,
            text: cluster.canonicalText,
            confidence: cluster.bestConfidence,
            cells: cluster.bestCells,
            normalizedBbox: cluster.bestBbox,
            sourceRefs: cluster.refs
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
    const preservedUniqueRows = clusters.filter(c => c.refs.length === 1).length;

    return {
        fusedPhotoRows,
        rowLookupMap,
        allGroundingRefs,
        stats: {
            totalInputRows,
            fusedRowCount,
            deduplicatedCount,
            preservedUniqueRows
        }
    };
};

module.exports = {
    normalizeTextForDeduplication,
    quickLevenshtein,
    areNearIdentical,
    isPotentialStatutoryRow,
    areSafeToMergeRows,
    fuseMultiPhotoEvidence
};
