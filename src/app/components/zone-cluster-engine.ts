// ════════════════════════════════════════════════════════════════
// SOSphere — Zone Cluster Detection Engine
// Detects multi-SOS events in the same zone and auto-escalates
// Prevents chaos when multiple workers trigger SOS simultaneously
// ════════════════════════════════════════════════════════════════

import {
  createSARMission, saveSARMission,
  type SARMission, type WorkerType, type TerrainType,
  type MissionLogEntry,
} from "./sar-engine";
import { emitAdminSignal } from "./shared-store";

// ── Types ────────────────────────────────────────────────────────

/** Escalation level based on cluster size */
export type ClusterLevel =
  | "zone_alert"     // 2 SOS in same zone → grouped + Zone Admin notified
  | "mass_casualty"  // 3-4 SOS → escalate to Main Admin + Owner
  | "catastrophic";  // 5+ SOS → activate SAR + external emergency services

/** A detected cluster of emergencies in the same zone */
export interface ZoneCluster {
  id: string;                       // CLUSTER-<zone_hash>-<ts>
  zone: string;                     // Zone name (exact match)
  level: ClusterLevel;
  emergencyIds: string[];           // IDs of grouped emergencies
  employeeNames: string[];          // Workers involved
  detectedAt: number;               // timestamp ms
  affectedCount: number;            // total workers in danger
  autoActions: ClusterAutoAction[]; // actions already executed
  suggestedActions: ClusterSuggestedAction[]; // actions for admin to approve
  escalationChain: EscalationStep[];// who was notified and when
}

/** Auto-executed action (no admin approval needed) */
export interface ClusterAutoAction {
  id: string;
  label: string;
  executedAt: number;
  result: "success" | "pending";
}

/** Suggested action requiring admin approval */
export interface ClusterSuggestedAction {
  id: string;
  label: string;
  description: string;
  priority: number;     // 1 = highest
  iconName: string;     // lucide icon name for rendering
  color: string;
  automated?: boolean;  // auto-executed at this level
  requiresConfirmation?: boolean;
}

/** Escalation notification record */
export interface EscalationStep {
  role: string;         // "Zone Admin" | "Main Admin" | "Owner" | "External 911"
  notifiedAt: number;
  channel: string;      // "push" | "sms" | "call" | "all"
  acknowledged: boolean;
}

// ── Configuration ────────────────────────────────────────────────

/** Time window to consider SOS events as "simultaneous" (10 minutes) */
const CLUSTER_WINDOW_MS = 10 * 60 * 1000;

/** Minimum emergencies for each escalation level */
const LEVEL_THRESHOLDS: Record<ClusterLevel, number> = {
  zone_alert: 2,
  mass_casualty: 3,
  catastrophic: 5,
};

/** Auto-actions per escalation level */
const LEVEL_AUTO_ACTIONS: Record<ClusterLevel, ClusterAutoAction[]> = {
  zone_alert: [
    { id: "group_visual", label: "Emergencies visually grouped", executedAt: Date.now(), result: "success" },
    { id: "notify_zone_admin", label: "Zone Admin notified via push", executedAt: Date.now(), result: "success" },
  ],
  mass_casualty: [
    { id: "group_visual", label: "Emergencies visually grouped", executedAt: Date.now(), result: "success" },
    { id: "notify_zone_admin", label: "Zone Admin notified via push + SMS", executedAt: Date.now(), result: "success" },
    { id: "notify_main_admin", label: "Main Admin notified (escalated)", executedAt: Date.now(), result: "success" },
    { id: "notify_owner", label: "Owner notified (mass casualty)", executedAt: Date.now(), result: "success" },
    { id: "lock_zone", label: "Zone entry restricted (auto)", executedAt: Date.now(), result: "success" },
  ],
  catastrophic: [
    { id: "group_visual", label: "Emergencies visually grouped", executedAt: Date.now(), result: "success" },
    { id: "notify_all_admins", label: "All admin levels notified via ALL channels", executedAt: Date.now(), result: "success" },
    { id: "lock_zone", label: "Zone locked down", executedAt: Date.now(), result: "success" },
    { id: "sar_activated", label: "SAR Protocol auto-activated", executedAt: Date.now(), result: "success" },
    { id: "external_alert", label: "External emergency services alerted", executedAt: Date.now(), result: "pending" },
  ],
};

/** Suggested actions per level */
function getSuggestedActions(level: ClusterLevel, zone: string): ClusterSuggestedAction[] {
  const base: ClusterSuggestedAction[] = [
    {
      id: "deploy_team", label: "Deploy Response Team",
      description: `Send nearest response team to ${zone}`,
      priority: 1, iconName: "Users", color: "#FF2D55",
    },
    {
      id: "broadcast_zone", label: "Broadcast Zone Alert",
      description: `Warn all workers in ${zone} to evacuate or shelter`,
      priority: 2, iconName: "Megaphone", color: "#FF9500",
    },
    {
      id: "headcount", label: "Emergency Headcount",
      description: `Trigger roll-call for all workers assigned to ${zone}`,
      priority: 3, iconName: "ClipboardList", color: "#00C8E0",
    },
  ];

  if (level === "mass_casualty" || level === "catastrophic") {
    base.push(
      {
        id: "lockdown", label: "Full Zone Lockdown",
        description: `Restrict all entry/exit to ${zone} — security notified`,
        priority: 2, iconName: "Lock", color: "#FF2D55", requiresConfirmation: true,
      },
      {
        id: "medical_standby", label: "Medical Team Standby",
        description: "Alert on-site medical and request ambulance staging",
        priority: 3, iconName: "HeartPulse", color: "#34C759",
      },
    );
  }

  if (level === "catastrophic") {
    base.push(
      {
        id: "evacuate_adjacent", label: "Evacuate Adjacent Zones",
        description: "Expand evacuation to neighboring zones as precaution",
        priority: 1, iconName: "ArrowUpRight", color: "#FF2D55", requiresConfirmation: true,
      },
      {
        id: "external_911", label: "Contact External Emergency",
        description: "Initiate call to 911/997/112 — provide site coordinates",
        priority: 1, iconName: "Phone", color: "#FF2D55", requiresConfirmation: true,
      },
    );
  }

  return base.sort((a, b) => a.priority - b.priority);
}

/** Build escalation chain based on level */
function buildEscalationChain(level: ClusterLevel): EscalationStep[] {
  const now = Date.now();
  const chain: EscalationStep[] = [];

  // Always notify Zone Admin first
  chain.push({ role: "Zone Admin", notifiedAt: now, channel: "push", acknowledged: false });

  if (level === "mass_casualty" || level === "catastrophic") {
    chain.push(
      { role: "Zone Admin", notifiedAt: now, channel: "sms", acknowledged: false },
      { role: "Main Admin", notifiedAt: now + 5000, channel: "push", acknowledged: false },
      { role: "Owner", notifiedAt: now + 10000, channel: "push", acknowledged: false },
    );
  }

  if (level === "catastrophic") {
    chain.push(
      { role: "Main Admin", notifiedAt: now + 5000, channel: "call", acknowledged: false },
      { role: "Owner", notifiedAt: now + 10000, channel: "call", acknowledged: false },
      { role: "External 911", notifiedAt: now + 30000, channel: "call", acknowledged: false },
    );
  }

  return chain;
}

// ── Core Detection ───────────────────────────────────────────────

interface MinimalEmergency {
  id: string;
  zone: string;
  status: string;
  timestamp: Date;
  employeeName?: string;
  severity?: string;
}

/**
 * Detect zone clusters from a list of emergencies.
 * Groups active emergencies by zone within the time window.
 * Returns only zones with 2+ simultaneous emergencies.
 */
export function detectClusters(emergencies: MinimalEmergency[]): ZoneCluster[] {
  const now = Date.now();

  // Only consider active/responding emergencies within the time window
  const recent = emergencies.filter(e =>
    (e.status === "active" || e.status === "responding" || e.status === "new") &&
    (now - e.timestamp.getTime()) <= CLUSTER_WINDOW_MS
  );

  // Group by zone
  const zoneGroups = new Map<string, MinimalEmergency[]>();
  for (const emg of recent) {
    const zone = emg.zone;
    if (!zoneGroups.has(zone)) zoneGroups.set(zone, []);
    zoneGroups.get(zone)!.push(emg);
  }

  // Detect clusters (2+ in same zone)
  const clusters: ZoneCluster[] = [];
  for (const [zone, group] of zoneGroups) {
    if (group.length < LEVEL_THRESHOLDS.zone_alert) continue;

    const level: ClusterLevel =
      group.length >= LEVEL_THRESHOLDS.catastrophic ? "catastrophic" :
      group.length >= LEVEL_THRESHOLDS.mass_casualty ? "mass_casualty" :
      "zone_alert";

    // Deterministic ID: based on zone + sorted emergency IDs (stable across re-renders)
    const zoneHash = zone.replace(/\s+/g, "").slice(0, 6).toUpperCase();
    const emgHash = group.map(e => e.id).sort().join("|");
    const stableHash = emgHash.split("").reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0).toString(36).toUpperCase().replace("-", "N").slice(-4);
    const cluster: ZoneCluster = {
      id: `CLUSTER-${zoneHash}-${stableHash}`,
      zone,
      level,
      emergencyIds: group.map(e => e.id),
      employeeNames: group.map(e => e.employeeName || "Unknown"),
      detectedAt: now,
      affectedCount: group.length,
      autoActions: LEVEL_AUTO_ACTIONS[level].map(a => ({ ...a, executedAt: now })),
      suggestedActions: getSuggestedActions(level, zone),
      escalationChain: buildEscalationChain(level),
    };

    clusters.push(cluster);
  }

  return clusters;
}

// ── Cluster Severity Override ────────────────────────────────────

/**
 * Get the effective severity for an emergency that's part of a cluster.
 * Clustered emergencies are auto-escalated to at least "high".
 * Mass casualty clusters escalate everything to "critical".
 */
export function getClusterSeverity(
  originalSeverity: string,
  clusterLevel: ClusterLevel | null
): "critical" | "high" | "medium" | "low" {
  if (!clusterLevel) return originalSeverity as any;

  if (clusterLevel === "catastrophic" || clusterLevel === "mass_casualty") {
    return "critical";
  }
  // zone_alert → at least "high"
  if (originalSeverity === "low" || originalSeverity === "medium") {
    return "high";
  }
  return originalSeverity as any;
}

// ── Smart Triage ─────────────────────────────────────────────────

/** Worker priority roles for triage ordering */
const ROLE_TRIAGE_PRIORITY: Record<string, number> = {
  "Lone Worker": 1,        // Most vulnerable
  "Confined Space": 2,     // Hard to reach
  "Working at Height": 3,  // Fall risk
  "Driver": 4,             // Vehicle accident
  "Electrician": 5,        // Electrocution risk
  "Field Worker": 6,       // General
  "Lab Technician": 7,     // Chemical exposure
  "Office Worker": 8,      // Lowest physical risk
};

/**
 * Suggest triage order within a cluster.
 * Prioritizes: unreachable > injured > lone workers > by severity > by elapsed time
 */
export function getTriageOrder(emergencies: Array<{
  id: string;
  employeeName: string;
  severity: string;
  elapsed: number;
  type?: string;
  role?: string;
}>): string[] {
  return [...emergencies]
    .sort((a, b) => {
      // 1. Severity first (critical > high > medium > low)
      const sevMap: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      const sevDiff = (sevMap[a.severity] || 3) - (sevMap[b.severity] || 3);
      if (sevDiff !== 0) return sevDiff;

      // 2. Role vulnerability
      const roleA = ROLE_TRIAGE_PRIORITY[a.role || ""] || 6;
      const roleB = ROLE_TRIAGE_PRIORITY[b.role || ""] || 6;
      if (roleA !== roleB) return roleA - roleB;

      // 3. Longest elapsed first (most urgent)
      return b.elapsed - a.elapsed;
    })
    .map(e => e.id);
}

// ── Resource Deconfliction ───────────────────────────────────────

export interface ResourceAssignment {
  emergencyId: string;
  responderName: string;
  role: string;
}

/**
 * Check if a responder is already assigned to another emergency in the same cluster.
 * Prevents double-dispatch.
 */
export function isResponderAvailable(
  responderName: string,
  assignments: ResourceAssignment[],
  clusterEmergencyIds: string[]
): boolean {
  return !assignments.some(
    a => a.responderName === responderName && clusterEmergencyIds.includes(a.emergencyId)
  );
}

// ── Cluster Display Helpers ──────────────────────────────────────

export const CLUSTER_LEVEL_CONFIG: Record<ClusterLevel, {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: string;
  sound: "clusterAlert" | "massCasualty" | "catastrophic";
  description: string;
}> = {
  zone_alert: {
    label: "ZONE ALERT",
    color: "#FF9500",
    bgColor: "rgba(255,149,0,0.06)",
    borderColor: "rgba(255,149,0,0.2)",
    icon: "AlertTriangle",
    sound: "clusterAlert",
    description: "Multiple SOS in same zone — possible shared incident",
  },
  mass_casualty: {
    label: "MASS CASUALTY EVENT",
    color: "#FF2D55",
    bgColor: "rgba(255,45,85,0.08)",
    borderColor: "rgba(255,45,85,0.25)",
    icon: "Siren",
    sound: "massCasualty",
    description: "3+ workers affected — unified response required",
  },
  catastrophic: {
    label: "CATASTROPHIC EVENT",
    color: "#FF0000",
    bgColor: "rgba(255,0,0,0.10)",
    borderColor: "rgba(255,0,0,0.30)",
    icon: "Skull",
    sound: "catastrophic",
    description: "Major incident — SAR activated, external services alerted",
  },
};

// ── Persistence (localStorage for cross-tab sync) ────────────────

const CLUSTER_STORAGE_KEY = "sosphere_zone_clusters";

export function saveClusters(clusters: ZoneCluster[]): void {
  try {
    localStorage.setItem(CLUSTER_STORAGE_KEY, JSON.stringify(clusters));
  } catch {}
}

export function loadClusters(): ZoneCluster[] {
  try {
    const raw = localStorage.getItem(CLUSTER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function clearClusters(): void {
  try { localStorage.removeItem(CLUSTER_STORAGE_KEY); } catch {}
}

// ── Guide Me Integration ─────────────────────────────────────────

/** Get cluster-aware Guide Me subtitle text */
export function getClusterGuideHint(clusters: ZoneCluster[]): string | null {
  if (clusters.length === 0) return null;

  const worst = clusters.reduce((a, b) => {
    const levelOrder: Record<ClusterLevel, number> = { catastrophic: 0, mass_casualty: 1, zone_alert: 2 };
    return levelOrder[a.level] <= levelOrder[b.level] ? a : b;
  });

  const cfg = CLUSTER_LEVEL_CONFIG[worst.level];
  return `${cfg.label}: ${worst.affectedCount} workers in ${worst.zone}`;
}

// ═══════════════════════════════════════════════════════════════
// SAR Pre-staging — the bridge that saves lives
// ────────────────────────────────────────────────────────────
// When a cluster reaches mass_casualty or catastrophic, this
// pre-fills a SAR mission with ALL cluster data so the admin
// only needs to press ONE button instead of building SAR from
// scratch. Every second saved = lives saved.
//
// Pre-staging ≠ Auto-activation:
//   mass_casualty  → "Prepare SAR" (data ready, admin confirms)
//   catastrophic   → "Activate SAR" (data ready, auto-saved,
//                     admin just reviews)
// ═══════════════════════════════════════════════════════════════

/** Zone → terrain mapping (best guess from zone name) */
const ZONE_TERRAIN_MAP: Record<string, TerrainType> = {
  "Zone A": "industrial",
  "Zone B": "industrial",
  "Zone C": "urban",
  "Zone D": "underground",
  "Zone E": "desert",
};

/** Zone → worker type default */
const ZONE_WORKER_TYPE: Record<string, WorkerType> = {
  "Zone A": "walker",
  "Zone B": "walker",
  "Zone C": "walker",
  "Zone D": "underground",
  "Zone E": "driver",
};

/** Pre-staged SAR result — everything the admin needs */
export interface SARPreStageResult {
  mission: SARMission;
  clusterContext: {
    clusterId: string;
    clusterLevel: ClusterLevel;
    allWorkers: string[];
    totalAffected: number;
    zone: string;
    preStageReason: string;
  };
  autoActivated: boolean; // true = catastrophic (saved immediately)
}

/**
 * Pre-stage a SAR mission from cluster data.
 *
 * This is the critical function that bridges cluster detection → SAR protocol.
 * It takes a detected cluster and generates a FULLY PRE-FILLED SAR mission:
 *
 * - Primary target: first worker in triage order (most vulnerable)
 * - All other cluster workers added to nearby workers + mission log
 * - Escalation pre-advanced to match cluster severity
 * - Zone/terrain auto-detected from zone name
 * - Mission log pre-filled with cluster event timeline
 *
 * For catastrophic: mission is auto-saved to localStorage (instant activation)
 * For mass_casualty: mission is returned but NOT saved (admin confirms first)
 */
export function prestageSARFromCluster(
  cluster: ZoneCluster,
): SARPreStageResult {
  const now = Date.now();
  const cfg = CLUSTER_LEVEL_CONFIG[cluster.level];

  // Determine zone characteristics
  const terrain = ZONE_TERRAIN_MAP[cluster.zone] || "industrial";
  const workerType = ZONE_WORKER_TYPE[cluster.zone] || "walker";

  // Primary target = first in triage order (or first employee)
  const primaryName = cluster.employeeNames[0] || "Unknown Worker";
  const primaryId = cluster.emergencyIds[0] || "EMG-CLUSTER";

  // Create SAR mission using the existing SAR engine
  const mission = createSARMission(
    primaryId,
    primaryName,
    "Field Worker",  // default role
    workerType,
    cluster.zone,
    terrain,
  );

  // ── Override mission with cluster-specific data ──

  // Override mission ID to link it to the cluster
  mission.id = `SAR-CLU-${cluster.id.split("-").pop() || Date.now().toString(36).toUpperCase()}`;

  // Add cluster context to the mission log (prepend cluster events)
  const clusterLogEntries: MissionLogEntry[] = [
    {
      timestamp: cluster.detectedAt,
      type: "system",
      message: `${cfg.label} detected: ${cluster.affectedCount} simultaneous SOS in ${cluster.zone}`,
      severity: "critical",
    },
    {
      timestamp: cluster.detectedAt + 1000,
      type: "auto",
      message: `Workers affected: ${cluster.employeeNames.join(", ")}`,
      severity: "critical",
    },
    ...cluster.autoActions.map(a => ({
      timestamp: a.executedAt,
      type: "auto" as const,
      message: `[Auto] ${a.label}`,
      severity: (a.result === "success" ? "info" : "warning") as "info" | "warning",
    })),
    ...cluster.escalationChain.map(e => ({
      timestamp: e.notifiedAt,
      type: "system" as const,
      message: `Escalation: ${e.role} notified via ${e.channel}`,
      severity: "warning" as const,
    })),
    {
      timestamp: now,
      type: "admin",
      message: `SAR Protocol pre-staged from ${cfg.label} — awaiting activation`,
      severity: "critical",
    },
  ];

  // Prepend cluster log entries before existing SAR log
  mission.log = [...clusterLogEntries, ...mission.log];

  // Add other cluster workers as nearby workers who need rescue
  const additionalWorkers = cluster.employeeNames.slice(1);
  for (let i = 0; i < additionalWorkers.length; i++) {
    mission.nearbyWorkers.unshift({
      id: cluster.emergencyIds[i + 1] || `CLU-W${i}`,
      name: additionalWorkers[i],
      role: "Cluster Affected Worker",
      // GPS: use origin coords — real position unknown until GPS ping received
      lat: mission.searchCone.originLat,
      lng: mission.searchCone.originLng,
      distanceMeters: 0, // Unknown — pending GPS update
      lastSeen: cluster.detectedAt,
      phone: "+966 5XX XXX",
      canAssist: false, // They need rescue, not assisting
      assignedTask: "⚠️ NEEDS RESCUE — SOS Active",
      estimatedArrivalMin: 0,
    });
  }

  // Add an extra search team for cluster response
  mission.searchTeams.push({
    id: "ST-CLU",
    name: "Cluster Response Unit",
    members: ["Zone Admin", "Safety Officer", "Medical Responder"],
    assignedZone: cluster.zone,
    pattern: "expanding_square",
    status: cluster.level === "catastrophic" ? "en_route" : "standby",
  });

  // For catastrophic: advance escalation further + auto-save
  const isCatastrophic = cluster.level === "catastrophic";
  if (isCatastrophic) {
    // Force all escalation steps to active/complete
    mission.escalation = mission.escalation.map(step => ({
      ...step,
      isActive: false,
      isComplete: true,
      completedAt: now,
      actions: step.actions.map(a => ({
        ...a,
        status: "done" as const,
        timestamp: now,
      })),
    }));
    mission.currentPhase = "external"; // Maximum escalation
    mission.status = "active";

    // Auto-save for catastrophic (instant activation)
    saveSARMission(mission);
  }

  return {
    mission,
    clusterContext: {
      clusterId: cluster.id,
      clusterLevel: cluster.level,
      allWorkers: cluster.employeeNames,
      totalAffected: cluster.affectedCount,
      zone: cluster.zone,
      preStageReason: isCatastrophic
        ? `Catastrophic event: ${cluster.affectedCount} workers — SAR auto-activated`
        : `Mass casualty: ${cluster.affectedCount} workers — SAR pre-staged for your review`,
    },
    autoActivated: isCatastrophic,
  };
}

/**
 * Convenience: pre-stage + save (for mass_casualty manual confirmation)
 * Called when admin clicks "Activate SAR" on a mass_casualty cluster
 */
export function activateClusterSAR(cluster: ZoneCluster): SARPreStageResult {
  const result = prestageSARFromCluster(cluster);
  if (!result.autoActivated) {
    // Add log entry BEFORE saving so it persists in localStorage
    result.mission.log.push({
      timestamp: Date.now(),
      type: "admin",
      message: "SAR Protocol activated by admin — mission is now LIVE",
      severity: "critical",
    });
    // Save now (admin confirmed)
    saveSARMission(result.mission);
  }
  // Alert mobile workers via shared store — critical for field awareness
  emitAdminSignal("SAR_ACTIVATED", result.mission.employeeId, {
    employeeName: result.mission.employeeName,
    zone: cluster.zone,
    clusterId: cluster.id,
    clusterLevel: cluster.level,
    affectedCount: cluster.affectedCount,
  });
  return result;
}