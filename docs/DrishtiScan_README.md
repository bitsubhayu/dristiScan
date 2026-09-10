# DrishtiScan
### A Packaged-Food Compliance Scanner for India's Legal Metrology Rules

This document explains the entire project in plain language — what it does, how it works, how it's built, and what still needs work — so that anyone joining the team, technical or not, can get up to speed without having to dig through old chat logs. Technical details (database structures, code folders, setup keys) are included too, clearly marked, for whoever is actually building it.

---

## Table of Contents

1. [What Is This Project?](#1-what-is-this-project)
2. [Why Does This Matter?](#2-why-does-this-matter)
3. [Who Uses This App?](#3-who-uses-this-app)
4. [How a Scan Works, Start to Finish](#4-how-a-scan-works-start-to-finish)
5. [The Technology We're Using, and Why](#5-the-technology-were-using-and-why)
6. [Detailed System Architecture](#6-detailed-system-architecture)
7. [The Databases](#7-the-databases)
8. [The Compliance Decision Logic](#8-the-compliance-decision-logic)
9. [Multiple Photos of the Same Product — and a Real Bug We Found](#9-multiple-photos-of-the-same-product--and-a-real-bug-we-found)
10. [Where AI (Gemini) Is Used, and Where It Deliberately Isn't](#10-where-ai-gemini-is-used-and-where-it-deliberately-isnt)
11. [Consumer Preferences (Allergies, Diet, Health Goals)](#11-consumer-preferences-allergies-diet-health-goals)
12. [Officer Tools: Repository, Dashboard, and Reports](#12-officer-tools-repository-dashboard-and-reports)
13. [Accounts and Sign-In](#13-accounts-and-sign-in)
14. [Navigation and Everyday Usability](#14-navigation-and-everyday-usability)
15. [Visual Design](#15-visual-design)
16. [Project Folder Structure](#16-project-folder-structure)
17. [Environment Variables / Setup Checklist](#17-environment-variables--setup-checklist)
18. [How This Maps to the Official SIH Problem Statement](#18-how-this-maps-to-the-official-sih-problem-statement)
19. [Current Known Limitations](#19-current-known-limitations)
20. [Project History in Brief](#20-project-history-in-brief)
21. [Questions SIH Judges Are Likely to Ask](#21-questions-sih-judges-are-likely-to-ask)
22. [Glossary](#22-glossary)

---

## 1. What Is This Project?

DrishtiScan is a web app that lets someone point a phone camera at a packaged product — a food item, a supplement bottle, a snack packet — and instantly find out two things:

1. **Does the packaging follow the law?** In India, every packaged product is legally required to clearly print certain information: the price, how much is inside, who made it, when it was made, when it expires, and how to contact the manufacturer if something's wrong. This app checks a photo of the package against those legal requirements automatically.
2. **Is this product right for me?** For everyday shoppers, the app can also flag things like "this contains egg" or "this is high in sugar" based on preferences the shopper sets for themselves (allergies, diet, health goals).

It's built for two very different kinds of people at once: a **government food safety officer** doing a formal inspection, and an **ordinary shopper** standing in a store aisle.

## 2. Why Does This Matter?

India has a law called the **Legal Metrology (Packaged Commodities) Rules, 2011**, which spells out exactly what must be printed on a package and how. Enforcement officers are supposed to check products against this law, but doing that by hand — reading every label, cross-referencing every rule — is slow, and with millions of products on shelves, it's practically impossible to check more than a tiny fraction of them.

This project is our entry for **Smart India Hackathon problem statement SIH26034**, issued by the Department of Consumer Affairs, which specifically asks for software that can scan a package and automatically flag rule violations, keep a record of past inspections, and give enforcement officers a dashboard to work from.

## 3. Who Uses This App?

There are four kinds of "user," and it's important to understand that they're treated very differently:

- **Shoppers (Consumers).** Anyone who opens the app and scans a product. They never need to sign in or create an account — there's no "consumer account" at all. Anything they set (like "I'm allergic to peanuts") is remembered only inside their own phone's browser, never sent to our servers. This is a deliberate privacy choice: we don't want to be in the business of storing what random people's health conditions are.
- **Guest Officers.** Anyone can open the "Officer" side of the app and use the full scanning and reporting tool without creating an account — this is the "try before you commit" mode. The catch: a guest cannot save an inspection to the permanent record, and cannot see the enforcement dashboard, because both of those require a real, identifiable account to attach the data to.
- **Officers.** A real account (name, email, password) that any enforcement officer can create for themselves — no approval process needed. Officers can do everything a guest can, plus save inspections permanently and see their own dashboard of past work.
- **Admins.** The same as an officer, but can see and manage *every* officer's saved inspections and dashboard data, not just their own — useful for a supervisor overseeing a team.

## 4. How a Scan Works, Start to Finish

**For a shopper:**
1. Open the Consumer side of the app (this is intentionally the *second* tab — the Officer side loads first by default, since this is primarily an enforcement tool).
2. Optionally, tick a few personal preferences first (see [Section 11](#11-consumer-preferences-allergies-diet-health-goals)) — or skip this and just scan.
3. Take or upload one or more photos of the package (front, back, side, nutrition panel — as many as needed), or scan the barcode instead.
4. Within a few seconds, see: whether the product appears to meet legal requirements, its manufacture/expiry dates and price, any warning based on the shopper's own preferences, and finally general info like ingredients and nutrition.
5. Nothing about this scan is saved anywhere — it exists only on that person's screen, for that moment.

**For an officer:**
1. Open the app — the Officer side is already selected.
2. Take or upload one or more photos of the package, and optionally a barcode image.
3. The app runs the *full* legal checklist (not just a one-line summary) and produces a detailed report: every requirement checked, whether it passed, and — where something's wrong — exactly which rule is being broken and why.
4. Optionally, the officer can also check whether the product's *online store listing* (price, quantity, country of origin) matches what's actually printed on the package — this is a specific, separate legal requirement, and it's an opt-in extra step, not automatic.
5. The officer sees a checkbox, **ticked by default**, offering to save this inspection permanently. They can untick it if they don't want to keep this one. If they're browsing as a Guest, this option isn't available at all.
6. The officer can download the report as a PDF, or as an editable Word document, and can immediately start scanning the next product without losing their place.

## 5. The Technology We're Using, and Why

We use what's called the **MERN stack** — four pieces of free, widely-used, well-supported software that fit together:
- **M**ongoDB — where we store organized records (think of it as a very large, very fast digital filing cabinet).
- **E**xpress — the framework our server-side code is built on.
- **R**eact — what builds the actual screens the user sees and taps.
- **N**ode.js — the engine that runs our server-side code.

For actually **reading the text off a photo**, we use an open-source tool called **PaddleOCR** (specifically its newest model, called PP-OCRv6). "OCR" stands for Optical Character Recognition — it's the technology that looks at a photo and figures out what words and numbers are printed in it, the same basic idea as how your phone can "read" a business card. We chose PaddleOCR because it's free, it runs on our own infrastructure (so photos aren't being sent to a third-party company just to read them), and after real testing it performs well on typical product labels.

For storing the actual **photos** people upload, we use a free image-hosting service called **Cloudinary**, rather than storing images in our own database (explained in [Section 7](#7-the-databases)).

For two very specific, narrow tasks that plain OCR isn't good at — described in detail in [Section 10](#10-where-ai-gemini-is-used-and-where-it-deliberately-isnt) — we also make limited use of Google's **Gemini** AI, which has a free tier we can use.

## 6. Detailed System Architecture

Here is the journey a photo takes through the system, step by step:

```
Photo(s) uploaded
      |
      v
Image pre-processing (contrast enhancement, splitting large photos into
zoomed-in tiles so small print isn't missed, straightening if needed)
      |
      v
PaddleOCR reads all the text on each photo and reports back the words it
found, roughly where on the image each word was, and how confident it is
about each one
      |
      v
Extraction: turning "a pile of text PaddleOCR found" into an organized
record — product name, net quantity, price, dates, manufacturer, etc.
This step uses the *position* of each piece of text on the label (not just
the words themselves) to correctly match a number to the label sitting next
to it
      |
      v
Reconciliation: if more than one photo was provided, combine what was found
across all of them into a single, agreed-upon record (see Section 9)
      |
      v
Rule Engine: compares the organized record against the legal requirements
stored in our Rules database, one requirement at a time
      |
      v
Compliance decision: only at this final step does the system decide whether
the product looks compliant, questionable, or unreadable — never earlier
      |
      v
Report generation (on-screen summary, downloadable PDF, downloadable Word
document)
      |
      v
(Officer only, and only if they chose to) saved to the permanent Inspection
Repository
```

The important design rule behind all of this: **the system should never jump straight from "here's a photo" to "here's a legal verdict."** Every step above has to happen in order, so that we always know exactly *why* the system concluded what it did, and so a human can double-check the reasoning rather than just seeing an unexplained "yes/no."

## 7. The Databases

We deliberately use **two separate MongoDB databases**, not one, and this was a specific decision worth explaining:

### 7.1 Database 1 — The Rules Database
Holds only the legal requirements themselves: the list of what must be printed on a package, what counts as a pass or a violation, and which official regulation each rule comes from. This almost never changes day-to-day and is small.

### 7.2 Database 2 — The Operational Database
Holds two collections (a "collection" in MongoDB is roughly like a table in a spreadsheet, holding one type of record):
- **Users** — officer and admin accounts: name, email, a securely scrambled (never plain-text) version of their password, their role, and some temporary data used only during a password reset.
- **Inspections** — every officer-saved inspection: who saved it, when, the product's extracted details, the full pass/fail findings, and links to the photos (not the photos themselves — see below).

### 7.3 Why Photos Are Never Stored Directly in MongoDB
A free MongoDB database only gives us 512 MB of storage total — a single high-quality photo can be a few megabytes, so storing photos directly would fill that up almost immediately. Instead, whenever an officer saves an inspection, its photos are uploaded to Cloudinary (a service built specifically for hosting images), and only the resulting web link to each photo is saved in MongoDB. This keeps our database small and fast, while Cloudinary's free plan comfortably handles thousands of photos.

**Unsaved scans never touch either database or Cloudinary at all** — they exist only in memory for the few seconds it takes to generate the on-screen result, and are then discarded.

## 8. The Compliance Decision Logic

For every single legal requirement checked, the system doesn't just say "pass" or "fail" — it uses five possible outcomes:

- **PASS** — the requirement is clearly met.
- **NON_COMPLIANT** — the requirement is clearly not met.
- **POTENTIAL_NON_COMPLIANCE** — something looks off, but a human should double check before treating it as a confirmed violation.
- **NOT_APPLICABLE** — this particular rule doesn't apply to this type of product or package.
- **REVIEW** / **INSUFFICIENT_EVIDENCE** — the photo didn't clearly show this information, so the system genuinely doesn't know, and says so honestly instead of guessing.

This last one matters a lot: **if a photo is blurry or a label can't be read, the correct answer is "we don't know," never "it's fine."** Early in development we actually had a bug where an unreadable photo produced a "fully compliant" result by default — that's been fixed, and the app is specifically tested to make sure "no information found" is never confused with "no problem found."

The system is also deliberately built to **never invent information it doesn't actually see.** If a manufacturer's address wasn't legible in the photo, the report says "Not detected" — it never guesses a plausible-looking address just to fill in the blank.

Because of all this, the final report always includes a place for a **human officer to review and sign off** on anything the system flagged as uncertain — this app is meant to make an officer's job faster, not to replace their judgment.

## 9. Multiple Photos of the Same Product — and a Real Bug We Found

Officers often need to photograph several sides of the same package (front, back, ingredients panel) to capture every required declaration. This created a genuinely tricky problem that's worth explaining, because it shaped a lot of the current design.

**What happened:** we tested the app on three real photos of the same vitamin bottle. The front of the bottle said "OPTIMUM NUTRITION," a side panel's tiny print (read imperfectly) came out as "MOLTON," and the website printed on the back read as "OPTIMUMNUTRITION.CO.IN." The system treated these three text fragments as three *different, conflicting product names* — and incorrectly reported the product as non-compliant because of it, even though all three photos were obviously the same bottle.

**Why this happened:** this wasn't really a photo-reading problem — PaddleOCR had, for the most part, read the text correctly for what was actually printed in each spot. The real bug was in the logic *afterward*: it was comparing raw text strings for exact sameness, instead of understanding that a brand name, a fragment of the same brand name, and that brand's website are all clearly describing the same product.

**How it's fixed:** when photos disagree on a field like product name, the system now asks Google's Gemini AI (a general-purpose AI good at this kind of language understanding) to judge whether the different readings are really the same thing observed differently, or a genuine conflict. Importantly, we specifically tested that this fix doesn't just make the system agree with itself no matter what — we deliberately fed it photos of two genuinely different products together, and confirmed it still correctly flags that as a real conflict. The goal was to fix the false alarm without losing the ability to catch a real one.

## 10. Where AI (Gemini) Is Used, and Where It Deliberately Isn't

To avoid any confusion on this point: **PaddleOCR reads every photo, every time, with no exceptions.** It is the only thing that ever looks at a raw, full photo to figure out what text is on it. Gemini is never used as a substitute for this, and never sees a raw photo as the very first step.

Gemini is used for exactly two narrow, specific jobs, both happening *after* PaddleOCR has already done its reading:

1. **Reconciling multiple photos of the same product** (explained in Section 9) — deciding whether different readings from different angles describe the same thing.
2. **A labeled fallback**, only for a specific field that PaddleOCR genuinely could not read with any confidence at all (for example, a manufacturer's address printed too small or too faintly to read). In this one case, a cropped image of just that area is sent to Gemini as a last resort. If Gemini manages to read it, the value is used — but it is always clearly marked to the person viewing the report as **"Couldn't be read clearly from the photo — please double-check this value,"** in plain language, with no technical jargon. It is never presented as being just as reliable as a normal, confidently-read value.

**On the honest question of accuracy:** we don't believe any OCR technology — free or paid, from us or from a large company — can promise close to perfect accuracy on things like a curved, glossy, glare-covered plastic bottle. That's a genuinely hard photography problem, not a flaw specific to our choice of tools. So instead of chasing an unrealistic "100% accurate" claim, our actual goal is: **the system should never state something false with confidence.** Where it's genuinely unsure, it says so and asks for a human to check — which is what actually makes it trustworthy for a legal/enforcement context.

## 11. Consumer Preferences (Allergies, Diet, Health Goals)

A shopper can select from a grouped list of preferences before or after scanning. **All of this stays on the shopper's own device (in their browser) and is never sent to our servers** — this was a deliberate decision so that nobody's personal health information is something we're responsible for storing.

- **Dietary type:** Vegetarian, Vegan, Eggetarian, Jain, Halal, Kosher, Pescatarian
- **Allergies & intolerances:** Milk/Dairy, Eggs, Peanuts, Tree Nuts, Soy, Wheat, Gluten/Celiac, Fish, Shellfish, Sesame, Mustard, Sulphites, Lactose Intolerance
- **Health goals:** High Calorie (flag it), Low Calorie, Diabetic-Friendly/Low Sugar, Sugar-Free, Low Sodium, Low Fat, High Protein, High Fiber, Low Carb/Keto-Friendly
- **Other:** Organic Preferred, No Artificial Colors/Flavors, No Preservatives, No MSG, Non-GMO

Allergy and diet matches are found by checking the scanned ingredient list for relevant keywords. Health-goal matches (like "high calorie") compare the scanned Nutrition Facts numbers against example threshold values — these thresholds are adjustable starting points, not officially verified regulatory cutoffs, and if the nutrition panel wasn't clearly captured, the app honestly says "not enough information was captured to check this" rather than guessing.

## 12. Officer Tools: Repository, Dashboard, and Reports

### 12.1 Saving to the Repository
After a scan, an officer sees a checkbox — **ticked by default** — to save the inspection permanently. If they leave it ticked, the photos are uploaded to Cloudinary and the full record (product details, findings, photos) is saved to the Inspections collection. If they untick it, or if they're using Guest mode, nothing is saved anywhere.

Saved inspections can later be searched (by product name, date, or compliance status), reopened to see the full original report and photos again, re-exported, or deleted if no longer needed (deleting also removes the photos from Cloudinary, so nothing is left behind).

### 12.2 The Enforcement Dashboard
Available only to a signed-in officer or admin. Shows: total inspections done, how many were compliant vs. not, the most common types of violation found, a list of recent inspections, and a simple chart of inspection activity over time. An officer sees only their own data; an admin can see everyone's.

### 12.3 PDF and Word (DOCX) Reports
Every report can be downloaded two ways: as a **PDF** (a fixed, final, easy-to-share document) and as an **editable Word document** (so an officer can add their own notes or adjust wording afterward, if needed for an official process). Both include the same information: product details, every finding, the specific rule behind any flagged issue, supporting photos, and the final result. We originally had a bug where the PDF came out 43 pages long (mostly from dumping raw, unfiltered scanner output into the document) — this has been fixed so a typical report runs a handful of pages.

## 13. Accounts and Sign-In

- **Shoppers never sign in**, anywhere in the app, under any circumstance.
- **Officers** create their own account with a name, email, and password — no approval needed, they can start using it immediately.
- **Guest Officer** mode requires no account at all, but can't save inspections or view the dashboard.
- **Forgotten password:** the officer enters their email, receives a one-time numeric code by email, and uses that code (plus a new password) to reset it — this is safer than a plain reset link, and the code expires after a short time.
- **Admins** are the same as officers, but can see and manage data across all officers, not just their own.

## 14. Navigation and Everyday Usability

- Every screen has a clear **Back** option — nobody should ever feel stuck.
- After finishing a report, an officer sees a **"Scan Another Product"** button that takes them straight back into a new scan, without losing the list of everything they've already scanned in that session — useful for an officer inspecting many products in one store visit.
- The **Officer side loads by default** when the app is opened (this is primarily an enforcement tool), with Consumer as a secondary option.
- The whole app is built to work properly on a phone, since that's how it will actually be used in the field or in a store — not just on a desktop screen.

## 15. Visual Design

The app deliberately avoids looking like a generic, templated dashboard. It uses a light (not dark) color scheme designed to feel considered rather than default, a clear visual hierarchy, and animation that's purposeful (giving feedback when something is happening) rather than decorative. Because the app needs to load quickly on an ordinary phone connection, animation is built mostly with lightweight, hardware-friendly CSS techniques rather than heavy JavaScript effects, and images are compressed and loaded only as needed.

To help guide this design work, the project uses three installed reference "skills" (bundles of expert design/animation guidance that our development tool can consult): one focused on overall polish and avoiding generic-feeling interfaces, one focused on visual "taste" and avoiding common AI-generated design clichés, and one focused specifically on getting animation timing and feel right.

## 16. Project Folder Structure

```
Antigravity_Workspace
  DrishtiScan
    frontend/            (everything the user sees and taps - React)
      src/
        pages/
          consumer/      (shopper-facing screens)
          officer/       (officer-facing screens)
        components/      (reusable pieces - upload box, result card, etc.)
        hooks/
        utils/           (helpers, including browser-storage helpers)
        assets/
    backend/             (the server - Node/Express)
      src/
        routes/
        controllers/
        services/
          ocrClient.js        (talks to the OCR service)
          extraction.js       (turns raw OCR text into organized fields)
          ruleEngine.js       (compares fields against the legal Rules database)
          mismatchCheck.js    (package vs. online listing check)
          reportBuilder.js    (builds the PDF and Word reports)
        models/          (database record shapes)
        config/          (database connection setup)
    ocr-service/         (the PaddleOCR reading engine, runs separately)
    rules-data/          (starting/example legal rule entries)
    docs/                (project documentation, including this file)
    .agents/skills/      (the three design/animation reference skills)
    python311/           (the Python environment the OCR service needs)
    run_all.ps1          (a script to start everything at once)
    README.md            (this file)
```

## 17. Environment Variables / Setup Checklist

These are the secret settings a developer needs to configure before running the app (never shared publicly or committed to version control):

| Setting | What it's for |
|---|---|
| `RULES_MONGODB_URI` | Connection to the database holding the legal rules |
| `OPERATIONAL_MONGODB_URI` | Connection to the database holding officer accounts and saved inspections |
| `JWT_SECRET` / `JWT_EXPIRY` | Used to keep an officer securely signed in between page loads |
| `OTP_EXPIRY_MINUTES` | How long a password-reset code stays valid (10 minutes is typical) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | Needed to actually send the password-reset emails |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Needed to upload and store evidence photos |
| `GEMINI_API_KEY` | Needed for the two narrow AI-assisted tasks described in Section 10 |

## 18. How This Maps to the Official SIH Problem Statement

| What SIH26034 explicitly asks for | Where it lives in this app |
|---|---|
| Scan and analyze packaged-product images | Consumer and Officer capture screens |
| Detect and validate mandatory declarations | OCR + extraction + rule engine |
| Check completeness, correctness, and placement | Rule engine validators |
| Check readability and font-size requirements | Confidence-based flagging, routed to human review |
| Detect missing/misleading/non-standard declarations | Rule engine + flagged findings |
| Generate a compliance report and violation summary | The report itself, on-screen and exported |
| Attach supporting photographic evidence | Photos included in saved inspections and reports |
| Maintain a repository of scanned products / inspection history | Officer's opt-in Inspection Repository |
| Search and retrieve past inspections | Repository search/filter |
| Provide an enforcement dashboard | Officer/Admin Dashboard |
| Secure authentication and role-based access | Officer/Admin accounts, guest mode, role separation |
| Export reports in PDF and editable format | PDF and Word (DOCX) export |
| Technical documentation of the architecture | This document |

## 19. Current Known Limitations

Being upfront about this matters, both for the team and for judges:

- OCR reading of a curved, glossy, or heavily glare-affected surface will occasionally still misread individual characters — this is a fundamental photography/computer-vision limitation, not something we expect to fully eliminate.
- There is currently no cross-session, multi-day trend history — the officer dashboard reflects saved inspections, which start from whenever the officer began using the tool.
- The starting set of legal rules in the system are examples/placeholders and need to be checked against the exact, current, official rule text before being relied on as a legal authority.
- The visual design has gone through several rounds of polish and is still being refined for a fully "premium" look and feel.

## 20. Project History in Brief

For context on how the project evolved (useful if you come across older notes that describe an earlier version):

- **Phase 1:** Core scanning pipeline built — no login for anyone, no data saved anywhere, MongoDB used only for legal rules.
- **Phase 2:** Officer/admin accounts, the Inspection Repository, the Enforcement Dashboard, and editable (Word) report export were added — consumers still never log in.
- **Phase 3:** Multiple-photo scanning, barcode scanning, the full preferences list, "Back"/"Scan Another Product" navigation, and a fix for an overly long PDF report.
- **Phase 4:** Professional visual design pass, mobile compatibility, and branding update.
- **Phase 5:** Accuracy improvements — fixing the false multi-photo product-name conflict, adding the labeled AI fallback for unreadable fields, and OCR configuration/preprocessing tuning.

## 21. Questions SIH Judges Are Likely to Ask

**"Why PaddleOCR instead of a commercial service like Google Vision or AWS Textract?"**
It's free with no per-scan cost, it runs on our own infrastructure so photos aren't sent to a third party just to be read, and testing showed it performs well for this use case. We do use Google's Gemini AI, but only for two narrow, specific tasks downstream of OCR — never as the primary reader.

**"What's your actual accuracy?"**
We deliberately don't claim perfect accuracy, because no OCR technology reliably achieves that on real-world packaging like curved, glossy bottles. Our actual design goal is that the system never confidently states something false — where it's uncertain, it says so and asks for human review, rather than guessing. We can speak to specific measured improvements from our testing (for example, correctly separating "net quantity" from "servings per container," and correctly recognizing multiple photos of the same product).

**"Can this legally replace a human inspector?"**
No, and it isn't meant to. Every report ends with a place for a human officer to review and confirm anything flagged as uncertain. The system is a decision-support tool that makes an officer faster and more consistent, not a replacement for their legal authority to make a final determination.

**"How do you keep up with changes to the law?"**
Every rule in our database is stored with the date it took effect (and, if applicable, when it stops applying), so the system always checks a scan against whatever rules were actually in force at that time — including handling a rule that's been announced but isn't enforceable yet.

**"What happens to a shopper's personal data — allergies, health conditions?"**
It never leaves their own device. Preferences are stored only in the shopper's browser and are never transmitted to or stored on our servers, specifically because we don't want to be responsible for holding anyone's personal health information.

**"How do you avoid confusing two different regulations — Legal Metrology and food-safety (FSSAI) rules?"**
We treat them as two separate rule sets internally, and we're careful not to claim that every FSSAI-related detail (like an ingredient or an FSSAI license number) is automatically a Legal Metrology requirement — they come from different laws with different purposes.

**"How does this handle a shopper or officer taking multiple photos of the same product?"**
Earlier versions of this system had a real bug where different-but-related text found across multiple photos (like a brand name and a fragment of that brand's website) was incorrectly treated as proof of two different, conflicting products. We fixed this with an AI-assisted step that understands when different text is describing the same thing — and we specifically tested that it still correctly catches a real conflict when two genuinely different products are involved.

**"Is this scalable / what does it cost to run?"**
Every service used has a workable free tier at this stage — the database, the image storage, and the AI-assisted step — so the prototype has no ongoing cost. Scaling to nationwide use would eventually mean moving off free tiers, but the architecture (separate databases, external image hosting, a swappable OCR engine) doesn't need to be redesigned to do that.

**"Why is there no login for regular consumers?"**
It removes friction for the people we most want to adopt this — nobody wants to create an account just to check a snack's expiry date — and it avoids us needing to store any personal data for the general public at all.

## 22. Glossary

- **OCR (Optical Character Recognition):** technology that reads text out of a photo.
- **API:** the way our frontend (what you see) and backend (the server) talk to each other.
- **MongoDB:** the database software we use to store organized records.
- **JWT:** a secure digital "ticket" that keeps an officer signed in without re-entering their password on every page.
- **MRP:** Maximum Retail Price — the highest legal price a product can be sold for in India.
- **Legal Metrology (Packaged Commodities) Rules, 2011:** the Indian law this app checks packaging against.
- **FSSAI:** the Food Safety and Standards Authority of India — a separate regulatory body from Legal Metrology, focused on food safety rather than package labeling.
- **Gemini:** Google's AI model, used here for two narrow, specific tasks (see Section 10).
- **Cloudinary:** the external service used to store uploaded photos.
- **SIH:** Smart India Hackathon, the competition this project is being built for.
