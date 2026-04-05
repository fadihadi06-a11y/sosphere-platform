// ═══════════════════════════════════════════════════════════════
// SOSphere Dashboard — Geo-fencing Editor Page
// Interactive canvas-based zone editor with polygon/circle drawing,
// zone properties, alert rules, and employee tracking overlay
// ═══════════════════════════════════════════════════════════════
import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { MapPin, Plus, X, Trash2, Eye, EyeOff, Circle, Pentagon, AlertTriangle, Check, Save, Users, Shield, Layers, Move, ZoomIn, ZoomOut, Crosshair, Lock, Unlock, Copy, Search, Navigation, ChevronDown, ChevronUp } from "lucide-react";
// EMPLOYEES & ZONES removed — store reads via useDashboardStore when needed
import { saveZoneGPS, type ZoneGPSData } from "./shared-store";
import { supabase, SUPABASE_CONFIG } from "./api/supabase-client";
import { toast } from "sonner";
import { hapticSuccess } from "./haptic-feedback";

// ── Supabase Geofence Persistence ────────────────────────────
const GEOFENCE_LOCAL_KEY = "sosphere_geofences";

async function loadGeofencesFromDB(): Promise<GeoZone[] | null> {
  if (!SUPABASE_CONFIG.isConfigured) return null;
  try {
    const { data, error } = await supabase
      .from("geofences")
      .select("*")
      .order("created_at", { ascending: true });
    if (error || !data || data.length === 0) return null;
    return data.map((row: any) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      center: row.center,
      radius: row.radius,
      points: row.points,
      risk: row.risk,
      status: row.status,
      color: row.color,
      locked: row.locked,
      visible: row.visible,
      alerts: row.alerts,
      employeeCount: row.employee_count || 0,
    }));
  } catch { return null; }
}

async function saveGeofenceToDB(zone: GeoZone): Promise<void> {
  // Always cache locally
  const local = loadGeofencesLocal();
  const idx = local.findIndex(z => z.id === zone.id);
  if (idx >= 0) local[idx] = zone; else local.push(zone);
  localStorage.setItem(GEOFENCE_LOCAL_KEY, JSON.stringify(local));

  if (!SUPABASE_CONFIG.isConfigured) return;
  try {
    await supabase.from("geofences").upsert({
      id: zone.id,
      name: zone.name,
      type: zone.type,
      center: zone.center,
      radius: zone.radius || null,
      points: zone.points || null,
      risk: zone.risk,
      status: zone.status,
      color: zone.color,
      locked: zone.locked,
      visible: zone.visible,
      alerts: zone.alerts,
      employee_count: zone.employeeCount,
    }, { onConflict: "id" });
  } catch (e) {
    console.warn("[Geofence] Supabase save failed:", e);
  }
}

async function deleteGeofenceFromDB(id: string): Promise<void> {
  const local = loadGeofencesLocal().filter(z => z.id !== id);
  localStorage.setItem(GEOFENCE_LOCAL_KEY, JSON.stringify(local));

  if (!SUPABASE_CONFIG.isConfigured) return;
  try {
    await supabase.from("geofences").delete().eq("id", id);
  } catch (e) {
    console.warn("[Geofence] Supabase delete failed:", e);
  }
}

function loadGeofencesLocal(): GeoZone[] {
  try {
    return JSON.parse(localStorage.getItem(GEOFENCE_LOCAL_KEY) || "[]");
  } catch { return []; }
}

// ── Types ─────────────────────────────────────────────────────
type DrawMode = "select" | "circle" | "polygon" | "pan";
type RiskLevel = "high" | "medium" | "low";
type ZoneStatus = "active" | "restricted" | "evacuated";

interface GeoPoint {
  x: number;
  y: number;
}

interface GeoZone {
  id: string;
  name: string;
  type: "circle" | "polygon";
  center: GeoPoint;
  radius?: number; // for circle
  points?: GeoPoint[]; // for polygon
  risk: RiskLevel;
  status: ZoneStatus;
  color: string;
  locked: boolean;
  visible: boolean;
  alerts: {
    entryAlert: boolean;
    exitAlert: boolean;
    dwellAlert: boolean;
    dwellMinutes: number;
    maxCapacity: number;
  };
  employeeCount: number;
}

// ── Constants ─────────────────────────────────────────────────
const RISK_COLORS: Record<RiskLevel, string> = {
  high: "#FF2D55",
  medium: "#FF9500",
  low: "#00C853",
};

const STATUS_LABELS: Record<ZoneStatus, { label: string; color: string }> = {
  active: { label: "Active", color: "#00C853" },
  restricted: { label: "Restricted", color: "#FF9500" },
  evacuated: { label: "Evacuated", color: "#FF2D55" },
};

const INITIAL_ZONES: GeoZone[] = [
  {
    id: "GZ-1", name: "Zone A - North Gate", type: "polygon",
    center: { x: 280, y: 140 },
    points: [{ x: 200, y: 80 }, { x: 360, y: 80 }, { x: 380, y: 200 }, { x: 180, y: 200 }],
    risk: "medium", status: "active", color: "#FF9500", locked: false, visible: true,
    alerts: { entryAlert: true, exitAlert: true, dwellAlert: false, dwellMinutes: 30, maxCapacity: 25 },
    employeeCount: 12,
  },
  {
    id: "GZ-2", name: "Zone B - Control Room", type: "circle",
    center: { x: 520, y: 160 }, radius: 65,
    risk: "low", status: "active", color: "#00C853", locked: false, visible: true,
    alerts: { entryAlert: true, exitAlert: false, dwellAlert: false, dwellMinutes: 60, maxCapacity: 15 },
    employeeCount: 8,
  },
  {
    id: "GZ-3", name: "Zone C - Main Hall", type: "polygon",
    center: { x: 400, y: 330 },
    points: [{ x: 300, y: 270 }, { x: 500, y: 270 }, { x: 520, y: 390 }, { x: 280, y: 390 }],
    risk: "low", status: "active", color: "#00C8E0", locked: false, visible: true,
    alerts: { entryAlert: false, exitAlert: false, dwellAlert: true, dwellMinutes: 120, maxCapacity: 30 },
    employeeCount: 15,
  },
  {
    id: "GZ-4", name: "Zone D - Warehouse", type: "circle",
    center: { x: 180, y: 380 }, radius: 55,
    risk: "high", status: "restricted", color: "#FF2D55", locked: true, visible: true,
    alerts: { entryAlert: true, exitAlert: true, dwellAlert: true, dwellMinutes: 15, maxCapacity: 8 },
    employeeCount: 5,
  },
  {
    id: "GZ-5", name: "Zone E - Parking", type: "polygon",
    center: { x: 600, y: 400 },
    points: [{ x: 560, y: 350 }, { x: 680, y: 350 }, { x: 680, y: 450 }, { x: 560, y: 450 }],
    risk: "low", status: "active", color: "#4A90D9", locked: false, visible: true,
    alerts: { entryAlert: false, exitAlert: false, dwellAlert: false, dwellMinutes: 60, maxCapacity: 20 },
    employeeCount: 3,
  },
];

// Mock employee dots
const EMPLOYEE_DOTS = [
  { id: "E1", x: 250, y: 130, name: "Ahmed K.", zone: "GZ-1" },
  { id: "E2", x: 300, y: 160, name: "Omar F.", zone: "GZ-1" },
  { id: "E3", x: 520, y: 150, name: "Fatima H.", zone: "GZ-2" },
  { id: "E4", x: 540, y: 175, name: "Yusuf B.", zone: "GZ-2" },
  { id: "E5", x: 400, y: 320, name: "Sara M.", zone: "GZ-3" },
  { id: "E6", x: 430, y: 350, name: "Lina C.", zone: "GZ-3" },
  { id: "E7", x: 180, y: 370, name: "Mohammed A.", zone: "GZ-4" },
  { id: "E8", x: 620, y: 400, name: "Hassan J.", zone: "GZ-5" },
  { id: "E9", x: 270, y: 110, name: "Ali M.", zone: "GZ-1" },
  { id: "E10", x: 370, y: 300, name: "Rania A.", zone: "GZ-3" },
];

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════
export function GeofencingPage({ t, webMode = false }: { t: (k: string) => string; webMode?: boolean }) {
  const [zones, setZones] = useState<GeoZone[]>(INITIAL_ZONES);
  const [zonesLoaded, setZonesLoaded] = useState(false);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>("GZ-1");

  // Load zones from Supabase on mount (fallback: localStorage → INITIAL_ZONES)
  useEffect(() => {
    if (zonesLoaded) return;
    (async () => {
      // Try Supabase first
      const dbZones = await loadGeofencesFromDB();
      if (dbZones && dbZones.length > 0) {
        setZones(dbZones);
        setSelectedZoneId(dbZones[0]?.id || null);
        setZonesLoaded(true);
        return;
      }
      // Try localStorage
      const localZones = loadGeofencesLocal();
      if (localZones.length > 0) {
        setZones(localZones);
        setSelectedZoneId(localZones[0]?.id || null);
        setZonesLoaded(true);
        return;
      }
      // Use defaults and save them
      setZonesLoaded(true);
      INITIAL_ZONES.forEach(z => saveGeofenceToDB(z));
    })();
  }, [zonesLoaded]);
  const [drawMode, setDrawMode] = useState<DrawMode>("select");
  const [showEmployees, setShowEmployees] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [editPanel, setEditPanel] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<GeoPoint>({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ w: 750, h: 500 });

  // Drawing state for new zones
  const [drawingPoints, setDrawingPoints] = useState<GeoPoint[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [showGPSModal, setShowGPSModal] = useState(false);
  const [showRelocateModal, setShowRelocateModal] = useState(false);
  const [showCoordsEditor, setShowCoordsEditor] = useState(false);

  const selectedZone = useMemo(() => zones.find(z => z.id === selectedZoneId) || null, [zones, selectedZoneId]);

  const filteredZones = useMemo(() => {
    if (!searchQuery) return zones;
    return zones.filter(z => z.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [zones, searchQuery]);

  // ── Canvas Drawing ──────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvasSize.w;
    const h = canvasSize.h;
    canvas.width = w * 2;
    canvas.height = h * 2;
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = "#080D1A";
    ctx.fillRect(0, 0, w, h);

    // Grid
    if (showGrid) {
      ctx.strokeStyle = "rgba(255,255,255,0.03)";
      ctx.lineWidth = 0.5;
      const gridSize = 40 * zoom;
      for (let x = 0; x < w; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y < h; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
    }

    // Draw zones
    zones.forEach(zone => {
      if (!zone.visible) return;
      const isSelected = zone.id === selectedZoneId;
      const alpha = isSelected ? 0.2 : 0.08;
      const borderAlpha = isSelected ? 0.7 : 0.3;

      if (zone.type === "circle" && zone.radius) {
        ctx.beginPath();
        ctx.arc(zone.center.x * zoom, zone.center.y * zoom, zone.radius * zoom, 0, Math.PI * 2);
        ctx.fillStyle = zone.color + Math.round(alpha * 255).toString(16).padStart(2, "0");
        ctx.fill();
        ctx.strokeStyle = zone.color + Math.round(borderAlpha * 255).toString(16).padStart(2, "0");
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        if (isSelected) ctx.setLineDash([6, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (zone.type === "polygon" && zone.points && zone.points.length > 2) {
        ctx.beginPath();
        ctx.moveTo(zone.points[0].x * zoom, zone.points[0].y * zoom);
        zone.points.forEach((p, i) => {
          if (i > 0) ctx.lineTo(p.x * zoom, p.y * zoom);
        });
        ctx.closePath();
        ctx.fillStyle = zone.color + Math.round(alpha * 255).toString(16).padStart(2, "0");
        ctx.fill();
        ctx.strokeStyle = zone.color + Math.round(borderAlpha * 255).toString(16).padStart(2, "0");
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        if (isSelected) ctx.setLineDash([6, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw vertices for selected polygon
        if (isSelected) {
          zone.points.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x * zoom, p.y * zoom, 4, 0, Math.PI * 2);
            ctx.fillStyle = zone.color;
            ctx.fill();
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 1;
            ctx.stroke();
          });
        }
      }

      // Zone label
      ctx.font = `600 ${isSelected ? 11 : 9}px 'Outfit', sans-serif`;
      ctx.fillStyle = zone.color;
      ctx.textAlign = "center";
      ctx.fillText(zone.name, zone.center.x * zoom, zone.center.y * zoom - 8);
      // Risk badge
      ctx.font = `700 7px 'Outfit', sans-serif`;
      ctx.fillStyle = RISK_COLORS[zone.risk];
      ctx.fillText(zone.risk.toUpperCase() + " RISK", zone.center.x * zoom, zone.center.y * zoom + 5);
      // Employee count
      ctx.font = `500 8px 'Outfit', sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText(`${zone.employeeCount} workers`, zone.center.x * zoom, zone.center.y * zoom + 17);
    });

    // Draw employee dots
    if (showEmployees) {
      EMPLOYEE_DOTS.forEach(dot => {
        const z = zones.find(z => z.id === dot.zone);
        const color = z?.color || "#00C8E0";
        // Outer glow
        ctx.beginPath();
        ctx.arc(dot.x * zoom, dot.y * zoom, 8, 0, Math.PI * 2);
        ctx.fillStyle = color + "15";
        ctx.fill();
        // Dot
        ctx.beginPath();
        ctx.arc(dot.x * zoom, dot.y * zoom, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "#080D1A";
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }

    // Drawing in progress
    if (isDrawing && drawingPoints.length > 0) {
      ctx.beginPath();
      ctx.moveTo(drawingPoints[0].x, drawingPoints[0].y);
      drawingPoints.forEach((p, i) => {
        if (i > 0) ctx.lineTo(p.x, p.y);
      });
      ctx.strokeStyle = "#00C8E0";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      drawingPoints.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#00C8E0";
        ctx.fill();
      });
    }
  }, [zones, selectedZoneId, showEmployees, showGrid, zoom, isDrawing, drawingPoints, canvasSize]);

  // Handle container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        setCanvasSize({ w: entry.contentRect.width, h: Math.max(entry.contentRect.height, 400) });
      }
    });
    obs.observe(container);
    return () => obs.disconnect();
  }, []);

  // Canvas click handling
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvasSize.w / rect.width);
    const y = (e.clientY - rect.top) * (canvasSize.h / rect.height);

    if (drawMode === "polygon") {
      setDrawingPoints(prev => [...prev, { x, y }]);
      if (!isDrawing) setIsDrawing(true);
      return;
    }

    if (drawMode === "circle") {
      const newZone: GeoZone = {
        id: `GZ-${Date.now()}`,
        name: `New Zone ${zones.length + 1}`,
        type: "circle",
        center: { x: x / zoom, y: y / zoom },
        radius: 50,
        risk: "low",
        status: "active",
        color: "#00C8E0",
        locked: false,
        visible: true,
        alerts: { entryAlert: true, exitAlert: false, dwellAlert: false, dwellMinutes: 30, maxCapacity: 20 },
        employeeCount: 0,
      };
      setZones(prev => [...prev, newZone]);
      setSelectedZoneId(newZone.id);
      saveGeofenceToDB(newZone);
      setDrawMode("select");
      return;
    }

    // Select mode: find clicked zone
    if (drawMode === "select") {
      const clickedZone = zones.find(zone => {
        if (zone.type === "circle" && zone.radius) {
          const dx = x / zoom - zone.center.x;
          const dy = y / zoom - zone.center.y;
          return Math.sqrt(dx * dx + dy * dy) <= zone.radius;
        }
        if (zone.type === "polygon" && zone.points) {
          return isPointInPolygon({ x: x / zoom, y: y / zoom }, zone.points);
        }
        return false;
      });
      setSelectedZoneId(clickedZone?.id || null);
    }
  }, [drawMode, isDrawing, zones, zoom, canvasSize]);

  // Complete polygon drawing
  const completePolygon = useCallback(() => {
    if (drawingPoints.length < 3) return;
    const cx = drawingPoints.reduce((s, p) => s + p.x, 0) / drawingPoints.length;
    const cy = drawingPoints.reduce((s, p) => s + p.y, 0) / drawingPoints.length;
    const newZone: GeoZone = {
      id: `GZ-${Date.now()}`,
      name: `New Zone ${zones.length + 1}`,
      type: "polygon",
      center: { x: cx / zoom, y: cy / zoom },
      points: drawingPoints.map(p => ({ x: p.x / zoom, y: p.y / zoom })),
      risk: "low",
      status: "active",
      color: "#00C8E0",
      locked: false,
      visible: true,
      alerts: { entryAlert: true, exitAlert: false, dwellAlert: false, dwellMinutes: 30, maxCapacity: 20 },
      employeeCount: 0,
    };
    setZones(prev => [...prev, newZone]);
    setSelectedZoneId(newZone.id);
    saveGeofenceToDB(newZone);
    setDrawingPoints([]);
    setIsDrawing(false);
    setDrawMode("select");
  }, [drawingPoints, zones.length, zoom]);

  // Zone CRUD — with Supabase persistence
  const updateZone = useCallback((id: string, updates: Partial<GeoZone>) => {
    setZones(prev => {
      const updated = prev.map(z => z.id === id ? { ...z, ...updates } : z);
      const zone = updated.find(z => z.id === id);
      if (zone) saveGeofenceToDB(zone);
      return updated;
    });
  }, []);

  const deleteZone = useCallback((id: string) => {
    setZones(prev => prev.filter(z => z.id !== id));
    deleteGeofenceFromDB(id);
    if (selectedZoneId === id) setSelectedZoneId(null);
  }, [selectedZoneId]);

  const duplicateZone = useCallback((id: string) => {
    const zone = zones.find(z => z.id === id);
    if (!zone) return;
    const newZone: GeoZone = {
      ...zone,
      id: `GZ-${Date.now()}`,
      name: `${zone.name} (Copy)`,
      center: { x: zone.center.x + 30, y: zone.center.y + 30 },
      points: zone.points?.map(p => ({ x: p.x + 30, y: p.y + 30 })),
      locked: false,
    };
    setZones(prev => [...prev, newZone]);
    setSelectedZoneId(newZone.id);
    saveGeofenceToDB(newZone);
  }, [zones]);

  const px = webMode ? "px-8 py-6" : "px-4 py-4";

  return (
    <div className={px}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-white flex items-center gap-2" style={{ fontSize: webMode ? 22 : 18, fontWeight: 700 }}>
            <MapPin className="size-5" style={{ color: "#00C8E0" }} />
            Geo-fencing Editor
          </h1>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
            Draw and manage safety zones, set alerts, and monitor boundaries
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGPSModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
            style={{ fontSize: 11, color: "#7B5EFF", background: "rgba(123,94,255,0.08)", border: "1px solid rgba(123,94,255,0.15)", fontWeight: 600 }}
          >
            <Navigation className="size-3" /> Create from GPS
          </button>
          <button
            onClick={() => { hapticSuccess(); toast.success("All Zones Saved", { description: `${zones.length} geofence zones saved successfully` }); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
            style={{ fontSize: 11, color: "#00C853", background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.15)", fontWeight: 600, cursor: "pointer" }}
          >
            <Save className="size-3" /> Save All
          </button>
        </div>
      </div>

      {/* KPI Summary */}
      <div className={`grid ${webMode ? "grid-cols-5" : "grid-cols-3"} gap-3 mb-5`}>
        {[
          { label: "Total Zones", value: zones.length.toString(), color: "#00C8E0", icon: Layers },
          { label: "Active", value: zones.filter(z => z.status === "active").length.toString(), color: "#00C853", icon: Check },
          { label: "Restricted", value: zones.filter(z => z.status === "restricted").length.toString(), color: "#FF9500", icon: AlertTriangle },
          ...(webMode ? [
            { label: "High Risk", value: zones.filter(z => z.risk === "high").length.toString(), color: "#FF2D55", icon: Shield },
            { label: "Workers Inside", value: zones.reduce((s, z) => s + z.employeeCount, 0).toString(), color: "#7B5EFF", icon: Users },
          ] : []),
        ].map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="p-3 rounded-xl"
            style={{
              background: `${kpi.color}08`,
              border: `1px solid ${kpi.color}15`,
            }}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <kpi.icon className="size-3" style={{ color: kpi.color }} />
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontWeight: 600 }}>{kpi.label}</span>
            </div>
            <p style={{ fontSize: 18, color: kpi.color, fontWeight: 700 }}>{kpi.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Main Layout: Canvas + Side Panel */}
      <div className={`flex gap-4 ${webMode ? "" : "flex-col"}`}>
        {/* Canvas Area */}
        <div className="flex-1">
          {/* Toolbar */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1">
              {([
                { mode: "select" as DrawMode, icon: Move, label: "Select", shortcut: "V" },
                { mode: "circle" as DrawMode, icon: Circle, label: "Circle", shortcut: "C" },
                { mode: "polygon" as DrawMode, icon: Pentagon, label: "Polygon", shortcut: "P" },
              ] as const).map(tool => (
                <button
                  key={tool.mode}
                  onClick={() => { setDrawMode(tool.mode); setDrawingPoints([]); setIsDrawing(false); }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                  style={{
                    background: drawMode === tool.mode ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${drawMode === tool.mode ? "rgba(0,200,224,0.25)" : "rgba(255,255,255,0.04)"}`,
                  }}
                >
                  <tool.icon className="size-3.5" style={{ color: drawMode === tool.mode ? "#00C8E0" : "rgba(255,255,255,0.35)" }} />
                  <span style={{ fontSize: 10, color: drawMode === tool.mode ? "#00C8E0" : "rgba(255,255,255,0.35)", fontWeight: 600 }}>
                    {tool.label}
                  </span>
                </button>
              ))}
              {isDrawing && drawMode === "polygon" && (
                <button
                  onClick={completePolygon}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg ml-2"
                  style={{ background: "rgba(0,200,83,0.12)", border: "1px solid rgba(0,200,83,0.25)" }}
                >
                  <Check className="size-3" style={{ color: "#00C853" }} />
                  <span style={{ fontSize: 10, color: "#00C853", fontWeight: 600 }}>Complete ({drawingPoints.length} pts)</span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setShowEmployees(!showEmployees)}
                className="size-7 rounded-lg flex items-center justify-center"
                style={{
                  background: showEmployees ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.02)",
                  border: `1px solid ${showEmployees ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.04)"}`,
                  color: showEmployees ? "#00C8E0" : "rgba(255,255,255,0.25)",
                }}>
                <Users className="size-3.5" />
              </button>
              <button onClick={() => setShowGrid(!showGrid)}
                className="size-7 rounded-lg flex items-center justify-center"
                style={{
                  background: showGrid ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.02)",
                  border: `1px solid ${showGrid ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.04)"}`,
                  color: showGrid ? "#00C8E0" : "rgba(255,255,255,0.25)",
                }}>
                <Crosshair className="size-3.5" />
              </button>
              <div className="flex items-center gap-0.5 ml-1">
                <button onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}
                  className="size-7 rounded-lg flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.35)" }}>
                  <ZoomOut className="size-3.5" />
                </button>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600, width: 36, textAlign: "center" }}>
                  {Math.round(zoom * 100)}%
                </span>
                <button onClick={() => setZoom(z => Math.min(2, z + 0.1))}
                  className="size-7 rounded-lg flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.35)" }}>
                  <ZoomIn className="size-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Canvas */}
          <div
            ref={containerRef}
            className="relative rounded-xl overflow-hidden"
            style={{
              border: "1px solid rgba(255,255,255,0.04)",
              height: webMode ? 500 : 350,
              cursor: drawMode === "circle" || drawMode === "polygon" ? "crosshair" : drawMode === "pan" ? "grab" : "default",
            }}
          >
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              className="w-full h-full"
              style={{ display: "block" }}
            />
            {/* Draw mode hint */}
            {drawMode !== "select" && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full"
                style={{ background: "rgba(0,200,224,0.12)", border: "1px solid rgba(0,200,224,0.2)", backdropFilter: "blur(8px)" }}>
                <span style={{ fontSize: 10, color: "#00C8E0", fontWeight: 600 }}>
                  {drawMode === "circle" ? "Click to place a circle zone" : "Click to add polygon points, then Complete"}
                </span>
              </div>
            )}
            {/* Compass */}
            <div className="absolute bottom-3 right-3 size-10 rounded-full flex items-center justify-center"
              style={{ background: "rgba(10,18,32,0.8)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <Navigation className="size-4" style={{ color: "rgba(255,255,255,0.3)", transform: "rotate(-45deg)" }} />
            </div>
          </div>
        </div>

        {/* Side Panel: Zone List + Properties */}
        <div className="flex flex-col gap-3" style={{ width: webMode ? 320 : "100%" }}>
          {/* Zone List */}
          <div className="rounded-xl overflow-hidden" style={{ background: "rgba(10,18,32,0.5)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <div className="p-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: 700 }}>ZONES ({zones.length})</span>
              <button
                onClick={() => setDrawMode("circle")}
                className="size-6 rounded-md flex items-center justify-center"
                style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)", color: "#00C8E0" }}
              >
                <Plus className="size-3.5" />
              </button>
            </div>
            {/* Search */}
            <div className="px-3 py-2">
              <div className="relative">
                <Search className="size-3 absolute left-2 top-1/2 -translate-y-1/2" style={{ color: "rgba(255,255,255,0.2)" }} />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search zones..."
                  className="w-full pl-6 pr-2 py-1.5 rounded-md outline-none"
                  style={{ fontSize: 10, color: "white", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)" }}
                />
              </div>
            </div>
            <div className="max-h-[240px] overflow-y-auto" style={{ scrollbarWidth: "none" }}>
              {filteredZones.map(zone => (
                <button
                  key={zone.id}
                  onClick={() => setSelectedZoneId(zone.id)}
                  className="w-full px-3 py-2.5 flex items-center gap-2 text-left"
                  style={{
                    borderBottom: "1px solid rgba(255,255,255,0.02)",
                    background: zone.id === selectedZoneId ? "rgba(0,200,224,0.04)" : undefined,
                  }}
                >
                  <div className="size-2.5 rounded-full flex-shrink-0" style={{ background: zone.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-white truncate" style={{ fontSize: 11, fontWeight: 600 }}>{zone.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span style={{ fontSize: 8, color: RISK_COLORS[zone.risk], fontWeight: 600 }}>{zone.risk.toUpperCase()}</span>
                      <span style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>&middot;</span>
                      <span style={{ fontSize: 8, color: STATUS_LABELS[zone.status].color }}>{STATUS_LABELS[zone.status].label}</span>
                      <span style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>&middot;</span>
                      <span style={{ fontSize: 8, color: "rgba(255,255,255,0.25)" }}>{zone.employeeCount} ppl</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {zone.locked && <Lock className="size-2.5" style={{ color: "rgba(255,255,255,0.15)" }} />}
                    {!zone.visible && <EyeOff className="size-2.5" style={{ color: "rgba(255,255,255,0.15)" }} />}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Zone Properties Panel */}
          <AnimatePresence mode="wait">
            {selectedZone && (
              <motion.div
                key={selectedZone.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="rounded-xl overflow-hidden"
                style={{ background: "rgba(10,18,32,0.5)", border: `1px solid ${selectedZone.color}15` }}
              >
                {/* Header */}
                <div className="p-3 flex items-center justify-between" style={{ borderBottom: `1px solid ${selectedZone.color}10` }}>
                  <div className="flex items-center gap-2">
                    <div className="size-3 rounded-full" style={{ background: selectedZone.color }} />
                    <span className="text-white" style={{ fontSize: 12, fontWeight: 700 }}>Properties</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => duplicateZone(selectedZone.id)}
                      className="size-6 rounded-md flex items-center justify-center"
                      style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.3)" }}>
                      <Copy className="size-3" />
                    </button>
                    <button onClick={() => deleteZone(selectedZone.id)}
                      className="size-6 rounded-md flex items-center justify-center"
                      style={{ background: "rgba(255,45,85,0.06)", color: "#FF2D55" }}>
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>

                <div className="p-3 space-y-3">
                  {/* Name */}
                  <div>
                    <label style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontWeight: 600, letterSpacing: "0.5px" }}>NAME</label>
                    <input
                      value={selectedZone.name}
                      onChange={e => updateZone(selectedZone.id, { name: e.target.value })}
                      className="w-full mt-1 px-2.5 py-1.5 rounded-md outline-none"
                      style={{ fontSize: 11, color: "white", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)" }}
                    />
                  </div>

                  {/* ── Coordinates Editor ── */}
                  <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(0,200,224,0.12)" }}>
                    <button
                      onClick={() => setShowCoordsEditor(v => !v)}
                      className="w-full flex items-center justify-between px-3 py-2"
                      style={{ background: "rgba(0,200,224,0.04)" }}
                    >
                      <div className="flex items-center gap-2">
                        <Navigation className="size-3" style={{ color: "#00C8E0" }} />
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#00C8E0", letterSpacing: "0.3px" }}>COORDINATES & GEOMETRY</span>
                      </div>
                      {showCoordsEditor
                        ? <ChevronUp className="size-3" style={{ color: "#00C8E0" }} />
                        : <ChevronDown className="size-3" style={{ color: "rgba(0,200,224,0.5)" }} />}
                    </button>
                    <AnimatePresence>
                      {showCoordsEditor && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          style={{ overflow: "hidden" }}
                        >
                          <div className="p-3 space-y-3" style={{ background: "rgba(0,0,0,0.15)" }}>
                            {/* Center X / Y */}
                            <div>
                              <label style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontWeight: 600, letterSpacing: "0.5px" }}>CENTER POSITION (canvas units)</label>
                              <div className="grid grid-cols-2 gap-2 mt-1">
                                <div>
                                  <label style={{ fontSize: 8, color: "rgba(0,200,224,0.5)", fontWeight: 600 }}>X</label>
                                  <input
                                    type="number"
                                    value={Math.round(selectedZone.center.x)}
                                    onChange={e => {
                                      const nx = parseFloat(e.target.value) || 0;
                                      const dx = nx - selectedZone.center.x;
                                      updateZone(selectedZone.id, {
                                        center: { ...selectedZone.center, x: nx },
                                        points: selectedZone.points?.map(p => ({ ...p, x: p.x + dx })),
                                      });
                                    }}
                                    className="w-full mt-0.5 px-2 py-1.5 rounded-md outline-none"
                                    style={{ fontSize: 11, color: "#00C8E0", background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.12)", fontFamily: "monospace" }}
                                  />
                                </div>
                                <div>
                                  <label style={{ fontSize: 8, color: "rgba(0,200,224,0.5)", fontWeight: 600 }}>Y</label>
                                  <input
                                    type="number"
                                    value={Math.round(selectedZone.center.y)}
                                    onChange={e => {
                                      const ny = parseFloat(e.target.value) || 0;
                                      const dy = ny - selectedZone.center.y;
                                      updateZone(selectedZone.id, {
                                        center: { ...selectedZone.center, y: ny },
                                        points: selectedZone.points?.map(p => ({ ...p, y: p.y + dy })),
                                      });
                                    }}
                                    className="w-full mt-0.5 px-2 py-1.5 rounded-md outline-none"
                                    style={{ fontSize: 11, color: "#00C8E0", background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.12)", fontFamily: "monospace" }}
                                  />
                                </div>
                              </div>
                              <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", marginTop: 4 }}>
                                Moving center also shifts all polygon vertices
                              </p>
                            </div>

                            {/* Radius (circle only) */}
                            {selectedZone.type === "circle" && (
                              <div>
                                <label style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontWeight: 600, letterSpacing: "0.5px" }}>RADIUS (canvas units)</label>
                                <div className="flex items-center gap-2 mt-1">
                                  <input
                                    type="range" min={20} max={150}
                                    value={selectedZone.radius || 50}
                                    onChange={e => updateZone(selectedZone.id, { radius: parseInt(e.target.value) })}
                                    className="flex-1"
                                    style={{ accentColor: "#00C8E0" }}
                                  />
                                  <input
                                    type="number"
                                    value={selectedZone.radius || 50}
                                    onChange={e => updateZone(selectedZone.id, { radius: parseInt(e.target.value) || 20 })}
                                    className="w-16 px-2 py-1 rounded-md outline-none text-center"
                                    style={{ fontSize: 11, color: "#00C8E0", background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.12)", fontFamily: "monospace" }}
                                  />
                                </div>
                              </div>
                            )}

                            {/* Polygon vertices */}
                            {selectedZone.type === "polygon" && selectedZone.points && (
                              <div>
                                <label style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontWeight: 600, letterSpacing: "0.5px" }}>
                                  POLYGON VERTICES ({selectedZone.points.length} pts)
                                </label>
                                <div className="mt-1.5 space-y-1 max-h-36 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
                                  {selectedZone.points.map((pt, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                      <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", width: 14, fontFamily: "monospace", flexShrink: 0 }}>P{idx + 1}</span>
                                      <input
                                        type="number"
                                        value={Math.round(pt.x)}
                                        onChange={e => {
                                          const newPts = [...(selectedZone.points || [])];
                                          newPts[idx] = { ...newPts[idx], x: parseFloat(e.target.value) || 0 };
                                          const cx = newPts.reduce((s, p) => s + p.x, 0) / newPts.length;
                                          const cy = newPts.reduce((s, p) => s + p.y, 0) / newPts.length;
                                          updateZone(selectedZone.id, { points: newPts, center: { x: cx, y: cy } });
                                        }}
                                        className="flex-1 px-2 py-1 rounded outline-none text-center"
                                        style={{ fontSize: 10, color: selectedZone.color, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", fontFamily: "monospace" }}
                                      />
                                      <span style={{ fontSize: 8, color: "rgba(255,255,255,0.15)" }}>·</span>
                                      <input
                                        type="number"
                                        value={Math.round(pt.y)}
                                        onChange={e => {
                                          const newPts = [...(selectedZone.points || [])];
                                          newPts[idx] = { ...newPts[idx], y: parseFloat(e.target.value) || 0 };
                                          const cx = newPts.reduce((s, p) => s + p.x, 0) / newPts.length;
                                          const cy = newPts.reduce((s, p) => s + p.y, 0) / newPts.length;
                                          updateZone(selectedZone.id, { points: newPts, center: { x: cx, y: cy } });
                                        }}
                                        className="flex-1 px-2 py-1 rounded outline-none text-center"
                                        style={{ fontSize: 10, color: selectedZone.color, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", fontFamily: "monospace" }}
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Relocate via GPS */}
                            <button
                              onClick={() => setShowRelocateModal(true)}
                              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg"
                              style={{ background: "rgba(123,94,255,0.08)", border: "1px solid rgba(123,94,255,0.2)", fontSize: 10, fontWeight: 700, color: "#7B5EFF" }}
                            >
                              <MapPin className="size-3" />
                              Relocate via GPS / Maps Link
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Risk + Status */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontWeight: 600, letterSpacing: "0.5px" }}>RISK</label>
                      <select
                        value={selectedZone.risk}
                        onChange={e => updateZone(selectedZone.id, { risk: e.target.value as RiskLevel, color: RISK_COLORS[e.target.value as RiskLevel] || selectedZone.color })}
                        className="w-full mt-1 px-2 py-1.5 rounded-md outline-none"
                        style={{ fontSize: 10, color: RISK_COLORS[selectedZone.risk], background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)" }}
                      >
                        <option value="low" style={{ background: "#0A1220" }}>Low</option>
                        <option value="medium" style={{ background: "#0A1220" }}>Medium</option>
                        <option value="high" style={{ background: "#0A1220" }}>High</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontWeight: 600, letterSpacing: "0.5px" }}>STATUS</label>
                      <select
                        value={selectedZone.status}
                        onChange={e => updateZone(selectedZone.id, { status: e.target.value as ZoneStatus })}
                        className="w-full mt-1 px-2 py-1.5 rounded-md outline-none"
                        style={{ fontSize: 10, color: STATUS_LABELS[selectedZone.status].color, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)" }}
                      >
                        <option value="active" style={{ background: "#0A1220" }}>Active</option>
                        <option value="restricted" style={{ background: "#0A1220" }}>Restricted</option>
                        <option value="evacuated" style={{ background: "#0A1220" }}>Evacuated</option>
                      </select>
                    </div>
                  </div>

                  {/* Capacity */}
                  <div>
                    <label style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontWeight: 600 }}>MAX CAPACITY</label>
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="number"
                        value={selectedZone.alerts.maxCapacity}
                        onChange={e => updateZone(selectedZone.id, {
                          alerts: { ...selectedZone.alerts, maxCapacity: parseInt(e.target.value) || 0 }
                        })}
                        className="flex-1 px-2.5 py-1.5 rounded-md outline-none"
                        style={{ fontSize: 11, color: "white", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)" }}
                      />
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
                        {selectedZone.employeeCount}/{selectedZone.alerts.maxCapacity}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <div className="h-full rounded-full transition-all" style={{
                        width: `${Math.min((selectedZone.employeeCount / selectedZone.alerts.maxCapacity) * 100, 100)}%`,
                        background: selectedZone.employeeCount > selectedZone.alerts.maxCapacity * 0.9 ? "#FF2D55" :
                          selectedZone.employeeCount > selectedZone.alerts.maxCapacity * 0.7 ? "#FF9500" : "#00C853",
                      }} />
                    </div>
                  </div>

                  {/* Alert Rules */}
                  <div>
                    <label style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontWeight: 600, letterSpacing: "0.5px" }}>ALERT RULES</label>
                    <div className="mt-1.5 space-y-1.5">
                      {[
                        { key: "entryAlert" as const, label: "Entry Alert", desc: "Alert when someone enters" },
                        { key: "exitAlert" as const, label: "Exit Alert", desc: "Alert when someone exits" },
                        { key: "dwellAlert" as const, label: "Dwell Alert", desc: `After ${selectedZone.alerts.dwellMinutes}min` },
                      ].map(rule => (
                        <button
                          key={rule.key}
                          onClick={() => updateZone(selectedZone.id, {
                            alerts: { ...selectedZone.alerts, [rule.key]: !selectedZone.alerts[rule.key] }
                          })}
                          className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg"
                          style={{
                            background: selectedZone.alerts[rule.key] ? "rgba(0,200,224,0.04)" : "rgba(255,255,255,0.01)",
                            border: `1px solid ${selectedZone.alerts[rule.key] ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.03)"}`,
                          }}
                        >
                          <div>
                            <p style={{ fontSize: 10, color: selectedZone.alerts[rule.key] ? "white" : "rgba(255,255,255,0.4)", fontWeight: 600 }}>
                              {rule.label}
                            </p>
                            <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>{rule.desc}</p>
                          </div>
                          <div className="w-8 h-4 rounded-full p-0.5 transition-colors"
                            style={{ background: selectedZone.alerts[rule.key] ? "#00C8E0" : "rgba(255,255,255,0.08)" }}>
                            <motion.div
                              animate={{ x: selectedZone.alerts[rule.key] ? 16 : 0 }}
                              transition={{ type: "spring", stiffness: 500, damping: 30 }}
                              className="size-3 rounded-full bg-white"
                            />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="flex items-center gap-1.5 pt-1">
                    <button
                      onClick={() => updateZone(selectedZone.id, { visible: !selectedZone.visible })}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg"
                      style={{
                        fontSize: 9, fontWeight: 600,
                        color: selectedZone.visible ? "#00C8E0" : "rgba(255,255,255,0.3)",
                        background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)",
                      }}
                    >
                      {selectedZone.visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                      {selectedZone.visible ? "Visible" : "Hidden"}
                    </button>
                    <button
                      onClick={() => updateZone(selectedZone.id, { locked: !selectedZone.locked })}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg"
                      style={{
                        fontSize: 9, fontWeight: 600,
                        color: selectedZone.locked ? "#FF9500" : "rgba(255,255,255,0.3)",
                        background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)",
                      }}
                    >
                      {selectedZone.locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
                      {selectedZone.locked ? "Locked" : "Unlocked"}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Relocate Zone Modal */}
      <AnimatePresence>
        {showRelocateModal && selectedZone && (
          <RelocateZoneModal
            zone={selectedZone}
            onClose={() => setShowRelocateModal(false)}
            onRelocate={(newCenter, newRadius) => {
              updateZone(selectedZone.id, {
                center: newCenter,
                ...(selectedZone.type === "circle" ? { radius: newRadius } : {}),
                ...(selectedZone.type === "polygon" && selectedZone.points
                  ? {
                      points: selectedZone.points.map(p => ({
                        x: p.x - selectedZone.center.x + newCenter.x,
                        y: p.y - selectedZone.center.y + newCenter.y,
                      })),
                    }
                  : {}),
              });
              setShowRelocateModal(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* GPS Zone Creation Modal */}
      <AnimatePresence>
        {showGPSModal && (
          <GPSZoneModal
            onClose={() => setShowGPSModal(false)}
            onCreate={(data) => {
              const newZone: GeoZone = {
                id: `GZ-${Date.now()}`,
                name: data.name,
                type: "circle",
                center: { x: 400, y: 200 }, // default canvas center; user can drag to reposition
                radius: Math.max(30, Math.min(data.radiusMeters / 5, 80)),
                risk: "low",
                status: "active",
                color: "#00C8E0",
                locked: false,
                visible: true,
                alerts: { entryAlert: true, exitAlert: true, dwellAlert: false, dwellMinutes: 30, maxCapacity: 20 },
                employeeCount: 0,
              };
              setZones(prev => [...prev, newZone]);
              setSelectedZoneId(newZone.id);
              saveGeofenceToDB(newZone);
              // Save GPS data
              const gpsData: ZoneGPSData = {
                id: newZone.id, name: data.name,
                lat: data.lat, lng: data.lng,
                radiusMeters: data.radiusMeters, address: data.address,
              };
              saveZoneGPS([...zones.map(z => ({
                id: z.id, name: z.name, lat: 0, lng: 0, radiusMeters: (z.radius || 50) * 5,
              })), gpsData]);
              setShowGPSModal(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Relocate Zone Modal — Edit GPS coordinates of existing zone
// ═══════════════════════════════════════════════════════════════
function RelocateZoneModal({ zone, onClose, onRelocate }: {
  zone: GeoZone;
  onClose: () => void;
  onRelocate: (newCenter: GeoPoint, newRadius: number) => void;
}) {
  const [lat, setLat] = useState("24.7136");
  const [lng, setLng] = useState("46.6753");
  const [radius, setRadius] = useState(String((zone.radius || 50) * 5));
  const [mapsLink, setMapsLink] = useState("");
  const [inputMode, setInputMode] = useState<"coords" | "link">("coords");
  const [parsed, setParsed] = useState(false);

  const parseLink = (link: string) => {
    const patterns = [
      /@(-?\d+\.\d+),(-?\d+\.\d+)/,
      /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/,
      /place\/[^/]*\/(-?\d+\.\d+),(-?\d+\.\d+)/,
      /(-?\d{1,3}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/,
    ];
    for (const p of patterns) {
      const m = link.match(p);
      if (m) { setLat(m[1]); setLng(m[2]); setParsed(true); return; }
    }
    setParsed(false);
  };

  const isValid = lat && lng && Number(radius) > 0;

  // GPS → canvas units (mock mapping)
  const toCanvas = (latV: number, lngV: number): GeoPoint => ({
    x: Math.round(((lngV - 40) / 30) * 600 + 80),
    y: Math.round(((35 - latV) / 20) * 400 + 60),
  });

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="w-[460px] max-h-[90vh] overflow-y-auto rounded-2xl"
        style={{ background: "#0A1220", border: "1px solid rgba(0,200,224,0.2)", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.2), rgba(0,200,224,0.06))", border: "1px solid rgba(0,200,224,0.25)" }}>
              <MapPin className="size-5" style={{ color: "#00C8E0" }} />
            </div>
            <div>
              <h3 className="text-white" style={{ fontSize: 16, fontWeight: 800 }}>Relocate Zone</h3>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                Update GPS location for <span style={{ color: zone.color, fontWeight: 700 }}>{zone.name}</span>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="size-8 rounded-lg flex items-center justify-center"
            style={{ color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.04)" }}>
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Input mode toggle */}
          <div className="flex gap-2">
            {([
              { id: "coords" as const, label: "GPS Coordinates", icon: Crosshair },
              { id: "link" as const, label: "Google Maps Link", icon: MapPin },
            ]).map(m => (
              <button key={m.id} onClick={() => setInputMode(m.id)}
                className="flex-1 p-3 rounded-xl flex items-center gap-2"
                style={{
                  background: inputMode === m.id ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.02)",
                  border: `1px solid ${inputMode === m.id ? "rgba(0,200,224,0.25)" : "rgba(255,255,255,0.04)"}`,
                }}>
                <m.icon className="size-4" style={{ color: inputMode === m.id ? "#00C8E0" : "rgba(255,255,255,0.25)" }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: inputMode === m.id ? "#00C8E0" : "rgba(255,255,255,0.4)" }}>{m.label}</span>
              </button>
            ))}
          </div>

          {inputMode === "coords" ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>LATITUDE</label>
                <input value={lat} onChange={e => setLat(e.target.value)} placeholder="24.7136"
                  className="w-full mt-1.5 px-3 py-2 rounded-lg outline-none"
                  style={{ fontSize: 12, color: "white", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", fontFamily: "monospace" }} />
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>LONGITUDE</label>
                <input value={lng} onChange={e => setLng(e.target.value)} placeholder="46.6753"
                  className="w-full mt-1.5 px-3 py-2 rounded-lg outline-none"
                  style={{ fontSize: 12, color: "white", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", fontFamily: "monospace" }} />
              </div>
              <div className="col-span-2 flex items-center gap-2 p-2.5 rounded-lg" style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.08)" }}>
                <MapPin className="size-3.5 shrink-0" style={{ color: "#00C8E0" }} />
                <p style={{ fontSize: 10, color: "rgba(0,200,224,0.6)" }}>
                  Tip: Open Google Maps → Right-click on location → Copy coordinates
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>GOOGLE MAPS LINK</label>
                <input value={mapsLink} onChange={e => { setMapsLink(e.target.value); parseLink(e.target.value); }}
                  placeholder="https://maps.google.com/..."
                  className="w-full mt-1.5 px-3 py-2.5 rounded-xl outline-none"
                  style={{ fontSize: 12, color: "white", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }} />
              </div>
              {parsed && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.15)" }}>
                  <Check className="size-3.5" style={{ color: "#00C853" }} />
                  <p style={{ fontSize: 11, color: "#00C853", fontWeight: 600 }}>Parsed: {lat}, {lng}</p>
                </div>
              )}
              {mapsLink && !parsed && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.15)" }}>
                  <AlertTriangle className="size-3.5" style={{ color: "#FF2D55" }} />
                  <p style={{ fontSize: 11, color: "#FF2D55", fontWeight: 600 }}>Could not parse coordinates from link</p>
                </div>
              )}
            </div>
          )}

          {/* Radius for circles */}
          {zone.type === "circle" && (
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>ZONE RADIUS (METERS)</label>
              <div className="flex items-center gap-3 mt-1.5">
                <input type="number" value={radius} onChange={e => setRadius(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg outline-none"
                  style={{ fontSize: 12, color: "white", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }} />
                <div className="flex gap-1.5">
                  {["50", "100", "200", "500"].map(r => (
                    <button key={r} onClick={() => setRadius(r)}
                      className="px-2.5 py-1.5 rounded-lg"
                      style={{
                        fontSize: 11, fontWeight: radius === r ? 700 : 500,
                        background: radius === r ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.03)",
                        color: radius === r ? "#00C8E0" : "rgba(255,255,255,0.3)",
                        border: `1px solid ${radius === r ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.04)"}`,
                      }}>{r}m</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Polygon note */}
          {zone.type === "polygon" && (
            <div className="flex items-start gap-2 p-3 rounded-lg" style={{ background: "rgba(255,149,0,0.06)", border: "1px solid rgba(255,149,0,0.15)" }}>
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" style={{ color: "#FF9500" }} />
              <p style={{ fontSize: 10, color: "rgba(255,149,0,0.8)", lineHeight: 1.5 }}>
                All polygon vertices will shift by the same offset as the center move. The shape is preserved — only the position changes.
              </p>
            </div>
          )}

          {/* Preview */}
          <div className="p-4 rounded-xl" style={{ background: `${zone.color}06`, border: `1px solid ${zone.color}15` }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: zone.color, letterSpacing: "0.5px", marginBottom: 8 }}>NEW POSITION PREVIEW</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>New Coordinates</p>
                <p style={{ fontSize: 12, fontWeight: 600, color: "#00C8E0", fontFamily: "monospace" }}>{lat}, {lng}</p>
              </div>
              <div>
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{zone.type === "circle" ? "Radius" : "Shape"}</p>
                <p className="text-white" style={{ fontSize: 12, fontWeight: 600 }}>
                  {zone.type === "circle" ? `${radius}m` : "Polygon (shifted)"}
                </p>
              </div>
            </div>
            <div className="mt-3 h-20 rounded-lg relative overflow-hidden flex items-center justify-center"
              style={{ background: "#080D1A", border: "1px solid rgba(255,255,255,0.04)" }}>
              <div className="absolute inset-0" style={{ background: `radial-gradient(circle at center, ${zone.color}10 0%, transparent 60%)` }} />
              <div className="relative z-10 flex flex-col items-center gap-1">
                <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 2, repeat: Infinity }}
                  className="size-3 rounded-full" style={{ background: zone.color, boxShadow: `0 0 12px ${zone.color}60` }} />
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>{lat}, {lng}</p>
              </div>
              <motion.div animate={{ scale: [1, 1.05, 1], opacity: [0.15, 0.25, 0.15] }} transition={{ duration: 3, repeat: Infinity }}
                className="absolute rounded-full"
                style={{ width: 72, height: 72, border: `1px dashed ${zone.color}50`, background: `${zone.color}06` }} />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-5 flex items-center gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl"
            style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", fontWeight: 600 }}>
            Cancel
          </button>
          <button
            onClick={() => {
              if (!isValid) return;
              const canvas = toCanvas(parseFloat(lat), parseFloat(lng));
              onRelocate(canvas, Math.round(parseInt(radius) / 5));
            }}
            className="flex-1 py-2.5 rounded-xl flex items-center justify-center gap-2"
            style={{
              fontSize: 13, fontWeight: 700,
              color: isValid ? "white" : "rgba(255,255,255,0.3)",
              background: isValid ? `linear-gradient(135deg, ${zone.color}, ${zone.color}99)` : "rgba(255,255,255,0.04)",
              opacity: isValid ? 1 : 0.5,
              boxShadow: isValid ? `0 4px 16px ${zone.color}40` : "none",
            }}>
            <MapPin className="size-4" />
            Apply New Location
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Utility: Point-in-Polygon (ray casting) ───────────────────
function isPointInPolygon(point: GeoPoint, polygon: GeoPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ═══════════════════════════════════════════════════════════════
// GPS Zone Creation Modal — Create zone via coordinates or
// Google Maps link / location sharing
// ═══════════════════════════════════════════════════════════════
function GPSZoneModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (data: { name: string; lat: number; lng: number; radiusMeters: number; address?: string }) => void;
}) {
  const [name, setName] = useState("");
  const [lat, setLat] = useState("24.7136");
  const [lng, setLng] = useState("46.6753");
  const [radius, setRadius] = useState("200");
  const [address, setAddress] = useState("");
  const [mapsLink, setMapsLink] = useState("");
  const [inputMode, setInputMode] = useState<"coords" | "link">("coords");
  const [parsed, setParsed] = useState(false);

  // Parse Google Maps link to extract coordinates
  const parseGoogleMapsLink = (link: string) => {
    // Patterns: https://maps.google.com/?q=24.7136,46.6753
    //           https://www.google.com/maps/place/.../@24.7136,46.6753,17z
    //           https://goo.gl/maps/...
    const patterns = [
      /@(-?\d+\.\d+),(-?\d+\.\d+)/,
      /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/,
      /place\/[^/]*\/(-?\d+\.\d+),(-?\d+\.\d+)/,
      /(-?\d{1,3}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/,
    ];
    for (const pattern of patterns) {
      const match = link.match(pattern);
      if (match) {
        setLat(match[1]);
        setLng(match[2]);
        setParsed(true);
        return;
      }
    }
    setParsed(false);
  };

  const isValid = name.trim() && lat && lng && Number(radius) > 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="w-[480px] max-h-[90vh] overflow-y-auto rounded-2xl"
        style={{ background: "#0A1220", border: "1px solid rgba(123,94,255,0.2)", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, rgba(123,94,255,0.2), rgba(123,94,255,0.08))", border: "1px solid rgba(123,94,255,0.25)" }}>
              <Navigation className="size-5" style={{ color: "#7B5EFF" }} />
            </div>
            <div>
              <h3 className="text-white" style={{ fontSize: 16, fontWeight: 800 }}>Create Zone from GPS</h3>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                Enter coordinates manually or paste a Google Maps link
              </p>
            </div>
          </div>
          <button onClick={onClose} className="size-8 rounded-lg flex items-center justify-center"
            style={{ color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.04)" }}>
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Zone Name */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>ZONE NAME</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g., North Gate Site, Warehouse B..."
              className="w-full mt-1.5 px-3 py-2.5 rounded-xl outline-none"
              style={{ fontSize: 13, color: "white", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
            />
          </div>

          {/* Input Mode Toggle */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>LOCATION METHOD</label>
            <div className="flex gap-2 mt-2">
              {([
                { id: "coords" as const, label: "GPS Coordinates", icon: Crosshair, desc: "Lat/Lng" },
                { id: "link" as const, label: "Google Maps Link", icon: MapPin, desc: "Paste URL" },
              ]).map(mode => (
                <button key={mode.id} onClick={() => setInputMode(mode.id)}
                  className="flex-1 p-3 rounded-xl flex items-center gap-2 text-left"
                  style={{
                    background: inputMode === mode.id ? "rgba(123,94,255,0.08)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${inputMode === mode.id ? "rgba(123,94,255,0.25)" : "rgba(255,255,255,0.04)"}`,
                  }}>
                  <mode.icon className="size-4" style={{ color: inputMode === mode.id ? "#7B5EFF" : "rgba(255,255,255,0.25)" }} />
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 600, color: inputMode === mode.id ? "#7B5EFF" : "rgba(255,255,255,0.5)" }}>
                      {mode.label}
                    </p>
                    <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{mode.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* GPS Coordinates Input */}
          {inputMode === "coords" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>LATITUDE</label>
                  <input
                    value={lat}
                    onChange={e => setLat(e.target.value)}
                    placeholder="24.7136"
                    className="w-full mt-1.5 px-3 py-2 rounded-lg outline-none"
                    style={{ fontSize: 12, color: "white", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>LONGITUDE</label>
                  <input
                    value={lng}
                    onChange={e => setLng(e.target.value)}
                    placeholder="46.6753"
                    className="w-full mt-1.5 px-3 py-2 rounded-lg outline-none"
                    style={{ fontSize: 12, color: "white", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.08)" }}>
                <MapPin className="size-3.5 flex-shrink-0" style={{ color: "#00C8E0" }} />
                <p style={{ fontSize: 10, color: "rgba(0,200,224,0.6)" }}>
                  Tip: Open Google Maps → Right-click on location → Copy coordinates
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>GOOGLE MAPS LINK</label>
                <input
                  value={mapsLink}
                  onChange={e => { setMapsLink(e.target.value); parseGoogleMapsLink(e.target.value); }}
                  placeholder="https://maps.google.com/... or paste coordinates"
                  className="w-full mt-1.5 px-3 py-2.5 rounded-xl outline-none"
                  style={{ fontSize: 12, color: "white", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                />
              </div>
              {parsed && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 p-2.5 rounded-lg"
                  style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.15)" }}
                >
                  <Check className="size-3.5" style={{ color: "#00C853" }} />
                  <p style={{ fontSize: 11, color: "#00C853", fontWeight: 600 }}>
                    Parsed: {lat}, {lng}
                  </p>
                </motion.div>
              )}
              {mapsLink && !parsed && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.15)" }}>
                  <AlertTriangle className="size-3.5" style={{ color: "#FF2D55" }} />
                  <p style={{ fontSize: 11, color: "#FF2D55", fontWeight: 600 }}>Could not parse coordinates from link</p>
                </div>
              )}
            </div>
          )}

          {/* Zone Radius */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>ZONE RADIUS (METERS)</label>
            <div className="flex items-center gap-3 mt-1.5">
              <input
                type="number"
                value={radius}
                onChange={e => setRadius(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg outline-none"
                style={{ fontSize: 12, color: "white", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
              />
              <div className="flex gap-1.5">
                {["50", "100", "200", "500"].map(r => (
                  <button key={r} onClick={() => setRadius(r)}
                    className="px-2.5 py-1.5 rounded-lg"
                    style={{
                      fontSize: 11, fontWeight: radius === r ? 700 : 500,
                      background: radius === r ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.03)",
                      color: radius === r ? "#00C8E0" : "rgba(255,255,255,0.3)",
                      border: `1px solid ${radius === r ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.04)"}`,
                    }}>
                    {r}m
                  </button>
                ))}
              </div>
            </div>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 6 }}>
              The Attend button will appear on employee's phone when they enter within {radius || "0"}m of the zone center.
            </p>
          </div>

          {/* Address (optional) */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>ADDRESS (OPTIONAL)</label>
            <input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="e.g., King Fahd Road, Industrial Area..."
              className="w-full mt-1.5 px-3 py-2 rounded-lg outline-none"
              style={{ fontSize: 12, color: "white", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
            />
          </div>

          {/* Preview */}
          <div className="p-4 rounded-xl" style={{ background: "rgba(123,94,255,0.04)", border: "1px solid rgba(123,94,255,0.1)" }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: "#7B5EFF", letterSpacing: "0.5px", marginBottom: 8 }}>PREVIEW</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Zone Name</p>
                <p className="text-white" style={{ fontSize: 12, fontWeight: 600 }}>{name || "—"}</p>
              </div>
              <div>
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Coordinates</p>
                <p style={{ fontSize: 12, fontWeight: 600, color: "#00C8E0", fontFamily: "monospace" }}>{lat}, {lng}</p>
              </div>
              <div>
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Radius</p>
                <p className="text-white" style={{ fontSize: 12, fontWeight: 600 }}>{radius}m</p>
              </div>
              <div>
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Attend Trigger</p>
                <p style={{ fontSize: 12, fontWeight: 600, color: "#00C853" }}>Within {radius}m</p>
              </div>
            </div>
            {/* Mini map placeholder */}
            <div className="mt-3 h-24 rounded-lg relative overflow-hidden flex items-center justify-center"
              style={{ background: "#080D1A", border: "1px solid rgba(255,255,255,0.04)" }}>
              <div className="absolute inset-0" style={{ background: "radial-gradient(circle at center, rgba(0,200,224,0.08) 0%, transparent 60%)" }} />
              <div className="relative z-10 flex flex-col items-center gap-1">
                <motion.div
                  animate={{ scale: [1, 1.3, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="size-3 rounded-full" style={{ background: "#00C8E0", boxShadow: "0 0 12px rgba(0,200,224,0.4)" }}
                />
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>{lat}, {lng}</p>
              </div>
              {/* Radius circle */}
              <motion.div
                animate={{ scale: [1, 1.05, 1], opacity: [0.15, 0.25, 0.15] }}
                transition={{ duration: 3, repeat: Infinity }}
                className="absolute rounded-full"
                style={{
                  width: Math.min(Number(radius) / 3, 100),
                  height: Math.min(Number(radius) / 3, 100),
                  border: "1px dashed rgba(0,200,224,0.3)",
                  background: "rgba(0,200,224,0.04)",
                }}
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-5 flex items-center gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl"
            style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", fontWeight: 600 }}>
            Cancel
          </button>
          <button
            onClick={() => {
              if (!isValid) return;
              onCreate({
                name, lat: parseFloat(lat), lng: parseFloat(lng),
                radiusMeters: parseInt(radius), address: address || undefined,
              });
            }}
            className="flex-1 py-2.5 rounded-xl flex items-center justify-center gap-2"
            style={{
              fontSize: 13, fontWeight: 700,
              color: isValid ? "white" : "rgba(255,255,255,0.3)",
              background: isValid ? "linear-gradient(135deg, #7B5EFF, #5A3FCC)" : "rgba(255,255,255,0.04)",
              opacity: isValid ? 1 : 0.5,
              boxShadow: isValid ? "0 4px 16px rgba(123,94,255,0.3)" : "none",
            }}>
            <Navigation className="size-4" />
            Create Zone
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}