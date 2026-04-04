Complete ALL remaining fixes C, D, E, I, J now.
Do not stop until all 5 are fully implemented.
No partial implementations.

FIX C — Medical Alert Forced Display:
File: sos-emergency-popup.tsx

When SOS popup opens, BEFORE showing any 
action buttons, check for medical data:

const medicalData = getLastEmployeeSync(em.employeeId);

if (medicalData?.bloodType || medicalData?.allergies) {
  Show full-width red banner at TOP of popup:
  Cannot be dismissed.
  Must tap "I've informed responders" to proceed.
  
  Content:
  "🩸 BLOOD TYPE: {bloodType}
   ⚠️ ALLERGIES: {allergies}
   💊 MEDICATIONS: {medications}
   
   Tell responders BEFORE they arrive.
   Wrong treatment could be fatal."
  
  [I've informed responders ✓] ← required button
  Only after tapping → show action buttons
}

FIX D — Shift Handover:
File: company-dashboard.tsx

In logout handler, check active emergencies:

const handleLogout = () => {
  const active = emergencies.filter(
    e => e.status === "active"
  );
  
  if (active.length > 0) {
    Show modal — cannot be dismissed:
    
    "⚠️ {active.length} Active Emergency During Logout
     
     You cannot log out without handover.
     
     Active emergencies:
     {active.map: employee name + zone + elapsed}
     
     Handover note: [text field — required]
     □ I confirm next admin is watching [checkbox]
     
     [Complete Handover & Logout]
     [Cancel — Stay Logged In]"
    
    Store handover note in localStorage:
    storeJSONSync("handover_notes", {
      by: userName,
      at: Date.now(),
      emergencies: active.map(e => e.id),
      note: handoverNote
    });
  }
};

On login, check for pending handover:
const handover = loadJSONSync("handover_notes");
if (handover && Date.now() - handover.at < 3600000) {
  Show banner: "Handover from {handover.by}:
  {handover.note}"
  [Acknowledge & Take Over]
}

FIX E — Post-Incident Monitoring:
Files: company-dashboard.tsx + sos-emergency.tsx

After resolving any emergency:
In safeHandleResolve(), add:

if (resolutionType === "minor" || 
    resolutionType === "monitoring") {
  
  // Set 30-min check-in for this employee
  emitAdminSignal("SET_MONITORING_MODE", {
    employeeId: emergency.employeeId,
    checkInInterval: 30, // minutes
    duration: 120, // monitor for 2 hours
    reason: "Post-incident monitoring"
  });
  
  // Add to monitoring list in dashboard
  addToMonitoring({
    employeeId: emergency.employeeId,
    employeeName: emergency.employeeName,
    reason: emergency.type,
    nextCheckIn: Date.now() + 1800000,
    monitorUntil: Date.now() + 7200000
  });
}

In WorkforcePage or OverviewPage:
Show "Monitoring" section:
Employees in monitoring mode with:
- Amber badge "POST-INCIDENT"
- Countdown to next check-in
- "Check In Now" button
- Auto-escalate if missed check-in

On employee mobile (dashboard.tsx):
When MONITORING_MODE signal received:
Show persistent banner:
"Your supervisor is monitoring you
 Press 'I'm OK' every 30 minutes
 Next check-in: {countdown}
 [I'm OK ✓]"

FIX I — Safe Escalation Path:
Files: sos-emergency.tsx + shared-store.ts

In SOS activation, add discreet option:
Below the main SOS button (small text):
"Situation involves my supervisor? →"
onClick: show options:

"Report Directly to Company Admin
 Your supervisor will NOT be notified first.
 Company admin will handle this."
 
 [Yes, bypass supervisor] [No, normal SOS]

If bypass selected:
emitSyncEvent({
  ...normalSOSPayload,
  bypassZoneAdmin: true,
  escalateTo: "company_admin",
  sensitiveReport: true
});

Dashboard handles bypassZoneAdmin:
- Does NOT show in zone admin view
- Shows ONLY to company_admin role
- Shows special badge: "⚠️ Sensitive Report"

Also in incident-photo-report.tsx:
Add toggle: "Submit anonymously"
When anonymous:
- Remove employeeName from report
- Show as "Anonymous Employee — Zone C"
- Only company_admin can see real identity

FIX J — Proactive Risk Scoring:
Files: dashboard-workforce-page.tsx + 
       company-dashboard.tsx

Create risk scoring function:

function calculateRiskScore(employee): number {
  let score = 0;
  const now = Date.now();
  
  // New employee (< 30 days)
  if (employee.joinDate > now - 2592000000) 
    score += 30;
  
  // No buddy assigned
  const buddy = getBuddyFor(employee.id);
  if (!buddy) score += 20;
  
  // Check-in timer > 2 hours
  if (employee.checkInInterval > 120) 
    score += 20;
  
  // Battery < 20%
  const sync = getLastEmployeeSync(employee.id);
  if (sync?.battery < 20) score += 25;
  
  // Not moved in 30+ minutes (possible collapse)
  if (sync?.lastMovement > 1800000) score += 15;
  
  // Night shift (8PM - 6AM)
  const hour = new Date().getHours();
  if (hour >= 20 || hour < 6) score += 10;
  
  // Working alone (no nearby employees in zone)
  if (employee.isAloneInZone) score += 15;
  
  return Math.min(score, 100);
}

Display in WorkforcePage employee list:
Each employee shows risk score badge:
- 0-40: Green "LOW RISK"
- 41-60: Amber "MEDIUM RISK"  
- 61-80: Orange "HIGH RISK ⚠️"
- 81-100: Red "CRITICAL RISK 🚨"

For CRITICAL employees, show action suggestions:
"Hassan — Risk: 85/100
 ⚠️ New employee + No buddy + Battery 8%
 Suggested actions:
 [Assign Buddy] [Set 30-min Check-in] [Call Now]"

Auto-alert admin when employee reaches 80+:
Show notification: "Hassan's risk score is critical"

Implement ALL 5 fixes completely.
No partial implementations.
Confirm each with exact file + line numbers.
When done, give updated survival rates 
for scenarios C, D, E, I, J.