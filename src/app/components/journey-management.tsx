// ═══════════════════════════════════════════════════════════════
// SOSphere — Journey Management
// ─────────────────────────────────────────────────────────────
// Track field workers on route assignments
// Auto-detect route deviation and missed waypoints
// ETA monitoring with auto-alert on delay
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  MapPin, Navigation, Clock, AlertTriangle, CheckCircle,
  ChevronRight, Users, Phone, Eye, Shield,
  Play, Pause, Flag, Route, Circle, Timer,
  ArrowRight, X, Zap, BarChart3, TrendingUp, Radar,
} from "lucide-react";
import { toast } from "sonner";
import { hapticSuccess, hapticWarning, hapticMedium } from "./haptic-feedback";
import { emitAdminSignal, emitSyncEvent } from "./shared-store";

// ── Types ────────────────────��───────────────────────────────
interface Waypoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  eta: Date;
  arrivedAt?: Date;
  status: "pending" | "arrived" | "missed" | "skipped";
}

interface Journey {
  id: string;
  employeeName: string;
  employeeId: string;
  origin: string;
  destination: string;
  startTime: Date;
  estimatedEnd: Date;
  actualEnd?: Date;
  waypoints: Waypoint[];
  status: "active" | "completed" | "delayed" | "deviated" | "sos";
  currentLocation?: string;
  distanceCovered: number;  // km
  totalDistance: number;     // km
  vehicleType: string;
}

// ── Mock Data ─────────────────────────────────────────────────
const MOCK_JOURNEYS: Journey[] = [
  {
    id: "JRN-001", employeeName: "Ahmed Khalil", employeeId: "EMP-001",
    origin: "HQ Gate A", destination: "Remote Station Delta",
    startTime: new Date(Date.now() - 5400000), estimatedEnd: new Date(Date.now() + 3600000),
    distanceCovered: 42, totalDistance: 78, vehicleType: "Pickup Truck",
    status: "active", currentLocation: "Highway 45, KM marker 42",
    waypoints: [
      { id: "W1", name: "Security Checkpoint", lat: 24.71, lng: 46.67, eta: new Date(Date.now() - 4800000), arrivedAt: new Date(Date.now() - 4700000), status: "arrived" },
      { id: "W2", name: "Fuel Station", lat: 24.73, lng: 46.70, eta: new Date(Date.now() - 3600000), arrivedAt: new Date(Date.now() - 3500000), status: "arrived" },
      { id: "W3", name: "Junction B-12", lat: 24.78, lng: 46.75, eta: new Date(Date.now() + 600000), status: "pending" },
      { id: "W4", name: "Remote Station Delta", lat: 24.85, lng: 46.82, eta: new Date(Date.now() + 3600000), status: "pending" },
    ],
  },
  {
    id: "JRN-002", employeeName: "Omar Al-Farsi", employeeId: "EMP-008",
    origin: "Zone C Lab", destination: "Warehouse 7",
    startTime: new Date(Date.now() - 7200000), estimatedEnd: new Date(Date.now() - 1800000),
    distanceCovered: 15, totalDistance: 22, vehicleType: "Van",
    status: "delayed", currentLocation: "Industrial Road, near Block 5",
    waypoints: [
      { id: "W1", name: "Lab Exit", lat: 24.65, lng: 46.60, eta: new Date(Date.now() - 7000000), arrivedAt: new Date(Date.now() - 6900000), status: "arrived" },
      { id: "W2", name: "Bridge Crossing", lat: 24.67, lng: 46.63, eta: new Date(Date.now() - 5400000), arrivedAt: new Date(Date.now() - 5200000), status: "arrived" },
      { id: "W3", name: "Industrial Gate", lat: 24.69, lng: 46.66, eta: new Date(Date.now() - 3600000), status: "missed" },
      { id: "W4", name: "Warehouse 7", lat: 24.70, lng: 46.68, eta: new Date(Date.now() - 1800000), status: "pending" },
    ],
  },
  {
    id: "JRN-003", employeeName: "Sara Al-Mutairi", employeeId: "EMP-005",
    origin: "HQ", destination: "Zone E — Logistics Hub",
    startTime: new Date(Date.now() - 10800000), estimatedEnd: new Date(Date.now() - 7200000),
    actualEnd: new Date(Date.now() - 7500000),
    distanceCovered: 35, totalDistance: 35, vehicleType: "Company Car",
    status: "completed",
    waypoints: [
      { id: "W1", name: "HQ Gate", lat: 24.70, lng: 46.65, eta: new Date(Date.now() - 10700000), arrivedAt: new Date(Date.now() - 10650000), status: "arrived" },
      { id: "W2", name: "Highway Exit 12", lat: 24.74, lng: 46.70, eta: new Date(Date.now() - 9000000), arrivedAt: new Date(Date.now() - 8900000), status: "arrived" },
      { id: "W3", name: "Logistics Hub", lat: 24.80, lng: 46.78, eta: new Date(Date.now() - 7200000), arrivedAt: new Date(Date.now() - 7500000), status: "arrived" },
    ],
  },
  {
    id: "JRN-004", employeeName: "Mohammed Ali", employeeId: "EMP-006",
    origin: "Zone D Gate", destination: "Emergency Repair Site",
    startTime: new Date(Date.now() - 1800000), estimatedEnd: new Date(Date.now() + 5400000),
    distanceCovered: 8, totalDistance: 45, vehicleType: "Service Truck",
    status: "deviated", currentLocation: "Off-route — 2.3km from planned path",
    waypoints: [
      { id: "W1", name: "Zone D Exit", lat: 24.63, lng: 46.58, eta: new Date(Date.now() - 1500000), arrivedAt: new Date(Date.now() - 1400000), status: "arrived" },
      { id: "W2", name: "Highway Merge", lat: 24.65, lng: 46.61, eta: new Date(Date.now() + 900000), status: "pending" },
      { id: "W3", name: "Repair Site", lat: 24.72, lng: 46.72, eta: new Date(Date.now() + 5400000), status: "pending" },
    ],
  },
];

const STATUS_CONFIG = {
  active:    { color: "#00C853", label: "On Route",  bg: "rgba(0,200,83,0.06)" },
  completed: { color: "#00C8E0", label: "Completed", bg: "rgba(0,200,224,0.04)" },
  delayed:   { color: "#FF9500", label: "Delayed",   bg: "rgba(255,150,0,0.06)" },
  deviated:  { color: "#FF2D55", label: "Off Route", bg: "rgba(255,45,85,0.06)" },
  sos:       { color: "#FF2D55", label: "SOS",       bg: "rgba(255,45,85,0.08)" },
};

// ── Dashboard Page ────────────────────────────────────────────
export function JourneyManagementPage({ t, webMode, onGuideMe, onLaunchSAR }: { t: (k: string) => string; webMode?: boolean; onGuideMe?: (journeyId: string, employeeName: string) => void; onLaunchSAR?: (employeeId: string, employeeName: string, zone: string) => void }) {
  // REAL: Load persisted journeys, fall back to MOCK_JOURNEYS as demo seed
  const [journeys, setJourneys] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("sosphere_journeys") || "[]");
      if (saved.length > 0) {
        // Revive Date objects
        return saved.map((j: any) => ({
          ...j,
          startTime: new Date(j.startTime),
          estimatedEnd: new Date(j.estimatedEnd),
          checkpoints: (j.checkpoints || []).map((c: any) => ({ ...c, time: new Date(c.time) })),
        }));
      }
    } catch {}
    return MOCK_JOURNEYS;
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "issues">("all");
  const [connectionWatchdog, setConnectionWatchdog] = useState<Record<string, { lostAt: number; minutesLost: number }>>({});

  // Auto-save journeys on change
  useEffect(() => {
    try { localStorage.setItem("sosphere_journeys", JSON.stringify(journeys)); } catch {}
  }, [journeys]);

  // ── Connection Watchdog — monitors delayed/deviated journeys ──
  // Simulates detecting connection loss for workers on remote routes
  useEffect(() => {
    const interval = setInterval(() => {
      setConnectionWatchdog(prev => {
        const updated = { ...prev };
        journeys.forEach(j => {
          if (j.status === "deviated" || (j.status === "delayed" && j.estimatedEnd.getTime() < Date.now() - 15 * 60 * 1000)) {
            if (!updated[j.id]) {
              updated[j.id] = { lostAt: Date.now(), minutesLost: 0 };
            }
            updated[j.id] = {
              ...updated[j.id],
              minutesLost: Math.floor((Date.now() - updated[j.id].lostAt) / 60000),
            };
          }
        });
        return updated;
      });
    }, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, [journeys]);

  const handleLaunchSAR = (journey: typeof MOCK_JOURNEYS[0]) => {
    hapticWarning();
    // Emit SAR event through shared store
    emitSyncEvent({
      type: "SAR_ACTIVATED",
      employeeId: journey.employeeId,
      employeeName: journey.employeeName,
      zone: journey.destination,
      timestamp: Date.now(),
      data: { source: "journey_watchdog", journeyId: journey.id, lastKnown: journey.currentLocation },
    });
    // Also emit admin signal to mobile workers nearby
    emitAdminSignal("SAR_ACTIVATED", journey.employeeId, {
      employeeName: journey.employeeName,
      zone: journey.destination,
    });
    toast.error("🚨 SAR Protocol Activated", {
      description: `Search & Rescue initiated for ${journey.employeeName} — last known: ${journey.currentLocation || journey.destination}`,
      duration: 8000,
    });
    if (onLaunchSAR) {
      onLaunchSAR(journey.employeeId, journey.employeeName, journey.destination);
    }
  };

  const filtered = journeys.filter(j =>
    filter === "all" ? true :
    filter === "active" ? (j.status === "active" || j.status === "delayed" || j.status === "deviated") :
    (j.status === "delayed" || j.status === "deviated" || j.status === "sos")
  );

  const activeCount = journeys.filter(j => j.status === "active").length;
  const issueCount = journeys.filter(j => j.status === "delayed" || j.status === "deviated").length;

  return (
    <div className={`p-5 space-y-5 ${webMode ? "max-w-5xl mx-auto" : ""}`}>
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Active Journeys", value: activeCount + issueCount, color: "#00C8E0", icon: Navigation },
          { label: "On Route", value: activeCount, color: "#00C853", icon: Route },
          { label: "Issues", value: issueCount, color: "#FF9500", icon: AlertTriangle },
          { label: "Completed Today", value: journeys.filter(j => j.status === "completed").length, color: "#00C8E0", icon: CheckCircle },
        ].map(stat => {
          const SI = stat.icon;
          return (
            <div key={stat.label} className="rounded-xl p-3"
              style={{ background: `${stat.color}06`, border: `1px solid ${stat.color}10` }}>
              <div className="flex items-center gap-2 mb-2">
                <SI className="size-3.5" style={{ color: stat.color }} />
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>{stat.label}</span>
              </div>
              <span className="text-white" style={{ fontSize: 22, fontWeight: 800 }}>{stat.value}</span>
            </div>
          );
        })}
      </div>

      {/* Filter */}
      <div className="flex gap-1.5">
        {(["all", "active", "issues"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded-lg"
            style={{
              background: filter === f ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${filter === f ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.05)"}`,
            }}>
            <span style={{ fontSize: 11, color: filter === f ? "#00C8E0" : "rgba(255,255,255,0.4)", fontWeight: 600 }}>
              {f === "all" ? "All Journeys" : f === "active" ? "In Progress" : "Issues Only"}
            </span>
            {f === "issues" && issueCount > 0 && (
              <span className="ml-1.5 px-1 py-0.5 rounded-md" style={{ background: "rgba(255,150,0,0.15)", fontSize: 9, fontWeight: 700, color: "#FF9500" }}>
                {issueCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Journey Cards */}
      <div className="space-y-2.5">
        {filtered.map(journey => {
          const cfg = STATUS_CONFIG[journey.status];
          const progress = Math.round((journey.distanceCovered / journey.totalDistance) * 100);
          const isExpanded = expandedId === journey.id;
          const completedWaypoints = journey.waypoints.filter(w => w.status === "arrived").length;

          return (
            <motion.div key={journey.id} layout className="rounded-xl overflow-hidden"
              style={{ background: cfg.bg, border: `1px solid ${cfg.color}10` }}>
              <button onClick={() => setExpandedId(isExpanded ? null : journey.id)}
                className="w-full flex items-start gap-3 p-3.5 text-left">
                <div className="size-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `${cfg.color}12`, border: `1px solid ${cfg.color}20` }}>
                  <Navigation className="size-5" style={{ color: cfg.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>{journey.employeeName}</p>
                    <div className="px-1.5 py-0.5 rounded" style={{ background: `${cfg.color}12`, border: `1px solid ${cfg.color}20` }}>
                      <span style={{ fontSize: 8, fontWeight: 800, color: cfg.color }}>{cfg.label.toUpperCase()}</span>
                    </div>
                  </div>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                    {journey.origin} → {journey.destination}
                  </p>
                  {/* Progress bar */}
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        className="h-full rounded-full"
                        style={{ background: cfg.color }}
                      />
                    </div>
                    <span style={{ fontSize: 10, color: cfg.color, fontWeight: 700 }}>{progress}%</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>
                      {journey.distanceCovered}/{journey.totalDistance} km
                    </span>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>&bull;</span>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>
                      {completedWaypoints}/{journey.waypoints.length} waypoints
                    </span>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>&bull;</span>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>
                      {journey.vehicleType}
                    </span>
                  </div>
                </div>
                <ChevronRight className="size-4 mt-1" style={{ color: "rgba(255,255,255,0.15)", transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.2s" }} />
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                    <div className="px-3.5 pb-3.5 space-y-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 10 }}>
                      {/* Current location */}
                      {journey.currentLocation && (
                        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
                          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                          <MapPin className="size-3" style={{ color: cfg.color }} />
                          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{journey.currentLocation}</span>
                        </div>
                      )}

                      {/* Waypoints timeline */}
                      <div className="relative pl-5">
                        <div className="absolute left-[9px] top-2 bottom-2 w-px"
                          style={{ background: "linear-gradient(180deg, rgba(0,200,224,0.2), rgba(0,200,224,0.05))" }} />
                        {journey.waypoints.map((wp, i) => {
                          const wpColor = wp.status === "arrived" ? "#00C853" : wp.status === "missed" ? "#FF2D55" : "rgba(255,255,255,0.15)";
                          return (
                            <div key={wp.id} className="relative flex items-center gap-2.5 mb-2.5">
                              <div className="absolute -left-5 size-5 rounded-full flex items-center justify-center"
                                style={{ background: `${wpColor}15`, border: `1px solid ${wpColor}30` }}>
                                {wp.status === "arrived" ? (
                                  <CheckCircle className="size-2.5" style={{ color: wpColor }} />
                                ) : wp.status === "missed" ? (
                                  <AlertTriangle className="size-2.5" style={{ color: wpColor }} />
                                ) : (
                                  <Circle className="size-2" style={{ color: wpColor }} />
                                )}
                              </div>
                              <div className="flex-1 flex items-center justify-between">
                                <div>
                                  <p style={{ fontSize: 11, fontWeight: 600, color: wp.status === "arrived" ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.7)" }}>{wp.name}</p>
                                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>
                                    ETA: {wp.eta.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                    {wp.arrivedAt && ` • Arrived: ${wp.arrivedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                                  </p>
                                </div>
                                {wp.status === "missed" && (
                                  <span style={{ fontSize: 8, fontWeight: 800, color: "#FF2D55" }}>MISSED</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Actions */}
                      {journey.status !== "completed" && (
                        <div className="flex gap-2">
                          <button className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl"
                            onClick={() => { hapticSuccess(); toast.success("Calling Driver", { description: `Initiating call to ${journey.employeeName}...` }); }}
                            style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.1)", cursor: "pointer" }}>
                            <Phone className="size-3" style={{ color: "#00C853" }} />
                            <span style={{ fontSize: 10, fontWeight: 600, color: "#00C853" }}>Call Driver</span>
                          </button>
                          <button className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl"
                            onClick={() => { hapticMedium(); toast.success("Live Tracking", { description: `Tracking ${journey.employeeName} on map — ${journey.currentLocation || "locating..."}` }); }}
                            style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.1)", cursor: "pointer" }}>
                            <Eye className="size-3" style={{ color: "#00C8E0" }} />
                            <span style={{ fontSize: 10, fontWeight: 600, color: "#00C8E0" }}>Track Live</span>
                          </button>
                          {(journey.status === "delayed" || journey.status === "deviated") && (
                            <>
                              <button className="flex items-center justify-center gap-1 px-3 py-2 rounded-xl"
                                onClick={() => { hapticWarning(); toast.success("Alert Sent", { description: `Safety alert sent to ${journey.employeeName} — ${journey.status === "deviated" ? "route deviation detected" : "journey delayed"}` }); }}
                                style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.1)", cursor: "pointer" }}>
                                <AlertTriangle className="size-3" style={{ color: "#FF2D55" }} />
                                <span style={{ fontSize: 10, fontWeight: 600, color: "#FF2D55" }}>Alert</span>
                              </button>
                              <button className="flex items-center justify-center gap-1 px-3 py-2 rounded-xl"
                                onClick={() => {
                                  hapticMedium();
                                  if (onGuideMe) {
                                    onGuideMe(journey.id, journey.employeeName);
                                  } else {
                                    toast("Guided Response", { description: `Opening step-by-step response guide for ${journey.employeeName}'s ${journey.status} journey` });
                                  }
                                }}
                                style={{
                                  background: "linear-gradient(135deg, rgba(0,200,224,0.08), rgba(0,200,224,0.04))",
                                  border: "1px solid rgba(0,200,224,0.15)",
                                  boxShadow: "0 0 8px rgba(0,200,224,0.08)",
                                  cursor: "pointer",
                                }}>
                                <Shield className="size-3" style={{ color: "#00C8E0" }} />
                                <span style={{ fontSize: 10, fontWeight: 600, color: "#00C8E0" }}>Guide Me</span>
                              </button>
                              <button className="flex items-center justify-center gap-1 px-3 py-2 rounded-xl"
                                onClick={() => handleLaunchSAR(journey)}
                                style={{
                                  background: "linear-gradient(135deg, rgba(255,45,85,0.08), rgba(255,45,85,0.04))",
                                  border: "1px solid rgba(255,45,85,0.15)",
                                  boxShadow: "0 0 8px rgba(255,45,85,0.08)",
                                  cursor: "pointer",
                                }}>
                                <Radar className="size-3" style={{ color: "#FF2D55" }} />
                                <span style={{ fontSize: 10, fontWeight: 600, color: "#FF2D55" }}>SAR</span>
                              </button>
                            </>
                          )}
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
    </div>
  );
}