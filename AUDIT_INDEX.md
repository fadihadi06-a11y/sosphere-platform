# 📑 Phase B1 — Dashboard Audit Index

**Date:** 2026-05-25
**Methodology:** 5-stage end-to-end framework (Inventory → Code Tracing → Intent Verification → Edge Cases → Report)
**Goal:** identify silent bugs, lying buttons, mock data, and data integrity gaps in life-safety paths

---

## 🎯 Master Findings Summary

| Audit | Page | Severity | Silent Bugs | TODOs |
|-------|------|----------|-------------|-------|
| #1 | `dashboard-sar-page.tsx` | 🔴 CRITICAL | 1 (Training-mode lock) | 7 |
| #2 | `company-dashboard.tsx` | 🔴 CRITICAL | 3 (AI Co-Admin key mismatch + delay + multi-SOS skip) | 8 |
| #3 | `dashboard-pages.tsx` | 🔴 **WORST** | **5 LIES + mock medical data** | 10 |
| #4 | `dashboard-evacuation-page.tsx` | 🟠 HIGH | 2 (no push, no SMS fallback) | 8 |
| #5-19 | (consolidated) | 🟢-🟠 mixed | minor | ~15 estimated |

**Total Silent Bugs Found:** 11 critical + 17+ medium
**Total TODOs:** 33 explicit + ~15 estimated = ~48

---

## 🚨 The 11 CRITICAL Silent Bugs (P0 LIFE-SAFETY)

### From dashboard-pages.tsx (5 LIES):
1. **"Call 997" button doesn't dial** — Toast only, no Twilio call
2. **"Take Action" button does nothing** — Toast only, no AI Co-Admin
3. **"Broadcast Alert" doesn't broadcast** — Toast only
4. **"Escalate" doesn't escalate** — Toast only
5. **EmpDetailView shows hardcoded mock medical data** for every employee

### From company-dashboard.tsx (3):
6. **AI Co-Admin batteryLevel key mismatch** — `event.data.batteryLevel` vs mobile's `event.data.battery`
7. **AI Co-Admin signalStrength key mismatch** — same pattern, different key
8. **Multi-SOS skip** — 2nd+ concurrent emergencies don't get AI triage

### From dashboard-sar-page.tsx (1):
9. **Entire SAR page is Training-mode** — Live mode disabled, no real rescue dispatch

### From dashboard-evacuation-page.tsx (2):
10. **No push notifications** for evacuation orders
11. **No SMS fallback** for offline workers in evacuation

---

## 📋 Master TODO Registry — Prioritized

### 🔴 P0 LIFE-SAFETY (15 TODOs):
1. Wire "Call 997" to actual Twilio call (or remove + show manual instructions)
2. Wire "Take Action" to open AI Co-Admin
3. Wire "Broadcast Alert" to sendBroadcast()
4. Wire "Escalate" to emitSyncEvent
5. Replace EmpDetailView mock medical data with real Supabase fetch
6. Fix AICoAdminContext keys: `battery`, `signal`, `lastGPS` (from mobile payload)
7. Remove 2-second AI Co-Admin delay
8. Queue/multi-emergency mode for AI Co-Admin
9. Wire SAR Live mode (Task #45 — gps_trail + sos_outbox + Twilio bridge)
10. Add dedicated `EVACUATION_TRIGGERED` SyncEvent type
11. Wire push notifications for evacuation (FCM)
12. Add SMS fallback via Twilio for offline workers
13. SAR "Alert Workers" — add zone geo-filter + delivery ack
14. SAR Pause semantics fix (currently misleading)
15. SAR auto-launch on CONNECTION_LOST event

### 🟠 P1 HIGH (10 TODOs):
16. Update emergency.location on GPS_TRAIL_UPDATE events
17. Persistent banner for BATTERY_CRITICAL (not just toast)
18. EmergencyWatchdog actionsLog from audit log store
19. CreateEmergencyDrawer should accept employee selection
20. Cancel evacuation broadcast priority → "urgent" not "normal"
21. Verify mobile-side handler for evacuation broadcasts
22. Wire AUDIO_EVIDENCE into AI Co-Admin context
23. Add audit log entries for evacuation trigger/complete/cancel
24. SAR audit log entries for every state transition
25. Replace hardcoded mocks with skeleton loading

### 🟡 P2 MEDIUM (10 TODOs):
26. CHECKIN_WARNING — skip events with missing employeeId
27. Pre-populate assembly points for new workers
28. Multi-zone evacuation support
29. CodeQL Clear text storage alerts (shared-store.ts)
30. ESLint warnings reduction (~13 remaining)
31. NPM audit HIGH (Capacitor v8 upgrade)
32. SAR Start-from-Connected-Lost-Worker flow
33. Verify mobile SAR_ACTIVATED listener
34. Stale Open PRs #2 #3 close
35. ESLint --max-warnings 0 enforcement

### 🟢 P3 LOW (5 TODOs):
36. Verify dispatchTeam() actually dispatches
37. dashboard-analytics-page TODOs (2 inline)
38. dashboard-offline-page "In production" comment cleanup
39. Z2-followup PR (no-hardcoded-secret lint-guard rule)
40. Firebase Android key restrictions (deferred Task #31)

---

## 📊 Coverage Status

```
Phase B1 — Dashboard Audits:
  Detailed audits: 4/21 pages (19%)
  Scanned briefs:  17/21 pages (81%)
  Total covered:   21/21 (100%) — SUFFICIENT for action

Phase B2 — Mobile Audits:
  Not started (0/5 critical mobile pages)

Phase B3 — Quick Fix PRs:
  Not started

Phase B4 — Task #45 (SAR Live):
  Not started (largest epic)

Phase B5 — Final E2E:
  Not started
```

---

## 💡 Strategic Recommendation — Don't Audit More, START FIXING

We have **enough information** to start the highest-priority fixes:

### Option A — Continue B1 (audit remaining pages exhaustively)
**Pro:** complete coverage
**Con:** more time, but the scan shows remaining pages don't have major "lying button" patterns
**Estimate:** +4-6 hours

### Option B — **Pivot to B3 (Quick Fix PRs)** ← RECOMMENDED
Start fixing the **15 P0 LIFE-SAFETY issues** now. Doctrine says: "smaller PRs > larger PRs". Group into 5-6 focused PRs:
- `phase-1/wire-call-997-twilio` (#1)
- `phase-1/wire-watchdog-take-action` (#2)
- `phase-1/wire-broadcast-escalate-buttons` (#3 + #4)
- `phase-1/empdetail-real-data` (#5)
- `phase-1/aicoadmin-key-fix` (#6 + #7 + #8)
- `phase-1/sar-live-mode-foundation` (#9 — multi-PR sub-epic)
- `phase-1/evacuation-push-sms` (#10 + #11 + #12)

### Option C — Continue B1 + start B2 (mobile)
**Pro:** find mobile-side issues before fixing
**Con:** much longer

---

## ⏭️ Next Step (your call)

**Recommendation:** **Option B**. We have actionable findings. Every day a "Call 997" button lies to admins is a day a worker could die because of UI deception.

Starting point: **`phase-1/wire-call-997-twilio`** — the most life-critical button across all audits.

If you agree, I'll:
1. Audit the Twilio integration files (`sos-server-trigger.ts`, `voice-provider-twilio.ts`)
2. Design the wiring for `onCall997` in EmergencyWatchdog
3. Open a focused PR with the fix + test
4. Verify end-to-end before merge

**Or** I can continue B1 audits if you prefer full coverage first.

---

*Audit index generated as part of Phase B1 — dashboard audit framework.*
