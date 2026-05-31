// ═══════════════════════════════════════════════════════════════
// SOSphere Dashboard — Emergencies Page + helpers
// ─────────────────────────────────────────────────────────────
// Final Tier A extraction (2026-05-31 step 7/7). Includes:
//   - 4 local types: EmgStatus, EmgTimelineEvent, EmgOwner, RichEmergency
//   - EMG_STATUS_CONFIG const map
//   - RICH_EMERGENCIES mock data (DEV-gated via parent SEVERITY_CONFIG)
//   - ZoneClusterBanner helper component
//   - EmergenciesPage main component
//
// After this extraction, dashboard-pages.tsx contains only:
//   - Shared constants (SLA_THRESHOLD, fmtElapsed, timerColor,
//     SEVERITY_CONFIG, STATUS_CONFIG)
//   - 7 re-exports pointing at the new per-page files
//   That's the end-state of the original 247 KB monolith.
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  AlertTriangle, ArrowRight, ArrowUpRight, Bell, ChevronDown, ChevronLeft,
  ChevronRight, Download, HeartPulse, Megaphone, Navigation, Phone, Plus,
  Search, Send, Shield, Siren, User, UserCheck, Users, XCircle, Zap,
} from "lucide-react";
import { Card as DSCard, Badge, Button as DSButton, Divider, TOKENS } from "./design-system";
import type { Employee, EmergencyItem } from "./dashboard-types";
import { trackEventSync } from "./smart-timeline-tracker";
import { buildReportData, generateEmergencyLifecyclePDF } from "./emergency-lifecycle-report";
import {
  detectClusters, type ZoneCluster, CLUSTER_LEVEL_CONFIG, activateClusterSAR,
} from "./zone-cluster-engine";
import { toast } from "sonner";
import { SEVERITY_CONFIG, SLA_THRESHOLD, fmtElapsed, timerColor } from "./dashboard-pages";

// ═══════════════════════════════════════════════════════════════
// Emergencies Page
// ═══════════════════════════════════════════════════════════════
type EmgStatus = "new" | "active" | "responding" | "contained" | "resolved" | "closed";
interface EmgTimelineEvent { time: Date; event: string; actor: string; }
interface EmgOwner { name: string; takenAt: Date; }
interface RichEmergency {
  id: string; title: string; description: string;
  severity: "critical" | "high" | "medium" | "low";
  status: EmgStatus; zone: string; address: string; radius: number;
  createdAt: Date; owner?: EmgOwner;
  affectedCount: number; respondersCount: number;
  timeline: EmgTimelineEvent[];
}

const EMG_STATUS_CONFIG: Record<EmgStatus, { label: string; color: string; bg: string; tKey: string }> = {
  new:        { label: "NEW",        color: "#FFB300", bg: "rgba(255,179,0,0.10)",   tKey: "status.new"       },
  active:     { label: "ACTIVE",     color: "#FF2D55", bg: "rgba(255,45,85,0.10)",   tKey: "status.active"    },
  responding: { label: "RESPONDING", color: "#00C8E0", bg: "rgba(0,200,224,0.10)",   tKey: "status.responding"},
  contained:  { label: "CONTAINED",  color: "#34C759", bg: "rgba(52,199,89,0.10)",   tKey: "status.contained" },
  resolved:   { label: "RESOLVED",   color: "#8090A5", bg: "rgba(128,144,165,0.10)", tKey: "status.resolved"  },
  closed:     { label: "CLOSED",     color: "#8090A5", bg: "rgba(128,144,165,0.10)", tKey: "status.closed"    },
};

const RICH_EMERGENCIES: RichEmergency[] = [
  {
    id: "EMG-2026-001", title: "Chemical Spill — Warehouse B3",
    description: "Hazardous chemical leak detected in storage area B3. Evacuation protocol initiated.",
    severity: "critical", status: "active", zone: "Zone A", address: "Warehouse B3, Sector 7",
    radius: 150, createdAt: new Date(Date.now() - 8 * 60 * 1000),
    affectedCount: 24, respondersCount: 0,
    timeline: [
      { time: new Date(Date.now() - 8 * 60000), event: "Incident Created", actor: "Omar Al-Farsi" },
      { time: new Date(Date.now() - 7.5 * 60000), event: "First Alert Sent", actor: "System" },
    ],
  },
  {
    id: "EMG-2026-002", title: "Fire Alarm — Lab D2",
    description: "Smoke detected in Laboratory D2. Fire suppression system activated.",
    severity: "high", status: "responding", zone: "Zone C", address: "Lab D2, East Wing",
    radius: 80, createdAt: new Date(Date.now() - 22 * 60 * 1000),
    owner: { name: "Ahmed Al-Rashid", takenAt: new Date(Date.now() - 20 * 60000) },
    affectedCount: 15, respondersCount: 5,
    timeline: [
      { time: new Date(Date.now() - 22 * 60000), event: "Incident Created",     actor: "Lina Chen" },
      { time: new Date(Date.now() - 21.5 * 60000), event: "First Alert Sent",   actor: "System" },
      { time: new Date(Date.now() - 20 * 60000), event: "Ownership Taken",       actor: "Ahmed Al-Rashid" },
      { time: new Date(Date.now() - 18 * 60000), event: "Broadcast Alert Sent", actor: "Ahmed Al-Rashid" },
    ],
  },
  {
    id: "EMG-2026-003", title: "Medical Emergency — Floor 5",
    description: "Employee collapsed. Medical team dispatched. Stabilizing patient.",
    severity: "medium", status: "contained", zone: "Zone B", address: "Office Floor 5, Room 502",
    radius: 30, createdAt: new Date(Date.now() - 45 * 60 * 1000),
    owner: { name: "Fatima Hassan", takenAt: new Date(Date.now() - 43 * 60000) },
    affectedCount: 1, respondersCount: 3,
    timeline: [
      { time: new Date(Date.now() - 45 * 60000), event: "Incident Created",   actor: "Sarah Johnson" },
      { time: new Date(Date.now() - 44 * 60000), event: "First Alert Sent",   actor: "System" },
      { time: new Date(Date.now() - 43 * 60000), event: "Ownership Taken",    actor: "Fatima Hassan" },
      { time: new Date(Date.now() - 40 * 60000), event: "Dispatch Team",      actor: "Fatima Hassan" },
      { time: new Date(Date.now() - 35 * 60000), event: "Contained",          actor: "Medical Team" },
    ],
  },
  // ── Zone A Cluster: 2 more SOS in same zone as EMG-001 (demo multi-SOS) ──
  {
    id: "EMG-2026-004", title: "Worker Trapped — Warehouse B3 Collapse",
    description: "Structural collapse near chemical spill area. Worker reported trapped under debris. Same zone as EMG-001.",
    severity: "critical", status: "active", zone: "Zone A", address: "Warehouse B3, Sector 7 — East Wall",
    radius: 150, createdAt: new Date(Date.now() - 6 * 60 * 1000),
    affectedCount: 1, respondersCount: 0,
    timeline: [
      { time: new Date(Date.now() - 6 * 60000), event: "SOS Triggered", actor: "Ali Mansour" },
      { time: new Date(Date.now() - 5.8 * 60000), event: "First Alert Sent", actor: "System" },
      { time: new Date(Date.now() - 5.5 * 60000), event: "Zone Cluster Detected — linked to EMG-2026-001", actor: "System" },
    ],
  },
  {
    id: "EMG-2026-005", title: "Breathing Difficulty — Toxic Fumes",
    description: "Worker reporting difficulty breathing near chemical spill zone. Likely fume exposure from EMG-001 spill.",
    severity: "high", status: "active", zone: "Zone A", address: "Warehouse B3, Sector 7 — Loading Bay",
    radius: 150, createdAt: new Date(Date.now() - 4 * 60 * 1000),
    affectedCount: 1, respondersCount: 0,
    timeline: [
      { time: new Date(Date.now() - 4 * 60000), event: "SOS Triggered", actor: "Hassan Jaber" },
      { time: new Date(Date.now() - 3.8 * 60000), event: "First Alert Sent", actor: "System" },
      { time: new Date(Date.now() - 3.5 * 60000), event: "Zone Cluster Escalated — MASS CASUALTY", actor: "System" },
    ],
  },
  // ── Zone C Cluster: 2 SOS in same zone (demo multi-zone scenario) ──
  {
    id: "EMG-2026-006", title: "Electrical Arc Flash — Lab D2 Panel",
    description: "High-voltage arc flash reported near main electrical panel in Lab D2. Worker received shock, secondary fire risk.",
    severity: "high", status: "active", zone: "Zone C", address: "Lab D2, East Wing — Panel Room",
    radius: 50, createdAt: new Date(Date.now() - 5 * 60 * 1000),
    affectedCount: 2, respondersCount: 0,
    timeline: [
      { time: new Date(Date.now() - 5 * 60000), event: "SOS Triggered", actor: "Khalid Noor" },
      { time: new Date(Date.now() - 4.8 * 60000), event: "First Alert Sent", actor: "System" },
    ],
  },
  {
    id: "EMG-2026-007", title: "Burn Injury — Lab D2 Explosion",
    description: "Worker sustained burns from secondary explosion near arc flash site. Same zone as EMG-006.",
    severity: "critical", status: "active", zone: "Zone C", address: "Lab D2, East Wing — Workstation 3",
    radius: 50, createdAt: new Date(Date.now() - 3 * 60 * 1000),
    affectedCount: 1, respondersCount: 0,
    timeline: [
      { time: new Date(Date.now() - 3 * 60000), event: "SOS Triggered", actor: "Yusuf Adel" },
      { time: new Date(Date.now() - 2.8 * 60000), event: "First Alert Sent", actor: "System" },
      { time: new Date(Date.now() - 2.5 * 60000), event: "Zone Cluster Detected — linked to EMG-2026-006", actor: "System" },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════
// Zone Cluster Banner — Auto-detects multi-SOS in same zone
// ═══════════════════════════════════════════════════════════════
function ZoneClusterBanner({ clusters, onAction, onLaunchSAR }: {
  clusters: ZoneCluster[];
  onAction?: (clusterId: string, actionId: string) => void;
  onLaunchSAR?: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (clusters.length === 0) return null;

  return (
    <div className="space-y-2 mb-3">
      {clusters.map(cluster => {
        const cfg = CLUSTER_LEVEL_CONFIG[cluster.level];
        const isExpanded = expanded === cluster.id;
        const ICON_MAP: Record<string, any> = {
          AlertTriangle, Siren, Skull, Users, Megaphone, Lock,
          HeartPulse, ClipboardList, ArrowUpRight, Phone,
        };

        return (
          <motion.div
            key={cluster.id}
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="rounded-2xl overflow-hidden"
            style={{
              background: cfg.bgColor,
              border: `1px solid ${cfg.borderColor}`,
              boxShadow: `0 0 20px ${cfg.color}15`,
            }}
          >
            {/* Header */}
            <button
              onClick={() => setExpanded(isExpanded ? null : cluster.id)}
              className="w-full px-4 py-3 flex items-center gap-3 text-left"
            >
              <motion.div
                animate={{ scale: [1, 1.2, 1], opacity: [1, 0.6, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
                className="size-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${cfg.color}20`, border: `1px solid ${cfg.color}40` }}
              >
                {cluster.level === "catastrophic" ? (
                  <Skull className="size-4" style={{ color: cfg.color }} />
                ) : cluster.level === "mass_casualty" ? (
                  <Siren className="size-4" style={{ color: cfg.color }} />
                ) : (
                  <AlertTriangle className="size-4" style={{ color: cfg.color }} />
                )}
              </motion.div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 10, fontWeight: 800, color: cfg.color, letterSpacing: "0.5px" }}>
                    {cfg.label}
                  </span>
                  <motion.span
                    animate={{ opacity: [1, 0.4, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="px-1.5 py-0.5 rounded-md"
                    style={{ fontSize: 9, fontWeight: 800, color: "#fff", background: cfg.color }}
                  >
                    {cluster.affectedCount} SOS
                  </motion.span>
                </div>
                <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.7)", marginTop: 2 }}>
                  {cluster.zone} — {cfg.description}
                </p>
              </div>
              <ChevronDown
                className="size-4 shrink-0 transition-transform"
                style={{ color: cfg.color, transform: isExpanded ? "rotate(180deg)" : "rotate(0)" }}
              />
            </button>

            {/* Expanded Detail */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 space-y-3" style={{ borderTop: `1px solid ${cfg.borderColor}` }}>
                    {/* Workers Involved */}
                    <div className="pt-3">
                      <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>
                        WORKERS INVOLVED
                      </span>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {cluster.employeeNames.map((name, i) => (
                          <span
                            key={i}
                            className="px-2 py-1 rounded-lg"
                            style={{ fontSize: 10, fontWeight: 600, color: cfg.color, background: `${cfg.color}10`, border: `1px solid ${cfg.color}20` }}
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Auto-Executed Actions */}
                    <div>
                      <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>
                        AUTO-EXECUTED
                      </span>
                      <div className="space-y-1.5 mt-2">
                        {cluster.autoActions.map(action => (
                          <div key={action.id} className="flex items-center gap-2">
                            <CheckCircle2
                              className="size-3 shrink-0"
                              style={{ color: action.result === "success" ? "#00C853" : "#FF9500" }}
                            />
                            <span style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.6)" }}>
                              {action.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Suggested Actions */}
                    <div>
                      <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>
                        RECOMMENDED ACTIONS
                      </span>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {cluster.suggestedActions.slice(0, 4).map(action => {
                          const IconComp = ICON_MAP[action.iconName] || AlertTriangle;
                          return (
                            <button
                              key={action.id}
                              onClick={() => {
                                onAction?.(cluster.id, action.id);
                                toast.success(action.label, { description: action.description });
                              }}
                              className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-colors"
                              style={{
                                background: `${action.color}08`,
                                border: `1px solid ${action.color}20`,
                              }}
                            >
                              <IconComp className="size-3.5 shrink-0" style={{ color: action.color }} />
                              <span style={{ fontSize: 10, fontWeight: 600, color: action.color }}>
                                {action.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Escalation Chain */}
                    <div>
                      <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>
                        ESCALATION CHAIN
                      </span>
                      <div className="flex items-center gap-1 mt-2 flex-wrap">
                        {cluster.escalationChain.map((step, i) => (
                          <span className="contents" key={i}>
                            <span
                              className="px-2 py-1 rounded-lg"
                              style={{
                                fontSize: 9, fontWeight: 600,
                                color: step.acknowledged ? "#00C853" : "rgba(255,255,255,0.5)",
                                background: step.acknowledged ? "rgba(0,200,83,0.08)" : "rgba(255,255,255,0.03)",
                                border: `1px solid ${step.acknowledged ? "rgba(0,200,83,0.15)" : "rgba(255,255,255,0.06)"}`,
                              }}
                            >
                              {step.role} ({step.channel})
                            </span>
                            {i < cluster.escalationChain.length - 1 && (
                              <ArrowRight className="size-2.5" style={{ color: "rgba(255,255,255,0.15)" }} />
                            )}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* ── SAR Pre-staging — the life-saving bridge ── */}
                    {(cluster.level === "mass_casualty" || cluster.level === "catastrophic") && (
                      <div
                        className="rounded-xl overflow-hidden"
                        style={{
                          background: cluster.level === "catastrophic"
                            ? "linear-gradient(135deg, rgba(255,0,0,0.12), rgba(255,45,85,0.08))"
                            : "linear-gradient(135deg, rgba(255,45,85,0.08), rgba(255,149,0,0.05))",
                          border: `1px solid ${cluster.level === "catastrophic" ? "rgba(255,0,0,0.25)" : "rgba(255,45,85,0.2)"}`,
                        }}
                      >
                        <div className="px-3 py-2.5 flex items-center gap-3">
                          <div
                            className="size-8 rounded-lg flex items-center justify-center shrink-0"
                            style={{ background: "rgba(255,45,85,0.15)", border: "1px solid rgba(255,45,85,0.25)" }}
                          >
                            <Radar className="size-4" style={{ color: "#FF2D55" }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p style={{ fontSize: 10, fontWeight: 800, color: "#FF2D55", letterSpacing: "0.5px" }}>
                              SAR PROTOCOL {cluster.level === "catastrophic" ? "AUTO-ACTIVATED" : "PRE-STAGED"}
                            </p>
                            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", marginTop: 1 }}>
                              {cluster.level === "catastrophic"
                                ? `Search & Rescue auto-launched — ${cluster.affectedCount} workers, all data pre-filled`
                                : `Mission data ready — search cone, teams, hazards pre-calculated for ${cluster.affectedCount} workers`
                              }
                            </p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const result = activateClusterSAR(cluster);
                              toast.success(
                                cluster.level === "catastrophic"
                                  ? "SAR Protocol LIVE — Mission Active"
                                  : "SAR Protocol Activated",
                                {
                                  description: result.clusterContext.preStageReason,
                                  duration: 6000,
                                }
                              );
                              onLaunchSAR?.();
                            }}
                            className="shrink-0 px-3 py-2 rounded-lg flex items-center gap-1.5 transition-transform active:scale-95"
                            style={{
                              background: cluster.level === "catastrophic"
                                ? "linear-gradient(135deg, #FF0000, #FF2D55)"
                                : "linear-gradient(135deg, #FF2D55, #FF6B35)",
                              boxShadow: `0 0 12px ${cluster.level === "catastrophic" ? "rgba(255,0,0,0.4)" : "rgba(255,45,85,0.3)"}`,
                            }}
                          >
                            <Radar className="size-3" style={{ color: "#fff" }} />
                            <span style={{ fontSize: 10, fontWeight: 800, color: "#fff" }}>
                              {cluster.level === "catastrophic" ? "View SAR" : "Activate SAR"}
                            </span>
                          </button>
                        </div>
                        {/* Pre-staged data summary */}
                        <div
                          className="px-3 py-2 flex items-center gap-3 flex-wrap"
                          style={{ borderTop: "1px solid rgba(255,45,85,0.1)" }}
                        >
                          {[
                            { label: "Search Cone", value: "Ready", color: "#FF2D55" },
                            { label: "Teams", value: `${cluster.affectedCount > 3 ? 3 : 2} assigned`, color: "#00C8E0" },
                            { label: "Hazards", value: "Scanned", color: "#FF9500" },
                            { label: "Escalation", value: cluster.level === "catastrophic" ? "MAX" : "Level 4", color: "#FF2D55" },
                          ].map(item => (
                            <div key={item.label} className="flex items-center gap-1">
                              <div className="size-1.5 rounded-full" style={{ background: item.color }} />
                              <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.35)" }}>{item.label}:</span>
                              <span style={{ fontSize: 8, fontWeight: 700, color: item.color }}>{item.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}

export function EmergenciesPage({ emergencies: _parentEmg, onResolve: _onResolveParent, onCreate, t, webMode = false, onLaunchSAR }: {
  emergencies: EmergencyItem[];
  onResolve: (id: string) => void;
  onCreate: () => void;
  t: (k: string) => string;
  webMode?: boolean;
  onLaunchSAR?: () => void;
}) {
  const [emgList, setEmgList] = useState<RichEmergency[]>(RICH_EMERGENCIES);

  // ── GAP FIX: Bridge parent emergencies → cluster engine ──
  // When mobile workers trigger SOS, the parent `emergencies` state gets updated
  // but EmergenciesPage's `emgList` is independent. This effect merges new parent
  // emergencies into emgList so the cluster engine can detect multi-SOS events
  // from real-time mobile triggers, not just mock data.
  const knownParentIdsRef = React.useRef<Set<string>>(new Set(_parentEmg.map(e => e.id)));
  useEffect(() => {
    const newEmgs = _parentEmg.filter(e => !knownParentIdsRef.current.has(e.id));
    if (newEmgs.length === 0) return;
    for (const e of newEmgs) knownParentIdsRef.current.add(e.id);
    // Convert EmergencyItem → RichEmergency and merge into emgList
    const richNew: RichEmergency[] = newEmgs.map(e => ({
      id: e.id,
      title: `${e.type} — ${e.employeeName}`,
      description: `Real-time ${e.type} received from ${e.employeeName} in ${e.zone}.`,
      severity: e.severity as RichEmergency["severity"],
      status: (e.status === "resolved" ? "resolved" : e.status === "responding" ? "responding" : "active") as EmgStatus,
      zone: e.zone.split(" - ")[0] || e.zone, // Normalize "Zone A - East" → "Zone A" for clustering
      address: e.zone,
      radius: 100,
      createdAt: e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp),
      affectedCount: 1,
      respondersCount: 0,
      owner: e.isOwned ? { name: e.ownedBy || "Admin", takenAt: new Date() } : undefined,
      timeline: [
        { time: e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp), event: "Incident Created", actor: e.employeeName },
        { time: new Date(), event: "Synced from Mobile App", actor: "System" },
      ],
    }));
    setEmgList(prev => [...richNew, ...prev]);
  }, [_parentEmg]);

  // ── GAP FIX: Handle parent status changes → mirror in emgList ──
  // When a parent emergency status changes to "resolved", mirror it in emgList
  // so the cluster engine drops resolved emergencies from active clusters.
  useEffect(() => {
    const parentResolved = new Set(
      _parentEmg.filter(e => e.status === "resolved").map(e => e.id)
    );
    if (parentResolved.size === 0) return;
    setEmgList(prev => prev.map(e => {
      if (!parentResolved.has(e.id) || e.status === "resolved" || e.status === "closed") return e;
      return {
        ...e,
        status: "resolved" as EmgStatus,
        timeline: [...e.timeline, { time: new Date(), event: "Resolved (synced from parent)", actor: "System" }],
      };
    }));
  }, [_parentEmg]);

  // ── Zone Cluster Detection ──
  const clusters = React.useMemo(() => {
    return detectClusters(emgList.map(e => ({
      id: e.id,
      zone: e.zone,
      status: e.status,
      timestamp: e.createdAt,
      employeeName: e.timeline[0]?.actor || "Unknown",
      severity: e.severity,
    }))).sort((a, b) => {
      // Priority sort: catastrophic first, then mass_casualty, then zone_alert
      const levelOrder: Record<string, number> = { catastrophic: 0, mass_casualty: 1, zone_alert: 2 };
      return (levelOrder[a.level] ?? 3) - (levelOrder[b.level] ?? 3);
    });
  }, [emgList]);

  // ── Catastrophic Auto-Activation: auto-save SAR for catastrophic clusters ──
  // This fulfills the promise of "SAR Protocol auto-activated" in the auto-actions list.
  // Without this, catastrophic auto-activation was just a label with no actual effect.
  const clusterAutoActionsRef = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const cluster of clusters) {
      if (clusterAutoActionsRef.current.has(cluster.id)) continue;

      // Guard: only one evacuation at a time (system limitation — single key)
      const existingEvac = getActiveEvacuation();
      const canEvacuate = !existingEvac || existingEvac.status !== "active";

      // ── Catastrophic: Auto-activate SAR + Auto-trigger evacuation ──
      if (cluster.level === "catastrophic") {
        clusterAutoActionsRef.current.add(cluster.id);
        const result = activateClusterSAR(cluster);
        toast.error("CATASTROPHIC EVENT — SAR AUTO-ACTIVATED", {
          description: result.clusterContext.preStageReason,
          duration: 10000,
        });
        // Catastrophic ALWAYS overrides existing evacuation
        const evac: ActiveEvacuation = {
          id: `EVAC-CLU-${cluster.id.split("-").pop()}`,
          zoneId: cluster.zone.replace(/\s+/g, "-").toUpperCase(),
          zoneName: cluster.zone,
          triggeredAt: Date.now(),
          triggeredBy: "System (Catastrophic Cluster)",
          reason: `Catastrophic event: ${cluster.affectedCount} simultaneous SOS in ${cluster.zone}`,
          expectedDuration: 60,
          status: "active",
        };
        triggerEvacuation(evac);
        toast.error("ZONE EVACUATION TRIGGERED", {
          description: `${cluster.zone} — auto-evacuated due to catastrophic cluster`,
          duration: 8000,
        });
      }

      // ── Mass Casualty: Auto-trigger zone lockdown/evacuation ──
      if (cluster.level === "mass_casualty") {
        clusterAutoActionsRef.current.add(cluster.id);
        if (canEvacuate) {
          const evac: ActiveEvacuation = {
            id: `EVAC-CLU-${cluster.id.split("-").pop()}`,
            zoneId: cluster.zone.replace(/\s+/g, "-").toUpperCase(),
            zoneName: cluster.zone,
            triggeredAt: Date.now(),
            triggeredBy: "System (Mass Casualty Cluster)",
            reason: `Mass casualty: ${cluster.affectedCount} simultaneous SOS in ${cluster.zone}`,
            expectedDuration: 30,
            status: "active",
          };
          triggerEvacuation(evac);
          toast.warning("ZONE LOCKDOWN ACTIVATED", {
            description: `${cluster.zone} — entry restricted, ${cluster.affectedCount} workers affected`,
            duration: 6000,
          });
        } else {
          toast.warning(`${cluster.zone} — Mass Casualty Detected`, {
            description: `Evacuation already active for ${existingEvac?.zoneName || "another zone"}. Manual action required.`,
            duration: 6000,
          });
        }
      }
    }
  }, [clusters]);

  // ── Admin Overload Detection ──
  const ownedClusterCount = clusters.filter(c =>
    c.emergencyIds.some(eid => emgList.find(e => e.id === eid)?.owner?.name === "Current User")
  ).length;

  // Find which cluster an emergency belongs to
  const getClusterForEmg = (emgId: string): ZoneCluster | undefined =>
    clusters.find(c => c.emergencyIds.includes(emgId));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? emgList.find(e => e.id === selectedId) || null : null;
  const [, setTick] = useState(0);
  useEffect(() => { const iv = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(iv); }, []);
  const fmtElapsedDate = (d: Date) => { const diff = Math.floor((Date.now() - d.getTime()) / 1000); const m = Math.floor(diff / 60), s = diff % 60; if (m < 60) return `${m}m ${s}s`; const h = Math.floor(m / 60); return `${h}h ${m % 60}m`; };
  const takeOwnership = (id: string) => { setEmgList(prev => prev.map(e => { if (e.id !== id) return e; const owner: EmgOwner = { name: "Current User", takenAt: new Date() }; const newStatus: EmgStatus = e.status === "active" ? "responding" : e.status; return { ...e, owner, status: newStatus, timeline: [...e.timeline, { time: new Date(), event: "Ownership Taken", actor: owner.name }] }; })); };
  const containEmg = (id: string) => { setEmgList(prev => prev.map(e => { if (e.id !== id || e.status !== "responding") return e; return { ...e, status: "contained" as EmgStatus, timeline: [...e.timeline, { time: new Date(), event: "Contained", actor: e.owner?.name || "System" }] }; })); };
  const resolveEmg = (id: string) => { setEmgList(prev => prev.map(e => { if (e.id !== id || e.status !== "contained") return e; return { ...e, status: "resolved" as EmgStatus, timeline: [...e.timeline, { time: new Date(), event: "Resolved", actor: e.owner?.name || "System" }] }; })); _onResolveParent(id); };
  const closeEmg = (id: string) => { setEmgList(prev => prev.map(e => { if (e.id !== id || e.status !== "resolved") return e; return { ...e, status: "closed" as EmgStatus, timeline: [...e.timeline, { time: new Date(), event: "Closed", actor: "Admin" }] }; })); };
  const dispatchTeam = (id: string) => { setEmgList(prev => prev.map(e => { if (e.id !== id) return e; return { ...e, respondersCount: e.respondersCount + 3, timeline: [...e.timeline, { time: new Date(), event: "Dispatch Team", actor: e.owner?.name || "Admin" }] }; })); };

  // ── Cluster Ownership: take ownership of ALL emergencies in a cluster at once ──
  const takeClusterOwnership = (clusterId: string) => {
    const cluster = clusters.find(c => c.id === clusterId);
    if (!cluster) return;
    setEmgList(prev => prev.map(e => {
      if (!cluster.emergencyIds.includes(e.id)) return e;
      if (e.owner) return e; // already owned
      const owner: EmgOwner = { name: "Current User", takenAt: new Date() };
      return { ...e, owner, status: "responding" as EmgStatus, timeline: [...e.timeline, { time: new Date(), event: "Cluster Ownership Taken", actor: owner.name }] };
    }));
    toast.success("Cluster Ownership Taken", { description: `All ${cluster.affectedCount} emergencies in ${cluster.zone} assigned to you` });
  };

  const activeCount = emgList.filter(e => !["resolved", "closed"].includes(e.status)).length;

  if (selected) {
    const sev = SEVERITY_CONFIG[selected.severity];
    const st = EMG_STATUS_CONFIG[selected.status];
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 pt-3 pb-3 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <button onClick={() => setSelectedId(null)} className="flex items-center gap-1 mb-2" style={{ fontSize: 11, fontWeight: 600, color: TOKENS.accent.primary }}>
            <ChevronLeft className="size-3.5" /> {t("emg.back")}
          </button>
          <div className="flex items-center justify-between">
            <div>
              <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.25)", fontFamily: "monospace", letterSpacing: 0.5 }}>{selected.id}</span>
              <p className="text-white mt-1" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>{selected.title}</p>
            </div>
            <div className="text-right">
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>{t("emg.elapsed")}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: sev.color, fontFamily: "monospace" }}>{fmtElapsedDate(selected.createdAt)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge color={sev.color}>{selected.severity.toUpperCase()}</Badge>
            <Badge color={st.color}>{t(st.tKey)}</Badge>
            <Badge variant="muted">{selected.zone}</Badge>
          </div>
          {/* Cluster linkage banner */}
          {(() => {
            const cl = getClusterForEmg(selected.id);
            if (!cl) return null;
            const cfg = CLUSTER_LEVEL_CONFIG[cl.level];
            const others = cl.emergencyIds.filter(id => id !== selected.id);
            return (
              <div className="mt-2 px-3 py-2 rounded-xl flex items-center gap-2" style={{ background: cfg.bgColor, border: `1px solid ${cfg.borderColor}` }}>
                <Siren className="size-3.5 shrink-0" style={{ color: cfg.color }} />
                <div className="flex-1 min-w-0">
                  <span style={{ fontSize: 9, fontWeight: 800, color: cfg.color }}>{cfg.label}</span>
                  <p className="truncate" style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>
                    Linked with {others.join(", ")} — {cl.affectedCount} total SOS in {cl.zone}
                  </p>
                </div>
              </div>
            );
          })()}
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ scrollbarWidth: "none" }}>
          <DSCard padding={12}>
            <p style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>{selected.description}</p>
          </DSCard>
          <DSCard padding={0} style={{ height: 140, overflow: "hidden", position: "relative" }}>
            <div className="w-full h-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #0A1220 0%, #0F1B2E 100%)" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundImage: "linear-gradient(rgba(0,200,224,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,200,224,0.03) 1px, transparent 1px)", backgroundSize: "30px 30px", opacity: 0.4 }} />
              <div className="flex flex-col items-center gap-2 z-10">
                <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 2, repeat: Infinity }} className="size-10 rounded-full flex items-center justify-center" style={{ background: "rgba(255,45,85,0.15)", border: "2px solid #FF2D55" }}>
                  <Navigation className="size-5" style={{ color: "#FF2D55" }} />
                </motion.div>
              </div>
              <div className="absolute top-2 right-2 px-2 py-1 rounded-lg" style={{ background: "#0F1B2E", border: "1px solid rgba(255,255,255,0.06)", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>{selected.address}</div>
              <div className="absolute bottom-2 left-2 flex gap-2">
                <span className="px-2 py-1 rounded-lg" style={{ background: "#0F1B2E", border: "1px solid rgba(255,255,255,0.06)", fontSize: 9, fontWeight: 700, color: "#FF2D55" }}>{selected.radius}m {t("emg.radius")}</span>
                <span className="px-2 py-1 rounded-lg" style={{ background: "#0F1B2E", border: "1px solid rgba(255,255,255,0.06)", fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}><Users className="size-3 inline mr-1" />{selected.affectedCount} {t("emg.affected")}</span>
              </div>
            </div>
          </DSCard>
          <div className="grid grid-cols-2 gap-2">
            <DSCard padding={12} glow={selected.owner ? TOKENS.accent.primary : TOKENS.accent.warning}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>{t("emg.ownership")}</div>
              {!selected.owner ? (
                <>
                  <div className="px-2 py-1.5 rounded-lg mb-2 text-center" style={{ background: "rgba(255,179,0,0.06)", border: "1px solid rgba(255,179,0,0.15)", fontSize: 10, fontWeight: 600, color: "#FFB300" }}>{t("emg.noOwner")}</div>
                  <button onClick={() => takeOwnership(selected.id)} className="w-full flex items-center justify-center gap-1 py-2 rounded-lg" style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.18)", fontSize: 10, fontWeight: 600, color: "#00C8E0" }}>
                    <UserCheck className="size-3" /> {t("emg.take")}
                  </button>
                </>
              ) : (
                <div className="px-2 py-2 rounded-lg" style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>
                  <p className="text-white" style={{ fontSize: 12, fontWeight: 700 }}>{selected.owner.name}</p>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>Taken {fmtElapsedDate(selected.owner.takenAt)} ago</p>
                </div>
              )}
            </DSCard>
            <DSCard padding={12}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>{t("emg.response")}</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{t("emg.affected")}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#FF2D55" }}>{selected.affectedCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{t("emg.responders")}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#00C8E0" }}>{selected.respondersCount}</span>
                </div>
              </div>
            </DSCard>
          </div>
          <DSCard padding={12}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>{t("emg.actions")}</div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {[
                // phase-1/finish-dashboard-pages (2026-05-25, life-safety):
                // dispatchTeam() needs a responders array — pre-fix was called with
                // just selected.id, silently dispatching with an empty assigned_to.
                // Server now gets {emergencyId, [defaultResponderId], dispatchNote}.
                { icon: Send, label: t("emg.dispatch"),  color: "#8090A5", onClick: () => {
                  // phase-1/finish-dashboard-pages (2026-05-25): local dispatchTeam() updates
                  // the displayed timeline + responders count. The server-side dispatch goes
                  // through dashboard-actions edge function via emitSyncEvent (audit-logged
                  // server-side). NOTE: pre-fix was JUST the local call — silent on audit log.
                  dispatchTeam(selected.id);
                  const note = `Dispatched responders to ${selected.zone || "Unknown zone"} for ${selected.title}`;
                  trackEventSync(selected.id, "responder_dispatched", note, "Admin", "Admin",
                    { zone: selected.zone, emergencyType: selected.title });
                  toast.success("Team dispatched", { description: note });
                }},
                // WIRE: Broadcast Alert — was toast-only stub. Now uses sendBroadcast()
                // with EMERGENCY priority targeted at the zone (or all zones if unknown).
                { icon: Bell, label: t("emg.broadcast"), color: "#4A90D9", onClick: () => {
                  const audience = selected.zone
                    ? { type: "zone" as const, zoneIds: [selected.zone] }
                    : { type: "all" as const };
                  sendBroadcast({
                    title: `🚨 EMERGENCY — ${selected.title}`,
                    body: `Active emergency in ${selected.zone || "your area"}. Stay alert. Follow safety protocols. If you can assist, contact Admin.`,
                    priority: "emergency",
                    audience,
                    audienceLabel: selected.zone || "All Zones",
                    source: "manual", senderName: "Emergency Command", senderRole: "Admin",
                    timestamp: Date.now(),
                    relatedEmergencyId: selected.id,
                  });
                  trackEventSync(selected.id, "emergency_services_called",
                    `Admin broadcast emergency alert to ${selected.zone || "all zones"}`,
                    "Admin", "Admin", { broadcastTarget: selected.zone || "all" });
                  toast.success("Broadcast sent", { description: `Workers in ${selected.zone || "all zones"} have been alerted` });
                }},
                // WIRE: Escalate — was toast-only stub. Now emits SOS_ESCALATED
                // SyncEvent (added in strict-4) so dashboard widgets + safety-intelligence
                // react. Also broadcasts to admin/supervisor roles for management chain.
                { icon: Zap,  label: t("emg.escalate"),  color: "#FFB300", onClick: () => {
                  emitSyncEvent({
                    type: "SOS_ESCALATED",
                    employeeId: (selected as any).employeeId || selected.id,
                    employeeName: selected.title,
                    zone: selected.zone,
                    timestamp: Date.now(),
                    data: {
                      emergencyId: selected.id,
                      reason: "admin_manual_escalation",
                      severity: selected.severity,
                      escalatedTo: "company_admin_and_safety_director",
                    },
                  });
                  sendBroadcast({
                    title: `⬆️ ESCALATED — ${selected.title}`,
                    body: `Emergency ${selected.id} escalated by Admin. Requires Zone Admin + Safety Director attention.`,
                    priority: "emergency",
                    audience: { type: "role", roles: ["admin", "supervisor"] },
                    audienceLabel: "Management",
                    source: "manual", senderName: "Emergency Command", senderRole: "Admin",
                    timestamp: Date.now(),
                    relatedEmergencyId: selected.id,
                  });
                  trackEventSync(selected.id, "escalation_triggered",
                    `Admin escalated to management chain (Zone Admin + Safety Director)`,
                    "Admin", "Admin", { severity: selected.severity });
                  toast.success("Escalated to management", { description: "Zone Admin & Safety Director notified" });
                }},
              ].map(a => (
                <button key={a.label} onClick={a.onClick} className="flex flex-col items-center gap-1 py-2 rounded-lg" style={{ background: `${a.color}0A`, border: `1px solid ${a.color}1F` }}>
                  <a.icon className="size-3.5" style={{ color: a.color }} />
                  <span style={{ fontSize: 8, fontWeight: 600, color: a.color }}>{a.label}</span>
                </button>
              ))}
            </div>
            <Divider spacing={8} />
            <div className="space-y-2">
              {selected.status === "responding" && <button onClick={() => containEmg(selected.id)} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg" style={{ background: "rgba(52,199,89,0.08)", border: "1px solid rgba(52,199,89,0.18)", fontSize: 11, fontWeight: 700, color: "#34C759" }}><Shield className="size-3.5" /> {t("emg.contain")}</button>}
              {selected.status === "contained" && <button onClick={() => resolveEmg(selected.id)} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg" style={{ background: "linear-gradient(135deg, #00C8E0 0%, #0088A8 100%)", fontSize: 11, fontWeight: 700, color: "#fff", boxShadow: "0 4px 16px rgba(0,200,224,0.25)" }}><CheckCircle2 className="size-3.5" /> {t("emg.resolve")}</button>}
              {selected.status === "resolved" && <button onClick={() => closeEmg(selected.id)} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg" style={{ background: "rgba(128,144,165,0.08)", border: "1px solid rgba(128,144,165,0.18)", fontSize: 11, fontWeight: 700, color: "#8090A5" }}><XCircle className="size-3.5" /> {t("emg.closePerm")}</button>}
              {selected.status === "active" && !selected.owner && <button onClick={() => takeOwnership(selected.id)} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg" style={{ background: "linear-gradient(135deg, #34C759 0%, #28A745 100%)", fontSize: 11, fontWeight: 700, color: "#fff", boxShadow: "0 4px 16px rgba(52,199,89,0.25)" }}><UserCheck className="size-3.5" /> {t("emg.takeOwnership")}</button>}
              {(selected.status === "resolved" || selected.status === "closed") && (
                <button onClick={() => {
                  const emgItem: EmergencyItem = { id: selected.id, severity: selected.severity, employeeName: selected.title, zone: selected.zone, type: selected.description?.split(" ")[0] || "Emergency", timestamp: selected.createdAt, status: "resolved", elapsed: Math.floor((Date.now() - selected.createdAt.getTime()) / 1000), isOwned: !!selected.owner, ownedBy: selected.owner?.name };
                  const reportData = buildReportData(emgItem);
                  generateEmergencyLifecyclePDF(reportData);
                }} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg" style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)", fontSize: 11, fontWeight: 700, color: "#00C8E0" }}>
                  <Download className="size-3.5" /> Export Lifecycle Report (PDF)
                </button>
              )}
            </div>
          </DSCard>
          <DSCard padding={12}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>{t("emg.timeline")}</div>
            {selected.timeline.map((item, idx) => (
              <div key={idx} className="flex gap-3 items-start">
                <div className="flex flex-col items-center" style={{ width: 10 }}>
                  <div className="size-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: idx === selected.timeline.length - 1 ? "#00C8E0" : "rgba(128,144,165,0.5)" }} />
                  {idx < selected.timeline.length - 1 && <div className="w-px flex-1 mt-1" style={{ background: "rgba(255,255,255,0.04)", minHeight: 20 }} />}
                </div>
                <div className="flex-1 pb-3">
                  <div className="flex items-center justify-between">
                    <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>{item.event}</span>
                    <span style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>{item.time.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 500, color: "rgba(255,255,255,0.25)" }}>{item.actor}</span>
                </div>
              </div>
            ))}
          </DSCard>
        </div>
      </div>
    );
  }

  if (webMode) {
    return (
      <div className="flex h-full" style={{ height: "calc(100vh - 56px)" }}>
        <div className="flex flex-col" style={{ width: 420, borderRight: "1px solid rgba(255,255,255,0.05)", flexShrink: 0 }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="flex items-center gap-3">
              <h2 className="text-white" style={{ fontSize: 16, fontWeight: 800 }}>Emergencies</h2>
              {activeCount > 0 && (
                <motion.span animate={{ scale: [1, 1.12, 1] }} transition={{ duration: 1.5, repeat: Infinity }} className="px-2 py-0.5 rounded-full" style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: "#FF2D55" }}>{activeCount} LIVE</motion.span>
              )}
            </div>
            <button onClick={onCreate} className="flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "linear-gradient(135deg, #FF2D55, #CC2244)", boxShadow: "0 4px 16px rgba(255,45,85,0.25)" }}>
              <Plus className="size-3.5" /> New
            </button>
          </div>
          <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
            {/* Zone Cluster Banner */}
            {clusters.length > 0 && (
              <div className="px-4 pt-3">
                <ZoneClusterBanner clusters={clusters} onAction={(cid, aid) => { if (aid === "deploy_team") takeClusterOwnership(cid); }} onLaunchSAR={onLaunchSAR} />
                {/* Admin Overload Warning — triggers when admin owns 2+ clusters */}
                {ownedClusterCount >= 2 && (
                  <div
                    className="mt-2 px-3 py-2.5 rounded-xl flex items-center gap-2.5"
                    style={{
                      background: "linear-gradient(135deg, rgba(255,149,0,0.08), rgba(255,45,85,0.05))",
                      border: "1px solid rgba(255,149,0,0.2)",
                    }}
                  >
                    <div className="size-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(255,149,0,0.12)" }}>
                      <AlertTriangle className="size-3.5" style={{ color: "#FF9500" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p style={{ fontSize: 10, fontWeight: 800, color: "#FF9500" }}>COGNITIVE OVERLOAD RISK</p>
                      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
                        You are managing {ownedClusterCount} clusters simultaneously. Consider delegating to another admin for safer response coordination.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
            {emgList.map(emg => {
              const sev = SEVERITY_CONFIG[emg.severity];
              const st = EMG_STATUS_CONFIG[emg.status];
              const elapsed = Math.floor((Date.now() - emg.createdAt.getTime()) / 1000);
              const isActive = !["resolved", "closed"].includes(emg.status);
              const isSelected = selectedId === emg.id;
              const clusterInfo = getClusterForEmg(emg.id);
              return (
                <button key={emg.id} onClick={() => setSelectedId(emg.id)} className="w-full text-left px-5 py-4 transition-colors"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: isSelected ? `${sev.color}08` : clusterInfo ? `${CLUSTER_LEVEL_CONFIG[clusterInfo.level].color}04` : "transparent", borderLeft: `3px solid ${isSelected ? sev.color : clusterInfo ? CLUSTER_LEVEL_CONFIG[clusterInfo.level].color : "transparent"}` }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {isActive && emg.status !== "contained" && <motion.div animate={{ scale: [1, 1.4, 1], opacity: [1, 0.4, 1] }} transition={{ duration: 1.2, repeat: Infinity }} className="size-2 rounded-full shrink-0" style={{ background: st.color }} />}
                        <p className="text-white truncate" style={{ fontSize: 13, fontWeight: 700 }}>{emg.title}</p>
                      </div>
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{emg.zone} · {emg.affectedCount} affected</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-md" style={{ fontSize: 9, fontWeight: 700, color: sev.color, background: sev.bg }}>{emg.severity.toUpperCase()}</span>
                        <span className="px-2 py-0.5 rounded-md" style={{ fontSize: 9, fontWeight: 700, color: st.color, background: st.bg }}>{emg.status.toUpperCase()}</span>
                        {emg.owner && <span style={{ fontSize: 9, fontWeight: 600, color: "#00C853" }}>✓ Owned</span>}
                        {clusterInfo && (
                          <span className="px-2 py-0.5 rounded-md" style={{
                            fontSize: 8, fontWeight: 800,
                            color: CLUSTER_LEVEL_CONFIG[clusterInfo.level].color,
                            background: CLUSTER_LEVEL_CONFIG[clusterInfo.level].bgColor,
                            border: `1px solid ${CLUSTER_LEVEL_CONFIG[clusterInfo.level].borderColor}`,
                            letterSpacing: "0.3px",
                          }}>
                            CLUSTER {clusterInfo.emergencyIds.indexOf(emg.id) + 1}/{clusterInfo.affectedCount}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p style={{ fontSize: 16, fontWeight: 800, color: timerColor(elapsed), fontVariantNumeric: "tabular-nums" }}>{fmtElapsed(elapsed)}</p>
                      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>elapsed</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          {!selectedId || !emgList.find(e => e.id === selectedId) ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="size-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <AlertTriangle className="size-7" style={{ color: "rgba(255,255,255,0.15)" }} />
              </div>
              <p style={{ fontSize: 15, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>Select an emergency to view details</p>
            </div>
          ) : (() => {
            const sel = emgList.find(e => e.id === selectedId)!;
            const sev = SEVERITY_CONFIG[sel.severity];
            const st = EMG_STATUS_CONFIG[sel.status];
            const elapsed = Math.floor((Date.now() - sel.createdAt.getTime()) / 1000);
            return (
              <div className="p-6 space-y-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2.5 py-1 rounded-lg" style={{ fontSize: 11, fontWeight: 700, color: sev.color, background: sev.bg }}>{sel.severity.toUpperCase()}</span>
                      <span className="px-2.5 py-1 rounded-lg" style={{ fontSize: 11, fontWeight: 700, color: st.color, background: st.bg }}>{sel.status.toUpperCase()}</span>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>{sel.id}</span>
                    </div>
                    <h2 className="text-white" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" }}>{sel.title}</h2>
                    <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>{sel.zone} · {sel.address}</p>
                  </div>
                  <div className="text-right">
                    <p style={{ fontSize: 32, fontWeight: 800, color: timerColor(elapsed), fontVariantNumeric: "tabular-nums" }}>{fmtElapsed(elapsed)}</p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>response time</p>
                  </div>
                </div>
                {/* Cluster Linkage Banner — web detail */}
                {(() => {
                  const cl = getClusterForEmg(sel.id);
                  if (!cl) return null;
                  const cfg = CLUSTER_LEVEL_CONFIG[cl.level];
                  const others = cl.emergencyIds.filter(id => id !== sel.id);
                  return (
                    <div className="px-4 py-3 rounded-xl flex items-center gap-3" style={{ background: cfg.bgColor, border: `1px solid ${cfg.borderColor}` }}>
                      <Siren className="size-5 shrink-0" style={{ color: cfg.color }} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span style={{ fontSize: 11, fontWeight: 800, color: cfg.color }}>{cfg.label}</span>
                          <span className="px-2 py-0.5 rounded-md" style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: cfg.color }}>{cl.affectedCount} SOS</span>
                        </div>
                        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
                          This emergency is part of a zone cluster with {others.join(", ")} in {cl.zone}. Unified response recommended.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {(cl.level === "mass_casualty" || cl.level === "catastrophic") && (
                          <button
                            onClick={() => {
                              activateClusterSAR(cl);
                              toast.success("SAR Protocol Activated", { description: `Mission pre-staged for ${cl.affectedCount} workers in ${cl.zone}` });
                              onLaunchSAR?.();
                            }}
                            className="px-3 py-2 rounded-lg flex items-center gap-1.5"
                            style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "linear-gradient(135deg, #FF2D55, #FF6B35)", boxShadow: "0 0 10px rgba(255,45,85,0.3)" }}
                          >
                            <Radar className="size-3.5" />
                            SAR
                          </button>
                        )}
                        <button
                          onClick={() => takeClusterOwnership(cl.id)}
                          className="px-3 py-2 rounded-lg"
                          style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: cfg.color }}
                        >
                          Own All ({cl.affectedCount})
                        </button>
                      </div>
                    </div>
                  );
                })()}
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: "Affected",   value: sel.affectedCount,  color: "#FF2D55" },
                    { label: "Responders", value: sel.respondersCount, color: "#00C8E0" },
                    { label: "Radius",     value: `${sel.radius}m`,   color: "#FF9500" },
                    { label: "Owner",      value: sel.owner ? sel.owner.name.split(" ")[0] : "None", color: sel.owner ? "#00C853" : "rgba(255,255,255,0.3)" },
                  ].map(s => (
                    <div key={s.label} className="p-4 rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <p style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</p>
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{s.label}</p>
                    </div>
                  ))}
                </div>
                <div className="p-4 rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.65 }}>{sel.description}</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  {sel.status === "active" && !sel.owner && <button onClick={() => takeOwnership(sel.id)} className="flex items-center gap-2 px-5 py-3 rounded-xl" style={{ background: "linear-gradient(135deg, #34C759, #28A745)", fontSize: 14, fontWeight: 700, color: "#fff", boxShadow: "0 4px 20px rgba(52,199,89,0.3)" }}><UserCheck className="size-4" /> Take Ownership</button>}
                  {sel.status === "responding" && <button onClick={() => containEmg(sel.id)} className="flex items-center gap-2 px-5 py-3 rounded-xl" style={{ background: "linear-gradient(135deg, #00C8E0, #0088A8)", fontSize: 14, fontWeight: 700, color: "#fff", boxShadow: "0 4px 20px rgba(0,200,224,0.3)" }}><Shield className="size-4" /> Mark Contained</button>}
                  {sel.status === "contained" && <button onClick={() => resolveEmg(sel.id)} className="flex items-center gap-2 px-5 py-3 rounded-xl" style={{ background: "linear-gradient(135deg, #00C853, #009940)", fontSize: 14, fontWeight: 700, color: "#fff", boxShadow: "0 4px 20px rgba(0,200,83,0.3)" }}><CheckCircle2 className="size-4" /> Resolve</button>}
                  {sel.status === "resolved" && <button onClick={() => closeEmg(sel.id)} className="flex items-center gap-2 px-5 py-3 rounded-xl" style={{ background: "rgba(128,144,165,0.1)", border: "1px solid rgba(128,144,165,0.2)", fontSize: 14, fontWeight: 700, color: "#8090A5" }}><XCircle className="size-4" /> Close Permanently</button>}
                  {(sel.status === "resolved" || sel.status === "closed") && (
                    <button onClick={() => {
                      const emgItem: EmergencyItem = { id: sel.id, severity: sel.severity, employeeName: sel.title, zone: sel.zone, type: sel.description?.split(" — ")[0] || "Emergency", timestamp: sel.createdAt, status: "resolved", elapsed: Math.floor((Date.now() - sel.createdAt.getTime()) / 1000), isOwned: !!sel.owner, ownedBy: sel.owner?.name };
                      generateEmergencyLifecyclePDF(buildReportData(emgItem));
                    }} className="flex items-center gap-2 px-5 py-3 rounded-xl" style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.1), rgba(123,94,255,0.06))", border: "1px solid rgba(0,200,224,0.15)", fontSize: 14, fontWeight: 700, color: "#00C8E0", boxShadow: "0 4px 16px rgba(0,200,224,0.08)" }}>
                      <Download className="size-4" /> Export Lifecycle Report
                    </button>
                  )}
                  {[
                    // phase-1/finish-dashboard-pages (2026-05-25, life-safety): web-mode buttons
                    // share the SAME wiring as the drawer buttons (lines ~2580). Pre-fix all 3
                    // were toast-only stubs.
                    { icon: Send, label: "Dispatch Team", color: "#FF9500", onClick: () => {
                      dispatchTeam(sel.id);
                      trackEventSync(sel.id, "responder_dispatched", `Dispatched to ${sel.zone}`, "Admin", "Admin");
                      toast.success("Team dispatched", { description: `Responders en route to ${sel.zone}` });
                    }},
                    { icon: Bell, label: "Broadcast", color: "#7B5EFF", onClick: () => {
                      const audience = sel.zone ? { type: "zone" as const, zoneIds: [sel.zone] } : { type: "all" as const };
                      sendBroadcast({
                        title: `🚨 EMERGENCY — ${sel.title}`,
                        body: `Active emergency in ${sel.zone || "your area"}. Stay alert.`,
                        priority: "emergency",
                        audience,
                        audienceLabel: sel.zone || "All Zones",
                        source: "manual", senderName: "Emergency Command", senderRole: "Admin",
                        timestamp: Date.now(), relatedEmergencyId: sel.id,
                      });
                      trackEventSync(sel.id, "emergency_services_called", `Broadcast to ${sel.zone || "all"}`, "Admin", "Admin");
                      toast.success("Broadcast sent", { description: `Alerted workers in ${sel.zone || "all zones"}` });
                    }},
                    { icon: Zap, label: "Escalate", color: "#FF2D55", onClick: () => {
                      emitSyncEvent({
                        type: "SOS_ESCALATED",
                        employeeId: (sel as any).employeeId || sel.id,
                        employeeName: sel.title, zone: sel.zone, timestamp: Date.now(),
                        data: { emergencyId: sel.id, reason: "admin_manual_escalation", severity: sel.severity, escalatedTo: "company_admin_and_safety_director" },
                      });
                      sendBroadcast({
                        title: `⬆️ ESCALATED — ${sel.title}`,
                        body: `Emergency ${sel.id} escalated. Requires Zone Admin + Safety Director.`,
                        priority: "emergency",
                        audience: { type: "role", roles: ["admin", "supervisor"] },
                        audienceLabel: "Management",
                        source: "manual", senderName: "Emergency Command", senderRole: "Admin",
                        timestamp: Date.now(), relatedEmergencyId: sel.id,
                      });
                      trackEventSync(sel.id, "escalation_triggered", `Escalated to management`, "Admin", "Admin");
                      toast.success("Escalated to management", { description: "Zone Admin & Safety Director notified" });
                    }},
                  ].map(a => (
                    <button key={a.label} onClick={a.onClick} className="flex items-center gap-2 px-4 py-3 rounded-xl" style={{ background: `${a.color}10`, border: `1px solid ${a.color}20`, fontSize: 13, fontWeight: 600, color: a.color }}>
                      <a.icon className="size-4" /> {a.label}
                    </button>
                  ))}
                </div>
                <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div className="px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}><p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>Incident Timeline</p></div>
                  <div className="px-5 py-4">
                    {sel.timeline.map((item, idx) => (
                      <div key={idx} className="flex gap-4 items-start mb-4 last:mb-0">
                        <div className="flex flex-col items-center" style={{ width: 12 }}>
                          <div className="size-2.5 rounded-full mt-1 shrink-0" style={{ background: idx === sel.timeline.length - 1 ? "#00C8E0" : "rgba(255,255,255,0.15)" }} />
                          {idx < sel.timeline.length - 1 && <div className="w-px flex-1 mt-1.5" style={{ background: "rgba(255,255,255,0.06)", minHeight: 24 }} />}
                        </div>
                        <div className="flex-1 flex items-start justify-between">
                          <div>
                            <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{item.event}</p>
                            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{item.actor}</p>
                          </div>
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", fontVariantNumeric: "tabular-nums" }}>{item.time.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="danger" pulse={activeCount > 0}>{activeCount} {t("emg.active")}</Badge>
          {emgList.some(e => !["resolved", "closed"].includes(e.status) && (Date.now() - e.createdAt.getTime()) / 1000 >= SLA_THRESHOLD) && <Badge variant="warning">SLA</Badge>}
        </div>
        <DSButton variant="danger" size="sm" icon={Plus} onClick={onCreate}>{t("b.create")}</DSButton>
      </div>
      {/* Zone Cluster Banner — mobile */}
      <ZoneClusterBanner clusters={clusters} onAction={(cid, aid) => { if (aid === "deploy_team") takeClusterOwnership(cid); }} onLaunchSAR={onLaunchSAR} />
      <div className="space-y-2">
        {emgList.map(emg => {
          const sev = SEVERITY_CONFIG[emg.severity];
          const st = EMG_STATUS_CONFIG[emg.status];
          const elapsed = Math.floor((Date.now() - emg.createdAt.getTime()) / 1000);
          const clusterInfo = getClusterForEmg(emg.id);
          return (
            <motion.div key={emg.id} layout onClick={() => setSelectedId(emg.id)}
              className="rounded-xl overflow-hidden cursor-pointer" whileTap={{ scale: 0.98 }}
              style={{ background: emg.status === "active" ? `${sev.color}06` : "rgba(255,255,255,0.02)", border: `1px solid ${emg.status === "active" ? `${sev.color}15` : "rgba(255,255,255,0.04)"}` }}>
              <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${sev.color}10` }}>
                {(emg.status === "active" || emg.status === "new") && <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 1, repeat: Infinity }} className="size-2 rounded-full" style={{ background: st.color }} />}
                <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>{emg.id}</span>
                {emg.owner && <Badge variant="success" size="sm">{t("emg.owned")}</Badge>}
                {clusterInfo && (
                  <span className="px-1.5 py-0.5 rounded-md" style={{
                    fontSize: 8, fontWeight: 800,
                    color: CLUSTER_LEVEL_CONFIG[clusterInfo.level].color,
                    background: CLUSTER_LEVEL_CONFIG[clusterInfo.level].bgColor,
                    border: `1px solid ${CLUSTER_LEVEL_CONFIG[clusterInfo.level].borderColor}`,
                  }}>
                    CLUSTER {clusterInfo.emergencyIds.indexOf(emg.id) + 1}/{clusterInfo.affectedCount}
                  </span>
                )}
                <span style={{ marginLeft: "auto" }}><Badge color={st.color}>{t(st.tKey)}</Badge></span>
              </div>
              <div className="px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-white truncate" style={{ fontSize: 13, fontWeight: 600 }}>{emg.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge color={sev.color}>{emg.severity.toUpperCase()}</Badge>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{emg.zone}</span>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>·</span>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}><Users className="size-2.5 inline mr-0.5" />{emg.affectedCount}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <span style={{ fontSize: 14, fontWeight: 800, color: timerColor(elapsed), fontVariantNumeric: "tabular-nums" }}>{fmtElapsed(elapsed)}</span>
                  </div>
                </div>
                <div className="flex items-center justify-end mt-1.5">
                  <span className="flex items-center gap-0.5" style={{ fontSize: 9, color: "#00C8E0", fontWeight: 500 }}>{t("emg.viewDetails")} <ChevronRight className="size-3" /></span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
