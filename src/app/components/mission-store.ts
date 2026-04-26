// ═══════════════════════════════════════════════════════════════
// SOSphere — Mission Store (Cross-Tab Bridge)
// Admin creates missions → Employee receives & tracks
// localStorage events for real-time sync between tabs
//
// PRODUCTION MIGRATION:
//   missions data       → supabase.from("missions") table
//   GPS tracking        → supabase.from("mission_gps") table
//   heartbeats          → supabase.from("mission_heartbeats") table
//   Cross-tab events    → supabase.channel("missions").send({ type: "broadcast", ... }) — lint-guard-allow:no-global-realtime-channel (doc only)
//   Real-time updates   → supabase.channel("missions").on("broadcast", ...) — lint-guard-allow:no-global-realtime-channel (doc only)
//   Schema defined in api/rls-policies.ts
// ═══════════════════════════════════════════════════════════════

// ── Mission Types ─────────────────────────────────────────────

export type MissionStatus =
  | "created"        // Admin created — waiting for start time
  | "notified"       // Near start time — employee sees notification
  | "ready"          // Employee accepted — pre-check passed
  | "en_route_out"   // Tracking TO destination
  | "arrived_site"   // Within 50m of destination
  | "working"        // On-site working
  | "en_route_back"  // Return tracking
  | "completed"      // Home safe — mission done
  | "cancelled"      // Cancelled by admin or employee
  | "alert";         // Something wrong — needs attention

export interface GPSPoint {
  lat: number;
  lng: number;
  timestamp: number;
  speed: number;       // km/h
  accuracy: number;    // meters
  isOffline: boolean;
}

export interface Heartbeat {
  timestamp: number;
  gpsEnabled: boolean;
  internetStatus: "wifi" | "4g" | "3g" | "offline";
  batteryLevel: number;
  isAppForeground: boolean;
  location: { lat: number; lng: number } | null;
  speed: number;
}

export interface MissionAlert {
  id: string;
  type: "stopped_long" | "route_deviation" | "speed_high" | "gps_disabled" | "phone_off" | "battery_low" | "fake_gps" | "eta_exceeded" | "no_heartbeat";
  message: string;
  timestamp: number;
  severity: "warning" | "critical";
  acknowledged: boolean;
}

export interface Mission {
  id: string;
  // Assignment
  employeeId: string;
  employeeName: string;
  assignedBy: string;
  createdAt: number;
  // Schedule
  scheduledStart: number;  // timestamp
  scheduledEnd: number;    // estimated return timestamp
  // Locations
  origin: { name: string; lat: number; lng: number };
  destination: { name: string; lat: number; lng: number };
  returnTo: { name: string; lat: number; lng: number };
  arrivalRadius: number;   // meters — default 50
  // Status
  status: MissionStatus;
  // Timestamps per phase
  acceptedAt?: number;
  departedAt?: number;
  arrivedSiteAt?: number;
  workStartedAt?: number;
  leftSiteAt?: number;
  arrivedHomeAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  // Tracking
  gpsTrack: GPSPoint[];
  returnTrack: GPSPoint[];
  heartbeats: Heartbeat[];
  alerts: MissionAlert[];
  offlineBuffer: GPSPoint[];  // stored when offline, merged on sync
  // Stats
  notes: string;
  vehicleType: string;
}

// ── Storage Keys ──────────────────────────────────────────────

const MISSIONS_KEY = "sosphere_missions";
const MISSION_EVENT_KEY = "sosphere_mission_event";

// ── Event Types ───────────────────────────────────────────────

export interface MissionEvent {
  type:
    | "MISSION_CREATED"
    | "MISSION_ACCEPTED"
    | "MISSION_DEPARTED"
    | "MISSION_ARRIVED_SITE"
    | "MISSION_WORK_STARTED"
    | "MISSION_LEFT_SITE"
    | "MISSION_ARRIVED_HOME"
    | "MISSION_COMPLETED"
    | "MISSION_CANCELLED"
    | "MISSION_ALERT"
    | "MISSION_GPS_UPDATE"
    | "MISSION_HEARTBEAT"
    | "MISSION_OFFLINE_SYNC";
  missionId: string;
  timestamp: number;
  data?: Record<string, any>;
}

// ── CRUD ──────────────────────────────────────────────────────

export function getAllMissions(): Mission[] {
  try {
    return JSON.parse(localStorage.getItem(MISSIONS_KEY) || "[]");
  } catch { return []; }
}

export function getMission(id: string): Mission | undefined {
  return getAllMissions().find(m => m.id === id);
}

export function saveMission(mission: Mission) {
  const all = getAllMissions();
  const idx = all.findIndex(m => m.id === mission.id);
  if (idx >= 0) all[idx] = mission;
  else all.unshift(mission);
  localStorage.setItem(MISSIONS_KEY, JSON.stringify(all));
}

function saveMissions(missions: Mission[]) {
  localStorage.setItem(MISSIONS_KEY, JSON.stringify(missions));
}

// ── Emit Event ────────────────────────────────────────────────

export function emitMissionEvent(event: MissionEvent) {
  const payload = JSON.stringify({ ...event, _ts: Date.now() });
  localStorage.setItem(MISSION_EVENT_KEY, payload);
  window.dispatchEvent(new StorageEvent("storage", { key: MISSION_EVENT_KEY, newValue: payload }));
}

// ── Listen for Events ─────────────────────────────────────────

export function onMissionEvent(callback: (event: MissionEvent) => void) {
  const handler = (e: StorageEvent) => {
    if (e.key === MISSION_EVENT_KEY && e.newValue) {
      try { callback(JSON.parse(e.newValue)); } catch {}
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

// ── Admin Actions ─────────────────────────────────────────────

export function createMission(data: {
  employeeId: string;
  employeeName: string;
  assignedBy: string;
  scheduledStart: number;
  scheduledEnd: number;
  origin: { name: string; lat: number; lng: number };
  destination: { name: string; lat: number; lng: number };
  returnTo: { name: string; lat: number; lng: number };
  vehicleType: string;
  notes: string;
}): Mission {
  const mission: Mission = {
    id: `MSN-${Date.now().toString(36).toUpperCase().slice(-5)}`,
    ...data,
    createdAt: Date.now(),
    arrivalRadius: 50,
    status: "created",
    gpsTrack: [],
    returnTrack: [],
    heartbeats: [],
    alerts: [],
    offlineBuffer: [],
  };
  saveMission(mission);
  emitMissionEvent({ type: "MISSION_CREATED", missionId: mission.id, timestamp: Date.now() });
  return mission;
}

export function cancelMission(id: string) {
  const m = getMission(id);
  if (!m) return;
  m.status = "cancelled";
  m.cancelledAt = Date.now();
  saveMission(m);
  emitMissionEvent({ type: "MISSION_CANCELLED", missionId: id, timestamp: Date.now() });
}

// ── Employee Actions ──────────────────────────────────────────

export function acceptMission(id: string) {
  const m = getMission(id);
  if (!m) return;
  m.status = "ready";
  m.acceptedAt = Date.now();
  saveMission(m);
  emitMissionEvent({ type: "MISSION_ACCEPTED", missionId: id, timestamp: Date.now() });
}

export function startMissionDeparture(id: string) {
  const m = getMission(id);
  if (!m) return;
  m.status = "en_route_out";
  m.departedAt = Date.now();
  saveMission(m);
  emitMissionEvent({ type: "MISSION_DEPARTED", missionId: id, timestamp: Date.now() });
}

export function arriveAtSite(id: string) {
  const m = getMission(id);
  if (!m) return;
  m.status = "arrived_site";
  m.arrivedSiteAt = Date.now();
  saveMission(m);
  emitMissionEvent({ type: "MISSION_ARRIVED_SITE", missionId: id, timestamp: Date.now() });
}

export function startWorking(id: string) {
  const m = getMission(id);
  if (!m) return;
  m.status = "working";
  m.workStartedAt = Date.now();
  saveMission(m);
  emitMissionEvent({ type: "MISSION_WORK_STARTED", missionId: id, timestamp: Date.now() });
}

export function leaveSite(id: string) {
  const m = getMission(id);
  if (!m) return;
  m.status = "en_route_back";
  m.leftSiteAt = Date.now();
  saveMission(m);
  emitMissionEvent({ type: "MISSION_LEFT_SITE", missionId: id, timestamp: Date.now() });
}

export function arriveHome(id: string) {
  const m = getMission(id);
  if (!m) return;
  m.status = "completed";
  m.arrivedHomeAt = Date.now();
  m.completedAt = Date.now();
  saveMission(m);
  emitMissionEvent({ type: "MISSION_ARRIVED_HOME", missionId: id, timestamp: Date.now() });
  emitMissionEvent({ type: "MISSION_COMPLETED", missionId: id, timestamp: Date.now() });
}

// ── GPS + Heartbeat ───────────────────────────────────────────

export function addGPSPoint(id: string, point: GPSPoint) {
  const m = getMission(id);
  if (!m) return;
  const track = m.status === "en_route_back" ? m.returnTrack : m.gpsTrack;
  track.push(point);
  // If offline, also buffer
  if (point.isOffline) m.offlineBuffer.push(point);
  saveMission(m);
  emitMissionEvent({ type: "MISSION_GPS_UPDATE", missionId: id, timestamp: Date.now(), data: { point } });
}

export function addHeartbeat(id: string, hb: Heartbeat) {
  const m = getMission(id);
  if (!m) return;
  m.heartbeats.push(hb);
  // Keep last 200 heartbeats
  if (m.heartbeats.length > 200) m.heartbeats = m.heartbeats.slice(-200);
  saveMission(m);
  emitMissionEvent({ type: "MISSION_HEARTBEAT", missionId: id, timestamp: Date.now(), data: { hb } });
}

export function addMissionAlert(id: string, alert: Omit<MissionAlert, "id" | "acknowledged">) {
  const m = getMission(id);
  if (!m) return;
  m.alerts.push({ ...alert, id: `ALT-${Date.now().toString(36)}`, acknowledged: false });
  if (alert.severity === "critical") m.status = "alert";
  saveMission(m);
  emitMissionEvent({ type: "MISSION_ALERT", missionId: id, timestamp: Date.now(), data: alert });
}

export function syncOfflineBuffer(id: string) {
  const m = getMission(id);
  if (!m) return;
  if (m.offlineBuffer.length === 0) return;
  // Mark all as synced
  m.offlineBuffer = [];
  saveMission(m);
  emitMissionEvent({ type: "MISSION_OFFLINE_SYNC", missionId: id, timestamp: Date.now(), data: { count: m.offlineBuffer.length } });
}

// ── Helpers ───────────────────────────────────────────────────

export function getActiveMission(employeeId: string): Mission | undefined {
  return getAllMissions().find(m =>
    m.employeeId === employeeId &&
    !["completed", "cancelled"].includes(m.status)
  );
}

export function getEmployeeMissions(employeeId: string): Mission[] {
  return getAllMissions().filter(m => m.employeeId === employeeId);
}

export function getMissionProgress(m: Mission): number {
  switch (m.status) {
    case "created": return 0;
    case "notified": return 5;
    case "ready": return 10;
    case "en_route_out": return 30;
    case "arrived_site": return 50;
    case "working": return 60;
    case "en_route_back": return 80;
    case "completed": return 100;
    case "cancelled": return 0;
    case "alert": return getMissionProgress({ ...m, status: "en_route_out" }); // keep previous progress
    default: return 0;
  }
}

export const MISSION_STATUS_CONFIG: Record<MissionStatus, { label: string; color: string; icon: string }> = {
  created:       { label: "Scheduled",     color: "#8090A5", icon: "Calendar" },
  notified:      { label: "Notified",      color: "#00C8E0", icon: "Bell" },
  ready:         { label: "Ready",         color: "#34C759", icon: "CheckCircle" },
  en_route_out:  { label: "En Route",      color: "#00C8E0", icon: "Navigation" },
  arrived_site:  { label: "At Site",       color: "#00C853", icon: "MapPin" },
  working:       { label: "Working",       color: "#7B5EFF", icon: "Wrench" },
  en_route_back: { label: "Returning",     color: "#FF9500", icon: "Home" },
  completed:     { label: "Completed",     color: "#00C853", icon: "CheckCircle2" },
  cancelled:     { label: "Cancelled",     color: "#8090A5", icon: "XCircle" },
  alert:         { label: "Alert",         color: "#FF2D55", icon: "AlertTriangle" },
};

// ── Seed Demo Missions ────────────────────────────────────────

export function seedDemoMissions() {
  if (getAllMissions().length > 0) return;
  const now = Date.now();

  const missions: Mission[] = [
    {
      id: "MSN-2026-001",
      employeeId: "EMP-001", employeeName: "Ahmed Khalil",
      assignedBy: "Admin",
      createdAt: now - 7200000,
      scheduledStart: now - 3600000,
      scheduledEnd: now + 7200000,
      origin: { name: "HQ Gate A", lat: 24.7136, lng: 46.6753 },
      destination: { name: "Remote Station Delta", lat: 24.8500, lng: 46.8200 },
      returnTo: { name: "HQ Gate A", lat: 24.7136, lng: 46.6753 },
      arrivalRadius: 50,
      status: "en_route_out",
      acceptedAt: now - 3500000,
      departedAt: now - 3400000,
      gpsTrack: [
        { lat: 24.7136, lng: 46.6753, timestamp: now - 3400000, speed: 0, accuracy: 5, isOffline: false },
        { lat: 24.7300, lng: 46.6900, timestamp: now - 3000000, speed: 65, accuracy: 8, isOffline: false },
        { lat: 24.7550, lng: 46.7200, timestamp: now - 2400000, speed: 78, accuracy: 6, isOffline: false },
        { lat: 24.7800, lng: 46.7500, timestamp: now - 1800000, speed: 72, accuracy: 10, isOffline: true },
        { lat: 24.8000, lng: 46.7700, timestamp: now - 1200000, speed: 68, accuracy: 12, isOffline: true },
        { lat: 24.8150, lng: 46.7900, timestamp: now - 600000, speed: 55, accuracy: 7, isOffline: false },
      ],
      returnTrack: [],
      heartbeats: [
        { timestamp: now - 3000000, gpsEnabled: true, internetStatus: "4g", batteryLevel: 92, isAppForeground: true, location: { lat: 24.73, lng: 46.69 }, speed: 65 },
        { timestamp: now - 2400000, gpsEnabled: true, internetStatus: "4g", batteryLevel: 88, isAppForeground: true, location: { lat: 24.755, lng: 46.72 }, speed: 78 },
        { timestamp: now - 1800000, gpsEnabled: true, internetStatus: "offline", batteryLevel: 84, isAppForeground: true, location: { lat: 24.78, lng: 46.75 }, speed: 72 },
        { timestamp: now - 1200000, gpsEnabled: true, internetStatus: "offline", batteryLevel: 80, isAppForeground: true, location: { lat: 24.80, lng: 46.77 }, speed: 68 },
        { timestamp: now - 600000, gpsEnabled: true, internetStatus: "4g", batteryLevel: 76, isAppForeground: true, location: { lat: 24.815, lng: 46.79 }, speed: 55 },
      ],
      alerts: [],
      offlineBuffer: [],
      vehicleType: "Pickup Truck",
      notes: "Equipment delivery to Station Delta",
    },
    {
      id: "MSN-2026-002",
      employeeId: "EMP-008", employeeName: "Omar Al-Farsi",
      assignedBy: "Zone Admin B",
      createdAt: now - 10800000,
      scheduledStart: now - 7200000,
      scheduledEnd: now - 1800000,
      origin: { name: "Zone C Lab", lat: 24.6500, lng: 46.6000 },
      destination: { name: "Warehouse 7", lat: 24.7000, lng: 46.6800 },
      returnTo: { name: "Zone C Lab", lat: 24.6500, lng: 46.6000 },
      arrivalRadius: 50,
      status: "working",
      acceptedAt: now - 7100000,
      departedAt: now - 7000000,
      arrivedSiteAt: now - 5400000,
      workStartedAt: now - 5300000,
      gpsTrack: [
        { lat: 24.6500, lng: 46.6000, timestamp: now - 7000000, speed: 0, accuracy: 4, isOffline: false },
        { lat: 24.6700, lng: 46.6300, timestamp: now - 6400000, speed: 45, accuracy: 6, isOffline: false },
        { lat: 24.6900, lng: 46.6600, timestamp: now - 5800000, speed: 50, accuracy: 5, isOffline: false },
        { lat: 24.6980, lng: 46.6780, timestamp: now - 5400000, speed: 10, accuracy: 4, isOffline: false },
      ],
      returnTrack: [],
      heartbeats: [
        { timestamp: now - 600000, gpsEnabled: true, internetStatus: "wifi", batteryLevel: 61, isAppForeground: true, location: { lat: 24.70, lng: 46.68 }, speed: 0 },
      ],
      alerts: [],
      offlineBuffer: [],
      vehicleType: "Van",
      notes: "Inventory check & equipment maintenance",
    },
    {
      id: "MSN-2026-003",
      employeeId: "EMP-005", employeeName: "Sara Al-Mutairi",
      assignedBy: "Admin",
      createdAt: now - 14400000,
      scheduledStart: now - 10800000,
      scheduledEnd: now - 3600000,
      origin: { name: "HQ", lat: 24.7136, lng: 46.6753 },
      destination: { name: "Zone E Logistics Hub", lat: 24.8000, lng: 46.7800 },
      returnTo: { name: "HQ", lat: 24.7136, lng: 46.6753 },
      arrivalRadius: 50,
      status: "completed",
      acceptedAt: now - 10700000,
      departedAt: now - 10600000,
      arrivedSiteAt: now - 8400000,
      workStartedAt: now - 8300000,
      leftSiteAt: now - 5400000,
      arrivedHomeAt: now - 3800000,
      completedAt: now - 3800000,
      gpsTrack: [
        { lat: 24.7136, lng: 46.6753, timestamp: now - 10600000, speed: 0, accuracy: 3, isOffline: false },
        { lat: 24.7500, lng: 46.7200, timestamp: now - 9600000, speed: 60, accuracy: 5, isOffline: false },
        { lat: 24.7980, lng: 46.7780, timestamp: now - 8400000, speed: 15, accuracy: 4, isOffline: false },
      ],
      returnTrack: [
        { lat: 24.7980, lng: 46.7780, timestamp: now - 5400000, speed: 0, accuracy: 4, isOffline: false },
        { lat: 24.7500, lng: 46.7200, timestamp: now - 4500000, speed: 55, accuracy: 6, isOffline: false },
        { lat: 24.7136, lng: 46.6753, timestamp: now - 3800000, speed: 10, accuracy: 4, isOffline: false },
      ],
      heartbeats: [],
      alerts: [],
      offlineBuffer: [],
      vehicleType: "Company Car",
      notes: "Logistics review & supply chain check",
    },
    {
      id: "MSN-2026-004",
      employeeId: "EMP-006", employeeName: "Mohammed Ali",
      assignedBy: "Admin",
      createdAt: now - 1800000,
      scheduledStart: now + 3600000,  // starts in 1 hour
      scheduledEnd: now + 14400000,
      origin: { name: "Zone D Gate", lat: 24.6300, lng: 46.5800 },
      destination: { name: "Emergency Repair Site", lat: 24.7200, lng: 46.7200 },
      returnTo: { name: "Zone D Gate", lat: 24.6300, lng: 46.5800 },
      arrivalRadius: 50,
      status: "created",
      gpsTrack: [],
      returnTrack: [],
      heartbeats: [],
      alerts: [],
      offlineBuffer: [],
      vehicleType: "Service Truck",
      notes: "Urgent pipeline repair — bring welding kit",
    },
    {
      id: "MSN-2026-005",
      employeeId: "EMP-003", employeeName: "Fatima Hassan",
      assignedBy: "Admin",
      createdAt: now - 5400000,
      scheduledStart: now - 3600000,
      scheduledEnd: now + 3600000,
      origin: { name: "HQ Gate B", lat: 24.7150, lng: 46.6770 },
      destination: { name: "Training Center North", lat: 24.7800, lng: 46.7400 },
      returnTo: { name: "HQ Gate B", lat: 24.7150, lng: 46.6770 },
      arrivalRadius: 50,
      status: "alert",
      acceptedAt: now - 3500000,
      departedAt: now - 3400000,
      gpsTrack: [
        { lat: 24.7150, lng: 46.6770, timestamp: now - 3400000, speed: 0, accuracy: 5, isOffline: false },
        { lat: 24.7300, lng: 46.6950, timestamp: now - 2800000, speed: 55, accuracy: 7, isOffline: false },
        { lat: 24.7400, lng: 46.7050, timestamp: now - 2400000, speed: 40, accuracy: 8, isOffline: false },
      ],
      returnTrack: [],
      heartbeats: [
        { timestamp: now - 2400000, gpsEnabled: true, internetStatus: "4g", batteryLevel: 45, isAppForeground: true, location: { lat: 24.74, lng: 46.705 }, speed: 40 },
        { timestamp: now - 1800000, gpsEnabled: true, internetStatus: "4g", batteryLevel: 38, isAppForeground: false, location: { lat: 24.74, lng: 46.705 }, speed: 0 },
        { timestamp: now - 1200000, gpsEnabled: false, internetStatus: "offline", batteryLevel: 22, isAppForeground: false, location: null, speed: 0 },
      ],
      alerts: [
        { id: "ALT-1", type: "stopped_long", message: "Stopped for 20+ minutes at unknown location", timestamp: now - 1800000, severity: "warning", acknowledged: false },
        { id: "ALT-2", type: "battery_low", message: "Battery dropped to 22%", timestamp: now - 1200000, severity: "warning", acknowledged: false },
        { id: "ALT-3", type: "gps_disabled", message: "GPS was disabled", timestamp: now - 1200000, severity: "critical", acknowledged: false },
      ],
      offlineBuffer: [],
      vehicleType: "Company Car",
      notes: "Safety training session at North Center",
    },
  ];

  saveMissions(missions);
}