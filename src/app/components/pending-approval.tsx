// ═══════════════════════════════════════════════════════════════
// SOSphere — Pending Approval Screen
// FIX 1: StorageEvent listener + 5s polling for approval
// FIX 4: Contact Admin modal (WhatsApp, Email, Copy)
// ═══════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Hourglass, Building2, Bell, Mail, ArrowRight, Shield,
  Phone, Copy, MessageCircle, CheckCircle2, X, ExternalLink,
} from "lucide-react";
import { getJoinRequests, onInviteSignal } from "./shared-store";

interface PendingApprovalProps {
  companyName: string;
  userPhone?: string;          // employee's phone for matching
  adminName?: string;          // company admin name
  adminPhone?: string;         // company admin phone
  adminEmail?: string;         // company admin email
  onApproved?: () => void;
  onApprovedAsEmployee?: () => void;
}

export function PendingApproval({
  companyName,
  userPhone = "+966551234567",
  adminName = "Company Admin",
  adminPhone,
  adminEmail,
  onApproved,
  onApprovedAsEmployee,
}: PendingApprovalProps) {
  const [showContactModal, setShowContactModal] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [phoneCopied, setPhoneCopied] = useState(false);

  // ── FIX 1a: Check approval from join requests ──────────────
  const checkApproval = useCallback(() => {
    const requests = getJoinRequests();
    const mine = requests.find(
      (r) => r.phone === userPhone && (r.status === "approved" || r.status === "auto-approved")
    );
    if (mine) {
      setApprovalStatus("approved");
      // Small delay for celebration animation before navigating
      setTimeout(() => {
        onApproved?.();
      }, 1800);
      return true;
    }
    // Also check for rejection
    const rejected = requests.find(
      (r) => r.phone === userPhone && r.status === "rejected"
    );
    if (rejected) {
      setApprovalStatus("rejected");
      return true;
    }
    return false;
  }, [userPhone, onApproved]);

  // ── FIX 1b: StorageEvent listener (cross-tab real-time) ────
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== "sosphere_join_requests") return;
      try {
        const requests = JSON.parse(e.newValue || "[]");
        const mine = requests.find(
          (r: { phone: string; status: string }) =>
            r.phone === userPhone && (r.status === "approved" || r.status === "auto-approved")
        );
        if (mine) {
          setApprovalStatus("approved");
          setTimeout(() => {
            onApproved?.();
          }, 1800);
        }
      } catch { /* ignore parse errors */ }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [userPhone, onApproved]);

  // ── FIX 1c: Listen for EMPLOYEE_APPROVED signal ────────────
  useEffect(() => {
    const cleanup = onInviteSignal((type, _name, phone) => {
      if (type === "EMPLOYEE_APPROVED" && phone === userPhone) {
        setApprovalStatus("approved");
        setTimeout(() => {
          onApproved?.();
        }, 1800);
      }
    });
    return cleanup;
  }, [userPhone, onApproved]);

  // ── FIX 1d: Polling every 5s as fallback ───────────────────
  useEffect(() => {
    // Initial check
    checkApproval();
    const interval = setInterval(() => {
      checkApproval();
    }, 5000);
    return () => clearInterval(interval);
  }, [checkApproval]);

  // ── FIX 4: Contact Admin actions ───────────────────────────
  const handleWhatsApp = () => {
    if (!adminPhone) return;
    const cleanPhone = adminPhone.replace(/[^+\d]/g, "");
    const msg = encodeURIComponent(
      `Hi ${adminName}, this is a new team member waiting for approval on SOSphere for ${companyName}. Could you please approve my request?`
    );
    window.open(`https://wa.me/${cleanPhone.replace("+", "")}?text=${msg}`, "_blank");
  };

  const handleEmail = () => {
    if (!adminEmail) return;
    const subject = encodeURIComponent(`SOSphere Approval Request — ${companyName}`);
    const body = encodeURIComponent(
      `Hi ${adminName},\n\nI'm waiting for approval to join ${companyName} on SOSphere.\n\nPlease check your dashboard under People & Teams → Pending Approvals.\n\nThank you.`
    );
    window.open(`mailto:${adminEmail}?subject=${subject}&body=${body}`, "_blank");
  };

  const handleCopyPhone = () => {
    if (!adminPhone) return;
    navigator.clipboard.writeText(adminPhone).then(() => {
      setPhoneCopied(true);
      setTimeout(() => setPhoneCopied(false), 2000);
    });
  };

  const hasAdminContact = !!(adminPhone || adminEmail);

  return (
    <div className="relative flex flex-col h-full">
      {/* Ambient glow */}
      <div
        className="absolute top-[150px] left-1/2 -translate-x-1/2 w-[400px] h-[400px] pointer-events-none"
        style={{
          background: approvalStatus === "approved"
            ? "radial-gradient(circle, rgba(0,200,83,0.06) 0%, transparent 55%)"
            : "radial-gradient(circle, rgba(255,180,0,0.04) 0%, transparent 55%)",
        }}
      />

      <div className="flex-1 flex flex-col px-6 relative z-10">
        {/* Steps */}
        <div className="flex items-center justify-center gap-2 pt-14 mb-8">
          <div className="size-2 rounded-full" style={{ background: "rgba(0,200,224,0.4)" }} />
          <div className="w-6 h-[2px] rounded-full" style={{ background: "rgba(0,200,224,0.2)" }} />
          <div className="size-2 rounded-full" style={{ background: "rgba(0,200,224,0.4)" }} />
          <div className="w-6 h-[2px] rounded-full" style={{ background: approvalStatus === "approved" ? "rgba(0,200,83,0.3)" : "rgba(255,180,0,0.2)" }} />
          <div className="size-2 rounded-full" style={{ background: approvalStatus === "approved" ? "#00C853" : "#FFB400" }} />
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col items-center justify-center -mt-10">
          <AnimatePresence mode="wait">
            {/* ── APPROVED STATE ── */}
            {approvalStatus === "approved" && (
              <motion.div
                key="approved"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="flex flex-col items-center"
              >
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
                  className="relative mb-7"
                >
                  <motion.div
                    animate={{ scale: [1, 1.5, 1], opacity: [0.2, 0, 0.2] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="absolute inset-0 rounded-[26px]"
                    style={{ background: "rgba(0,200,83,0.15)" }}
                  />
                  <div
                    className="relative size-[88px] rounded-[26px] flex items-center justify-center"
                    style={{
                      background: "linear-gradient(145deg, rgba(0,200,83,0.15), rgba(0,200,83,0.05))",
                      border: "1px solid rgba(0,200,83,0.25)",
                      boxShadow: "0 12px 40px rgba(0,200,83,0.12)",
                    }}
                  >
                    <CheckCircle2 className="size-10" style={{ color: "#00C853" }} />
                  </div>
                </motion.div>

                <h1 className="text-white mb-3" style={{ fontSize: "26px", fontWeight: 700, letterSpacing: "-0.5px" }}>
                  You're Approved!
                </h1>
                <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.4)", lineHeight: 1.7, textAlign: "center", maxWidth: "280px" }}>
                  Welcome to {companyName}. Redirecting to your safety dashboard...
                </p>
              </motion.div>
            )}

            {/* ── PENDING STATE ── */}
            {approvalStatus === "pending" && (
              <motion.div
                key="pending"
                initial={{ opacity: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="flex flex-col items-center"
              >
                {/* Animated icon */}
                <motion.div
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className="relative mb-7"
                >
                  <motion.div
                    animate={{ scale: [1, 1.4, 1], opacity: [0.15, 0, 0.15] }}
                    transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute inset-0 rounded-[26px]"
                    style={{ background: "rgba(255,180,0,0.08)" }}
                  />
                  <motion.div
                    animate={{ scale: [1, 1.25, 1], opacity: [0.1, 0, 0.1] }}
                    transition={{ duration: 3.5, delay: 0.5, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute inset-0 rounded-[26px]"
                    style={{ background: "rgba(255,180,0,0.06)" }}
                  />
                  <div
                    className="relative size-[88px] rounded-[26px] flex items-center justify-center"
                    style={{
                      background: "linear-gradient(145deg, rgba(255,180,0,0.12), rgba(255,180,0,0.04))",
                      border: "1px solid rgba(255,180,0,0.15)",
                      boxShadow: "0 12px 40px rgba(255,180,0,0.08), inset 0 1px 0 rgba(255,255,255,0.05)",
                    }}
                  >
                    <motion.div
                      animate={{ rotate: [0, 15, -15, 0] }}
                      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <Hourglass className="size-10" style={{ color: "#FFB400" }} />
                    </motion.div>
                  </div>
                </motion.div>

                {/* Text */}
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.25 }}
                  className="text-center mb-8"
                >
                  <h1 className="text-white mb-3" style={{ fontSize: "26px", fontWeight: 700, letterSpacing: "-0.5px" }}>
                    Request Sent!
                  </h1>
                  <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.3)", lineHeight: 1.7, maxWidth: "280px", margin: "0 auto" }}>
                    Your admin will review and approve your request. We'll notify you when you're in.
                  </p>
                </motion.div>

                {/* Company card */}
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.4 }}
                  className="w-full p-5"
                  style={{
                    borderRadius: "18px",
                    background: "rgba(255,255,255,0.025)",
                    backdropFilter: "blur(20px)",
                    border: "1px solid rgba(255,255,255,0.05)",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
                  }}
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className="size-12 rounded-[14px] flex items-center justify-center shrink-0"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.06)",
                      }}
                    >
                      <Building2 className="size-5" style={{ color: "rgba(255,255,255,0.45)" }} />
                    </div>
                    <div className="flex-1">
                      <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.2)", fontWeight: 500, letterSpacing: "0.3px", marginBottom: "3px" }}>
                        APPLIED TO
                      </p>
                      <p className="text-white" style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.2px" }}>
                        {companyName}
                      </p>
                    </div>
                    <div
                      className="flex items-center gap-1.5 px-3 py-1.5"
                      style={{
                        borderRadius: "10px",
                        background: "rgba(255,180,0,0.08)",
                        border: "1px solid rgba(255,180,0,0.12)",
                      }}
                    >
                      <motion.div
                        animate={{ opacity: [1, 0.3, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="size-[6px] rounded-full"
                        style={{ background: "#FFB400", boxShadow: "0 0 6px rgba(255,180,0,0.5)" }}
                      />
                      <span style={{ fontSize: "11px", fontWeight: 600, color: "#FFB400" }}>Pending</span>
                    </div>
                  </div>

                  <div
                    className="mt-4 pt-4 flex items-center gap-4"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    <div className="flex items-center gap-2">
                      <Bell className="size-[13px]" style={{ color: "rgba(255,255,255,0.15)" }} />
                      <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.2)" }}>
                        Auto-checking every 5 seconds
                      </span>
                    </div>
                  </div>
                </motion.div>

                {/* What happens next */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.55 }}
                  className="w-full mt-4 space-y-0"
                >
                  {[
                    { step: "1", text: "Admin reviews your request", done: true },
                    { step: "2", text: "You receive approval notification", done: false },
                    { step: "3", text: "Full access to company safety tools", done: false },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3 py-3">
                      <div
                        className="size-6 rounded-full flex items-center justify-center shrink-0"
                        style={{
                          background: item.done ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.02)",
                          border: item.done ? "1px solid rgba(0,200,224,0.15)" : "1px solid rgba(255,255,255,0.05)",
                        }}
                      >
                        <span style={{ fontSize: "10px", fontWeight: 700, color: item.done ? "#00C8E0" : "rgba(255,255,255,0.15)" }}>
                          {item.step}
                        </span>
                      </div>
                      <span style={{ fontSize: "13px", color: item.done ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.2)", fontWeight: 400 }}>
                        {item.text}
                      </span>
                    </div>
                  ))}
                </motion.div>
              </motion.div>
            )}

            {/* ── REJECTED STATE ── */}
            {approvalStatus === "rejected" && (
              <motion.div
                key="rejected"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="flex flex-col items-center"
              >
                <div
                  className="size-[88px] rounded-[26px] flex items-center justify-center mb-7"
                  style={{
                    background: "linear-gradient(145deg, rgba(255,45,85,0.12), rgba(255,45,85,0.04))",
                    border: "1px solid rgba(255,45,85,0.2)",
                  }}
                >
                  <X className="size-10" style={{ color: "#FF2D55" }} />
                </div>
                <h1 className="text-white mb-3" style={{ fontSize: "26px", fontWeight: 700 }}>
                  Request Declined
                </h1>
                <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.3)", lineHeight: 1.7, textAlign: "center", maxWidth: "280px" }}>
                  Your admin declined this request. Please contact them for details.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom buttons */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.65 }}
          className="pb-12 pt-4"
        >
          {/* FIX 4: Contact Admin button — now opens modal */}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowContactModal(true)}
            className="w-full flex items-center justify-center gap-2.5 transition-all duration-300"
            style={{
              padding: "16px",
              borderRadius: "16px",
              background: "rgba(255,255,255,0.04)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(255,255,255,0.07)",
              fontSize: "15px",
              fontWeight: 600,
              color: "rgba(255,255,255,0.6)",
            }}
          >
            <Mail className="size-[17px]" />
            Contact Admin
          </motion.button>

          {onApproved && (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={onApproved}
              className="w-full flex items-center justify-center gap-2.5 mt-3"
              style={{
                padding: "16px",
                borderRadius: "16px",
                background: "linear-gradient(135deg, rgba(255,150,0,0.08), rgba(255,150,0,0.03))",
                border: "1px solid rgba(255,150,0,0.15)",
                fontSize: "14px",
                fontWeight: 600,
                color: "#FF9500",
              }}
            >
              <Shield className="size-[17px]" />
              Demo: Enter as Supervisor
            </motion.button>
          )}

          {onApprovedAsEmployee && (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={onApprovedAsEmployee}
              className="w-full flex items-center justify-center gap-2.5 mt-3"
              style={{
                padding: "16px",
                borderRadius: "16px",
                background: "linear-gradient(135deg, rgba(0,200,224,0.08), rgba(0,200,224,0.03))",
                border: "1px solid rgba(0,200,224,0.15)",
                fontSize: "14px",
                fontWeight: 600,
                color: "#00C8E0",
              }}
            >
              <ArrowRight className="size-[17px]" />
              Demo: Enter as Employee
            </motion.button>
          )}
        </motion.div>
      </div>

      {/* ══ FIX 4: Contact Admin Modal ═══════════════════════════ */}
      <AnimatePresence>
        {showContactModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-end justify-center"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
            onClick={() => setShowContactModal(false)}
          >
            <motion.div
              initial={{ y: 300, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 300, opacity: 0 }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
              className="w-full mx-4 mb-6 p-6 rounded-3xl"
              style={{
                background: "linear-gradient(180deg, #0F1A2E 0%, #0A1220 100%)",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 -8px 40px rgba(0,0,0,0.4)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div
                    className="size-11 rounded-2xl flex items-center justify-center"
                    style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)" }}
                  >
                    <Phone className="size-5" style={{ color: "#00C8E0" }} />
                  </div>
                  <div>
                    <p className="text-white" style={{ fontSize: 16, fontWeight: 700 }}>Contact Admin</p>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{companyName}</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowContactModal(false)}
                  className="size-8 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <X className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
                </button>
              </div>

              {hasAdminContact ? (
                <div className="space-y-3">
                  {/* Admin info card */}
                  <div
                    className="p-4 rounded-2xl"
                    style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px", marginBottom: 8 }}>
                      ADMIN DETAILS
                    </p>
                    <p className="text-white" style={{ fontSize: 15, fontWeight: 600 }}>{adminName}</p>
                    {adminPhone && (
                      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>{adminPhone}</p>
                    )}
                    {adminEmail && (
                      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{adminEmail}</p>
                    )}
                  </div>

                  {/* Action buttons */}
                  {adminPhone && (
                    <div className="grid grid-cols-2 gap-3">
                      <motion.button
                        whileTap={{ scale: 0.96 }}
                        onClick={handleWhatsApp}
                        className="flex items-center justify-center gap-2 py-3.5 rounded-2xl"
                        style={{
                          background: "rgba(37,211,102,0.1)",
                          border: "1px solid rgba(37,211,102,0.2)",
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#25D366",
                        }}
                      >
                        <MessageCircle className="size-4" />
                        WhatsApp
                      </motion.button>

                      <motion.button
                        whileTap={{ scale: 0.96 }}
                        onClick={handleCopyPhone}
                        className="flex items-center justify-center gap-2 py-3.5 rounded-2xl"
                        style={{
                          background: "rgba(0,200,224,0.08)",
                          border: "1px solid rgba(0,200,224,0.2)",
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#00C8E0",
                        }}
                      >
                        {phoneCopied ? (
                          <span className="flex items-center gap-1.5">
                            <CheckCircle2 className="size-4" /> Copied!
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <Copy className="size-4" /> Copy Phone
                          </span>
                        )}
                      </motion.button>
                    </div>
                  )}

                  {adminEmail && (
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={handleEmail}
                      className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-2xl"
                      style={{
                        background: "rgba(123,94,255,0.08)",
                        border: "1px solid rgba(123,94,255,0.2)",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#7B5EFF",
                      }}
                    >
                      <Mail className="size-4" />
                      Send Email
                      <ExternalLink className="size-3.5" style={{ opacity: 0.5 }} />
                    </motion.button>
                  )}

                  {/* Suggested message */}
                  <div
                    className="p-3 rounded-xl mt-2"
                    style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.2)", marginBottom: 6 }}>
                      SUGGESTED MESSAGE
                    </p>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
                      "Hi, I'm waiting for approval on SOSphere to join {companyName}. Could you please check
                      <span style={{ color: "#00C8E0" }}> People & Teams → Pending Approvals</span>?"
                    </p>
                  </div>
                </div>
              ) : (
                /* No admin contact available */
                <div className="space-y-4">
                  <div
                    className="p-4 rounded-2xl text-center"
                    style={{ background: "rgba(255,180,0,0.04)", border: "1px solid rgba(255,180,0,0.1)" }}
                  >
                    <Building2 className="size-8 mx-auto mb-3" style={{ color: "rgba(255,180,0,0.4)" }} />
                    <p style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>
                      Ask your admin to check their dashboard under:
                    </p>
                    <p
                      className="mt-2 inline-block px-3 py-1.5 rounded-lg"
                      style={{ fontSize: 13, fontWeight: 700, color: "#00C8E0", background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)" }}
                    >
                      People & Teams → Pending Approvals
                    </p>
                  </div>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", textAlign: "center", lineHeight: 1.6 }}>
                    Your request is visible to all company admins. They can approve you with one tap.
                  </p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
