// ═══════════════════════════════════════════════════════════════
// MANUAL PRIORITY MODAL — Bottom sheet for priority override (Mobile)
// Mirrors ManualPriorityModal.tsx from web
// ═══════════════════════════════════════════════════════════════
import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { AlertTriangle, ArrowUp, X, Shield, FileText } from "lucide-react";

interface ManualPriorityModalProps {
  isOpen: boolean;
  emergencyId: string;
  currentPosition: number;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  t: (k: string) => string;
}

const QUICK_REASONS = [
  { key: "mp.vipThreat",    icon: Shield },
  { key: "mp.massCasualty",  icon: AlertTriangle },
  { key: "mp.imminent",     icon: ArrowUp },
  { key: "mp.executiveOrder", icon: FileText },
];

export function ManualPriorityModal({ isOpen, emergencyId, currentPosition, onConfirm, onCancel, t }: ManualPriorityModalProps) {
  const [reason, setReason] = useState("");
  const [selectedQuick, setSelectedQuick] = useState<string | null>(null);

  const handleConfirm = () => {
    const finalReason = selectedQuick ? t(selectedQuick) : reason;
    if (!finalReason.trim()) return;
    onConfirm(finalReason);
    setReason("");
    setSelectedQuick(null);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[90]"
            style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
            onClick={onCancel}
          />

          {/* Bottom Sheet */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
            className="absolute bottom-0 left-0 right-0 z-[91] rounded-t-2xl"
            style={{
              background: "#0A1220",
              border: "1px solid rgba(255,255,255,0.06)",
              borderBottom: "none",
            }}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-8 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }} />
            </div>

            <div className="px-4 pb-8 space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="size-8 rounded-lg flex items-center justify-center"
                    style={{ background: "rgba(255,179,0,0.1)" }}
                  >
                    <ArrowUp className="size-4" style={{ color: "#FFB300" }} />
                  </div>
                  <div>
                    <h3 className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>
                      {t("mp.title")}
                    </h3>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                      {emergencyId} — {t("mp.position")} #{currentPosition + 1}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onCancel}
                  className="size-7 rounded-lg flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.05)" }}
                >
                  <X className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
                </button>
              </div>

              {/* Warning */}
              <div
                className="rounded-xl px-3 py-2.5"
                style={{
                  background: "rgba(255,179,0,0.06)",
                  border: "1px solid rgba(255,179,0,0.12)",
                }}
              >
                <p style={{ fontSize: 10, color: "#FFB300", fontWeight: 500, lineHeight: 1.5 }}>
                  {t("mp.warning")}
                </p>
              </div>

              {/* Quick Reasons */}
              <div>
                <p style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 8 }}>
                  {t("mp.quickReasons")}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {QUICK_REASONS.map(qr => {
                    const active = selectedQuick === qr.key;
                    return (
                      <button
                        key={qr.key}
                        onClick={() => {
                          setSelectedQuick(active ? null : qr.key);
                          if (!active) setReason("");
                        }}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-left"
                        style={{
                          background: active ? "rgba(255,179,0,0.08)" : "rgba(255,255,255,0.02)",
                          border: `1px solid ${active ? "rgba(255,179,0,0.2)" : "rgba(255,255,255,0.04)"}`,
                        }}
                      >
                        <qr.icon className="size-3.5 flex-shrink-0" style={{ color: active ? "#FFB300" : "rgba(255,255,255,0.25)" }} />
                        <span style={{ fontSize: 10, fontWeight: 500, color: active ? "#FFB300" : "rgba(255,255,255,0.5)" }}>
                          {t(qr.key)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom reason */}
              {!selectedQuick && (
                <div>
                  <p style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 6 }}>
                    {t("mp.customReason")}
                  </p>
                  <textarea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder={t("mp.placeholder")}
                    rows={2}
                    className="w-full px-3 py-2.5 rounded-xl bg-transparent text-white outline-none resize-none"
                    style={{
                      fontSize: 11,
                      border: "1px solid rgba(255,255,255,0.06)",
                      background: "rgba(255,255,255,0.02)",
                    }}
                  />
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={onCancel}
                  className="flex-1 py-2.5 rounded-xl"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "rgba(255,255,255,0.4)",
                  }}
                >
                  {t("mp.cancel")}
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={!selectedQuick && !reason.trim()}
                  className="flex-1 py-2.5 rounded-xl flex items-center justify-center gap-1.5"
                  style={{
                    background: (selectedQuick || reason.trim())
                      ? "linear-gradient(135deg, #FFB300 0%, #FF9500 100%)"
                      : "rgba(255,255,255,0.04)",
                    fontSize: 12,
                    fontWeight: 700,
                    color: (selectedQuick || reason.trim()) ? "#fff" : "rgba(255,255,255,0.2)",
                    boxShadow: (selectedQuick || reason.trim()) ? "0 4px 16px rgba(255,179,0,0.25)" : "none",
                  }}
                >
                  <ArrowUp className="size-3.5" />
                  {t("mp.confirm")}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
