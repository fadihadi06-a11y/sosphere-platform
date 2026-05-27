# 🔍 Page Audit Report — `dashboard-sar-page.tsx`

**Date:** 2026-05-25
**Auditor:** Phase B end-to-end framework
**File:** `src/app/components/dashboard-sar-page.tsx` (2,070 lines)
**Criticality:** 🔴 HIGHEST — Search & Rescue for missing workers (life-safety)

---

## 🎯 Executive Finding

> **The entire SAR Protocol page is TRAINING MODE ONLY.**
> Every life-safety action — dispatch rescue teams, escalate to authorities, alert workers — is **simulated locally**. **NOTHING reaches real rescue services, emergency authorities, or workers' phones.**

This is **explicitly documented in the source** (lines 695-700) and a banner is shown to the admin at runtime (line 730: "⚠️ DEMO / TRAINING MODE — NOT CONNECTED TO LIVE RESCUE SERVICES"). The "Live" mode toggle exists but is **disabled** with tooltip "Coming soon — requires gps_trail subscription + sos_outbox dispatch + Twilio bridge".

**Tracked as:** Task #45 (separate epic, not in scope of strict-5 cascade).

---

## 📋 Stage 1 — Inventory

### Components in this file (13):
| Component | Purpose |
|-----------|---------|
| `SARProtocolPage` | Main page export |
| `ScenarioPicker` | Scenario presets for demo |
| `MiniTag` | Display tag |
| `PastMissions` | List of resolved missions |
| `MissionDashboard` | Active mission view |
| `MissionHeader` | Header w/ timer + actions |
| `KPIChip` | KPI display chip |
| `DirectLeafletMap` | Leaflet map for search cone |
| `SearchMapPanel` | Tab: map view |
| `EscalationPanel` | Tab: protocol steps |
| `TeamsPanel` | Tab: search teams |
| `LogPanel` | Tab: mission log |

### Interactive Elements (17 buttons identified):
| Line | Element | Action |
|------|---------|--------|
| 791 | Training mode (active) | aria-only; cursor: default |
| 812 | Live mode (disabled) | ⚠️ disabled; "Coming soon" tooltip |
| 893 | Mission switcher | Switches active SAR mission |
| 1031 | Start scenario | Creates SAR mission from preset |
| 1184 | Tab change | Switches mission tabs |
| 1297 | Pause/Resume | Toggles `isPaused` (local state) |
| 1309 | Export PDF | `exportSARReportPDF()` |
| 1322 | Alert Workers | `emitAdminSignal("SAR_ACTIVATED", ...)` |
| 1344 | End Mission menu | Opens dropdown |
| 1374 | End Mission option | `onEndMission(status)` |
| 1594 | Toggle map layer | Toggles trail/cone/hazards/workers |
| 1763 | Toggle escalation step | Expand/collapse step details |
| 1958 | (unidentified) | TBD |

### Data Sources:
- `getActiveSARMissions()` — localStorage missions
- `getAllSARMissions()` — historical missions
- `SAR_SCENARIOS` (mock data) — preset scenarios
- `createSARMission()`, `saveSARMission()` — mission persistence
- `recommendSearchPattern()` — algorithm output
- `calculateSearchCone()` — geometry calculation
- `analyzeTrail()` — GPS trail analysis
- `supabase` — audit logging (mode only — NOT dispatch)

---

## 🧬 Stage 2 — Code Tracing (Critical Buttons)

### 1. **"Alert Workers"** button (line 1322)
**Intent:** Send SAR alert to all nearby mobile workers
**Code path:**
```ts
emitAdminSignal("SAR_ACTIVATED", mission.employeeId, {
  employeeName: mission.employeeName,
  zone: mission.zone,
});
toast.success("SAR Alert sent to all mobile workers", { ... });
```
**Actual behavior:**
- ✅ `emitAdminSignal` DOES broadcast over Supabase Realtime IF a channel is registered
- ⚠️ But mobile-side listener handling of `SAR_ACTIVATED` is **not verified end-to-end** here
- ⚠️ Toast says "sent" but doesn't verify delivery (no ack)
- ❌ "field workers near zone" — **no geo-filtering** in the actual broadcast

**Verdict:** ⚠️ Partial — broadcast goes out, but the claim of "near zone workers" is not enforced; all subscribed devices receive it.

### 2. **"Export PDF"** button (line 1309)
**Intent:** Export SAR report as PDF
**Code path:** `exportSARReportPDF(mission, totalElapsed)` — uses jsPDF
**Actual behavior:**
- ✅ Generates PDF locally
- ✅ Includes mission state + timeline
**Verdict:** ✅ Works as documented (training-mode output).

### 3. **"End Mission" (Found Safe/Injured/Cancel)** (line 1374)
**Intent:** Close out the mission with a status
**Code path:** `onEndMission(opt.status)` → handler in MissionDashboard parent → `saveSARMission()`
**Actual behavior:**
- ✅ Status saved to localStorage
- ✅ Past Missions view will show the resolved mission
- ❌ **No broadcast** to mobile or external authorities — Training mode

### 4. **"Pause/Resume"** (line 1297)
**Intent:** Pause the mission timer
**Code path:** `onTogglePause` → toggles `isPaused` boolean
**Actual behavior:**
- ⚠️ Only pauses the LOCAL elapsed timer counter
- ⚠️ Does NOT pause the escalation protocol (5/10/15/30 min thresholds)
- ⚠️ Does NOT pause the search cone expansion calculation
**Verdict:** ⚠️ MISLEADING — admin thinks they paused the mission but the underlying algorithm keeps running.

### 5. **"Start Scenario"** (line 1031)
**Intent:** Launch a SAR mission from a demo preset
**Code path:** `onStart(s)` → creates `SARMission` via `createSARMission()` → saves
**Actual behavior:**
- ✅ Creates demo mission with all scenario data
- ⚠️ Demo only — no real worker connection

---

## ⚠️ Stage 3 — Intent Verification — Issues Found

### 🚨 CRITICAL: Training/Live Toggle Lock
- Line 812-835: Live button is `disabled` with `aria-disabled="true"`, tooltip says "Coming soon — requires backend wiring"
- **Implication:** The ENTIRE SAR page provides NO real-world rescue capability
- **Required:** Wire `gps_trail` Supabase subscription + `sos_outbox` dispatch + Twilio bridge

### ⚠️ HIGH: "Alert Workers" Doesn't Geo-Filter
- Button label: "Send SAR alert to all nearby mobile workers"
- Reality: broadcasts to ALL subscribed mobile clients, not just those in the zone
- **Fix:** Server-side filter by zone before fanout, OR client-side filter on receive

### ⚠️ HIGH: Pause Button Misleads
- Pause stops the visual timer but NOT the escalation algorithm
- Admin may believe mission is paused → delay action → real-world consequences (if/when live)
- **Fix:** Either:
  - (A) Make Pause actually stop the algorithm AND log "paused at T+Nmin" for audit
  - (B) Remove the Pause button until backend supports it

### ⚠️ MEDIUM: Toast Confirms Without Acknowledgment
- "SAR Alert sent to all mobile workers" — but no ack from Supabase Realtime
- If `_syncChannel` is null (offline / not connected), broadcast silently fails
- **Fix:** Use the `emitSyncEvent` ack pattern we built in strict-4 (Promise<{ delivered: boolean }>)

### ⚠️ MEDIUM: SAR Scenario Picker is Mock-Heavy
- 4 hardcoded scenarios in `SAR_SCENARIOS` — useful for training but no real worker integration
- **Fix:** Add "Start from Connected Lost Worker" flow that picks up `CONNECTION_LOST` SyncEvent

---

## 🧪 Stage 4 — Edge Cases

| Scenario | Current Behavior | Status |
|----------|------------------|--------|
| No active mission, click Pause | Button not rendered (gated by activeMission) | ✅ |
| Pause then End Mission | End works; pause state irrelevant | ✅ |
| Alert Workers when offline | Toast shows "sent" but broadcast silently fails | 🚨 |
| Switch mission mid-emergency | State + toast update; algorithm restarts on new mission | ⚠️ |
| Export PDF mid-mission | Snapshot at moment of click; subsequent updates not in PDF | ✅ |
| End Mission then access map | Mission moved to history; map references prior state | ⚠️ |
| Many concurrent SAR missions | Switcher shows all; only 1 active at a time in view | ✅ |
| SAR mission for unknown worker | mission.employeeId not in employee roster — buttons still work | ⚠️ |
| Cluster-sourced mission (`SAR-CLU-*`) | Special banner shown; same actions available | ✅ |

---

## 📝 Stage 5 — Audit Report Summary

### ✅ Works as documented (5):
1. Export PDF
2. Tab navigation
3. Map layer toggle
4. Escalation step expand/collapse
5. Mission switcher between concurrent missions

### ⚠️ Works but has issues (5):
1. "Alert Workers" — no geo-filter
2. "Alert Workers" — no delivery ack
3. "Pause" — misleading (UI only)
4. End Mission — local only, no external notification (acknowledged in DEMO banner)
5. Scenario Picker — mock-only, no live worker integration

### 🚨 Silent/architectural issues (1 — biggest):
1. **Entire page is Training mode** — Live mode disabled. SAR is **planning + training tool only**. Real rescue requires separate wiring (Task #45).

### 📋 TODOs to fix:
1. **Wire Live mode** (Task #45 — separate epic):
   - `gps_trail` Supabase Realtime subscription
   - `sos_outbox` dispatch table
   - Twilio bridge for external SAR (911/997/112)
2. **Fix Pause semantics** — either pause algorithm or remove button
3. **Add delivery ack to Alert Workers** — use Promise<{ delivered }> pattern
4. **Add zone geo-filter** to SAR_ACTIVATED broadcasts (server-side or client-side)
5. **Add "Start from Connected Lost Worker"** flow (subscribe to CONNECTION_LOST events)
6. **Add audit log entries** for every mission state transition (visible in dashboard-audit-log-page)
7. **Verify mobile listener** for SAR_ACTIVATED — confirm worker phones DO show banner

---

## 💡 Recommendations

**This page is well-architected but not connected to live data.** The TRAINING banner protects users from believing they're getting real rescue capability. The path to "Live" mode is documented (Task #45).

**For the page-by-page audit:**
- This file scored **3/10 on end-to-end functional correctness** (mostly because of the Training-mode constraint).
- Once Live mode is wired, re-audit to verify the dispatch chain actually reaches workers + authorities.

**Suggested next audit:** `company-dashboard.tsx` (the SOS ingress + main admin view) — most critical for the data flow into this SAR page.

---

*Audit generated as part of Phase B end-to-end review. Methodology: 5-stage framework (Inventory → Code Tracing → Intent Verification → Edge Cases → Report).*
