DRISHTISCAN - CRITICAL OCR FIX AND FULL PROJECT AUDIT

(Scan-Isolation Regression, Field-Misplacement Bug, Architecture Boundary Restoration, Full Functional and Security Audit)

HOW TO USE THIS: this is a critical fix plus a comprehensive audit of the entire application as it currently stands. Do not treat this as adding new features - the goal is to make everything already built actually correct, reliable, and secure. Work through the priorities in order. For every single item below, report back explicitly whether it was already working, was broken and got fixed, or could not be fully verified - a silent "done" is not acceptable for this pass. This is going to be independently re-verified afterward, so accuracy of your own reporting matters as much as the fixes themselves.

\============================================================

PRIORITY 1 (URGENT): FIX THE SCAN-CONTAMINATION AND FIELD-MISPLACEMENT REGRESSION

\============================================================

Confirmed symptoms, reproduced by the project owner:

1. Scanning a multivitamin label, then immediately scanning a completely different product (a milk pouch label), produced results still showing the multivitamin's data - the previous scan's information leaked into the new scan.
1. Separately, on a flat, clearly legible, easy-to-read label (deliberately chosen to rule out image-quality problems - this was not a curved or glare-affected surface), a value like "500 ml" appeared under productName instead of the actual product name, while the actual quantity was legible and should have been easy to extract correctly.

Both of these were tested and confirmed to occur, and both appeared after the change where PaddleOCR was scoped down to only extract raw text and Gemini was given responsibility for structuring that raw text into fields. Treat this as the primary suspect.

Required investigation and fixes:

1. Audit every place Gemini is called in the OCR/extraction pipeline. Confirm whether any chat session, conversation object, message history, or client instance is being created once and reused across multiple requests/scans, rather than being created fresh for every single scan with no memory of any previous call. If any such reuse exists, this is almost certainly the cause of symptom 1, and it must be fixed so that every scan's Gemini call is fully independent and stateless, with zero carryover from any prior request.
1. Audit for any global or module-level mutable variable (for example, "current extracted data," "last scan result," a shared object reused between requests) anywhere in the backend that could hold state between one request and the next. Node.js keeps a single running process, so any state stored outside of a request's own local scope can leak between requests even without real concurrency. Fix any such case so all scan data lives only within that single request's own scope.
1. Enforce strict schema validation on Gemini's structuring output before it is used anywhere. Define the exact expected shape (the same Extracted Fields JSON structure already established: productName, netQuantity as its own object with value and unit, MRP, dates, manufacturer, consumerCare, and so on) and validate every response against it. If a response doesn't match - wrong keys, wrong types, a value in the wrong field - reject that response entirely rather than using any part of it, and fall back to marking the affected fields as not detected rather than risking a misplaced value like quantity appearing under product name.
1. Re-run the exact scenario described: scan a multivitamin label, then immediately scan a milk pouch label (or an equivalent pair of clearly different products), and confirm the second scan's result contains zero trace of the first scan's data. Then separately confirm the flat, easy-to-read label test the project owner already performed now correctly extracts each value into its correct field. Both of these must pass before moving to Priority 2.
1. Add these two exact scenarios as permanent, automated regression tests, since this specific bug class has now recurred once already. Any future change to the OCR/extraction/structuring pipeline should be checked against these tests before being considered complete.

\============================================================

PRIORITY 2: RESTORE AND CONFIRM THE INTENDED OCR/GEMINI BOUNDARY

\============================================================

The original design intent, established earlier in this project, was:

- PaddleOCR plus positional/spatial matching (matching a value to its nearest label by physical position on the image) is the default, primary path for extracting every field, on every scan.
- Gemini is used only for two narrow, specific tasks downstream of that: reconciling values across multiple photos of the same product when they disagree, and a fallback re-read only for a specific field that the primary extraction genuinely could not confidently determine - and any value that came from this fallback must be clearly labeled to the user as "Couldn't be read clearly from the photo -- please double-check this value," never presented as equivalent to a normal confidently-extracted value.

Audit the current implementation and report explicitly: is Gemini currently being used to structure every field on every scan by default, rather than only stepping in for the two narrow cases above? If so, this is a deviation from the intended design and is very likely the root cause of Priority 1's bugs, not just an unrelated side issue. Correct this so that positional/spatial PaddleOCR-based extraction is attempted first, for every field, on every scan, and Gemini is only invoked for the two specific narrow cases - reconciliation across disagreeing multi-photo values, and fallback for a field the primary path could not determine at all, with the required user-facing label applied in that second case only.

\============================================================

PRIORITY 3: ADDITIONAL ACCURACY AND RELIABILITY UPGRADES

\============================================================

Beyond fixing the specific bug, these are worth adding now given how central OCR accuracy is to this project:

1. Give every scan a unique scan ID at the moment it starts, and attach that ID to every log line produced while processing it - the raw OCR output, the structuring input and output, the reconciliation step if it ran, and the final decision. This makes it possible to trace exactly what happened for one specific scan if something looks wrong in the future, instead of guessing.
1. Build a small "golden set" of real test label photos - a handful covering a flat easy label, a curved/glossy label, a dense small-text label, and at least two clearly different products photographed in immediate succession (to continuously guard against the exact contamination bug from Priority 1). Run this set automatically whenever the OCR/extraction/structuring code changes, and report pass/fail per image, so a regression like this one is caught before it reaches manual testing.
1. Make the confidence threshold that decides "this field needs the Gemini fallback" an explicit, single, named, configurable value rather than something implicit or scattered across the code - and log, per field, which path (primary extraction vs. fallback) actually produced its final value.

\============================================================

PRIORITY 4: FULL FUNCTIONAL AUDIT

\============================================================

Go through every area below. For each, confirm it works correctly end to end, fix anything that doesn't, and report the result.

Authentication (Officer/Admin):

- Sign up, log in, and log out all work correctly, and logging out actually ends that session rather than leaving a token that still works afterward.
- Forgot password: requesting a reset sends a one-time code by email, the code correctly expires after its set time, a correct code lets the password be reset, and the officer can then log in with the new password immediately afterward. Confirm an incorrect or expired code is correctly rejected, and that a code cannot be reused after it has already been used once.
- Guest mode is blocked from saving to the repository and from viewing the dashboard at the server/API level, not only hidden in the interface - attempt to call those endpoints directly as a guest and confirm they are refused.

Repository management:

- The save checkbox correctly results in a saved record when ticked and correctly results in nothing being saved when unticked or when the user is a guest.
- An officer sees only their own saved inspections; an admin sees everyone's - confirm this is enforced by the server, not just by what the interface chooses to display.
- Search and filtering (by product name, date range, and compliance status) return correct results.
- Deleting a saved inspection removes both its database record and its photos from Cloudinary - confirm no orphaned images are left behind afterward.
- Opening a saved inspection's detail view correctly shows its full original data and photos again.

Enforcement Dashboard:

- Total inspections, compliant/non-compliant counts, and the most-common-violations list all match what is actually in the saved data - spot-check the numbers against the underlying records rather than trusting the display.
- The trend view reflects real data over time.
- Scoping is correct: an officer sees only their own statistics, an admin can see across everyone.

Consumer section:

- Confirm the result screen still shows information in the originally specified order: the compliance one-line status first, then manufacture/expiry dates, then MRP, then any personal-preference warnings, then other product information (ingredients, nutrition, usage) last. Report explicitly if this order has drifted during other changes.
- Confirm every consumer preference category and option (Dietary Type, Allergies and Intolerances, Health Goals, Other) is present, correctly grouped, and correctly matched against a scan's results.
- Confirm consumer preferences are still stored only in the browser and are never sent to or stored on the server - this is a privacy commitment made earlier and should be re-verified, not assumed.

Rule matching engine:

- This needs to be tested for catching real violations, not just for extracting data correctly. Test with at least one label that is deliberately missing a required declaration (for example, no visible MRP, or no manufacture date) and confirm the corresponding rule correctly reports NON\_COMPLIANT or POTENTIAL\_NON\_COMPLIANCE rather than incorrectly passing.
- Confirm NOT\_APPLICABLE is correctly used for rules that genuinely don't apply to a given product/package type, rather than every rule being forced to apply universally.
- Re-confirm the two core safety principles established earlier still hold everywhere: the system never invents a value it didn't actually detect, and an unreadable or missing piece of evidence never results in a PASS - it should produce REVIEW or INSUFFICIENT\_EVIDENCE instead.

Reports:

- PDF and DOCX export both still work, both stay to a reasonable page length rather than regressing back toward dozens of pages, and any AI-assisted-fallback field is still clearly labeled in both formats with the plain-language wording already established, not technical wording.

Barcode scanning:

- Confirm barcode scanning actually works end to end, for both the Consumer and Officer sections - both scanning live via the device camera and uploading a barcode image. Do not assume it works because a button exists for it; actually test it. If it was never fully wired up to a working barcode-reading library, or is broken, or is currently just a non-functional placeholder button, implement or fix it properly rather than leaving it half-done.
- On the Consumer side, confirm a successfully decoded barcode correctly triggers the external product-data lookup described earlier in the project, and that the result is shown to the shopper.
- On the Officer side, confirm the barcode image itself is correctly captured, and, if that scan is saved to the repository, is correctly uploaded to Cloudinary and stored tagged as "barcode\_image" alongside the product photos, exactly as already specified.
- Report explicitly whether barcode scanning was already working, was broken and got fixed, or was never actually implemented and has now been built.

\============================================================

PRIORITY 5: SECURITY AND EXPOSURE AUDIT

\============================================================

Go through each of these explicitly and report the result:

1. No API keys, database connection strings, or other secrets exist anywhere in the frontend code or bundle, or hardcoded anywhere in the backend source - all of them come from environment variables only.
1. Every officer- or admin-only API route independently verifies the request's authentication token and role on the server before doing anything - do not rely on the frontend simply not showing a button as the only protection.
1. Passwords are hashed with a proper algorithm (bcrypt or equivalent) with a reasonable cost factor, are never logged anywhere, and are never included in any API response, including error responses.
1. The password-reset one-time code is a genuinely hard-to-guess value, expires after its set window, can only be used once, and the endpoint that accepts a code is rate-limited so it can't be brute-forced by rapid guessing.
1. Login and signup endpoints are rate-limited to reduce automated abuse.
1. Any file upload (photos, barcode images) is validated as actually being an image and is limited to a reasonable file size before being accepted or forwarded to OCR or Cloudinary.
1. Error responses sent to the client never include internal details like stack traces, raw database errors, or file paths.
1. Cross-origin request settings (CORS) are limited to the actual frontend's address rather than left open to any origin.

\============================================================

REQUIRED OUTPUT: AUDIT REPORT

\============================================================

Produce a written report alongside the code changes, organized by the priority sections above, stating for each specific item: already working correctly (no change made), was broken and has been fixed (briefly describe the actual cause and the fix), or could not be fully verified (explain why, and what would be needed to verify it). This report is what will be used for independent re-verification afterward, so it needs to be accurate and specific rather than a general "everything looks good."

\============================================================

DEFINITION OF DONE

\============================================================

1. The exact contamination scenario (multivitamin label followed immediately by a different product's label) no longer shows any leakage between the two results, and this is now covered by a permanent automated test.
1. The exact field-misplacement scenario (a value landing under the wrong field name on an easy, flat, clearly legible label) no longer occurs, and Gemini's structuring output is now validated against a strict schema before being trusted anywhere.
1. It has been explicitly confirmed and reported whether Gemini had taken over structuring every field by default, and if so, this has been corrected so PaddleOCR plus positional matching is the default path, with Gemini reserved only for multi-photo reconciliation and labeled low-confidence fallback.
1. Every item in the Priority 4 functional audit has been checked, with a clear working/fixed/could-not-verify result reported for each.
1. Every item in the Priority 5 security audit has been checked, with the same clear reporting.
1. Barcode scanning has been actually tested (not assumed) for both sections, and is confirmed working, fixed, or newly built if it was missing.
1. A scan-ID-based logging trail and a golden regression test set now exist to catch a similar bug earlier if it happens again.
1. The full written audit report has been produced alongside the code changes.
