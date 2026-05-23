# Secret Rotation Runbook (P0-Z2)

**Status:** living document — update after every real rotation.
**Owner:** platform on-call (rotate quarterly).
**Last full rotation:** _(record when first executed)_

---

## When to rotate

Run this runbook when any of the following is true:

1. **Calendar trigger** — any service's secret age exceeds **90 days**
   (tracked by the `secret_age_days{service}` gauge; alert fires at 90).
2. **Departure trigger** — anyone with prior access to the rotated value leaves the project.
3. **Incident trigger** — leak detected (gitleaks alert, GitHub secret scanner, paste in chat, lost laptop).
4. **Forward-only rollback** — if a freshly-rotated secret needs to be revoked,
   you do not roll BACK; you rotate FORWARD to a third value. Treat rollback as a
   second rotation, not a restore.

---

## Threat model recap (why this runbook is structured this way)

The L1 (lefthook) + L2 (gitleaks) + L3 (lint-guard) guards installed in P0-Z0 +
P0-Z2 prevent a future leak via commit. They do **not** retroactively clean a
secret that already escaped. Rotation is the **only** remediation for an
already-leaked value. Speed matters — most automated credential abuse starts
within minutes of a public leak.

World-class anchors:
- OWASP ASVS V2.10 (Service Authentication)
- NIST SP 800-57 Part 1 Rev. 5 §5.3 (key-rotation cadence)
- CWE-798 (Hard-coded credentials), CWE-321 (Hard-coded crypto key)
- 12-Factor App: III. Config

---

## Pre-flight (do these BEFORE touching any console)

1. **Open a coordination doc** — short title `Rotation YYYY-MM-DD @<service>`,
   pin in the team chat. Every step lands an update there. If you are alone,
   still write it — your future self will read it during the incident review.
2. **Inventory who is using the secret right now** — count active sessions on
   Supabase Studio, recent deploys, current Stripe webhook events. Some rotations
   invalidate every existing session (notably Supabase JWT signing key); plan a
   maintenance window if user impact is non-trivial.
3. **Verify CI has the secret as an environment variable**, not embedded in a
   workflow file (`grep -r 'sk_live_\|eyJ\|sbp_' .github/workflows/` should
   return nothing real — only pattern references in docs).
4. **Tell the on-call channel you're starting**, name the service, ETA 10 min
   per service.

---

## Per-service rotation steps

Each section is a self-contained checkbox list. Target: **≤ 10 min per service**.
Skip a section only if that service is not yet integrated.

### Supabase — JWT signing secret

The JWT secret signs the `anon` and `service_role` keys. Rotating it **invalidates
every active user session immediately** — they will get logged out. Coordinate.

- [ ] Supabase Dashboard → Project → Settings → API → "Reset JWT secret"
- [ ] Wait for the dashboard to reissue new `anon` and `service_role` keys
- [ ] Copy the new `anon` key — that's the public-facing one
- [ ] Update GitHub repo secrets: `VITE_SUPABASE_ANON_KEY`
- [ ] Update Vercel project env vars (Production + Preview + Development):
      `VITE_SUPABASE_ANON_KEY`
- [ ] Update Supabase Edge Function env (Studio → Edge Functions → Settings →
      Secrets): the edge functions usually use `SUPABASE_SERVICE_ROLE_KEY`,
      which Supabase rotates automatically. Verify by listing secrets and
      checking the timestamp matches.
- [ ] Trigger a fresh Vercel deploy (any branch) so the new anon key takes effect.
- [ ] Smoke-test: log in to staging from an incognito browser, confirm SOS button works.
- [ ] Record in the coordination doc: rotation timestamp + the GitHub-Action run that
      picked up the new key.

### Supabase — Personal Access Token (`sbp_…`, used by CI)

Used by the function-drift probe and any other CI tooling that calls the
Management API. Tied to a human account; rotate if that human leaves.

- [ ] Supabase Dashboard → Account → Access Tokens → "Generate new token"
- [ ] Scope: as minimal as the consuming tooling needs (read-only if possible)
- [ ] Copy the token (shown ONCE)
- [ ] Update GitHub repo secret: `SUPABASE_ACCESS_TOKEN`
- [ ] Revoke the OLD token from the same dashboard
- [ ] Trigger a CI run that uses the token (e.g. `Probes` workflow) — confirm green
- [ ] Record token expiry date if you set one; add a calendar reminder 14 days before

### Vercel — OIDC session + deploy hook

- [ ] Vercel Dashboard → Account → Settings → Tokens → revoke the old token
- [ ] Issue a new token, name it `ci-deploy-YYYY-MM-DD`, scope to the project only
- [ ] Update GitHub repo secret: `VERCEL_TOKEN` (or whatever name your workflow uses)
- [ ] Also rotate `VERCEL_OIDC_TOKEN` if it exists in `.env.local` (developer-local)
- [ ] If you use a deploy hook URL: regenerate it in Project → Settings → Git → Deploy Hooks
- [ ] Trigger a manual deploy via the new token — confirm success

### Stripe — webhook signing secret + restricted API key

If Stripe is not yet integrated for this environment, skip.

- [ ] Stripe Dashboard → Developers → Webhooks → click the relevant endpoint →
      "Roll signing secret"
- [ ] Update GitHub repo secret + Supabase Edge Function env:
      `STRIPE_WEBHOOK_SIGNING_SECRET`
- [ ] Stripe Dashboard → Developers → API keys → restricted keys → revoke + create new
- [ ] Update CI/Supabase env: `STRIPE_RESTRICTED_KEY`
- [ ] Send a test webhook from the Stripe dashboard — confirm the edge function
      returns 200 and `log_sos_audit` writes a row
- [ ] **Do NOT roll the secret API key (`sk_live_…`) without coordination** — it
      breaks every consumer immediately. Roll it only on real-incident triggers.

### Twilio — API key + auth token + messaging service SID

If Twilio is not yet integrated, skip.

- [ ] Twilio Console → Account → API keys → revoke old + create new (Standard,
      not Master)
- [ ] Twilio Console → Account → General settings → Auth Token → rotate (this
      affects all webhook signatures; coordinate with edge function deploy)
- [ ] Update Supabase Edge Function env: `TWILIO_API_KEY_SID`,
      `TWILIO_API_KEY_SECRET`, `TWILIO_AUTH_TOKEN`
- [ ] If the messaging service SID was leaked, create a new one and reassign
      the phone numbers
- [ ] Smoke test: trigger an SMS via the `sos-dispatch-probe` edge function

### FCM — service-account JSON

- [ ] Firebase Console → Project Settings → Service Accounts → "Generate new
      private key" → download the JSON
- [ ] Store the JSON content in GitHub repo secrets: `FCM_SERVICE_ACCOUNT_JSON`
      (paste the raw JSON; the workflow base64-decodes it)
- [ ] Update Supabase Edge Function env: `FCM_SERVICE_ACCOUNT_JSON`
- [ ] Revoke the OLD service-account key from the same dashboard
- [ ] Smoke test: send a test push to a known device

### Google OAuth — client secret (server-side flow only)

The `VITE_GOOGLE_CLIENT_ID` is public by design and does not rotate. If you have
a server-side OAuth flow that uses a CLIENT SECRET, rotate that instead:

- [ ] Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client →
      Add new secret → mark old one for deletion in 7 days (grace window)
- [ ] Update server env: `GOOGLE_OAUTH_CLIENT_SECRET`
- [ ] After 7 days, delete the old secret

---

## Post-rotation verification

Run these in order. Any failure = rotation is NOT complete.

1. `npm run test:secret-guard` — confirms no rotated value accidentally landed
   in `.env.example` or a tracked file
2. `git status` — must not show any `.env`, `.env.local`, or `*.env` file
3. `git log -p --since="1 hour ago"` — visually scan for any pasted token
4. Trigger a synthetic SOS probe end-to-end against staging — confirms the new
   keys actually work in the live path
5. Update the coordination doc with the smoke-test result + any deviation from
   the runbook

---

## If a rotated secret leaks IMMEDIATELY (within minutes of issuance)

This means the leak path is still open — rotation alone won't help. Do BOTH:

1. Rotate AGAIN to a third value (the second rotation closes the window where
   the leaked second-value was accepted)
2. Find the leak source NOW — usually a `console.log`, a Sentry breadcrumb, an
   error message that includes the secret, a CI log artifact retained too long,
   or a chat-paste. Fix the leak source before issuing rotation #3.

---

## Telemetry hooks (to add as P0-Z2 follow-up)

The Z2 plan calls for these — they are documented here so the runbook stays the
single source of truth even before the wiring lands:

- Log event: `secret_rotation` with fields
  `{service, rotated_at, rotated_by, expires_at}`
- Metric: `secret_age_days{service}` (gauge), threshold 90d → ticket auto-filed
- Alert: any secret with age > 90 days fires a low-severity ticket; > 120 days
  escalates to on-call paging

---

## Files of interest

| Path | Why |
|------|-----|
| `.env.example` | Single source of truth for which keys exist. Must stay placeholder-only — tested by `npm run test:secret-guard`. |
| `lefthook.yml` → `block-secrets-touch` | L1 commit-time gate that catches `.env`/`*.env` modifications. `.env.example` is explicitly allowlisted. |
| `scripts/__behavior_tests__/secret-guard.spec.mjs` | Pattern contract — adding a new secret type? Add its regex + bad fixture + good fixture here first. |
| `docs/runbooks/secret-rotation.md` | This file. |

---

## Change log

| Date | Editor | Change |
|------|--------|--------|
| 2026-05-23 | P0-Z2 | Initial draft alongside .gitignore tightening + secret-guard test. |
