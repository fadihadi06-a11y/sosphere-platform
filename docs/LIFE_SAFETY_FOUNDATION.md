# SOSphere — Life-Safety Foundation Plan

> **Status:** Active workstream
> **Started:** 2026-05-08
> **Owner:** Fadi Hadi
> **Author:** Claude (audit + design)
> **Priority:** Above all feature work
> **Companion:** [`SOS_FLOW_DESIGN.md`](./SOS_FLOW_DESIGN.md) — authoritative spec for the SOS user flow across all 3 civilian tiers + Employee/Admin/Owner roles. Read alongside this document.

This document is the master plan for converting SOSphere from "B2B emergency-response SaaS" into a **life-safety platform that customers can trust with workers' lives**.

It supersedes the audit roadmap in `SOSphere_Audit_Report_2026-05-07.docx` for prioritization purposes — every audit finding is reframed below through the life-safety lens.

---

## The Foundation Pyramid

```
                ┌──────────────────────────────────┐
                │  6. Business Protection          │
                ├──────────────────────────────────┤
                │  5. Operations Discipline        │
                ├──────────────────────────────────┤
                │  4. Infrastructure Resilience    │
                ├──────────────────────────────────┤
                │  3. Client Hardening             │
                ├──────────────────────────────────┤
                │  2. SOS Pipeline Hardening       │
                ├──────────────────────────────────┤
   ★★★ ABSOLUTE │  1. Observability & Verification │
   FOUNDATION ★ │     (We KNOW what happens)       │
                └──────────────────────────────────┘
```

Each layer rests on what's below it. **Skip a layer and the structure collapses under load.**

---

## Layer 0 — Pipeline Discovery (DONE 2026-05-08)

Before any change, we mapped what exists today. Findings:

### ✅ Already strong (do not touch unless broken)

| Resilience | Where | Detail |
|---|---|---|
| Idempotency keys | `supabase/functions/sos-alert/index.ts:163-191` | `onConflict: function_name+key` |
| Per-fetch timeouts | multiple | Twilio 8s, trigger 20s, heartbeat custom |
| `AbortController` + in-flight guard | `sos-server-trigger.ts:216-299` | Prevents stacking on network flap |
| Exponential backoff | `sos-server-trigger.ts:60-61` | `min(2^attempts × 1000, 60000)` |
| Offline IndexedDB queue | `offline-database.ts` | `queueSOS` + retry tracking + sync marker |
| 429 replay cooldown | `sos-server-trigger.ts:1053` | Honors server rate-limits |
| Server-enforced tier | `sos-alert/index.ts` | DB lookup — never trusts payload |
| Progressive watchdog | `sos-alert/index.ts:818` | Escalates at t=5s and t=15s |
| sendBeacon prewarm + native fallback | `sos-server-trigger.ts` | Multi-path delivery |
| Heartbeat starts BEFORE await | `sos-server-trigger.ts` | Doesn't block on main fetch |
| Server-side timestamping | `sos-alert/index.ts` (13 sites) | Critical times not client-trusted |
| Zero empty catch in `sos-alert` | `sos-alert/index.ts` | Clean error propagation |

### ❌ Critical gaps in Layer 1 (Observability)

1. **No correlation/trace IDs** — can't reconstruct one SOS press as a single timeline across client + edge function + audit_log + Twilio
2. **No end-to-end timing** — we don't measure button-press → server-received → responder-acked
3. **No `client_claimed_time` vs `server_received_time` deltas** — needed for legal forensics + tamper detection
4. **No synthetic probe** — nothing verifies the pipeline is alive between real customer pressings
5. **No formal circuit breaker** — short-circuits exist in business logic but no architectural breaker
6. **No live metrics dashboard** — we have logs but no aggregated p50/p95/p99 latency view

---

## Layer 1 Plan — Observability & Verification (NEXT)

This is the next workstream. Ships in ~5 days of focused work, in this order:

### L1-A. Correlation ID propagation

Goal: every SOS press gets a unique `trace_id` (UUID v4) generated at button press time. It's passed through:

- Client log (`[sos-trace=abc123]`)
- HTTP header `X-SOS-Trace-Id`
- `emergencies.trace_id` column
- `audit_log.trace_id` column
- Twilio statusCallback URL query param
- Sentry tag

Effort: 1 day. Migration: 1 file (add column + index). Code: ~20 sites.

### L1-B. `client_claimed_at` + `server_received_at` columns

Goal: store BOTH timestamps in `emergencies` table. The delta is a forensic signal:

- delta < 5s → normal
- delta > 30s → client clock skew or queued (offline replay) — flag for review
- delta < 0 → client clock manipulation — alert security

Effort: half day. Migration: 1 file. Code: ~5 sites.

### L1-C. End-to-end timing telemetry

Goal: emit a structured JSON record per SOS press to an `sos_pipeline_metrics` table:

```typescript
{
  trace_id: string,
  emergency_id: string,
  client_claimed_at: timestamp,
  server_received_at: timestamp,
  primary_alert_dispatched_at: timestamp,
  responder_acked_at: timestamp | null,
  total_dispatch_ms: number,           // server_received → primary_alert_dispatched
  total_acknowledge_ms: number | null, // client_claimed → responder_acked
  channel_used: "push" | "sms" | "voice" | "all",
  fallbacks_triggered: string[],       // ["push_failed", "sms_succeeded"]
  watchdog_escalations: number,
}
```

Effort: 1 day. Migration: 1 file (new table). Code: ~10 sites.

### L1-D. Synthetic SOS probe

Goal: a scheduled task fires a test-flagged SOS every 5 minutes from 3 geographic sources (Vercel cron or GitHub Actions matrix). Captures the same metrics as real SOS but with `is_synthetic=true` flag.

Pipeline alerts when:
- 2 consecutive synthetic probes fail
- p95 dispatch_ms > 3000 over 1h window
- any synthetic probe takes > 10s

Effort: 1.5 days. New: GitHub Action + dashboard query.

### L1-E. Live metrics dashboard

Goal: a single page (`/dashboard/pipeline-health`, internal-only) showing:

- Last 24h: synthetic probe success rate, p50/p95/p99 dispatch latency
- Real SOS volume + dispatch latency distribution
- Failure rate per channel (push/sms/voice)
- Current circuit breaker state per Twilio account / edge function
- Last 10 incidents requiring manual intervention

Effort: 1 day. Stack: existing dashboard skeleton + new RPCs.

### L1-F. Architectural invariant test

Mirrors `auth5-architectural-invariants.test.ts` and `auth-listener-cleanup.test.ts`:

- Every entry point in the SOS pipeline propagates `trace_id`
- `emergencies` table has both timestamp columns + non-null constraints
- `sos_alert` edge function has timeout on every external fetch
- Offline queue has bounded size + TTL eviction
- No new empty catch blocks in `supabase/functions/sos-*` paths

Effort: half day. New: 1 test file, ~12 assertions.

**Total Layer 1 effort: ~5 working days.**

---

## Layer 2 Plan — SOS Pipeline Hardening (after Layer 1)

After observability, we lock down the pipeline behavior under failure. Most of this is already in place — Layer 2 is verification + filling specific gaps.

> **Cross-reference:** the user-flow spec in [`SOS_FLOW_DESIGN.md`](./SOS_FLOW_DESIGN.md) drives sub-tasks L2-E through L2-H below — Free-tier call cascade, "answered" SMS, post-call capture flow, and evidence hash chain. These are net-new work surfaced by the flow design and slot into Layer 2 because they harden the pipeline behavior.

### L2-E. Free-tier call cascade (currently FREE has no call)
Per `SOS_FLOW_DESIGN.md` §3.2: 3 calls × 30s ring per contact, 5s retry SMS between attempts, cascade to next contact after 3 fails. ⏱️ 2 days.

### L2-F. "Answered" SMS during live call
Per §3.2 Phase B: when Twilio reports a human answered, fire SMS to that contact in parallel with the call so the location link is delivered even after hang-up. ⏱️ Half day.

### L2-G. Post-call automatic audio + photo capture
Per §3.2 Phase C: on `CallStatus=completed`, auto-start background audio recording (60s Free / 5min Basic / unlimited Elite, hidden indicator), then prompt photo capture with 10s auto-skip. Hash + upload to `evidence/${trace_id}/`. ⏱️ 2 days.

### L2-H. Evidence chain-of-custody
SHA-256 hashes already exist in `evidence-hash.ts` but aren't wired through. Wire so every audio + photo upload writes its hash to a dedicated column, and the audit_log row references it. ⏱️ 1 day.

### L2-A. Formal circuit breaker per Twilio account

Goal: when Twilio API fails 5 times in 30s, the breaker opens for 30s. Future SOS in that window skip Twilio and go straight to backup channel.

### L2-B. Push → SMS → Voice failover chain (S-03)

Goal: documented contract — every alert tier must reach the responder via at least one channel. Implementation will verify each fallback in synthetic probes.

### L2-C. SOS pipeline must withstand Supabase 60s outage

Goal: client-side queue must survive, replay correctly, and the edge function (when Supabase recovers) must dedup correctly.

Tests:
- Local outage simulation (chaos test)
- Verify offline queue replays in correct order
- Verify idempotency holds across the outage window

### L2-D. Append-only audit log with hash chain (S-13)

Goal: each `audit_log` row carries `prev_hash` and its own `row_hash`. Tampering breaks the chain.

Effort: ~1 week (migration + RPC changes + test).

---

## Layer 3 Plan — Client Hardening

These are the audit findings reframed for life-safety:

### L3-A. F-01 Bundle splitting (Critical)

Already documented in audit — but reframe: **a worker on 3G with a 2.2MB bundle = 8s load time during chemical leak = potential death.** This is not a UX issue. It is a life-safety issue.

### L3-B. Panic-mode UI (S-09)

- SOS button 3x larger than the rest of UI
- One-handed operation, low-light optimized
- 1-second long-press to confirm (prevents accidental, but no longer)
- Voice + haptic confirmation: "Sent. Help is coming."
- No dropdowns, no input fields, no "Are you sure?" — confirmation in panic = death

### L3-C. F-05 Empty catch fixes — but ONLY in SOS pipeline first

Of the 159 empty catches, audit them in this order:
1. Files matching `sos-*`, `emergency-*`, `incident-*`
2. Files in `supabase/functions/sos-alert/`
3. Files in `dashboard-incident-investigation`

Other 100+ can wait. The 30-40 in the SOS path cannot.

### L3-D. Panic-mode UI redesign
Per `SOS_FLOW_DESIGN.md` §1.2: large red "End SOS" button only after acknowledgement, single status sentence, live state pill ("Calling X..." / "X answered" / "No answer — calling Y"), no menus, no inputs, high contrast, one-handed operation. ⏱️ 3 days.

### L3-E. "I'm OK now" stand-down button (Employee role only)
Per §6.3: appears 90s after SOS commit. One tap → marks session ended, notifies admin, suppresses next-stage escalation. Prevents needlessly waking the response chain when the worker self-recovers. ⏱️ Half day.

### L3-F. Pre-flight check on app open
Per §9.2: warn on app open if battery <20%, GPS permission missing, notification permission denied, location services off. Surfaces silent failure modes before they bite during a real emergency. ⏱️ 1 day.

---

## Layer 4 Plan — Infrastructure Resilience

### L4-A. Multi-region failover (S-02)

Read replica in second region (EU + ME), edge functions duplicated, DNS failover within 30 seconds.

### L4-B. Dead-man switch / heartbeat (S-01)

Inverse model: instead of "pressed SOS → alert", model = "hasn't checked in for X min → alert anyway."

### L4-C. Buddy system auto-activation (S-11)

Workers paired by shift. If one's app fires SOS, the other gets immediate proximity alert.

### L4-D. Buddy auto-activation push (partial code exists)
Per `SOS_FLOW_DESIGN.md` §6.1.B: bypass DND, ETA computation from buddy GPS, "I'm responding" one-tap update visible to victim. Some scaffolding in `shared-store` already; needs wiring + push priority + tone bypass. ⏱️ 2 days.

### L4-E. Smart call routing by hour (S-10 refinement)
Per §9.10: time-of-day-aware contact prioritization. Spouse first 6am-10pm, sibling/parent first 10pm-6am. Configurable per user. ~40% reduction in no-answer rate per emergency-call studies. ⏱️ 1 day.

---

## Layer 5 Plan — Operations Discipline

### L5-A. Status page hosted off-platform (S-05)

`status.sosphere.app` hosted on Better Uptime / Statuspage.io. Survives full SOSphere outage.

### L5-B. Synthetic monitoring (already part of L1-D)

### L5-C. Tabletop exercises monthly (S-07)

4-hour walkthrough of "Supabase down 15 min, weekend 3am, customer has incident." Walk every step. Document gaps.

### L5-D. Postmortems without blame (S-08)

Every failure (even minor) → postmortem doc. What happened? When detected? How fixed? How prevent? Fix systems, not people.

### L5-E. Drill mode (`is_drill=true` end-to-end)
Per `SOS_FLOW_DESIGN.md` §7.3: dedicated button "Run drill — no real responders" in admin console. Triggers a fake SOS that exercises the entire pipeline (audit log, dispatch, chat) with `is_drill=true` flag so no Twilio cost, no real contact rings, no responder dispatched. Builds worker muscle memory. Major sales lever. ⏱️ 2 days.

---

## Layer 6 Plan — Business Protection

### L6-A. E&O Insurance (S-14)

$5-15k/year. Mandatory before first paying customer. Without it, one fatal failure = bankruptcy + personal liability.

### L6-B. Customer drill mode (S-15)

`?drill=true` flag bypasses real responder dispatch but generates same metrics + UI confirmation. Lets customers train monthly without false alerts.

### L6-C. Pre-emergency profile (S-10)

Each worker pre-fills emergency contacts, allergies, blood type, medical conditions. At SOS time, this auto-attaches to dispatch payload.

### L6-D. Pre-emergency profile expansion
Per `SOS_FLOW_DESIGN.md` §9.6: add language preference (TTS), insurance info, special instructions ("I'm deaf — text only", "Call my doctor first"). Saves 30s of "what does the victim need" — life-or-death in cardiac events. ⏱️ 2 days.

### L6-E. Forensic export bundle (Elite-only)
Per §5.2: ZIP with all audio (raw + transcribed VTT), photos with EXIF, chat (JSON + PDF), audit log filtered by trace_id (CSV), `manifest.json` with SHA-256 of every file + GPG signature from server's signing key. Court-admissible. ⏱️ 3 days.

---

## How audit findings map to layers

| Finding | Layer | Status |
|---|---|---|
| F-01 Bundle 2.2MB | L3 (Client Hardening) | Pending |
| F-02 DOMPurify CVE | L0 (Already done) | ✅ Resolved |
| F-03 onAuthStateChange leak | L0 (Already done) | ✅ Verified clean + test added |
| F-04 23+ outdated packages | L4 / Maintenance | Pending |
| F-05 159 empty catches | L3 (SOS-path subset first) | Pending |
| F-06 184 console.log | L1 (after trace IDs added — replace with structured trace) | Pending |
| F-07 848 unused-vars | Quality / Sustainable | Pending |
| F-08 242 :any types | Quality / Sustainable | Pending |
| F-09 .env.example | L0 (Already done) | ✅ Resolved |
| F-10 6 raw err.message | L3 (Client Hardening) | Pending |
| F-11 dangerouslySetInnerHTML | L3 (Client Hardening) | Pending |
| F-12 RLS-zero-policy tables | L1 (verify deny-by-default) | Pending |
| F-13 346 localStorage + PII | L3 (Client Hardening + GDPR) | Pending |
| F-14/15/16/17 (Low) | Sustainable | Defer |

---

## Sequencing rule (tie-breaker)

When choosing what to do next, ask three questions in order:

1. **Does it affect the SOS path?** → Yes → top priority
2. **Does it block measurement of #1?** → Yes → second priority
3. **Does it block sales credibility?** → Yes → third priority

Everything else waits.

---

## Living document

Update this doc whenever:
- A layer is started → mark "in progress" + date
- A layer is finished → mark "done" + commit SHA
- A new finding is discovered → add to the right layer
- A layer's plan changes → revision note at the top with rationale

The plan is the spine. Without it, every session re-debates priorities.
