# DrishtiScan — Fusion Conflict-Safety Gap Fix (Code-Level, Verified)

Repository: `bitsubhayu/dristiScan`. Branch: **`upgrade_speed+mapping`** only.
Current implementation commit: **`d80e086`**.

This is a single, narrow, already-verified fix — not a redesign. I inspected
the current code directly, then **ran the actual function in isolation**
(not a mock) to confirm the bug before writing this, and **ran the fix
below against the real code** to confirm it works and causes zero
regressions. Do not second-guess the diagnosis — implement exactly what's
below, then verify it yourself the same way.

## Non-negotiable rules (same as every prior round)

- Work ONLY on `upgrade_speed+mapping`. Never touch `main` or
  `upgrade-accuracy-overhaul`.
- Do NOT modify `backend/src/services/ruleEngine.js`.
- Do NOT add Gemini, another provider, or another GPT-OSS call.
- No real product/brand-specific hardcoding in production code.
- Before editing, open the file and confirm the current code below still
  matches. If it doesn't, stop and report the mismatch — do not guess.
- Run tests, inspect actual pass/fail counts, then commit and push only to
  `upgrade_speed+mapping`.

## THE BUG

File: `backend/src/services/multiPhotoEvidenceFusion.js`, function
`areSafeToMergeRows`.

I ran this exact function directly, with the module unmodified:

```
Pack of 6 vs Pack of 8: true
Type A vs Type B: true
```

Both are incorrectly judged "safe to merge." Neither string matches any
keyword in `STATUTORY_PATTERNS`, so both fall through to the function's
final line — `return areNearIdentical(normA, normB);` — which only checks
edit distance (≤1 for strings ≤15 chars) with **no awareness that a
1-character difference in a short string is very often a meaningfully
different declaration** (a pack count, a size code, a variant letter),
not OCR noise. This is exactly the MRP-99-vs-98 failure mode the fusion
layer already protects against for statutory-keyword rows — it just
doesn't protect against it here, because protection is currently gated
behind recognizing a `STATUTORY_PATTERNS` keyword, and short label/code
text often has no such keyword at all.

## CURRENT CODE (verify this matches before editing)

```js
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
```

## EXACT REPLACEMENT (already tested — this is the real fix, apply verbatim)

Apply these as two separate, precise edits to the same function. **Edit 1**
— insert a universal digit-conflict guard immediately after the exact-match
check, before the statutory-keyword check:

```js
    // 1. If exact normalized text matches: SAFE to merge
    if (normA === normB) return true;

    // 1b. Universal digit-conflict guard — applies to EVERY row pair, not just
    // rows recognized by STATUTORY_PATTERNS. A lone number difference (a count,
    // a weight, a code, a variant marker) is always potentially meaningful even
    // without a recognized label keyword nearby (e.g. "Pack of 6" vs "Pack of 8").
    const digitsA0 = (textA.match(/\d+(?:\.\d+)?/g) || []).join(' ');
    const digitsB0 = (textB.match(/\d+(?:\.\d+)?/g) || []).join(' ');
    if (digitsA0 && digitsB0 && digitsA0 !== digitsB0) {
        return false;
    }

    const isStatA = isPotentialStatutoryRow(textA);
```

**Edit 2** — replace the function's final line (the "ordinary descriptive
prose" fallback) with a short-string safety guard before it:

```js
    // 3. Short-string safety guard: below this length, a single-character edit
    // is disproportionately likely to be a genuinely different short code/label/
    // variant rather than OCR noise in a longer sentence — require exact match
    // (already checked above) rather than fuzzy edit-distance-1 tolerance.
    const SHORT_STRING_EXACT_MATCH_THRESHOLD = 20;
    const maxLen = Math.max(normA.length, normB.length);
    if (maxLen < SHORT_STRING_EXACT_MATCH_THRESHOLD) {
        return false;
    }

    // For longer ordinary descriptive prose, retain conservative near-identical logic
    return areNearIdentical(normA, normB);
};
```

That's the entire fix — two insertions into one function, nothing else in
this file changes. Do not touch `normalizeTextForDeduplication`,
`quickLevenshtein`, `areNearIdentical`, `isPotentialStatutoryRow`, or
`fuseMultiPhotoEvidence` — none of them need to change.

## Verification I already did — repeat it yourself

I ran this exact fix in an isolated copy of the repo and got:

```
Pack of 6 vs Pack of 8: false   (fixed)
Type A vs Type B: false         (fixed)
unique A vs unique B: false     (fixed)
exact dup NET WEIGHT 500 g x2: true   (legitimate merge still works)
MRP 99 vs MRP 98 (still must reject): false   (unchanged, still correct)
```

And re-ran the existing suite: **27 / 27 tests still passed**, zero
regressions. You should get the identical result — if you don't, stop and
report exactly which assertion changed before proceeding.

## Add these tests to `backend/test_multi_photo_fusion_suite.js`

Append a new suite (do not modify the existing 27 tests):

```js
console.log('\n--- Suite 6: Short/Non-Statutory Conflict Safety ---');

await runTest('28. Short numeric variant labels are NOT merged (Pack of 6 vs Pack of 8)', () => {
    const { areSafeToMergeRows, normalizeTextForDeduplication } = require('./src/services/multiPhotoEvidenceFusion');
    const mk = (t) => ({ text: t, normText: normalizeTextForDeduplication(t) });
    assert.strictEqual(areSafeToMergeRows(mk('Pack of 6'), mk('Pack of 8')), false);
});

await runTest('29. Short letter-variant labels are NOT merged (Type A vs Type B)', () => {
    const { areSafeToMergeRows, normalizeTextForDeduplication } = require('./src/services/multiPhotoEvidenceFusion');
    const mk = (t) => ({ text: t, normText: normalizeTextForDeduplication(t) });
    assert.strictEqual(areSafeToMergeRows(mk('Type A'), mk('Type B')), false);
});

await runTest('30. Legitimate short exact duplicates still merge (regression guard)', () => {
    const { areSafeToMergeRows, normalizeTextForDeduplication } = require('./src/services/multiPhotoEvidenceFusion');
    const mk = (t) => ({ text: t, normText: normalizeTextForDeduplication(t) });
    assert.strictEqual(areSafeToMergeRows(mk('NET WEIGHT: 500 g'), mk('NET WEIGHT: 500 g')), true);
});

await runTest('31. Full fusion: three photos with a Pack-of-6/Pack-of-8 conflict both survive', () => {
    const { fuseMultiPhotoEvidence } = require('./src/services/multiPhotoEvidenceFusion');
    const fused = fuseMultiPhotoEvidence([
        { photoId: 'photo-1', rows: [{ text: 'Pack of 6' }] },
        { photoId: 'photo-2', rows: [{ text: 'Pack of 8' }] }
    ]);
    assert.strictEqual(fused.stats.fusedRowCount, 2, 'Both conflicting pack-count rows must survive as 2 distinct rows');
});
```

Adjust `runTest`'s exact call signature to match whatever pattern the rest
of this file already uses (read the file first — do not guess its helper
function's signature).

## Required verification steps, in order

1. Read the current `areSafeToMergeRows` and confirm it matches the
   "CURRENT CODE" block above exactly.
2. Apply Edit 1 and Edit 2 exactly as given.
3. Run `node backend/test_multi_photo_fusion_suite.js` — confirm all
   original 27 tests still pass, plus the 4 new ones (31 / 31 total).
4. Run `node backend/test_structuring_engine.js`,
   `node backend/test_golden_regression.js`,
   `node backend/test_gpt_oss_suite.js` — confirm no regressions there
   either (paste actual output, not a summary).
5. `git diff` and confirm the only change is the two insertions above
   plus the new test suite — nothing else in `multiPhotoEvidenceFusion.js`
   or any other file was touched.
6. Confirm no product-specific hardcoding was introduced (there shouldn't
   be any — this fix is pure string/digit comparison logic).
7. Commit message: `fix(fusion): add digit-conflict and short-string
   safety guards to prevent unsafe row merging`. Push to
   `upgrade_speed+mapping` only. Report the commit hash and `git push`
   output.

## Report format

```
Status: DONE | BLOCKED (with reason)
Confirmed current code matched the "CURRENT CODE" block: yes/no
Test output before fix (should show the bug): <paste>
Test output after fix: <paste, all 31 fusion tests + the other 3 suites>
Files changed: <should be exactly 2>
Commit hash / push confirmation: <paste>
```

Send me this report and the diff — I'll pull the branch and re-run
`Pack of 6 vs Pack of 8` myself the same way I found it, before we
move on to anything else.
