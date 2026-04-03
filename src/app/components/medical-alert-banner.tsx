// ═══════════════════════════════════════════════════════════════
// FIX C: Medical Alert Forced Display
// ═══════════════════════════════════════════════════════════════
// CRITICAL: Admin MUST see medical data before dispatch
// Prevents deaths from allergic reactions, wrong blood type, etc.
// ═══════════════════════════════════════════════════════════════

import { useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, Heart } from "lucide-react";

interface MedicalAlertBannerProps {
  employee: {
    name: string;
    bloodType?: string;
    allergies?: string[];
    medications?: string[];
    conditions?: string[];
  };
  onAcknowledge: () => void;
}

export function MedicalAlertBanner({ employee, onAcknowledge }: MedicalAlertBannerProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  
  const hasMedicalData = 
    employee.bloodType || 
    (employee.allergies && employee.allergies.length > 0) || 
    (employee.medications && employee.medications.length > 0) ||
    (employee.conditions && employee.conditions.length > 0);

  // If no medical data or already acknowledged, don't show
  if (!hasMedicalData || acknowledged) return null;

  const handleAcknowledge = () => {
    setAcknowledged(true);
    onAcknowledge();
  };

  return (
    <motion.div
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, type: "spring", stiffness: 300 }}
      className="mb-4 p-5 rounded-2xl"
      style={{
        background: "linear-gradient(135deg, rgba(255,45,85,0.15), rgba(255,45,85,0.10))",
        border: "2px solid rgba(255,45,85,0.5)",
        boxShadow: "0 8px 32px rgba(255,45,85,0.4), 0 0 0 1px rgba(255,45,85,0.2)",
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <motion.div
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="p-2 rounded-full"
          style={{ background: "rgba(255,45,85,0.2)" }}
        >
          <AlertTriangle className="size-6" style={{ color: "#FF2D55" }} />
        </motion.div>
        <div className="flex-1">
          <h3 style={{
            fontSize: 18,
            fontWeight: 800,
            color: "#FF2D55",
            marginBottom: 4,
            letterSpacing: "-0.3px",
          }}>
            🩸 CRITICAL MEDICAL INFORMATION
          </h3>
          <p style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.6)",
            lineHeight: 1.5,
          }}>
            You MUST inform responders before dispatch. Wrong treatment could be fatal.
          </p>
        </div>
      </div>

      {/* Medical Data Grid */}
      <div className="space-y-3 mb-5">
        {employee.bloodType && (
          <div className="flex items-center gap-3">
            <div className="w-24 shrink-0">
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(255,255,255,0.4)",
                letterSpacing: "0.5px",
              }}>
                BLOOD TYPE
              </span>
            </div>
            <div className="px-4 py-2 rounded-xl" style={{
              background: "rgba(255,45,85,0.2)",
              border: "1px solid rgba(255,45,85,0.3)",
            }}>
              <span style={{
                fontSize: 16,
                fontWeight: 800,
                color: "#FF6080",
                letterSpacing: "0.5px",
              }}>
                🩸 {employee.bloodType}
              </span>
            </div>
          </div>
        )}

        {employee.allergies && employee.allergies.length > 0 && (
          <div className="flex items-start gap-3">
            <div className="w-24 shrink-0 pt-1">
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(255,255,255,0.4)",
                letterSpacing: "0.5px",
              }}>
                ALLERGIES
              </span>
            </div>
            <div className="flex-1 flex flex-wrap gap-2">
              {employee.allergies.map((allergy, i) => (
                <div
                  key={i}
                  className="px-3 py-2 rounded-lg"
                  style={{
                    background: "rgba(255,149,0,0.15)",
                    border: "1.5px solid rgba(255,149,0,0.4)",
                  }}
                >
                  <span style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#FF9500",
                  }}>
                    ⚠️ {allergy}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {employee.medications && employee.medications.length > 0 && (
          <div className="flex items-start gap-3">
            <div className="w-24 shrink-0 pt-1">
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(255,255,255,0.4)",
                letterSpacing: "0.5px",
              }}>
                MEDICATIONS
              </span>
            </div>
            <div className="flex-1">
              <span style={{
                fontSize: 13,
                color: "rgba(255,255,255,0.8)",
                lineHeight: 1.6,
              }}>
                💊 {employee.medications.join(", ")}
              </span>
            </div>
          </div>
        )}

        {employee.conditions && employee.conditions.length > 0 && (
          <div className="flex items-start gap-3">
            <div className="w-24 shrink-0 pt-1">
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(255,255,255,0.4)",
                letterSpacing: "0.5px",
              }}>
                CONDITIONS
              </span>
            </div>
            <div className="flex-1">
              <span style={{
                fontSize: 13,
                color: "rgba(255,255,255,0.8)",
                lineHeight: 1.6,
              }}>
                {employee.conditions.join(", ")}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Acknowledgment Button */}
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={handleAcknowledge}
        className="w-full px-6 py-4 rounded-xl"
        style={{
          background: "linear-gradient(135deg, #FF2D55, #D9193D)",
          boxShadow: "0 4px 20px rgba(255,45,85,0.5), inset 0 1px 0 rgba(255,255,255,0.1)",
        }}
      >
        <span style={{
          fontSize: 15,
          fontWeight: 800,
          color: "#fff",
          letterSpacing: "0.3px",
        }}>
          ✓ I've Informed Responders — Proceed
        </span>
      </motion.button>

      {/* Warning Footer */}
      <div className="mt-3 px-3 py-2 rounded-lg" style={{
        background: "rgba(255,45,85,0.08)",
        border: "1px solid rgba(255,45,85,0.15)",
      }}>
        <p style={{
          fontSize: 10,
          color: "rgba(255,255,255,0.5)",
          lineHeight: 1.5,
          textAlign: "center",
        }}>
          📞 Confirm you've told 997 dispatcher: "{employee.bloodType || 'Blood type'}{employee.allergies && employee.allergies.length > 0 ? `, allergic to ${employee.allergies.join(', ')}` : ''}"
        </p>
      </div>
    </motion.div>
  );
}
