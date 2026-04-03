// ═══════════════════════════════════════════════════════════════
// HAZARD ALERT BANNER — Floating hazard zone alert (Mobile)
// Mirrors HazardAlertBanner.tsx from web
// ═══════════════════════════════════════════════════════════════
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { AlertTriangle, X, MapPin, ChevronRight } from "lucide-react";

interface HazardAlert {
  id: string;
  zone: string;
  type: string;
  severity: "warning" | "danger" | "info";
  message: string;
}

interface HazardBannerProps {
  onNavigate?: (page: string, params?: Record<string, string>) => void;
  t: (k: string) => string;
  inline?: boolean;
}

const SEV_STYLES = {
  danger:  { bg: "rgba(255,45,85,0.12)", border: "rgba(255,45,85,0.25)", color: "#FF2D55", icon: "!" },
  warning: { bg: "rgba(255,179,0,0.12)", border: "rgba(255,179,0,0.25)", color: "#FFB300", icon: "⚠" },
  info:    { bg: "rgba(0,200,224,0.12)", border: "rgba(0,200,224,0.25)", color: "#00C8E0", icon: "ℹ" },
};

// ── Mock Hazard Data ──
// Start empty — hazards populate dynamically from weather/zone monitoring
const HAZARD_ALERTS: HazardAlert[] = [];

export function HazardAlertBanner({ onNavigate, t, inline = false }: HazardBannerProps) {
  const [alerts, setAlerts] = useState<HazardAlert[]>(HAZARD_ALERTS);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Auto-rotate alerts every 5s
  useEffect(() => {
    if (alerts.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIdx(prev => (prev + 1) % alerts.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [alerts.length]);

  const visibleAlerts = alerts.filter(a => !dismissed.has(a.id));
  if (visibleAlerts.length === 0) return null;

  const current = visibleAlerts[currentIdx % visibleAlerts.length];
  if (!current) return null;
  const style = SEV_STYLES[current.severity];

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={current.id}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3 }}
        className={`${inline ? "mx-5 mt-3 mb-1" : "absolute top-[52px] left-3 right-3 z-40"} rounded-xl overflow-hidden`}
        style={{ background: style.bg, border: `1px solid ${style.border}`, backdropFilter: "blur(12px)" }}
      >
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          {/* Pulsing icon */}
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="size-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: `${style.color}15` }}
          >
            <AlertTriangle className="size-3.5" style={{ color: style.color }} />
          </motion.div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span style={{ fontSize: 9, fontWeight: 700, color: style.color, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                {t("hb.hazardAlert")}
              </span>
              <span className="flex items-center gap-0.5" style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>
                <MapPin className="size-2.5" /> {current.zone}
              </span>
            </div>
            <p className="truncate" style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.7)", marginTop: 1 }}>
              {current.message}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {onNavigate && (
              <button
                onClick={() => onNavigate("zones", { zone: current.zone })}
                className="size-6 rounded-md flex items-center justify-center"
                style={{ background: `${style.color}10` }}
              >
                <ChevronRight className="size-3.5" style={{ color: style.color }} />
              </button>
            )}
            <button
              onClick={() => setDismissed(prev => new Set([...prev, current.id]))}
              className="size-6 rounded-md flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.04)" }}
            >
              <X className="size-3" style={{ color: "rgba(255,255,255,0.3)" }} />
            </button>
          </div>
        </div>

        {/* Multi-alert indicator */}
        {visibleAlerts.length > 1 && (
          <div className="flex justify-center gap-1 pb-1.5">
            {visibleAlerts.map((_, idx) => (
              <div
                key={idx}
                className="rounded-full transition-all"
                style={{
                  width: idx === (currentIdx % visibleAlerts.length) ? 12 : 4,
                  height: 3,
                  background: idx === (currentIdx % visibleAlerts.length) ? style.color : "rgba(255,255,255,0.1)",
                }}
              />
            ))}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}