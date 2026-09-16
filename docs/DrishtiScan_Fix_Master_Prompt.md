# DrishtiScan — Fix Master Prompt (upgrade_speed+mapping)

You are working on the GitHub repository `bitsubhayu/dristiScan`, branch
**`upgrade_speed+mapping`**, at commit `c79bd8d` or later.

This document is a fix list produced by an independent code review that
**actually read and executed the code** (not just inspected it). Every issue
below includes the exact file, exact current code, and the reason it is
wrong, verified either by direct code inspection or by running the code in
an isolated sandbox. Treat every claim as evidence-backed, but **line
numbers may have drifted** since the review — always re-locate code by its
unique content (function name, exact string, comment) before editing, not
by line number alone.

## Non-negotiable rules — read before touching anything

1. **Branch scope.** Only commit to `upgrade_speed+mapping`. Do not touch
   `main` or `upgrade-accuracy-overhaul`.
2. **No hardcoding, ever.** Do not add any literal product name, brand
   name, or test-specific string to production logic (`backend/src/`,
   `ocr-service/app.py`) — including the exact strings used as evidence in
   this document ("CUT FROM HERE", "NEXUS LABS", "GULF DATES", etc.). Those
   strings exist only to *illustrate* a category of bug (e.g. "imperative
   packaging instructions", "brand/product inversion"). Every fix must be
   phrased generically enough to work on a product neither of us has seen.
3. **Do not modify `backend/src/services/ruleEngine.js`.** One issue below
   (Issue 3) has a knock-on effect on a rule engine PASS/FAIL outcome, but
   the fix is entirely upstream in `extraction.js`. If, after implementing
   everything below, you still believe `ruleEngine.js` itself needs a
   change, **stop and report that as an open question** in your final
   report instead of making the change.
4. **Statutory fields stay fully deterministic.** After your changes,
   `mrp`, `unitSalePrice`, `netQuantity`, `dates.manufacture`,
   `dates.expiry`, `batchNumber`, `fssaiLicenseNumber`,
   `servingsPerContainer`, `servingSize`, `ingredients`, and
   `nutritionFacts` must remain untouchable by both `gptOssService.js` and
   `geminiService.js`. Confirm this is still true at the end and say so
   explicitly in your report.
5. **Verify before you patch.** For every issue below, first open the
   named file and confirm the "Current code" block still matches (or
   locate the equivalent code if it has moved/been renamed). If it does
   **not** match closely, stop, note the discrepancy in your report, and
   do not guess — ask for clarification rather than inventing a fix for
   code that doesn't exist.
6. **One issue at a time.** Implement, test, and record the result for one
   issue before moving to the next. Do not batch all changes into one
   untested commit.
7. **No narrated claims without executed evidence.** For every fix, your
   final report must include actual terminal/test output proving it,
   not a description of what you expect to happen. If you cannot run
   something (e.g. no network for a specific API), say so explicitly
   rather than presenting an assumption as a result.
8. **Never weaken a test to make it pass.** You may only add new tests or
   strengthen existing assertions (e.g. `assert.ok` → `assert.strictEqual`
   with the correct expected value). Do not delete or loosen any existing
   test.
9. **Push when done.** Commit to `upgrade_speed+mapping` (one commit per
   issue, or clearly separated commits) and push to GitHub. Report the
   final commit hash(es) and confirm the push succeeded (paste the
   `git push` output).

---

## ISSUE 1 (CRITICAL) — Identity fields can end up with zero semantic verification

**Files:** `backend/src/services/extraction.js`

### 1a. The "heuristic" trigger for GPT-OSS arbitration can never fire

**Current code** (inside `mergeMultiPhotoExtractedFields`, in the block that
builds `unresolvedIdentityFields`):

```js
if (f === 'productName' || f === 'brandName') {
    const hasMultipleCandidates = extractedList.some(e => (e.rawOcrText || []).length >= 2);
    const isHeuristic = extractedList.some(e => {
        const s = e.declarations?.[f]?.source;
        return s === 'title_heuristic' || s === 'font_size_heuristic' || s === 'fallback_largest' || !s;
    });
    if (hasMultipleCandidates && isHeuristic && (!merged.genericCommodityName || distinctObs.size > 0)) {
        return true;
    }
}
```

**Why it's wrong:** `createEvidenceRecord(...)` — the function that builds
every `declarations.productName` / `declarations.brandName` entry — is
always called without a 5th (`source`) argument, so `source` always
defaults to `'paddleocr_primary'`. The strings `'title_heuristic'`,
`'font_size_heuristic'`, and `'fallback_largest'` are never assigned
anywhere in the codebase (confirm this yourself with
`grep -n "title_heuristic\|font_size_heuristic\|fallback_largest" backend/src/services/extraction.js`
— it should only show this one comparison, never an assignment). Since `s`
is always `'paddleocr_primary'` (truthy, and none of the three literals),
`isHeuristic` is always `false`, and this condition — whose comment says
it exists "to avoid brand/product inversion" — can never trigger.

**Required fix:** Change the comparison to match the value the code
actually produces:

```js
const isHeuristic = extractedList.some(e => {
    const s = e.declarations?.[f]?.source;
    // Every productName/brandName value created by the deterministic
    // scoring path defaults to source 'paddleocr_primary'. Only a value
    // already confirmed by an LLM pass should be treated as non-heuristic.
    return !s || s === 'paddleocr_primary';
});
```

### 1b. A detected brand/product naming collision doesn't force re-verification of both fields

**Current code** (still inside `extractFields`, in the block titled
"Disambiguation: If brand matches what was picked as productName"):

```js
if (brandNameVal && prodName && brandNameVal.toLowerCase().trim() === prodName.toLowerCase().trim()) {
    const nextProductCandidates = rawElements.filter(el => { ... }).map(c => ({ candidate: c, ...scoreProductCandidate(c) }));
    nextProductCandidates.sort((a, b) => b.score - a.score);
    if (nextProductCandidates.length > 0 && nextProductCandidates[0].score >= 45) {
        prodName = nextProductCandidates[0].candidate.text.trim();
        prodNameElem = nextProductCandidates[0].candidate;
        declarations.productName = createEvidenceRecord(prodName, prodNameElem, 'verified');
        ...
        console.log(`[Extraction] Brand/product disambiguation: brand="${brandNameVal}", product="${prodName}"`);
    }
}
```

**Why it's wrong (verified by execution, not just inspection):** when the
initial productName-scorer and the initial brand-scorer both pick the same
text, this block moves `productName` to the next-best candidate but
**never re-checks whether `brandNameVal` is still the correct choice.** I
reproduced this directly by running `extractFields` against a fixture
where two lines ("NEXUS LABS", a brand-shaped name, and "NITRO WHEY
ISOLATE", a product-title-shaped name) both scored highest for
`productName` initially. The actual output was:

```
[Extraction] Brand/product disambiguation: brand="NITRO WHEY ISOLATE", product="NEXUS LABS"
```

i.e. the two ended up **swapped relative to what they obviously are** —
`brandName` held the product-shaped string, `productName` held the
brand-shaped string — and this state is never flagged for correction,
because (per 1a) the "isHeuristic" gate downstream is dead. This is not a
hypothetical: this is a real fixture already present in
`backend/test_gpt_oss_suite.js` (Suite 5), and the suite's own assertion
(`assert.ok(mergedResult.brandName, ...)`) is too weak (truthy-only, not
value-equality) to catch it.

**Required fix:** When this disambiguation block reassigns `prodName`, it
must also mark that a collision occurred, on the object that
`extractFields` returns (the same object that becomes one entry of
`extractedList` during merge — add the flag next to where `rawOcrText` is
set on that return object):

```js
// New field on the extractFields() return value:
identityCollisionResolved: true,
```

Then, in `mergeMultiPhotoExtractedFields`'s `unresolvedIdentityFields`
computation, add a new unconditional trigger for **both** `productName`
and `brandName` whenever any photo hit this collision path:

```js
// 5. A same-photo brand/product naming collision was detected and
// resolved heuristically for at least one photo — always re-verify
// both identity fields regardless of the other heuristics above.
if ((f === 'productName' || f === 'brandName') &&
    extractedList.some(e => e.identityCollisionResolved)) {
    return true;
}
```

### 1c. Once GPT-OSS is *configured*, Gemini's safety nets for identity fields are skipped even for fields GPT-OSS never actually resolved

**Current code, three separate places in `extraction.js`:**

Gate on the mandatory Gemini identity-verification block:
```js
if (!merged.reconciliation.gptOssUsed && !gptOssService.isAvailable()) {
    // entire per-field loop over productName/brandName/genericCommodityName
}
```

Gate that excludes identity fields from Gemini's image-re-read fallback:
```js
if ((name === 'productName' || name === 'brandName' || name === 'genericCommodityName') &&
    (gptOssService.isAvailable() || mergedFields.reconciliation?.gptOssUsed)) {
    return;
}
```

Gate that prevents Gemini fallback from overwriting a GPT-OSS decision:
```js
if (decl?.source === 'gpt_oss_120b' ||
    ((fieldPath === 'productName' || fieldPath === 'brandName' || fieldPath === 'genericCommodityName') && gptOssService.isAvailable())) {
    return;
}
```

**Why it's wrong:** all three check "is GPT-OSS *available* (configured)"
rather than "did GPT-OSS *actually resolve this specific field* on this
scan." Combined with 1a/1b (GPT-OSS's own trigger being weaker than
intended), the realistic outcome is: once `GROQ_API_KEY` is set, a field
that GPT-OSS's gate never flagged, or that GPT-OSS's API call failed for
(network error, rate limit, malformed response), gets **no verification
from anything** — not GPT-OSS (never asked), not Gemini (blocked because
GPT-OSS is "available"). This directly explains how a wrong identity
field can survive to the final result even with both LLM layers
theoretically active.

**Required fix:**

1. Inside the existing GPT-OSS success-handling loop (where
   `decision.value` passes `validateFieldFormat` and gets applied),
   record exactly which fields were actually resolved:
   ```js
   merged.reconciliation.gptOssResolvedFields = merged.reconciliation.gptOssResolvedFields || [];
   merged.reconciliation.gptOssResolvedFields.push(field);
   ```
2. Replace all three gates above so they check field-level resolution,
   not global availability. Example for the mandatory-verification block —
   move the check inside the per-field loop instead of wrapping the whole
   block:
   ```js
   highStakesVerificationFields.forEach(f => {
       if ((merged.reconciliation.gptOssResolvedFields || []).includes(f)) return;
       // ...existing per-field Gemini verification logic, unchanged...
   });
   ```
   Before removing the outer gate entirely, check whether the functions
   this block calls into (`geminiService.reconcileFields` /
   `localReconcileFields`) already handle a missing `GEMINI_API_KEY`
   gracefully on their own (they should — verify by reading
   `geminiService.js`'s `getClient()`/`isAvailable()`). If they do, the
   outer `!gptOssService.isAvailable()` half of the gate can simply be
   removed; if for some reason they don't, add an equivalent
   `geminiService.isAvailable()`-based guard instead — but the guard must
   never be based on `gptOssService.isAvailable()`.
3. Same field-level substitution for the other two gates:
   ```js
   // image-fallback exclusion
   if ((name === 'productName' || name === 'brandName' || name === 'genericCommodityName') &&
       (mergedFields.reconciliation?.gptOssResolvedFields || []).includes(name)) {
       return;
   }
   // anti-overwrite guard
   if (decl?.source === 'gpt_oss_120b' ||
       ((fieldPath === 'productName' || fieldPath === 'brandName' || fieldPath === 'genericCommodityName') &&
        (mergedFields.reconciliation?.gptOssResolvedFields || []).includes(fieldPath))) {
       return;
   }
   ```
4. Search the entire file for every other occurrence of
   `gptOssService.isAvailable()` (there are at least 6 as of `c79bd8d`,
   including one inside the `brandClassification` handling that may
   become redundant once the outer gate above is removed — if it becomes
   truly redundant, you may delete it, but only after confirming with a
   test that behavior is unchanged). List every occurrence you find and
   what you did with each one in your report.

**Test requirement for Issue 1 (mandatory, do not skip):**

Add a new test file `backend/test_identity_verification_gate.js` with, at
minimum:

- The exact Suite 5 fixture from `test_gpt_oss_suite.js`, but asserting
  **exact correct values**, not truthiness:
  ```js
  assert.strictEqual(mergedResult.brandName, 'NEXUS LABS');
  assert.strictEqual(mergedResult.productName, 'NITRO WHEY ISOLATE');
  ```
  (Adjust the expected values only if, after your fix, the deterministic
  scorer genuinely and correctly picks a different but *equally correct*
  assignment — but the assignment must not be inverted, and you must show
  your reasoning if you change these expected values from what's shown
  here.)
- A test with `GROQ_API_KEY` set to a value that will genuinely fail (e.g.
  an invalid key, or by monkey-patching `gptOssService.resolveIdentityFields`
  to reject/error), confirming that `applyGeminiFallback` (or the
  mandatory verification block, whichever applies) still gets a chance to
  act on the specific field GPT-OSS failed on, instead of that field being
  silently skipped.
- Run `node backend/test_gpt_oss_suite.js` for real, with a real
  `GROQ_API_KEY`, and paste the full output in your report.

---

## ISSUE 2 (CRITICAL) — Imperative packaging instructions are never excluded from identity-field candidates

**File:** `backend/src/services/extraction.js`, function
`isNonProductTitleCandidate`.

**Why it's wrong:** the function has 12 numbered rejection categories
(dates, prices, quantities, nutrition rows, batch/lot, FSSAI, contact
info, storage instructions, etc.) but **none of them cover imperative
packaging-handling directives** — "cut here", "tear along dotted line",
"open here", "peel to open", "twist cap to open", and similar. I verified
this is a live, reproducible gap by running `extractFields` against a
reconstructed fixture: with a modest, realistic increase in the
bounding-box height of an instructional-text line relative to the true
brand/product lines, the instructional text was selected as `productName`
outright — the current scoring function has no negative signal for this
category at all, so the outcome depends entirely on incidental font size.

**Required fix:** Add a new, fully generic rejection category (do not
name any real brand/product anywhere in this code):

```js
// 13. Imperative / procedural packaging-handling directives — generic,
// not tied to any specific product (e.g. cut-here marks, tear lines,
// twist-open caps, peel tabs). These are printed instructions for
// handling the package, never the product's identity.
if (/\b(?:cut|tear|open|peel|pull|press|push|twist|fold|snip|lift)\b.{0,20}\b(?:here|along|this\s*(?:line|side|edge)|dotted\s*line|perforat\w*|to\s*open|tab|corner)\b/i.test(tr)) return true;
if (/^(?:cut|tear|open|peel|pull|press|push|twist|fold|snip)\s+(?:here|from\s*here|along|this|the|open|carefully)/i.test(tr)) return true;
if (/\b(?:dotted|perforated)\s*line\b/i.test(tr)) return true;
```

Place this fix at the **hard-rejection filter level** (inside
`isNonProductTitleCandidate`), not only as a scoring penalty in
`scoreProductCandidate` — a hard rejection removes the font-size
sensitivity entirely, which is the actual bug; a scoring penalty alone
would just shift where the threshold breaks.

**Also update `backend/src/services/gptOssService.js` for defense in
depth**, matching the existing pattern used for dates/prices/quantities.
In the post-validation negative-constraint check (the block that already
does `if (/\b\d{1,2}[/-]\d{2,4}\b/.test(valStr) || ...)`), add the same
packaging-directive regex so that even if GPT-OSS's own reasoning fails to
follow its system prompt, the code-level check still rejects it:

```js
if (/\b(?:cut|tear|open|peel|pull|press|push|twist|fold|snip)\b.{0,20}\b(?:here|along|dotted\s*line|to\s*open|tab)\b/i.test(valStr)) {
    // reject, same as the existing date/price/unit rejections just above
}
```

**Do not** hardcode "CUT FROM HERE" or any other literal product/package
string anywhere. If, while testing, you find real packaging phrases that
this regex misses, extend it with more **generic verb/keyword patterns**,
not literal phrase matches.

**Test requirement (mandatory):** Add tests that run the exact fixture I
used, at multiple bounding-box sizes, confirming the instructional text is
*never* selected regardless of its relative height:

```js
// backend/test_instructional_text_exclusion.js
const { extractFields } = require('./src/services/extraction');
const assert = require('assert');

function buildFixture(instructionHeight) {
    return {
        rawElements: [
            { text: 'CUT FROM HERE', confidence: 0.95, bbox: [[50,30],[350,30],[350,30+instructionHeight],[50,30+instructionHeight]] },
            { text: 'GULF DATES', confidence: 0.90, bbox: [[60,300],[500,300],[500,400],[60,400]] },
            { text: 'ZAHIDI DATES', confidence: 0.88, bbox: [[60,420],[520,420],[520,500],[60,500]] },
            { text: 'Net Wt. 500g', confidence: 0.93, bbox: [[60,700],[300,700],[300,760],[60,760]] },
            { text: 'Product of Saudi Arabia', confidence: 0.92, bbox: [[60,900],[400,900],[400,950],[60,950]] }
        ]
    };
}

[60, 100, 140, 200].forEach(h => {
    const ext = extractFields(buildFixture(h), 'photo-1');
    assert.notStrictEqual(ext.productName, 'CUT FROM HERE', `Failed at instruction height ${h}px`);
    assert.notStrictEqual(ext.brandName, 'CUT FROM HERE', `Failed at instruction height ${h}px`);
});
console.log('PASSED: instructional text never selected across all tested sizes');
```

Run this for real and paste the output. If it still fails at any height,
do not consider Issue 2 fixed — iterate on the regex until it passes at
all four heights without hardcoding "CUT FROM HERE" itself as a
comparison target anywhere in the fix (only in the *test*, which is fine).

---

## ISSUE 3 (HIGH) — A wrong `productName` can still produce a false compliance PASS

**File (read-only reference, do not edit):**
`backend/src/services/ruleEngine.js`, rule `LM-03`:

```js
else if (code === 'LM-03') {
    const genericName = fields.genericCommodityName || fields.productName;
    if (genericName) {
        status = 'PASS';
        ...
    }
}
```

This rule checks *presence*, not *validity* — if `productName` is wrong
(e.g. an instructional phrase) it still marks the generic-commodity-name
requirement as PASS. Per rule 3 at the top of this document, **do not
edit `ruleEngine.js`.** Issue 2's fix should prevent `productName` from
ever holding an instructional/procedural string in the first place, which
closes this gap upstream.

**Required verification (not a code change):** after implementing Issue
2, write a test that runs the Gulf-Dates-style fixture above all the way
through to `ruleEngine.js`'s `evaluateRules` (or however the full
pipeline is invoked in existing tests), and confirm `LM-03`'s status for
that fixture is **not** `PASS` with the instructional text as the
extracted value. If it still is, that means Issue 2's fix is incomplete —
go back and strengthen it. Do not resolve this by touching
`ruleEngine.js`.

---

## ISSUE 4 (HIGH) — GPT-OSS is given a fake image size that contradicts the coordinates it's given

**Files:** `backend/src/services/extraction.js` (call site) and
`backend/src/services/gptOssService.js` (consumer).

**Current code**, `extraction.js`:
```js
const gptOssResult = await gptOssService.resolveIdentityFields({
    unresolvedFields: unresolvedIdentityFields,
    deterministicCandidates,
    rawOcrTokens: allOcrTokens,
    imageMeta: { width: 1000, height: 1000 }   // <-- always this literal, never real
});
```

**Current code**, `gptOssService.js`, `buildCompactOcrContext`:
```js
.map(t => ({
    text: t.text.trim(),
    confidence: ...,
    normalizedBbox: Array.isArray(t.bbox) && t.bbox.length >= 4 ? t.bbox : []
    // ^ this is the RAW pixel bbox from OCR, in the ORIGINAL photo's
    //   pixel coordinates (confirmed: ocr-service/app.py rescales bboxes
    //   back to original image dimensions before returning them) — NOT
    //   actually normalized to 0-1 or to the stated imageMeta size.
}))
```

**Why it's wrong:** GPT-OSS is told the image is 1000×1000 while receiving
bounding-box coordinates that can be several times larger (e.g. from a
4000×3000 original photo) — any spatial/positional reasoning it attempts
using these two numbers together is working from internally inconsistent
data.

**Required fix — normalize at the source instead of guessing which
photo's dimensions to report:**

1. First, verify (do not assume) that `backend/src/services/ocrClient.js`
   passes through `imageWidth`/`imageHeight` from the OCR service's
   response unchanged. `ocr-service/app.py`'s `/ocr` endpoint response
   includes `"imageWidth": orig_w, "imageHeight": orig_h` — confirm these
   survive into whatever `ocrClient.js`'s `runOCR()` returns to its
   caller. If they don't currently survive, add them to the return value.
2. In `extractFields(ocrResults, sourceImageId)`, when building the
   `rawOcrText: resultsArray` field that gets returned, **normalize each
   element's bbox coordinates to a 0–1 fraction using that photo's own
   `imageWidth`/`imageHeight`** (from `ocrResults.imageWidth` /
   `ocrResults.imageHeight`), rather than leaving them as raw pixels. This
   solves the deeper problem that a multi-photo scan can have photos of
   different resolutions feeding into one flat token list — a single
   global `imageMeta` cannot correctly describe pixel coordinates from
   more than one photo, but a 0–1 normalized coordinate is resolution
   independent and works for every photo uniformly.
3. Update the call site in `extraction.js` to match:
   ```js
   imageMeta: { width: 1, height: 1 }   // tokens are pre-normalized 0-1
   ```
4. Update the comment on `normalizedBbox` in `gptOssService.js` to state
   plainly that these are 0–1 fractions of that token's own source photo,
   not pixel coordinates.
5. If `imageWidth`/`imageHeight` are ever missing or zero for a given
   photo (defensive case), fall back to leaving that token's bbox as an
   empty array (`[]`) rather than dividing by zero or guessing — the
   existing code already treats `normalizedBbox: []` as "no spatial data,"
   so this degrades safely.

**Test requirement:** a small unit test confirming that for a given
OCR result with a known `imageWidth`/`imageHeight`, every bbox in the
returned `rawOcrText` has all x/y values between 0 and 1.

---

## ISSUE 5 (MEDIUM) — Two different functions decide what's a valid identity value, and they disagree

**File:** `backend/src/services/extraction.js` — `isNonProductTitleCandidate`
(strong, 13 categories after Issue 2) vs. `validateFieldFormat`'s
`'productName'`/`'brandName'`/`'genericCommodityName'` case (weak — only
checks `isDateShaped`, `isMarketingBadge`, and minimum length).

**Why it matters:** `validateFieldFormat` is the function that gates GPT-OSS's
own output (`extraction.js`, where `decision.value` is checked before being
applied) and Gemini's reconciled output. Because it's weaker than
`isNonProductTitleCandidate`, an LLM output that fails to follow its
instructions can pass this weaker gate even though it would have been
rejected at the deterministic candidate stage.

**Required fix:**

1. `isNonProductTitleCandidate` is currently defined as a local `const`
   *inside* `extractFields`'s function body. Confirm it does not reference
   anything from `extractFields`'s closure (it should only use its own
   `rawText` parameter) — if that's still true, move its definition to
   module-level scope (alongside `isDateShaped`, `isMarketingBadge`, etc.,
   above `extractFields`), so it can be called from `validateFieldFormat`,
   which is also at module level.
2. Update `validateFieldFormat`'s case for these three fields to also call
   it:
   ```js
   case 'productName':
   case 'brandName':
   case 'genericCommodityName': {
       const str = String(value).trim();
       if (isDateShaped(str)) return { valid: false, reason: `... date-shaped ...` };
       if (isMarketingBadge(str)) return { valid: false, reason: `... marketing badge ...` };
       if (isNonProductTitleCandidate(str)) return { valid: false, reason: `Rejected by identity-candidate filter: "${str}"` };
       if (str.length < 2) return { valid: false, reason: 'Too short to be a valid identity declaration' };
       return { valid: true, value: str };
   }
   ```
3. Add `isNonProductTitleCandidate` to `extraction.js`'s `module.exports`
   so it's independently testable.
4. Run the full existing test suite after this change — since this makes
   validation *stricter*, check whether any existing test's fixture now
   fails because it was relying on a previously-permissive value passing
   through Gemini/GPT-OSS output validation. If so, that test's fixture
   was masking a real gap; fix the fixture to use a genuinely valid value,
   don't loosen the new check.

---

## ISSUE 6 (MEDIUM) — Gemini's reconciled answer for most non-identity fields is silently discarded

**File:** `backend/src/services/extraction.js`, the block applying
`geminiService.reconcileFields`'s output back onto `merged`:

```js
const setterMap = {
    'productName': (m, v) => m.productName = v,
    'brandName': (m, v) => m.brandName = v,
    'genericCommodityName': (m, v) => m.genericCommodityName = v,
    'manufacturer.name': (m, v) => m.manufacturer.name = v,
    'marketer.name': (m, v) => m.marketer.name = v,
    'countryOfOrigin': (m, v) => m.countryOfOrigin = v,
};
if (setterMap[fieldName]) {
    setterMap[fieldName](merged, result.value);
    ...
}
```

**Why it's wrong:** any field name reaching this point that isn't one of
these 6 keys is simply skipped — `result.value` (Gemini's actual answer)
is computed and then thrown away, while `merged[fieldName]` stays frozen
at whatever the first photo happened to produce.

**Required fix — investigate before you patch, this needs care:**

1. First, enumerate every distinct string ever passed as the first
   argument to `reconcileField(...)` inside `mergeMultiPhotoExtractedFields`
   (search for all `reconcileField(` call sites in that function). This
   tells you the full universe of field names that can end up in
   `fieldsNeedingGemini` and therefore reach this setter block.
2. For each field name in that list that is **not** already in
   `setterMap`, check whether it is a simple scalar (safe for a generic
   dot-path setter) or a nested object with a specific shape (e.g. does
   `netQuantity` or `mrp` ever reach this generic path, or do they have
   their own dedicated `reconcileField` call with custom getter/setter
   functions that bypass this whole generic block entirely?). Do not
   assume — check the actual `reconcileField(...)` call for each one.
3. For any field confirmed to be a plain scalar and missing from
   `setterMap`, replace the whitelist-based setter with a generic
   dot-path setter so nothing scalar can be silently dropped:
   ```js
   const setNestedField = (obj, path, value) => {
       const parts = path.split('.');
       let target = obj;
       for (let i = 0; i < parts.length - 1; i++) {
           if (target[parts[i]] === undefined || target[parts[i]] === null || typeof target[parts[i]] !== 'object') {
               target[parts[i]] = {};
           }
           target = target[parts[i]];
       }
       target[parts[parts.length - 1]] = value;
   };
   // Replace: if (setterMap[fieldName]) { setterMap[fieldName](merged, result.value); ... }
   // With:
   setNestedField(merged, fieldName, result.value);
   ```
4. For any field confirmed to be object-shaped (like `{value, unit}`),
   do **not** blindly overwrite the whole object with a scalar — only
   update the relevant sub-key, and preserve the rest, or skip it
   entirely with a clear comment if it turns out those fields never
   actually reach this generic path (in which case, say so in your
   report and leave them out of the generic setter).
5. Add a test with a field name deliberately outside the old 6-entry
   whitelist (but confirmed scalar per step 2) that has genuinely
   conflicting values across 2+ photos, confirming Gemini's reconciled
   answer is now actually applied to `merged`, not discarded.

---

## ISSUE 7 (LOW) — Cleanup, safe to do alongside the above

1. `extraction.js`: a comment block titled "Semantic Identity Arbitration
   via GPT-OSS 120B..." appears duplicated back-to-back immediately above
   the `unresolvedIdentityFields` computation. Remove the duplicate,
   keep one copy.
2. `extraction.js`: inside the `brandClassification` handling block (the
   one gated by `if (geminiResult.brandClassification && ...)`), there is
   a redundant re-check of `!merged.reconciliation.gptOssUsed &&
   !gptOssService.isAvailable()` that duplicates the outer gate it's
   already nested inside. Once Issue 1c's restructuring lands, re-check
   whether this inner condition is now fully redundant; if so, remove it,
   but only after confirming with a test that behavior is unchanged.
3. `ocr-service/app.py`: the comment on `apply_clahe` references a real
   commercial brand name as an illustrative example. Replace it with a
   generic description (e.g. "dark-background, glossy-label products")
   — no functional change, just removes an unnecessary specific brand
   reference from production source.

---

## ISSUE 8 (HIGH) — OCR resize to 1920px makes the tiling fallback structurally unreachable

**File:** `ocr-service/app.py`.

**Current constants and logic:**
```python
MAX_IMAGE_DIM = 1920
TILE_THRESHOLD = 2560
...
if max(orig_h, orig_w) > MAX_IMAGE_DIM:
    scale = MAX_IMAGE_DIM / float(max(orig_h, orig_w))
    ... resize so the longest side becomes exactly 1920 ...
...
cur_h, cur_w = enhanced_img.shape[:2]
use_tiling = max(cur_h, cur_w) > TILE_THRESHOLD
```

**Why it's wrong:** because the resize step always caps the working
image's longest side at exactly `MAX_IMAGE_DIM` (1920), and tiling only
triggers above `TILE_THRESHOLD` (2560), `use_tiling` can mathematically
never become `True` for any input — the entire tiling code path
(`run_tiled_ocr`, `create_tiles`, `bbox_iou`, `deduplicate_results`) is
now dead. This means a very high-resolution original photo (e.g.
4000×3000) is now always downscaled by roughly half before OCR, with no
remaining path to preserve fine print (batch codes, FSSAI license
numbers, small nutrition-table text) the way tiling was originally built
to do. The in-code comment claiming "Tiling remains available as a
fallback for ultra-large images" is currently false.

**Required fix — decide tiling based on the ORIGINAL image size, before
the speed-resize is applied, and only apply the speed-resize to images
that don't need tiling:**

```python
orig_h, orig_w = img.shape[:2]

if max(orig_h, orig_w) > TILE_THRESHOLD:
    # Ultra-large image: preserve full resolution via tiling so fine
    # statutory print isn't lost to downscaling.
    scale = 1.0
    enhanced_img = apply_clahe(img)
    use_tiling = True
elif max(orig_h, orig_w) > MAX_IMAGE_DIM:
    # Normal large phone photo: fast single-pass path via controlled downscale.
    scale = MAX_IMAGE_DIM / float(max(orig_h, orig_w))
    new_w, new_h = int(orig_w * scale), int(orig_h * scale)
    resized_img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
    enhanced_img = apply_clahe(resized_img)
    use_tiling = False
else:
    scale = 1.0
    enhanced_img = apply_clahe(img)
    use_tiling = False

start_time = time.time()

if use_tiling:
    tiled_results = run_tiled_ocr(enhanced_img)
    formatted_results = [... same bbox/field mapping the current tiled branch already does, with scale=1.0 so no rescale is needed ...]
else:
    ... existing single-pass branch, unchanged, using enhanced_img and dividing bbox by scale as it already does ...
```

Keep every existing helper function (`apply_clahe`, `run_tiled_ocr`,
`create_tiles`, `deduplicate_results`, `bbox_iou`) exactly as-is — this is
a change to *when* they're invoked and on *which* image, not a rewrite of
their internals. Also update:
- The stale startup log line and `/health` endpoint's
  `phase5Enhancements.tilingThreshold` description so they accurately
  describe the new branching (three paths: tiled / resized-single-pass /
  original-single-pass), not just a threshold that's never reachable.
- Any comment claiming tiling is unreachable or dead — it no longer is.

**Test requirement:** since this is a Python service, add or update a
test (or a manual verification script if no Python test harness exists
yet — check `ocr-service/` for one first) confirming: (a) an image whose
longest side is, say, 1200px goes through the original-single-pass branch
with `scale=1.0`; (b) an image whose longest side is 2200px goes through
the resized-single-pass branch with `scale ≈ 1920/2200`; (c) an image
whose longest side is 3200px goes through the tiled branch with
`scale=1.0` and `use_tiling=True`. You can test this by calling the
branching logic directly with synthetic numpy arrays of the right shape
(you don't need a real photo, just an array of the correct dimensions) —
confirm `use_tiling`/`scale` in the JSON response match expectations for
each case.

---

## Final deliverable — required report format

When everything above is implemented, tested, committed, and pushed,
produce a single report (as a reply, or as `backend/FIX_REPORT.md` in the
repo — your choice) with exactly this structure, one section per issue:

```
### Issue <N>: <title>
Status: FIXED | PARTIALLY FIXED | NOT FIXED | N/A (with reason)
Files changed: <list>
Summary: <2-4 sentences, what changed and why>
Before → After (key snippet):
<code>
Tests added/run: <file names>
Test output (pasted verbatim, not paraphrased):
<output>
Caveats / open questions: <anything you're not 100% sure about>
```

Then, at the very end:

1. **Cross-check pass:** re-read this entire master prompt one more time
   against your actual diff (`git diff a807646 HEAD` or equivalent) and
   confirm, issue by issue, that everything listed was genuinely
   addressed — not just that you believe it was. Flag anything you
   skipped or couldn't fully verify.
2. **Statutory-field regression check:** explicitly confirm (with test
   output) that `mrp`, `unitSalePrice`, `netQuantity`,
   `dates.manufacture`, `dates.expiry`, `batchNumber`,
   `fssaiLicenseNumber`, `servingsPerContainer`, `servingSize`,
   `ingredients`, and `nutritionFacts` are still never touched by
   `gptOssService.js` or `geminiService.js` after your changes.
3. **Hardcoding self-check:** re-run a search across your own diff for
   any literal product/brand name you may have introduced (there should
   be none outside test files) and confirm the result.
4. **Git status:** paste `git log --oneline -15` and the output of your
   `git push` command, and state the final commit hash of
   `upgrade_speed+mapping`.

This report is what will be independently reviewed against the actual
repository state next — so completeness and honesty about anything
uncertain matters more than making every line look finished.
