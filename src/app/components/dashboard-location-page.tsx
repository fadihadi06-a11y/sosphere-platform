// ═══════════════════════════════════════════════════════════════
// SOSphere — Location & Zones (Hybrid Page)
// Merges: Zones Overview + Geofencing Editor + GPS Compliance
// ═══════════════════════════════════════════════════════════════
import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { MapPin, Crosshair, Satellite } from "lucide-react";
import { ZonesPage } from "./dashboard-pages";
import { GeofenceMapEditor } from "./dashboard-geofence-map-editor";
import { GPSCompliancePage } from "./dashboard-gps-compliance";
import { useDashboardStore } from "./stores/dashboard-store";

// ── Tab Bar ──────────────────────────────────────────────────────
type Tab = { id: string; labelKey: string; icon: React.ElementType; descKey: string };

const TABS: Tab[] = [
  { id: "zones",    labelKey: "loc.zones",    icon: MapPin,    descKey: "loc.zonesDesc" },
  { id: "geofence", labelKey: "loc.geofence", icon: Crosshair, descKey: "loc.geofenceDesc" },
  { id: "gps",      labelKey: "loc.gps",      icon: Satellite, descKey: "loc.gpsDesc" },
];

function LocationTabBar({ active, onSelect, t }: { active: string; onSelect: (id: string) => void; t: (k: string) => string }) {
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
              {t(tab.labelKey)}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

function ContextBanner({ tabId, t }: { tabId: string; t: (k: string) => string }) {
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
      <span style={{ fontSize: 10, color: "rgba(0,200,224,0.7)", fontWeight: 500 }}>{t(tab.descKey)}</span>
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
      <LocationTabBar active={activeTab} onSelect={setActiveTab} t={t} />
      <ContextBanner tabId={activeTab} t={t} />

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
          {activeTab === "geofence" && <GeofenceMapEditor webMode={webMode} />}
          {activeTab === "gps" && <GPSCompliancePage t={t} webMode={webMode} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}