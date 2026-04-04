// ═══════════════════════════════════════════════════════════════
// SOSphere — Location & Zones (Hybrid Page)
// Merges: Zones Overview + Geofencing Editor + GPS Compliance
// ═══════════════════════════════════════════════════════════════
import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { MapPin, Crosshair, Satellite } from "lucide-react";
import { ZonesPage } from "./dashboard-pages";
import { GeofencingPage } from "./dashboard-geofencing-page";
import { GPSCompliancePage } from "./dashboard-gps-compliance";
import { useDashboardStore } from "./stores/dashboard-store";

// ── Tab Bar ──────────────────────────────────────────────────────
type Tab = { id: string; label: string; icon: React.ElementType; desc: string };

const TABS: Tab[] = [
  { id: "zones",    label: "Zones",       icon: MapPin,    desc: "Site zones with risk levels & employee counts" },
  { id: "geofence", label: "Geofencing",  icon: Crosshair, desc: "Draw & configure virtual perimeters with alert rules" },
  { id: "gps",      label: "GPS Compliance", icon: Satellite, desc: "Real-time zone compliance monitoring (auto-checks every 15 min)" },
];

function LocationTabBar({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  return (
    <div
      className="flex items-center gap-1 mx-4 mt-4 p-1 rounded-2xl"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        return (
          <motion.button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            className="relative flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl"
            style={{ minWidth: 0 }}
          >
            {isActive && (
              <motion.div
                layoutId="loc-tab-pill"
                className="absolute inset-0 rounded-xl"
                style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.18)" }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
              />
            )}
            <Icon
              className="relative z-10 shrink-0"
              style={{ width: 13, height: 13, color: isActive ? "#00C8E0" : "rgba(255,255,255,0.3)" }}
            />
            <span
              className="relative z-10 truncate"
              style={{
                fontSize: 11,
                fontWeight: isActive ? 700 : 500,
                color: isActive ? "#00C8E0" : "rgba(255,255,255,0.35)",
                letterSpacing: "-0.1px",
              }}
            >
              {tab.label}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

function ContextBanner({ tabId }: { tabId: string }) {
  const tab = TABS.find(t => t.id === tabId);
  if (!tab) return null;
  const Icon = tab.icon;
  return (
    <motion.div
      key={tabId}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 mt-2 mb-0 px-3 py-2 rounded-xl flex items-center gap-2"
      style={{ background: "rgba(0,200,224,0.05)", border: "1px solid rgba(0,200,224,0.10)" }}
    >
      <Icon style={{ width: 12, height: 12, color: "#00C8E0", flexShrink: 0 }} />
      <span style={{ fontSize: 10, color: "rgba(0,200,224,0.7)", fontWeight: 500 }}>{tab.desc}</span>
    </motion.div>
  );
}

// ── Main Export ──────────────────────────────────────────────────
interface LocationPageProps {
  t: (k: string) => string;
  webMode?: boolean;
}

export function LocationZonesPage({ t, webMode = false }: LocationPageProps) {
  const zones = useDashboardStore(s => s.zones);
  const [activeTab, setActiveTab] = useState("zones");

  return (
    <div className="flex flex-col h-full">
      <LocationTabBar active={activeTab} onSelect={setActiveTab} />
      <ContextBanner tabId={activeTab} />

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
          className="flex-1 overflow-y-auto"
          style={{ scrollbarWidth: "none" }}
        >
          {activeTab === "zones" && (
            <ZonesPage zones={zones} t={t} webMode={webMode} />
          )}
          {activeTab === "geofence" && <GeofencingPage t={t} webMode={webMode} />}
          {activeTab === "gps" && <GPSCompliancePage t={t} webMode={webMode} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}