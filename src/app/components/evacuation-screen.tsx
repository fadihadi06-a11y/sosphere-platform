// ═══════════════════════════════════════════════════════════════
// SOSphere — Employee Evacuation Screen
// Full-screen guided evacuation for field workers
// Shows: zone, reason, nearest assembly point, Google Maps link,
// step-by-step instructions, and 3-stage status flow.
// ═══════════════════════════════════════════════════════════════
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  AlertTriangle, MapPin, Navigation, CheckCircle2, Clock,
  Shield, ArrowLeft, ExternalLink, ChevronRight, Info,
  Footprints, Eye, Radio,
} from "lucide-react";
import {
  getActiveEvacuation,
  getEvacuationPointsByZone,
  updateEmployeeEvacuationStatus,
  onEvacuationChange,
  type ActiveEvacuation,
  type EvacuationPoint,
} from "./shared-store";

// Haversine distance
function calcDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

type EvacStatus = "notified" | "acknowledged" | "evacuating" | "arrived";

interface EvacuationScreenProps {
  employeeId?: string;
  employeeName?: string;
  currentZoneId?: string;
  currentLat?: number;
  currentLng?: number;
  onBack: () => void;
}

export function EvacuationScreen({
  employeeId = "EMP-001",
  employeeName = "Ahmed Khalil",
  currentZoneId = "Z-A",
  currentLat = 24.7136,
  currentLng = 46.6753,
  onBack,
}: EvacuationScreenProps) {
  const [evacuation, setEvacuation] = useState<ActiveEvacuation | null>(null);
  const [points, setPoints] = useState<EvacuationPoint[]>([]);
  const [nearestPoint, setNearestPoint] = useState<EvacuationPoint | null>(null);
  const [distance, setDistance] = useState(0);
  const [status, setStatus] = useState<EvacStatus>("notified");
  const [elapsed, setElapsed] = useState(0);
  const [step, setStep] = useState(0); // animated instruction step

  useEffect(() => {
    loadEvacuation();
    const unsub = onEvacuationChange(loadEvacuation);
    return unsub;
  }, []);

  useEffect(() => {
    if (!evacuation) return;
    const i = setInterval(() => setElapsed(Math.floor((Date.now() - evacuation.triggeredAt) / 1000)), 1000);
    return () => clearInterval(i);
  }, [evacuation]);

  // Cycle through instruction steps
  useEffect(() => {
    if (status !== "evacuating") return;
    const i = setInterval(() => setStep(s => (s + 1) % STEPS.length), 3500);
    return () => clearInterval(i);
  }, [status]);

  const loadEvacuation = () => {
    const active = getActiveEvacuation();
    setEvacuation(active);
    if (!active || active.status !== "active") return;

    // Try zone-specific points first, fall back to all points
    let pts = getEvacuationPointsByZone(active.zoneId);
    if (pts.length === 0) pts = getEvacuationPointsByZone(currentZoneId);
    setPoints(pts);

    if (pts.length > 0) {
      const nearest = pts.reduce((best, pt) => {
        const d = calcDistance(currentLat, currentLng, pt.lat, pt.lng);
        return d < calcDistance(currentLat, currentLng, best.lat, best.lng) ? pt : best;
      }, pts[0]);
      setNearestPoint(nearest);
      setDistance(Math.round(calcDistance(currentLat, currentLng, nearest.lat, nearest.lng)));
    }

    // Auto-acknowledge
    updateEmployeeEvacuationStatus({
      employeeId, employeeName, evacuationId: active.id,
      status: "acknowledged", acknowledgedAt: Date.now(),
      currentLat, currentLng,
    });
    setStatus("acknowledged");
  };

  const handleStartEvacuation = () => {
    if (!evacuation) return;
    setStatus("evacuating");
    setStep(0);
    updateEmployeeEvacuationStatus({
      employeeId, employeeName, evacuationId: evacuation.id,
      status: "evacuating", acknowledgedAt: Date.now(),
      currentLat, currentLng,
      targetPointId: nearestPoint?.id,
    });
  };

  const handleConfirmArrival = () => {
    if (!evacuation) return;
    setStatus("arrived");
    updateEmployeeEvacuationStatus({
      employeeId, employeeName, evacuationId: evacuation.id,
      status: "arrived", acknowledgedAt: Date.now(), arrivedAt: Date.now(),
      currentLat, currentLng, targetPointId: nearestPoint?.id,
    });
  };

  // ── No active evacuation ────────────────────────────────────
  if (!evacuation || evacuation.status !== "active") {
    return (
      <div className="h-full flex flex-col" style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}>
        <div className="flex items-center gap-3 p-4 pt-6">
          <button onClick={onBack}
            className="size-10 rounded-full flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.06)" }}>
            <ArrowLeft className="size-5" style={{ color: "rgba(255,255,255,0.6)" }} />
          </button>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#FFFFFF" }}>Emergency Evacuation</h1>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
          <div className="size-20 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>
            <Shield className="size-10" style={{ color: "rgba(0,200,224,0.4)" }} />
          </div>
          <p style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.5)", textAlign: "center" }}>
            No Active Evacuation
          </p>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", textAlign: "center", maxWidth: 240 }}>
            You will receive an automatic full-screen alert if an evacuation is declared for your zone.
          </p>

          {/* Info about the system */}
          <div className="mt-4 p-4 rounded-2xl w-full"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.4)", marginBottom: 10 }}>
              WHAT HAPPENS DURING EVACUATION
            </p>
            {[
              { icon: "🚨", text: "You receive an instant full-screen alert" },
              { icon: "📍", text: "Nearest assembly point is shown automatically" },
              { icon: "🗺️", text: "Google Maps link guides you there" },
              { icon: "✅", text: "Confirm arrival to mark yourself safe" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3 mb-2">
                <span style={{ fontSize: 16 }}>{item.icon}</span>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const mapsUrl = nearestPoint
    ? `https://maps.google.com/?q=${nearestPoint.lat},${nearestPoint.lng}&navigate=yes`
    : null;

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}>
      {/* ── Pulsing Header ─────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex-shrink-0 px-4 pt-6 pb-3"
        style={{
          background: "linear-gradient(180deg, rgba(255,45,85,0.2) 0%, rgba(255,45,85,0.0) 100%)",
        }}
      >
        <div className="flex items-center gap-3">
          <button onClick={onBack}
            className="size-9 rounded-full flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.06)" }}>
            <ArrowLeft className="size-4" style={{ color: "rgba(255,255,255,0.5)" }} />
          </button>
          <motion.div
            animate={{ opacity: [1, 0.4, 1] }}
            transition={{ duration: 0.8, repeat: Infinity }}
            className="size-2.5 rounded-full flex-shrink-0"
            style={{ background: "#FF2D55", boxShadow: "0 0 8px rgba(255,45,85,0.8)" }}
          />
          <p style={{ fontSize: 16, fontWeight: 800, color: "#FF2D55", letterSpacing: "-0.3px" }}>
            EVACUATION ALERT
          </p>
          <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full"
            style={{ background: "rgba(255,45,85,0.12)", border: "1px solid rgba(255,45,85,0.25)" }}>
            <Clock className="size-3" style={{ color: "#FF2D55" }} />
            <span style={{ fontSize: 11, fontWeight: 800, color: "#FF2D55", fontVariantNumeric: "tabular-nums" }}>
              {fmtTime(elapsed)}
            </span>
          </div>
        </div>
      </motion.div>

      {/* ── Scrollable Content ─────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3" style={{ scrollbarWidth: "none" }}>

        {/* Alert Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="p-4 rounded-2xl"
          style={{
            background: "linear-gradient(135deg, rgba(255,45,85,0.18) 0%, rgba(199,0,76,0.08) 100%)",
            border: "2px solid rgba(255,45,85,0.35)",
          }}
        >
          <div className="flex items-start gap-3">
            <motion.div
              animate={{ rotate: [0, 8, -8, 0] }}
              transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 2 }}
            >
              <AlertTriangle className="size-8" style={{ color: "#FF2D55" }} />
            </motion.div>
            <div className="flex-1">
              <p style={{ fontSize: 15, fontWeight: 800, color: "#FF2D55" }}>EVACUATE NOW</p>
              <p style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 3 }}>{evacuation.zoneName}</p>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", marginTop: 3 }}>{evacuation.reason}</p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 6 }}>
                Ordered by {evacuation.triggeredBy} at {new Date(evacuation.triggeredAt).toLocaleTimeString()}
              </p>
            </div>
          </div>
        </motion.div>

        {/* 3-Step Progress */}
        <StepProgress status={status} />

        {/* Nearest Assembly Point */}
        {nearestPoint ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="p-4 rounded-2xl"
            style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.2)" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="size-4" style={{ color: "#00C8E0" }} />
              <p style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.5px" }}>
                NEAREST ASSEMBLY POINT
              </p>
            </div>
            <p style={{ fontSize: 17, fontWeight: 800, color: "#00C8E0", marginBottom: 4 }}>{nearestPoint.name}</p>
            {nearestPoint.description && (
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginBottom: 8 }}>{nearestPoint.description}</p>
            )}

            {/* Distance + Coords */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Navigation className="size-4" style={{ color: "#00C8E0" }} />
                <span style={{ fontSize: 14, fontWeight: 800, color: "#00C8E0" }}>
                  {distance > 0 ? `~${distance}m away` : "Assembly Point"}
                </span>
              </div>
              {nearestPoint.capacity && (
                <span className="px-2.5 py-1 rounded-lg"
                  style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.04)" }}>
                  Cap: {nearestPoint.capacity}
                </span>
              )}
            </div>

            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginBottom: 10 }}>
              📍 {nearestPoint.lat.toFixed(5)}, {nearestPoint.lng.toFixed(5)}
            </p>

            {/* Mini Map Visual */}
            <MiniMapVisual status={status} />

            {/* Google Maps Button */}
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex items-center justify-center gap-2 py-2.5 rounded-xl w-full"
                style={{
                  background: "rgba(0,200,224,0.12)",
                  border: "1px solid rgba(0,200,224,0.3)",
                  color: "#00C8E0", fontSize: 13, fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                <ExternalLink className="size-4" />
                Open in Google Maps
              </a>
            )}
          </motion.div>
        ) : (
          <div className="p-4 rounded-2xl"
            style={{ background: "rgba(255,149,0,0.08)", border: "1px solid rgba(255,149,0,0.2)" }}>
            <div className="flex items-start gap-3">
              <Info className="size-5 flex-shrink-0" style={{ color: "#FF9500" }} />
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#FF9500" }}>No Assembly Point Configured</p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
                  Contact your supervisor for evacuation directions. Follow emergency signage.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Step-by-step Instructions */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-4 rounded-2xl"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Footprints className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
            <p style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px" }}>
              STEP-BY-STEP INSTRUCTIONS
            </p>
          </div>
          {STEPS.map((step, i) => (
            <div key={i} className="flex items-start gap-3 mb-2.5">
              <div className="size-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)" }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: "#00C8E0" }}>{i + 1}</span>
              </div>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>{step}</p>
            </div>
          ))}
        </motion.div>
      </div>

      {/* ── Fixed Bottom Action ────────────────────────────── */}
      <div className="flex-shrink-0 px-4 pb-6 pt-3"
        style={{ background: "linear-gradient(0deg, #05070E 70%, transparent 100%)" }}>
        <AnimatePresence mode="wait">
          {status === "acknowledged" && (
            <motion.button
              key="start"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleStartEvacuation}
              className="w-full py-4 rounded-2xl flex items-center justify-center gap-2"
              style={{
                background: "linear-gradient(135deg, #00C8E0 0%, #0088A0 100%)",
                color: "#fff", fontSize: 16, fontWeight: 800,
                boxShadow: "0 6px 24px rgba(0,200,224,0.35)",
              }}
            >
              <Navigation className="size-5" />
              Start Evacuation
              <ChevronRight className="size-5" />
            </motion.button>
          )}

          {status === "evacuating" && (
            <motion.div
              key="evacuating"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-3"
            >
              {/* Animated status */}
              <div className="flex items-center justify-center gap-3 py-2 rounded-xl"
                style={{ background: "rgba(255,149,0,0.08)", border: "1px solid rgba(255,149,0,0.2)" }}>
                <motion.div
                  animate={{ x: [0, 4, 0] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                >
                  <Navigation className="size-5" style={{ color: "#FF9500" }} />
                </motion.div>
                <p style={{ fontSize: 14, fontWeight: 700, color: "#FF9500" }}>
                  Evacuating → {nearestPoint?.name || "Assembly Point"}
                </p>
              </div>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleConfirmArrival}
                className="w-full py-4 rounded-2xl flex items-center justify-center gap-2"
                style={{
                  background: "linear-gradient(135deg, #00C853 0%, #009940 100%)",
                  color: "#fff", fontSize: 16, fontWeight: 800,
                  boxShadow: "0 6px 24px rgba(0,200,83,0.3)",
                }}
              >
                <CheckCircle2 className="size-5" />
                I've Arrived — I'm Safe
              </motion.button>
            </motion.div>
          )}

          {status === "arrived" && (
            <motion.div
              key="arrived"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="py-5 rounded-2xl text-center"
              style={{ background: "rgba(0,200,83,0.1)", border: "1.5px solid rgba(0,200,83,0.3)" }}
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 250, damping: 20 }}
              >
                <CheckCircle2 className="size-12 mx-auto mb-2" style={{ color: "#00C853" }} />
              </motion.div>
              <p style={{ fontSize: 18, fontWeight: 800, color: "#00C853" }}>You're Safe</p>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
                Your status has been reported to the admin. Remain at the assembly point until the all-clear signal.
              </p>
              <div className="flex items-center justify-center gap-2 mt-3">
                <Radio className="size-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                  Stay tuned for admin updates
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── 3-Step Progress Bar ─────────────────────────────────────────
function StepProgress({ status }: { status: EvacStatus }) {
  const steps = [
    { id: "acknowledged", label: "Alert Received", icon: Eye },
    { id: "evacuating",   label: "Evacuating",     icon: Navigation },
    { id: "arrived",      label: "Safe",            icon: CheckCircle2 },
  ];
  const currentIndex = status === "notified" || status === "acknowledged" ? 0
    : status === "evacuating" ? 1 : 2;

  return (
    <div className="flex items-center gap-0 px-1">
      {steps.map((s, i) => {
        const Icon = s.icon;
        const done = i < currentIndex;
        const active = i === currentIndex;
        const color = done ? "#00C853" : active ? "#00C8E0" : "rgba(255,255,255,0.15)";
        return (
          <div key={s.id} className="flex-1 flex flex-col items-center gap-1.5">
            {/* Line before */}
            {i === 0 ? null : (
              <div className="absolute" style={{ display: "none" }} />
            )}
            <div className="relative w-full flex items-center">
              {i > 0 && (
                <div className="flex-1 h-0.5 rounded-full"
                  style={{ background: done ? "#00C853" : "rgba(255,255,255,0.08)" }} />
              )}
              <motion.div
                animate={active ? { scale: [1, 1.1, 1] } : {}}
                transition={{ duration: 1.2, repeat: Infinity }}
                className="size-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{
                  background: done ? "rgba(0,200,83,0.15)" : active ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.04)",
                  border: `1.5px solid ${color}`,
                }}
              >
                <Icon className="size-3.5" style={{ color }} />
              </motion.div>
              {i < steps.length - 1 && (
                <div className="flex-1 h-0.5 rounded-full"
                  style={{ background: done ? "#00C853" : "rgba(255,255,255,0.08)" }} />
              )}
            </div>
            <p style={{ fontSize: 9, fontWeight: 700, color, letterSpacing: "0.4px", textAlign: "center" }}>
              {s.label.toUpperCase()}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ── Mini Map Visual ─────────────────────────────────────────────
function MiniMapVisual({ status }: { status: EvacStatus }) {
  const progress = status === "arrived" ? 1 : status === "evacuating" ? 0.6 : 0.15;
  return (
    <div className="h-28 rounded-xl relative overflow-hidden"
      style={{ background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.12)" }}>
      {/* Grid */}
      <svg className="absolute inset-0 w-full h-full opacity-10">
        {[...Array(6)].map((_, i) => (
          <line key={`v${i}`} x1={`${i * 20}%`} y1="0" x2={`${i * 20}%`} y2="100%"
            stroke="rgba(0,200,224,0.5)" strokeWidth="0.5" />
        ))}
        {[...Array(5)].map((_, i) => (
          <line key={`h${i}`} x1="0" y1={`${i * 25}%`} x2="100%" y2={`${i * 25}%`}
            stroke="rgba(0,200,224,0.5)" strokeWidth="0.5" />
        ))}
      </svg>

      {/* Dashed route line */}
      <svg className="absolute inset-0 w-full h-full">
        <motion.line
          x1="25%" y1="65%"
          x2="75%" y2="35%"
          stroke="#00C8E0"
          strokeWidth="2"
          strokeDasharray="6,4"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: progress }}
          transition={{ duration: 1.5, ease: "easeOut" }}
        />
      </svg>

      {/* Employee dot (pulsing) */}
      <motion.div
        animate={{ scale: [1, 1.3, 1] }}
        transition={{ duration: 1.5, repeat: Infinity }}
        className="absolute rounded-full"
        style={{
          width: 12, height: 12,
          background: "#FF2D55",
          boxShadow: "0 0 12px rgba(255,45,85,0.6)",
          left: `${25 + progress * 35}%`,
          top: `${65 - progress * 30}%`,
          transform: "translate(-50%, -50%)",
        }}
      />

      {/* Assembly point icon */}
      <div className="absolute" style={{ right: "20%", top: "25%", transform: "translate(50%, -50%)" }}>
        <motion.div
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="size-7 rounded-full flex items-center justify-center"
          style={{ background: "rgba(0,200,224,0.2)", border: "2px solid #00C8E0" }}>
          <Shield className="size-3.5" style={{ color: "#00C8E0" }} />
        </motion.div>
      </div>

      {/* Labels */}
      <div className="absolute bottom-1.5 left-3 flex items-center gap-1">
        <div className="size-2 rounded-full" style={{ background: "#FF2D55" }} />
        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>YOU</span>
      </div>
      <div className="absolute top-1.5 right-3 flex items-center gap-1">
        <span style={{ fontSize: 8, color: "rgba(0,200,224,0.7)", fontWeight: 600 }}>ASSEMBLY</span>
        <div className="size-2 rounded-full" style={{ background: "#00C8E0" }} />
      </div>
    </div>
  );
}

const STEPS = [
  "Stay calm. Do not run or panic.",
  "Leave all non-essential belongings behind.",
  "Do NOT use elevators — use stairs or emergency exits only.",
  "Proceed to the nearest assembly point shown above.",
  "Help colleagues who need assistance.",
  "Report to your supervisor once you reach the assembly point.",
  "Do not re-enter the building until the all-clear signal is given.",
];

// ── Auto Evacuation Overlay (rendered ON TOP of mobile app) ─────
// This component sits at the top of MobileApp and auto-shows
// when an active evacuation is detected.
interface EvacuationOverlayProps {
  employeeId?: string;
  employeeName?: string;
  currentZoneId?: string;
}

export function EvacuationAlertOverlay({
  employeeId = "EMP-001",
  employeeName = "Ahmed Khalil",
  currentZoneId = "Z-A",
}: EvacuationOverlayProps) {
  const [evacuation, setEvacuation] = useState<ActiveEvacuation | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const prevEvacId = useRef<string | null>(null);

  useEffect(() => {
    const check = () => {
      const active = getActiveEvacuation();
      if (active?.status === "active") {
        // Reset dismissed if it's a NEW evacuation
        if (active.id !== prevEvacId.current) {
          prevEvacId.current = active.id;
          setDismissed(false);
        }
        setEvacuation(active);
      } else {
        setEvacuation(null);
      }
    };
    check();
    const unsub = onEvacuationChange(check);
    return unsub;
  }, []);

  const shouldShow = evacuation?.status === "active" && !dismissed;

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="absolute inset-0 z-40"
          style={{ fontFamily: "'Outfit', sans-serif" }}
        >
          <EvacuationScreen
            employeeId={employeeId}
            employeeName={employeeName}
            currentZoneId={currentZoneId}
            onBack={() => setDismissed(true)}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
