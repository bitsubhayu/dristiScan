# DrishtiScan -- Antigravity Master Prompts (All Phases)

This file collects all four build prompts given to Antigravity so far, in the exact wording used each time, kept inside plain-text blocks so nothing gets reformatted or reflowed. Each phase assumes every prior phase is already built and working. Give them to Antigravity **one phase at a time, in order** -- do not ask it to do all four phases in a single pass.

## Contents

- [Phase 1 -- Core Build: MERN Skeleton, PaddleOCR Integration, Rule Engine, No Login, No Storage](#phase-1)
- [Phase 2 -- Authentication, Product/Inspection Repository, Enforcement Dashboard, Editable (DOCX) Export](#phase-2)
- [Phase 3 -- Multi-Photo Capture, Barcode Scan Input, Expanded Consumer Preferences, Navigation Fixes, Shorter PDF Reports](#phase-3)
- [Phase 4 -- Agent Skills Setup, Professional Animated Frontend, Mobile Compatibility, Branding Update](#phase-4)

---

## Phase 1 -- Core Build: MERN Skeleton, PaddleOCR Integration, Rule Engine, No Login, No Storage

```text
DRISHTISCAN - MASTER BUILD PROMPT FOR ANTIGRAVITY

HOW TO USE THIS: paste this entire text as your instruction to Antigravity. It is written directly to you, the coding agent, and assumes you can read/write files and run shell commands inside the Antigravity_Workspace folder.

============================================================
ROLE AND CONTEXT
============================================================

You are building DrishtiScan, a web application that scans packaged-commodity labels and images and checks them for compliance with the Legal Metrology (Packaged Commodities) Rules, 2011 - the Indian regulation covering mandatory package declarations such as MRP, net quantity, manufacturer details, dates, and consumer-care information. This is being built for SIH26034, a Smart India Hackathon problem statement from the Department of Consumer Affairs.

There are two sections in the app, and neither requires login:
- Officer section: full rule-by-rule compliance report, an optional listing-vs-package mismatch check, PDF and DOCX export.
- Consumer section: a fast plain-language read - compliance one-liner, key dates and price, personal-preference warnings, general product info.

Stack: MERN (MongoDB, Express, React, Node.js) plus a Python microservice running PaddleOCR for OCR. The OCR microservice already exists and works - see the next section.

============================================================
WHAT ALREADY EXISTS - DO NOT REBUILD THIS
============================================================

A working OCR proof-of-concept already exists in the workspace (ocr-service, backend, and frontend folders under Antigravity_Workspace). It has been tested end-to-end with good results (97.1 percent average confidence on a nutrition label test image, 29 detected regions, about 10 seconds processing time on CPU). Preserve this working configuration. Do not re-architect or downgrade it.

Confirmed working setup:
- OCR engine: PaddleOCR, model PP-OCRv6 Medium, device CPU.
- Pinned versions: paddlepaddle==3.3.1, paddleocr==3.7.0.
- Known bug workaround, keep this: PaddleOCR must be initialized with enable_mkldnn=False to avoid a OneDNN/PIR fatal bug seen in WSL. Do not remove this flag.
- API usage, keep this: the code uses the current predict() method. Do not revert to the deprecated ocr(img, cls=True) call - PaddleOCR 3.x changed its prediction API and returns a different dictionary-based structure, so JSON parsing logic must match predict()'s output shape, not the old API's.
- Memory profile: about 750 to 815 MB during inference - this is normal, not a leak.
- Run mode: "Hybrid Windows/WSL" per the existing README. Confirm which parts run where before changing any scripts such as run_all.ps1, and preserve that split unless told otherwise.
- The frontend test page runs on localhost:5173, the backend/OCR service on localhost:8000, and CORS is already configured between them.

Your job is to build the real application around this proof-of-concept, not to replace the OCR layer.

============================================================
HARD CONSTRAINTS - READ BEFORE DOING ANYTHING ELSE
============================================================

1. No authentication and no login, for anyone. Not consumers, not officers. The Officer versus Consumer split is a plain UI or route choice ("I'm a Consumer" or "I'm a Food Safety Officer"), not a security boundary. Do not add password fields, JWT, sessions tied to identity, or user accounts.

2. No server-side persistence of scan or report data. MongoDB is used for exactly one thing: the Legal Metrology rules dataset. Do not create products, reports, users, or history collections. Uploaded images are processed in memory or temp storage per request and discarded immediately after the response is sent.

3. The listing-vs-package mismatch check is optional and officer-triggered per scan, not automatic.

4. The frontend must stay simple for this pass. Plain, workable UI, basic forms, basic styling. No animation libraries, no elaborate theming, no design-system work yet. That is a deliberately later phase.

5. All comparison logic is JSON versus JSON: the OCR and extraction pipeline outputs structured JSON for a scanned product, and that JSON is compared field by field against rule documents, also JSON, stored in MongoDB, to produce the compliance verdicts. See the Data Schemas section below for exact shapes.

6. Keep the OCR microservice as its own separate Python process or service. Do not try to port PaddleOCR into Node.

============================================================
TARGET FOLDER STRUCTURE
============================================================

Currently backend, frontend, ocr-service, python311, python311.zip, README.md, and run_all.ps1 sit directly under Antigravity_Workspace. Reorganize into a dedicated project folder named DrishtiScan, like this:

Antigravity_Workspace
  DrishtiScan
    frontend
      src
        pages
          consumer      (Consumer section screens)
          officer       (Officer section screens)
        components      (shared UI pieces: upload box, result card, etc.)
        hooks
        utils           (localStorage / sessionStorage helpers)
        assets
      package.json
      .env.example
    backend
      src
        routes          (express route definitions)
        controllers     (request handlers)
        services
          ocrClient.js       (calls the Python OCR microservice)
          extraction.js      (OCR text to structured field JSON)
          ruleEngine.js      (field JSON vs Mongo rules to findings)
          mismatchCheck.js   (listing-vs-package logic)
          reportBuilder.js   (PDF and DOCX generation)
        models
          Rule.js        (Mongoose schema for the rules collection)
        config
          db.js          (Mongo connection via Mongoose)
        app.js
      package.json
      .env.example
    ocr-service         (move as-is from current location, keep working)
    rules-data
      seed-rules.json   (example/placeholder rule documents, see Data Schemas)
    docs                (design docs, this prompt, architecture notes)
    python311           (move here too, or exclude from version control if it is just a bundled runtime)
    run_all.ps1         (update relative paths after the move)
    .gitignore
    README.md

Action: move the existing backend, frontend, ocr-service, python311, README.md, and run_all.ps1 folders into the new DrishtiScan folder, preserving their internal contents. After moving, update any relative paths in run_all.ps1, .env files, and README instructions that assumed the old location. Add rules-data and docs as new folders. If python311.zip is just an archived copy of the runtime already unpacked into python311, leave it out of the new structure or move it into docs as an archive - do not duplicate a large binary unnecessarily.

============================================================
BUILD PLAN - DO THESE IN ORDER
============================================================

STEP 0 - Reorganize the workspace.
Follow the folder structure above. Verify the OCR proof-of-concept still runs correctly from its new location before moving on - re-run the existing test page and confirm it still returns results.

STEP 1 - Backend scaffold.
Set up an Express app in backend/src/app.js. Add a Mongoose connection using a MONGODB_URI value from .env, using a placeholder for now since real credentials come later. Create a Rule model matching the schema below. Write a seed script that loads rules-data/seed-rules.json into MongoDB for local development.

STEP 2 - Wire up OCR.
In services/ocrClient.js, call the existing Python OCR microservice's endpoint, send it an image, and receive back raw OCR text plus bounding boxes and confidence per region. Reuse whatever contract the proof-of-concept already returns rather than changing it unless necessary.

STEP 3 - Extraction, turning OCR text into structured JSON.
In services/extraction.js, take the raw OCR output and produce the Extracted Fields JSON described below, using regex and rule-based parsing for dates, currency amounts, and units. Keep this rule-based for now - no machine learning model is needed for field parsing at this stage.

STEP 4 - Rule engine.
In services/ruleEngine.js, given the Extracted Fields JSON, query MongoDB for applicable Rule documents, filtered by category and by effectiveFrom/effectiveTo covering today's date. Compare field by field and produce the Findings JSON described below, with a status of PASS, POTENTIAL_NON_COMPLIANCE, or NOT_APPLICABLE per field, a confidence score, and a short reason.

STEP 5 - Optional mismatch check.
In services/mismatchCheck.js, accept the extracted fields plus a listed MRP, listed quantity, and listed country of origin. Compare each against the corresponding extracted value and return a mismatch findings block. If this step is not invoked for a scan, the report should show that section as "Not performed."

STEP 6 - Report generation.
In services/reportBuilder.js, take a completed Findings JSON, plus the optional mismatch block if present, and render both a PDF (for example via Puppeteer, rendering HTML to PDF) and a DOCX (via the docx npm package). Since nothing is stored server-side, this should work as a stateless render: the frontend sends the report JSON it already has back to this endpoint and gets a file back.

STEP 7 - Frontend, Consumer section.
Build simple, plain screens: a capture screen (upload image, multi-image, or a manual barcode number entry for now), an optional preferences form for allergy or diet tags saved only to localStorage and never sent to the backend as identity-linked data, and a result screen in this exact order - compliance one-liner, then MFG and expiry dates, then MRP, then preference warnings computed client-side against extracted ingredient data, then other product info.

STEP 8 - Frontend, Officer section.
Build simple, plain screens: a capture screen where the full rule set always runs, then after results return, a toggle or button asking "Run listing-vs-package mismatch check?" - if yes, show a small form for listed MRP, quantity, and origin, call the mismatch endpoint, and merge the result into the same report view. Add a report view showing the full findings table plus the mismatch section or "Not performed," with buttons to export PDF and DOCX. Also add a simple session log: keep an array in sessionStorage of every report generated in the current session (product name, timestamp, and overall status is enough), rendered as a list with basic search and filter by text. This resets when the browser session ends - that is intended, not a bug.

STEP 9 - Testing.
Do a manual end-to-end test: image goes in, JSON gets extracted, rules get fetched from Mongo, findings get produced, a report gets rendered, and a PDF/DOCX becomes downloadable. Test with at least one clearly compliant and one clearly non-compliant seeded rule to confirm both verdict paths render correctly.

============================================================
API CONTRACT (NODE/EXPRESS)
============================================================

- POST /api/consumer/scan - accepts multipart image(s), returns extracted fields plus a consumer-facing summary. Stateless.
- POST /api/officer/scan - accepts multipart image(s), returns the full Findings JSON. Stateless.
- POST /api/officer/mismatch-check - accepts extracted fields plus listing MRP/quantity/origin, returns mismatch findings.
- POST /api/officer/report/pdf - accepts a full report JSON, returns a PDF file.
- POST /api/officer/report/docx - accepts a full report JSON, returns a DOCX file.
- GET /api/rules - internal/development use only, lists current rule documents for debugging and seed verification.

No endpoint reads or writes anything except the Rule collection.

============================================================
DATA FLOW YOU ARE IMPLEMENTING
============================================================

Image(s) go to the OCR microservice (PaddleOCR), which returns raw text, bounding boxes, and confidence scores. That goes to the Extraction service, which produces the Extracted Fields JSON. That goes to the Rule Engine, which fetches applicable Rule documents from MongoDB and does a field-by-field comparison, producing the Findings JSON with a verdict, confidence, and reason per field. If requested, the Mismatch Check runs and its result is merged into the Findings JSON. Finally the Report Builder turns that into a PDF or DOCX, returned to the client. Nothing is persisted server-side at any step.

============================================================
DATA SCHEMAS
============================================================

Extracted Fields JSON (output of Step 3):
{
  "productName": "string or null",
  "manufacturer": { "name": "string or null", "address": "string or null" },
  "netQuantity": { "value": "number or null", "unit": "string or null" },
  "mrp": { "value": "number or null", "currency": "INR", "inclusiveOfTaxes": "boolean or null" },
  "dates": { "manufacture": "string or null", "expiry": "string or null", "bestBefore": "string or null" },
  "consumerCare": { "name": "string or null", "address": "string or null", "phone": "string or null", "email": "string or null" },
  "countryOfOrigin": "string or null",
  "unitSalePrice": "string or null",
  "dimensions": "string or null",
  "rawOcrText": [ { "text": "string", "confidence": 0.0, "bbox": [0,0,0,0] } ]
}

Rule document, MongoDB "rules" collection:
{
  "ruleCode": "LM-NETQTY-001",
  "field": "netQuantity",
  "category": "packaged_food_general",
  "description": "Plain-language description of what this rule checks",
  "validation": { "type": "presence, format, range, or crossField", "params": {} },
  "effectiveFrom": "2011-01-01",
  "effectiveTo": null,
  "sourceReference": "Legal Metrology (Packaged Commodities) Rules, 2011 - VERIFY exact sub-rule before production use",
  "severity": "high, medium, or low"
}

Findings JSON, the final report body:
{
  "scanTimestamp": "ISO-8601 string",
  "overallStatus": "PASS, POTENTIAL_NON_COMPLIANCE, or NEEDS_REVIEW",
  "findings": [
    {
      "ruleCode": "LM-NETQTY-001",
      "field": "netQuantity",
      "status": "PASS, POTENTIAL_NON_COMPLIANCE, or NOT_APPLICABLE",
      "confidence": 0.9,
      "extractedValue": "500 g",
      "reason": "string",
      "evidenceBbox": [0,0,0,0]
    }
  ],
  "listingMismatchCheck": {
    "performed": false,
    "mismatches": []
  }
}

rules-data/seed-rules.json should contain a handful of example rule documents in this shape, covering net quantity, MRP, manufacturer and address, dates, and consumer-care presence checks, so the rule engine has something to run against during development. Mark these as placeholders - exact rule codes and sub-rule references must be verified against the official Legal Metrology (Packaged Commodities) Rules, 2011 text before this is used for anything beyond development or demo.

============================================================
MONGODB ACCESS
============================================================

A MongoDB MCP server connection will be made available to you directly, as a development-time tool - use it to inspect collections, verify seeded rule documents, and test queries while building. This MCP access is not a runtime dependency of the application itself. The actual Express backend must connect to MongoDB using the standard Mongoose client or the native Node MongoDB driver, reading the connection string from an environment variable named MONGODB_URI. Use a placeholder or local value in .env.example until real credentials are provided.

============================================================
FRONTEND SCOPE FOR THIS PASS
============================================================

Keep it plain: basic HTML form elements and simple component styling, skipping animation libraries and design-system work. The goal right now is a working end-to-end flow, not visual design. It is fine to use minimal CSS rather than pulling in a large UI framework, to keep this step fast.

============================================================
NON-GOALS FOR THIS PASS
============================================================

Do not build any of the following yet, they are explicitly deferred:
- Login or authentication of any kind.
- Any server-side database beyond the rules collection.
- Allergen, nutrition, or dietary-personalization features.
- FSSAI banned-ingredient screening.
- Visual or animation polish, theming, food-themed branding.
- Multi-day analytics or trend dashboards.
- Barcode hardware scanning beyond a simple manual code entry, unless it is already trivial given existing libraries.

============================================================
DEFINITION OF DONE (MVP)
============================================================

1. Workspace reorganized into DrishtiScan with the structure above; existing OCR proof-of-concept still runs unmodified from its new location.
2. Backend connects to MongoDB using a placeholder URI and can read seeded Rule documents.
3. A consumer can upload an image and see a one-line compliance status, dates, MRP, and, if preferences are set, a warning - nothing is saved server-side.
4. An officer can upload an image and see the full findings table with PASS, POTENTIAL_NON_COMPLIANCE, or NOT_APPLICABLE per field.
5. The officer can optionally trigger the listing-mismatch check and see it merged into the same report.
6. The officer can export the report as PDF and as DOCX.
7. The officer's session log, browser-side only, lists every report generated in the current session and supports basic search and filter.
8. No authentication exists anywhere, and no scan or report data exists in MongoDB after a request completes - only the rules collection persists.

============================================================
IF YOU GET BLOCKED
============================================================

Surface these back to the human rather than guessing silently:
- Real MongoDB connection details - a placeholder is fine for now, but flag when the real one is needed.
- Exact Legal Metrology sub-rule references for the seed data - placeholders are acceptable for the MVP, but should be flagged as needing legal verification.
- Whether barcode scanning needs real camera-hardware integration in this pass, or whether a manual code-entry field is acceptable for now.
```

---

## Phase 2 -- Authentication, Product/Inspection Repository, Enforcement Dashboard, Editable (DOCX) Export

```text
DRISHTISCAN - PHASE 2 MASTER PROMPT FOR ANTIGRAVITY
(Authentication, Product/Inspection Repository, Enforcement Dashboard, Editable Report Export)

HOW TO USE THIS: paste this as a follow-up instruction to Antigravity, after the Phase 1 build (OCR pipeline, rule engine, PDF export, consumer and officer scan flows) is already working. This adds new capabilities on top of that existing app - it does not ask you to rebuild anything already working.

============================================================
WHAT CHANGES FROM THE PREVIOUS PASS
============================================================

The earlier build was told: no login for anyone, and no server-side persistence of scan data. Those two rules are now partially superseded:

- Officers and admins now log in. Consumers still never log in - that part is unchanged.
- Scans can now be saved to a real, persistent Product/Inspection Repository, but only when the officer explicitly opts in via a checkbox, and only on the Officer side. Anything not opted into saving stays exactly as ephemeral as before.
- Everything already built in Phase 1 - the OCR microservice, the extraction pipeline, the rule engine, the Findings JSON shape, the Rules collection in MongoDB, the consumer flow, and PDF export - stays as-is. This phase adds to it, it does not replace it.

============================================================
HARD CONSTRAINTS FOR THIS PHASE
============================================================

1. There are exactly two authenticated account roles: officer and admin. There is no third account role. "Other users" in the original problem statement refers to normal consumers, who never log in and are not part of this authentication system at all - they remain the anonymous, no-login public side of the app.
2. Anyone using the Officer section without being logged in is a guest, by definition. There is no separate "logged out but not guest" state - not logging in and choosing guest mode are the same thing.
3. Officer signup is fully self-service. No admin approval step is required before a new officer account can log in and use the tool.
4. Guests cannot save to the repository and cannot access the dashboard, since neither makes sense without a persistent account. If a guest is logged in, hide or disable the save checkbox and route any dashboard link to a "sign in to see this" prompt.
5. Saving a scan to the repository is opt-in, not automatic. The save checkbox defaults to checked (ticked) on the officer's scan results screen, but the officer can untick it before the report is finalized to skip saving that one.
6. Use a second, separate MongoDB database for all of this new operational data (users and inspections - structured data only). Keep the existing Rules database exactly as it is - do not mix rule definitions with user or inspection data.
7. Never store image files inside MongoDB. MongoDB (a 512 MB free-tier cluster) holds structured JSON only. Actual photo files go to a dedicated media storage service - see Feature 3 below - and MongoDB stores only the resulting URL.
8. Passwords must be hashed (bcrypt or equivalent) - never store or log plain-text passwords.
9. The password reset flow uses a one-time numeric code emailed to the user (an OTP), not a reset link.

============================================================
FEATURE 1: EDITABLE REPORT EXPORT (DOCX)
============================================================

PDF export already works. The missing piece is the editable format. Implement DOCX generation using the same report data (the Findings JSON, plus product details and evidence) that already feeds the PDF.

- Add a function in the existing report-building service that takes the same report JSON already used for PDF and produces a DOCX file using the "docx" npm package.
- The DOCX must be a real editable Word document - use actual Word headings, paragraphs, and tables for the findings list, not an image of the report. An officer should be able to open it in Word and edit the text directly.
- Include the same content the PDF has: product details, the list of violations, the specific rules cited for each, evidence photos embedded as inline images, and the final overall result.
- Wire this up to the existing "editable format" export button or add one if it does not exist yet, calling a new endpoint (see API Contract below) that returns the DOCX file for download, the same way the PDF download already works.

============================================================
FEATURE 2: AUTHENTICATION AND ROLES
============================================================

Build this before Repository and Dashboard, since both depend on knowing who is logged in.

Roles: admin and officer are the only two account types. Guest is not an account - it is a temporary session for someone who has not logged in.
- Admin: full access, plus management of officer accounts, plus a dashboard view across all officers' data.
- Officer: full use of the scanning and reporting tool, can save to their own repository, sees their own dashboard.
- Guest: full use of the scanning and reporting tool, cannot save to the repository, cannot see the dashboard. No account is created for a guest - issue a temporary, short-lived session instead.

Officer signup: name, email, password. No approval step - the account is active immediately. Store the password as a bcrypt hash. Email must be unique.

Officer/admin login: email and password, returns an authenticated session (a JWT is fine - store it in an httpOnly cookie, and include the user's role in the token so route access can be checked without an extra database lookup on every request).

Guest login: a "Continue as Guest" option with no fields to fill in. Issue a short-lived session with role set to guest and no database record created.

Password reset via email OTP:
1. User requests a reset by entering their email.
2. Generate a random numeric one-time code, store a hash of it against that user's account along with an expiry (10 minutes is reasonable), and email the plain code to the user.
3. User submits the email, the code, and a new password.
4. Verify the code matches and has not expired, then update the password hash and clear the stored code.
5. For sending the email itself, use Nodemailer with SMTP settings from environment variables. For local development, a throwaway SMTP catcher such as Ethereal or Mailtrap is fine - note in the README that production needs real SMTP credentials.

Route protection: add middleware that checks the session/JWT and the role, and apply it to every repository and dashboard route. Anything under the officer or admin area should reject unauthenticated requests and reject guests specifically from the save-to-repository and dashboard routes.

============================================================
FEATURE 3: PRODUCT/INSPECTION REPOSITORY
============================================================

Use the second MongoDB database mentioned above, in a collection for inspections - structured data only, as noted in the hard constraints.

Where to store the actual image files:
Use Cloudinary for the photo files themselves (product photos and barcode images). Upload each image via Cloudinary's Node SDK when an inspection is saved, and store only the returned secure URL (plus a type label) in the MongoDB inspection document. Do not store image bytes, and do not use MongoDB GridFS - both would count against the same limited database storage this design is specifically avoiding. Read the Cloudinary credentials from environment variables (see Environment Variables below). If Cloudinary is not reachable in a given environment, fall back to saving the file to a local "/uploads/evidence/" folder on disk and store that relative path instead - but treat this as a development-only fallback, since a typical free-tier hosting platform wipes its local disk on every restart or redeploy.

When an officer or admin (not a guest) finishes a scan and the "save to repository" checkbox is ticked, store a record containing:
- who saved it (the officer's id and name)
- when the scan happened
- the product name
- the full extracted fields JSON from that scan
- the full findings JSON (the same verdict data used in the report)
- the overall status (pass, potential non-compliance, or needs review)
- the listing mismatch check result, if it was run
- every image involved in that scan: the product photo(s) that were uploaded, and, if a barcode scan was used as the input method, an image of the barcode itself as well - not just the decoded barcode value. Tag each stored image with what it is (for example "product_photo" or "barcode_image") so the report and the repository detail view can label them correctly.

Repository features to build:
- A list/search view: search by product name, date range, and compliance status. An officer sees only their own saved inspections; an admin sees everyone's.
- A detail view: opening a saved inspection shows the full report again, including all of its images, with the option to re-export it as PDF or DOCX.
- A delete option: an officer can remove their own saved record if they change their mind later (an admin can remove any record). Deleting a record should also delete its images from Cloudinary, not just the database entry.

============================================================
FEATURE 4: ENFORCEMENT DASHBOARD
============================================================

Requires login (officer or admin). Build a dashboard page showing, scoped to the logged-in officer's own saved inspections (or, for an admin, across all officers unless the admin filters to one):

- Total inspections saved
- Count of compliant vs non-compliant products (based on overall status)
- Most common violations (which rule codes show up most often across saved inspections with a non-compliant status)
- A list of recent inspections (most recent first, clickable through to the detail view)
- A simple trend view over time (for example, inspections per day or per week, enough for a basic line or bar chart)

Compute these with MongoDB aggregation queries against the inspections collection rather than pulling everything into the application and calculating in code. A simple charting library (Chart.js or Recharts, whichever is easier to wire into the existing frontend) is fine for the trend chart - keep the rest of the dashboard as plain numbers/lists/tables, consistent with keeping the UI simple for now.

============================================================
API CONTRACT (NEW OR CHANGED ENDPOINTS)
============================================================

Auth:
- POST /api/auth/signup - name, email, password -> creates an officer account, active immediately
- POST /api/auth/login - email, password -> returns an authenticated session
- POST /api/auth/guest - no body -> returns a short-lived guest session
- POST /api/auth/forgot-password - email -> triggers an OTP email
- POST /api/auth/reset-password - email, otp, newPassword -> resets the password
- POST /api/auth/logout

Repository:
- The existing POST /api/officer/scan now also accepts a saveToRepository boolean (default true in the frontend UI, but only actually saved if the logged-in user is an officer or admin). If false, or if the caller is a guest, behave exactly as before - nothing is persisted, and no image is uploaded to Cloudinary.
- GET /api/officer/repository - list/search saved inspections, scoped to the logged-in officer, or all of them for an admin, with query parameters for product name, date range, and status
- GET /api/officer/repository/:id - full detail of one saved inspection, including its image URLs
- DELETE /api/officer/repository/:id - remove a saved inspection and its associated Cloudinary images

Dashboard:
- GET /api/officer/dashboard - returns total inspections, compliant/non-compliant counts, top violations, recent inspections, and trend data, scoped the same way as the repository list above

Reports:
- POST /api/officer/report/docx - same input as the existing PDF endpoint, returns a DOCX file instead

============================================================
DATA SCHEMAS
============================================================

User document (new "users" collection, in the new operational database):
{
  "name": "string",
  "email": "string, unique",
  "passwordHash": "string",
  "role": "admin or officer",
  "otp": { "codeHash": "string or null", "expiresAt": "date or null" },
  "createdAt": "date"
}

Inspection document (new "inspections" collection, same operational database):
{
  "savedBy": { "userId": "ObjectId", "name": "string", "role": "officer or admin" },
  "scanTimestamp": "ISO-8601 string",
  "productName": "string",
  "extractedFields": { "...same shape as the Phase 1 Extracted Fields JSON..." },
  "findings": [ "...same shape as the Phase 1 Findings JSON array..." ],
  "overallStatus": "PASS, POTENTIAL_NON_COMPLIANCE, or NEEDS_REVIEW",
  "listingMismatchCheck": { "performed": false, "mismatches": [] },
  "evidenceImages": [
    { "url": "https://res.cloudinary.com/...", "type": "product_photo", "caption": "string" },
    { "url": "https://res.cloudinary.com/...", "type": "barcode_image", "caption": "string" }
  ],
  "createdAt": "date"
}

============================================================
ENVIRONMENT VARIABLES NEEDED
============================================================

- OPERATIONAL_MONGODB_URI - connection string for the new users/inspections database (separate from the existing rules database's connection string)
- JWT_SECRET
- JWT_EXPIRY (for example, 7d)
- OTP_EXPIRY_MINUTES (for example, 10)
- SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM - for sending OTP emails via Nodemailer
- CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET - for uploading evidence and barcode images

Add placeholder values for all of these in .env.example, matching how the Rules database URI was handled in Phase 1.

============================================================
BUILD ORDER FOR THIS PHASE
============================================================

1. DOCX export - independent of everything else, do this first as a quick win.
2. Authentication: signup, login, guest session, forgot/reset password with OTP email, and route-protection middleware.
3. Repository: wire up Cloudinary for image uploads, then build the save-to-database write path, the list/search view, the detail view, and delete (including deleting images from Cloudinary).
4. Dashboard: aggregation queries and the dashboard page, built on top of the repository data from step 3.

============================================================
DEFINITION OF DONE
============================================================

1. An officer's report can be exported as a real, editable DOCX in addition to the existing PDF.
2. An officer can sign up (no approval needed), log in, log out, and reset a forgotten password using an emailed one-time code.
3. Someone can also click "Continue as Guest" and use the scanning tool without creating an account.
4. On the officer's scan results screen, a "save to repository" checkbox appears, ticked by default; unticking it before finalizing means nothing is saved and no image is uploaded anywhere, exactly like Phase 1 behavior.
5. When a scan is saved, the product photo(s) and, if applicable, the barcode image are uploaded to Cloudinary, and only their URLs (plus the structured data) are stored in MongoDB.
6. A logged-in officer can see a list of their own saved inspections, search/filter it, open one to see the full report and its images again, and delete one if needed.
7. A logged-in officer sees a dashboard with total inspections, compliant/non-compliant counts, most common violations, recent inspections, and a basic trend view - scoped to their own data.
8. A guest cannot save to the repository and cannot open the dashboard.
9. An admin account can see the same dashboard and repository, but across all officers, not just their own.
10. Consumers still never encounter a login screen anywhere in the app.
```

---

## Phase 3 -- Multi-Photo Capture, Barcode Scan Input, Expanded Consumer Preferences, Navigation Fixes, Shorter PDF Reports

```text
DRISHTISCAN - PHASE 3 MASTER PROMPT FOR ANTIGRAVITY
(Multi-Photo Capture, Barcode Scan Input, Expanded Consumer Preferences, Navigation Fixes, Shorter PDF Reports)

HOW TO USE THIS: paste this as a follow-up instruction to Antigravity, after Phase 1 (core scanning/rule engine) and Phase 2 (auth, repository, dashboard, DOCX export) are already built. This is a mix of new features and fixes to the existing app - do not rebuild anything already working, only change what is described below.

============================================================
WHAT THIS PHASE COVERS
============================================================

1. Multiple photos per scan, for both the Consumer and Officer sections (currently only a single photo can be uploaded).
2. A barcode scan input option, for both sections (currently missing entirely).
3. A much larger, grouped set of consumer preference options (currently only three: Vegetarian, Gluten Free, Sugar Free).
4. Navigation fixes: a Back option on every screen, a "Scan Another Product" option for officers, and Officer Portal as the default view when the site loads (currently Consumer View is the default).
5. The repository detail view should let an officer download the original uploaded photos, not just the report.
6. Fix the PDF report, which is currently generating at 43 pages - it should be a few pages, not dozens.

============================================================
FEATURE 1: MULTIPLE PHOTOS PER SCAN
============================================================

Change the upload area (in both the Consumer Product Scanner and the Officer scan screen) to accept multiple image files in one go - drag-and-drop or click-to-select should both allow selecting more than one file (front of pack, back of pack, side panels, etc.), and show a thumbnail strip of everything selected before the scan is run, with a way to remove one before submitting.

On the backend, send all selected images together as one scan request rather than one request per image. In the extraction step, merge the results from all images into a single Extracted Fields JSON: for each field (product name, MRP, net quantity, dates, manufacturer, consumer care, and so on), use the first clearly-detected, reasonably confident value found across all the images. If two images produce different values for the same field (for example, two different MRPs), do not silently pick one - flag that field for human review in the findings, with both extracted values recorded, rather than guessing which is correct.

============================================================
FEATURE 2: BARCODE SCAN INPUT
============================================================

Add a barcode option alongside the photo upload, in both the Consumer and Officer sections - either scanning live via the device camera or entering/uploading a barcode image. Reuse a browser barcode-reading library for the live-camera case.

- On the consumer side, decoding the barcode calls an external product-data lookup (as already specified in the Phase 1 prompt) to pull reference details as a supplementary signal alongside whatever photos were also provided.
- On the officer side, if the scan is later saved to the repository, store the barcode image itself (not just the decoded number) as one of the evidence images for that inspection, tagged as "barcode_image" - this was already specified in the Phase 2 prompt's data schema, so this feature is what actually produces that image.

============================================================
FEATURE 3: EXPANDED CONSUMER PREFERENCE OPTIONS
============================================================

Replace the current three checkboxes with a grouped set of options. Keep the UI simple - group them under a few plain labeled sections (accordion, tabs, or just stacked headings with checkboxes underneath is fine, no need for anything elaborate) rather than one long unsorted list. Build this as a data-driven list (an array of option objects with an id, a label, a group, and how it is checked) rather than hardcoding each checkbox, so more can be added later without touching the layout code.

Dietary type: Vegetarian, Vegan, Eggetarian, Jain, Halal, Kosher, Pescatarian.

Allergies and intolerances: Milk/Dairy, Eggs, Peanuts, Tree Nuts, Soy, Wheat, Gluten/Celiac, Fish, Shellfish, Sesame, Mustard, Sulphites, Lactose Intolerance. Keep Gluten/Celiac and Lactose Intolerance as separate entries from the Wheat and Milk/Dairy allergy entries respectively - they are different mechanisms (an autoimmune reaction and an enzyme deficiency) from a classic food allergy, even though they overlap with the same ingredients.

Health goals: High Calorie (flag/avoid), Low Calorie (prefer), Diabetic-Friendly/Low Sugar, Sugar-Free, Low Sodium, Low Fat, High Protein, High Fiber, Low Carb/Keto-Friendly.

Other preferences: Organic Preferred, No Artificial Colors/Flavors, No Preservatives, No MSG, Non-GMO.

Matching logic:
- Dietary type and Allergies/Intolerances: match by scanning the extracted ingredient list text for known keywords per option (for example, Peanuts matches "peanut" or "groundnut"). This only needs the ingredient list to be extracted, which the OCR/extraction pipeline already produces.
- Health goals: match by comparing extracted Nutrition Facts values (calories, sugar, sodium, fat, protein, fiber, carbohydrates per serving) against a threshold per option. Use clearly labeled, adjustable example thresholds for now (for example, flag High Calorie above a configurable per-serving calorie number) rather than hardcoded magic numbers - note in the code and README that these are starting defaults, not verified regulatory claim thresholds, and should be reviewed before being treated as authoritative. If the Nutrition Facts panel was not captured or could not be extracted from the photos provided, show "not enough nutrition information was captured to check this" for those preferences rather than guessing.
- Other preferences: match by scanning the ingredient list and any declared claims text for relevant keywords (for example, "organic" printed on the pack, or the absence of artificial color/preservative code numbers in the ingredient list).

============================================================
FEATURE 4: NAVIGATION FIXES
============================================================

- Add a Back option on every screen in both the Consumer and Officer flows - preferences, capture, results, the mismatch-check form, the report view, the repository list and detail views, and the dashboard should all have a clear way to go back to the previous screen without losing anything already entered on the current one unnecessarily.
- Add a "Scan Another Product" button on the officer's report view. It should reset the capture screen for a new scan while keeping the current session log intact, so an officer inspecting many products in one store visit does not have to leave and come back in.
- Make Officer Portal the default selected view when the site is first opened, replacing Consumer View as the default. The toggle between the two stays exactly as it is otherwise - only which one is active on first load changes.

============================================================
FEATURE 5: REPOSITORY - DOWNLOADABLE RAW PHOTOS
============================================================

In the repository detail view (already specified in Phase 2), add the ability to download the original uploaded photos for that saved inspection, not only the generated PDF/DOCX report. Since the images are hosted on Cloudinary, this can be a direct download link per image, or a single "download all photos" action that fetches each one - either is fine.

============================================================
FEATURE 6: FIX THE PDF REPORT LENGTH
============================================================

The PDF is currently 43 pages for what should be a short compliance report. Likely causes: the raw, per-region OCR output (every individual detected text line, of which a single label alone can have around 30) is being dumped into the report instead of just the structured findings, full-resolution photos are being embedded without resizing so each one spans multiple pages, and there is no print-friendly page-break control so content is breaking awkwardly.

Fix it like this:
- Remove the raw line-by-line OCR output from the report entirely. The report should only show the structured, per-field findings (the Findings JSON), not the underlying raw text detections that produced it.
- Resize/compress every photo before embedding it in the PDF - a width of roughly 600 to 800 pixels is plenty for a printed evidence photo. Lay multiple photos out as a compact grid (several per page) rather than one photo per page.
- Fix the print CSS so page breaks only happen where they make sense (for example, do not start a new page after every single finding row or every single image) - use page-break-inside avoid on logical blocks like a table row or an image-with-caption group, instead of forcing a break between every element.
- Target length: roughly one page for the header and violation summary, one to two pages for the full findings table even with all applicable declaration checks included, one page for a compact evidence photo grid, one page for the listing-mismatch section if it was run, and one page for the officer sign-off area. A typical single-product report should land around 3 to 6 pages total, only growing if an unusually large number of photos were uploaded for that one scan.
- Apply the same fix to the DOCX export, so it does not inherit the same bloated structure.

============================================================
OPEN QUESTION
============================================================

The instruction to save scans to Cloudinary/MongoDB was given in the same breath as "for both user and officer" for multiple photos. This prompt assumes that instruction is about photo upload only, and that saving to the repository stays officer-only exactly as built in Phase 2, since consumers still have no account to attach a saved record to. If consumer scans should also be saveable somehow (for example, as an anonymous history kept only in that consumer's own browser rather than tied to a login), describe how ownership should work for that and it can be added as a separate feature - it is not included in this prompt.
```

---

## Phase 4 -- Agent Skills Setup, Professional Animated Frontend, Mobile Compatibility, Branding Update

```text
DRISHTISCAN - PHASE 4 MASTER PROMPT FOR ANTIGRAVITY
(Agent Skills Setup, Professional Animated Frontend, Mobile Compatibility, Branding Update)

HOW TO USE THIS: paste this as a follow-up instruction to Antigravity, after Phases 1 through 3 (core scanning, auth/repository/dashboard, multi-photo/barcode/preferences/navigation) are already working. This phase is about visual and interaction polish plus two small text/setup changes - it should not touch scanning logic, the rule engine, authentication, or the repository/dashboard behavior at all.

============================================================
WHAT THIS PHASE COVERS
============================================================

1. Install three project-local Agent Skills to guide the design and animation work in this phase.
2. Rebuild the visual design to look professional, with purposeful animation, while keeping the app light to host and fast to load.
3. Make sure the whole app is properly mobile compatible.
4. Change the header subtitle text from "METROLOGY AI" to "Metrology Food Scanner".

Nothing about the existing application logic (OCR pipeline, extraction, rule engine, authentication, repository, dashboard, PDF/DOCX generation) should change in this phase - this is a frontend presentation pass on top of an app that already works correctly.

============================================================
STEP 1: INSTALL PROJECT-LOCAL AGENT SKILLS
============================================================

Install these 3 skills as project-local Antigravity Agent Skills under .agents/skills/:

1. pbakaus/impeccable
2. https://github.com/Leonxlnx/taste-skill
3. emilkowalski/skills

Keep them project-local so they are available whenever you work on this project. Do not modify existing application code while installing these - this step should only add the skill files under .agents/skills/, nothing else. If any of these three cannot be found or fetched, report back exactly which one and why, rather than silently skipping it or substituting something else.

Once installed, actually use them for the design and animation decisions in Step 2 below - they exist specifically to guide this kind of polish work, not just to sit installed and unused.

============================================================
STEP 2: PROFESSIONAL VISUAL DESIGN AND ANIMATION
============================================================

Redesign the visual presentation of both the Consumer and Officer sections to look like a professional, trustworthy government/enforcement-grade tool rather than a rough prototype - clean typography, clear visual hierarchy, consistent spacing, and a cohesive color palette appropriate to a food-safety/metrology product. Use the installed skills to guide taste and animation-quality decisions rather than defaulting to generic component-library styling.

Animation should be purposeful, not decorative for its own sake. Good places for it: feedback when a scan starts processing, a smooth reveal of the results once they arrive, a transition between screens, gentle hover/press feedback on buttons, a subtle success/warning indicator on the compliance verdict. Do not animate everything just because it is possible to - most of the interface (text, tables, forms) should simply be there, correct, and readable.

============================================================
STEP 3: KEEP THE ANIMATION LIGHTWEIGHT ON HOSTING
============================================================

This constraint matters as much as Step 2 - a good-looking app that is heavy to host or slow to load is not a win.

- Default to CSS transitions and CSS keyframe animations wherever they can do the job (hover states, fades, slides, simple reveals) - these are hardware-accelerated and add no JavaScript bundle weight.
- Only reach for a JavaScript animation library for the handful of moments CSS genuinely cannot handle well (for example, an orchestrated multi-step sequence or a shared-element transition between screens). If one is added, use a small, purpose-built library rather than a large general-purpose suite, and apply it narrowly to a few key moments rather than across the whole interface.
- Respect the prefers-reduced-motion setting - simplify or disable non-essential animation for users who have that turned on.
- Compress and lazy-load images (product photos, icons), and code-split routes/pages so the initial load stays light - this app needs to open quickly on an average mobile connection while someone is standing in a store.
- Avoid animation approaches that are expensive to render continuously - looping full-screen background effects, heavy blur or filter animations, scroll-jacking, particle canvases. Fine for a marketing landing page, not appropriate for a tool people open repeatedly to do a quick scan.
- After this pass, check the app's Lighthouse performance score (or an equivalent) on a simulated mobile connection and keep it in a good range rather than letting animation work quietly tank it.

============================================================
STEP 4: MOBILE COMPATIBILITY
============================================================

Verify and fix responsiveness across the whole app, not just the landing screen shown so far - the capture screens, preference checklist, results/report views, the officer's mismatch-check form, the repository list and detail views, and the dashboard should all work properly on a narrow phone-width viewport: touch-friendly tap targets, no horizontal scrolling, readable text sizes without zooming, and forms/checklists that stack sensibly instead of being squeezed. The photo upload and barcode-scan inputs specifically need to work through a mobile browser's camera, since that is the primary real-world use case for this app.

============================================================
STEP 5: BRANDING TEXT CHANGE
============================================================

In the header, replace the subtitle text "METROLOGY AI" with "Metrology Food Scanner", next to the DrishtiScan logo. This is a text-only change - the logo mark itself and the rest of the header layout stay as they are.

============================================================
DEFINITION OF DONE
============================================================

1. The three skills listed in Step 1 are installed under .agents/skills/ and were actually referenced while doing the design work in this phase, with no existing application code changed as a side effect of installing them.
2. Both the Consumer and Officer sections have a cohesive, professional visual design with purposeful, not excessive, animation.
3. CSS-first animation is used by default; any JavaScript animation library in use is small and applied only to a few key moments, not the whole interface.
4. prefers-reduced-motion is respected somewhere meaningful in the app.
5. Images are compressed/lazy-loaded and routes are code-split where reasonable, and a mobile-simulated performance check shows the app is still fast to load.
6. Every screen in both sections, including the repository, dashboard, and forms, works correctly and comfortably on a narrow mobile viewport, with working camera-based photo and barcode input.
7. The header subtitle reads "Metrology Food Scanner" instead of "METROLOGY AI".
8. No scanning, extraction, rule-engine, authentication, repository, or dashboard behavior has changed as a result of this phase.
```

---
