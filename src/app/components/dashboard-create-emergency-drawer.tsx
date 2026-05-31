// ═══════════════════════════════════════════════════════════════
// SOSphere Dashboard — Create Emergency Drawer
// ─────────────────────────────────────────────────────────────
// Extracted from dashboard-pages.tsx (2026-05-31 Tier A step 5/7).
// Uses SEVERITY_CONFIG one-way from parent. Smallest extraction
// in the Tier A series — 65 lines.
// ═══════════════════════════════════════════════════════════════

import { useState } from "react";
import { motion } from "motion/react";
import { Siren, X } from "lucide-react";
import { useDashboardStore } from "./stores/dashboard-store";
import { SEVERITY_CONFIG } from "./dashboard-pages";

// ═══════════════════════════════════════════════════════════════
// Create Emergency Drawer — also lives here (needs SEVERITY_CONFIG + store zones)
// ═══════════════════════════════════════════════════════════════
export function CreateEmergencyDrawer({ onClose, onCreate, t }: {
  onClose: () => void;
  onCreate: (data: { severity: "critical" | "high" | "medium" | "low"; employeeName: string; zone: string; type: string }) => void;
  t: (k: string) => string;
}) {
  const storeZones = useDashboardStore(s => s.zones);
  const [severity, setSeverity] = useState<"critical" | "high" | "medium" | "low">("high");
  const [type, setType] = useState("Manual SOS");
  const [zone, setZone] = useState(storeZones[0]?.name || "Zone A - North Gate");
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 z-50" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }} onClick={onClose} />
      <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 400, damping: 35 }}
        className="absolute bottom-0 left-0 right-0 z-50 rounded-t-2xl"
        style={{ background: "#0A1220", border: "1px solid rgba(255,255,255,0.06)", borderBottom: "none" }}>
        <div className="flex justify-center pt-3 pb-2"><div className="w-8 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }} /></div>
        <div className="px-4 pb-8 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-white" style={{ fontSize: 16, fontWeight: 700 }}>{t("ced.title")}</h3>
            <button onClick={onClose} className="size-8 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <X className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
            </button>
          </div>
          <div>
            <p className="mb-1.5" style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)" }}>{t("ced.severity")}</p>
            <div className="grid grid-cols-4 gap-1.5">
              {(["critical", "high", "medium", "low"] as const).map(sev => {
                const cfg = SEVERITY_CONFIG[sev];
                return (
                  <button key={sev} onClick={() => setSeverity(sev)} className="py-2 rounded-lg text-center"
                    style={{ fontSize: 10, fontWeight: 600, color: severity === sev ? "#fff" : cfg.color, background: severity === sev ? cfg.color : cfg.bg, border: `1px solid ${severity === sev ? cfg.color : "transparent"}` }}>
                    {t(cfg.tKey)}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-1.5" style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)" }}>{t("ced.type")}</p>
            <select value={type} onChange={e => setType(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-transparent text-white outline-none" style={{ fontSize: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
              <option value="Manual SOS">{t("ced.manualSos")}</option>
              <option value="Missed Check-in">{t("ced.missedCheckin")}</option>
              <option value="Geofence Breach">{t("ced.geofenceBreach")}</option>
              <option value="Fall Detection">{t("ced.fallDetection")}</option>
              <option value="Gas Leak">{t("ced.gasLeak")}</option>
            </select>
          </div>
          <div>
            <p className="mb-1.5" style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)" }}>{t("ced.zone")}</p>
            <select value={zone} onChange={e => setZone(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-transparent text-white outline-none" style={{ fontSize: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
              {storeZones.map(z => <option key={z.id} value={z.name}>{z.name}</option>)}
            </select>
          </div>
          <button onClick={() => onCreate({ severity, employeeName: "Admin Report", zone, type })}
            className="w-full py-3 rounded-xl flex items-center justify-center gap-2"
            style={{ background: "linear-gradient(135deg, #FF2D55 0%, #FF1744 100%)" }}>
            <Siren className="size-4 text-white" />
            <span className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>{t("ced.submit")}</span>
          </button>
        </div>
      </motion.div>
    </>
  );
}
