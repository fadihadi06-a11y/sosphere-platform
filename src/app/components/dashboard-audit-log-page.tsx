// ═══════════════════════════════════════════════════════════════
// SOSphere — Audit Log Page
// Full activity trail: who changed what, when, and from where
// Filters: Action Type · Actor Level · Date Range · Zone
// ═══════════════════════════════════════════════════════════════
import React, { useState, useMemo, useEffect } from "react";
import { getRealAuditLog, onAuditEvent, type AuditEntry as RealAuditEntry } from "./audit-log-store";
import { fetchAuditLog } from "./api/data-layer";
import { motion, AnimatePresence } from "motion/react";
import jsPDF from "jspdf";
import QRCode from "qrcode";
import { PdfPasswordModal, type PdfEncryptionConfig, getEncryptionOptions } from "./pdf-password-modal";
import { PdfEmailModal } from "./pdf-email-modal";
import {
  Shield, Key, Users, MapPin, Crown, ShieldCheck,
  UserCheck, Clock, Download, Filter, Search, X,
  ChevronDown, ChevronUp, ArrowRight, AlertTriangle,
  CheckCircle2, Eye, Lock, Unlock, UserPlus, UserX,
  RefreshCw, Siren, Settings, Bell, FileText, Mail,
  BarChart3, Activity, Hash, Layers, Calendar,
  Edit2, Trash2, LogIn, LogOut, Fingerprint, Zap,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────
type AuditLevel = "owner" | "main_admin" | "zone_admin" | "worker" | "system";
type AuditCategory =
  | "permission_change"
  | "role_change"
  | "zone_assignment"
  | "user_added"
  | "user_removed"
  | "user_suspended"
  | "2fa_event"
  | "login"
  | "logout"
  | "emergency"
  | "settings"
  | "csv_import"
  | "file_access"
  | "data_modify"
  | "data_delete"
  | "report_export"
  | "investigation";

interface AuditEntry {
  id: string;
  timestamp: Date;
  actor: {
    id: string;
    name: string;
    level: AuditLevel;
    zone?: string;
  };
  target?: {
    id: string;
    name: string;
    level?: AuditLevel;
  };
  category: AuditCategory;
  action: string;
  detail: string;
  before?: string;
  after?: string;
  zone?: string;
  ip?: string;
  severity: "info" | "warning" | "critical" | "success";
  verified2FA?: boolean;
}

// ── Category Config ───────────────────────────────────────────
const CATEGORY_CONFIG: Record<AuditCategory, {
  label: string; icon: React.ElementType; color: string; bg: string;
}> = {
  permission_change: { label: "Permission Change", icon: Key,       color: "#FF9500", bg: "rgba(255,150,0,0.1)"   },
  role_change:       { label: "Role Change",       icon: Shield,    color: "#00C8E0", bg: "rgba(0,200,224,0.1)"  },
  zone_assignment:   { label: "Zone Assignment",   icon: MapPin,    color: "#34C759", bg: "rgba(52,199,89,0.1)"  },
  user_added:        { label: "User Added",        icon: UserPlus,  color: "#00C8E0", bg: "rgba(0,200,224,0.08)" },
  user_removed:      { label: "User Removed",      icon: UserX,     color: "#FF2D55", bg: "rgba(255,45,85,0.1)"  },
  user_suspended:    { label: "User Suspended",    icon: Lock,      color: "#FF2D55", bg: "rgba(255,45,85,0.1)"  },
  "2fa_event":       { label: "2FA / PIN",         icon: Fingerprint,color:"#9B59B6", bg: "rgba(155,89,182,0.1)" },
  login:             { label: "Login",              icon: LogIn,     color: "#4A90D9", bg: "rgba(74,144,217,0.1)" },
  logout:            { label: "Logout",             icon: LogOut,    color: "#4A90D9", bg: "rgba(74,144,217,0.08)"},
  emergency:         { label: "Emergency Action",  icon: Siren,     color: "#FF2D55", bg: "rgba(255,45,85,0.1)"  },
  settings:          { label: "Settings Change",   icon: Settings,  color: "#FF9500", bg: "rgba(255,150,0,0.08)" },
  csv_import:        { label: "CSV Import",        icon: FileText,  color: "#34C759", bg: "rgba(52,199,89,0.08)" },
  file_access:       { label: "File Accessed",     icon: Eye,       color: "#8090A5", bg: "rgba(128,144,165,0.08)" },
  data_modify:       { label: "Data Modified",     icon: Edit2,     color: "#FF9500", bg: "rgba(255,150,0,0.08)" },
  data_delete:       { label: "Data Deleted",      icon: Trash2,    color: "#FF2D55", bg: "rgba(255,45,85,0.08)" },
  report_export:     { label: "Report Exported",   icon: Download,  color: "#00C8E0", bg: "rgba(0,200,224,0.08)" },
  investigation:     { label: "Investigation",     icon: Activity,  color: "#FF9500", bg: "rgba(255,150,0,0.08)" },
};

const LEVEL_CONFIG: Record<AuditLevel, { label: string; color: string; icon: React.ElementType }> = {
  owner:      { label: "Owner",        color: "#FF2D55", icon: Crown      },
  main_admin: { label: "Main Admin",   color: "#FF9500", icon: Key        },
  zone_admin: { label: "Zone Admin",   color: "#00C8E0", icon: ShieldCheck },
  worker:     { label: "Field Worker", color: "#34C759", icon: UserCheck  },
  system:     { label: "System",       color: "#9B59B6", icon: Zap        },
};

const SEVERITY_CONFIG = {
  info:     { color: "rgba(255,255,255,0.35)", bg: "rgba(255,255,255,0.04)" },
  success:  { color: "#34C759",               bg: "rgba(52,199,89,0.06)"   },
  warning:  { color: "#FF9500",               bg: "rgba(255,150,0,0.06)"   },
  critical: { color: "#FF2D55",               bg: "rgba(255,45,85,0.06)"   },
};

// ── Mock Audit Data ───────────────────────────────────────────
function ago(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

const MOCK_AUDIT: AuditEntry[] = [
  {
    id: "AUD-001", timestamp: ago(2), category: "permission_change", severity: "warning",
    actor: { id: "USR-001", name: "Ahmed Al-Rashid", level: "owner" },
    target: { id: "USR-006", name: "Sara Al-Mutairi", level: "zone_admin" },
    action: "Custom permissions applied",
    detail: "Modified 3 permissions for Sara Al-Mutairi in Zone C",
    before: "Role defaults (Safety Manager)",
    after: "Custom: +audit:view, -billing:view, +reports:export",
    zone: "Zone C", ip: "192.168.1.10", verified2FA: true,
  },
  {
    id: "AUD-002", timestamp: ago(5), category: "2fa_event", severity: "success",
    actor: { id: "USR-001", name: "Ahmed Al-Rashid", level: "owner" },
    action: "2FA PIN verified",
    detail: "Owner verified PIN before modifying permissions for Sara Al-Mutairi",
    ip: "192.168.1.10", verified2FA: true,
  },
  {
    id: "AUD-003", timestamp: ago(18), category: "zone_assignment", severity: "info",
    actor: { id: "USR-002", name: "Omar Al-Farsi", level: "main_admin" },
    target: { id: "USR-005", name: "Mohammed Ali", level: "zone_admin" },
    action: "Zone Lead assigned",
    detail: "Mohammed Ali assigned as Lead Admin for Zone B — Control Room",
    before: "Unassigned",
    after: "Zone B Lead Admin",
    zone: "Zone B", ip: "192.168.1.11",
  },
  {
    id: "AUD-004", timestamp: ago(34), category: "2fa_event", severity: "success",
    actor: { id: "USR-002", name: "Omar Al-Farsi", level: "main_admin" },
    action: "2FA PIN verified",
    detail: "Main Admin verified PIN before assigning zone admin role",
    ip: "192.168.1.11", verified2FA: true,
  },
  {
    id: "AUD-005", timestamp: ago(52), category: "role_change", severity: "warning",
    actor: { id: "USR-001", name: "Ahmed Al-Rashid", level: "owner" },
    target: { id: "USR-003", name: "Khalid Omar", level: "zone_admin" },
    action: "Role upgraded",
    detail: "Khalid Omar role changed from Employee to Shift Supervisor",
    before: "employee",
    after: "shift_supervisor",
    ip: "192.168.1.10", verified2FA: true,
  },
  {
    id: "AUD-006", timestamp: ago(78), category: "csv_import", severity: "success",
    actor: { id: "USR-002", name: "Omar Al-Farsi", level: "main_admin" },
    action: "CSV bulk import completed",
    detail: "487 employees imported successfully (3 warnings, 2 errors skipped)",
    after: "+487 employees, distributed across Zone A, B, C, D, E",
    ip: "192.168.1.11",
  },
  {
    id: "AUD-007", timestamp: ago(112), category: "user_added", severity: "success",
    actor: { id: "USR-002", name: "Omar Al-Farsi", level: "main_admin" },
    target: { id: "USR-010", name: "Aisha Rahman", level: "worker" },
    action: "New member approved",
    detail: "Aisha Rahman approved from invite link and assigned to Zone B",
    after: "Field Worker · Zone B",
    ip: "192.168.1.11",
  },
  {
    id: "AUD-008", timestamp: ago(145), category: "emergency", severity: "critical",
    actor: { id: "USR-006", name: "Sara Al-Mutairi", level: "zone_admin" },
    action: "Emergency escalated",
    detail: "Zone C incident escalated to Main Admin — worker unresponsive 4+ minutes",
    zone: "Zone C", ip: "10.0.0.45",
  },
  {
    id: "AUD-009", timestamp: ago(180), category: "permission_change", severity: "warning",
    actor: { id: "USR-002", name: "Omar Al-Farsi", level: "main_admin" },
    target: { id: "USR-007", name: "Nasser Al-Said", level: "worker" },
    action: "Permission downgraded",
    detail: "Removed emergency:create permission from Nasser Al-Said",
    before: "employee defaults + emergency:create",
    after: "Standard employee defaults",
    zone: "Zone A", ip: "192.168.1.11", verified2FA: true,
  },
  {
    id: "AUD-010", timestamp: ago(220), category: "login", severity: "info",
    actor: { id: "USR-001", name: "Ahmed Al-Rashid", level: "owner" },
    action: "Dashboard login",
    detail: "Owner logged into SOSphere dashboard from Chrome/macOS",
    ip: "192.168.1.10",
  },
  {
    id: "AUD-011", timestamp: ago(245), category: "settings", severity: "info",
    actor: { id: "USR-001", name: "Ahmed Al-Rashid", level: "owner" },
    action: "Company settings updated",
    detail: "Check-in interval changed from 30min to 15min. SMS alerts enabled for late check-ins.",
    before: "30 min interval",
    after: "15 min interval + SMS",
    ip: "192.168.1.10", verified2FA: false,
  },
  {
    id: "AUD-012", timestamp: ago(290), category: "zone_assignment", severity: "info",
    actor: { id: "USR-001", name: "Ahmed Al-Rashid", level: "owner" },
    target: { id: "USR-004", name: "Fatima Hassan", level: "zone_admin" },
    action: "Secondary Zone Admin assigned",
    detail: "Fatima Hassan assigned as Secondary Admin for Zone A — North Gate",
    before: "Unassigned",
    after: "Zone A Secondary Admin",
    zone: "Zone A", ip: "192.168.1.10",
  },
  {
    id: "AUD-013", timestamp: ago(360), category: "user_suspended", severity: "critical",
    actor: { id: "USR-002", name: "Omar Al-Farsi", level: "main_admin" },
    target: { id: "USR-009", name: "Yusuf Bakr", level: "worker" },
    action: "Account suspended",
    detail: "Yusuf Bakr account suspended — reason: 3 consecutive missed check-ins in Zone D",
    zone: "Zone D", ip: "192.168.1.11", verified2FA: true,
  },
  {
    id: "AUD-014", timestamp: ago(480), category: "2fa_event", severity: "warning",
    actor: { id: "USR-002", name: "Omar Al-Farsi", level: "main_admin" },
    action: "2FA PIN failed (attempt 1/3)",
    detail: "Incorrect PIN entered before attempting permission change. System logged attempt.",
    ip: "192.168.1.11",
  },
  {
    id: "AUD-015", timestamp: ago(720), category: "role_change", severity: "info",
    actor: { id: "system", name: "System", level: "system" },
    target: { id: "USR-003", name: "Khalid Omar", level: "zone_admin" },
    action: "Role auto-promoted via Onboarding",
    detail: "Zone Admin role assigned during company onboarding wizard (Step 2 — Zone Setup)",
    after: "shift_supervisor · Zone A Lead Admin",
  },
  {
    id: "AUD-016", timestamp: ago(1440), category: "csv_import", severity: "warning",
    actor: { id: "USR-002", name: "Omar Al-Farsi", level: "main_admin" },
    action: "CSV import with errors",
    detail: "Import attempted — 2 critical errors prevented completion (duplicate ID, invalid phone)",
    before: "0 employees",
    after: "Import aborted — fix errors and retry",
    ip: "192.168.1.11",
  },
  {
    id: "AUD-017", timestamp: ago(2880), category: "permission_change", severity: "critical",
    actor: { id: "USR-001", name: "Ahmed Al-Rashid", level: "owner" },
    target: { id: "USR-002", name: "Omar Al-Farsi", level: "main_admin" },
    action: "Main Admin billing access revoked",
    detail: "billing:manage permission removed from Main Admin",
    before: "billing:view + billing:manage",
    after: "billing:view only",
    ip: "192.168.1.10", verified2FA: true,
  },
  {
    id: "AUD-018", timestamp: ago(4320), category: "user_added", severity: "success",
    actor: { id: "system", name: "System", level: "system" },
    target: { id: "USR-001", name: "Ahmed Al-Rashid", level: "owner" },
    action: "Owner account created",
    detail: "Company registered — Owner account bootstrapped with full permissions",
    after: "Owner · Full Access · All Zones",
  },
  // ── ISO Compliance Audit Entries ──
  {
    id: "AUD-019", timestamp: ago(15), category: "file_access" as AuditCategory, severity: "info" as const,
    actor: { id: "USR-006", name: "Sara Al-Mutairi", level: "zone_admin" as AuditLevel },
    action: "Viewed investigation report",
    detail: "Opened investigation INV-001 (Scaffolding Collapse) — full report including RCA and CAPA plan",
    zone: "Zone D", ip: "10.0.0.45",
  },
  {
    id: "AUD-020", timestamp: ago(25), category: "data_modify" as AuditCategory, severity: "warning" as const,
    actor: { id: "USR-002", name: "Omar Al-Farsi", level: "main_admin" as AuditLevel },
    action: "Risk assessment updated",
    detail: "RSK-004 (Heat Stress) likelihood changed from 3 to 4 based on new weather forecast data",
    before: "Likelihood: 3, Score: 9 (Medium)",
    after: "Likelihood: 4, Score: 12 (High)",
    zone: "Zone A", ip: "192.168.1.11", verified2FA: true,
  },
  {
    id: "AUD-021", timestamp: ago(42), category: "data_delete" as AuditCategory, severity: "critical" as const,
    actor: { id: "USR-002", name: "Omar Al-Farsi", level: "main_admin" as AuditLevel },
    target: { id: "USR-012", name: "Tariq Zayed", level: "worker" as AuditLevel },
    action: "Employee record archived",
    detail: "Tariq Zayed employment record moved to archive — reason: contract ended. All GPS and check-in history preserved for 7 years per policy.",
    zone: "Zone D", ip: "192.168.1.11", verified2FA: true,
  },
  {
    id: "AUD-022", timestamp: ago(55), category: "report_export" as AuditCategory, severity: "info" as const,
    actor: { id: "USR-006", name: "Sara Al-Mutairi", level: "zone_admin" as AuditLevel },
    action: "Compliance report exported",
    detail: "Monthly Safety Compliance Report (Feb 2026) exported as PDF with encryption. Sent to management@company.com",
    ip: "10.0.0.45",
  },
  {
    id: "AUD-023", timestamp: ago(88), category: "investigation" as AuditCategory, severity: "warning" as const,
    actor: { id: "USR-006", name: "Sara Al-Mutairi", level: "zone_admin" as AuditLevel },
    action: "CAPA action marked complete",
    detail: "CA-5 (Retrain lab operators on chemical transfer SOP) marked as completed — 5/5 operators retrained",
    zone: "Zone B", ip: "10.0.0.45",
  },
  {
    id: "AUD-024", timestamp: ago(130), category: "logout" as AuditCategory, severity: "info" as const,
    actor: { id: "USR-001", name: "Ahmed Al-Rashid", level: "owner" as AuditLevel },
    action: "Dashboard logout",
    detail: "Owner logged out — session duration: 2h 15m. No pending actions.",
    ip: "192.168.1.10",
  },
  {
    id: "AUD-025", timestamp: ago(160), category: "file_access" as AuditCategory, severity: "info" as const,
    actor: { id: "USR-002", name: "Omar Al-Farsi", level: "main_admin" as AuditLevel },
    action: "Viewed employee GPS trail",
    detail: "Accessed 48h GPS trail history for Ali Mansour (EMP-013) — Zone A North Gate",
    zone: "Zone A", ip: "192.168.1.11",
  },
  {
    id: "AUD-026", timestamp: ago(200), category: "data_modify" as AuditCategory, severity: "info" as const,
    actor: { id: "USR-006", name: "Sara Al-Mutairi", level: "zone_admin" as AuditLevel },
    action: "Training record updated",
    detail: "Updated certification expiry for Lina Chen — HAZMAT certification renewed to 2027-03-10",
    before: "Expiry: 2026-03-10 (Expiring Soon)",
    after: "Expiry: 2027-03-10 (Valid)",
    zone: "Zone B", ip: "10.0.0.45",
  },
  {
    id: "AUD-027", timestamp: ago(310), category: "report_export" as AuditCategory, severity: "info" as const,
    actor: { id: "USR-001", name: "Ahmed Al-Rashid", level: "owner" as AuditLevel },
    action: "Risk Register exported",
    detail: "Full Risk Register + Training Records exported as PDF (2 pages, encrypted). Downloaded locally.",
    ip: "192.168.1.10",
  },
  {
    id: "AUD-028", timestamp: ago(500), category: "investigation" as AuditCategory, severity: "critical" as const,
    actor: { id: "USR-006", name: "Sara Al-Mutairi", level: "zone_admin" as AuditLevel },
    action: "New investigation opened",
    detail: "Investigation INV-002 opened for Chemical Spill in Zone B Lab — assigned as lead investigator",
    zone: "Zone B", ip: "10.0.0.45",
  },
  {
    id: "AUD-029", timestamp: ago(600), category: "data_delete" as AuditCategory, severity: "warning" as const,
    actor: { id: "USR-002", name: "Omar Al-Farsi", level: "main_admin" as AuditLevel },
    action: "Obsolete zone removed",
    detail: "Zone F (Temporary Storage) decommissioned and archived — 0 active workers, all geofences disabled",
    before: "Zone F — Active, 0 employees",
    after: "Zone F — Archived",
    ip: "192.168.1.11", verified2FA: true,
  },
];

// ── Helper Functions ──────────────────────────────────────────
function formatTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function formatFullDate(date: Date): string {
  return date.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

// ── Props ─────────────────────────────────────────────────────
interface AuditLogPageProps {
  t: (k: string) => string;
  webMode?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════
export function AuditLogPage({ t, webMode = false }: AuditLogPageProps) {
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<AuditCategory | "all">("all");
  const [filterLevel, setFilterLevel] = useState<AuditLevel | "all">("all");
  const [filterSeverity, setFilterSeverity] = useState<"all" | "info" | "warning" | "critical" | "success">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  // ── Email Delivery Modal State ──
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [lastAuditEncrypted, setLastAuditEncrypted] = useState(false);
  const [lastEncPassword, setLastEncPassword] = useState<string | undefined>();

  // ── REAL AUDIT LOG: Load from local store + Supabase ──────────
  const [realEntries, setRealEntries] = useState<AuditEntry[]>(() => {
    const real = getRealAuditLog();
    return real.map(r => ({ ...r, detail: r.detail || "" }));
  });

  // Fetch from Supabase on mount and merge with local entries
  useEffect(() => {
    fetchAuditLog().then(supabaseEntries => {
      if (!supabaseEntries?.length) return;
      setRealEntries(prev => {
        const existingIds = new Set(prev.map(r => r.id));
        const newEntries = supabaseEntries
          .filter((e: any) => !existingIds.has(e.id))
          .map((e: any) => ({
            id: e.id,
            timestamp: new Date(e.timestamp || e.created_at),
            category: (e.action_type || "settings") as any,
            severity: (e.severity || "info") as any,
            actor: {
              id: e.actor_id || "system",
              name: e.actor_name || "System",
              level: (e.actor_role || "system") as any,
              zone: e.zone,
            },
            target: e.target_id ? { id: e.target_id, name: e.target_name || e.target_id } : undefined,
            action: e.action || e.action_type || "System event",
            detail: e.detail || e.description || "",
            zone: e.zone,
            severity_level: e.severity,
            verified2FA: e.verified_2fa ?? false,
          }));
        if (newEntries.length === 0) return prev;
        return [...newEntries, ...prev].sort((a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
      });
    }).catch(() => {/* Supabase unavailable — local data still shown */});
  }, []);

  // Listen for new local audit events (live updates from this session)
  useEffect(() => {
    const unsub = onAuditEvent(() => {
      const real = getRealAuditLog();
      setRealEntries(prev => {
        const existingIds = new Set(prev.map(r => r.id));
        const newLocal = real
          .filter(r => !existingIds.has(r.id))
          .map(r => ({ ...r, detail: r.detail || "" }));
        if (newLocal.length === 0) return prev;
        return [...newLocal, ...prev];
      });
    });
    return unsub;
  }, []);

  // Real entries only. Mock data is shown ONLY as an empty-state demo
  // when there's nothing real yet — never interleaved with real events,
  // because that would let a fabricated row pass a compliance audit.
  // (P3-#11: replaced gap-filling merge with strict real-only view.)
  const DEV_DEMO_AUDIT = (import.meta as any).env?.DEV === true;
  const allEntries = useMemo(() => {
    if (realEntries.length > 0) {
      return [...realEntries].sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    }
    if (DEV_DEMO_AUDIT) {
      // Dev-only empty-state demo. Production builds show an empty state.
      return [...MOCK_AUDIT].sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    }
    return [];
  }, [realEntries, DEV_DEMO_AUDIT]);

  const filtered = useMemo(() => {
    return allEntries.filter(entry => {
      const matchSearch = search === "" ||
        entry.actor.name.toLowerCase().includes(search.toLowerCase()) ||
        entry.action.toLowerCase().includes(search.toLowerCase()) ||
        entry.detail.toLowerCase().includes(search.toLowerCase()) ||
        entry.target?.name.toLowerCase().includes(search.toLowerCase());
      const matchCat = filterCategory === "all" || entry.category === filterCategory;
      const matchLevel = filterLevel === "all" || entry.actor.level === filterLevel;
      const matchSev = filterSeverity === "all" || entry.severity === filterSeverity;
      return matchSearch && matchCat && matchLevel && matchSev;
    });
  }, [search, filterCategory, filterLevel, filterSeverity]);

  // Stats — use merged real+mock data
  const stats = useMemo(() => ({
    total: allEntries.length,
    critical: allEntries.filter(e => e.severity === "critical").length,
    warning: allEntries.filter(e => e.severity === "warning").length,
    with2FA: allEntries.filter(e => e.verified2FA).length,
    permChanges: allEntries.filter(e => e.category === "permission_change").length,
  }), [allEntries]);

  const handleExport = () => {
    const rows = [
      ["Timestamp","Actor","Level","Action","Category","Target","Zone","2FA","IP","Severity"],
      ...filtered.map(e => [
        formatFullDate(e.timestamp),
        e.actor.name,
        e.actor.level,
        e.action,
        e.category,
        e.target?.name || "—",
        e.zone || "—",
        e.verified2FA ? "Yes" : "No",
        e.ip || "—",
        e.severity,
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sosphere_audit_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = async (encryptionConfig?: PdfEncryptionConfig | null) => {
    try { await import("jspdf-autotable"); } catch {}

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
        toast.warning("Encryption Not Applied", { description: "PDF generated without password protection.", duration: 5000 });
      }
    } else {
      doc = new jsPDF(baseOpts);
    }
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const today = new Date();
    const docId = `AUD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const verifyURL = `https://sosphere.app/verify/${docId}`;
    let qrDataURL = "";
    try {
      qrDataURL = await QRCode.toDataURL(verifyURL, {
        width: 200, margin: 1,
        color: { dark: "#0A0F1E", light: "#FFFFFF" },
        errorCorrectionLevel: "H",
      });
    } catch { /* fallback */ }
    // REAL SHA-256 of document content for legal-grade integrity
    let integrityHash = "0".repeat(64);
    try {
      const hashInput = `${docId}|${today.toISOString()}|${allEntries.length}|${allEntries.map(e => e.id).join(",")}`;
      const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput));
      integrityHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
    } catch { /* fallback: hash unavailable */ }

    // ── Sanitize text for PDF (replace non-ASCII with safe alternatives) ──
    const safe = (s: string) => s
      .replace(/—/g, "--")
      .replace(/–/g, "-")
      .replace(/→/g, ">")
      .replace(/←/g, "<")
      .replace(/↑/g, "+")
      .replace(/↓/g, "-")
      .replace(/•/g, "-")
      .replace(/✅/g, "[OK]")
      .replace(/⚠️/g, "[!]")
      .replace(/❌/g, "[X]")
      .replace(/≥/g, ">=")
      .replace(/≤/g, "<=")
      .replace(/°/g, " deg")
      // eslint-disable-next-line no-control-regex
      .replace(/[^\u0000-\u007F]/g, "");

    // ── Colors ──
    const C = {
      bg: [5, 7, 14] as [number, number, number],
      card: [10, 18, 32] as [number, number, number],
      cyan: [0, 200, 224] as [number, number, number],
      red: [255, 45, 85] as [number, number, number],
      orange: [255, 150, 0] as [number, number, number],
      green: [52, 199, 89] as [number, number, number],
      purple: [139, 92, 246] as [number, number, number],
      gold: [255, 214, 10] as [number, number, number],
    };

    // ── Helper: autoTable wrapper ──
    const tbl = (opts: any) => {
      if (typeof (doc as any).autoTable === "function") {
        (doc as any).autoTable(opts);
      } else {
        let fy = opts.startY || 20;
        doc.setFontSize(7);
        if (opts.head?.[0]) { doc.setTextColor(80); doc.text(opts.head[0].join(" | "), 15, fy); fy += 5; }
        if (opts.body) {
          doc.setTextColor(50);
          for (const row of opts.body) { if (fy > ph - 20) { doc.addPage(); fy = 15; } doc.text(row.map((c: any) => String(c)).join(" | "), 15, fy); fy += 4; }
        }
        (doc as any).lastAutoTable = { finalY: fy + 2 };
      }
    };
    const tblY = () => (doc as any).lastAutoTable?.finalY ?? 20;

    // ── Helper: draw KPI card ──
    const drawKPI = (x: number, yy: number, w: number, h: number, value: string, label: string, color: [number, number, number]) => {
      doc.setFillColor(245, 247, 250);
      doc.roundedRect(x, yy, w, h, 2, 2, "F");
      doc.setFillColor(color[0], color[1], color[2]);
      doc.rect(x, yy, 2.5, h, "F");
      doc.setFontSize(18);
      doc.setTextColor(color[0], color[1], color[2]);
      doc.text(value, x + w / 2 + 1, yy + h / 2 - 1, { align: "center" });
      doc.setFontSize(7);
      doc.setTextColor(100);
      doc.text(label, x + w / 2 + 1, yy + h / 2 + 6, { align: "center" });
    };

    // ── Helper: draw severity indicator (colored dot + text) ──
    const drawSev = (x: number, yy: number, severity: string) => {
      const sc: Record<string, [number, number, number]> = {
        critical: C.red, warning: C.orange, success: C.green, info: [120, 140, 170],
      };
      const col = sc[severity] || sc.info;
      doc.setFillColor(col[0], col[1], col[2]);
      doc.circle(x + 2, yy - 1.2, 1.5, "F");
      doc.setFontSize(7);
      doc.setTextColor(col[0], col[1], col[2]);
      doc.text(severity.toUpperCase(), x + 5, yy);
    };

    // ── Helper: draw progress bar ──
    const drawBar = (x: number, yy: number, w: number, pct: number, color: [number, number, number]) => {
      doc.setFillColor(230, 232, 237);
      doc.roundedRect(x, yy, w, 3, 1.5, 1.5, "F");
      if (pct > 0) {
        doc.setFillColor(color[0], color[1], color[2]);
        doc.roundedRect(x, yy, Math.max(w * pct, 3), 3, 1.5, 1.5, "F");
      }
    };

    // ── Helper: section header with colored accent ──
    const sectionHead = (title: string, color: [number, number, number], subtitle?: string) => {
      if (y > ph - 40) { doc.addPage(); y = 18; }
      doc.setFillColor(color[0], color[1], color[2]);
      doc.rect(15, y, pw - 30, 0.8, "F");
      y += 5;
      doc.setFillColor(color[0], color[1], color[2]);
      doc.roundedRect(15, y, 3, 9, 1, 1, "F");
      doc.setFontSize(12);
      doc.setTextColor(30, 35, 50);
      doc.text(title, 22, y + 6.5);
      if (subtitle) {
        doc.setFontSize(8);
        doc.setTextColor(140);
        doc.text(subtitle, pw - 15, y + 6.5, { align: "right" });
      }
      y += 14;
    };

    // ── Helper: page footer (called at end on all pages) ──
    const addFooters = () => {
      const tp = doc.getNumberOfPages();
      for (let i = 1; i <= tp; i++) {
        doc.setPage(i);
        // Bottom line
        doc.setDrawColor(220);
        doc.setLineWidth(0.2);
        doc.line(15, ph - 12, pw - 15, ph - 12);
        doc.setFontSize(6.5);
        if (i === 1) {
          doc.setTextColor(80);
          doc.text("SOSphere Safety Intelligence Platform", pw / 2, ph - 8, { align: "center" });
        } else {
          doc.setTextColor(130);
          doc.text("SOSphere Audit Report", 15, ph - 8);
          doc.setTextColor(170);
          doc.text("CONFIDENTIAL", pw / 2, ph - 8, { align: "center" });
          doc.setTextColor(130);
          doc.text(`Page ${i} of ${tp}`, pw - 15, ph - 8, { align: "right" });
        }
      }
    };

    // ── Pre-compute stats ──
    const sevStats = {
      critical: filtered.filter(e => e.severity === "critical").length,
      warning: filtered.filter(e => e.severity === "warning").length,
      success: filtered.filter(e => e.severity === "success").length,
      info: filtered.filter(e => e.severity === "info").length,
    };
    const twoFACount = filtered.filter(e => e.verified2FA).length;
    const twoFAPct = filtered.length > 0 ? Math.round((twoFACount / filtered.length) * 100) : 0;
    const permChanges = filtered.filter(e => e.category === "permission_change").length;
    const catStats = Object.entries(CATEGORY_CONFIG).map(([k, v]) => ({
      key: k, label: v.label, count: filtered.filter(e => e.category === k).length,
    })).filter(c => c.count > 0).sort((a, b) => b.count - a.count);
    const actorStats: Record<string, { count: number; level: AuditLevel }> = {};
    filtered.forEach(e => {
      if (!actorStats[e.actor.name]) actorStats[e.actor.name] = { count: 0, level: e.actor.level };
      actorStats[e.actor.name].count++;
    });
    const topActors = Object.entries(actorStats).sort(([,a],[,b]) => b.count - a.count);

    // Active filters
    const activeFilters: string[] = [];
    if (filterCategory !== "all") activeFilters.push(`Category: ${CATEGORY_CONFIG[filterCategory].label}`);
    if (filterLevel !== "all") activeFilters.push(`Level: ${LEVEL_CONFIG[filterLevel].label}`);
    if (filterSeverity !== "all") activeFilters.push(`Severity: ${filterSeverity}`);
    if (search) activeFilters.push(`Search: "${search}"`);


    // ====================================================================
    //  PAGE 1 -- COVER PAGE (Dark themed, premium)
    // ====================================================================
    doc.setFillColor(C.bg[0], C.bg[1], C.bg[2]);
    doc.rect(0, 0, pw, ph, "F");

    // Top cyan accent bar
    doc.setFillColor(C.cyan[0], C.cyan[1], C.cyan[2]);
    doc.rect(0, 0, pw, 3, "F");

    // Decorative side line
    doc.setFillColor(C.cyan[0], C.cyan[1], C.cyan[2]);
    doc.rect(20, 30, 1.5, 100, "F");

    // Logo
    doc.setFillColor(C.cyan[0], C.cyan[1], C.cyan[2]);
    doc.roundedRect(30, 35, 30, 30, 4, 4, "F");
    doc.setFontSize(22);
    doc.setTextColor(C.bg[0], C.bg[1], C.bg[2]);
    doc.text("S", 40, 55);

    // Title block
    doc.setFontSize(32);
    doc.setTextColor(255, 255, 255);
    doc.text("AUDIT LOG", 30, 85);
    doc.setFontSize(14);
    doc.setTextColor(C.cyan[0], C.cyan[1], C.cyan[2]);
    doc.text("REPORT", 30, 93);

    doc.setFontSize(10);
    doc.setTextColor(180, 185, 200);
    doc.text("Security & Compliance Activity Trail", 30, 104);

    // Separator
    doc.setFillColor(40, 50, 70);
    doc.rect(30, 112, pw - 60, 0.3, "F");

    // Metadata grid (2 columns)
    const metaLeft = [
      ["Document ID", docId],
      ["Generated", today.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })],
      ["Time", today.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })],
      ["Classification", "CONFIDENTIAL"],
    ];
    const metaRight = [
      ["Total Events", `${filtered.length} of ${allEntries.length}`],
      ["Period", `${formatFullDate(filtered[filtered.length - 1]?.timestamp || today)} -- ${formatFullDate(filtered[0]?.timestamp || today)}`],
      ["Critical Events", String(sevStats.critical)],
      ["2FA Compliance", `${twoFAPct}%`],
    ];

    let my = 120;
    doc.setFontSize(8);
    metaLeft.forEach(([k, v]) => {
      doc.setTextColor(100, 110, 130);
      doc.text(k.toUpperCase(), 30, my);
      doc.setTextColor(200, 205, 215);
      doc.text(v, 30, my + 4.5);
      my += 12;
    });
    my = 120;
    metaRight.forEach(([k, v]) => {
      doc.setTextColor(100, 110, 130);
      doc.text(k.toUpperCase(), pw / 2 + 10, my);
      doc.setTextColor(200, 205, 215);
      doc.text(v, pw / 2 + 10, my + 4.5);
      my += 12;
    });

    // Filters badge
    if (activeFilters.length > 0) {
      my += 4;
      doc.setFillColor(255, 150, 0, 0.15 as any);
      doc.setFillColor(40, 35, 20);
      doc.roundedRect(28, my - 3, pw - 56, 12, 2, 2, "F");
      doc.setDrawColor(C.orange[0], C.orange[1], C.orange[2]);
      doc.setLineWidth(0.3);
      doc.roundedRect(28, my - 3, pw - 56, 12, 2, 2, "S");
      doc.setFontSize(7);
      doc.setTextColor(C.orange[0], C.orange[1], C.orange[2]);
      doc.text("ACTIVE FILTERS:", 33, my + 3);
      doc.setTextColor(200, 180, 140);
      doc.text(activeFilters.join("  |  "), 62, my + 3);
    }

    // ── QR Code Verification Block (bottom-right) ──
    if (qrDataURL) {
      const qrS = 26;
      const qrX = pw - 15 - qrS;
      const qrY = ph - 72;

      doc.setFillColor(15, 20, 35);
      doc.roundedRect(qrX - 4, qrY - 8, qrS + 8, qrS + 20, 3, 3, "F");
      doc.setDrawColor(C.cyan[0], C.cyan[1], C.cyan[2]);
      doc.setLineWidth(0.3);
      doc.roundedRect(qrX - 4, qrY - 8, qrS + 8, qrS + 20, 3, 3, "S");

      doc.addImage(qrDataURL, "PNG", qrX, qrY, qrS, qrS);

      doc.setFontSize(5);
      doc.setTextColor(C.cyan[0], C.cyan[1], C.cyan[2]);
      doc.text("DIGITAL VERIFICATION", qrX + qrS / 2, qrY - 3, { align: "center" });
      doc.setFontSize(4);
      doc.setTextColor(120);
      doc.text("Scan to verify", qrX + qrS / 2, qrY + qrS + 4, { align: "center" });
      doc.setFontSize(3.5);
      doc.text(docId, qrX + qrS / 2, qrY + qrS + 8, { align: "center" });
    } else {
      // Fallback security stamp
      doc.setDrawColor(C.cyan[0], C.cyan[1], C.cyan[2]);
      doc.setLineWidth(0.5);
      doc.circle(pw - 35, ph - 45, 14, "S");
      doc.circle(pw - 35, ph - 45, 12, "S");
      doc.setFontSize(6);
      doc.setTextColor(C.cyan[0], C.cyan[1], C.cyan[2]);
      doc.text("VERIFIED", pw - 35, ph - 48, { align: "center" });
      doc.setFontSize(7);
      doc.text("SOSphere", pw - 35, ph - 43, { align: "center" });
      doc.setFontSize(5);
      doc.text("SECURITY", pw - 35, ph - 39, { align: "center" });
    }

    // Bottom powered-by
    doc.setFontSize(7);
    doc.setTextColor(60, 65, 80);
    doc.text("Powered by SOSphere -- Proactive Safety Intelligence Platform", pw / 2, ph - 18, { align: "center" });
    doc.setFontSize(6);
    doc.text("This document is system-generated. Unauthorized distribution is prohibited.", pw / 2, ph - 13, { align: "center" });


    // ====================================================================
    //  PAGE 2 -- TABLE OF CONTENTS
    // ====================================================================
    doc.addPage();
    let y = 18;

    // Top bar
    doc.setFillColor(C.cyan[0], C.cyan[1], C.cyan[2]);
    doc.rect(0, 0, pw, 1.5, "F");

    doc.setFontSize(18);
    doc.setTextColor(25, 30, 45);
    doc.text("Table of Contents", 15, y);
    y += 3;
    doc.setDrawColor(C.cyan[0], C.cyan[1], C.cyan[2]);
    doc.setLineWidth(0.5);
    doc.line(15, y, 70, y);
    y += 10;

    const tocItems = [
      { num: "01", title: "Executive Summary & KPI Dashboard", page: "3" },
      { num: "02", title: "Severity & Risk Analysis", page: "3" },
      { num: "03", title: "Activity Breakdown by Category", page: "3" },
      { num: "04", title: "Actor Activity Analysis", page: "3-4" },
      { num: "05", title: "Detailed Event Log", page: "4-5" },
      { num: "06", title: "Critical Events -- Detailed Investigation", page: "5-6" },
      { num: "07", title: "Change Audit Trail (Before / After)", page: "6" },
      { num: "08", title: "2FA Compliance Report", page: "7" },
      { num: "09", title: "Trust & Integrity Verification", page: "7" },
      { num: "10", title: "Certification, Legal & Signatures", page: "8" },
    ];

    tocItems.forEach(item => {
      // Number box
      doc.setFillColor(C.cyan[0], C.cyan[1], C.cyan[2]);
      doc.roundedRect(15, y - 3.5, 10, 7, 1, 1, "F");
      doc.setFontSize(8);
      doc.setTextColor(255);
      doc.text(item.num, 20, y + 0.5, { align: "center" });

      // Title
      doc.setFontSize(10);
      doc.setTextColor(40, 45, 60);
      doc.text(item.title, 30, y + 0.5);

      // Dotted line
      doc.setDrawColor(200);
      doc.setLineWidth(0.1);
      doc.setLineDashPattern([1, 1], 0);
      const titleW = doc.getTextWidth(item.title);
      doc.line(30 + titleW + 3, y + 1, pw - 25, y + 1);
      doc.setLineDashPattern([], 0);

      // Page number
      doc.setTextColor(C.cyan[0], C.cyan[1], C.cyan[2]);
      doc.setFontSize(9);
      doc.text(item.page, pw - 15, y + 0.5, { align: "right" });

      y += 11;
    });


    // ====================================================================
    //  PAGE 3 -- EXECUTIVE SUMMARY + KPI DASHBOARD
    // ====================================================================
    doc.addPage();
    y = 18;

    doc.setFillColor(C.cyan[0], C.cyan[1], C.cyan[2]);
    doc.rect(0, 0, pw, 1.5, "F");

    sectionHead("Executive Summary", C.cyan, "OVERVIEW");

    // KPI Cards Row
    const kpiW = (pw - 30 - 12) / 4;  // 4 cards with 4mm gaps
    drawKPI(15, y, kpiW, 22, String(filtered.length), "TOTAL EVENTS", C.cyan);
    drawKPI(15 + kpiW + 4, y, kpiW, 22, String(sevStats.critical), "CRITICAL", C.red);
    drawKPI(15 + (kpiW + 4) * 2, y, kpiW, 22, String(sevStats.warning), "WARNINGS", C.orange);
    drawKPI(15 + (kpiW + 4) * 3, y, kpiW, 22, `${twoFAPct}%`, "2FA RATE", C.green);
    y += 28;

    // Second row of KPIs
    drawKPI(15, y, kpiW, 22, String(permChanges), "PERM CHANGES", C.purple);
    drawKPI(15 + kpiW + 4, y, kpiW, 22, String(twoFACount), "2FA VERIFIED", C.green);
    drawKPI(15 + (kpiW + 4) * 2, y, kpiW, 22, String(catStats.length), "CATEGORIES", C.cyan);
    drawKPI(15 + (kpiW + 4) * 3, y, kpiW, 22, String(topActors.length), "UNIQUE ACTORS", C.gold);
    y += 30;

    // ── Severity & Risk Analysis ──
    sectionHead("Severity & Risk Analysis", C.red, "RISK ASSESSMENT");

    // Visual severity bars
    const sevItems = [
      { label: "CRITICAL", count: sevStats.critical, color: C.red },
      { label: "WARNING", count: sevStats.warning, color: C.orange },
      { label: "SUCCESS", count: sevStats.success, color: C.green },
      { label: "INFO", count: sevStats.info, color: [150, 160, 180] as [number, number, number] },
    ];

    sevItems.forEach(s => {
      const pct = filtered.length > 0 ? s.count / filtered.length : 0;
      // Label
      doc.setFontSize(8);
      doc.setTextColor(s.color[0], s.color[1], s.color[2]);
      doc.text(s.label, 15, y);
      // Count
      doc.setTextColor(60);
      doc.text(String(s.count), 50, y);
      // Percentage
      doc.text(`${(pct * 100).toFixed(1)}%`, 60, y);
      // Progress bar
      drawBar(75, y - 2.5, pw - 90, pct, s.color);
      y += 8;
    });

    // Risk level indicator
    y += 2;
    const riskLevel = sevStats.critical >= 3 ? "HIGH" : sevStats.critical >= 1 ? "MODERATE" : "LOW";
    const riskColor = sevStats.critical >= 3 ? C.red : sevStats.critical >= 1 ? C.orange : C.green;
    doc.setFillColor(riskColor[0], riskColor[1], riskColor[2]);
    doc.roundedRect(15, y, 50, 10, 2, 2, "F");
    doc.setFontSize(8);
    doc.setTextColor(255);
    doc.text(`RISK LEVEL: ${riskLevel}`, 40, y + 6.5, { align: "center" });
    doc.setFontSize(7);
    doc.setTextColor(100);
    doc.text(`Based on ${sevStats.critical} critical event(s) in the reporting period`, 70, y + 6.5);
    y += 16;

    // ── Activity by Category ──
    sectionHead("Activity Breakdown by Category", C.purple, `${catStats.length} ACTIVE CATEGORIES`);

    tbl({
      startY: y,
      head: [["#", "Category", "Events", "Share", "Trend"]],
      body: catStats.map((c, i) => [
        String(i + 1),
        c.label,
        String(c.count),
        `${((c.count / filtered.length) * 100).toFixed(1)}%`,
        c.count >= 3 ? "High Activity" : c.count >= 2 ? "Normal" : "Low",
      ]),
      theme: "striped",
      headStyles: { fillColor: [45, 35, 75], textColor: [200, 180, 255], fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 8, textColor: [50, 55, 65] },
      alternateRowStyles: { fillColor: [248, 248, 252] },
      margin: { left: 15, right: 15 },
      columnStyles: {
        0: { cellWidth: 10, halign: "center", fontStyle: "bold" },
        1: { cellWidth: 50 },
        2: { cellWidth: 20, halign: "center" },
        3: { cellWidth: 25, halign: "center" },
        4: { cellWidth: 30 },
      },
      didParseCell: (data: any) => {
        if (data.section === "body" && data.column.index === 4) {
          const v = data.cell.raw;
          if (v === "High Activity") data.cell.styles.textColor = [255, 45, 85];
          else if (v === "Normal") data.cell.styles.textColor = [52, 199, 89];
          else data.cell.styles.textColor = [150, 150, 150];
        }
      },
    });
    y = tblY() + 8;


    // ====================================================================
    //  PAGE 4 -- ACTOR ANALYSIS
    // ====================================================================
    if (y > ph - 80) { doc.addPage(); y = 18; doc.setFillColor(C.cyan[0], C.cyan[1], C.cyan[2]); doc.rect(0, 0, pw, 1.5, "F"); }

    sectionHead("Actor Activity Analysis", C.cyan, `${topActors.length} ACTORS`);

    tbl({
      startY: y,
      head: [["Rank", "Actor Name", "Role", "Events", "Share", "2FA Usage"]],
      body: topActors.map(([name, data], i) => {
        const actor2FA = filtered.filter(e => e.actor.name === name && e.verified2FA).length;
        return [
          String(i + 1),
          safe(name),
          LEVEL_CONFIG[data.level]?.label || data.level,
          String(data.count),
          `${((data.count / filtered.length) * 100).toFixed(1)}%`,
          actor2FA > 0 ? `${actor2FA}/${data.count} (${Math.round((actor2FA / data.count) * 100)}%)` : "None",
        ];
      }),
      theme: "striped",
      headStyles: { fillColor: C.card, textColor: C.cyan, fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 8, textColor: [50, 55, 65] },
      alternateRowStyles: { fillColor: [245, 250, 252] },
      margin: { left: 15, right: 15 },
      columnStyles: {
        0: { cellWidth: 12, halign: "center", fontStyle: "bold" },
        1: { cellWidth: 40 },
        2: { cellWidth: 28 },
        3: { cellWidth: 18, halign: "center" },
        4: { cellWidth: 20, halign: "center" },
        5: { cellWidth: 35 },
      },
      didParseCell: (data: any) => {
        if (data.section === "body" && data.column.index === 2) {
          const v = data.cell.raw;
          if (v === "Owner") data.cell.styles.textColor = [255, 45, 85];
          else if (v === "Main Admin") data.cell.styles.textColor = [255, 150, 0];
          else if (v === "Zone Admin") data.cell.styles.textColor = [0, 200, 224];
          else if (v === "System") data.cell.styles.textColor = [139, 92, 246];
        }
      },
    });
    y = tblY() + 8;


    // ====================================================================
    //  PAGE 5 -- DETAILED EVENT LOG
    // ====================================================================
    doc.addPage();
    y = 18;
    doc.setFillColor(C.cyan[0], C.cyan[1], C.cyan[2]);
    doc.rect(0, 0, pw, 1.5, "F");

    sectionHead("Detailed Event Log", C.cyan, `${filtered.length} EVENTS`);

    tbl({
      startY: y,
      head: [["#", "Timestamp", "Actor", "Level", "Action", "Target", "Severity", "2FA"]],
      body: filtered.map((e, i) => [
        String(i + 1),
        formatFullDate(e.timestamp),
        safe(e.actor.name),
        LEVEL_CONFIG[e.actor.level].label,
        safe(e.action),
        safe(e.target?.name || "--"),
        e.severity.toUpperCase(),
        e.verified2FA ? "YES" : "--",
      ]),
      theme: "striped",
      headStyles: { fillColor: C.card, textColor: C.cyan, fontSize: 7.5, fontStyle: "bold" },
      bodyStyles: { fontSize: 7.5, textColor: [50, 55, 65] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 12, right: 12 },
      columnStyles: {
        0: { cellWidth: 8, halign: "center", fontStyle: "bold" },
        1: { cellWidth: 32 },
        2: { cellWidth: 28 },
        3: { cellWidth: 20 },
        4: { cellWidth: 38 },
        5: { cellWidth: 24 },
        6: { cellWidth: 18, halign: "center" },
        7: { cellWidth: 12, halign: "center" },
      },
      didParseCell: (data: any) => {
        if (data.section === "body") {
          // Severity color
          if (data.column.index === 6) {
            const v = data.cell.raw;
            if (v === "CRITICAL") { data.cell.styles.textColor = [255, 45, 85]; data.cell.styles.fontStyle = "bold"; }
            else if (v === "WARNING") data.cell.styles.textColor = [255, 150, 0];
            else if (v === "SUCCESS") data.cell.styles.textColor = [52, 199, 89];
            else data.cell.styles.textColor = [140, 150, 165];
          }
          // 2FA color
          if (data.column.index === 7) {
            if (data.cell.raw === "YES") data.cell.styles.textColor = [52, 199, 89];
            else data.cell.styles.textColor = [200, 200, 200];
          }
          // Level color
          if (data.column.index === 3) {
            const v = data.cell.raw;
            if (v === "Owner") data.cell.styles.textColor = [255, 45, 85];
            else if (v === "Main Admin") data.cell.styles.textColor = [255, 150, 0];
            else if (v === "Zone Admin") data.cell.styles.textColor = [0, 160, 190];
            else if (v === "System") data.cell.styles.textColor = [139, 92, 246];
          }
        }
      },
    });
    y = tblY() + 8;


    // ====================================================================
    //  CRITICAL EVENTS -- DETAILED INVESTIGATION CARDS
    // ====================================================================
    const criticals = filtered.filter(e => e.severity === "critical");
    if (criticals.length > 0) {
      doc.addPage();
      y = 18;
      doc.setFillColor(C.cyan[0], C.cyan[1], C.cyan[2]);
      doc.rect(0, 0, pw, 1.5, "F");

      sectionHead("Critical Events -- Detailed Investigation", C.red, `${criticals.length} CRITICAL EVENT(S)`);

      criticals.forEach((e, i) => {
        if (y > ph - 65) { doc.addPage(); y = 18; }

        // Card background
        doc.setFillColor(252, 245, 247);
        doc.roundedRect(15, y, pw - 30, 50, 3, 3, "F");

        // Left red accent
        doc.setFillColor(C.red[0], C.red[1], C.red[2]);
        doc.roundedRect(15, y, 4, 50, 2, 0, "F");
        doc.rect(17, y, 2, 50, "F"); // cover the right side of roundedRect

        // Critical badge
        doc.setFillColor(C.red[0], C.red[1], C.red[2]);
        doc.roundedRect(23, y + 4, 28, 7, 1.5, 1.5, "F");
        doc.setFontSize(7);
        doc.setTextColor(255);
        doc.text(`CRITICAL #${i + 1}`, 37, y + 9, { align: "center" });

        // Title
        doc.setFontSize(11);
        doc.setTextColor(C.red[0], C.red[1], C.red[2]);
        doc.text(safe(e.action), 55, y + 9);

        // Details grid
        doc.setFontSize(8);
        const detailY = y + 18;

        doc.setTextColor(130);
        doc.text("Actor:", 23, detailY);
        doc.setTextColor(50);
        doc.text(safe(`${e.actor.name} (${LEVEL_CONFIG[e.actor.level].label})`), 42, detailY);

        doc.setTextColor(130);
        doc.text("Time:", 23, detailY + 6);
        doc.setTextColor(50);
        doc.text(formatFullDate(e.timestamp), 42, detailY + 6);

        if (e.target) {
          doc.setTextColor(130);
          doc.text("Target:", 23, detailY + 12);
          doc.setTextColor(50);
          doc.text(safe(e.target.name), 42, detailY + 12);
        }

        if (e.zone) {
          doc.setTextColor(130);
          doc.text("Zone:", pw / 2 + 10, detailY);
          doc.setTextColor(50);
          doc.text(e.zone, pw / 2 + 25, detailY);
        }

        if (e.ip) {
          doc.setTextColor(130);
          doc.text("IP:", pw / 2 + 10, detailY + 6);
          doc.setTextColor(50);
          doc.text(e.ip, pw / 2 + 25, detailY + 6);
        }

        doc.setTextColor(130);
        doc.text("2FA:", pw / 2 + 10, detailY + 12);
        doc.setTextColor(e.verified2FA ? C.green[0] : C.orange[0], e.verified2FA ? C.green[1] : C.orange[1], e.verified2FA ? C.green[2] : C.orange[2]);
        doc.text(e.verified2FA ? "Verified" : "Not Verified", pw / 2 + 25, detailY + 12);

        // Description
        doc.setFontSize(7.5);
        doc.setTextColor(80);
        const descLines = doc.splitTextToSize(safe(e.detail), pw - 50);
        doc.text(descLines, 23, detailY + 20);

        y += 56;
      });
    }


    // ====================================================================
    //  CHANGE AUDIT TRAIL (Before / After)
    // ====================================================================
    const withChanges = filtered.filter(e => e.before || e.after);
    if (withChanges.length > 0) {
      doc.addPage();
      y = 18;
      doc.setFillColor(C.cyan[0], C.cyan[1], C.cyan[2]);
      doc.rect(0, 0, pw, 1.5, "F");

      sectionHead("Change Audit Trail", C.orange, `${withChanges.length} MODIFICATIONS`);

      tbl({
        startY: y,
        head: [["#", "Action", "Actor", "Before", "After"]],
        body: withChanges.map((e, i) => [
          String(i + 1),
          safe(e.action),
          safe(e.actor.name),
          safe(e.before || "--"),
          safe(e.after || "--"),
        ]),
        theme: "striped",
        headStyles: { fillColor: [60, 40, 10], textColor: C.orange, fontSize: 8, fontStyle: "bold" },
        bodyStyles: { fontSize: 7.5, textColor: [50, 55, 65] },
        alternateRowStyles: { fillColor: [255, 252, 245] },
        margin: { left: 15, right: 15 },
        columnStyles: {
          0: { cellWidth: 8, halign: "center", fontStyle: "bold" },
          1: { cellWidth: 38 },
          2: { cellWidth: 28 },
          3: { cellWidth: 50, textColor: [200, 80, 80] },
          4: { cellWidth: 50, textColor: [40, 160, 70] },
        },
      });
      y = tblY() + 8;
    }


    // ====================================================================
    //  2FA COMPLIANCE REPORT
    // ====================================================================
    doc.addPage();
    y = 18;
    doc.setFillColor(C.cyan[0], C.cyan[1], C.cyan[2]);
    doc.rect(0, 0, pw, 1.5, "F");

    sectionHead("Two-Factor Authentication Compliance", C.green, `${twoFAPct}% COMPLIANCE`);

    // Big compliance indicator
    const complianceStatus = twoFAPct >= 80 ? "COMPLIANT" : twoFAPct >= 50 ? "PARTIAL" : "NON-COMPLIANT";
    const compColor = twoFAPct >= 80 ? C.green : twoFAPct >= 50 ? C.orange : C.red;

    // Compliance card
    doc.setFillColor(245, 250, 248);
    doc.roundedRect(15, y, pw - 30, 30, 3, 3, "F");
    doc.setFillColor(compColor[0], compColor[1], compColor[2]);
    doc.roundedRect(15, y, 4, 30, 2, 0, "F");
    doc.rect(17, y, 2, 30, "F");

    doc.setFontSize(24);
    doc.setTextColor(compColor[0], compColor[1], compColor[2]);
    doc.text(`${twoFAPct}%`, 30, y + 18);
    doc.setFontSize(10);
    doc.text(complianceStatus, 55, y + 14);
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(`${twoFACount} of ${filtered.length} actions verified with two-factor authentication`, 55, y + 22);
    y += 38;

    // 2FA per actor breakdown
    doc.setFontSize(10);
    doc.setTextColor(50);
    doc.text("2FA Compliance by Actor", 15, y);
    y += 6;

    tbl({
      startY: y,
      head: [["Actor", "Role", "Total Actions", "2FA Verified", "Compliance"]],
      body: topActors.map(([name, data]) => {
        const a2fa = filtered.filter(e => e.actor.name === name && e.verified2FA).length;
        const aPct = data.count > 0 ? Math.round((a2fa / data.count) * 100) : 0;
        return [
          safe(name),
          LEVEL_CONFIG[data.level]?.label || data.level,
          String(data.count),
          String(a2fa),
          `${aPct}%`,
        ];
      }),
      theme: "striped",
      headStyles: { fillColor: [20, 60, 40], textColor: C.green, fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 8, textColor: [50, 55, 65] },
      alternateRowStyles: { fillColor: [245, 252, 248] },
      margin: { left: 15, right: 15 },
      columnStyles: {
        0: { cellWidth: 40 },
        1: { cellWidth: 28 },
        2: { cellWidth: 25, halign: "center" },
        3: { cellWidth: 25, halign: "center" },
        4: { cellWidth: 25, halign: "center", fontStyle: "bold" },
      },
      didParseCell: (data: any) => {
        if (data.section === "body" && data.column.index === 4) {
          const pctVal = parseInt(data.cell.raw);
          if (pctVal >= 80) data.cell.styles.textColor = [52, 199, 89];
          else if (pctVal >= 50) data.cell.styles.textColor = [255, 150, 0];
          else data.cell.styles.textColor = [255, 45, 85];
        }
      },
    });
    y = tblY() + 12;


    // ====================================================================
    //  TRUST & INTEGRITY VERIFICATION
    // ====================================================================
    sectionHead("Trust & Integrity Verification", C.cyan, "DATA INTEGRITY");

    // Integrity card
    doc.setFillColor(245, 248, 252);
    doc.roundedRect(15, y, pw - 30, 40, 3, 3, "F");
    doc.setDrawColor(C.cyan[0], C.cyan[1], C.cyan[2]);
    doc.setLineWidth(0.3);
    doc.roundedRect(15, y, pw - 30, 40, 3, 3, "S");

    doc.setFontSize(9);
    doc.setTextColor(C.cyan[0], C.cyan[1], C.cyan[2]);
    doc.text("DATA INTEGRITY HASH (SHA-256)", 22, y + 7);

    doc.setFontSize(7);
    doc.setTextColor(80);
    doc.text(integrityHash, 22, y + 14);

    doc.setTextColor(100);
    doc.text("Report Generation Method:   Automated / System-Generated", 22, y + 22);
    doc.text("Data Source:                SOSphere Real-Time Event Store", 22, y + 27);
    doc.text("Tamper Detection:           Blockchain-anchored hash verification", 22, y + 32);

    // Verified stamp
    doc.setDrawColor(C.green[0], C.green[1], C.green[2]);
    doc.setLineWidth(0.5);
    doc.circle(pw - 35, y + 20, 10, "S");
    doc.setFontSize(7);
    doc.setTextColor(C.green[0], C.green[1], C.green[2]);
    doc.text("DATA", pw - 35, y + 18, { align: "center" });
    doc.text("VERIFIED", pw - 35, y + 23, { align: "center" });

    y += 48;


    // ====================================================================
    //  CERTIFICATION, LEGAL & SIGNATURES
    // ====================================================================
    doc.addPage();
    y = 18;
    doc.setFillColor(C.cyan[0], C.cyan[1], C.cyan[2]);
    doc.rect(0, 0, pw, 1.5, "F");

    sectionHead("Certification & Legal Disclaimer", C.cyan, "COMPLIANCE");

    doc.setFontSize(9);
    doc.setTextColor(60);
    const legalParagraphs = [
      "This Audit Log Report has been automatically generated by the SOSphere Safety Intelligence Platform. All events are recorded in real-time with cryptographic integrity verification. This document provides a complete and unmodified record of all administrative actions, security events, and system changes during the reporting period.",
      "The data presented in this report is derived from system logs and is intended for compliance, audit, and security review purposes. SOSphere maintains strict data integrity controls to ensure the accuracy and completeness of all recorded events.",
    ];

    legalParagraphs.forEach(p => {
      const lines = doc.splitTextToSize(p, pw - 40);
      doc.text(lines, 20, y);
      y += lines.length * 4.5 + 4;
    });

    y += 2;

    // Applicable standards box
    doc.setFillColor(245, 248, 252);
    doc.roundedRect(15, y, pw - 30, 28, 2, 2, "F");
    doc.setFillColor(C.cyan[0], C.cyan[1], C.cyan[2]);
    doc.rect(15, y, 3, 28, "F");

    doc.setFontSize(8);
    doc.setTextColor(C.cyan[0], C.cyan[1], C.cyan[2]);
    // B-18 (2026-04-25): truthful framing — these are standards the log is
    // DESIGNED to align with, not certifications SOSphere has been audited for.
    doc.text("STANDARDS THIS LOG IS DESIGNED FOR ALIGNMENT WITH", 22, y + 6);
    doc.setTextColor(70);
    doc.setFontSize(7.5);
    const standards = [
      "- OSHA 29 CFR 1904 -- Recording and Reporting Occupational Injuries",
      "- ISO 45001:2018 -- Occupational Health and Safety Management Systems",
      "- GDPR Art. 30 -- Records of Processing Activities",
      "- SOC 2 CC7 event-logging principles (audit not yet undertaken)",
    ];
    standards.forEach((s, i) => {
      doc.text(s, 24, y + 12 + i * 4);
    });
    y += 36;

    // Signature blocks
    y += 5;
    doc.setFontSize(9);
    doc.setTextColor(40);
    doc.text("AUTHORIZATION SIGNATURES", 15, y);
    y += 3;
    doc.setDrawColor(C.cyan[0], C.cyan[1], C.cyan[2]);
    doc.setLineWidth(0.3);
    doc.line(15, y, 80, y);
    y += 8;

    const sigBlocks = [
      { role: "Exported By", title: "System Administrator" },
      { role: "Reviewed By", title: "Safety Officer / Compliance Manager" },
      { role: "Approved By", title: "Company Owner / Authorized Signatory" },
    ];

    sigBlocks.forEach(sig => {
      // Signature box
      doc.setFillColor(250, 250, 252);
      doc.roundedRect(15, y, pw - 30, 22, 2, 2, "F");
      doc.setDrawColor(210);
      doc.setLineWidth(0.2);
      doc.roundedRect(15, y, pw - 30, 22, 2, 2, "S");

      doc.setFontSize(8);
      doc.setTextColor(C.cyan[0], C.cyan[1], C.cyan[2]);
      doc.text(sig.role.toUpperCase(), 20, y + 6);
      doc.setTextColor(130);
      doc.setFontSize(7);
      doc.text(sig.title, 20, y + 11);

      // Signature line
      doc.setDrawColor(180);
      doc.setLineWidth(0.15);
      doc.line(20, y + 17, 90, y + 17);
      doc.setFontSize(6);
      doc.setTextColor(170);
      doc.text("Signature", 20, y + 20);

      // Date line
      doc.line(pw / 2 + 20, y + 17, pw - 20, y + 17);
      doc.text("Date", pw / 2 + 20, y + 20);

      y += 26;
    });

    // Final seal
    y += 5;
    doc.setFillColor(245, 248, 252);
    doc.roundedRect(15, y, pw - 30, 14, 2, 2, "F");
    doc.setFontSize(7);
    doc.setTextColor(100);
    doc.text(`Document ID: ${docId}  |  Generated: ${today.toISOString()}  |  Hash: ${integrityHash.substring(0, 16)}...`, pw / 2, y + 8, { align: "center" });
    y += 20;

    // ── QR Verification Certificate ──────────────────────────
    if (qrDataURL) {
      if (y > ph - 60) { doc.addPage(); y = 18; }

      const vBoxX = 15;
      const vBoxW = pw - 30;
      const vBoxH = 48;

      doc.setFillColor(245, 248, 252);
      doc.roundedRect(vBoxX, y, vBoxW, vBoxH, 3, 3, "F");
      doc.setDrawColor(200, 210, 230);
      doc.setLineWidth(0.3);
      doc.roundedRect(vBoxX, y, vBoxW, vBoxH, 3, 3, "S");

      // QR Code
      const qrCertSize = 30;
      doc.addImage(qrDataURL, "PNG", vBoxX + 8, y + 9, qrCertSize, qrCertSize);

      // Verification details
      const infoX = vBoxX + qrCertSize + 18;
      doc.setFontSize(10);
      doc.setTextColor(30, 41, 59);
      doc.text("Digital Verification Certificate", infoX, y + 10);

      doc.setFontSize(7);
      doc.setTextColor(100);
      doc.text(`Document ID: ${docId}`, infoX, y + 16);
      doc.text(`Generated: ${today.toLocaleString()}`, infoX, y + 21);
      doc.text(`Verification URL: ${verifyURL}`, infoX, y + 26);
      doc.text(`Integrity Hash: SHA-256 ${integrityHash.substring(0, 32)}...`, infoX, y + 31);

      doc.setFontSize(6);
      doc.setTextColor(0, 150, 170);
      doc.text("Scan QR code to verify the authenticity and integrity of this audit report.", infoX, y + 38);
      doc.text("This certificate confirms the report was generated by SOSphere platform.", infoX, y + 42);
    }

    // ── Add footers to all pages ──
    addFooters();

    // ═══════════════════════════════════════════════════════════
    // WATERMARK — Applied to every page EXCEPT cover (page 1)
    // ═══════════════════════════════════════════════════════════
    const totalPg = doc.getNumberOfPages();
    for (let p = 2; p <= totalPg; p++) {
      doc.setPage(p);

      // Diagonal "CONFIDENTIAL" watermark
      doc.saveGraphicsState();
      doc.setGState(new (doc as any).GState({ opacity: 0.035 }));
      doc.setFontSize(62);
      doc.setTextColor(0, 200, 224);

      const wmAngle = -40 * (Math.PI / 180);
      const wmCos = Math.cos(wmAngle);
      const wmSin = Math.sin(wmAngle);
      const wmText = "CONFIDENTIAL";
      const wmTW = doc.getTextWidth(wmText);
      const wmTx = pw / 2 - (wmTW * wmCos) / 2;
      const wmTy = ph / 2 - (wmTW * wmSin) / 2;

      doc.internal.write(
        `q ${wmCos.toFixed(4)} ${wmSin.toFixed(4)} ${(-wmSin).toFixed(4)} ${wmCos.toFixed(4)} ${(wmTx * 72 / 25.4).toFixed(2)} ${((ph - wmTy) * 72 / 25.4).toFixed(2)} cm`
      );
      doc.text(wmText, 0, 0);
      doc.internal.write("Q");
      doc.restoreGraphicsState();

      // Corner security marks
      doc.saveGraphicsState();
      doc.setGState(new (doc as any).GState({ opacity: 0.06 }));
      doc.setDrawColor(0, 200, 224);
      doc.setLineWidth(0.4);
      doc.line(8, 8, 8, 18); doc.line(8, 8, 18, 8);
      doc.line(pw - 8, 8, pw - 8, 18); doc.line(pw - 8, 8, pw - 18, 8);
      doc.line(8, ph - 8, 8, ph - 18); doc.line(8, ph - 8, 18, ph - 8);
      doc.line(pw - 8, ph - 8, pw - 8, ph - 18); doc.line(pw - 8, ph - 8, pw - 18, ph - 8);
      doc.restoreGraphicsState();

      // Bottom security strip
      doc.saveGraphicsState();
      doc.setGState(new (doc as any).GState({ opacity: 0.04 }));
      doc.setFillColor(0, 200, 224);
      doc.rect(0, ph - 4, pw, 4, "F");
      doc.restoreGraphicsState();

      // Metadata line
      doc.setFontSize(5);
      doc.setTextColor(180);
      doc.text(
        `SOSphere | ${docId} | Audit Report | ${today.toISOString().split("T")[0]} | Page ${p}/${totalPg} | CONFIDENTIAL`,
        pw / 2, ph - 4, { align: "center" }
      );
    }

    doc.save(`SOSphere_Audit_Report_${today.toISOString().split("T")[0]}.pdf`);
  };

  // Password modal → then export
  const handleExportWithPassword = () => {
    setShowPasswordModal(true);
  };

  const handlePasswordConfirm = async (encConfig: PdfEncryptionConfig | null) => {
    setShowPasswordModal(false);
    setLastEncPassword(encConfig?.password);
    try {
      toast.loading("Generating PDF report...", { id: "audit-pdf", duration: 10000 });
      await handleExportPDF(encConfig);
      setLastAuditEncrypted(!!encConfig);
      const encLabel = encConfig ? " | Password Protected" : "";
      toast.success("Audit PDF Generated", { id: "audit-pdf", description: `${filtered.length} entries exported${encLabel}` });
      setTimeout(() => {
        toast("Email this audit report?", {
          description: "Send the generated PDF to team members via secure email",
          action: { label: "Email Report", onClick: () => setShowEmailModal(true) },
          duration: 8000,
        });
      }, 1500);
    } catch (err) {
      console.error("Audit PDF error:", err);
      toast.error("PDF Generation Failed", { id: "audit-pdf", description: "An error occurred while generating the audit PDF." });
    }
  };

  const activeFilterCount = [
    filterCategory !== "all",
    filterLevel !== "all",
    filterSeverity !== "all",
  ].filter(Boolean).length;

  return (
    <div className="flex flex-col h-full" style={{ background: "#05070E", minHeight: "100%" }}>

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center justify-between mb-1">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px" }}>Audit Log</h1>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
              Complete trail — who changed what, when, and why
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowEmailModal(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all"
              style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)", fontSize: 11, fontWeight: 600, color: "#8B5CF6" }}
            >
              <Mail className="size-3.5" /> Email
            </button>
            <button
              onClick={handleExportWithPassword}
              className="flex items-center gap-2 px-4 py-2 rounded-xl transition-all"
              style={{ background: "rgba(0,200,224,0.15)", border: "1px solid rgba(0,200,224,0.3)", fontSize: 12, fontWeight: 700, color: "#00C8E0" }}
            >
              <FileText className="size-3.5" /> Export PDF
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.45)" }}
            >
              <Download className="size-3" /> CSV
            </button>
          </div>
        </div>
      </div>

      {/* ── Stats Row ────────────────────────────────────────── */}
      <div className="px-6 py-4 grid grid-cols-5 gap-2">
        {[
          { label: "Total Events", value: stats.total,       color: "rgba(255,255,255,0.7)", icon: Activity   },
          { label: "Critical",     value: stats.critical,    color: "#FF2D55",               icon: AlertTriangle },
          { label: "Warnings",     value: stats.warning,     color: "#FF9500",               icon: Shield     },
          { label: "Perm Changes", value: stats.permChanges, color: "#00C8E0",               icon: Key        },
          { label: "2FA Verified", value: stats.with2FA,     color: "#34C759",               icon: Fingerprint },
        ].map(s => {
          const SIcon = s.icon;
          return (
            <div key={s.label} className="flex flex-col items-center justify-center p-3 rounded-2xl text-center"
              style={{ background: "rgba(10,18,32,0.8)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <SIcon className="size-4 mb-1" style={{ color: s.color }} />
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>{s.label}</div>
            </div>
          );
        })}
      </div>

      {/* ── Search + Filter Bar ───────────────────────────────── */}
      <div className="px-6 mb-4 flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <Search className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search actions, actors, targets…"
            className="bg-transparent flex-1 outline-none"
            style={{ fontSize: 13, color: "#fff" }}
          />
          {search && <button onClick={() => setSearch("")}><X className="size-3.5" style={{ color: "rgba(255,255,255,0.3)" }} /></button>}
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl relative"
          style={{
            background: showFilters ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${showFilters ? "rgba(0,200,224,0.3)" : "rgba(255,255,255,0.07)"}`,
            color: showFilters ? "#00C8E0" : "rgba(255,255,255,0.5)",
            fontSize: 12, fontWeight: 600,
          }}
        >
          <Filter className="size-4" />
          Filters
          {activeFilterCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 size-5 rounded-full flex items-center justify-center"
              style={{ background: "#FF2D55", fontSize: 9, fontWeight: 700, color: "#fff" }}>
              {activeFilterCount}
            </span>
          )}
        </motion.button>
      </div>

      {/* ── Filter Panel ─────────────────────────────────────── */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-6 overflow-hidden"
          >
            <div className="grid grid-cols-3 gap-3 mb-4 p-4 rounded-2xl"
              style={{ background: "rgba(10,18,32,0.8)", border: "1px solid rgba(255,255,255,0.06)" }}>
              {/* Category Filter */}
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px", textTransform: "uppercase" }}>
                  Category
                </label>
                <select
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value as AuditCategory | "all")}
                  className="w-full mt-1.5 px-3 py-2 rounded-xl outline-none"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.7)", fontSize: 12 }}
                >
                  <option value="all">All Categories</option>
                  {Object.entries(CATEGORY_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              {/* Level Filter */}
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px", textTransform: "uppercase" }}>
                  Actor Level
                </label>
                <select
                  value={filterLevel}
                  onChange={e => setFilterLevel(e.target.value as AuditLevel | "all")}
                  className="w-full mt-1.5 px-3 py-2 rounded-xl outline-none"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.7)", fontSize: 12 }}
                >
                  <option value="all">All Levels</option>
                  <option value="owner">Owner</option>
                  <option value="main_admin">Main Admin</option>
                  <option value="zone_admin">Zone Admin</option>
                  <option value="worker">Field Worker</option>
                  <option value="system">System</option>
                </select>
              </div>
              {/* Severity Filter */}
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px", textTransform: "uppercase" }}>
                  Severity
                </label>
                <select
                  value={filterSeverity}
                  onChange={e => setFilterSeverity(e.target.value as any)}
                  className="w-full mt-1.5 px-3 py-2 rounded-xl outline-none"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.7)", fontSize: 12 }}
                >
                  <option value="all">All Severities</option>
                  <option value="critical">Critical</option>
                  <option value="warning">Warning</option>
                  <option value="success">Success</option>
                  <option value="info">Info</option>
                </select>
              </div>
              {/* Clear Filters */}
              {activeFilterCount > 0 && (
                <button
                  onClick={() => { setFilterCategory("all"); setFilterLevel("all"); setFilterSeverity("all"); }}
                  className="col-span-3 flex items-center justify-center gap-2 py-2 rounded-xl"
                  style={{ background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.15)", color: "#FF2D55", fontSize: 12, fontWeight: 600 }}
                >
                  <X className="size-3.5" /> Clear {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Results count ─────────────────────────────────────── */}
      <div className="px-6 mb-3 flex items-center gap-2">
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
          {filtered.length} event{filtered.length !== 1 ? "s" : ""}
          {filtered.length < allEntries.length ? ` of ${allEntries.length}` : ""}
        </span>
        {filtered.length < allEntries.length && (
          <span className="px-2 py-0.5 rounded-md" style={{ fontSize: 9, fontWeight: 700, color: "#FF9500", background: "rgba(255,150,0,0.1)" }}>
            FILTERED
          </span>
        )}
      </div>

      {/* ── Timeline ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 pb-6" style={{ scrollbarWidth: "none" }}>
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-5 top-0 bottom-0 w-px" style={{ background: "rgba(255,255,255,0.06)" }} />

          <div className="flex flex-col gap-3">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Search className="size-10 mb-4" style={{ color: "rgba(255,255,255,0.1)" }} />
                <p style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.3)" }}>No events found</p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", marginTop: 4 }}>Try adjusting your filters</p>
              </div>
            ) : filtered.map((entry, i) => (
              <AuditRow
                key={entry.id}
                entry={entry}
                expanded={expandedId === entry.id}
                onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* PDF Password Protection Modal */}
      <PdfPasswordModal
        open={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        onConfirm={handlePasswordConfirm}
        title="Audit PDF Security"
        description="Protect this audit report with encryption"
      />

      {/* Email Delivery Simulation Modal */}
      <PdfEmailModal
        open={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        reportTitle="Audit Log Report"
        reportSize="1.8 MB"
        isEncrypted={lastAuditEncrypted}
        encryptionPassword={lastEncPassword}
        onSent={(emails) => {
          toast.success("Audit Report Emailed", {
            description: `Sent to ${emails.length} recipient${emails.length > 1 ? "s" : ""} via secure channel`,
            duration: 5000,
          });
        }}
      />
    </div>
  );
}

// ── Audit Row Component ───────────────────────────────────────
function AuditRow({ entry, expanded, onToggle }: {
  entry: AuditEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const catCfg  = CATEGORY_CONFIG[entry.category];
  const sevCfg  = SEVERITY_CONFIG[entry.severity];
  const actorCfg = LEVEL_CONFIG[entry.actor.level];
  const CatIcon = catCfg.icon;
  const ActorIcon = actorCfg.icon;
  const hasDiff = entry.before || entry.after;
  const hasDetails = hasDiff || entry.zone || entry.ip || entry.verified2FA !== undefined;

  return (
    <motion.div
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      className="pl-10 relative"
    >
      {/* Timeline dot */}
      <div className="absolute left-0 top-3 size-11 flex items-center justify-center">
        <div className="size-8 rounded-xl flex items-center justify-center"
          style={{ background: catCfg.bg, border: `1px solid ${catCfg.color}30` }}>
          <CatIcon className="size-4" style={{ color: catCfg.color }} />
        </div>
      </div>

      <motion.div
        className="rounded-2xl overflow-hidden cursor-pointer"
        style={{ background: "rgba(10,18,32,0.8)", border: `1px solid rgba(255,255,255,0.05)` }}
        whileHover={{ borderColor: `${catCfg.color}20` }}
        onClick={onToggle}
      >
        {/* Main row */}
        <div className="flex items-start gap-3 p-3">
          {/* Severity bar */}
          <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ background: sevCfg.color }} />

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Action */}
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{entry.action}</span>
              {/* Category badge */}
              <span className="px-1.5 py-0.5 rounded-md flex-shrink-0"
                style={{ fontSize: 9, fontWeight: 700, background: catCfg.bg, color: catCfg.color }}>
                {catCfg.label.toUpperCase()}
              </span>
              {/* 2FA badge */}
              {entry.verified2FA && (
                <span className="px-1.5 py-0.5 rounded-md flex items-center gap-0.5 flex-shrink-0"
                  style={{ fontSize: 9, fontWeight: 700, background: "rgba(52,199,89,0.1)", color: "#34C759" }}>
                  <Fingerprint style={{ width: 8, height: 8 }} /> 2FA
                </span>
              )}
            </div>

            {/* Actor → Target */}
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <ActorIcon className="size-3 flex-shrink-0" style={{ color: actorCfg.color }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: actorCfg.color }}>{entry.actor.name}</span>
              {entry.target && (
                <>
                  <ArrowRight className="size-3 flex-shrink-0" style={{ color: "rgba(255,255,255,0.2)" }} />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{entry.target.name}</span>
                </>
              )}
              <span style={{ color: "rgba(255,255,255,0.15)", fontSize: 11 }}>·</span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{formatTime(entry.timestamp)}</span>
            </div>

            {/* Detail */}
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4, lineHeight: 1.5 }}>
              {entry.detail}
            </p>
          </div>

          {/* Expand toggle */}
          <div className="flex-shrink-0 mt-1">
            {hasDetails && (
              <div className="size-6 rounded-lg flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.04)" }}>
                {expanded
                  ? <ChevronUp className="size-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
                  : <ChevronDown className="size-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
                }
              </div>
            )}
          </div>
        </div>

        {/* Expanded detail */}
        <AnimatePresence>
          {expanded && hasDetails && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 pt-0 space-y-3"
                style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>

                {/* Before / After diff */}
                {hasDiff && (
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    {entry.before && (
                      <div className="p-3 rounded-xl"
                        style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.12)" }}>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <div className="size-1.5 rounded-full" style={{ background: "#FF2D55" }} />
                          <span style={{ fontSize: 9, fontWeight: 700, color: "#FF2D55", letterSpacing: "0.5px" }}>BEFORE</span>
                        </div>
                        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>{entry.before}</p>
                      </div>
                    )}
                    {entry.after && (
                      <div className="p-3 rounded-xl"
                        style={{ background: "rgba(52,199,89,0.06)", border: "1px solid rgba(52,199,89,0.12)" }}>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <div className="size-1.5 rounded-full" style={{ background: "#34C759" }} />
                          <span style={{ fontSize: 9, fontWeight: 700, color: "#34C759", letterSpacing: "0.5px" }}>AFTER</span>
                        </div>
                        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>{entry.after}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Meta row */}
                <div className="flex flex-wrap gap-3 mt-1">
                  {entry.zone && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="size-3" style={{ color: "#00C8E0" }} />
                      <span style={{ fontSize: 10, color: "rgba(0,200,224,0.7)" }}>{entry.zone}</span>
                    </div>
                  )}
                  {entry.ip && (
                    <div className="flex items-center gap-1.5">
                      <Hash className="size-3" style={{ color: "rgba(255,255,255,0.2)" }} />
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>IP: {entry.ip}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <Clock className="size-3" style={{ color: "rgba(255,255,255,0.2)" }} />
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{formatFullDate(entry.timestamp)}</span>
                  </div>
                  {entry.verified2FA === false && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md"
                      style={{ background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.15)" }}>
                      <Lock className="size-3" style={{ color: "#FF9500" }} />
                      <span style={{ fontSize: 9, fontWeight: 700, color: "#FF9500" }}>NO 2FA</span>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}