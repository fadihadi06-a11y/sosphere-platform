# SOSphere — Red-Team Audit Wave 3 (Deep, Multi-Angle)

**Date:** 2026-04-26
**Method:** 6 independent agents, parallel, each focused on one angle, none aware of others' findings.
**Coverage:** Civilian flow, Company/Admin flow, Edge functions, DB state-machine + RLS, Client state-machines + leaks, Cross-component handoffs.
**Output:** ~100 distinct findings; this report deduplicates and prioritizes.

> ⚠️ Some findings **contradict prior fix claims** (G-17, G-18, G-29, G-41). Those are flagged `[VERIFY-FIRST]` — first action of execution session must confirm before fixing.

---

## 🔥 TIER 0 — CRITICAL (must fix before launch — 14 items)

### **W3-1 — `userId` plumbing broken end-to-end for civilians**
**Source:** Agent C (civilian flow). **Severity: CRIT**
- `mobile-app.tsx:1664` passes `userId={`EMP-${loginName.replace(/\s+/g, "")}`}` into `<SosEmergency>`.
- `sos-server-trigger.ts:523` ships this as `payload.userId`.
- `sos-alert/index.ts:890` enforces `payload.userId === auth.uid()` → **always 403** for civilian Path B.
- Cascading: heartbeat 404, escalate 404, end 404, no `sos_sessions` row, no `audit_log`, no dashboard broadcast.
- **The regression test at `__tests__/sos-server-trigger-userid.test.ts` documents the correct fix; production code never adopted it.**
- **Impact:** Every civilian SOS server-side leg fails silently; only local Twilio dialer (Path A) works. Server-side audit chain is empty for civilians.

### **W3-2 — Stripe webhook G-29 dedup is UNWIRED** `[VERIFY-FIRST]`
**Source:** Agent A (company flow) + Agent D (DB). **Severity: CRIT**
- `processed_stripe_events` table created via migration `20260426110000_g_29_stripe_event_dedup.sql`.
- `grep processed_stripe_events supabase/functions/stripe-webhook/index.ts` → **zero matches**.
- The dedup table is read/written ONLY by the test script.
- Combined with timestamp `Math.abs` window (W3-7), every Stripe event is reprocessed on every retry, reflipping `subscriptions.status`.
- **Impact:** Replay attack window is 5 minutes; an attacker who captures one valid `customer.subscription.updated` body can lock subscription state.

### **W3-3 — Realtime broadcast channels NOT tenant-scoped (cross-tenant PHI leak)**
**Source:** Agent A + Agent S (handoffs). **Severity: CRIT**
- 4 globally-named channels: `sos-live` (sos-alert/index.ts:1380), `evidence-changes` (evidence-store.ts:234,501), `missions` (mission-store.ts:10), `chat-${emergencyId}` (shared-store.ts:1889,1955).
- No Realtime Authorization configured (no policies on `realtime.messages`, no `private:true`).
- Any authenticated user `supabase.channel("sos-live").subscribe(...)` receives **every tenant's** SOS payload (employee name, lat/lng, contact list, blood type).
- Forged broadcasts: attacker can `send()` fake `EVACUATE`/`STATUS_UPDATE` payloads into another tenant's `admin:${companyId}` channel.
- **Impact:** Cross-tenant PII/PHI broadcast over Supabase Realtime. Privacy violation + spoofing.

### **W3-4 — `twilio-status/index.ts` source is corrupted (lines 407-471 unparseable)**
**Source:** Agent E (edge functions). **Severity: CRIT**
- Orphan duplicate `logCallEvent` body, fragment statements `status,`, `call_sid:`, stray `catch (e)` at top level.
- Deno `tsc` will reject this file. Any future `supabase functions deploy twilio-status` from this tree fails OR deploys broken code that throws on first invocation.
- **Impact:** Every Twilio status callback returns 500 → call lifecycle never recorded → uncapped Twilio billing on stuck conferences.

### **W3-5 — `sos-bridge-twiml` has no auth, no signature, no gtok** `[VERIFY-FIRST]`
**Source:** Agent E. **Severity: CRIT**
- G-17 was claimed to require `gtok` on this function.
- Agent E reports that `?action=accept&userPhone=+15551234567&emergencyId=anything` triggers a real Twilio outbound call to attacker-chosen number on our bill.
- Conflict with prior G-17 fix claim — **must verify by reading the deployed v14 code first**.
- **If true:** classic toll-fraud + harassment vector + information disclosure (loadAiScript leaks Elite scripts).

### **W3-6 — `AbortSignal.timeout` not used by ANY edge function** `[VERIFY-FIRST]`
**Source:** Agent E. **Severity: CRIT**
- `grep -r "AbortSignal.timeout" supabase/functions/` → reports zero matches.
- G-41 was claimed deployed only in sos-bridge-twiml v14. Agent claims even that is unwired.
- **Must verify by reading deployed v14**.
- **Impact:** A degraded Twilio/Stripe API hangs the entire Deno worker until 150s timeout, on the most life-critical path.

### **W3-7 — Stripe-webhook timestamp uses `Math.abs` (accepts future-dated `t`)**
**Source:** Agent A. **Severity: CRIT (combined with W3-2)**
- `stripe-webhook/index.ts:60-62`: `const age = Math.abs(Date.now()/1000 - Number(t)); if (age > 300) return false;`.
- Stripe's recommended check is one-sided: `Date.now()/1000 - t > tolerance`.
- A `t` 4 minutes in the FUTURE is accepted. Doubles the replay window.
- **Impact:** Combined with W3-2 (no event-id dedup), an intercepted valid webhook can be replayed indefinitely within ±5 min of the signed `t`.

### **W3-8 — `audit_log` writable + DELETE-able by every authenticated user**
**Source:** Agent D. **Severity: CRIT**
- `role_table_grants` shows `authenticated` AND `anon` hold `INSERT, UPDATE, DELETE, TRUNCATE` on `audit_log` and `audit_logs`.
- RLS without a `WITH CHECK` policy denies writes — but the table-level grants remain broad. **One `DROP POLICY` migration away from total tampering**, and no `FORCE ROW LEVEL SECURITY`.
- Anon-key ships in mobile app; if anyone inadvertently disables RLS for one query, the entire forensic audit chain is rewritable.
- **Impact:** Tamper-evidence rests on one RLS toggle. Defense-in-depth is missing.

### **W3-9 — `log_emergency_changes` trigger writes to `audit_log` with mismatched schema** `[VERIFY-FIRST]`
**Source:** Agent D. **Severity: CRIT**
- Trigger inserts `(table_name, record_id, action, user_id, new_data, old_data)` but `audit_log` columns are `(id, action, actor, actor_role, operation, target, target_name, metadata, ...)`.
- Every UPDATE/INSERT on `emergencies` triggers this function → INSERT fails → originating `emergencies` write rolls back.
- **If true: the entire `emergencies` state machine is broken in production.** Could be why server-side civilian SOS path also fails.
- **Must verify** by reading `pg_proc` for `log_emergency_changes` body via Supabase MCP.

### **W3-10 — Deactivation PIN broken: user CANNOT end their own SOS after migration**
**Source:** Agent S. **Severity: CRIT**
- `duress-service.ts:43-45,107` writes `sosphere_deactivation_pin = "__legacy_pre_hash__"` after migration.
- `sos-emergency.tsx:2781` does `pinInput === storedPin` → **only the literal string `__legacy_pre_hash__` matches**, OR `1234` (the fallback default).
- Real user with their real PIN cannot deactivate. Anyone who types `1234` deactivates.
- **Impact:** Catastrophic UX — user can't end their own SOS, must reboot phone.

### **W3-11 — App never reads `subscriptions` table; tier source-of-truth is localStorage only**
**Source:** Agent S. **Severity: CRIT**
- `stripe-webhook/index.ts:132` upserts `subscriptions.tier=planId`.
- `subscription-service.ts:144,161-184` reads only `localStorage["sosphere_subscription"]`.
- Customer pays for Elite → webhook updates DB → app stays on Free until they manually call `setSubscription()` somewhere (which they don't).
- Conversely: cancel/downgrade doesn't take effect until logout/login.
- **Impact:** Refund-bait. Also revenue leak — owner-side cancel doesn't strip Elite from their device.

### **W3-12 — `evidence-vault-service.ts` is dead code; nothing creates a vault**
**Source:** Agent S. **Severity: CRIT (false-marketing)**
- `grep -r "evidence-vault-service" src/` → zero non-self importers.
- The whole "tamper-evident encrypted evidence vault with SHA-256 lock-after-24h" feature is wired to `sosphere_evidence_vaults` but the localStorage key is never written.
- Production evidence path uses `evidence-store.ts` (different key `sosphere_evidence_vault` — singular).
- B-15/B-16 migration (text→uuid) was applied to `evidence_vaults` table that nothing populates.
- **Impact:** PDF/UI claims encrypted vault that doesn't exist. Compliance claim is false.

### **W3-13 — `last-breath` sendBeacon strips Authorization → sos-alert 401s**
**Source:** Agent S. **Severity: CRIT**
- `last-breath-service.ts:189` uses `navigator.sendBeacon(`${url}/sos-alert`, beaconData)`.
- `sendBeacon` cannot set custom headers. `sos-alert` requires `Authorization: Bearer ...` and 401s.
- **The literal "user is dying, send my last SOS as page unloads" code path always fails server-side.**
- Local code logs "Sent via sendBeacon" but server returns 401 and never fans out.

### **W3-14 — `sos-alert.resolveTier` queries employee's PERSONAL Stripe sub, not company's**
**Source:** Agent A. **Severity: CRIT for B2B revenue**
- `sos-alert/index.ts:393-421`: `subscriptions.select(...).eq("user_id", userId)` where `userId` is the JWT subject (employee).
- Company subscriptions are paid by the OWNER against owner's `user_id`. Employees never have a row.
- Every B2B employee SOS resolves to `tier="free"` → no TTS call, no conference bridge, no recording.
- Dashboard advertises Elite features the employees can never receive.
- **Impact:** Every paying B2B customer's employees get free-tier SOS. Direct violation of paid contract.

---

## 🟧 TIER 1 — HIGH (~25 items, summary)

| ID | Source | Summary |
|---|---|---|
| W3-15 | C-3 | Civilian-mode `gps_trail.employee_id` + `evidence_vaults.user_id` INSERTs fail uuid cast (post-B15/16) |
| W3-16 | A-3 | Owner registration bypasses `create_company` RPC; writes via anon `.upsert` (RLS gap or dead code) |
| W3-17 | A-4 | `invite_code` uses `Math.random()` (32-bit predictable); brute-forceable in <1k attempts |
| W3-18 | A-5 | `log_sos_audit` never sets `company_id` → audit rows for dispatcher actions invisible to dashboard reads |
| W3-19 | A-6 | Resolve / acknowledge / assign / broadcast in `dashboard-actions` have no state-machine guard or row lock |
| W3-20 | A-8 | `delete_user_completely` casts `gps_trail.employee_id::text` after B-15 made it uuid → GDPR cascade aborts |
| W3-21 | A-9 | `get_my_subscription_tier()` treats `past_due` as active → up to 21 days free Elite after card fails |
| W3-22 | A-13 | `audit_log` INSERT policy lets any auth'd company member forge audit entries (subject also to W3-8) |
| W3-23 | C-4 | `delete-account` doesn't wipe `subscriptions` row directly; relies on auth.users CASCADE which often fails partial |
| W3-24 | C-5 | Mid-SOS Stripe upgrade does NOT take effect for the running emergency |
| W3-25 | C-9 | `sosphere_gps_trail` shared across users on shared devices; substring `includes()` filter cross-leaks |
| W3-26 | E-4 | "Press 2 to replay" Twilio IVR dead — twilio-status redirects to twilio-call which 401s on un-Bearer'd Twilio fetch |
| W3-27 | E-5 | sos-alert PARALLEL FANOUT has no per-call timeout; one stuck Twilio call hangs the whole Promise.all + 7s primary contact wait |
| W3-28 | E-6 | sos-alert TRIGGER doesn't write audit/spend ledger if fanout throws partway → compliance black-hole |
| W3-29 | E-7 | twilio-status: signed Twilio callback `From`/`Called` trusted to send escalation SMS; phishing seed if attacker calls our number |
| W3-30 | E-9 | sos-alert PREWARM body-token: any Supabase access token (even from logged-out device) works for 1 hour |
| W3-31 | E-10 | sos-alert HEARTBEAT writes attacker-chosen GPS without lat/lng/battery range validation |
| W3-32 | E-11 | twilio-sms exposes Twilio raw `error.message` in 5xx response (G-30 violation) |
| W3-33 | E-13 | send-invitations Resend HTML email injection via `companyName` / `emp.name` / `inviteCode` |
| W3-34 | D-3 | `sos_sessions` has NO state-transition guard; owner can rewrite their own emergency timeline |
| W3-35 | D-4 | `sos_queue` writable by ALL company members → employee can fake "admin resolved this" attribution forgery |
| W3-36 | D-5 | 15 RLS-enabled tables have ZERO policies (broader than G-31 covered) — silent black-hole; owner can't read own evidence |
| W3-37 | D-6 | `profiles` has 19 overlapping policies, including TWO `WITH CHECK true` INSERTs; OR-of-policies = least restrictive wins |
| W3-38 | D-7 | `companies` has 21 policies with conflicting `owner_id` vs `owner_user_id` ownership models |
| W3-39 | D-12 | Some SECDEF functions (`promote_user_to_admin`, `transfer_ownership`, `add_company_member`) — caller-identity check needs body verification |
| W3-40 | D-13 | `record_twilio_spend(p_company_id, ...)` SECDEF without actor-bind → Twilio budget DoS on any victim company |
| W3-41 | A-1 (sub-ang) | `flushAuditRetryQueue` bypasses G-35 write lock and clobbers retry queue → silent compliance event loss |
| W3-42 | A-3 (sub-ang) | `startGPSTracking` adds anonymous listeners with no cleanup; each `updateTrackerConfig` doubles them |
| W3-43 | A-4 (sub-ang) | 3 sites of `onAuthStateChange` discarded subscriptions → HMR/refresh causes N-fold replay |
| W3-44 | A-12 (sub-ang) | `replayPendingSOS` uses `navigator.onLine` (lies on Android WebView with captive portal/MDM-DNS) |
| W3-45 | A-13 (sub-ang) | Service worker `STATIC_PATH_PATTERNS` matches `/\.json$/` — any `.json` (e.g. future feature flags) can be cache-poisoned |
| W3-46 | S-7 | Twilio status callback writes `call_events` only — never updates `audit_log` or `sos_sessions` |
| W3-47 | S-8 | `twilio-call` `normalizePhone` server-side strips `+`; client `phone-utils` always emits `+CC...`; allowedPhones Set comparison fails |
| W3-48 | S-9 | Two `emergency_id` formats coexist (`ERR-XXX` text vs UUID-as-text via projection trigger) → cross-references break |
| W3-49 | S-11 | `sosphere_dashboard_pin` uses hardcoded constant salt `"sosphere_pin_salt_2026"` (different from per-install salt elsewhere) |
| W3-50 | S-12 | `sosphere_sync_data` is read by 2 components but never written; UI metric permanently zero |

---

## 🟨 TIER 2 — MEDIUM (~25 items, abbreviated)

C-6 (packet modules cross-user leak on shared device), C-7 (phone staleness mid-SOS), C-8 (phantom active-SOS after crash), A-12 (chat broadcast forgery), A-15 (`promote_user_to_admin` "service-role bootstrap" branch), E-15 (stripe-portal no rate limit), E-16 (stripe-checkout successUrl unallowlisted [`VERIFY-FIRST` vs G-18]), D-14 (`relforcerowsecurity=false` everywhere), D-15 (audit_logs JWT-claim trust during stale TTL), D-16 (`project_sos_session_to_queue` swallows ALL exceptions), D-17 (conflicting profile triggers — order brittle), D-19 (companies 21 policies = perf attack), A-14 (gps `_syncTimer` race → duplicate inserts), A-15 (two-tab divergence sosphere_audit_log), A-16 (auth-refresh inflight 401 silent drop), A-17 (Twilio realtime channel cleanup leak on subscribe failure), A-18 (mobile-app GPS effect compounds A-3 listener leak), S-13 (subscriptions table not in CDC publication), S-14 (normalizePhone divergence), S-15 (neighbor-alert consent not server-mirrored), S-16 (audit_log device-info gap for telephony events).

## 🟩 TIER 3 — LOW (~15 items)

E-19 idempotency cache no TTL, E-20 sos-alert→sos-bridge URL contract fragility, A-15 promote_user_to_admin search_path missing pg_temp, D-20 helper functions search_path missing pg_temp, S-17 mobile i18n gaps, S-18 chat channel-name divergence (consequence of S-9), E-12 invite-employees long-running risk, A-7 checkin-timer auto-extends past warning silently, A-10 toast-only failure UI for queued check-in, A-11 service-worker `.json` cache risk, A-13 push-notifications AudioContext never closes (alarm goes silent on long sessions), W3-26-pdf compliance fallback type mismatch (S-6).

---

## 📊 EXECUTION PLAN — 3-hour session

**Phase A — verify-first (~20 min):** confirm or refute W3-2, W3-5, W3-6, W3-9 by reading actual deployed code. Adjust master list.

**Phase B — TIER 0 fixes (~90 min):** hard-test each.
1. W3-1 (civilian userId UUID plumbing) — biggest impact, longest reach
2. W3-10 (deactivation PIN) — 1-line fix but blocks every user from ending SOS
3. W3-11 (subscription DB read) — revenue protection
4. W3-13 (last-breath beacon path) — life-critical, must not 401
5. W3-14 (resolveTier company-aware) — paid B2B contract honored
6. W3-3 (realtime tenant scoping) — privacy
7. W3-4 (twilio-status source repair) — deploy-blocker
8. W3-7 (Stripe timestamp Math.abs) — defense vs replay
9. W3-8 (audit_log table grants tighten) — forensic integrity
10. W3-12 (decide: wire vault or remove the dead code + marketing copy)

**Phase C — TIER 1 batch fixes (~60 min):** group by domain.

**Phase D — final regression (~10 min):** all 18 test suites + tsc + smoke.

---

## 🧠 OPEN QUESTIONS FOR USER (need answers before Phase B starts)

1. **W3-12 evidence-vault dead code** — wire the production flow into vault-service, OR remove the service + scrub marketing copy? (Wiring costs ~1 hour, removing costs ~10 min but reduces feature set)
2. **W3-1 userId plumbing** — confirm: civilians use `auth.uid()` UUID; employees use `EMP-${id}` for human-readable display only (UUID still goes to server)?
3. **W3-3 realtime privatization** — switch to Supabase Realtime Authorization (per-channel JWT) or use service-role broadcast through edge functions only?
4. **W3-14 tier resolution** — do we look up `subscriptions WHERE company_id = my_company` for employees? Confirm B2B contract.

---

## 🔁 PENDING REMINDERS (the other options I offered before deep-audit)

You picked option 1. The rest are still on the table:
1. ~~Deep red-team multi-angle attack~~ (DONE — this report)
2. **Final Launch Readiness Report** — matrix of every B-* and G-* fix with verification status
3. **New signed APK release build** after all fixes
4. **Lint guard pre-commit** that prevents reintroduction of `any` typing, dead schema names from G-43, missing AbortSignal on outbound fetches

---

**Net assessment:** the prior 44-finding wave closed shallow defects (privilege/RLS/CORS/timing). This wave found **architectural** defects — broken contracts between components, dead code paths claimed as features, prior fixes that didn't make it into deployed code. The civilian flow is **functionally broken** server-side; we've been protecting an empty room.

When you return: say "نبدأ التنفيذ" and I'll start with Phase A verification, then march through TIER 0 with the same methodology — fix each, hard-test each, regression-after-each.
