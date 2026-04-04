// ═══════════════════════════════════════════════════════════════
// SOSphere — SAR Protocol Engine (Search & Rescue)
// ─────────────────────────────────────────────────────────────
// The MOST CRITICAL safety feature in SOSphere.
//
// When a worker goes missing and is NOT at their last GPS point,
// this engine answers: "WHERE DO WE LOOK NEXT?"
//
// Core Concept: SEARCH CONE
//   Last GPS + Speed + Heading + Time Elapsed + Terrain
//   = Probability zone (cone/circle) that EXPANDS over time
//
// Adapts to worker type:
//   - Driver on road → cone follows road corridors
//   - Walker on foot → circular spread
//   - Solo remote mission → high-alert mode
//   - Underground worker → vertical + horizontal cone
//
// Escalation Protocol:
//   0 min  → Connection Watchdog detects silence
//   5 min  → Auto-ping device (sound/vibrate)
//   10 min → Alert buddy + nearest workers
//   15 min → Alert Zone Admin + show search cone
//   30 min → Alert Command Center + dispatch rescue
//   45 min → External SAR activation + GPS trail shared
//   60 min → Full emergency protocol + authorities
// ═══════════════════════════════════════════════════════════════

// ── Types ──────────────────────────────────────────────────────

export type WorkerType = "driver" | "walker" | "solo_remote" | "underground" | "maritime" | "aerial";
export type TerrainType = "urban" | "desert" | "mountain" | "forest" | "marine" | "underground" | "industrial";
export type SARPhase = "watchdog" | "alert" | "search" | "rescue" | "recovery" | "external" | "critical";
export type SearchPattern = "expanding_square" | "sector" | "parallel_track" | "creeping_line" | "spiral";

export interface GPSBreadcrumb {
  lat: number;
  lng: number;
  timestamp: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  source: "gps" | "dead_reckoning" | "cell_tower" | "wifi";
  altitude?: number | null;
  batteryLevel?: number | null;
}

export interface SearchCone {
  /** Center point (last known position) */
  originLat: number;
  originLng: number;
  /** Direction of travel (degrees from north) */
  heading: number;
  /** Half-angle of the cone (degrees) — wider = more uncertainty */
  spreadAngle: number;
  /** Maximum radius in meters */
  maxRadius: number;
  /** Minimum radius (inner bound) */
  minRadius: number;
  /** Probability heat zones */
  probabilityZones: ProbabilityZone[];
  /** Time since last contact */
  elapsedMinutes: number;
  /** Estimated max speed (m/s) */
  maxSpeed: number;
  /** Confidence level 0-100 */
  confidence: number;
  /** Is this a 360° circle (no heading info) or directional cone */
  isCircular: boolean;
}

export interface ProbabilityZone {
  /** "high" = 60-90% likely here, "medium" = 30-60%, "low" = 10-30% */
  level: "high" | "medium" | "low";
  radiusMin: number;
  radiusMax: number;
  color: string;
  opacity: number;
  /** Percentage probability */
  probability: number;
}

export interface NearbyWorker {
  id: string;
  name: string;
  role: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  lastSeen: number;
  phone: string;
  canAssist: boolean;
  assignedTask?: string;
  estimatedArrivalMin?: number;
}

export interface HazardZone {
  id: string;
  name: string;
  type: "cliff" | "water" | "mine_shaft" | "chemical" | "electrical" | "construction" | "road" | "restricted";
  lat: number;
  lng: number;
  radiusMeters: number;
  severity: "lethal" | "dangerous" | "caution";
  overlapPercent: number; // % overlap with search cone
}

export interface EscalationStep {
  id: string;
  phase: SARPhase;
  triggerMinutes: number;
  title: string;
  description: string;
  actions: EscalationAction[];
  isComplete: boolean;
  completedAt?: number;
  isActive: boolean;
  icon: string;
  color: string;
}

export interface EscalationAction {
  id: string;
  type: "auto_ping" | "alert_buddy" | "alert_nearby" | "alert_admin" | "alert_command" | "dispatch_rescue" | "call_external" | "share_gps" | "activate_beacon" | "sound_alarm";
  label: string;
  status: "pending" | "executing" | "done" | "failed";
  target?: string;
  timestamp?: number;
}

export interface TrailAnalysis {
  totalPoints: number;
  totalDistance: number; // meters
  averageSpeed: number; // m/s
  maxSpeed: number;
  lastSpeed: number;
  lastHeading: number;
  movementPattern: "stationary" | "walking" | "running" | "driving" | "erratic";
  stopsDetected: TrailStop[];
  directionChanges: number;
  elevationChange: number;
  timeSinceLastPoint: number; // minutes
  deadReckoningPoints: number;
  gpsQuality: "excellent" | "good" | "fair" | "poor" | "lost";
  trailDuration: number; // minutes
}

export interface TrailStop {
  lat: number;
  lng: number;
  duration: number; // seconds
  timestamp: number;
}

export interface SARMission {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  workerType: WorkerType;
  zone: string;
  terrain: TerrainType;
  /** When connection was lost */
  connectionLostAt: number;
  /** Current SAR phase */
  currentPhase: SARPhase;
  /** Search cone data */
  searchCone: SearchCone;
  /** Trail analysis */
  trailAnalysis: TrailAnalysis;
  /** GPS breadcrumb trail */
  trail: GPSBreadcrumb[];
  /** Nearby workers who can help */
  nearbyWorkers: NearbyWorker[];
  /** Hazard zones in search area */
  hazardZones: HazardZone[];
  /** Escalation timeline */
  escalation: EscalationStep[];
  /** Recommended search pattern */
  searchPattern: SearchPattern;
  /** Search teams dispatched */
  searchTeams: SearchTeam[];
  /** Mission status */
  status: "active" | "found_safe" | "found_injured" | "found_deceased" | "cancelled" | "transferred";
  /** Last updated */
  updatedAt: number;
  /** Notes/log */
  log: MissionLogEntry[];
}

export interface SearchTeam {
  id: string;
  name: string;
  members: string[];
  assignedZone: string;
  pattern: SearchPattern;
  status: "standby" | "en_route" | "searching" | "found" | "returning";
  lat?: number;
  lng?: number;
}

export interface MissionLogEntry {
  timestamp: number;
  type: "system" | "admin" | "auto" | "external";
  message: string;
  severity: "info" | "warning" | "critical";
}

// ── Constants ──────────────────────────────────────────────────

const EARTH_RADIUS = 6371000; // meters

/** Speed assumptions by worker type (m/s) */
const SPEED_BY_TYPE: Record<WorkerType, { walk: number; run: number; vehicle: number }> = {
  driver:       { walk: 1.4, run: 3.0, vehicle: 25.0 },
  walker:       { walk: 1.4, run: 3.0, vehicle: 0 },
  solo_remote:  { walk: 1.2, run: 2.5, vehicle: 15.0 },
  underground:  { walk: 0.8, run: 1.5, vehicle: 5.0 },
  maritime:     { walk: 0.5, run: 1.0, vehicle: 8.0 },
  aerial:       { walk: 1.4, run: 3.0, vehicle: 50.0 },
};

/** Terrain speed modifiers */
const TERRAIN_MODIFIER: Record<TerrainType, number> = {
  urban: 1.0,
  desert: 0.7,
  mountain: 0.5,
  forest: 0.6,
  marine: 0.3,
  underground: 0.4,
  industrial: 0.8,
};

/** Cone spread by GPS quality (degrees half-angle) */
const SPREAD_BY_QUALITY: Record<string, number> = {
  excellent: 15,
  good: 25,
  fair: 40,
  poor: 60,
  lost: 90, // Full 180° = basically a semicircle
};

// ── Haversine ──────────────────────────────────────────────────

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function destinationPoint(lat: number, lng: number, distMeters: number, bearingDeg: number): [number, number] {
  const d = distMeters / EARTH_RADIUS;
  const br = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [(lat2 * 180) / Math.PI, (lng2 * 180) / Math.PI];
}

// ── Trail Analysis ─────────────────────────────────────────────

export function analyzeTrail(trail: GPSBreadcrumb[]): TrailAnalysis {
  if (trail.length === 0) {
    return {
      totalPoints: 0, totalDistance: 0, averageSpeed: 0, maxSpeed: 0,
      lastSpeed: 0, lastHeading: 0, movementPattern: "stationary",
      stopsDetected: [], directionChanges: 0, elevationChange: 0,
      timeSinceLastPoint: 999, deadReckoningPoints: 0,
      gpsQuality: "lost", trailDuration: 0,
    };
  }

  const sorted = [...trail].sort((a, b) => a.timestamp - b.timestamp);
  let totalDist = 0;
  let maxSpd = 0;
  let dirChanges = 0;
  let prevHeading: number | null = null;
  const stops: TrailStop[] = [];
  let drPoints = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const dist = haversine(prev.lat, prev.lng, curr.lat, curr.lng);
    totalDist += dist;

    const dt = (curr.timestamp - prev.timestamp) / 1000;
    if (dt > 0) {
      const spd = dist / dt;
      if (spd > maxSpd) maxSpd = spd;
    }

    // Detect stops (less than 2m movement in 30+ seconds)
    if (dist < 2 && dt > 30) {
      const lastStop = stops[stops.length - 1];
      if (lastStop && haversine(lastStop.lat, lastStop.lng, curr.lat, curr.lng) < 5) {
        lastStop.duration += dt;
      } else {
        stops.push({ lat: curr.lat, lng: curr.lng, duration: dt, timestamp: curr.timestamp });
      }
    }

    // Direction changes (>45° change)
    if (curr.heading !== null && prevHeading !== null) {
      const diff = Math.abs(curr.heading - prevHeading);
      if (diff > 45 && diff < 315) dirChanges++;
    }
    if (curr.heading !== null) prevHeading = curr.heading;

    if (curr.source === "dead_reckoning") drPoints++;
  }

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const durationMin = (last.timestamp - first.timestamp) / 60000;
  const timeSinceLast = (Date.now() - last.timestamp) / 60000;
  const avgSpeed = durationMin > 0 ? totalDist / (durationMin * 60) : 0;

  // Determine movement pattern
  let pattern: TrailAnalysis["movementPattern"] = "stationary";
  if (avgSpeed > 10) pattern = "driving";
  else if (avgSpeed > 3) pattern = "running";
  else if (avgSpeed > 0.5) pattern = "walking";
  else if (dirChanges > sorted.length * 0.3) pattern = "erratic";

  // GPS quality
  const avgAccuracy = sorted.reduce((s, p) => s + p.accuracy, 0) / sorted.length;
  let quality: TrailAnalysis["gpsQuality"] = "excellent";
  if (avgAccuracy > 100) quality = "poor";
  else if (avgAccuracy > 50) quality = "fair";
  else if (avgAccuracy > 20) quality = "good";

  if (timeSinceLast > 30) quality = "lost";
  else if (timeSinceLast > 15) quality = "poor";

  const elevChange = sorted.reduce((sum, p, i) => {
    if (i === 0 || !p.altitude || !sorted[i - 1].altitude) return sum;
    return sum + Math.abs((p.altitude || 0) - (sorted[i - 1].altitude || 0));
  }, 0);

  return {
    totalPoints: sorted.length,
    totalDistance: Math.round(totalDist),
    averageSpeed: Math.round(avgSpeed * 100) / 100,
    maxSpeed: Math.round(maxSpd * 100) / 100,
    lastSpeed: last.speed ?? avgSpeed,
    lastHeading: last.heading ?? (sorted.length >= 2 ? bearing(sorted[sorted.length - 2].lat, sorted[sorted.length - 2].lng, last.lat, last.lng) : 0),
    movementPattern: pattern,
    stopsDetected: stops,
    directionChanges: dirChanges,
    elevationChange: Math.round(elevChange),
    timeSinceLastPoint: Math.round(timeSinceLast * 10) / 10,
    deadReckoningPoints: drPoints,
    gpsQuality: quality,
    trailDuration: Math.round(durationMin * 10) / 10,
  };
}

// ── Search Cone Calculator ─────────────────────────────────────

export function calculateSearchCone(
  trail: GPSBreadcrumb[],
  analysis: TrailAnalysis,
  workerType: WorkerType,
  terrain: TerrainType,
  elapsedMinutes: number,
): SearchCone {
  const last = trail.length > 0 ? trail[trail.length - 1] : null;
  if (!last) {
    return {
      originLat: 0, originLng: 0, heading: 0, spreadAngle: 180,
      maxRadius: 5000, minRadius: 0, probabilityZones: [],
      elapsedMinutes, maxSpeed: 1.4, confidence: 0, isCircular: true,
    };
  }

  // Calculate max possible speed
  const speedProfile = SPEED_BY_TYPE[workerType];
  const terrainMod = TERRAIN_MODIFIER[terrain];
  let maxSpeed: number;

  if (analysis.movementPattern === "driving") {
    maxSpeed = speedProfile.vehicle * terrainMod;
  } else if (analysis.movementPattern === "running") {
    maxSpeed = speedProfile.run * terrainMod;
  } else {
    maxSpeed = speedProfile.walk * terrainMod;
  }

  // Use actual last speed if available and reasonable
  if (analysis.lastSpeed > 0 && analysis.lastSpeed < maxSpeed * 2) {
    maxSpeed = Math.max(maxSpeed, analysis.lastSpeed * 1.3); // 30% buffer
  }

  // Calculate maximum radius (how far they could have gone)
  const elapsedSeconds = elapsedMinutes * 60;
  const maxRadius = maxSpeed * elapsedSeconds;

  // Determine heading and spread
  const hasHeading = analysis.lastHeading !== 0 || trail.length >= 2;
  const headingDeg = analysis.lastHeading;

  // Spread angle depends on GPS quality and time elapsed
  let baseSpread = SPREAD_BY_QUALITY[analysis.gpsQuality] || 45;
  // Spread increases over time (more uncertainty)
  baseSpread = Math.min(180, baseSpread + elapsedMinutes * 0.5);

  const isCircular = !hasHeading || analysis.movementPattern === "stationary" || analysis.movementPattern === "erratic" || baseSpread >= 170;

  // Confidence decreases over time and with poor GPS
  let confidence = 95;
  confidence -= elapsedMinutes * 1.2;
  if (analysis.gpsQuality === "poor") confidence -= 20;
  if (analysis.gpsQuality === "lost") confidence -= 35;
  if (analysis.deadReckoningPoints > analysis.totalPoints * 0.5) confidence -= 15;
  confidence = Math.max(5, Math.min(95, Math.round(confidence)));

  // Probability zones
  const probabilityZones: ProbabilityZone[] = [
    {
      level: "high",
      radiusMin: 0,
      radiusMax: maxRadius * 0.4,
      color: "#FF2D55",
      opacity: 0.35,
      probability: 60,
    },
    {
      level: "medium",
      radiusMin: maxRadius * 0.4,
      radiusMax: maxRadius * 0.7,
      color: "#FF9500",
      opacity: 0.25,
      probability: 25,
    },
    {
      level: "low",
      radiusMin: maxRadius * 0.7,
      radiusMax: maxRadius,
      color: "#FFD60A",
      opacity: 0.15,
      probability: 15,
    },
  ];

  return {
    originLat: last.lat,
    originLng: last.lng,
    heading: headingDeg,
    spreadAngle: isCircular ? 180 : baseSpread,
    maxRadius: Math.round(maxRadius),
    minRadius: 0,
    probabilityZones,
    elapsedMinutes,
    maxSpeed: Math.round(maxSpeed * 100) / 100,
    confidence,
    isCircular,
  };
}

// ── Generate Search Cone Polygon Points ────────────────────────
// Returns lat/lng pairs to draw on a map

export function getConePolygon(cone: SearchCone, segments: number = 36): [number, number][] {
  const points: [number, number][] = [];

  if (cone.isCircular) {
    // Full circle
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * 360;
      points.push(destinationPoint(cone.originLat, cone.originLng, cone.maxRadius, angle));
    }
  } else {
    // Cone/arc
    points.push([cone.originLat, cone.originLng]); // Start at origin
    const startAngle = cone.heading - cone.spreadAngle;
    const endAngle = cone.heading + cone.spreadAngle;
    const step = (endAngle - startAngle) / segments;

    for (let i = 0; i <= segments; i++) {
      const angle = startAngle + i * step;
      points.push(destinationPoint(cone.originLat, cone.originLng, cone.maxRadius, angle));
    }
    points.push([cone.originLat, cone.originLng]); // Close back to origin
  }

  return points;
}

/** Get polygon for a specific probability zone */
export function getZonePolygon(cone: SearchCone, zone: ProbabilityZone, segments: number = 36): [number, number][] {
  const outerPoints: [number, number][] = [];
  const innerPoints: [number, number][] = [];

  if (cone.isCircular) {
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * 360;
      outerPoints.push(destinationPoint(cone.originLat, cone.originLng, zone.radiusMax, angle));
      if (zone.radiusMin > 0) {
        innerPoints.push(destinationPoint(cone.originLat, cone.originLng, zone.radiusMin, angle));
      }
    }
  } else {
    const startAngle = cone.heading - cone.spreadAngle;
    const endAngle = cone.heading + cone.spreadAngle;
    const step = (endAngle - startAngle) / segments;

    if (zone.radiusMin === 0) {
      outerPoints.push([cone.originLat, cone.originLng]);
    }
    for (let i = 0; i <= segments; i++) {
      const angle = startAngle + i * step;
      outerPoints.push(destinationPoint(cone.originLat, cone.originLng, zone.radiusMax, angle));
    }
    if (zone.radiusMin === 0) {
      outerPoints.push([cone.originLat, cone.originLng]);
    }
  }

  return outerPoints;
}

// ── Escalation Protocol Builder ────────────────────────────────

export function buildEscalation(workerType: WorkerType, isSoloMission: boolean): EscalationStep[] {
  // Solo missions get faster escalation
  const factor = isSoloMission ? 0.5 : 1.0;

  return [
    {
      id: "E1", phase: "watchdog", triggerMinutes: Math.round(5 * factor),
      title: "Connection Watchdog",
      description: "Automatic device ping — attempt to reach the worker's device remotely",
      actions: [
        { id: "A1", type: "auto_ping", label: "Send device wake-up ping", status: "pending" },
        { id: "A2", type: "sound_alarm", label: "Trigger remote device alarm", status: "pending" },
      ],
      isComplete: false, isActive: false, icon: "Wifi", color: "#00C8E0",
    },
    {
      id: "E2", phase: "alert", triggerMinutes: Math.round(10 * factor),
      title: "Buddy & Nearby Alert",
      description: "Alert assigned buddy and nearest 3 workers with last known location",
      actions: [
        { id: "A3", type: "alert_buddy", label: "Alert assigned buddy", status: "pending" },
        { id: "A4", type: "alert_nearby", label: "Alert 3 nearest workers", status: "pending" },
      ],
      isComplete: false, isActive: false, icon: "Users", color: "#4A90D9",
    },
    {
      id: "E3", phase: "search", triggerMinutes: Math.round(15 * factor),
      title: "Zone Admin + Search Cone",
      description: "Alert Zone Admin, generate search cone, show predicted location area",
      actions: [
        { id: "A5", type: "alert_admin", label: "Alert Zone Admin", status: "pending" },
        { id: "A6", type: "share_gps", label: "Share GPS trail with search team", status: "pending" },
      ],
      isComplete: false, isActive: false, icon: "Radar", color: "#FF9500",
    },
    {
      id: "E4", phase: "rescue", triggerMinutes: Math.round(30 * factor),
      title: "Command Center + Dispatch",
      description: "Full command center activation — dispatch rescue team to search cone",
      actions: [
        { id: "A7", type: "alert_command", label: "Activate Command Center", status: "pending" },
        { id: "A8", type: "dispatch_rescue", label: "Dispatch rescue team", status: "pending" },
      ],
      isComplete: false, isActive: false, icon: "Siren", color: "#FF2D55",
    },
    {
      id: "E5", phase: "recovery", triggerMinutes: Math.round(45 * factor),
      title: "External SAR Activation",
      description: "Share full GPS history with external search & rescue services",
      actions: [
        { id: "A9", type: "call_external", label: "Contact external SAR", status: "pending" },
        { id: "A10", type: "share_gps", label: "Transmit full GPS history", status: "pending" },
        { id: "A11", type: "activate_beacon", label: "Activate emergency beacon", status: "pending" },
      ],
      isComplete: false, isActive: false, icon: "Radio", color: "#FF2D55",
    },
    {
      id: "E6", phase: "external", triggerMinutes: Math.round(60 * factor),
      title: "Full Emergency Protocol",
      description: "All available resources mobilized — authorities notified, media blackout protocol",
      actions: [
        { id: "A12", type: "call_external", label: "Notify authorities (997/911)", status: "pending" },
      ],
      isComplete: false, isActive: false, icon: "ShieldAlert", color: "#FF2D55",
    },
  ];
}

// ── Recommended Search Pattern ─────────────────────────────────

export function recommendSearchPattern(
  cone: SearchCone,
  terrain: TerrainType,
  workerType: WorkerType,
): { pattern: SearchPattern; reason: string } {
  // Directional cone → sector search
  if (!cone.isCircular && cone.spreadAngle < 60) {
    return { pattern: "sector", reason: "Strong directional signal — worker was heading in a clear direction" };
  }

  // Large area + flat terrain → parallel tracks
  if (cone.maxRadius > 3000 && (terrain === "desert" || terrain === "marine")) {
    return { pattern: "parallel_track", reason: "Large open area — systematic parallel sweeps most efficient" };
  }

  // Underground/industrial → creeping line
  if (terrain === "underground" || terrain === "industrial") {
    return { pattern: "creeping_line", reason: "Confined spaces — methodical corridor-by-corridor search" };
  }

  // Small area → expanding square from last known point
  if (cone.maxRadius < 1000) {
    return { pattern: "expanding_square", reason: "Small search area — start from last known position and expand" };
  }

  // Default → spiral
  return { pattern: "spiral", reason: "Best general coverage — spiral outward from last known position" };
}

// ── Find Nearby Workers ────────────────────────────────────────

export function findNearbyWorkers(
  targetLat: number,
  targetLng: number,
  maxDistanceMeters: number = 5000,
): NearbyWorker[] {
  // Mock nearby workers — in production, this queries real GPS positions
  const allWorkers = [
    { id: "EMP-001", name: "Ahmed Khalil", role: "Field Engineer", lat: 24.7136, lng: 46.6753, phone: "+966 55 XXX" },
    { id: "EMP-002", name: "Fatima Hassan", role: "Safety Inspector", lat: 24.7140, lng: 46.6760, phone: "+966 50 XXX" },
    { id: "EMP-005", name: "Sara Al-Mutairi", role: "HSE Coordinator", lat: 24.7145, lng: 46.6770, phone: "+966 50 XXX" },
    { id: "EMP-007", name: "Lina Chen", role: "Lab Technician", lat: 24.7148, lng: 46.6775, phone: "+966 50 XXX" },
    { id: "EMP-008", name: "Omar Al-Farsi", role: "Site Manager", lat: 24.7135, lng: 46.6752, phone: "+966 55 XXX" },
    { id: "EMP-010", name: "Aisha Rahman", role: "Fire Marshal", lat: 24.7160, lng: 46.6800, phone: "+966 50 XXX" },
    { id: "EMP-011", name: "Hassan Jaber", role: "Crane Operator", lat: 24.7120, lng: 46.6730, phone: "+966 55 XXX" },
    { id: "EMP-018", name: "Salma Idris", role: "Nurse", lat: 24.7138, lng: 46.6758, phone: "+966 50 XXX" },
  ];

  return allWorkers
    .map(w => {
      const dist = haversine(targetLat, targetLng, w.lat, w.lng);
      const walkSpeed = 1.4; // m/s
      return {
        ...w,
        distanceMeters: Math.round(dist),
        lastSeen: Date.now() - Math.random() * 300000,
        canAssist: dist < maxDistanceMeters,
        estimatedArrivalMin: Math.round(dist / walkSpeed / 60),
      };
    })
    .filter(w => w.distanceMeters < maxDistanceMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

// ── Detect Hazard Zone Overlap ─────────────────────────────────

export function findHazardOverlap(cone: SearchCone): HazardZone[] {
  // Mock hazard zones near the search area
  const hazards: Omit<HazardZone, "overlapPercent">[] = [
    { id: "H1", name: "Mine Shaft B-7", type: "mine_shaft", lat: cone.originLat + 0.003, lng: cone.originLng + 0.002, radiusMeters: 50, severity: "lethal" },
    { id: "H2", name: "Chemical Storage", type: "chemical", lat: cone.originLat - 0.001, lng: cone.originLng + 0.004, radiusMeters: 100, severity: "dangerous" },
    { id: "H3", name: "Water Reservoir", type: "water", lat: cone.originLat + 0.005, lng: cone.originLng - 0.001, radiusMeters: 200, severity: "dangerous" },
    { id: "H4", name: "Construction Zone F", type: "construction", lat: cone.originLat + 0.002, lng: cone.originLng + 0.003, radiusMeters: 150, severity: "caution" },
    { id: "H5", name: "High Voltage Area", type: "electrical", lat: cone.originLat - 0.002, lng: cone.originLng - 0.002, radiusMeters: 80, severity: "lethal" },
  ];

  return hazards
    .map(h => {
      const dist = haversine(cone.originLat, cone.originLng, h.lat, h.lng);
      const overlap = dist < cone.maxRadius
        ? Math.round(Math.max(0, (1 - dist / cone.maxRadius)) * 100)
        : 0;
      return { ...h, overlapPercent: overlap };
    })
    .filter(h => h.overlapPercent > 0)
    .sort((a, b) => b.overlapPercent - a.overlapPercent);
}

// ── Generate Mock GPS Trail ────────────────────────────────────
// Creates a realistic GPS breadcrumb trail for demo purposes

export function generateMockTrail(
  workerType: WorkerType,
  durationMinutes: number = 120,
): GPSBreadcrumb[] {
  const trail: GPSBreadcrumb[] = [];
  const startLat = 24.7136;
  const startLng = 46.6753;
  const now = Date.now();
  const startTime = now - durationMinutes * 60 * 1000;

  let lat = startLat;
  let lng = startLng;
  let heading = 315; // Northwest
  let speed = workerType === "driver" ? 12 : 1.2; // m/s

  const intervalSec = workerType === "driver" ? 10 : 15;
  const totalPoints = Math.floor((durationMinutes * 60) / intervalSec);

  for (let i = 0; i < totalPoints; i++) {
    const timestamp = startTime + i * intervalSec * 1000;

    // Add some realistic variation
    const headingDrift = (Math.random() - 0.5) * 10;
    heading = (heading + headingDrift + 360) % 360;

    const speedVariation = speed * (0.8 + Math.random() * 0.4);
    const distance = speedVariation * intervalSec;

    const [newLat, newLng] = destinationPoint(lat, lng, distance, heading);
    lat = newLat;
    lng = newLng;

    // Simulate accuracy degradation over time (last 30% of trail)
    const progress = i / totalPoints;
    let accuracy = 10 + Math.random() * 5;
    let source: GPSBreadcrumb["source"] = "gps";

    if (progress > 0.85) {
      accuracy = 100 + Math.random() * 400;
      source = "dead_reckoning";
      speed *= 0.95; // Slowing down
    } else if (progress > 0.7) {
      accuracy = 30 + Math.random() * 50;
    }

    // Add occasional stops
    if (Math.random() < 0.05 && progress < 0.8) {
      speed = 0;
      for (let s = 0; s < 3; s++) {
        trail.push({
          lat: lat + (Math.random() - 0.5) * 0.00001,
          lng: lng + (Math.random() - 0.5) * 0.00001,
          timestamp: timestamp + s * intervalSec * 1000,
          accuracy: 8,
          speed: 0,
          heading: null,
          source: "gps",
          batteryLevel: Math.max(5, 85 - progress * 60),
        });
      }
      speed = workerType === "driver" ? 12 : 1.2;
      continue;
    }

    trail.push({
      lat, lng, timestamp, accuracy,
      speed: speedVariation,
      heading,
      source,
      altitude: 620 + Math.random() * 10,
      batteryLevel: Math.max(5, 85 - progress * 60),
    });
  }

  return trail;
}

// ── Create Full SAR Mission ────────────────────────────────────

export function createSARMission(
  employeeId: string,
  employeeName: string,
  employeeRole: string,
  workerType: WorkerType,
  zone: string,
  terrain: TerrainType,
  trail?: GPSBreadcrumb[],
): SARMission {
  const missionTrail = trail || generateMockTrail(workerType);
  const analysis = analyzeTrail(missionTrail);
  const elapsedMin = analysis.timeSinceLastPoint;
  const cone = calculateSearchCone(missionTrail, analysis, workerType, terrain, elapsedMin);
  const isSolo = workerType === "solo_remote";
  const escalation = buildEscalation(workerType, isSolo);
  const { pattern } = recommendSearchPattern(cone, terrain, workerType);
  const nearby = findNearbyWorkers(cone.originLat, cone.originLng);
  const hazards = findHazardOverlap(cone);

  // Auto-advance escalation based on elapsed time
  const advancedEscalation = escalation.map(step => ({
    ...step,
    isComplete: elapsedMin >= step.triggerMinutes + 5,
    isActive: elapsedMin >= step.triggerMinutes && elapsedMin < step.triggerMinutes + 5,
    completedAt: elapsedMin >= step.triggerMinutes + 5 ? Date.now() - (elapsedMin - step.triggerMinutes - 5) * 60000 : undefined,
    actions: step.actions.map(a => ({
      ...a,
      status: elapsedMin >= step.triggerMinutes + 5 ? "done" as const
        : elapsedMin >= step.triggerMinutes ? "executing" as const
        : "pending" as const,
      timestamp: elapsedMin >= step.triggerMinutes ? Date.now() - (elapsedMin - step.triggerMinutes) * 60000 : undefined,
    })),
  }));

  // Determine current phase
  let currentPhase: SARPhase = "watchdog";
  for (const step of advancedEscalation) {
    if (step.isActive || step.isComplete) currentPhase = step.phase;
  }

  return {
    id: `SAR-${Date.now().toString(36).toUpperCase()}`,
    employeeId,
    employeeName,
    employeeRole,
    workerType,
    zone,
    terrain,
    connectionLostAt: Date.now() - elapsedMin * 60000,
    currentPhase,
    searchCone: cone,
    trailAnalysis: analysis,
    trail: missionTrail,
    nearbyWorkers: nearby,
    hazardZones: hazards,
    escalation: advancedEscalation,
    searchPattern: pattern,
    searchTeams: [
      { id: "ST-1", name: "Alpha Team", members: ["Ahmed Khalil", "Omar Al-Farsi"], assignedZone: "Sector NW", pattern, status: "searching" },
      { id: "ST-2", name: "Medical Unit", members: ["Salma Idris", "Fatima Hassan"], assignedZone: "Standby", pattern: "expanding_square", status: "standby" },
    ],
    status: "active",
    updatedAt: Date.now(),
    log: [
      { timestamp: Date.now() - elapsedMin * 60000, type: "system", message: `Connection lost with ${employeeName}`, severity: "critical" },
      { timestamp: Date.now() - (elapsedMin - 2) * 60000, type: "auto", message: "Device ping sent — no response", severity: "warning" },
      { timestamp: Date.now() - (elapsedMin - 5) * 60000, type: "auto", message: "Buddy system notified: Omar Al-Farsi", severity: "info" },
      { timestamp: Date.now() - (elapsedMin - 8) * 60000, type: "system", message: "Search cone generated — heading NW, radius 2.1km", severity: "info" },
      { timestamp: Date.now() - (elapsedMin - 12) * 60000, type: "admin", message: "Zone Admin Ahmed acknowledged — dispatching rescue team", severity: "info" },
      { timestamp: Date.now() - 120000, type: "auto", message: `Rescue team dispatched to search cone — pattern: ${pattern.replace(/_/g, " ")}`, severity: "critical" },
      { timestamp: Date.now() - 60000, type: "system", message: "Search cone expanding — confidence decreasing", severity: "warning" },
    ],
  };
}

// ── SAR Mission Store (localStorage) ───────────────────────────

const SAR_STORE_KEY = "sosphere_sar_missions";

export function saveSARMission(mission: SARMission) {
  const missions = getAllSARMissions();
  const idx = missions.findIndex(m => m.id === mission.id);
  if (idx >= 0) missions[idx] = mission;
  else missions.unshift(mission);
  localStorage.setItem(SAR_STORE_KEY, JSON.stringify(missions.slice(0, 20)));
  window.dispatchEvent(new StorageEvent("storage", { key: SAR_STORE_KEY, newValue: JSON.stringify(missions) }));
}

export function getAllSARMissions(): SARMission[] {
  try { return JSON.parse(localStorage.getItem(SAR_STORE_KEY) || "[]"); } catch { return []; }
}

export function getActiveSARMissions(): SARMission[] {
  return getAllSARMissions().filter(m => m.status === "active");
}

// ── Format Helpers ─────────────────────────────────────────────

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

export function formatElapsed(minutes: number): string {
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function getPhaseLabel(phase: SARPhase): string {
  const map: Record<SARPhase, string> = {
    watchdog: "Monitoring",
    alert: "Alert Sent",
    search: "Active Search",
    rescue: "Rescue Dispatched",
    recovery: "External SAR",
    external: "Full Emergency",
    critical: "Critical",
  };
  return map[phase];
}

export function getPhaseColor(phase: SARPhase): string {
  const map: Record<SARPhase, string> = {
    watchdog: "#00C8E0",
    alert: "#4A90D9",
    search: "#FF9500",
    rescue: "#FF2D55",
    recovery: "#FF2D55",
    external: "#FF2D55",
    critical: "#FF2D55",
  };
  return map[phase];
}
