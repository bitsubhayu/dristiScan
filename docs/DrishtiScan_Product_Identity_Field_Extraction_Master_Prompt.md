```
DRISHTISCAN - PRODUCT IDENTITY & FIELD-BOUNDARY EXTRACTION
(Root-Cause Fix, Not A Patch - This Is The Core Reliability Layer)
```

```
HOW TO USE THIS: everything else in this project - the rule engine, the PDF/DOCX
report, the pass/fail verdicts - is only as trustworthy as this extraction
layer. Two symptoms were reported from real multi-photo testing: (1) when a
label shows both the company/brand name and the product name, the system
sometimes treats them as competing answers to the same question and flags a
false cross-photo conflict, which then triggers a false Legal Metrology
inconsistency violation; (2) the quantity field sometimes comes back with
ingredient-list text mixed into it. A Gemini-based structuring step already
sits in this pipeline specifically to turn messy OCR text into clean fields, so
"the LLM should have fixed this" is a fair question - the point of this prompt
is to find out exactly why it hasn't, rather than assuming Gemini is simply bad
at this. Do not rewrite the extraction pipeline from scratch. Trace the actual
cause first, using the required mapping in Section 0, then apply the fix that
matches what's actually found - not the first plausible-sounding one.
```

```
============================================================
HARD CONSTRAINTS
============================================================
```

```
1. Do not touch the PDF export, barcode scanning, or UI/styling work from
earlier rounds. This prompt is scoped entirely to extraction, field structuring,
and cross-photo conflict detection.
```

```
2. Do not remove or weaken any existing correctness rule - specifically the
rule that servings-per-container must never become or corrupt net quantity,
and the rule that a flagged conflict must not be silently resolved into a value
used elsewhere in the report. Both stay in force; this prompt adds to them.
```

```
3. Complete Section 0 (mapping the actual pipeline) before writing any fix code,
and report what it finds. The rest of this prompt gives several hypotheses for
why "Gemini is already there" hasn't solved this - which one is correct changes
which fix is appropriate, so this cannot be skipped or guessed.
```

```
============================================================
SECTION 0: REQUIRED FIRST STEP - MAP THE ACTUAL PIPELINE
============================================================
```

```
Before changing anything, trace and report on exactly the following. Answer
these directly, in the actual code - do not infer or assume the answers from
this document:
```

```
a. Where exactly is Gemini called? Is it given the raw OCR text output and
asked to structure it into fields, or is it given the image directly (vision
input) and asked to extract fields itself, or something else?
```

```
b. Is Gemini called once per uploaded photo independently, with no knowledge
of the other photos, or is it given all photos/candidates together in one call
with cross-photo context?
```

```
c. What is the CURRENT exact prompt/instruction text sent to Gemini for this
structuring step? Paste it verbatim in the report - do not paraphrase it.
```

```
d. Where does "genuine conflict" detection actually happen? Does it compare
Gemini's already-structured per-field JSON output across photos, or does it
compare a separate, earlier list of raw OCR candidate strings that exists
independently of whatever Gemini decided? This is the single most important
question in this section - see Section 3.
```

```
e. Is there any format or shape validation applied to a field's value after
Gemini returns it - for example, is netQuantity ever checked to see if it
actually looks like a number-plus-unit before being accepted - or is whatever
Gemini/OCR returns accepted as-is for every field?
```

```
f. Is there currently one single field for product identity (e.g. a field
literally called productName), or are there already separate fields for brand
name, product/variant name, and the common/generic name of the commodity? Note
that the rule engine's own output already includes a rule described as "Common/
Generic commodity name declared as: ..." (seen in prior testing) - check whether
that rule is currently being fed from a real, separately-extracted generic-name
field, or whether it is just reusing whatever is in productName as a stand-in.
```

```
============================================================
HYPOTHESIS 1 (MOST LIKELY): PRODUCT IDENTITY IS ONE FIELD, BUT THE LABEL
LEGITIMATELY CONTAINS THREE DIFFERENT DECLARATIONS
============================================================
```

```
A label can correctly and simultaneously show three different, all-true pieces
of identity information: the brand/manufacturer's trade name (e.g. NUTRABOX),
the specific product/variant name (e.g. "The Alpha Creatine (Unflavoured)"),
and the common or generic name of the commodity - a declaration the Legal
Metrology rules separately require, precisely so a product's actual generic
identity (e.g. "Creatine Monohydrate") is stated plainly regardless of
marketing name. These are not three guesses at one true value - they are three
different true values that can all appear on the same pack.
```

```
If the schema has only one bucket for all of this, extraction is forced to
arbitrarily pick one of the three whenever it encounters any of them, and
different photos or angles may make a different one of the three most visually
prominent. Cross-photo conflict detection then sees three genuinely different
strings and reports a "conflict" - when the real problem is that three correct,
non-competing answers were forced into one field, not that any of them is wrong.
```

```
Required fix: split product identity into three explicit fields -
brandName, productName (the specific product/variant name), and
genericCommodityName - matching the declaration the rule engine already checks
for separately. Update the Gemini structuring prompt to define and request all
three distinctly, with a one-line definition of each and an instruction not to
put one kind of text into another's field. Update conflict detection to run
per-field, on these three separate fields, not on one merged identity field.
```

```
Verification for this specific case: after the fix, brandName should read
NUTRABOX, productName should read "The Alpha Creatine (Unflavoured)", and
genericCommodityName should read "Micronized Creatine Monohydrate" - all three
extracted with no conflict flagged, across all three original test photos. A
misread like "NUTHENTIC" (likely from a "100% AUTHENTIC" quality badge) should
not appear as a candidate for any of the three fields at all - a marketing/
quality badge is not a candidate value for brand, product, or generic name, and
the schema/prompt should say so explicitly rather than relying on the model to
infer it.
```

```
Important: this fix must not suppress genuine conflicts. If OCR genuinely reads
two different strings for the same one of these three fields across photos
(e.g. brandName comes back different from two photos), that is still a real
conflict and must still be flagged. The fix is correct field separation, not
a blanket reduction in how often conflicts get reported.
```

```
============================================================
HYPOTHESIS 2: NO FORMAT VALIDATION ON FIELDS THAT HAVE A WELL-DEFINED SHAPE
============================================================
```

```
Net quantity has a narrow, well-defined expected format - a number followed by
a unit (g, kg, ml, l, and similar). There is no legitimate reading of a label
where net quantity should ever contain ingredient names or composition
percentages. If whatever Gemini or the extraction step returns for this field
is accepted as-is with no shape check, any leakage from a visually adjacent
block of text (ingredients, nutrition table) passes straight through into the
final report unfiltered.
```

```
Required fix: add a strict post-extraction validator for every field that has
a well-defined format - net quantity, MRP, unit sale price, manufacture/expiry
dates, batch number, barcode, FSSAI numbers. If the returned value does not
match the expected pattern for that field, do not accept it as-is - mark that
field as a failed extraction requiring REVIEW, and consider a second, narrower
re-extraction pass targeted only at that field and its expected shape, instead
of accepting a paragraph of unrelated text as the value. Free-text fields
(address, ingredient list, generic name) do not need this and should stay as
they are.
```

```
Also investigate directly why nutrition-table and "how to use" content is
ending up in the same raw text block being classified as the quantity field to
begin with - this is the same underlying pattern as the previously-diagnosed
serving-size field-boundary bug. Check whether OCR output currently preserves
positional/bounding-box layout information, or whether it gets flattened into
one linear stream of text before reaching Gemini. If it's flattened, that loss
of spatial separation is very likely a root cause shared across this bug and
the earlier serving-size bug - fixing it once (preserving and using layout
information so visually distinct blocks stay distinct) is worth more than
patching the quantity field in isolation.
```

```
Verification for this specific case: netQuantity should read "300 g" and
contain nothing else, extracted from the same test photos where it previously
came back mixed with unrelated text.
```

```
============================================================
HYPOTHESIS 3: CONFLICT DETECTION MAY BE BYPASSING GEMINI'S STRUCTURED OUTPUT
ENTIRELY
============================================================
```

```
If cross-photo conflict detection runs on a separate, earlier list of raw OCR
candidate strings - gathered independently of whatever Gemini actually decided
was the correct value for each field - then Gemini's structuring work is not
actually the thing being compared for conflicts. This would mean the
structuring step could be working perfectly and these bugs would still happen,
because the comparison step never looks at its output.
```

```
Confirm this directly per Section 0d above. If conflict detection is comparing
raw pre-Gemini candidates, change it to compare Gemini's final structured
per-field values instead - conflict detection should always run on the same
data that ends up in the report, not a separate, earlier snapshot of it.
```

```
============================================================
REQUIRED: TIGHTEN THE GEMINI STRUCTURING PROMPT ITSELF
============================================================
```

```
Whatever Section 0c reveals about the current prompt, update it to explicitly:
```

```
- List every target field by name with a one-sentence definition each,
including the three separated identity fields from Hypothesis 1 and the
expected format for each shape-constrained field from Hypothesis 2.
- Instruct explicitly: do not put ingredient/composition list text into any
field other than an ingredients field. Do not put marketing or quality-badge
text (e.g. "100% authentic," "certified," "premium") into any identity field.
If a field's value cannot be confidently found on this label, return null for
it rather than guessing from unrelated nearby text.
- Use a fixed, low/zero temperature for this structuring call specifically, so
the same photo does not get classified differently across repeated runs or
retries. Confirm what temperature is currently set (or left unset/default) for
this call.
- Use the identical field schema on every photo/call, so that comparing field X
of photo 1 against field X of photo 2 is actually a like-for-like comparison.
```

```
============================================================
TEST FIXTURE (SAME REAL PRODUCT AS BEFORE - REUSE IT)
============================================================
```

```
Product: NUTRABOX - The Alpha Creatine (Unflavoured). Use the same three real
photos from the previous testing round. Expected field-level output after this
fix:
```

```
brandName: NUTRABOX
productName: The Alpha Creatine (Unflavoured)
genericCommodityName: Micronized Creatine Monohydrate
netQuantity: 300 g (nothing else in this field)
```

```
No conflict should be flagged on brandName, productName, or genericCommodityName
across the three photos. "NUTHENTIC" should not appear as a candidate value for
any of the three identity fields.
```

```
============================================================
REQUIRED VERIFICATION BEFORE REPORTING THIS AS FIXED
============================================================
```

```
Show the actual before-and-after JSON returned by the Gemini structuring step
itself for this test case - not just the final rendered report. This matters
because the goal is to fix the structuring layer, not to patch what the report
displays on top of a structuring layer that's still wrong underneath. Also show
whatever Section 0 found (the actual pipeline mapping) as part of the report,
since the fix applied should follow directly from that, not from guesswork.
```

```
============================================================
DEFINITION OF DONE
============================================================
```

```
1. Section 0's mapping of the actual pipeline is documented and shown, not
skipped.
```

```
2. Product identity is split into brandName, productName, and
genericCommodityName, each extracted separately and each checked for conflicts
separately - genuine cross-photo conflicts on any single one of these three are
still correctly flagged, not suppressed.
```

```
3. Fields with a well-defined format (net quantity, MRP, unit sale price,
dates, batch number, barcode, FSSAI numbers) are validated against that format
after extraction, and a non-conforming value is treated as REVIEW rather than
accepted as-is.
```

```
4. Conflict detection operates on Gemini's final structured output - the same
data that ends up in the report - not on a separate, earlier candidate list.
```

```
5. The Gemini structuring prompt explicitly defines every field, excludes
ingredient and marketing/badge text from identity and quantity fields, and uses
a fixed low/zero temperature.
```

```
6. Re-scanning the same three Alpha Creatine photos produces the exact
field-level output in the test fixture above, with the actual before/after
Gemini JSON shown as evidence, not just claimed.
```
