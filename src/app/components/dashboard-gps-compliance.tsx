import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Satellite, AlertTriangle, CheckCircle2, WifiOff, RefreshCw, Clock, DollarSign, Shield, Navigation, Target, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, Eye } from "lucide-react";
// ═══════════════════════════════════════════════════════════════
// GPS Zone Compliance Monitor
// Auto-checks every 15 min (demo: 15s) if employees are in zones
// Uses Haversine formula on raw GPS coordinates — $0 cost
// ═══════════════════════════════════════════════════════════════

const STATUS_CONFIG = {
  "in-zone": { label: "In Zone", color: "#00C853", bg: "rgba(0,200,83,0.08)", border: "rgba(0,200,83,0.15)", icon: CheckCircle2 },
  "out-of-zone": { label: "Out of Zone", color: "#FF2D55", bg: "rgba(255,45,85,0.08)", border: "rgba(255,45,85,0.15)", icon: AlertTriangle },
  "no-zone": { label: "Unassigned", color: "#FF9500", bg: "rgba(255,150,0,0.08)", border: "rgba(255,150,0,0.15)", icon: Minus },
  "offline": { label: "Offline", color: "rgba(255,255,255,0.2)", bg: "rgba(255,255,255,0.02)", border: "rgba(255,255,255,0.06)", icon: WifiOff },
};

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
}

function fmtTimeShort(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "Just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ── Compliance Ring ───────────────────────────────────────────
function ComplianceRing({ percent, size = 120 }: { percent: number; size?: number }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const color = percent >= 80 ? "#00C853" : percent >= 50 ? "#FF9500" : "#FF2D55";

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="6" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ * (1 - percent / 100) }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          style={{ filter: `drop-shadow(0 0 6px ${color}40)` }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span style={{ fontSize: 28, fontWeight: 900, color, letterSpacing: "-1px" }}>{percent}%</span>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", fontWeight: 600, letterSpacing: "0.5px" }}>COMPLIANCE</span>
      </div>
    </div>
  );
}

// ── Employee Row ──────────────────────────────────────────────
function EmployeeRow({ snapshot }: { snapshot: EmployeeGPSSnapshot }) {
  const config = STATUS_CONFIG[snapshot.status];
  const Icon = config.icon;
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="transition-all"
      style={{
        borderRadius: 12,
        background: config.bg,
        border: `1px solid ${config.border}`,
        marginBottom: 6,
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3.5 py-2.5"
      >
        <div
          className="size-8 rounded-full flex items-center justify-center shrink-0"
          style={{ background: `${config.color}15`, border: `1px solid ${config.color}25` }}
        >
          <Icon style={{ width: 14, height: 14, color: config.color }} />
        </div>

        <div className="flex-1 text-left min-w-0">
          <p className="truncate" style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
            {snapshot.employeeName}
          </p>
          <p className="truncate" style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
            {snapshot.assignedZoneName || "No zone assigned"}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {snapshot.distanceMeters !== null && (
            <span style={{ fontSize: 11, fontWeight: 700, color: config.color, fontVariantNumeric: "tabular-nums" }}>
              {snapshot.distanceMeters > 999 ? `${(snapshot.distanceMeters / 1000).toFixed(1)}km` : `${snapshot.distanceMeters}m`}
            </span>
          )}
          <div
            className="px-2 py-0.5 rounded-full"
            style={{ background: `${config.color}12`, border: `1px solid ${config.color}20` }}
          >
            <span style={{ fontSize: 9, fontWeight: 700, color: config.color, letterSpacing: "0.3px" }}>
              {config.label.toUpperCase()}
            </span>
          </div>
          {expanded ? (
            <ChevronUp style={{ width: 12, height: 12, color: "rgba(255,255,255,0.15)" }} />
          ) : (
            <ChevronDown style={{ width: 12, height: 12, color: "rgba(255,255,255,0.15)" }} />
          )}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3.5 pb-3 pt-1 border-t" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
              <div className="grid grid-cols-2 gap-2">
                {snapshot.status !== "offline" && (
                  <>
                    <div className="px-2.5 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
                      <p style={{ fontSize: 8, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", marginBottom: 2 }}>GPS POSITION</p>
                      <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontVariantNumeric: "tabular-nums" }}>
                        {snapshot.currentLat.toFixed(6)}, {snapshot.currentLng.toFixed(6)}
                      </p>
                    </div>
                    {snapshot.zoneCenterLat && (
                      <div className="px-2.5 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
                        <p style={{ fontSize: 8, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", marginBottom: 2 }}>ZONE CENTER</p>
                        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontVariantNumeric: "tabular-nums" }}>
                          {snapshot.zoneCenterLat.toFixed(6)}, {snapshot.zoneCenterLng!.toFixed(6)}
                        </p>
                      </div>
                    )}
                    {snapshot.zoneRadiusMeters && (
                      <div className="px-2.5 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
                        <p style={{ fontSize: 8, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", marginBottom: 2 }}>ZONE RADIUS</p>
                        <p style={{ fontSize: 10, color: "rgba(0,200,224,0.5)", fontWeight: 600 }}>
                          {snapshot.zoneRadiusMeters}m
                        </p>
                      </div>
                    )}
                    {snapshot.distanceMeters !== null && (
                      <div className="px-2.5 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
                        <p style={{ fontSize: 8, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px", marginBottom: 2 }}>DISTANCE FROM CENTER</p>
                        <p style={{ fontSize: 10, color: config.color, fontWeight: 700 }}>
                          {snapshot.distanceMeters}m {snapshot.status === "in-zone" ? "inside" : "outside"}
                        </p>
                      </div>
                    )}
                  </>
                )}
                {snapshot.status === "offline" && (
                  <div className="col-span-2 px-2.5 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>
                      Employee is off-shift — no GPS data available
                    </p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main GPS Compliance Page
// ═══════════════════════════════════════════════════════════════
export function GPSCompliancePage({ t, webMode = false }: { t?: (k: string) => string; webMode?: boolean }) {
  const [result, setResult] = useState<ComplianceCheckResult | null>(getLatestCompliance);
  const [history, setHistory] = useState<ComplianceCheckResult[]>(getComplianceHistory);
  const [countdown, setCountdown] = useState(GPS_CHECK_INTERVAL_DEMO);
  const [isChecking, setIsChecking] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [filter, setFilter] = useState<"all" | "in-zone" | "out-of-zone" | "offline">("all");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const performCheck = useCallback(() => {
    setIsChecking(true);
    // Simulate 1s GPS acquisition delay
    setTimeout(() => {
      const r = runComplianceCheck();
      setResult(r);
      setHistory(getComplianceHistory());
      setCountdown(GPS_CHECK_INTERVAL_DEMO);
      setIsChecking(false);
      // Auto-broadcast out-of-zone employees to Broadcast Center
      r.snapshots
        .filter(s => s.status === "out-of-zone" && s.distanceMeters !== null)
        .forEach(s => {
          autoBroadcastOutOfZone(s.employeeName, s.assignedZoneName || "Unknown", s.distanceMeters!);
        });
    }, 800);
  }, []);

  // Auto-check interval
  useEffect(() => {
    if (!autoEnabled) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      return;
    }

    // Run initial check
    if (!result) performCheck();

    // Countdown timer
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          performCheck();
          return GPS_CHECK_INTERVAL_DEMO;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoEnabled, performCheck, result]);

  // Listen for cross-tab updates
  useEffect(() => {
    return onComplianceUpdate((r) => {
      setResult(r);
      setHistory(getComplianceHistory());
    });
  }, []);

  const filteredSnapshots = result?.snapshots.filter(s => {
    if (filter === "all") return true;
    return s.status === filter;
  }) || [];

  // Trend calculation
  const prevCheck = history.length > 1 ? history[1] : null;
  const trend = result && prevCheck ? result.compliancePercent - prevCheck.compliancePercent : 0;

  return (
    <div className="h-full overflow-y-auto" style={{ scrollbarWidth: "none" }}>
      <div className="p-6 max-w-[1200px] mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Satellite style={{ width: 22, height: 22, color: "#00C8E0" }} />
              <h1 style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px" }}>
                GPS Zone Compliance
              </h1>
            </div>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>
              Automatic position check every 15 minutes (Demo: {GPS_CHECK_INTERVAL_DEMO}s)
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Cost badge */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.12)" }}>
              <DollarSign style={{ width: 12, height: 12, color: "#00C853" }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "#00C853" }}>$0 GPS Cost</span>
            </div>

            {/* Auto toggle */}
            <button
              onClick={() => setAutoEnabled(!autoEnabled)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all"
              style={{
                background: autoEnabled ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${autoEnabled ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.06)"}`,
              }}
            >
              <div
                className="relative w-8 h-4 rounded-full transition-all"
                style={{ background: autoEnabled ? "rgba(0,200,224,0.3)" : "rgba(255,255,255,0.1)" }}
              >
                <motion.div
                  className="absolute top-0.5 w-3 h-3 rounded-full"
                  animate={{ left: autoEnabled ? 18 : 2 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  style={{ background: autoEnabled ? "#00C8E0" : "rgba(255,255,255,0.3)" }}
                />
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: autoEnabled ? "#00C8E0" : "rgba(255,255,255,0.3)" }}>
                Auto-Check
              </span>
            </button>

            {/* Manual check */}
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={performCheck}
              disabled={isChecking}
              className="flex items-center gap-2 px-4 py-2 rounded-lg"
              style={{
                background: "linear-gradient(135deg, #00C8E0, #0088A0)",
                color: "#fff", fontSize: 12, fontWeight: 700,
                opacity: isChecking ? 0.6 : 1,
                boxShadow: "0 4px 16px rgba(0,200,224,0.2)",
              }}
            >
              <motion.div animate={isChecking ? { rotate: 360 } : {}} transition={{ duration: 1, repeat: isChecking ? Infinity : 0, ease: "linear" }}>
                <RefreshCw style={{ width: 14, height: 14 }} />
              </motion.div>
              {isChecking ? "Scanning..." : "Check Now"}
            </motion.button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-5 gap-4 mb-6">
          {/* Compliance Ring */}
          <div
            className="col-span-1 flex flex-col items-center justify-center py-4"
            style={{ borderRadius: 16, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
          >
            <ComplianceRing percent={result?.compliancePercent || 0} size={110} />
            {trend !== 0 && (
              <div className="flex items-center gap-1 mt-2">
                {trend > 0 ? (
                  <TrendingUp style={{ width: 12, height: 12, color: "#00C853" }} />
                ) : (
                  <TrendingDown style={{ width: 12, height: 12, color: "#FF2D55" }} />
                )}
                <span style={{ fontSize: 10, fontWeight: 700, color: trend > 0 ? "#00C853" : "#FF2D55" }}>
                  {trend > 0 ? "+" : ""}{trend}% vs last check
                </span>
              </div>
            )}
          </div>

          {/* Stat cards */}
          {[
            { label: "In Zone", value: result?.inZone || 0, icon: CheckCircle2, color: "#00C853" },
            { label: "Out of Zone", value: result?.outOfZone || 0, icon: AlertTriangle, color: "#FF2D55" },
            { label: "Unassigned", value: result?.noZone || 0, icon: Target, color: "#FF9500" },
            { label: "Offline", value: result?.offline || 0, icon: WifiOff, color: "rgba(255,255,255,0.2)" },
          ].map((stat) => {
            const SIcon = stat.icon;
            return (
              <div
                key={stat.label}
                className="flex flex-col items-center justify-center py-5"
                style={{
                  borderRadius: 16,
                  background: `${stat.color}06`,
                  border: `1px solid ${stat.color}12`,
                }}
              >
                <SIcon style={{ width: 20, height: 20, color: stat.color, marginBottom: 8 }} />
                <span style={{ fontSize: 28, fontWeight: 900, color: stat.color, letterSpacing: "-1px" }}>
                  {stat.value}
                </span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontWeight: 600, marginTop: 2, letterSpacing: "0.3px" }}>
                  {stat.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Timer bar + Cost Breakdown */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          {/* Next check countdown */}
          <div
            className="flex items-center gap-4 px-5 py-4"
            style={{ borderRadius: 14, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
          >
            <div className="flex items-center gap-2 flex-1">
              <Clock style={{ width: 16, height: 16, color: autoEnabled ? "#00C8E0" : "rgba(255,255,255,0.15)" }} />
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: autoEnabled ? "#fff" : "rgba(255,255,255,0.3)" }}>
                  Next Check
                </p>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>
                  {autoEnabled ? `in ${countdown}s (demo)` : "Auto-check disabled"}
                </p>
              </div>
            </div>
            {autoEnabled && (
              <div className="flex-1">
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "linear-gradient(90deg, #00C8E0, #0088A0)" }}
                    animate={{ width: `${((GPS_CHECK_INTERVAL_DEMO - countdown) / GPS_CHECK_INTERVAL_DEMO) * 100}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </div>
            )}
            {result && (
              <div className="text-right">
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.15)" }}>Last check</p>
                <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(0,200,224,0.6)" }}>
                  {fmtTime(result.timestamp)}
                </p>
              </div>
            )}
          </div>

          {/* Cost Breakdown */}
          <div
            className="flex items-center gap-4 px-5 py-4"
            style={{ borderRadius: 14, background: "rgba(0,200,83,0.03)", border: "1px solid rgba(0,200,83,0.08)" }}
          >
            <Shield style={{ width: 18, height: 18, color: "#00C853", flexShrink: 0 }} />
            <div className="flex-1 min-w-0">
              <p style={{ fontSize: 12, fontWeight: 700, color: "#00C853" }}>Zero Cost GPS Tracking</p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", lineHeight: 1.5, marginTop: 2 }}>
                Device GPS = free | Haversine formula = no API calls | 96 checks/day/employee = $0
              </p>
            </div>
            <div className="text-right shrink-0">
              <p style={{ fontSize: 20, fontWeight: 900, color: "#00C853" }}>$0</p>
              <p style={{ fontSize: 8, color: "rgba(0,200,83,0.4)", letterSpacing: "0.5px" }}>PER MONTH</p>
            </div>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-2 mb-4">
          {(["all", "in-zone", "out-of-zone", "offline"] as const).map((f) => {
            const active = filter === f;
            const count = f === "all"
              ? result?.snapshots.length || 0
              : result?.snapshots.filter(s => s.status === f).length || 0;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all"
                style={{
                  background: active ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.02)",
                  border: `1px solid ${active ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.04)"}`,
                  fontSize: 11, fontWeight: active ? 700 : 500,
                  color: active ? "#00C8E0" : "rgba(255,255,255,0.25)",
                }}
              >
                {f === "all" ? "All" : STATUS_CONFIG[f].label}
                <span style={{
                  fontSize: 9, fontWeight: 700,
                  background: active ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.04)",
                  padding: "1px 5px", borderRadius: 6,
                  color: active ? "#00C8E0" : "rgba(255,255,255,0.15)",
                }}>
                  {count}
                </span>
              </button>
            );
          })}

          <div className="flex-1" />

          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
            style={{
              background: showHistory ? "rgba(255,150,0,0.08)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${showHistory ? "rgba(255,150,0,0.15)" : "rgba(255,255,255,0.04)"}`,
              fontSize: 11, fontWeight: 600,
              color: showHistory ? "#FF9500" : "rgba(255,255,255,0.25)",
            }}
          >
            <Eye style={{ width: 12, height: 12 }} />
            History ({history.length})
          </button>
        </div>

        {/* Employee List */}
        <div className="grid grid-cols-2 gap-x-4">
          <div>
            {filteredSnapshots
              .filter((_, i) => i % 2 === 0)
              .map((s) => <EmployeeRow key={s.employeeId} snapshot={s} />)}
          </div>
          <div>
            {filteredSnapshots
              .filter((_, i) => i % 2 === 1)
              .map((s) => <EmployeeRow key={s.employeeId} snapshot={s} />)}
          </div>
        </div>

        {/* No results */}
        {!result && (
          <div className="flex flex-col items-center justify-center py-16">
            <Satellite style={{ width: 40, height: 40, color: "rgba(255,255,255,0.06)", marginBottom: 12 }} />
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.2)" }}>No compliance data yet</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.1)", marginTop: 4 }}>Click "Check Now" to run the first GPS scan</p>
          </div>
        )}

        {/* History Timeline */}
        <AnimatePresence>
          {showHistory && history.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="mt-6 overflow-hidden"
            >
              <h3 className="flex items-center gap-2 mb-3" style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>
                <Clock style={{ width: 14, height: 14, color: "#FF9500" }} />
                Check History
              </h3>
              <div
                className="overflow-hidden"
                style={{ borderRadius: 14, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
              >
                <table className="w-full" style={{ fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      {["Time", "Compliance", "In Zone", "Out", "Unassigned", "Offline", "Total"].map((h) => (
                        <th key={h} className="px-3 py-2.5 text-left" style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px" }}>
                          {h.toUpperCase()}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.slice(0, 10).map((check, i) => {
                      const compColor = check.compliancePercent >= 80 ? "#00C853" : check.compliancePercent >= 50 ? "#FF9500" : "#FF2D55";
                      return (
                        <tr
                          key={check.id}
                          style={{
                            borderBottom: i < history.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none",
                            background: i === 0 ? "rgba(0,200,224,0.03)" : "transparent",
                          }}
                        >
                          <td className="px-3 py-2.5">
                            <div>
                              <span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 600, fontSize: 11 }}>
                                {fmtTimeShort(check.timestamp)}
                              </span>
                              {i === 0 && (
                                <span className="ml-1.5 px-1.5 py-0.5 rounded" style={{ fontSize: 8, fontWeight: 700, background: "rgba(0,200,224,0.1)", color: "#00C8E0" }}>
                                  LATEST
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.12)" }}>{timeAgo(check.timestamp)}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-12 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                                <div className="h-full rounded-full" style={{ width: `${check.compliancePercent}%`, background: compColor }} />
                              </div>
                              <span style={{ fontSize: 12, fontWeight: 800, color: compColor }}>{check.compliancePercent}%</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5" style={{ color: "#00C853", fontWeight: 700 }}>{check.inZone}</td>
                          <td className="px-3 py-2.5" style={{ color: check.outOfZone > 0 ? "#FF2D55" : "rgba(255,255,255,0.15)", fontWeight: 700 }}>{check.outOfZone}</td>
                          <td className="px-3 py-2.5" style={{ color: "rgba(255,150,0,0.5)", fontWeight: 600 }}>{check.noZone}</td>
                          <td className="px-3 py-2.5" style={{ color: "rgba(255,255,255,0.15)", fontWeight: 600 }}>{check.offline}</td>
                          <td className="px-3 py-2.5" style={{ color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>{check.totalEmployees}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Technical Note */}
        <div
          className="mt-6 px-5 py-4 flex items-start gap-3"
          style={{ borderRadius: 14, background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.06)" }}
        >
          <Navigation style={{ width: 16, height: 16, color: "rgba(0,200,224,0.4)", marginTop: 1, flexShrink: 0 }} />
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: "rgba(0,200,224,0.6)", marginBottom: 4 }}>How it works — Zero Cost Architecture</p>
            <div className="space-y-1.5">
              {[
                "GPS coordinates read directly from employee's phone hardware — FREE",
                "Haversine formula calculates distance to zone center locally — no API calls",
                "Only raw lat/lng stored — no Google Maps reverse geocoding needed ($5/1K saved)",
                "96 checks/day/employee @ 15-min intervals × unlimited employees = $0/month",
                "Optional: Add Google Maps visualization only for admin dashboard ($7/1K loads)",
              ].map((text, i) => (
                <p key={i} style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", lineHeight: 1.5 }}>
                  <span style={{ color: "rgba(0,200,224,0.3)", marginRight: 6 }}>{i + 1}.</span>
                  {text}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}