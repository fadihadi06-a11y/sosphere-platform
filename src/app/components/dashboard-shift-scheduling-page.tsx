// ═══════════════════════════════════════════════════════════════
// SOSphere Dashboard — Shift Scheduling Page
// Interactive weekly shift planner with drag-to-assign, templates,
// conflict detection, and coverage analytics
// ═══════════════════════════════════════════════════════════════
import React, { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Calendar, Clock, Users, Plus, X, Copy, Trash2,
  ChevronLeft, ChevronRight, Sun, Moon, Sunset,
  AlertTriangle, Check, RotateCcw, Filter,
  GripVertical, UserCheck, ArrowRight, Edit3,
  Repeat, Download, Search,
} from "lucide-react";
import {
  Card as DSCard, SectionHeader, Badge, Button as DSButton,
  Divider, TOKENS,
} from "./design-system";
import { useDashboardStore } from "./stores/dashboard-store";
import { toast } from "sonner";
import { hapticSuccess, hapticLight } from "./haptic-feedback";

// ── Types ─────────────────────────────────────────────────────
type ShiftType = "morning" | "afternoon" | "night" | "custom";

interface Shift {
  id: string;
  employeeId: string;
  day: number; // 0-6 (Mon-Sun)
  type: ShiftType;
  startHour: number;
  endHour: number;
  zone: string;
  note?: string;
}

interface ShiftTemplate {
  id: string;
  name: string;
  type: ShiftType;
  startHour: number;
  endHour: number;
  color: string;
  icon: React.ElementType;
}

// ── Constants ─────────────────────────────────────────────────
const SHIFT_TEMPLATES: ShiftTemplate[] = [
  { id: "morning",   name: "Morning",   type: "morning",   startHour: 6,  endHour: 14, color: "#FF9500", icon: Sun },
  { id: "afternoon", name: "Afternoon", type: "afternoon", startHour: 14, endHour: 22, color: "#00C8E0", icon: Sunset },
  { id: "night",     name: "Night",     type: "night",     startHour: 22, endHour: 6,  color: "#7B5EFF", icon: Moon },
];

const SHIFT_COLORS: Record<ShiftType, string> = {
  morning: "#FF9500",
  afternoon: "#00C8E0",
  night: "#7B5EFF",
  custom: "#00C853",
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ZONES = ["Zone A", "Zone B", "Zone C", "Zone D", "Zone E"];

const getWeekDates = (offset: number) => {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay() + 1 + offset * 7);
  return DAYS.map((_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    return d;
  });
};

// ── Initial mock shifts ────────────────────────────────────────
const INITIAL_SHIFTS: Shift[] = [
  { id: "S1", employeeId: "EMP-001", day: 0, type: "morning",   startHour: 6,  endHour: 14, zone: "Zone A" },
  { id: "S2", employeeId: "EMP-001", day: 1, type: "morning",   startHour: 6,  endHour: 14, zone: "Zone A" },
  { id: "S3", employeeId: "EMP-001", day: 2, type: "morning",   startHour: 6,  endHour: 14, zone: "Zone A" },
  { id: "S4", employeeId: "EMP-002", day: 0, type: "afternoon", startHour: 14, endHour: 22, zone: "Zone B" },
  { id: "S5", employeeId: "EMP-002", day: 1, type: "afternoon", startHour: 14, endHour: 22, zone: "Zone B" },
  { id: "S6", employeeId: "EMP-003", day: 0, type: "night",     startHour: 22, endHour: 6,  zone: "Zone A" },
  { id: "S7", employeeId: "EMP-003", day: 2, type: "night",     startHour: 22, endHour: 6,  zone: "Zone A" },
  { id: "S8", employeeId: "EMP-005", day: 0, type: "morning",   startHour: 6,  endHour: 14, zone: "Zone C" },
  { id: "S9", employeeId: "EMP-005", day: 1, type: "morning",   startHour: 6,  endHour: 14, zone: "Zone C" },
  { id: "S10", employeeId: "EMP-005", day: 3, type: "afternoon", startHour: 14, endHour: 22, zone: "Zone C" },
  { id: "S11", employeeId: "EMP-006", day: 1, type: "night",     startHour: 22, endHour: 6,  zone: "Zone D" },
  { id: "S12", employeeId: "EMP-006", day: 3, type: "night",     startHour: 22, endHour: 6,  zone: "Zone D" },
  { id: "S13", employeeId: "EMP-007", day: 0, type: "afternoon", startHour: 14, endHour: 22, zone: "Zone C" },
  { id: "S14", employeeId: "EMP-007", day: 2, type: "afternoon", startHour: 14, endHour: 22, zone: "Zone C" },
  { id: "S15", employeeId: "EMP-008", day: 0, type: "morning",   startHour: 6,  endHour: 14, zone: "Zone A" },
  { id: "S16", employeeId: "EMP-008", day: 1, type: "morning",   startHour: 6,  endHour: 14, zone: "Zone A" },
  { id: "S17", employeeId: "EMP-008", day: 2, type: "morning",   startHour: 6,  endHour: 14, zone: "Zone A" },
  { id: "S18", employeeId: "EMP-008", day: 3, type: "morning",   startHour: 6,  endHour: 14, zone: "Zone A" },
  { id: "S19", employeeId: "EMP-010", day: 0, type: "morning",   startHour: 6,  endHour: 14, zone: "Zone D" },
  { id: "S20", employeeId: "EMP-010", day: 2, type: "afternoon", startHour: 14, endHour: 22, zone: "Zone D" },
  { id: "S21", employeeId: "EMP-010", day: 4, type: "morning",   startHour: 6,  endHour: 14, zone: "Zone D" },
];

// ── Utility: detect shift conflicts ───────────────────────────
function detectConflicts(shifts: Shift[]): Set<string> {
  const conflictIds = new Set<string>();
  for (let i = 0; i < shifts.length; i++) {
    for (let j = i + 1; j < shifts.length; j++) {
      const a = shifts[i], b = shifts[j];
      if (a.employeeId === b.employeeId && a.day === b.day) {
        conflictIds.add(a.id);
        conflictIds.add(b.id);
      }
    }
  }
  return conflictIds;
}

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════
export function ShiftSchedulingPage({ t, webMode = false }: { t: (k: string) => string; webMode?: boolean }) {
  const storeEmployees = useDashboardStore(s => s.employees);
  const [shifts, setShifts] = useState<Shift[]>(() => {
    try {
      const saved = localStorage.getItem("sosphere_shifts");
      if (saved) {
        const parsed = JSON.parse(saved) as Shift[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { /* fallback */ }
    return INITIAL_SHIFTS;
  });
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<ShiftTemplate>(SHIFT_TEMPLATES[0]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTarget, setCreateTarget] = useState<{ employeeId: string; day: number } | null>(null);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [filterDept, setFilterDept] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCopyWeek, setShowCopyWeek] = useState(false);

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  // Auto-save shifts to localStorage on every change
  useEffect(() => {
    try {
      localStorage.setItem("sosphere_shifts", JSON.stringify(shifts));
    } catch { /* ignore storage errors */ }
  }, [shifts]);
  const conflicts = useMemo(() => detectConflicts(shifts), [shifts]);

  // Filtered employees
  const displayedEmployees = useMemo(() => {
    let list = storeEmployees.slice(0, 12); // Show first 12
    if (filterDept !== "all") list = list.filter(e => e.department === filterDept);
    if (searchQuery) list = list.filter(e => e.name.toLowerCase().includes(searchQuery.toLowerCase()));
    return list;
  }, [storeEmployees, filterDept, searchQuery]);

  const departments = useMemo(() => {
    const depts = new Set(storeEmployees.map(e => e.department));
    return ["all", ...Array.from(depts)];
  }, [storeEmployees]);

  // Coverage stats
  const coverageStats = useMemo(() => {
    const stats = DAYS.map((_, dayIdx) => {
      const dayShifts = shifts.filter(s => s.day === dayIdx);
      const morning = dayShifts.filter(s => s.type === "morning").length;
      const afternoon = dayShifts.filter(s => s.type === "afternoon").length;
      const night = dayShifts.filter(s => s.type === "night").length;
      return { morning, afternoon, night, total: morning + afternoon + night };
    });
    return stats;
  }, [shifts]);

  const totalHours = useMemo(() => {
    return shifts.reduce((sum, s) => {
      const h = s.endHour > s.startHour ? s.endHour - s.startHour : (24 - s.startHour) + s.endHour;
      return sum + h;
    }, 0);
  }, [shifts]);

  // Handlers
  const handleCellClick = useCallback((employeeId: string, day: number) => {
    setCreateTarget({ employeeId, day });
    setEditingShift(null);
    setShowCreateModal(true);
  }, []);

  const handleCreateShift = useCallback((zone: string, note?: string) => {
    if (!createTarget && !editingShift) return;
    if (editingShift) {
      setShifts(prev => prev.map(s => s.id === editingShift.id ? {
        ...s, type: selectedTemplate.type, startHour: selectedTemplate.startHour,
        endHour: selectedTemplate.endHour, zone, note,
      } : s));
    } else if (createTarget) {
      const newShift: Shift = {
        id: `S-${Date.now()}`,
        employeeId: createTarget.employeeId,
        day: createTarget.day,
        type: selectedTemplate.type,
        startHour: selectedTemplate.startHour,
        endHour: selectedTemplate.endHour,
        zone,
        note,
      };
      setShifts(prev => [...prev, newShift]);
    }
    setShowCreateModal(false);
    setCreateTarget(null);
    setEditingShift(null);
    hapticSuccess();
    toast.success("Shift assigned successfully!");
  }, [createTarget, editingShift, selectedTemplate]);

  const handleDeleteShift = useCallback((id: string) => {
    setShifts(prev => prev.filter(s => s.id !== id));
    hapticLight();
    toast.success("Shift deleted successfully!");
  }, []);

  const handleCopyWeek = useCallback(() => {
    const nextWeekShifts = shifts.map(s => ({
      ...s,
      id: `S-${Date.now()}-${(crypto.randomUUID ? crypto.randomUUID().slice(0,8) : Date.now().toString(36))}`,
    }));
    setShifts(prev => [...prev, ...nextWeekShifts]);
    setShowCopyWeek(false);
    hapticSuccess();
    toast.success("Week copied successfully!");
  }, [shifts]);

  const handleEditShift = useCallback((shift: Shift) => {
    setEditingShift(shift);
    setCreateTarget(null);
    const tpl = SHIFT_TEMPLATES.find(t => t.type === shift.type) || SHIFT_TEMPLATES[0];
    setSelectedTemplate(tpl);
    setShowCreateModal(true);
  }, []);

  const px = webMode ? "px-8 py-6" : "px-4 py-4";

  return (
    <div className={px}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-white flex items-center gap-2" style={{ fontSize: webMode ? 22 : 18, fontWeight: 700 }}>
            <Calendar className="size-5" style={{ color: "#00C8E0" }} />
            Shift Scheduling
          </h1>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
            Plan and manage employee shifts across all zones
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCopyWeek(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
            style={{ fontSize: 11, color: "#00C8E0", background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)", fontWeight: 600 }}
          >
            <Copy className="size-3" /> Copy Week
          </button>
          <button
            onClick={() => { hapticSuccess(); toast.success("Exporting Schedule", { description: "Weekly shift schedule PDF is being generated..." }); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
            style={{ fontSize: 11, color: "#7B5EFF", background: "rgba(123,94,255,0.08)", border: "1px solid rgba(123,94,255,0.15)", fontWeight: 600, cursor: "pointer" }}
          >
            <Download className="size-3" /> Export
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className={`grid ${webMode ? "grid-cols-4" : "grid-cols-2"} gap-3 mb-6`}>
        {[
          { label: "Total Shifts", value: shifts.length.toString(), color: "#00C8E0", icon: Calendar },
          { label: "Scheduled Hours", value: `${totalHours}h`, color: "#FF9500", icon: Clock },
          { label: "Employees Assigned", value: new Set(shifts.map(s => s.employeeId)).size.toString(), color: "#00C853", icon: Users },
          { label: "Conflicts", value: conflicts.size > 0 ? Math.floor(conflicts.size / 2).toString() : "0", color: conflicts.size > 0 ? "#FF2D55" : "#00C853", icon: conflicts.size > 0 ? AlertTriangle : Check },
        ].map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="p-3 rounded-xl"
            style={{
              background: `linear-gradient(135deg, ${kpi.color}08, ${kpi.color}03)`,
              border: `1px solid ${kpi.color}20`,
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <kpi.icon className="size-3.5" style={{ color: kpi.color }} />
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>{kpi.label}</span>
            </div>
            <p style={{ fontSize: 20, color: kpi.color, fontWeight: 700 }}>{kpi.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Week Navigator + Filters */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekOffset(w => w - 1)}
            className="size-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)" }}>
            <ChevronLeft className="size-4" />
          </button>
          <div className="px-3 py-1.5 rounded-lg" style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>
            <span style={{ fontSize: 12, color: "#00C8E0", fontWeight: 600 }}>
              {weekDates[0].toLocaleDateString("en", { month: "short", day: "numeric" })} — {weekDates[6].toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          </div>
          <button onClick={() => setWeekOffset(w => w + 1)}
            className="size-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)" }}>
            <ChevronRight className="size-4" />
          </button>
          {weekOffset !== 0 && (
            <button onClick={() => setWeekOffset(0)}
              className="px-2 py-1 rounded-md flex items-center gap-1"
              style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.04)" }}>
              <RotateCcw className="size-3" /> Today
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2" style={{ color: "rgba(255,255,255,0.3)" }} />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search employee..."
              className="pl-7 pr-3 py-1.5 rounded-lg outline-none"
              style={{
                fontSize: 11, color: "white", background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)", width: webMode ? 180 : 140,
              }}
            />
          </div>
          {/* Department filter */}
          <select
            value={filterDept}
            onChange={e => setFilterDept(e.target.value)}
            className="px-2 py-1.5 rounded-lg outline-none cursor-pointer"
            style={{
              fontSize: 11, color: "rgba(255,255,255,0.6)", background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {departments.map(d => (
              <option key={d} value={d} style={{ background: "#0A1220", color: "white" }}>
                {d === "all" ? "All Departments" : d}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Shift Templates Picker */}
      <div className="flex items-center gap-2 mb-4">
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600, letterSpacing: "0.5px" }}>TEMPLATE:</span>
        {SHIFT_TEMPLATES.map(tpl => (
          <button
            key={tpl.id}
            onClick={() => setSelectedTemplate(tpl)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all"
            style={{
              background: selectedTemplate.id === tpl.id ? `${tpl.color}18` : "rgba(255,255,255,0.02)",
              border: `1px solid ${selectedTemplate.id === tpl.id ? `${tpl.color}40` : "rgba(255,255,255,0.06)"}`,
            }}
          >
            <tpl.icon className="size-3" style={{ color: tpl.color }} />
            <span style={{ fontSize: 10, color: selectedTemplate.id === tpl.id ? tpl.color : "rgba(255,255,255,0.4)", fontWeight: 600 }}>
              {tpl.name}
            </span>
            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.25)" }}>
              {`${tpl.startHour}:00-${tpl.endHour}:00`}
            </span>
          </button>
        ))}
      </div>

      {/* Schedule Grid */}
      <div className="rounded-xl overflow-hidden" style={{ background: "rgba(10,18,32,0.6)", border: "1px solid rgba(255,255,255,0.04)" }}>
        {/* Grid header */}
        <div className="grid" style={{ gridTemplateColumns: webMode ? "180px repeat(7, 1fr)" : "120px repeat(7, 1fr)" }}>
          <div className="p-3 flex items-center" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", borderRight: "1px solid rgba(255,255,255,0.04)" }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>EMPLOYEE</span>
          </div>
          {DAYS.map((day, i) => {
            const d = weekDates[i];
            const isToday = new Date().toDateString() === d.toDateString();
            return (
              <div key={day} className="p-2 text-center" style={{
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                borderRight: i < 6 ? "1px solid rgba(255,255,255,0.04)" : undefined,
                background: isToday ? "rgba(0,200,224,0.04)" : undefined,
              }}>
                <p style={{ fontSize: 10, color: isToday ? "#00C8E0" : "rgba(255,255,255,0.4)", fontWeight: 600 }}>{day}</p>
                <p style={{ fontSize: 8, color: isToday ? "rgba(0,200,224,0.6)" : "rgba(255,255,255,0.2)" }}>
                  {d.toLocaleDateString("en", { month: "short", day: "numeric" })}
                </p>
              </div>
            );
          })}
        </div>

        {/* Grid rows */}
        {displayedEmployees.map((emp, rowIdx) => (
          <div key={emp.id} className="grid" style={{ gridTemplateColumns: webMode ? "180px repeat(7, 1fr)" : "120px repeat(7, 1fr)" }}>
            {/* Employee name cell */}
            <div className="p-2 flex items-center gap-2" style={{
              borderBottom: "1px solid rgba(255,255,255,0.03)",
              borderRight: "1px solid rgba(255,255,255,0.04)",
              background: rowIdx % 2 === 0 ? "rgba(255,255,255,0.01)" : undefined,
            }}>
              <div className="size-6 rounded-md flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.12)" }}>
                <span style={{ fontSize: 8, color: "#00C8E0", fontWeight: 700 }}>
                  {emp.name.split(" ").map(n => n[0]).join("")}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-white truncate" style={{ fontSize: 11, fontWeight: 600 }}>{emp.name}</p>
                <p className="truncate" style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>{emp.role}</p>
              </div>
            </div>
            {/* Day cells */}
            {DAYS.map((_, dayIdx) => {
              const dayShifts = shifts.filter(s => s.employeeId === emp.id && s.day === dayIdx);
              const isToday = new Date().toDateString() === weekDates[dayIdx].toDateString();
              return (
                <div
                  key={dayIdx}
                  onClick={() => dayShifts.length === 0 && handleCellClick(emp.id, dayIdx)}
                  className="p-1 flex flex-col gap-0.5 min-h-[44px] cursor-pointer group relative"
                  style={{
                    borderBottom: "1px solid rgba(255,255,255,0.03)",
                    borderRight: dayIdx < 6 ? "1px solid rgba(255,255,255,0.04)" : undefined,
                    background: isToday ? "rgba(0,200,224,0.02)" : rowIdx % 2 === 0 ? "rgba(255,255,255,0.005)" : undefined,
                  }}
                >
                  {dayShifts.length > 0 ? dayShifts.map(shift => {
                    const color = SHIFT_COLORS[shift.type];
                    const isConflict = conflicts.has(shift.id);
                    return (
                      <motion.div
                        key={shift.id}
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="rounded-md px-1.5 py-1 cursor-pointer relative group/shift"
                        style={{
                          background: isConflict ? "rgba(255,45,85,0.15)" : `${color}12`,
                          border: `1px solid ${isConflict ? "rgba(255,45,85,0.3)" : `${color}25`}`,
                        }}
                        onClick={(e) => { e.stopPropagation(); handleEditShift(shift); }}
                      >
                        <div className="flex items-center justify-between">
                          <span style={{ fontSize: 8, color: isConflict ? "#FF2D55" : color, fontWeight: 700 }}>
                            {shift.type === "morning" ? "AM" : shift.type === "afternoon" ? "PM" : "NT"}
                          </span>
                          {isConflict && <AlertTriangle className="size-2.5" style={{ color: "#FF2D55" }} />}
                        </div>
                        <p style={{ fontSize: 7, color: "rgba(255,255,255,0.3)" }}>
                          {`${shift.startHour}:00-${shift.endHour}:00`}
                        </p>
                        <p style={{ fontSize: 7, color: `${color}80` }}>{shift.zone}</p>
                        {/* Delete button on hover */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteShift(shift.id); }}
                          className="absolute -top-1 -right-1 size-4 rounded-full items-center justify-center hidden group-hover/shift:flex"
                          style={{ background: "#FF2D55", color: "white" }}
                        >
                          <X className="size-2.5" />
                        </button>
                      </motion.div>
                    );
                  }) : (
                    <div className="flex-1 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Plus className="size-3.5" style={{ color: "rgba(255,255,255,0.15)" }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Coverage Summary Row */}
      <div className="mt-4 rounded-xl p-4" style={{ background: "rgba(10,18,32,0.4)", border: "1px solid rgba(255,255,255,0.04)" }}>
        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600, letterSpacing: "0.5px", marginBottom: 8 }}>
          DAILY COVERAGE
        </p>
        <div className="grid" style={{ gridTemplateColumns: webMode ? "repeat(7, 1fr)" : "repeat(7, 1fr)", gap: 8 }}>
          {coverageStats.map((stat, i) => (
            <div key={i} className="text-center">
              <p style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontWeight: 600, marginBottom: 4 }}>{DAYS[i]}</p>
              <div className="flex flex-col gap-1">
                {[
                  { label: "AM", count: stat.morning, color: "#FF9500" },
                  { label: "PM", count: stat.afternoon, color: "#00C8E0" },
                  { label: "NT", count: stat.night, color: "#7B5EFF" },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-center gap-1">
                    <div className="size-1.5 rounded-full" style={{ background: row.color, opacity: row.count > 0 ? 1 : 0.2 }} />
                    <span style={{ fontSize: 8, color: row.count > 0 ? row.color : "rgba(255,255,255,0.15)", fontWeight: 600 }}>
                      {row.count}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 h-1 rounded-full mx-1" style={{ background: "rgba(255,255,255,0.04)" }}>
                <div className="h-full rounded-full" style={{
                  width: `${Math.min((stat.total / 6) * 100, 100)}%`,
                  background: stat.total >= 4 ? "#00C853" : stat.total >= 2 ? "#FF9500" : "#FF2D55",
                }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create/Edit Shift Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <ShiftModal
            editing={editingShift}
            template={selectedTemplate}
            templates={SHIFT_TEMPLATES}
            onSelectTemplate={setSelectedTemplate}
            onConfirm={handleCreateShift}
            onClose={() => { setShowCreateModal(false); setCreateTarget(null); setEditingShift(null); }}
            employeeName={editingShift
              ? storeEmployees.find(e => e.id === editingShift.employeeId)?.name || ""
              : storeEmployees.find(e => e.id === createTarget?.employeeId)?.name || ""
            }
            dayLabel={editingShift ? DAYS[editingShift.day] : createTarget ? DAYS[createTarget.day] : ""}
          />
        )}
      </AnimatePresence>

      {/* Copy Week Confirmation */}
      <AnimatePresence>
        {showCopyWeek && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
            onClick={() => setShowCopyWeek(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-80 rounded-2xl p-5"
              style={{ background: "#0A1220", border: "1px solid rgba(0,200,224,0.15)" }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-3">
                <Repeat className="size-4" style={{ color: "#00C8E0" }} />
                <h3 className="text-white" style={{ fontSize: 15, fontWeight: 700 }}>Copy This Week</h3>
              </div>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 16 }}>
                Duplicate all {shifts.length} shifts to next week? Existing shifts won't be affected.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowCopyWeek(false)}
                  className="flex-1 py-2 rounded-lg"
                  style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", fontWeight: 600 }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCopyWeek}
                  className="flex-1 py-2 rounded-lg"
                  style={{ fontSize: 12, color: "white", background: "rgba(0,200,224,0.2)", border: "1px solid rgba(0,200,224,0.3)", fontWeight: 600 }}
                >
                  Copy
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Shift Create/Edit Modal
// ═══════════════════════════════════════════════════════════════
function ShiftModal({ editing, template, templates, onSelectTemplate, onConfirm, onClose, employeeName, dayLabel }: {
  editing: Shift | null;
  template: ShiftTemplate;
  templates: ShiftTemplate[];
  onSelectTemplate: (t: ShiftTemplate) => void;
  onConfirm: (zone: string, note?: string) => void;
  onClose: () => void;
  employeeName: string;
  dayLabel: string;
}) {
  const [zone, setZone] = useState(editing?.zone || "Zone A");
  const [note, setNote] = useState(editing?.note || "");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="w-96 rounded-2xl overflow-hidden"
        style={{ background: "#0A1220", border: "1px solid rgba(0,200,224,0.15)", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg flex items-center justify-center" style={{ background: `${template.color}15` }}>
              <template.icon className="size-4" style={{ color: template.color }} />
            </div>
            <div>
              <h3 className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>
                {editing ? "Edit Shift" : "Assign Shift"}
              </h3>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
                {employeeName} &middot; {dayLabel}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="size-7 rounded-lg flex items-center justify-center"
            style={{ color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.04)" }}>
            <X className="size-3.5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Template Selection */}
          <div>
            <label style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600, letterSpacing: "0.5px" }}>SHIFT TYPE</label>
            <div className="flex gap-2 mt-2">
              {templates.map(tpl => (
                <button
                  key={tpl.id}
                  onClick={() => onSelectTemplate(tpl)}
                  className="flex-1 py-2 rounded-lg flex flex-col items-center gap-1"
                  style={{
                    background: template.id === tpl.id ? `${tpl.color}15` : "rgba(255,255,255,0.02)",
                    border: `1px solid ${template.id === tpl.id ? `${tpl.color}35` : "rgba(255,255,255,0.06)"}`,
                  }}
                >
                  <tpl.icon className="size-4" style={{ color: template.id === tpl.id ? tpl.color : "rgba(255,255,255,0.25)" }} />
                  <span style={{ fontSize: 9, color: template.id === tpl.id ? tpl.color : "rgba(255,255,255,0.3)", fontWeight: 600 }}>
                    {tpl.name}
                  </span>
                  <span style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>
                    {`${tpl.startHour}:00-${tpl.endHour}:00`}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Zone Selection */}
          <div>
            <label style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600, letterSpacing: "0.5px" }}>ZONE</label>
            <select
              value={zone}
              onChange={e => setZone(e.target.value)}
              className="w-full mt-1.5 px-3 py-2 rounded-lg outline-none"
              style={{ fontSize: 12, color: "white", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              {ZONES.map(z => (
                <option key={z} value={z} style={{ background: "#0A1220" }}>{z}</option>
              ))}
            </select>
          </div>

          {/* Note */}
          <div>
            <label style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600, letterSpacing: "0.5px" }}>NOTE (OPTIONAL)</label>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g., Fire watch, standby duty..."
              className="w-full mt-1.5 px-3 py-2 rounded-lg outline-none"
              style={{ fontSize: 12, color: "white", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 flex items-center gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg"
            style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", fontWeight: 600 }}>
            Cancel
          </button>
          <button
            onClick={() => onConfirm(zone, note || undefined)}
            className="flex-1 py-2.5 rounded-lg flex items-center justify-center gap-1.5"
            style={{ fontSize: 12, color: "white", background: `${template.color}25`, border: `1px solid ${template.color}40`, fontWeight: 600 }}
          >
            <Check className="size-3.5" />
            {editing ? "Update" : "Assign"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}