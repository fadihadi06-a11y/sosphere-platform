// ═══════════════════════════════════════════════════════════════
// SOSphere — PDF Email Delivery Simulation Modal
// Professional glassmorphism modal for simulated secure email
// delivery of encrypted PDF reports
// ═══════════════════════════════════════════════════════════════

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Mail, Send, X, Plus, Lock, Shield,
  CheckCircle2, FileText, Users, Paperclip,
  AlertTriangle, Loader2, Globe, ChevronDown,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────
interface EmailRecipient {
  email: string;
  name: string;
  role?: string;
  valid: boolean;
}

interface PdfEmailModalProps {
  open: boolean;
  onClose: () => void;
  reportTitle: string;
  reportSize?: string;
  isEncrypted: boolean;
  encryptionPassword?: string;
  onSent?: (recipients: string[]) => void;
}

// ── Mock Team Members ──────────────────────────────────────────
const MOCK_TEAM: { email: string; name: string; role: string }[] = [
  { email: "sarah.johnson@sosphere.com", name: "Sarah Johnson", role: "Safety Director" },
  { email: "ahmed.khalil@sosphere.com", name: "Ahmed Khalil", role: "Zone Admin - A" },
  { email: "maria.santos@sosphere.com", name: "Maria Santos", role: "Compliance Manager" },
  { email: "james.chen@sosphere.com", name: "James Chen", role: "HR Director" },
  { email: "fatima.noor@sosphere.com", name: "Fatima Noor", role: "Zone Admin - B" },
  { email: "david.miller@sosphere.com", name: "David Miller", role: "Operations Lead" },
  { email: "lisa.park@sosphere.com", name: "Lisa Park", role: "Legal Counsel" },
  { email: "omar.hassan@sosphere.com", name: "Omar Hassan", role: "Insurance Liaison" },
];

// ── Email Validator ────────────────────────────────────────────
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Delivery Stages ────────────────────────────────────────────
const DELIVERY_STAGES = [
  { label: "Preparing secure package...", icon: FileText, duration: 800 },
  { label: "Applying encryption layer...", icon: Lock, duration: 1000 },
  { label: "Validating recipient addresses...", icon: Users, duration: 600 },
  { label: "Connecting to secure SMTP...", icon: Globe, duration: 900 },
  { label: "Transmitting encrypted payload...", icon: Send, duration: 1200 },
  { label: "Confirming delivery status...", icon: CheckCircle2, duration: 700 },
];

// ═══════════════════════════════════════════════════════════════
// MAIN MODAL
// ═══════════════════════════════════════════════════════════════
export function PdfEmailModal({
  open,
  onClose,
  reportTitle,
  reportSize = "2.4 MB",
  isEncrypted,
  encryptionPassword,
  onSent,
}: PdfEmailModalProps) {
  const [recipients, setRecipients] = useState<EmailRecipient[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [includePassword, setIncludePassword] = useState(false);
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [sendingState, setSendingState] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [currentStage, setCurrentStage] = useState(0);
  const [deliveryId, setDeliveryId] = useState("");
  const emailInputRef = useRef<HTMLInputElement>(null);

  // Set default subject when modal opens
  useEffect(() => {
    if (open) {
      setSubject(`SOSphere Report: ${reportTitle}`);
      setMessage("");
      setRecipients([]);
      setNewEmail("");
      setIncludePassword(false);
      setSendingState("idle");
      setCurrentStage(0);
      setShowTeamPicker(false);
    }
  }, [open, reportTitle]);

  const addRecipient = (email: string, name?: string, role?: string) => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || recipients.some(r => r.email === trimmed)) return;
    setRecipients(prev => [...prev, {
      email: trimmed,
      name: name || trimmed.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      role,
      valid: isValidEmail(trimmed),
    }]);
    setNewEmail("");
  };

  const removeRecipient = (email: string) => {
    setRecipients(prev => prev.filter(r => r.email !== email));
  };

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addRecipient(newEmail);
    }
  };

  const validRecipients = recipients.filter(r => r.valid);
  const canSend = validRecipients.length > 0 && subject.trim().length > 0;

  // ── Simulated Send ────────────────────────────────────────────
  const handleSend = async () => {
    if (!canSend) return;
    setSendingState("sending");
    setCurrentStage(0);
    const id = `DLV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    setDeliveryId(id);

    // Walk through delivery stages
    const stages = isEncrypted ? DELIVERY_STAGES : DELIVERY_STAGES.filter(s => s.label !== "Applying encryption layer...");
    for (let i = 0; i < stages.length; i++) {
      setCurrentStage(i);
      await new Promise(resolve => setTimeout(resolve, stages[i].duration));
    }

    // Always succeed when all delivery stages complete (no fake failures)
    setSendingState("success");
    onSent?.(validRecipients.map(r => r.email));
  };

  const activeStages = isEncrypted ? DELIVERY_STAGES : DELIVERY_STAGES.filter(s => s.label !== "Applying encryption layer...");

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[410] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(16px)" }}
        >
          <motion.div
            initial={{ scale: 0.88, y: 30, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, y: 20, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="relative w-full max-w-lg mx-4"
            style={{
              background: "linear-gradient(180deg, #0E1529 0%, #080C18 100%)",
              borderRadius: 24,
              border: "1px solid rgba(0,200,224,0.12)",
              boxShadow: "0 40px 100px rgba(0,0,0,0.7), 0 0 60px rgba(0,200,224,0.05)",
              overflow: "hidden",
              maxHeight: "92vh",
            }}
          >
            <div style={{ maxHeight: "92vh", overflowY: "auto" }}>
              {/* Decorative top glow */}
              <div className="absolute top-0 left-0 right-0 h-px"
                style={{ background: "linear-gradient(90deg, transparent, rgba(0,200,224,0.3), transparent)" }} />

              {/* ── SUCCESS STATE ──────────────────────────────── */}
              <AnimatePresence mode="wait">
                {sendingState === "success" ? (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="px-6 py-10 flex flex-col items-center text-center"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 300, delay: 0.1 }}
                      className="size-16 rounded-full flex items-center justify-center mb-5"
                      style={{ background: "rgba(0,200,83,0.08)", border: "2px solid rgba(0,200,83,0.2)" }}
                    >
                      <CheckCircle2 className="size-8" style={{ color: "#00C853" }} />
                    </motion.div>
                    <h3 style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: "-0.3px" }}>
                      Delivery Successful
                    </h3>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 6, lineHeight: 1.6 }}>
                      Report sent to {validRecipients.length} recipient{validRecipients.length > 1 ? "s" : ""} via secure email
                    </p>

                    {/* Delivery Details */}
                    <div className="w-full mt-6 space-y-2">
                      <div className="flex items-center justify-between px-4 py-2.5 rounded-xl"
                        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Delivery ID</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#00C8E0", fontFamily: "monospace" }}>{deliveryId}</span>
                      </div>
                      <div className="flex items-center justify-between px-4 py-2.5 rounded-xl"
                        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Encryption</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: isEncrypted ? "#00C853" : "rgba(255,255,255,0.4)" }}>
                          {isEncrypted ? "AES-Encrypted" : "Standard"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between px-4 py-2.5 rounded-xl"
                        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Timestamp</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>
                          {new Date().toLocaleString()}
                        </span>
                      </div>
                      {isEncrypted && includePassword && (
                        <div className="flex items-center justify-between px-4 py-2.5 rounded-xl"
                          style={{ background: "rgba(255,149,0,0.03)", border: "1px solid rgba(255,149,0,0.08)" }}>
                          <span style={{ fontSize: 10, color: "rgba(255,149,0,0.6)" }}>Password included in email</span>
                          <AlertTriangle className="size-3" style={{ color: "#FF9500" }} />
                        </div>
                      )}
                    </div>

                    {/* Recipients Summary */}
                    <div className="w-full mt-4">
                      <p style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 6, textAlign: "left" }}>Delivered To</p>
                      <div className="space-y-1.5">
                        {validRecipients.map(r => (
                          <div key={r.email} className="flex items-center gap-2 px-3 py-2 rounded-lg"
                            style={{ background: "rgba(0,200,83,0.03)", border: "1px solid rgba(0,200,83,0.06)" }}>
                            <CheckCircle2 className="size-3 shrink-0" style={{ color: "#00C853" }} />
                            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{r.name}</span>
                            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginLeft: "auto" }}>{r.email}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-6 flex gap-2 w-full">
                      <motion.button
                        whileTap={{ scale: 0.96 }}
                        onClick={() => {
                          const receipt = [
                            `SOSphere Email Delivery Receipt`,
                            `──────────────────────────`,
                            `Delivery ID: ${deliveryId}`,
                            `Date: ${new Date().toLocaleString()}`,
                            `Report: ${reportTitle}`,
                            `Recipients: ${validRecipients.map(r => `${r.name} <${r.email}>`).join(", ")}`,
                            `Encryption: ${isEncrypted ? "AES-Encrypted" : "Standard"}`,
                            `Status: Delivered Successfully`,
                            `──────────────────────────`,
                            `This receipt was auto-generated by SOSphere.`,
                          ].join("\n");
                          const blob = new Blob([receipt], { type: "text/plain" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `SOSphere_Email_Receipt_${deliveryId}.txt`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl"
                        style={{
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid rgba(255,255,255,0.08)",
                          fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.45)", cursor: "pointer",
                        }}
                      >
                        <Globe className="size-3.5" /> Receipt
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.96 }}
                        onClick={onClose}
                        className="flex-1 py-3 rounded-xl"
                        style={{
                          background: "linear-gradient(135deg, rgba(0,200,224,0.12), rgba(0,200,224,0.04))",
                          border: "1px solid rgba(0,200,224,0.2)",
                          fontSize: 13, fontWeight: 700, color: "#00C8E0", cursor: "pointer",
                        }}
                      >
                        Done
                      </motion.button>
                    </div>
                  </motion.div>

                ) : sendingState === "sending" ? (
                  /* ── SENDING STATE ──────────────────────────────── */
                  <motion.div
                    key="sending"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="px-6 py-10 flex flex-col items-center"
                  >
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                      className="size-14 rounded-full flex items-center justify-center mb-6"
                      style={{ background: "rgba(0,200,224,0.06)", border: "1.5px solid rgba(0,200,224,0.15)" }}
                    >
                      <Loader2 className="size-7" style={{ color: "#00C8E0" }} />
                    </motion.div>
                    <h3 style={{ fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: "-0.3px", marginBottom: 20 }}>
                      Sending Secure Email
                    </h3>

                    {/* Stage Progress */}
                    <div className="w-full space-y-2">
                      {activeStages.map((stage, i) => {
                        const StageIcon = stage.icon;
                        const isActive = i === currentStage;
                        const isDone = i < currentStage;
                        return (
                          <motion.div
                            key={stage.label}
                            initial={{ opacity: 0.3 }}
                            animate={{ opacity: isDone || isActive ? 1 : 0.3 }}
                            className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
                            style={{
                              background: isActive ? "rgba(0,200,224,0.04)" : "rgba(255,255,255,0.01)",
                              border: `1px solid ${isActive ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.02)"}`,
                            }}
                          >
                            {isDone ? (
                              <CheckCircle2 className="size-4 shrink-0" style={{ color: "#00C853" }} />
                            ) : isActive ? (
                              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                                <Loader2 className="size-4 shrink-0" style={{ color: "#00C8E0" }} />
                              </motion.div>
                            ) : (
                              <StageIcon className="size-4 shrink-0" style={{ color: "rgba(255,255,255,0.1)" }} />
                            )}
                            <span style={{
                              fontSize: 11, fontWeight: isActive ? 700 : 500,
                              color: isDone ? "rgba(0,200,83,0.6)" : isActive ? "#00C8E0" : "rgba(255,255,255,0.2)",
                            }}>
                              {stage.label}
                            </span>
                          </motion.div>
                        );
                      })}
                    </div>

                    {/* Progress bar */}
                    <div className="w-full mt-5 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: "linear-gradient(90deg, #00C8E0, #00C853)" }}
                        animate={{ width: `${((currentStage + 1) / activeStages.length) * 100}%` }}
                        transition={{ duration: 0.5 }}
                      />
                    </div>
                    <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginTop: 8 }}>
                      Step {currentStage + 1} of {activeStages.length} -- {validRecipients.length} recipient{validRecipients.length > 1 ? "s" : ""}
                    </p>
                  </motion.div>

                ) : sendingState === "error" ? (
                  /* ── ERROR STATE ─────────────────────────────────── */
                  <motion.div
                    key="error"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="px-6 py-10 flex flex-col items-center text-center"
                  >
                    <div className="size-14 rounded-full flex items-center justify-center mb-5"
                      style={{ background: "rgba(255,45,85,0.08)", border: "2px solid rgba(255,45,85,0.2)" }}>
                      <AlertTriangle className="size-7" style={{ color: "#FF2D55" }} />
                    </div>
                    <h3 style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>Delivery Failed</h3>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 6 }}>
                      A network error occurred during transmission. This is a simulated environment.
                    </p>
                    <div className="flex gap-3 mt-6 w-full">
                      <button onClick={onClose} className="flex-1 py-2.5 rounded-xl"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.4)", cursor: "pointer" }}>
                        Cancel
                      </button>
                      <motion.button whileTap={{ scale: 0.96 }} onClick={handleSend}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl"
                        style={{
                          background: "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,200,224,0.06))",
                          border: "1px solid rgba(0,200,224,0.2)", fontSize: 12, fontWeight: 700, color: "#00C8E0", cursor: "pointer",
                        }}>
                        <Send className="size-3.5" /> Retry
                      </motion.button>
                    </div>
                  </motion.div>

                ) : (
                  /* ── COMPOSE STATE ───────────────────────────────── */
                  <motion.div key="compose" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>

                    {/* Header */}
                    <div className="px-6 pt-6 pb-4 flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="size-10 rounded-2xl flex items-center justify-center"
                          style={{
                            background: "linear-gradient(135deg, rgba(0,200,224,0.12), rgba(0,200,224,0.04))",
                            border: "1px solid rgba(0,200,224,0.15)",
                          }}>
                          <Mail className="size-5" style={{ color: "#00C8E0" }} />
                        </div>
                        <div>
                          <h3 style={{ fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: "-0.3px" }}>
                            Email Report
                          </h3>
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                            Send {isEncrypted ? "encrypted " : ""}PDF via secure email
                          </p>
                        </div>
                      </div>
                      <button onClick={onClose} className="size-8 rounded-lg flex items-center justify-center"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <X className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
                      </button>
                    </div>

                    {/* Attachment Preview */}
                    <div className="px-6 mb-4">
                      <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
                        style={{ background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.08)" }}>
                        <Paperclip className="size-4 shrink-0" style={{ color: "#00C8E0" }} />
                        <div className="flex-1 min-w-0">
                          <p className="truncate" style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>
                            {reportTitle.replace(/\s+/g, "_")}.pdf
                          </p>
                          <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginTop: 1 }}>
                            {reportSize} {isEncrypted && (
                              <span style={{ color: "rgba(0,200,83,0.6)" }}> -- Password Protected</span>
                            )}
                          </p>
                        </div>
                        {isEncrypted && <Lock className="size-3.5 shrink-0" style={{ color: "#00C853" }} />}
                      </div>
                    </div>

                    {/* Recipients */}
                    <div className="px-6 mb-3">
                      <div className="flex items-center justify-between mb-2">
                        <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          Recipients
                        </label>
                        <button onClick={() => setShowTeamPicker(v => !v)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg"
                          style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.1)", cursor: "pointer" }}>
                          <Users className="size-3" style={{ color: "#00C8E0" }} />
                          <span style={{ fontSize: 9, fontWeight: 600, color: "#00C8E0" }}>Team</span>
                          <ChevronDown className="size-3" style={{ color: "#00C8E0", transform: showTeamPicker ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                        </button>
                      </div>

                      {/* Team Picker Dropdown */}
                      <AnimatePresence>
                        {showTeamPicker && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden mb-2"
                          >
                            <div className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)" }}>
                              {MOCK_TEAM.map(member => {
                                const isAdded = recipients.some(r => r.email === member.email);
                                return (
                                  <button key={member.email}
                                    onClick={() => { if (!isAdded) addRecipient(member.email, member.name, member.role); }}
                                    disabled={isAdded}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
                                    style={{
                                      borderBottom: "1px solid rgba(255,255,255,0.02)",
                                      background: isAdded ? "rgba(0,200,83,0.02)" : "transparent",
                                      opacity: isAdded ? 0.5 : 1,
                                      cursor: isAdded ? "default" : "pointer",
                                    }}>
                                    <div className="size-7 rounded-full flex items-center justify-center shrink-0"
                                      style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.1)" }}>
                                      <span style={{ fontSize: 9, fontWeight: 700, color: "#00C8E0" }}>
                                        {member.name.split(" ").map(n => n[0]).join("")}
                                      </span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="truncate" style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>{member.name}</p>
                                      <p className="truncate" style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{member.role} -- {member.email}</p>
                                    </div>
                                    {isAdded ? (
                                      <CheckCircle2 className="size-3.5 shrink-0" style={{ color: "#00C853" }} />
                                    ) : (
                                      <Plus className="size-3.5 shrink-0" style={{ color: "rgba(0,200,224,0.5)" }} />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Added Recipients */}
                      {recipients.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {recipients.map(r => (
                            <motion.div
                              key={r.email}
                              initial={{ scale: 0.8, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                              style={{
                                background: r.valid ? "rgba(0,200,224,0.04)" : "rgba(255,45,85,0.04)",
                                border: `1px solid ${r.valid ? "rgba(0,200,224,0.1)" : "rgba(255,45,85,0.15)"}`,
                              }}>
                              <span style={{ fontSize: 10, fontWeight: 600, color: r.valid ? "rgba(255,255,255,0.5)" : "#FF2D55" }}>
                                {r.name}
                              </span>
                              <button onClick={() => removeRecipient(r.email)}
                                className="size-4 rounded-full flex items-center justify-center"
                                style={{ background: "rgba(255,255,255,0.06)" }}>
                                <X className="size-2.5" style={{ color: "rgba(255,255,255,0.3)" }} />
                              </button>
                            </motion.div>
                          ))}
                        </div>
                      )}

                      {/* Manual Email Input */}
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5" style={{ color: "rgba(255,255,255,0.12)" }} />
                        <input
                          ref={emailInputRef}
                          type="email"
                          value={newEmail}
                          onChange={e => setNewEmail(e.target.value)}
                          onKeyDown={handleAddKeyDown}
                          placeholder="Add email address and press Enter"
                          className="w-full pl-9 pr-12 py-2.5 rounded-xl outline-none"
                          style={{
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid rgba(255,255,255,0.06)",
                            fontSize: 12, color: "#fff",
                            fontFamily: "Outfit, sans-serif",
                          }}
                        />
                        {newEmail.length > 0 && (
                          <button onClick={() => addRecipient(newEmail)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-1 rounded-md"
                            style={{ background: "rgba(0,200,224,0.08)", cursor: "pointer" }}>
                            <Plus className="size-3" style={{ color: "#00C8E0" }} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Subject */}
                    <div className="px-6 mb-3">
                      <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        Subject
                      </label>
                      <input
                        type="text"
                        value={subject}
                        onChange={e => setSubject(e.target.value)}
                        className="w-full mt-1.5 px-4 py-2.5 rounded-xl outline-none"
                        style={{
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid rgba(255,255,255,0.06)",
                          fontSize: 12, color: "#fff",
                          fontFamily: "Outfit, sans-serif",
                        }}
                      />
                    </div>

                    {/* Message */}
                    <div className="px-6 mb-3">
                      <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        Message (Optional)
                      </label>
                      <textarea
                        value={message}
                        onChange={e => setMessage(e.target.value)}
                        placeholder="Add a note for the recipients..."
                        rows={3}
                        className="w-full mt-1.5 px-4 py-2.5 rounded-xl outline-none resize-none"
                        style={{
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid rgba(255,255,255,0.06)",
                          fontSize: 12, color: "#fff",
                          fontFamily: "Outfit, sans-serif",
                        }}
                      />
                    </div>

                    {/* Include Password Toggle (only if encrypted) */}
                    {isEncrypted && encryptionPassword && (
                      <div className="px-6 mb-3">
                        <button onClick={() => setIncludePassword(v => !v)}
                          className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl"
                          style={{
                            background: includePassword ? "rgba(255,149,0,0.04)" : "rgba(255,255,255,0.015)",
                            border: `1px solid ${includePassword ? "rgba(255,149,0,0.12)" : "rgba(255,255,255,0.04)"}`,
                          }}>
                          <div className="flex items-center gap-2.5">
                            <Lock className="size-3.5" style={{ color: includePassword ? "#FF9500" : "rgba(255,255,255,0.15)" }} />
                            <div className="text-left">
                              <span style={{ fontSize: 11, fontWeight: 600, color: includePassword ? "#fff" : "rgba(255,255,255,0.35)" }}>
                                Include password in email
                              </span>
                              <p style={{ fontSize: 8, color: includePassword ? "rgba(255,149,0,0.5)" : "rgba(255,255,255,0.15)", marginTop: 1 }}>
                                {includePassword ? "Warning: reduces security" : "Recipient will need the password separately"}
                              </p>
                            </div>
                          </div>
                          <div className="relative shrink-0" style={{
                            width: 36, height: 20, borderRadius: 10,
                            background: includePassword ? "rgba(255,149,0,0.2)" : "rgba(255,255,255,0.06)",
                            border: `1.5px solid ${includePassword ? "rgba(255,149,0,0.3)" : "rgba(255,255,255,0.08)"}`,
                            transition: "all 0.2s",
                          }}>
                            <motion.div animate={{ x: includePassword ? 16 : 2 }}
                              transition={{ type: "spring", stiffness: 500, damping: 30 }}
                              className="absolute top-[2px]"
                              style={{ width: 14, height: 14, borderRadius: 7, background: includePassword ? "#FF9500" : "rgba(255,255,255,0.25)" }} />
                          </div>
                        </button>
                      </div>
                    )}

                    {/* Security Info */}
                    <div className="px-6 mb-3">
                      <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl"
                        style={{ background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.06)" }}>
                        <Shield className="size-3.5 shrink-0 mt-0.5" style={{ color: "rgba(0,200,224,0.4)" }} />
                        <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", lineHeight: 1.6 }}>
                          This is a simulated email delivery for demonstration purposes. In production, emails would be sent via encrypted SMTP with TLS 1.3 and delivery confirmation tracking.
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="px-6 py-5 flex items-center gap-3">
                      <button onClick={onClose}
                        className="flex-1 py-2.5 rounded-xl"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.4)", cursor: "pointer" }}>
                        Cancel
                      </button>
                      <motion.button
                        whileTap={{ scale: 0.96 }}
                        onClick={handleSend}
                        disabled={!canSend}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl"
                        style={{
                          background: canSend
                            ? "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,200,224,0.06))"
                            : "rgba(255,255,255,0.02)",
                          border: `1px solid ${canSend ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.04)"}`,
                          fontSize: 12, fontWeight: 700,
                          color: canSend ? "#00C8E0" : "rgba(255,255,255,0.15)",
                          cursor: canSend ? "pointer" : "not-allowed",
                        }}>
                        <Send className="size-3.5" />
                        Send to {validRecipients.length || 0} Recipient{validRecipients.length !== 1 ? "s" : ""}
                      </motion.button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}