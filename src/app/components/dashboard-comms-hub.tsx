// ═══════════════════════════════════════════════════════════════
// SOSphere — Communications & Safety Hub (Hybrid Page)
// Merges: Broadcast Center + Evacuation Control
// ═══════════════════════════════════════════════════════════════
import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Megaphone, Target } from "lucide-react";
import { BroadcastPage } from "./dashboard-broadcast";
import { DashboardEvacuationPage } from "./dashboard-evacuation-page";

// ── Tab Bar ──────────────────────────────────────────────────────
type Tab = { id: string; label: string; icon: React.ElementType; desc: string; accentColor: string };

const TABS: Tab[] = [
  {
    id: "broadcast",
    label: "Broadcast",
    icon: Megaphone,
    desc: "Send prioritized alerts & announcements to any group or zone",
    accentColor: "#00C8E0",
  },
  {
    id: "evacuation",
    label: "Evacuation",
    icon: Target,
    desc: "Trigger evacuation protocol & track employee muster status",
    accentColor: "#FF9500",
  },
];

function CommsTabBar({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
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
          >
            {isActive && (
              <motion.div
                layoutId="comms-tab-pill"
                className="absolute inset-0 rounded-xl"
                style={{
                  background: `${tab.accentColor}10`,
                  border: `1px solid ${tab.accentColor}20`,
                }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
              />
            )}
            <Icon
              className="relative z-10 shrink-0"
              style={{
                width: 13, height: 13,
                color: isActive ? tab.accentColor : "rgba(255,255,255,0.3)",
              }}
            />
            <span
              className="relative z-10"
              style={{
                fontSize: 11,
                fontWeight: isActive ? 700 : 500,
                color: isActive ? tab.accentColor : "rgba(255,255,255,0.35)",
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
      style={{
        background: `${tab.accentColor}06`,
        border: `1px solid ${tab.accentColor}12`,
      }}
    >
      <Icon style={{ width: 12, height: 12, color: tab.accentColor, flexShrink: 0 }} />
      <span style={{ fontSize: 10, color: `${tab.accentColor}AA`, fontWeight: 500 }}>{tab.desc}</span>
    </motion.div>
  );
}

// ── Main Export ──────────────────────────────────────────────────
interface CommsHubProps {
  t: (k: string) => string;
  webMode?: boolean;
  initialTab?: string;
}

export function CommsHubPage({ t, webMode = false, initialTab = "broadcast" }: CommsHubProps) {
  const [activeTab, setActiveTab] = useState(initialTab);

  return (
    <div className="flex flex-col h-full">
      <CommsTabBar active={activeTab} onSelect={setActiveTab} />
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
          {activeTab === "broadcast" && <BroadcastPage t={t} webMode={webMode} />}
          {activeTab === "evacuation" && <DashboardEvacuationPage t={t} webMode={webMode} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
