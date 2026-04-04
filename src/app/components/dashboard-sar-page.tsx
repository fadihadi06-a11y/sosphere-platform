// ═══════════════════════════════════════════════════════════════
// SOSphere — SAR Protocol Dashboard Page
// ─────────────────────────────────────────────────────────────
// Search & Rescue command interface. When a worker goes missing
// and isn't at their last GPS point, this page shows:
//
//   1. Search Cone Map — predicted location area
//   2. GPS Trail — full breadcrumb history
//   3. Escalation Timeline — step-by-step protocol
//   4. Nearby Workers — who can help
//   5. Hazard Zones — dangers in the search area
//   6. Search Teams — dispatch & coordination
//   7. Mission Log — real-time event feed
//
// Designed for: Zone Admin / Command Center / Main Admin
// ═══════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Radar, MapPin, AlertTriangle, Clock, Users, Phone,
  Radio, Shield, Navigation, Target, Crosshair,
  ChevronRight, ChevronDown, Circle, Siren, Activity,
  Eye, Send, Volume2, Search, RefreshCw, Download,
  UserCheck, HeartPulse, Wifi, WifiOff, Zap,
  TriangleAlert, Map as MapIcon, Route, Layers,
  Play, Pause, SkipForward, X, Check, AlertCircle,
  Compass, Gauge, Signal, Timer, ArrowUpRight,
  ShieldAlert, CircleDot, Footprints, Car, Anchor,
  HardHat, ChevronUp, MessageSquare, Bell,
} from "lucide-react";
// react-leaflet removed — using Leaflet directly to avoid Context issues in Figma Make
import L from "leaflet";
import jsPDF from "jspdf";
import { autoTable } from "jspdf-autotable";
import { toast } from "sonner";
import { emitAdminSignal } from "./shared-store";
import {
  type SARMission, type WorkerType, type TerrainType, type SARPhase,
  type SearchCone, type EscalationStep, type NearbyWorker, type HazardZone,
  type GPSBreadcrumb, type MissionLogEntry,
  createSARMission, getConePolygon, getZonePolygon,
  formatDistance, formatElapsed, getPhaseLabel, getPhaseColor,
  saveSARMission, getActiveSARMissions, getAllSARMissions,
  recommendSearchPattern, calculateSearchCone, analyzeTrail,
} from "./sar-engine";
import {
  Card as DSCard, TOKENS, TYPOGRAPHY, PageHeader,
} from "./design-system";

// ── Scenario Presets for Demo ──────────────────────────────────

interface SARScenario {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  workerType: WorkerType;
  zone: string;
  terrain: TerrainType;
  elapsedMin: number;
}

const SAR_SCENARIOS: SARScenario[] = [
  {
    id: "S1", title: "Mine Worker — Underground",
    description: "Khalid Omar lost signal 35 minutes ago in Mine Shaft B-7. Last check-in was normal. Rescue team sent to last GPS — not found.",
    icon: HardHat,
    employeeId: "EMP-003", employeeName: "Khalid Omar", employeeRole: "Operator",
    workerType: "underground", zone: "Zone D - Warehouse", terrain: "underground", elapsedMin: 35,
  },
  {
    id: "S2", title: "Driver — Desert Route",
    description: "Faisal Qasim delivering to remote site. GPS stopped 28 minutes ago on Desert Highway 15. Vehicle tracking offline.",
    icon: Car,
    employeeId: "EMP-017", employeeName: "Faisal Qasim", employeeRole: "Driver",
    workerType: "driver", zone: "Route DH-15", terrain: "desert", elapsedMin: 28,
  },
  {
    id: "S3", title: "Solo Inspector — Remote Site",
    description: "Ali Mansour sent alone to inspect Tower 7-Alpha. No check-in for 22 minutes. Area has poor coverage.",
    icon: Footprints,
    employeeId: "EMP-013", employeeName: "Ali Mansour", employeeRole: "Welder",
    workerType: "solo_remote", zone: "Tower 7-Alpha", terrain: "industrial", elapsedMin: 22,
  },
  {
    id: "S4", title: "Field Worker — Mountain Area",
    description: "Hassan Jaber conducting survey in mountainous terrain. Signal lost 45 minutes ago. Weather deteriorating.",
    icon: Compass,
    employeeId: "EMP-011", employeeName: "Hassan Jaber", employeeRole: "Crane Operator",
    workerType: "walker", zone: "Survey Grid M-12", terrain: "mountain", elapsedMin: 45,
  },
];

// ── Leaflet Fix ────────────────────────────────────────────────

const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const sosIcon = L.divIcon({
  className: "",
  html: `<div style="width:20px;height:20px;border-radius:50%;background:#FF2D55;border:3px solid white;box-shadow:0 0 12px rgba(255,45,85,0.8);animation:pulse 1.5s infinite"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const workerIcon = L.divIcon({
  className: "",
  html: `<div style="width:14px;height:14px;border-radius:50%;background:#00C8E0;border:2px solid white;box-shadow:0 0 8px rgba(0,200,224,0.6)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const hazardIcon = L.divIcon({
  className: "",
  html: `<div style="width:16px;height:16px;border-radius:50%;background:#FF9500;border:2px solid white;box-shadow:0 0 8px rgba(255,149,0,0.6)"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

// MapFitter removed — map fitting is done imperatively in DirectLeafletMap

// ── Pulsing CSS ────────────────────────────────────────────────

const pulseCSS = `
@keyframes sarPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.05); }
}
@keyframes sarRing {
  0% { transform: scale(1); opacity: 0.6; }
  100% { transform: scale(2.5); opacity: 0; }
}
@keyframes conePulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.15; }
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 12px rgba(255,45,85,0.8); }
  50% { opacity: 0.6; box-shadow: 0 0 24px rgba(255,45,85,1); }
}
`;

// ── SAR PDF Report Export ──────────────────────────────────────

async function exportSARReportPDF(mission: SARMission, totalElapsed: number) {
  toast.loading("Generating SAR Report PDF...", { id: "sar-pdf" });

  try {
    const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    let y = 15;

    // Header — Red stripe
    doc.setFillColor(255, 45, 85);
    doc.rect(0, 0, pw, 28, "F");
    doc.setFillColor(180, 20, 40);
    doc.rect(0, 25, pw, 3, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.text("SAR MISSION REPORT", 14, 12);
    doc.setFontSize(9);
    doc.text(`CONFIDENTIAL — ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, 14, 19);
    doc.text(`Mission ID: ${mission.id}`, pw - 14, 12, { align: "right" });
    doc.text(`Status: ${mission.status.replace(/_/g, " ").toUpperCase()}`, pw - 14, 19, { align: "right" });

    y = 35;

    // SOSphere branding
    doc.setTextColor(0, 200, 224);
    doc.setFontSize(8);
    doc.text("Generated by SOSphere Safety Intelligence Platform", 14, y);
    y += 8;

    // Missing Worker Info
    doc.setTextColor(40, 40, 40);
    doc.setFillColor(255, 240, 240);
    doc.roundedRect(14, y, pw - 28, 30, 3, 3, "F");
    doc.setFontSize(7);
    doc.setTextColor(200, 50, 50);
    doc.text("MISSING WORKER", 18, y + 6);
    doc.setTextColor(40, 40, 40);
    doc.setFontSize(14);
    doc.text(mission.employeeName, 18, y + 14);
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(`${mission.employeeRole} • ${mission.zone} • ${mission.terrain} terrain`, 18, y + 21);
    doc.text(`Worker Type: ${mission.workerType.replace(/_/g, " ")}`, 18, y + 27);
    y += 36;

    // Critical Timeline
    doc.setFontSize(11);
    doc.setTextColor(255, 45, 85);
    doc.text("CRITICAL TIMELINE", 14, y);
    y += 6;

    const timeData = [
      ["Signal Lost", new Date(mission.connectionLostAt).toLocaleString()],
      ["Elapsed Since Loss", formatElapsed(totalElapsed)],
      ["Current SAR Phase", getPhaseLabel(mission.currentPhase).toUpperCase()],
      ["Report Generated", new Date().toLocaleString()],
    ];

    autoTable(doc, {
      startY: y,
      head: [["Metric", "Value"]],
      body: timeData,
      theme: "striped",
      headStyles: { fillColor: [255, 45, 85], textColor: [255, 255, 255], fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 8, textColor: [50, 50, 50] },
      margin: { left: 14, right: 14 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 50 } },
    });
    y = (doc as any).lastAutoTable.finalY + 8;

    // Search Cone Analysis
    doc.setFontSize(11);
    doc.setTextColor(255, 149, 0);
    doc.text("SEARCH CONE ANALYSIS", 14, y);
    y += 6;

    const cone = mission.searchCone;
    const coneData = [
      ["Origin (Last GPS)", `${cone.originLat.toFixed(6)}, ${cone.originLng.toFixed(6)}`],
      ["Search Radius", formatDistance(cone.maxRadius)],
      ["Heading", cone.isCircular ? "360° (circular — no heading)" : `${Math.round(cone.heading)}° ± ${Math.round(cone.spreadAngle)}°`],
      ["Confidence", `${cone.confidence}%`],
      ["Max Speed Estimate", `${cone.maxSpeed.toFixed(1)} m/s`],
      ["Probability Zones", cone.probabilityZones.map(z => `${z.level}: ${z.probability}% (${formatDistance(z.radiusMin)}-${formatDistance(z.radiusMax)})`).join("; ")],
    ];

    autoTable(doc, {
      startY: y,
      head: [["Parameter", "Value"]],
      body: coneData,
      theme: "striped",
      headStyles: { fillColor: [255, 149, 0], textColor: [255, 255, 255], fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 8, textColor: [50, 50, 50] },
      margin: { left: 14, right: 14 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 50 } },
    });
    y = (doc as any).lastAutoTable.finalY + 8;

    // Draw Search Cone Diagram
    if (y + 60 > ph) { doc.addPage(); y = 15; }
    doc.setFontSize(11);
    doc.setTextColor(255, 45, 85);
    doc.text("SEARCH CONE DIAGRAM", 14, y);
    y += 6;

    const cx = pw / 2;
    const cy = y + 30;
    const r = 25;

    // Low probability (outer)
    doc.setDrawColor(255, 214, 10);
    doc.setFillColor(255, 250, 220);
    doc.circle(cx, cy, r, "FD");
    // Medium
    doc.setDrawColor(255, 149, 0);
    doc.setFillColor(255, 235, 210);
    doc.circle(cx, cy, r * 0.65, "FD");
    // High (center)
    doc.setDrawColor(255, 45, 85);
    doc.setFillColor(255, 220, 225);
    doc.circle(cx, cy, r * 0.35, "FD");
    // Center dot
    doc.setFillColor(255, 45, 85);
    doc.circle(cx, cy, 1.5, "F");

    // Labels
    doc.setFontSize(6);
    doc.setTextColor(255, 45, 85);
    doc.text("HIGH", cx - 3, cy + 2);
    doc.setTextColor(255, 149, 0);
    doc.text("MEDIUM", cx + r * 0.4, cy - r * 0.3);
    doc.setTextColor(180, 150, 0);
    doc.text("LOW", cx + r * 0.7, cy - r * 0.6);

    // Direction arrow if not circular
    if (!cone.isCircular) {
      const headingRad = (cone.heading - 90) * Math.PI / 180;
      const ax = cx + Math.cos(headingRad) * (r + 5);
      const ay = cy + Math.sin(headingRad) * (r + 5);
      doc.setDrawColor(0, 200, 224);
      doc.setLineWidth(0.8);
      doc.line(cx, cy, ax, ay);
      doc.setFontSize(6);
      doc.setTextColor(0, 150, 180);
      doc.text(`${Math.round(cone.heading)}°`, ax + 2, ay);
    }

    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text(`Radius: ${formatDistance(cone.maxRadius)} | Confidence: ${cone.confidence}%`, cx, cy + r + 8, { align: "center" });
    y = cy + r + 14;

    // Trail Analysis
    if (y + 40 > ph) { doc.addPage(); y = 15; }
    doc.setFontSize(11);
    doc.setTextColor(0, 200, 224);
    doc.text("TRAIL ANALYSIS", 14, y);
    y += 6;

    const trail = mission.trailAnalysis;
    autoTable(doc, {
      startY: y,
      head: [["Metric", "Value"]],
      body: [
        ["Total GPS Points", `${trail.totalPoints}`],
        ["Trail Distance", formatDistance(trail.totalDistance)],
        ["Average Speed", `${trail.averageSpeed.toFixed(1)} m/s`],
        ["Last Speed", `${trail.lastSpeed.toFixed(1)} m/s`],
        ["Last Heading", `${Math.round(trail.lastHeading)}°`],
        ["Movement Pattern", trail.movementPattern],
        ["Stops Detected", `${trail.stopsDetected.length}`],
        ["Dead Reckoning Points", `${trail.deadReckoningPoints}`],
        ["GPS Quality", trail.gpsQuality],
      ],
      theme: "striped",
      headStyles: { fillColor: [0, 200, 224], textColor: [255, 255, 255], fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 8, textColor: [50, 50, 50] },
      margin: { left: 14, right: 14 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 50 } },
    });
    y = (doc as any).lastAutoTable.finalY + 8;

    // Nearby Workers
    if (y + 20 > ph) { doc.addPage(); y = 15; }
    doc.setFontSize(11);
    doc.setTextColor(0, 200, 83);
    doc.text("NEARBY WORKERS WHO CAN ASSIST", 14, y);
    y += 6;

    if (mission.nearbyWorkers.length > 0) {
      autoTable(doc, {
        startY: y,
        head: [["Name", "Role", "Distance", "ETA", "Phone", "Can Assist"]],
        body: mission.nearbyWorkers.map(w => [
          w.name, w.role, formatDistance(w.distanceMeters),
          `${w.estimatedArrivalMin || "?"} min`, w.phone, w.canAssist ? "Yes" : "No",
        ]),
        theme: "striped",
        headStyles: { fillColor: [0, 200, 83], textColor: [255, 255, 255], fontSize: 7, fontStyle: "bold" },
        bodyStyles: { fontSize: 7, textColor: [50, 50, 50] },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    }

    // Hazard Zones
    if (y + 20 > ph) { doc.addPage(); y = 15; }
    doc.setFontSize(11);
    doc.setTextColor(255, 149, 0);
    doc.text("HAZARD ZONES IN SEARCH AREA", 14, y);
    y += 6;

    if (mission.hazardZones.length > 0) {
      autoTable(doc, {
        startY: y,
        head: [["Hazard", "Type", "Severity", "Radius", "Overlap %"]],
        body: mission.hazardZones.map(h => [
          h.name, h.type.replace(/_/g, " "), h.severity,
          `${h.radiusMeters}m`, `${h.overlapPercent}%`,
        ]),
        theme: "striped",
        headStyles: { fillColor: [255, 149, 0], textColor: [255, 255, 255], fontSize: 7, fontStyle: "bold" },
        bodyStyles: { fontSize: 7, textColor: [50, 50, 50] },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    }

    // Escalation Protocol
    if (y + 20 > ph) { doc.addPage(); y = 15; }
    doc.setFontSize(11);
    doc.setTextColor(130, 80, 220);
    doc.text("ESCALATION PROTOCOL STATUS", 14, y);
    y += 6;

    autoTable(doc, {
      startY: y,
      head: [["Phase", "Trigger", "Status", "Actions"]],
      body: mission.escalation.map(step => [
        step.title,
        `+${step.triggerMinutes} min`,
        step.isComplete ? "Complete" : step.isActive ? "ACTIVE" : "Pending",
        step.actions.map(a => `${a.label} (${a.status})`).join(", "),
      ]),
      theme: "striped",
      headStyles: { fillColor: [130, 80, 220], textColor: [255, 255, 255], fontSize: 7, fontStyle: "bold" },
      bodyStyles: { fontSize: 6.5, textColor: [50, 50, 50] },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 8;

    // Search Teams
    if (mission.searchTeams.length > 0) {
      if (y + 20 > ph) { doc.addPage(); y = 15; }
      doc.setFontSize(11);
      doc.setTextColor(0, 200, 224);
      doc.text("SEARCH TEAMS DEPLOYED", 14, y);
      y += 6;

      autoTable(doc, {
        startY: y,
        head: [["Team", "Members", "Zone", "Pattern", "Status"]],
        body: mission.searchTeams.map(st => [
          st.name, st.members.join(", "), st.assignedZone,
          st.pattern.replace(/_/g, " "), st.status,
        ]),
        theme: "striped",
        headStyles: { fillColor: [0, 200, 224], textColor: [255, 255, 255], fontSize: 7, fontStyle: "bold" },
        bodyStyles: { fontSize: 7, textColor: [50, 50, 50] },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    }

    // Mission Log
    if (mission.log.length > 0) {
      if (y + 20 > ph) { doc.addPage(); y = 15; }
      doc.setFontSize(11);
      doc.setTextColor(80, 80, 80);
      doc.text("MISSION LOG", 14, y);
      y += 6;

      autoTable(doc, {
        startY: y,
        head: [["Time", "Type", "Severity", "Message"]],
        body: [...mission.log].sort((a, b) => a.timestamp - b.timestamp).map(entry => [
          new Date(entry.timestamp).toLocaleTimeString(),
          entry.type, entry.severity, entry.message,
        ]),
        theme: "striped",
        headStyles: { fillColor: [80, 80, 80], textColor: [255, 255, 255], fontSize: 7, fontStyle: "bold" },
        bodyStyles: { fontSize: 6.5, textColor: [50, 50, 50] },
        margin: { left: 14, right: 14 },
        columnStyles: { 3: { cellWidth: 80 } },
      });
    }

    // Footer on all pages
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(40);
      doc.setTextColor(240, 240, 240);
      doc.text("CONFIDENTIAL", pw / 2, ph / 2, { align: "center", angle: 45 });
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text(`SOSphere SAR Report — ${mission.employeeName} — Mission ${mission.id}`, 14, ph - 8);
      doc.text(`Page ${i}/${pageCount}`, pw - 14, ph - 8, { align: "right" });
      doc.setDrawColor(200, 200, 200);
      doc.line(14, ph - 12, pw - 14, ph - 12);
    }

    doc.save(`SAR-Report-${mission.id}-${mission.employeeName.replace(/\s/g, "_")}.pdf`);
    toast.success("SAR Report exported!", { id: "sar-pdf", description: "PDF includes search cone diagram, trail analysis, escalation timeline, and all mission data." });
  } catch (err) {
    console.error("PDF Error:", err);
    toast.error("Failed to generate PDF", { id: "sar-pdf" });
  }
}

// ═══════════════════════════════════════════════════════════════
// Main SAR Page Component
// ═══════════════════════════════════════════════════════════════

export function SARProtocolPage() {
  const [activeMission, setActiveMission] = useState<SARMission | null>(null);
  const [showScenarioPicker, setShowScenarioPicker] = useState(true);
  const [elapsedTimer, setElapsedTimer] = useState(0);
  const [selectedTab, setSelectedTab] = useState<"map" | "timeline" | "teams" | "log">("map");
  const [showMapLayers, setShowMapLayers] = useState({ trail: true, cone: true, hazards: true, workers: true });
  const [isPaused, setIsPaused] = useState(false);
  const [expandedEscalation, setExpandedEscalation] = useState<string | null>(null);

  // ── FIX: Auto-load pre-staged/active missions from localStorage on mount ──
  // This is the critical bridge: when SAR is pre-staged from a cluster,
  // the mission is saved to localStorage BEFORE we navigate here.
  // Without this, the page shows the scenario picker instead of the live mission.
  useEffect(() => {
    if (activeMission) return; // already have a mission, don't override
    const active = getActiveSARMissions();
    if (active.length > 0) {
      // Load the most recent active mission
      const latest = active[0]; // already sorted newest-first by saveSARMission
      setActiveMission(latest);
      setShowScenarioPicker(false);
      setElapsedTimer(0);
      const isClusterMission = latest.id.startsWith("SAR-CLU-");
      toast.success(
        isClusterMission
          ? "Cluster SAR Mission Loaded"
          : "Active SAR Mission Resumed",
        {
          description: `Tracking ${latest.employeeName} in ${latest.zone}`,
          duration: 4000,
        }
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── FIX 4: Auto-load pre-fill data from SOS Emergency Popup bridge ──
  useEffect(() => {
    if (activeMission) return;
    try {
      const raw = localStorage.getItem("sosphere_sar_prefill");
      if (!raw) return;
      const prefill = JSON.parse(raw) as {
        employeeName: string;
        zone: string;
        lastGPS?: { lat: number; lng: number };
        elapsedMinutes: number;
        emergencyId: string;
      };
      // Consume the pre-fill data (one-shot)
      localStorage.removeItem("sosphere_sar_prefill");
      const mission = createSARMission(
        prefill.emergencyId,
        prefill.employeeName,
        "Field Worker",
        "field_worker",
        prefill.zone,
        "urban",
      );
      saveSARMission(mission);
      setActiveMission(mission);
      setShowScenarioPicker(false);
      setElapsedTimer(0);
      toast.success("SAR Mission Created from Emergency", {
        description: `Tracking ${prefill.employeeName} in ${prefill.zone} — ${prefill.elapsedMinutes}+ min elapsed`,
        duration: 5000,
      });
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Timer — updates search cone in real-time
  useEffect(() => {
    if (!activeMission || isPaused) return;
    const interval = setInterval(() => {
      setElapsedTimer(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [activeMission, isPaused]);

  // Recalculate cone every 30 seconds of real-time
  const currentMission = useMemo(() => {
    if (!activeMission) return null;
    const extraMin = elapsedTimer / 60;
    const totalElapsed = activeMission.trailAnalysis.timeSinceLastPoint + extraMin;
    const newCone = calculateSearchCone(
      activeMission.trail,
      activeMission.trailAnalysis,
      activeMission.workerType,
      activeMission.terrain,
      totalElapsed,
    );
    return { ...activeMission, searchCone: newCone };
  }, [activeMission, Math.floor(elapsedTimer / 10)]);

  const handleStartMission = useCallback((scenario: SARScenario) => {
    const mission = createSARMission(
      scenario.employeeId,
      scenario.employeeName,
      scenario.employeeRole,
      scenario.workerType,
      scenario.zone,
      scenario.terrain,
    );
    setActiveMission(mission);
    setShowScenarioPicker(false);
    setElapsedTimer(0);
    saveSARMission(mission);
    // Auto-alert mobile workers via shared store
    emitAdminSignal("SAR_ACTIVATED", scenario.employeeId, {
      employeeName: scenario.employeeName,
      zone: scenario.zone,
    });
    toast.success("SAR Mission launched — mobile workers alerted", {
      description: `Search for ${scenario.employeeName} in ${scenario.zone}`,
    });
  }, []);

  const handleEndMission = useCallback((status: SARMission["status"]) => {
    if (activeMission) {
      const updated = { ...activeMission, status };
      saveSARMission(updated);
      // Notify mobile workers that the search is over
      if (status === "found_safe" || status === "found_injured") {
        emitAdminSignal("SAR_WORKER_FOUND", activeMission.employeeId, {
          employeeName: activeMission.employeeName,
          status,
        });
        toast.success(status === "found_safe" ? "Worker found safe!" : "Worker found — medical attention needed", {
          description: `${activeMission.employeeName} — SAR mission concluded`,
        });
      }
    }
    setActiveMission(null);
    setShowScenarioPicker(true);
    setElapsedTimer(0);
  }, [activeMission]);

  return (
    <div style={{ minHeight: "100vh", color: "white" }}>
      <style>{pulseCSS}</style>

      {/* Header */}
      <PageHeader
        title="SAR Protocol"
        description="Search & Rescue — Intelligent Missing Worker System"
        color="#FF2D55"
      />

      {/* Multi-Mission Switcher — shows when multiple SAR missions are active */}
      {(() => {
        const allActive = getActiveSARMissions();
        if (allActive.length <= 1 && !activeMission?.id.startsWith("SAR-CLU-")) return null;
        return (
          <div style={{ margin: "0 24px 12px" }}>
            {/* Cluster Context Tag */}
            {activeMission?.id.startsWith("SAR-CLU-") && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "12px 12px 0 0",
                  background: "linear-gradient(135deg, rgba(255,45,85,0.10), rgba(255,0,0,0.06))",
                  border: "1px solid rgba(255,45,85,0.2)",
                  borderBottom: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <Siren style={{ width: 14, height: 14, color: "#FF2D55", flexShrink: 0 }} />
                <p style={{ fontSize: 10, fontWeight: 700, color: "#FF2D55" }}>
                  CLUSTER-SOURCED — auto-generated from zone cluster event
                </p>
              </div>
            )}
            {/* Mission Switcher Bar */}
            {allActive.length > 1 && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: activeMission?.id.startsWith("SAR-CLU-") ? "0 0 12px 12px" : 12,
                  background: "rgba(255,149,0,0.06)",
                  border: "1px solid rgba(255,149,0,0.15)",
                  borderTop: activeMission?.id.startsWith("SAR-CLU-") ? "1px solid rgba(255,45,85,0.1)" : undefined,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <AlertTriangle style={{ width: 12, height: 12, color: "#FF9500", flexShrink: 0 }} />
                  <span style={{ fontSize: 9, fontWeight: 800, color: "#FF9500", letterSpacing: "0.5px" }}>
                    {allActive.length} ACTIVE SAR MISSIONS — SWITCH BELOW
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {allActive.map(m => {
                    const isCurrent = activeMission?.id === m.id;
                    const isCluster = m.id.startsWith("SAR-CLU-");
                    return (
                      <button
                        key={m.id}
                        onClick={() => {
                          if (!isCurrent) {
                            setActiveMission(m);
                            setShowScenarioPicker(false);
                            setElapsedTimer(0);
                            toast.info(`Switched to ${m.employeeName}`, {
                              description: `${m.zone} — ${isCluster ? "Cluster Mission" : "Standard SAR"}`,
                            });
                          }
                        }}
                        style={{
                          padding: "5px 10px",
                          borderRadius: 8,
                          fontSize: 10,
                          fontWeight: isCurrent ? 800 : 600,
                          color: isCurrent ? "#fff" : "rgba(255,255,255,0.5)",
                          background: isCurrent
                            ? "linear-gradient(135deg, #FF2D55, #FF6B35)"
                            : "rgba(255,255,255,0.04)",
                          border: `1px solid ${isCurrent ? "rgba(255,45,85,0.4)" : "rgba(255,255,255,0.08)"}`,
                          cursor: isCurrent ? "default" : "pointer",
                          transition: "all 0.2s",
                        }}
                      >
                        {isCluster ? "🔗 " : ""}{m.employeeName} — {m.zone}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      <AnimatePresence mode="wait">
        {showScenarioPicker ? (
          <motion.div
            key="picker"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <ScenarioPicker scenarios={SAR_SCENARIOS} onStart={handleStartMission} />
          </motion.div>
        ) : currentMission ? (
          <motion.div
            key="mission"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <MissionDashboard
              mission={currentMission}
              elapsedTimer={elapsedTimer}
              isPaused={isPaused}
              onTogglePause={() => setIsPaused(!isPaused)}
              onEndMission={handleEndMission}
              selectedTab={selectedTab}
              onTabChange={setSelectedTab}
              showMapLayers={showMapLayers}
              onToggleLayer={(layer) => setShowMapLayers(prev => ({ ...prev, [layer]: !prev[layer] }))}
              expandedEscalation={expandedEscalation}
              onToggleEscalation={(id) => setExpandedEscalation(prev => prev === id ? null : id)}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// ── Scenario Picker ────────────────────────────────────────────

function ScenarioPicker({
  scenarios,
  onStart,
}: {
  scenarios: SARScenario[];
  onStart: (s: SARScenario) => void;
}) {
  return (
    <div style={{ padding: "0 24px 24px" }}>
      {/* Intro */}
      <DSCard glow="#FF2D55" style={{ marginBottom: 24, padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: "rgba(255,45,85,0.15)", border: "1px solid rgba(255,45,85,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Radar size={28} color="#FF2D55" />
          </div>
          <div>
            <div style={{ ...TYPOGRAPHY.h2, color: "white" }}>Search & Rescue Protocol</div>
            <div style={{ ...TYPOGRAPHY.bodySm, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
              When a worker is missing and NOT at their last GPS point — SOSphere calculates WHERE to look next
            </div>
          </div>
        </div>

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12,
          background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: 16,
        }}>
          {[
            { icon: Target, label: "Search Cone", desc: "AI-predicted location area" },
            { icon: Route, label: "Trail Analysis", desc: "Full GPS breadcrumb path" },
            { icon: Siren, label: "Auto-Escalation", desc: "6-phase rescue protocol" },
          ].map((f, i) => (
            <div key={i} style={{ textAlign: "center" }}>
              <f.icon size={20} color="#00C8E0" style={{ marginBottom: 6 }} />
              <div style={{ ...TYPOGRAPHY.caption, color: "white" }}>{f.label}</div>
              <div style={{ ...TYPOGRAPHY.micro, color: "rgba(255,255,255,0.4)" }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </DSCard>

      {/* Scenario Cards */}
      <div style={{ ...TYPOGRAPHY.overline, color: "rgba(255,255,255,0.4)", marginBottom: 12, paddingLeft: 4 }}>
        SELECT SCENARIO TO SIMULATE
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
        {scenarios.map((s, i) => (
          <motion.div
            key={s.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <DSCard
              style={{ padding: 20, cursor: "pointer", height: "100%" }}
              onClick={() => onStart(s)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <s.icon size={20} color="#FF2D55" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ ...TYPOGRAPHY.h4, color: "white" }}>{s.title}</div>
                  <div style={{ ...TYPOGRAPHY.micro, color: "rgba(255,255,255,0.4)" }}>{s.zone}</div>
                </div>
              </div>

              <div style={{ ...TYPOGRAPHY.bodySm, color: "rgba(255,255,255,0.5)", marginBottom: 16, minHeight: 48 }}>
                {s.description}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <MiniTag color="#FF2D55" label={`${s.elapsedMin} min ago`} />
                <MiniTag color="#FF9500" label={s.terrain} />
                <MiniTag color="#00C8E0" label={s.workerType.replace("_", " ")} />
              </div>

              <motion.div
                style={{
                  marginTop: 16, padding: "10px 0", textAlign: "center",
                  borderRadius: 10, background: "rgba(255,45,85,0.1)",
                  border: "1px solid rgba(255,45,85,0.3)", color: "#FF2D55",
                  ...TYPOGRAPHY.caption,
                }}
                whileHover={{ background: "rgba(255,45,85,0.2)" }}
              >
                ▶ Launch SAR Mission
              </motion.div>
            </DSCard>
          </motion.div>
        ))}
      </div>

      {/* Past Missions */}
      <PastMissions />
    </div>
  );
}

function MiniTag({ color, label }: { color: string; label: string }) {
  return (
    <span style={{
      ...TYPOGRAPHY.micro, color, padding: "3px 8px",
      borderRadius: 6, background: `${color}15`, border: `1px solid ${color}30`,
    }}>
      {label}
    </span>
  );
}

function PastMissions() {
  const missions = getAllSARMissions().filter(m => m.status !== "active");
  if (missions.length === 0) return null;
  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ ...TYPOGRAPHY.overline, color: "rgba(255,255,255,0.4)", marginBottom: 12, paddingLeft: 4 }}>
        PAST MISSIONS
      </div>
      {missions.slice(0, 5).map(m => (
        <DSCard key={m.id} style={{ padding: 12, marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 8, height: 8, borderRadius: "50%",
                background: m.status === "found_safe" ? "#00C853" : m.status === "cancelled" ? "rgba(255,255,255,0.3)" : "#FF2D55",
              }} />
              <div>
                <div style={{ ...TYPOGRAPHY.caption, color: "white" }}>{m.employeeName}</div>
                <div style={{ ...TYPOGRAPHY.micro, color: "rgba(255,255,255,0.4)" }}>{m.zone} • {m.workerType}</div>
              </div>
            </div>
            <div style={{
              ...TYPOGRAPHY.micro, padding: "2px 8px", borderRadius: 6,
              background: m.status === "found_safe" ? "rgba(0,200,83,0.15)" : "rgba(255,255,255,0.05)",
              color: m.status === "found_safe" ? "#00C853" : "rgba(255,255,255,0.4)",
            }}>
              {m.status.replace(/_/g, " ").toUpperCase()}
            </div>
          </div>
        </DSCard>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Mission Dashboard — Main SAR Interface
// ═══════════════════════════════════════════════════════════════

interface MissionDashboardProps {
  mission: SARMission;
  elapsedTimer: number;
  isPaused: boolean;
  onTogglePause: () => void;
  onEndMission: (status: SARMission["status"]) => void;
  selectedTab: "map" | "timeline" | "teams" | "log";
  onTabChange: (tab: "map" | "timeline" | "teams" | "log") => void;
  showMapLayers: Record<string, boolean>;
  onToggleLayer: (layer: string) => void;
  expandedEscalation: string | null;
  onToggleEscalation: (id: string) => void;
}

function MissionDashboard({
  mission, elapsedTimer, isPaused, onTogglePause, onEndMission,
  selectedTab, onTabChange, showMapLayers, onToggleLayer,
  expandedEscalation, onToggleEscalation,
}: MissionDashboardProps) {
  const totalElapsed = mission.trailAnalysis.timeSinceLastPoint + elapsedTimer / 60;
  const phaseColor = getPhaseColor(mission.currentPhase);

  return (
    <div style={{ padding: "0 24px 24px" }}>
      {/* Mission Header Bar */}
      <MissionHeader
        mission={mission}
        totalElapsed={totalElapsed}
        isPaused={isPaused}
        onTogglePause={onTogglePause}
        onEndMission={onEndMission}
      />

      {/* KPI Strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
        <KPIChip icon={<Clock size={14} />} label="Elapsed" value={formatElapsed(totalElapsed)} color="#FF2D55" />
        <KPIChip icon={<Target size={14} />} label="Search Radius" value={formatDistance(mission.searchCone.maxRadius)} color="#FF9500" />
        <KPIChip icon={<Gauge size={14} />} label="Confidence" value={`${mission.searchCone.confidence}%`} color={mission.searchCone.confidence > 50 ? "#00C853" : "#FF9500"} />
        <KPIChip icon={<Users size={14} />} label="Nearby" value={`${mission.nearbyWorkers.length}`} color="#00C8E0" />
        <KPIChip icon={<AlertTriangle size={14} />} label="Hazards" value={`${mission.hazardZones.length}`} color="#FF9500" />
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", gap: 4, marginBottom: 16, padding: 4,
        background: "rgba(255,255,255,0.03)", borderRadius: 12,
      }}>
        {[
          { id: "map" as const, label: "Search Map", icon: MapIcon },
          { id: "timeline" as const, label: "Escalation", icon: Timer },
          { id: "teams" as const, label: "Teams & Workers", icon: Users },
          { id: "log" as const, label: "Mission Log", icon: MessageSquare },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              flex: 1, padding: "10px 8px", borderRadius: 10, border: "none",
              background: selectedTab === tab.id ? "rgba(255,45,85,0.15)" : "transparent",
              color: selectedTab === tab.id ? "#FF2D55" : "rgba(255,255,255,0.4)",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              ...TYPOGRAPHY.caption,
              transition: "all 0.2s",
            }}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={selectedTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {selectedTab === "map" && (
            <SearchMapPanel
              mission={mission}
              showLayers={showMapLayers}
              onToggleLayer={onToggleLayer}
            />
          )}
          {selectedTab === "timeline" && (
            <EscalationPanel
              escalation={mission.escalation}
              currentPhase={mission.currentPhase}
              totalElapsed={totalElapsed}
              expanded={expandedEscalation}
              onToggle={onToggleEscalation}
            />
          )}
          {selectedTab === "teams" && (
            <TeamsPanel
              nearbyWorkers={mission.nearbyWorkers}
              searchTeams={mission.searchTeams}
              hazardZones={mission.hazardZones}
            />
          )}
          {selectedTab === "log" && (
            <LogPanel log={mission.log} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ── Mission Header ─────────────────────────────────────────────

function MissionHeader({
  mission, totalElapsed, isPaused, onTogglePause, onEndMission,
}: {
  mission: SARMission; totalElapsed: number; isPaused: boolean;
  onTogglePause: () => void; onEndMission: (s: SARMission["status"]) => void;
}) {
  const phaseColor = getPhaseColor(mission.currentPhase);
  const [showEndOptions, setShowEndOptions] = useState(false);

  return (
    <DSCard glow={phaseColor} style={{ marginBottom: 16, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {/* Left — Worker Info */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: `${phaseColor}20`, border: `2px solid ${phaseColor}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "sarPulse 2s infinite",
          }}>
            <Radar size={24} color={phaseColor} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ ...TYPOGRAPHY.h3, color: "white" }}>{mission.employeeName}</span>
              <span style={{
                ...TYPOGRAPHY.micro, padding: "2px 8px", borderRadius: 6,
                background: `${phaseColor}20`, color: phaseColor, border: `1px solid ${phaseColor}40`,
              }}>
                {getPhaseLabel(mission.currentPhase).toUpperCase()}
              </span>
            </div>
            <div style={{ ...TYPOGRAPHY.bodySm, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
              {mission.employeeRole} • {mission.zone} • {mission.terrain}
            </div>
          </div>
        </div>

        {/* Right — Timer + Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Elapsed Timer */}
          <div style={{
            padding: "8px 16px", borderRadius: 10,
            background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.3)",
            textAlign: "center",
          }}>
            <div style={{ ...TYPOGRAPHY.micro, color: "rgba(255,255,255,0.4)" }}>SIGNAL LOST</div>
            <div style={{ ...TYPOGRAPHY.kpiValueSm, color: "#FF2D55", marginTop: 2 }}>
              {formatElapsed(totalElapsed)}
            </div>
          </div>

          {/* Pause/Resume */}
          <button
            onClick={onTogglePause}
            style={{
              width: 36, height: 36, borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.05)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {isPaused ? <Play size={16} color="#00C853" /> : <Pause size={16} color="rgba(255,255,255,0.5)" />}
          </button>

          {/* Export PDF */}
          <button
            onClick={() => exportSARReportPDF(mission, totalElapsed)}
            style={{
              width: 36, height: 36, borderRadius: 10, border: "1px solid rgba(0,200,224,0.2)",
              background: "rgba(0,200,224,0.08)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
            title="Export SAR Report as PDF"
          >
            <Download size={16} color="#00C8E0" />
          </button>

          {/* Alert Mobile Workers */}
          <button
            onClick={() => {
              emitAdminSignal("SAR_ACTIVATED", mission.employeeId, {
                employeeName: mission.employeeName,
                zone: mission.zone,
              });
              toast.success("SAR Alert sent to all mobile workers", {
                description: `Field workers near ${mission.zone} will see the alert on their phones.`,
              });
            }}
            style={{
              padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,149,0,0.3)",
              background: "rgba(255,149,0,0.1)", cursor: "pointer", color: "#FF9500",
              ...TYPOGRAPHY.caption, display: "flex", alignItems: "center", gap: 6,
            }}
            title="Send SAR alert to all nearby mobile workers"
          >
            <Bell size={14} /> Alert Workers
          </button>

          {/* End Mission */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowEndOptions(!showEndOptions)}
              style={{
                padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(0,200,83,0.3)",
                background: "rgba(0,200,83,0.1)", cursor: "pointer", color: "#00C853",
                ...TYPOGRAPHY.caption, display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <Check size={14} /> End Mission
            </button>

            <AnimatePresence>
              {showEndOptions && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  style={{
                    position: "absolute", right: 0, top: "100%", marginTop: 4,
                    background: "#0A1220", border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 12, padding: 8, minWidth: 200, zIndex: 50,
                    boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                  }}
                >
                  {[
                    { status: "found_safe" as const, label: "Found Safe", color: "#00C853" },
                    { status: "found_injured" as const, label: "Found Injured", color: "#FF9500" },
                    { status: "cancelled" as const, label: "Cancel Mission", color: "rgba(255,255,255,0.4)" },
                  ].map(opt => (
                    <button
                      key={opt.status}
                      onClick={() => { onEndMission(opt.status); setShowEndOptions(false); }}
                      style={{
                        display: "block", width: "100%", padding: "10px 12px", border: "none",
                        background: "transparent", color: opt.color, textAlign: "left",
                        cursor: "pointer", borderRadius: 8, ...TYPOGRAPHY.caption,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      {opt.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Search Pattern Recommendation */}
      {(() => {
        const rec = recommendSearchPattern(mission.searchCone, mission.terrain, mission.workerType);
        return (
          <div style={{
            marginTop: 12, padding: "10px 14px", borderRadius: 10,
            background: "rgba(0,200,224,0.05)", border: "1px solid rgba(0,200,224,0.15)",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <Compass size={16} color="#00C8E0" />
            <div>
              <span style={{ ...TYPOGRAPHY.caption, color: "#00C8E0" }}>
                Recommended: {rec.pattern.replace(/_/g, " ").toUpperCase()}
              </span>
              <span style={{ ...TYPOGRAPHY.bodySm, color: "rgba(255,255,255,0.35)", marginLeft: 8 }}>
                — {rec.reason}
              </span>
            </div>
          </div>
        );
      })()}
    </DSCard>
  );
}

function KPIChip({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div style={{
      padding: "12px 10px", borderRadius: 12,
      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
      textAlign: "center",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginBottom: 4, color: "rgba(255,255,255,0.4)" }}>
        {icon}
        <span style={{ ...TYPOGRAPHY.micro }}>{label}</span>
      </div>
      <div style={{ ...TYPOGRAPHY.kpiValueSm, color, fontSize: 16 }}>{value}</div>
    </div>
  );
}

// ── Direct Leaflet Map (no react-leaflet) ──────────────────────

function DirectLeafletMap({
  mission,
  showLayers,
}: {
  mission: SARMission;
  showLayers: Record<string, boolean>;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup>(L.layerGroup());

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;
    const cone = mission.searchCone;
    const map = L.map(mapRef.current, {
      center: [cone.originLat || 24.7136, cone.originLng || 46.6753],
      zoom: 14,
      zoomControl: false,
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    }).addTo(map);
    layersRef.current.addTo(map);
    mapInstanceRef.current = map;

    // Fit bounds
    if (mission.trail.length > 0) {
      const bounds = L.latLngBounds(mission.trail.map(p => [p.lat, p.lng] as [number, number]));
      if (cone.maxRadius > 0) {
        const conePoints = getConePolygon(cone);
        conePoints.forEach(([lat, lng]) => bounds.extend([lat, lng]));
      }
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [mission.id]);

  // Update layers when showLayers or mission changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const lg = layersRef.current;
    lg.clearLayers();

    const cone = mission.searchCone;
    const trail = mission.trail;
    const trailCoords = trail.map(p => [p.lat, p.lng] as [number, number]);
    const lastPoint = trail[trail.length - 1];

    // Search Cone Probability Zones
    if (showLayers.cone) {
      cone.probabilityZones.forEach((zone, i) => {
        const zonePolygon = getZonePolygon(cone, zone);
        L.polygon(zonePolygon, {
          color: zone.color,
          fillColor: zone.color,
          fillOpacity: zone.opacity,
          weight: 1,
          dashArray: i === 0 ? undefined : "5,5",
        }).addTo(lg);
      });
    }

    // GPS Trail
    if (showLayers.trail && trailCoords.length > 1) {
      L.polyline(trailCoords, { color: "#00C8E0", weight: 3, opacity: 0.7 }).addTo(lg);
      L.circleMarker(trailCoords[0], {
        radius: 5, color: "#00C853", fillColor: "#00C853", fillOpacity: 1, weight: 2,
      }).addTo(lg);
      const drSegments = trail
        .filter(p => p.source === "dead_reckoning")
        .map(p => [p.lat, p.lng] as [number, number]);
      if (drSegments.length > 1) {
        L.polyline(drSegments, { color: "#FF9500", weight: 2, opacity: 0.5, dashArray: "8,8" }).addTo(lg);
      }
    }

    // Last Known Position
    if (lastPoint) {
      L.marker([lastPoint.lat, lastPoint.lng], { icon: sosIcon })
        .bindPopup(`<div style="color:#333;font-size:12px"><strong>Last Known Position</strong><br/>${mission.employeeName}<br/>${new Date(lastPoint.timestamp).toLocaleTimeString()}<br/>Accuracy: ${Math.round(lastPoint.accuracy)}m</div>`)
        .addTo(lg);
    }

    // Nearby Workers
    if (showLayers.workers) {
      mission.nearbyWorkers.forEach(w => {
        L.marker([w.lat, w.lng], { icon: workerIcon })
          .bindPopup(`<div style="color:#333;font-size:12px"><strong>${w.name}</strong><br/>${w.role}<br/>${formatDistance(w.distanceMeters)} away<br/>ETA: ~${w.estimatedArrivalMin} min</div>`)
          .addTo(lg);
      });
    }

    // Hazard Zones
    if (showLayers.hazards) {
      mission.hazardZones.forEach(h => {
        L.circle([h.lat, h.lng], {
          radius: h.radiusMeters,
          color: h.severity === "lethal" ? "#FF2D55" : h.severity === "dangerous" ? "#FF9500" : "#FFD60A",
          fillOpacity: 0.15, weight: 2, dashArray: "4,4",
        }).addTo(lg);
        L.marker([h.lat, h.lng], { icon: hazardIcon })
          .bindPopup(`<div style="color:#333;font-size:12px"><strong>⚠ ${h.name}</strong><br/>Type: ${h.type.replace(/_/g, " ")}<br/>Severity: ${h.severity}<br/>Overlap: ${h.overlapPercent}%</div>`)
          .addTo(lg);
      });
    }
  }, [mission, showLayers]);

  return (
    <div
      ref={mapRef}
      style={{ height: "100%", width: "100%", borderRadius: 16 }}
    />
  );
}

// ── Search Map Panel ───────────────────────────────────────────

function SearchMapPanel({
  mission,
  showLayers,
  onToggleLayer,
}: {
  mission: SARMission;
  showLayers: Record<string, boolean>;
  onToggleLayer: (l: string) => void;
}) {
  const cone = mission.searchCone;
  const trail = mission.trail;
  const trailCoords = trail.map(p => [p.lat, p.lng] as [number, number]);
  const lastPoint = trail[trail.length - 1];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16 }}>
      {/* Map */}
      <DSCard style={{ overflow: "hidden", borderRadius: 16 }}>
        <div style={{ height: 520, position: "relative" }}>
          <DirectLeafletMap mission={mission} showLayers={showLayers} />

          {/* Map Layer Controls */}
          <div style={{
            position: "absolute", top: 12, right: 12, zIndex: 1000,
            background: "rgba(10,18,32,0.9)", borderRadius: 10, padding: 8,
            border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(10px)",
          }}>
            {[
              { key: "trail", label: "GPS Trail", color: "#00C8E0" },
              { key: "cone", label: "Search Cone", color: "#FF2D55" },
              { key: "hazards", label: "Hazards", color: "#FF9500" },
              { key: "workers", label: "Workers", color: "#00C853" },
            ].map(layer => (
              <button
                key={layer.key}
                onClick={() => onToggleLayer(layer.key)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, width: "100%",
                  padding: "6px 10px", border: "none", borderRadius: 6,
                  background: showLayers[layer.key] ? `${layer.color}15` : "transparent",
                  color: showLayers[layer.key] ? layer.color : "rgba(255,255,255,0.3)",
                  cursor: "pointer", ...TYPOGRAPHY.micro, marginBottom: 2,
                }}
              >
                <div style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: showLayers[layer.key] ? layer.color : "rgba(255,255,255,0.15)",
                }} />
                {layer.label}
              </button>
            ))}
          </div>

          {/* Cone Legend */}
          <div style={{
            position: "absolute", bottom: 12, left: 12, zIndex: 1000,
            background: "rgba(10,18,32,0.9)", borderRadius: 10, padding: 10,
            border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(10px)",
          }}>
            <div style={{ ...TYPOGRAPHY.micro, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>PROBABILITY</div>
            {[
              { label: "High (60%)", color: "#FF2D55" },
              { label: "Medium (25%)", color: "#FF9500" },
              { label: "Low (15%)", color: "#FFD60A" },
            ].map(z => (
              <div key={z.label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: z.color, opacity: 0.6 }} />
                <span style={{ ...TYPOGRAPHY.micro, color: "rgba(255,255,255,0.4)" }}>{z.label}</span>
              </div>
            ))}
          </div>
        </div>
      </DSCard>

      {/* Right Panel — Trail Analysis + Quick Info */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Trail Analysis */}
        <DSCard style={{ padding: 16 }}>
          <div style={{ ...TYPOGRAPHY.h4, color: "white", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <Route size={14} color="#00C8E0" />
            Trail Analysis
          </div>
          {[
            { label: "Total Points", value: `${mission.trailAnalysis.totalPoints}` },
            { label: "Trail Distance", value: formatDistance(mission.trailAnalysis.totalDistance) },
            { label: "Average Speed", value: `${mission.trailAnalysis.averageSpeed.toFixed(1)} m/s` },
            { label: "Last Speed", value: `${mission.trailAnalysis.lastSpeed.toFixed(1)} m/s` },
            { label: "Movement", value: mission.trailAnalysis.movementPattern },
            { label: "Heading", value: `${Math.round(mission.trailAnalysis.lastHeading)}°` },
            { label: "Stops Found", value: `${mission.trailAnalysis.stopsDetected.length}` },
            { label: "Dead Reckoning", value: `${mission.trailAnalysis.deadReckoningPoints} pts` },
            { label: "GPS Quality", value: mission.trailAnalysis.gpsQuality },
          ].map((item, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", padding: "6px 0",
              borderBottom: i < 8 ? "1px solid rgba(255,255,255,0.04)" : "none",
            }}>
              <span style={{ ...TYPOGRAPHY.bodySm, color: "rgba(255,255,255,0.4)" }}>{item.label}</span>
              <span style={{ ...TYPOGRAPHY.caption, color: "white" }}>{item.value}</span>
            </div>
          ))}
        </DSCard>

        {/* Search Cone Stats */}
        <DSCard style={{ padding: 16 }}>
          <div style={{ ...TYPOGRAPHY.h4, color: "white", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <Target size={14} color="#FF2D55" />
            Search Cone
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8,
          }}>
            {[
              { label: "Radius", value: formatDistance(mission.searchCone.maxRadius), color: "#FF2D55" },
              { label: "Heading", value: mission.searchCone.isCircular ? "360°" : `${Math.round(mission.searchCone.heading)}°`, color: "#00C8E0" },
              { label: "Spread", value: `±${Math.round(mission.searchCone.spreadAngle)}°`, color: "#FF9500" },
              { label: "Confidence", value: `${mission.searchCone.confidence}%`, color: mission.searchCone.confidence > 50 ? "#00C853" : "#FF9500" },
            ].map((s, i) => (
              <div key={i} style={{
                padding: "10px 8px", borderRadius: 8,
                background: "rgba(255,255,255,0.02)", textAlign: "center",
              }}>
                <div style={{ ...TYPOGRAPHY.micro, color: "rgba(255,255,255,0.4)" }}>{s.label}</div>
                <div style={{ ...TYPOGRAPHY.h4, color: s.color, marginTop: 4 }}>{s.value}</div>
              </div>
            ))}
          </div>
        </DSCard>

        {/* Hazard Alert */}
        {mission.hazardZones.filter(h => h.severity === "lethal").length > 0 && (
          <DSCard glow="#FF2D55" style={{ padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <AlertTriangle size={18} color="#FF2D55" />
              <div>
                <div style={{ ...TYPOGRAPHY.caption, color: "#FF2D55" }}>LETHAL HAZARD IN SEARCH ZONE</div>
                <div style={{ ...TYPOGRAPHY.micro, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                  {mission.hazardZones.filter(h => h.severity === "lethal").map(h => h.name).join(", ")}
                </div>
              </div>
            </div>
          </DSCard>
        )}
      </div>
    </div>
  );
}

// ── Escalation Timeline Panel ──────────────────────────────────

function EscalationPanel({
  escalation, currentPhase, totalElapsed, expanded, onToggle,
}: {
  escalation: EscalationStep[];
  currentPhase: SARPhase;
  totalElapsed: number;
  expanded: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      {/* Left — Timeline */}
      <DSCard style={{ padding: 20 }}>
        <div style={{ ...TYPOGRAPHY.h3, color: "white", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
          <Timer size={18} color="#FF2D55" />
          Escalation Protocol
        </div>

        <div style={{ position: "relative" }}>
          {/* Vertical line */}
          <div style={{
            position: "absolute", left: 19, top: 0, bottom: 0, width: 2,
            background: "rgba(255,255,255,0.06)",
          }} />

          {escalation.map((step, i) => {
            const isActive = step.isActive;
            const isDone = step.isComplete;
            const isPending = !isActive && !isDone;
            const isExpanded = expanded === step.id;
            const color = isDone ? "#00C853" : isActive ? step.color : "rgba(255,255,255,0.15)";

            return (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                style={{ position: "relative", paddingLeft: 48, marginBottom: 16 }}
              >
                {/* Dot */}
                <div style={{
                  position: "absolute", left: 10, top: 4, width: 20, height: 20,
                  borderRadius: "50%", background: isDone ? "#00C853" : isActive ? step.color : "rgba(255,255,255,0.08)",
                  border: `2px solid ${color}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  zIndex: 1,
                  animation: isActive ? "sarPulse 2s infinite" : "none",
                }}>
                  {isDone && <Check size={10} color="white" />}
                </div>

                {/* Content */}
                <div
                  onClick={() => onToggle(step.id)}
                  style={{
                    padding: "12px 14px", borderRadius: 12, cursor: "pointer",
                    background: isActive ? `${step.color}10` : "rgba(255,255,255,0.02)",
                    border: `1px solid ${isActive ? `${step.color}30` : "rgba(255,255,255,0.04)"}`,
                    transition: "all 0.2s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ ...TYPOGRAPHY.caption, color: isPending ? "rgba(255,255,255,0.3)" : "white" }}>
                          {step.title}
                        </span>
                        {isActive && (
                          <span style={{
                            ...TYPOGRAPHY.micro, padding: "1px 6px", borderRadius: 4,
                            background: `${step.color}30`, color: step.color,
                          }}>
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <div style={{ ...TYPOGRAPHY.micro, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                        Triggers at +{step.triggerMinutes} min
                      </div>
                    </div>
                    <ChevronDown
                      size={14}
                      color="rgba(255,255,255,0.2)"
                      style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "0.2s" }}
                    />
                  </div>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        style={{ overflow: "hidden" }}
                      >
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                          <div style={{ ...TYPOGRAPHY.bodySm, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>
                            {step.description}
                          </div>
                          {step.actions.map(action => (
                            <div key={action.id} style={{
                              display: "flex", alignItems: "center", gap: 8, padding: "6px 0",
                            }}>
                              <div style={{
                                width: 6, height: 6, borderRadius: "50%",
                                background: action.status === "done" ? "#00C853" : action.status === "executing" ? "#FF9500" : "rgba(255,255,255,0.15)",
                              }} />
                              <span style={{
                                ...TYPOGRAPHY.bodySm,
                                color: action.status === "done" ? "#00C853" : action.status === "executing" ? "#FF9500" : "rgba(255,255,255,0.3)",
                              }}>
                                {action.label}
                              </span>
                              {action.status === "executing" && (
                                <RefreshCw size={10} color="#FF9500" style={{ animation: "spin 2s linear infinite" }} />
                              )}
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            );
          })}
        </div>
      </DSCard>

      {/* Right — Phase Summary + Tips */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Current Phase Card */}
        <DSCard glow={getPhaseColor(currentPhase)} style={{ padding: 20 }}>
          <div style={{ ...TYPOGRAPHY.overline, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>CURRENT PHASE</div>
          <div style={{ ...TYPOGRAPHY.h1, color: getPhaseColor(currentPhase), marginBottom: 4 }}>
            {getPhaseLabel(currentPhase)}
          </div>
          <div style={{ ...TYPOGRAPHY.bodySm, color: "rgba(255,255,255,0.4)" }}>
            {totalElapsed < 10 && "Device ping sent. Waiting for response. Buddy notified."}
            {totalElapsed >= 10 && totalElapsed < 20 && "Nearby workers alerted. Search cone calculated. Zone Admin notified."}
            {totalElapsed >= 20 && totalElapsed < 40 && "Rescue team dispatched to search cone area. Expanding search pattern."}
            {totalElapsed >= 40 && "External SAR activated. Full emergency protocol in effect. All resources mobilized."}
          </div>
        </DSCard>

        {/* Smart Tips */}
        <DSCard style={{ padding: 16 }}>
          <div style={{ ...TYPOGRAPHY.h4, color: "white", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <Zap size={14} color="#00C8E0" />
            Smart Tips
          </div>
          {[
            { tip: "Check the trail for stops — the worker may have returned to a previous stop location", icon: "📍" },
            { tip: "Cross-reference with buddy's last position — they may have been near the missing worker", icon: "👥" },
            { tip: "If signal was lost suddenly (not gradually), suspect equipment failure, not movement", icon: "📡" },
            { tip: "Send drone to search cone center if available — 10x faster than ground search", icon: "🛸" },
            { tip: "Check if worker's phone battery was low — they may have powered down to conserve", icon: "🔋" },
          ].map((t, i) => (
            <div key={i} style={{
              display: "flex", gap: 10, padding: "8px 0",
              borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.03)" : "none",
            }}>
              <span>{t.icon}</span>
              <span style={{ ...TYPOGRAPHY.bodySm, color: "rgba(255,255,255,0.4)" }}>{t.tip}</span>
            </div>
          ))}
        </DSCard>
      </div>
    </div>
  );
}

// ── Teams & Workers Panel ──────────────────────────────────────

function TeamsPanel({
  nearbyWorkers, searchTeams, hazardZones,
}: {
  nearbyWorkers: NearbyWorker[];
  searchTeams: SARMission["searchTeams"];
  hazardZones: HazardZone[];
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      {/* Search Teams */}
      <DSCard style={{ padding: 20 }}>
        <div style={{ ...TYPOGRAPHY.h3, color: "white", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
          <Shield size={18} color="#00C8E0" />
          Search Teams
        </div>
        {searchTeams.map(team => (
          <div key={team.id} style={{
            padding: 14, borderRadius: 12, marginBottom: 10,
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ ...TYPOGRAPHY.caption, color: "white" }}>{team.name}</div>
              <span style={{
                ...TYPOGRAPHY.micro, padding: "2px 8px", borderRadius: 6,
                background: team.status === "searching" ? "rgba(255,45,85,0.15)" : "rgba(255,255,255,0.05)",
                color: team.status === "searching" ? "#FF2D55" : "rgba(255,255,255,0.4)",
              }}>
                {team.status.toUpperCase()}
              </span>
            </div>
            <div style={{ ...TYPOGRAPHY.bodySm, color: "rgba(255,255,255,0.3)" }}>
              Members: {team.members.join(", ")}
            </div>
            <div style={{ ...TYPOGRAPHY.bodySm, color: "rgba(255,255,255,0.3)" }}>
              Zone: {team.assignedZone} • Pattern: {team.pattern.replace(/_/g, " ")}
            </div>
          </div>
        ))}
      </DSCard>

      {/* Nearby Workers */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <DSCard style={{ padding: 20 }}>
          <div style={{ ...TYPOGRAPHY.h3, color: "white", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
            <Users size={18} color="#00C853" />
            Nearby Workers ({nearbyWorkers.length})
          </div>
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {nearbyWorkers.map((w, i) => (
              <div key={w.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 0",
                borderBottom: i < nearbyWorkers.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: "rgba(0,200,224,0.1)", display: "flex",
                    alignItems: "center", justifyContent: "center",
                    ...TYPOGRAPHY.caption, color: "#00C8E0",
                  }}>
                    {w.name.split(" ").map(n => n[0]).join("")}
                  </div>
                  <div>
                    <div style={{ ...TYPOGRAPHY.caption, color: "white" }}>{w.name}</div>
                    <div style={{ ...TYPOGRAPHY.micro, color: "rgba(255,255,255,0.3)" }}>
                      {w.role} • {formatDistance(w.distanceMeters)}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ ...TYPOGRAPHY.micro, color: "rgba(255,255,255,0.3)" }}>
                    ~{w.estimatedArrivalMin}m
                  </span>
                  <button style={{
                    width: 28, height: 28, borderRadius: 8, border: "1px solid rgba(0,200,224,0.3)",
                    background: "rgba(0,200,224,0.1)", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Phone size={12} color="#00C8E0" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </DSCard>

        {/* Hazard Zones */}
        <DSCard style={{ padding: 16 }}>
          <div style={{ ...TYPOGRAPHY.h4, color: "white", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle size={14} color="#FF9500" />
            Hazards in Search Zone ({hazardZones.length})
          </div>
          {hazardZones.map(h => (
            <div key={h.id} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 0",
              borderBottom: "1px solid rgba(255,255,255,0.03)",
            }}>
              <div>
                <div style={{ ...TYPOGRAPHY.caption, color: h.severity === "lethal" ? "#FF2D55" : h.severity === "dangerous" ? "#FF9500" : "white" }}>
                  {h.name}
                </div>
                <div style={{ ...TYPOGRAPHY.micro, color: "rgba(255,255,255,0.3)" }}>
                  {h.type.replace(/_/g, " ")} • r={h.radiusMeters}m
                </div>
              </div>
              <div style={{
                ...TYPOGRAPHY.micro, padding: "2px 8px", borderRadius: 6,
                background: h.severity === "lethal" ? "rgba(255,45,85,0.15)" : "rgba(255,149,0,0.15)",
                color: h.severity === "lethal" ? "#FF2D55" : "#FF9500",
              }}>
                {h.overlapPercent}% overlap
              </div>
            </div>
          ))}
        </DSCard>
      </div>
    </div>
  );
}

// ── Mission Log Panel ──────────────────────────────────────────

function LogPanel({ log }: { log: MissionLogEntry[] }) {
  const sortedLog = [...log].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <DSCard style={{ padding: 20 }}>
      <div style={{ ...TYPOGRAPHY.h3, color: "white", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
        <MessageSquare size={18} color="#00C8E0" />
        Mission Log
      </div>

      <div style={{ position: "relative" }}>
        {/* Timeline line */}
        <div style={{
          position: "absolute", left: 7, top: 4, bottom: 4, width: 2,
          background: "rgba(255,255,255,0.04)",
        }} />

        {sortedLog.map((entry, i) => {
          const severityColor = entry.severity === "critical" ? "#FF2D55"
            : entry.severity === "warning" ? "#FF9500" : "#00C8E0";

          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              style={{ position: "relative", paddingLeft: 32, marginBottom: 16 }}
            >
              {/* Dot */}
              <div style={{
                position: "absolute", left: 2, top: 6, width: 12, height: 12,
                borderRadius: "50%", background: `${severityColor}30`,
                border: `2px solid ${severityColor}`, zIndex: 1,
              }} />

              <div style={{
                padding: "10px 14px", borderRadius: 10,
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{
                    ...TYPOGRAPHY.micro, padding: "1px 6px", borderRadius: 4,
                    background: `${severityColor}15`, color: severityColor,
                    textTransform: "uppercase",
                  }}>
                    {entry.type}
                  </span>
                  <span style={{ ...TYPOGRAPHY.micro, color: "rgba(255,255,255,0.3)" }}>
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div style={{ ...TYPOGRAPHY.bodySm, color: "rgba(255,255,255,0.6)" }}>
                  {entry.message}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </DSCard>
  );
}
