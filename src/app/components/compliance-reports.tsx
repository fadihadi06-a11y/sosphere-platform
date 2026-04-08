// ═══════════════════════════════════════════════════════════════
// SOSphere — Compliance PDF Reports (Enterprise-Grade)
// ─────────────────────────────────────────────────────────────
// Before generating: shows section picker with ALL scenarios
// Admin picks what they want → auto-generates professional PDF
// Includes: company logo, headers, tables, charts, timestamps
// ═══════════════════════════════════════════════════════════════

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import jsPDF from "jspdf";
import QRCode from "qrcode";
import { PdfPasswordModal, type PdfEncryptionConfig, getEncryptionOptions } from "./pdf-password-modal";
import { PdfEmailModal } from "./pdf-email-modal";
import { ZONE_NAMES } from "./shared-store";
import { getRealAuditLog } from "./audit-log-store";

// Dynamic import for autotable — avoids crash if module load fails
let autoTableLoaded = false;
const ensureAutoTable = async () => {
  if (!autoTableLoaded) {
    try { await import("jspdf-autotable"); autoTableLoaded = true; } catch { /* fallback */ }
  }
};
ensureAutoTable();

const addTable = (doc: jsPDF, opts: any) => {
  if (typeof (doc as any).autoTable === "function") {
    (doc as any).autoTable(opts);
  } else {
    let fy = opts.startY || 20;
    doc.setFontSize(8);
    if (opts.head?.[0]) {
      doc.setTextColor(80);
      doc.text(opts.head[0].join("  |  "), 20, fy);
      fy += 5;
    }
    if (opts.body) {
      doc.setTextColor(50);
      for (const row of opts.body) {
        if (fy > 270) { doc.addPage(); fy = 15; }
        doc.text(row.join("  |  "), 20, fy);
        fy += 4.5;
      }
    }
    (doc as any).lastAutoTable = { finalY: fy + 2 };
  }
};
const getTableY = (doc: jsPDF) => (doc as any).lastAutoTable?.finalY ?? 0;

// ═══════════════════════════════════════════════════════════════
// PDF CHART DRAWING UTILITIES — Professional bar/horizontal charts
// ═══════════════════════════════════════════════════════════════

interface BarChartData {
  label: string;
  value: number;
  color: [number, number, number];
}

function drawBarChart(
  doc: jsPDF,
  x: number,
  startY: number,
  width: number,
  height: number,
  data: BarChartData[],
  title: string,
  maxValue?: number
) {
  const max = maxValue || Math.max(...data.map(d => d.value)) * 1.15;
  const barAreaX = x + 28;
  const barAreaW = width - 38;
  const barAreaH = height - 28;
  const barCount = data.length;
  const barGap = 4;
  const barWidth = Math.min(20, (barAreaW - barGap * (barCount - 1)) / barCount);
  const totalBarsWidth = barCount * barWidth + (barCount - 1) * barGap;
  const offsetX = barAreaX + (barAreaW - totalBarsWidth) / 2;

  // Background
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(x, startY, width, height, 3, 3, "F");
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(x, startY, width, height, 3, 3, "S");

  // Title
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  doc.text(title, x + width / 2, startY + 8, { align: "center" });

  // Grid lines
  const gridCount = 5;
  const gridStartY = startY + 14;
  doc.setDrawColor(230, 230, 240);
  doc.setLineWidth(0.15);
  for (let i = 0; i <= gridCount; i++) {
    const gy = gridStartY + barAreaH - (barAreaH * i) / gridCount;
    doc.line(barAreaX - 2, gy, barAreaX + barAreaW, gy);
    doc.setFontSize(6);
    doc.setTextColor(150);
    const labelVal = Math.round((max * i) / gridCount);
    doc.text(String(labelVal), barAreaX - 4, gy + 1, { align: "right" });
  }

  // Bars
  data.forEach((item, i) => {
    const bx = offsetX + i * (barWidth + barGap);
    const barH = (item.value / max) * barAreaH;
    const by = gridStartY + barAreaH - barH;

    // Bar
    doc.setFillColor(item.color[0], item.color[1], item.color[2]);
    doc.roundedRect(bx, by, barWidth, barH, 1.5, 1.5, "F");

    // Highlight
    doc.setFillColor(
      Math.min(255, item.color[0] + 40),
      Math.min(255, item.color[1] + 40),
      Math.min(255, item.color[2] + 40)
    );
    doc.rect(bx + 1, by + 1, barWidth * 0.3, Math.max(0, barH - 2), "F");

    // Value on top
    doc.setFontSize(6.5);
    doc.setTextColor(item.color[0], item.color[1], item.color[2]);
    doc.text(String(item.value), bx + barWidth / 2, by - 2, { align: "center" });

    // Label below
    doc.setFontSize(5.5);
    doc.setTextColor(100);
    const labelLines = doc.splitTextToSize(item.label, barWidth + barGap);
    doc.text(labelLines[0], bx + barWidth / 2, gridStartY + barAreaH + 4, { align: "center" });
  });
}

function drawHorizontalBarChart(
  doc: jsPDF,
  x: number,
  startY: number,
  width: number,
  data: { label: string; value: number; max: number; color: [number, number, number]; suffix?: string }[],
  title: string
) {
  const rowH = 10;
  const totalH = 14 + data.length * rowH + 8;
  const barStartX = x + 55;
  const barMaxW = width - 80;

  // Background
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(x, startY, width, totalH, 3, 3, "F");
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(x, startY, width, totalH, 3, 3, "S");

  // Title
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  doc.text(title, x + width / 2, startY + 8, { align: "center" });

  data.forEach((item, i) => {
    const ry = startY + 14 + i * rowH;
    const barW = (item.value / item.max) * barMaxW;

    // Label
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text(item.label, barStartX - 3, ry + 5.5, { align: "right" });

    // Track background
    doc.setFillColor(226, 232, 240);
    doc.roundedRect(barStartX, ry + 2, barMaxW, 5, 2, 2, "F");

    // Bar fill
    doc.setFillColor(item.color[0], item.color[1], item.color[2]);
    doc.roundedRect(barStartX, ry + 2, Math.max(2, barW), 5, 2, 2, "F");

    // Value
    doc.setFontSize(6.5);
    doc.setTextColor(item.color[0], item.color[1], item.color[2]);
    doc.text(`${item.value}${item.suffix || ""}`, barStartX + barMaxW + 3, ry + 5.5);
  });

  return totalH;
}

function drawPieIndicator(
  doc: jsPDF,
  cx: number,
  cy: number,
  radius: number,
  percentage: number,
  color: [number, number, number],
  label: string,
  sublabel?: string
) {
  // Background circle
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(2.5);
  doc.circle(cx, cy, radius, "S");

  // Progress arc
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(2.5);
  const segments = Math.floor(percentage * 3.6);
  for (let i = 0; i < segments; i++) {
    const angle1 = ((i - 90) * Math.PI) / 180;
    const angle2 = ((i + 1 - 90) * Math.PI) / 180;
    const x1 = cx + radius * Math.cos(angle1);
    const y1 = cy + radius * Math.sin(angle1);
    const x2 = cx + radius * Math.cos(angle2);
    const y2 = cy + radius * Math.sin(angle2);
    doc.line(x1, y1, x2, y2);
  }

  // Center text
  doc.setFontSize(14);
  doc.setTextColor(color[0], color[1], color[2]);
  doc.text(`${percentage}%`, cx, cy + 1, { align: "center" });

  // Label
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  doc.text(label, cx, cy + radius + 6, { align: "center" });
  if (sublabel) {
    doc.setFontSize(6);
    doc.setTextColor(150);
    doc.text(sublabel, cx, cy + radius + 10, { align: "center" });
  }
}

// QR Code generator for PDF
async function generateQRDataURL(text: string): Promise<string> {
  try {
    return await QRCode.toDataURL(text, {
      width: 200,
      margin: 1,
      color: { dark: "#0A0F1E", light: "#FFFFFF" },
      errorCorrectionLevel: "H",
    });
  } catch {
    return "";
  }
}

import { FileText, Download, Calendar, Clock, CheckCircle, CheckCircle2, Shield, BarChart3, Users, AlertTriangle, Eye, RefreshCw, TrendingUp, Award, MapPin, X, Heart, Navigation, Activity, Route, Clipboard, Lock, Star, Mail } from "lucide-react";
import { toast } from "sonner";
import { hapticSuccess } from "./haptic-feedback";

// ═══════════════════════════════════════════════════════════════
// MOCK PDF TABLE DATA — extracted from generatePDF() for Supabase migration
// Each constant maps 1:1 to a SUPABASE_MIGRATION_POINT inside generatePDF().
// When migrating, replace these with fetched data and pass via the `data` param.
// ═══════════════════════════════════════════════════════════════

/* SUPABASE_MIGRATION_POINT: kpi_data — FROM analytics_summary */
const MOCK_KPI_DATA = {
  tableRows: [
    ["Overall Safety Score", "87%", ">= 85%", "[OK] ON TARGET"],
    ["Avg Response Time", "2m 34s", "< 3 min", "[OK] ON TARGET"],
    ["Check-in Compliance", "94%", ">= 90%", "[OK] ON TARGET"],
    ["Pre-Shift Checklist", "78%", ">= 85%", "[!] BELOW TARGET"],
    ["Active Incidents (MTD)", "3", "< 5", "[OK] ON TARGET"],
    ["Days Without Incident", "12", ">= 30", "[!] NEEDS IMPROVEMENT"],
    ["Buddy System Coverage", "80%", "100%", "[!] BELOW TARGET"],
    ["Evacuation Drill Score", "92%", ">= 90%", "[OK] ON TARGET"],
  ],
  chartBars: [
    { label: "Safety", value: 87, color: [0, 200, 83] as [number, number, number] },
    { label: "Response", value: 92, color: [0, 200, 224] as [number, number, number] },
    { label: "Check-in", value: 94, color: [52, 199, 89] as [number, number, number] },
    { label: "Checklist", value: 78, color: [255, 150, 0] as [number, number, number] },
    { label: "Buddy", value: 80, color: [255, 214, 10] as [number, number, number] },
    { label: "Evacuation", value: 92, color: [139, 92, 246] as [number, number, number] },
  ],
};

/* SUPABASE_MIGRATION_POINT: incident_table — FROM incidents JOIN zones */
const MOCK_INCIDENT_TABLE = [
  ["EMG-001", "Mar 3", "SOS Button", "Ahmed Khalil", "Zone A", "Critical", "Resolved", "1m 45s"],
  ["EMG-002", "Mar 5", "Fall Detected", "Mohammed Ali", "Zone D", "High", "Resolved", "2m 10s"],
  ["EMG-003", "Mar 8", "Missed Check-in", "Khalid Omar", "Zone A", "Medium", "False Alarm", "4m 30s"],
  ["EMG-004", "Mar 9", "Journey SOS", "Omar Al-Farsi", "On Route", "Critical", "Resolved", "3m 45s"],
  ["EMG-005", "Mar 11", "Shake SOS", "Sara Al-Mutairi", "Zone C", "High", "Active", "--"],
];

/* SUPABASE_MIGRATION_POINT: corrective_actions — FROM capa_actions */
const MOCK_CORRECTIVE_ACTIONS = [
  ["EMG-001", "Zone A risk level raised to High", "Zone Admin", "Mar 3", "Complete"],
  ["EMG-001", "Safety briefing scheduled for Zone A team", "Main Admin", "Mar 4", "Complete"],
  ["EMG-002", "Fall protection equipment ordered for Zone D", "HSE Manager", "Mar 6", "In Progress"],
  ["EMG-002", "Pre-shift checklist updated with fall harness check", "Main Admin", "Mar 6", "Complete"],
  ["EMG-004", "Journey check-in frequency increased to every 30min", "Main Admin", "Mar 10", "Complete"],
];

/* SUPABASE_MIGRATION_POINT: zone_risk — FROM risk_register */
const MOCK_ZONE_RISK = {
  tableRows: [
    [ZONE_NAMES.A, "High", "8", "2", "Mar 3", "2", "Ahmed (Lead)"],
    [ZONE_NAMES.B, "Medium", "5", "0", "Feb 15", "1", "Omar (Lead)"],
    [ZONE_NAMES.C, "Low", "4", "1", "Mar 11", "2", "Sara (Lead)"],
    [ZONE_NAMES.D, "Critical", "3", "1", "Mar 5", "1", "Mohammed (Lead)"],
    [ZONE_NAMES.E, "Medium", "4", "0", "Jan 22", "1", "Not Assigned"],
  ],
  incidentChart: [
    { label: "Zone A", value: 2, color: [255, 150, 0] as [number, number, number] },
    { label: "Zone B", value: 0, color: [0, 200, 83] as [number, number, number] },
    { label: "Zone C", value: 1, color: [0, 200, 224] as [number, number, number] },
    { label: "Zone D", value: 1, color: [255, 45, 85] as [number, number, number] },
    { label: "Zone E", value: 0, color: [139, 92, 246] as [number, number, number] },
  ],
  workersChart: [
    { label: "Zone A", value: 8, color: [0, 200, 224] as [number, number, number] },
    { label: "Zone B", value: 5, color: [0, 200, 83] as [number, number, number] },
    { label: "Zone C", value: 4, color: [52, 199, 89] as [number, number, number] },
    { label: "Zone D", value: 3, color: [255, 150, 0] as [number, number, number] },
    { label: "Zone E", value: 4, color: [139, 92, 246] as [number, number, number] },
  ],
};

/* SUPABASE_MIGRATION_POINT: employee_roster — FROM employees */
const MOCK_EMPLOYEE_ROSTER = [
  ["Sara Al-Mutairi", "HSE Coordinator", "Zone C", "98%", "100%", "Lina Chen", "[OK] Complete"],
  ["Omar Al-Farsi", "Site Manager", "Zone A", "95%", "100%", "Ahmed Khalil", "[OK] Complete"],
  ["Ahmed Khalil", "Field Engineer", "Zone A", "92%", "96%", "Omar Al-Farsi", "[OK] Complete"],
  ["Lina Chen", "Lab Technician", "Zone C", "89%", "98%", "Sara Al-Mutairi", "[OK] Complete"],
  ["Aisha Rahman", "Fire Marshal", "Zone D", "87%", "95%", "Mohammed Ali", "[OK] Complete"],
  ["Mohammed Ali", "Technician", "Zone D", "82%", "90%", "Aisha Rahman", "[!] Incomplete"],
  ["Khalid Omar", "Operator", "Zone A", "78%", "85%", "Ali Mansour", "[OK] Complete"],
  ["Ali Mansour", "Welder", "Zone A", "75%", "82%", "Khalid Omar", "[!] Incomplete"],
];

/* SUPABASE_MIGRATION_POINT: checkin_compliance — FROM checkin_logs */
const MOCK_CHECKIN_COMPLIANCE = {
  tableRows: [
    ["Sara Al-Mutairi", "22", "22", "0", "0", "100%"],
    ["Omar Al-Farsi", "22", "22", "0", "0", "100%"],
    ["Lina Chen", "22", "21", "1", "0", "98%"],
    ["Ahmed Khalil", "22", "20", "1", "1", "96%"],
    ["Aisha Rahman", "22", "20", "1", "1", "95%"],
    ["Mohammed Ali", "22", "18", "2", "2", "90%"],
    ["Khalid Omar", "22", "17", "3", "2", "85%"],
    ["Ali Mansour", "22", "16", "4", "2", "82%"],
  ],
  chartBars: [
    { label: "Sara Al-Mutairi", value: 100, max: 100, color: [0, 200, 83] as [number, number, number], suffix: "%" },
    { label: "Omar Al-Farsi", value: 100, max: 100, color: [0, 200, 83] as [number, number, number], suffix: "%" },
    { label: "Lina Chen", value: 98, max: 100, color: [0, 200, 224] as [number, number, number], suffix: "%" },
    { label: "Ahmed Khalil", value: 96, max: 100, color: [0, 200, 224] as [number, number, number], suffix: "%" },
    { label: "Aisha Rahman", value: 95, max: 100, color: [52, 199, 89] as [number, number, number], suffix: "%" },
    { label: "Mohammed Ali", value: 90, max: 100, color: [255, 214, 10] as [number, number, number], suffix: "%" },
    { label: "Khalid Omar", value: 85, max: 100, color: [255, 150, 0] as [number, number, number], suffix: "%" },
    { label: "Ali Mansour", value: 82, max: 100, color: [255, 150, 0] as [number, number, number], suffix: "%" },
  ],
};

/* SUPABASE_MIGRATION_POINT: journey_log — FROM journey_management */
const MOCK_JOURNEY_LOG = [
  ["JRN-001", "Ahmed Khalil", "HQ Gate A", "Remote Station Delta", "Pickup", "Active", "42/78 km", "0"],
  ["JRN-002", "Omar Al-Farsi", "Zone C Lab", "Warehouse 7", "Van", "Delayed", "15/22 km", "0"],
  ["JRN-003", "Sara Al-Mutairi", "HQ", "Logistics Hub", "Company Car", "Completed", "35/35 km", "0"],
  ["JRN-004", "Mohammed Ali", "Zone D Gate", "Repair Site", "Service Truck", "Deviated", "8/45 km", "1"],
];

/* SUPABASE_MIGRATION_POINT: playbook_data — FROM emergency_playbooks */
const MOCK_PLAYBOOK_DATA = [
  ["SOS Button Response", "SOS Button", "8", "Yes", "12", "1m 45s"],
  ["Fall Detection Response", "Fall Detected", "6", "Yes", "3", "2m 10s"],
  ["Fire / Gas Leak Protocol", "Environmental", "7", "No", "1", "--"],
  ["Security Threat Response", "Security Threat", "6", "No", "0", "--"],
  ["Missed Check-in Escalation", "Missed Check-in", "5", "Yes", "28", "4m 30s"],
];

// ── PDF Report Data interface (for Supabase migration) ────────
interface PdfReportData {
  kpi?: typeof MOCK_KPI_DATA;
  incidents?: typeof MOCK_INCIDENT_TABLE;
  correctiveActions?: typeof MOCK_CORRECTIVE_ACTIONS;
  zoneRisk?: typeof MOCK_ZONE_RISK;
  employeeRoster?: typeof MOCK_EMPLOYEE_ROSTER;
  checkinCompliance?: typeof MOCK_CHECKIN_COMPLIANCE;
  journeyLog?: typeof MOCK_JOURNEY_LOG;
  playbookData?: typeof MOCK_PLAYBOOK_DATA;
}

// ── Auto-Schedule config ──────────────────────────────────────
/* SUPABASE_MIGRATION_POINT: auto_schedules — FROM report_schedules WHERE company_id = :id */
const DEFAULT_SCHEDULES = [
  { id: "sched-1", name: "Weekly Safety Report", frequency: "Every Monday 8:00 AM", active: true, reportTypes: ["safety_kpi", "checkin_compliance"] },
  { id: "sched-2", name: "Monthly Compliance Report", frequency: "1st of every month", active: true, reportTypes: ["full_compliance"] },
  { id: "sched-3", name: "Quarterly Insurance Report", frequency: "Every 3 months", active: false, reportTypes: ["insurance_claim", "incident_summary"] },
];

// ═══════════════════════════════════════════════════════════════
// PDF Section Definitions — every possible section the admin can pick
// ═══════════════════════════════════════════════════════════════

interface ReportSection {
  id: string;
  label: string;
  description: string;
  category: string;
  icon: any;
  color: string;
  defaultChecked: boolean;
}

const ALL_SECTIONS: ReportSection[] = [
  // ── Company Info ────────────────────────────────────────────
  { id: "company_header",    label: "Company Profile & Logo",        description: "Company name, address, registration, and logo",     category: "Company", icon: Shield,       color: "#00C8E0", defaultChecked: true },
  { id: "report_meta",       label: "Report Metadata",               description: "Report date, period, generated by, document ID",   category: "Company", icon: FileText,     color: "#00C8E0", defaultChecked: true },

  // ── Safety Overview ─────────────────────────────────────────
  { id: "kpi_dashboard",     label: "KPI Safety Dashboard",          description: "Key safety metrics: score, response time, compliance rate", category: "Safety Metrics", icon: BarChart3, color: "#00C853", defaultChecked: true },
  { id: "safety_score",      label: "Company Safety Score",          description: "Overall company safety score with trend analysis",  category: "Safety Metrics", icon: Award,    color: "#FFD60A", defaultChecked: true },
  { id: "response_times",    label: "Emergency Response Times",      description: "Average, fastest, slowest response times by type",  category: "Safety Metrics", icon: Clock,    color: "#FF9500", defaultChecked: true },

  // ── Incidents ───────────────────────────────────────────────
  { id: "incident_summary",  label: "Incident Summary",              description: "All incidents with type, severity, resolution status", category: "Incidents", icon: AlertTriangle, color: "#FF2D55", defaultChecked: true },
  { id: "incident_timeline", label: "Incident Timeline",             description: "Chronological timeline of each incident",          category: "Incidents", icon: Activity,    color: "#FF9500", defaultChecked: false },
  { id: "incident_photos",   label: "Incident Photo Evidence",       description: "Photos submitted during emergencies",              category: "Incidents", icon: Eye,         color: "#00C8E0", defaultChecked: false },
  { id: "incident_audio",    label: "Audio Recording Log",           description: "List of 60-sec audio recordings as evidence",      category: "Incidents", icon: Activity,    color: "#FF9500", defaultChecked: false },
  { id: "root_cause",        label: "Root Cause Analysis",           description: "Why each incident happened + contributing factors", category: "Incidents", icon: Eye,         color: "#FF2D55", defaultChecked: false },
  { id: "corrective_actions",label: "Corrective Actions Taken",      description: "What was done to resolve each incident",           category: "Incidents", icon: CheckCircle, color: "#00C853", defaultChecked: true },

  // ── Zones & Location ────────────────────────────────────────
  { id: "zone_risk_matrix",  label: "Zone Risk Assessment Matrix",   description: "All zones with risk levels and incident counts",    category: "Zones & Location", icon: MapPin,    color: "#FF9500", defaultChecked: true },
  { id: "evacuation_report", label: "Evacuation Readiness Report",   description: "Evacuation points, routes, drill results",         category: "Zones & Location", icon: Navigation,color: "#FF2D55", defaultChecked: false },
  { id: "geofence_log",      label: "Geofence Breach Log",           description: "All geofence violations with timestamps",          category: "Zones & Location", icon: MapPin,    color: "#FF9500", defaultChecked: false },

  // ── Employees ───────────────────────────────────────────────
  { id: "employee_list",     label: "Employee Safety Roster",        description: "All employees with roles, zones, and safety scores", category: "Employees", icon: Users,     color: "#00C8E0", defaultChecked: true },
  { id: "checkin_compliance",label: "Check-in Compliance Report",    description: "Who checked in on time vs missed check-ins",       category: "Employees", icon: Clock,     color: "#FF9500", defaultChecked: true },
  { id: "checklist_compliance",label: "Pre-Shift Checklist Report", description: "Checklist completion rates per worker",             category: "Employees", icon: Clipboard, color: "#00C853", defaultChecked: false },
  { id: "medical_id_status", label: "Medical ID Completion Status",  description: "Which employees have complete medical profiles",   category: "Employees", icon: Heart,     color: "#FF2D55", defaultChecked: false },
  { id: "buddy_pairs",       label: "Buddy System Pairs",            description: "All buddy pairs and their activity status",        category: "Employees", icon: Users,     color: "#00C8E0", defaultChecked: false },
  { id: "safety_leaderboard",label: "Safety Score Leaderboard",      description: "Top performers with badges and streaks",           category: "Employees", icon: Award,     color: "#FFD60A", defaultChecked: false },

  // ── Journey ─────────────────────────────────────────────────
  { id: "journey_log",       label: "Journey Management Log",        description: "All journeys with routes, deviations, and delays", category: "Journeys", icon: Route,      color: "#00C8E0", defaultChecked: false },
  { id: "journey_incidents", label: "On-Route Incident Report",      description: "Incidents that happened during journeys",          category: "Journeys", icon: AlertTriangle, color: "#FF2D55", defaultChecked: false },

  // ── Weather & Environment ───────────────────────────────────
  { id: "weather_log",       label: "Weather Alert History",         description: "All weather warnings and actions taken",           category: "Environment", icon: Activity,  color: "#FF9500", defaultChecked: false },

  // ── Compliance & Legal ──────────────────────────────────────
  { id: "emergency_procedures", label: "Emergency Procedures",       description: "Documented emergency response protocols",          category: "Compliance", icon: Shield,    color: "#00C853", defaultChecked: false },
  { id: "playbook_summary",  label: "Response Playbook Summary",     description: "All playbooks with trigger types and step counts", category: "Compliance", icon: FileText,  color: "#8B5CF6", defaultChecked: false },
  { id: "audit_log",         label: "System Audit Log",              description: "All system actions with timestamps and users",     category: "Compliance", icon: Lock,      color: "#8B5CF6", defaultChecked: false },
  { id: "escalation_log",    label: "Escalation History",            description: "Auto and manual escalations with resolution",     category: "Compliance", icon: TrendingUp,color: "#FF9500", defaultChecked: false },

  // ── Footer ──────────────────────────────────────────────────
  { id: "recommendations",   label: "Recommendations & Action Items",description: "Suggested improvements based on data analysis",    category: "Summary", icon: Star,       color: "#FFD60A", defaultChecked: true },
  { id: "legal_disclaimer",  label: "Legal Disclaimer & Signatures", description: "Compliance statement, prepared by, approved by",  category: "Summary", icon: Shield,     color: "#00C8E0", defaultChecked: true },
];

// Group sections by category
const CATEGORIES = Array.from(new Set(ALL_SECTIONS.map(s => s.category)));

const CATEGORY_COLORS: Record<string, string> = {
  "Company": "#00C8E0",
  "Safety Metrics": "#00C853",
  "Incidents": "#FF2D55",
  "Zones & Location": "#FF9500",
  "Employees": "#00C8E0",
  "Journeys": "#8B5CF6",
  "Environment": "#FF9500",
  "Compliance": "#8B5CF6",
  "Summary": "#FFD60A",
};

// ── Real data builder for PDF sections ──────────────────────
function buildRealPdfData() {
  try {
    const auditLogs = (() => { try { return getRealAuditLog(); } catch { return []; } })();
    const empProfile = (() => { try { return JSON.parse(localStorage.getItem("sosphere_admin_profile") || "{}"); } catch { return {}; } })();
    const compProfile = (() => { try { return JSON.parse(localStorage.getItem("sosphere_company_profile") || "{}"); } catch { return {}; } })();
    const risks = (() => { try { return JSON.parse(localStorage.getItem("sosphere_risks") || "[]"); } catch { return []; } })();

    // Real KPI from audit log
    const total = auditLogs.filter((e: any) => e.action?.includes("emergency")).length;
    const resolved = auditLogs.filter((e: any) => e.action?.includes("resolved")).length;
    const rate = total > 0 ? Math.round((resolved / total) * 100) : 100;

    if (total === 0) return null; // No real data yet

    return {
      kpi: {
        totalIncidents: total,
        resolved,
        avgResponseTime: "N/A (from Timeline Tracker)",
        safetyScore: Math.min(100, 50 + rate / 2),
        complianceRate: rate,
        nearMisses: auditLogs.filter((e: any) => e.action?.includes("hazard")).length,
      },
      riskCount: risks.length,
      companyInfo: { name: compProfile.name || "", admin: empProfile.name || "" },
    };
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════
// PDF GENERATOR ENGINE
// ═══════════════════════════════════════════════════════════════

// SUPABASE_MIGRATION_POINT: generatePDF — ALL table data below is hardcoded inline.
// When migrating, this function must accept a `data: ComplianceReportData` param
// containing: kpiData, incidentTable, correctiveActions, zoneRisks, employeeRoster,
// checkinCompliance, journeyLog, playbookData — all fetched from Supabase.
async function generatePDF(selectedSections: string[], companyName: string, preparedFor?: string, reportFormat?: ReportFormat, recipients?: ExportRecipient[], encryptionConfig?: PdfEncryptionConfig | null, data?: PdfReportData) {
  console.log("[SUPABASE_READY] pdf_generated: " + JSON.stringify({sections: selectedSections, timestamp: new Date().toISOString()}));
  await ensureAutoTable();

  // ── Resolve data: use provided (Supabase) or fall back to mock ──
  const kpi = data?.kpi ?? MOCK_KPI_DATA;
  const incidents = data?.incidents ?? MOCK_INCIDENT_TABLE;
  const correctiveActions = data?.correctiveActions ?? MOCK_CORRECTIVE_ACTIONS;
  const zoneRisk = data?.zoneRisk ?? MOCK_ZONE_RISK;
  const employeeRoster = data?.employeeRoster ?? MOCK_EMPLOYEE_ROSTER;
  const checkinCompliance = data?.checkinCompliance ?? MOCK_CHECKIN_COMPLIANCE;
  const journeyLog = data?.journeyLog ?? MOCK_JOURNEY_LOG;
  const playbookData = data?.playbookData ?? MOCK_PLAYBOOK_DATA;

  // Build jsPDF options — apply encryption if configured, with fallback
  const baseOpts: any = { orientation: "p", unit: "mm", format: "a4" };
  let doc: jsPDF;
  let wasEncrypted = false;
  if (encryptionConfig) {
    try {
      doc = new jsPDF({ ...baseOpts, ...getEncryptionOptions(encryptionConfig) });
      wasEncrypted = true;
    } catch (encErr) {
      console.warn("[SOSphere] Encryption failed, generating unprotected PDF:", encErr);
      doc = new jsPDF(baseOpts);
    }
  } else {
    doc = new jsPDF(baseOpts);
  }
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = 15;

  // Generate unique verification ID and QR code
  const verificationId = `RPT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const verificationURL = `https://sosphere.co/verify/${verificationId}`;

  // ── REAL SHA-256: Hash the document identity for legal integrity ──
  // eslint-disable-next-line no-useless-assignment -- used on line 1095
  let realDocHash = "";
  try {
    const hashData = `${verificationId}|${companyName}|${Date.now()}|${selectedSections.join(",")}`;
    const msgBuffer = new TextEncoder().encode(hashData);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    realDocHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // Fallback: deterministic pseudo-hash from verificationId
    realDocHash = verificationId.split("").reduce((acc, c) => {
      const hash = ((acc << 5) - acc) + c.charCodeAt(0);
      return hash & hash;
    }, 0).toString(16).padStart(8, "0").repeat(8).slice(0, 64);
  }
  const qrDataURL = await generateQRDataURL(verificationURL);

  const addNewPage = () => {
    doc.addPage();
    y = 15;
    // Page footer
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(`SOSphere Safety Report -- ${companyName}`, 15, pageHeight - 8);
    doc.text(`Page ${doc.getNumberOfPages()}`, pageWidth - 25, pageHeight - 8);
  };

  const checkPageBreak = (needed: number) => {
    if (y + needed > pageHeight - 20) addNewPage();
  };

  const drawSectionHeader = (title: string, color: [number, number, number]) => {
    checkPageBreak(20);
    doc.setFillColor(color[0], color[1], color[2]);
    doc.rect(15, y, pageWidth - 30, 8, "F");
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text(title.toUpperCase(), 20, y + 5.5);
    y += 12;
    doc.setTextColor(50, 50, 50);
  };

  const drawKeyValue = (key: string, value: string) => {
    checkPageBreak(7);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(key, 20, y);
    doc.setTextColor(40);
    doc.text(value, 80, y);
    y += 5;
  };

  // ═══════════════════════════════════════════════════════════
  // COVER PAGE
  // ═══════════════════════════════════════════════════════════
  // Background
  doc.setFillColor(5, 7, 14);
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  // Logo placeholder
  doc.setFillColor(0, 200, 224);
  doc.roundedRect(pageWidth / 2 - 20, 40, 40, 40, 5, 5, "F");
  doc.setFontSize(22);
  doc.setTextColor(255);
  doc.text("S", pageWidth / 2 - 6, 66);

  // Company name
  doc.setFontSize(28);
  doc.setTextColor(255);
  doc.text(companyName, pageWidth / 2, 100, { align: "center" });

  // Report title
  doc.setFontSize(16);
  doc.setTextColor(0, 200, 224);
  doc.text("SAFETY COMPLIANCE REPORT", pageWidth / 2, 115, { align: "center" });

  // Date info
  doc.setFontSize(10);
  doc.setTextColor(180);
  const today = new Date();
  doc.text(`Generated: ${today.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, pageWidth / 2, 130, { align: "center" });
  doc.text(`Report Period: March 1-11, 2026`, pageWidth / 2, 137, { align: "center" });
  doc.text(`Document ID: ${verificationId}`, pageWidth / 2, 144, { align: "center" });

  // Format badge
  if (reportFormat) {
    doc.setFontSize(9);
    doc.setTextColor(150);
    const formatLabel = reportFormat === "executive" ? "EXECUTIVE SUMMARY" : reportFormat === "legal" ? "LEGAL / COMPLIANCE FORMAT" : "DETAILED REPORT";
    doc.text(formatLabel, pageWidth / 2, 155, { align: "center" });
  }

  // Prepared For
  if (preparedFor) {
    doc.setFontSize(11);
    doc.setTextColor(200);
    doc.text(`Prepared For: ${preparedFor}`, pageWidth / 2, 168, { align: "center" });
  }

  // Recipients
  if (recipients && recipients.length > 0) {
    doc.setFontSize(8);
    doc.setTextColor(120);
    const recipientLabels = recipients.map(r => {
      const found = EXPORT_RECIPIENTS.find(er => er.id === r);
      return found?.label || r;
    });
    doc.text(`Distribution: ${recipientLabels.join(" · ")}`, pageWidth / 2, preparedFor ? 178 : 168, { align: "center" });
  }

  // ── QR Code on Cover Page ──────────────────────────────────
  if (qrDataURL) {
    const qrSize = 28;
    const qrX = pageWidth / 2 - qrSize / 2;
    const qrY = pageHeight - 72;

    // QR Background frame
    doc.setFillColor(15, 20, 35);
    doc.roundedRect(qrX - 4, qrY - 8, qrSize + 8, qrSize + 20, 3, 3, "F");
    doc.setDrawColor(0, 200, 224);
    doc.setLineWidth(0.3);
    doc.roundedRect(qrX - 4, qrY - 8, qrSize + 8, qrSize + 20, 3, 3, "S");

    // QR code image
    doc.addImage(qrDataURL, "PNG", qrX, qrY, qrSize, qrSize);

    // QR Label
    doc.setFontSize(5.5);
    doc.setTextColor(0, 200, 224);
    doc.text("DIGITAL VERIFICATION", pageWidth / 2, qrY - 3, { align: "center" });

    doc.setFontSize(4.5);
    doc.setTextColor(120);
    doc.text("Scan to verify authenticity", pageWidth / 2, qrY + qrSize + 4, { align: "center" });
    doc.setFontSize(3.5);
    doc.text(verificationId, pageWidth / 2, qrY + qrSize + 8, { align: "center" });
  }

  // Powered by
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text("Powered by SOSphere -- Proactive Safety Intelligence Platform", pageWidth / 2, pageHeight - 12, { align: "center" });
  doc.text("CONFIDENTIAL -- For authorized personnel only", pageWidth / 2, pageHeight - 7, { align: "center" });

  // ═══════════════════════════════════════════════════════════
  // TABLE OF CONTENTS
  // ═══════════════════════════════════════════════════════════
  addNewPage();
  doc.setFontSize(18);
  doc.setTextColor(30);
  doc.text("Table of Contents", 15, y);
  y += 12;

  let sectionNum = 1;
  selectedSections.forEach(sId => {
    const section = ALL_SECTIONS.find(s => s.id === sId);
    if (!section) return;
    doc.setFontSize(10);
    doc.setTextColor(60);
    doc.text(`${sectionNum}. ${section.label}`, 20, y);
    doc.setTextColor(150);
    doc.text(section.description, 25, y + 4, { maxWidth: 150 });
    y += 10;
    sectionNum++;
  });

  // ═══════════════════════════════════════════════════════════
  // CONTENT PAGES
  // ═══════════════════════════════════════════════════════════
  addNewPage();

  // ── Company Header ──────────────────────────────────────────
  if (selectedSections.includes("company_header")) {
    drawSectionHeader("Company Profile", [0, 150, 180]);
    drawKeyValue("Company Name:", companyName);
    drawKeyValue("Industry:", "Oil & Gas / Construction");
    drawKeyValue("Headquarters:", "Riyadh, Saudi Arabia");
    drawKeyValue("Registration:", "CR-2024-SOSphere-001");
    drawKeyValue("Safety Officer:", "Admin -- Main Admin");
    drawKeyValue("Total Employees:", "24");
    drawKeyValue("Active Zones:", "5 (Zone A, B, C, D, E)");
    drawKeyValue("Subscription:", "Shield Plan (Active)");
    y += 5;
  }

  // ── Report Meta ─────────────────────────────────────────────
  if (selectedSections.includes("report_meta")) {
    drawSectionHeader("Report Information", [0, 150, 180]);
    drawKeyValue("Report Type:", "Safety Compliance Report");
    drawKeyValue("Period:", "March 1-11, 2026");
    drawKeyValue("Generated:", today.toLocaleString());
    drawKeyValue("Generated By:", "System -- Auto-generated");
    drawKeyValue("Classification:", "CONFIDENTIAL");
    y += 5;
  }

  // ── KPI Dashboard ──────────────────────────────────────────
  if (selectedSections.includes("kpi_dashboard")) {
    drawSectionHeader("Key Performance Indicators", [0, 200, 83]);
    // SUPABASE_MIGRATION_POINT: kpi_data — FROM analytics_summary
    addTable(doc, {
      startY: y,
      head: [["Metric", "Current", "Target", "Status"]],
      body: kpi.tableRows,
      theme: "striped",
      headStyles: { fillColor: [0, 200, 83], textColor: 255, fontSize: 9, fontStyle: "bold" },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [245, 252, 248] },
      margin: { left: 15, right: 15 },
      columnStyles: { 3: { cellWidth: 40 } },
      didParseCell: (data: any) => {
        if (data.section === "body" && data.column.index === 3) {
          const v = data.cell.raw;
          if (v?.includes("[OK]")) data.cell.styles.textColor = [52, 199, 89];
          else if (v?.includes("[!]")) data.cell.styles.textColor = [255, 150, 0];
        }
      },
    });
    y = getTableY(doc) + 8;

    // ── KPI Visual Bar Chart ──────────────────────────────────
    checkPageBreak(75);
    drawBarChart(doc, 15, y, pageWidth - 30, 65, kpi.chartBars, "KPI Performance Overview (%)", 100);
    y += 72;
  }

  // ── Safety Score ────────────────────────────────────────────
  if (selectedSections.includes("safety_score")) {
    checkPageBreak(90);
    drawSectionHeader("Company Safety Score", [255, 214, 10]);

    // Score indicators row
    const indicatorY = y + 2;
    drawPieIndicator(doc, 45, indicatorY + 14, 11, 87, [0, 200, 83], "Overall", "Score");
    drawPieIndicator(doc, 105, indicatorY + 14, 11, 94, [0, 200, 224], "Check-in", "Rate");
    drawPieIndicator(doc, 165, indicatorY + 14, 11, 78, [255, 150, 0], "Checklist", "Rate");
    y = indicatorY + 34;

    // Monthly trend bar chart
    checkPageBreak(70);
    drawBarChart(doc, 15, y, pageWidth - 30, 60, [
      { label: "Sep", value: 72, color: [255, 150, 0] },
      { label: "Oct", value: 75, color: [255, 180, 50] },
      { label: "Nov", value: 79, color: [255, 214, 10] },
      { label: "Dec", value: 81, color: [200, 210, 50] },
      { label: "Jan", value: 83, color: [100, 200, 70] },
      { label: "Feb", value: 85, color: [52, 199, 89] },
      { label: "Mar", value: 87, color: [0, 200, 83] },
    ], "Safety Score Trend (6-Month)", 100);
    y += 66;

    drawKeyValue("Trend:", "Improving -- up from 83% last month");
    drawKeyValue("Top Zone:", "Zone C -- 95% safety score");
    drawKeyValue("Lowest Zone:", "Zone D -- 72% (High-Risk)");
    y += 5;
  }

  // ── Response Times ──────────────────────────────────────────
  if (selectedSections.includes("response_times")) {
    drawSectionHeader("Emergency Response Times", [255, 150, 0]);
    addTable(doc, {
      startY: y,
      head: [["Emergency Type", "Count", "Avg Response", "Fastest", "Slowest"]],
      body: [
        ["SOS Button", "5", "1m 45s", "0m 32s", "4m 12s"],
        ["Fall Detection", "2", "2m 10s", "1m 05s", "3m 15s"],
        ["Shake SOS", "1", "1m 22s", "1m 22s", "1m 22s"],
        ["Missed Check-in", "8", "4m 30s", "2m 00s", "8m 15s"],
        ["Journey SOS", "1", "3m 45s", "3m 45s", "3m 45s"],
      ],
      theme: "grid",
      headStyles: { fillColor: [255, 150, 0], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      margin: { left: 15, right: 15 },
    });
    y = getTableY(doc) + 8;

    // Response Times Horizontal Bar Chart
    checkPageBreak(65);
    const rtH = drawHorizontalBarChart(doc, 15, y, pageWidth - 30, [
      { label: "SOS Button", value: 105, max: 500, color: [0, 200, 83], suffix: "s" },
      { label: "Fall Detection", value: 130, max: 500, color: [0, 200, 224], suffix: "s" },
      { label: "Shake SOS", value: 82, max: 500, color: [52, 199, 89], suffix: "s" },
      { label: "Missed Check-in", value: 270, max: 500, color: [255, 150, 0], suffix: "s" },
      { label: "Journey SOS", value: 225, max: 500, color: [255, 45, 85], suffix: "s" },
    ], "Average Response Time by Type (seconds)");
    y += rtH + 8;
  }

  // ── Incident Summary ────────────────────────────────────────
  if (selectedSections.includes("incident_summary")) {
    checkPageBreak(30);
    drawSectionHeader("Incident Summary", [255, 45, 85]);
    // SUPABASE_MIGRATION_POINT: incident_table — FROM incidents JOIN zones
    addTable(doc, {
      startY: y,
      head: [["ID", "Date", "Type", "Employee", "Zone", "Severity", "Status", "Response Time"]],
      body: incidents,
      theme: "striped",
      headStyles: { fillColor: [255, 45, 85], textColor: 255, fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 7 },
      alternateRowStyles: { fillColor: [255, 248, 250] },
      margin: { left: 15, right: 15 },
      columnStyles: { 0: { cellWidth: 15 }, 5: { cellWidth: 16 } },
      didParseCell: (data: any) => {
        if (data.section === "body") {
          if (data.column.index === 5) {
            const v = data.cell.raw;
            if (v === "Critical") { data.cell.styles.textColor = [255, 45, 85]; data.cell.styles.fontStyle = "bold"; }
            else if (v === "High") data.cell.styles.textColor = [255, 150, 0];
          }
          if (data.column.index === 6) {
            const v = data.cell.raw;
            if (v === "Active") { data.cell.styles.textColor = [255, 45, 85]; data.cell.styles.fontStyle = "bold"; }
            else if (v === "Resolved") data.cell.styles.textColor = [52, 199, 89];
          }
        }
      },
    });
    y = getTableY(doc) + 8;
  }

  // ── Corrective Actions ──────────────────────────────────────
  if (selectedSections.includes("corrective_actions")) {
    checkPageBreak(30);
    drawSectionHeader("Corrective Actions Taken", [0, 200, 83]);
    // SUPABASE_MIGRATION_POINT: corrective_actions — FROM capa_actions
    addTable(doc, {
      startY: y,
      head: [["Incident", "Action Taken", "Responsible", "Date", "Status"]],
      body: correctiveActions,
      theme: "grid",
      headStyles: { fillColor: [0, 200, 83], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 7 },
      margin: { left: 15, right: 15 },
    });
    y = getTableY(doc) + 8;
  }

  // ── Zone Risk Matrix ────────────────────────────────────────
  if (selectedSections.includes("zone_risk_matrix")) {
    checkPageBreak(30);
    drawSectionHeader("Zone Risk Assessment", [255, 150, 0]);
    // SUPABASE_MIGRATION_POINT: zone_risk — FROM risk_register
    addTable(doc, {
      startY: y,
      head: [["Zone", "Risk Level", "Workers", "Incidents (MTD)", "Last Incident", "Evacuation Points", "Zone Admin"]],
      body: zoneRisk.tableRows,
      theme: "grid",
      headStyles: { fillColor: [255, 150, 0], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 7 },
      margin: { left: 15, right: 15 },
    });
    y = getTableY(doc) + 8;

    // Zone charts side by side
    checkPageBreak(70);
    const halfW = (pageWidth - 35) / 2;
    drawBarChart(doc, 15, y, halfW, 58, zoneRisk.incidentChart, "Incidents by Zone (MTD)", 5);

    drawBarChart(doc, pageWidth / 2 + 2.5, y, halfW, 58, zoneRisk.workersChart, "Workers per Zone", 10);
    y += 65;
  }

  // ── Employee Roster ─────────────────────────────────────────
  if (selectedSections.includes("employee_list")) {
    checkPageBreak(30);
    drawSectionHeader("Employee Safety Roster", [0, 200, 224]);
    // SUPABASE_MIGRATION_POINT: employee_roster — FROM employees
    addTable(doc, {
      startY: y,
      head: [["Name", "Role", "Zone", "Safety Score", "Check-in Rate", "Buddy Pair", "Medical ID"]],
      body: employeeRoster,
      theme: "striped",
      headStyles: { fillColor: [0, 200, 224], textColor: 255, fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 7 },
      alternateRowStyles: { fillColor: [245, 250, 252] },
      margin: { left: 15, right: 15 },
      didParseCell: (data: any) => {
        if (data.section === "body" && data.column.index === 6) {
          const v = data.cell.raw;
          if (v?.includes("[OK]")) data.cell.styles.textColor = [52, 199, 89];
          else if (v?.includes("[!]")) data.cell.styles.textColor = [255, 150, 0];
        }
      },
    });
    y = getTableY(doc) + 8;
  }

  // ── Check-in Compliance ─────────────────────────────────────
  if (selectedSections.includes("checkin_compliance")) {
    checkPageBreak(25);
    drawSectionHeader("Check-in Compliance", [255, 150, 0]);
    // SUPABASE_MIGRATION_POINT: checkin_compliance — FROM checkin_logs
    addTable(doc, {
      startY: y,
      head: [["Employee", "Total Check-ins", "On Time", "Late", "Missed", "Compliance %"]],
      body: checkinCompliance.tableRows,
      theme: "grid",
      headStyles: { fillColor: [255, 150, 0], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 7 },
      margin: { left: 15, right: 15 },
    });
    y = getTableY(doc) + 8;

    // Check-in Compliance Horizontal Bar Chart
    checkPageBreak(75);
    const ciH = drawHorizontalBarChart(doc, 15, y, pageWidth - 30, checkinCompliance.chartBars, "Employee Check-in Compliance Rate");
    y += ciH + 8;
  }

  // ── Journey Log ─────────────────────────────────────────────
  if (selectedSections.includes("journey_log")) {
    checkPageBreak(25);
    drawSectionHeader("Journey Management Log", [139, 92, 246]);
    // SUPABASE_MIGRATION_POINT: journey_log — FROM journey_management
    addTable(doc, {
      startY: y,
      head: [["Journey ID", "Employee", "Origin", "Destination", "Vehicle", "Status", "Distance", "Incidents"]],
      body: journeyLog,
      theme: "grid",
      headStyles: { fillColor: [139, 92, 246], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 7 },
      margin: { left: 15, right: 15 },
    });
    y = getTableY(doc) + 8;
  }

  // ── Playbook Summary ────────────────────────────────────────
  if (selectedSections.includes("playbook_summary")) {
    checkPageBreak(25);
    drawSectionHeader("Response Playbook Summary", [139, 92, 246]);
    // SUPABASE_MIGRATION_POINT: playbook_data — FROM emergency_playbooks
    addTable(doc, {
      startY: y,
      head: [["Playbook", "Trigger Type", "Steps", "Auto-Trigger", "Used Count", "Avg Time"]],
      body: playbookData,
      theme: "grid",
      headStyles: { fillColor: [139, 92, 246], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 7 },
      margin: { left: 15, right: 15 },
    });
    y = getTableY(doc) + 8;
  }

  // ── Remaining simple sections ───────────────────────────────
  const simpleMap: Record<string, { title: string; color: [number,number,number]; content: string }> = {
    incident_timeline: { title: "Incident Timeline", color: [255,150,0], content: "March 3, 09:14 -- SOS triggered by Ahmed Khalil (Zone A). Response in 1m 45s.\nMarch 5, 14:22 -- Fall detected for Mohammed Ali (Zone D). Response in 2m 10s.\nMarch 8, 08:45 -- Missed check-in for Khalid Omar. Confirmed false alarm at 08:49.\nMarch 9, 11:30 -- Journey SOS by Omar Al-Farsi on route. Resolved in 3m 45s.\nMarch 11, 07:12 -- Shake SOS from Sara Al-Mutairi (Zone C). Currently active." },
    root_cause: { title: "Root Cause Analysis", color: [255,45,85], content: "EMG-001: Loose scaffolding caused worker to slip. Root cause: inadequate equipment inspection.\nEMG-002: Wet floor without warning signs in Zone D. Root cause: missing safety signage.\nEMG-004: Driver took wrong exit due to GPS glitch. Root cause: outdated map data." },
    evacuation_report: { title: "Evacuation Readiness", color: [255,45,85], content: "Last evacuation drill: March 1, 2026\nDrill completion time: 4 minutes 22 seconds (target: < 5 minutes)\nAll employees accounted for: YES\nEvacuation points tested: 7/7\nRecommendation: Add signage to Zone D stairwell B." },
    emergency_procedures: { title: "Emergency Procedures", color: [0,200,83], content: "1. SOS Response: Call employee > Dispatch help > Notify admin chain\n2. Evacuation: Trigger alarm > Account for all workers > Report to assembly point\n3. Medical: Call ambulance > Share Medical ID > Secure scene\n4. Security: Silent alert > Lock zone > Contact police\n5. Environmental: Evacuate zone > Call hazmat > Isolate area" },
    weather_log: { title: "Weather Alert Log", color: [255,150,0], content: "March 2: Sandstorm advisory (Moderate) -- Operations paused for 3 hours\nMarch 7: Extreme heat (48 C) -- Mandatory rest cycles enforced\nMarch 10: Thunderstorm warning -- Outdoor work suspended" },
    audit_log: { title: "Audit Log Excerpt", color: [139,92,246], content: "Mar 1 09:00 -- Admin logged in\nMar 1 09:02 -- Emergency drill initiated\nMar 3 09:14 -- SOS received (EMG-001)\nMar 3 09:15 -- Guided Response activated\nMar 3 09:17 -- Emergency resolved\nMar 5 14:22 -- Fall detection alert\nMar 8 08:45 -- Auto-escalation triggered (missed check-in)" },
    admin_performance: { title: "Admin Performance Summary", color: [255,215,0], content: "Rania Al-Dosari: PLATINUM (94 avg, 47 incidents, 12 streak)\nAhmed Al-Rashid: GOLD (87 avg, 31 incidents, 8 streak)\nKhalid Bin Saeed: GOLD (82 avg, 23 incidents, 5 streak)\nNoura Al-Shammari: SILVER (78 avg, 19 incidents, 3 streak)\nOmar Al-Qahtani: SILVER (71 avg, 15 incidents, 2 streak)\nFatima Al-Harbi: BRONZE (65 avg, 8 incidents, 1 streak)\nAvg Response Time: 1m 52s | Training Completion: 78% | Drill Avg Score: 81/100" },
  };

  Object.entries(simpleMap).forEach(([key, val]) => {
    if (!selectedSections.includes(key)) return;
    checkPageBreak(30);
    drawSectionHeader(val.title, val.color);
    doc.setFontSize(8);
    doc.setTextColor(60);
    const lines = doc.splitTextToSize(val.content, pageWidth - 40);
    doc.text(lines, 20, y);
    y += lines.length * 4 + 8;
  });

  // ── Recommendations ─────────────────────────────────────────
  if (selectedSections.includes("recommendations")) {
    checkPageBreak(40);
    drawSectionHeader("Recommendations & Action Items", [255, 214, 10]);
    const recs = [
      "1. URGENT: Complete Medical ID profiles for Mohammed Ali and Ali Mansour",
      "2. PRIORITY: Assign Zone Admin for Zone E (currently unassigned)",
      "3. ACTION: Increase pre-shift checklist compliance from 78% to 85% target",
      "4. IMPROVE: Reduce average response time for missed check-ins (currently 4m 30s)",
      "5. MAINTAIN: Continue excellent evacuation drill performance (92%)",
      "6. CONSIDER: Add weather monitoring integration for Zone D (extreme heat zone)",
      "7. RECOMMEND: Pair remaining 3 unassigned workers in the Buddy System",
    ];
    doc.setFontSize(9);
    doc.setTextColor(50);
    recs.forEach(r => {
      checkPageBreak(6);
      doc.text(r, 20, y, { maxWidth: pageWidth - 40 });
      y += 6;
    });
    y += 5;
  }

  // ── Legal Disclaimer ────────────────────────────────────────
  if (selectedSections.includes("legal_disclaimer")) {
    checkPageBreak(40);
    drawSectionHeader("Legal Disclaimer & Approval", [0, 200, 224]);
    doc.setFontSize(8);
    doc.setTextColor(100);
    const disclaimer = "This report has been automatically generated by SOSphere Safety Intelligence Platform. The data contained herein is based on system records and employee inputs during the reporting period. This document is confidential and intended solely for authorized personnel of " + companyName + ". Unauthorized distribution is prohibited. This report may be used for regulatory compliance (OSHA, ISO 45001), insurance documentation, and internal safety audits.";
    const disclaimerLines = doc.splitTextToSize(disclaimer, pageWidth - 40);
    doc.text(disclaimerLines, 20, y);
    y += disclaimerLines.length * 3.5 + 10;

    checkPageBreak(30);
    doc.setFontSize(9);
    doc.setTextColor(50);
    doc.text("Prepared By: ____________________________", 20, y);
    doc.text("Date: _______________", pageWidth - 70, y);
    y += 10;
    doc.text("Reviewed By: ____________________________", 20, y);
    doc.text("Date: _______________", pageWidth - 70, y);
    y += 10;
    doc.text("Approved By: ____________________________", 20, y);
    doc.text("Date: _______________", pageWidth - 70, y);
    y += 15;

    // ── QR Verification Block on Last Page ──────────────────
    if (qrDataURL) {
      checkPageBreak(55);
      const vBoxX = 15;
      const vBoxW = pageWidth - 30;
      const vBoxH = 48;

      doc.setFillColor(245, 248, 252);
      doc.roundedRect(vBoxX, y, vBoxW, vBoxH, 3, 3, "F");
      doc.setDrawColor(200, 210, 230);
      doc.setLineWidth(0.3);
      doc.roundedRect(vBoxX, y, vBoxW, vBoxH, 3, 3, "S");

      // QR Code
      const lastQrSize = 30;
      doc.addImage(qrDataURL, "PNG", vBoxX + 8, y + 9, lastQrSize, lastQrSize);

      // Verification details
      const infoX = vBoxX + lastQrSize + 18;
      doc.setFontSize(10);
      doc.setTextColor(30, 41, 59);
      doc.text("Digital Verification Certificate", infoX, y + 10);

      doc.setFontSize(7);
      doc.setTextColor(100);
      doc.text(`Document ID: ${verificationId}`, infoX, y + 16);
      doc.text(`Generated: ${today.toLocaleString()}`, infoX, y + 21);
      doc.text(`Verification URL: ${verificationURL}`, infoX, y + 26);
      doc.text(`Hash: SHA-256 ${realDocHash.slice(0, 32)}...`, infoX, y + 31);

      doc.setFontSize(6);
      doc.setTextColor(0, 150, 170);
      doc.text("Scan QR code to verify the authenticity and integrity of this report.", infoX, y + 38);
      doc.text("This digital certificate confirms the report was generated by SOSphere platform.", infoX, y + 42);

      y += vBoxH + 5;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // WATERMARK — Applied to every page EXCEPT cover (page 1)
  // ═══════════════════════════════════════════════════════════
  const totalPages = doc.getNumberOfPages();
  for (let p = 2; p <= totalPages; p++) {
    doc.setPage(p);

    // ── Diagonal "CONFIDENTIAL" watermark ──────────────────
    doc.saveGraphicsState();
    doc.setGState(new (doc as any).GState({ opacity: 0.035 }));
    doc.setFontSize(62);
    doc.setTextColor(0, 200, 224);

    const cx = pageWidth / 2;
    const cy = pageHeight / 2;
    const angle = -40 * (Math.PI / 180);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const text = "CONFIDENTIAL";
    const textW = doc.getTextWidth(text);
    const tx = cx - (textW * cos) / 2;
    const ty = cy - (textW * sin) / 2;

    doc.internal.write(
      `q ${cos.toFixed(4)} ${sin.toFixed(4)} ${(-sin).toFixed(4)} ${cos.toFixed(4)} ${(tx * 72 / 25.4).toFixed(2)} ${((pageHeight - ty) * 72 / 25.4).toFixed(2)} cm`
    );
    doc.text(text, 0, 0);
    doc.internal.write("Q");
    doc.restoreGraphicsState();

    // ── Corner security marks ──────────────────────────────
    doc.saveGraphicsState();
    doc.setGState(new (doc as any).GState({ opacity: 0.06 }));
    doc.setDrawColor(0, 200, 224);
    doc.setLineWidth(0.4);
    doc.line(8, 8, 8, 18);
    doc.line(8, 8, 18, 8);
    doc.line(pageWidth - 8, 8, pageWidth - 8, 18);
    doc.line(pageWidth - 8, 8, pageWidth - 18, 8);
    doc.line(8, pageHeight - 8, 8, pageHeight - 18);
    doc.line(8, pageHeight - 8, 18, pageHeight - 8);
    doc.line(pageWidth - 8, pageHeight - 8, pageWidth - 8, pageHeight - 18);
    doc.line(pageWidth - 8, pageHeight - 8, pageWidth - 18, pageHeight - 8);
    doc.restoreGraphicsState();

    // ── Bottom security strip ──────────────────────────────
    doc.saveGraphicsState();
    doc.setGState(new (doc as any).GState({ opacity: 0.04 }));
    doc.setFillColor(0, 200, 224);
    doc.rect(0, pageHeight - 4, pageWidth, 4, "F");
    doc.restoreGraphicsState();

    // ── Watermark metadata line (bottom) ───────────────────
    doc.setFontSize(5);
    doc.setTextColor(180);
    doc.text(
      `SOSphere | ${verificationId} | ${companyName} | Generated ${today.toISOString().split("T")[0]} | Page ${p}/${totalPages} | CONFIDENTIAL`,
      pageWidth / 2, pageHeight - 4,
      { align: "center" }
    );
  }

  // Save
  const filename = `SOSphere_Safety_Report_${companyName.replace(/\s/g, "_")}_${today.toISOString().split("T")[0]}.pdf`;
  doc.save(filename);
  console.log("[SUPABASE_READY] compliance_pdf_generated", { verificationId, totalPages, wasEncrypted, sectionCount: selectedSections.length });
  return { verificationId, verificationURL, generatedAt: today.toISOString(), totalPages, companyName, wasEncrypted };
}

// ═══════════════════════════════════════════════════════════════
// SECTION PICKER MODAL — Admin chooses what goes in the report
// ═══════════════════════════════════════════════════════════════

type ExportRecipient = "self" | "main_admin" | "owner" | "zone_admin" | "hse_manager" | "insurance" | "regulator";

const EXPORT_RECIPIENTS: { id: ExportRecipient; label: string; description: string; icon: any; color: string }[] = [
  { id: "self",        label: "Download Locally",         description: "Save to your device only",                 icon: Download,        color: "#00C8E0" },
  { id: "main_admin",  label: "Send to Main Admin",       description: "Admin receives a copy via email",          icon: Users,           color: "#00C853" },
  { id: "owner",       label: "Send to Owner",            description: "Company owner receives the report",        icon: Shield,          color: "#FFD60A" },
  { id: "zone_admin",  label: "Send to Zone Admins",      description: "All zone lead admins get a copy",          icon: MapPin,          color: "#FF9500" },
  { id: "hse_manager", label: "Send to HSE Manager",      description: "Health, Safety & Environment officer",     icon: Heart,           color: "#FF2D55" },
  { id: "insurance",   label: "Export for Insurance",      description: "Formatted for insurance claim submission", icon: FileText,        color: "#8B5CF6" },
  { id: "regulator",   label: "Export for Regulator",      description: "OSHA / ISO 45001 compliance format",       icon: Lock,            color: "#8B5CF6" },
];

type ReportFormat = "detailed" | "executive" | "legal";

const REPORT_FORMATS: { id: ReportFormat; label: string; description: string; color: string }[] = [
  { id: "detailed",  label: "Detailed Report",    description: "Full data with all tables, logs, and evidence",      color: "#00C8E0" },
  { id: "executive", label: "Executive Summary",   description: "High-level overview for leadership — 3-5 pages",    color: "#FFD60A" },
  { id: "legal",     label: "Legal / Compliance",  description: "Structured for audits, courts, and regulatory bodies", color: "#8B5CF6" },
];

function SectionPickerModal({
  onGenerate,
  onClose,
}: {
  onGenerate: (sections: string[], preparedFor?: string, format?: ReportFormat, recipients?: ExportRecipient[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(
    ALL_SECTIONS.filter(s => s.defaultChecked).map(s => s.id)
  );
  const [activeTab, setActiveTab] = useState<"sections" | "recipients" | "format">("sections");
  const [recipients, setRecipients] = useState<ExportRecipient[]>(["self"]);
  const [reportFormat, setReportFormat] = useState<ReportFormat>("detailed");
  const [preparedFor, setPreparedFor] = useState("");

  const toggle = (id: string) => {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const toggleRecipient = (id: ExportRecipient) => {
    setRecipients(prev =>
      prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]
    );
  };

  const selectAll = () => setSelected(ALL_SECTIONS.map(s => s.id));
  const deselectAll = () => setSelected([]);
  const selectCategory = (cat: string) => {
    const catSections = ALL_SECTIONS.filter(s => s.category === cat).map(s => s.id);
    const allSelected = catSections.every(id => selected.includes(id));
    if (allSelected) {
      setSelected(prev => prev.filter(id => !catSections.includes(id)));
    } else {
      setSelected(prev => [...new Set([...prev, ...catSections])]);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="relative w-full max-w-2xl mx-4 flex flex-col"
        style={{
          maxHeight: "88vh",
          background: "linear-gradient(180deg, #0C1222, #05070E)",
          borderRadius: 24,
          border: "1px solid rgba(0,200,224,0.1)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div className="px-5 pt-4 pb-3 flex items-center justify-between"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div>
            <div className="flex items-center gap-2">
              <FileText className="size-4" style={{ color: "#00C8E0" }} />
              <h3 className="text-white" style={{ fontSize: 16, fontWeight: 800 }}>Generate PDF Report</h3>
            </div>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
              Configure your report content, format, and recipients
            </p>
          </div>
          <button onClick={onClose} className="size-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <X className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-2.5 pb-2 flex items-center gap-1.5"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
          {([
            { id: "sections" as const, label: "Sections", count: `${selected.length}/${ALL_SECTIONS.length}` },
            { id: "format" as const, label: "Format", count: null },
            { id: "recipients" as const, label: "Export To", count: `${recipients.length}` },
          ]).map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
              style={{
                background: activeTab === tab.id ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${activeTab === tab.id ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.04)"}`,
              }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: activeTab === tab.id ? "#00C8E0" : "rgba(255,255,255,0.35)" }}>
                {tab.label}
              </span>
              {tab.count && (
                <span className="px-1.5 py-0.5 rounded" style={{ fontSize: 8, fontWeight: 800, background: activeTab === tab.id ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.04)", color: activeTab === tab.id ? "#00C8E0" : "rgba(255,255,255,0.2)" }}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
          <div className="flex-1" />
          {activeTab === "sections" && (
            <div className="flex gap-1.5">
              <button onClick={selectAll} className="px-2.5 py-1 rounded-md"
                style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.1)" }}>
                <span style={{ fontSize: 9, color: "#00C8E0", fontWeight: 600 }}>All</span>
              </button>
              <button onClick={deselectAll} className="px-2.5 py-1 rounded-md"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>None</span>
              </button>
            </div>
          )}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto px-5 py-3" style={{ scrollbarWidth: "none" }}>

          {/* ── RECIPIENTS TAB ──────────────────────────────── */}
          {activeTab === "recipients" && (
            <div className="space-y-3">
              <div className="mb-4">
                <p className="text-white mb-1" style={{ fontSize: 13, fontWeight: 700 }}>Who should receive this report?</p>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
                  Select one or more recipients. "Download Locally" always downloads to your device.
                </p>
              </div>
              {EXPORT_RECIPIENTS.map(recipient => {
                const RIcon = recipient.icon;
                const isChecked = recipients.includes(recipient.id);
                return (
                  <motion.button
                    key={recipient.id}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => toggleRecipient(recipient.id)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl text-left"
                    style={{
                      background: isChecked ? `${recipient.color}06` : "rgba(255,255,255,0.01)",
                      border: `1px solid ${isChecked ? `${recipient.color}15` : "rgba(255,255,255,0.04)"}`,
                    }}
                  >
                    <div className="size-6 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{
                        background: isChecked ? recipient.color : "rgba(255,255,255,0.04)",
                        border: `1px solid ${isChecked ? recipient.color : "rgba(255,255,255,0.08)"}`,
                      }}>
                      {isChecked ? <CheckCircle2 className="size-3.5" style={{ color: "#fff" }} /> : <RIcon className="size-3" style={{ color: "rgba(255,255,255,0.2)" }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p style={{ fontSize: 12, fontWeight: 600, color: isChecked ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.4)" }}>
                        {recipient.label}
                      </p>
                      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{recipient.description}</p>
                    </div>
                    <RIcon className="size-4 flex-shrink-0" style={{ color: isChecked ? recipient.color : "rgba(255,255,255,0.1)" }} />
                  </motion.button>
                );
              })}

              {/* Prepared For field */}
              <div className="mt-4 pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                <p className="mb-2" style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)" }}>
                  Prepared For (optional)
                </p>
                <input
                  type="text"
                  value={preparedFor}
                  onChange={(e) => setPreparedFor(e.target.value)}
                  placeholder="e.g. Ministry of Labor, Insurance Company Name..."
                  className="w-full px-3 py-2.5 rounded-xl outline-none"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    color: "white",
                    fontSize: 12,
                  }}
                />
                <p className="mt-1.5" style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>
                  This name will appear on the cover page and legal disclaimer
                </p>
              </div>
            </div>
          )}

          {/* ── FORMAT TAB ──────────────────────────────────── */}
          {activeTab === "format" && (
            <div className="space-y-3">
              <div className="mb-4">
                <p className="text-white mb-1" style={{ fontSize: 13, fontWeight: 700 }}>Report Format</p>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
                  Choose how the report should be structured
                </p>
              </div>
              {REPORT_FORMATS.map(fmt => (
                <motion.button
                  key={fmt.id}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setReportFormat(fmt.id)}
                  className="w-full flex items-center gap-3 p-4 rounded-xl text-left"
                  style={{
                    background: reportFormat === fmt.id ? `${fmt.color}06` : "rgba(255,255,255,0.01)",
                    border: `1px solid ${reportFormat === fmt.id ? `${fmt.color}20` : "rgba(255,255,255,0.04)"}`,
                  }}
                >
                  <div className="size-5 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      background: reportFormat === fmt.id ? fmt.color : "transparent",
                      border: `2px solid ${reportFormat === fmt.id ? fmt.color : "rgba(255,255,255,0.12)"}`,
                    }}>
                    {reportFormat === fmt.id && <div className="size-2 rounded-full" style={{ background: "#fff" }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: 13, fontWeight: 700, color: reportFormat === fmt.id ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)" }}>
                      {fmt.label}
                    </p>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>{fmt.description}</p>
                  </div>
                </motion.button>
              ))}

              {/* Preview of what this format includes */}
              <div className="mt-4 p-3 rounded-xl" style={{ background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.06)" }}>
                <p className="mb-2" style={{ fontSize: 10, fontWeight: 700, color: "#00C8E0" }}>
                  {reportFormat === "detailed" ? "INCLUDES EVERYTHING" : reportFormat === "executive" ? "SUMMARY VIEW" : "LEGAL STRUCTURE"}
                </p>
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", lineHeight: 1.6 }}>
                  {reportFormat === "detailed" && "Full tables with all rows, individual incident details, employee lists, zone breakdowns, timeline events, corrective actions, and raw audit data."}
                  {reportFormat === "executive" && "KPIs only, high-level incident counts, safety score trend, top recommendations. Designed for C-level and board presentations."}
                  {reportFormat === "legal" && "Numbered sections, formal structure, evidence chain, witness/signature blocks, regulatory references (OSHA 300, ISO 45001), and chain-of-custody formatting."}
                </p>
              </div>
            </div>
          )}

          {/* ── SECTIONS TAB ───────────────────────────────── */}
          {activeTab === "sections" && CATEGORIES.map(cat => {
            const catSections = ALL_SECTIONS.filter(s => s.category === cat);
            const catColor = CATEGORY_COLORS[cat] || "#00C8E0";
            const allSelected = catSections.every(s => selected.includes(s.id));
            const someSelected = catSections.some(s => selected.includes(s.id));

            return (
              <div key={cat} className="mb-4">
                <button onClick={() => selectCategory(cat)}
                  className="flex items-center gap-2 mb-2 w-full text-left">
                  <div className="size-4 rounded flex items-center justify-center"
                    style={{
                      background: allSelected ? catColor : someSelected ? `${catColor}30` : "rgba(255,255,255,0.04)",
                      border: `1px solid ${allSelected ? catColor : `${catColor}20`}`,
                    }}>
                    {allSelected && <CheckCircle2 className="size-3" style={{ color: "#fff" }} />}
                    {someSelected && !allSelected && <div className="size-1.5 rounded-full" style={{ background: catColor }} />}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: catColor, letterSpacing: "0.5px" }}>
                    {cat.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>
                    ({catSections.filter(s => selected.includes(s.id)).length}/{catSections.length})
                  </span>
                </button>

                <div className="space-y-1 pl-1">
                  {catSections.map(section => {
                    const SIcon = section.icon;
                    const isChecked = selected.includes(section.id);
                    return (
                      <motion.button
                        key={section.id}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => toggle(section.id)}
                        className="w-full flex items-center gap-2.5 p-2 rounded-lg text-left"
                        style={{
                          background: isChecked ? `${section.color}04` : "transparent",
                          border: `1px solid ${isChecked ? `${section.color}10` : "transparent"}`,
                        }}
                      >
                        <div className="size-5 rounded flex items-center justify-center flex-shrink-0"
                          style={{
                            background: isChecked ? section.color : "rgba(255,255,255,0.04)",
                            border: `1px solid ${isChecked ? section.color : "rgba(255,255,255,0.08)"}`,
                          }}>
                          {isChecked && <CheckCircle2 className="size-3" style={{ color: "#fff" }} />}
                        </div>
                        <SIcon className="size-3.5 flex-shrink-0" style={{ color: isChecked ? section.color : "rgba(255,255,255,0.15)" }} />
                        <div className="flex-1 min-w-0">
                          <p style={{ fontSize: 11, fontWeight: 600, color: isChecked ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.4)" }}>
                            {section.label}
                          </p>
                          <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{section.description}</p>
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer — Generate button */}
        <div className="px-5 py-3"
          style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: "rgba(0,0,0,0.2)" }}>
          {/* Summary row */}
          <div className="flex items-center gap-3 mb-2.5">
            <div className="flex items-center gap-1.5">
              <div className="size-1.5 rounded-full" style={{ background: "#00C8E0" }} />
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
                {selected.length} sections
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="size-1.5 rounded-full" style={{ background: "#00C853" }} />
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
                {REPORT_FORMATS.find(f => f.id === reportFormat)?.label}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="size-1.5 rounded-full" style={{ background: "#FF9500" }} />
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
                {recipients.length} recipient{recipients.length !== 1 ? "s" : ""}
              </span>
            </div>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>
              ~{Math.max(3, Math.round(selected.length * (reportFormat === "executive" ? 0.4 : reportFormat === "legal" ? 1.5 : 1.2)))} pages
            </span>
          </div>
          {/* Buttons */}
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>Cancel</span>
            </button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => onGenerate(selected, preparedFor || undefined, reportFormat, recipients)}
              disabled={selected.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl"
              style={{
                background: selected.length > 0
                  ? "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,200,224,0.06))"
                  : "rgba(255,255,255,0.03)",
                border: `1px solid ${selected.length > 0 ? "rgba(0,200,224,0.25)" : "rgba(255,255,255,0.05)"}`,
                opacity: selected.length > 0 ? 1 : 0.4,
              }}
            >
              <Download className="size-4" style={{ color: "#00C8E0" }} />
              <span style={{ fontSize: 12, color: "#00C8E0", fontWeight: 700 }}>
                {recipients.includes("self") && recipients.length === 1
                  ? `Download PDF (${selected.length} sections)`
                  : `Generate & Send (${recipients.length} recipients)`
                }
              </span>
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Recent Reports (mock)
// ═══════════════════════════════════════════════════════════════

interface RecentReport {
  id: string;
  title: string;
  type: "incident" | "monthly" | "quarterly" | "audit" | "custom" | "performance";
  period: string;
  generatedAt: Date;
  status: "ready" | "generating" | "scheduled";
  pageCount: number;
  size: string;
  sections: string[];
  autoScheduled: boolean;
}

/* SUPABASE_MIGRATION_POINT: compliance_reports
   SELECT * FROM generated_reports
   WHERE company_id = :id ORDER BY created_at DESC */
const RECENT_REPORTS: RecentReport[] = [
  { id: "RPT-001", title: "Monthly Safety Report — February 2026", type: "monthly", period: "Feb 1-28, 2026", generatedAt: new Date(Date.now() - 86400000), status: "ready", pageCount: 24, size: "2.4 MB", sections: ["KPI Dashboard", "Check-in Compliance", "Incident Count"], autoScheduled: true },
  { id: "RPT-002", title: "Incident Report — Zone A Fall Detection", type: "incident", period: "March 8, 2026", generatedAt: new Date(Date.now() - 172800000), status: "ready", pageCount: 8, size: "1.1 MB", sections: ["Incident Timeline", "Response Actions", "Photos & Evidence"], autoScheduled: false },
  { id: "RPT-003", title: "Q1 2026 Safety Audit Report", type: "quarterly", period: "Jan 1 - Mar 31, 2026", generatedAt: new Date(Date.now() - 7200000), status: "ready", pageCount: 36, size: "4.8 MB", sections: ["Full Audit"], autoScheduled: true },
  { id: "RPT-004", title: "Insurance Claim — Incident #EMG-0A", type: "custom", period: "March 5, 2026", generatedAt: new Date(Date.now() - 432000000), status: "ready", pageCount: 12, size: "3.2 MB", sections: ["Incident Details", "Medical Reports", "Response Timeline"], autoScheduled: false },
  { id: "RPT-005", title: "Admin Performance Report — March 2026", type: "performance", period: "Mar 1-11, 2026", generatedAt: new Date(Date.now() - 3600000), status: "ready", pageCount: 6, size: "1.8 MB", sections: ["Response Scores", "Tier Rankings", "Drill Completion", "AI Insights"], autoScheduled: true },
];

const TYPE_CONFIG: Record<string, { color: string; label: string }> = {
  incident: { color: "#FF9500", label: "Incident" },
  monthly: { color: "#00C8E0", label: "Monthly" },
  quarterly: { color: "#00C853", label: "Quarterly" },
  audit: { color: "#8B5CF6", label: "Audit" },
  custom: { color: "#FF2D55", label: "Custom" },
  performance: { color: "#FFD700", label: "Performance" },
};

// ═══════════════════════════════════════════════════════════════
// MAIN DASHBOARD PAGE
// ═══════════════════════════════════════════════════════════════

export function ComplianceReportsPage({ t, webMode, companyName: companyNameProp = "SOSphere Industries" }: { t: (k: string) => string; webMode?: boolean; companyName?: string }) {
  // Use real company name from localStorage if available
  const companyName = (() => {
    try {
      const p = JSON.parse(localStorage.getItem("sosphere_company_profile") || "{}");
      return p.name || companyNameProp;
    } catch { return companyNameProp; }
  })();
  const [showPicker, setShowPicker] = useState(false);
  const [activeTab, setActiveTab] = useState<"reports" | "schedule">("reports");

  // ── Auto-Schedule State ──
  const [schedules, setSchedules] = useState(DEFAULT_SCHEDULES.map(s => ({ ...s })));

  const toggleSchedule = useCallback((id: string) => {
    setSchedules(prev => prev.map(s => {
      if (s.id !== id) return s;
      const enabled = !s.active;
      console.log("[SUPABASE_READY] schedule_toggled: " + JSON.stringify({ id: s.id, name: s.name, frequency: s.frequency, enabled, reportTypes: s.reportTypes }));
      return { ...s, active: enabled };
    }));
  }, []);

  // ── PDF Password Protection State ──
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [pendingPdfArgs, setPendingPdfArgs] = useState<{ sections: string[]; pf?: string; fmt?: ReportFormat; recs?: ExportRecipient[] } | null>(null);
  const [pendingDownloadReport, setPendingDownloadReport] = useState<RecentReport | null>(null);

  // ── Email Delivery Modal State ──
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [lastReportTitle, setLastReportTitle] = useState("");
  const [lastReportEncrypted, setLastReportEncrypted] = useState(false);
  const [lastEncryptionPassword, setLastEncryptionPassword] = useState<string | undefined>();

  // When user clicks Generate in SectionPicker → show password modal first
  const handleGenerateRequest = useCallback((sections: string[], pf?: string, fmt?: ReportFormat, recs?: ExportRecipient[]) => {
    setShowPicker(false);
    setPendingPdfArgs({ sections, pf, fmt, recs });
    setPendingDownloadReport(null);
    setShowPasswordModal(true);
  }, []);

  // When user clicks Download on a recent report → show password modal first
  const handleDownloadRequest = useCallback((report: RecentReport) => {
    setPendingDownloadReport(report);
    setPendingPdfArgs(null);
    setShowPasswordModal(true);
  }, []);

  // Actual generation after password decision
  const handlePasswordConfirm = useCallback(async (encConfig: PdfEncryptionConfig | null) => {
    setShowPasswordModal(false);

    if (pendingPdfArgs) {
      const { sections, pf, fmt, recs } = pendingPdfArgs;
      try {
        const loadingMsg = encConfig
          ? "Generating encrypted PDF with QR verification..."
          : "Generating PDF with QR verification...";
        toast.loading(loadingMsg, { id: "gen-pdf", duration: 8000 });
        const _realPdfData = buildRealPdfData();
        const result = await generatePDF(sections, companyName, pf, fmt, recs, encConfig, _realPdfData ? { kpi: { ...MOCK_KPI_DATA, ...(_realPdfData.kpi || {}) } } as any : undefined);
        const actuallyEncrypted = result?.wasEncrypted ?? false;
        const encLabel = actuallyEncrypted ? " | Password Protected" : encConfig ? " | Encryption Skipped (unsupported)" : "";
        toast.success("PDF Generated Successfully", { id: "gen-pdf", description: `${sections.length} sections | ${result?.totalPages || "?"} pages | ID: ${result?.verificationId || "N/A"} | QR Verified & Watermarked${encLabel}` });
        if (encConfig && !actuallyEncrypted) {
          toast.warning("Encryption Not Applied", { description: "Your jsPDF version doesn't support encryption. PDF was generated without password protection.", duration: 6000 });
        }
        hapticSuccess();
        // Store for email modal
        setLastReportTitle(`Safety Report - ${sections.length} sections`);
        setLastReportEncrypted(actuallyEncrypted);
        setLastEncryptionPassword(encConfig?.password);
        // Offer email delivery
        setTimeout(() => {
          toast("Email this report?", {
            description: "Send the generated PDF to team members",
            action: { label: "Email Report", onClick: () => setShowEmailModal(true) },
            duration: 8000,
          });
        }, 1500);
      } catch (err) {
        console.error("PDF generation error:", err);
        toast.error("PDF Generation Failed", { id: "gen-pdf", description: "An error occurred. Please try with fewer sections." });
      }
      setPendingPdfArgs(null);
    }

    if (pendingDownloadReport) {
      const report = pendingDownloadReport;
      hapticSuccess();
      const loadingMsg = encConfig
        ? `Generating encrypted "${report.title}"...`
        : `Generating "${report.title}"...`;
      toast.loading(loadingMsg, { id: `dl-${report.id}`, duration: 8000 });
      try {
        const sectionIds = ALL_SECTIONS.filter(s => s.defaultChecked).map(s => s.id);
        const result = await generatePDF(sectionIds, companyName, undefined, "detailed", undefined, encConfig);
        const actuallyEncrypted = result?.wasEncrypted ?? false;
        const encLabel = actuallyEncrypted ? " | Encrypted" : "";
        toast.success("Report Downloaded", { id: `dl-${report.id}`, description: `${report.title} — ${report.pageCount} pages, ${report.size}${encLabel}` });
        if (encConfig && !actuallyEncrypted) {
          toast.warning("Encryption Not Applied", { description: "PDF generated without password protection — encryption not supported.", duration: 5000 });
        }
        // Store for email modal
        setLastReportTitle(report.title);
        setLastReportEncrypted(actuallyEncrypted);
        setLastEncryptionPassword(encConfig?.password);
        setTimeout(() => {
          toast("Email this report?", {
            description: "Send the generated PDF to team members",
            action: { label: "Email Report", onClick: () => setShowEmailModal(true) },
            duration: 8000,
          });
        }, 1500);
      } catch (err) {
        console.error("PDF download error:", err);
        toast.error("Download Failed", { id: `dl-${report.id}`, description: "Could not generate the PDF. Try again." });
      }
      setPendingDownloadReport(null);
    }
  }, [companyName, pendingPdfArgs, pendingDownloadReport]);

  return (
    <div className={`p-5 space-y-5 ${webMode ? "max-w-5xl mx-auto" : ""}`}>
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Reports Ready", value: RECENT_REPORTS.filter(r => r.status === "ready").length, color: "#00C8E0", icon: FileText, tip: "View ready reports below" },
          { label: "Auto-Scheduled", value: RECENT_REPORTS.filter(r => r.autoScheduled).length, color: "#00C853", icon: RefreshCw, tip: "Manage auto-schedule settings" },
          { label: "Total Pages", value: RECENT_REPORTS.reduce((a, b) => a + b.pageCount, 0), color: "#FF9500", icon: BarChart3, tip: "Combined report page count" },
          { label: "Available Sections", value: ALL_SECTIONS.length, color: "#8B5CF6", icon: Shield, tip: `${ALL_SECTIONS.length} configurable report sections` },
        ].map(stat => {
          const SI = stat.icon;
          return (
            <motion.button key={stat.label} whileTap={{ scale: 0.97 }}
              onClick={() => { hapticSuccess(); toast.success(stat.label, { description: stat.tip }); }}
              className="rounded-xl p-3 text-left cursor-pointer"
              style={{ background: `${stat.color}06`, border: `1px solid ${stat.color}10`, transition: "all 0.2s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = `${stat.color}30`; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = `${stat.color}10`; }}>
              <div className="flex items-center gap-2 mb-2">
                <SI className="size-3.5" style={{ color: stat.color }} />
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>{stat.label}</span>
              </div>
              <span className="text-white" style={{ fontSize: 20, fontWeight: 800 }}>{stat.value}</span>
            </motion.button>
          );
        })}
      </div>

      {/* Generate Button */}
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={() => setShowPicker(true)}
        className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl"
        style={{
          background: "linear-gradient(135deg, rgba(0,200,224,0.08), rgba(0,200,224,0.03))",
          border: "1px solid rgba(0,200,224,0.15)",
          boxShadow: "0 4px 20px rgba(0,200,224,0.08)",
        }}
      >
        <Download className="size-5" style={{ color: "#00C8E0" }} />
        <span className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Generate New PDF Report</span>
        <span style={{ fontSize: 11, color: "rgba(0,200,224,0.5)" }}>— Choose sections →</span>
      </motion.button>

      {/* Tabs */}
      <div className="flex gap-1.5">
        {(["reports", "schedule"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className="px-4 py-2 rounded-lg"
            style={{
              background: activeTab === tab ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${activeTab === tab ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.05)"}`,
            }}>
            <span style={{ fontSize: 12, color: activeTab === tab ? "#00C8E0" : "rgba(255,255,255,0.4)", fontWeight: 600 }}>
              {tab === "reports" ? "Recent Reports" : "Auto-Schedule"}
            </span>
          </button>
        ))}
      </div>

      {/* Recent Reports */}
      {activeTab === "reports" && (
        <div className="space-y-2.5">
          {RECENT_REPORTS.map(report => {
            const typeCfg = TYPE_CONFIG[report.type];
            return (
              <div key={report.id} className="flex items-center gap-3 p-3.5 rounded-xl"
                style={{
                  background: report.status === "generating" ? "rgba(255,150,0,0.03)" : "rgba(255,255,255,0.02)",
                  border: `1px solid ${report.status === "generating" ? "rgba(255,150,0,0.08)" : "rgba(255,255,255,0.04)"}`,
                }}>
                <div className="size-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `${typeCfg.color}10`, border: `1px solid ${typeCfg.color}18` }}>
                  <FileText className="size-5" style={{ color: typeCfg.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white truncate" style={{ fontSize: 13, fontWeight: 700 }}>{report.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="px-1.5 py-0.5 rounded" style={{ background: `${typeCfg.color}10` }}>
                      <span style={{ fontSize: 8, fontWeight: 800, color: typeCfg.color }}>{typeCfg.label.toUpperCase()}</span>
                    </div>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{report.period}</span>
                    {report.status === "ready" && (
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{report.pageCount} pages &bull; {report.size}</span>
                    )}
                    {report.status === "generating" && (
                      <motion.span animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 1.5, repeat: Infinity }}
                        style={{ fontSize: 9, color: "#FF9500", fontWeight: 600 }}>Generating...</motion.span>
                    )}
                  </div>
                </div>
                {report.status === "ready" && (
                  <div className="flex items-center gap-1.5">
                    <motion.button whileTap={{ scale: 0.9 }} className="size-9 rounded-lg flex items-center justify-center"
                      onClick={() => { setLastReportTitle(report.title); setLastReportEncrypted(false); setLastEncryptionPassword(undefined); setShowEmailModal(true); }}
                      style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.1)", cursor: "pointer" }}
                      title="Email Report">
                      <Mail className="size-3.5" style={{ color: "#8B5CF6" }} />
                    </motion.button>
                    <motion.button whileTap={{ scale: 0.9 }} className="size-9 rounded-lg flex items-center justify-center"
                      onClick={() => handleDownloadRequest(report)}
                      style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.12)", cursor: "pointer" }}
                      title="Download PDF">
                      <Download className="size-4" style={{ color: "#00C8E0" }} />
                    </motion.button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {activeTab === "schedule" && (
        <div className="space-y-3">
          <div className="rounded-xl p-4" style={{ background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.06)" }}>
            <p className="text-white mb-3" style={{ fontSize: 14, fontWeight: 700 }}>Auto-Scheduled Reports</p>
            {/* SUPABASE_MIGRATION_POINT: auto_schedules — FROM report_schedules WHERE company_id = :id */}
            <div className="space-y-2">
              {schedules.map(schedule => (
                <div key={schedule.id} className="flex items-center gap-3 p-3 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                  <div className="size-8 rounded-lg flex items-center justify-center"
                    style={{ background: schedule.active ? "rgba(0,200,83,0.1)" : "rgba(255,255,255,0.04)" }}>
                    <Calendar className="size-4" style={{ color: schedule.active ? "#00C853" : "rgba(255,255,255,0.2)" }} />
                  </div>
                  <div className="flex-1">
                    <p className="text-white" style={{ fontSize: 12, fontWeight: 600 }}>{schedule.name}</p>
                    <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{schedule.frequency}</p>
                  </div>
                  <div className="w-10 h-5 rounded-full p-0.5 cursor-pointer"
                    onClick={() => toggleSchedule(schedule.id)}
                    style={{ background: schedule.active ? "rgba(0,200,83,0.3)" : "rgba(255,255,255,0.08)" }}>
                    <div className="size-4 rounded-full"
                      style={{ background: schedule.active ? "#00C853" : "rgba(255,255,255,0.2)", transform: schedule.active ? "translateX(20px)" : "translateX(0)", transition: "transform 0.2s" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Section Picker Modal */}
      <AnimatePresence>
        {showPicker && (
          <SectionPickerModal
            onGenerate={handleGenerateRequest}
            onClose={() => setShowPicker(false)}
          />
        )}
      </AnimatePresence>

      {/* PDF Password Protection Modal */}
      <PdfPasswordModal
        open={showPasswordModal}
        onClose={() => { setShowPasswordModal(false); setPendingPdfArgs(null); setPendingDownloadReport(null); }}
        onConfirm={handlePasswordConfirm}
        title="PDF Security"
        description="Protect this compliance report with encryption"
      />

      {/* Email Delivery Simulation Modal */}
      <PdfEmailModal
        open={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        reportTitle={lastReportTitle || "Safety Compliance Report"}
        reportSize="2.4 MB"
        isEncrypted={lastReportEncrypted}
        encryptionPassword={lastEncryptionPassword}
        onSent={(emails) => {
          toast.success("Report Emailed Successfully", {
            description: `Sent to ${emails.length} recipient${emails.length > 1 ? "s" : ""} via secure channel`,
            duration: 5000,
          });
        }}
      />
    </div>
  );
}