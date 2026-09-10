```
DRISHTISCAN - PDF DOWNLOAD FIX AND BARCODE SCANNING IMPLEMENTATION
(Focused Retry - Isolated From Every Other Bug)
```

```
HOW TO USE THIS: the previous round covered nine issues at once (Bug Evidence
Master Prompt). After running that pass, two of those nine are still broken:
PDF download and barcode scanning. This prompt pulls just those two out on
their own so they get full attention and can be verified precisely, instead of
competing for attention with seven other fixes. Do not touch anything outside
these two features. Do not report either one as fixed without the exact
evidence demanded at the end - both were already reported as being worked on
once before and remained broken.
```

```
============================================================
HARD CONSTRAINTS
============================================================
```

```
1. Only touch what PDF export and barcode scanning actually require. Do not
modify the OCR/extraction pipeline, the compliance rule engine, or any of the
field-classification logic from the earlier bug list (product name, net
quantity, serving size, MRP, manufacturer/marketer detection, etc.).
```

```
2. Do not change approved UI styling, colors, or animations, or any copy text
unrelated to these two features.
```

```
3. Fix PDF download first and confirm it works before starting on barcode
scanning. Do not work on both at once.
```

```
4. For barcode scanning, wire in a real, installable, open-source JavaScript
decoding library and call it for real. Do not simulate, mock, or hardcode a
detection result.
```

```
============================================================
FIX 1: PDF DOWNLOAD (STILL BROKEN AFTER THE PREVIOUS FIX ATTEMPT)
============================================================
```

```
Diagnose before writing new code, and report what was actually found at each
step rather than guessing:
```

```
a. Hit the backend PDF-generation endpoint directly (curl or Postman, bypassing
the frontend). Confirm it returns HTTP 200 with a genuine PDF byte stream and
the correct headers - Content-Type: application/pdf and a Content-Disposition
header with a filename.
```

```
b. Check the server logs for that request. If whatever renders the PDF (a
headless-browser renderer, an HTML-to-PDF step, or a PDF-building library) is
throwing an exception, it may be failing silently and sending back an empty
file or a JSON error body dressed up with a 200 status - confirm which one is
actually happening here.
```

```
c. Check the frontend download handler. Confirm it treats the response as a
blob (not JSON), correctly builds a download link/object URL from it, and
actually surfaces an error to the user if the request fails instead of doing
nothing.
```

```
d. Check whether auth/session middleware on the download route is rejecting
the request specifically for a Guest session. Test as both a Guest and a
signed-in Officer - these may be failing for different reasons.
```

```
e. Open the browser DevTools Network tab while clicking Download and record
the actual HTTP status code and response body. Fix based on what that shows,
not on assumption.
```

```
============================================================
FIX 2: BARCODE SCANNING (NOTHING IS EVER DETECTED)
============================================================
```

```
First confirm directly whether any real barcode-decoding library is wired into
the code at all right now, for both the live-camera path and the upload-an-
image path, in both the Consumer and Officer sections. A clean, sharp,
well-lit barcode image producing zero detections is a strong sign nothing real
is connected yet - treat it as a missing feature, not an image-quality problem,
unless the diagnosis proves otherwise.
```

```
Implement decoding using @zxing/browser (built on the open-source, MIT-
licensed ZXing project). Reasons to use this one specifically:
```

```
- Free and open source, no API key, runs entirely client-side in the browser -
fits a no-budget build with no ongoing service cost.
- One consistent API covers both paths this project needs: decoding an already-
uploaded image (decodeFromImageUrl / decodeFromImageElement) and decoding
continuously from a live camera stream (decodeFromVideoDevice).
- Supports EAN-13 (the format this project's test barcode uses) plus UPC-A,
Code128, QR, and most other common formats, so it also handles other barcode
types if a different product is scanned later.
- Pure JavaScript, no native/system library to install - avoids repeating the
kind of environment setup friction already hit getting PaddleOCR/paddlepaddle
running under WSL.
```

```
Install:
    npm install @zxing/browser
```

```
Wire it into every barcode entry point: the Consumer scanner's barcode
capture, the Officer section's "Barcode Image Evidence" upload box, and any
live-camera barcode control in either section. These likely share one
underlying component - check whether a single shared decode utility/hook can
serve all of them, the same way the OCR flow already does for label scanning.
```

```
Fallback only if needed: if @zxing/browser genuinely underperforms in testing
on real, slightly imperfect retail photos, @ericblade/quagga2 is a free, open-
source alternative that specializes in 1D retail barcodes (EAN/UPC/Code128)
and sometimes handles rough real-world photos better. Only switch to it after
actually testing @zxing/browser first - do not wire in both.
```

```
Make sure a failed decode shows a clear "barcode not recognized - try again"
state to the user, rather than doing nothing and looking identical to a
feature that was never built. That silence is likely part of why this was
mistaken for a hard-to-read-image problem before.
```

```
Acceptance test: use the same clean barcode image already captured in the
previous testing round. It must decode to exactly 8906091301250 (EAN-13) on
both the live-scan path and the upload path, in both the Consumer and Officer
sections.
```

```
============================================================
REQUIRED VERIFICATION BEFORE REPORTING EITHER OF THESE AS FIXED
============================================================
```

```
For PDF: show an actual successful download - file name, and confirmation it
opens and displays the report content correctly - for both a Guest session and
a signed-in Officer session.
```

```
For barcode: show the exact decoded value returned for the test image (must
read 8906091301250) on both the live-scan and upload paths, in both sections.
```

```
A claim of "fixed" without this specific evidence is not sufficient - both of
these were already reported as being addressed once before and were not.
```

```
============================================================
DEFINITION OF DONE
============================================================
```

```
1. PDF report downloads successfully and opens correctly, confirmed for both
Guest and Officer sessions.
```

```
2. Barcode scanning runs on a real decoding library (@zxing/browser, or
@ericblade/quagga2 only if substituted after genuine testing), wired into both
the live-camera and image-upload paths, in both the Consumer and Officer
sections.
```

```
3. The known test barcode (8906091301250, EAN-13) decodes correctly on every
path above.
```

```
4. No other bug, styling choice, or extraction/rule-engine logic from earlier
rounds was touched in the process.
```

```
5. All of the above is demonstrated with actual before/after evidence, not
just stated as complete.
```
