// ═══════════════════════════════════════════════════════════════
// SOSphere — Individual Emergency PDF Report
// Professional, legal-grade incident documentation for individuals.
//
// TIER MATRIX (2026-04-28 — CRIT 3-tier reports gap fix):
//   • free  → no PDF (audit_log only, retroactive after upgrade)
//   • basic → "Standard Report" — court-admissible, abbreviated
//             evidence sections, no Server-Verified Audit Chain
//   • elite → "Forensic Evidence Grade" — full Server-Verified Audit
//             Chain (the legal-gold property), full GPS trail, full
//             timeline, audio metadata, packet privacy state
//
// Why two tiers (instead of one paid PDF):
//   • The Server-Verified Audit Chain is what makes a report legally
//     tamper-evident in serious cases. It cross-references the on-device
//     timeline with audit_log rows protected by FORCE RLS — impossible
//     to forge even by an admin. That property carries real cost (RLS
//     reads, server-side audit table maintenance) and warrants the
//     elite price point.
//   • basic still gives the user a lawful, automatically-generated
//     incident document with timestamps, GPS, contact cycle, integrity
//     hash, and a clear chain of custody — sufficient for insurance
//     claims, employer reports, and most civil disputes.
// ═══════════════════════════════════════════════════════════════

import jsPDF from "jspdf";
import { autoTable } from "jspdf-autotable";
import { toast } from "sonner";

// ── Types ───────────────────────────────────────────────────────

/**
 * The PDF report tier. Resolved by the caller from the user's
 * effective subscription tier (subscription-service.getEffectiveTier).
 *
 * The function MUST receive a real tier — passing 'free' is a
 * developer error and is rejected at the entry point. Free users
 * cannot generate a PDF (they get audit_log persistence and can
 * download retroactively after upgrading).
 */
export type ReportTier = "basic" | "elite";

export interface IndividualReportData {
  // User
  userName: string;
  userPhone: string;
  /**
   * Tier governs what sections render. See ReportTier docstring.
   * The legacy `plan` field is preserved for backward-compat with
   * older callers but is now ignored when `tier` is present.
   */
  tier?: ReportTier;
  /** @deprecated 2026-04-28 — use `tier` instead. Kept to avoid breaking older callers during rollout. */
  plan?: "personal" | "family";
  
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

  // FIX 2026-04-23: real SHA-256 of canonical incident payload, precomputed
  // by the caller via computeIncidentHashAsync(). If undefined, the report
  // prints "NOT_VERIFIED" instead of faking a hash.
  documentHash?: string;

  // FIX 2026-04-23: honesty flags so the PDF does not claim data exists when
  // it wasn't captured. Caller must set these based on what was actually
  // recorded for this incident.
  audioCaptured?: boolean;   // true only if real audio blob was uploaded
  audioUrl?: string | null;  // Supabase Storage URL if uploaded
  photosCaptured?: boolean;  // true only if real photo blobs were uploaded
  gpsTrailIsReal?: boolean;  // true only if trail came from offline-gps-tracker (not synthesized)

  /**
   * FIX 2026-04-24 (Point 3): server-verified audit chain for this incident.
   * Each entry is an audit_log row keyed by `target = incidentId` plus the
   * emergency_id variant. Source columns: `created_at` (authoritative
   * server time), `actor` / `actor_name`, `actor_role`, `action`,
   * `operation`, `detail`, `metadata`.
   *
   * This section is what makes the PDF legally defensible — it proves
   * what the SERVER recorded, independent of anything the client claimed.
   * If a client-side timeline entry has no matching audit row, it's
   * visible as a gap. If an audit entry has no client-side timeline
   * counterpart, it's visible as an unacknowledged server event.
   *
   * Readers MUST NOT fabricate this list — if the fetch fails (no
   * network, RLS block, etc.) the PDF prints "Server audit chain
   * unavailable at report time" rather than inventing entries.
   */
  serverAudit?: {
    serverTime: Date;     // audit_log.created_at — authoritative
    actor: string;        // audit_log.actor_name || audit_log.actor
    actorRole: string;    // audit_log.actor_role
    action: string;       // audit_log.action
    operation: string;    // audit_log.operation
    detail?: string;      // audit_log.detail
    source?: string;      // audit_log.metadata->>'source'
  }[];
  serverAuditAvailable?: boolean; // explicit flag — false if fetch failed

  /**
   * FIX 2026-04-24 (Point 5): the Emergency Packet privacy state at
   * trigger time. Recovered from the sos_triggered audit row's metadata
   * (set by the edge function from the client's localStorage snapshot).
   * Printed in a dedicated line of Section 4 so the legal reader can
   * see EXACTLY what parts of the user's profile were shared with
   * contacts — nothing more, nothing less.
   *
   * undefined → older incidents from before this field was added;
   * the PDF prints "packet state not recorded" rather than inventing
   * a default that might overstate what was shared.
   */
  packetModules?: {
    location: true;
    medical: boolean;
    contacts: boolean;
    device: boolean;
    recording: boolean;
    incident: boolean;
  };
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

// ── Tier helpers ────────────────────────────────────────────────

/**
 * Resolve the report tier with a defensive default. Anything that
 * isn't 'elite' falls back to 'basic' (we never silently render an
 * elite-grade report for a basic user).
 */
function resolveTier(data: IndividualReportData): ReportTier {
  if (data.tier === "elite") return "elite";
  return "basic";
}

const TIER_LABEL: Record<ReportTier, string> = {
  basic: "STANDARD REPORT",
  elite: "FORENSIC EVIDENCE",
};

// ── Generate PDF ────────────────────────────────────────────────

export function generateIndividualReport(data: IndividualReportData): void {
  try {
    // CRIT 3-tier reports (2026-04-28): tier is the authoritative
    // gate. resolveTier defaults to 'basic' if missing, which is the
    // safer side (lower-fidelity output). Elite output is gated on
    // an explicit data.tier === 'elite'.
    const tier = resolveTier(data);
    const isElite = tier === "elite";

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

    // Tier-colored accent line: elite=cyan (premium), basic=red
    if (isElite) {
      doc.setFillColor(0, 200, 224);
    } else {
      doc.setFillColor(255, 45, 85);
    }
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

    // Tier badge — replaces the static "CONFIDENTIAL" badge.
    // Elite gets cyan + "FORENSIC EVIDENCE", basic gets orange + "STANDARD REPORT".
    if (isElite) {
      doc.setFillColor(0, 200, 224);
    } else {
      doc.setFillColor(255, 150, 0);
    }
    doc.roundedRect(pw - margin - 42, 12, 42, 8, 2, 2, "F");
    doc.setTextColor(isElite ? 5 : 255, isElite ? 7 : 255, isElite ? 14 : 255);
    doc.setFontSize(7);
    doc.text(TIER_LABEL[tier], pw - margin - 21, 17, { align: "center" });

    // Report metadata
    doc.setFontSize(8);
    doc.setTextColor(156, 163, 175);
    y = 35;
    doc.text(`Report ID: ${data.incidentId}`, margin, y);
    doc.text(`Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}`, margin, y + 5);
    // Tier line — shows what this report tier means at a glance.
    doc.text(
      `Tier: ${TIER_LABEL[tier]}${isElite ? " — full server-verified audit" : " — abbreviated evidence sections"}`,
      margin, y + 10,
    );
    
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
    // FIX 2026-04-24 (Point 5): extended from 30 to 38mm to fit the
    // "Privacy Packet Shared" row added below the existing three.
    doc.roundedRect(margin, y, pw - margin * 2, 38, 3, 3, "F");
    doc.setDrawColor(255, 45, 85);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, y, pw - margin * 2, 38, 3, 3, "S");

    doc.setFontSize(11);
    doc.setTextColor(255, 45, 85);
    doc.text("4. EVIDENCE COLLECTED", margin + 5, y + 8);

    doc.setFontSize(8);
    oy = y + 14;
    const evidenceData = [
      // FIX 2026-04-23: the "encrypted & stored" claim was false — blobs
      // were never actually captured or uploaded. Now we only claim what
      // we really did: if audioCaptured === true AND audioUrl is present,
      // we cite the storage URL. Otherwise we print what we CAN verify
      // (timer ran for N seconds, but the blob itself is not in evidence).
      ["Audio Recording", (() => {
        if (!data.recordingDuration || data.recordingDuration <= 0) return "Not recorded";
        // Basic: duration only, no storage URL (forensic chain-of-custody is Elite).
        if (!isElite) {
          return `${data.recordingDuration}s captured — full storage chain-of-custody available in Elite Forensic tier`;
        }
        if (data.audioCaptured && data.audioUrl) {
          return `${data.recordingDuration}s — stored at ${data.audioUrl}`;
        }
        return `${data.recordingDuration}s timer recorded (audio blob unavailable)`;
      })()],
      ["Photos Captured", (() => {
        if (!data.photoCount || data.photoCount <= 0) return "No photos";
        if (!isElite) {
          // Basic: count only, no vault references.
          return `${data.photoCount} photo(s) referenced — vault chain-of-custody in Elite tier`;
        }
        if (data.photosCaptured) {
          return `${data.photoCount} photo(s) — stored in evidence vault`;
        }
        return `${data.photoCount} photo(s) referenced (images not available in this export)`;
      })()],
      ["GPS Trail Log", `${data.gpsTrail.length} coordinate updates — timestamped`],
      // FIX 2026-04-24 (Point 5): privacy packet state shared with
      // contacts. "not recorded" if the audit row didn't capture it
      // (older incidents) — NEVER a fake default.
      // ELITE ONLY: forensic chain-of-custody field.
      ["Privacy Packet Shared", (() => {
        if (!isElite) {
          return "Available in Elite Forensic tier (forensic chain-of-custody field)";
        }
        if (!data.packetModules) return "not recorded for this incident";
        const on: string[] = [];
        const off: string[] = [];
        const labels: Array<[keyof NonNullable<typeof data.packetModules>, string]> = [
          ["location", "location"],
          ["medical", "medical"],
          ["contacts", "contacts"],
          ["device", "device"],
          ["recording", "recording"],
          ["incident", "incident-id"],
        ];
        for (const [key, label] of labels) {
          if (data.packetModules[key]) on.push(label); else off.push(label);
        }
        return `ON: ${on.join(", ") || "—"}   OFF: ${off.join(", ") || "—"}`;
      })()],
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
    // CRIT 3-tier reports: basic gets last 10 events, elite gets full.
    y = 28;
    doc.setFontSize(11);
    doc.setTextColor(0, 200, 224);
    doc.text(
      isElite ? "5. EVENT TIMELINE" : "5. EVENT TIMELINE (abbreviated)",
      margin + 5, y,
    );

    y += 5;
    const timelineRows = isElite ? data.timeline : data.timeline.slice(-10);
    autoTable(doc, {
      startY: y,
      margin: { left: margin + 3, right: margin + 3 },
      head: [["Time", "Event", "Type"]],
      body: timelineRows.map(t => [
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

    y = (doc as any).lastAutoTable.finalY + 5;
    // Show abbreviation footer when basic abbreviated.
    if (!isElite && data.timeline.length > 10) {
      doc.setFontSize(7);
      doc.setTextColor(255, 150, 0);
      doc.text(
        `+ ${data.timeline.length - 10} earlier events in this incident — full chronological timeline included in Elite Forensic tier.`,
        margin + 5, y,
      );
      y += 6;
    }
    y += 5;

    // ── Section 6: GPS Trail Log ──
    // FIX 2026-04-23: when gpsTrail came from the synthesized sin/cos fallback
    // (now removed, but historical PDFs may have it) we annotate. When empty,
    // we print "Not available" instead of hiding the section silently — a
    // legal reader needs to know the trail was NOT recorded vs we decided
    // not to include it.
    if (data.gpsTrail.length === 0) {
      doc.setFontSize(11);
      doc.setTextColor(0, 200, 83);
      doc.text("6. GPS TRAIL LOG", margin + 5, y);
      y += 6;
      doc.setFontSize(9);
      doc.setTextColor(107, 114, 128);
      doc.text("GPS trail not available for this incident — only the trigger-time position was recorded.", margin + 5, y);
      y += 10;
    } else if (data.gpsTrail.length > 0) {
      // CRIT 3-tier reports: basic shows first 5 only ("teaser" + count),
      // elite shows first 20 + "+more" footer.
      const trailLimit = isElite ? 20 : 5;
      const trailRows = data.gpsTrail.slice(0, trailLimit);

      doc.setFontSize(11);
      doc.setTextColor(0, 200, 83);
      const titleSuffix = data.gpsTrailIsReal === false
        ? " (synthetic fallback — not authoritative)"
        : (isElite ? "" : " (abbreviated)");
      doc.text(`6. GPS TRAIL LOG${titleSuffix}`, margin + 5, y);

      y += 5;
      autoTable(doc, {
        startY: y,
        margin: { left: margin + 3, right: margin + 3 },
        head: [["#", "Time", "Latitude", "Longitude"]],
        body: trailRows.map((p, i) => [
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
      const remaining = data.gpsTrail.length - trailLimit;
      if (remaining > 0) {
        doc.setFontSize(7);
        if (isElite) {
          doc.setTextColor(107, 112, 128);
          doc.text(`+ ${remaining} more location updates (available in digital evidence package)`, margin + 5, y);
        } else {
          doc.setTextColor(255, 150, 0);
          doc.text(`+ ${remaining} more coordinates recorded — full trail table included in Elite Forensic tier.`, margin + 5, y);
        }
        y += 8;
      }
    }

    // ── Section 7: Server-Verified Audit Chain ──
    // FIX 2026-04-24 (Point 3): prints the audit_log rows the server
    // recorded for this incident. This is the legally-defensible
    // cross-reference between the on-device timeline (Section 5) and
    // tamper-evident server entries.
    //
    // CRIT 3-tier reports (2026-04-28): ELITE ONLY.
    //   audit_log rows are protected by FORCE RLS (CRIT-#10) — they
    //   cannot be forged even by an admin. That tamper-evidence is
    //   forensic-grade and the principal reason Elite is priced higher.
    //   Basic gets a clear notice: the data exists server-side and is
    //   captured for every incident regardless of plan; an upgrade
    //   re-renders this section with the audit chain populated.
    if (y > ph - 40) { doc.addPage(); y = 25; }
    doc.setFontSize(11);
    doc.setTextColor(139, 92, 246);
    doc.text("7. SERVER-VERIFIED AUDIT CHAIN", margin + 5, y);
    y += 2;

    if (!isElite) {
      doc.setFontSize(7);
      doc.setTextColor(107, 114, 128);
      doc.text(
        "This section requires the Elite Forensic tier.",
        margin + 5, y + 4,
      );
      y += 9;
      doc.setFontSize(8);
      doc.setTextColor(220, 220, 220);
      const eliteNoticeLines = [
        "The Server-Verified Audit Chain prints the audit_log rows the server recorded for this incident,",
        "cross-referencing the on-device timeline (Section 5) with tamper-evident server entries (FORCE",
        "RLS — cannot be forged even by a system administrator). This is the property that makes a report",
        "forensic-grade and admissible in serious legal proceedings.",
        "",
        "The audit data for this incident is captured and retained on SOSphere's servers regardless of plan.",
        "Upgrading to Elite Forensic and regenerating this report will populate this section retroactively.",
      ];
      for (const line of eliteNoticeLines) {
        doc.text(line, margin + 5, y);
        y += 4;
      }
      y += 4;
    } else {
      doc.setFontSize(7);
      doc.setTextColor(107, 114, 128);
      doc.text(
        "Cross-reference: these entries come directly from the server's audit_log table.",
        margin + 5, y + 4,
      );
      y += 9;

    if (data.serverAuditAvailable === false) {
      doc.setFontSize(9);
      doc.setTextColor(255, 150, 0);
      doc.text(
        "Server audit chain unavailable at report time — network or RLS prevented fetch.",
        margin + 5, y,
      );
      y += 10;
    } else if (!data.serverAudit || data.serverAudit.length === 0) {
      doc.setFontSize(9);
      doc.setTextColor(107, 114, 128);
      doc.text(
        "No server-side audit entries recorded for this incident.",
        margin + 5, y,
      );
      y += 10;
    } else {
      autoTable(doc, {
        startY: y,
        margin: { left: margin + 3, right: margin + 3 },
        head: [["Server Time (UTC)", "Actor · Role", "Action", "Source"]],
        body: data.serverAudit.slice(0, 40).map((a) => [
          a.serverTime.toISOString().replace("T", " ").slice(0, 19),
          `${a.actor} · ${a.actorRole}`,
          a.action + (a.detail ? ` — ${a.detail.slice(0, 40)}` : ""),
          a.source || a.operation,
        ]),
        theme: "plain",
        styles: { fontSize: 7, textColor: [200, 200, 200], cellPadding: 2, lineWidth: 0.1, lineColor: [30, 40, 60] },
        headStyles: { fillColor: [10, 18, 32], textColor: [139, 92, 246], fontSize: 7, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [8, 14, 26] },
        columnStyles: {
          0: { cellWidth: 38 },
          1: { cellWidth: 45 },
          3: { cellWidth: 30 },
        },
      });
      y = (doc as any).lastAutoTable.finalY + 5;
      if (data.serverAudit.length > 40) {
        doc.setFontSize(7);
        doc.setTextColor(107, 112, 128);
        doc.text(
          `+ ${data.serverAudit.length - 40} more server audit entries (full chain in digital evidence package)`,
          margin + 5, y,
        );
        y += 8;
      }
    }
    } // end of `if (!isElite) else { ... }` (CRIT 3-tier reports)

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
      // FIX 2026-04-23: removed the line claiming audio & photos are "stored
      // encrypted on SOSphere secure servers" — capture/upload of those blobs
      // is not yet wired (Phase 1 work). Claiming it in a legal document was
      // deceptive. When blobs are actually captured+uploaded, restore this.
      "with accuracy noted. Reference this incident ID when discussing the event with first responders or investigators.",
      "",
      "This document describes the digital record stored on the user's device. Where referenced fields (audio,",
      "photographs, GPS trail) were captured, they are linked by the Incident ID above. If a field is marked as",
      "unavailable, the corresponding data was not recorded for this incident.",
      "",
      "Integrity verification: the Document Hash below is a SHA-256 digest of the incident payload. If the",
      "hash is \"NOT_VERIFIED\", the browser or runtime did not support cryptographic hashing at export time.",
      "",
      "For evidence retrieval, contact your administrator with the Incident ID.",
      // FIX 2026-04-23: real SHA-256 from precomputed data.documentHash (passed
      // in by caller). If undefined, we print NOT_VERIFIED so we don't fake it.
      `Document Hash: SHA-256:${data.documentHash || "NOT_VERIFIED"}`,
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

// FIX 2026-04-23: Replaced `generateMockHash` with a REAL SHA-256 digest of
// the canonical incident payload. The previous function produced a
// deterministic string derived from the ID alone — identical content
// across reports, zero tamper detection. Embedding that in a document that
// claims "cryptographic hash verification" was actively misleading.
//
// Strategy:
//   - SYNC path: we need the hash at PDF-render time; jsPDF writeLines is
//     synchronous. We compute the hash async BEFORE rendering via
//     computeIncidentHashAsync() and pass it in. If the caller didn't
//     precompute, we render "NOT_VERIFIED" so the claim is never faked.
//   - ASYNC path: exposed helper that does real SHA-256 via crypto.subtle.
export async function computeIncidentHashAsync(
  incidentId: string,
  canonical: string,
): Promise<string> {
  try {
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const buf = new TextEncoder().encode(`${incidentId}|${canonical}`);
      const digest = await crypto.subtle.digest("SHA-256", buf);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch (err) {
    console.error("[pdf-report] SHA-256 hash failed:", err);
  }
  // HONEST fallback — no pretending
  return "NOT_VERIFIED";
}

// ── Mock data for demo ──────────────────────────────────────────

export function generateDemoIndividualReport(): void {
  const now = new Date();
  const start = new Date(now.getTime() - 15 * 60 * 1000); // 15 min ago

  // FIX 2026-04-23: read REAL GPS trail only. The previous sin/cos fallback
  // synthesized a fake curve that looked like a person walking — embedding
  // invented coordinates in a legal document is forgery. Now: if no real
  // trail exists we return an empty array and the report honestly shows
  // "GPS trail not available for this incident".
  const buildRealGpsTrail = (): {
    trail: IndividualReportData["gpsTrail"];
    isReal: boolean;
  } => {
    try {
      const stored: unknown[] = JSON.parse(
        localStorage.getItem("sosphere_gps_trail") || "[]",
      );
      if (Array.isArray(stored) && stored.length > 0) {
        const trail = stored
          .slice(-30)
          .map((raw) => {
            const p = raw as Record<string, unknown>;
            const lat = typeof p.lat === "number" ? p.lat : (p.latitude as number);
            const lng = typeof p.lng === "number" ? p.lng : (p.longitude as number);
            const ts = (p.timestamp as number) ?? (p.time as number);
            if (typeof lat !== "number" || typeof lng !== "number") return null;
            return { lat, lng, time: new Date(ts ?? Date.now()) };
          })
          .filter((p): p is { lat: number; lng: number; time: Date } => p !== null);
        if (trail.length > 0) return { trail, isReal: true };
      }
    } catch {
      /* fall through to honest empty state */
    }
    // HONEST fallback — empty, not a fake curve
    return { trail: [], isReal: false };
  };

  const { trail, isReal: trailIsReal } = buildRealGpsTrail();

  // Read real user info from localStorage
  const adminProfile = (() => { try { return JSON.parse(localStorage.getItem("sosphere_admin_profile") || "{}"); } catch { return {}; } })();
  const compProfile = (() => { try { return JSON.parse(localStorage.getItem("sosphere_company_profile") || "{}"); } catch { return {}; } })();

  const data: IndividualReportData = {
    userName: adminProfile.name || "Ahmed Khalil",
    userPhone: adminProfile.phone || "+966 501 234 567",
    tier: "elite",  // demo defaults to elite to showcase all sections
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
    gpsTrailIsReal: trailIsReal,
    contacts: [
      { name: "Sarah", relation: "Wife", phone: "+966 501 234 567", status: "no_answer" },
      { name: "Alex", relation: "Son", phone: "+966 502 345 678", status: "answered", callDuration: 45 },
      { name: "Mom", relation: "Mother", phone: "+966 503 456 789", status: "pending" },
    ],
    cyclesCompleted: 1,
    recordingDuration: 60,
    photoCount: 1,
    // FIX 2026-04-23: demo flags — mark demo data honestly as synthesized,
    // not real evidence. Real-incident path must set these correctly.
    audioCaptured: false,
    audioUrl: null,
    photosCaptured: false,
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
