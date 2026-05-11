# SOSphere Operations Runbook

Last updated: 2026-05-11 (post foundation-pyramid build)

This is the deployment + incident-response document for SOSphere.
Read this before pushing changes that touch the SOS dispatch path,
the Twilio integration, or the monitoring probes.

---

## 1. Architecture Overview — the Foundation Pyramid

The platform is built in layers. Each layer adds resilience on top
of the previous. If something fails, **trace top-down**: start with
the highest layer that should have caught it.

```
┌─────────────────────────────────────────────────────────────┐
│ L5 — Launch readiness  (this runbook + .env.example)        │
├─────────────────────────────────────────────────────────────┤
│ L4 — Infrastructure resilience                              │
│   L4-A  withDbRetry on sos-alert critical-path writes       │
│   L4-B  /sos-health public endpoint for uptime monitors     │
├─────────────────────────────────────────────────────────────┤
│ L3 — Client hardening                                       │
│   L3-A  React.lazy on dashboard pages (-1.5MB initial)      │
│   L3-B  React.lazy on mobile-app screens (-400KB)           │
│   L3-C  Audit-log trigger uses index (76× speedup)          │
├─────────────────────────────────────────────────────────────┤
│ L2 — Pipeline hardening                                     │
│   L2-A  Twilio circuit breaker (per-tenant)                 │
│   L2-B  Per-leg dispatch_attempts ledger                    │
│   L2-C  Single SOS replay path (no dual queue)              │
│   L2-D  audit_log SHA-256 hash chain                        │
│   L2-E  Voice retry cascade (≤2 attempts, all tiers)        │
│   L2-F  Inbound SMS replies + ack classifier                │
│   L2-G  Post-call forensic photo capture                    │
│   L2-H  Evidence chain-of-custody + UI surfaces             │
├─────────────────────────────────────────────────────────────┤
│ L1 — Observability                                          │
│   L1-A  trace_id end-to-end                                 │
│   L1-B  Pipeline observability columns                      │
│   L1-C  SLA metrics + ack pipeline                          │
│   L1-D  Synthetic probes                                    │
│         Phase 1   internal pipeline probe                   │
│         Phase 2   Twilio config drift (per-phone)           │
│         Phase 2.5 routing-aware (Messaging Services)        │
│         Phase 3   synthetic inbound SMS end-to-end          │
│         Phase 3.5 GitHub Actions cron (every 15 min)        │
│   L1-E  Pipeline health checks                              │
└─────────────────────────────────────────────────────────────┘
```

Foundation tests: **~450 architectural invariants** in
`src/app/components/__tests__/`. Every layer has both behavior
unit tests AND structural lock-in tests so a future refactor
that drops a contract fails CI immediately.

---

## 2. Deployment Checklist

### 2.1 First-time setup (one repo + one person, ~20 min)

**Vercel side:**
1. Connect the GitHub repo
2. Set environment variables (see `.env.example` for the full list):
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - `VITE_GOOGLE_CLIENT_ID`
   - `VITE_SENTRY_DSN` (production only)
   - `VITE_TWILIO_ENABLED=true` once Twilio is provisioned

**Supabase side:**
1. Run `supabase db push` to apply all migrations
2. Set edge-function secrets (the list at the bottom of `.env.example`):
   ```bash
   supabase secrets set TWILIO_ACCOUNT_SID=ACxxxxx
   supabase secrets set TWILIO_AUTH_TOKEN=xxxxx
   supabase secrets set TWILIO_FROM_NUMBER=+1xxxxxxxxxx
   supabase secrets set SOSPHERE_BASE_URL=https://sosphere-platform.vercel.app
   supabase secrets set PROBE_SECRET=$(openssl rand -hex 32)   # or PowerShell equivalent
   ```
3. Deploy edge functions:
   ```bash
   supabase functions deploy sos-alert
   supabase functions deploy sos-bridge-twiml
   supabase functions deploy twilio-call
   supabase functions deploy twilio-sms
   supabase functions deploy twilio-status
   supabase functions deploy sos-sms-inbound
   supabase functions deploy twilio-config-probe
   supabase functions deploy sos-inbound-probe
   supabase functions deploy sos-health
   ```
   (`supabase functions deploy --all` works if your CLI version supports it.)

**Twilio side:**
1. Buy a phone number
2. **Phone Numbers → Manage → Active Numbers → [your number]:**
   - Messaging Configuration → "A message comes in":
     - URL: `https://<project>.functions.supabase.co/sos-sms-inbound`
     - Method: HTTP POST
   - Voice Configuration → "A call comes in" (optional):
     - URL: `https://<project>.functions.supabase.co/sos-bridge-twiml`
     - Method: HTTP POST
3. (Optional, for higher volume) Create a Messaging Service with the
   same inbound webhook on its Integration tab. If you do this, the
   per-number config is ignored — the Service is authoritative.

**GitHub Actions side:**
1. Repository Settings → Secrets and variables → Actions → New repo secret:
   - `SUPA_FN_URL = https://<project>.functions.supabase.co`
   - `PROBE_SECRET = <same value as the Supabase secret>`
2. The probe workflow (`.github/workflows/probes.yml`) auto-runs every
   15 min after this. Trigger one manual run via Actions tab → "SOSphere
   Probes" → Run workflow, to verify the secrets.

### 2.2 Recurring deploy (after a normal feature push)

```bash
git push                                    # Vercel rebuilds the frontend

# Only if any edge function changed:
supabase functions deploy <name>

# Only if any migration was added:
supabase db push
node scripts/check-migration-drift.mjs --update
git add supabase/migrations.lock.json && git commit -m "chore: update lockfile"
git push
```

---

## 3. Secret Inventory + Rotation

| Secret | Lives in | Rotation procedure |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Supabase secrets | Twilio Console → Settings → API Keys. Update + re-deploy edge fns. |
| `TWILIO_AUTH_TOKEN` | Supabase secrets | Twilio Console → "Primary Auth Token" → Request Secondary → Promote. Update Supabase secret + redeploy. **Heads-up: inbound SMS signature validation breaks momentarily during the rotation window.** |
| `TWILIO_FROM_NUMBER` | Supabase secrets | Buy new number in Twilio Console, reconfigure webhooks (see 2.1 Twilio side), update secret + redeploy. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secrets (auto) | Supabase Dashboard → Project Settings → API → rotate. **Affects ALL edge functions** — redeploy everything after rotation. |
| `PROBE_SECRET` | Supabase secrets + GitHub Actions repo secret | Generate new hex value. Update BOTH places. Redeploy `twilio-config-probe` + `sos-inbound-probe`. The GitHub workflow will start using the new value on its next 15-min run. |
| `VITE_SENTRY_DSN` | Vercel env vars | Sentry → Project Settings → Client Keys (DSN). Update Vercel + redeploy frontend. |

**Critical rule**: anywhere a secret appears, it must be set in ALL
environments (dev, staging, production). Drift between environments
is what causes signature failures + cryptic 403s.

---

## 4. Synthetic Probes — Daily Operation

### 4.1 Manual run (post-deploy verification)

```powershell
$secret = "<your PROBE_SECRET>"
$base   = "https://<project>.functions.supabase.co"

# L1-D Phase 2.5: Twilio webhook config drift
Invoke-RestMethod -Method Post -Uri "$base/twilio-config-probe" `
  -Headers @{ Authorization = "Bearer $secret" } | ConvertTo-Json -Depth 5

# L1-D Phase 3: synthetic end-to-end inbound SMS
Invoke-RestMethod -Method Post -Uri "$base/sos-inbound-probe" `
  -Headers @{ Authorization = "Bearer $secret" } | ConvertTo-Json -Depth 5

# L4-B: public health endpoint (no auth)
Invoke-RestMethod -Uri "$base/sos-health" | ConvertTo-Json -Depth 5
```

### 4.2 Interpreting probe output

| Probe | Healthy output | Common failure modes |
|---|---|---|
| `twilio-config-probe` | `driftedCount: 0` (or `voice_url` warning only) | sms_url drift = Twilio webhook unconfigured; service_drift = Messaging Service Integration tab not pointing at sos-sms-inbound |
| `sos-inbound-probe` | `pass: true`, all stages ok, `elapsedMs < 2000` | `post: failed` = signature mismatch (token drift OR http/https URL mismatch); `verify: missing` = handler ran but DB write failed |
| `sos-health` | HTTP 200, `supabase: "up"` | HTTP 503 = Supabase unreachable; HTTP timeout = function deployment broken |

### 4.3 The cron (automatic, every 15 min)

`.github/workflows/probes.yml` calls both probes. A failed run emails
repo admins by default (GitHub Settings → Notifications). For Slack
/ PagerDuty alerts, add a webhook step to the workflow.

---

## 5. Incident Response Playbook

### 5.1 "All inbound SMS replies are getting dropped"

**Symptoms:** `sos-inbound-probe` returns `pass: false`, HTTP 403,
`debug_url` in the response.

**Likely cause (1):** Twilio webhook isn't pointing at sos-sms-inbound.
- Fix: Twilio Console → Phone Numbers → number → Messaging → set "A
  message comes in" to `<base>/sos-sms-inbound` POST.

**Likely cause (2):** TWILIO_AUTH_TOKEN drift between Twilio and Supabase.
- Fix: copy the Auth Token from Twilio Console, paste into
  `supabase secrets set TWILIO_AUTH_TOKEN=...`, redeploy
  `sos-sms-inbound`.

**Likely cause (3):** `req.url` protocol mismatch (the L1-D Phase 3
bug from 91ba7ff). Fix is already in place; if you see this resurface,
verify `canonicalUrl = req.url.replace(/^http:\/\//, "https://")` is
still in `sos-sms-inbound/index.ts`.

### 5.2 "Twilio circuit breaker is stuck open"

**Symptoms:** Real SOS triggers complete but `sos_dispatch_attempts.outcome`
is `breaker_open` for many legs.

**Cause:** L2-A breaker tripped due to many consecutive failed Twilio
calls. Auto-resets after the breaker's cool-down window (~60s).

**Action:**
1. Check Twilio Console → Monitor → Errors for the underlying failures.
2. If Twilio API is genuinely down: wait. The breaker will half-open
   and probe in ~60s.
3. If Twilio API is fine: there's a credential issue. Check
   `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` in Supabase secrets;
   redeploy edge functions to refresh env.

### 5.3 "Migration applied to live DB but not in git"

**Symptoms:** CI fails on "Migration Drift Guard" job.

**Cause:** Someone used the Supabase web SQL editor to make a schema
change without going through `supabase/migrations/`.

**Action:**
1. From the Supabase Dashboard SQL editor, pull the offending change.
2. Write a proper migration file: `supabase/migrations/<timestamp>_<name>.sql`
3. Run `node scripts/check-migration-drift.mjs --update`
4. Commit both the migration AND the regenerated `migrations.lock.json`.

### 5.4 "Vercel says BUILD FAILED after my push"

**Symptoms:** Push triggered Vercel build, build log shows syntax error.

**Cause:** Likely a TypeScript-permissive-but-esbuild-strict pattern
(double-closing braces, etc). Edge functions in `supabase/functions/`
are bundled by esbuild, NOT by TypeScript — they pass tsc but fail
esbuild.

**Action:**
1. Locally: `node_modules/.bin/esbuild --bundle --platform=neutral \\
   --target=es2022 --external:* <function>/index.ts > /dev/null`
2. Fix the error, repush.
3. Defensive: this is why every edge-function commit in this repo
   runs `esbuild --bundle` before commit during the build cycle.

### 5.5 "Sentry isn't receiving errors but I know something broke"

**Symptoms:** Production error report from user but Sentry dashboard
empty.

**Action:**
1. Open `https://sosphere.sentry.io/issues/`
2. From production console, run `window.__sosSentryTest()` —
   this fires a controlled message to Sentry's ingest. Should appear
   within ~30s.
3. If no event appears: `VITE_SENTRY_DSN` is not set in Vercel
   production env. Set it and redeploy.

---

## 6. Edge Function Inventory

| Function | Purpose | Auth | verify_jwt | Deploys with |
|---|---|---|---|---|
| `sos-alert` | Main SOS trigger orchestrator | JWT (user) | true | every release |
| `sos-bridge-twiml` | Twilio bridge / announce TwiML generator | Twilio signature | false | rare |
| `twilio-call` | Outbound voice call | JWT | true | rare |
| `twilio-sms` | Outbound SMS send | JWT | true | rare |
| `twilio-status` | Twilio status callback receiver | Twilio signature | false | L2-E2 / L1-D3 changes |
| `twilio-token` | Twilio access token for client SDK | JWT | true | rare |
| `sos-sms-inbound` | L2-F inbound SMS reply handler | Twilio signature | false | L2-F / L1-D3 changes |
| `twilio-config-probe` | L1-D Phase 2/2.5 config drift probe | `PROBE_SECRET` bearer | false | probe changes |
| `sos-inbound-probe` | L1-D Phase 3 synthetic inbound | `PROBE_SECRET` bearer | false | probe changes |
| `sos-health` | L4-B public health pulse | none | false | rare |
| `dashboard-actions`, `incident-history`, `incident-report-data`, `invite-employees`, `process-bulk-invite`, `send-invitations`, `send-push-notification`, `stripe-checkout`, `stripe-portal`, `stripe-webhook`, `delete-account`, `export-my-data` | Various non-emergency surfaces | per-function | per-function | per-feature |

---

## 7. Hard rules + foot-guns

1. **Never reproduce TWILIO_AUTH_TOKEN in code.** It lives ONLY in
   Supabase secrets. The signature compute helper reads it via
   `Deno.env.get`.
2. **Never push debug code that logs secrets.** The
   `SIG_MISMATCH_DEBUG` log explicitly logs `token_len`, NOT `token`.
   If you add a similar debug, follow that pattern.
3. **Never bypass the L2-D audit hash chain.** Inserting into
   `audit_log` outside the `log_sos_audit` RPC breaks `prev_hash`
   continuity. Forensic value collapses.
4. **Never use the bare `sos-live` Realtime channel name.** Always
   tenant-scope to `sos-live:<companyId>` or `sos-live:civilian:<userId>`.
   The bare channel name is a known cross-tenant PHI leak (W3-3).
5. **Never delete an edge function's `verify_jwt = false` config
   for a webhook endpoint.** Twilio and PROBE_SECRET endpoints
   carry their own auth; Supabase's JWT gateway would 401 them.
6. **Run the architectural invariants tests before committing.** Many
   contracts that look optional are load-bearing — e.g., the L2-D
   canonical SHA-256 input field order is frozen because changing it
   breaks every tenant's existing chain.

---

## 8. Where to look for help

| Question | File |
|---|---|
| "How does the SOS dispatch flow work?" | `docs/SOS_FLOW_DESIGN.md` |
| "What's the foundation pyramid?" | `docs/LIFE_SAFETY_FOUNDATION.md` |
| "What invariants are locked?" | `src/app/components/__tests__/l*-*.test.ts` |
| "How is data laid out?" | `supabase/migrations/` (chronological order) |
| "Why does this old comment say X?" | `git log -p -- <file>` — comments cross-reference commit hashes |
