```
DRISHTISCAN - PHASE 5 MASTER PROMPT FOR ANTIGRAVITY
(OCR Accuracy: Semantic Multi-Angle Reconciliation, Confidence-Based Gemini
Fallback, Spatial Field Extraction, Preprocessing Fixes)
```

```
HOW TO USE THIS: paste this as a follow-up instruction to Antigravity. It
assumes the application already works end to end (OCR, extraction, rule engine,
reports, auth, repository, dashboard) and has already been through a debugging
pass that fixed cross-scan data contamination and the PASS-on-unreadable-image
bug. This phase targets the two problem classes identified in that debugging
pass: genuine OCR/image-quality errors on curved packaging, and application-
level semantic/reconciliation errors. Do not rebuild anything already working -
this is a targeted accuracy pass.
```

# `============================================================ BACKGROUND, SO THIS PROMPT STANDS ON ITS OWN ============================================================` 

```
A real test case: three photos of the same Optimum Nutrition Multivitamin bottle
were scanned. The system correctly extracted MRP, dates, batch number, and FSSAI
license with no data contamination from previous scans. However, it also
reported "Material discrepancy detected across photos for productName" comparing
"OPTIMUMNUTRITION.CO.IN." (from one photo, likely a website/domain text
fragment), "MOLTON" (an OCR fragment from marketer text), and "OPTIMUM" (from
the front label) - and used that false discrepancy to mark the whole scan
POTENTIAL_NON_COMPLIANCE. All three photos are of the same physical product.
Separately, a unit sale price of 13.99 printed clearly on the label was not
extracted, while the MRP right next to it (839.00) was extracted correctly - and
the manufacturer/marketer address, also visible in the photo, was reported as
"Not detected."
```

```
The conclusion from that debugging pass, which this prompt builds on: not
everything wrong here is an OCR problem. Retain PaddleOCR 3.7.0 / PP-OCRv6 as
the primary and first-pass OCR engine for every image - do not replace it. The
fixes below are about what happens to PaddleOCR's output afterward, plus some
preprocessing improvements to help PaddleOCR itself on curved, glossy, glare-
heavy surfaces.
```

```
Also important: perfect character-level OCR accuracy on a glossy cylindrical
bottle is not a realistic goal for any engine, free or paid. The real goal is
that the system never confidently states something false. Where it genuinely
cannot read something, it should say so (using the existing REVIEW /
INSUFFICIENT_EVIDENCE states) rather than guess - that is correct behavior, not
a failure to fix.
```

```
============================================================
HARD CONSTRAINTS FOR THIS PHASE
```

```
============================================================
```

```
1. PaddleOCR remains the sole engine for the first-pass text detection and
recognition on every image, for every scan, always. Nothing below changes that.
2. Gemini (via the Gemini API, using a free-tier Flash-class model - check
Google AI Studio for whichever current small/fast Flash model has the most
generous free-tier limits, since these change over time) is used only for two
specific, narrow tasks described below: semantic multi-angle reconciliation, and
a fallback re-read of fields PaddleOCR itself could not confidently extract.
Gemini must never be the first or only pass on a full raw image, and must never
replace PaddleOCR's role.
```

```
3. Every field whose final value came from the Gemini fallback pass (Fix 2
below) must be visibly and clearly labeled as such wherever it is shown - in the
on-screen result, the PDF, and the DOCX. Use wording along these lines: "AI-
assisted read - PaddleOCR could not confidently read this field; please verify
manually." Do not silently present a Gemini-fallback value with the same visual
weight as a normal high-confidence PaddleOCR read.
```

```
4. The semantic reconciliation step (Fix 1 below) does not need this same
```

```
warning label in the UI, since merging genuinely-the-same-product observations
across photos is normal expected behavior, not a failure state - but it should
still log its reasoning (see Data Model section) so it can be inspected if
questioned.
```

```
5. The reconciliation logic must remain capable of detecting a real conflict. Do
not fix the false-positive problem by simply forcing every multi-angle scan to
always agree - if two photos are genuinely of two different products, the system
must still catch that. See the Test Requirements section for the specific test
this must pass.
```

```
6. Do not regress any existing behavior: no fabrication of missing declarations,
the PASS / NON_COMPLIANT / POTENTIAL_NON_COMPLIANCE / REVIEW /
INSUFFICIENT_EVIDENCE state model, scan/session isolation, and multi-angle
merging must all continue to work exactly as they do now.
```

```
============================================================
FIX 1: SEMANTIC MULTI-ANGLE RECONCILIATION VIA GEMINI
============================================================
```

```
Replace the current logic that flags a "material discrepancy" whenever two
photos produce different raw strings for the same field (currently doing this
for productName, and likely similar issues exist for brand/genericName).
```

```
New approach: after PaddleOCR extracts candidate values for a field from each
photo, if those candidates are not already identical after basic normalization
(case, punctuation, whitespace), send the candidate values (plain text is
enough; the photos themselves are optional extra context if useful) to a single
Gemini call per scan, asking it to determine, for each field with multiple
candidates:
```

```
- whether the candidates represent the same real-world entity observed
differently (for example, a brand name, a website domain built from the brand
name, and an OCR fragment of the same brand, all referring to one product), in
which case return a single reconciled canonical value plus a brief reason
- or whether the candidates genuinely conflict (for example, two photos that
appear to show two different products entirely), in which case keep the conflict
flag and return the reasoning
```

```
Use this same call to also resolve brand vs. productName vs. genericName
classification, since it is the same kind of semantic judgment: given all the
candidate text fragments gathered across the photos, ask Gemini to classify
which fragments are the brand, which represent the specific product name, and
what a reasonable generic/commodity description would be (for example, brand
"Optimum Nutrition", product name "Multivitamin for Men", generic description
"Multivitamin tablets"). Do not let a brand name alone continue to populate the
genericName field.
```

```
Batch this into as few Gemini calls as reasonably possible per scan (ideally one
call covering all fields that need reconciliation for that scan), both for
efficiency and to stay comfortably within free-tier rate limits.
```

```
============================================================
FIX 2: GEMINI FALLBACK FOR LOW-CONFIDENCE OR UNDETECTED FIELDS
============================================================
```

```
When the extraction/rule-engine stage determines that a field is genuinely low-
confidence or was not detected at all (for example, manufacturer/marketer
address, or a value like a unit sale price that should be present but wasn't
confidently associated with its label), run one additional fallback step before
finalizing that field as "Not detected":
```

```
- Take the relevant image (or a cropped region near where a low-confidence
candidate was detected, if one exists) and send it to Gemini with a targeted
prompt asking it to read and return the specific declaration being looked for
(for example, "read the manufacturer or marketer name and address from this
label image, if present").
```

```
- If Gemini returns a value, use it, but tag it clearly (see Data Model below)
and apply the visible "AI-assisted read, please verify" labeling required by the
hard constraints above.
```

```
- If Gemini also cannot find it, the field stays "Not detected" / contributes to
INSUFFICIENT_EVIDENCE exactly as it does now - do not fabricate a value from
either engine.
```

```
Batch multiple low-confidence fields from the same scan into as few Gemini calls
as reasonably possible, same efficiency reasoning as Fix 1.
```

# `============================================================ FIX 3: SPATIAL (BOUNDING-BOX) LABEL-VALUE PAIRING ============================================================` 

```
This is a free, PaddleOCR-only fix and should be done regardless of the two
Gemini fixes above - it is likely the actual cause of the missed unit sale price
(13.99), which sits directly next to its faint field label on the label, while
the correctly-extracted MRP (839.00) sits next to its own label just above it.
If the current extraction logic matches values to field labels by searching for
keywords in the flattened OCR text, a faint or partially-read label (like a
light-colored "USP" or "MRP" printed on a dark background) can fail to anchor
its neighboring value, even though the value itself was read just fine.
```

```
Fix: use the bounding box coordinates PaddleOCR already returns for every
detected line to pair each candidate value with its nearest label by physical
position (proximity and reading order/columns), not only by searching for
keyword matches in concatenated text. When a numeric or date-like value is
detected close to a low-confidence but partially-matching label fragment, prefer
the positional association over discarding the value. This should directly help
with unit sale price, MRP qualifiers, and similar values-next-to-faint-labels
situations, and should be attempted before falling back to Gemini in Fix 2 -
only fall back to Gemini if positional pairing still can't confidently resolve
the field.
```

# `============================================================ FIX 4: PADDLEOCR CONFIGURATION AND PREPROCESSING IMPROVEMENTS ============================================================` 

```
These target genuine OCR/image-quality errors (for example, "Fish Oil" read as
"Fish Oll", "INGREDIENTS" read as "NGEDIENTS") on curved, glossy, glare-heavy
packaging. None of these replace PaddleOCR - they are configuration and
preprocessing changes around it.
```

```
- Review the current PaddleOCR pipeline configuration:
```

```
`use_textline_orientation`, `use_doc_unwarping`, `use_doc_orientation_classify`,
`text_det_limit_side_len`, `text_det_limit_type`, and `text_rec_score_thresh`
are real, current PaddleOCR 3.x pipeline parameters. Confirm what the current
settings are, and adjust: raise the detection side-length limit so large photos
are not downscaled before small text is detected (since processing time is not
the priority right now), and consider lowering the recognition score threshold
so borderline-confidence text isn't silently dropped by OCR itself - let the
existing confidence-based REVIEW/INSUFFICIENT_EVIDENCE logic handle uncertainty
explicitly instead of the OCR module discarding it first. Note that
```

```
`use_doc_unwarping` is designed for flattening a perspective-distorted flat
document, not for true cylindrical-surface unwrapping - test it, but don't
expect it to fully fix text that wraps around a curved bottle.
```

```
- Add a contrast-enhancement preprocessing step (for example CLAHE) before OCR -
this specifically helps the dark-background, light-text style labels seen on
this bottle.
```

```
- For large photos, tile the image into overlapping high-resolution crops and
run OCR on each tile rather than the whole image at once, then merge results
with position offsets - this avoids losing small dense text (like the nutrition
panel) to internal downscaling.
```

```
- Add brief capture-quality guidance in the officer capture screen: a short tip
```

```
to avoid direct flash glare, hold the camera steady, and fill the frame with the
panel being photographed. This is free, has no model or processing cost, and
meaningfully reduces how often a genuinely unreadable photo gets uploaded in the
first place.
```

```
============================================================
FIX 5: PERFORMANCE CHECK (DO THIS REGARDLESS OF THE ABOVE)
============================================================
```

```
Three minutes or more to process three images is unusually slow even for CPU-
based PP-OCRv6. Before layering more processing on top, confirm that the
PaddleOCR model is loaded once when the OCR service starts, and not re-
initialized on every incoming request - re-loading model weights per request is
a common and completely free-to-fix performance bug. Report back what the
current behavior actually is and fix it if it is reloading per request,
independent of whether any of the accuracy fixes above are implemented yet.
```

```
============================================================
DATA MODEL AND PROVENANCE UPDATES
```

```
============================================================
```

```
Extend each extracted field's stored/returned data to include:
```

```
- source: "paddleocr_primary", "spatial_pairing", "gemini_reconciliation", or
"gemini_fallback"
```

```
- confidence: the original OCR/derivation confidence where available
- reconciledFrom: if applicable, the list of raw candidate values and which
photo each came from, plus the reconciliation reasoning if Gemini was used
- a boolean or equivalent flag the frontend/report/PDF/DOCX can use to decide
whether to show the "AI-assisted read, please verify" label (true only for
source = "gemini_fallback", per the hard constraints above)
```

```
This matches and extends the provenance approach already established in the
application (scanId, imageId, rawText, confidence, sourceRegion,
normalizedValue) - it should not require a new architecture, just additional
fields on the existing structures.
```

```
============================================================
ENVIRONMENT VARIABLES NEEDED
```

```
============================================================
```

```
- GEMINI_API_KEY - for the backend to call the Gemini API directly for Fix 1 and
Fix 2. This is separate from whatever model Antigravity itself uses to write
code - it is a runtime dependency of the deployed application. Use a free-tier
Flash-class model; check current options and free-tier limits at the time of
implementation, since Google updates these.
```

```
============================================================
TEST REQUIREMENTS
```

```
============================================================
```

```
Add these to the existing test matrix:
```

```
1. Re-run the exact three-photo Optimum Nutrition test. Expected result: no
"material discrepancy" flag on productName/brand, a correctly reconciled brand
("Optimum Nutrition") and generic description (something like "multivitamin
tablets"), and overall compliance should no longer be pulled down by a false
product-name conflict.
```

```
2. Negative control: deliberately mix one photo from a genuinely different
product (for example, the earlier Haldiram or Coca-Cola test images) in with
photos of the Optimum Nutrition bottle. Expected result: the system must still
detect and flag this as a real conflict - this is what confirms Fix 1 didn't
just disable conflict detection entirely.
```

```
3. Confirm the unit sale price (13.99) is now extracted, either via the spatial
pairing fix (Fix 3) or, failing that, via the Gemini fallback (Fix 2) with
```

```
correct "AI-assisted" labeling if the fallback was the one that caught it.
```

`4. Confirm manufacturer/marketer extraction improves, with the same labeling requirement if Gemini fallback was needed to recover it.` 

`5. Regression: the unreadable/blank image test must still produce INSUFFICIENT_EVIDENCE or REVIEW, never PASS.` 

`6. Regression: cross-scan data contamination must still not occur (re-run the earlier scan-isolation tests).` 

`7. Spot-check curved-surface character-level accuracy before and after Fix 4's preprocessing changes on a few known-hard images - report the difference, but do not treat anything less than perfect as a failure; the acceptance criterion here is measurable improvement, not perfection.` 

`8. Confirm and report the actual cause of the current ~3-minutes-for-3-images processing time (Fix 5), and the time after the model-loading fix if that was the cause.` 

```
============================================================
```

```
DEFINITION OF DONE
```

```
============================================================
```

`1. The Optimum Nutrition three-photo test no longer produces a false productName/brand conflict, while the negative-control test with a genuinely different product still correctly flags a real conflict.` 

`2. Brand, product name, and generic/commodity description are populated as distinct, correctly classified fields rather than all being derived from the same branding text.` 

`3. Unit sale price and manufacturer/marketer information are extracted for this test case, via spatial pairing and/or the labeled Gemini fallback.` 

`4. Any field recovered via the Gemini fallback pass is visibly labeled as an AIassisted read requiring manual verification, everywhere it appears (screen, PDF, DOCX) - reconciliation-only fields are not labeled this way.` 

`5. PaddleOCR remains the sole first-pass OCR engine for every image; Gemini is only ever used for the two narrow downstream tasks described above.` 

`6. No fabrication, no PASS-on-unreadable-image, and no cross-scan contamination regressions.` 

`7. The cause of the current slow processing time has been identified and reported, and fixed if it was the model-reloading issue.` 

`8. Measurable (not necessarily perfect) improvement in curved-surface characterlevel OCR accuracy is demonstrated on at least a few known-hard test images.` 

