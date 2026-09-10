```
DRISHTISCAN - REMOVE ALL HARDCODED PRODUCT MATCHING + ACCURACY FIXES
(Final Architecture Pass - Non-Negotiable: Zero Hardcoded Names After This)
```

```
HOW TO USE THIS: this session traced the current bugs to actual code, not
symptoms. The single biggest discovery: parts of the "production" extraction
logic are hardcoded to the exact products used during testing - not a general
solution at all. That is fixed alongside the confidence/overwrite issues from
the previous round, which still haven't been applied. The one requirement that
overrides everything else in this prompt: after this pass, there must be zero
hardcoded product or brand names anywhere in the matching/decision logic. If a
fix works by adding another name, brand, or product category to a list, it is
the wrong fix - it will pass this test case and fail the next real product an
officer scans.
```

```
============================================================
HARD CONSTRAINTS
============================================================
```

```
1. No hardcoded product name, brand name, or exact-word matching may drive any
extraction decision anywhere in the codebase after this change - not one. A
fixed, closed list of commodity categories (even a long one) is the same
problem in a different shape and must also go.
```

```
2. Exception: illustrative examples written INSIDE a prompt sent to Gemini
(e.g. "brandName: the company trade name, e.g. NUTRABOX, Optimum Nutrition")
are fine and can stay or expand - those help Gemini generalize, they don't
restrict it to only those products. The test: if deleting that text would make
the code physically incapable of recognizing a different, unseen product, it's
a hardcode and must go. If it's inside a string sent to Gemini as guidance, it
stays.
```

```
3. Do not delete the Alpha Creatine or Fish Oil photos/results as test
fixtures - they're useful regression tests. The problem was these products'
names being burned into the matching LOGIC, not their use as test data.
```

```
4. Go one section at a time and confirm each works before moving to the next.
```

```
5. Section 6 (the final audit) is mandatory. Do not report this as done
without it.
```

```
============================================================
SECTION 0: KNOWN HARDCODED-NAME LOCATIONS (CONFIRM THESE, THEN SEARCH FOR MORE)
============================================================
```

```
- extraction.js, around line 1120: the product-title matcher is literally
    /Fish\s*O[il]{2}/i.test(t) || /Optimum\s*Nutrition/i.test(t) ||
    /Coca-?Cola/i.test(t) || /Bhujia\s*Sev/i.test(t)
  - four exact products, apparently the physical test items used during
  development.
```

```
- extraction.js, around line 58: a regex hardcoded to the literal misread
  token from one earlier bug report -
    /\b(?:NUTHENTIC|AUTHENTIC)\b/i
  - this is a patch for one specific misread word, not a general exclusion of
  marketing/quality-badge text.
```

```
- extraction.js, around lines 1296-1317: a closed list of about 19 hardcoded
  commodity-category regexes (Creatine Monohydrate, Whey Protein, Fish Oil,
  Bhujia Sev, Tomato Ketchup, and so on) used to guess genericCommodityName.
  Any real commodity outside this list - which is the overwhelming majority of
  what a Legal Metrology officer will actually scan - cannot be recognized by
  this code at all, no matter how well everything else works.
```

```
Confirm each of these, then search the rest of the codebase (all of
extraction.js, geminiService.js, ruleEngine.js, and any other service or
controller file) for any further literal product/brand name or closed
enumerated category list used in actual matching logic - as opposed to a
comment or a Gemini-prompt example, which are fine per the hard constraints
above.
```

```
============================================================
SECTION 1: REPLACE HARDCODED PRODUCT-IDENTITY MATCHING WITH A MANDATORY
GEMINI VISION PASS
============================================================
```

```
Delete the Section 0 titleMatch regex and the NUTHENTIC/AUTHENTIC regex
entirely. The marketing-badge exclusion these were patching around already
exists properly as an instruction in geminiService.js's prompt ("Marketing/
quality badges ... are NOT valid candidates for any identity field") - rely on
that general instruction instead of a hardcoded token list.
```

```
Product name, brand name, and generic commodity name must be verified by
Gemini on every single scan - not only when photos disagree with each other,
and not gated behind a regex matching first. The existing PaddleOCR-based
regex/heuristic extraction can remain as a fast first pass that produces
candidates for cross-photo comparison, but the value that actually reaches the
final report for these three fields must always pass through Gemini
verification, using the confidence-aware overwrite policy from Section 3 below
so a bad first-pass guess can actually be corrected.
```

```
============================================================
SECTION 2: REPLACE THE FIXED COMMODITY-CATEGORY LIST WITH GENERAL REASONING
============================================================
```

```
Remove the closed commodityPatterns list from Section 0. genericCommodityName
should be covered by the same mandatory Gemini verification pass from Section
1 - geminiService.js already has a FIELD_DESCRIPTIONS entry for this field,
make sure it's actually reached on every scan rather than only as a reactive
fallback.
```

```
============================================================
SECTION 3: APPLY THE CONFIDENCE-AWARE OVERWRITE POLICY (CARRIED OVER FROM LAST
ROUND - STILL NOT IN THE CODE)
============================================================
```

```
This was specified previously and confirmed still unapplied - it's a
prerequisite for Sections 1 and 2 to actually work, so it must be done as part
of this pass:
```

```
- Change extraction.js's brand/product/generic application (around line 1789)
and applyGeminiFallback's recovery application (around line 1926) from "only
fill in nulls" to "fill nulls, OR overwrite a value the primary extraction
itself flagged low-confidence."
```

```
- Add productName, brandName, and mrp to the fieldsToCheck array (around line
1876) and to geminiService.js's FIELD_DESCRIPTIONS dictionary if not already
present for mrp - otherwise Sections 1 and 2's "verify on every scan" behavior
has nowhere to actually apply its result.
```

```
============================================================
SECTION 4: FIELD-TYPE / SHAPE VALIDATION BEFORE ANY VALUE IS ACCEPTED
============================================================
```

```
Add a validation gate, independent of which extraction path produced the
value:
- A date-shaped string (matches a date pattern) must never be accepted into
productName, brandName, or genericCommodityName - reject it and treat that
field as unresolved rather than displaying it.
- netQuantity's unit must be checked against an actual set of valid units (g,
kg, ml, l, or count-style units like Capsules/Softgels/Tablets/Pieces/Sachets).
A non-unit value such as "n" must not pass through as if it were valid - the
"60 n" case from this session's test should have been caught here.
- Apply the same shape checks already specified for MRP, unit sale price, and
dates in the previous round if not yet done.
```

```
============================================================
SECTION 5: MAKE THE CONFIDENCE-BASED RULE STATUS UNIFORM, AND STOP TREATING AI
COMMENTARY AS A LEGAL CITATION
============================================================
```

```
First, trace exactly where the text "[Officer Review Required: Field
declaration carries uncertainty (0% confidence).]" actually comes from - it
does not exist as a literal string anywhere in ruleEngine.js or
reportGenerator.js as currently written, which suggests it may be Gemini's own
generated reasoning text being inserted directly into the citation/reasoning
column. Confirm this directly and report which it is before changing anything.
```

```
Separately, confirm this: ruleEngine.js's individual rule handlers (LM-04,
LM-06, LM-07, LM-09 at minimum) currently do a plain "does a value exist ->
PASS" check with no confidence awareness at all, which is why a clearly-wrong
value like "DECD 50" for a manufacturing date still returned PASS. Meanwhile
other rules (LM-01, LM-02, LM-05, LM-08) do appear confidence-aware in the
delivered report. This inconsistency needs one shared fix, not four separate
ones:
```

```
- Add one shared confidence check, applied uniformly to every LM-xx rule
result, that downgrades a PASS to REVIEW when the underlying field(s) it used
were flagged low-confidence/aiAssisted - regardless of which rule it is. Do
not fix this rule-by-rule; put it in one place both LM-04-style and LM-01-style
rules pass through.
```

```
- If the "[Officer Review Required...]" text is confirmed to be Gemini's own
freeform output, stop putting it directly into the citation/rule-reference
column. That column should contain only the fixed rule number and a fixed,
templated reason - not raw model-generated text. If there's real value in
showing the AI's reasoning, put it in a clearly separate, visually distinct
"system note" area - not mixed into what's presented as an authoritative legal
citation.
```

```
============================================================
SECTION 6 (MANDATORY): PROVE THERE ARE NO HARDCODED NAMES LEFT
============================================================
```

```
Grep the entire backend for any literal real-product or real-brand name
appearing in actual matching/decision logic - not in a comment, not in a
Gemini-prompt example, not in a test-fixture file. Report every match found,
with a one-line note on why each is safe (comment / prompt example / test
data) or confirmation that it was removed (logic).
```

```
Then run a live test: scan a packaged product that has never appeared anywhere
in this project's history, testing, or documentation - any ordinary household
item works. Confirm productName, brandName, and genericCommodityName are
populated by actual reasoning about that image, not left blank because nothing
hardcoded happened to match. This is the real test of whether Section 1's fix
worked - the Fish Oil and Alpha Creatine tests alone cannot prove it, since
those are exactly the products that used to be hardcoded.
```

```
============================================================
REQUIRED VERIFICATION
============================================================
```

```
Re-run both existing fixtures - the three Alpha Creatine photos and the three
Fish Oil photos - and show before/after values for productName, brandName,
genericCommodityName, and netQuantity, plus the exact status (PASS / REVIEW /
INSUFFICIENT_EVIDENCE) for LM-04, LM-06, and LM-09 specifically, to confirm the
previously-inconsistent confidence gating is now uniform. Also show the
Section 6 audit output and the result of scanning the new, never-before-used
product.
```

```
============================================================
DEFINITION OF DONE
============================================================
```

```
1. No literal product/brand name or closed category list drives any
extraction decision anywhere in the codebase - confirmed by the Section 6
audit output.
```

```
2. productName, brandName, and genericCommodityName are verified by Gemini on
every scan, not gated behind cross-photo disagreement or a hardcoded regex
match.
```

```
3. Gemini's output can overwrite a primary-extraction value that was itself
flagged low-confidence, not only an empty one.
```

```
4. A date-shaped or otherwise wrong-typed value cannot be accepted into
productName, brandName, genericCommodityName, netQuantity, mrp, or any date
field.
```

```
5. Every LM-xx rule applies the same confidence-based PASS/REVIEW/
INSUFFICIENT_EVIDENCE logic through one shared check, not per-rule.
```

```
6. The citation/rule-reference column contains only fixed, deterministic rule
text - never raw, unreviewed model-generated reasoning.
```

```
7. A product never previously used anywhere in this project is correctly
identified by real reasoning about the image, proving the fix generalizes.
```

```
8. Both existing test fixtures (Alpha Creatine, Fish Oil) still work
correctly - shown with before/after evidence, not just claimed.
```
