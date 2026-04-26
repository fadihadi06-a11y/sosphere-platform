// ═══════════════════════════════════════════════════════════════
// SOSphere — Mission Tracker (Employee Mobile Side)
// Simple, clear flow: Ready → Depart → Arrive → Work → Return → Home
// GPS works OFFLINE — no excuses
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Navigation, MapPin, Clock, CheckCircle2, AlertTriangle,
  Shield, Play, Flag, Home, X, Zap, Timer,
  ArrowRight, Target, Wifi, WifiOff, Battery,
  BatteryLow, Locate, Radio, ChevronUp, ChevronDown,
  Phone, Send, Circle, XCircle, Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { hapticSuccess, hapticWarning, hapticMedium } from "./haptic-feedback";
import { getBatteryLevel } from "./offline-gps-tracker";
import {
  type Mission, type MissionStatus,
  getActiveMission, getMission, onMissionEvent,
  acceptMission, startMissionDeparture, arriveAtSite,
  startWorking, leaveSite, arriveHome,
  addGPSPoint, addHeartbeat, getMissionProgress,
  MISSION_STATUS_CONFIG, getAllMissions, seedDemoMissions,
} from "./mission-store";

// ── Helpers ───────────────────────────────────────────────────
function fmtDur(ms: number): string {
  if (ms < 0) return "—";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

const SC = MISSION_STATUS_CONFIG;

// ═══════════════════════════════════════════════════════════════
// MissionNotificationBanner — appears on home screen
// ═══════════════════════════════════════════════════════════════

export function MissionNotificationBanner({ employeeId, onOpen }: { employeeId: string; onOpen: () => void }) {
  const [mission, setMission] = useState<Mission | undefined>(undefined);

  useEffect(() => {
    seedDemoMissions(); // Ensure demo data exists
    const check = () => setMission(getActiveMission(employeeId));
    check();
    const interval = setInterval(check, 3000);
    const unsub = onMissionEvent(check);
    return () => { clearInterval(interval); unsub(); };
  }, [employeeId]);

  if (!mission) return null;
  const cfg = SC[mission.status];

  return (
    <motion.button
      initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
      onClick={onOpen}
      className="w-full rounded-2xl px-4 py-3 relative overflow-hidden text-left"
      style={{ background: `${cfg.color}08`, border: `1px solid ${cfg.color}18` }}
    >
      {/* Pulse for active states */}
      {["en_route_out", "en_route_back", "alert"].includes(mission.status) && (
        <motion.div animate={{ opacity: [0.05, 0.15, 0.05] }} transition={{ duration: 2, repeat: Infinity }}
          className="absolute inset-0" style={{ background: cfg.color }} />
      )}

      <div className="relative z-10 flex items-center gap-3">
        <div className="size-10 rounded-xl flex items-center justify-center" style={{ background: `${cfg.color}15`, border: `1px solid ${cfg.color}25` }}>
          <Navigation className="size-5" style={{ color: cfg.color }} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Active Mission</p>
            <div className="px-2 py-0.5 rounded-full" style={{ background: `${cfg.color}15`, border: `1px solid ${cfg.color}25` }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
            </div>
          </div>
          <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.4)" }}>
            {mission.destination.name} · Tap to open
          </p>
        </div>
        <ChevronUp className="size-4" style={{ color: "rgba(255,255,255,0.2)" }} />
      </div>
    </motion.button>
  );
}

// ═══════════════════════════════════════════════════════════════
// MissionTrackerScreen — Full mobile tracking interface
// ═══════════════════════════════════════════════════════════════

export function MissionTrackerScreen({ employeeId, onBack }: { employeeId: string; onBack: () => void }) {
  const [mission, setMission] = useState<Mission | undefined>(undefined);
  const [elapsed, setElapsed] = useState(0);
  const [simulating, setSimulating] = useState(false);
  const gpsInterval = useRef<any>(null);
  const hbInterval = useRef<any>(null);

  // Load mission
  useEffect(() => {
    const check = () => {
      const m = getActiveMission(employeeId);
      if (m) setMission({ ...m });
    };
    check();
    const unsub = onMissionEvent(check);
    const poll = setInterval(check, 2000);
    return () => { unsub(); clearInterval(poll); };
  }, [employeeId]);

  // Elapsed timer
  useEffect(() => {
    if (!mission || !mission.departedAt) return;
    const tick = () => setElapsed(Date.now() - mission.departedAt!);
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [mission?.departedAt]);

  // Simulate GPS tracking when active
  useEffect(() => {
    if (!mission) return;
    const isTracking = ["en_route_out", "en_route_back"].includes(mission.status);
    if (isTracking && !gpsInterval.current) {
      // Simulate GPS points every 5 seconds
      const lastTrack = mission.status === "en_route_back" ? mission.returnTrack : mission.gpsTrack;
      const lastPt = lastTrack[lastTrack.length - 1];
      let lat = lastPt?.lat || mission.origin.lat;
      let lng = lastPt?.lng || mission.origin.lng;
      const target = mission.status === "en_route_out" ? mission.destination : mission.returnTo;

      // Use real device GPS instead of simulated random positions
      const _gpsWatchId = navigator.geolocation
        ? navigator.geolocation.watchPosition(
            (pos) => {
              lat = pos.coords.latitude;
              lng = pos.coords.longitude;
              addGPSPoint(mission.id, {
                lat,
                lng,
                timestamp: Date.now(),
                speed: pos.coords.speed ?? 0,
                accuracy: pos.coords.accuracy,
                isOffline: !navigator.onLine,
              });
            },
            (err) => {
              console.warn("[MissionTracker] GPS error:", err.message);
              // Fallback: use last known position without random drift
              addGPSPoint(mission.id, {
                lat: lat || target.lat,
                lng: lng || target.lng,
                timestamp: Date.now(),
                speed: 0,
                accuracy: 9999,
                isOffline: true,
              });
            },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
          )
        : null;

      // Interval only for heartbeat-style updates when GPS watch is unavailable
      gpsInterval.current = setInterval(() => {
        if (_gpsWatchId !== null) return; // real GPS is active — skip interval
        // Deterministic movement toward target (no random noise)
        const dlat = (target.lat - lat) * 0.05;
        const dlng = (target.lng - lng) * 0.05;
        lat += dlat;
        lng += dlng;
        addGPSPoint(mission.id, {
          lat, lng,
          timestamp: Date.now(),
          speed: 0,
          accuracy: 9999,
          isOffline: !navigator.onLine,
        });
      }, 5000);

      // Cleanup GPS watch on unmount
      if (_gpsWatchId !== null) {
        const origClear = gpsInterval.current ? () => {
          clearInterval(gpsInterval.current!);
          navigator.geolocation.clearWatch(_gpsWatchId);
        } : () => navigator.geolocation.clearWatch(_gpsWatchId);
        // Store clearWatch in ref for cleanup
        (gpsInterval as any)._watchId = _gpsWatchId;
      }

      // Heartbeat every 10 seconds
      hbInterval.current = setInterval(() => {
        const currentMission = getMission(mission.id);
        const lastTrackNow = currentMission?.status === "en_route_back" ? currentMission.returnTrack : currentMission?.gpsTrack;
        const lastPtNow = lastTrackNow?.[lastTrackNow.length - 1];
        // Determine real internet status and battery
        const isOnline = navigator.onLine;
        // W3-50 (B-20, 2026-04-26): real battery from offline-gps-tracker
        // (which uses the Battery API). Pre-fix read sosphere_sync_data
        // which was never written; result was a fake decay from 90%.
        // Falls back to a conservative 50% if Battery API unavailable.
        const _bat = getBatteryLevel();
        const batteryEstimate = typeof _bat === "number"
          ? Math.round(_bat * 100)
          : 50;
        addHeartbeat(mission.id, {
          timestamp: Date.now(),
          gpsEnabled: !!navigator.geolocation,
          internetStatus: isOnline ? "4g" : "offline",
          batteryLevel: batteryEstimate,
          isAppForeground: !document.hidden,
          location: lastPtNow ? { lat: lastPtNow.lat, lng: lastPtNow.lng } : null,
          speed: lastPtNow?.speed || 0,
        });
      }, 10000);
    }

    if (!isTracking) {
      if (gpsInterval.current) { clearInterval(gpsInterval.current); gpsInterval.current = null; }
      if (hbInterval.current) { clearInterval(hbInterval.current); hbInterval.current = null; }
    }

    return () => {
      if (gpsInterval.current) { clearInterval(gpsInterval.current); gpsInterval.current = null; }
      if (hbInterval.current) { clearInterval(hbInterval.current); hbInterval.current = null; }
    };
  }, [mission?.status, mission?.id]);

  // Pre-flight check state
  const [preCheck, setPreCheck] = useState({ gps: false, battery: false, storage: false });

  const runPreCheck = useCallback(() => {
    setPreCheck({ gps: false, battery: false, storage: false });
    // Simulate checking
    setTimeout(() => setPreCheck(p => ({ ...p, gps: true })), 500);
    setTimeout(() => setPreCheck(p => ({ ...p, battery: true })), 1000);
    setTimeout(() => setPreCheck(p => ({ ...p, storage: true })), 1500);
  }, []);

  if (!mission) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20">
        <div className="size-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>
          <Navigation className="size-8" style={{ color: "rgba(0,200,224,0.3)" }} />
        </div>
        <p className="text-white mb-1" style={{ fontSize: 16, fontWeight: 700 }}>No Active Mission</p>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", textAlign: "center", maxWidth: 260 }}>
          When your admin assigns a mission, it will appear here.
        </p>
        <button onClick={onBack} className="mt-6 px-6 py-2.5 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.4)" }}>
          Go Back
        </button>
      </div>
    );
  }

  const cfg = SC[mission.status];
  const progress = getMissionProgress(mission);

  // ── Action Button Logic ────────────────────────────────────
  const getActionButton = (): { label: string; icon: any; color: string; disabled?: boolean; action: () => void } | null => {
    switch (mission.status) {
      case "created":
      case "notified":
        return {
          label: "Accept Mission",
          icon: CheckCircle2,
          color: "#34C759",
          action: () => {
            acceptMission(mission.id);
            runPreCheck();
            hapticSuccess();
            toast.success("Mission Accepted", { description: "Running pre-flight checks..." });
          },
        };
      case "ready":
        return {
          label: preCheck.gps && preCheck.battery && preCheck.storage ? "Start Mission" : "Checking...",
          icon: Play,
          color: "#00C8E0",
          disabled: !(preCheck.gps && preCheck.battery && preCheck.storage),
          action: () => {
            startMissionDeparture(mission.id);
            hapticSuccess();
            toast.success("Mission Started", { description: "GPS tracking is now active" });
          },
        };
      case "en_route_out":
        return {
          label: "Arrived at Site",
          icon: MapPin,
          color: "#00C853",
          action: () => {
            arriveAtSite(mission.id);
            hapticSuccess();
            toast.success("Arrival Confirmed", { description: `You are at ${mission.destination.name}` });
          },
        };
      case "arrived_site":
        return {
          label: "Start Working",
          icon: Wrench,
          color: "#7B5EFF",
          action: () => {
            startWorking(mission.id);
            hapticMedium();
            toast.success("Work Started", { description: "Timer is running" });
          },
        };
      case "working":
        return {
          label: "Work Complete — Return",
          icon: Home,
          color: "#FF9500",
          action: () => {
            leaveSite(mission.id);
            hapticSuccess();
            toast.success("Returning Home", { description: "Return tracking active" });
          },
        };
      case "en_route_back":
        return {
          label: "Arrived Home Safely",
          icon: CheckCircle2,
          color: "#00C853",
          action: () => {
            arriveHome(mission.id);
            hapticSuccess();
            toast.success("Mission Complete!", { description: "Well done — safe return confirmed" });
          },
        };
      default: return null;
    }
  };

  const action = getActionButton();

  return (
    <div className="px-4 py-2 space-y-3">
      {/* ── Header ──────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="size-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.04)" }}>
          <X className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
        </button>
        <div className="flex items-center gap-2">
          <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }} className="size-2 rounded-full" style={{ background: ["en_route_out", "en_route_back"].includes(mission.status) ? "#00C853" : cfg.color }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
        </div>
        <div className="px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: "rgba(255,255,255,0.3)" }}>{mission.id}</span>
        </div>
      </div>

      {/* ── Progress Ring ────────────────────────────────── */}
      <div className="flex flex-col items-center py-3">
        <div className="relative size-32">
          <svg viewBox="0 0 100 100" className="size-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="6" />
            <motion.circle
              cx="50" cy="50" r="42" fill="none"
              stroke={mission.status === "alert" ? "#FF2D55" : cfg.color}
              strokeWidth="6" strokeLinecap="round"
              strokeDasharray={`${progress * 2.64} ${264 - progress * 2.64}`}
              animate={{ strokeDasharray: `${progress * 2.64} ${264 - progress * 2.64}` }}
              transition={{ duration: 0.5 }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-white" style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{progress}%</p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 500, marginTop: 2 }}>
              {mission.departedAt ? fmtDur(elapsed) : "Not started"}
            </p>
          </div>
        </div>
      </div>

      {/* ── Route Summary ────────────────────────────────── */}
      <div className="rounded-2xl px-4 py-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-center gap-1">
            <Circle className="size-3" style={{ color: "#00C8E0" }} />
            <div className="w-0.5 h-6" style={{ background: `linear-gradient(${cfg.color}, rgba(255,255,255,0.05))` }} />
            <Target className="size-3" style={{ color: "#FF9500" }} />
            {["en_route_back", "completed"].includes(mission.status) && (
              <>
                <div className="w-0.5 h-6" style={{ background: `linear-gradient(#FF9500, #00C853)` }} />
                <Home className="size-3" style={{ color: "#00C853" }} />
              </>
            )}
          </div>
          <div className="flex-1 space-y-3">
            <div>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>From</p>
              <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{mission.origin.name}</p>
              {mission.departedAt && <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>Departed {fmtTime(mission.departedAt)}</p>}
            </div>
            <div>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>Destination</p>
              <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{mission.destination.name}</p>
              {mission.arrivedSiteAt && <p style={{ fontSize: 10, color: "#00C853" }}>Arrived {fmtTime(mission.arrivedSiteAt)}</p>}
            </div>
            {["en_route_back", "completed"].includes(mission.status) && (
              <div>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>Return to</p>
                <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{mission.returnTo.name}</p>
                {mission.arrivedHomeAt && <p style={{ fontSize: 10, color: "#00C853" }}>Arrived {fmtTime(mission.arrivedHomeAt)}</p>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Pre-Flight Check (only in ready state) ────────── */}
      <AnimatePresence>
        {mission.status === "ready" && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="rounded-2xl px-4 py-3 overflow-hidden"
            style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.1)" }}
          >
            <p className="mb-2.5" style={{ fontSize: 11, fontWeight: 700, color: "#00C8E0" }}>PRE-FLIGHT CHECK</p>
            {[
              { label: "GPS Signal", ok: preCheck.gps, icon: Locate },
              { label: "Battery > 30%", ok: preCheck.battery, icon: Battery },
              { label: "Storage Available", ok: preCheck.storage, icon: Shield },
            ].map(c => (
              <div key={c.label} className="flex items-center gap-3 py-1.5">
                <motion.div
                  animate={c.ok ? { scale: [0.8, 1.1, 1] } : {}}
                  className="size-5 rounded-full flex items-center justify-center"
                  style={{ background: c.ok ? "rgba(0,200,83,0.15)" : "rgba(255,255,255,0.05)" }}
                >
                  {c.ok ? <CheckCircle2 className="size-3" style={{ color: "#00C853" }} /> :
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="size-3 rounded-full border-2 border-t-transparent" style={{ borderColor: "rgba(0,200,224,0.3)", borderTopColor: "transparent" }} />
                  }
                </motion.div>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ok ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.3)" }}>
                  {c.label}
                </span>
              </div>
            ))}
            <p className="mt-2" style={{ fontSize: 10, color: "rgba(0,200,224,0.5)" }}>
              All checks must pass before starting the mission
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Live GPS Indicator (during tracking) ───────────── */}
      {["en_route_out", "en_route_back"].includes(mission.status) && (
        <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: "rgba(0,200,83,0.04)", border: "1px solid rgba(0,200,83,0.1)" }}>
          <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 2, repeat: Infinity }}>
            <Radio className="size-5" style={{ color: "#00C853" }} />
          </motion.div>
          <div className="flex-1">
            <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>GPS Tracking Active</p>
            <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.3)" }}>
              {mission.status === "en_route_out" ? `${mission.gpsTrack.length} points recorded` : `${mission.returnTrack.length} return points`}
              {mission.gpsTrack.filter(p => p.isOffline).length > 0 && ` · ${mission.gpsTrack.filter(p => p.isOffline).length} offline`}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1, repeat: Infinity }} className="size-2 rounded-full" style={{ background: "#00C853" }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: "#00C853" }}>LIVE</span>
          </div>
        </div>
      )}

      {/* ── Offline Mode Banner ────────────────────────────── */}
      {mission.heartbeats.length > 0 && mission.heartbeats[mission.heartbeats.length - 1]?.internetStatus === "offline" && (
        <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: "rgba(255,150,0,0.04)", border: "1px solid rgba(255,150,0,0.1)" }}>
          <WifiOff className="size-5" style={{ color: "#FF9500" }} />
          <div className="flex-1">
            <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>Offline Mode</p>
            <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.3)" }}>
              GPS still recording locally. Data will sync when connected.
            </p>
          </div>
        </div>
      )}

      {/* ── Working Timer (on-site) ────────────────────────── */}
      {["arrived_site", "working"].includes(mission.status) && (
        <div className="rounded-2xl px-4 py-4 text-center" style={{ background: "rgba(123,94,255,0.04)", border: "1px solid rgba(123,94,255,0.1)" }}>
          <Wrench className="size-6 mx-auto mb-2" style={{ color: "#7B5EFF" }} />
          <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>On Site — {mission.destination.name}</p>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
            {mission.workStartedAt
              ? `Working for ${fmtDur(Date.now() - mission.workStartedAt)}`
              : `Arrived ${mission.arrivedSiteAt ? fmtDur(Date.now() - mission.arrivedSiteAt) + " ago" : ""}`
            }
          </p>
        </div>
      )}

      {/* ── Completed Summary ──────────────────────────────── */}
      {mission.status === "completed" && (
        <div className="rounded-2xl px-4 py-4 text-center" style={{ background: "rgba(0,200,83,0.04)", border: "1px solid rgba(0,200,83,0.12)" }}>
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", damping: 12 }}>
            <CheckCircle2 className="size-10 mx-auto mb-2" style={{ color: "#00C853" }} />
          </motion.div>
          <p className="text-white" style={{ fontSize: 16, fontWeight: 800 }}>Mission Complete</p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
            Total time: {fmtDur((mission.completedAt || 0) - (mission.departedAt || 0))}
          </p>
          <div className="flex items-center justify-center gap-4 mt-3">
            <div className="text-center">
              <p className="text-white" style={{ fontSize: 18, fontWeight: 800 }}>{mission.gpsTrack.length + mission.returnTrack.length}</p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>GPS Points</p>
            </div>
            <div className="w-px h-8" style={{ background: "rgba(255,255,255,0.06)" }} />
            <div className="text-center">
              <p className="text-white" style={{ fontSize: 18, fontWeight: 800 }}>{mission.heartbeats.length}</p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>Heartbeats</p>
            </div>
          </div>
        </div>
      )}

      {/* ══ MAIN ACTION BUTTON ══════════════════════════════ */}
      {action && (
        <motion.button
          whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.97 }}
          onClick={action.action}
          disabled={action.disabled}
          className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl relative overflow-hidden"
          style={{
            background: action.disabled ? "rgba(255,255,255,0.03)" : `linear-gradient(135deg, ${action.color}, ${action.color}BB)`,
            border: `1px solid ${action.disabled ? "rgba(255,255,255,0.06)" : `${action.color}40`}`,
            opacity: action.disabled ? 0.5 : 1,
          }}
        >
          {!action.disabled && (
            <motion.div animate={{ x: [-200, 400] }} transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              className="absolute inset-y-0 w-20" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)" }} />
          )}
          <action.icon className="size-5 relative z-10" style={{ color: action.disabled ? "rgba(255,255,255,0.2)" : "#fff" }} />
          <span className="relative z-10" style={{ fontSize: 16, fontWeight: 800, color: action.disabled ? "rgba(255,255,255,0.2)" : "#fff", letterSpacing: "-0.02em" }}>
            {action.label}
          </span>
        </motion.button>
      )}

      {/* ── Phase Progress Dots ───────────────────────────── */}
      <div className="flex items-center justify-center gap-2 py-1">
        {["created", "ready", "en_route_out", "arrived_site", "working", "en_route_back", "completed"].map((phase, i) => {
          const isActive = mission.status === phase;
          const isDone = getMissionProgress(mission) > getMissionProgress({ ...mission, status: phase as MissionStatus });
          return (
            <motion.div
              key={phase}
              animate={isActive ? { scale: [1, 1.3, 1] } : {}}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="rounded-full"
              style={{
                width: isActive ? 20 : 6,
                height: 6,
                background: isActive ? cfg.color : isDone ? `${cfg.color}60` : "rgba(255,255,255,0.06)",
                borderRadius: 3,
                transition: "all 0.3s",
              }}
            />
          );
        })}
      </div>

      {/* ── Schedule Info ──────────────────────────────────── */}
      <div className="rounded-2xl px-4 py-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="size-3.5" style={{ color: "rgba(255,255,255,0.2)" }} />
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Scheduled</span>
          </div>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>
            {fmtTime(mission.scheduledStart)} — {fmtTime(mission.scheduledEnd)}
          </span>
        </div>
        {mission.notes && (
          <p className="mt-2 pt-2" style={{ fontSize: 11.5, color: "rgba(255,255,255,0.35)", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            {mission.notes}
          </p>
        )}
      </div>
    </div>
  );
}