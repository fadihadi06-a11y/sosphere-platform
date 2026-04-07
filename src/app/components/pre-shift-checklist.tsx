// ═══════════════════════════════════════════════════════════════
// SOSphere — Pre-Shift Safety Checklist (Enterprise Dashboard)
// ─────────────────────────────────────────────────────────────
// Workers must complete safety checks before starting shift
// Admin can customize checklists per zone / role
// Tracks compliance % and flags non-compliant workers
// ═══════════════════════════════════════════════════════════════

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Clipboard, CheckCircle, CheckCircle2, Circle,
  AlertTriangle, Shield, ChevronRight, ChevronDown,
  Plus, X, Eye, Clock, Users, BarChart3, Zap,
  HardHat, Flame, Activity, MapPin, Settings, Star,
  Send, Download, Search, Filter, UserCheck, XCircle,
  ClipboardCheck, ClipboardList, ShieldCheck, FileText,
  CircleCheck, CircleDot, Bell, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { hapticSuccess } from "./haptic-feedback";
import { TYPOGRAPHY, TOKENS, KPICard, Card, SectionHeader, Badge, StatPill } from "./design-system";

// ── Types ─────────────────────────────────────────────────────
interface ChecklistItem {
  id: string;
  text: string;
  category: "ppe" | "equipment" | "environment" | "communication" | "medical";
  required: boolean;
}

interface ChecklistTemplate {
  id: string;
  name: string;
  zone?: string;
  role?: string;
  items: ChecklistItem[];
  isDefault: boolean;
}

interface ChecklistSubmission {
  id: string;
  employeeName: string;
  employeeId: string;
  templateId: string;
  completedItems: string[];
  totalItems: number;
  submittedAt: Date;
  zone: string;
  isComplete: boolean;
  flaggedItems: string[];
  avatar: string;
}

// ── Mock Data ─────────────────────────────────────────────────
const CATEGORY_CONFIG = {
  ppe:           { label: "PPE & Gear",      color: "#00C8E0", icon: HardHat, gradient: "linear-gradient(135deg, #00C8E020, #00C8E008)" },
  equipment:     { label: "Equipment",       color: "#FF9500", icon: Settings, gradient: "linear-gradient(135deg, #FF950020, #FF950008)" },
  environment:   { label: "Environment",     color: "#00C853", icon: MapPin, gradient: "linear-gradient(135deg, #00C85320, #00C85308)" },
  communication: { label: "Communication",   color: "#8B5CF6", icon: Activity, gradient: "linear-gradient(135deg, #8B5CF620, #8B5CF608)" },
  medical:       { label: "Medical",         color: "#FF2D55", icon: Shield, gradient: "linear-gradient(135deg, #FF2D5520, #FF2D5508)" },
};

const DEFAULT_TEMPLATES: ChecklistTemplate[] = [
  {
    id: "TPL-001", name: "General Field Safety", isDefault: true,
    items: [
      { id: "C1", text: "Wearing hard hat / safety helmet", category: "ppe", required: true },
      { id: "C2", text: "High-visibility vest is on", category: "ppe", required: true },
      { id: "C3", text: "Steel-toe boots are worn", category: "ppe", required: true },
      { id: "C4", text: "Safety glasses / goggles ready", category: "ppe", required: false },
      { id: "C5", text: "Radio / phone is charged and working", category: "communication", required: true },
      { id: "C6", text: "Buddy pair confirmed for the shift", category: "communication", required: false },
      { id: "C7", text: "Fire extinguisher location noted", category: "environment", required: true },
      { id: "C8", text: "Evacuation route reviewed", category: "environment", required: true },
      { id: "C9", text: "Equipment pre-use inspection done", category: "equipment", required: true },
      { id: "C10", text: "First aid kit location known", category: "medical", required: true },
      { id: "C11", text: "No open wounds or untreated injuries", category: "medical", required: false },
      { id: "C12", text: "Weather conditions are safe to work", category: "environment", required: true },
    ],
  },
  {
    id: "TPL-002", name: "High-Risk Zone Safety", zone: "Zone D", isDefault: false,
    items: [
      { id: "H1", text: "Gas detector is calibrated and active", category: "equipment", required: true },
      { id: "H2", text: "Respiratory protection (mask/respirator)", category: "ppe", required: true },
      { id: "H3", text: "Chemical-resistant gloves worn", category: "ppe", required: true },
      { id: "H4", text: "Spill containment equipment verified", category: "equipment", required: true },
      { id: "H5", text: "Emergency shower location confirmed", category: "environment", required: true },
      { id: "H6", text: "Supervisor briefing completed", category: "communication", required: true },
      { id: "H7", text: "SOS app is active and connected", category: "communication", required: true },
      { id: "H8", text: "Fall protection harness inspected", category: "ppe", required: true },
    ],
  },
];

const RECENT_SUBMISSIONS: ChecklistSubmission[] = [
  { id: "SUB-001", employeeName: "Ahmed Khalil", employeeId: "EMP-001", templateId: "TPL-001", completedItems: ["C1","C2","C3","C5","C7","C8","C9","C10","C12"], totalItems: 12, submittedAt: new Date(Date.now() - 1800000), zone: "Zone A", isComplete: false, flaggedItems: ["C4","C6","C11"], avatar: "AK" },
  { id: "SUB-002", employeeName: "Sara Al-Mutairi", employeeId: "EMP-005", templateId: "TPL-001", completedItems: ["C1","C2","C3","C4","C5","C6","C7","C8","C9","C10","C11","C12"], totalItems: 12, submittedAt: new Date(Date.now() - 3600000), zone: "Zone C", isComplete: true, flaggedItems: [], avatar: "SM" },
  { id: "SUB-003", employeeName: "Mohammed Ali", employeeId: "EMP-006", templateId: "TPL-002", completedItems: ["H1","H2","H3","H5","H6","H7"], totalItems: 8, submittedAt: new Date(Date.now() - 5400000), zone: "Zone D", isComplete: false, flaggedItems: ["H4","H8"], avatar: "MA" },
  { id: "SUB-004", employeeName: "Lina Chen", employeeId: "EMP-007", templateId: "TPL-001", completedItems: ["C1","C2","C3","C4","C5","C7","C8","C9","C10","C12"], totalItems: 12, submittedAt: new Date(Date.now() - 7200000), zone: "Zone C", isComplete: false, flaggedItems: ["C6","C11"], avatar: "LC" },
  { id: "SUB-005", employeeName: "Omar Al-Farsi", employeeId: "EMP-008", templateId: "TPL-001", completedItems: ["C1","C2","C3","C4","C5","C6","C7","C8","C9","C10","C11","C12"], totalItems: 12, submittedAt: new Date(Date.now() - 9000000), zone: "Zone A", isComplete: true, flaggedItems: [], avatar: "OF" },
];

// ── GlowIcon ──────────────────────────────────────────────────
function GlowIcon({ icon: Icon, color, size = 40, iconSize = 20 }: {
  icon: any; color: string; size?: number; iconSize?: number;
}) {
  return (
    <div className="flex items-center justify-center rounded-xl" style={{
      width: size, height: size,
      background: `linear-gradient(145deg, ${color}20, ${color}08)`,
      border: `1px solid ${color}22`,
      boxShadow: `0 4px 16px ${color}10, inset 0 1px 0 ${color}08`,
    }}>
      <Icon size={iconSize} color={color} strokeWidth={1.6} />
    </div>
  );
}

// ── Compliance Ring ───────────────────────────────────────────
function ComplianceRing({ value, color, size = 48 }: { value: number; color: string; size?: number }) {
  const r = (size - 6) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={3.5} />
        <motion.circle
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - value / 100) }}
          transition={{ duration: 1, ease: "easeOut" }}
          cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={3.5}
          strokeLinecap="round" strokeDasharray={circumference}
          style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span style={{ fontSize: size * 0.22, fontWeight: 900, color, fontVariantNumeric: "tabular-nums" }}>{value}%</span>
      </div>
    </div>
  );
}

// ── Dashboard Pre-Shift Checklist Page ────────────────────────
export function PreShiftChecklistPage({ t, webMode, onNavigateToFlagged }: { t: (k: string) => string; webMode?: boolean; onNavigateToFlagged?: () => void }) {
  const [activeTab, setActiveTab] = useState<"submissions" | "templates" | "analytics">("submissions");
  const [expandedSubmission, setExpandedSubmission] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "complete" | "incomplete">("all");
  const [remindedWorkers, setRemindedWorkers] = useState<Set<string>>(new Set());
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);
  const [showRemindAllModal, setShowRemindAllModal] = useState(false);

  const totalSubmissions = RECENT_SUBMISSIONS.length;
  const completeCount = RECENT_SUBMISSIONS.filter(s => s.isComplete).length;
  const incompleteCount = totalSubmissions - completeCount;
  const complianceRate = totalSubmissions > 0 ? Math.round((completeCount / totalSubmissions) * 100) : 0;
  const flaggedCount = RECENT_SUBMISSIONS.filter(s => s.flaggedItems.length > 0).length;
  const totalFlaggedItems = RECENT_SUBMISSIONS.reduce((sum, s) => sum + s.flaggedItems.length, 0);

  const filteredSubmissions = RECENT_SUBMISSIONS.filter(sub => {
    const matchesSearch = !searchQuery || sub.employeeName.toLowerCase().includes(searchQuery.toLowerCase()) || sub.zone.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterStatus === "all" || (filterStatus === "complete" && sub.isComplete) || (filterStatus === "incomplete" && !sub.isComplete);
    return matchesSearch && matchesFilter;
  });

  const handleRemind = useCallback((subId: string) => {
    hapticSuccess();
    setRemindedWorkers(prev => new Set([...prev, subId]));
    const sub = RECENT_SUBMISSIONS.find(s => s.id === subId);
    toast.success("Reminder Sent", { description: `${sub?.employeeName || "Worker"} has been notified to complete their checklist` });
  }, []);

  const handleRemindAll = useCallback(() => {
    hapticSuccess();
    const incompleteSubmissions = RECENT_SUBMISSIONS.filter(s => !s.isComplete);
    setRemindedWorkers(prev => new Set([...prev, ...incompleteSubmissions.map(s => s.id)]));
    toast.success("Reminders Sent", { description: `${incompleteSubmissions.length} workers have been notified to complete their checklists` });
    setShowRemindAllModal(false);
  }, []);

  return (
    <div className="p-6 space-y-6" style={{ fontFamily: "'Outfit', sans-serif" }}>

      {/* ══════════════════════════════════════════════════════ */}
      {/* KPI Cards                                            */}
      {/* ══════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-5 gap-4">
        <KPICard label="Submissions Today" value={totalSubmissions} icon={ClipboardList} color="#00C8E0"
          subtitle="Pre-shift checklists" trend={{ value: "+3 from yesterday", positive: true }} />
        <KPICard label="Fully Compliant" value={completeCount} icon={ClipboardCheck} color="#00C853"
          subtitle="100% completion" trend={{ value: `${completeCount}/${totalSubmissions}`, positive: completeCount >= totalSubmissions / 2 }} />
        <KPICard label="Incomplete" value={incompleteCount} icon={AlertTriangle} color="#FF9500"
          subtitle="Needs attention" />
        {/* Compliance Rate — with Send Reminder action */}
        <Card padding={18} glow={complianceRate < 95 ? "#FF2D55" : undefined} style={complianceRate < 95 ? { border: "1px solid rgba(255,45,85,0.25)" } : undefined}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...TYPOGRAPHY.overline, fontSize: 10, color: TOKENS.text.muted, marginBottom: 8 }}>Compliance Rate</div>
              <div style={{ ...TYPOGRAPHY.kpiValue, color: complianceRate >= 80 ? "#00C853" : complianceRate >= 60 ? "#FF9500" : "#FF2D55" }}>{complianceRate}%</div>
              <div style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted, marginTop: 6 }}>Target: 95%</div>
            </div>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: `linear-gradient(135deg, ${complianceRate >= 80 ? "#00C853" : complianceRate >= 60 ? "#FF9500" : "#FF2D55"}18 0%, ${complianceRate >= 80 ? "#00C853" : complianceRate >= 60 ? "#FF9500" : "#FF2D55"}08 100%)`,
              border: `1px solid ${complianceRate >= 80 ? "#00C853" : complianceRate >= 60 ? "#FF9500" : "#FF2D55"}20`,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <BarChart3 size={19} color={complianceRate >= 80 ? "#00C853" : complianceRate >= 60 ? "#FF9500" : "#FF2D55"} strokeWidth={1.8} />
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={() => setShowRemindAllModal(true)}
            className="w-full flex items-center justify-center gap-1.5 mt-3 py-2 rounded-lg"
            style={{
              background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.18)",
              cursor: "pointer",
            }}>
            <Send size={11} color="#FF2D55" strokeWidth={2} />
            <span style={{ fontSize: 10, fontWeight: 700, color: "#FF2D55" }}>Send Reminder to All</span>
          </motion.button>
        </Card>
        {/* Flagged Items — with Review Flagged action */}
        <Card padding={18}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...TYPOGRAPHY.overline, fontSize: 10, color: TOKENS.text.muted, marginBottom: 8 }}>Flagged Items</div>
              <div style={{ ...TYPOGRAPHY.kpiValue, color: flaggedCount > 0 ? "#FF2D55" : "#00C853" }}>{totalFlaggedItems}</div>
              <div style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted, marginTop: 6 }}>{flaggedCount} workers with issues</div>
            </div>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: `linear-gradient(135deg, ${flaggedCount > 0 ? "#FF2D55" : "#00C853"}18 0%, ${flaggedCount > 0 ? "#FF2D55" : "#00C853"}08 100%)`,
              border: `1px solid ${flaggedCount > 0 ? "#FF2D55" : "#00C853"}20`,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <XCircle size={19} color={flaggedCount > 0 ? "#FF2D55" : "#00C853"} strokeWidth={1.8} />
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={() => { if (onNavigateToFlagged) onNavigateToFlagged(); }}
            className="w-full flex items-center justify-center gap-1.5 mt-3 py-2 rounded-lg"
            style={{
              background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.18)",
              cursor: "pointer",
            }}>
            <Eye size={11} color="#FF9500" strokeWidth={2} />
            <span style={{ fontSize: 10, fontWeight: 700, color: "#FF9500" }}>Review in Incident & Risk</span>
          </motion.button>
        </Card>
      </div>

      {/* ── Remind All Confirmation Modal ── */}
      <AnimatePresence>
        {showRemindAllModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
            onClick={() => setShowRemindAllModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="rounded-2xl p-6 mx-4"
              style={{
                background: "linear-gradient(145deg, rgba(20,30,50,0.98), rgba(10,18,32,0.98))",
                border: "1px solid rgba(255,45,85,0.15)",
                boxShadow: "0 24px 64px rgba(0,0,0,0.5), 0 0 40px rgba(255,45,85,0.08)",
                maxWidth: 420, width: "100%",
              }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="size-11 rounded-xl flex items-center justify-center" style={{
                  background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.2)",
                }}>
                  <Send size={18} color="#FF2D55" />
                </div>
                <div>
                  <p style={{ fontSize: 15, fontWeight: 800, color: "rgba(255,255,255,0.95)" }}>Send Bulk Reminder</p>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>Pre-shift checklist notification</p>
                </div>
              </div>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.6, marginBottom: 20 }}>
                Send pre-shift reminder to all <span style={{ color: "#FF2D55", fontWeight: 700 }}>{incompleteCount} incomplete</span> employees? They will receive a push notification to complete their safety checklist before starting their shift.
              </p>
              <div className="flex gap-3">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setShowRemindAllModal(false)}
                  className="flex-1 py-2.5 rounded-xl"
                  style={{
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                    fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.4)", cursor: "pointer",
                  }}
                >Cancel</motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleRemindAll}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl"
                  style={{
                    background: "rgba(255,45,85,0.15)", border: "1px solid rgba(255,45,85,0.3)",
                    fontSize: 12, fontWeight: 700, color: "#FF2D55", cursor: "pointer",
                  }}
                >
                  <Send size={13} />
                  Send to All {incompleteCount}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══════════════════════════════════════════════════════ */}
      {/* Tabs + Actions Bar                                   */}
      {/* ══════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2 p-1.5 rounded-xl" style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.05)",
        }}>
          {([
            { id: "submissions" as const, icon: ClipboardList, label: "Submissions" },
            { id: "templates" as const, icon: FileText, label: "Templates" },
            { id: "analytics" as const, icon: BarChart3, label: "Analytics" },
          ]).map(tab => (
            <motion.button
              key={tab.id}
              whileTap={{ scale: 0.97 }}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg transition-all"
              style={{
                background: activeTab === tab.id ? "rgba(0,200,224,0.08)" : "transparent",
                border: activeTab === tab.id ? "1px solid rgba(0,200,224,0.18)" : "1px solid transparent",
                cursor: "pointer",
              }}>
              <tab.icon size={14} color={activeTab === tab.id ? "#00C8E0" : "rgba(255,255,255,0.25)"} strokeWidth={1.8} />
              <span style={{
                ...TYPOGRAPHY.caption,
                fontWeight: activeTab === tab.id ? 700 : 500,
                color: activeTab === tab.id ? "#00C8E0" : "rgba(255,255,255,0.3)",
              }}>{tab.label}</span>
            </motion.button>
          ))}
        </div>

        {/* Search & Filter */}
        {activeTab === "submissions" && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}>
              <Search size={13} color="rgba(255,255,255,0.25)" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search worker or zone..."
                className="bg-transparent outline-none text-white"
                style={{ ...TYPOGRAPHY.caption, width: 160, caretColor: "#00C8E0" }}
              />
            </div>
            <div className="flex gap-1">
              {(["all", "complete", "incomplete"] as const).map(f => (
                <button key={f} onClick={() => setFilterStatus(f)}
                  className="px-3 py-1.5 rounded-lg"
                  style={{
                    background: filterStatus === f ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${filterStatus === f ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.04)"}`,
                    cursor: "pointer",
                    ...TYPOGRAPHY.micro,
                    color: filterStatus === f ? "#00C8E0" : "rgba(255,255,255,0.3)",
                  }}>
                  {f === "all" ? "All" : f === "complete" ? "Complete" : "Incomplete"}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════ */}
      {/* Content                                              */}
      {/* ══════════════════════════════════════════════════════ */}
      <AnimatePresence mode="wait">

        {/* ── SUBMISSIONS TAB ────────────────────────────────── */}
        {activeTab === "submissions" && (
          <motion.div key="submissions" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
            {filteredSubmissions.length === 0 ? (
              <Card padding={32}>
                <div className="text-center">
                  <GlowIcon icon={Search} color="#00C8E0" size={48} iconSize={22} />
                  <p style={{ ...TYPOGRAPHY.h3, color: TOKENS.text.primary, marginTop: 12 }}>No results found</p>
                  <p style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted, marginTop: 4 }}>Try adjusting your search or filter</p>
                </div>
              </Card>
            ) : (
              filteredSubmissions.map(sub => {
                const completionRate = Math.round((sub.completedItems.length / sub.totalItems) * 100);
                const isExpanded = expandedSubmission === sub.id;
                const reminded = remindedWorkers.has(sub.id);
                const statusColor = sub.isComplete ? "#00C853" : completionRate >= 70 ? "#FF9500" : "#FF2D55";

                return (
                  <motion.div key={sub.id} layout className="rounded-xl overflow-hidden" style={{
                    background: sub.isComplete ? "rgba(0,200,83,0.02)" : "rgba(255,150,0,0.02)",
                    border: `1px solid ${sub.isComplete ? "rgba(0,200,83,0.08)" : "rgba(255,150,0,0.08)"}`,
                  }}>
                    <div onClick={() => setExpandedSubmission(isExpanded ? null : sub.id)}
                      className="w-full flex items-center gap-4 p-4 text-left cursor-pointer">
                      
                      {/* Avatar */}
                      <div className="size-10 rounded-xl flex items-center justify-center shrink-0" style={{
                        background: `linear-gradient(135deg, ${statusColor}20, ${statusColor}08)`,
                        border: `1px solid ${statusColor}20`,
                      }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: statusColor }}>{sub.avatar}</span>
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p style={{ ...TYPOGRAPHY.h4, color: TOKENS.text.primary }} className="truncate">{sub.employeeName}</p>
                          {sub.isComplete ? (
                            <Badge variant="success" size="sm">COMPLETE</Badge>
                          ) : (
                            <Badge variant="warning" size="sm">{sub.flaggedItems.length} FLAGGED</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="flex items-center gap-1" style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted }}>
                            <MapPin size={9} /> {sub.zone}
                          </span>
                          <span className="flex items-center gap-1" style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted }}>
                            <Clock size={9} /> {sub.submittedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <span style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted }}>
                            {sub.employeeId}
                          </span>
                        </div>
                      </div>

                      {/* Completion Ring */}
                      <ComplianceRing value={completionRate} color={statusColor} size={44} />

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        {!sub.isComplete && (
                          <div className="relative">
                            <motion.button
                              whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                              onClick={e => { e.stopPropagation(); handleRemind(sub.id); }}
                              disabled={reminded}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                              style={{
                                background: reminded ? "rgba(0,200,83,0.06)" : "rgba(255,149,0,0.06)",
                                border: `1px solid ${reminded ? "rgba(0,200,83,0.15)" : "rgba(255,149,0,0.12)"}`,
                                cursor: reminded ? "default" : "pointer",
                                ...TYPOGRAPHY.micro,
                                color: reminded ? "#00C853" : "#FF9500",
                              }}>
                              {reminded ? <CheckCircle2 size={11} /> : <Bell size={11} />}
                              {reminded ? "Reminded" : "Remind"}
                            </motion.button>
                            {sub.flaggedItems.length > 0 && !reminded && (
                              <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center rounded-full"
                                style={{
                                  minWidth: 16, height: 16, padding: "0 4px",
                                  background: "#FF2D55", fontSize: 9, fontWeight: 900, color: "#fff",
                                  boxShadow: "0 2px 6px rgba(255,45,85,0.4)",
                                }}>
                                {sub.flaggedItems.length}
                              </span>
                            )}
                          </div>
                        )}
                        <ChevronRight size={14} color="rgba(255,255,255,0.15)"
                          style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.2s" }} />
                      </div>
                    </div>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                          <div className="px-5 pb-4" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 14 }}>
                            {sub.flaggedItems.length > 0 && (
                              <div className="mb-4 p-3 rounded-xl flex items-start gap-3" style={{
                                background: "rgba(255,150,0,0.04)",
                                border: "1px solid rgba(255,150,0,0.1)",
                              }}>
                                <GlowIcon icon={AlertTriangle} color="#FF9500" size={28} iconSize={13} />
                                <div>
                                  <span style={{ ...TYPOGRAPHY.caption, color: "#FF9500", fontWeight: 700 }}>
                                    {sub.flaggedItems.length} item(s) incomplete or flagged
                                  </span>
                                  <p style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted, marginTop: 2 }}>
                                    Worker may need additional training or equipment
                                  </p>
                                </div>
                              </div>
                            )}
                            
                            {/* Category Summary */}
                            <div className="flex flex-wrap gap-2 mb-4">
                              {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => {
                                const template = DEFAULT_TEMPLATES.find(t => t.id === sub.templateId);
                                const catItems = template?.items.filter(i => i.category === key) || [];
                                if (catItems.length === 0) return null;
                                const completedCat = catItems.filter(i => sub.completedItems.includes(i.id)).length;
                                const CatIcon = cfg.icon;
                                return (
                                  <div key={key} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{
                                    background: `${cfg.color}06`, border: `1px solid ${cfg.color}10`,
                                  }}>
                                    <CatIcon size={10} color={cfg.color} />
                                    <span style={{ ...TYPOGRAPHY.micro, color: cfg.color }}>{cfg.label}</span>
                                    <span style={{ ...TYPOGRAPHY.micro, fontWeight: 800, color: completedCat === catItems.length ? "#00C853" : "#FF9500" }}>
                                      {completedCat}/{catItems.length}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>

                            <div className="space-y-1.5">
                              {DEFAULT_TEMPLATES.find(t => t.id === sub.templateId)?.items.map(item => {
                                const completed = sub.completedItems.includes(item.id);
                                const catCfg = CATEGORY_CONFIG[item.category];
                                return (
                                  <div key={item.id} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-white/[0.01]">
                                    {completed
                                      ? <CheckCircle2 size={15} color="#00C853" strokeWidth={1.8} />
                                      : <Circle size={15} color="rgba(255,150,0,0.4)" strokeWidth={1.8} />
                                    }
                                    <span style={{
                                      ...TYPOGRAPHY.bodySm,
                                      color: completed ? "rgba(255,255,255,0.35)" : "rgba(255,150,0,0.7)",
                                      textDecoration: completed ? "line-through" : "none",
                                      flex: 1,
                                    }}>{item.text}</span>
                                    <div className="flex items-center gap-2">
                                      {item.required && !completed && (
                                        <Badge variant="danger" size="sm">REQUIRED</Badge>
                                      )}
                                      <div className="size-5 rounded flex items-center justify-center" style={{
                                        background: `${catCfg.color}08`,
                                      }}>
                                        <catCfg.icon size={10} color={catCfg.color} />
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })
            )}
          </motion.div>
        )}

        {/* ── TEMPLATES TAB ─────────────────────────────────── */}
        {activeTab === "templates" && (
          <motion.div key="templates" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
            {DEFAULT_TEMPLATES.map(template => {
              const isExpanded = expandedTemplate === template.id;
              const requiredCount = template.items.filter(i => i.required).length;
              return (
                <Card key={template.id} glow={template.isDefault ? "#00C8E0" : undefined} padding={0}>
                  <button
                    onClick={() => setExpandedTemplate(isExpanded ? null : template.id)}
                    className="w-full flex items-center gap-4 p-5 text-left cursor-pointer"
                  >
                    <GlowIcon icon={template.isDefault ? ClipboardCheck : ClipboardList}
                      color={template.isDefault ? "#00C8E0" : "#FF9500"} size={44} iconSize={20} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span style={{ ...TYPOGRAPHY.h3, color: TOKENS.text.primary }}>{template.name}</span>
                        {template.isDefault && <Badge variant="default" size="sm">DEFAULT</Badge>}
                        {template.zone && <Badge variant="warning" size="sm">{template.zone}</Badge>}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5">
                        <StatPill label="Items" value={template.items.length} color="#00C8E0" />
                        <StatPill label="Required" value={requiredCount} color="#FF9500" />
                        <StatPill label="Optional" value={template.items.length - requiredCount} color="#7B5EFF" />
                      </div>
                    </div>
                    <ChevronRight size={16} color="rgba(255,255,255,0.15)"
                      style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.2s" }} />
                  </button>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                        <div className="px-5 pb-5" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 14 }}>
                          {/* Category Distribution */}
                          <div className="flex flex-wrap gap-2 mb-4">
                            {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => {
                              const count = template.items.filter(i => i.category === key).length;
                              if (count === 0) return null;
                              const CatIcon = cfg.icon;
                              return (
                                <div key={key} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{
                                  background: cfg.gradient, border: `1px solid ${cfg.color}15`,
                                }}>
                                  <CatIcon size={13} color={cfg.color} strokeWidth={1.8} />
                                  <span style={{ ...TYPOGRAPHY.caption, color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>
                                  <span className="px-1.5 py-0.5 rounded" style={{
                                    background: `${cfg.color}15`, ...TYPOGRAPHY.micro, fontWeight: 800, color: cfg.color,
                                  }}>{count}</span>
                                </div>
                              );
                            })}
                          </div>

                          {/* Items List */}
                          <div className="space-y-1.5">
                            {template.items.map((item, i) => {
                              const catCfg = CATEGORY_CONFIG[item.category];
                              return (
                                <div key={item.id} className="flex items-center gap-3 py-2 px-3 rounded-lg" style={{
                                  background: i % 2 === 0 ? "rgba(255,255,255,0.01)" : "transparent",
                                }}>
                                  <div className="size-6 rounded-lg flex items-center justify-center" style={{
                                    background: `${catCfg.color}10`,
                                    border: `1px solid ${catCfg.color}15`,
                                  }}>
                                    <catCfg.icon size={11} color={catCfg.color} />
                                  </div>
                                  <span className="flex-1" style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.secondary }}>{item.text}</span>
                                  {item.required ? (
                                    <Badge variant="danger" size="sm">REQUIRED</Badge>
                                  ) : (
                                    <Badge variant="muted" size="sm">OPTIONAL</Badge>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              );
            })}
          </motion.div>
        )}

        {/* ── ANALYTICS TAB ─────────────────────────────────── */}
        {activeTab === "analytics" && (
          <motion.div key="analytics" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">
            
            {/* Compliance Overview */}
            <Card glow="#00C8E0" padding={24}>
              <SectionHeader title="Compliance Overview" subtitle="Pre-shift checklist compliance metrics" icon={BarChart3} color="#00C8E0" />
              <div className="grid grid-cols-3 gap-6 mt-4">
                <div className="flex items-center gap-4">
                  <ComplianceRing value={complianceRate} color={complianceRate >= 80 ? "#00C853" : "#FF9500"} size={72} />
                  <div>
                    <p style={{ ...TYPOGRAPHY.h3, color: TOKENS.text.primary }}>Overall Compliance</p>
                    <p style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted }}>Target: 95%</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <ComplianceRing value={Math.round((completeCount / Math.max(totalSubmissions, 1)) * 100)} color="#00C853" size={72} />
                  <div>
                    <p style={{ ...TYPOGRAPHY.h3, color: TOKENS.text.primary }}>Full Completion</p>
                    <p style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted }}>{completeCount} of {totalSubmissions} workers</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <ComplianceRing value={100 - Math.round((flaggedCount / Math.max(totalSubmissions, 1)) * 100)} color="#FF9500" size={72} />
                  <div>
                    <p style={{ ...TYPOGRAPHY.h3, color: TOKENS.text.primary }}>No Flags Rate</p>
                    <p style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted }}>{totalSubmissions - flaggedCount} clean submissions</p>
                  </div>
                </div>
              </div>
            </Card>

            {/* Category Breakdown */}
            <Card padding={24}>
              <SectionHeader title="Category Breakdown" subtitle="Compliance by safety category" icon={Shield} color="#7B5EFF" />
              <div className="grid grid-cols-5 gap-4 mt-4">
                {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => {
                  const CatIcon = cfg.icon;
                  const allItems = DEFAULT_TEMPLATES.flatMap(t => t.items.filter(i => i.category === key));
                  const mockCompliance = key === "ppe" ? 92 : key === "equipment" ? 78 : key === "environment" ? 85 : key === "communication" ? 67 : 88;
                  return (
                    <div key={key} className="text-center p-4 rounded-xl" style={{
                      background: `${cfg.color}04`, border: `1px solid ${cfg.color}10`,
                    }}>
                      <GlowIcon icon={CatIcon} color={cfg.color} size={36} iconSize={16} />
                      <div className="mt-3">
                        <ComplianceRing value={mockCompliance} color={cfg.color} size={56} />
                      </div>
                      <p style={{ ...TYPOGRAPHY.caption, color: cfg.color, fontWeight: 600, marginTop: 8 }}>{cfg.label}</p>
                      <p style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted, marginTop: 2 }}>{allItems.length} items</p>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Recent Trends */}
            <Card padding={24}>
              <SectionHeader title="Compliance Trends" subtitle="Last 7 days" icon={Activity} color="#00C853" />
              <div className="flex items-end gap-3 mt-4 h-32">
                {[68, 72, 75, 70, 78, 82, complianceRate].map((val, i) => {
                  const isToday = i === 6;
                  const barColor = val >= 80 ? "#00C853" : val >= 60 ? "#FF9500" : "#FF2D55";
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-2">
                      <span style={{ ...TYPOGRAPHY.micro, color: isToday ? barColor : TOKENS.text.muted, fontWeight: isToday ? 800 : 600 }}>
                        {val}%
                      </span>
                      <motion.div
                        initial={{ height: 0 }} animate={{ height: `${val}%` }}
                        transition={{ duration: 0.6, delay: i * 0.08 }}
                        className="w-full rounded-t-lg relative"
                        style={{
                          background: isToday ? `linear-gradient(to top, ${barColor}40, ${barColor})` : `${barColor}20`,
                          border: isToday ? `1px solid ${barColor}40` : "none",
                          minHeight: 4,
                        }}
                      >
                        {isToday && (
                          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full"
                            style={{ background: barColor, boxShadow: `0 0 6px ${barColor}` }} />
                        )}
                      </motion.div>
                      <span style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted, fontSize: 8 }}>
                        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Today"][i]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}