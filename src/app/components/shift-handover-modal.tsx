// ═══════════════════════════════════════════════════════════════
// FIX D: Shift Handover Protocol
// ═══════════════════════════════════════════════════════════════
// CRITICAL: Admin cannot logout with active emergencies
// Prevents context loss during shift changes
// Ensures next admin knows what's happening
// ═══════════════════════════════════════════════════════════════

import { useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, Clock, MapPin, X } from "lucide-react";

export interface EmergencyForHandover {
  id: string;
  employeeName: string;
  zone: string;
  type: string;
  elapsed: number;
  status: string;
}

interface ShiftHandoverModalProps {
  activeEmergencies: EmergencyForHandover[];
  adminName: string;
  onComplete: (notes: string) => void;
  onEmergencyLogout: () => void;
  onCancel: () => void;
}

export function ShiftHandoverModal({
  activeEmergencies,
  adminName,
  onComplete,
  onEmergencyLogout,
  onCancel,
}: ShiftHandoverModalProps) {
  const [handoverNotes, setHandoverNotes] = useState("");
  const [confirmNextAdmin, setConfirmNextAdmin] = useState(false);

  const canComplete = handoverNotes.trim().length >= 20 && confirmNextAdmin;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[99999] flex items-center justify-center p-6"
      style={{
        background: "rgba(5,7,14,0.96)",
        backdropFilter: "blur(16px)",
      }}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="w-full max-w-2xl rounded-3xl overflow-y-auto"
        style={{
          background: "linear-gradient(135deg, rgba(255,45,85,0.10), rgba(255,149,0,0.08))",
          border: "2px solid rgba(255,45,85,0.4)",
          boxShadow: "0 20px 60px rgba(255,45,85,0.3)",
          maxHeight: "90vh",
          padding: "32px",
          scrollbarWidth: "none",
        }}
      >
        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          <div className="p-4 rounded-2xl" style={{ background: "rgba(255,45,85,0.15)" }}>
            <AlertTriangle className="size-8" style={{ color: "#FF2D55" }} />
          </div>
          <div className="flex-1">
            <h2 style={{
              fontSize: 24,
              fontWeight: 800,
              color: "#fff",
              marginBottom: 6,
              letterSpacing: "-0.5px",
            }}>
              ⚠️ Active Emergency Handover Required
            </h2>
            <p style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.6)",
              lineHeight: 1.6,
            }}>
              You cannot log out with {activeEmergencies.length} active {activeEmergencies.length === 1 ? 'emergency' : 'emergencies'}. 
              Complete handover to ensure continuity of care.
            </p>
          </div>
        </div>

        {/* Active Emergencies List */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="size-2 rounded-full" style={{ background: "#FF2D55" }} />
            <span style={{
              fontSize: 12,
              fontWeight: 700,
              color: "rgba(255,255,255,0.5)",
              letterSpacing: "0.5px",
            }}>
              ACTIVE EMERGENCIES ({activeEmergencies.length})
            </span>
          </div>
          
          <div className="space-y-2">
            {activeEmergencies.map((emg) => (
              <div
                key={emg.id}
                className="p-4 rounded-xl"
                style={{
                  background: "rgba(255,45,85,0.08)",
                  border: "1px solid rgba(255,45,85,0.2)",
                }}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="size-2 rounded-full animate-pulse" style={{ background: "#FF2D55" }} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>
                    {emg.employeeName}
                  </span>
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-md" style={{
                    background: "rgba(255,149,0,0.15)",
                    border: "1px solid rgba(255,149,0,0.3)",
                  }}>
                    <MapPin className="size-3" style={{ color: "#FF9500" }} />
                    <span style={{ fontSize: 10, fontWeight: 600, color: "#FF9500" }}>
                      {emg.zone}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                  <div className="flex items-center gap-1">
                    <Clock className="size-3" />
                    <span>{Math.floor(emg.elapsed / 60)}m {emg.elapsed % 60}s ago</span>
                  </div>
                  <span>•</span>
                  <span>{emg.type}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Handover Notes */}
        <div className="mb-6">
          <label style={{
            fontSize: 12,
            fontWeight: 700,
            color: "rgba(255,255,255,0.6)",
            marginBottom: 8,
            display: "block",
          }}>
            Handover Notes <span style={{ color: "#FF2D55" }}>*</span> (Required - minimum 20 characters)
          </label>
          <textarea
            value={handoverNotes}
            onChange={(e) => setHandoverNotes(e.target.value)}
            placeholder="What has been done? Current status? What should next admin do?&#10;&#10;Example: 'Ahmed: 997 called at 14:15, team dispatched, ETA 6 min. Fatima: Assessment in progress, waiting for call back.'"
            className="w-full px-4 py-3 rounded-xl"
            rows={5}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1.5px solid rgba(255,255,255,0.15)",
              color: "#fff",
              fontSize: 13,
              resize: "vertical",
              lineHeight: 1.6,
            }}
          />
          <div className="flex items-center justify-between mt-2">
            <p style={{
              fontSize: 10,
              color: handoverNotes.length < 20 ? "#FF2D55" : "rgba(255,255,255,0.4)",
            }}>
              {handoverNotes.length} / 20 characters minimum
            </p>
            {handoverNotes.trim().length >= 20 && (
              <span style={{ fontSize: 10, color: "#00C853" }}>✓ Acceptable</span>
            )}
          </div>
        </div>

        {/* Confirmation Checkbox */}
        <label className="flex items-start gap-3 mb-6 cursor-pointer p-4 rounded-xl hover:bg-white/5 transition-colors" style={{
          border: "1px solid rgba(255,255,255,0.1)",
        }}>
          <input
            type="checkbox"
            checked={confirmNextAdmin}
            onChange={(e) => setConfirmNextAdmin(e.target.checked)}
            className="mt-0.5"
            style={{ width: 16, height: 16 }}
          />
          <span style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.7)",
            lineHeight: 1.6,
            flex: 1,
          }}>
            I confirm the next admin is actively watching the dashboard and has been verbally briefed about these emergencies
          </span>
        </label>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <button
            disabled={!canComplete}
            onClick={() => {
              // Save handover notes
              const handoverData = {
                from: adminName,
                at: Date.now(),
                emergencies: activeEmergencies.map(e => ({
                  id: e.id,
                  employeeName: e.employeeName,
                  zone: e.zone,
                })),
                notes: handoverNotes,
              };
              
              localStorage.setItem("handover_notes", JSON.stringify(handoverData));
              onComplete(handoverNotes);
            }}
            className="px-6 py-4 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            style={{
              background: canComplete
                ? "linear-gradient(135deg, #00C853, #00A843)"
                : "rgba(255,255,255,0.05)",
              boxShadow: canComplete ? "0 4px 20px rgba(0,200,83,0.4)" : "none",
            }}
          >
            <span style={{
              fontSize: 15,
              fontWeight: 800,
              color: canComplete ? "#fff" : "rgba(255,255,255,0.3)",
            }}>
              ✓ Complete Handover & Logout
            </span>
          </button>

          <button
            onClick={onCancel}
            className="px-6 py-3 rounded-xl hover:bg-white/5 transition-colors"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <span style={{
              fontSize: 14,
              fontWeight: 600,
              color: "rgba(255,255,255,0.6)",
            }}>
              Cancel — Stay Logged In
            </span>
          </button>

          <button
            onClick={() => {
              if (confirm(
                `⚠️ EMERGENCY LOGOUT WARNING\n\nYou are about to log out with ${activeEmergencies.length} active emergencies without handover.\n\nThis could result in:\n• Delayed response times\n• Context loss\n• Preventable deaths\n\nYou accept full liability. Continue?`
              )) {
                // Log emergency logout
                const emergencyLogoutData = {
                  from: adminName,
                  at: Date.now(),
                  emergencyCount: activeEmergencies.length,
                  emergencyIds: activeEmergencies.map(e => e.id),
                  type: "emergency_logout_no_handover",
                };
                
                const logs = JSON.parse(localStorage.getItem("emergency_logout_log") || "[]");
                logs.push(emergencyLogoutData);
                localStorage.setItem("emergency_logout_log", JSON.stringify(logs));
                
                onEmergencyLogout();
              }
            }}
            className="px-6 py-2 rounded-xl hover:bg-red-500/10 transition-colors"
            style={{
              background: "transparent",
              border: "1px solid rgba(255,45,85,0.3)",
            }}
          >
            <span style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#FF2D55",
            }}>
              ⚠️ Emergency Logout — Accept Liability
            </span>
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
