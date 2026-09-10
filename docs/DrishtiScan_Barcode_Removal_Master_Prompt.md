```
DRISHTISCAN - COMPLETE REMOVAL OF THE BARCODE SCANNING FEATURE
(Clean, Isolated Rollback - Subtraction Only, Nothing Else Touched)
```

```
HOW TO USE THIS: barcode scanning is being dropped entirely, not fixed, not
hidden behind a flag - the package, the frontend UI, and anything wired to it
should no longer exist in the codebase after this. The one hard requirement
that matters more than anything else in this prompt: every other feature must
behave exactly as it did before this change. This is a subtraction-only task -
if you find yourself improving, refactoring, or restyling something that isn't
barcode-related, stop, that's out of scope.
```

```
============================================================
HARD CONSTRAINTS
============================================================
```

```
1. This is a removal task only. Do not refactor, rename, reorganize, or
"clean up" anything you happen to pass through while doing this.
```

```
2. Every other feature must work identically before and after: OCR label
scanning and field extraction, the rule engine, PDF/DOCX report generation
(including the earlier PDF-download fix, for both Guest and Officer sessions),
and both the Consumer and Officer flows minus only the barcode piece.
```

```
3. If a barcode-related line of code lives inside a shared component that also
does something unrelated, edit only the barcode-specific lines inside it. Do
not rewrite or restructure the shared component itself.
```

```
4. Complete Section 0 (find everything first) and report the full list before
deleting anything. Do not remove based on assumption or memory of what was
added - confirm it in the actual code.
```

```
5. Go one section below at a time, and confirm the app still builds and runs
correctly after each one before moving to the next.
```

```
============================================================
SECTION 0: FIND EVERYTHING BARCODE-RELATED FIRST
============================================================
```

```
Before deleting anything, search the codebase and report back a full
inventory:
```

```
a. Which barcode-decoding npm package(s) are actually installed - check
package.json in the frontend (and backend, if it has its own) and name the
exact package(s) found. Do not assume which one it is.
```

```
b. Every file that imports or references that package.
```

```
c. Every barcode-related UI element: the Consumer section's barcode capture/
upload control, the Officer section's "Barcode Image Evidence" upload box, any
live-camera barcode scanning component, button, icon, or label anywhere.
```

```
d. Any barcode-related state (component state, context, store), any
barcode-specific handler/helper function, any backend route or endpoint that
exists to receive or process a barcode image or decoded value, and any
barcode field in the data model (MongoDB schema) or in the PDF/DOCX report
template.
```

```
Report this as a simple list of exact files and line ranges before touching
any of it - this doesn't need to be a long write-up, just the inventory.
```

```
============================================================
SECTION 1: UNINSTALL THE PACKAGE
============================================================
```

```
Uninstall the exact barcode-decoding package(s) found in Section 0a. After
uninstalling, explicitly confirm no import of that package remains anywhere in
the codebase - a leftover import of an uninstalled package will break the
build, so check this directly rather than assuming the uninstall step alone
handles it.
```

```
============================================================
SECTION 2: REMOVE THE FRONTEND BARCODE UI
============================================================
```

```
Remove every barcode-related UI element found in Section 0c: the Consumer
section's barcode control, the Officer section's "Barcode Image Evidence" box,
any live-camera barcode component, and their associated state/handlers.
```

```
If a removed barcode box sat alongside other elements in a shared layout (for
example, next to the main label-photo upload box), remove only the barcode
element and let the layout reflow naturally. Only touch the surrounding
layout/spacing if removing the barcode element visibly breaks it - and if so,
fix only what's broken, don't restyle anything that already looks fine.
```

```
============================================================
SECTION 3: REMOVE BACKEND AND DATA-MODEL TRACES
============================================================
```

```
Remove any backend endpoint that exists solely to receive or process a
barcode image or decoded value - after confirming from Section 0d that it
isn't shared with anything else.
```

```
If the report schema, MongoDB model, or PDF/DOCX template has a barcode
field, remove it from the report output entirely. Do not leave a placeholder
line such as "Barcode: Not detected" appearing in every future report - the
field itself should be gone, not shown as permanently empty.
```

```
============================================================
REQUIRED VERIFICATION
============================================================
```

```
After all three sections above are done:
```

```
1. Build and run the app end-to-end. Confirm there are no console or build
errors referencing barcode or the uninstalled package anywhere.
```

```
2. Confirm the Consumer flow works exactly as before, minus the barcode
control.
```

```
3. Confirm the Officer flow works exactly as before, minus the barcode
control.
```

```
4. Re-test PDF download for both a Guest session and a signed-in Officer
session, and confirm OCR extraction and the rule engine still work as before -
this removal must not regress either of those already-fixed features.
```

```
5. Generate a report and confirm it contains no barcode-related field or line
at all, empty or otherwise.
```

```
6. Show a before-and-after screenshot of both the Consumer and Officer scan
screens so the visual removal is confirmed, not just stated.
```

```
============================================================
DEFINITION OF DONE
============================================================
```

```
1. The barcode-decoding npm package is uninstalled, and no import of it
remains anywhere in the codebase.
```

```
2. No barcode-related UI - upload box, camera control, button, or label -
remains on the Consumer or Officer screens.
```

```
3. No barcode-related state, backend endpoint, database field, or report
line remains anywhere.
```

```
4. Every other feature - OCR extraction, the rule engine, PDF/DOCX
generation, PDF download for Guest and Officer sessions, and general layout -
behaves identically to how it did before this change.
```

```
5. The Section 0 inventory and the required verification results are both
shown as evidence, not just reported as complete.
```
