# 🔍 Page Audit Report — `dashboard-pages.tsx`

**Date:** 2026-05-25
**Auditor:** Phase B end-to-end framework
**File:** `src/app/components/dashboard-pages.tsx` (3,622 lines)
**Criticality:** 🔴 HIGH — Hosts EmergencyWatchdog (auto-escalation) + Employee Detail + multiple page bodies

---

## 🎯 Executive Findings

> **4 buttons that LIE — they show success toasts but DO NOTHING.**
> **EmpDetailView shows HARDCODED MOCK medical/contact data for every employee.**

These are the most dangerous kind of silent bugs in life-safety software: the UI **claims success** while the underlying action **never happens**. An admin clicks "Call 997" and thinks help is on the way — when actually NOTHING was dialed.

---

## 📋 Stage 1 — Inventory

### Components (10 exported pages + 4 internal):
| Component | Purpose |
|-----------|---------|
| `OverviewPage` | Main overview tab (KPIs, hotspots, watchdog) |
| `WebOverviewLayout` | Web-mode overview layout |
| `EmpDetailView` | Employee detail with 4 tabs (Profile, Medical, Contacts, History) |
| `EmployeesPage` | Workforce listing + risk scoring |
| `EmergenciesPage` | Live emergencies + actions |
| `ZonesPage` | Zone management |
| `IncidentHistoryPage` | Past incidents |
| `AttendancePage` | Check-in compliance |
| `CreateEmergencyDrawer` | Manual emergency creation |
| `ZoneClusterBanner` | Cluster detection alerts |
| `LiveZoneArrivals` | Live arrivals widget |
| `EvidenceIntelBanner` | Evidence pipeline banner |
| `EmergencyWatchdog` (consumer) | 5-min unattended auto-escalation |

### Interactive Elements:
- **74 `onClick` handlers**
- **6 `useEffect` hooks**
- Multiple action buttons per emergency (dispatch, broadcast, escalate, contain, resolve, close, take ownership, export PDF)

---

## 🧬 Stage 2 — Code Tracing (Critical Paths)

### 1. **EmergencyWatchdog "Take Action"** (line 1304-1313)
**Intent:** When watchdog detects 5min unattended emergency, click → take action
**Code:**
```ts
onTakeAction={(id) => {
  const emergency = sorted.find(e => e.id === id);
  if (emergency) {
    toast.success(`Opening emergency for ${emergency.employeeName}`, {
      description: "Taking immediate action",
    });
    // In real implementation, this would open AI Co-Admin   ← ❌
  }
}}
```
**Actual behavior:**
- ✅ Toast shown ("Taking immediate action")
- ❌ **NOTHING happens** — admin's screen doesn't change
- ❌ AI Co-Admin doesn't open
- ❌ Emergency doesn't get focused
- ❌ No audit log entry

**Verdict:** 🚨 **LIE** — UI says action taken; reality: no action.

### 2. **EmergencyWatchdog "Call 997"** (line 1314-1323)
**Intent:** Auto-escalation button to dial 997 (Saudi emergency)
**Code:**
```ts
onCall997={(id) => {
  const emergency = sorted.find(e => e.id === id);
  if (emergency) {
    toast.success("📞 Calling 997 Emergency Services", {
      description: `For ${emergency.employeeName} in ${emergency.zone}`,
    });
    // In real implementation with Twilio:                    ← ❌
    // twilioCall("997", { emergencyId: id, location: ... });  ← ❌
  }
}}
```
**Actual behavior:**
- ✅ Toast shown ("📞 Calling 997 Emergency Services")
- ❌ **NO PHONE CALL IS MADE**
- ❌ Twilio not invoked
- ❌ 997 (the actual emergency line) is NOT dialed
- ❌ No call record, no Twilio billing event

**Verdict:** 🚨🚨🚨 **CRITICAL LIE** — Admin sees "Calling 997" toast, thinks help is on the way. **NO ONE IS CALLED.** A worker could die while admin waits for the imaginary 997 dispatcher.

### 3. **EmpDetailView Mock Data** (lines 1347-1363)
**Intent:** Show employee's real medical ID, contacts, history
**Code:**
```ts
const MEDICAL_DATA = {
  bloodType: "A+", allergies: ["Penicillin", "Latex"],
  medications: ["Aspirin 100mg", "Metformin 500mg"],
  conditions: ["Type 2 Diabetes", "Hypertension"],
  emergencyNote: "Patient requires insulin kit on-site. Do NOT administer morphine.",
  ...
};
const CONTACTS = [
  { name: "Mona Al-Khalil", relation: "Wife", phone: "+966 50 111 2233", ... },
  ...
];
const INCIDENTS = [ /* hardcoded list */ ];
```
**Actual behavior:**
- 🚨 EVERY employee shows the SAME hardcoded medical info
- 🚨 EVERY employee shows the SAME hardcoded contacts
- 🚨 EVERY employee shows the SAME hardcoded incident history

**Verdict:** 🚨🚨🚨 **CRITICAL** — If an admin acts on this info during an emergency (e.g., "do NOT administer morphine"), they're acting on FAKE DATA. **Life-threatening medical errors possible.**

### 4. **Emergency Action: "Broadcast"** (line 2579)
```ts
onClick: () => { toast.success("Broadcasting Alert", { description: `Emergency broadcast sent to all workers in ${selected.zone || "all zones"}` }); }
```
**Actual behavior:**
- ✅ Toast shown
- ❌ **NO broadcast sent** — no `sendBroadcast()` call, no `emitSyncEvent()`
**Verdict:** 🚨 LIE — admin thinks workers were alerted; they were NOT.

### 5. **Emergency Action: "Escalate"** (line 2580)
```ts
onClick: () => { toast.success("Escalated to Management", { description: `Emergency ${selected.id} escalated to Zone Admin & Safety Director` }); }
```
**Actual behavior:**
- ✅ Toast shown
- ❌ **NO escalation** — no `emitSyncEvent("ESCALATION_UPDATE")`, no notification
**Verdict:** 🚨 LIE — admin thinks management was notified; they were NOT.

### 6. **Emergency Action: "Dispatch Team"** (line 2578)
```ts
onClick: () => dispatchTeam(selected.id)
```
**Status:** Uses `dispatchTeam` from data-layer.ts. **Need to verify this actually dispatches.**

---

## ⚠️ Stage 3 — Intent Verification — Issues Found

### 🚨🚨🚨 CRITICAL: 4 LYING BUTTONS in life-safety paths
1. **"Call 997"** in Watchdog → no call made
2. **"Take Action"** in Watchdog → no action
3. **"Broadcast Alert"** in emergency actions → no broadcast
4. **"Escalate to Management"** → no escalation

**Pattern:** Each shows `toast.success()` then leaves a code comment `// In real implementation, ...` describing what SHOULD happen. The promised implementation **never landed**.

### 🚨 CRITICAL: EmpDetailView is 100% MOCK
- Medical ID: hardcoded
- Contacts: hardcoded
- Incident history: hardcoded
- **Risk:** Admin in real emergency reads wrong blood type, gives wrong medication, calls wrong emergency contact → potential death.

### ⚠️ MEDIUM: EmergencyWatchdog adapter loses data
- We added the EmergencyItem→Emergency mapper in strict-5
- But `actionsLog: []` is always empty
- The watchdog can't see prior actions taken
- May fire false-positive "unattended" alerts even if admin has taken actions logged elsewhere

### ⚠️ LOW: Several pages have hardcoded mock data
- Past missions, hotspots, hub navigation — all show mocks until store hydrates

---

## 🧪 Stage 4 — Edge Cases

| Scenario | Behavior | Status |
|----------|----------|--------|
| Admin clicks "Call 997" during real emergency | Toast says calling; no call made | 🚨 |
| Admin reads employee medical ID | Shows hardcoded "A+ Penicillin allergy" for EVERYONE | 🚨 |
| Admin clicks "Take Action" on watchdog alert | Toast; nothing happens | 🚨 |
| Admin broadcasts alert | Toast; no actual broadcast | 🚨 |
| Watchdog 5-min timer expires | Detection works; auto-escalation buttons LIE | 🚨 |
| Dispatch team from emergency drawer | Calls dispatchTeam() — needs verification | ❓ |
| Resolve emergency from drawer | Calls resolveEmg() — works (verified in company-dashboard) | ✅ |
| Create emergency from drawer | onCreate handler creates EmergencyItem — works | ✅ |
| Export Lifecycle PDF | generateEmergencyLifecyclePDF() — uses real data | ✅ |

---

## 📝 Stage 5 — Audit Report Summary

### ✅ Works as documented (8):
1. Page navigation
2. Tab switching within pages
3. Zone listing (uses store)
4. Workforce listing with risk scoring
5. Resolve/contain/close emergency
6. Take ownership
7. Export Lifecycle PDF
8. Create emergency drawer

### ⚠️ Works but has issues (4):
1. EmergencyWatchdog `actionsLog: []` always empty
2. Mock hotspots/activities until store hydrates
3. EmergencyWatchdog adapter type-cast was added in strict-5 but data integrity unverified
4. CreateEmergencyDrawer doesn't populate employeeId (admin-created emergencies have no worker link)

### 🚨🚨🚨 LIES — CRITICAL Silent Bugs (5):
1. **Call 997 button doesn't dial** (Twilio not wired)
2. **Take Action button does nothing** (AI Co-Admin not opened)
3. **Broadcast Alert button doesn't broadcast** (no sendBroadcast)
4. **Escalate to Management button doesn't escalate** (no notification)
5. **EmpDetailView shows fake medical/contact data for everyone** (hardcoded mocks)

### 📋 TODOs to fix (10):
1. **P0 LIFE-SAFETY:** Wire `onCall997` to actual Twilio call (or remove button + replace with "Call 997 manually" instruction)
2. **P0 LIFE-SAFETY:** Wire `onTakeAction` to open AI Co-Admin / IRE panel
3. **P0:** Replace EmpDetailView mock data with real fetches from Supabase / store
4. **P0:** Wire "Broadcast Alert" to `sendBroadcast()`
5. **P0:** Wire "Escalate" to `emitSyncEvent("ESCALATION_UPDATE")`
6. **P1:** EmergencyWatchdog actionsLog should pull from audit log store
7. **P1:** CreateEmergencyDrawer should accept optional employee selection (link to worker)
8. **P2:** Replace hardcoded mocks with skeleton loading until store hydrates
9. **P2:** Add audit log entries for Watchdog actions
10. **P2:** Verify dispatchTeam actually dispatches (separate audit needed)

---

## 💡 Recommendations

**This file has the most life-threatening silent bugs found so far.** The "Call 997" button is the worst because:
- Saudi emergency line is 997 (matters to primary market)
- An admin trusting this button could delay a real call by minutes
- A worker bleeding out, having a stroke, or trapped underground could die

**Priority order:**
- **P0 IMMEDIATE:** Either implement the 5 lying buttons OR remove them and replace with manual instructions ("Tap the worker's phone number to dial directly")
- **P0 IMMEDIATE:** EmpDetailView mock data is a malpractice risk — must show "Data not loaded" or "Profile incomplete" if real data unavailable
- **P1:** EmergencyWatchdog integration with audit log

### Doctrine-aligned framing:
> "A button that shows success but does nothing **is worse than no button at all**. It creates false confidence at the moment of greatest need."

### Next audit:
`dashboard-evacuation-page.tsx` — also part of the dashboard hub, with its own action buttons. Will check if "Trigger Evacuation" actually triggers anything.

---

*Audit generated as part of Phase B end-to-end review.*
