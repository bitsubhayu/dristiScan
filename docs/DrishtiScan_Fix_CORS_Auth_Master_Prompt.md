```
DRISHTISCAN - FIX CROSS-ORIGIN AUTH + CORS
(Application Changes + Deploy Config + Push to GitHub)
```

```
HOW TO USE THIS: this fixes two confirmed issues from live production testing -
Officer guest login not persisting, and Consumer OCR scan failing with a
generic "Scan processing failed" error. Both are most likely explained by the
backend's CORS_ORIGINS environment variable not including the live Vercel
frontend URL, plus a confirmed separate bug in how the auth cookie is set for
a cross-origin deployment (frontend on Vercel, backend on Cloud Run - two
different domains). This prompt covers the code fix, the required Cloud Run
environment configuration, and pushing the result to GitHub. Do not touch
anything outside this scope - not the OCR pipeline, not the rule engine, not
report generation, nothing already fixed in earlier rounds.
```

```
============================================================
HARD CONSTRAINTS
============================================================
```

```
1. Scope is strictly: the auth cookie, CORS configuration, and the Cloud Run
environment variables needed to support them. Do not modify extraction,
Gemini, the rule engine, report generation, or frontend UI/styling.
```

```
2. Verify each fix against the actual live URLs before moving to the next
section - do not assume a fix worked without checking it.
```

```
3. Do not weaken CORS by switching to a wildcard/allow-all origin as a
shortcut - the fix is to correctly configure the specific allowed origin(s),
not to remove the protection.
```

```
============================================================
SECTION 1: FIX THE CROSS-SITE COOKIE
============================================================
```

```
File: backend/src/controllers/authController.js, setAuthCookie function:
    res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: maxAgeMs
    });
```

```
sameSite: 'lax' cookies are never sent on cross-site requests. Since the
frontend (Vercel) and backend (Cloud Run) are on different domains, this
cookie will never actually reach the backend on any follow-up request - the
initial login/guest call can succeed and still leave the user effectively
logged out on the next request.
```

```
Required fix: when running in production, use sameSite: 'none' paired with
secure: true (sameSite: 'none' is rejected by browsers unless secure is also
true, so these two must change together, not separately). Keep local
development behavior (sameSite: 'lax', secure: false) intact for non-
production. Search the codebase for any other place a cookie is set the same
way and apply the identical fix there too - do not fix only this one call site
if there are others.
```

```
============================================================
SECTION 2: MAKE CORS REJECTIONS VISIBLE, AND VERIFY THE CONFIGURED ORIGIN
============================================================
```

```
Add explicit server-side logging whenever an incoming request's Origin header
does not match any entry in CORS_ORIGINS - log the rejected origin and the
currently-configured allowed list. Right now a mismatch fails silently from
the server's point of view (the browser blocks it client-side with no trace in
your own logs), which makes this exact class of bug slow to diagnose. This
logging should make it immediately visible in Cloud Run logs going forward.
```

```
Then confirm directly what CORS_ORIGINS is currently set to on the live
dristiscan-backend Cloud Run service (gcloud run services describe
dristiscan-backend --region asia-south1, or the Cloud Run console's
Variables & Secrets tab) - do not assume it's missing or present, check it.
Set it to the exact live Vercel URL if it isn't already there. If more than
one Vercel URL is in active use (for example a production URL and a preview
deployment URL), include all of them, comma-separated, matching how the code
already parses this variable.
```

```
============================================================
SECTION 3: CONFIRM NODE_ENV ON THE BACKEND CLOUD RUN SERVICE
============================================================
```

```
Section 1's fix depends on NODE_ENV being exactly 'production' in the
deployed environment - Cloud Run does not set this automatically. Confirm
directly whether it's currently set on dristiscan-backend, and set it
explicitly if it isn't. Do not assume it's already there.
```

```
============================================================
SECTION 4: REQUIRED VERIFICATION
============================================================
```

```
After redeploying the backend with these changes:
```

```
1. On the live Vercel site, start a guest session in the Officer section,
then reload the page. Confirm the session persists and the user is not
bounced back to the sign-in screen.
```

```
2. On the live Vercel site, run a Consumer scan with a real package photo.
Confirm it completes without falling back to the generic "Scan processing
failed" error.
```

```
3. During both tests, open the browser DevTools Network tab and confirm no
CORS error appears, and check that the guest/login response's Set-Cookie
header actually reads SameSite=None; Secure.
```

```
Report this with actual evidence (console/network output, or screenshots) -
not just a statement that it works now, given both of these were already
assumed fixed once before during initial deployment.
```

```
============================================================
SECTION 5: COMMIT AND PUSH TO GITHUB
============================================================
```

```
Commit these changes following the existing commit message convention already
used in this repo (short, scoped, imperative - e.g. "fix(auth): use
SameSite=None; Secure for cross-origin cookie compatibility" and "fix(cors):
log rejected origins for easier diagnosis"). Push to the main branch at
https://github.com/bitsubhayu/dristiScan so the fix is reflected in the
remote repository, not left as a local or console-only change. After pushing,
redeploy the dristiscan-backend Cloud Run service so the live site is actually
running this code - a push alone does not update the running service unless
your deploy process is connected to auto-deploy from GitHub.
```

```
============================================================
DEFINITION OF DONE
============================================================
```

```
1. setAuthCookie (and any other cookie-setting code found) uses SameSite=None
and Secure=true in production, verified against the actual deployed behavior,
not just the code.
```

```
2. CORS_ORIGINS on the live backend Cloud Run service is confirmed to include
the exact live Vercel URL(s) in use.
```

```
3. A rejected CORS origin is now logged server-side instead of failing
silently.
```

```
4. NODE_ENV=production is confirmed set on the backend Cloud Run service.
```

```
5. Guest login persists across a page reload, and Consumer OCR scan completes
without the generic fallback error - both confirmed live, with evidence shown.
```

```
6. All changes are committed with clear messages and pushed to the main
branch on GitHub, and the backend Cloud Run service is redeployed with this
code.
```

```
7. Nothing outside auth/CORS/cookie/deploy config was touched.
```

```
============================================================
SEPARATE NOTE - NOT PART OF THIS CODE PUSH
============================================================
```

```
Independently of anything above, consider setting min instances to 1 on the
dristiscan-ocr Cloud Run service (currently 0) to eliminate cold-start model-
loading delays, especially before any live demo or judging session. This is a
Cloud Run configuration change, not a code change, and doesn't need a commit -
just note it as a follow-up action to take via the Cloud Run console or gcloud.
```
