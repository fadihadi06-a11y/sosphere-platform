// ═══════════════════════════════════════════════════════════════
// SOSphere — Unified Call Panel
// Reusable across: Employee Cards, Emergency Popup, Incident Reports
// Explains EXACTLY where the call comes from (Desktop vs Mobile)
// ═══════════════════════════════════════════════════════════════
import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Phone, MessageCircle, Copy, Check, X,
  Monitor, Smartphone, ChevronRight,
  Shield, Info, PhoneCall,
} from "lucide-react";
import { startAdminCall } from "./shared-store";
import { safeTelCall } from "./utils/safe-tel";

export type CallReason = "emergency" | "checkin" | "inquiry" | "warning" | "welfare";

export interface CallPanelProps {
  employeeName: string;
  employeeRole?: string;
  employeeDept?: string;
  phone: string;
  reason?: CallReason;
  onClose: () => void;
  onCallPlaced?: (method: "device" | "whatsapp" | "copy") => void;
}

const REASON_CONFIG: Record<CallReason, { label: string; color: string; icon: string }> = {
  emergency: { label: "Emergency Response",  color: "#FF2D55", icon: "🚨" },
  checkin:   { label: "Check-In Follow-up",  color: "#FF9500", icon: "⏰" },
  inquiry:   { label: "General Inquiry",     color: "#00C8E0", icon: "💬" },
  warning:   { label: "Safety Warning",      color: "#FFD60A", icon: "⚠️" },
  welfare:   { label: "Welfare Check",       color: "#00C853", icon: "✅" },
};

// ── Mini context note ─────────────────────────────────────────
function PlatformNote() {
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ border: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.02)" }}>
      <div className="px-3 py-2 flex items-center gap-2"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <Info className="size-3.5" style={{ color: "rgba(0,200,224,0.5)" }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.4px" }}>
          HOW THE CALL IS PLACED
        </span>
      </div>
      <div className="grid grid-cols-2 divide-x" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
        <div className="px-3 py-2.5 flex gap-2">
          <Monitor className="size-3.5 flex-shrink-0 mt-0.5" style={{ color: "rgba(0,200,224,0.6)" }} />
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(0,200,224,0.8)" }}>Desktop</p>
            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", lineHeight: 1.4, marginTop: 1 }}>
              Opens Skype, Teams, or FaceTime — whichever is set as your default calling app
            </p>
          </div>
        </div>
        <div className="px-3 py-2.5 flex gap-2">
          <Smartphone className="size-3.5 flex-shrink-0 mt-0.5" style={{ color: "rgba(0,200,83,0.6)" }} />
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(0,200,83,0.8)" }}>Mobile</p>
            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", lineHeight: 1.4, marginTop: 1 }}>
              Opens native phone dialer instantly — most direct
            </p>
          </div>
        </div>
      </div>
      <div className="px-3 py-2 flex items-start gap-2"
        style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: "rgba(255,255,255,0.01)" }}>
        <Shield className="size-3 flex-shrink-0 mt-0.5" style={{ color: "rgba(255,150,0,0.4)" }} />
        <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", lineHeight: 1.4 }}>
          For emergencies, <span style={{ color: "rgba(255,150,0,0.6)", fontWeight: 600 }}>Copy Number</span> and call from your personal phone for fastest response. WhatsApp works via WiFi if employee has no cellular signal.
        </p>
      </div>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────
export function CallPanel({
  employeeName, employeeRole, employeeDept,
  phone, reason = "inquiry",
  onClose, onCallPlaced,
}: CallPanelProps) {
  const [copied, setCopied] = useState(false);
  const [callDone, setCallDone] = useState<"device" | "whatsapp" | "copy" | null>(null);
  const cfg = REASON_CONFIG[reason];

  const handleDeviceCall = () => {
    safeTelCall(phone, employeeName);
    setCallDone("device");
    onCallPlaced?.("device");
    // Trigger active call mini-bar in admin dashboard
    startAdminCall({
      employeeId: `EMP-CALL-${Date.now()}`,
      employeeName,
      employeeRole,
      startedAt: Date.now(),
    });
  };

  const handleWhatsApp = () => {
    const num = phone.replace(/[\s+\-\(\)]/g, "");
    window.open(`https://wa.me/${num}`);
    setCallDone("whatsapp");
    onCallPlaced?.("whatsapp");
  };

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(phone); } catch {}
    setCopied(true);
    setCallDone("copy");
    onCallPlaced?.("copy");
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 8 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: "rgba(5,9,20,0.99)",
        border: `1px solid ${cfg.color}30`,
        backdropFilter: "blur(24px)",
        boxShadow: `0 12px 40px rgba(0,0,0,0.8), 0 0 0 1px ${cfg.color}10`,
        fontFamily: "'Outfit', sans-serif",
        width: 300,
      }}
    >
      {/* ── Header ── */}
      <div className="px-4 py-3 flex items-center gap-3"
        style={{
          background: `linear-gradient(135deg, ${cfg.color}12, transparent)`,
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}>
        {/* Avatar */}
        <div className="size-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${cfg.color}15`, border: `1px solid ${cfg.color}25` }}>
          <span style={{ fontSize: 16 }}>{cfg.icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p style={{ fontSize: 13, fontWeight: 800, color: "rgba(255,255,255,0.95)" }}>
            {employeeName}
          </p>
          {(employeeRole || employeeDept) && (
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
              {employeeRole}{employeeDept ? ` · ${employeeDept}` : ""}
            </p>
          )}
          <div className="flex items-center gap-1.5 mt-1.5">
            <PhoneCall className="size-3" style={{ color: `${cfg.color}80` }} />
            <span style={{ fontSize: 10, color: cfg.color, fontWeight: 700 }}>
              {cfg.label}
            </span>
          </div>
        </div>
        <button onClick={onClose}
          className="size-7 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: "rgba(255,255,255,0.05)" }}>
          <X className="size-4" style={{ color: "rgba(255,255,255,0.35)" }} />
        </button>
      </div>

      {/* ── Phone number ── */}
      <div className="px-4 py-2.5 flex items-center gap-2"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <Phone className="size-3.5" style={{ color: "rgba(255,255,255,0.25)" }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", letterSpacing: "0.3px" }}>
          {phone}
        </span>
      </div>

      {/* ── Options ── */}
      <div className="p-3 space-y-2">
        {/* Device Call */}
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handleDeviceCall}
          className="w-full flex items-center gap-3 p-3 rounded-2xl text-left"
          style={{
            background: callDone === "device"
              ? "rgba(0,200,83,0.08)"
              : `linear-gradient(135deg, ${cfg.color}14, ${cfg.color}04)`,
            border: callDone === "device"
              ? "1px solid rgba(0,200,83,0.25)"
              : `1px solid ${cfg.color}22`,
          }}
        >
          <div className="size-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: callDone === "device" ? "rgba(0,200,83,0.15)" : `${cfg.color}18` }}>
            {callDone === "device"
              ? <Check className="size-4" style={{ color: "#00C853" }} />
              : <Phone className="size-4" style={{ color: cfg.color }} />
            }
          </div>
          <div className="flex-1 min-w-0">
            <p style={{ fontSize: 12, fontWeight: 700, color: callDone === "device" ? "#00C853" : "rgba(255,255,255,0.9)" }}>
              {callDone === "device" ? "Call opened!" : "Call via Device"}
            </p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
              Desktop → Skype/Teams · Mobile → native dialer
            </p>
          </div>
          {callDone !== "device" && (
            <ChevronRight className="size-4 flex-shrink-0" style={{ color: "rgba(255,255,255,0.2)" }} />
          )}
        </motion.button>

        {/* WhatsApp */}
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handleWhatsApp}
          className="w-full flex items-center gap-3 p-3 rounded-2xl text-left"
          style={{
            background: callDone === "whatsapp" ? "rgba(0,200,83,0.08)" : "rgba(37,211,102,0.07)",
            border: callDone === "whatsapp" ? "1px solid rgba(0,200,83,0.25)" : "1px solid rgba(37,211,102,0.18)",
          }}
        >
          <div className="size-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: callDone === "whatsapp" ? "rgba(0,200,83,0.15)" : "rgba(37,211,102,0.15)" }}>
            {callDone === "whatsapp"
              ? <Check className="size-4" style={{ color: "#00C853" }} />
              : <MessageCircle className="size-4" style={{ color: "#25D366" }} />
            }
          </div>
          <div className="flex-1 min-w-0">
            <p style={{ fontSize: 12, fontWeight: 700, color: callDone === "whatsapp" ? "#00C853" : "rgba(255,255,255,0.9)" }}>
              {callDone === "whatsapp" ? "WhatsApp opened!" : "Open WhatsApp"}
            </p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
              Works globally · WiFi fallback if no cellular
            </p>
          </div>
          {callDone !== "whatsapp" && (
            <ChevronRight className="size-4 flex-shrink-0" style={{ color: "rgba(255,255,255,0.2)" }} />
          )}
        </motion.button>

        {/* Copy */}
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handleCopy}
          className="w-full flex items-center gap-3 p-3 rounded-2xl text-left"
          style={{
            background: copied ? "rgba(0,200,83,0.08)" : "rgba(255,255,255,0.03)",
            border: copied ? "1px solid rgba(0,200,83,0.2)" : "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <div className="size-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: copied ? "rgba(0,200,83,0.15)" : "rgba(255,255,255,0.05)" }}>
            {copied
              ? <Check className="size-4" style={{ color: "#00C853" }} />
              : <Copy className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
            }
          </div>
          <div className="flex-1 min-w-0">
            <p style={{ fontSize: 12, fontWeight: 700, color: copied ? "#00C853" : "rgba(255,255,255,0.9)" }}>
              {copied ? "Copied to clipboard!" : "Copy Number"}
            </p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
              Dial from personal phone or desk phone
            </p>
          </div>
        </motion.button>
      </div>

      {/* ── Platform note ── */}
      <div className="px-3 pb-3">
        <PlatformNote />
      </div>
    </motion.div>
  );
}

// ── Inline Trigger (used on employee cards) ───────────────────
export function CallTrigger({
  employeeName, employeeRole, employeeDept,
  phone, reason = "inquiry",
  size = "md",
  className = "",
}: {
  employeeName: string;
  employeeRole?: string;
  employeeDept?: string;
  phone: string;
  reason?: CallReason;
  size?: "sm" | "md";
  className?: string;
}) {
  const [show, setShow] = useState(false);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const cfg = REASON_CONFIG[reason];

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAnchor({ x: rect.left, y: rect.bottom + 8 });
    setShow(true);
  };

  return (
    <>
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={handleClick}
        className={`flex items-center justify-center gap-1.5 rounded-xl ${className}`}
        style={{
          background: `${cfg.color}10`,
          border: `1px solid ${cfg.color}20`,
          padding: size === "sm" ? "5px 10px" : "7px 14px",
        }}
      >
        <Phone className={size === "sm" ? "size-3" : "size-3.5"} style={{ color: cfg.color }} />
        <span style={{ fontSize: size === "sm" ? 10 : 11, fontWeight: 700, color: cfg.color }}>
          Call
        </span>
      </motion.button>

      {/* Floating panel */}
      <AnimatePresence>
        {show && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[300]"
              style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
              onClick={() => setShow(false)}
            />
            {/* Centered panel */}
            <div className="fixed inset-0 z-[301] flex items-center justify-center pointer-events-none">
              <div className="pointer-events-auto">
                <CallPanel
                  employeeName={employeeName}
                  employeeRole={employeeRole}
                  employeeDept={employeeDept}
                  phone={phone}
                  reason={reason}
                  onClose={() => setShow(false)}
                  onCallPlaced={() => setTimeout(() => setShow(false), 1800)}
                />
              </div>
            </div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
