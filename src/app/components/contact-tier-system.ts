// ═══════════════════════════════════════════════════════════════
// SOSphere — Contact Tier System
// 3 types: Full Contact | Lite Contact | Ghost Contact
// + Safety Link generator + Emergency Ripple engine
// + Tracking permissions based on plan tier
// ═══════════════════════════════════════════════════════════════

// ── Contact Types ─────────────────────────────────────────────

export type ContactType = "full" | "lite" | "ghost";
export type ContactPlan = "free" | "pro";
export type TrackingRole = "watcher" | "beacon" | "mutual";

export interface SafetyContact {
  id: string;
  name: string;
  phone: string;
  relation: string;
  priority: number;
  isFavorite: boolean;
  // Tier system
  type: ContactType;        // full | lite | ghost
  hasApp: boolean;          // does this person have SOSphere?
  theirPlan: ContactPlan;   // their account plan
  // Tracking
  trackingRole: TrackingRole; // watcher = I track them, beacon = they track me, mutual = both
  locationSharingEnabled: boolean;
  lastKnownLocation: { lat: number; lng: number; timestamp: number } | null;
  locationUpdateFrequency: number; // seconds — 30 for pro, 300 for free
  // Safety Link (for ghost contacts)
  safetyLinkId: string | null;     // unique link ID
  safetyLinkExpiry: number | null;  // timestamp
  safetyLinkActive: boolean;
  // Status
  isOnline: boolean;
  lastSeen: number;        // timestamp
  batteryLevel: number | null;
  appStatus: "active" | "background" | "closed" | "uninstalled";
  // Consent
  consentGiven: boolean;
  consentTimestamp: number | null;
  // Stats
  totalAlertsReceived: number;
  totalAlertsResponded: number;
  avgResponseTime: number; // seconds
  addedAt: number;
}

// ── Plan Limits ───────────────────────────────────────────────

export const PLAN_LIMITS = {
  free: {
    maxWatchTargets: 1,          // can track 1 person
    maxBeaconAllowances: 1,      // can be tracked by 1 person
    maxGhostContacts: 1,         // 1 ghost contact
    locationUpdateInterval: 300,  // 5 minutes
    trackHistoryDays: 7,
    geofenceZones: 0,
    safeWalkEnabled: false,
    emergencyRippleWaves: 2,     // only 2 waves
    smartAlerts: false,
  },
  pro: {
    maxWatchTargets: Infinity,   // unlimited
    maxBeaconAllowances: Infinity,
    maxGhostContacts: Infinity,
    locationUpdateInterval: 30,   // 30 seconds (real-time)
    trackHistoryDays: 90,
    geofenceZones: 10,
    safeWalkEnabled: true,
    emergencyRippleWaves: 3,     // all 3 waves
    smartAlerts: true,
  },
} as const;

// ── Contact Type Config ───────────────────────────────────────

export const CONTACT_TYPE_CONFIG: Record<ContactType, {
  label: string;
  description: string;
  color: string;
  icon: string;
  features: string[];
  limitations: string[];
}> = {
  full: {
    label: "Full Contact",
    description: "Has SOSphere app — full two-way safety features",
    color: "#00C853",
    icon: "Shield",
    features: [
      "Real-time location sharing",
      "Two-way SOS alerts",
      "In-app emergency chat",
      "Battery & signal monitoring",
      "Geofence notifications",
      "Trip tracking & ETA",
    ],
    limitations: [],
  },
  lite: {
    label: "Lite Contact",
    description: "Has SOSphere app (free plan) — limited tracking",
    color: "#00C8E0",
    icon: "User",
    features: [
      "Shares location with 1 person",
      "Receives SOS alerts",
      "Basic SOS button works",
      "Location updates every 5 min",
    ],
    limitations: [
      "Cannot track multiple people",
      "No smart alerts / intelligence",
      "No geofence notifications",
      "7-day history only",
    ],
  },
  ghost: {
    label: "Ghost Contact",
    description: "No app — receives SMS + Safety Link during emergencies",
    color: "#FF9500",
    icon: "Link",
    features: [
      "Receives SMS during SOS",
      "Safety Link with live map",
      "One-tap 'I'm coming' response",
      "Emergency call button",
    ],
    limitations: [
      "No location sharing from them",
      "No real-time tracking",
      "Link expires after 24 hours",
      "SMS-only notifications",
    ],
  },
};

// ── Emergency Ripple System ───────────────────────────────────

export interface RippleWave {
  id: number;
  label: string;
  delay: number;          // seconds from SOS trigger
  description: string;
  icon: string;
  color: string;
  targetTypes: ContactType[];
  action: string;
  requiresPro: boolean;
}

export const EMERGENCY_RIPPLE_WAVES: RippleWave[] = [
  {
    id: 1,
    label: "Wave 1 — Instant",
    delay: 0,
    description: "Push notification + live location to Full contacts",
    icon: "Zap",
    color: "#FF2D55",
    targetTypes: ["full"],
    action: "PUSH_NOTIFICATION + LIVE_LOCATION",
    requiresPro: false,
  },
  {
    id: 2,
    label: "Wave 2 — 30 seconds",
    delay: 30,
    description: "Alert Lite contacts + SMS with Safety Link to Ghost contacts",
    icon: "Radio",
    color: "#FF9500",
    targetTypes: ["lite", "ghost"],
    action: "PUSH_LITE + SMS_SAFETY_LINK",
    requiresPro: false,
  },
  {
    id: 3,
    label: "Wave 3 — 2 minutes",
    delay: 120,
    description: "Auto-call nearest contact + alert local emergency services",
    icon: "Phone",
    color: "#00C8E0",
    targetTypes: ["full", "lite", "ghost"],
    action: "AUTO_CALL + EMERGENCY_SERVICES",
    requiresPro: true,
  },
];

// ── Safety Link Generator ─────────────────────────────────────

export function generateSafetyLink(contactId: string, userName: string): {
  linkId: string;
  url: string;
  expiry: number;
} {
  const linkId = `SL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const expiry = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  return {
    linkId,
    url: `https://sosphere.co/safety/${userName.toLowerCase().replace(/\s+/g, "-")}/${linkId}`,
    expiry,
  };
}

// ── Permission Check ──────────────────────────────────────────

export function canTrackContact(myPlan: ContactPlan, currentWatchCount: number): boolean {
  const limits = PLAN_LIMITS[myPlan];
  return currentWatchCount < limits.maxWatchTargets;
}

export function canBeTrackedBy(myPlan: ContactPlan, currentBeaconCount: number): boolean {
  const limits = PLAN_LIMITS[myPlan];
  return currentBeaconCount < limits.maxBeaconAllowances;
}

export function getLocationUpdateInterval(plan: ContactPlan): number {
  return PLAN_LIMITS[plan].locationUpdateInterval;
}

// ── Determine Contact Type ────────────────────────────────────

export function determineContactType(hasApp: boolean, theirPlan: ContactPlan): ContactType {
  if (!hasApp) return "ghost";
  if (theirPlan === "pro") return "full";
  return "lite";
}

// ── Storage ───────────────────────────────────────────────────

const CONTACTS_KEY = "sosphere_safety_contacts";

export function getSafetyContacts(): SafetyContact[] {
  try {
    return JSON.parse(localStorage.getItem(CONTACTS_KEY) || "[]");
  } catch { return []; }
}

export function saveSafetyContacts(contacts: SafetyContact[]) {
  localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
}

export function addSafetyContact(contact: Omit<SafetyContact, "id" | "addedAt" | "safetyLinkId" | "safetyLinkExpiry" | "safetyLinkActive" | "totalAlertsReceived" | "totalAlertsResponded" | "avgResponseTime">): SafetyContact {
  const contacts = getSafetyContacts();
  const newContact: SafetyContact = {
    ...contact,
    id: `SC-${Date.now().toString(36).toUpperCase()}`,
    addedAt: Date.now(),
    safetyLinkId: null,
    safetyLinkExpiry: null,
    safetyLinkActive: false,
    totalAlertsReceived: 0,
    totalAlertsResponded: 0,
    avgResponseTime: 0,
  };
  
  // Auto-generate safety link for ghost contacts
  if (contact.type === "ghost") {
    const link = generateSafetyLink(newContact.id, contact.name);
    newContact.safetyLinkId = link.linkId;
    newContact.safetyLinkExpiry = link.expiry;
    newContact.safetyLinkActive = true;
  }
  
  contacts.push(newContact);
  saveSafetyContacts(contacts);
  return newContact;
}

// ── Mock Demo Contacts ────────────────────────────────────────

export function seedDemoContacts() {
  if (getSafetyContacts().length > 0) return;
  const now = Date.now();
  
  const demo: SafetyContact[] = [
    {
      id: "SC-001",
      name: "Sarah Johnson",
      phone: "+966 5XX XXX 1234",
      relation: "Spouse",
      priority: 1,
      isFavorite: true,
      type: "full",
      hasApp: true,
      theirPlan: "pro",
      trackingRole: "mutual",
      locationSharingEnabled: true,
      lastKnownLocation: { lat: 24.7136, lng: 46.6753, timestamp: now - 120000 },
      locationUpdateFrequency: 30,
      safetyLinkId: null,
      safetyLinkExpiry: null,
      safetyLinkActive: false,
      isOnline: true,
      lastSeen: now - 30000,
      batteryLevel: 85,
      appStatus: "active",
      consentGiven: true,
      consentTimestamp: now - 86400000 * 30,
      totalAlertsReceived: 3,
      totalAlertsResponded: 3,
      avgResponseTime: 12,
      addedAt: now - 86400000 * 90,
    },
    {
      id: "SC-002",
      name: "Omar Johnson",
      phone: "+966 5XX XXX 5678",
      relation: "Parent",
      priority: 2,
      isFavorite: false,
      type: "lite",
      hasApp: true,
      theirPlan: "free",
      trackingRole: "beacon",
      locationSharingEnabled: true,
      lastKnownLocation: { lat: 24.6800, lng: 46.6500, timestamp: now - 600000 },
      locationUpdateFrequency: 300,
      safetyLinkId: null,
      safetyLinkExpiry: null,
      safetyLinkActive: false,
      isOnline: true,
      lastSeen: now - 300000,
      batteryLevel: 62,
      appStatus: "background",
      consentGiven: true,
      consentTimestamp: now - 86400000 * 60,
      totalAlertsReceived: 2,
      totalAlertsResponded: 2,
      avgResponseTime: 45,
      addedAt: now - 86400000 * 60,
    },
    {
      id: "SC-003",
      name: "Mom (Fatima)",
      phone: "+966 5XX XXX 9012",
      relation: "Parent",
      priority: 3,
      isFavorite: false,
      type: "ghost",
      hasApp: false,
      theirPlan: "free",
      trackingRole: "watcher",
      locationSharingEnabled: false,
      lastKnownLocation: null,
      locationUpdateFrequency: 0,
      safetyLinkId: "SL-M7K2X-DEMO",
      safetyLinkExpiry: now + 86400000,
      safetyLinkActive: true,
      isOnline: false,
      lastSeen: 0,
      batteryLevel: null,
      appStatus: "uninstalled",
      consentGiven: true,
      consentTimestamp: now - 86400000 * 15,
      totalAlertsReceived: 1,
      totalAlertsResponded: 1,
      avgResponseTime: 180,
      addedAt: now - 86400000 * 15,
    },
    {
      id: "SC-004",
      name: "Alex (Son)",
      phone: "+966 5XX XXX 3456",
      relation: "Child",
      priority: 4,
      isFavorite: true,
      type: "full",
      hasApp: true,
      theirPlan: "pro",
      trackingRole: "mutual",
      locationSharingEnabled: true,
      lastKnownLocation: { lat: 24.7300, lng: 46.6900, timestamp: now - 60000 },
      locationUpdateFrequency: 30,
      safetyLinkId: null,
      safetyLinkExpiry: null,
      safetyLinkActive: false,
      isOnline: true,
      lastSeen: now - 60000,
      batteryLevel: 71,
      appStatus: "active",
      consentGiven: true,
      consentTimestamp: now - 86400000 * 45,
      totalAlertsReceived: 1,
      totalAlertsResponded: 1,
      avgResponseTime: 8,
      addedAt: now - 86400000 * 45,
    },
    {
      id: "SC-005",
      name: "Uncle Fahad",
      phone: "+966 5XX XXX 7890",
      relation: "Other",
      priority: 5,
      isFavorite: false,
      type: "ghost",
      hasApp: false,
      theirPlan: "free",
      trackingRole: "watcher",
      locationSharingEnabled: false,
      lastKnownLocation: null,
      locationUpdateFrequency: 0,
      safetyLinkId: "SL-F4HD-DEMO",
      safetyLinkExpiry: now + 86400000,
      safetyLinkActive: true,
      isOnline: false,
      lastSeen: 0,
      batteryLevel: null,
      appStatus: "uninstalled",
      consentGiven: true,
      consentTimestamp: now - 86400000 * 7,
      totalAlertsReceived: 0,
      totalAlertsResponded: 0,
      avgResponseTime: 0,
      addedAt: now - 86400000 * 7,
    },
  ];
  
  saveSafetyContacts(demo);
}

// ── Emergency Ripple Simulation ───────────────────────────────

export interface RippleResult {
  waveId: number;
  contactId: string;
  contactName: string;
  contactType: ContactType;
  action: string;
  sentAt: number;
  respondedAt: number | null;
  response: "acknowledged" | "coming" | "called_911" | "no_response" | null;
}

export function simulateEmergencyRipple(contacts: SafetyContact[]): RippleResult[] {
  const now = Date.now();
  const results: RippleResult[] = [];
  
  // Wave 1: Full contacts — instant
  contacts.filter(c => c.type === "full").forEach(c => {
    results.push({
      waveId: 1,
      contactId: c.id,
      contactName: c.name,
      contactType: "full",
      action: "Push notification + live location",
      sentAt: now,
      respondedAt: c.isOnline ? now + (c.avgResponseTime || 15) * 1000 : null,
      response: c.isOnline ? "acknowledged" : null,
    });
  });
  
  // Wave 2: Lite + Ghost — 30s delay
  contacts.filter(c => c.type === "lite").forEach(c => {
    results.push({
      waveId: 2,
      contactId: c.id,
      contactName: c.name,
      contactType: "lite",
      action: "Push notification (simplified)",
      sentAt: now + 30000,
      respondedAt: c.isOnline ? now + 30000 + (c.avgResponseTime || 60) * 1000 : null,
      response: c.isOnline ? "acknowledged" : null,
    });
  });
  
  contacts.filter(c => c.type === "ghost").forEach(c => {
    results.push({
      waveId: 2,
      contactId: c.id,
      contactName: c.name,
      contactType: "ghost",
      action: "SMS + Safety Link",
      sentAt: now + 30000,
      respondedAt: null,        // Real: populated when contact actually responds
      response: "no_response",  // Real: updated via SMS reply webhook (Twilio)
    });
  });
  
  return results;
}
