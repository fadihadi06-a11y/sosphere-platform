// ═══════════════════════════════════════════════════════════════
// SOSphere — Incident Reports Tab (Emergency Hub)
// Shows all employee-submitted photo reports
// Admin can Broadcast → Team or Forward → Owner
// ═══════════════════════════════════════════════════════════════
import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Camera, FileText, Megaphone, ChevronRight,
  CheckCircle2, Clock, MapPin, AlertTriangle,
  Users, X, Send, Shield, Eye, Image,
  Radio, Star, Lock, TrendingUp, Filter,
  PhoneCall, Phone, Copy, MessageCircle,
  Monitor, Smartphone, Check, Mic, Layers,
} from "lucide-react";
import { safeTelCall } from "./utils/safe-tel";
import { CallTrigger } from "./call-panel";
import {
  getAllEvidence, type EvidenceEntry,
  getEvidencePipelineStatus,
} from "./evidence-store";
import {
  EvidencePipelineVisual, ChainOfCustody,
  EvidenceQuickActions, EvidenceComments,
  EvidenceDetailPanel, AudioMemoPlayer,
} from "./evidence-pipeline-panel";
import { toast } from "sonner";
import { fetchIncidentReports } from "./api/data-layer";

// ═══════════════════════════════════════════════════════════════
// FIX 2026-04-24 (Point 3): dispatcher action wire to real endpoint
// ─────────────────────────────────────────────────────────────
// 2026-04-25 (B-02): the local callDispatcherAction was extracted to
//   ./api/dashboard-actions-client so AI Co-Admin + Intelligent Guide
//   share the SAME single channel ("behave like a beehive"). The
//   contract is unchanged — { ok:true, data } | { ok:false, error }.
// ═══════════════════════════════════════════════════════════════
import { callDispatcherAction } from "./api/dashboard-actions-client";

// ── Types ─────────────────────────────────────────────────────
export interface IncidentPhotoReport {
  id: string;
  emergencyId: string;
  employeeName: string;
  employeeRole: string;
  employeeDept: string;
  employeePhone: string;
  zone: string;
  severity: "low" | "medium" | "high" | "critical";
  incidentType: string;
  comment: string;
  photos: number;           // photo count (mock — real would be URLs)
  photoUrls?: string[];
  submittedAt: Date;
  status: "new" | "reviewed" | "broadcast" | "forwarded";
  broadcastTo?: string;
  reviewedBy?: string;
}

// ── Mock Data ─────────────────────────────────────────────────
/* SUPABASE_MIGRATION_POINT: incident_reports
   SELECT * FROM incident_reports
   WHERE company_id = :id ORDER BY created_at DESC */
const MOCK_REPORTS: IncidentPhotoReport[] = [
  {
    id: "RPT-001",
    emergencyId: "EMG-7A3F",
    employeeName: "Mohammed Ali",
    employeeRole: "Technician",
    employeeDept: "Maintenance",
    employeePhone: "+966 55 XXX",
    zone: "Zone D - Warehouse",
    severity: "critical",
    incidentType: "Equipment Failure",
    comment: "Hydraulic press malfunctioned suddenly. I heard a loud bang and noticed oil leaking from the main cylinder. I moved away immediately but the area is still hazardous.",
    photos: 3,
    photoUrls: [
      "https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=200&h=200&fit=crop",
      "https://images.unsplash.com/photo-1565043589221-1a6fd9ae45c7?w=200&h=200&fit=crop",
    ],
    submittedAt: new Date(Date.now() - 3 * 60000),
    status: "new",
  },
  {
    id: "RPT-002",
    emergencyId: "EMG-5B2E",
    employeeName: "Khalid Omar",
    employeeRole: "Operator",
    employeeDept: "Operations",
    employeePhone: "+966 55 XXX",
    zone: "Zone A - East",
    severity: "high",
    incidentType: "Chemical Exposure",
    comment: "Noticed a strong chemical smell near Tank B-4. Eyes are burning slightly. I left the area and am waiting near the safety station.",
    photos: 1,
    photoUrls: [
      "https://images.unsplash.com/photo-1576086213369-97a306d36557?w=200&h=200&fit=crop",
    ],
    submittedAt: new Date(Date.now() - 18 * 60000),
    status: "reviewed",
    reviewedBy: "Admin",
  },
  {
    id: "RPT-003",
    emergencyId: "EMG-AUTO-1",
    employeeName: "Tariq Zayed",
    employeeRole: "Plumber",
    employeeDept: "Maintenance",
    employeePhone: "+966 55 XXX",
    zone: "Zone D - Warehouse",
    severity: "medium",
    incidentType: "Slip & Fall",
    comment: "Slipped on a wet floor near the storage bay. Minor knee injury. Floor was not marked as wet.",
    photos: 2,
    photoUrls: [],
    submittedAt: new Date(Date.now() - 45 * 60000),
    status: "broadcast",
    broadcastTo: "Zone D team",
    reviewedBy: "Admin",
  },
];

// ── Severity Config ───────────────────────────────────────────
const SEV = {
  critical: { color: "#FF2D55", bg: "rgba(255,45,85,0.1)", label: "CRITICAL" },
  high:     { color: "#FF9500", bg: "rgba(255,150,0,0.1)", label: "HIGH" },
  medium:   { color: "#FFD60A", bg: "rgba(255,214,10,0.1)", label: "MEDIUM" },
  low:      { color: "#00C853", bg: "rgba(0,200,83,0.1)", label: "LOW" },
};

const STATUS_CONFIG = {
  new:       { color: "#FF2D55", label: "New Report",       dot: true },
  reviewed:  { color: "#00C8E0", label: "Reviewed",         dot: false },
  broadcast: { color: "#00C853", label: "Broadcast Sent",   dot: false },
  forwarded: { color: "#9B59B6", label: "Forwarded to Owner", dot: false },
};

// ─── Call From Where — Explainer ──────────────────────────────
function CallExplainer({ phone, name }: { phone: string; name: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(phone); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}>

      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2.5"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,200,224,0.04)" }}>
        <PhoneCall className="size-4" style={{ color: "#00C8E0" }} />
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>
            How to Call {name}
          </p>
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
            {phone}
          </p>
        </div>
      </div>

      {/* Explanation */}
      <div className="px-4 py-3 space-y-2.5">
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
          The dashboard cannot make calls directly — it routes through your connected device or app:
        </p>

        <div className="grid grid-cols-2 gap-2">
          {/* Desktop */}
          <div className="p-3 rounded-xl"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center gap-2 mb-2">
              <Monitor className="size-3.5" style={{ color: "#00C8E0" }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(0,200,224,0.8)" }}>DESKTOP</span>
            </div>
            <div className="space-y-1">
              {["Skype", "Microsoft Teams", "FaceTime", "Google Meet", "Phone Link"].map(app => (
                <div key={app} className="flex items-center gap-1.5">
                  <div className="size-1 rounded-full" style={{ background: "rgba(0,200,224,0.4)" }} />
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>{app}</span>
                </div>
              ))}
              <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginTop: 4, lineHeight: 1.4 }}>
                Opens whichever app is set as default for tel: links on your OS
              </p>
            </div>
          </div>

          {/* Mobile */}
          <div className="p-3 rounded-xl"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center gap-2 mb-2">
              <Smartphone className="size-3.5" style={{ color: "#00C853" }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(0,200,83,0.8)" }}>MOBILE</span>
            </div>
            <div className="space-y-1">
              {["Native Phone Dialer", "WhatsApp", "SIM Card (direct)"].map(app => (
                <div key={app} className="flex items-center gap-1.5">
                  <div className="size-1 rounded-full" style={{ background: "rgba(0,200,83,0.4)" }} />
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>{app}</span>
                </div>
              ))}
              <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginTop: 4, lineHeight: 1.4 }}>
                Opens native dialer automatically — most direct option
              </p>
            </div>
          </div>
        </div>

        {/* Best practice */}
        <div className="flex items-start gap-2.5 p-3 rounded-xl"
          style={{ background: "rgba(255,150,0,0.05)", border: "1px solid rgba(255,150,0,0.12)" }}>
          <Shield className="size-3.5 flex-shrink-0 mt-0.5" style={{ color: "#FF9500" }} />
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
            <span style={{ color: "#FF9500", fontWeight: 700 }}>Best practice:</span>{" "}
            For emergencies, use "Copy Number" and call from your personal mobile for fastest response. WhatsApp works offline via WiFi if the employee has no cellular signal.
          </p>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          <motion.button whileTap={{ scale: 0.96 }}
            onClick={() => safeTelCall(phone)}
            className="flex flex-col items-center gap-1.5 py-3 rounded-xl"
            style={{ background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.15)" }}>
            <Phone className="size-4" style={{ color: "#FF2D55" }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: "#FF2D55" }}>Call</span>
          </motion.button>

          <motion.button whileTap={{ scale: 0.96 }}
            onClick={() => window.open(`https://wa.me/${phone.replace(/[\s+]/g, "")}`)}
            className="flex flex-col items-center gap-1.5 py-3 rounded-xl"
            style={{ background: "rgba(37,211,102,0.06)", border: "1px solid rgba(37,211,102,0.12)" }}>
            <MessageCircle className="size-4" style={{ color: "#25D366" }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: "#25D366" }}>WhatsApp</span>
          </motion.button>

          <motion.button whileTap={{ scale: 0.96 }}
            onClick={handleCopy}
            className="flex flex-col items-center gap-1.5 py-3 rounded-xl"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            {copied
              ? <Check className="size-4" style={{ color: "#00C853" }} />
              : <Copy className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />}
            <span style={{ fontSize: 9, fontWeight: 700, color: copied ? "#00C853" : "rgba(255,255,255,0.4)" }}>
              {copied ? "Copied!" : "Copy"}
            </span>
          </motion.button>
        </div>
      </div>
    </div>
  );
}

// ─── Report Detail Drawer ─────────────────────────────────────
function ReportDetailDrawer({
  report,
  onClose,
  onBroadcast,
  onForwardToOwner,
  onMarkReviewed,
  onEscalate,
}: {
  report: IncidentPhotoReport;
  onClose: () => void;
  onBroadcast: (report: IncidentPhotoReport, scope: string) => void;
  onForwardToOwner: (report: IncidentPhotoReport) => void;
  onMarkReviewed: (id: string) => void;
  onEscalate?: (report: IncidentPhotoReport) => void;
}) {
  const [broadcastScope, setBroadcastScope] = useState<"zone" | "all" | "dept">("zone");
  const [broadcastMsg, setBroadcastMsg] = useState(
    `⚠️ Safety Alert: ${report.incidentType} in ${report.zone}. Severity: ${report.severity.toUpperCase()}. ${report.comment.slice(0, 80)}...`
  );
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastDone, setBroadcastDone] = useState(false);
  const [showCallExplainer, setShowCallExplainer] = useState(false);
  const sev = SEV[report.severity];

  const handleBroadcast = async () => {
    setIsBroadcasting(true);
    await new Promise(r => setTimeout(r, 1500));
    onBroadcast(report, broadcastScope);
    setIsBroadcasting(false);
    setBroadcastDone(true);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-end"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 350, damping: 32 }}
        onClick={e => e.stopPropagation()}
        className="w-full rounded-t-3xl overflow-hidden"
        style={{
          background: "#070d1a",
          border: "1px solid rgba(255,255,255,0.07)",
          borderBottom: "none",
          maxHeight: "88vh",
          overflowY: "auto",
          fontFamily: "'Outfit', sans-serif",
        }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.12)" }} />
        </div>

        {/* Header */}
        <div className="px-5 py-3 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full"
                style={{ fontSize: 10, fontWeight: 800, background: sev.bg, color: sev.color, letterSpacing: "0.5px" }}>
                {sev.label}
              </span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{report.incidentType}</span>
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 900, color: "rgba(255,255,255,0.95)", letterSpacing: "-0.3px" }}>
              Incident Report
            </h2>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
              {report.employeeName} · {report.zone}
            </p>
          </div>
          <button onClick={onClose}
            className="size-8 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.05)" }}>
            <X className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
          </button>
        </div>

        <div className="px-5 pb-8 space-y-4">
          {/* Employee Card */}
          <div className="flex items-center gap-3 p-3.5 rounded-2xl"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="size-11 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: `${sev.color}20`, border: `1px solid ${sev.color}30` }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: sev.color }}>
                {report.employeeName.split(" ").map(n => n[0]).join("").slice(0, 2)}
              </span>
            </div>
            <div className="flex-1">
              <p style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>{report.employeeName}</p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{report.employeeRole} · {report.employeeDept}</p>
              <button
                onClick={() => setShowCallExplainer(!showCallExplainer)}
                className="flex items-center gap-1.5 mt-1.5"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                <Phone className="size-3" style={{ color: "rgba(0,200,224,0.7)" }} />
                <span style={{ fontSize: 11, color: "#00C8E0", fontWeight: 600 }}>{report.employeePhone}</span>
                <ChevronRight className="size-3"
                  style={{ color: "rgba(0,200,224,0.4)", transform: showCallExplainer ? "rotate(90deg)" : "none", transition: "transform 0.2s" }} />
              </button>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full"
                style={{ background: `${STATUS_CONFIG[report.status].color}15`, border: `1px solid ${STATUS_CONFIG[report.status].color}25` }}>
                <div className="size-1.5 rounded-full" style={{ background: STATUS_CONFIG[report.status].color }} />
                <span style={{ fontSize: 8, fontWeight: 700, color: STATUS_CONFIG[report.status].color }}>
                  {STATUS_CONFIG[report.status].label}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="size-3" style={{ color: "rgba(255,255,255,0.25)" }} />
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
                  {Math.round((Date.now() - report.submittedAt.getTime()) / 60000)}m ago
                </span>
              </div>
            </div>
          </div>

          {/* Call Explainer — collapsible */}
          <AnimatePresence>
            {showCallExplainer && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                style={{ overflow: "hidden" }}>
                <CallExplainer phone={report.employeePhone} name={report.employeeName} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Photos */}
          {report.photos > 0 && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", marginBottom: 10, letterSpacing: "0.5px" }}>
                EVIDENCE PHOTOS ({report.photos})
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {(report.photoUrls && report.photoUrls.length > 0
                  ? report.photoUrls
                  : Array.from({ length: report.photos }, () => null)
                ).map((url, i) => (
                  <div key={i}
                    className="flex-shrink-0 relative rounded-2xl overflow-hidden"
                    style={{ width: 100, height: 100, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    {url ? (
                      <img src={url} alt={`Evidence ${i + 1}`} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                        <Image className="size-6" style={{ color: "rgba(255,255,255,0.15)" }} />
                        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>Photo {i + 1}</span>
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 flex items-center gap-1"
                      style={{ background: "rgba(0,0,0,0.6)" }}>
                      <Eye className="size-2.5" style={{ color: "rgba(255,255,255,0.5)" }} />
                      <span style={{ fontSize: 8, color: "rgba(255,255,255,0.4)" }}>Evidence</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Comment */}
          <div className="p-4 rounded-2xl"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", marginBottom: 8, letterSpacing: "0.5px" }}>
              EMPLOYEE STATEMENT
            </p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", lineHeight: 1.7 }}>
              "{report.comment}"
            </p>
          </div>

          {/* Broadcast Section */}
          {report.status !== "broadcast" && report.status !== "forwarded" ? (
            <>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", marginBottom: 10, letterSpacing: "0.5px" }}>
                  BROADCAST TO TEAM
                </p>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {([
                    { id: "zone", label: "Zone Only", sub: report.zone.split(" - ")[0] },
                    { id: "all",  label: "All Company", sub: "Everyone" },
                    { id: "dept", label: "Department", sub: report.employeeDept },
                  ] as const).map(opt => (
                    <button key={opt.id}
                      onClick={() => setBroadcastScope(opt.id)}
                      className="p-2.5 rounded-xl text-left"
                      style={{
                        background: broadcastScope === opt.id ? "rgba(255,150,0,0.1)" : "rgba(255,255,255,0.02)",
                        border: broadcastScope === opt.id ? "1.5px solid rgba(255,150,0,0.3)" : "1px solid rgba(255,255,255,0.06)",
                      }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: broadcastScope === opt.id ? "#FF9500" : "rgba(255,255,255,0.6)" }}>
                        {opt.label}
                      </p>
                      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>{opt.sub}</p>
                    </button>
                  ))}
                </div>

                <textarea
                  value={broadcastMsg}
                  onChange={e => setBroadcastMsg(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl px-3 py-2.5 outline-none resize-none mb-3"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.07)",
                    color: "rgba(255,255,255,0.75)",
                    fontSize: 12,
                    lineHeight: 1.6,
                  }}
                />
              </div>

              {!broadcastDone ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => { onForwardToOwner(report); onClose(); }}
                    className="flex items-center gap-2 px-4 py-3 rounded-xl"
                    style={{
                      background: "rgba(155,89,182,0.08)",
                      border: "1px solid rgba(155,89,182,0.15)",
                      color: "#9B59B6",
                      fontSize: 12,
                      fontWeight: 700,
                    }}>
                    <ChevronRight className="size-4" />
                    Owner
                  </button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={handleBroadcast}
                    disabled={isBroadcasting}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl"
                    style={{
                      background: isBroadcasting ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg, #FF9500, #FF6B00)",
                      color: isBroadcasting ? "rgba(255,255,255,0.3)" : "#fff",
                      fontSize: 13,
                      fontWeight: 800,
                      boxShadow: isBroadcasting ? "none" : "0 4px 18px rgba(255,150,0,0.3)",
                    }}>
                    {isBroadcasting ? (
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        className="size-4 border-2 border-current border-t-transparent rounded-full" />
                    ) : <Megaphone className="size-4" />}
                    {isBroadcasting ? "Broadcasting..." : "Broadcast Warning"}
                  </motion.button>
                </div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center justify-center gap-2.5 py-4 rounded-2xl"
                  style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.15)" }}>
                  <CheckCircle2 className="size-5" style={{ color: "#00C853" }} />
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: "#00C853" }}>Broadcast Sent!</p>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                      Safety warning delivered to {broadcastScope === "all" ? "all employees" : broadcastScope === "zone" ? report.zone.split(" - ")[0] : report.employeeDept}
                    </p>
                  </div>
                </motion.div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-3 p-4 rounded-2xl"
              style={{
                background: report.status === "broadcast" ? "rgba(0,200,83,0.06)" : "rgba(155,89,182,0.06)",
                border: `1px solid ${report.status === "broadcast" ? "rgba(0,200,83,0.15)" : "rgba(155,89,182,0.15)"}`,
              }}>
              <CheckCircle2 className="size-5 flex-shrink-0"
                style={{ color: report.status === "broadcast" ? "#00C853" : "#9B59B6" }} />
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, color: report.status === "broadcast" ? "#00C853" : "#9B59B6" }}>
                  {report.status === "broadcast" ? `Broadcast sent to ${report.broadcastTo}` : "Forwarded to Owner"}
                </p>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                  Reviewed by {report.reviewedBy}
                </p>
              </div>
            </div>
          )}

          {/* Mark Reviewed */}
          {report.status === "new" && (
            <button
              onClick={() => { onMarkReviewed(report.id); onClose(); }}
              className="w-full py-2.5 rounded-xl"
              style={{
                background: "rgba(0,200,224,0.06)",
                border: "1px solid rgba(0,200,224,0.12)",
                color: "#00C8E0",
                fontSize: 12,
                fontWeight: 700,
              }}>
              Mark as Reviewed (no action needed)
            </button>
          )}

          {/* Open Investigation — visible for critical/high OR any unresolved report */}
          {onEscalate && (report.severity === "critical" || report.severity === "high") && report.status !== "forwarded" && (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => { onEscalate(report); onClose(); }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl"
              style={{
                background: "linear-gradient(135deg, rgba(255,45,85,0.12), rgba(255,45,85,0.06))",
                border: "1px solid rgba(255,45,85,0.25)",
                color: "#FF2D55",
                fontSize: 13,
                fontWeight: 800,
              }}>
              <AlertTriangle className="size-4" />
              Open Investigation
            </motion.button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Incident Reports Tab — Main
// ═══════════════════════════════════════════════════════════════
// ── Convert EvidenceEntry → IncidentPhotoReport ─────────────────
function evidenceToReport(ev: EvidenceEntry): IncidentPhotoReport {
  return {
    id: ev.id,
    emergencyId: ev.emergencyId,
    employeeName: ev.submittedBy,
    employeeRole: "Employee",
    employeeDept: "Field",
    employeePhone: "",
    zone: ev.zone,
    severity: ev.severity,
    incidentType: ev.incidentType || "SOS Emergency",
    comment: ev.workerComment || "",
    photos: ev.photos.length,
    photoUrls: ev.photos.map(p => p.dataUrl).filter(url => url && !url.startsWith("pending://")),
    submittedAt: new Date(ev.submittedAt),
    status: ev.status === "pending" ? "new" : ev.status === "reviewed" || ev.status === "broadcast" ? ev.status : "new",
    reviewedBy: ev.reviewedBy,
  };
}
