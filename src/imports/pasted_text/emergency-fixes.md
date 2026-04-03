Execute these 4 final fixes NOW:

FIX 1 — Emergency bypasses billing (4 hours):
In plan-gate.tsx and company-dashboard.tsx,
add this safety override:

const isEmergencyActive = emergencies.some(
  e => e.status === "active"
);

// Safety always wins over billing
if (isEmergencyActive) {
  // Never block these pages regardless of plan:
  // emergencyHub, riskMap, commandCenter
  return <>{children}</>;
}

In TrialExpiredOverlay, add to TRIAL_ALLOWED_PAGES:
"emergencyHub", "riskMap", "commandCenter"

Employee SOS must ALWAYS work regardless of:
- Trial expired
- Payment failed  
- Account suspended
- Grace period ended

Add to canCreateEmergency() in mobile-company.ts:
// SOS is always allowed - billing never blocks safety
export function canTriggerSOS(): boolean {
  return true; // unconditional
}

FIX 2 — Guide Me auto-reopens (4 hours):
In company-dashboard.tsx,
add a useEffect that monitors active emergencies:

useEffect(() => {
  if (!showIntelligentGuide && !showAICoAdmin) {
    const timer = setTimeout(() => {
      const active = emergencies.filter(
        e => e.status === "active"
      );
      if (active.length > 0) {
        // Gentle reminder, not forced
        toast("🆘 Active emergency needs attention", {
          action: {
            label: "Open Guide Me",
            onClick: () => setShowAICoAdmin(true)
          },
          duration: 30000 // stays for 30 seconds
        });
      }
    }, 30000); // after 30s of inactivity
    return () => clearTimeout(timer);
  }
}, [emergencies, showIntelligentGuide, showAICoAdmin]);

FIX 3 — GPS accuracy warning:
In ai-co-admin.tsx Phase 0 and 
sos-emergency-popup.tsx,
add GPS accuracy display:

const gpsAccuracy = getLastKnownPosition()?.accuracy;

if (gpsAccuracy && gpsAccuracy > 100) {
  show red banner:
  "⚠️ GPS UNRELIABLE — ±{gpsAccuracy}m accuracy
   Location may be wrong. Ask employee:
   'What do you see around you?'
   'What floor/building are you in?'"
}

if (gpsAccuracy && gpsAccuracy <= 20) {
  show green badge: "GPS Accurate ±{gpsAccuracy}m"
}

if (!gpsAccuracy) {
  show amber badge: "GPS Unknown — indoors?"
}

FIX 4 — Subscription cliff safety override:
In mobile-company.ts canCreateEmergency():

// Current code blocks suspended accounts
// Change to: billing NEVER blocks SOS

export function canCreateEmergency(
  state: CompanyState
): boolean {
  return true; // SOS is always allowed
}

// Instead show a warning banner:
// "⚠️ Account suspended — SOS still works
//  but dashboard features are limited
//  Renew now to restore full functionality"

In company-dashboard.tsx billing status banner:
When account is suspended/expired:
Show yellow banner at top:
"⚠️ Subscription issue — Emergency features 
 still active. Other features paused. 
 [Renew Now]"

Confirm all 4 fixes with exact file and line numbers.