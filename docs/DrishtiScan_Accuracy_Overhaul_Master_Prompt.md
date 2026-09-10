```
DRISHTISCAN - ACCURACY OVERHAUL
(Findings Traced Directly From The Actual Repo - github.com/bitsubhayu/dristiScan)
```

```
HOW TO USE THIS: every finding below was confirmed by actually reading the
current code (extraction.js, geminiService.js, ruleEngine.js, mismatchCheck.js),
not guessed from symptoms. File and approximate line references are given so
each one can be located and verified directly before changing it. This exists
because "why isn't Gemini catching this, it's already there" turns out to have
a precise, structural answer: Gemini's two integration points share one design
flaw, and two of the highest-stakes fields were never actually wired to reach
Gemini at all. Fix the shared flaw once rather than patching each field
separately again - that pattern (fix one field, the same bug resurfaces on the
next field next round) has repeated across every previous round on this
project, and it will keep repeating until the shared cause is fixed.
```

```
============================================================
RESOLVE THIS FIRST - A GROUND-TRUTH CONFLICT IN THE TEST DATA
============================================================
```

```
The comparison report treats "100 g" as the correct net quantity and derives
"33 servings" from it (100 ÷ 3). Every earlier round on this same physical
product established net quantity as 300 g with approximately 100 servings at
3 g each - consistent with the batch number, MRP, and dates already confirmed
correct in this same comparison. Before trusting this report's verdicts on
netQuantity and servingsPerContainer, confirm with the person which is actually
correct for the physical unit being tested - it's possible the "authentic
website" used for comparison lists a different pack-size variant of the same
product line. Do not silently pick one; this affects whether "300 servings" is
actually a bug or actually correct, so get this confirmed before treating
either verdict as ground truth in the test fixture at the end of this prompt.
```

```
============================================================
FINDING 1 (HIGHEST PRIORITY): BOTH GEMINI INTEGRATION POINTS ONLY FILL EMPTY
FIELDS - NEITHER CAN EVER CORRECT A WRONG VALUE
============================================================
```

```
backend/src/services/extraction.js, around line 1789:
    if (bc.brand && !merged.brandName) merged.brandName = bc.brand;
    if (bc.productName && !merged.productName && ...) { merged.productName = bc.productName; }
    if (bc.genericName && !merged.genericCommodityName) merged.genericCommodityName = bc.genericName;
```

```
backend/src/services/extraction.js, around line 1926 (inside applyGeminiFallback):
    if (!target[lastKey]) {
        target[lastKey] = value;
        ...
    }
```

```
Both of these apply Gemini's output only when the existing field is currently
empty/falsy. If the PRIMARY (pre-Gemini) extraction already produced a value -
even a wrong one, even one that the primary extraction itself flagged as
low-confidence - Gemini's correct answer is computed successfully and then
silently discarded, because the field wasn't empty. This is very likely why
brandName still showed the marketer's name ("Thee Feathers Life Sciences")
instead of the actual brand ("Nutrabox") in the latest test: the primary
extraction populated brandName with something first, and Gemini's own
correctly-reasoned classification of "brand = NUTRABOX" never got applied on
top of it. Gemini's prompt and logic here are already well-written - this is
purely an application/overwrite-policy bug downstream of a correct Gemini
answer.
```

```
Required fix: change the overwrite policy from "only fill nulls" to "fill
nulls, OR overwrite a value the primary extraction itself marked
low-confidence." A wrong-but-present low-confidence value is functionally the
same problem as a missing one and should be treated the same way. Do not make
Gemini able to overwrite a value the primary extraction is actually confident
about - that would risk the opposite problem (Gemini overriding correct OCR).
The gate should be confidence-based, not presence-based.
```

```
============================================================
FINDING 2: THE RECONCILIATION PATH (FIX 1) ONLY RUNS ON CROSS-PHOTO
DISAGREEMENT - IT CANNOT CATCH A CONSISTENT MISTAKE
============================================================
```

```
extraction.js, around line 1733:
    if (Object.keys(fieldsNeedingGemini).length > 0 && geminiService.isAvailable()) {
```

```
fieldsNeedingGemini is only populated when candidates for a field DISAGREE
across the photos. If the primary extraction misclassifies the same wrong text
as productName on all three photos consistently (no disagreement to detect),
this whole path - including the well-designed brand/product/generic
classification prompt in geminiService.js - never runs at all for that field.
Confirm directly whether this is what happened with "NUTHENTIC": check whether
productName differed across the three photos in this test (a real conflict) or
was identical across all three (a systematic miss that this path is
structurally incapable of catching).
```

```
Required fix: for the small set of highest-stakes fields - brandName,
productName, genericCommodityName, mrp, unitSalePrice - do not wait for
disagreement. Always run a Gemini verification pass against at least one image
for these specific fields on every scan, and apply Finding 1's confidence-based
overwrite policy to the result. Reserve the current disagreement-only behavior
for lower-stakes fields where a full re-check on every scan isn't worth the
extra API call.
```

```
============================================================
FINDING 3: productName AND brandName ARE NOT EVEN ELIGIBLE FOR THE
LOW-CONFIDENCE FALLBACK PATH (FIX 2)
============================================================
```

```
extraction.js, around line 1876-1884:
    const fieldsToCheck = [
        { name: 'unitSalePrice', ... },
        { name: 'manufacturer.name', ... },
        { name: 'manufacturer.address', ... },
        { name: 'marketer.name', ... },
        { name: 'countryOfOrigin', ... },
        { name: 'consumerCare.phone', ... },
        { name: 'genericCommodityName', ... },
    ];
```

```
productName and brandName are absent from this list, even though
geminiService.js's FIELD_DESCRIPTIONS dictionary already has well-written
entries for exactly these two fields (including the explicit "NOT the brand"
and "NOT marketing badges" instructions). The description work is done and
unused - it's simply never reached, because nothing ever adds these two field
names to the list that decides what gets sent to Gemini.
```

```
Required fix: add 'productName' and 'brandName' to this fieldsToCheck list, so
that whenever either is empty OR flagged low-confidence by the primary
extraction, Gemini's fallback (which already knows how to read them correctly)
actually gets a chance to run.
```

```
============================================================
FINDING 4: MRP HAS NEVER BEEN ELIGIBLE FOR GEMINI FALLBACK AT ALL - LIKELY THE
REAL REASON IT HAS STAYED BROKEN ACROSS THREE ROUNDS
============================================================
```

```
'mrp' is missing from BOTH:
- the fieldsToCheck array in extraction.js (Finding 3's location)
- the FIELD_DESCRIPTIONS dictionary in geminiService.js's fallbackReadFields
```

```
The current MRP extraction already has four separate PaddleOCR-text-based
recovery strategies layered on top of each other (direct regex, label-then-
adjacent-element search, standalone-decimal fallback, spatial-pairing
fallback - all present and confirmed in the code around extraction.js lines
660-725). That is a lot of engineering effort already spent on text-based
recovery. If PaddleOCR's raw OCR output never captured the MRP sticker's text
in a usable form to begin with - not misformatted, actually absent from the
text - none of those four strategies has anything to work with, and only a
direct visual re-look (Gemini fallback, which reads the image itself, not
PaddleOCR's text output) could recover it. That path currently isn't wired for
MRP at all.
```

```
Required fix: add 'mrp' as a Gemini-fallback-eligible field: add it to the
fieldsToCheck array, and add a clear FIELD_DESCRIPTIONS entry distinguishing it
from unitSalePrice (e.g. "the Maximum Retail Price / MRP - a bold, prominent
retail price, usually printed with 'inclusive of all taxes' nearby - distinct
from the smaller per-unit price").
```

```
============================================================
FINDING 5: A KNOWN-LOW-CONFIDENCE VALUE IS BEING DISPLAYED AS IF IT WERE
DEFINITE
============================================================
```

```
The comparison report notes the system's own evidence says the unitSalePrice
reading couldn't be read clearly, yet "Rs. 7.66" appears in the report with no
visible uncertainty marker. Trace whether this value was present in
_singleExtractions[].lowConfidenceFields for this scan; if it was, Finding 1's
overwrite-policy fix should also cause it to pick up the "aiAssisted" /
"please verify" tag that reportGenerator.js already knows how to render
(isFieldAiAssisted, confirmed present in reportGenerator.js) - that tagging
logic only fires when a fallback value is actually applied, which currently
can't happen for a non-empty field. Fixing Finding 1 should fix this
automatically; verify that it does rather than patching this one separately.
```

```
============================================================
FINDING 6: NO CROSS-FIELD ARITHMETIC VALIDATION EXISTS ANYWHERE IN THE
CODEBASE YET
============================================================
```

```
mismatchCheck.js only compares extracted values against an officer-provided
external listing (a different feature entirely) - it does not check extracted
fields against each other. There is no code anywhere that checks netQuantity
against servingSize x servingsPerContainer, or mrp against netQuantity and
unitSalePrice, or manufacture date against expiry date.
```

```
The standalone-servings regex in extraction.js (around line 758):
    const standaloneServings = fullText.match(/\b(\d+)\s*Servings?\b/i);
```

```
runs against fullText - a flattened, linear OCR text stream. If two unrelated
numbers end up adjacent to each other in that flattened stream (a real risk
whenever spatial/bounding-box layout isn't preserved), this regex has no way
to tell a genuinely-paired "100 Servings" from an accidentally-adjacent number
that has nothing to do with servings. This is a plausible mechanism for a wrong
servings value, independent of whatever the ground-truth-conflict section
above resolves to.
```

```
Required fix: after the merge step, add explicit cross-field validators:
- netQuantity ÷ servingSize should approximately equal servingsPerContainer
  (flag if it disagrees beyond a small tolerance)
- mrp ÷ netQuantity should be in the same neighborhood as unitSalePrice, unit-
  adjusted (flag if wildly inconsistent)
- manufacture date must be before expiry date, and the gap should be a
  plausible shelf-life range, not negative or absurd
A failed check should downgrade that field to REVIEW - it should not silently
keep displaying the OCR'd value as if it passed.
```

```
============================================================
FINDING 7: COUNTRY OF ORIGIN - CONFIRM WHICH CODE PATH THE CONTRADICTION CAME
FROM
============================================================
```

```
As the code currently reads, ruleEngine.js's LM-02 rule and reportGenerator.js's
declarations table both read the same fields.countryOfOrigin from the same
merged object, and mergeMultiPhotoExtractedFields (which includes the Gemini
fallback step) completes before evaluateRules is called in
officerController.js - so on a straight read of the code, these two should
agree. If the delivered report genuinely showed "India" in one place and "not
detected" in the other, grep every place countryOfOrigin is read for display
versus for rule evaluation and confirm whether a different property path (for
example a per-photo declarations.countryOfOrigin evidence record, distinct from
the top-level merged field) was used in one place but not the other. This is
the same single-source-of-truth principle flagged in earlier rounds on other
fields (the MRP panel-vs-findings contradiction, and the productName
conflict-still-used-elsewhere bug) - if it's resurfacing again on a new field,
it's worth introducing one shared accessor/getter for each field's authoritative
value, used everywhere it's displayed or reasoned about, rather than continuing
to fix this same class of bug field by field.
```

```
Separately: if "India" did come from Gemini's fallback rather than primary
extraction, note that geminiService.js's fallback prompt already explicitly
instructs "Only return values you can actually see in the image. Do NOT guess
or fabricate" - so if this was a hallucination, the instruction alone wasn't
sufficient. Consider adding a lightweight grounding check: require Gemini to
also return the exact source phrase it based the answer on, and programmatically
confirm that phrase actually appears somewhere in this photo's OCR text before
accepting the field. An answer with no locatable source text is a strong
hallucination signal and should be rejected rather than trusted.
```

```
============================================================
WHAT "ABOVE 98% ACCURACY" SHOULD ACTUALLY MEAN FOR AN OFFICIAL COMPLIANCE TOOL
============================================================
```

```
No OCR+LLM pipeline will read every real-world photo correctly on the first
pass - lighting, damage, and label design vary too much for that to be a
realistic target. The metric that actually matters for a government compliance
tool is different from raw field-match accuracy: it's the rate at which a
field presented as definite (PASS, not REVIEW) turns out to be wrong. That rate
should approach zero. A meaningfully nonzero REVIEW rate is not a failure - a
government officer reviewing a flagged field is the system working as intended.
The dangerous failure mode is the one already found twice in this report:
presenting an uncertain or wrong value with the same confidence as a verified
one. Track and optimize for "false-confidence rate" specifically, not overall
percent-correct - that reframing is what actually makes a defensible >98% claim
achievable, since it's a claim about how often the system is confidently wrong
(should be near zero), not a claim that it's never wrong at all.
```

```
============================================================
REQUIRED VERIFICATION
============================================================
```

```
Re-run the same three Alpha Creatine photos after applying these fixes. For
every field discussed above, show the value at each stage of the pipeline -
primary/PaddleOCR extraction, Gemini reconciliation output (if triggered),
Gemini fallback output (if triggered), the final merged field, the rule engine
finding, and the rendered report/declarations value - so it's possible to see
exactly which stage produced whatever ends up on the page. Use whichever net
quantity/servings figures were confirmed correct in the ground-truth section
above as the acceptance target, not whichever number happened to be convenient.
```

```
============================================================
DEFINITION OF DONE
============================================================
```

```
1. Gemini's output (from either integration point) can overwrite a primary-
extraction value when that value was itself flagged low-confidence - not only
when the field was empty.
```

```
2. brandName, productName, genericCommodityName, mrp, and unitSalePrice are
verified by Gemini on every scan, not only when photos disagree with each
other.
```

```
3. mrp and productName/brandName are fully wired into the Gemini fallback path
(fieldsToCheck array and FIELD_DESCRIPTIONS dictionary both updated).
```

```
4. Any field whose value came from a source that expressed uncertainty carries
that uncertainty through to the final report - it never displays identically
to a confident, verified value.
```

```
5. Cross-field arithmetic validation (quantity/servings, MRP/USP, date
ordering) exists and downgrades a field to REVIEW when the numbers don't add
up, instead of silently trusting whatever OCR produced.
```

```
6. The country-of-origin contradiction is traced to its actual cause (a
property-path mismatch, a timing issue, or something else) and fixed at the
source, not patched only for this one field.
```

```
7. Stage-by-stage before/after output is shown for the same test case, and the
net-quantity ground-truth conflict is confirmed with the project owner before
being used as the acceptance target.
```
