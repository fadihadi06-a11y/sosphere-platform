// ═══════════════════════════════════════════════════════════════
// SOSphere — Risk Map Live Page (Premium Redesign)
// WIYAK GPS-inspired futuristic design with real Leaflet map
// Connected to shared-store for live sync + Trip Tracking
// + Trip Replay Animation + PDF Export + Live Weather Sensors
// ═══════════════════════════════════════════════════════════════
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  MapPin, AlertTriangle, Users, Shield,
  Navigation, Eye, Clock, Zap, Satellite, Wifi,
  Thermometer, Wind, LocateFixed, Layers,
  Route, ChevronDown, ChevronUp,
  Gauge, Timer, Flag, CheckCircle2,
  Play, Pause, RotateCcw, Download,
  Droplets, Sun, CloudRain, FileText,
} from "lucide-react";
import L from "leaflet";

// Inject Leaflet CSS from CDN (avoids bundler issues with leaflet's image assets)
if (typeof document !== "undefined" && !document.getElementById("leaflet-css")) {
  const link = document.createElement("link");
  link.id = "leaflet-css";
  link.rel = "stylesheet";
  link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  document.head.appendChild(link);
}

// Fix default marker icons (Leaflet's defaults break in bundlers)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

import jsPDF from "jspdf";
import { autoTable } from "jspdf-autotable";
import {
  getLiveWorkerPositions,
  getActiveTrips,
  getEmployeeTrip,
  getZoneGPS,
  onSyncEvent,
  type EmployeeTrip,
} from "./shared-store";

interface RiskMapLiveProps {
  t: (key: string) => string;
}

// ── Zone Geofences ─────────────────────────────────────────────
const DEFAULT_ZONES = [
  { id: "Z-A", name: "Zone A — North Gate", risk: "medium" as const, center: [24.7130, 46.6750] as [number, number], radius: 150, employees: 4, alerts: 1 },
  { id: "Z-B", name: "Zone B — Control Room", risk: "low" as const, center: [24.7150, 46.6805] as [number, number], radius: 120, employees: 2, alerts: 0 },
  { id: "Z-C", name: "Zone C — Main Hall", risk: "low" as const, center: [24.7170, 46.6770] as [number, number], radius: 130, employees: 1, alerts: 0 },
  { id: "Z-D", name: "Zone D — Warehouse", risk: "high" as const, center: [24.7092, 46.6825] as [number, number], radius: 100, employees: 2, alerts: 2 },
  { id: "Z-E", name: "Zone E — Parking", risk: "low" as const, center: [24.7180, 46.6790] as [number, number], radius: 80, employees: 1, alerts: 0 },
];

const RISK_COLORS = { high: "#FF2D55", medium: "#FF9500", low: "#00C853" };
const STATUS_COLORS: Record<string, string> = { active: "#00C8E0", late: "#FF9500", sos: "#FF2D55", offline: "rgba(255,255,255,0.2)" };

// ── Weather Simulation Engine ──────────────────────────────────
interface WeatherData {
  temp: number; humidity: number; windSpeed: number; windDir: string;
  uvIndex: number; visibility: string; condition: string; pressure: number;
  feelsLike: number; updatedAt: number;
}

function generateWeather(seed: number): WeatherData {
  const hour = new Date().getHours();
  const isDay = hour >= 6 && hour <= 18;
  const baseTemp = isDay ? 38 + Math.sin(seed * 0.001) * 8 : 28 + Math.sin(seed * 0.001) * 5;
  const conditions = isDay
    ? ["Clear Sky", "Partly Cloudy", "Hazy", "Dusty"]
    : ["Clear Night", "Partly Cloudy", "Calm"];
  return {
    temp: Math.round(baseTemp + Math.sin(seed * 0.0005) * 3),
    humidity: Math.round(25 + Math.sin(seed * 0.0008) * 15),
    windSpeed: Math.round(8 + Math.sin(seed * 0.0006) * 12),
    windDir: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.floor((seed * 0.0003) % 8)],
    uvIndex: isDay ? Math.round(6 + Math.sin(seed * 0.001) * 4) : 0,
    visibility: Math.sin(seed * 0.0004) > 0.3 ? "Good" : Math.sin(seed * 0.0004) > -0.3 ? "Moderate" : "Poor",
    condition: conditions[Math.floor(Math.abs(Math.sin(seed * 0.0002)) * conditions.length)],
    pressure: Math.round(1013 + Math.sin(seed * 0.0007) * 8),
    feelsLike: Math.round(baseTemp + 3 + Math.sin(seed * 0.0009) * 2),
    updatedAt: Date.now(),
  };
}

// ── PDF Trip Report Generator ──────────────────────────────────
function exportTripPDF(trip: EmployeeTrip) {
  const doc = new jsPDF();
  const cyan = [0, 200, 224];
  const dark = [5, 7, 14];

  // Header
  doc.setFillColor(dark[0], dark[1], dark[2]);
  doc.rect(0, 0, 210, 40, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.text("SOSphere", 15, 18);
  doc.setFontSize(10);
  doc.setTextColor(cyan[0], cyan[1], cyan[2]);
  doc.text("TRIP TRACKING REPORT", 15, 26);
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 15, 33);
  doc.text(`Report ID: RPT-${Date.now().toString(36).toUpperCase()}`, 120, 33);

  // Employee Info
  doc.setFontSize(13);
  doc.setTextColor(30, 30, 30);
  doc.text(`Employee: ${trip.employeeName}`, 15, 52);
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(`Trip ID: ${trip.id} | Zone: ${trip.zone} | Status: ${trip.status.toUpperCase()}`, 15, 59);
  doc.text(`Started: ${new Date(trip.startedAt).toLocaleString()}${trip.endedAt ? ` | Ended: ${new Date(trip.endedAt).toLocaleString()}` : " | Still Active"}`, 15, 65);

  // KPI Summary
  const duration = trip.endedAt ? Math.round((trip.endedAt - trip.startedAt) / 60000) : Math.round((Date.now() - trip.startedAt) / 60000);
  const kpis = [
    ["Total Distance", `${trip.totalDistanceKm} km`],
    ["Duration", `${duration} min`],
    ["Avg Speed", `${trip.avgSpeedKmh} km/h`],
    ["Max Speed", `${trip.maxSpeedKmh} km/h`],
    ["Idle Time", `${trip.idleTimeMinutes} min`],
    ["Checkpoints", `${trip.checkpoints}`],
    ["Waypoints", `${trip.waypoints.length}`],
  ];

  autoTable(doc, {
    startY: 72,
    head: [["Metric", "Value"]],
    body: kpis,
    theme: "grid",
    headStyles: { fillColor: [0, 200, 224], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 50 } },
    margin: { left: 15, right: 15 },
  });

  // Waypoint Events Table
  const events = trip.waypoints
    .filter(w => w.event)
    .map(w => [
      (w.event || "").replace("_", " ").toUpperCase(),
      new Date(w.timestamp).toLocaleTimeString(),
      `${w.lat.toFixed(5)}, ${w.lng.toFixed(5)}`,
      w.speed != null ? `${w.speed} km/h` : "-",
      w.zoneName || "-",
    ]);

  if (events.length > 0) {
    const prevEnd = (doc as any).lastAutoTable?.finalY || 120;
    doc.setFontSize(11);
    doc.setTextColor(30, 30, 30);
    doc.text("Route Events Timeline", 15, prevEnd + 12);

    autoTable(doc, {
      startY: prevEnd + 16,
      head: [["Event", "Time", "Coordinates", "Speed", "Zone"]],
      body: events,
      theme: "striped",
      headStyles: { fillColor: [10, 18, 32], textColor: [255, 255, 255], fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      margin: { left: 15, right: 15 },
    });
  }

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(`SOSphere Safety Platform — Confidential — Page ${i}/${pageCount}`, 105, 290, { align: "center" });
  }

  doc.save(`SOSphere_Trip_${trip.employeeName.replace(/\s/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// Leaflet Map Component — Connected to shared-store
// ═══════════════════════════════════════════════════════════════
function LiveMap({ selectedWorker, onSelectWorker, showTrip, tripData, replayIndex }: {
  selectedWorker: string | null;
  onSelectWorker: (id: string | null) => void;
  showTrip: string | null;
  tripData: EmployeeTrip | null;
  replayIndex: number; // -1 = no replay, 0+ = current waypoint
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const tripLineRef = useRef<L.Polyline | null>(null);
  const tripTrailRef = useRef<L.Polyline | null>(null);
  const tripMarkersRef = useRef<L.Marker[]>([]);
  const replayMarkerRef = useRef<L.Marker | null>(null);
  const zonesDrawnRef = useRef(false);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;
    const map = L.map(mapRef.current, {
      center: [24.7136, 46.6780], zoom: 16,
      zoomControl: false, attributionControl: false,
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 20, subdomains: "abcd",
    }).addTo(map);
    L.control.zoom({ position: "topright" }).addTo(map);

    const style = document.createElement("style");
    style.id = "sos-map-styles";
    style.textContent = `
      @keyframes sosPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.4);opacity:.6}}
      @keyframes tripPulse{0%,100%{opacity:1}50%{opacity:.4}}
      @keyframes replayGlow{0%,100%{box-shadow:0 0 8px #00C8E080,0 0 20px #00C8E040}50%{box-shadow:0 0 16px #00C8E0,0 0 40px #00C8E060}}
      .sos-tooltip .leaflet-tooltip-content{padding:0!important}
      .leaflet-tooltip.sos-tooltip{background:transparent!important;border:none!important;box-shadow:none!important;padding:0!important}
      .leaflet-tooltip.sos-tooltip::before{display:none!important}
      .leaflet-control-zoom a{background:rgba(10,18,32,.9)!important;color:rgba(255,255,255,.6)!important;border-color:rgba(0,200,224,.12)!important;font-family:Outfit!important;width:28px!important;height:28px!important;line-height:28px!important;font-size:14px!important}
      .leaflet-control-zoom a:hover{background:rgba(0,200,224,.12)!important;color:#00C8E0!important}
      .leaflet-control-zoom{border:1px solid rgba(0,200,224,.08)!important;border-radius:10px!important;overflow:hidden}
    `;
    document.head.appendChild(style);
    mapInstanceRef.current = map;
    return () => { map.remove(); mapInstanceRef.current = null; document.getElementById("sos-map-styles")?.remove(); };
  }, []);

  // Draw zones (once)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || zonesDrawnRef.current) return;
    zonesDrawnRef.current = true;
    const customZones = getZoneGPS();
    const zonesToDraw = customZones.length > 0
      ? customZones.map(z => {
          const def = DEFAULT_ZONES.find(d => d.id === z.id);
          return { ...z, risk: (def?.risk || "low") as "high" | "medium" | "low", center: [z.lat, z.lng] as [number, number], radius: z.radiusMeters, employees: def?.employees || 0, alerts: def?.alerts || 0 };
        })
      : DEFAULT_ZONES;
    zonesToDraw.forEach(zone => {
      const color = RISK_COLORS[zone.risk];
      L.circle(zone.center, {
        radius: zone.radius, color, fillColor: color, fillOpacity: 0.06, weight: 1.5, opacity: 0.4,
        dashArray: zone.risk === "high" ? "8,4" : undefined,
      }).addTo(map).bindTooltip(
        `<div style="background:rgba(10,18,32,.95);border:1px solid ${color}35;border-radius:12px;padding:10px 14px;color:white;font-family:Outfit;backdrop-filter:blur(12px);">
          <div style="font-weight:700;font-size:12px;margin-bottom:3px;">${zone.name}</div>
          <div style="font-size:10px;color:rgba(255,255,255,.35);">${zone.employees} workers · ${zone.alerts} alerts · ${zone.risk} risk</div>
        </div>`, { className: "sos-tooltip", direction: "top", offset: [0, -10] }
      );
    });
  }, []);

  // Update worker markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const workers = getLiveWorkerPositions();
    workers.forEach(worker => {
      const color = STATUS_COLORS[worker.status] || "#00C8E0";
      const isSOSActive = worker.status === "sos";
      const isSelected = selectedWorker === worker.id;
      const size = isSOSActive ? 20 : isSelected ? 16 : 12;
      const icon = L.divIcon({
        className: "custom-worker-marker",
        html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};box-shadow:0 0 ${isSOSActive ? 18 : isSelected ? 12 : 6}px ${color}80${isSOSActive ? `,0 0 30px ${color}40` : ""};border:${isSOSActive ? 3 : 2}px solid ${isSOSActive ? "#fff" : isSelected ? "#fff" : `${color}50`};${isSOSActive ? "animation:sosPulse .8s ease infinite;" : ""}transition:all .3s ease;"></div>`,
        iconSize: [size, size], iconAnchor: [size / 2, size / 2],
      });
      const existing = markersRef.current.get(worker.id);
      if (existing) { existing.setLatLng([worker.lat, worker.lng]); existing.setIcon(icon); }
      else {
        const marker = L.marker([worker.lat, worker.lng], { icon }).addTo(map);
        marker.bindTooltip(
          `<div style="background:rgba(10,18,32,.95);border:1px solid ${color}35;border-radius:12px;padding:10px 14px;color:white;font-family:Outfit;min-width:160px;backdrop-filter:blur(12px);">
            <div style="font-weight:700;font-size:12px;margin-bottom:2px;">${worker.name}</div>
            <div style="font-size:10px;color:rgba(255,255,255,.35);margin-bottom:5px;">${worker.role} · ${worker.zone}</div>
            <div style="display:flex;gap:10px;font-size:9px;align-items:center;">
              <span style="color:${color};font-weight:700;">${worker.status === "sos" ? "SOS ACTIVE" : worker.status === "late" ? "LATE CHECK-IN" : "ON SHIFT"}</span>
              <span style="color:rgba(255,255,255,.25);">${worker.battery}%</span>
              ${worker.speed > 0 ? `<span style="color:rgba(255,255,255,.25);">${worker.speed.toFixed(1)} km/h</span>` : ""}
            </div>
          </div>`, { className: "sos-tooltip", direction: "top", offset: [0, -14] }
        );
        marker.on("click", () => onSelectWorker(worker.id === selectedWorker ? null : worker.id));
        markersRef.current.set(worker.id, marker);
      }
    });
  }, [selectedWorker, onSelectWorker]);

  // Draw trip route
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    // Clear previous
    if (tripLineRef.current) { map.removeLayer(tripLineRef.current); tripLineRef.current = null; }
    if (tripTrailRef.current) { map.removeLayer(tripTrailRef.current); tripTrailRef.current = null; }
    tripMarkersRef.current.forEach(m => map.removeLayer(m));
    tripMarkersRef.current = [];
    if (replayMarkerRef.current) { map.removeLayer(replayMarkerRef.current); replayMarkerRef.current = null; }

    if (!showTrip || !tripData) return;

    const color = tripData.status === "active" ? "#00C8E0" : "#00C853";
    const points: [number, number][] = tripData.waypoints.map(w => [w.lat, w.lng]);

    // Full route (dimmed during replay)
    const line = L.polyline(points, {
      color, weight: replayIndex >= 0 ? 2 : 3, opacity: replayIndex >= 0 ? 0.2 : 0.7,
      dashArray: tripData.status === "active" ? "8,6" : undefined, lineCap: "round", lineJoin: "round",
    }).addTo(map);
    tripLineRef.current = line;

    // Replay trail (bright portion up to replayIndex)
    if (replayIndex >= 0) {
      const trailPoints = points.slice(0, replayIndex + 1);
      if (trailPoints.length > 1) {
        const trail = L.polyline(trailPoints, {
          color: "#00C8E0", weight: 4, opacity: 0.9, lineCap: "round", lineJoin: "round",
        }).addTo(map);
        tripTrailRef.current = trail;
      }

      // Replay cursor marker
      const wp = tripData.waypoints[replayIndex];
      if (wp) {
        const replayIcon = L.divIcon({
          className: "replay-cursor",
          html: `<div style="width:18px;height:18px;border-radius:50%;background:#00C8E0;border:3px solid #fff;box-shadow:0 0 16px #00C8E080,0 0 30px #00C8E040;animation:replayGlow 1.5s ease infinite;"></div>`,
          iconSize: [18, 18], iconAnchor: [9, 9],
        });
        const rm = L.marker([wp.lat, wp.lng], { icon: replayIcon, zIndexOffset: 1000 }).addTo(map);
        const timeStr = new Date(wp.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        rm.bindTooltip(
          `<div style="background:rgba(10,18,32,.95);border:1px solid rgba(0,200,224,.35);border-radius:10px;padding:8px 12px;color:white;font-family:Outfit;">
            <div style="font-weight:700;font-size:11px;color:#00C8E0;">REPLAY ${replayIndex + 1}/${tripData.waypoints.length}</div>
            <div style="font-size:9px;color:rgba(255,255,255,.35);">${timeStr}${wp.speed ? ` · ${wp.speed} km/h` : ""}${wp.event ? ` · ${wp.event.replace("_", " ")}` : ""}</div>
          </div>`, { className: "sos-tooltip", direction: "top", offset: [0, -14], permanent: true }
        );
        replayMarkerRef.current = rm;
        map.panTo([wp.lat, wp.lng], { animate: true, duration: 0.5 });
      }
    }

    // Event markers
    tripData.waypoints.forEach((wp) => {
      if (!wp.event || wp.event === "idle") return;
      const eventColors: Record<string, string> = { start: "#00C853", stop: "#8090A5", checkpoint: "#00C8E0", geofence_enter: "#00C853", geofence_exit: "#FF9500", sos: "#FF2D55" };
      const eventIcons: Record<string, string> = { start: "▶", stop: "■", checkpoint: "◆", geofence_enter: "→", geofence_exit: "←", sos: "!" };
      const ec = eventColors[wp.event] || "#00C8E0";
      const eIcon = eventIcons[wp.event] || "•";
      const marker = L.marker([wp.lat, wp.lng], {
        icon: L.divIcon({
          className: "trip-event-marker",
          html: `<div style="width:22px;height:22px;border-radius:8px;background:${ec}20;border:2px solid ${ec};display:flex;align-items:center;justify-content:center;font-size:10px;color:${ec};font-weight:800;box-shadow:0 0 10px ${ec}40;${wp.event === "sos" ? "animation:sosPulse .8s ease infinite;" : ""}">${eIcon}</div>`,
          iconSize: [22, 22], iconAnchor: [11, 11],
        }),
      }).addTo(map);
      const timeStr = new Date(wp.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      marker.bindTooltip(
        `<div style="background:rgba(10,18,32,.95);border:1px solid ${ec}35;border-radius:10px;padding:8px 12px;color:white;font-family:Outfit;">
          <div style="font-weight:700;font-size:11px;color:${ec};margin-bottom:2px;">${wp.event.replace("_", " ").toUpperCase()}</div>
          <div style="font-size:9px;color:rgba(255,255,255,.35);">${timeStr}${wp.speed ? ` · ${wp.speed} km/h` : ""}${wp.zoneName ? ` · ${wp.zoneName}` : ""}</div>
        </div>`, { className: "sos-tooltip", direction: "top", offset: [0, -14] }
      );
      tripMarkersRef.current.push(marker);
    });

    // Fit bounds
    if (points.length > 1 && replayIndex < 0) {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 17 });
    }
  }, [showTrip, tripData, replayIndex]);

  return <div ref={mapRef} className="w-full h-full" style={{ borderRadius: "inherit" }} />;
}

// ═══════════════════════════════════════════════════════════════
// Futuristic Feature Card (WIYAK-style)
// ═══════════════════════════════════════════════════════════════
function FeatureCard({ icon: Icon, title, value, sub, color, pulse }: {
  icon: any; title: string; value: string | number; sub?: string;
  color: string; pulse?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl p-4 text-left"
      style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0.008) 100%)",
        border: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${color}15, transparent)` }} />
      <div className="relative mb-3">
        <div className="size-11 rounded-[14px] flex items-center justify-center relative"
          style={{ background: `linear-gradient(135deg, ${color}18 0%, ${color}06 100%)`, border: `1px solid ${color}18`, boxShadow: `0 0 16px ${color}10` }}>
          <Icon className="size-5" style={{ color, strokeWidth: 1.6 }} />
          {pulse && (
            <motion.div animate={{ scale: [1, 1.7, 1], opacity: [0.3, 0, 0.3] }} transition={{ duration: 2, repeat: Infinity }}
              className="absolute inset-0 rounded-[14px]" style={{ border: `2px solid ${color}25` }} />
          )}
        </div>
      </div>
      <p style={{ fontSize: 22, fontWeight: 800, color, letterSpacing: "-0.03em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</p>
      <p className="mt-1.5" style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.65)", letterSpacing: "-0.01em" }}>{title}</p>
      {sub && <p className="mt-0.5" style={{ fontSize: 9.5, color: "rgba(255,255,255,0.22)" }}>{sub}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Trip Replay Controls — Cinema-style playback bar
// ═══════════════════════════════════════════════════════════════
function TripReplayBar({ trip, replayIndex, isPlaying, speed, onPlay, onPause, onReset, onSpeedChange, onSeek }: {
  trip: EmployeeTrip; replayIndex: number; isPlaying: boolean; speed: number;
  onPlay: () => void; onPause: () => void; onReset: () => void;
  onSpeedChange: () => void; onSeek: (idx: number) => void;
}) {
  const total = trip.waypoints.length;
  const pct = total > 0 ? ((replayIndex + 1) / total) * 100 : 0;
  const currentWp = trip.waypoints[replayIndex];
  const timeStr = currentWp ? new Date(currentWp.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="absolute bottom-16 left-4 right-[356px] z-20"
    >
      <div className="rounded-2xl overflow-hidden" style={{
        background: "rgba(10,18,32,0.92)", border: "1px solid rgba(0,200,224,0.12)",
        backdropFilter: "blur(16px)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}>
        <div className="absolute top-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(0,200,224,0.3), transparent)" }} />

        {/* Progress bar */}
        <div className="px-4 pt-3">
          <div className="relative h-1.5 rounded-full overflow-hidden cursor-pointer"
            style={{ background: "rgba(255,255,255,0.06)" }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const idx = Math.round((x / rect.width) * (total - 1));
              onSeek(Math.max(0, Math.min(total - 1, idx)));
            }}>
            <motion.div className="absolute top-0 left-0 h-full rounded-full"
              style={{ width: `${pct}%`, background: "linear-gradient(90deg, #00C853, #00C8E0)" }}
              layout transition={{ duration: 0.3 }} />
            <motion.div
              className="absolute top-1/2 -translate-y-1/2 size-3 rounded-full"
              style={{ left: `${pct}%`, marginLeft: -6, background: "#00C8E0", border: "2px solid #fff", boxShadow: "0 0 8px #00C8E080" }}
              layout transition={{ duration: 0.3 }} />
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button onClick={onReset} className="size-7 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors">
            <RotateCcw className="size-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
          </button>
          <button onClick={isPlaying ? onPause : onPlay}
            className="size-9 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(0,200,224,0.15)", border: "1px solid rgba(0,200,224,0.2)" }}>
            {isPlaying
              ? <Pause className="size-4" style={{ color: "#00C8E0" }} />
              : <Play className="size-4" style={{ color: "#00C8E0", marginLeft: 1 }} />}
          </button>
          <button onClick={onSpeedChange} className="px-2.5 py-1 rounded-lg hover:bg-white/5 transition-colors"
            style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#FF9500" }}>{speed}x</span>
          </button>

          <div className="flex-1 flex items-center justify-center gap-3">
            <span style={{ fontSize: 11, fontWeight: 600, color: "#00C8E0", fontVariantNumeric: "tabular-nums" }}>{timeStr}</span>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>|</span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontVariantNumeric: "tabular-nums" }}>
              Waypoint {replayIndex + 1} / {total}
            </span>
            {currentWp?.speed != null && (
              <>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>|</span>
                <div className="flex items-center gap-1">
                  <Gauge className="size-3" style={{ color: "rgba(255,255,255,0.25)" }} />
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontVariantNumeric: "tabular-nums" }}>{currentWp.speed} km/h</span>
                </div>
              </>
            )}
            {currentWp?.event && (
              <>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>|</span>
                <span className="px-1.5 py-0.5 rounded-md" style={{
                  fontSize: 8, fontWeight: 700,
                  color: currentWp.event === "sos" ? "#FF2D55" : "#00C8E0",
                  background: currentWp.event === "sos" ? "rgba(255,45,85,0.12)" : "rgba(0,200,224,0.08)",
                }}>{currentWp.event.replace("_", " ").toUpperCase()}</span>
              </>
            )}
          </div>

          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>{trip.employeeName}</span>
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Live Weather Sensor Panel
// ═══════════════════════════════════════════════════════════════
function WeatherSensorPanel({ weather }: { weather: WeatherData }) {
  const condIcon = weather.condition.includes("Rain") ? CloudRain : weather.condition.includes("Clear") ? Sun : Wind;
  const tempColor = weather.temp > 42 ? "#FF2D55" : weather.temp > 35 ? "#FF9500" : "#00C853";
  const visColor = weather.visibility === "Good" ? "#00C853" : weather.visibility === "Moderate" ? "#FF9500" : "#FF2D55";
  const uvColor = weather.uvIndex > 8 ? "#FF2D55" : weather.uvIndex > 5 ? "#FF9500" : "#00C853";

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(255,149,0,0.1)", border: "1px solid rgba(255,149,0,0.15)" }}>
            <condIcon className="size-3.5" style={{ color: "#FF9500", strokeWidth: 1.8 }} />
          </div>
          <div>
            <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.9)", letterSpacing: "-0.01em" }}>Environment</span>
            <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>{weather.condition} · Updated {new Date(weather.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
          </div>
        </div>
        <motion.div animate={{ rotate: [0, 360] }} transition={{ duration: 20, repeat: Infinity, ease: "linear" }}>
          <Sun className="size-3" style={{ color: "rgba(255,255,255,0.08)" }} />
        </motion.div>
      </div>

      {/* Main sensors grid */}
      <div className="grid grid-cols-3 gap-2 p-3">
        {[
          { icon: Thermometer, label: "Temperature", value: `${weather.temp}°C`, sub: `Feels ${weather.feelsLike}°C`, color: tempColor },
          { icon: Droplets, label: "Humidity", value: `${weather.humidity}%`, sub: weather.humidity > 60 ? "High" : "Normal", color: "#00C8E0" },
          { icon: Wind, label: "Wind", value: `${weather.windSpeed}km/h`, sub: weather.windDir, color: "#00C8E0" },
          { icon: Eye, label: "Visibility", value: weather.visibility, sub: `${weather.pressure}hPa`, color: visColor },
          { icon: Sun, label: "UV Index", value: `${weather.uvIndex}`, sub: weather.uvIndex > 8 ? "Extreme" : weather.uvIndex > 5 ? "High" : "Low", color: uvColor },
          { icon: Gauge, label: "Pressure", value: `${weather.pressure}`, sub: "hPa", color: "rgba(255,255,255,0.4)" },
        ].map(s => (
          <div key={s.label} className="text-center p-2.5 rounded-xl" style={{
            background: `linear-gradient(135deg, ${s.color}06, transparent)`, border: `1px solid ${s.color}08`,
          }}>
            <div className="size-6 rounded-lg flex items-center justify-center mx-auto mb-1.5"
              style={{ background: `${s.color}10`, border: `1px solid ${s.color}12` }}>
              <s.icon className="size-3" style={{ color: s.color, strokeWidth: 1.6 }} />
            </div>
            <p style={{ fontSize: 12, fontWeight: 700, color: s.color, fontVariantNumeric: "tabular-nums" }}>{s.value}</p>
            <p style={{ fontSize: 7, color: "rgba(255,255,255,0.2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</p>
            {s.sub && <p style={{ fontSize: 7, color: "rgba(255,255,255,0.12)", marginTop: 1 }}>{s.sub}</p>}
          </div>
        ))}
      </div>

      {/* Heat index warning */}
      {weather.temp > 40 && (
        <div className="mx-3 mb-3 flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.1)" }}>
          <AlertTriangle className="size-3.5 shrink-0" style={{ color: "#FF2D55" }} />
          <span style={{ fontSize: 9, color: "#FF2D55", fontWeight: 600 }}>
            Heat Stress Warning — Temp {weather.temp}°C exceeds safety threshold. Ensure hydration breaks.
          </span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Trip Tracking Panel — WIYAK GPS-style
// ═══════════════════════════════════════════════════════════════
function TripTrackingPanel({ trips, selectedTrip, onSelectTrip, onReplay, onExportPDF }: {
  trips: EmployeeTrip[]; selectedTrip: string | null;
  onSelectTrip: (empId: string | null) => void;
  onReplay: (empId: string) => void;
  onExportPDF: (trip: EmployeeTrip) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const activeTrips = trips.filter(t => t.status === "active");
  const completedTrips = trips.filter(t => t.status === "completed");

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3"
        style={{ borderBottom: expanded ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.15)" }}>
            <Route className="size-3.5" style={{ color: "#00C8E0", strokeWidth: 1.8 }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.9)", letterSpacing: "-0.01em" }}>Trip Tracking</span>
          <span className="px-2 py-0.5 rounded-md" style={{ fontSize: 9, fontWeight: 700, color: "#00C8E0", background: "rgba(0,200,224,0.08)" }}>
            {activeTrips.length} active
          </span>
        </div>
        {expanded ? <ChevronUp className="size-3.5" style={{ color: "rgba(255,255,255,0.2)" }} /> : <ChevronDown className="size-3.5" style={{ color: "rgba(255,255,255,0.2)" }} />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }} className="overflow-hidden">
            {[...activeTrips, ...completedTrips].map(trip => {
              const isSelected = selectedTrip === trip.employeeId;
              const duration = trip.endedAt ? Math.round((trip.endedAt - trip.startedAt) / 60000) : Math.round((Date.now() - trip.startedAt) / 60000);
              const statusColor = trip.waypoints.some(w => w.event === "sos") ? "#FF2D55" : trip.status === "completed" ? "#8090A5" : "#00C8E0";
              const isDone = trip.status === "completed";

              return (
                <motion.div key={trip.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", opacity: isDone ? 0.6 : 1 }}>
                  <button onClick={() => onSelectTrip(isSelected ? null : trip.employeeId)}
                    className="w-full text-left">
                    <div className="px-4 py-3 flex items-center gap-3"
                      style={{ background: isSelected ? `${statusColor}06` : "transparent" }}>
                      <div className="flex flex-col items-center gap-0.5 shrink-0">
                        <div className="size-2.5 rounded-full" style={{ background: "#00C853", boxShadow: "0 0 4px rgba(0,200,83,0.5)" }} />
                        <div className="w-px h-5" style={{ background: `linear-gradient(to bottom, #00C853, ${statusColor})` }} />
                        <motion.div animate={!isDone ? { scale: [1, 1.3, 1] } : {}} transition={{ duration: 1.5, repeat: Infinity }}
                          className="size-2.5 rounded-full" style={{ background: statusColor, boxShadow: `0 0 4px ${statusColor}60` }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-white truncate" style={{ fontSize: 12, fontWeight: 600, letterSpacing: "-0.01em" }}>{trip.employeeName}</p>
                          <span className="px-1.5 py-0.5 rounded-md shrink-0" style={{
                            fontSize: 8, fontWeight: 700, color: statusColor, background: `${statusColor}12`,
                            animation: !isDone ? "tripPulse 2s ease infinite" : "none",
                          }}>{isDone ? "DONE" : "LIVE"}</span>
                        </div>
                        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>
                          {trip.zone} · {duration}m · {trip.totalDistanceKm}km
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <div className="flex items-center gap-1">
                          <Gauge className="size-2.5" style={{ color: "rgba(255,255,255,0.2)" }} />
                          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontVariantNumeric: "tabular-nums" }}>{trip.avgSpeedKmh} km/h</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Flag className="size-2.5" style={{ color: "rgba(255,255,255,0.2)" }} />
                          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{trip.checkpoints} pts</span>
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Expanded */}
                  {isSelected && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="px-4 pb-3">
                      <div className="grid grid-cols-4 gap-2 mt-1">
                        {[
                          { label: "Distance", value: `${trip.totalDistanceKm}km`, icon: Route, color: "#00C8E0" },
                          { label: "Max Speed", value: `${trip.maxSpeedKmh}km/h`, icon: Gauge, color: "#FF9500" },
                          { label: "Idle", value: `${trip.idleTimeMinutes}m`, icon: Timer, color: "#FF2D55" },
                          { label: "Checkpts", value: `${trip.checkpoints}`, icon: CheckCircle2, color: "#00C853" },
                        ].map(s => (
                          <div key={s.label} className="text-center p-2 rounded-lg" style={{ background: `${s.color}06`, border: `1px solid ${s.color}08` }}>
                            <s.icon className="size-3 mx-auto mb-1" style={{ color: s.color }} />
                            <p style={{ fontSize: 11, fontWeight: 700, color: s.color }}>{s.value}</p>
                            <p style={{ fontSize: 7, color: "rgba(255,255,255,0.2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</p>
                          </div>
                        ))}
                      </div>

                      {/* Action Buttons: Replay + Export PDF */}
                      <div className="flex gap-2 mt-2">
                        <motion.button whileTap={{ scale: 0.95 }} onClick={() => onReplay(trip.employeeId)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl"
                          style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.12)" }}>
                          <Play className="size-3" style={{ color: "#00C8E0" }} />
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#00C8E0" }}>Replay Trip</span>
                        </motion.button>
                        <motion.button whileTap={{ scale: 0.95 }} onClick={() => onExportPDF(trip)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl"
                          style={{ background: "rgba(255,149,0,0.06)", border: "1px solid rgba(255,149,0,0.1)" }}>
                          <FileText className="size-3" style={{ color: "#FF9500" }} />
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#FF9500" }}>Export PDF</span>
                        </motion.button>
                      </div>

                      {/* Event Timeline */}
                      <div className="mt-2 space-y-1">
                        {trip.waypoints.filter(w => w.event && w.event !== "idle").map((wp, i) => {
                          const ec = wp.event === "sos" ? "#FF2D55" : wp.event === "start" ? "#00C853" : wp.event === "stop" ? "#8090A5" : wp.event === "geofence_exit" ? "#FF9500" : "#00C8E0";
                          return (
                            <div key={i} className="flex items-center gap-2 px-2 py-1 rounded-md" style={{ background: `${ec}05` }}>
                              <div className="size-1.5 rounded-full" style={{ background: ec }} />
                              <span style={{ fontSize: 9, color: ec, fontWeight: 600 }}>{wp.event?.replace("_", " ").toUpperCase()}</span>
                              <span className="ml-auto" style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", fontVariantNumeric: "tabular-nums" }}>
                                {new Date(wp.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Worker Detail Panel (connected to shared-store)
// ═══════════════════════════════════════════════════════════════
function WorkerDetailPanel({ worker, trip, onShowTrip, onReplay, onExportPDF }: {
  worker: ReturnType<typeof getLiveWorkerPositions>[0];
  trip: EmployeeTrip | null;
  onShowTrip: () => void; onReplay: () => void; onExportPDF: () => void;
}) {
  const color = STATUS_COLORS[worker.status] || "#00C8E0";
  const batteryColor = worker.battery > 50 ? "#00C853" : worker.battery > 20 ? "#FF9500" : "#FF2D55";

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
      className="rounded-2xl overflow-hidden"
      style={{ background: "linear-gradient(135deg, rgba(10,18,32,0.95), rgba(5,7,14,0.95))",
        border: `1px solid ${color}20`, backdropFilter: "blur(20px)", boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 16px ${color}06` }}>
      <div className="relative px-4 pt-4 pb-3">
        <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${color}45, transparent)` }} />
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl flex items-center justify-center"
            style={{ background: `${color}15`, border: `1px solid ${color}20`, boxShadow: `0 0 10px ${color}10` }}>
            <span style={{ fontSize: 14, fontWeight: 800, color }}>{worker.name.charAt(0)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white" style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>{worker.name}</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{worker.role} · {worker.zone}</p>
          </div>
          <span className="px-2.5 py-1 rounded-lg" style={{ fontSize: 9, fontWeight: 800, color, background: `${color}12`, border: `1px solid ${color}18`, letterSpacing: "0.05em" }}>
            {worker.status === "sos" ? "SOS" : worker.status === "late" ? "LATE" : "OK"}
          </span>
        </div>
      </div>

      <div className="px-4 pb-3 grid grid-cols-4 gap-2">
        {[
          { icon: Zap, label: "Battery", value: `${worker.battery}%`, color: batteryColor },
          { icon: Wifi, label: "Signal", value: worker.signal, color: worker.signal === "strong" ? "#00C853" : "#FF9500" },
          { icon: Gauge, label: "Speed", value: worker.speed > 0 ? `${worker.speed.toFixed(1)}` : "0", color: "#00C8E0" },
          { icon: MapPin, label: "GPS", value: "Live", color: "#00C8E0" },
        ].map(s => (
          <div key={s.label} className="text-center p-2 rounded-xl" style={{ background: `${s.color}05`, border: `1px solid ${s.color}08` }}>
            <s.icon className="size-3 mx-auto mb-1" style={{ color: s.color }} />
            <p style={{ fontSize: 11, fontWeight: 700, color: s.color }}>{s.value}</p>
            <p style={{ fontSize: 7, color: "rgba(255,255,255,0.2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</p>
          </div>
        ))}
      </div>

      <div className="px-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LocateFixed className="size-3" style={{ color: "rgba(0,200,224,0.35)" }} />
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.18)", fontVariantNumeric: "tabular-nums", fontFamily: "monospace" }}>
            {worker.lat.toFixed(4)}N, {worker.lng.toFixed(4)}E
          </span>
        </div>
      </div>

      {/* Quick Actions */}
      {worker.hasTrip && (
        <div className="px-4 pb-3 flex gap-2">
          <motion.button whileTap={{ scale: 0.95 }} onClick={onShowTrip}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl"
            style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.1)" }}>
            <Route className="size-3" style={{ color: "#00C8E0" }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: "#00C8E0" }}>Route</span>
          </motion.button>
          <motion.button whileTap={{ scale: 0.95 }} onClick={onReplay}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl"
            style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.1)" }}>
            <Play className="size-3" style={{ color: "#00C8E0" }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: "#00C8E0" }}>Replay</span>
          </motion.button>
          <motion.button whileTap={{ scale: 0.95 }} onClick={onExportPDF}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl"
            style={{ background: "rgba(255,149,0,0.06)", border: "1px solid rgba(255,149,0,0.1)" }}>
            <Download className="size-3" style={{ color: "#FF9500" }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: "#FF9500" }}>PDF</span>
          </motion.button>
        </div>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Risk Map Page
// ═══════════════════════════════════════════════════════════════
export function RiskMapLivePage({ t }: RiskMapLiveProps) {
  const [workers, setWorkers] = useState(() => getLiveWorkerPositions());
  const [trips, setTrips] = useState(() => getActiveTrips());
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);
  const [showTrip, setShowTrip] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [weather, setWeather] = useState(() => generateWeather(Date.now()));

  // Replay state
  const [replayTripId, setReplayTripId] = useState<string | null>(null);
  const [replayIndex, setReplayIndex] = useState(-1);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const replayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const replayTrip = replayTripId ? getEmployeeTrip(replayTripId) : null;

  // Refresh data periodically
  useEffect(() => {
    const iv = setInterval(() => {
      setNow(Date.now());
      setWorkers(getLiveWorkerPositions());
      setWeather(generateWeather(Date.now()));
    }, 5000);
    return () => clearInterval(iv);
  }, []);

  // Listen for sync events
  useEffect(() => {
    return onSyncEvent((event) => {
      if (event.type === "SOS_TRIGGERED" || event.type === "LOCATION_UPDATE" || event.type === "CHECKIN") {
        setWorkers(getLiveWorkerPositions());
        setTrips(getActiveTrips());
      }
    });
  }, []);

  // Replay animation timer
  useEffect(() => {
    if (replayTimerRef.current) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    if (!replayPlaying || !replayTrip) return;

    const interval = Math.max(200, 1000 / replaySpeed);
    replayTimerRef.current = setInterval(() => {
      setReplayIndex(prev => {
        if (prev >= (replayTrip?.waypoints.length || 0) - 1) {
          setReplayPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, interval);

    return () => { if (replayTimerRef.current) clearInterval(replayTimerRef.current); };
  }, [replayPlaying, replaySpeed, replayTrip]);

  const startReplay = (empId: string) => {
    setReplayTripId(empId);
    setShowTrip(empId);
    setSelectedWorker(empId);
    setReplayIndex(0);
    setReplayPlaying(true);
    setReplaySpeed(1);
  };

  const sosCount = workers.filter(w => w.status === "sos").length;
  const activeCount = workers.filter(w => w.status === "active").length;
  const selectedW = workers.find(w => w.id === selectedWorker);
  const selectedTripData = showTrip ? getEmployeeTrip(showTrip) : null;

  const handleSelectWorker = useCallback((id: string | null) => setSelectedWorker(id), []);

  return (
    <div className="flex flex-col" style={{ background: "#050710", minHeight: "calc(100vh - 120px)" }}>
      {/* ── Live Status Ribbon ── */}
      <div className="flex items-center gap-3 px-5 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <motion.div animate={{ scale: [1, 1.4, 1], opacity: [1, 0.4, 1] }} transition={{ duration: 1.5, repeat: Infinity }}
          className="size-2 rounded-full" style={{ background: sosCount > 0 ? "#FF2D55" : "#00C853", boxShadow: `0 0 8px ${sosCount > 0 ? "#FF2D55" : "#00C853"}70` }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: sosCount > 0 ? "#FF2D55" : "#00C853", letterSpacing: "0.04em" }}>
          {sosCount > 0 ? `${sosCount} SOS ACTIVE` : "ALL CLEAR"} · LIVE TRACKING
        </span>
        <div className="flex items-center gap-4 ml-auto">
          {weather.temp > 40 && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg" style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.1)" }}>
              <Thermometer className="size-3" style={{ color: "#FF2D55" }} />
              <span style={{ fontSize: 9, fontWeight: 700, color: "#FF2D55" }}>{weather.temp}°C</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <Satellite className="size-3" style={{ color: "rgba(0,200,224,0.35)" }} />
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.22)", fontWeight: 500 }}>GPS synced</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Users className="size-3" style={{ color: "rgba(0,200,224,0.35)" }} />
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.22)", fontWeight: 500 }}>{workers.length} tracked</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="size-3" style={{ color: "rgba(0,200,224,0.35)" }} />
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.22)", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
              {new Date(now).toLocaleTimeString()}
            </span>
          </div>
        </div>
      </div>

      {/* ── Main Content: Map + Sidebar ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Map Area */}
        <div className="flex-1 relative">
          <div className="absolute inset-0 overflow-hidden">
            <LiveMap selectedWorker={selectedWorker} onSelectWorker={handleSelectWorker}
              showTrip={showTrip} tripData={selectedTripData}
              replayIndex={replayTripId === showTrip ? replayIndex : -1} />
          </div>

          {/* HUD corners */}
          {[
            { pos: "top-3 left-3", border: "borderTop,borderLeft" },
            { pos: "top-3 right-14", border: "borderTop,borderRight" },
            { pos: "bottom-3 left-3", border: "borderBottom,borderLeft" },
            { pos: "bottom-3 right-3", border: "borderBottom,borderRight" },
          ].map((c, i) => {
            const borders = c.border.split(",");
            return (
              <div key={i} className={`absolute ${c.pos} pointer-events-none`}>
                <div className="size-4" style={{
                  ...(borders.includes("borderTop") ? { borderTop: "2px solid rgba(0,200,224,0.25)" } : {}),
                  ...(borders.includes("borderBottom") ? { borderBottom: "2px solid rgba(0,200,224,0.25)" } : {}),
                  ...(borders.includes("borderLeft") ? { borderLeft: "2px solid rgba(0,200,224,0.25)" } : {}),
                  ...(borders.includes("borderRight") ? { borderRight: "2px solid rgba(0,200,224,0.25)" } : {}),
                }} />
              </div>
            );
          })}

          {/* Scan line */}
          <motion.div className="absolute left-0 right-0 h-px pointer-events-none"
            style={{ background: "linear-gradient(90deg, transparent, rgba(0,200,224,0.12), transparent)" }}
            animate={{ top: ["0%", "100%"] }} transition={{ duration: 8, repeat: Infinity, ease: "linear" }} />

          {/* Trip indicator */}
          {showTrip && !replayTripId && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
              className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-xl z-10"
              style={{ background: "rgba(10,18,32,0.9)", border: "1px solid rgba(0,200,224,0.15)", backdropFilter: "blur(8px)" }}>
              <motion.div animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.5, repeat: Infinity }}
                className="size-2 rounded-full" style={{ background: "#00C8E0" }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "#00C8E0" }}>
                Viewing route: {selectedTripData?.employeeName}
              </span>
              <button onClick={() => { setShowTrip(null); setReplayTripId(null); setReplayPlaying(false); }}
                className="ml-2 px-2 py-0.5 rounded-md"
                style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.05)" }}>
                Close
              </button>
            </motion.div>
          )}

          {/* Trip Replay Bar */}
          <AnimatePresence>
            {replayTripId && replayTrip && (
              <TripReplayBar
                trip={replayTrip}
                replayIndex={replayIndex}
                isPlaying={replayPlaying}
                speed={replaySpeed}
                onPlay={() => {
                  if (replayIndex >= replayTrip.waypoints.length - 1) setReplayIndex(0);
                  setReplayPlaying(true);
                }}
                onPause={() => setReplayPlaying(false)}
                onReset={() => { setReplayIndex(0); setReplayPlaying(false); }}
                onSpeedChange={() => setReplaySpeed(prev => prev >= 4 ? 1 : prev * 2)}
                onSeek={(idx) => { setReplayIndex(idx); setReplayPlaying(false); }}
              />
            )}
          </AnimatePresence>

          {/* Legend */}
          <div className="absolute bottom-4 left-4 flex gap-1.5">
            {[
              { label: "Active", color: "#00C8E0" },
              { label: "Late", color: "#FF9500" },
              { label: "SOS", color: "#FF2D55" },
            ].map(l => (
              <div key={l.label} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                style={{ background: "rgba(10,18,32,0.85)", border: "1px solid rgba(255,255,255,0.05)", backdropFilter: "blur(8px)" }}>
                <div className="size-2 rounded-full" style={{ background: l.color, boxShadow: `0 0 5px ${l.color}50` }} />
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", fontWeight: 600 }}>{l.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right Sidebar ── */}
        <div className="w-[340px] flex-shrink-0 overflow-y-auto p-4 space-y-4" style={{ borderLeft: "1px solid rgba(255,255,255,0.04)", scrollbarWidth: "none" }}>
          {/* Feature Cards */}
          <div className="grid grid-cols-2 gap-3">
            <FeatureCard icon={Navigation} title="Live Tracking" value={activeCount} sub="Workers on duty" color="#00C8E0" />
            <FeatureCard icon={AlertTriangle} title="SOS Alerts" value={sosCount} sub={sosCount > 0 ? "Requires action" : "All clear"} color="#FF2D55" pulse={sosCount > 0} />
            <FeatureCard icon={Shield} title="Zones Active" value={DEFAULT_ZONES.length} sub={`${DEFAULT_ZONES.filter(z => z.risk === "high").length} high risk`} color="#00C853" />
            <FeatureCard icon={Route} title="Active Trips" value={trips.filter(t => t.status === "active").length} sub={`${trips.filter(t => t.status === "completed").length} completed`} color="#FF9500" />
          </div>

          {/* Worker Detail */}
          <AnimatePresence>
            {selectedW && (
              <WorkerDetailPanel worker={selectedW} trip={getEmployeeTrip(selectedW.id)}
                onShowTrip={() => setShowTrip(selectedW.id)}
                onReplay={() => startReplay(selectedW.id)}
                onExportPDF={() => { const t = getEmployeeTrip(selectedW.id); if (t) exportTripPDF(t); }}
              />
            )}
          </AnimatePresence>

          {/* Trip Tracking */}
          <TripTrackingPanel trips={trips} selectedTrip={showTrip}
            onSelectTrip={(empId) => { setShowTrip(empId); if (empId) setSelectedWorker(empId); }}
            onReplay={startReplay}
            onExportPDF={exportTripPDF}
          />

          {/* Worker List */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <div className="flex items-center gap-2">
                <Users className="size-4" style={{ color: "#00C8E0", strokeWidth: 1.8 }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.9)", letterSpacing: "-0.01em" }}>Workers</span>
              </div>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.18)", fontWeight: 600 }}>{workers.length} total</span>
            </div>
            <div style={{ maxHeight: 220 }}>
              {[...workers].sort((a, b) => {
                const order: Record<string, number> = { sos: 0, late: 1, active: 2, offline: 3 };
                return (order[a.status] ?? 3) - (order[b.status] ?? 3);
              }).map(w => {
                const wColor = STATUS_COLORS[w.status] || "#00C8E0";
                const isSelected = selectedWorker === w.id;
                return (
                  <motion.button key={w.id} onClick={() => setSelectedWorker(isSelected ? null : w.id)} whileTap={{ scale: 0.98 }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.025)", background: isSelected ? `${wColor}06` : "transparent" }}>
                    <div className="relative">
                      <div className="size-7 rounded-[9px] flex items-center justify-center"
                        style={{ background: `${wColor}12`, border: `1px solid ${wColor}18` }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: wColor }}>{w.name.charAt(0)}</span>
                      </div>
                      <div className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border"
                        style={{ background: wColor, borderColor: "#0A1220", boxShadow: `0 0 4px ${wColor}50` }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white truncate" style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "-0.01em" }}>{w.name}</p>
                      <p style={{ fontSize: 9.5, color: "rgba(255,255,255,0.2)" }}>{w.zone}{w.speed > 0 ? ` · ${w.speed.toFixed(1)}km/h` : ""}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {w.hasTrip && <Route className="size-2.5" style={{ color: "rgba(0,200,224,0.3)" }} />}
                      <div className="flex items-center gap-1">
                        <Zap className="size-2.5" style={{ color: w.battery > 50 ? "#00C853" : "#FF9500" }} />
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", fontVariantNumeric: "tabular-nums" }}>{w.battery}%</span>
                      </div>
                      <span className="px-1.5 py-0.5 rounded-md" style={{ fontSize: 8, fontWeight: 700, color: wColor, background: `${wColor}10`, letterSpacing: "0.04em" }}>
                        {w.status === "sos" ? "SOS" : w.status === "late" ? "LATE" : "OK"}
                      </span>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>

          {/* Zone Risk */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <Layers className="size-4" style={{ color: "#FF9500", strokeWidth: 1.8 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>Zones</span>
            </div>
            {DEFAULT_ZONES.map(z => {
              const zColor = RISK_COLORS[z.risk];
              return (
                <div key={z.id} className="flex items-center gap-3 px-4 py-2.5"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.025)" }}>
                  <div className="size-2.5 rounded-full" style={{ background: zColor, boxShadow: `0 0 5px ${zColor}40` }} />
                  <span className="flex-1 truncate" style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>{z.name}</span>
                  <span style={{ fontSize: 9.5, color: "rgba(255,255,255,0.18)" }}>{z.employees}w</span>
                  {z.alerts > 0 && <span className="px-1.5 py-0.5 rounded-md" style={{ fontSize: 8, fontWeight: 800, color: "#fff", background: "#FF2D55" }}>{z.alerts}</span>}
                </div>
              );
            })}
          </div>

          {/* Live Weather Sensors */}
          <WeatherSensorPanel weather={weather} />
        </div>
      </div>
    </div>
  );
}
