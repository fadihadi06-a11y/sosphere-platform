import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Megaphone, AlertTriangle, Siren, Bell, X } from "lucide-react";
import { onBroadcastReceived, type BroadcastMessage, type BroadcastPriority } from "./shared-store";

// ═══════════════════════════════════════════════════════════════
// Dynamic Island — Broadcast Alert Pill
// Appears at top of mobile app when a broadcast is received
// Matches iPhone 14 Pro Dynamic Island visual language
// ═══════════════════════════════════════════════════════════════

const PRIORITY_STYLE: Record<BroadcastPriority, { color: string; glow: string; icon: any }> = {
  emergency: { color: "#FF2D55", glow: "rgba(255,45,85,0.4)", icon: Siren },
  urgent: { color: "#FF9500", glow: "rgba(255,150,0,0.3)", icon: AlertTriangle },
  normal: { color: "#00C8E0", glow: "rgba(0,200,224,0.3)", icon: Bell },
  info: { color: "rgba(255,255,255,0.4)", glow: "rgba(255,255,255,0.1)", icon: Megaphone },
};

const AUTO_DISMISS_MS = 6000; // 6 seconds

export function BroadcastIsland() {
  const [currentBroadcast, setCurrentBroadcast] = useState<BroadcastMessage | null>(null);
  const [expanded, setExpanded] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = onBroadcastReceived((msg) => {
      setCurrentBroadcast(msg);
      setExpanded(false);

      // Auto-dismiss after timeout
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(() => {
        setCurrentBroadcast(null);
        setExpanded(false);
      }, AUTO_DISMISS_MS);
    });
    return () => {
      unsub();
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  const dismiss = () => {
    setCurrentBroadcast(null);
    setExpanded(false);
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
  };

  if (!currentBroadcast) return null;

  const style = PRIORITY_STYLE[currentBroadcast.priority];
  const Icon = style.icon;

  return (
    <AnimatePresence>
      {currentBroadcast && (
        <motion.div
          key={currentBroadcast.id}
          initial={{ y: -60, opacity: 0, scale: 0.8 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -40, opacity: 0, scale: 0.85 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="absolute top-1 left-1/2 z-[60]"
          style={{ transform: "translateX(-50%)" }}
          onClick={() => {
            if (!expanded) {
              setExpanded(true);
              // Reset auto-dismiss when expanded
              if (dismissTimer.current) clearTimeout(dismissTimer.current);
              dismissTimer.current = setTimeout(dismiss, AUTO_DISMISS_MS * 2);
            }
          }}
        >
          <motion.div
            layout
            className="relative overflow-hidden"
            style={{
              borderRadius: expanded ? 22 : 28,
              background: "linear-gradient(135deg, #1A1A2E 0%, #0D0D1A 100%)",
              border: `1px solid ${style.color}30`,
              boxShadow: `0 4px 24px rgba(0,0,0,0.5), 0 0 20px ${style.glow}`,
              minWidth: expanded ? 340 : 200,
              maxWidth: 360,
            }}
          >
            {/* Ambient glow line */}
            <motion.div
              className="absolute top-0 left-0 right-0 h-[2px]"
              style={{
                background: `linear-gradient(90deg, transparent, ${style.color}, transparent)`,
              }}
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 2, repeat: Infinity }}
            />

            {/* Collapsed: pill view */}
            <div className="flex items-center gap-2.5 px-4 py-2.5">
              {/* Pulsing icon */}
              <motion.div
                animate={currentBroadcast.priority === "emergency" ? { scale: [1, 1.2, 1] } : {}}
                transition={{ duration: 1, repeat: Infinity }}
                className="size-6 rounded-full flex items-center justify-center shrink-0"
                style={{
                  background: `${style.color}20`,
                  boxShadow: `0 0 8px ${style.glow}`,
                }}
              >
                <Icon style={{ width: 12, height: 12, color: style.color }} />
              </motion.div>

              {/* Title */}
              <div className="flex-1 min-w-0">
                <p className="truncate" style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#fff",
                  letterSpacing: "-0.2px",
                }}>
                  {currentBroadcast.title}
                </p>
                {!expanded && (
                  <p className="truncate" style={{
                    fontSize: 9,
                    color: style.color,
                    fontWeight: 600,
                    opacity: 0.7,
                  }}>
                    {currentBroadcast.audienceLabel}
                  </p>
                )}
              </div>

              {/* Priority badge */}
              <span className="px-1.5 py-0.5 rounded-full shrink-0" style={{
                fontSize: 7,
                fontWeight: 900,
                color: style.color,
                background: `${style.color}15`,
                letterSpacing: "0.5px",
              }}>
                {currentBroadcast.priority === "emergency" ? "SOS" : currentBroadcast.priority.toUpperCase()}
              </span>

              {/* Dismiss */}
              <button
                onClick={(e) => { e.stopPropagation(); dismiss(); }}
                className="size-5 rounded-full flex items-center justify-center shrink-0"
                style={{ background: "rgba(255,255,255,0.06)" }}
              >
                <X style={{ width: 8, height: 8, color: "rgba(255,255,255,0.3)" }} />
              </button>
            </div>

            {/* Expanded: message body */}
            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-3 pt-0">
                    <div className="h-px mb-2.5" style={{ background: `${style.color}15` }} />
                    <p style={{
                      fontSize: 11,
                      color: "rgba(255,255,255,0.5)",
                      lineHeight: 1.6,
                    }}>
                      {currentBroadcast.body}
                    </p>
                    <div className="flex items-center gap-2 mt-2.5">
                      <span style={{ fontSize: 8, color: "rgba(255,255,255,0.15)", fontWeight: 600 }}>
                        from {currentBroadcast.senderName}
                      </span>
                      <span style={{ fontSize: 8, color: style.color, fontWeight: 600 }}>
                        {currentBroadcast.audienceLabel}
                      </span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
