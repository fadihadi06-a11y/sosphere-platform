# 🔍 Page Audit Report — `company-dashboard.tsx`

**Date:** 2026-05-25
**Auditor:** Phase B end-to-end framework
**File:** `src/app/components/company-dashboard.tsx` (4,018 lines)
**Criticality:** 🔴 HIGHEST — Central admin hub, SOS ingress, AI Co-Admin trigger, monitoring activation

---

## 🎯 Executive Findings

> **3 SILENT BUGS uncovered** in the SOS-to-AI-Co-Admin dispatch chain.
> **AI Co-Admin starts triage with NO battery/signal/GPS data — exactly what it needs to prioritize life-saving decisions.**

This is a **DATA INTEGRITY** issue in the most critical reception path. When a worker triggers SOS:
- ✅ Their phone/employeeId/zone REACHES the dashboard (fixed in strict-5)
- ❌ Battery, signal, and GPS info are LOST before reaching the AI triage logic

---

## 📋 Stage 1 — Inventory

### Components (15 sub-components):
| Component | Purpose |
|-----------|---------|
| `CompanyDashboard` | Main page export |
| `HubTabBar` | Multi-tab hub navigation |
| `TrialBanner` | Trial countdown banner |
| `TrialBlockedModal` | Plan limit modals |
| `GuideQuickPanel` | Quick triage launcher |
| `IreTriagePanel` | Intelligent Response Engine picker |
| `CrossHubPrompt` | Cross-feature navigation after resolve |
| `RoleBadgeChip` | Active role display |
| `EnterprisePageHeader` | Page header |
| `GuideSubtitle` | Guide me hint |
| `DashSidebar` | Left nav rail |
| `NavGroupLabel` | Sidebar section labels |
| `SidebarNavItem` | Nav item |
| `DashTopbar` | Top app bar |
| `MissedCallsPanel` | Missed calls drawer |

### Hooks:
- **16 `useEffect` hooks** (data sync, real-time subscriptions, auto-refresh)
- **51 imports** from `shared-store` (onSyncEvent, emitAdminSignal, etc.)
- **43 `onClick` handlers**

### Event Listener — `onSyncEvent` (line 821, single handler):
Processes 18 event types:
1. `SOS_TRIGGERED` — main SOS ingress
2. `HAZARD_REPORT` — hazard report
3. `FALL_DETECTED` — auto-detected fall
4. `SHAKE_SOS` — shake-to-SOS gesture
5. `AUDIO_EVIDENCE` — evidence upload
6. `EMERGENCY_CHAT` — chat message
7. `GPS_TRAIL_UPDATE` — GPS breadcrumb
8. `SOS_CONTACT_ANSWERED` — contact answered
9. `SOS_RECORDING_STARTED` — ambient recording
10. `STATUS_UPDATE` — employee status
11. `INCIDENT_REPORT_RECEIVED` — incident photo+audio
12. `CHECKIN` — check-in
13. `STATUS_CHANGE` — status change
14. `SOS_CANCELLED` — SOS cancellation
15. `CONNECTION_LOST` — watchdog
16. `SAR_ACTIVATED` — SAR mission start
17. `BATTERY_CRITICAL` — low battery
18. `CHECKIN_WARNING` — late check-in
19. `BUDDY_ALERT` — buddy notification
20. `SAFE_WALK_*` — walk tracking
21. `MONITORING_*` — post-incident monitoring

---

## 🧬 Stage 2 — Code Tracing (Critical Path)

### SOS_TRIGGERED Handler (line 822-878)

**Intent:** Receive SOS from mobile, create EmergencyItem, auto-trigger AI Co-Admin.

**Step 1 — EmergencyItem creation (lines 833-848):** ✅
```ts
const sosData = event.data || {};
const gps = sosData.lastGPS as ...;
addEmergency({
  ...
  phone: (sosData.phone as string | undefined) || empObj?.phone,
  batteryLevel: typeof sosData.battery === "number" ? sosData.battery : undefined,
  signalStrength: sosData.signal as ...,
  location: gps ? {...} : undefined,
});
```
**Status:** ✅ Reads from `sosData.battery`, `sosData.signal`, `sosData.lastGPS` — matches mobile payload.

**Step 2 — AI Co-Admin Context (lines 860-877):** 🚨 **BROKEN**
```ts
const ctx: AICoAdminContext = {
  ...
  batteryLevel: event.data?.batteryLevel as number | undefined,         // 🚨 WRONG KEY
  signalStrength: event.data?.signalStrength as ... | undefined,        // 🚨 WRONG KEY
  lastGPS: event.data?.lastGPS as ... | undefined,                      // 🚨 not sent for SOS_TRIGGERED
  ...
};
```

**Mobile actually sends (sos-emergency.tsx:2531-2540):**
```ts
data: {
  phone: userPhone,
  bloodType: userBloodType,
  emergencyId: errIdRef.current,
  battery: null,          // ← key is "battery", not "batteryLevel"
  signal: signalType,     // ← key is "signal", not "signalStrength"
  bypassZoneAdmin: ...,
  // NO lastGPS in SOS_TRIGGERED payload
}
```

**Result:** AI Co-Admin **always** receives:
- `batteryLevel: undefined`
- `signalStrength: undefined`
- `lastGPS: undefined`

The AI then makes triage decisions WITHOUT this critical context. **This is life-safety degraded silently.**

---

## ⚠️ Stage 3 — Intent Verification — Issues Found

### 🚨 CRITICAL #1: AI Co-Admin Context Key Mismatch
- **Lines:** 869, 870, 871
- **Impact:** Every SOS triage starts blind to battery/signal/GPS
- **Fix:** Use the same key names as the EmergencyItem mapping (lines 844-847):
  ```ts
  batteryLevel: typeof event.data?.battery === "number" ? event.data.battery : undefined,
  signalStrength: event.data?.signal as "excellent" | "good" | "fair" | "poor" | "none" | undefined,
  lastGPS: undefined, // Not sent in SOS_TRIGGERED; pulled from later GPS_TRAIL_UPDATE events
  ```

### 🚨 CRITICAL #2: 2-Second Delay on AI Co-Admin (line 877)
```ts
setTimeout(() => { ... }, 2000); // 2s delay to show SOS notification first
```
**Issue:** In a mass-casualty event, those 2 seconds matter. The notification is already shown by `toast` system. **Why delay the triage?**
**Fix:** Open AI Co-Admin immediately; toast shows in parallel.

### 🚨 HIGH #3: Active Emergency Gate Caps AI to 1 at a Time (line 860)
```ts
if (activeCount <= 1 && !showAICoAdmin && aiGate.allowed) { ... }
```
**Issue:** During mass-casualty (3+ workers in SOS simultaneously), AI Co-Admin opens for ONLY the first one. The 2nd, 3rd, 4th... get NO AI triage.
**Fix:** Either:
- (A) Queue: open AI for next after current closes
- (B) Multi-emergency mode: AI handles N emergencies in priority order

### ⚠️ MEDIUM #4: AI Co-Admin Doesn't Get Audio Evidence
- When `AUDIO_EVIDENCE` arrives (line 923), only `incrementNotifCount()` fires
- AI Co-Admin never sees the audio context for triage
- **Fix:** Pass audio/evidence into AI Co-Admin context when available

### ⚠️ MEDIUM #5: GPS_TRAIL_UPDATE Just Increments Counter (line 925)
```ts
if (event.type === "GPS_TRAIL_UPDATE") incrementNotifCount();
```
**Issue:** Live GPS updates are arriving but NOT updating the emergency's `location` field. The map stays at the initial GPS point.
**Fix:** Use `updateEmergency` to merge new GPS into emergency.location.

### ⚠️ MEDIUM #6: Connection Lost Doesn't Auto-Launch SAR (line 989)
**Code:** Creates emergency with type "Connection Lost (Watchdog)" but does NOT auto-launch SAR Protocol page.
**Comment in toast says:** "Monitor or initiate SAR."
**Issue:** Forces admin to manually navigate — seconds lost.
**Fix:** Auto-open SAR Protocol with this emergency pre-loaded.

### ⚠️ MEDIUM #7: BATTERY_CRITICAL Toast Has 15s Duration (line 1016)
**Issue:** Critical info shown for only 15 seconds. If admin away from screen, it's gone.
**Fix:** Critical battery should persist until acknowledged, or appear in a dedicated banner.

### ⚠️ LOW #8: CHECKIN_WARNING Uses event.employeeId WITHOUT FALLBACK (line 1034)
```ts
employeeId: event.employeeId || "EMP-UNKNOWN",
```
**Issue:** Fallback "EMP-UNKNOWN" pollutes warnings list if employeeId is missing. Better: skip the warning entirely with a console.error.

---

## 🧪 Stage 4 — Edge Cases

| Scenario | Current Behavior | Status |
|----------|------------------|--------|
| First SOS event | AI Co-Admin opens after 2s | ✅ (slow) |
| 2nd SOS while AI Co-Admin is open | AI does NOT open for 2nd | 🚨 |
| SOS with no battery data | AI gets undefined batteryLevel | 🚨 (key mismatch + true undefined) |
| SOS for unknown employee | empObj null; falls back to event data | ✅ |
| SOS_CANCELLED with no emergencyId | cancelEmergencyById gets "" | ⚠️ |
| CONNECTION_LOST | New emergency created, admin must navigate manually | ⚠️ |
| BATTERY_CRITICAL | Toast 15s, new emergency, but no GPS map update | ⚠️ |
| Multiple BUDDY_ALERT same worker | Each fires emitAdminSignal | ✅ |
| Offline (no _syncChannel) | onSyncEvent listener still works via localStorage | ✅ |

---

## 📝 Stage 5 — Audit Report Summary

### ✅ Works as documented (12):
1. SOS_TRIGGERED → EmergencyItem creation (with full life-safety enrichment from strict-5)
2. HAZARD_REPORT, FALL_DETECTED → emergencies created
3. INCIDENT_REPORT_RECEIVED → evidence stored
4. SOS_CANCELLED → cancel by ID
5. Audit log entries (trackEventSync)
6. Notification count increments
7. Buddy alert forwarding
8. Hub tab navigation
9. Trial banner gating
10. Plan limit modals
11. Missed calls panel
12. Sidebar navigation

### ⚠️ Works but has issues (5):
1. CONNECTION_LOST — no auto-SAR launch
2. BATTERY_CRITICAL — toast disappears
3. GPS_TRAIL_UPDATE — doesn't update emergency.location
4. AUDIO_EVIDENCE — doesn't feed AI Co-Admin
5. CHECKIN_WARNING — "EMP-UNKNOWN" pollution

### 🚨 Silent runtime bugs (3 CRITICAL):
1. **AI Co-Admin batteryLevel key mismatch** — always undefined
2. **AI Co-Admin signalStrength key mismatch** — always undefined
3. **2nd+ concurrent SOS skip AI Co-Admin** — mass casualty UX bug

### 📋 TODOs to fix (8):
1. Fix AICoAdminContext key names: `batteryLevel` ← `event.data.battery`, etc.
2. Remove 2-second AI Co-Admin delay
3. Queue/multi-emergency mode for AI Co-Admin
4. Wire AUDIO_EVIDENCE into AI Co-Admin context
5. Update emergency.location on GPS_TRAIL_UPDATE
6. Auto-launch SAR on CONNECTION_LOST
7. Persistent banner for BATTERY_CRITICAL (not just toast)
8. CHECKIN_WARNING — skip events with missing employeeId

---

## 💡 Recommendations

**This is the highest-impact audit so far** — 3 CRITICAL silent bugs in the SOS reception path that degrade AI triage **for every single SOS event since launch**.

### Priority order for fixes:
- **P0** (Today): #1 (key mismatch) — wire batteryLevel/signalStrength correctly
- **P1** (This week): #3 (multi-SOS queue), #2 (remove delay)
- **P2** (Next sprint): #5 (live GPS), #6 (auto-SAR), #7 (battery banner)
- **P3**: #4 (audio), #8 (warning cleanup)

### Next audit:
`dashboard-pages.tsx` — the routing hub that orchestrates which page renders. Suspected issues with EmergencyWatchdog adapter (we fixed type in strict-5 but didn't verify runtime correctness).

---

*Audit generated as part of Phase B end-to-end review.*
