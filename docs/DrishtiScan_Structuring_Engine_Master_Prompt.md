# DrishtiScan — Structuring Engine Redesign (Master Prompt)

Repository: `bitsubhayu/dristiScan`. Branch: **`upgrade_speed+mapping`** only.
Base commit for all line-number references below: **`6dde82e`**. Line numbers
drift as you edit — every reference below also gives the exact surrounding
text as an anchor. If the anchor text doesn't match what you find, **stop
and report the mismatch instead of guessing.**

This is a genuine architecture change, not another patch. Read this entire
document before writing any code. Work through the numbered steps in order;
verify each step (read the actual current file first) before touching it.

## Non-negotiable rules

1. Branch scope: only `upgrade_speed+mapping`. Never touch `main` or
   `upgrade-accuracy-overhaul`.
2. **Do not modify `backend/src/services/ruleEngine.js`.** Its input
   contract is: `extracted.normalizedFields` (or `extracted` itself) for
   flat field values, `extracted.rawOcrText` (array), and
   `extracted.declarations` (per-field evidence records). Everything you
   build must still produce this exact shape.
3. **Do not modify `backend/src/routes/consumerRoutes.js` or
   `backend/src/controllers/officerController.js`.** They call
   `extractFields(ocrResult, sourceImageId)` once per photo and then
   `mergeMultiPhotoExtractedFields(singlePhotoExtractions, imageFiles)`
   once across all photos. **These two function names and this two-step
   call pattern must be preserved exactly** — everything below is an
   internal rewrite behind that same interface.
4. No hardcoded product/brand/test-image-specific strings anywhere in
   production code (`backend/src/`, `ocr-service/app.py`). The system
   prompt text specified below already avoids this — do not add examples
   to it.
5. Verify before you patch: open every file named below and confirm it
   still matches. Do not assume line numbers are exact after your own
   earlier edits — re-locate by anchor text.
6. No narrated claims without executed evidence. Every step's test must
   be actually run, with pasted output, in your final report.
7. Push to `upgrade_speed+mapping` when done and report the final commit
   hash and `git push` output.

---

## Why this redesign (context, so you don't second-guess the direction)

The previous rounds fixed a real ordering bug (`deduplicate_results`
sorting OCR results by confidence instead of position — verified fixed)
and added real row-grouping (`groupIntoRows` in `extraction.js` — verified
working). But everything downstream of that is still ~1100 lines of
hand-written regex across 14 numbered sections inside `extractFields`,
each trying to anticipate every real-world label phrasing. That's an
unbounded problem — it cannot be finished by writing more regex, only
by handing the *interpretation* step to something that can read text in
context. The reconstruction work (row grouping) stays; the interpretation
work moves to a single, grounded GPT-OSS call covering every field, not
just the three identity fields it currently handles.

Gemini is being removed entirely from the live pipeline per explicit
decision — it was the source of a whole class of gating bugs found in
earlier rounds (see the two prior fix-report commits `50dfe78` /
`6dde82e` for that history). Its safety role (a second opinion when the
primary path is unavailable) is replaced by keeping the existing
deterministic regex logic as an explicit, lower-confidence **fallback**
path — not deleted, repositioned.

---

## STEP 1 — Extract three dependency-free modules out of `extraction.js`

`extraction.js` is 3054 lines. Before rewriting anything, pull out the
pieces that have **no dependency on anything else in the file** so the
new structuring engine (Step 3) can use them without creating a circular
`require()` between `extraction.js` and the new files.

### 1a. Create `backend/src/services/textShapeValidators.js`

Move these definitions **out of `extraction.js`** (do not duplicate —
remove them from `extraction.js` after moving, and have `extraction.js`
`require()` them back from the new file):

- `isDateShaped` (currently `extraction.js` L35-53)
- `VALID_MASS_VOLUME_UNITS` (L54-62)
- `VALID_COUNT_UNITS` (L63-71)
- `isValidQuantityUnit` (L72-82)
- `MARKETING_BADGE_PATTERNS` (L128-142)
- `isMarketingBadge` (L143-154)
- `isNonProductTitleCandidate` (L155-257) — confirm before moving that it
  still only references its own `rawText` parameter (it did as of
  `6dde82e`; if that's changed, stop and report).
- `KNOWN_COUNTRIES` (L358-372)
- `sanitizeExtractedText` (L373-424)

Export all of these from the new file. This file must end up with **zero
`require()` calls to any other local module** — it's pure string/regex
logic.

### 1b. Create `backend/src/services/ocrReconstruction.js`

Move these out of `extraction.js`:

- `groupIntoRows` (L425-609) — self-contained, confirmed no external
  dependencies as of `6dde82e`.
- `generateCandidateTitles` (L610-705) — depends on `isDateShaped`,
  `isMarketingBadge`, `isNonProductTitleCandidate`; import these from
  `textShapeValidators.js` (Step 1a) instead of expecting them in local
  scope.

Export both. This file's only `require()` should be
`textShapeValidators.js`.

### 1c. Verify `extraction.js` still loads

After 1a/1b, `extraction.js` should now `require()` both new files near
its top (alongside its existing requires) and reference
`groupIntoRows`/`generateCandidateTitles`/the shape-validators through
those imports instead of local definitions. Run `node -e
"require('./backend/src/services/extraction.js')"` and confirm it loads
without error before proceeding — this catches any missed
cross-reference immediately.

---

## STEP 2 — Trim `gptOssService.js` to a generic Groq client

Current file (324 lines) is narrowly built for the 3-field identity call.
Reduce it to a **reusable, prompt-agnostic HTTP client**:

**Keep, unchanged:** `isAvailable()` (L27-29), the constants
`GROQ_API_URL`, `GROQ_MODEL`, `GROQ_TIMEOUT_MS` (L19-21).

**Remove entirely:** `SYSTEM_PROMPT` (L35-85, the narrow 3-field one —
replaced by a comprehensive prompt living in the new
`structuringEngine.js`), `buildCompactOcrContext` (L91-113 — it currently
*excludes* nutrition/numeric tokens, L99-103, which the new engine needs
included; superseded by a row-based context builder in the new file),
`isGroundedInOcr` (L119-132 — moves to `structuringEngine.js`, see Step
3, where it becomes one tier of a larger grounding system),
`resolveIdentityFields` (L144-316 — fully superseded).

**Add:** a new generic function extracted from the mechanics already
inside the old `resolveIdentityFields` (the axios POST, the 429-retry
backoff computed from the API's own `"try again in Xs"` message, the
JSON-parse-with-error-handling) — same logic, parameterized so any
caller can supply its own system prompt and payload:

```js
const callGroqJson = async (systemPrompt, userPayload, retryCount = 0) => {
    if (!isAvailable()) {
        return { success: false, skipped: true, reason: 'GROQ_API_KEY is not configured' };
    }
    try {
        const startTime = Date.now();
        const response = await axios.post(
            GROQ_API_URL,
            {
                model: GROQ_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: JSON.stringify(userPayload) }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.1,
                max_tokens: 4096
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: GROQ_TIMEOUT_MS
            }
        );
        const latencyMs = Date.now() - startTime;
        const rawContent = response.data?.choices?.[0]?.message?.content;
        if (!rawContent) {
            return { success: false, reason: 'Empty response received from Groq API', latencyMs };
        }
        let parsed;
        try {
            parsed = JSON.parse(rawContent);
        } catch (parseErr) {
            return { success: false, reason: `Malformed JSON response: ${parseErr.message}`, latencyMs };
        }
        return { success: true, content: parsed, latencyMs, usage: response.data.usage || {} };
    } catch (err) {
        if (err.response?.status === 429 && retryCount < 1) {
            let waitMs = 3000;
            const msg = err.response?.data?.error?.message || '';
            const match = msg.match(/try again in ([\d.]+)s/i);
            if (match) waitMs = Math.ceil(parseFloat(match[1]) * 1000) + 400;
            if (waitMs <= 8500) {
                await new Promise(r => setTimeout(r, waitMs));
                return callGroqJson(systemPrompt, userPayload, retryCount + 1);
            }
        }
        const errorDetail = err.response ? JSON.stringify(err.response.data) : err.message;
        return {
            success: false,
            error: err.message,
            statusCode: err.response?.status || 500,
            rateLimited: err.response?.status === 429,
            detail: errorDetail
        };
    }
};
```

**New `module.exports`:** `{ isAvailable, callGroqJson, GROQ_MODEL }`.
(Note the raised `max_tokens` — the new schema covers far more fields
than the old 3-field one, and 2048 will likely truncate it. Verify this
empirically once you have real payloads; raise further if you see
truncated JSON in testing.)

---

## STEP 3 — Create `backend/src/services/structuringEngine.js`

This is the new brain. It replaces the ~1100 lines of per-field
extraction logic that currently live inside `extractFields` (sections
1-14, mapped exactly in Step 4 below) with one grounded LLM call across
all photos of a scan.

### 3a. Row-based context builder

Replace the old `buildCompactOcrContext` (which filtered out exactly the
numeric/nutrition data this engine now needs) with one that consumes
`groupIntoRows`'s output per photo and produces a compact,
row-organized structure:

```js
const buildRowContext = (photoRowsList) => {
    // photoRowsList: [{ photoId, rows: [...from groupIntoRows...] }, ...]
    return photoRowsList.map(({ photoId, rows }) => ({
        photoId,
        rows: rows.map((row, rowId) => ({
            rowId,
            cells: row.elements.map(el => ({
                text: el.text,
                confidence: Math.round((el.confidence || 0.8) * 100) / 100
            })),
            // normalizedBbox: 0-1 fractions, already established in a prior fix —
            // reuse whatever field groupIntoRows/extractFields currently attaches
            // for this; verify the exact property name before using it.
            normalizedBbox: row.normalizedBbox || []
        }))
    }));
};
```

Verify `groupIntoRows`'s actual return shape (`row.elements`, or whatever
it's actually called as of `6dde82e` — read it, don't assume) and adjust
field names above to match exactly.

### 3b. The system prompt — full text, use verbatim, do not add examples

```
You are a Legal Metrology packaging structuring engine. You receive OCR
evidence extracted from photos of a packaged product — organized by
photo, then by row (a row is a set of text fragments the reconstruction
layer determined are visually aligned on the same horizontal line or
table row), then by cell within that row (left to right).

Your job is to produce a single structured JSON object describing every
field listed below. You are reading fragmented, possibly reordered,
possibly OCR-noisy evidence — some rows may contain a label and its
value together, some may have the value split across cells or across an
adjacent row, and identical information may appear on more than one
photo with varying completeness or clarity.

FIELDS TO PRODUCE:
productName, brandName, genericCommodityName, netQuantity (amount +
unit), mrp (amount + currency), unitSalePrice (amount + unit),
dateOfManufacture, dateOfExpiry, batchNumber, fssaiLicenseNumber,
servingsPerContainer, servingSize, manufacturer (name + address), packer
(name + address), importer (name + address), marketer (name + address),
consumerCarePhone, consumerCareEmail, countryOfOrigin, ingredients (full
text), nutritionFacts (an object with whichever of calories, fat, sugar,
protein, sodium, carbohydrates, fiber are present, each as its own
grounded sub-value).

CRITICAL — GROUNDING, NEVER INVENT A VALUE:
Every value you output must be traceable to actual evidence given to
you. For every field, return:
  - "value": your final answer.
  - "rawObservedText": the literal text of the evidence you based this
    on, exactly as given to you, before any correction.
  - "correctionApplied": true only if "value" differs from
    "rawObservedText".
  - "correctionReason": one of "cross_reference_match",
    "character_confusion_fix", "row_concatenation", "generic_classification",
    or null if no correction was applied. Do not use any other reason string.
  - "groundingRefs": an array of {"photoId", "rowId"} pairs identifying
    every row your value/correction is based on.
  - "confidence": 0.0-1.0.
If a field has no supporting evidence anywhere in the input, return
"value": null with an empty "groundingRefs" — never guess, never
substitute a plausible but unevidenced answer.

CORRECTION VS INVENTION — READ THIS CAREFULLY:
You MAY correct a value when:
  (a) "cross_reference_match" — a fragment appears incomplete or garbled
      in one row, and a more complete or clearer version of the SAME
      text appears in a different row or photo (cite BOTH rows in
      groundingRefs). Example: one row reads "AMU" and a different row
      elsewhere reads "AMUL" or "AMUL DAIRY" or contains "amul" as part
      of a website/email — you may output "AMUL", citing both rows.
  (b) "character_confusion_fix" — a single character is a well-known OCR
      confusion of another (0/O, 1/I/l, 5/S, 8/B, rn/m) and fixing it
      does not change the word's length or meaning materially.
  (c) "row_concatenation" — a value (e.g. a price, a date, a title) is
      visibly split across adjacent cells/rows and you are joining
      fragments that are already present, not adding new characters
      beyond what joining requires.
  (d) "generic_classification" — for genericCommodityName ONLY, you may
      state the standard common-noun category of the product (e.g.
      "Whey Protein Supplement") even if that exact phrase is not
      printed anywhere, based on the product's other identity evidence.
      This is the ONLY field where this kind of inference is allowed.
You must NEVER invent a value that is not a minor, evidenced correction
of the kind above. Example of what is FORBIDDEN: evidence shows only
"AMU" with no corroborating fuller mention anywhere in any photo, and
you output "Sunrise" or any other brand name — this is strictly
forbidden even if such a brand is common or plausible for this product
category. When you cannot find corroborating evidence for completing a
fragment, return the fragment itself as "value" with
"correctionApplied": false, or return null — never substitute a
different, unevidenced name.

OTHER EXCLUSION RULES:
- Never select packaging-handling directives (cut/tear/open/peel/press/
  twist/fold/snip + here/along/dotted line/to open/tab), marketing
  slogans, or URLs as productName, brandName, or genericCommodityName.
- Never select dosage quantities, prices, dates, or batch/lot numbers as
  productName or brandName.
- Statutory numeric/date fields (netQuantity, mrp, unitSalePrice, dates,
  batchNumber, fssaiLicenseNumber, servingsPerContainer, servingSize)
  must never use "generic_classification" as a correction reason —
  reason (d) is reserved for genericCommodityName only.

Respond with a single JSON object only, no prose.
```

### 3c. Deterministic grounding validator (no LLM — this is the safety gate)

Implement in this file, run on **every** field in the LLM's response
before it's trusted:

```js
// Standard Levenshtein distance
const levenshtein = (a, b) => {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
        }
    }
    return dp[m][n];
};

const normalizedEditDistance = (a, b) => {
    if (!a && !b) return 0;
    const maxLen = Math.max(a.length, b.length, 1);
    return levenshtein(a.toLowerCase(), b.toLowerCase()) / maxLen;
};

// rowLookup: Map from `${photoId}:${rowId}` -> concatenated row text
const validateGrounding = (fieldName, decision, rowLookup, tier) => {
    if (!decision || decision.value === null || decision.value === undefined) {
        return { status: 'not_detected', value: null };
    }
    const value = String(decision.value).trim();
    const raw = String(decision.rawObservedText || '').trim();
    const refs = Array.isArray(decision.groundingRefs) ? decision.groundingRefs : [];

    if (tier === 'generic_inferred') {
        // genericCommodityName only — no strict char grounding required,
        // but still require it's not empty and not obviously a rejected shape
        // (caller applies isNonProductTitleCandidate / isDateShaped separately).
        return { status: value ? 'verified' : 'not_detected', value, provenance: 'llm_inferred' };
    }

    if (refs.length === 0) {
        return { status: 'review', value, reason: 'No grounding references provided' };
    }

    if (!decision.correctionApplied) {
        // Value must closely match at least one cited row's actual text.
        const matches = refs.some(r => {
            const rowText = rowLookup.get(`${r.photoId}:${r.rowId}`) || '';
            return normalizedEditDistance(value, rowText) <= 0.1 || rowText.toLowerCase().includes(value.toLowerCase());
        });
        if (!matches) return { status: 'review', value, reason: 'Uncorrected value does not match its cited row' };
        return { status: 'verified', value, provenance: 'ocr_verbatim' };
    }

    // A correction was applied — check it against its stated reason.
    const dist = normalizedEditDistance(value, raw);
    if (decision.correctionReason === 'character_confusion_fix') {
        if (dist > 0.2) return { status: 'review', value, reason: `Correction too large for character_confusion_fix (distance ${dist.toFixed(2)})` };
        return { status: 'verified', value, provenance: 'ocr_corrected' };
    }
    if (decision.correctionReason === 'cross_reference_match') {
        if (refs.length < 2) return { status: 'review', value, reason: 'cross_reference_match requires 2+ grounding refs' };
        const corroborated = refs.some(r => {
            const rowText = rowLookup.get(`${r.photoId}:${r.rowId}`) || '';
            return normalizedEditDistance(value, rowText) <= 0.15;
        });
        if (!corroborated) return { status: 'review', value, reason: 'No cited row closely matches the corrected value' };
        return { status: 'verified', value, provenance: 'ocr_corrected' };
    }
    if (decision.correctionReason === 'row_concatenation') {
        // The claimed value's characters should be a superset built from the cited rows' text.
        const combined = refs.map(r => rowLookup.get(`${r.photoId}:${r.rowId}`) || '').join('');
        const combinedChars = combined.toLowerCase().replace(/[^a-z0-9]/g, '').split('').sort().join('');
        const valueChars = value.toLowerCase().replace(/[^a-z0-9]/g, '').split('').sort().join('');
        // Every character in value should be present in the combined evidence (allow evidence to have extra chars, e.g. punctuation split differently).
        const missing = [...new Set(valueChars)].filter(c => !combinedChars.includes(c));
        if (missing.length > 0) return { status: 'review', value, reason: `Concatenation introduces characters not present in cited rows: ${missing.join('')}` };
        return { status: 'verified', value, provenance: 'ocr_corrected' };
    }
    return { status: 'review', value, reason: `Unrecognized correctionReason: ${decision.correctionReason}` };
};
```

Apply `tier`:
- `'strict'` (default) for: netQuantity, mrp, unitSalePrice, dateOfManufacture,
  dateOfExpiry, batchNumber, fssaiLicenseNumber, servingsPerContainer,
  servingSize. **Additionally** re-run this repo's existing
  `validateFieldFormat` (from `extraction.js`, still exported — see Step
  4) on the resulting value; if that fails, downgrade status to
  `'review'` regardless of what `validateGrounding` said.
- `'verbatim'` for productName, brandName: same as `'strict'` but without
  the extra format check (there's no fixed shape to check).
- `'generic_inferred'` for genericCommodityName only.
- `'descriptive'` for ingredients, nutritionFacts sub-values,
  manufacturer/packer/importer/marketer name+address, consumerCare,
  countryOfOrigin: treat like `'strict'` grounding logic but do not run
  `validateFieldFormat` (no fixed shape).

These thresholds (0.1, 0.15, 0.2) are a reasoned starting point, not
something empirically tuned against real photos yet — say so explicitly
in your report, and if your test fixtures reveal they're too strict or
too loose, adjust and document why.

### 3d. The main export

```js
const structureFields = async (photoRowsList, deterministicHints = []) => {
    if (!gptOssService.isAvailable()) {
        return { success: false, skipped: true, reason: 'GROQ_API_KEY not configured' };
    }
    const rowContext = buildRowContext(photoRowsList);
    const userPayload = { photos: rowContext, deterministicHints };
    const result = await gptOssService.callGroqJson(STRUCTURING_SYSTEM_PROMPT, userPayload);
    if (!result.success) return result;

    const rowLookup = new Map();
    photoRowsList.forEach(({ photoId, rows }) => {
        rows.forEach((row, rowId) => {
            rowLookup.set(`${photoId}:${rowId}`, row.elements.map(e => e.text).join(' '));
        });
    });

    // Build the final fields object, running validateGrounding per field
    // with the correct tier (see 3c) for every field listed in Step 3b.
    // Return shape must match what mergeMultiPhotoExtractedFields (Step 5)
    // needs to assemble normalizedFields + declarations for ruleEngine.js.
    ...
};

module.exports = { structureFields };
```

Fill in the field-by-field tier assignment and output assembly following
3c exactly — this is mechanical once the validator exists, but go
field-by-field, don't skip any of the 20 fields listed in 3b.

---

## STEP 4 — Rewrite `extraction.js`

### 4a. Delete the per-photo field-extraction sections inside `extractFields`

As of `6dde82e`, `extractFields` spans L706-2097. Inside it, delete
sections 1 through 14 **as one contiguous block**, from the start of:

```
    // -------------------------------------------------------------
    // 1. Country of Origin
    // -------------------------------------------------------------
```
(L861) through the end of section 14, immediately before:
```
    // -------------------------------------------------------------
    // 15. Post-Extraction Format Validation
    // -------------------------------------------------------------
```
(L1975). That's sections: Country of Origin, FSSAI, Batch/Lot, Dates,
USP, MRP, Servings/Net Quantity, Manufacturer/Packer/Importer/Marketer,
Consumer Care, Ingredients, Nutrition Facts, Product Name, Brand Name,
Generic Commodity Name.

**Before deleting, save this block** — it becomes the fallback extractor
in Step 4b, not wasted work.

**Keep:** everything before section 1 (raw element setup, bbox
normalization, `groupIntoRows`/`generateCandidateTitles` calls — now via
the Step 1 imports), and section 15 onward (`validateFieldFormat`
usage and the final `normalizedFields`/`declarations` object
construction) — but section 15+ now validates the **new engine's
output**, not the deleted regex variables. You will need to rewire what
feeds into it — see 4c.

### 4b. Create `backend/src/services/deterministicFallbackExtractor.js`

Move the exact block deleted in 4a into this new file, wrapped as one
exported function, e.g. `extractFieldsDeterministic(rawElements,
structuredRows)`, returning the same shape of values the old inline code
produced (prodName, brandNameVal, mrpVal, dates, etc. — as a single
returned object rather than loose local variables). Update its internal
references to `groupIntoRows`/`generateCandidateTitles`/shape-validators
to import from the Step 1 modules instead of assuming local scope.

This function is called **only** when `structuringEngine.structureFields`
returns `{ success: false }` for a given scan (GPT-OSS unavailable or
failed) — it is the degraded fallback, not the primary path. Its output
should be marked with a visibly lower confidence / a
`structuringMode: 'deterministic_fallback'` flag somewhere in the
returned declarations so this is distinguishable later (in logs, in the
debug scan tracker) from a normal GPT-OSS-structured result.

### 4c. `extractFields`'s new, much smaller body

Per photo, it should now: normalize raw elements and bboxes (existing
Issue-4 normalization, keep as-is), call `groupIntoRows` to get
`structuredRows`, call `generateCandidateTitles` to get candidate hints,
and return an evidence package: `{ sourceImageId, structuredRows,
candidateHints, rawOcrText: resultsArray }` — **no field values yet**.
Do not attempt any of the old regex extraction here anymore; that's
deferred to the merge stage where all photos are available together.

### 4d. `mergeMultiPhotoExtractedFields`'s new body

This is where the single consolidated call happens, since it's the one
place that has all photos' evidence at once:

1. Build `photoRowsList` from every photo's `structuredRows`.
2. Call `structuringEngine.structureFields(photoRowsList,
   deterministicHints)` (the `deterministicHints` can be the
   `candidateHints` collected from each photo in 4c — pass them through
   as extra context, not as authoritative values).
3. If it succeeds, use its output to build `normalizedFields` and
   `declarations` (matching the exact shape `ruleEngine.js` expects — see
   the non-negotiable rules).
4. If it fails/is skipped, call `deterministicFallbackExtractor` (Step
   4b) per photo and merge with a simple "first non-null value wins"
   rule (this is an explicitly degraded mode — do not try to rebuild the
   old `reconcileField`/`fieldsNeedingGemini` conflict machinery here;
   that whole apparatus is retired along with Gemini).
5. Remove: `reconcileField`, `setNestedField`/`setterMap` usage tied to
   Gemini reconciliation, `fieldsNeedingGemini`, `unresolvedIdentityFields`,
   `identityCollisionResolved`, `gptOssResolvedFields`, and every call
   into `geminiService` or the old `gptOssService.resolveIdentityFields`
   — all of this existed to coordinate two competing providers across a
   fragile per-field gate, and that entire problem class goes away when
   one call handles all fields across all photos at once.
6. Remove the `applyGeminiFallback` function (L2847-3042) entirely — its
   job (image re-read for low-confidence fields) is no longer applicable
   since there's no second provider to fall back to; the deterministic
   fallback (4b) is the fallback now.
7. Remove `const geminiService = require('./geminiService');` from the
   top of the file.

---

## STEP 5 — Delete `geminiService.js` and update tests

**Delete** `backend/src/services/geminiService.js` entirely (`git rm`).
Confirmed as of this commit its only callers are `extraction.js` (being
rewritten) and two test files, handled below.

**`backend/test_golden_regression.js`** — remove Suite 1 ("No Hardcoded
Brand Classification") and Suite 4 ("Sequential Scan Independence") in
full; both call `geminiService` methods that no longer exist. Keep
Suites 2, 3, 5, 6 unchanged (they test multi-photo merge behavior,
module exports, rate limiting, and upload validation — none of that is
Gemini-specific). Update Suite 3's export checks to also verify
`structuringEngine.structureFields` and the Step 1/1b module exports
exist.

**Delete** `backend/test_identity_verification_gate.js` entirely — its
entire purpose (testing the old dual-provider gating logic) no longer
applies to the new architecture. Replace with a new
`backend/test_structuring_engine.js` — see Step 6.

**`backend/test_gpt_oss_suite.js`** — rewrite its 7 tests to call
`structuringEngine.structureFields` instead of the removed
`gptOssService.resolveIdentityFields`, keeping the same intent per
suite (disambiguation, zero-hallucination on insufficient evidence,
negative-constraint enforcement, multi-photo reconciliation, graceful
fallback, packaging-directive rejection) but exercising the new function
and its full field set, not just 3 identity fields.

**`backend/test_instructional_text_exclusion.js`** and
**`backend/test_issues_3_to_6.js`** — the parts testing
`isNonProductTitleCandidate` and `validateFieldFormat` directly are
still valid (those functions still exist, now imported from
`textShapeValidators.js`/kept in `extraction.js`) — update their
`require()` paths if you moved the functions, keep the assertions. The
part of `test_issues_3_to_6.js` testing the old `setterMap`/`packer.name`
dot-path fix is now obsolete (that whole reconciliation path is retired)
— remove that specific test, keep the rest.

---

## STEP 6 — New tests (mandatory, value-correctness assertions only — `assert.strictEqual`, never bare `assert.ok` for a value that could be silently wrong)

Create `backend/test_structuring_engine.js` covering, as synthetic
fixtures (fabricated row/bbox data, not real photos):

1. **Cross-reference correction, allowed:** a fixture where one row has
   `"AMU"` and a separate row has `"AMUL DAIRY"` (or similar fuller
   mention) — assert the resolved brand is `"AMUL DAIRY"`'s brand token
   with `correctionReason: 'cross_reference_match'`, and that
   `validateGrounding` returns `status: 'verified'`.
2. **Invention, forbidden:** a fixture where the only evidence for a
   brand is `"AMU"` and nothing else anywhere corroborates it — feed a
   fabricated LLM response (monkey-patch `callGroqJson`) that returns
   `"Sunrise"` as the value with no real grounding refs — assert
   `validateGrounding` rejects this (`status: 'review'`, not
   `'verified'`), proving the deterministic gate catches an invented
   value even if the LLM produces one.
3. **Row concatenation:** MRP split across 3 cells in one row
   (`"₹"`, `"7"`, `"9"`, `"9"`) — assert the resolved value is `799`
   with `correctionReason: 'row_concatenation'` and passes grounding.
4. **Packaging directive still rejected:** re-use the existing "CUT FROM
   HERE" / "GULF DATES" / "ZAHIDI DATES" fixture from prior rounds —
   assert it's still never selected as productName/brandName.
5. **GPT-OSS unavailable → deterministic fallback engages:** unset
   `GROQ_API_KEY`, confirm `mergeMultiPhotoExtractedFields` falls back to
   `deterministicFallbackExtractor` and still returns a usable (if
   lower-confidence) result rather than an empty one.
6. **Statutory field format check still gates LLM output:** feed a
   fabricated LLM response where `dateOfExpiry` grounds cleanly but the
   value itself isn't a valid date shape — assert the existing
   `validateFieldFormat` check downgrades it to `review` despite passing
   grounding.

Also re-run every pre-existing test file (`test_golden_regression.js`,
`test_gpt_oss_suite.js`, `test_tiling_routing.py`, and anything else
under `backend/test_*.js` and `ocr-service/test_*.py`) and paste their
output — confirm nothing regresses.

---

## STEP 7 — Final report (required format)

Same structure as prior rounds — one section per Step above:

```
### Step <N>: <title>
Status: DONE | PARTIAL | BLOCKED (with reason)
Files changed/created/deleted: <list>
Summary: <what changed, why>
Test(s) run: <file names>
Test output (verbatim, not paraphrased): <output>
Caveats: <anything uncertain, especially the edit-distance thresholds in 3c — did real testing suggest different values?>
```

Then:

1. **Cross-check pass:** re-read this entire document against your
   actual `git diff` one more time, step by step, and confirm every
   numbered step was genuinely completed — flag anything skipped.
2. **Hardcoding check:** confirm no product/brand-specific string was
   added anywhere in the new files.
3. **Contract check:** confirm `consumerRoutes.js`/`officerController.js`
   needed zero changes, and `ruleEngine.js` diff is 0.
4. **Latency note:** report the actual observed latency of a
   `structureFields` call against a real multi-photo fixture with a real
   `GROQ_API_KEY` — this schema is much larger than the old 3-field one
   and you raised `max_tokens`; confirm it's still fast enough to be
   usable, and say so with a real number, not an estimate.
5. `git log --oneline -10`, `git push` output, final commit hash.

Send me this report along with the actual diff — I'll independently
verify it against the live repo the same way I checked the last two
rounds, by pulling the branch and running your tests myself, not just
reading the report.
