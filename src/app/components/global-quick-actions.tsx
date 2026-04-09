// ═══════════════════════════════════════════════════════════════
// SOSphere Global Quick Actions — Apple-grade Floating Menu
// Minimal, fast, always accessible
// ═══════════════════════════════════════════════════════════════
import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Zap, Plus, Megaphone, Target, Search, AlertTriangle, X } from "lucide-react";

interface QuickActionsProps {
  onCreateEmergency: () => void;
  onBroadcast: () => void;
  onEvacuation: () => void;
  onSearch: () => void;
}

export function GlobalQuickActions({ onCreateEmergency, onBroadcast, onEvacuation, onSearch }: QuickActionsProps) {
  const [isOpen, setIsOpen] = useState(false);

  const actions = [
    { icon: AlertTriangle, label: "Emergency", color: "#FF2D55", action: onCreateEmergency, hotkey: "E" },
    { icon: Megaphone, label: "Broadcast", color: "#FF9500", action: onBroadcast, hotkey: "B" },
    { icon: Target, label: "Evacuation", color: "#AF52DE", action: onEvacuation, hotkey: "V" },
    { icon: Search, label: "Search", color: "#00C8E0", action: onSearch, hotkey: "K" },
  ];

  return (
    <>
      {/* Main FAB */}
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="fixed bottom-8 right-8 size-14 rounded-2xl flex items-center justify-center z-[9998]"
        style={{
          background: "linear-gradient(135deg, #00C8E0 0%, #0099B8 100%)",
          boxShadow: isOpen
            ? "0 8px 32px rgba(0,200,224,0.3), inset 0 1px 0 rgba(255,255,255,0.2)"
            : "0 12px 40px rgba(0,200,224,0.4), 0 0 0 4px rgba(0,200,224,0.08)",
          border: "1px solid rgba(255,255,255,0.15)",
        }}
      >
        <AnimatePresence mode="wait">
          {isOpen ? (
            <motion.div 
              key="close" 
              initial={{ rotate: -90, scale: 0.8 }} 
              animate={{ rotate: 0, scale: 1 }} 
              exit={{ rotate: 90, scale: 0.8 }}
              transition={{ duration: 0.2 }}
            >
              <X className="size-6 text-white" strokeWidth={2.5} />
            </motion.div>
          ) : (
            <motion.div 
              key="open" 
              initial={{ rotate: 90, scale: 0.8 }} 
              animate={{ rotate: 0, scale: 1 }} 
              exit={{ rotate: -90, scale: 0.8 }}
              transition={{ duration: 0.2 }}
            >
              <Zap className="size-6 text-white" strokeWidth={2.5} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Action Menu */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 z-[9997]"
              style={{ background: "rgba(10, 14, 23, 0.7)", backdropFilter: "blur(12px)" }}
            />

            {/* Actions */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className="fixed bottom-28 right-8 z-[9998] grid gap-2"
              style={{ width: 280 }}
            >
              {actions.map((action, i) => {
                const Icon = action.icon;
                return (
                  <motion.button
                    key={action.label}
                    initial={{ opacity: 0, x: 40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 40 }}
                    transition={{ delay: i * 0.04, type: "spring", stiffness: 400, damping: 25 }}
                    onClick={() => {
                      action.action();
                      setIsOpen(false);
                    }}
                    whileHover={{ x: -4, scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl relative overflow-hidden group"
                    style={{
                      background: "rgba(13,17,23,0.95)",
                      border: `1px solid rgba(255,255,255,0.08)`,
                      backdropFilter: "blur(24px)",
                      boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
                    }}
                  >
                    {/* Hover glow */}
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                      style={{ background: `radial-gradient(circle at 20% 50%, ${action.color}10 0%, transparent 70%)` }}
                    />

                    {/* Icon */}
                    <div
                      className="size-10 rounded-xl flex items-center justify-center shrink-0 relative z-10"
                      style={{ 
                        background: `${action.color}12`, 
                        border: `1px solid ${action.color}20`,
                        boxShadow: `0 0 16px ${action.color}08`
                      }}
                    >
                      <Icon className="size-5" style={{ color: action.color }} strokeWidth={2} />
                    </div>

                    {/* Label */}
                    <div className="flex-1 text-left relative z-10">
                      <p className="text-white font-semibold" style={{ fontSize: 14, letterSpacing: "-0.2px" }}>
                        {action.label}
                      </p>
                    </div>

                    {/* Hotkey */}
                    <div
                      className="px-2 py-1 rounded-md relative z-10"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                    >
                      <span className="font-mono font-semibold" style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
                        ⌘{action.hotkey}
                      </span>
                    </div>
                  </motion.button>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}