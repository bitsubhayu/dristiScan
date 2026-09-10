```
DRISHTISCAN - PHASE 4 FOLLOW-UP FOR ANTIGRAVITY
(Fix PDF/Report Label Bug and Wording, Fix Upload-Box Layout Density)
```

```
HOW TO USE THIS: this is a narrow follow-up to the previous frontend styling
prompt, not a redesign. The color palette and the existing animations from that
previous pass are approved and working well - do not change or "improve" them.
This prompt fixes three specific, concrete remaining problems: a text-rendering
bug in the reports, overly technical wording in one label, and a layout density
problem in the upload components. Nothing else should change.
```

```
============================================================
HARD CONSTRAINTS
============================================================
```

```
1. Do not change the current color palette, typography choices, or existing
animations/transitions - these are already approved. This is a targeted fix, not
a new design pass.
```

```
2. Do not touch business logic, OCR/extraction logic, the rule engine, state
management, or API calls - styling, layout, and copy text only.
```

```
3. Go one fix at a time and confirm each one works before moving to the next.
```

```
============================================================
FIX 1: THE GARBLED CHARACTERS AND THE JARGON IN THE "PLEASE VERIFY" LABEL
============================================================
```

```
The current label reads: "AI-assisted read -- PaddleOCR could not confidently
read this field; please verify manually" and is rendering with garbled
characters ("& þ") in front of it in the downloaded PDF.
```

```
Find wherever this label is defined - it is likely one shared component or
string used across the on-screen report, the PDF, and the DOCX (per the earlier
requirement that this label appear everywhere the field appears). Whatever icon
or special character is currently placed in front of the text is the most likely
source of the garbling - remove that special character/icon glyph entirely
rather than trying to fix its encoding, and replace it with a plain text
treatment instead (bold text and/or a color change is enough to draw attention -
it does not need an icon).
```

```
Replace the wording itself with this exact text, in every place it currently
appears (on-screen, PDF, and DOCX):
```

```
"Couldn't be read clearly from the photo -- please double-check this value."
```

```
Do not use the words "AI," "AI-assisted," "PaddleOCR," "OCR," or "confidently"
anywhere a normal officer using the tool would see it - those are internal
implementation details, not something the end user needs to know. The point
communicated to the user should simply be "this one might be wrong, look at it
yourself," in plain language.
```

```
After this change, regenerate a report that includes at least one field using
this label and confirm no garbled characters appear anywhere it's shown -
screen, PDF, and DOCX.
```

```
============================================================
```

```
FIX 2: UPLOAD BOX LAYOUT IS TOO SPARSE AND CENTERED
============================================================
```

```
This is the concrete cause of the "looks like a plain AI-generated placement"
feedback: the package-photo upload dropzone (on both the Consumer scanner and
the Officer scan screen, including the second smaller "Barcode Image Evidence"
box on the Officer screen) is a large box with its icon, heading text, subtext,
and buttons all centered as a small cluster floating in the middle of a lot of
empty padding. That empty-box-with-centered-content-floating-in-the-middle look
is the specific pattern to fix - it is not about "centering is bad" in general,
```

```
buttons and icons can still be centered within their own small elements, it's
specifically this oversized-box-with-sparse-centered-content pattern.
```

```
Fix by doing one or both of:
```

```
- Reduce the box's padding/min-height so it sizes to its actual content with
reasonable breathing room, instead of a large fixed empty area.
```

```
- Restructure the content into a more deliberately composed arrangement rather
than a tall centered stack - for example, icon and heading/subtext arranged
together on one side with the action buttons positioned more intentionally,
rather than everything stacked and centered top to bottom.
```

```
Apply the same fix consistently to every instance of this component (consumer
upload box, officer packaging-photo box, officer barcode-image box) since they
appear to share the same underlying component - fixing it once should fix all of
them.
```

```
If the "impeccable" skill's audit mode can specifically flag this "sparse
centered empty-state" pattern, run it against these three components before and
after the change to confirm it's resolved.
```

```
============================================================
DEFINITION OF DONE
```

```
============================================================
```

`1. No garbled characters appear anywhere the "please double-check this value" label is shown (screen, PDF, DOCX).` 

`2. The label uses the exact plain-language wording above, with no mention of AI, PaddleOCR, or OCR, anywhere a user sees it.` 

`3. The upload dropzone components (consumer, officer packaging photos, officer barcode image) no longer read as a small centered cluster floating in a large empty box - content is sized and composed intentionally.` 

`4. The existing color palette and animations from the previous styling pass are unchanged.` 

`5. All existing scanning, extraction, and reporting functionality still works exactly as before - this was a styling and copy fix only.` 

