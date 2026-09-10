```
DRISHTISCAN - CRITICAL BUG EVIDENCE AND REQUIRED FIXES (ROUND 2)
(Real-Product Test Case With Ground-Truth Values, Barcode Non-Detection, Broken
PDF Download)
```

```
HOW TO USE THIS: this follows the previous critical-fix-and-audit pass. Real-
world testing with an actual product afterward showed several of the same bug
classes are still present, one severe new symptom, and two separate broken
features (PDF download, barcode scanning). This prompt provides exact ground-
truth values from a real product so the fix can be verified precisely, not just
claimed. Do not report anything as fixed without showing the actual before/after
output for the test case below.
```

```
============================================================
TEST FIXTURE: REAL PRODUCT WITH KNOWN CORRECT VALUES
============================================================
```

```
Product: NUTRABOX - The Alpha Creatine (Unflavoured), a creatine monohydrate
supplement. Three real photos of this product (front label, and two views of the
back/side label) were used as the test scan. The correct values, confirmed
directly from the photos, are:
```

```
Brand: NUTRABOX
Product name: The Alpha Creatine (Unflavoured)
Ingredient / generic description: Micronized Creatine Monohydrate (this is the
ingredient, not the product name)
Net quantity: 300 g
Servings per container: 100 (approx.)
Serving size: 3 g (one scoop)
MRP: Rs. 2299.00 (inclusive of all taxes)
Unit sale price: Rs. 7.66 / g
Batch number: NP60311
Manufacture date: 03/2026
Expiry date: 08/2027
Manufactured by: Nutricare Biosciences Pvt. Ltd., Surat - 394530, Gujarat, India
Marketed by: Three Feathers Life Sciences, A/1, 3rd Floor, Safal Profitaire,
Corporate Road, Prahladnagar, Ahmedabad - 380015, India
Consumer care contact: phone numbers including +91 98 2400 0768 and +91 98240
00403, email info@nutrabox.in
FSSAI license numbers: two separate ones are printed - one for the marketer
(10717001000025) and one for the manufacturer (10715031000081) - both should
ideally be captured and correctly attributed, not just one
Barcode (EAN-13): 8906091301250
Allergen note printed on pack: "This product is made in a facility which also
processes milk and soy derivatives."
```

```
Use this exact product and these exact values as a permanent, repeatable
regression test. Every bug below should be checked against this specific case,
and the fix should not be considered complete until re-scanning these three
photos produces output matching the correct values above.
```

```
============================================================
BUG 1: PRODUCT-NAME FIELD CONTAINS INGREDIENT TEXT, NOT JUST A MISREAD
============================================================
```

```
The system reported a "genuine conflict" for productName across the three
photos, with candidate values "NUTHENTIC" (likely a misread of a "100%
AUTHENTIC" badge), "NUTRABOX" (correct), and "Micronized Creatine Monohydrate"
(this is the ingredient list content, not a product name candidate at all).
```

```
This is not primarily an OCR misread problem - the third candidate is text from
the wrong section of the label being classified as the wrong field. Investigate
why text from an ingredients panel is being offered as a productName candidate,
and fix the extraction/classification step so it does not treat ingredient-list
text as a possible product name. This is likely the same underlying field-
```

```
boundary problem causing Bugs 2 and 3 below, not an isolated issue - fix the
shared root cause rather than only this one symptom.
```

```
============================================================
```

```
BUG 2: A FLAGGED CONFLICT VALUE IS STILL USED ELSEWHERE AND ALLOWED TO PASS
RULES
============================================================
```

```
Even after productName was flagged as a genuine conflict, the garbage value
"NUTHENTIC" was still used as the actual Product Name and Generic Commodity Name
shown elsewhere in the same report, and the rule checking generic name
declaration ("PASS - Common/Generic commodity name declared as: NUTHENTIC")
passed using that clearly-wrong value.
```

```
Required behavior: once a field is flagged as a genuine cross-photo conflict, it
must be treated as unresolved everywhere in that report, not just in the panel
where the conflict was first detected. Any rule that depends on a conflicted
field must be marked REVIEW, not PASS or NOT_APPLICABLE, and the conflicted
field must not be silently resolved into any single value used elsewhere in the
declarations, PDF, or DOCX.
```

```
============================================================
BUG 3: SERVING SIZE FIELD CONTAINS UNRELATED TEXT MASHED TOGETHER
============================================================
```

```
The servingSize field came back containing a mix of the nutrition composition
table, the "how to use" instructions, and storage information, all run together
as one value, instead of just the serving size itself (3 g). This is a field-
boundary extraction failure, not a misread - investigate the same underlying
issue as Bug 1, since both point to extraction not correctly determining where
one field's relevant text ends and unrelated nearby text begins.
```

```
============================================================
BUG 4: NET QUANTITY CONFUSED WITH SERVINGS COUNT, AGAIN
============================================================
```

```
netQuantity was reported as "100 g" - the correct value is 300 g. The pack
prominently prints "100 Servings" on the front. This is the same servings-vs-
net-quantity confusion that was already established as a rule to never violate.
Re-verify that this rule (servings per container must never become or corrupt
the net quantity value) is actually being enforced in the current code, since
this test case shows it failing, and add this exact case (100 g reported vs. 300
g correct, with "100 Servings" printed nearby) as a permanent regression test.
```

```
============================================================
```

```
BUG 5: MANUFACTURER, MARKETER, AND CONSUMER-CARE EMAIL MISSED DESPITE BEING
LEGIBLE
```

```
============================================================
```

```
All three of these were reported "Not detected," despite being clearly printed
and legible in the photo - and despite the report's own character-readability
check stating the package text was clear and legible for automated reading. The
system is contradicting itself: it cannot simultaneously report that the text
was legible and that this specific information could not be found. This confirms
the gap is in extraction/field-matching, not image quality, consistent with Bugs
1 and 3. Use the exact ground-truth manufacturer, marketer, and email values
above to verify the fix.
```

```
============================================================
BUG 6: MRP AND UNIT SALE PRICE MISSED AGAIN
============================================================
```

```
Both were reported "Not detected," despite being printed in bold on a plain
white high-contrast sticker (2299.00 and 7.66/g). This is the same failure
```

```
pattern as an earlier bug where a unit price next to a correctly-read MRP was
missed. Re-verify whether the positional/spatial label-value pairing fix that
was previously specified for exactly this kind of situation is actually present
and active in the current code - the evidence here suggests it either was not
fully implemented or has regressed. Use the exact MRP (2299.00) and unit sale
price (7.66/g) values above to verify the fix.
```

# `============================================================ BUG 7: THE REPORT CONTRADICTS ITSELF ABOUT WHETHER MRP WAS FOUND ============================================================` 

```
The rule-findings table's reasoning for the MRP rule states "MRP detected, but
'inclusive of all taxes' statement was not observed," while the extracted-
declarations panel in the same report states "MRP: Not detected." These two
parts of the same report disagree about a basic fact. Find and fix whatever is
causing different parts of the report to be built from inconsistent underlying
data - there should be exactly one source of truth for each field's value, used
consistently everywhere it's displayed or reasoned about.
```

# `============================================================ BUG 8: BARCODE SCANNING APPEARS NON-FUNCTIONAL` 

```
============================================================
```

```
A clean, sharp, well-lit, high-contrast barcode image was provided specifically
to test this feature, and nothing was detected at all - not a misread, no result
whatsoever. Confirm directly whether an actual barcode-decoding library is wired
up and being called at all, for both the live-camera-scan path and the upload-a-
barcode-image path, on both the Consumer and Officer sections. If it is not
actually implemented, or the decoding call is failing silently without being
surfaced as an error, implement or fix it properly. The correct decoded value
for the test barcode image is 8906091301250 (EAN-13 format) - use this as the
acceptance test, and do not report this as fixed without showing that this exact
barcode was successfully decoded.
```

# `============================================================ BUG 9: PDF DOWNLOAD NOT WORKING ============================================================` 

```
The PDF export is currently failing. Investigate and fix this - check the
backend PDF-generation endpoint is returning a valid file with correct response
headers, check whether the download button is correctly calling that endpoint
(including whether authentication/session handling changed recently in a way
that could be blocking it, especially for a Guest session), and check the
browser's network/console output for the actual error rather than guessing.
Confirm a real download succeeds and the resulting file opens correctly, for
both a guest session and a signed-in officer session.
```

# `============================================================ REQUIRED VERIFICATION BEFORE REPORTING ANY OF THIS AS FIXED ============================================================` 

```
Re-scan the same three Alpha Creatine photos after each fix and show the actual
before-and-after output for every field listed in the test fixture at the top of
this prompt, plus confirm the barcode test image now correctly decodes to
8906091301250, plus confirm a PDF successfully downloads and opens. A claim that
something is "fixed" without this side-by-side evidence is not sufficient this
round - the previous fix pass reported several of these exact issues as
resolved, and they were not, so this round needs to be demonstrated, not just
stated.
```

```
============================================================
DEFINITION OF DONE
```

```
============================================================
```

```
1. Re-scanning the three Alpha Creatine photos produces correct values for
brand, product name, net quantity, serving size, MRP, unit sale price,
manufacturer, marketer, and consumer care email, matching the ground truth
listed above.
```

`2. A field flagged as a genuine cross-photo conflict no longer gets silently resolved into a single value used elsewhere in the same report, and any rule depending on it is marked REVIEW rather than PASS.` 

`3. The report no longer contains internal contradictions between its declarations panel and its rule-findings reasoning text.` 

`4. The test barcode image correctly decodes to 8906091301250, confirmed on both the live-scan and image-upload paths, for both sections.` 

`5. PDF download works correctly and produces an openable file, for both guest and signed-in sessions.` 

`6. All of the above is demonstrated with actual before/after output, not just reported as complete.` 

