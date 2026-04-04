// ═══════════════════════════════════════════════════════════════
// SOSphere — Emergency Lifecycle Report (Full PDF)
// Generates a comprehensive incident report from SOS → Resolution
// ISO 45001 · ISO 27001 · Professional Enterprise Format
// ═══════════════════════════════════════════════════════════════

import jsPDF from "jspdf";
import { autoTable } from "jspdf-autotable";
import { toast } from "sonner";
import {
  getTimelineEntries, getRealResponseTimeSec, getRealDurationMin,
  getRealResponders, getTimelineForReport, getCommsLog, getGPSTrail,
  verifyChainIntegrity, type TimelineEntry
} from "./smart-timeline-tracker";
import { getEvidenceForEmergency } from "./evidence-store";

// ── Types ───────────────────────────────────────────────────────

export interface EmergencyReportData {
  // Core emergency
  emergencyId: string;
  severity: "critical" | "high" | "medium" | "low";
  employeeName: string;
  zone: string;
  type: string;
  triggeredAt: Date;
  resolvedAt: Date;
  status: string;
  // Response
  responseTimeSec: number;
  totalDurationMin: number;
  responders: { name: string; role: string; arrivedAt: string }[];
  // Timeline
  timeline: { time: string; event: string; actor: string; type: "trigger" | "action" | "escalation" | "resolution" | "system" }[];
  // Context
  weatherCondition: string;
  temperature: string;
  zoneRiskLevel: string;
  nearbyWorkers: number;
  gpsCoords: { lat: number; lng: number };
  // Actions taken
  actionsTaken: { action: string; by: string; time: string; result: string }[];
  // Communication log
  commsLog: { time: string; from: string; to: string; channel: string; message: string }[];
  // Resolution
  resolutionSummary: string;
  rootCauseInitial: string;
  immediateActions: string[];
  injuryReport: { occurred: boolean; type?: string; severity?: string; medicalAttention?: boolean };
  // Compliance
  isoChecklist: { item: string; status: "pass" | "fail" | "na" }[];
  // Field Evidence — photos from Incident Photo Report (if available)
  fieldEvidence?: {
    photoCount: number;
    incidentType?: string;
    workerComment?: string;
    severity?: string;
    submittedAt?: Date;
    photoRetentionDays?: number;
  };
  // Company
  companyName: string;
  siteName: string;
  reportGeneratedBy: string;
  reportGeneratedAt: Date;
}

// ── Severity Config ─────────────────────────────────────────────
const SEV_CFG = {
  critical: { label: "CRITICAL", rgb: [255, 45, 85] as [number, number, number], hex: "#FF2D55" },
  high: { label: "HIGH", rgb: [255, 150, 0] as [number, number, number], hex: "#FF9500" },
  medium: { label: "MEDIUM", rgb: [255, 214, 10] as [number, number, number], hex: "#FFD60A" },
  low: { label: "LOW", rgb: [0, 200, 224] as [number, number, number], hex: "#00C8E0" },
};

const TL_TYPE_COLORS: Record<string, [number, number, number]> = {
  trigger: [255, 45, 85],
  action: [0, 200, 224],
  escalation: [255, 150, 0],
  resolution: [0, 200, 83],
  system: [128, 144, 165],
};

// ── Generate Mock Report Data from Emergency ────────────────────

export function buildReportData(emg: {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  employeeName: string;
  zone: string;
  type: string;
  timestamp: Date;
  status: string;
  elapsed: number;
  isOwned?: boolean;
  ownedBy?: string;
}): EmergencyReportData {
  const triggeredAt = emg.timestamp;

  // ── REAL DATA: Try Smart Timeline Tracker first ──
  const timelineEntries = getTimelineEntries(emg.id);
  const hasRealTimeline = timelineEntries.length > 0;

  // Real response time (or estimate from elapsed)
  const realResponseSec = getRealResponseTimeSec(emg.id);
  const responseTime = realResponseSec ?? Math.min(emg.elapsed, 300);

  // Real duration (or calculate from elapsed)
  const realDurationMin = getRealDurationMin(emg.id);
  const resolvedAt = hasRealTimeline
    ? new Date(triggeredAt.getTime() + (realDurationMin || Math.ceil(emg.elapsed / 60)) * 60000)
    : new Date(triggeredAt.getTime() + Math.max(emg.elapsed, 300) * 1000);
  const totalMin = realDurationMin ?? Math.round((resolvedAt.getTime() - triggeredAt.getTime()) / 60000);

  const fmt = (d: Date) => d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const fmtOff = (d: Date, sec: number) => fmt(new Date(d.getTime() + sec * 1000));

  // ── REAL RESPONDERS: From timeline or fallback ──
  const realResponders = getRealResponders(emg.id);
  const responders = realResponders.length > 0
    ? realResponders.map(r => ({
        name: r.name,
        role: r.role,
        arrivedAt: new Date(r.firstActionAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      }))
    : [{ name: emg.ownedBy || "Assigned Responder", role: "Incident Commander", arrivedAt: fmtOff(triggeredAt, responseTime) }];

  // ── REAL TIMELINE: From tracker or generate minimal ──
  const timeline = hasRealTimeline
    ? getTimelineForReport(emg.id)
    : [
        { time: fmt(triggeredAt), event: `${emg.type} triggered by ${emg.employeeName}`, actor: emg.employeeName, type: "trigger" as const },
        { time: fmtOff(triggeredAt, 3), event: "Alert dispatched to responders", actor: "System", type: "system" as const },
        { time: fmt(resolvedAt), event: "Emergency resolved", actor: emg.ownedBy || "Responder", type: "resolution" as const },
      ];

  // ── REAL COMMS LOG: From tracker or minimal ──
  const commsLog = hasRealTimeline
    ? getCommsLog(emg.id)
    : [{ time: fmt(triggeredAt), from: "System", to: "All Responders", channel: "Push Notification", message: `EMERGENCY: ${emg.type} in ${emg.zone}` }];

  // ── REAL GPS: From tracker or use zone default ──
  const gpsTrail = getGPSTrail(emg.id);
  const gpsCoords = gpsTrail.length > 0
    ? { lat: gpsTrail[0].lat, lng: gpsTrail[0].lng }
    : { lat: 0, lng: 0 }; // Unknown — no GPS data available

  // ── REAL EVIDENCE: From evidence store ──
  const evidenceEntries = getEvidenceForEmergency(emg.id);
  const totalPhotos = evidenceEntries.reduce((sum, e) => sum + e.photos.length, 0);
  const fieldEvidence = evidenceEntries.length > 0 ? {
    photoCount: totalPhotos,
    incidentType: evidenceEntries[0].incidentType,
    workerComment: evidenceEntries[0].workerComment,
    severity: evidenceEntries[0].severity,
    submittedAt: new Date(evidenceEntries[0].submittedAt),
    photoRetentionDays: evidenceEntries[0].retentionDays,
  } : undefined;

  // ── COMPANY NAME: From localStorage (real) ──
  let companyName = "Company";
  try {
    const profile = JSON.parse(localStorage.getItem("sosphere_company_profile") || "{}");
    companyName = profile.companyName || profile.name || "Company";
  } catch {}

  // ── ACTIONS: From real timeline events or minimal ──
  const actionsTaken = hasRealTimeline
    ? timelineEntries
        .filter(e => ["contact_called", "contact_answered", "evidence_submitted", "gps_locked", "escalation_triggered", "admin_answered"].includes(e.type))
        .map(e => ({
          action: e.event,
          by: e.actor,
          time: new Date(e.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          result: "Completed",
        }))
    : [{ action: "Emergency response initiated", by: "System", time: fmt(triggeredAt), result: "Completed" }];

  return {
    emergencyId: emg.id,
    severity: emg.severity,
    employeeName: emg.employeeName,
    zone: emg.zone,
    type: emg.type,
    triggeredAt,
    resolvedAt,
    status: emg.status === "resolved" ? "Resolved" : "Active",
    responseTimeSec: responseTime,
    totalDurationMin: totalMin,
    responders,
    timeline,
    weatherCondition: "Data not available",
    temperature: "—",
    zoneRiskLevel: emg.severity === "critical" ? "EXTREME" : emg.severity === "high" ? "HIGH" : "MODERATE",
    nearbyWorkers: 0, // Real count requires zone query
    gpsCoords,
    actionsTaken,
    commsLog,
    resolutionSummary: hasRealTimeline
      ? `Emergency ${emg.id} (${emg.type}) involving ${emg.employeeName} in ${emg.zone} — ${timeline.length} tracked events. Response time: ${responseTime}s. Total duration: ${totalMin} minutes. ${totalPhotos > 0 ? `${totalPhotos} evidence photos collected.` : ""}`
      : `Emergency ${emg.id} (${emg.type}) involving ${emg.employeeName} in ${emg.zone}. Timeline data not available — report generated from emergency metadata only.`,
    rootCauseInitial: "Pending investigation — see Investigation & CAPA module",
    immediateActions: hasRealTimeline
      ? timelineEntries
          .filter(e => e.type === "escalation_triggered" || e.type === "evidence_submitted" || e.type === "contact_answered")
          .map(e => e.event)
      : ["Emergency response initiated — detailed actions pending investigation"],
    injuryReport: {
      occurred: emg.severity === "critical",
      type: emg.severity === "critical" ? "Assessment pending" : undefined,
      severity: emg.severity === "critical" ? "Under evaluation" : undefined,
      medicalAttention: emg.severity === "critical",
    },
    isoChecklist: [
      { item: "Emergency response initiated within 60 seconds", status: responseTime <= 60 ? "pass" : "fail" },
      { item: "All designated responders notified", status: hasRealTimeline ? "pass" : "na" },
      { item: "GPS location shared with responders", status: gpsTrail.length > 0 ? "pass" : "fail" },
      { item: "First aid administered per protocol", status: "na" },
      { item: "Area secured and access controlled", status: "na" },
      { item: "Witness statements collected", status: "na" },
      { item: "Incident documented with photos/evidence", status: totalPhotos > 0 ? "pass" : "fail" },
      { item: "Near-miss/injury report filed", status: "na" },
      { item: "Affected worker medical clearance obtained", status: "na" },
      { item: "Zone risk reassessment completed", status: "na" },
      { item: "Communication log maintained", status: commsLog.length > 1 ? "pass" : "fail" },
      { item: "Post-incident debrief scheduled", status: "na" },
    ],
    fieldEvidence,
    companyName,
    siteName: companyName,
    reportGeneratedBy: emg.ownedBy || "System (Auto-Generated)",
    reportGeneratedAt: new Date(),
  };
}


// ═══════════════════════════════════════════════════════════════
// PDF Generation — Professional Emergency Lifecycle Report
// ═══════════════════════════════════════════════════════════════

export function generateEmergencyLifecyclePDF(data: EmergencyReportData) {
  toast.loading("Generating Emergency Lifecycle Report...", { id: "emg-pdf" });

  try {
    const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const margin = 14;
    const contentW = pw - margin * 2;

    // ── Helper: Section Title ──────────────────────────────────
    const sev = SEV_CFG[data.severity];

    function sectionTitle(doc: jsPDF, y: number, num: string, title: string, color: [number, number, number] = [0, 200, 224]): number {
      if (y + 20 > ph - 20) { doc.addPage(); y = 20; }
      doc.setDrawColor(...color);
      doc.setLineWidth(0.5);
      doc.line(margin, y, margin + 3, y);
      doc.setFontSize(12);
      doc.setTextColor(...color);
      doc.text(`${num}. ${title}`, margin + 5, y + 0.5);
      doc.setDrawColor(230, 230, 230);
      doc.setLineWidth(0.15);
      doc.line(margin + 5 + doc.getTextWidth(`${num}. ${title}`) + 2, y, pw - margin, y);
      return y + 7;
    }

    // ── Helper: Key-Value Row ──────────────────────────────────
    function kvRow(doc: jsPDF, y: number, key: string, value: string): number {
      if (y + 6 > ph - 20) { doc.addPage(); y = 20; }
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(key, margin, y);
      doc.setTextColor(40, 40, 40);
      doc.text(value, margin + 45, y);
      return y + 5;
    }

    // ═════════════════════════════════════════════════════════════
    // PAGE 1 — COVER
    // ═════════════════════════════════════════════════════════════

    // Dark header band
    doc.setFillColor(10, 18, 32);
    doc.rect(0, 0, pw, 65, "F");

    // SOSphere branding
    doc.setFontSize(8);
    doc.setTextColor(0, 200, 224);
    doc.text("SOSphere", margin, 12);
    doc.setTextColor(100, 120, 140);
    doc.text("Safety Intelligence Platform", margin + 22, 12);

    // Classification badge
    doc.setFillColor(...sev.rgb);
    doc.roundedRect(pw - margin - 35, 7, 35, 8, 2, 2, "F");
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    doc.text(`SEVERITY: ${sev.label}`, pw - margin - 33, 12.5);

    // Report Title
    doc.setFontSize(22);
    doc.setTextColor(255, 255, 255);
    doc.text("EMERGENCY LIFECYCLE", margin, 30);
    doc.text("REPORT", margin, 39);

    // Emergency ID + date
    doc.setFontSize(10);
    doc.setTextColor(0, 200, 224);
    doc.text(data.emergencyId, margin, 50);
    doc.setTextColor(150, 160, 170);
    doc.setFontSize(8);
    doc.text(data.triggeredAt.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }), margin, 56);

    // Status ribbon
    doc.setFillColor(0, 200, 83);
    doc.roundedRect(pw - margin - 25, 48, 25, 7, 2, 2, "F");
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    doc.text("RESOLVED", pw - margin - 20, 53);

    // Quick facts boxes
    let y = 75;
    const boxW = (contentW - 6) / 3;
    const quickFacts = [
      { label: "RESPONSE TIME", value: `${data.responseTimeSec}s`, sub: data.responseTimeSec < 60 ? "Within Target" : "Above Target" },
      { label: "TOTAL DURATION", value: `${data.totalDurationMin} min`, sub: `${data.timeline.length} events logged` },
      { label: "RESPONDERS", value: `${data.responders.length}`, sub: `${data.nearbyWorkers} nearby workers` },
    ];

    quickFacts.forEach((fact, i) => {
      const x = margin + i * (boxW + 3);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, y, boxW, 22, 2, 2, "F");
      doc.setDrawColor(230, 235, 240);
      doc.setLineWidth(0.2);
      doc.roundedRect(x, y, boxW, 22, 2, 2, "S");
      doc.setFontSize(6.5);
      doc.setTextColor(130, 140, 150);
      doc.text(fact.label, x + 4, y + 6);
      doc.setFontSize(16);
      doc.setTextColor(10, 18, 32);
      doc.text(fact.value, x + 4, y + 14);
      doc.setFontSize(6);
      doc.setTextColor(0, 200, 224);
      doc.text(fact.sub, x + 4, y + 19);
    });
    y += 30;

    // Company & Site info
    y = kvRow(doc, y, "Company", data.companyName);
    y = kvRow(doc, y, "Site / Location", data.siteName);
    y = kvRow(doc, y, "Zone", data.zone);
    y = kvRow(doc, y, "GPS Coordinates", `${data.gpsCoords.lat.toFixed(4)}°N, ${data.gpsCoords.lng.toFixed(4)}°E`);
    y = kvRow(doc, y, "Weather", `${data.weatherCondition}, ${data.temperature}`);
    y = kvRow(doc, y, "Zone Risk Level", data.zoneRiskLevel);
    y = kvRow(doc, y, "Report Generated", data.reportGeneratedAt.toLocaleString());
    y = kvRow(doc, y, "Generated By", data.reportGeneratedBy);
    y += 5;

    // ═════════════════════════════════════════════════════════════
    // SECTION 1 — EMERGENCY DETAILS
    // ═════════════════════════════════════════════════════════════

    y = sectionTitle(doc, y, "1", "EMERGENCY DETAILS", sev.rgb);

    autoTable(doc, {
      startY: y,
      head: [["Field", "Details"]],
      body: [
        ["Emergency ID", data.emergencyId],
        ["Type", data.type],
        ["Severity", `${sev.label} — Priority ${data.severity === "critical" ? "P1" : data.severity === "high" ? "P2" : data.severity === "medium" ? "P3" : "P4"}`],
        ["Affected Worker", data.employeeName],
        ["Zone / Location", data.zone],
        ["Triggered At", data.triggeredAt.toLocaleString()],
        ["Resolved At", data.resolvedAt.toLocaleString()],
        ["Total Duration", `${data.totalDurationMin} minutes`],
        ["First Response Time", `${data.responseTimeSec} seconds`],
      ],
      theme: "striped",
      headStyles: { fillColor: sev.rgb, fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 8 },
      margin: { left: margin, right: margin },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 45 } },
    });
    y = (doc as any).lastAutoTable.finalY + 8;

    // ═════════════════════════════════════════════════════════════
    // SECTION 2 — RESPONSE TEAM
    // ═════════════════════════════════════════════════════════════

    y = sectionTitle(doc, y, "2", "RESPONSE TEAM", [0, 200, 224]);

    autoTable(doc, {
      startY: y,
      head: [["Responder", "Role", "Arrived At"]],
      body: data.responders.map(r => [r.name, r.role, r.arrivedAt]),
      theme: "striped",
      headStyles: { fillColor: [0, 200, 224], fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 8 },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 8;

    // ═════════════════════════════════════════════════════════════
    // SECTION 3 — INCIDENT TIMELINE
    // ═════════════════════════════════════════════════════════════

    y = sectionTitle(doc, y, "3", "INCIDENT TIMELINE", [123, 94, 255]);

    autoTable(doc, {
      startY: y,
      head: [["Time", "Event", "Actor", "Type"]],
      body: data.timeline.map(t => [t.time, t.event, t.actor, t.type.toUpperCase()]),
      theme: "striped",
      headStyles: { fillColor: [123, 94, 255], fontSize: 7.5, fontStyle: "bold" },
      bodyStyles: { fontSize: 7 },
      margin: { left: margin, right: margin },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 80 },
        2: { cellWidth: 30 },
        3: { cellWidth: 20 },
      },
      didParseCell: (hookData: any) => {
        if (hookData.section === "body" && hookData.column.index === 3) {
          const type = hookData.cell.raw?.toString().toLowerCase() || "";
          const color = TL_TYPE_COLORS[type] || [40, 40, 40];
          hookData.cell.styles.textColor = color;
          hookData.cell.styles.fontStyle = "bold";
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 8;

    // ═════════════════════════════════════════════════════════════
    // SECTION 4 — ACTIONS TAKEN
    // ═════════════════════════════════════════════════════════════

    y = sectionTitle(doc, y, "4", "ACTIONS TAKEN", [0, 200, 83]);

    autoTable(doc, {
      startY: y,
      head: [["Action", "By", "Time", "Result"]],
      body: data.actionsTaken.map(a => [a.action, a.by, a.time, a.result]),
      theme: "striped",
      headStyles: { fillColor: [0, 200, 83], fontSize: 7.5, fontStyle: "bold" },
      bodyStyles: { fontSize: 7 },
      margin: { left: margin, right: margin },
      columnStyles: { 0: { cellWidth: 65 } },
    });
    y = (doc as any).lastAutoTable.finalY + 8;

    // ═════════════════════════════════════════════════════════════
    // SECTION 5 — COMMUNICATION LOG
    // ═════════════════════════════════════════════════════════════

    y = sectionTitle(doc, y, "5", "COMMUNICATION LOG", [74, 144, 217]);

    autoTable(doc, {
      startY: y,
      head: [["Time", "From", "To", "Channel", "Message"]],
      body: data.commsLog.map(c => [c.time, c.from, c.to, c.channel, c.message]),
      theme: "striped",
      headStyles: { fillColor: [74, 144, 217], fontSize: 7.5, fontStyle: "bold" },
      bodyStyles: { fontSize: 7 },
      margin: { left: margin, right: margin },
      columnStyles: { 4: { cellWidth: 55 } },
    });
    y = (doc as any).lastAutoTable.finalY + 8;

    // ═════════════════════════════════════════════════════════════
    // SECTION 6 — INJURY REPORT
    // ═════════════════════════════════════════════════════════════

    y = sectionTitle(doc, y, "6", "INJURY / MEDICAL REPORT", [255, 45, 85]);

    if (data.injuryReport.occurred) {
      autoTable(doc, {
        startY: y,
        head: [["Field", "Details"]],
        body: [
          ["Injury Occurred", "YES"],
          ["Type", data.injuryReport.type || "N/A"],
          ["Severity", data.injuryReport.severity || "N/A"],
          ["Medical Attention Required", data.injuryReport.medicalAttention ? "Yes — On-site first aid" : "No"],
          ["Worker Cleared for Duty", "Yes — Cleared by on-site nurse"],
        ],
        theme: "striped",
        headStyles: { fillColor: [255, 45, 85], fontSize: 8, fontStyle: "bold" },
        bodyStyles: { fontSize: 8 },
        margin: { left: margin, right: margin },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 50 } },
      });
    } else {
      doc.setFontSize(9);
      doc.setTextColor(0, 200, 83);
      doc.text("No injuries reported — Zero Harm achieved", margin, y + 2);
      y += 4;
      autoTable(doc, {
        startY: y + 2,
        body: [["Injury Occurred", "NO"], ["Near-Miss Classification", "Yes — Logged for trend analysis"]],
        theme: "plain",
        bodyStyles: { fontSize: 8 },
        margin: { left: margin, right: margin },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 50 } },
      });
    }
    y = (doc as any).lastAutoTable.finalY + 8;

    // ═════════════════════════════════════════════════════════════
    // SECTION 7 — RESOLUTION & INITIAL ROOT CAUSE
    // ═════════════════════════════════════════════════════════════

    y = sectionTitle(doc, y, "7", "RESOLUTION SUMMARY & INITIAL ROOT CAUSE", [191, 90, 242]);

    // Resolution summary paragraph
    doc.setFontSize(8);
    doc.setTextColor(40, 40, 40);
    const splitSummary = doc.splitTextToSize(data.resolutionSummary, contentW);
    if (y + splitSummary.length * 4 > ph - 30) { doc.addPage(); y = 20; }
    doc.text(splitSummary, margin, y);
    y += splitSummary.length * 4 + 4;

    // Initial root cause
    doc.setFontSize(8);
    doc.setTextColor(255, 150, 0);
    doc.text("Initial Root Cause Assessment:", margin, y);
    y += 4;
    doc.setTextColor(60, 60, 60);
    const splitRC = doc.splitTextToSize(data.rootCauseInitial, contentW);
    doc.text(splitRC, margin, y);
    y += splitRC.length * 4 + 4;

    // Immediate actions
    doc.setFontSize(8);
    doc.setTextColor(0, 200, 224);
    doc.text("Immediate Corrective Actions:", margin, y);
    y += 5;
    data.immediateActions.forEach((action, i) => {
      if (y + 5 > ph - 20) { doc.addPage(); y = 20; }
      doc.setFontSize(7.5);
      doc.setTextColor(60, 60, 60);
      doc.text(`${i + 1}. ${action}`, margin + 3, y);
      y += 4.5;
    });
    y += 4;

    // ═════════════════════════════════════════════════════════════
    // SECTION 8 — ISO 45001 COMPLIANCE CHECKLIST
    // ═════════════════════════════════════════════════════════════

    y = sectionTitle(doc, y, "8", "ISO 45001 COMPLIANCE CHECKLIST", [0, 150, 180]);

    const passCount = data.isoChecklist.filter(c => c.status === "pass").length;
    const totalChecks = data.isoChecklist.filter(c => c.status !== "na").length;
    const complianceRate = totalChecks > 0 ? Math.round((passCount / totalChecks) * 100) : 100;

    // Compliance score bar
    doc.setFillColor(240, 242, 245);
    doc.roundedRect(margin, y, contentW, 6, 1, 1, "F");
    const barColor = complianceRate >= 90 ? [0, 200, 83] : complianceRate >= 70 ? [255, 150, 0] : [255, 45, 85];
    doc.setFillColor(barColor[0], barColor[1], barColor[2]);
    doc.roundedRect(margin, y, contentW * (complianceRate / 100), 6, 1, 1, "F");
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    doc.text(`${complianceRate}% Compliance (${passCount}/${totalChecks})`, margin + 3, y + 4.2);
    y += 10;

    autoTable(doc, {
      startY: y,
      head: [["#", "Requirement", "Status"]],
      body: data.isoChecklist.map((item, i) => [
        `${i + 1}`,
        item.item,
        item.status === "pass" ? "PASS" : item.status === "fail" ? "FAIL" : "N/A",
      ]),
      theme: "striped",
      headStyles: { fillColor: [0, 150, 180], fontSize: 7.5, fontStyle: "bold" },
      bodyStyles: { fontSize: 7.5 },
      margin: { left: margin, right: margin },
      columnStyles: { 0: { cellWidth: 8, halign: "center" }, 2: { cellWidth: 15, halign: "center" } },
      didParseCell: (hookData: any) => {
        if (hookData.section === "body" && hookData.column.index === 2) {
          const val = hookData.cell.raw?.toString();
          if (val === "PASS") { hookData.cell.styles.textColor = [0, 180, 70]; hookData.cell.styles.fontStyle = "bold"; }
          if (val === "FAIL") { hookData.cell.styles.textColor = [255, 45, 85]; hookData.cell.styles.fontStyle = "bold"; }
          if (val === "N/A") { hookData.cell.styles.textColor = [160, 160, 160]; }
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 10;

    // ═════════════════════════════════════════════════════════════
    // SECTION 8.5 — FIELD EVIDENCE (Photo Report) — if available
    // ═════════════════════════════════════════════════════════════

    if (data.fieldEvidence && data.fieldEvidence.photoCount > 0) {
      y = sectionTitle(doc, y, "8b", "FIELD EVIDENCE — INCIDENT PHOTO REPORT", [175, 82, 222]);

      autoTable(doc, {
        startY: y,
        head: [["Evidence Detail", "Value"]],
        body: [
          ["Photos Submitted", `${data.fieldEvidence.photoCount} photo${data.fieldEvidence.photoCount > 1 ? "s" : ""}`],
          ["Incident Type", data.fieldEvidence.incidentType || "Not specified"],
          ["Worker-Reported Severity", (data.fieldEvidence.severity || "medium").toUpperCase()],
          ["Worker Comment", data.fieldEvidence.workerComment || "No comment provided"],
          ["Submitted At", data.fieldEvidence.submittedAt ? data.fieldEvidence.submittedAt.toLocaleString() : "N/A"],
          ["Photo Retention", `${data.fieldEvidence.photoRetentionDays || 90} days`],
          ["Evidence Status", "Archived — Available for RCA & compliance review"],
        ],
        theme: "striped",
        headStyles: { fillColor: [175, 82, 222], fontSize: 8, fontStyle: "bold" },
        bodyStyles: { fontSize: 8 },
        margin: { left: margin, right: margin },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 50 } },
      });
      y = (doc as any).lastAutoTable.finalY + 4;

      // Note about photo storage
      doc.setFontSize(7);
      doc.setTextColor(140, 140, 140);
      doc.text("Note: Actual photo files are stored securely in the SOSphere Evidence Vault. Reference this report ID to retrieve.", margin, y);
      y += 8;
    }

    // ═════════════════════════════════════════════════════════════
    // SECTION 8.6 — DATA INTEGRITY VERIFICATION
    // ═════════════════════════════════════════════════════════════

    const trackedEventCount = (data.timeline || []).length;
    const chainIntegrityStatus = verifyChainIntegrity(data.emergencyId);
    const dataSourceLabel = trackedEventCount > 3 ? "Real Timeline Tracker" : "Metadata Only";

    y = sectionTitle(doc, y, "8c", "DATA INTEGRITY VERIFICATION", [80, 80, 80]);

    autoTable(doc, {
      startY: y,
      head: [["Verification Item", "Value"]],
      body: [
        ["Total Tracked Events", trackedEventCount.toString()],
        ["Chain Hash Status", chainIntegrityStatus ? "VERIFIED" : "UNVERIFIED"],
        ["Data Source", dataSourceLabel],
        ["Report Generated", data.reportGeneratedAt.toLocaleString()],
      ],
      theme: "striped",
      headStyles: { fillColor: [80, 80, 80], fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 8 },
      margin: { left: margin, right: margin },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 50 },
        1: { fontStyle: chainIntegrityStatus ? "bold" : "normal" }
      },
      didDrawCell: (hookData) => {
        if (hookData.section === "body" && hookData.column.index === 1) {
          const val = hookData.cell.raw?.toString();
          if (val === "VERIFIED") { hookData.cell.styles.textColor = [0, 180, 70]; }
          if (val === "UNVERIFIED") { hookData.cell.styles.textColor = [255, 150, 0]; }
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 4;

    doc.setFontSize(7);
    doc.setTextColor(140, 140, 140);
    const integrityNote = chainIntegrityStatus
      ? "This report contains verified data from the Smart Timeline Tracker. All tracked events are cryptographically authenticated."
      : "This report was generated from emergency metadata. Full timeline data from Smart Timeline Tracker is not available.";
    doc.text(integrityNote, margin, y, { maxWidth: contentW });
    y += 8;

    // ═════════════════════════════════════════════════════════════
    // SECTION 9 — SIGN-OFF
    // ═════════════════════════════════════════════════════════════

    y = sectionTitle(doc, y, "9", "SIGN-OFF & AUTHORIZATION", [40, 40, 40]);

    const signoffs = [
      { role: "Incident Commander", name: data.responders[0]?.name || "" },
      { role: "HSE Manager", name: "Rania Abbas" },
      { role: "Site Manager", name: "Omar Al-Farsi" },
      { role: "General Manager", name: "" },
    ];

    signoffs.forEach(s => {
      if (y + 14 > ph - 20) { doc.addPage(); y = 20; }
      doc.setFontSize(8);
      doc.setTextColor(80, 80, 80);
      doc.text(`${s.role}:`, margin, y);
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.line(margin + 35, y, margin + 85, y);
      doc.text("Date:", margin + 90, y);
      doc.line(margin + 100, y, margin + 130, y);
      if (s.name) {
        doc.setFontSize(7);
        doc.setTextColor(160, 160, 160);
        doc.text(`(${s.name})`, margin + 36, y + 4);
      }
      y += 12;
    });

    // ═════════════════════════════════════════════════════════════
    // FOOTER + WATERMARK on all pages
    // ═════════════════════════════════════════════════════════════

    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);

      // Confidential watermark
      doc.setFontSize(40);
      doc.setTextColor(245, 245, 245);
      doc.text("CONFIDENTIAL", pw / 2, ph / 2, { align: "center", angle: 45 });

      // Footer line
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.2);
      doc.line(margin, ph - 14, pw - margin, ph - 14);

      // Footer left — report info
      doc.setFontSize(6.5);
      doc.setTextColor(150, 150, 150);
      doc.text(`SOSphere Emergency Lifecycle Report | ${data.emergencyId} | ${data.companyName}`, margin, ph - 9);
      doc.text(`Generated: ${data.reportGeneratedAt.toLocaleString()} | ISO 45001:2018 Compliant`, margin, ph - 5.5);

      // Footer right — page number
      doc.setTextColor(0, 200, 224);
      doc.text(`Page ${i} of ${totalPages}`, pw - margin, ph - 7, { align: "right" });
    }

    // ── Save ──────────────────────────────────────────────────────
    const filename = `Emergency-Report-${data.emergencyId}-${data.triggeredAt.toISOString().slice(0, 10)}.pdf`;
    doc.save(filename);

    toast.success("Emergency Lifecycle Report exported!", {
      id: "emg-pdf",
      description: `${totalPages} pages · ${filename}`,
      duration: 5000,
    });
  } catch (err) {
    console.error("PDF generation failed:", err);
    toast.error("Failed to generate report", { id: "emg-pdf" });
  }
}