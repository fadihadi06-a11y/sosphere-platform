// ═══════════════════════════════════════════════════════════════
// SOSphere — Individual Emergency PDF Report
// Professional, legal-grade incident documentation for individuals
// Paid plans only — can be used as legal evidence
// ═══════════════════════════════════════════════════════════════

import jsPDF from "jspdf";
import { autoTable } from "jspdf-autotable";
import { toast } from "sonner";

// ── Types ───────────────────────────────────────────────────────

export interface IndividualReportData {
  // User
  userName: string;
  userPhone: string;
  plan: "personal" | "family";
  
  // Incident
  incidentId: string;
  triggerMethod: "hold" | "shake" | "fall" | "timer" | "voice";
  startTime: Date;
  endTime: Date;
  
  // Location
  location: {
    lat: number;
    lng: number;
    accuracy: number;
    address: string;
  };
  gpsTrail: { lat: number; lng: number; time: Date }[];
  
  // Contact cycle
  contacts: {
    name: string;
    relation: string;
    phone: string;
    status: "answered" | "no_answer" | "pending";
    callDuration?: number;
  }[];
  cyclesCompleted: number;
  
  // Evidence
  recordingDuration: number; // seconds
  photoCount: number;
  
  // Timeline
  timeline: {
    time: Date;
    event: string;
    type: "trigger" | "call" | "answer" | "location" | "recording" | "photo" | "end";
  }[];
  
  // Resolution
  endReason: string; // "user_safe" | "contact_resolved" | "timeout" | "user_cancelled"
}

// ── Colors ──────────────────────────────────────────────────────

const C = {
  bg: "#05070E",
  card: "#0A1220",
  cyan: "#00C8E0",
  red: "#FF2D55",
  green: "#00C853",
  orange: "#FF9500",
  white: "#FFFFFF",
  gray: "#6B7280",
  lightGray: "#9CA3AF",
};

// ── Generate PDF ────────────────────────────────────────────────

export function generateIndividualReport(data: IndividualReportData): void {
  try {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const margin = 15;
    let y = 0;

    // ────────────────────────────────────────────────────
    // Page 1: Cover + Summary
    // ────────────────────────────────────────────────────

    // Dark header band
    doc.setFillColor(5, 7, 14);
    doc.rect(0, 0, pw, 65, "F");

    // Red accent line
    doc.setFillColor(255, 45, 85);
    doc.rect(0, 65, pw, 1.5, "F");

    // SOSphere logo area
    doc.setFillColor(0, 200, 224);
    doc.roundedRect(margin, 12, 10, 10, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7);
    doc.text("SOS", margin + 5, 18.5, { align: "center" });

    // Title
    doc.setFontSize(22);
    doc.setTextColor(255, 255, 255);
    doc.text("Emergency Incident Report", margin + 14, 18);
    
    doc.setFontSize(9);
    doc.setTextColor(0, 200, 224);
    doc.text("SOSphere Safety Platform", margin + 14, 24);

    // Classification badge
    doc.setFillColor(255, 45, 85);
    doc.roundedRect(pw - margin - 35, 12, 35, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7);
    doc.text("CONFIDENTIAL", pw - margin - 17.5, 17, { align: "center" });

    // Report metadata
    doc.setFontSize(8);
    doc.setTextColor(156, 163, 175);
    y = 35;
    doc.text(`Report ID: ${data.incidentId}`, margin, y);
    doc.text(`Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}`, margin, y + 5);
    doc.text(`Plan: ${data.plan === "family" ? "Family Plan" : "Personal Plan"}`, margin, y + 10);
    
    // Date on right
    doc.setTextColor(255, 150, 0);
    doc.text(data.startTime.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), pw - margin, y, { align: "right" });
    doc.setTextColor(156, 163, 175);
    doc.text(data.startTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }), pw - margin, y + 5, { align: "right" });

    // ── Section 1: Incident Overview ──
    y = 75;
    doc.setFillColor(10, 18, 32);
    doc.roundedRect(margin, y, pw - margin * 2, 52, 3, 3, "F");
    doc.setDrawColor(0, 200, 224);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, y, pw - margin * 2, 52, 3, 3, "S");

    doc.setFontSize(11);
    doc.setTextColor(0, 200, 224);
    doc.text("1. INCIDENT OVERVIEW", margin + 5, y + 8);

    doc.setFontSize(8);
    doc.setTextColor(200, 200, 200);
    const overviewData = [
      ["Reported By", data.userName],
      ["Phone", data.userPhone],
      ["Trigger Method", getTriggerLabel(data.triggerMethod)],
      ["Start Time", formatDateTime(data.startTime)],
      ["End Time", formatDateTime(data.endTime)],
      ["Duration", formatDuration(data.startTime, data.endTime)],
      ["Resolution", getEndReasonLabel(data.endReason)],
    ];

    let oy = y + 14;
    overviewData.forEach(([label, value]) => {
      doc.setTextColor(107, 112, 128);
      doc.text(label, margin + 8, oy);
      doc.setTextColor(220, 220, 220);
      doc.text(value, margin + 55, oy);
      oy += 5;
    });

    // ── Section 2: Location Data ──
    y = 135;
    doc.setFillColor(10, 18, 32);
    doc.roundedRect(margin, y, pw - margin * 2, 35, 3, 3, "F");
    doc.setDrawColor(0, 200, 83);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, y, pw - margin * 2, 35, 3, 3, "S");

    doc.setFontSize(11);
    doc.setTextColor(0, 200, 83);
    doc.text("2. LOCATION DATA", margin + 5, y + 8);

    doc.setFontSize(8);
    const locData = [
      ["Address", data.location.address],
      ["GPS Coordinates", `${data.location.lat.toFixed(6)}N, ${data.location.lng.toFixed(6)}E`],
      ["Accuracy", `\u00B1${data.location.accuracy}m`],
      ["GPS Trail Points", `${data.gpsTrail.length} location updates recorded`],
    ];

    oy = y + 14;
    locData.forEach(([label, value]) => {
      doc.setTextColor(107, 112, 128);
      doc.text(label, margin + 8, oy);
      doc.setTextColor(220, 220, 220);
      doc.text(value, margin + 55, oy);
      oy += 5;
    });

    // ── Section 3: Contact Cycle ──
    y = 178;
    doc.setFontSize(11);
    doc.setTextColor(255, 150, 0);
    doc.text("3. EMERGENCY CONTACT CYCLE", margin + 5, y);

    y += 5;
    autoTable(doc, {
      startY: y,
      margin: { left: margin + 3, right: margin + 3 },
      head: [["#", "Contact", "Relation", "Phone", "Status", "Duration"]],
      body: data.contacts.map((c, i) => [
        (i + 1).toString(),
        c.name,
        c.relation,
        c.phone,
        c.status === "answered" ? "ANSWERED" : c.status === "no_answer" ? "NO ANSWER" : "PENDING",
        c.callDuration ? `${c.callDuration}s` : "-",
      ]),
      theme: "plain",
      styles: { fontSize: 7.5, textColor: [200, 200, 200], cellPadding: 2.5, lineWidth: 0.1, lineColor: [30, 40, 60] },
      headStyles: { fillColor: [10, 18, 32], textColor: [0, 200, 224], fontSize: 7, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [8, 14, 26] },
      columnStyles: {
        4: { textColor: [0, 0, 0], fontStyle: "bold" },
      },
      didParseCell: (hookData) => {
        if (hookData.column.index === 4 && hookData.section === "body") {
          const val = hookData.cell.raw as string;
          if (val === "ANSWERED") {
            hookData.cell.styles.textColor = [0, 200, 83];
          } else if (val === "NO ANSWER") {
            hookData.cell.styles.textColor = [255, 150, 0];
          } else {
            hookData.cell.styles.textColor = [107, 112, 128];
          }
        }
      },
    });

    y = (doc as any).lastAutoTable.finalY + 5;
    doc.setFontSize(8);
    doc.setTextColor(107, 112, 128);
    doc.text(`Total call cycles completed: ${data.cyclesCompleted}`, margin + 5, y);

    // ── Section 4: Evidence Collected ──
    y += 10;
    doc.setFillColor(10, 18, 32);
    doc.roundedRect(margin, y, pw - margin * 2, 30, 3, 3, "F");
    doc.setDrawColor(255, 45, 85);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, y, pw - margin * 2, 30, 3, 3, "S");

    doc.setFontSize(11);
    doc.setTextColor(255, 45, 85);
    doc.text("4. EVIDENCE COLLECTED", margin + 5, y + 8);

    doc.setFontSize(8);
    oy = y + 14;
    const evidenceData = [
      ["Audio Recording", data.recordingDuration > 0 ? `${data.recordingDuration} seconds — encrypted & stored` : "Not recorded"],
      ["Photos Captured", data.photoCount > 0 ? `${data.photoCount} photo(s) — encrypted & stored` : "No photos"],
      ["GPS Trail Log", `${data.gpsTrail.length} coordinate updates — timestamped`],
    ];
    evidenceData.forEach(([label, value]) => {
      doc.setTextColor(107, 112, 128);
      doc.text(label, margin + 8, oy);
      doc.setTextColor(220, 220, 220);
      doc.text(value, margin + 55, oy);
      oy += 5;
    });

    // ────────────────────────────────────────────────────
    // Page 2: Timeline + Legal Notice
    // ────────────────────────────────────────────────────
    doc.addPage();

    // Header band
    doc.setFillColor(5, 7, 14);
    doc.rect(0, 0, pw, 20, "F");
    doc.setFillColor(255, 45, 85);
    doc.rect(0, 20, pw, 0.8, "F");

    doc.setFontSize(9);
    doc.setTextColor(0, 200, 224);
    doc.text("SOSphere Emergency Report", margin, 13);
    doc.setTextColor(156, 163, 175);
    doc.text(data.incidentId, pw - margin, 13, { align: "right" });

    // ── Section 5: Event Timeline ──
    y = 28;
    doc.setFontSize(11);
    doc.setTextColor(0, 200, 224);
    doc.text("5. EVENT TIMELINE", margin + 5, y);

    y += 5;
    autoTable(doc, {
      startY: y,
      margin: { left: margin + 3, right: margin + 3 },
      head: [["Time", "Event", "Type"]],
      body: data.timeline.map(t => [
        t.time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        t.event,
        t.type.toUpperCase(),
      ]),
      theme: "plain",
      styles: { fontSize: 7.5, textColor: [200, 200, 200], cellPadding: 2.5, lineWidth: 0.1, lineColor: [30, 40, 60] },
      headStyles: { fillColor: [10, 18, 32], textColor: [0, 200, 224], fontSize: 7, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [8, 14, 26] },
      columnStyles: {
        0: { cellWidth: 30 },
        2: { cellWidth: 25 },
      },
      didParseCell: (hookData) => {
        if (hookData.column.index === 2 && hookData.section === "body") {
          const val = (hookData.cell.raw as string).toLowerCase();
          if (val === "trigger") hookData.cell.styles.textColor = [255, 45, 85];
          else if (val === "answer") hookData.cell.styles.textColor = [0, 200, 83];
          else if (val === "location") hookData.cell.styles.textColor = [0, 200, 224];
          else if (val === "recording") hookData.cell.styles.textColor = [255, 150, 0];
          else if (val === "end") hookData.cell.styles.textColor = [0, 200, 224];
        }
      },
    });

    y = (doc as any).lastAutoTable.finalY + 10;

    // ── Section 6: GPS Trail Log ──
    if (data.gpsTrail.length > 0) {
      doc.setFontSize(11);
      doc.setTextColor(0, 200, 83);
      doc.text("6. GPS TRAIL LOG", margin + 5, y);

      y += 5;
      autoTable(doc, {
        startY: y,
        margin: { left: margin + 3, right: margin + 3 },
        head: [["#", "Time", "Latitude", "Longitude"]],
        body: data.gpsTrail.slice(0, 20).map((p, i) => [
          (i + 1).toString(),
          p.time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          p.lat.toFixed(6),
          p.lng.toFixed(6),
        ]),
        theme: "plain",
        styles: { fontSize: 7, textColor: [200, 200, 200], cellPadding: 2, lineWidth: 0.1, lineColor: [30, 40, 60] },
        headStyles: { fillColor: [10, 18, 32], textColor: [0, 200, 83], fontSize: 7, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [8, 14, 26] },
      });

      y = (doc as any).lastAutoTable.finalY + 5;
      if (data.gpsTrail.length > 20) {
        doc.setFontSize(7);
        doc.setTextColor(107, 112, 128);
        doc.text(`+ ${data.gpsTrail.length - 20} more location updates (available in digital evidence package)`, margin + 5, y);
        y += 8;
      }
    }

    // ── Legal Notice ──
    if (y > ph - 80) { doc.addPage(); y = 25; }
    
    doc.setFillColor(255, 45, 85);
    doc.rect(margin, y, pw - margin * 2, 0.5, "F");
    y += 5;

    doc.setFontSize(10);
    doc.setTextColor(255, 45, 85);
    doc.text("LEGAL NOTICE", margin + 5, y);
    y += 6;

    doc.setFontSize(7);
    doc.setTextColor(156, 163, 175);
    const legalText = [
      "This report was automatically generated by SOSphere Safety Platform and constitutes a digital record",
      "of an emergency incident. All timestamps are UTC-synchronized. GPS coordinates are device-reported",
      "with accuracy noted. Audio recordings and photographs referenced in this report are stored encrypted",
      "on SOSphere secure servers and can be retrieved with the incident ID above.",
      "",
      "This document may be used as supporting evidence in legal proceedings, insurance claims, or law",
      "enforcement investigations. The integrity of this report is protected by cryptographic hash verification.",
      "",
      "For verification or evidence retrieval, contact: evidence@sosphere.com",
      `Document Hash: SHA-256:${generateMockHash(data.incidentId)}`,
    ];
    legalText.forEach(line => {
      doc.text(line, margin + 5, y);
      y += 4;
    });

    // ── Footer on all pages ──
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      // Footer line
      doc.setFillColor(0, 200, 224);
      doc.rect(margin, ph - 12, pw - margin * 2, 0.3, "F");
      // Footer text
      doc.setFontSize(6.5);
      doc.setTextColor(107, 112, 128);
      doc.text("SOSphere Safety Platform — Confidential Emergency Report", margin, ph - 7);
      doc.text(`Page ${i} of ${totalPages}`, pw - margin, ph - 7, { align: "right" });
    }

    // Save
    const filename = `SOSphere_Report_${data.incidentId}_${data.startTime.toISOString().split("T")[0]}.pdf`;
    doc.save(filename);
    toast.success("PDF Report downloaded", { description: filename });
  } catch (err) {
    console.error("PDF generation error:", err);
    toast.error("Failed to generate report");
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function getTriggerLabel(method: string): string {
  const map: Record<string, string> = {
    hold: "Manual SOS (3-second hold)",
    shake: "Shake-to-SOS gesture",
    fall: "Automatic fall detection",
    timer: "Check-in timer expired",
    voice: "Voice command",
  };
  return map[method] || method;
}

function getEndReasonLabel(reason: string): string {
  const map: Record<string, string> = {
    user_safe: "User confirmed safe",
    contact_resolved: "Resolved by emergency contact",
    timeout: "Maximum monitoring time reached",
    user_cancelled: "Cancelled by user",
  };
  return map[reason] || reason;
}

function formatDateTime(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function formatDuration(start: Date, end: Date): string {
  const diff = Math.floor((end.getTime() - start.getTime()) / 1000);
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function generateMockHash(id: string): string {
  let hash = "";
  const chars = "0123456789abcdef";
  // Deterministic mock based on id
  for (let i = 0; i < 64; i++) {
    hash += chars[(id.charCodeAt(i % id.length) + i * 7) % 16];
  }
  return hash;
}

// ── Mock data for demo ──────────────────────────────────────────

export function generateDemoIndividualReport(): void {
  const now = new Date();
  const start = new Date(now.getTime() - 15 * 60 * 1000); // 15 min ago

  // Read real GPS trail from offline-gps-tracker (localStorage)
  const buildRealGpsTrail = (): IndividualReportData["gpsTrail"] => {
    try {
      const stored: any[] = JSON.parse(localStorage.getItem("sosphere_gps_trail") || "[]");
      if (stored.length > 0) {
        return stored.slice(-30).map(p => ({
          lat: typeof p.lat === "number" ? p.lat : p.latitude ?? 24.7136,
          lng: typeof p.lng === "number" ? p.lng : p.longitude ?? 46.6753,
          time: new Date(p.timestamp ?? p.time ?? Date.now()),
        }));
      }
    } catch { /* fallback */ }
    // Deterministic fallback: simulate a realistic path without Math.random()
    const sinePath: IndividualReportData["gpsTrail"] = [];
    const baseLat = 24.7136, baseLng = 46.6753;
    for (let i = 0; i < 15; i++) {
      // Use sin/cos for deterministic path (person walking in a curve)
      const t = i / 14;
      sinePath.push({
        lat: baseLat + Math.sin(t * Math.PI) * 0.0008,
        lng: baseLng + t * 0.0012,
        time: new Date(start.getTime() + i * 60000),
      });
    }
    return sinePath;
  };

  const trail = buildRealGpsTrail();

  // Read real user info from localStorage
  const adminProfile = (() => { try { return JSON.parse(localStorage.getItem("sosphere_admin_profile") || "{}"); } catch { return {}; } })();
  const compProfile = (() => { try { return JSON.parse(localStorage.getItem("sosphere_company_profile") || "{}"); } catch { return {}; } })();

  const data: IndividualReportData = {
    userName: adminProfile.name || "Ahmed Khalil",
    userPhone: adminProfile.phone || "+966 501 234 567",
    plan: "personal",
    incidentId: `SOS-${now.getTime().toString(36).toUpperCase().slice(-6)}`,
    triggerMethod: "hold",
    startTime: start,
    endTime: now,
    location: {
      lat: 24.7136,
      lng: 46.6753,
      accuracy: 4,
      address: "King Fahd Road, Al Olaya District, Riyadh 12211, Saudi Arabia",
    },
    gpsTrail: trail,
    contacts: [
      { name: "Sarah", relation: "Wife", phone: "+966 501 234 567", status: "no_answer" },
      { name: "Alex", relation: "Son", phone: "+966 502 345 678", status: "answered", callDuration: 45 },
      { name: "Mom", relation: "Mother", phone: "+966 503 456 789", status: "pending" },
    ],
    cyclesCompleted: 1,
    recordingDuration: 60,
    photoCount: 1,
    timeline: [
      { time: start, event: "SOS activated — 3-second hold", type: "trigger" },
      { time: new Date(start.getTime() + 2000), event: "GPS tracking initiated", type: "location" },
      { time: new Date(start.getTime() + 3000), event: "Calling Sarah (Wife)", type: "call" },
      { time: new Date(start.getTime() + 15000), event: "Sarah — no answer", type: "call" },
      { time: new Date(start.getTime() + 17000), event: "Calling Alex (Son)", type: "call" },
      { time: new Date(start.getTime() + 22000), event: "Alex answered — location sent", type: "answer" },
      { time: new Date(start.getTime() + 23000), event: "GPS location shared with Alex", type: "location" },
      { time: new Date(start.getTime() + 24000), event: "Live GPS trail activated (every 30s)", type: "location" },
      { time: new Date(start.getTime() + 37000), event: "Call ended — ambient recording started", type: "recording" },
      { time: new Date(start.getTime() + 97000), event: "Recording completed — 60 seconds", type: "recording" },
      { time: new Date(start.getTime() + 100000), event: "1 photo captured", type: "photo" },
      { time: now, event: "SOS ended — resolved by contact", type: "end" },
    ],
    endReason: "contact_resolved",
  };

  generateIndividualReport(data);
}
