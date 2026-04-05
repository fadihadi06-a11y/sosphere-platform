// =================================================================
// SOSphere — Incident Investigation & CAPA (ISO 45001 Ch.10)
// -----------------------------------------------------------------
// Root Cause Analysis + Corrective Action Plans + Follow-up Tracking
// + Final Investigation Report PDF Export
// =================================================================

import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Search, FileText, AlertTriangle, CheckCircle2, Clock, Filter, Download, Eye, X, Zap, TriangleAlert, Paperclip, Flag, CircleDot, Camera } from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import { autoTable } from "jspdf-autotable";
import { TYPOGRAPHY } from "./design-system";
import { sortByPriority } from "./priority-engine";
import { MOCK_RISKS } from "./dashboard-risk-register";
import { getAllEvidence, linkToInvestigation } from "./evidence-store";
import { EvidencePipelineVisual, AudioMemoPlayer, ChainOfCustody, EvidenceComments } from "./evidence-pipeline-panel";
import { getTimelineEntries } from "./smart-timeline-tracker";

// ── Types ─────────────────────────────────────────────────────

type InvestigationStatus = "open" | "investigating" | "pending_capa" | "capa_in_progress" | "closed" | "overdue";
type Severity = "critical" | "high" | "medium" | "low";
type CAPAStatus = "planned" | "in_progress" | "completed" | "overdue" | "verified";

interface RootCause {
  id: string;
  category: "human" | "equipment" | "process" | "environment" | "management";
  description: string;
  contributing: boolean; // true = contributing factor, false = root cause
  evidence: string[];
}

interface CorrectiveAction {
  id: string;
  type: "corrective" | "preventive";
  description: string;
  assignedTo: string;
  dueDate: Date;
  status: CAPAStatus;
  completedDate?: Date;
  verifiedBy?: string;
  notes: string;
  priority: "high" | "medium" | "low";
}

interface Investigation {
  id: string;
  incidentId: string;
  title: string;
  description: string;
  severity: Severity;
  zone: string;
  incidentDate: Date;
  reportedBy: string;
  investigator: string;
  status: InvestigationStatus;
  rootCauses: RootCause[];
  actions: CorrectiveAction[];
  timeline: { date: Date; event: string; by: string }[];
  affectedWorkers: string[];
  isoReference: string; // e.g., "ISO 45001 §10.2"
  finalReportDate?: Date;
  source?: string;
}

// ── Mock Data ────────────────────────────────────────────────────

// ── Create Investigation from Real Emergency ────────────────────
// This bridges the gap: when an emergency is resolved on the dashboard,
// it can be sent here as a real investigation with real timeline data.

function createInvestigationFromEmergency(emg: {
  id: string;
  employeeName: string;
  zone: string;
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  timestamp: Date;
  elapsed: number;
  ownedBy?: string;
}): Investigation {
  const timelineEntries = getTimelineEntries(emg.id);
  const evidence = getAllEvidence().filter(e => e.emergencyId === emg.id);

  return {
    id: `INV-${emg.id}`,
    incidentId: emg.id,
    title: `${emg.type} — ${emg.zone}`,
    description: `Auto-generated investigation from emergency ${emg.id}. ${emg.employeeName} triggered ${emg.type} in ${emg.zone}. ${timelineEntries.length} events tracked. ${evidence.length > 0 ? `${evidence.reduce((s, e) => s + e.photos.length, 0)} evidence photos collected.` : "No field evidence collected."}`,
    severity: emg.severity,
    zone: emg.zone,
    incidentDate: emg.timestamp,
    reportedBy: emg.employeeName,
    investigator: emg.ownedBy || "Pending Assignment",
    status: "open",
    rootCauses: [],
    actions: [],
    timeline: timelineEntries.length > 0
      ? timelineEntries.map(te => ({
          date: new Date(te.timestamp),
          event: te.event,
          by: te.actor,
        }))
      : [
          { date: emg.timestamp, event: `Emergency triggered: ${emg.type}`, by: emg.employeeName },
          { date: new Date(), event: "Investigation auto-created from resolved emergency", by: "System" },
        ],
    affectedWorkers: [emg.employeeName],
    isoReference: "ISO 45001 §10.2 — Incident investigation & nonconformity",
    source: "Emergency Response",
  };
}

/* SUPABASE_MIGRATION_POINT: investigations
   SELECT * FROM investigations
   JOIN capa_actions ON investigations.id = capa_actions.investigation_id
   WHERE company_id = :id */
const MOCK_INVESTIGATIONS: Investigation[] = [
  {
    id: "INV-001",
    incidentId: "INC-2026-0047",
    title: "Scaffolding Collapse — Zone D Warehouse",
    description: "Partial scaffolding collapse during maintenance work. One worker suffered minor injuries. Investigation revealed inadequate inspection prior to use.",
    severity: "critical",
    zone: "Zone D - Warehouse",
    incidentDate: new Date(2026, 2, 1, 9, 30),
    reportedBy: "Ahmed Khalil",
    investigator: "Rania Abbas",
    status: "capa_in_progress",
    rootCauses: [
      { id: "RC-1", category: "equipment", description: "Scaffolding base plates corroded — not replaced during last quarterly maintenance", contributing: false, evidence: ["Photo evidence of corrosion", "Maintenance log showing skipped inspection"] },
      { id: "RC-2", category: "process", description: "Pre-use inspection checklist did not include base plate condition", contributing: false, evidence: ["Current checklist template review"] },
      { id: "RC-3", category: "management", description: "Maintenance schedule was overdue by 3 weeks due to staff shortage", contributing: true, evidence: ["HR staffing records", "Maintenance schedule"] },
    ],
    actions: [
      { id: "CA-1", type: "corrective", description: "Replace all corroded scaffolding base plates in Zone D", assignedTo: "Mohammed Ali", dueDate: new Date(2026, 2, 8), status: "completed", completedDate: new Date(2026, 2, 6), verifiedBy: "Rania Abbas", notes: "All 24 base plates replaced with galvanized steel units", priority: "high" },
      { id: "CA-2", type: "corrective", description: "Update pre-use inspection checklist to include base plate corrosion check", assignedTo: "Sara Al-Mutairi", dueDate: new Date(2026, 2, 10), status: "completed", completedDate: new Date(2026, 2, 9), verifiedBy: "Rania Abbas", notes: "Checklist v3.1 now includes 5 additional structural checks", priority: "high" },
      { id: "CA-3", type: "preventive", description: "Implement quarterly scaffolding integrity audit for all zones", assignedTo: "Omar Al-Farsi", dueDate: new Date(2026, 2, 20), status: "in_progress", notes: "Audit framework drafted — pending zone manager approval", priority: "medium" },
      { id: "CA-4", type: "preventive", description: "Hire 2 additional maintenance technicians to prevent schedule delays", assignedTo: "HR Department", dueDate: new Date(2026, 3, 1), status: "planned", notes: "Job postings published on 3 platforms", priority: "medium" },
    ],
    timeline: [
      { date: new Date(2026, 2, 1, 9, 30), event: "Incident occurred — scaffolding partial collapse", by: "System" },
      { date: new Date(2026, 2, 1, 9, 35), event: "SOS triggered by Mohammed Ali", by: "Mohammed Ali" },
      { date: new Date(2026, 2, 1, 10, 0), event: "Investigation opened by HSE Manager", by: "Rania Abbas" },
      { date: new Date(2026, 2, 2, 14, 0), event: "Root cause analysis completed — 3 causes identified", by: "Rania Abbas" },
      { date: new Date(2026, 2, 3, 9, 0), event: "CAPA plan approved by management", by: "Omar Al-Farsi" },
      { date: new Date(2026, 2, 6, 16, 0), event: "CA-1 completed: Base plates replaced", by: "Mohammed Ali" },
      { date: new Date(2026, 2, 9, 11, 0), event: "CA-2 completed: Checklist updated to v3.1", by: "Sara Al-Mutairi" },
    ],
    affectedWorkers: ["Mohammed Ali", "Hassan Jaber"],
    isoReference: "ISO 45001 §10.2 — Incident investigation & nonconformity",
    source: "Pre-Shift Checklist",
  },
  {
    id: "INV-002",
    incidentId: "INC-2026-0052",
    title: "Chemical Spill — Zone B Lab",
    description: "Minor chemical spill during transfer operation. No injuries but potential exposure risk identified. Spill contained within 15 minutes.",
    severity: "high",
    zone: "Zone B - Control Room",
    incidentDate: new Date(2026, 2, 7, 14, 20),
    reportedBy: "Lina Chen",
    investigator: "Sara Al-Mutairi",
    status: "investigating",
    rootCauses: [
      { id: "RC-4", category: "human", description: "Operator did not follow standard transfer procedure — skipped valve check", contributing: false, evidence: ["CCTV footage review", "Operator interview"] },
      { id: "RC-5", category: "equipment", description: "Transfer hose coupling showed wear beyond acceptable limits", contributing: true, evidence: ["Equipment inspection report"] },
    ],
    actions: [
      { id: "CA-5", type: "corrective", description: "Retrain all lab operators on chemical transfer SOP", assignedTo: "Lina Chen", dueDate: new Date(2026, 2, 15), status: "in_progress", notes: "3 of 5 operators retrained", priority: "high" },
      { id: "CA-6", type: "preventive", description: "Install automated valve interlock system", assignedTo: "Engineering", dueDate: new Date(2026, 3, 15), status: "planned", notes: "Budget approved — vendor selection in progress", priority: "medium" },
    ],
    timeline: [
      { date: new Date(2026, 2, 7, 14, 20), event: "Chemical spill detected during transfer", by: "Lina Chen" },
      { date: new Date(2026, 2, 7, 14, 35), event: "Spill contained — hazmat team deployed", by: "System" },
      { date: new Date(2026, 2, 8, 9, 0), event: "Investigation initiated", by: "Sara Al-Mutairi" },
      { date: new Date(2026, 2, 10, 16, 0), event: "Root cause analysis in progress", by: "Sara Al-Mutairi" },
    ],
    affectedWorkers: ["Lina Chen", "Yusuf Bakr"],
    isoReference: "ISO 45001 §10.2",
    source: "Pre-Shift Checklist",
  },
  {
    id: "INV-003",
    incidentId: "INC-2026-0038",
    title: "Near-Miss: Forklift Close Call — Zone E",
    description: "Forklift came within 1m of pedestrian in loading area. No contact made. Blind corner identified as contributing factor.",
    severity: "medium",
    zone: "Zone E - Parking",
    incidentDate: new Date(2026, 1, 22, 11, 45),
    reportedBy: "Hassan Jaber",
    investigator: "Rania Abbas",
    status: "closed",
    rootCauses: [
      { id: "RC-6", category: "environment", description: "Blind corner at T-junction — no convex mirror installed", contributing: false, evidence: ["Site inspection photos", "Layout review"] },
      { id: "RC-7", category: "process", description: "No designated pedestrian walkway in loading area", contributing: false, evidence: ["Zone layout documentation"] },
    ],
    actions: [
      { id: "CA-7", type: "corrective", description: "Install convex mirrors at all T-junctions in Zone E", assignedTo: "Maintenance", dueDate: new Date(2026, 2, 1), status: "verified", completedDate: new Date(2026, 1, 28), verifiedBy: "Rania Abbas", notes: "6 mirrors installed — all verified functional", priority: "high" },
      { id: "CA-8", type: "preventive", description: "Paint pedestrian walkways and install bollards", assignedTo: "Facilities", dueDate: new Date(2026, 2, 5), status: "verified", completedDate: new Date(2026, 2, 4), verifiedBy: "Rania Abbas", notes: "Complete — yellow walkway markings and 12 bollards installed", priority: "high" },
    ],
    timeline: [
      { date: new Date(2026, 1, 22, 11, 45), event: "Near-miss reported", by: "Hassan Jaber" },
      { date: new Date(2026, 1, 22, 14, 0), event: "Investigation opened", by: "Rania Abbas" },
      { date: new Date(2026, 1, 23, 10, 0), event: "Root causes identified", by: "Rania Abbas" },
      { date: new Date(2026, 1, 28), event: "All corrective actions completed", by: "Maintenance" },
      { date: new Date(2026, 2, 5), event: "Investigation closed — all CAPAs verified", by: "Rania Abbas" },
    ],
    affectedWorkers: ["Hassan Jaber"],
    isoReference: "ISO 45001 §10.2",
    finalReportDate: new Date(2026, 2, 5),
    source: "Field Report",
  },
  {
    id: "INV-004",
    incidentId: "INC-2026-0055",
    title: "Heat Stress Incident — Zone A Outdoor",
    description: "Worker collapsed due to heat stress during afternoon shift. Ambient temperature 47°C. Worker recovered after first aid.",
    severity: "high",
    zone: "Zone A - North Gate",
    incidentDate: new Date(2026, 2, 10, 14, 15),
    reportedBy: "Ali Mansour",
    investigator: "Rania Abbas",
    status: "pending_capa",
    rootCauses: [
      { id: "RC-8", category: "environment", description: "Work continued past heat stress threshold (46°C) without implementing mandatory rest protocol", contributing: false, evidence: ["Weather station data", "Shift schedule"] },
      { id: "RC-9", category: "management", description: "Heat stress policy not enforced — supervisor unaware of updated thresholds", contributing: true, evidence: ["Supervisor interview", "Policy distribution log"] },
    ],
    actions: [],
    timeline: [
      { date: new Date(2026, 2, 10, 14, 15), event: "Worker collapsed  first aid administered", by: "Aisha Rahman" },
      { date: new Date(2026, 2, 10, 14, 30), event: "Incident reported — investigation initiated", by: "Rania Abbas" },
      { date: new Date(2026, 2, 11, 10, 0), event: "Root cause analysis completed", by: "Rania Abbas" },
      { date: new Date(2026, 2, 11, 16, 0), event: "Awaiting CAPA plan approval", by: "System" },
    ],
    affectedWorkers: ["Ali Mansour"],
    isoReference: "ISO 45001 §10.2 + §8.1.2 (Eliminating hazards)",
    source: "Weather Alert",
  },
];

// ── Configs ──────────────────────────────────────────────────────

const STATUS_CONFIG: Record<InvestigationStatus, { label: string; color: string; bg: string }> = {
  open: { label: "Open", color: "#00C8E0", bg: "rgba(0,200,224,0.08)" },
  investigating: { label: "Investigating", color: "#FF9500", bg: "rgba(255,150,0,0.08)" },
  pending_capa: { label: "Pending CAPA", color: "#FFD60A", bg: "rgba(255,214,10,0.08)" },
  capa_in_progress: { label: "CAPA In Progress", color: "#BF5AF2", bg: "rgba(191,90,242,0.08)" },
  closed: { label: "Closed", color: "#00C853", bg: "rgba(0,200,83,0.08)" },
  overdue: { label: "Overdue", color: "#FF2D55", bg: "rgba(255,45,85,0.08)" },
};

const SEVERITY_CONFIG: Record<Severity, { label: string; color: string }> = {
  critical: { label: "Critical", color: "#FF2D55" },
  high: { label: "High", color: "#FF9500" },
  medium: { label: "Medium", color: "#FFD60A" },
  low: { label: "Low", color: "#00C8E0" },
};

const CAUSE_CATEGORY_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  human: { label: "Human Factor", color: "#FF9500", icon: "H" },
  equipment: { label: "Equipment", color: "#00C8E0", icon: "E" },
  process: { label: "Process", color: "#BF5AF2", icon: "P" },
  environment: { label: "Environment", color: "#00C853", icon: "N" },
  management: { label: "Management", color: "#FFD60A", icon: "M" },
};

const CAPA_STATUS_CONFIG: Record<CAPAStatus, { label: string; color: string }> = {
  planned: { label: "Planned", color: "#00C8E0" },
  in_progress: { label: "In Progress", color: "#FF9500" },
  completed: { label: "Completed", color: "#00C853" },
  overdue: { label: "Overdue", color: "#FF2D55" },
  verified: { label: "Verified", color: "#BF5AF2" },
};

// ── PDF Export ───────────────────────────────────────────────────

function exportInvestigationPDF(inv: Investigation) {
  console.log("[SUPABASE_READY] pdf_export_investigation: " + inv.id);
  toast.loading("Generating Investigation Report...", { id: "inv-pdf" });

  try {
    const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    let y = 15;

    // Header
    const sevCfg = SEVERITY_CONFIG[inv.severity];
    doc.setFillColor(10, 18, 32);
    doc.rect(0, 0, pw, 32, "F");
    doc.setTextColor(0, 200, 224);
    doc.setFontSize(18);
    doc.text("INCIDENT INVESTIGATION REPORT", 14, 14);
    doc.setFontSize(9);
    doc.setTextColor(200, 200, 200);
    doc.text(`${inv.id} | ${inv.incidentId} | ${inv.isoReference}`, 14, 22);
    doc.text(`Status: ${STATUS_CONFIG[inv.status].label.toUpperCase()}`, pw - 14, 14, { align: "right" });
    doc.text(`Severity: ${sevCfg.label.toUpperCase()}`, pw - 14, 22, { align: "right" });
    doc.setFontSize(7);
    doc.setTextColor(0, 200, 224);
    doc.text("SOSphere Safety Intelligence Platform", 14, 29);
    y = 38;

    // Incident Summary
    doc.setTextColor(40, 40, 40);
    doc.setFontSize(12);
    doc.text("1. INCIDENT SUMMARY", 14, y);
    y += 6;

    autoTable(doc, {
      startY: y,
      head: [["Field", "Details"]],
      body: [
        ["Title", inv.title],
        ["Date & Time", inv.incidentDate.toLocaleString()],
        ["Location", inv.zone],
        ["Reported By", inv.reportedBy],
        ["Lead Investigator", inv.investigator],
        ["Affected Workers", inv.affectedWorkers.join(", ")],
        ["Description", inv.description],
      ],
      theme: "striped",
      headStyles: { fillColor: [0, 200, 224], fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 40 } },
    });
    y = (doc as any).lastAutoTable.finalY + 8;

    // Root Cause Analysis
    if (y + 20 > ph) { doc.addPage(); y = 15; }
    doc.setFontSize(12);
    doc.setTextColor(255, 45, 85);
    doc.text("2. ROOT CAUSE ANALYSIS", 14, y);
    y += 6;

    if (inv.rootCauses.length > 0) {
      autoTable(doc, {
        startY: y,
        head: [["ID", "Category", "Type", "Description", "Evidence"]],
        body: inv.rootCauses.map(rc => [
          rc.id,
          CAUSE_CATEGORY_CONFIG[rc.category]?.label || rc.category,
          rc.contributing ? "Contributing Factor" : "Root Cause",
          rc.description,
          rc.evidence.join("; "),
        ]),
        theme: "striped",
        headStyles: { fillColor: [255, 45, 85], fontSize: 7, fontStyle: "bold" },
        bodyStyles: { fontSize: 7 },
        margin: { left: 14, right: 14 },
        columnStyles: { 3: { cellWidth: 60 }, 4: { cellWidth: 40 } },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    }

    // CAPA Plan
    if (y + 20 > ph) { doc.addPage(); y = 15; }
    doc.setFontSize(12);
    doc.setTextColor(191, 90, 242);
    doc.text("3. CORRECTIVE & PREVENTIVE ACTIONS (CAPA)", 14, y);
    y += 6;

    if (inv.actions.length > 0) {
      autoTable(doc, {
        startY: y,
        head: [["ID", "Type", "Action", "Assigned To", "Due Date", "Status", "Notes"]],
        body: inv.actions.map(a => [
          a.id,
          a.type === "corrective" ? "Corrective" : "Preventive",
          a.description,
          a.assignedTo,
          a.dueDate.toLocaleDateString(),
          CAPA_STATUS_CONFIG[a.status]?.label || a.status,
          a.notes,
        ]),
        theme: "striped",
        headStyles: { fillColor: [191, 90, 242], fontSize: 7, fontStyle: "bold" },
        bodyStyles: { fontSize: 6.5 },
        margin: { left: 14, right: 14 },
        columnStyles: { 2: { cellWidth: 40 }, 6: { cellWidth: 35 } },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    }

    // Investigation Timeline
    if (y + 20 > ph) { doc.addPage(); y = 15; }
    doc.setFontSize(12);
    doc.setTextColor(0, 150, 180);
    doc.text("4. INVESTIGATION TIMELINE", 14, y);
    y += 6;

    autoTable(doc, {
      startY: y,
      head: [["Date/Time", "Event", "By"]],
      body: inv.timeline.map(t => [
        t.date.toLocaleString(),
        t.event,
        t.by,
      ]),
      theme: "striped",
      headStyles: { fillColor: [0, 150, 180], fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 7.5 },
      margin: { left: 14, right: 14 },
      columnStyles: { 1: { cellWidth: 90 } },
    });
    y = (doc as any).lastAutoTable.finalY + 8;

    // Sign-off area
    if (y + 40 > ph) { doc.addPage(); y = 15; }
    doc.setFontSize(12);
    doc.setTextColor(40, 40, 40);
    doc.text("5. SIGN-OFF", 14, y);
    y += 8;
    const roles = ["Lead Investigator", "HSE Manager", "Site Manager", "General Manager"];
    roles.forEach((role, i) => {
      doc.setFontSize(8);
      doc.text(`${role}: ___________________________`, 14, y + i * 12);
      doc.text("Date: ______________", pw - 60, y + i * 12);
    });

    // Footer + Watermark
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(36);
      doc.setTextColor(240, 240, 240);
      doc.text("CONFIDENTIAL", pw / 2, ph / 2, { align: "center", angle: 45 });
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text(`SOSphere Investigation Report — ${inv.id} — ${inv.title}`, 14, ph - 8);
      doc.text(`Page ${i}/${pageCount}`, pw - 14, ph - 8, { align: "right" });
      doc.setDrawColor(200, 200, 200);
      doc.line(14, ph - 12, pw - 14, ph - 12);
    }

    doc.save(`Investigation-${inv.id}.pdf`);
    toast.success("Investigation Report exported!", { id: "inv-pdf" });
  } catch (err) {
    console.error(err);
    toast.error("Failed to generate PDF", { id: "inv-pdf" });
  }
}

// ── Main Page Component ──────────────────────────────────────────

// ── Field Evidence Section (from Evidence Vault) ─────────────────
function FieldEvidenceSection({ investigationId, zone }: { investigationId: string; zone: string }) {
  const allEvd = getAllEvidence();
  // Show evidence linked to this investigation OR from the same zone
  const linked = allEvd.filter(e => e.linkedInvestigationId === investigationId);
  const zoneMatch = allEvd.filter(e => !e.linkedInvestigationId && e.zone.toLowerCase().includes(zone.split(" - ")[0].toLowerCase()));
  const [linking, setLinking] = useState<string | null>(null);

  const handleLink = (evdId: string) => {
    setLinking(evdId);
    setTimeout(() => {
      const adminName = (() => { try { return JSON.parse(localStorage.getItem("sosphere_admin_profile") || "{}").name || "Admin"; } catch { return "Admin"; } })();
      linkToInvestigation(evdId, investigationId, adminName);
      console.log("[SUPABASE_READY] link_evidence: " + JSON.stringify({ evidenceId: evdId, investigationId }));
      setLinking(null);
      toast.success("Evidence linked to investigation", {
        description: `${evdId} is now attached to ${investigationId}`,
      });
    }, 800);
  };

  return (
    <div>
      <h3 style={{ ...TYPOGRAPHY.overline, color: "#7B5EFF", marginBottom: 10 }}>
        FIELD EVIDENCE
        {linked.length > 0 && (
          <span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 400 }}> ({linked.length} linked)</span>
        )}
      </h3>

      {/* Linked evidence */}
      {linked.length > 0 ? (
        <div className="space-y-3">
          {linked.map(evd => (
            <div key={evd.id} className="rounded-xl overflow-hidden"
              style={{ background: "rgba(123,94,255,0.04)", border: "1px solid rgba(123,94,255,0.12)" }}>
              <div className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <Camera className="size-3.5" style={{ color: "#7B5EFF" }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#7B5EFF" }}>{evd.id}</span>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
                    from {evd.submittedBy} · {evd.incidentType}
                  </span>
                </div>

                {/* Pipeline visual */}
                <EvidencePipelineVisual entry={evd} compact />

                {/* Photos */}
                {evd.photos.length > 0 && (
                  <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
                    {evd.photos.map((photo, i) => (
                      <div key={photo.id} className="flex-shrink-0 size-16 rounded-xl overflow-hidden"
                        style={{ border: "1px solid rgba(0,200,224,0.2)" }}>
                        <img src={photo.dataUrl} alt="" className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                )}

                {/* Audio */}
                {evd.audioMemo && (
                  <div className="mt-3">
                    <AudioMemoPlayer audioMemo={evd.audioMemo} />
                  </div>
                )}

                {/* Worker statement */}
                {evd.workerComment && (
                  <p className="mt-3" style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.5, fontStyle: "italic" }}>
                    &ldquo;{evd.workerComment}&rdquo;
                  </p>
                )}

                {/* Chain of custody */}
                <div className="mt-3">
                  <ChainOfCustody actions={evd.actions} compact />
                </div>

                {/* Comments */}
                <div className="mt-3">
                  <EvidenceComments evidenceId={evd.id} comments={evd.comments} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {/* No linked evidence — suggest from zone */}
          <div className="rounded-xl p-4 text-center"
            style={{ background: "rgba(123,94,255,0.03)", border: "1px dashed rgba(123,94,255,0.12)" }}>
            <Camera className="size-6 mx-auto mb-2" style={{ color: "rgba(123,94,255,0.3)" }} />
            <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)" }}>
              No field evidence linked yet
            </p>
            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginTop: 4 }}>
              Link evidence from the Evidence Vault to support this investigation
            </p>
          </div>

          {/* Available zone evidence to link */}
          {zoneMatch.length > 0 && (
            <div>
              <p style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", marginBottom: 8 }}>
                AVAILABLE EVIDENCE FROM {zone.split(" - ")[0].toUpperCase()}
              </p>
              {zoneMatch.slice(0, 3).map(evd => (
                <div key={evd.id} className="flex items-center gap-3 p-3 rounded-xl mb-2"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <Camera className="size-4 flex-shrink-0" style={{ color: "rgba(123,94,255,0.5)" }} />
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>
                      {evd.submittedBy} · {evd.photos.length} photos{evd.audioMemo ? " + audio" : ""}
                    </p>
                    <p style={{ fontSize: 8, color: "rgba(255,255,255,0.25)" }}>{evd.incidentType} · {evd.zone}</p>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleLink(evd.id)}
                    disabled={linking === evd.id}
                    className="px-3 py-1.5 rounded-lg"
                    style={{
                      background: "rgba(123,94,255,0.1)",
                      border: "1px solid rgba(123,94,255,0.2)",
                      color: "#7B5EFF",
                      fontSize: 9, fontWeight: 700,
                    }}>
                    {linking === evd.id ? "Linking..." : "Link"}
                  </motion.button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function IncidentInvestigationPage({ t, webMode, initialSourceFilter, pendingInvestigations = [], onRiskUpdate }: { t: (k: string) => string; webMode?: boolean; initialSourceFilter?: string; pendingInvestigations?: any[]; onRiskUpdate?: (riskId: string, update: Record<string, any>) => void }) {
  const [investigations, setInvestigations] = useState(() => {
    // Load any real investigations saved from resolved emergencies
    try {
      const saved = JSON.parse(localStorage.getItem("sosphere_investigations") || "[]") as Investigation[];
      // Restore Date objects (JSON serialization loses them)
      const restored = saved.map(inv => ({
        ...inv,
        incidentDate: new Date(inv.incidentDate),
        finalReportDate: inv.finalReportDate ? new Date(inv.finalReportDate) : undefined,
        timeline: inv.timeline.map(t => ({ ...t, date: new Date(t.date) })),
        actions: inv.actions.map(a => ({ ...a, dueDate: new Date(a.dueDate), completedDate: a.completedDate ? new Date(a.completedDate) : undefined })),
      }));
      // Merge: real saved + mock (for demo). Real ones come first.
      const realIds = new Set(restored.map(r => r.id));
      const mockFiltered = MOCK_INVESTIGATIONS.filter(m => !realIds.has(m.id));
      return [...restored, ...mockFiltered];
    } catch {
      return MOCK_INVESTIGATIONS;
    }
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | InvestigationStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string | null>(initialSourceFilter || null);

  // ── Persist ALL user investigations to localStorage ──
  // Saves real + manually-created investigations; excludes unmodified mock ones
  useEffect(() => {
    const realOrModified = investigations.filter(inv => {
      const mock = MOCK_INVESTIGATIONS.find(m => m.id === inv.id);
      // Keep if: not a mock, OR mock was modified (status/findings changed)
      return !mock || mock.status !== inv.status || mock.findings !== inv.findings;
    });
    if (realOrModified.length > 0) {
      try {
        localStorage.setItem("sosphere_investigations", JSON.stringify(realOrModified));
      } catch { /* storage full */ }
    }
  }, [investigations]);

  // ── Listen for new emergencies that need investigation ──
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "sosphere_new_investigation" && e.newValue) {
        try {
          const emgData = JSON.parse(e.newValue);
          const newInv = createInvestigationFromEmergency(emgData);
          setInvestigations(prev => {
            if (prev.some(p => p.incidentId === emgData.id)) return prev;
            return [newInv, ...prev];
          });
          toast.success(`New investigation created: ${newInv.title}`);
        } catch {}
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  // ── Merge escalated investigations from Reports tab ────────────
  useEffect(() => {
    if (pendingInvestigations.length > 0) {
      setInvestigations(prev => {
        const existingIds = new Set(prev.map(inv => inv.id));
        const newOnes = pendingInvestigations.filter(p => !existingIds.has(p.id));
        if (newOnes.length === 0) return prev;
        console.log("[SUPABASE_READY] investigations_merged: " + JSON.stringify(newOnes.map(n => n.id)));
        return [...newOnes, ...prev];
      });
    }
  }, [pendingInvestigations]);

  // ── Mutation Handlers ──────────────────────────────────────────

  const updateInvestigationStatus = (id: string, status: InvestigationStatus) => {
    setInvestigations(prev => prev.map(inv =>
      inv.id === id
        ? { ...inv, status, timeline: [...inv.timeline, { date: new Date(), event: `Status changed to ${status}`, by: "Admin" }] }
        : inv
    ));
    console.log("[SUPABASE_READY] investigation_mutation: " + JSON.stringify({ id, action: "update_status", status }));
    toast.success(`Investigation ${id} → ${status}`);
  };

  const closeInvestigation = (id: string, resolution: string) => {
    const inv = investigations.find(i => i.id === id);
    setInvestigations(prev => prev.map(inv =>
      inv.id === id
        ? {
            ...inv,
            status: "closed" as InvestigationStatus,
            finalReportDate: new Date(),
            timeline: [...inv.timeline, { date: new Date(), event: `Investigation closed: ${resolution}`, by: "Admin" }],
          }
        : inv
    ));
    console.log("[SUPABASE_READY] investigation_mutation: " + JSON.stringify({ id, action: "close", resolution }));
    toast.success(`Investigation ${id} closed`);

    // Cross-update related risk by zone match
    if (inv && onRiskUpdate) {
      const relatedRisk = MOCK_RISKS.find(r => r.zone === inv.zone);
      if (relatedRisk) {
        onRiskUpdate(relatedRisk.id, {
          lastIncidentDate: new Date().toISOString(),
          investigationResolution: resolution,
          controlsReviewed: true,
        });
        console.log("[SUPABASE_READY] investigation_closed_risk_updated: " + JSON.stringify({ investigationId: id, relatedRiskId: relatedRisk.id }));
      }
    }
  };

  const addCAPAAction = (investigationId: string, action: Omit<CorrectiveAction, "id">) => {
    const newAction: CorrectiveAction = { ...action, id: `CAPA-${Date.now()}` };
    setInvestigations(prev => prev.map(inv =>
      inv.id === investigationId
        ? {
            ...inv,
            actions: [...inv.actions, newAction],
            timeline: [...inv.timeline, { date: new Date(), event: `CAPA added: ${newAction.description.slice(0, 50)}`, by: action.assignedTo }],
          }
        : inv
    ));
    console.log("[SUPABASE_READY] investigation_mutation: " + JSON.stringify({ id: investigationId, action: "add_capa", capaId: newAction.id }));
    toast.success("CAPA action added");
  };

  // ── Filters ────────────────────────────────────────────────────

  const filtered = investigations.filter(inv => {
    if (filterStatus !== "all" && inv.status !== filterStatus) return false;
    if (sourceFilter && inv.source !== sourceFilter) return false;
    if (searchQuery && !inv.title.toLowerCase().includes(searchQuery.toLowerCase()) && !inv.id.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const sortedInvestigations = sortByPriority(
    filtered.map(inv => ({
      ...inv,
      priority: inv.severity === "critical" ? 1 : inv.severity === "high" ? 2 : 3,
      hasOverdue: inv.actions?.some(a => a.status === "overdue"),
      timestamp: inv.incidentDate,
    }))
  );
  console.log("[SUPABASE_READY] investigations_sorted: " + sortedInvestigations.map(i => i.id).join(", "));

  const selected = investigations.find(i => i.id === selectedId);

  const stats = {
    total: investigations.length,
    open: investigations.filter(i => i.status !== "closed").length,
    overdue: investigations.filter(i => i.actions.some(a => a.status === "overdue" || (a.status !== "completed" && a.status !== "verified" && a.dueDate < new Date()))).length,
    closed: investigations.filter(i => i.status === "closed").length,
  };

  return (
    <div className={`p-5 space-y-5 ${webMode ? "max-w-6xl mx-auto" : ""}`}>
      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Investigations", value: stats.total, color: "#00C8E0", icon: FileText },
          { label: "Open / Active", value: stats.open, color: "#FF9500", icon: AlertTriangle },
          { label: "Overdue CAPAs", value: stats.overdue, color: "#FF2D55", icon: Clock },
          { label: "Closed", value: stats.closed, color: "#00C853", icon: CheckCircle2 },
        ].map(s => {
          const I = s.icon;
          return (
            <div key={s.label} className="rounded-xl p-4" style={{ background: `${s.color}06`, border: `1px solid ${s.color}12` }}>
              <div className="flex items-center gap-2 mb-2">
                <I className="size-4" style={{ color: s.color }} />
                <span style={{ ...TYPOGRAPHY.overline, color: "rgba(255,255,255,0.35)" }}>{s.label}</span>
              </div>
              <span className="text-white" style={{ fontSize: 28, fontWeight: 800 }}>{s.value}</span>
            </div>
          );
        })}
      </div>

      {/* Search + Filters */}
      {sourceFilter && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.12)" }}>
          <Filter className="size-3.5" style={{ color: "#FF2D55" }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: "#FF2D55" }}>
            Filtered by source: {sourceFilter}
          </span>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginLeft: 4 }}>
            ({filtered.length} result{filtered.length !== 1 ? "s" : ""})
          </span>
          <button
            onClick={() => setSourceFilter(null)}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg"
            style={{ background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.15)", cursor: "pointer" }}
          >
            <X className="size-3" style={{ color: "#FF2D55" }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: "#FF2D55" }}>Clear Filter</span>
          </button>
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <Search className="size-4" style={{ color: "rgba(255,255,255,0.25)" }} />
          <input
            type="text"
            placeholder="Search investigations..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent outline-none text-white"
            style={{ fontSize: 12 }}
          />
        </div>
        <div className="flex gap-1.5">
          {(["all", "investigating", "pending_capa", "capa_in_progress", "closed"] as const).map(f => (
            <button key={f} onClick={() => setFilterStatus(f)}
              className="px-3 py-1.5 rounded-lg whitespace-nowrap"
              style={{
                background: filterStatus === f ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${filterStatus === f ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.05)"}`,
                fontSize: 10, fontWeight: 600,
                color: filterStatus === f ? "#00C8E0" : "rgba(255,255,255,0.4)",
              }}>
              {f === "all" ? "All" : STATUS_CONFIG[f]?.label || f}
            </button>
          ))}
        </div>
      </div>

      {/* Split View: List + Detail */}
      <div className="grid grid-cols-5 gap-4" style={{ minHeight: 500 }}>
        {/* Investigation List */}
        <div className="col-span-2 space-y-2 overflow-y-auto" style={{ maxHeight: 620, scrollbarWidth: "none" }}>
          <div className="flex items-center gap-1.5 mb-1">
            <Zap className="size-3" style={{ color: "rgba(0,200,224,0.4)" }} />
            <span style={{ fontSize: 9, fontWeight: 600, color: "rgba(0,200,224,0.4)" }}>Auto-sorted by priority</span>
          </div>
          {sortedInvestigations.map(inv => {
            const stCfg = STATUS_CONFIG[inv.status];
            const sevCfg = SEVERITY_CONFIG[inv.severity];
            const isActive = selectedId === inv.id;
            const capaProgress = inv.actions.length > 0
              ? Math.round(inv.actions.filter(a => a.status === "completed" || a.status === "verified").length / inv.actions.length * 100)
              : 0;

            return (
              <motion.div
                key={inv.id}
                layout
                onClick={() => setSelectedId(inv.id)}
                className="rounded-xl p-3.5 cursor-pointer"
                style={{
                  background: isActive ? "rgba(0,200,224,0.06)" : "rgba(255,255,255,0.02)",
                  border: `1px solid ${isActive ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.05)"}`,
                  transition: "all 0.2s",
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="size-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `${sevCfg.color}12`, border: `1px solid ${sevCfg.color}20` }}>
                    <TriangleAlert className="size-4" style={{ color: sevCfg.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.25)" }}>{inv.id}</span>
                      <div className="px-1.5 py-0.5 rounded" style={{ background: stCfg.bg, border: `1px solid ${stCfg.color}20` }}>
                        <span style={{ fontSize: 7.5, fontWeight: 800, color: stCfg.color }}>{stCfg.label.toUpperCase()}</span>
                      </div>
                    </div>
                    <p className="text-white truncate" style={{ fontSize: 12, fontWeight: 700 }}>{inv.title}</p>
                    <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                      {inv.zone} &bull; {inv.incidentDate.toLocaleDateString()}
                    </p>
                    {/* CAPA Progress */}
                    {inv.actions.length > 0 && (
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex-1 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.04)" }}>
                          <div className="h-full rounded-full" style={{ width: `${capaProgress}%`, background: capaProgress === 100 ? "#00C853" : "#BF5AF2", transition: "width 0.3s" }} />
                        </div>
                        <span style={{ fontSize: 8, fontWeight: 700, color: capaProgress === 100 ? "#00C853" : "#BF5AF2" }}>
                          CAPA {capaProgress}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Detail Panel */}
        <div className="col-span-3 rounded-xl overflow-y-auto" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", maxHeight: 620, scrollbarWidth: "none" }}>
          {selected ? (
            <div className="p-5 space-y-5">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.25)" }}>{selected.id}</span>
                    <div className="px-2 py-0.5 rounded" style={{ background: STATUS_CONFIG[selected.status].bg, border: `1px solid ${STATUS_CONFIG[selected.status].color}20` }}>
                      <span style={{ fontSize: 8, fontWeight: 800, color: STATUS_CONFIG[selected.status].color }}>{STATUS_CONFIG[selected.status].label.toUpperCase()}</span>
                    </div>
                    <div className="px-2 py-0.5 rounded" style={{ background: `${SEVERITY_CONFIG[selected.severity].color}10` }}>
                      <span style={{ fontSize: 8, fontWeight: 800, color: SEVERITY_CONFIG[selected.severity].color }}>{SEVERITY_CONFIG[selected.severity].label.toUpperCase()}</span>
                    </div>
                  </div>
                  <h2 className="text-white" style={{ fontSize: 18, fontWeight: 800 }}>{selected.title}</h2>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
                    {selected.zone} &bull; {selected.incidentDate.toLocaleString()} &bull; Investigator: {selected.investigator}
                  </p>
                  <p style={{ fontSize: 9, color: "rgba(0,200,224,0.5)", marginTop: 2 }}>{selected.isoReference}</p>
                </div>
                <button
                  onClick={() => exportInvestigationPDF(selected)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl"
                  style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)", cursor: "pointer" }}>
                  <Download className="size-3.5" style={{ color: "#00C8E0" }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#00C8E0" }}>Export PDF</span>
                </button>
              </div>

              {/* Description */}
              <div className="rounded-xl p-3.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>{selected.description}</p>
              </div>

              {/* Root Cause Analysis */}
              <div>
                <h3 style={{ ...TYPOGRAPHY.overline, color: "#FF2D55", marginBottom: 10 }}>ROOT CAUSE ANALYSIS</h3>
                <div className="space-y-2">
                  {selected.rootCauses.map(rc => {
                    const catCfg = CAUSE_CATEGORY_CONFIG[rc.category];
                    return (
                      <div key={rc.id} className="flex items-start gap-3 p-3 rounded-xl"
                        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                        <div className="size-8 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: `${catCfg.color}12`, border: `1px solid ${catCfg.color}20` }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: catCfg.color }}>{catCfg.icon}</span>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span style={{ fontSize: 9, fontWeight: 700, color: catCfg.color }}>{catCfg.label}</span>
                            <span style={{ fontSize: 8, fontWeight: 700, color: rc.contributing ? "rgba(255,255,255,0.3)" : "#FF2D55" }}>
                              {rc.contributing ? "Contributing Factor" : "ROOT CAUSE"}
                            </span>
                          </div>
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>{rc.description}</p>
                          {rc.evidence.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {rc.evidence.map((ev, i) => (
                                <span key={i} className="px-2 py-0.5 rounded" style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                                  <Paperclip className="size-2.5 inline mr-1" style={{ color: "rgba(255,255,255,0.2)" }} />{ev}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* CAPA Table */}
              <div>
                <h3 style={{ ...TYPOGRAPHY.overline, color: "#BF5AF2", marginBottom: 10 }}>CORRECTIVE & PREVENTIVE ACTIONS</h3>
                {selected.actions.length > 0 ? (
                  <div className="space-y-2">
                    {selected.actions.map(action => {
                      const stCfg = CAPA_STATUS_CONFIG[action.status];
                      return (
                        <div key={action.id} className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                          <div className="flex items-center gap-2 mb-2">
                            <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.2)" }}>{action.id}</span>
                            <div className="px-1.5 py-0.5 rounded" style={{ background: action.type === "corrective" ? "rgba(255,150,0,0.08)" : "rgba(0,200,224,0.08)" }}>
                              <span style={{ fontSize: 7.5, fontWeight: 800, color: action.type === "corrective" ? "#FF9500" : "#00C8E0" }}>
                                {action.type === "corrective" ? "CORRECTIVE" : "PREVENTIVE"}
                              </span>
                            </div>
                            <div className="px-1.5 py-0.5 rounded" style={{ background: `${stCfg.color}10` }}>
                              <span style={{ fontSize: 7.5, fontWeight: 800, color: stCfg.color }}>{stCfg.label.toUpperCase()}</span>
                            </div>
                            <span className="ml-auto" style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>
                              Due: {action.dueDate.toLocaleDateString()}
                            </span>
                          </div>
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>{action.description}</p>
                          <div className="flex items-center gap-3 mt-2" style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
                            <span>Assigned: {action.assignedTo}</span>
                            {action.completedDate && <span>&bull; Completed: {action.completedDate.toLocaleDateString()}</span>}
                            {action.verifiedBy && <span>&bull; Verified by: {action.verifiedBy}</span>}
                          </div>
                          {action.notes && (
                            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontStyle: "italic", marginTop: 4 }}>{action.notes}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8 rounded-xl" style={{ background: "rgba(255,214,10,0.04)", border: "1px dashed rgba(255,214,10,0.15)" }}>
                    <div className="text-center">
                      <Flag className="size-6 mx-auto mb-2" style={{ color: "rgba(255,214,10,0.4)" }} />
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#FFD60A" }}>CAPA Plan Pending</p>
                      <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>Root cause analysis is complete. Awaiting corrective action plan approval.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Timeline */}
              <div>
                <h3 style={{ ...TYPOGRAPHY.overline, color: "rgba(255,255,255,0.4)", marginBottom: 10 }}>INVESTIGATION TIMELINE</h3>
                <div className="relative pl-5">
                  <div className="absolute left-[7px] top-1 bottom-1 w-px" style={{ background: "linear-gradient(180deg, rgba(0,200,224,0.2), rgba(0,200,224,0.03))" }} />
                  {selected.timeline.map((entry, i) => (
                    <div key={i} className="relative flex items-start gap-3 mb-3">
                      <div className="absolute -left-5 mt-1 size-4 rounded-full flex items-center justify-center"
                        style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)" }}>
                        <CircleDot className="size-2" style={{ color: "#00C8E0" }} />
                      </div>
                      <div>
                        <p style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>{entry.event}</p>
                        <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>
                          {entry.date.toLocaleString()} &bull; {entry.by}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Field Evidence (from Evidence Vault) ── */}
              <FieldEvidenceSection investigationId={selected.id} zone={selected.zone} />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Eye className="size-10 mx-auto mb-3" style={{ color: "rgba(255,255,255,0.08)" }} />
                <p style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.15)" }}>Select an investigation</p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.08)", marginTop: 4 }}>Click on any item to view full details, RCA, and CAPA plan</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}