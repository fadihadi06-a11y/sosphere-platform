# 🔍 Page Audit Report — `dashboard-evacuation-page.tsx`

**Date:** 2026-05-25
**Auditor:** Phase B end-to-end framework
**File:** `src/app/components/dashboard-evacuation-page.tsx` (1,156 lines)
**Criticality:** 🔴 HIGH — Zone evacuation = mass workers, life-safety critical

---

## 🎯 Executive Findings

> **Good news: this page actually invokes real functions** (`triggerEvacuation`, `sendBroadcast`, `cancelEvacuation`, `completeEvacuation`).
> **Bad news: the broadcast model doesn't reach workers' mobile phones reliably.** `sendBroadcast` writes to localStorage + dispatches a window event + emits a `STATUS_CHANGE` SyncEvent — but workers' apps may not act on STATUS_CHANGE as an evacuation alert.

**Also:** the silent showTriggerModal state bug we fixed in strict-5 means **prior to that PR**, the trigger modal would never close after evacuation. This was a real broken UX.

---

## 📋 Stage 1 — Inventory

### Components (7):
- `DashboardEvacuationPage` — main export
- `ActiveEvacuationBanner` — live evacuation status
- `TriggerPanel` — start evacuation flow
- `AssemblyPointsSetup` — manage assembly points
- `AssemblyPointModal` — create/edit assembly point
- `EmployeePreview` — preview before triggering
- `EmployeeStatusRow` — per-employee evacuation status

### Interactive Elements:
- **19 `onClick` handlers**
- **3 `useEffect` hooks**

### Actions invoked (real functions):
- `triggerEvacuation()` — creates ActiveEvacuation in store
- `sendBroadcast()` — saves to localStorage + emits STATUS_CHANGE
- `completeEvacuation()` — marks complete
- `cancelEvacuation()` — cancels active evacuation
- `getEvacuationStatuses()` — reads per-worker status
- `getZoneGPS()`, `getEvacuationPoints()` — config readers
- `getActiveEvacuation()`, `getEvacuationHistory()` — store readers

---

## 🧬 Stage 2 — Code Tracing (Critical Path)

### **Trigger Evacuation Flow** (line 98-121)

**Intent:** Admin selects zone + reason → triggers evacuation → broadcasts to workers.

**Code:**
```ts
const handleTriggerEvacuation = () => {
  if (!selectedZone || !evacuationReason.trim()) return;
  // ... validation
  triggerEvacuation(evacuation);  // ✅ Saves to store
  sendBroadcast({
    title: `🚨 EVACUATION ORDER — ${zone.name}`,
    body: `IMMEDIATE EVACUATION REQUIRED. Reason: ${...}`,
    priority: "emergency",
    audience: { type: "zone", zoneIds: [selectedZone] },
    ...
  });
  setShowTriggerModal(false);  // ← Fixed in strict-5
  ...
};
```

**Trace `sendBroadcast`** (shared-store.ts:1450):
```ts
export function sendBroadcast(msg) {
  // 1. Save to localStorage
  localStorage.setItem(BROADCAST_KEY, JSON.stringify([broadcast, ...all]));
  // 2. Dispatch window event (same-browser tabs only)
  window.dispatchEvent(new StorageEvent("storage", { key: BROADCAST_NOTIFY_KEY, ... }));
  // 3. Emit STATUS_CHANGE sync event (cross-device)
  emitSyncEvent({ type: "STATUS_CHANGE", ..., data: { broadcastId, broadcastTitle, ... } });
}
```

**Trace mobile-side STATUS_CHANGE listener:** Workers' mobile app needs to listen for `STATUS_CHANGE` SyncEvents and recognize evacuations. **NOT VERIFIED** end-to-end here.

---

## ⚠️ Stage 3 — Intent Verification — Issues Found

### 🚨 CRITICAL: Broadcast distribution model
- `sendBroadcast` emits `STATUS_CHANGE` over Supabase Realtime — but `STATUS_CHANGE` is a GENERIC event type
- Mobile listeners may not recognize this as an EVACUATION
- Required check: does `mobile-app.tsx` listen for STATUS_CHANGE and route evacuation broadcasts to a dedicated UI banner?
- **Expected:** A dedicated `EVACUATION_TRIGGERED` SyncEvent type with full evacuation payload

### 🚨 HIGH: No push notifications
- Evacuation broadcasts saved locally + STATUS_CHANGE sync
- **NO PUSH** notification fired (no FCM, no APNs, no SMS fallback)
- If worker's app is in background or offline → they miss the evacuation order
- Required: integration with `fcm-push.ts` / `push-notifications.tsx` to fire push on evacuation

### ⚠️ MEDIUM: Assembly Points are admin-managed only
- Workers can't see assembly points in the app unless they've been pre-onboarded
- New workers (joined mid-day) may not know where to go

### ⚠️ MEDIUM: `setShowTriggerModal(false)` was broken pre-strict-5
- We fixed it (added the missing useState declaration)
- But the modal probably never visibly persisted — was always closing instantly due to other state cycling
- Need real-device test post-strict-5 to verify the modal opens/closes correctly

### ⚠️ MEDIUM: Cancel evacuation broadcast has "normal" priority
```ts
priority: "normal",  // for cancellation broadcast
```
**Issue:** Workers should KNOW immediately if evacuation is cancelled — "normal" priority may be lost in queue
**Fix:** Cancellation should be at least "urgent" priority

### ⚠️ LOW: No audit log entries for evacuation actions
- triggerEvacuation, complete, cancel — none log to `audit-log-store`
- Important for post-incident review and compliance

---

## 🧪 Stage 4 — Edge Cases

| Scenario | Behavior | Status |
|----------|----------|--------|
| Trigger evacuation with no reason | `return;` early — button does nothing visible | ⚠️ |
| Trigger when no assembly point set | Allowed (only checks selectedZone + reason) | ⚠️ |
| Multiple evacuations simultaneously | Each gets unique ID; UI may not show all | ⚠️ |
| Worker offline at trigger | STATUS_CHANGE queued in Supabase Realtime IF connected later | ✅ |
| Worker offline indefinitely | **NO broadcast received until they come online** | 🚨 (no SMS fallback) |
| Cancel mid-evacuation | sendBroadcast with priority "normal" — may not be seen urgently | ⚠️ |
| Worker arrives at assembly | Status tracked via getEvacuationStatuses() — REAL or MOCK? | ❓ |
| Complete evacuation | sendBroadcast "ALL CLEAR" with priority "urgent" | ✅ |

---

## 📝 Stage 5 — Audit Report Summary

### ✅ Works as documented (6):
1. Trigger evacuation invokes `triggerEvacuation()` (real store update)
2. `sendBroadcast()` saves + dispatches sync event
3. Cancel/Complete actions invoke real functions
4. UI state management (setShowTriggerModal fixed in strict-5)
5. Assembly points CRUD
6. Live evacuation banner

### ⚠️ Works but has issues (5):
1. STATUS_CHANGE event may not be recognized as evacuation by mobile
2. No push notification → offline workers miss alerts
3. Cancel uses "normal" priority — too low
4. Assembly Points not pushed to new workers
5. No audit log entries

### 🚨 Silent bugs (2):
1. **Broadcast distribution gap** — workers may not receive evacuation alerts reliably (no push, only STATUS_CHANGE)
2. **No SMS fallback** — offline workers in genuine evacuation get NO message

### 📋 TODOs to fix (8):
1. **P0 LIFE-SAFETY:** Add dedicated `EVACUATION_TRIGGERED` SyncEvent type (not STATUS_CHANGE) so mobile can route to dedicated full-screen evacuation banner
2. **P0 LIFE-SAFETY:** Wire push notifications (FCM) for evacuation broadcasts
3. **P0 LIFE-SAFETY:** Add SMS fallback via Twilio for offline workers (Path B)
4. **P1:** Cancel evacuation broadcast priority should be "urgent" not "normal"
5. **P1:** Add audit log entries for trigger/complete/cancel
6. **P1:** Verify mobile-side handler for STATUS_CHANGE recognizes evacuation
7. **P2:** Pre-populate assembly points for new workers
8. **P2:** Multi-zone evacuation support (currently single zone)

---

## 💡 Recommendations

**This page is BETTER than dashboard-pages.tsx** — actual functions are called. But the **delivery model is weak** for mass evacuation:

- The store + broadcast pattern works for same-tab and connected devices
- **But workers in tunnels, basements, low-signal areas, or with closed apps WILL NOT receive evacuation orders**
- For life-safety: this requires **redundant delivery** (push + SMS + sound) — exactly what's missing

### The Doctrine §2 principle applies here:
> "L1 (UI signal), L4 (push), L5 (SMS fallback) — multiple paths, the most critical messages use ALL paths."

### Next audit:
`dashboard-comms-hub.tsx` — comms hub for admin-worker chat. Verify chat delivery works end-to-end.

---

*Audit generated as part of Phase B end-to-end review.*
