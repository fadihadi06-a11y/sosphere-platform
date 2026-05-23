# SOSphere — Root Audit Results, Wave 3 (R→Z)

**Audit date:** 2026-05-22
**Trigger:** User refused fixing until exhaustive audit complete — "انت ترقع وانا ارفض الترقيع"
**Scope:** 9 dimensions not covered in Waves 1–2.
**Method:** 9 dedicated subagents, static analysis only.

---

## Severity Totals — Wave 3

| Dim | Topic | CRIT | HIGH | MED | LOW | Total |
|---|---|---:|---:|---:|---:|---:|
| **R** | AI / LLM behavior | 1 | 8 | 9 | 4 | **22** |
| **S** | Voice / SIP state machine | 6 | 13 | 14 | 7 | **40** |
| **T** | Family Circle / privacy / coercion | 9 | 9 | 9 | 10 | **37** |
| **U** | Risk Map / Geofencing / Neighbor | 8 | 13 | 11 | 8 | **40** |
| **V** | Email / SMS deliverability | 6 | 12 | 8 | 4 | **30** |
| **W** | Realtime under partition | 6 | 10 | 10 | 9 | **35** |
| **X** | Observability gaps | 6 | 14 | 12 | 3 | **35** |
| **Y** | DB schema integrity | 10 | 17 | 18 | 5 | **50** |
| **Z** | Falsifiable marketing/legal claims | 14 | 16 | 10 | 4 | **44** |
| **TOTAL Wave 3** | | **66** | **112** | **101** | **54** | **333** |

**Grand Total (Wave 1 + 2 + 3):** 53 + 450 + 333 = **836 distinct root-level defects** across 26 audit dimensions.

---

## STOP-SHIP — Wave 3 (R-167 → R-220)

The defects that, in independent auditor judgment, MUST be fixed before production traffic. Each cites file:line.

### Voice/SIP catastrophic (R-167 → R-172)
| R# | Title | Evidence |
|---|---|---|
| R-167 | `endCall()` is no-op — disconnect commented out → 4-hour Twilio billing per call | `voice-provider-twilio.ts:273-277` |
| R-168 | Mute button is local state only — admin convos leak to worker | `admin-incoming-call.tsx:59,424,520,719` |
| R-169 | Conference `endConferenceOnExit="false"` — orphaned billing on drop | `sos-bridge-twiml/index.ts:238` |
| R-170 | No retry/voicemail fallback on mid-emergency drop | `twilio-status/index.ts:259-366` |
| R-171 | KSA/IQ workers see US `+1` CLI for SOS | `twilio-call/index.ts:177` |
| R-172 | No premium-rate / international destination allowlist → toll-fraud | `twilio-call/index.ts:185-243` |

### Family Circle / coercion (R-173 → R-181)
| R# | Title | Evidence |
|---|---|---|
| R-173 | No consent flow — silent add as contact/buddy/family member | `manage-emergency-contacts.tsx:85-126`, `emergency-contacts.tsx:338-364`, `buddy-system.tsx:284-310` |
| R-174 | `consentGiven` field exists but never enforced anywhere | `contact-tier-system.ts:339,367,395,423,451` |
| R-175 | Family invite code hardcoded `FML-8K3P` — same for every user | `family-circle.tsx:490` |
| R-176 | "Send SMS Invite" + "Share Link" buttons are no-op | `family-circle.tsx:512-535` |
| R-177 | No server table for family/buddy/circle — all localStorage | `supabase/migrations/` (absence) |
| R-178 | Safe Walk guardian auto-populated — guardian never consents | `safe-walk-mode.tsx:86-94` |
| R-179 | No silent-leave / panic-removal path | all 4 social-safety files |
| R-180 | No block / report / abuse path | all 4 files |
| R-181 | No "X viewed your location" audit visible to target | all 4 files |

### Risk Map / Geofence (R-182 → R-189)
| R# | Title | Evidence |
|---|---|---|
| R-182 | `neighbor_responses` insert missing `responder_id` → RLS rejects all silently | `neighbor-alert-service.ts:674` |
| R-183 | `neighbor_responses` world-readable to any authenticated user | `supabase-neighbor-and-ai.sql:42-45` |
| R-184 | Neighbor SOS channel consent enforced client-side only | `neighbor-alert-service.ts:381` |
| R-185 | No rate-limit on `publishNeighborAlert` → DDoS panic | `neighbor-alert-service.ts:506` |
| R-186 | Geofence inside/outside computed in client (spoofable) | `dashboard-geofencing-page.tsx:1373` |
| R-187 | Canvas pixels vs real GPS conflated — geofence is decorative | `dashboard-geofencing-page.tsx:1175` |
| R-188 | Evacuation state localStorage-only | `shared-store.ts:810-832` |
| R-189 | Zone IDs mismatch `Z-*` vs `GZ-*` — evacuation broadcast to wrong people | `dashboard-evacuation-page.tsx:75` vs `dashboard-geofencing-page.tsx:152` |

### Deliverability (R-190 → R-195)
| R# | Title | Evidence |
|---|---|---|
| R-190 | Email from `onboarding@resend.dev` sandbox | `send-invitations/index.ts:193` |
| R-191 | No STOP/STOPALL/UNSUBSCRIBE handler — TCPA exposure | `sos-sms-inbound/index.ts:136-165` |
| R-192 | No HELP keyword handler (10DLC required) | `sos-sms-inbound/index.ts` |
| R-193 | No SMS consent/opt-out/suppression schema | migrations (absence) |
| R-194 | No SPF / DKIM / DMARC / BIMI records | repo |
| R-195 | No List-Unsubscribe header | `send-invitations/index.ts:186-227` |

### Realtime (R-196 → R-201)
| R# | Title | Evidence |
|---|---|---|
| R-196 | `twilio-status` send-on-unsubscribed channel | `twilio-status/index.ts:236` |
| R-197 | `storage-adapter.broadcast()` never subscribes, leaks every call | `api/storage-adapter.ts:291-303` |
| R-198 | No re-fetch after Realtime reconnect → SOS lost in WS gap | `shared-store.ts:85-93` |
| R-199 | Server-side SOS watchdog claimed but only client-side `setInterval` | `sos-server-trigger.ts:845-955` |
| R-200 | Heartbeat broadcast uses unsubscribed transient channel | `sos-alert/index.ts:825-840` |
| R-201 | Realtime is single point of failure — no out-of-band backup | repo-wide |

### Observability (R-202 → R-207)
| R# | Title | Evidence |
|---|---|---|
| R-202 | Sentry leaks user.email on every event | `sentry-client.ts:167,175,221,224` |
| R-203 | `beforeSend` only scrubs URLs — `event.user`/`event.extra` raw | `sentry-client.ts:99-103,282-292` |
| R-204 | Zero server-side Sentry for edge functions | `supabase/functions/**` |
| R-205 | No Capacitor/native crash reporting (Crashlytics absent) | `package.json` |
| R-206 | Source maps not uploaded → stack traces unreadable | `.github/workflows/ci.yml:68-87` |
| R-207 | No alerting / pager / on-call rotation | `probes.yml:23-25` |

### DB Schema (R-208 → R-214)
| R# | Title | Evidence |
|---|---|---|
| R-208 | `audit_log.company_id ON DELETE CASCADE` — forensic destruction | `20260415_p3_11_audit_log.sql:21` |
| R-209 | `sos_sessions`/`gps_trail`/`companies`/`employees` NEVER `CREATE TABLE`'d in repo | full migrations tree |
| R-210 | Trigger `project_sos_session_to_queue` swallows all errors silently | `f_a_sos_sessions_to_queue_projection.sql:138-142` |
| R-211 | 35 migrations applied via Studio MCP, back-filled by hand | 26% of files |
| R-212 | Zero PII encryption (phone/GPS/medical plaintext) | full migrations tree |
| R-213 | `gps_trail` RLS keys on JWT `company_id` — claim-spoofable | `b_15_b_16_text_to_uuid.sql:114-116` |
| R-214 | Audit log not append-only — no UPDATE/DELETE REVOKE | `p3_11_audit_log.sql:71-100` |

### Falsifiable Claims (R-215 → R-220)
| R# | Title | Evidence |
|---|---|---|
| R-215 | "Calling 997 Emergency Services" toast — does nothing! | `dashboard-pages.tsx:1304-1308` |
| R-216 | "12,847 Protected Workers" / "400+ enterprises" / "284 zones" all hardcoded | `landing-page.tsx:23-28`, `dashboard-web-page.tsx:49-54` |
| R-217 | "< 30s response time" never measured — `avgResponseTimeSec: 0` | `data-layer.ts:34` |
| R-218 | "AI Co-Admin" / "Intelligent Response Engine" / "Safety Intelligence" — zero AI | `ai-co-admin.tsx`, `safety-intelligence.tsx`, `intelligent-guide.tsx` |
| R-219 | "H2S / Weather sensors" generate via `Math.sin(seed)` | `risk-map-live.tsx:66-83` |
| R-220 | "Append-only audit chain" / "court-admissible" but service_role bypasses | `compliance-dashboard-v2.tsx:115` + `p3_11_audit_log.sql` |

---

## Per-Dimension Detail

### R — AI/LLM behavior (22 defects)
**Single most important finding:** there is NO actual AI integration anywhere. "AI Co-Admin v2.1 (PREMIUM EDITION)", "Intelligent Response Engine", "Safety Intelligence", "AI Insights" — all are deterministic JavaScript with `Math` heuristics, lookup tables, and `setTimeout` animations. No call to OpenAI/Anthropic/Gemini/HuggingFace anywhere. Customers pay $799/mo Business tier for "AI Co-Admin" — consumer-fraud risk on a life-safety product. Additional findings: `dangerouslySetInnerHTML` on TOTP QR SVG (XSS surface), voice-sos-trigger.ts uses Web Speech API which streams audio to Google cloud (claims on-device), no DPA for any future AI vendor, IRE PDF carries fake non-cryptographic "verification hash" (`hash |= 0` 32-bit Java string hash).

### S — Voice/SIP (40 defects)
CallStatus switch incomplete — `canceled` triggers no escalation. X-Twilio-Signature replay window unbounded. Conference recording starts immediately in English-only with no two-party-consent banner (KSA/EU/CA violation). Recording storage Twilio US default — KSA PDPL residency violation. Hold music over plaintext HTTP (`twimlets.com`) — MITM injection vector. No `TimeLimit` parameter on initial `twilio-call` POST → up to 4hr default ring/silence. AccessToken TTL 1hr with no mid-call refresh. `@twilio/voice-sdk` version drift (^2.12 → 2.18 resolved). No SIP-region failover. No mic-permission revocation handler mid-call. No DTMF PIN — `Press 1` accepts blindly. No emergency-services (911/999/112) bypass.

### T — Family Circle / Privacy (37 defects)
**Coercive-control nightmare.** An abuser controlling one device can populate the victim's contact list, paywall-unlock Family Circle, enable Safe Walk + Check-In, and receive continuous GPS + SOS. The victim has no surface to discover this, no surface to revoke, no surface to report, no STOP keyword. Additional findings: Safety-Link IDs use `Math.random()` + `Date.now()` (~20 bits entropy); URLs leak user name; no minor-account/age-of-majority lifecycle; payer sees all members' content; multi-account stalking has no defense (10 attacker accounts × 1 victim = silent); phone-number reuse never detected (port-out → new owner inherits stream); `DEV` mode leaks `MOCK_PAIRS` / `ALL_WORKERS` to production builds.

### U — Risk Map / Geofence (40 defects)
**Geofencing is decorative not enforced.** Two parallel ID spaces (Z-* vs GZ-*), canvas-pixel geometry that never reaches real GPS, client-side point-in-polygon. Localized findings: lng→x projection formula dimensionally wrong (ignores `cos(lat)`); radius slider in "canvas units"; lat/lng inputs accept any string; polygons accept self-intersecting/concave; no GPS-jitter debounce → flap; `is_neighbor_receive_granted(uuid)` enumerable (target list builder); displayName leaked plaintext over public channel; retract is silent failure → neighbors converge on resolved scene; CARTO tile CDN leaks every map pan (PDPL violation); no CSAM/virus scan anywhere on image uploads; geohash precision-4 = 234km dragnet enables surveillance; weather panel is `Math.sin()` mock; trip-replay PDF has uncontrolled GPS export.

### V — Deliverability (30 defects)
Combination of DELIV-001 + DELIV-002 + DELIV-005 = operationally fatal. Every invitation ships from a vendor sandbox domain. Every inbound STOP is silently dropped. Single concerted carrier complaint (STC/Verizon/T-Mobile) can shut down SMS channel platform-wide within 24-48hr. Also: 3 different domains in different SMS senders (sosphere.co / sosphere-platform.vercel.app / sosphere.app), no Twilio Lookup, no Resend webhook for bounces, no Arabic STOP (إيقاف), no 10DLC registration, no per-recipient daily cap, no DNC/quiet-hours, no DKIM rotation procedure, no `Reply-To` set, no plain-text email alternative.

### W — Realtime (35 defects)
Heartbeat broadcast doesn't subscribe before sending → race + leak. No JWT refresh on long-lived channels → dies after 1hr idle. Default `eventsPerSecond: 10` — exceeded by GPS+heartbeat+Twilio combined → server drops events silently. Ordering not enforced (uses `Date.now()` only). At-most-once for life-safety events with no client-level retry/ACK. Listener leak in shared-store on re-mount. `chat-${emergencyId}` channel collision — 2s removeChannel kills long-lived listener. Edge functions create channels in loops without proper teardown → connection-storm pattern. No presence anywhere — dispatcher liveness DB-derived. Multi-tab same user → duplicate broadcast handlers. Watchdog timer client-only (server-side never exists).

### X — Observability (35 defects)
Most acute gaps in order: Sentry user PII leak (email shipped raw); no Capacitor/native crash reporting; no server-side Sentry; source maps not uploaded; no pager/on-call rotation; mobile surface lacks page-level ErrorBoundaries protecting SOS button; no SOS-specific 100% trace sampling; `BrowserTracing`+`Replay`+Web Vitals all filtered → effectively crash-reporting-only; service worker errors not captured; no synthetic monitoring from KSA/IQ POPs; no SLO/error-budget; no RUM/Web Vitals; pg_stat_statements not configured; no `__sosSentryTest` removal in prod (DevTools spam attack); release-tagging works for APK only — web build skips it.

### Y — DB Schema (50 defects)
**`sos_sessions`/`gps_trail`/`companies`/`employees`/`profiles`/`evidence` have NO `CREATE TABLE` in repo — only `ALTER`s.** Fresh git clone cannot rebuild DB. 26% of migrations back-filled from Studio. Zero PII encryption. `audit_log.id` is text PK with `'AUD-' || substr(md5(random()),1,8)` — 32-bit collision space (birthday at ~65k inserts). `subscriptions.tier`/`status` unconstrained text. Phone/email/lat/lng have no CHECK constraints. No table partitioning on unbounded tables (`gps_trail`, `audit_log`). Two SECDEF RPCs granted to `anon` for unauthenticated logging — log forgery + DoS via spam INSERT. Audit-chain skips legacy pre-2026-05-09 NULL rows. `sos_sessions.status` CHECK constraint allows both `cancelled` AND `canceled`. State-machine migration REMOVED valid intermediate states defined in earlier migration. No autovacuum tuning. Materialized views — none. `pg_cron`/`pgmq`/`pgsodium` extensions not version-pinned.

### Z — Falsifiable Claims (44 defects)
The marketing/UX surface lies extensively about what the platform does. Highest-priority lies:
- "Calling 997 Emergency Services" toast fires; no call placed (`dashboard-pages.tsx:1304`). **Life-safety negligence.**
- Broadcast/Escalate buttons are pure toast (`dashboard-pages.tsx:2566-2567`).
- "AI predictions" with hardcoded named workers ("Mohammed Ali", "Khalid Omar") in `safety-intelligence.tsx:188-246`.
- "H2S/Weather sensors" generated via `Math.sin(seed)`.
- All four "trust stats" (12,847 / 400+ / 284 / <30s) on landing page hardcoded literals.
- "AI analyzing" is a 1.5-second progress bar.
- "ISO 45001 §10.2 — Investigation Required" badges on every investigation card — no certification held.
- "AES-256 at-rest" claimed in pricing UI; Arabic FAQ admits "نخطط" (we PLAN).
- "End-to-end encrypted" — Supabase reads everything; not E2E.
- Apple/Google Play store badges with no published apps (trademark violation).
- "Powered by Stripe" while payments not active (Stripe brand-guideline violation).
- "We never sell your data" with no DSAR path.
- "7-day money-back guarantee" with no refund code path.
- Hardcoded data-residency claim "Riyadh, Saudi Arabia" while actual hosting is Supabase EU/US.

---

## Cross-Wave Themes (Updated)

In addition to the 7 themes identified in Wave 2, Wave 3 surfaces 5 new systemic patterns:

8. **The "UI lies to operators in life-safety paths" theme** — `toast.success(...)` precedes any backend work; "Calling 997" / "Broadcasting Alert" / "Escalated" / "AI Analysis Complete" all fire without backend invocation. Operator believes action succeeded; nothing happened. Root fix: every `toast.success` must follow a confirmed server response; introduce `toastOnPromise(promise)` helper that NEVER shows success unless promise resolves with confirmation.

9. **The "Marketing claims that code can't honor" theme** — AI, encryption, certifications, response times, uptime, sensors. Each false claim is a separate legal exposure under FTC/KSA/EU consumer-protection law. Root fix: 1-day product/legal/eng review of every landing-page/pricing-page string; either implement or remove. No exceptions.

10. **The "Coercive-control surface" theme** — Family Circle/Buddy/Safe Walk/Check-In all add silently with no consent, no leave, no block, no report. Combined with stalker-bait UI (Safety-Link URLs containing victim names, location broadcasts to lockscreen, GPS trails in localStorage), the platform is currently a domestic-abuse weapon kit. Root fix: implement server-side relationship tables with two-sided consent, revoke-from-either-side, silent-leave, and "who has access to me" reverse-view.

11. **The "Schema half-defined" theme** — life-safety tables defined in production only. Migration ordering inconsistent. 35 of 134 files asserted-equal-to-prod by manual transcription. Type mismatches (text vs uuid). No partitioning. Root fix: stop-the-world schema audit. Dump prod, diff with repo migrations, generate authoritative `CREATE TABLE` statements, commit them as a "consolidation" migration, set "no more Studio MCP" policy with CI enforcement.

12. **The "Observability hidden by design" theme** — Sentry installed but BrowserTracing/Replay/Web Vitals filtered out, source maps not uploaded, no server-side capture, no native crash reporting, no pager. The team is intentionally blind. Root fix: end the filter-out pattern; upload source maps; add Sentry-Capacitor; add Sentry-Cocoa; configure PagerDuty webhook; define SLO + error budgets.

---

## Updated Phase Plan

The previous Phase Plan (~14 weeks) needs revision because Wave 3 added **66 new CRITs** + **112 new HIGHs** that depend on each other.

**Phase 0 — STOP-SHIP (must complete before any traffic):**
- All Wave 1 + Wave 2 + Wave 3 STOP-SHIP items: 25 (W2) + 8 (W1 remainder) + 54 (W3 R-167→R-220) = **87 tickets / 4 weeks** (single eng) / **2 weeks** (3 engs).

**Phase 1 — Pre-launch security & life-safety:**
- All remaining CRIT across 3 waves: 14 + 78 + 66 - 87 (already in P0) = ~71 items.
- Plus all Q-HIGH + K-HIGH + S-HIGH (Voice) + T-HIGH (Privacy) + U-HIGH (Map) + W-HIGH (Realtime) = ~80 items.
- **Estimate: 6 weeks / 3 weeks with 3 engs.**

**Phase 2 — Marketing/legal claims cleanup (Z findings — URGENT):**
- Remove every false claim from landing/pricing/UI before any external traffic. 1 week.
- This phase can run in parallel with Phase 0/1.

**Phase 3 — Compliance & enterprise-readiness:**
- M-CRIT (ROPA/DPIA/SCCs/SDAIA) + N-CRIT (status page/on-call/SLO/runbook/rollback) + ZATCA pipeline + counsel review.
- **4 weeks.**

**Phase 4 — DB schema consolidation (Y findings — URGENT BEFORE ANY OTHER MIGRATION):**
- Dump prod, generate authoritative CREATE TABLE statements, commit. Enforce "no more Studio MCP" via CI.
- **1 week.**

**Phase 5 — Performance & scale:** 3 weeks.
**Phase 6 — UX/A11y/i18n:** 2 weeks.
**Phase 7 — Frontend quality + tech-debt:** 2 weeks.

**Updated critical-path (Phases 0+1+2+3+4):** ~16 weeks (1 eng) / **~7 weeks (3 engs).**

---

## Dimensions still NOT audited (Wave 4 candidates)

Even after 26 dimensions, these remain:

- **Capacity & load** under real Twilio MPS pressure (needs k6/artillery)
- **Real-device battery drain** over 24hr (needs Battery Historian + multiple OEM devices)
- **Cellular failover** (LTE→3G→2G) and captive-portal behavior
- **Edge function memory leak** over hours (needs Deno isolate lifecycle telemetry)
- **DB query plans at scale** (needs production-sized data + `EXPLAIN ANALYZE`)
- **External penetration test** (live exploit attempts, not static analysis)
- **SOC 2 Type II audit attestation** (needs certified auditor)
- **PDPL counsel review** (needs Saudi-licensed lawyer)
- **Real-device SMS delivery** across MENA carriers (STC/Mobily/Zain/Asiacell/Korek)
- **Push notification delivery reliability** across OEMs (Xiaomi/Huawei/Honor/Realme/Vivo)
- **Stripe webhook race** under concurrent scenarios with real Stripe sandbox
- **Crash reporting completeness** validation (force-crash, verify Sentry receipt)
- **Long-running WebSocket** stability under iOS background suspend

---

## Files

- `ROOT_AUDIT_RESULTS.md` (Wave 1, A-F, 53 defects)
- `ROOT_AUDIT_RESULTS_2.md` (Wave 2, G-Q, 450 defects)
- `ROOT_AUDIT_RESULTS_3.md` (Wave 3, R-Z, 333 defects) — this file
- `POST_LAUNCH_AUDIT.md` (master ticket plan, R-87 → R-220 + remaining)

**Total known defects:** 836 across 26 audit dimensions, all static-analysis only. Real production deployment will surface additional runtime/load/device-specific issues that no amount of code reading can find.
