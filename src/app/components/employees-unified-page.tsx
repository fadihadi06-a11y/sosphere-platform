// ═══════════════════════════════════════════════════════════════
// SOSphere — Employees Hub (Full Hybrid Redesign)
// Directory · Live Status · Quick Call · GPS · Safety Score
// ═══════════════════════════════════════════════════════════════
import React, { useState, useMemo, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Users, Search, MapPin, Phone, Shield, Clock,
  AlertTriangle, CheckCircle2, UserCheck, Activity,
  Upload, ChevronRight, MoreVertical, X,
  Siren, WifiOff, Battery, TrendingUp, TrendingDown,
  Filter, Eye, MessageCircle, Copy, Check,
  LayoutGrid, List, Star, Navigation, Zap,
  Radio, Info, Bell, FileText, Send, UserPlus,
  KeyRound, Mail, MessageSquare,
} from "lucide-react";
import { EnterpriseImportWizard } from "./enterprise-import-wizard";
import { CallTrigger } from "./call-panel";
import { EmployeeInviteManager } from "./employee-invite-manager";
import { getJoinRequests, approveJoinRequest, rejectJoinRequest, type JoinRequest } from "./shared-store";
import { toast } from "sonner";
import { useDashboardStore } from "./stores/dashboard-store";
import { supabase, SUPABASE_CONFIG } from "./api/supabase-client";
import { loadCanonicalIdentity } from "./api/canonical-identity";

// ── Types ─────────────────────────────────────────────────────
interface UnifiedEmployeesPageProps {
  employees: any[];
  t: (key: string) => string;
  webMode?: boolean;
  onEmployeeSelect: (emp: any) => void;
  onNavigate?: (page: string) => void;
}

// ── Status Config ─────────────────────────────────────────────
const STATUS_CFG: Record<string, {
  color: string; bg: string; label: string;
  pulse: boolean; icon: React.ElementType; priority: number;
}> = {
  "sos":          { color: "#FF2D55", bg: "rgba(255,45,85,0.12)",  label: "SOS Active",    pulse: true,  icon: Siren,        priority: 0 },
  "late-checkin": { color: "#FF9500", bg: "rgba(255,150,0,0.1)",   label: "Late Check-in", pulse: true,  icon: Clock,        priority: 1 },
  "on-shift":     { color: "#00C853", bg: "rgba(0,200,83,0.08)",   label: "On Shift",      pulse: false, icon: CheckCircle2, priority: 2 },
  "checked-in":   { color: "#00C8E0", bg: "rgba(0,200,224,0.08)", label: "Checked In",    pulse: false, icon: UserCheck,    priority: 3 },
  "off-shift":    { color: "rgba(255,255,255,0.2)", bg: "rgba(255,255,255,0.03)", label: "Off Shift", pulse: false, icon: Users, priority: 4 },
};

// ── Avatar gradient pool ───────────────────────────────────────
const GRADIENTS = [
  ["#00C8E0","#0090A0"], ["#FF2D55","#CC1040"],
  ["#FF9500","#CC7700"], ["#00C853","#008A3A"],
  ["#9B59B6","#7D3C98"], ["#E67E22","#CA6F1E"],
  ["#3498DB","#2471A3"], ["#1ABC9C","#148F77"],
];

// ── Quick-stat KPI ─────────────────────────────────────────────
function KPI({ icon: Icon, label, value, sub, color, pulse = false }: {
  icon: React.ElementType; label: string;
  value: string | number; sub?: string;
  color: string; pulse?: boolean;
}) {
  return (
    <div className="flex-1 min-w-0 p-3 rounded-2xl flex items-start gap-3"
      style={{ background: `${color}08`, border: `1px solid ${color}14` }}>
      <div className="size-8 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}15` }}>
        <Icon className="size-4" style={{ color }} />
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span style={{ fontSize: 22, fontWeight: 900, color: "rgba(255,255,255,0.95)", letterSpacing: "-1px" }}>
            {value}
          </span>
          {pulse && (
            <motion.div
              animate={{ opacity: [1, 0.3, 1], scale: [1, 1.3, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
              className="size-2 rounded-full"
              style={{ background: color }}
            />
          )}
        </div>
        <p style={{ fontSize: 11, fontWeight: 700, color: `${color}CC`, letterSpacing: "-0.1px" }}>{label}</p>
        {sub && <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginTop: 1 }}>{sub}</p>}
      </div>
    </div>
  );
}

// ── Employee Card ─────────────────────────────────────────────
function EmployeeCard({
  employee, onClick, viewMode
}: { employee: any; onClick: () => void; viewMode: "grid" | "list" }) {
  const status = STATUS_CFG[employee.status] || STATUS_CFG["off-shift"];
  const StatusIcon = status.icon;
  const gradIdx = parseInt(employee.id?.replace(/\D/g, "") || "0", 10) % GRADIENTS.length;
  const [g1, g2] = GRADIENTS[gradIdx];
  const initials = employee.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2);
  const isCritical = employee.status === "sos";
  const isLate = employee.status === "late-checkin";
  const scoreColor = employee.safetyScore >= 90 ? "#00C853" : employee.safetyScore >= 70 ? "#FF9500" : "#FF2D55";

  // Fake "last action" per employee
  const lastActions: Record<string, string> = {
    "on-shift":     "Checked in",
    "off-shift":    "Ended shift",
    "sos":          "SOS triggered",
    "late-checkin": "Missed check-in",
    "checked-in":   "Confirmed location",
  };

  if (viewMode === "list") {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        whileTap={{ scale: 0.995 }}
        className="flex items-center gap-4 px-4 py-3 rounded-2xl cursor-pointer"
        style={{
          background: isCritical
            ? "linear-gradient(135deg, rgba(255,45,85,0.07), rgba(255,45,85,0.02))"
            : "rgba(255,255,255,0.02)",
          border: isCritical
            ? "1px solid rgba(255,45,85,0.2)"
            : isLate
            ? "1px solid rgba(255,150,0,0.15)"
            : "1px solid rgba(255,255,255,0.05)",
        }}
        onClick={onClick}
      >
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          <div className="size-10 rounded-xl flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${g1}, ${g2})` }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{initials}</span>
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full flex items-center justify-center"
            style={{ background: status.color, border: "1.5px solid #060a14" }}>
            {status.pulse ? (
              <motion.div
                animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
                className="size-1.5 rounded-full"
                style={{ background: "#fff" }}
              />
            ) : (
              <div className="size-1.5 rounded-full" style={{ background: "#fff" }} />
            )}
          </div>
        </div>

        {/* Name & Role */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>
              {employee.name}
            </p>
            {isCritical && (
              <motion.span
                animate={{ opacity: [1, 0.4, 1] }}
                transition={{ duration: 0.7, repeat: Infinity }}
                style={{ fontSize: 8, fontWeight: 800, color: "#FF2D55",
                  background: "rgba(255,45,85,0.15)", padding: "1px 6px", borderRadius: 99 }}>
                SOS
              </motion.span>
            )}
          </div>
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
            {employee.role} · {employee.department}
          </p>
        </div>

        {/* Location */}
        <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
          <MapPin className="size-3" style={{ color: "rgba(0,200,224,0.4)" }} />
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
            {employee.location === "—" ? "Off-site" : employee.location.split(" - ")[0]}
          </span>
        </div>

        {/* Last checkin */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <Clock className="size-3" style={{ color: "rgba(255,255,255,0.2)" }} />
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{employee.lastCheckin}</span>
        </div>

        {/* Safety score */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-12 h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div className="h-full rounded-full" style={{ width: `${employee.safetyScore}%`, background: scoreColor }} />
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, color: scoreColor }}>{employee.safetyScore}%</span>
        </div>

        {/* Status badge */}
        <div className="px-2.5 py-1 rounded-full flex-shrink-0"
          style={{ background: status.bg, border: `1px solid ${status.color}30` }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: status.color }}>{status.label}</span>
        </div>

        {/* Call button — inline, stops propagation */}
        <div className="flex-shrink-0" onClick={e => e.stopPropagation()}>
          <CallTrigger
            employeeName={employee.name}
            employeeRole={employee.role}
            employeeDept={employee.department}
            phone={employee.phone}
            reason={isCritical ? "emergency" : isLate ? "checkin" : "inquiry"}
            size="sm"
          />
        </div>

        <ChevronRight className="size-4 flex-shrink-0" style={{ color: "rgba(255,255,255,0.15)" }} />
      </motion.div>
    );
  }

  // Grid mode
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className="rounded-2xl overflow-hidden cursor-pointer flex flex-col"
      style={{
        background: isCritical
          ? "linear-gradient(160deg, rgba(255,45,85,0.08) 0%, rgba(10,18,32,0.98) 50%)"
          : "rgba(255,255,255,0.02)",
        border: isCritical
          ? "1px solid rgba(255,45,85,0.22)"
          : isLate
          ? "1px solid rgba(255,150,0,0.15)"
          : "1px solid rgba(255,255,255,0.05)",
      }}
      onClick={onClick}
    >
      {/* Top accent bar */}
      {(isCritical || isLate) && (
        <motion.div
          animate={{ opacity: isCritical ? [0.6, 1, 0.6] : [0.4, 0.7, 0.4] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="h-0.5 w-full"
          style={{ background: isCritical ? "#FF2D55" : "#FF9500" }}
        />
      )}

      <div className="p-4 flex-1 flex flex-col">
        {/* Header row */}
        <div className="flex items-start justify-between mb-3">
          {/* Avatar */}
          <div className="relative">
            <div className="size-12 rounded-2xl flex items-center justify-center"
              style={{ background: `linear-gradient(135deg, ${g1}, ${g2})`,
                boxShadow: isCritical ? `0 0 14px ${g1}40` : "none" }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>{initials}</span>
            </div>
            {/* Status dot */}
            <motion.div
              animate={status.pulse ? { scale: [1, 1.3, 1], opacity: [1, 0.5, 1] } : {}}
              transition={{ duration: 0.9, repeat: Infinity }}
              className="absolute -bottom-1 -right-1 size-4 rounded-full flex items-center justify-center"
              style={{ background: status.color, border: "2px solid #060a14" }}>
              <div className="size-1.5 rounded-full" style={{ background: "#fff" }} />
            </motion.div>
          </div>

          {/* Status badge */}
          <div className="px-2 py-1 rounded-xl flex items-center gap-1"
            style={{ background: status.bg, border: `1px solid ${status.color}25` }}>
            <StatusIcon className="size-3" style={{ color: status.color }} />
            <span style={{ fontSize: 9, fontWeight: 800, color: status.color, letterSpacing: "0.2px" }}>
              {status.label}
            </span>
          </div>
        </div>

        {/* Name */}
        <p style={{ fontSize: 14, fontWeight: 800, color: "rgba(255,255,255,0.95)", letterSpacing: "-0.2px" }}>
          {employee.name}
        </p>
        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
          {employee.role}
        </p>

        {/* Department pill */}
        <span className="mt-2 self-start px-2 py-0.5 rounded-full"
          style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.4)",
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
          {employee.department}
        </span>

        {/* Location & Checkin */}
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <MapPin className="size-3 flex-shrink-0" style={{ color: "rgba(0,200,224,0.5)" }} />
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
              {employee.location === "—" ? "Off-site" : employee.location}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="size-3 flex-shrink-0"
              style={{ color: isLate ? "#FF9500" : "rgba(255,255,255,0.25)" }} />
            <span style={{ fontSize: 10, color: isLate ? "#FF9500" : "rgba(255,255,255,0.35)" }}>
              {lastActions[employee.status]} · {employee.lastCheckin}
            </span>
          </div>
        </div>

        {/* Safety Score bar */}
        <div className="mt-4 pt-3 border-t" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
          <div className="flex items-center justify-between mb-1.5">
            <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.4px" }}>
              SAFETY SCORE
            </span>
            <span style={{ fontSize: 12, fontWeight: 800, color: scoreColor }}>
              {employee.safetyScore}%
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${employee.safetyScore}%` }}
              transition={{ duration: 0.8, ease: "easeOut", delay: 0.1 }}
              className="h-full rounded-full"
              style={{
                background: employee.safetyScore >= 90
                  ? "linear-gradient(90deg, #00C853, #00E676)"
                  : employee.safetyScore >= 70
                  ? "linear-gradient(90deg, #FF9500, #FFB800)"
                  : "linear-gradient(90deg, #FF2D55, #FF6B6B)",
                boxShadow: `0 0 6px ${scoreColor}60`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="px-4 pb-3 pt-0 grid grid-cols-2 gap-2"
        onClick={e => e.stopPropagation()}>
        <CallTrigger
          employeeName={employee.name}
          employeeRole={employee.role}
          employeeDept={employee.department}
          phone={employee.phone}
          reason={isCritical ? "emergency" : isLate ? "checkin" : "inquiry"}
          className="w-full justify-center"
        />
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          className="flex items-center justify-center gap-1.5 rounded-xl"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            padding: "7px 10px",
          }}>
          <Eye className="size-3.5" style={{ color: "rgba(255,255,255,0.45)" }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)" }}>View</span>
        </motion.button>
      </div>
    </motion.div>
  );
}

// ── Filter Pill ───────────────────────────────────────────────
function FilterPill({ label, count, active, color, onClick }: {
  label: string; count: number; active: boolean;
  color: string; onClick: () => void;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl flex-shrink-0"
      style={{
        background: active ? `${color}15` : "rgba(255,255,255,0.03)",
        border: active ? `1.5px solid ${color}35` : "1px solid rgba(255,255,255,0.07)",
      }}>
      {active && (
        <div className="size-1.5 rounded-full" style={{ background: color }} />
      )}
      <span style={{ fontSize: 11, fontWeight: active ? 700 : 500,
        color: active ? color : "rgba(255,255,255,0.4)" }}>
        {label}
      </span>
      <span className="px-1.5 py-0.5 rounded-full"
        style={{ fontSize: 9, fontWeight: 700,
          background: active ? `${color}20` : "rgba(255,255,255,0.05)",
          color: active ? color : "rgba(255,255,255,0.3)" }}>
        {count}
      </span>
    </motion.button>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════
export function UnifiedEmployeesPage({
  employees, t, webMode, onEmployeeSelect, onNavigate
}: UnifiedEmployeesPageProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState<"name" | "score" | "status" | "checkin">("status");
  const [showInviteManager, setShowInviteManager] = useState(false);
  const [showPendingApprovals, setShowPendingApprovals] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<JoinRequest[]>([]);
  // Blocker C (2026-04-30): post-onboarding employee invitation UI.
  // Allows the owner to add employees from the dashboard, see pending
  // invitations, and revoke them. Backed by the invite-employees edge
  // function (auth.admin.inviteUserByEmail) and the invitations table.
  const [showInviteEmployee, setShowInviteEmployee] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"employee" | "zone_admin" | "dispatcher">("employee");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [pendingInvites, setPendingInvites] = useState<Array<{ id: string; email: string; role: string | null; created_at: string; status: string; name: string | null }>>([]);
  const [pendingInvitesLoading, setPendingInvitesLoading] = useState(false);
  const [companyIdForInvites, setCompanyIdForInvites] = useState<string | null>(null);
  const [approvalToast, setApprovalToast] = useState<{ name: string; action: "approved" | "rejected" } | null>(null);
  // E1.6.1 Q6: live count of items still queued (pgmq -> worker hasn't
  // processed yet). Bridges the ~60s gap between enqueue and the moment
  // the worker writes invitations rows. Re-computed via Realtime on
  // async_job_metadata.
  const [queuedItemsCount, setQueuedItemsCount] = useState<number>(0);

  // Plan limit guard for adding employees
  const { checkPlanLimitGuard, checkTrialGuard } = useDashboardStore();
  const guardEmployeeAdd = () => {
    if (checkTrialGuard("employee")) return true;
    if (checkPlanLimitGuard("employee")) return true;
    return false;
  };

  // ── Load pending join requests ──────────────────────────────
  useEffect(() => {
    const load = () => {
      const all = getJoinRequests();
      setPendingRequests(all.filter(r => r.status === "pending"));
    };
    load();
    const interval = setInterval(load, 3000);
    // Listen for cross-tab changes
    const handler = (e: StorageEvent) => {
      if (e.key === "sosphere_join_requests") load();
    };
    window.addEventListener("storage", handler);
    return () => {
      clearInterval(interval);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const handleApprove = (reqId: string, name: string) => {
    approveJoinRequest(reqId, "Admin");
    setPendingRequests(prev => prev.filter(r => r.id !== reqId));
    setApprovalToast({ name, action: "approved" });
    setTimeout(() => setApprovalToast(null), 3000);
  };

  const handleReject = (reqId: string, name: string) => {
    rejectJoinRequest(reqId);
    setPendingRequests(prev => prev.filter(r => r.id !== reqId));
    setApprovalToast({ name, action: "rejected" });
    setTimeout(() => setApprovalToast(null), 3000);
  };

  // Mock invite data for EmployeeInviteManager
  const inviteEmployees = employees.slice(0, 8).map(e => ({
    id: e.id,
    name: e.name,
    phone: e.phone || "", // phone must come from real employee profile
    email: e.email || `${e.name.toLowerCase().replace(/\s/g, ".")}@company.com`,
    zone: e.location,
    role: e.role,
    status: "pending" as const,
  }));

  // ── Stats ────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:    employees.length,
    onShift:  employees.filter(e => e.status === "on-shift" || e.status === "checked-in").length,
    sos:      employees.filter(e => e.status === "sos").length,
    late:     employees.filter(e => e.status === "late-checkin").length,
    offShift: employees.filter(e => e.status === "off-shift").length,
    // Audit 2026-05-01 (live test fix): guard against div-by-zero when
    // company has no employees yet. Old code returned NaN -> "NaN%" KPI.
    avgScore: employees.length > 0
      ? Math.round(employees.reduce((s, e) => s + e.safetyScore, 0) / employees.length)
      : 0,
  }), [employees]);

  // ── Filter counts ────────────────────────────────────────────
  const filterOptions = [
    { id: "all",          label: "All",          count: stats.total,    color: "#00C8E0"              },
    { id: "sos",          label: "SOS Active",   count: stats.sos,      color: "#FF2D55"              },
    { id: "late-checkin", label: "Late",         count: stats.late,     color: "#FF9500"              },
    { id: "on-shift",     label: "On Shift",     count: stats.onShift,  color: "#00C853"              },
    { id: "off-shift",    label: "Off Shift",    count: stats.offShift, color: "rgba(255,255,255,0.4)" },
  ];

  // ── Filtered & sorted ────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = employees.filter(emp => {
      const q = searchQuery.toLowerCase();
      const matchQ = !q || emp.name.toLowerCase().includes(q)
        || emp.department.toLowerCase().includes(q)
        || emp.role.toLowerCase().includes(q)
        || emp.location?.toLowerCase().includes(q);
      const matchS = statusFilter === "all" || emp.status === statusFilter;
      return matchQ && matchS;
    });

    list = [...list].sort((a, b) => {
      if (sortBy === "name")   return a.name.localeCompare(b.name);
      if (sortBy === "score")  return b.safetyScore - a.safetyScore;
      if (sortBy === "status") {
        const pa = STATUS_CFG[a.status]?.priority ?? 5;
        const pb = STATUS_CFG[b.status]?.priority ?? 5;
        return pa - pb;
      }
      return 0;
    });

    return list;
  }, [employees, searchQuery, statusFilter, sortBy]);

  const activeCount = filtered.filter(e => e.status !== "off-shift").length;

  // Blocker C (2026-04-30): load company_id for the current owner so
  // we can scope invitations queries. Also subscribes to pending list
  // so the modal updates after invites/revokes.
  useEffect(() => {
    if (!SUPABASE_CONFIG.isConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        // E1.6-PHASE3 (2026-05-04): use loadCanonicalIdentity instead of
        // a raw getSession() + companies SELECT. The legacy two-call chain
        // hits supabase-js's _acquireLock twice; if the lock is wedged by
        // an unrelated boot-time holder, companyIdForInvites stays null
        // forever — which is exactly what surfaced the user-facing
        // "Cannot queue import: company id not loaded" error during the
        // E1 live test. loadCanonicalIdentity tries safeRpc first
        // (direct fetch, lock-free) and only falls back to the locking
        // path if that fails.
        const id = await loadCanonicalIdentity(supabase);
        if (!cancelled && id?.active_company?.id) {
          setCompanyIdForInvites(id.active_company.id);
        }
      } catch (_) { /* ignore — page still works without invitations panel */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadPendingInvites = async () => {
    if (!companyIdForInvites) return;
    setPendingInvitesLoading(true);
    try {
      const { data, error } = await supabase
        .from("invitations")
        .select("id, email, role, role_type, created_at, status, name")
        .eq("company_id", companyIdForInvites)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (!error && data) {
        setPendingInvites(data.map((r: any) => ({
          id: r.id, email: r.email, role: r.role || r.role_type,
          created_at: r.created_at, status: r.status, name: r.name,
        })));
      }
    } catch (_) { /* ignore */ }
    setPendingInvitesLoading(false);
  };

  // E1.6.1 Q6: queued items badge loader + realtime subscription
  const loadQueuedItemsCount = useCallback(async (cid: string) => {
    try {
      const { data, error } = await supabase
        .from("async_job_metadata")
        .select("progress")
        .eq("company_id", cid)
        .in("status", ["pending", "running", "paused"]);
      if (error || !Array.isArray(data)) return;
      const total = data.reduce((acc: number, row: any) => {
        const p = row?.progress || {};
        const remaining = Math.max(0, (Number(p.total) || 0) - (Number(p.processed) || 0));
        return acc + remaining;
      }, 0);
      setQueuedItemsCount(total);
    } catch (_) { /* non-fatal: badge stays at last known value */ }
  }, []);

  useEffect(() => {
    if (!companyIdForInvites || !SUPABASE_CONFIG.isConfigured) return;
    void loadQueuedItemsCount(companyIdForInvites);
    const channel = supabase
      .channel(`queued_items_badge:${companyIdForInvites}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        {
          event:  "*",
          schema: "public",
          table:  "async_job_metadata",
          filter: `company_id=eq.${companyIdForInvites}`,
        },
        () => { void loadQueuedItemsCount(companyIdForInvites); }
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [companyIdForInvites, loadQueuedItemsCount]);

  useEffect(() => {
    if (showInviteEmployee) loadPendingInvites();
  }, [showInviteEmployee, companyIdForInvites]);

  const handleSendInvite = async () => {
    setInviteError("");
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setInviteError("Please enter a valid email address");
      return;
    }
    if (!companyIdForInvites) {
      setInviteError("Company not loaded yet — try again in a moment");
      return;
    }
    setInviteSubmitting(true);
    try {
      // 1) Pre-create the invitation row so accept_invitation() can find
      //    it later. The edge function then triggers Supabase Auth invite.
      //
      // Audit 2026-05-01 (live test fix): include `invited_by` so the
      // audit trail records *which* owner sent the invite. Required for
      // compliance + dispute resolution. Falls back to NULL only if the
      // session genuinely can't be resolved (the RLS policy on
      // invitations already requires the user be a company member).
      const { data: { user } } = await supabase.auth.getUser();
      const { error: insErr } = await supabase.from("invitations").insert({
        company_id: companyIdForInvites,
        email,
        name: inviteName.trim() || null,
        role: inviteRole,
        role_type: inviteRole,
        status: "pending",
        invited_by: user?.id ?? null,
      });
      if (insErr && !/duplicate|unique/i.test(insErr.message)) {
        setInviteError(insErr.message);
        setInviteSubmitting(false);
        return;
      }
      // 2) Call the invite-employees edge function to send the email.
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${SUPABASE_CONFIG.url}/functions/v1/invite-employees`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token || ""}`,
        },
        // Audit 2026-05-02 (CRITICAL employee onboarding fix): without an
        // explicit redirect_to, invite-employees falls back to
        // `${SITE_URL || 'https://sosphere.app'}/welcome` — sosphere.app is
        // a wrong domain and Supabase Auth's allowlist may also reject it,
        // so the magic link redirected employees back to the landing page
        // instead of the activation flow. New companies could not onboard
        // ANY employees. Pin the redirect to THIS deployment's /welcome
        // route, which knows how to exchange the PKCE code into a session
        // (see welcome-activation.tsx).
        body: JSON.stringify({
          employees: [{ email, full_name: inviteName.trim() || undefined, company_id: companyIdForInvites }],
          redirect_to: `${window.location.origin}/welcome`,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        setInviteError(`Failed to send invite: ${res.status} ${text.slice(0, 160)}`);
        setInviteSubmitting(false);
        return;
      }
      // #149 fix (2026-05-02): inspect per-email outcome instead of trusting
      // the top-level `success` boolean. The edge function now distinguishes
      // three states per email — sent / skipped_existing / failed — so we
      // can show the owner an actionable message instead of a misleading
      // "Invitation sent" toast when the email already had an account.
      let summary: { sent: number; failed: number; skipped_existing: number } | undefined;
      let firstResult: { success: boolean; skipped_existing?: boolean; error?: string } | undefined;
      try {
        const parsed = await res.json();
        summary = parsed?.summary;
        firstResult = parsed?.results?.[0];
      } catch { /* keep defaults */ }

      if (summary?.skipped_existing && summary.skipped_existing > 0) {
        toast.info(
          `${email} already has a SOSphere account. Ask them to sign in directly with their existing password — they will be added to your company automatically.`,
          { duration: 9000 },
        );
        setInviteEmail(""); setInviteName(""); setInviteRole("employee");
        await loadPendingInvites();
      } else if (summary?.failed && summary.failed > 0) {
        setInviteError(`Failed: ${firstResult?.error || "unknown error"}`);
      } else if (summary?.sent && summary.sent > 0) {
        toast.success(`Invitation sent to ${email}`);
        setInviteEmail(""); setInviteName(""); setInviteRole("employee");
        await loadPendingInvites();
      } else {
        setInviteError("Invitation status unclear — please refresh and check pending invites.");
      }
    } catch (e) {
      setInviteError(`Error: ${(e as Error).message}`);
    } finally {
      setInviteSubmitting(false);
    }
  };

  const handleRevokeInvite = async (id: string, email: string) => {
    if (!confirm(`Revoke invitation for ${email}?`)) return;
    try {
      const { error } = await supabase
        .from("invitations")
        .update({ status: "revoked" })
        .eq("id", id);
      if (error) {
        toast.error(`Failed to revoke: ${error.message}`);
        return;
      }
      toast.success(`Invitation revoked for ${email}`);
      await loadPendingInvites();
    } catch (e) {
      toast.error(`Revoke failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className={`${webMode ? "px-6 py-5" : "px-4 py-4"} space-y-5`}>

      {/* ── Actions Toolbar ── */}
      <div className="flex items-center justify-end gap-2">
        {/* View toggle */}
        <div className="flex items-center p-1 rounded-xl"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
          {(["grid","list"] as const).map(v => (
            <button key={v} onClick={() => setViewMode(v)}
              className="size-7 rounded-lg flex items-center justify-center"
              style={{ background: viewMode === v ? "rgba(0,200,224,0.15)" : "transparent" }}>
              {v === "grid"
                ? <LayoutGrid className="size-3.5" style={{ color: viewMode === v ? "#00C8E0" : "rgba(255,255,255,0.3)" }} />
                : <List className="size-3.5" style={{ color: viewMode === v ? "#00C8E0" : "rgba(255,255,255,0.3)" }} />
              }
            </button>
          ))}
        </div>

        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => onNavigate?.("csvGuide")}
          className="flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{
            background: "rgba(255,150,0,0.08)",
            border: "1px solid rgba(255,150,0,0.2)",
            color: "#FF9500",
            fontSize: 12,
            fontWeight: 700,
          }}>
          <FileText className="size-3.5" />
          CSV Guide
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => { if (!guardEmployeeAdd()) setShowImportWizard(true); }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl"
          style={{
            background: "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,200,224,0.05))",
            border: "1px solid rgba(0,200,224,0.25)",
            color: "#00C8E0",
          }}>
          <Upload className="size-3.5" />
          Import
        </motion.button>
        {/* Blocker C (2026-04-30): single-employee invite button. */}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => { if (!guardEmployeeAdd()) setShowInviteEmployee(true); }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl"
          style={{
            background: "linear-gradient(135deg, rgba(0,200,83,0.18), rgba(0,200,83,0.06))",
            border: "1px solid rgba(0,200,83,0.3)",
            color: "#00C853",
            fontSize: 13, fontWeight: 700,
          }}>
          <UserPlus className="size-3.5" />
          Invite Employee
        </motion.button>

        {/* Pending Approvals Button */}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => setShowPendingApprovals(true)}
          className="relative flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{
            background: pendingRequests.length > 0 ? "rgba(255,150,0,0.08)" : "rgba(255,255,255,0.03)",
            border: pendingRequests.length > 0 ? "1px solid rgba(255,150,0,0.2)" : "1px solid rgba(255,255,255,0.07)",
            color: pendingRequests.length > 0 ? "#FF9500" : "rgba(255,255,255,0.4)",
            fontSize: 12,
            fontWeight: 700,
          }}>
          <UserPlus className="size-3.5" />
          Pending
          {pendingRequests.length > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-1.5 -right-1.5 size-5 rounded-full flex items-center justify-center"
              style={{ background: "#FF9500", fontSize: 9, fontWeight: 900, color: "#fff" }}>
              {pendingRequests.length}
            </motion.span>
          )}
        </motion.button>

        {/* Send Invitations Button */}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => { if (!guardEmployeeAdd()) setShowInviteManager(true); }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl"
          style={{
            background: "linear-gradient(135deg, #00C8E0, #00A5C0)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            boxShadow: "0 4px 16px rgba(0,200,224,0.2)",
          }}>
          <Send className="size-3.5" />
          Send Invitations
        </motion.button>
      </div>

      {/* ── KPI Strip ── */}
      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        <KPI icon={Users}        label="Total"      value={stats.total}    color="#00C8E0" sub="All employees" />
        <KPI icon={Activity}     label="Active Now"  value={stats.onShift}  color="#00C853" sub="On shift / checked in" />
        <KPI icon={Siren}        label="SOS Alerts"  value={stats.sos}      color="#FF2D55" pulse={stats.sos > 0} sub={stats.sos > 0 ? "Requires response" : "All clear"} />
        <KPI icon={Clock}        label="Late"        value={stats.late}     color="#FF9500" pulse={stats.late > 0} sub="Missed check-in" />
        <KPI icon={Shield}       label="Avg Safety"  value={`${stats.avgScore}%`} color={stats.avgScore >= 85 ? "#00C853" : "#FF9500"} sub="Team average" />
      </div>

      {/* ── Search ── */}
      <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
        <Search className="size-4 flex-shrink-0" style={{ color: "rgba(255,255,255,0.25)" }} />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search by name, role, department, or zone…"
          className="flex-1 bg-transparent outline-none"
          style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", caretColor: "#00C8E0" }}
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery("")}>
            <X className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
          </button>
        )}
      </div>

      {/* ── Filters ── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5" style={{ scrollbarWidth: "none" }}>
        {filterOptions.map(f => (
          <FilterPill key={f.id}
            label={f.label} count={f.count}
            active={statusFilter === f.id}
            color={f.color}
            onClick={() => setStatusFilter(f.id)}
          />
        ))}
        <div className="flex-shrink-0 w-px h-5 mx-1" style={{ background: "rgba(255,255,255,0.08)" }} />
        {/* Sort */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>Sort:</span>
          {(["status","score","name"] as const).map(s => (
            <button key={s} onClick={() => setSortBy(s)}
              className="px-2.5 py-1 rounded-lg"
              style={{
                fontSize: 10, fontWeight: 600,
                background: sortBy === s ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.03)",
                border: sortBy === s ? "1px solid rgba(0,200,224,0.2)" : "1px solid rgba(255,255,255,0.06)",
                color: sortBy === s ? "#00C8E0" : "rgba(255,255,255,0.3)",
              }}>
              {s === "status" ? "Priority" : s === "score" ? "Safety" : "A–Z"}
            </button>
          ))}
        </div>
      </div>

      {/* ── SOS Alert Banner ── */}
      {stats.sos > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="rounded-2xl overflow-hidden"
          style={{ border: "1px solid rgba(255,45,85,0.3)" }}>
          <div className="px-4 py-3 flex items-center gap-3"
            style={{ background: "linear-gradient(135deg, rgba(255,45,85,0.12), rgba(255,45,85,0.04))" }}>
            <motion.div
              animate={{ scale: [1, 1.2, 1], opacity: [1, 0.5, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
              className="size-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(255,45,85,0.2)" }}>
              <Siren className="size-4" style={{ color: "#FF2D55" }} />
            </motion.div>
            <div className="flex-1">
              <p style={{ fontSize: 13, fontWeight: 800, color: "#FF2D55" }}>
                {stats.sos} Active SOS {stats.sos === 1 ? "Alert" : "Alerts"} — Immediate Response Required
              </p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
                Use the Call button on any SOS employee card or go to Emergency Hub
              </p>
            </div>
            <button
              onClick={() => setStatusFilter("sos")}
              className="px-3 py-1.5 rounded-xl"
              style={{ background: "#FF2D55", color: "#fff", fontSize: 11, fontWeight: 700 }}>
              Show SOS
            </button>
          </div>
        </motion.div>
      )}

      {/* ── Results count ── */}
      <div className="flex items-center justify-between">
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
          {filtered.length === employees.length
            ? `All ${employees.length} employees`
            : `${filtered.length} of ${employees.length} employees`}
          {searchQuery && ` matching "${searchQuery}"`}
        </p>
        {/* Legend */}
        <div className="flex items-center gap-3">
          {["on-shift","late-checkin","sos"].map(s => (
            <div key={s} className="flex items-center gap-1.5">
              <div className="size-2 rounded-full" style={{ background: STATUS_CFG[s].color }} />
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{STATUS_CFG[s].label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Employee Grid / List ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={viewMode}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className={viewMode === "grid"
            ? "grid grid-cols-3 gap-3"
            : "space-y-2"}
        >
          {filtered.map(emp => (
            <EmployeeCard
              key={emp.id}
              employee={emp}
              onClick={() => onEmployeeSelect(emp)}
              viewMode={viewMode}
            />
          ))}
        </motion.div>
      </AnimatePresence>

      {/* ── Empty state ── */}
      {filtered.length === 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="py-16 text-center"
        >
          <div className="size-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <Users className="size-8" style={{ color: "rgba(255,255,255,0.1)" }} />
          </div>
          <p style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>
            No employees found
          </p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", marginTop: 6 }}>
            {searchQuery ? `Try a different search term` : "Import your team to get started"}
          </p>
          {!searchQuery && (
            <button
              onClick={() => setShowImportWizard(true)}
              className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl"
              style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)",
                color: "#00C8E0", fontSize: 13, fontWeight: 700 }}>
              <Upload className="size-4" /> Import Employees
            </button>
          )}
        </motion.div>
      )}

      {/* ── How Calls Work — Always Visible Footer ── */}
      <div className="rounded-2xl overflow-hidden"
        style={{ border: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.01)" }}>
        <div className="px-4 py-3 flex items-center gap-2.5"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <Info className="size-4" style={{ color: "rgba(0,200,224,0.5)" }} />
          <p style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>
            How Admin Calls Work
          </p>
        </div>
        <div className="grid grid-cols-3 divide-x" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
          {[
            { icon: "📞", title: "Call via Device", desc: "Desktop → Skype/Teams/FaceTime · Mobile → native dialer · Based on your OS default" },
            { icon: "💬", title: "WhatsApp",         desc: "Works via WiFi if employee has no cellular · Good for international workers" },
            { icon: "📋", title: "Copy Number",      desc: "Best for emergencies · Dial from personal phone or desk phone for fastest connection" },
          ].map(item => (
            <div key={item.title} className="px-4 py-3">
              <div className="text-lg mb-1.5">{item.icon}</div>
              <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", marginBottom: 4 }}>
                {item.title}
              </p>
              <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", lineHeight: 1.5 }}>
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Enterprise Import Wizard ── */}
      <AnimatePresence>
        {showImportWizard && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 overflow-y-auto"
            style={{ background: "rgba(0,0,0,0.97)" }}>
            <EnterpriseImportWizard
              // E1.5: companyId is REQUIRED for the new async-queue flow.
              // Without it the wizard refuses to enqueue (better than the
              // legacy silent-fail). Loaded above via session.user.id ->
              // companies.owner_id (same query that scopes pending invites).
              companyId={companyIdForInvites}
              onComplete={(imported) => {
                // E1.5: messaging now reflects ASYNC enqueue. The actual
                // employee rows / invitation emails materialize as the
                // worker (process-bulk-invite, ~60s tick) processes the
                // queue. Owners track live progress on the Jobs page.
                toast.success(`Queued ${imported.length} invitations — processing in background`);
                setShowImportWizard(false);
              }}
              onCancel={() => setShowImportWizard(false)}
              onNavigate={(page) => {
                setShowImportWizard(false);
                onNavigate?.(page);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Blocker C (2026-04-30): Invite Employee Modal */}
      <AnimatePresence>
        {showInviteEmployee && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
            onClick={() => setShowInviteEmployee(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg rounded-2xl p-6"
              style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "85vh", overflowY: "auto" }}
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-xl flex items-center justify-center"
                    style={{ background: "rgba(0,200,83,0.12)", border: "1px solid rgba(0,200,83,0.3)" }}>
                    <UserPlus className="size-5" style={{ color: "#00C853" }} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>Invite Employee</h3>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>Send a secure email invite to join your company</p>
                  </div>
                </div>
                <button onClick={() => setShowInviteEmployee(false)}
                  className="size-8 rounded-lg flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.05)" }}>
                  <X className="size-4" style={{ color: "rgba(255,255,255,0.5)" }} />
                </button>
              </div>

              <div className="space-y-3 mb-4">
                <div>
                  <label style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>Email *</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="employee@company.com"
                    className="w-full mt-1 px-4 py-3 rounded-xl"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontSize: 14 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>Full Name (optional)</label>
                  <input
                    type="text"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Ahmad Hassan"
                    className="w-full mt-1 px-4 py-3 rounded-xl"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontSize: 14 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>Role</label>
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    {(["employee","zone_admin","dispatcher"] as const).map(r => (
                      <button key={r} onClick={() => setInviteRole(r)}
                        className="px-3 py-2 rounded-xl text-center"
                        style={{
                          background: inviteRole === r ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.04)",
                          border: inviteRole === r ? "1px solid rgba(0,200,224,0.4)" : "1px solid rgba(255,255,255,0.08)",
                          color: inviteRole === r ? "#00C8E0" : "rgba(255,255,255,0.55)",
                          fontSize: 12, fontWeight: 600, textTransform: "capitalize",
                        }}>
                        {r.replace("_", " ")}
                      </button>
                    ))}
                  </div>
                </div>
                {inviteError && (
                  <div className="px-3 py-2 rounded-xl"
                    style={{ background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.3)" }}>
                    <p style={{ fontSize: 12, color: "#FF2D55" }}>{inviteError}</p>
                  </div>
                )}
                <button
                  onClick={handleSendInvite}
                  disabled={inviteSubmitting || !inviteEmail.trim()}
                  className="w-full py-3 rounded-xl flex items-center justify-center gap-2"
                  style={{
                    background: inviteSubmitting || !inviteEmail.trim()
                      ? "rgba(255,255,255,0.04)"
                      : "linear-gradient(135deg, #00C853, #008A3A)",
                    color: inviteSubmitting || !inviteEmail.trim() ? "rgba(255,255,255,0.3)" : "#fff",
                    fontSize: 14, fontWeight: 700,
                    cursor: inviteSubmitting || !inviteEmail.trim() ? "not-allowed" : "pointer",
                    border: "none",
                  }}>
                  {inviteSubmitting ? <>Sending...</> : <><Send className="size-4" /> Send Invitation</>}
                </button>
              </div>

              {/* Pending invitations list */}
              <div className="pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.65)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Pending Invitations ({pendingInvites.length})
                    </p>
                    {/* E1.6.1 Q6: live "Queued: N" pill — visible during the */}
                    {/* ~60s window between enqueue and worker materializing.   */}
                    {queuedItemsCount > 0 && (
                      <span title="Items waiting in the async queue. They'll appear in Pending Invitations as the worker processes them."
                        className="flex items-center gap-1 px-2 py-0.5 rounded-md"
                        style={{
                          background: "rgba(155,89,182,0.10)",
                          border: "1px solid rgba(155,89,182,0.20)",
                          color: "#9B59B6",
                          fontSize: 10,
                          fontWeight: 800,
                          letterSpacing: 0.3,
                        }}>
                        <span style={{
                          display: "inline-block", width: 6, height: 6, borderRadius: 999,
                          background: "#9B59B6",
                        }} />
                        QUEUED {queuedItemsCount.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <button onClick={loadPendingInvites}
                    style={{ fontSize: 11, color: "#00C8E0", background: "none", border: "none", cursor: "pointer" }}>
                    {pendingInvitesLoading ? "Loading..." : "Refresh"}
                  </button>
                </div>
                {pendingInvites.length === 0 && !pendingInvitesLoading && (
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "16px 0" }}>
                    No pending invitations
                  </p>
                )}
                <div className="space-y-2">
                  {pendingInvites.map(inv => (
                    <div key={inv.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p style={{ fontSize: 13, color: "#fff", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {inv.email}
                        </p>
                        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
                          {(inv.name || "—")} · {inv.role || "employee"} · {new Date(inv.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <button onClick={() => handleRevokeInvite(inv.id, inv.email)}
                        className="px-2 py-1 rounded-lg shrink-0"
                        style={{ background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.2)", color: "#FF2D55", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Employee Invite Manager ── */}
      <AnimatePresence>
        {showInviteManager && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(16px)" }}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-3xl p-6"
              style={{
                background: "linear-gradient(160deg, #0A1220 0%, #05070E 100%)",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 40px 120px rgba(0,0,0,0.6), 0 0 60px rgba(0,200,224,0.03)",
                scrollbarWidth: "thin",
              }}>
              <EmployeeInviteManager
                employees={inviteEmployees}
                companyName="Aramco Industries"
                inviteCode="AX7K9P"
                onInvitesSent={(method, count) => {
                  toast.success(`Sent ${count} invites via ${method}`);
                }}
                onClose={() => setShowInviteManager(false)}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Pending Approvals Panel ── */}
      <AnimatePresence>
        {showPendingApprovals && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(16px)" }}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-3xl p-6"
              style={{
                background: "linear-gradient(160deg, #0A1220 0%, #05070E 100%)",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 40px 120px rgba(0,0,0,0.6)",
                scrollbarWidth: "thin",
              }}>
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-xl flex items-center justify-center"
                    style={{ background: "rgba(255,150,0,0.1)", border: "1px solid rgba(255,150,0,0.2)" }}>
                    <UserPlus className="size-5" style={{ color: "#FF9500" }} />
                  </div>
                  <div>
                    <h2 className="text-white" style={{ fontSize: 18, fontWeight: 800 }}>Pending Join Requests</h2>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                      Employees waiting for approval (not matched to CSV)
                    </p>
                  </div>
                </div>
                <button onClick={() => setShowPendingApprovals(false)}
                  className="size-8 rounded-lg flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.05)" }}>
                  <X className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
                </button>
              </div>

              {pendingRequests.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="size-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                    style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.12)" }}>
                    <CheckCircle2 className="size-8" style={{ color: "rgba(0,200,83,0.4)" }} />
                  </div>
                  <p style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>
                    No Pending Requests
                  </p>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", marginTop: 4 }}>
                    All employees are either auto-approved via CSV match or already processed
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {pendingRequests.map((req, i) => {
                    const initials = req.employeeName.split(" ").map(n => n[0]).join("").slice(0, 2);
                    const [g1, g2] = GRADIENTS[i % GRADIENTS.length];
                    return (
                      <motion.div
                        key={req.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="flex items-center gap-4 p-4 rounded-2xl"
                        style={{
                          background: "rgba(255,255,255,0.02)",
                          border: "1px solid rgba(255,150,0,0.12)",
                        }}>
                        {/* Avatar */}
                        <div className="size-11 rounded-xl flex items-center justify-center shrink-0"
                          style={{ background: `linear-gradient(135deg, ${g1}, ${g2})` }}>
                          <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{initials}</span>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-white truncate" style={{ fontSize: 14, fontWeight: 700 }}>
                            {req.employeeName}
                          </p>
                          <div className="flex items-center gap-3 mt-1">
                            <div className="flex items-center gap-1">
                              <Phone className="size-3" style={{ color: "rgba(255,255,255,0.25)" }} />
                              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{req.phone}</span>
                            </div>
                            {req.email && (
                              <div className="flex items-center gap-1">
                                <Mail className="size-3" style={{ color: "rgba(255,255,255,0.25)" }} />
                                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{req.email}</span>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="px-2 py-0.5 rounded-md"
                              style={{ background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.15)",
                                fontSize: 9, fontWeight: 700, color: "#FF9500" }}>
                              Code: {req.companyCode}
                            </span>
                            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>
                              {new Date(req.requestedAt).toLocaleString()}
                            </span>
                            {!req.matchedCSVRecord && (
                              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md"
                                style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.12)",
                                  fontSize: 8, fontWeight: 700, color: "#FF2D55" }}>
                                <AlertTriangle className="size-2.5" />
                                No CSV Match
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 shrink-0">
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            onClick={() => handleApprove(req.id, req.employeeName)}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl"
                            style={{
                              background: "rgba(0,200,83,0.1)",
                              border: "1px solid rgba(0,200,83,0.25)",
                              color: "#00C853", fontSize: 12, fontWeight: 700,
                            }}>
                            <CheckCircle2 className="size-3.5" />
                            Approve
                          </motion.button>
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            onClick={() => handleReject(req.id, req.employeeName)}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl"
                            style={{
                              background: "rgba(255,45,85,0.06)",
                              border: "1px solid rgba(255,45,85,0.15)",
                              color: "#FF2D55", fontSize: 12, fontWeight: 700,
                            }}>
                            <X className="size-3.5" />
                            Reject
                          </motion.button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}

              {/* Info footer */}
              <div className="mt-6 flex items-start gap-2.5 p-3 rounded-xl"
                style={{ background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.08)" }}>
                <Info className="size-4 shrink-0 mt-0.5" style={{ color: "rgba(0,200,224,0.4)" }} />
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", lineHeight: 1.6 }}>
                  Employees whose phone number matches a CSV record are <span style={{ color: "#00C853", fontWeight: 700 }}>automatically approved</span>.
                  Requests here are from employees who used the invite code but their phone wasn't found in the CSV.
                  After approval, the employee receives a real-time notification on their mobile app.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Approval Toast ── */}
      <AnimatePresence>
        {approvalToast && (
          <motion.div
            initial={{ opacity: 0, y: 30, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: 30, x: "-50%" }}
            className="fixed bottom-8 left-1/2 z-[60] flex items-center gap-3 px-5 py-3 rounded-2xl"
            style={{
              background: approvalToast.action === "approved"
                ? "linear-gradient(135deg, rgba(0,200,83,0.15), rgba(0,200,83,0.05))"
                : "linear-gradient(135deg, rgba(255,45,85,0.15), rgba(255,45,85,0.05))",
              border: `1px solid ${approvalToast.action === "approved" ? "rgba(0,200,83,0.3)" : "rgba(255,45,85,0.3)"}`,
              boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
              backdropFilter: "blur(20px)",
            }}>
            {approvalToast.action === "approved" ? (
              <CheckCircle2 className="size-5" style={{ color: "#00C853" }} />
            ) : (
              <X className="size-5" style={{ color: "#FF2D55" }} />
            )}
            <span style={{
              fontSize: 13, fontWeight: 700,
              color: approvalToast.action === "approved" ? "#00C853" : "#FF2D55",
            }}>
              {approvalToast.name} {approvalToast.action === "approved" ? "approved — notification sent to mobile app" : "rejected"}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
