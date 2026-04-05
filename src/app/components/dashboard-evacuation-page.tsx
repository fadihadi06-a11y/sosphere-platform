import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  AlertTriangle, MapPin, Users, Clock, CheckCircle2, XCircle,
  Navigation, Shield, Plus, Trash2, Edit3, X, Save,
  ChevronRight, Eye, Megaphone, Info, ExternalLink,
  History, Zap, ArrowRight,
} from "lucide-react";
import {
  getZoneGPS,
  getEvacuationPoints,
  saveEvacuationPoints,
  getActiveEvacuation,
  triggerEvacuation,
  completeEvacuation,
  cancelEvacuation,
  getEvacuationStatuses,
  getEvacuationHistory,
  onEvacuationChange,
  sendBroadcast,
  type ZoneGPSData,
  type EvacuationPoint,
  type ActiveEvacuation,
  type EmployeeEvacuationStatus,
  type EvacuationHistoryEntry,
} from "./shared-store";

interface DashboardEvacuationPageProps {
  t: (k: string) => string;
  webMode?: boolean;
}

// ── Parse Google Maps Link ─────────────────────────────────────
function parseGoogleMapsLink(link: string): { lat: number; lng: number } | null {
  const patterns = [
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/,
    /place\/[^/]*\/(-?\d+\.\d+),(-?\d+\.\d+)/,
    /(-?\d{1,3}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})/,
  ];
  for (const pattern of patterns) {
    const match = link.match(pattern);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
  }
  return null;
}

// ── Evacuation History is now read from localStorage (getEvacuationHistory) ──

export function DashboardEvacuationPage({ t, webMode = false }: DashboardEvacuationPageProps) {
  const [activeTab, setActiveTab] = useState<"setup" | "control" | "history">("control");
  const [zones, setZones] = useState<ZoneGPSData[]>([]);
  const [evacPoints, setEvacPoints] = useState<EvacuationPoint[]>([]);
  const [activeEvacuation, setActiveEvacuation] = useState<ActiveEvacuation | null>(null);
  const [evacStatuses, setEvacStatuses] = useState<EmployeeEvacuationStatus[]>([]);
  const [evacHistory, setEvacHistory] = useState<EvacuationHistoryEntry[]>(() => getEvacuationHistory());

  // Control tab state
  const [selectedZone, setSelectedZone] = useState("");
  const [selectedEvacPoint, setSelectedEvacPoint] = useState("");
  const [evacuationReason, setEvacuationReason] = useState("");
  const [showEmployeePreview, setShowEmployeePreview] = useState(false);

  useEffect(() => {
    loadData();
    const unsubscribe = onEvacuationChange(loadData);
    return unsubscribe;
  }, []);

  const loadData = () => {
    setEvacHistory(getEvacuationHistory());
    const zoneData = getZoneGPS();
    // If no zones in store, use defaults
    const defaultZones: ZoneGPSData[] = [
      { id: "Z-A", name: "Zone A - North Gate", lat: 24.7136, lng: 46.6753, radiusMeters: 150 },
      { id: "Z-B", name: "Zone B - Control Room", lat: 24.7140, lng: 46.6760, radiusMeters: 100 },
      { id: "Z-C", name: "Zone C - Main Hall", lat: 24.7145, lng: 46.6770, radiusMeters: 200 },
      { id: "Z-D", name: "Zone D - Warehouse", lat: 24.7160, lng: 46.6800, radiusMeters: 120 },
      { id: "Z-E", name: "Zone E - Parking", lat: 24.7120, lng: 46.6730, radiusMeters: 250 },
    ];
    setZones(zoneData.length > 0 ? zoneData : defaultZones);
    setEvacPoints(getEvacuationPoints());
    const active = getActiveEvacuation();
    setActiveEvacuation(active);
    if (active) {
      setEvacStatuses(getEvacuationStatuses(active.id));
    }
  };

  // Zones that have assembly points configured for trigger
  const zonesWithPoints = zones.filter(z => evacPoints.some(p => p.zoneId === z.id));
  const pointsForSelectedZone = evacPoints.filter(p => p.zoneId === selectedZone);

  const handleTriggerEvacuation = () => {
    if (!selectedZone || !evacuationReason.trim()) return;
    const zone = zones.find(z => z.id === selectedZone);
    if (!zone) return;
    const evacId = `EVAC-${Date.now().toString(36).toUpperCase()}`;
    const evacuation: ActiveEvacuation = {
      id: evacId, zoneId: selectedZone, zoneName: zone.name,
      triggeredAt: Date.now(), triggeredBy: "Admin",
      reason: evacuationReason, status: "active",
    };
    triggerEvacuation(evacuation);
    sendBroadcast({
      title: `🚨 EVACUATION ORDER — ${zone.name}`,
      body: `IMMEDIATE EVACUATION REQUIRED. Reason: ${evacuationReason}. Proceed to your nearest assembly point immediately. This is NOT a drill.`,
      priority: "emergency",
      audience: { type: "zone", zoneIds: [selectedZone] },
      audienceLabel: zone.name,
      source: "manual", senderName: "Emergency Command", senderRole: "Admin",
      timestamp: Date.now(),
    });
    setShowTriggerModal(false);
    setSelectedZone(""); setEvacuationReason(""); setSelectedEvacPoint("");
    setActiveTab("control");
  };

  const handleComplete = () => {
    if (!activeEvacuation) return;
    completeEvacuation(activeEvacuation.id);
    sendBroadcast({
      title: `✅ ALL CLEAR — ${activeEvacuation.zoneName}`,
      body: `Evacuation has been completed. All-clear signal issued. Thank you for your swift response. You may now return to normal operations.`,
      priority: "urgent",
      audience: { type: "zone", zoneIds: [activeEvacuation.zoneId] },
      audienceLabel: activeEvacuation.zoneName,
      source: "manual", senderName: "Emergency Command", senderRole: "Admin",
      timestamp: Date.now(),
    });
  };

  const handleCancel = () => {
    if (!activeEvacuation) return;
    cancelEvacuation(activeEvacuation.id);
    sendBroadcast({
      title: `❌ Evacuation Cancelled — ${activeEvacuation.zoneName}`,
      body: `The evacuation order has been cancelled. Please resume normal operations.`,
      priority: "normal",
      audience: { type: "zone", zoneIds: [activeEvacuation.zoneId] },
      audienceLabel: activeEvacuation.zoneName,
      source: "manual", senderName: "Emergency Command", senderRole: "Admin",
      timestamp: Date.now(),
    });
  };

  const statusCounts = activeEvacuation ? {
    safe: evacStatuses.filter(s => s.status === "arrived" || s.status === "safe").length,
    evacuating: evacStatuses.filter(s => s.status === "evacuating").length,
    acknowledged: evacStatuses.filter(s => s.status === "acknowledged").length,
    notified: evacStatuses.filter(s => s.status === "notified").length,
  } : { safe: 0, evacuating: 0, acknowledged: 0, notified: 0 };

  const TABS = [
    { id: "control" as const, label: "Control", icon: Zap, color: "#FF2D55" },
    { id: "setup" as const, label: "Assembly Points", icon: MapPin, color: "#00C8E0" },
    { id: "history" as const, label: "History", icon: History, color: "rgba(255,255,255,0.4)" },
  ];

  return (
    <div className="h-full flex flex-col" style={{ fontFamily: "'Outfit', sans-serif" }}>
      {/* Page Header */}
      <div className="px-6 pt-6 pb-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#FFFFFF", letterSpacing: "-0.5px" }}>
            Emergency Evacuation
          </h2>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
            Manage assembly points, trigger and monitor evacuations
          </p>
        </div>
        {activeEvacuation?.status === "active" && (
          <motion.div
            animate={{ opacity: [1, 0.4, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl"
            style={{ background: "rgba(255,45,85,0.15)", border: "1.5px solid rgba(255,45,85,0.4)" }}
          >
            <div className="size-2 rounded-full" style={{ background: "#FF2D55" }} />
            <span style={{ fontSize: 13, fontWeight: 800, color: "#FF2D55" }}>LIVE EVACUATION</span>
          </motion.div>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="px-6 flex gap-1 flex-shrink-0 mb-4">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl transition-all"
              style={{
                background: isActive ? `${tab.color}12` : "transparent",
                border: `1px solid ${isActive ? `${tab.color}30` : "rgba(255,255,255,0.06)"}`,
                color: isActive ? tab.color : "rgba(255,255,255,0.4)",
                fontSize: 13, fontWeight: 700,
              }}
            >
              <Icon className="size-3.5" />
              {tab.label}
              {tab.id === "control" && activeEvacuation?.status === "active" && (
                <span className="size-2 rounded-full" style={{ background: "#FF2D55" }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6" style={{ scrollbarWidth: "none" }}>
        <AnimatePresence mode="wait">
          {/* ── CONTROL TAB ───────────────────────────────────── */}
          {activeTab === "control" && (
            <motion.div
              key="control"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              {/* Active Evacuation Banner */}
              {activeEvacuation?.status === "active" ? (
                <>
                  <ActiveEvacuationBanner
                    evacuation={activeEvacuation}
                    statusCounts={statusCounts}
                    onComplete={handleComplete}
                    onCancel={handleCancel}
                    evacPoints={evacPoints}
                  />
                  {/* Employee Status List */}
                  {evacStatuses.length > 0 && (
                    <div className="rounded-2xl overflow-hidden"
                      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        <p style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>Employee Status</p>
                      </div>
                      <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.03)" }}>
                        {evacStatuses.map(s => (
                          <EmployeeStatusRow key={s.employeeId} status={s} />
                        ))}
                      </div>
                    </div>
                  )}
                  {evacStatuses.length === 0 && (
                    <div className="rounded-2xl p-8 text-center"
                      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <Users className="size-10 mx-auto mb-3" style={{ color: "rgba(255,255,255,0.15)" }} />
                      <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)" }}>Waiting for employee acknowledgements…</p>
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 4 }}>
                        Status updates appear here as employees respond
                      </p>
                    </div>
                  )}
                </>
              ) : (
                /* No Active Evacuation — Trigger Panel */
                <TriggerPanel
                  zones={zones}
                  zonesWithPoints={zonesWithPoints}
                  evacPoints={evacPoints}
                  selectedZone={selectedZone}
                  setSelectedZone={setSelectedZone}
                  selectedEvacPoint={selectedEvacPoint}
                  setSelectedEvacPoint={setSelectedEvacPoint}
                  evacuationReason={evacuationReason}
                  setEvacuationReason={setEvacuationReason}
                  showEmployeePreview={showEmployeePreview}
                  setShowEmployeePreview={setShowEmployeePreview}
                  pointsForSelectedZone={pointsForSelectedZone}
                  onTrigger={handleTriggerEvacuation}
                  onGoSetup={() => setActiveTab("setup")}
                />
              )}
            </motion.div>
          )}

          {/* ── SETUP TAB ──────────────────────────────────────── */}
          {activeTab === "setup" && (
            <motion.div
              key="setup"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <AssemblyPointsSetup
                zones={zones}
                evacPoints={evacPoints}
                onSave={points => { saveEvacuationPoints(points); setEvacPoints(points); }}
              />
            </motion.div>
          )}

          {/* ── HISTORY TAB ─────────────────────────────────────── */}
          {activeTab === "history" && (
            <motion.div
              key="history"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-3"
            >
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", fontWeight: 600 }}>
                PAST EVACUATIONS ({evacHistory.length})
              </p>
              {evacHistory.map(ev => (
                <div key={ev.id} className="rounded-2xl p-5"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{ev.zoneName}</p>
                      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{ev.reason}</p>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg"
                      style={{ fontSize: 11, fontWeight: 700,
                        color: ev.status === "completed" ? "#00C853" : "#FF453A",
                        background: ev.status === "completed" ? "rgba(0,200,83,0.1)" : "rgba(255,69,58,0.1)" }}>
                      {ev.status === "completed" ? "Completed" : "Cancelled"}
                    </span>
                  </div>
                  <div className="flex items-center gap-4" style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
                    <span className="flex items-center gap-1.5">
                      <Clock className="size-3" />
                      {new Date(ev.triggeredAt).toLocaleDateString()} {ev.duration ? `· ${ev.duration}min` : ""}
                    </span>
                    {ev.employeesEvacuated != null && (
                      <span className="flex items-center gap-1.5">
                        <Users className="size-3" />
                        {ev.employeesEvacuated} evacuated
                      </span>
                    )}
                    <span className="flex items-center gap-1.5">
                      <Shield className="size-3" />
                      By {ev.triggeredBy}
                    </span>
                  </div>
                </div>
              ))}
              {evacHistory.length === 0 && (
                <div className="rounded-2xl p-12 text-center"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <History className="size-10 mx-auto mb-3" style={{ color: "rgba(255,255,255,0.1)" }} />
                  <p style={{ color: "rgba(255,255,255,0.3)" }}>No past evacuations</p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Active Evacuation Banner ────────────────────────────────────
function ActiveEvacuationBanner({
  evacuation, statusCounts, onComplete, onCancel, evacPoints,
}: {
  evacuation: ActiveEvacuation;
  statusCounts: { safe: number; evacuating: number; acknowledged: number; notified: number };
  onComplete: () => void;
  onCancel: () => void;
  evacPoints: EvacuationPoint[];
}) {
  const [elapsed, setElapsed] = useState(Math.floor((Date.now() - evacuation.triggeredAt) / 1000));
  useEffect(() => {
    const i = setInterval(() => setElapsed(Math.floor((Date.now() - evacuation.triggeredAt) / 1000)), 1000);
    return () => clearInterval(i);
  }, [evacuation.triggeredAt]);

  const fmtTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
  const zonePoints = evacPoints.filter(p => p.zoneId === evacuation.zoneId);
  const totalResponded = statusCounts.safe + statusCounts.evacuating + statusCounts.acknowledged;

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ border: "2px solid rgba(255,45,85,0.4)", background: "linear-gradient(135deg, rgba(255,45,85,0.08) 0%, rgba(199,0,76,0.04) 100%)" }}>
      {/* Top bar */}
      <div className="px-5 py-4 flex items-center gap-4" style={{ borderBottom: "1px solid rgba(255,45,85,0.15)" }}>
        <motion.div
          animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 1, repeat: Infinity }}
          className="size-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: "rgba(255,45,85,0.2)" }}>
          <AlertTriangle className="size-6" style={{ color: "#FF2D55" }} />
        </motion.div>
        <div className="flex-1">
          <p style={{ fontSize: 16, fontWeight: 800, color: "#FF2D55" }}>ACTIVE EVACUATION</p>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", marginTop: 1 }}>
            <strong>{evacuation.zoneName}</strong> — {evacuation.reason}
          </p>
        </div>
        <div className="text-right">
          <p style={{ fontSize: 28, fontWeight: 800, color: "#FF2D55", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
            {fmtTime(elapsed)}
          </p>
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>ELAPSED</p>
        </div>
      </div>

      {/* Status grid */}
      <div className="grid grid-cols-4 divide-x" style={{ borderBottom: "1px solid rgba(255,45,85,0.1)", borderColor: "rgba(255,255,255,0.04)" }}>
        {[
          { label: "Safe", count: statusCounts.safe, color: "#00C853" },
          { label: "Evacuating", count: statusCounts.evacuating, color: "#FF9500" },
          { label: "Acknowledged", count: statusCounts.acknowledged, color: "#FFD60A" },
          { label: "Notified", count: statusCounts.notified, color: "rgba(255,255,255,0.4)" },
        ].map(s => (
          <div key={s.label} className="px-4 py-3 text-center">
            <p style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.count}</p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>{s.label.toUpperCase()}</p>
          </div>
        ))}
      </div>

      {/* Assembly points for this zone */}
      {zonePoints.length > 0 && (
        <div className="px-5 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.3)", marginBottom: 8, letterSpacing: "0.5px" }}>
            ASSEMBLY POINTS FOR THIS ZONE
          </p>
          <div className="flex flex-wrap gap-2">
            {zonePoints.map(pt => (
              <div key={pt.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
                style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.2)" }}>
                <MapPin className="size-3" style={{ color: "#00C8E0" }} />
                <span style={{ fontSize: 12, color: "#00C8E0", fontWeight: 600 }}>{pt.name}</span>
                {pt.capacity && <span style={{ fontSize: 10, color: "rgba(0,200,224,0.6)" }}>Cap: {pt.capacity}</span>}
                <a
                  href={`https://maps.google.com/?q=${pt.lat},${pt.lng}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1"
                  style={{ fontSize: 10, color: "rgba(0,200,224,0.7)" }}
                >
                  <ExternalLink className="size-2.5" /> Maps
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="px-5 py-4 flex items-center gap-3">
        <button onClick={onComplete}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl"
          style={{ background: "linear-gradient(135deg, #00C8E0, #0088A8)", fontSize: 13, fontWeight: 700, color: "#fff", boxShadow: "0 4px 16px rgba(0,200,224,0.2)" }}>
          <CheckCircle2 className="size-4" /> Mark All Safe
        </button>
        <button onClick={onCancel}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>
          <XCircle className="size-4" /> Cancel
        </button>
      </div>
    </div>
  );
}

// ── Trigger Panel ───────────────────────────────────────────────
function TriggerPanel({
  zones, zonesWithPoints, evacPoints, selectedZone, setSelectedZone,
  selectedEvacPoint, setSelectedEvacPoint, evacuationReason, setEvacuationReason,
  showEmployeePreview, setShowEmployeePreview, pointsForSelectedZone, onTrigger, onGoSetup,
}: {
  zones: ZoneGPSData[];
  zonesWithPoints: ZoneGPSData[];
  evacPoints: EvacuationPoint[];
  selectedZone: string;
  setSelectedZone: (v: string) => void;
  selectedEvacPoint: string;
  setSelectedEvacPoint: (v: string) => void;
  evacuationReason: string;
  setEvacuationReason: (v: string) => void;
  showEmployeePreview: boolean;
  setShowEmployeePreview: (v: boolean) => void;
  pointsForSelectedZone: EvacuationPoint[];
  onTrigger: () => void;
  onGoSetup: () => void;
}) {
  const canTrigger = selectedZone && evacuationReason.trim();
  const hasNoPoints = zones.length > 0 && evacPoints.length === 0;

  return (
    <div className="space-y-4">
      {/* Setup Warning */}
      {hasNoPoints && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-2xl flex items-center gap-4"
          style={{ background: "rgba(255,149,0,0.08)", border: "1px solid rgba(255,149,0,0.2)" }}>
          <Info className="size-5 flex-shrink-0" style={{ color: "#FF9500" }} />
          <div className="flex-1">
            <p style={{ fontSize: 13, fontWeight: 700, color: "#FF9500" }}>No Assembly Points Configured</p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
              Add assembly points so employees know where to go during an evacuation.
            </p>
          </div>
          <button onClick={onGoSetup}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg flex-shrink-0"
            style={{ background: "rgba(255,149,0,0.12)", border: "1px solid rgba(255,149,0,0.25)", fontSize: 12, fontWeight: 700, color: "#FF9500" }}>
            Setup <ChevronRight className="size-3" />
          </button>
        </motion.div>
      )}

      {/* Trigger Form */}
      <div className="rounded-2xl overflow-hidden"
        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="size-9 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.2)" }}>
            <AlertTriangle className="size-5" style={{ color: "#FF2D55" }} />
          </div>
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>Trigger Evacuation</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Employees will receive an immediate alert</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Zone Selector */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px" }}>
              SELECT ZONE
            </label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {zones.map(zone => {
                const hasPoints = evacPoints.some(p => p.zoneId === zone.id);
                const isSelected = selectedZone === zone.id;
                return (
                  <button key={zone.id} onClick={() => { setSelectedZone(zone.id); setSelectedEvacPoint(""); }}
                    className="p-3 rounded-xl text-left transition-all"
                    style={{
                      background: isSelected ? "rgba(255,45,85,0.1)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${isSelected ? "rgba(255,45,85,0.35)" : "rgba(255,255,255,0.06)"}`,
                    }}>
                    <div className="flex items-center justify-between mb-1">
                      <span style={{ fontSize: 11, fontWeight: 700, color: isSelected ? "#FF2D55" : "rgba(255,255,255,0.6)" }}>
                        {zone.name.split(" - ")[0]}
                      </span>
                      {hasPoints
                        ? <CheckCircle2 className="size-3" style={{ color: "#00C853" }} />
                        : <AlertTriangle className="size-3" style={{ color: "#FF9500" }} />
                      }
                    </div>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
                      {hasPoints ? `${evacPoints.filter(p => p.zoneId === zone.id).length} assembly pt` : "No assembly pts"}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Assembly Point (optional) */}
          {selectedZone && pointsForSelectedZone.length > 0 && (
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px" }}>
                ASSEMBLY POINT (optional override)
              </label>
              <select
                value={selectedEvacPoint}
                onChange={e => setSelectedEvacPoint(e.target.value)}
                className="mt-2 w-full px-4 py-2.5 rounded-xl outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: 13 }}>
                <option value="">Auto (nearest to each employee)</option>
                {pointsForSelectedZone.map(pt => (
                  <option key={pt.id} value={pt.id}>{pt.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Reason */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px" }}>
              EVACUATION REASON *
            </label>
            <div className="mt-2 grid grid-cols-3 gap-2 mb-2">
              {["Fire detected", "Gas leak", "Security threat", "Medical emergency", "Structural hazard", "Drill"].map(r => (
                <button key={r} onClick={() => setEvacuationReason(r)}
                  className="px-2 py-1.5 rounded-lg text-center transition-all"
                  style={{
                    fontSize: 11, fontWeight: 600,
                    color: evacuationReason === r ? "#FF2D55" : "rgba(255,255,255,0.4)",
                    background: evacuationReason === r ? "rgba(255,45,85,0.1)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${evacuationReason === r ? "rgba(255,45,85,0.3)" : "rgba(255,255,255,0.06)"}`,
                  }}>
                  {r}
                </button>
              ))}
            </div>
            <textarea
              value={evacuationReason}
              onChange={e => setEvacuationReason(e.target.value)}
              placeholder="Or type a custom reason…"
              rows={2}
              className="w-full px-4 py-2.5 rounded-xl outline-none resize-none"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: 13 }}
            />
          </div>

          {/* Employee Preview Toggle */}
          <button onClick={() => setShowEmployeePreview(!showEmployeePreview)}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all"
            style={{ background: "rgba(0,200,224,0.05)", border: "1px solid rgba(0,200,224,0.12)" }}>
            <div className="flex items-center gap-2">
              <Eye className="size-4" style={{ color: "#00C8E0" }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#00C8E0" }}>Preview what employees will see</span>
            </div>
            <ChevronRight className="size-4 transition-transform" style={{ color: "#00C8E0", transform: showEmployeePreview ? "rotate(90deg)" : "none" }} />
          </button>

          <AnimatePresence>
            {showEmployeePreview && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <EmployeePreview
                  zoneName={zones.find(z => z.id === selectedZone)?.name || "Selected Zone"}
                  reason={evacuationReason || "Reason will appear here"}
                  assemblyPoint={pointsForSelectedZone[0]}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Trigger Button */}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onTrigger}
            disabled={!canTrigger}
            className="w-full py-4 rounded-xl flex items-center justify-center gap-2"
            style={{
              background: canTrigger ? "linear-gradient(135deg, #FF2D55 0%, #C7004C 100%)" : "rgba(255,255,255,0.06)",
              color: canTrigger ? "#fff" : "rgba(255,255,255,0.25)",
              fontSize: 15, fontWeight: 800, letterSpacing: "-0.3px",
              boxShadow: canTrigger ? "0 6px 24px rgba(255,45,85,0.3)" : "none",
              border: "none", opacity: canTrigger ? 1 : 0.7,
            }}
          >
            <AlertTriangle className="size-5" />
            Trigger Evacuation
          </motion.button>
        </div>
      </div>

      {/* How it works */}
      <div className="rounded-2xl p-5 space-y-4"
        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>HOW IT WORKS</p>
        {[
          { step: "1", label: "Admin triggers", desc: "Select zone + reason → employees get instant in-app alert", icon: Zap, color: "#FF2D55" },
          { step: "2", label: "Employees receive alert", desc: "Full-screen notification with zone name, reason & nearest assembly point", icon: Megaphone, color: "#FF9500" },
          { step: "3", label: "Employee follows guidance", desc: "Step-by-step instructions + Google Maps link to assembly point", icon: Navigation, color: "#00C8E0" },
          { step: "4", label: "Confirm arrival", desc: "Employee taps 'I'm Safe' — dashboard updates in real-time", icon: CheckCircle2, color: "#00C853" },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={s.step} className="flex items-start gap-3">
              <div className="size-7 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: `${s.color}12`, border: `1px solid ${s.color}20` }}>
                <Icon className="size-3.5" style={{ color: s.color }} />
              </div>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{s.label}</p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>{s.desc}</p>
              </div>
              {i < 3 && <ArrowRight className="size-4 flex-shrink-0 mt-1 ml-auto" style={{ color: "rgba(255,255,255,0.1)" }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Assembly Points Setup Tab ───────────────────────────────────
function AssemblyPointsSetup({
  zones, evacPoints, onSave,
}: {
  zones: ZoneGPSData[];
  evacPoints: EvacuationPoint[];
  onSave: (points: EvacuationPoint[]) => void;
}) {
  const [showModal, setShowModal] = useState(false);
  const [editingPoint, setEditingPoint] = useState<EvacuationPoint | null>(null);

  const handleDelete = (id: string) => {
    onSave(evacPoints.filter(p => p.id !== id));
  };

  const handleSavePoint = (point: EvacuationPoint) => {
    if (editingPoint) {
      onSave(evacPoints.map(p => p.id === editingPoint.id ? point : p));
    } else {
      onSave([...evacPoints, point]);
    }
    setShowModal(false);
    setEditingPoint(null);
  };

  // Group by zone
  const grouped = zones.map(zone => ({
    zone,
    points: evacPoints.filter(p => p.zoneId === zone.id),
  })).filter(g => g.points.length > 0);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <p style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>Assembly Points</p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
            Define where employees should go during evacuation
          </p>
        </div>
        <button
          onClick={() => { setEditingPoint(null); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl"
          style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.25)", fontSize: 13, fontWeight: 700, color: "#00C8E0" }}>
          <Plus className="size-4" /> Add Point
        </button>
      </div>

      {evacPoints.length === 0 ? (
        <div className="rounded-2xl p-12 text-center"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.1)" }}>
          <MapPin className="size-12 mx-auto mb-4" style={{ color: "rgba(0,200,224,0.3)" }} />
          <p style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>No Assembly Points</p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", marginTop: 4, marginBottom: 16 }}>
            Add at least one assembly point per zone so employees know where to evacuate to.
          </p>
          <button
            onClick={() => { setEditingPoint(null); setShowModal(true); }}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl"
            style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)", fontSize: 13, fontWeight: 700, color: "#00C8E0" }}>
            <Plus className="size-4" /> Add First Assembly Point
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Zone groups */}
          {grouped.map(({ zone, points }) => (
            <div key={zone.id} className="rounded-2xl overflow-hidden"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.02)" }}>
                <div className="size-6 rounded-lg flex items-center justify-center"
                  style={{ background: "rgba(0,200,224,0.1)" }}>
                  <MapPin className="size-3" style={{ color: "#00C8E0" }} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{zone.name}</span>
                <span className="px-2 py-0.5 rounded-full ml-auto"
                  style={{ fontSize: 10, fontWeight: 700, color: "#00C8E0", background: "rgba(0,200,224,0.08)" }}>
                  {points.length} point{points.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.03)" }}>
                {points.map(pt => (
                  <div key={pt.id} className="px-4 py-3 flex items-start gap-3">
                    <div className="size-9 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)" }}>
                      <Shield className="size-4" style={{ color: "#00C8E0" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{pt.name}</p>
                      {pt.description && (
                        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{pt.description}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-3 mt-2">
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                          📍 {pt.lat.toFixed(5)}, {pt.lng.toFixed(5)}
                        </span>
                        {pt.capacity && (
                          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                            👥 Cap: {pt.capacity}
                          </span>
                        )}
                        <a href={`https://maps.google.com/?q=${pt.lat},${pt.lng}`}
                          target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1"
                          style={{ fontSize: 11, color: "#00C8E0", textDecoration: "none" }}>
                          <ExternalLink className="size-3" /> Open in Maps
                        </a>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setEditingPoint(pt); setShowModal(true); }}
                        className="size-7 rounded-lg flex items-center justify-center transition-all"
                        style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)" }}>
                        <Edit3 className="size-3" />
                      </button>
                      <button onClick={() => handleDelete(pt.id)}
                        className="size-7 rounded-lg flex items-center justify-center transition-all"
                        style={{ background: "rgba(255,45,85,0.08)", color: "rgba(255,45,85,0.6)" }}>
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Zones without points */}
          {zones.filter(z => !evacPoints.some(p => p.zoneId === z.id)).length > 0 && (
            <div className="rounded-2xl p-4"
              style={{ background: "rgba(255,149,0,0.05)", border: "1px solid rgba(255,149,0,0.15)" }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#FF9500", marginBottom: 8 }}>
                ⚠️ Zones without assembly points:
              </p>
              <div className="flex flex-wrap gap-2">
                {zones.filter(z => !evacPoints.some(p => p.zoneId === z.id)).map(z => (
                  <button key={z.id}
                    onClick={() => { setEditingPoint(null); setShowModal(true); }}
                    className="px-3 py-1.5 rounded-lg"
                    style={{ background: "rgba(255,149,0,0.08)", border: "1px solid rgba(255,149,0,0.2)", fontSize: 12, color: "#FF9500", fontWeight: 600 }}>
                    {z.name.split(" - ")[0]} <Plus className="size-3 inline ml-1" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {showModal && (
          <AssemblyPointModal
            zones={zones}
            editingPoint={editingPoint}
            onSave={handleSavePoint}
            onClose={() => { setShowModal(false); setEditingPoint(null); }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ── Assembly Point Modal (Add / Edit) ───────────────────────────
function AssemblyPointModal({
  zones, editingPoint, onSave, onClose,
}: {
  zones: ZoneGPSData[];
  editingPoint: EvacuationPoint | null;
  onSave: (point: EvacuationPoint) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(editingPoint?.name || "");
  const [zoneId, setZoneId] = useState(editingPoint?.zoneId || (zones[0]?.id || ""));
  const [lat, setLat] = useState(editingPoint?.lat.toString() || "24.7136");
  const [lng, setLng] = useState(editingPoint?.lng.toString() || "46.6753");
  const [capacity, setCapacity] = useState(editingPoint?.capacity?.toString() || "");
  const [description, setDescription] = useState(editingPoint?.description || "");
  const [mapsLink, setMapsLink] = useState("");
  const [inputMode, setInputMode] = useState<"coords" | "link">("coords");
  const [parseError, setParseError] = useState(false);
  const [parsed, setParsed] = useState(false);

  const handleParseLink = (link: string) => {
    setMapsLink(link);
    const result = parseGoogleMapsLink(link);
    if (result) {
      setLat(result.lat.toFixed(6));
      setLng(result.lng.toFixed(6));
      setParsed(true);
      setParseError(false);
    } else {
      setParsed(false);
      setParseError(link.length > 10);
    }
  };

  const canSave = name.trim() && zoneId && lat && lng;

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      id: editingPoint?.id || `EP-${Date.now().toString(36).toUpperCase()}`,
      name: name.trim(),
      zoneId,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      capacity: capacity ? parseInt(capacity) : undefined,
      description: description.trim() || undefined,
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0 }}
        className="w-full max-w-lg mx-4 rounded-2xl overflow-hidden"
        style={{ background: "#0A1220", border: "1px solid rgba(0,200,224,0.2)", boxShadow: "0 24px 80px rgba(0,0,0,0.6)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)" }}>
              <MapPin className="size-5" style={{ color: "#00C8E0" }} />
            </div>
            <div>
              <p style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>
                {editingPoint ? "Edit Assembly Point" : "Add Assembly Point"}
              </p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Define where employees evacuate to</p>
            </div>
          </div>
          <button onClick={onClose} className="size-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)" }}>
            <X className="size-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          {/* Name */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px" }}>
              POINT NAME *
            </label>
            <input
              value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g., Assembly Point A — Main Parking"
              className="mt-2 w-full px-4 py-2.5 rounded-xl outline-none"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: 13 }}
            />
          </div>

          {/* Zone */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px" }}>
              ASSIGNED ZONE *
            </label>
            <select value={zoneId} onChange={e => setZoneId(e.target.value)}
              className="mt-2 w-full px-4 py-2.5 rounded-xl outline-none"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: 13 }}>
              {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </div>

          {/* GPS Input Mode */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px" }}>
              LOCATION *
            </label>
            <div className="flex gap-2 mt-2 mb-3">
              {[
                { id: "coords" as const, label: "Coordinates" },
                { id: "link" as const, label: "Google Maps Link" },
              ].map(m => (
                <button key={m.id} onClick={() => setInputMode(m.id)}
                  className="flex-1 py-2 rounded-lg"
                  style={{
                    fontSize: 12, fontWeight: 700,
                    color: inputMode === m.id ? "#00C8E0" : "rgba(255,255,255,0.35)",
                    background: inputMode === m.id ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${inputMode === m.id ? "rgba(0,200,224,0.25)" : "rgba(255,255,255,0.06)"}`,
                  }}>
                  {m.label}
                </button>
              ))}
            </div>

            {inputMode === "coords" ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>LATITUDE</label>
                  <input value={lat} onChange={e => setLat(e.target.value)}
                    placeholder="24.7136"
                    className="mt-1 w-full px-3 py-2.5 rounded-lg outline-none"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>LONGITUDE</label>
                  <input value={lng} onChange={e => setLng(e.target.value)}
                    placeholder="46.6753"
                    className="mt-1 w-full px-3 py-2.5 rounded-lg outline-none"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: 13 }} />
                </div>
              </div>
            ) : (
              <div>
                <input
                  value={mapsLink} onChange={e => handleParseLink(e.target.value)}
                  placeholder="Paste Google Maps link or share location URL…"
                  className="w-full px-4 py-2.5 rounded-xl outline-none"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: `1px solid ${parsed ? "rgba(0,200,83,0.4)" : parseError ? "rgba(255,45,85,0.4)" : "rgba(255,255,255,0.08)"}`,
                    color: "#fff", fontSize: 13
                  }} />
                {parsed && (
                  <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg"
                    style={{ background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.2)" }}>
                    <CheckCircle2 className="size-3.5" style={{ color: "#00C853" }} />
                    <span style={{ fontSize: 12, color: "#00C853", fontWeight: 600 }}>
                      Parsed: {parseFloat(lat).toFixed(5)}, {parseFloat(lng).toFixed(5)}
                    </span>
                  </div>
                )}
                {parseError && (
                  <p style={{ fontSize: 11, color: "#FF2D55", marginTop: 4 }}>
                    Could not parse coordinates from this link. Try a direct Google Maps URL.
                  </p>
                )}
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 6 }}>
                  Supported: maps.google.com, goo.gl/maps, or any URL with @lat,lng
                </p>
              </div>
            )}
          </div>

          {/* Capacity + Description */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px" }}>
                CAPACITY
              </label>
              <input value={capacity} onChange={e => setCapacity(e.target.value)}
                placeholder="e.g. 50"
                type="number"
                className="mt-2 w-full px-3 py-2.5 rounded-xl outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px" }}>
                INSTRUCTIONS
              </label>
              <input value={description} onChange={e => setDescription(e.target.value)}
                placeholder="e.g. Behind north building"
                className="mt-2 w-full px-3 py-2.5 rounded-xl outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: 13 }} />
            </div>
          </div>
        </div>

        {/* Save */}
        <div className="px-6 py-4 flex gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button onClick={handleSave} disabled={!canSave}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl"
            style={{
              background: canSave ? "linear-gradient(135deg, #00C8E0, #0088A8)" : "rgba(255,255,255,0.06)",
              color: canSave ? "#fff" : "rgba(255,255,255,0.25)",
              fontSize: 14, fontWeight: 700,
            }}>
            <Save className="size-4" />
            {editingPoint ? "Save Changes" : "Add Assembly Point"}
          </button>
          <button onClick={onClose}
            className="px-5 py-3 rounded-xl"
            style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.5)", fontSize: 14, fontWeight: 600 }}>
            Cancel
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Employee Preview Card ───────────────────────────────────────
function EmployeePreview({ zoneName, reason, assemblyPoint }: {
  zoneName: string; reason: string; assemblyPoint?: EvacuationPoint;
}) {
  return (
    <div className="rounded-xl overflow-hidden mt-2" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="px-3 py-2 flex items-center gap-2"
        style={{ background: "rgba(0,200,224,0.06)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <Eye className="size-3" style={{ color: "#00C8E0" }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: "#00C8E0" }}>EMPLOYEE VIEW PREVIEW</span>
      </div>
      {/* Simulated phone notification */}
      <div className="p-3" style={{ background: "#05070E" }}>
        <div className="p-3 rounded-xl"
          style={{ background: "linear-gradient(135deg, rgba(255,45,85,0.2) 0%, rgba(199,0,76,0.12) 100%)", border: "2px solid rgba(255,45,85,0.35)" }}>
          <div className="flex items-start gap-2.5 mb-3">
            <motion.div animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 1, repeat: Infinity }}>
              <AlertTriangle className="size-6" style={{ color: "#FF2D55" }} />
            </motion.div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 800, color: "#FF2D55" }}>🚨 EVACUATION ORDER</p>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", marginTop: 2 }}>{zoneName}</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>{reason}</p>
            </div>
          </div>
          {assemblyPoint && (
            <div className="px-3 py-2 rounded-lg"
              style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)" }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: "#00C8E0" }}>
                📍 Go to: {assemblyPoint.name}
              </p>
              {assemblyPoint.description && (
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
                  {assemblyPoint.description}
                </p>
              )}
            </div>
          )}
          <div className="flex gap-2 mt-3">
            <div className="flex-1 py-1.5 rounded-lg text-center"
              style={{ background: "rgba(0,200,224,0.15)", border: "1px solid rgba(0,200,224,0.3)", fontSize: 11, fontWeight: 700, color: "#00C8E0" }}>
              Navigate ↗
            </div>
            <div className="flex-1 py-1.5 rounded-lg text-center"
              style={{ background: "rgba(0,200,83,0.15)", border: "1px solid rgba(0,200,83,0.3)", fontSize: 11, fontWeight: 700, color: "#00C853" }}>
              I'm Safe ✓
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Employee Status Row ─────────────────────────────────────────
function EmployeeStatusRow({ status }: { status: EmployeeEvacuationStatus }) {
  const STATUS_MAP = {
    safe: { label: "Safe at Assembly", color: "#00C853" },
    arrived: { label: "Safe at Assembly", color: "#00C853" },
    evacuating: { label: "Evacuating", color: "#FF9500" },
    acknowledged: { label: "Acknowledged", color: "#FFD60A" },
    notified: { label: "Notified", color: "rgba(255,255,255,0.4)" },
  };
  const cfg = STATUS_MAP[status.status] || STATUS_MAP.notified;
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <motion.div
        animate={status.status === "evacuating" ? { scale: [1, 1.3, 1] } : {}}
        transition={{ duration: 1, repeat: Infinity }}
        className="size-2 rounded-full flex-shrink-0"
        style={{ background: cfg.color }}
      />
      <span style={{ fontSize: 13, color: "#fff", flex: 1 }}>{status.employeeName}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
    </div>
  );
}
