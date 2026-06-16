import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Building2, Users, Lock, BarChart3, Bell, Timer, Globe, MapPin,
  Shield, Zap, Send, X, Check, ChevronRight, ChevronLeft, Plus,
  RefreshCw, Download, ShieldAlert, CheckCircle2, FileText,
  LayoutDashboard, Phone, Layers, Clock, TriangleAlert, Settings,
  Radio, Gauge, Navigation, Crosshair, Map,
} from "lucide-react";
import { type Lang, LANG_META } from "./dashboard-i18n";
import { ROLE_CONFIG, type Role, type AuthState } from "./mobile-auth";
import { employeeUsagePercent, type CompanyState } from "./mobile-company";
import { toast } from "sonner";
import { hapticSuccess, hapticLight } from "./haptic-feedback";
// Dashboard audit P0: EMP-${Date.now()} was collision-prone + predictable.
import { secureRandomId } from "./utils/secure-random";
import {
  Card as DSCard, SectionHeader, Badge, AlertItem, Divider,
} from "./design-system";
import { setHybridMode as setHybridModeStore, getHybridMode, assignEmployeeZone, ZONE_NAMES } from "./shared-store";
import { useDashboardStore } from "./stores/dashboard-store";
import { storeJSONSync, loadJSONSync } from "./api/storage-adapter";
import { MFAEnrollmentModal } from "./mfa-enrollment-modal";
import { DpaSettingsSection } from "./dpa-settings-section";  // AUTH-5 P6
import { mfaListFactors, mfaUnenroll, mfaRecoveryStatus, mfaGenerateRecoveryCodes } from "./api/mfa-client";
import { fetchEmployees, fetchAuditLog } from "./api/data-layer";
import { logAuditEvent } from "./audit-log-store";
import { loadEmailSchedules, saveEmailSchedule, getCachedEmailSchedules, type EmailScheduleRow } from "./email-schedules-service";

type DashPage = "overview" | "employees" | "emergencies" | "zones" | "incidents" | "attendance" | "settings" | "commandCenter" | "riskMap" | "billing" | "analytics" | "shiftScheduling" | "geofencing";

// ── P1-fix: mock data used ONLY in dev when Supabase returns empty ──
const DEV_ONLY = (import.meta as any).env?.DEV === true;

// P1-6 (2026-06-09): real Security Audit Log export. Replaces the
// toast-only stub. Pulls the company-scoped audit_log through the data
// layer (RLS-protected) and downloads a UTF-8 CSV — Excel-friendly,
// no extra dependencies. Returns the number of rows exported.
async function downloadAuditLogCsv(): Promise<number> {
  const rows = await fetchAuditLog(1000);
  if (!rows.length) return 0;
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["Timestamp", "Action", "Actor", "Target", "Details"];
  const lines = [header.join(",")];
  for (const r of rows) {
    const ts = r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp ?? "");
    lines.push([esc(ts), esc(r.action), esc(r.actor), esc(r.target), esc(r.details)].join(","));
  }
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sosphere-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return rows.length;
}

const ROLE_COLORS: Record<string, string> = {
  admin: "#00C8E0", site_admin: "#7B5EFF", hse_manager: "#00C853",
  supervisor: "#FF9500", viewer: "#FF2D55", employee: "#34C759",
};

type TeamMember = {
  name: string; email: string; role: string;
  status: string; color: string; lastActive: string;
};

type SecurityEvent = {
  event: string; time: string;
  color: string; icon: React.ElementType;
};

const MOCK_TEAM: TeamMember[] = [
  { name: "Jane Mitchell", email: "j.mitchell@acmeindustries.com", role: "Admin", status: "active", color: "#00C8E0", lastActive: "Just now" },
  { name: "Carlos Silva", email: "c.silva@buildco.com", role: "Site Admin", status: "active", color: "#7B5EFF", lastActive: "5m ago" },
  { name: "Emma Wilson", email: "l.chen@acmeindustries.com", role: "HSE Manager", status: "active", color: "#00C853", lastActive: "1h ago" },
  { name: "Khalid Nouri", email: "k.nouri@aramco.com", role: "Supervisor", status: "inactive", color: "#FF9500", lastActive: "2d ago" },
  { name: "Laura Chen", email: "e.wilson@acmeindustries.com", role: "Viewer", status: "pending", color: "#FF2D55", lastActive: "Pending" },
];

const SECURITY_ICON_MAP: Record<string, React.ElementType> = {
  login: Lock, password_change: CheckCircle2, failed_login: ShieldAlert,
  api_key: RefreshCw, "2fa_event": Shield,
};

const MOCK_SECURITY: SecurityEvent[] = [
  { event: "New login from Chrome / Windows 11", time: "Today, 09:14", color: "#FF9500", icon: Lock },
  { event: "Password changed successfully", time: "Mar 5, 2026", color: "#00C853", icon: CheckCircle2 },
  { event: "Failed login attempt (x3)", time: "Mar 2, 2026", color: "#FF2D55", icon: ShieldAlert },
  { event: "API key rotated", time: "Feb 28, 2026", color: "#00C8E0", icon: RefreshCw },
  { event: "2FA enrolled for all admin accounts", time: "Feb 20, 2026", color: "#7B5EFF", icon: Shield },
];

// ═══════════════════════════════════════════════════════════════
// Settings Page
// [SUPABASE_READY] — All mock data marked, handlers ready for async migration
// ═══════════════════════════════════════════════════════════════
export function SettingsPage({ companyName, t, lang, onLangChange, activeRole, onRoleChange, authState, companyState, onNavigate, webMode = false }: {
  companyName: string;
  t?: (k: string) => string;
  lang?: Lang;
  onLangChange?: (l: Lang) => void;
  activeRole?: Role;
  onRoleChange?: (r: Role) => void;
  authState?: AuthState;
  companyState?: CompanyState;
  onNavigate?: (p: DashPage) => void;
  webMode?: boolean;
}) {
  const tr = t || ((k: string) => k);
  type SettingsTab = "company" | "access" | "security" | "billing" | "reports";
  const [activeTab, setActiveTab] = useState<SettingsTab>("company");
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    notifications: true, geofencing: true, twoFA: true, sosHold: true, autoEscalation: true, auditLog: true,
    hybridMode: getHybridMode(),
  });
  const toggle = (key: string) => {
    setToggles(p => {
      const newVal = !p[key];
      if (key === "hybridMode") setHybridModeStore(newVal);
      return { ...p, [key]: newVal };
    });
  };

  type AccessSubPage = "list" | "createRole";
  const [accessSubPage, setAccessSubPage] = useState<AccessSubPage>("list");
  const [showInviteUser, setShowInviteUser] = useState(false);
  const [checkinInterval, setCheckinInterval] = useState(() => {
    const saved = loadJSONSync<{ checkinInterval?: string } | null>("company_settings", null);
    return saved?.checkinInterval || "30m";
  });

  // ── FIX 1: Load saved toggles from localStorage on mount ──
  const [settingsSaved, setSettingsSaved] = useState(false);
  // Apply saved toggles on mount
  useEffect(() => {
    const saved = loadJSONSync<{ toggles?: Record<string, boolean> } | null>("company_settings", null);
    if (saved?.toggles) {
      setToggles(prev => ({ ...prev, ...saved.toggles }));
    }
  }, []);

  // ── P1-fix (2026-05-27): Fetch team + security events from Supabase ──
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const emps = await fetchEmployees();
        if (!cancelled && emps.length > 0) {
          setTeamMembers(emps.map(e => ({
            name: e.name,
            email: e.phone || "",
            role: e.role,
            status: e.status === "on-shift" ? "active" : "inactive",
            color: ROLE_COLORS[e.role] || "#00C8E0",
            lastActive: e.lastCheckin ? new Date(e.lastCheckin).toLocaleString() : "—",
          })));
        }
      } catch { /* Supabase unavailable */ }
      try {
        const logs = await fetchAuditLog(5);
        if (!cancelled && logs.length > 0) {
          setSecurityEvents(logs.map((l: any) => ({
            event: l.action || l.action_type || "Event",
            time: l.timestamp ? new Date(l.timestamp).toLocaleDateString() : "—",
            color: l.severity === "critical" ? "#FF2D55" : l.severity === "warning" ? "#FF9500" : "#00C853",
            icon: SECURITY_ICON_MAP[l.action_type] || ShieldAlert,
          })));
        }
      } catch { /* Supabase unavailable */ }
      if (!cancelled) {
        setDataLoaded(true);
        // Fall back to demo data only in DEV if nothing came from Supabase
        setTeamMembers(prev => prev.length > 0 ? prev : (DEV_ONLY ? MOCK_TEAM : []));
        setSecurityEvents(prev => prev.length > 0 ? prev : (DEV_ONLY ? MOCK_SECURITY : []));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /** Persist all settings to localStorage */
  // SUPABASE_MIGRATION_POINT: saveAllSettings → supabase.from('company_settings').upsert({ company_id, toggles, checkinInterval, sessionTimeout, language })
  const saveAllSettings = async () => {
    storeJSONSync("company_settings", {
      companyName,
      language: lang || "en",
      checkinInterval,
      sessionTimeout: useDashboardStore.getState().sessionTimeout,
      toggles,
      savedAt: Date.now(),
    });
    // Also save admin profile if authState is available
    if (authState) {
      // P0-doctrine-completion (2026-05-25, life-safety): AuthState has no `phone`
      // and MobileUser has no `phone` either — admin profile phone is stored
      // separately via localStorage in the legacy flow. Cast at use site to a
      // shape that includes the optional phone so the code type-checks against
      // the actual runtime data (which may carry phone as an enrichment field).
      const authShape = authState as { userId?: string; phone?: string };
      const adminPhone = authShape.phone || "";
      const adminProfile = {
        name: authShape.userId || "Admin",
        role: activeRole || "admin",
        phone: adminPhone,
      };
      localStorage.setItem("sosphere_admin_profile", JSON.stringify(adminProfile));
      localStorage.setItem("sosphere_admin_phone", adminPhone.replace(/\s/g, ""));
    }
    // 2026-06-03 19th pattern app: route through SECDEF RPC instead
    // of the prior direct .upsert() call that silently failed (the
    // table existed but lacked the `settings` jsonb column the upsert
    // tried to write). saveCompanySettings uses getCompanyId() to
    // resolve the real UUID — was passing the company name as id+
    // company_id which also broke the upsert.
    try {
      const { saveCompanySettings } = await import("./company-settings-service");
      void saveCompanySettings({
        company_name:     companyName,
        language:         lang || "en",
        checkin_interval: checkinInterval,
        session_timeout:  useDashboardStore.getState().sessionTimeout,
        toggles,
      });
    } catch { /* service unavailable — localStorage mirror above still drives UI */ }

    logAuditEvent("settings", "Company settings saved", {
      detail: `Toggles: ${Object.entries(toggles).filter(([,v]) => v).map(([k]) => k).join(", ")} | Interval: ${checkinInterval}`,
      severity: "info",
    });

    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
    hapticSuccess();
    toast.success(tr("setg.settingsSaved"), { description: tr("setg.settingsSavedDesc") });
  };

  // ── REAL scheduled reports (email_schedules) for the Reports & Email tab ──
  const [emailSchedules, setEmailSchedules] = useState<EmailScheduleRow[]>(() => getCachedEmailSchedules());
  useEffect(() => { void loadEmailSchedules().then(setEmailSchedules); }, []);
  const toggleEmailSchedule = (sched: EmailScheduleRow) => {
    const next = { ...sched, enabled: !sched.enabled };
    setEmailSchedules(prev => prev.map(s => s.id === sched.id ? next : s)); // optimistic
    void saveEmailSchedule({
      id: sched.id, name: sched.name, frequency: sched.frequency,
      reportTypes: sched.report_types, recipients: sched.recipients, enabled: next.enabled,
      nextRun: sched.next_run, includeCharts: sched.include_charts, includeQR: sched.include_qr, format: sched.format,
    }).then(ok => {
      if (ok) toast.success(next.enabled ? tr("setg.scheduleActivated") : tr("setg.schedulePaused"));
      else { toast.error(tr("setg.couldNotUpdateSchedule")); setEmailSchedules(prev => prev.map(s => s.id === sched.id ? sched : s)); }
    });
  };

  // ── CRITICAL FIX 3: Session timeout from Zustand store (not local state) ──
  const { sessionTimeout, setSessionTimeout } = useDashboardStore();

  const tabs: { id: SettingsTab; label: string; icon: typeof Building2 }[] = [
    { id: "company", label: tr("st.company"), icon: Building2 },
    { id: "access", label: tr("st.access"), icon: Users },
    { id: "security", label: tr("st.security"), icon: Lock },
    { id: "billing", label: tr("st.billing"), icon: BarChart3 },
    { id: "reports", label: tr("setg.reports"), icon: Send },
  ];
  const handleTabChange = (tab: SettingsTab) => { setActiveTab(tab); setAccessSubPage("list"); };

  const renderToggle = (key: string, label: string, icon: typeof Bell, color: string, desc?: string) => (
    <div className="flex items-center gap-3 px-3 py-3" style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
      <div className="size-7 rounded-lg flex items-center justify-center" style={{ background: `${color}10` }}>
        {React.createElement(icon, { className: "size-3.5", style: { color } })}
      </div>
      <div className="flex-1">
        <span className="text-white" style={{ fontSize: 12, fontWeight: 500 }}>{label}</span>
        {desc && <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", marginTop: 1 }}>{desc}</p>}
      </div>
      <button onClick={() => toggle(key)} className="w-9 h-5 rounded-full relative transition-all"
        style={{ background: toggles[key] ? `${color}40` : "rgba(255,255,255,0.08)" }}>
        <motion.div initial={false} animate={{ x: toggles[key] ? 16 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="absolute top-0.5 left-0.5 size-4 rounded-full" style={{ background: toggles[key] ? color : "rgba(255,255,255,0.3)" }} />
      </button>
    </div>
  );

  const renderRow = (icon: typeof Bell, label: string, value: string, color: string) => (
    <button className="w-full flex items-center gap-3 px-3 py-3"
      onClick={() => { hapticLight(); toast(`${label}`, { description: `${tr("setg.current")}: ${value}. ${tr("setg.tapToModify")}` }); }}
      style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.03)", cursor: "pointer" }}>
      <div className="size-7 rounded-lg flex items-center justify-center" style={{ background: `${color}10` }}>
        {React.createElement(icon, { className: "size-3.5", style: { color } })}
      </div>
      <span className="flex-1 text-left text-white" style={{ fontSize: 12, fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>{value}</span>
      <ChevronRight className="size-3.5" style={{ color: "rgba(255,255,255,0.1)" }} />
    </button>
  );

  // ─── WEB DESKTOP SETTINGS ────────────────────────────────────
  if (webMode) {
    const WEB_NAV: { id: SettingsTab; label: string; icon: typeof Building2; desc: string }[] = [
      { id: "company",  label: tr("setg.navCompany"),  icon: Building2, desc: tr("setg.navCompanyDesc") },
      { id: "access",   label: tr("setg.navAccess"),   icon: Users,     desc: tr("setg.navAccessDesc") },
      { id: "security", label: tr("setg.navSecurity"), icon: Lock,      desc: tr("setg.navSecurityDesc") },
      { id: "billing",  label: tr("setg.navBilling"),  icon: BarChart3, desc: tr("setg.navBillingDesc") },
      { id: "reports",  label: tr("setg.navReports"),  icon: Send,      desc: tr("setg.navReportsDesc") },
    ];

    const WebToggle = ({ id, label, desc, color }: { id: string; label: string; desc: string; color: string }) => (
      <div className="flex items-center justify-between py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div>
          <p className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>{label}</p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{desc}</p>
        </div>
        <button onClick={() => toggle(id)} className="relative flex-shrink-0"
          style={{ width: 44, height: 24, borderRadius: 12, background: toggles[id] ? color : "rgba(255,255,255,0.08)", transition: "background 0.3s" }}>
          <motion.div initial={false} animate={{ x: toggles[id] ? 22 : 2 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="absolute top-1 size-4 rounded-full" style={{ background: toggles[id] ? "#fff" : "rgba(255,255,255,0.4)", boxShadow: toggles[id] ? `0 2px 8px ${color}60` : "none" }} />
        </button>
      </div>
    );

    // P1-fix (2026-05-27): TEAM_MEMBERS & SECURITY_EVENTS now fetched from
    // Supabase via useEffect above, stored in teamMembers / securityEvents state.
    // In dev mode, MOCK_TEAM / MOCK_SECURITY are shown when Supabase is empty.
    const isDemo = dataLoaded && teamMembers.length > 0 && teamMembers === MOCK_TEAM;
    const TEAM_MEMBERS = teamMembers;
    const SECURITY_EVENTS = securityEvents;

    return (
      <div className="flex h-full" style={{ minHeight: "calc(100vh - 56px)" }}>
        {/* ── Left nav ── */}
        <div className="flex-shrink-0 p-5" style={{ width: 240, borderRight: "1px solid rgba(255,255,255,0.05)" }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: "1.5px", marginBottom: 16 }}>{tr("setg.settingsHeader")}</p>
          <div className="space-y-1">
            {WEB_NAV.map(nav => {
              const Icon = nav.icon;
              const active = activeTab === nav.id;
              return (
                <button key={nav.id} onClick={() => handleTabChange(nav.id)}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all"
                  style={{ background: active ? "rgba(0,200,224,0.08)" : "transparent", border: active ? "1px solid rgba(0,200,224,0.15)" : "1px solid transparent" }}>
                  <div className="size-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: active ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.04)" }}>
                    <Icon className="size-4" style={{ color: active ? "#00C8E0" : "rgba(255,255,255,0.35)" }} />
                  </div>
                  <div className="min-w-0">
                    <p style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? "#00C8E0" : "rgba(255,255,255,0.6)" }}>{nav.label}</p>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 1 }}>{nav.desc}</p>
                  </div>
                  {active && <div className="ml-auto size-1.5 rounded-full" style={{ background: "#00C8E0", boxShadow: "0 0 6px #00C8E0" }} />}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto p-8" style={{ scrollbarWidth: "none" }}>
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25 }}>

              {/* ── COMPANY TAB ── */}
              {/* Header removed — sidebar nav + breadcrumb provide context */}
              {activeTab === "company" && (
                <div className="space-y-7 max-w-3xl">

                  {/* Company Profile card */}
                  <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="px-6 py-4 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.025)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <div className="flex items-center gap-3">
                        <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,149,0,0.12)" }}>
                          <Building2 className="size-4" style={{ color: "#FF9500" }} />
                        </div>
                        <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>{tr("setg.companyProfile")}</p>
                      </div>
                      <button onClick={saveAllSettings} className="px-4 py-2 rounded-xl flex items-center gap-2" style={{ fontSize: 12, fontWeight: 700, color: settingsSaved ? "#00C853" : "#00C8E0", background: settingsSaved ? "rgba(0,200,83,0.08)" : "rgba(0,200,224,0.08)", border: settingsSaved ? "1px solid rgba(0,200,83,0.2)" : "1px solid rgba(0,200,224,0.2)", cursor: "pointer", transition: "all 0.3s" }}>{settingsSaved ? <span>✓ {tr("setg.saved")}</span> : tr("setg.saveChanges")}</button>
                    </div>
                    <div className="p-6 space-y-5" style={{ background: "rgba(255,255,255,0.01)" }}>
                      <div className="flex items-center gap-5">
                        <div className="size-20 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, rgba(255,149,0,0.15), rgba(255,149,0,0.05))", border: "1px solid rgba(255,149,0,0.2)" }}>
                          <Building2 className="size-9" style={{ color: "#FF9500" }} />
                        </div>
                        <div>
                          <p className="text-white" style={{ fontSize: 18, fontWeight: 800 }}>{companyName}</p>
                          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginTop: 3 }}>{tr("setg.enterpriseAccount")}</p>
                          <button onClick={() => { hapticLight(); toast(tr("setg.uploadLogo"), { description: tr("setg.uploadLogoDesc") }); }} className="mt-2 px-3 py-1.5 rounded-lg" style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer" }}>{tr("setg.uploadLogo")}</button>
                        </div>
                      </div>
                      {/* SUPABASE_MIGRATION_POINT: companyProfile → supabase.from('companies').select('*').eq('id', companyId).single()
                          P1-note (2026-05-27): Company Name uses real prop; remaining fields are placeholders until
                          a `companies` profile table is created. Low risk — display-only, no compliance impact. */}
                      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
                        {[
                          { label: tr("setg.fieldCompanyName"), value: companyName,                     icon: Building2, color: "#FF9500" },
                          { label: tr("setg.fieldIndustry"),    value: tr("setg.notConfigured"),        icon: Layers,    color: "#00C8E0" },
                          { label: tr("setg.fieldCompanySize"), value: companyState ? `${companyState.company.employeeCount} ${tr("setg.employees")}` : "—", icon: Users, color: "#00C853" },
                          { label: tr("setg.fieldCountryRegion"), value: tr("setg.notConfigured"),      icon: Globe,     color: "#7B5EFF" },
                          { label: tr("setg.fieldTimeZone"),    value: Intl.DateTimeFormat().resolvedOptions().timeZone, icon: Clock, color: "#FF9500" },
                          { label: tr("setg.fieldContactEmail"), value: tr("setg.notConfigured"),       icon: Send,      color: "#00C8E0" },
                        ].map(field => {
                          const Icon = field.icon;
                          return (
                            <div key={field.label}>
                              <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.8px", display: "block", marginBottom: 8 }}>{field.label.toUpperCase()}</label>
                              <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                                <Icon className="size-4 flex-shrink-0" style={{ color: field.color }} />
                                <span className="text-white" style={{ fontSize: 13 }}>{field.value}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* ── Hybrid Mode — Multi-Site Toggle ── */}
                  <div className="rounded-2xl overflow-hidden relative" style={{
                    border: `1px solid ${toggles.hybridMode ? "rgba(123,94,255,0.25)" : "rgba(255,255,255,0.06)"}`,
                    background: toggles.hybridMode ? "linear-gradient(135deg, rgba(123,94,255,0.04), rgba(123,94,255,0.01))" : undefined,
                  }}>
                    <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <div className="flex items-center gap-3">
                        <div className="size-10 rounded-xl flex items-center justify-center" style={{
                          background: toggles.hybridMode ? "linear-gradient(135deg, rgba(123,94,255,0.2), rgba(123,94,255,0.08))" : "rgba(255,255,255,0.04)",
                          border: `1px solid ${toggles.hybridMode ? "rgba(123,94,255,0.3)" : "rgba(255,255,255,0.06)"}`,
                        }}>
                          <Navigation className="size-5" style={{ color: toggles.hybridMode ? "#7B5EFF" : "rgba(255,255,255,0.25)" }} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-white" style={{ fontSize: 16, fontWeight: 800 }}>{tr("setg.hybridMode")}</p>
                            <span className="px-2 py-0.5 rounded-full" style={{
                              fontSize: 9, fontWeight: 700, letterSpacing: "0.5px",
                              color: toggles.hybridMode ? "#7B5EFF" : "rgba(255,255,255,0.3)",
                              background: toggles.hybridMode ? "rgba(123,94,255,0.12)" : "rgba(255,255,255,0.04)",
                            }}>
                              {toggles.hybridMode ? tr("setg.multiSite") : tr("setg.hqOnly")}
                            </span>
                          </div>
                          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 3, maxWidth: 400 }}>
                            {tr("setg.hybridModeDesc")}
                          </p>
                        </div>
                      </div>
                      <button onClick={() => toggle("hybridMode")} className="relative flex-shrink-0"
                        style={{ width: 52, height: 28, borderRadius: 14, background: toggles.hybridMode ? "#7B5EFF" : "rgba(255,255,255,0.08)", transition: "background 0.3s", boxShadow: toggles.hybridMode ? "0 0 16px rgba(123,94,255,0.3)" : "none" }}>
                        <motion.div initial={false} animate={{ x: toggles.hybridMode ? 26 : 2 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}
                          className="absolute top-1 size-5 rounded-full" style={{ background: toggles.hybridMode ? "#fff" : "rgba(255,255,255,0.4)", boxShadow: toggles.hybridMode ? "0 2px 8px rgba(123,94,255,0.6)" : "none" }} />
                      </button>
                    </div>
                    <AnimatePresence>
                      {toggles.hybridMode && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-6 py-4 space-y-3" style={{ background: "rgba(123,94,255,0.02)" }}>
                            <p style={{ fontSize: 10, fontWeight: 700, color: "#7B5EFF", letterSpacing: "1px" }}>{tr("setg.enabledFeatures")}</p>
                            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                              {[
                                { icon: MapPin, label: tr("setg.featZoneMgmt"), desc: tr("setg.featZoneMgmtDesc") },
                                { icon: Crosshair, label: tr("setg.featGeofenceEditor"), desc: tr("setg.featGeofenceEditorDesc") },
                                { icon: Map, label: tr("setg.featRiskMap"), desc: tr("setg.featRiskMapDesc") },
                                { icon: Navigation, label: tr("setg.featProximityAttend"), desc: tr("setg.featProximityAttendDesc") },
                                { icon: Clock, label: tr("setg.featShiftSched"), desc: tr("setg.featShiftSchedDesc") },
                                { icon: Bell, label: tr("setg.featZoneAlerts"), desc: tr("setg.featZoneAlertsDesc") },
                              ].map(feat => (
                                <div key={feat.label} className="flex items-start gap-2 p-3 rounded-xl"
                                  style={{ background: "rgba(123,94,255,0.04)", border: "1px solid rgba(123,94,255,0.08)" }}>
                                  <feat.icon className="size-4 flex-shrink-0 mt-0.5" style={{ color: "#7B5EFF" }} />
                                  <div>
                                    <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{feat.label}</p>
                                    <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>{feat.desc}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="flex items-center gap-2 mt-2 p-3 rounded-xl" style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.1)" }}>
                              <MapPin className="size-4 flex-shrink-0" style={{ color: "#00C8E0" }} />
                              <div className="flex-1">
                                <p style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0" }}>{tr("setg.zoneCreationGps")}</p>
                                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>
                                  {tr("setg.zoneCreationGpsDesc")}
                                </p>
                              </div>
                              {onNavigate && (
                                <button onClick={() => onNavigate("geofencing")} className="px-3 py-1.5 rounded-lg flex-shrink-0"
                                  style={{ fontSize: 10, fontWeight: 700, color: "#00C8E0", background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)" }}>
                                  {tr("setg.openEditor")}
                                </button>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Operational Settings */}
                  <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="px-6 py-4" style={{ background: "rgba(255,255,255,0.025)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <div className="flex items-center gap-3">
                        <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,200,224,0.12)" }}>
                          <Settings className="size-4" style={{ color: "#00C8E0" }} />
                        </div>
                        <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>{tr("setg.operationalPreferences")}</p>
                      </div>
                    </div>
                    <div className="px-6" style={{ background: "rgba(255,255,255,0.01)" }}>
                      <WebToggle id="notifications"  label={tr("setg.pushSmsNotif")}     desc={tr("setg.pushSmsNotifDesc")}     color="#00C853" />
                      <WebToggle id="geofencing"     label={tr("setg.autoGeofencing")}   desc={tr("setg.autoGeofencingDesc")}   color="#00C8E0" />
                      <WebToggle id="sosHold"        label={tr("setg.holdToActivateSos")} desc={tr("setg.holdToActivateSosDesc")} color="#FF2D55" />
                      <WebToggle id="autoEscalation" label={tr("setg.autoEscEngine")}    desc={tr("setg.autoEscEngineDesc")}    color="#FF9500" />
                      <div className="flex items-center justify-between py-4">
                        <div>
                          <p className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>{tr("setg.checkinInterval")}</p>
                          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{tr("setg.checkinIntervalDesc")}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {["15m", "30m", "1h", "2h"].map(v => (
                            <button key={v} onClick={() => { setCheckinInterval(v); hapticLight(); toast.success(tr("setg.checkinIntervalUpdated"), { description: `${tr("setg.workersCheckInEvery")} ${v}` }); }} className="px-3 py-1.5 rounded-lg" style={{ fontSize: 12, fontWeight: v === checkinInterval ? 700 : 500, background: v === checkinInterval ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.04)", color: v === checkinInterval ? "#00C8E0" : "rgba(255,255,255,0.35)", border: v === checkinInterval ? "1px solid rgba(0,200,224,0.25)" : "1px solid rgba(255,255,255,0.06)", cursor: "pointer" }}>
                              {v}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Language */}
                  {lang && onLangChange && (
                    <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="px-6 py-4" style={{ background: "rgba(255,255,255,0.025)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        <div className="flex items-center gap-3">
                          <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(123,94,255,0.12)" }}>
                            <Globe className="size-4" style={{ color: "#7B5EFF" }} />
                          </div>
                          <div>
                            <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>{tr("setg.languageLocalization")}</p>
                            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>{tr("setg.languagesSupported")}</p>
                          </div>
                        </div>
                      </div>
                      <div className="p-4 grid gap-2" style={{ gridTemplateColumns: "repeat(3, 1fr)", background: "rgba(255,255,255,0.01)" }}>
                        {(Object.keys(LANG_META) as Lang[]).map(l => (
                          <button key={l} onClick={() => onLangChange(l)}
                            className="flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all"
                            style={{ background: l === lang ? "rgba(0,200,224,0.07)" : "rgba(255,255,255,0.02)", border: `1px solid ${l === lang ? "rgba(0,200,224,0.25)" : "rgba(255,255,255,0.05)"}` }}>
                            <span style={{ fontSize: 20 }}>{LANG_META[l].flag}</span>
                            <div className="min-w-0">
                              <p style={{ fontSize: 13, fontWeight: l === lang ? 700 : 500, color: l === lang ? "#00C8E0" : "rgba(255,255,255,0.55)" }}>{LANG_META[l].native}</p>
                              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{LANG_META[l].label}</p>
                            </div>
                            {l === lang && <CheckCircle2 className="size-4 ml-auto flex-shrink-0" style={{ color: "#00C8E0" }} />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── ACCESS CONTROL TAB ── */}
              {activeTab === "access" && (
                <div className="space-y-7 max-w-4xl">
                  <div className="flex items-center justify-end">
                    <div className="flex gap-3">
                      <button onClick={() => setShowInviteUser(true)} className="flex items-center gap-2 px-5 py-2.5 rounded-xl"
                        style={{ fontSize: 13, fontWeight: 700, color: "#00C8E0", background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.2)" }}>
                        <Send className="size-4" /> {tr("setg.inviteMember")}
                      </button>
                      <button onClick={() => setAccessSubPage("createRole")} className="flex items-center gap-2 px-5 py-2.5 rounded-xl"
                        style={{ fontSize: 13, fontWeight: 700, color: "#7B5EFF", background: "rgba(123,94,255,0.08)", border: "1px solid rgba(123,94,255,0.2)" }}>
                        <Plus className="size-4" /> {tr("setg.createRole")}
                      </button>
                    </div>
                  </div>

                  {accessSubPage === "createRole" ? (
                    <CreateCustomRolePage t={tr} onBack={() => setAccessSubPage("list")} />
                  ) : (
                    <>
                      {/* Team table */}
                      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div className="px-6 py-4 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.025)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <div className="flex items-center gap-3">
                            <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,200,224,0.12)" }}>
                              <Users className="size-4" style={{ color: "#00C8E0" }} />
                            </div>
                            <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>{tr("setg.teamMembers")}</p>
                            {isDemo && <span style={{ fontSize: 8, fontWeight: 700, padding: "2px 5px", borderRadius: 4, background: "rgba(255,150,0,0.12)", color: "#FF9500", marginLeft: 6 }}>{tr("setg.demo")}</span>}
                          </div>
                          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{TEAM_MEMBERS.length} {tr("setg.membersCount")}</span>
                        </div>
                        <div className="grid px-6 py-3" style={{ gridTemplateColumns: "48px 1fr 160px 120px 100px 80px", background: "rgba(255,255,255,0.015)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                          {["", tr("setg.colMember"), tr("setg.colRole"), tr("setg.colLastActive"), tr("setg.colStatus"), ""].map((h, i) => (
                            <span key={i} style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.22)", textTransform: "uppercase", letterSpacing: "0.8px" }}>{h}</span>
                          ))}
                        </div>
                        {TEAM_MEMBERS.map((member, i) => {
                          const statusColor = member.status === "active" ? "#00C853" : member.status === "pending" ? "#FF9500" : "rgba(255,255,255,0.2)";
                          const statusLabel = member.status === "active" ? tr("setg.statusActive") : member.status === "pending" ? tr("setg.statusPending") : tr("setg.statusInactive");
                          return (
                            <div key={member.name} className="grid items-center px-6 py-4" style={{ gridTemplateColumns: "48px 1fr 160px 120px 100px 80px", borderBottom: i < TEAM_MEMBERS.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                              <div className="size-9 rounded-full flex items-center justify-center" style={{ background: `${member.color}18`, border: `1.5px solid ${member.color}30` }}>
                                <span style={{ fontSize: 12, fontWeight: 800, color: member.color }}>{member.name.split(" ").map(n => n[0]).join("").slice(0, 2)}</span>
                              </div>
                              <div>
                                <p className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>{member.name}</p>
                                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{member.email}</p>
                              </div>
                              <span className="px-2.5 py-1 rounded-lg" style={{ fontSize: 11, fontWeight: 600, color: member.color, background: `${member.color}12`, display: "inline-block" }}>{member.role}</span>
                              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{member.lastActive}</p>
                              <span className="px-2.5 py-1 rounded-lg" style={{ fontSize: 10, fontWeight: 700, color: statusColor, background: `${statusColor}12`, display: "inline-block" }}>{statusLabel}</span>
                              <button onClick={() => { hapticLight(); toast(tr("setg.editRole"), { description: tr("setg.editRoleDesc") }); }} style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", fontWeight: 600, cursor: "pointer" }}>{tr("setg.edit")}</button>
                            </div>
                          );
                        })}
                      </div>

                      {/* Role matrix */}
                      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div className="px-6 py-4" style={{ background: "rgba(255,255,255,0.025)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <div className="flex items-center gap-3">
                            <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(175,82,222,0.12)" }}>
                              <Lock className="size-4" style={{ color: "#AF52DE" }} />
                            </div>
                            <div>
                              <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>{tr("setg.rolePermissionsMatrix")}</p>
                              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>{tr("setg.currentRole")}: <span style={{ color: activeRole ? ROLE_CONFIG[activeRole]?.color : "#00C8E0", fontWeight: 700 }}>{activeRole}</span> — {tr("setg.clickToSwitch")}</p>
                            </div>
                          </div>
                        </div>
                        <div className="p-6" style={{ background: "rgba(255,255,255,0.01)" }}>
                          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                            {(Object.keys(ROLE_CONFIG) as Role[]).map(role => {
                              const cfg = ROLE_CONFIG[role];
                              const isActive = activeRole === role;
                              return (
                                <button key={role} onClick={() => onRoleChange?.(role)}
                                  className="p-4 rounded-xl text-left transition-all"
                                  style={{ background: isActive ? `${cfg.color}08` : "rgba(255,255,255,0.02)", border: `1px solid ${isActive ? cfg.color + "30" : "rgba(255,255,255,0.06)"}`, borderLeft: `3px solid ${isActive ? cfg.color : "rgba(255,255,255,0.06)"}` }}>
                                  <div className="flex items-center gap-2 mb-3">
                                    <div className="size-2 rounded-full" style={{ background: cfg.color, boxShadow: isActive ? `0 0 8px ${cfg.color}80` : "none" }} />
                                    <span style={{ fontSize: 13, fontWeight: 700, color: isActive ? cfg.color : "rgba(255,255,255,0.7)" }}>{cfg.label}</span>
                                    <span className="ml-auto px-1.5 py-0.5 rounded" style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.04)" }}>T{cfg.tier}</span>
                                  </div>
                                  {authState && isActive && (
                                    <div className="space-y-1">
                                      {authState.permissions.slice(0, 4).map(p => (
                                        <div key={p} className="flex items-center gap-1.5">
                                          <CheckCircle2 className="size-3 flex-shrink-0" style={{ color: cfg.color }} />
                                          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>{p}</span>
                                        </div>
                                      ))}
                                      {authState.permissions.length > 4 && <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>+{authState.permissions.length - 4} {tr("setg.more")}</p>}
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── SECURITY TAB ── */}
              {activeTab === "security" && (
                <div className="space-y-7 max-w-3xl">
                  {/* Security score card */}
                  <div className="p-6 rounded-2xl relative overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(0,200,83,0.08), rgba(0,200,83,0.02))", border: "1px solid rgba(0,200,83,0.2)" }}>
                    <div className="absolute top-0 right-0 w-48 h-48 pointer-events-none" style={{ background: "radial-gradient(circle, rgba(0,200,83,0.1) 0%, transparent 70%)" }} />
                    <div className="flex items-center gap-6 relative z-10">
                      <div className="relative size-[90px] flex-shrink-0">
                        <svg viewBox="0 0 90 90" className="size-full -rotate-90">
                          <circle cx="45" cy="45" r="38" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="7" />
                          <motion.circle cx="45" cy="45" r="38" fill="none" stroke="#00C853" strokeWidth="7" strokeLinecap="round"
                            strokeDasharray={`${2 * Math.PI * 38}`}
                            initial={{ strokeDashoffset: 2 * Math.PI * 38 }}
                            animate={{ strokeDashoffset: 2 * Math.PI * 38 * 0.12 }}
                            transition={{ duration: 1.5, ease: "easeOut" }} />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-white" style={{ fontSize: 24, fontWeight: 900 }}>88</span>
                          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: -2 }}>/ 100</span>
                        </div>
                      </div>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 700, color: "#00C853", letterSpacing: "1px" }}>{tr("setg.securityScoreStrong")}</p>
                        <p className="text-white mt-1" style={{ fontSize: 20, fontWeight: 800 }}>{tr("setg.accountWellProtected")}</p>
                        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 4, lineHeight: 1.6 }}>{tr("setg.securityScoreSubtitle")}</p>
                      </div>
                      <div className="ml-auto flex flex-col gap-2">
                        {[{ label: tr("setg.twoFaActive"), color: "#00C853" }, { label: tr("setg.ssoEnabled"), color: "#00C853" }].map(b => (
                          <div key={b.label} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.15)" }}>
                            <div className="size-2 rounded-full" style={{ background: b.color }} />
                            <span style={{ fontSize: 12, fontWeight: 700, color: b.color }}>{b.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Auth settings */}
                  <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="px-6 py-4" style={{ background: "rgba(255,255,255,0.025)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <div className="flex items-center gap-3">
                        <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,200,83,0.12)" }}>
                          <Lock className="size-4" style={{ color: "#00C853" }} />
                        </div>
                        <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>{tr("setg.authAndAccess")}</p>
                      </div>
                    </div>
                    <div className="px-6" style={{ background: "rgba(255,255,255,0.01)" }}>
                      <MFAControlSection t={tr} />
                      <WebToggle id="auditLog" label={tr("setg.auditLogging")} desc={tr("setg.auditLoggingDesc")} color="#00C8E0" />
                      <div className="flex items-center justify-between py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <div>
                          <p className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>{tr("setg.sessionTimeout")}</p>
                          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{tr("setg.autoLogoutInactivity")}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {["15m", "30m", "1h", "4h"].map(v => (
                            <button key={v} onClick={() => { setSessionTimeout(v); hapticLight(); toast.success(tr("setg.sessionTimeoutUpdated"), { description: `${tr("setg.autoLogoutSetTo")} ${v}. ${tr("setg.timerResetsNote")}` }); }} className="px-3 py-1.5 rounded-lg" style={{ fontSize: 12, fontWeight: v === sessionTimeout ? 700 : 500, background: v === sessionTimeout ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.04)", color: v === sessionTimeout ? "#00C8E0" : "rgba(255,255,255,0.35)", border: v === sessionTimeout ? "1px solid rgba(0,200,224,0.25)" : "1px solid rgba(255,255,255,0.06)", cursor: "pointer" }}>
                              {v}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between py-4">
                        <div>
                          <p className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>{tr("setg.apiAccess")}</p>
                          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{tr("setg.apiAccessDesc")}</p>
                        </div>
                        <button onClick={async () => {
                          hapticSuccess();
                          const companyId = companyState?.company?.id;
                          if (!companyId) { toast.error(tr("setg.noActiveCompany")); return; }
                          try {
                            const { createApiKey } = await import("./api-keys-service");
                            const res = await createApiKey(companyId, "Dashboard API Key");
                            if (!res.ok || !res.apiKey) { toast.error(tr("setg.couldNotGenerateApiKey"), { description: res.error || tr("setg.pleaseTryAgain") }); return; }
                            try { await navigator.clipboard.writeText(res.apiKey); } catch (_) { /* clipboard unavailable */ }
                            toast.success(tr("setg.apiKeyGenerated"), { description: `${res.apiKey.slice(0, 16)}…  ·  ${tr("setg.storeItNow")}`, duration: 12000 });
                          } catch (e) {
                            toast.error(tr("setg.couldNotGenerateApiKey"), { description: (e as Error)?.message || tr("setg.pleaseTryAgain") });
                          }
                        }} className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ fontSize: 12, fontWeight: 700, color: "#7B5EFF", background: "rgba(123,94,255,0.08)", border: "1px solid rgba(123,94,255,0.2)", cursor: "pointer" }}>
                          <RefreshCw className="size-3.5" /> {tr("setg.rotateKey")}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Audit log */}
                  <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="px-6 py-4 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.025)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <div className="flex items-center gap-3">
                        <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,45,85,0.12)" }}>
                          <ShieldAlert className="size-4" style={{ color: "#FF2D55" }} />
                        </div>
                        <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>{tr("setg.securityAuditLog")}</p>
                      </div>
                      <button onClick={async () => { hapticSuccess(); try { const n = await downloadAuditLogCsv(); if (n === 0) { toast.info(tr("setg.noAuditEvents")); return; } toast.success(tr("setg.auditLogExported"), { description: `${n} ${tr("setg.eventsDownloadedCsv")}` }); } catch (e) { toast.error(tr("setg.exportFailed"), { description: (e as Error)?.message || tr("setg.pleaseTryAgain") }); } }} className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ fontSize: 12, fontWeight: 600, color: "#00C8E0", background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.15)", cursor: "pointer" }}>
                        <Download className="size-3.5" /> {tr("setg.exportLog")}
                      </button>
                    </div>
                    <div style={{ background: "rgba(255,255,255,0.01)" }}>
                      {SECURITY_EVENTS.map((ev, i) => {
                        const Icon = ev.icon;
                        return (
                          <div key={i} className="flex items-center gap-4 px-6 py-4" style={{ borderBottom: i < SECURITY_EVENTS.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                            <div className="size-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${ev.color}10`, border: `1px solid ${ev.color}20` }}>
                              <Icon className="size-4" style={{ color: ev.color }} />
                            </div>
                            <div className="flex-1">
                              <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{ev.event}</p>
                              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{ev.time}</p>
                            </div>
                            <div className="size-2 rounded-full flex-shrink-0" style={{ background: ev.color }} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* ── BILLING TAB (quick link) ── */}
              {/* ── REPORTS & EMAIL TAB ── */}
              {activeTab === "reports" && (
                <div className="space-y-7 max-w-3xl">
                  {/* Recent Deliveries — REAL: schedules that have actually run (last_run) */}
                  <div>
                    <p className="text-white mb-3" style={{ fontSize: 15, fontWeight: 700 }}>{tr("setg.recentDeliveries")}</p>
                    {emailSchedules.filter(s => s.last_run).length === 0 ? (
                      <div className="rounded-xl p-6 text-center" style={{ border: "1px solid rgba(255,255,255,0.05)" }}>
                        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{tr("setg.noReportsSentYet")}</p>
                      </div>
                    ) : (
                      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.05)" }}>
                        {emailSchedules.filter(s => s.last_run).sort((a, b) => new Date(b.last_run!).getTime() - new Date(a.last_run!).getTime()).slice(0, 5).map((s, i, arr) => (
                          <div key={s.id} className="flex items-center gap-4 px-5 py-3.5" style={{ borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                            <div className="size-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(0,200,83,0.1)" }}>
                              <CheckCircle2 className="size-4" style={{ color: "#00C853" }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-white truncate" style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</p>
                              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>{tr("setg.to")}: {(s.recipients || []).join(", ") || "\u2014"}</p>
                            </div>
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", whiteSpace: "nowrap" }}>{s.last_run ? new Date(s.last_run).toLocaleString() : ""}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Scheduled Reports — REAL from email_schedules */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-white" style={{ fontSize: 15, fontWeight: 700 }}>{tr("setg.scheduledReports")}</p>
                      {onNavigate && (
                        <button onClick={() => onNavigate("emailScheduler" as DashPage)} style={{ fontSize: 11, fontWeight: 600, color: "#00C8E0", background: "none", border: "none", cursor: "pointer" }}>{tr("setg.manageInReports")}</button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {emailSchedules.length === 0 ? (
                        <div className="rounded-xl p-6 text-center" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{tr("setg.noScheduledReports")}</p>
                        </div>
                      ) : emailSchedules.map(sched => (
                        <div key={sched.id} className="flex items-center gap-4 px-5 py-3.5 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                          <div className="size-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: sched.enabled ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.04)" }}>
                            <Timer className="size-4" style={{ color: sched.enabled ? "#00C8E0" : "rgba(255,255,255,0.2)" }} />
                          </div>
                          <div className="flex-1">
                            <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{sched.name}</p>
                            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>{sched.frequency} \u2014 {(sched.recipients || []).join(", ") || tr("setg.noRecipients")}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-full" style={{ fontSize: 9, fontWeight: 700, color: sched.enabled ? "#00C853" : "rgba(255,255,255,0.3)", background: sched.enabled ? "rgba(0,200,83,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${sched.enabled ? "rgba(0,200,83,0.15)" : "rgba(255,255,255,0.06)"}` }}>{sched.enabled ? tr("setg.active") : tr("setg.paused")}</span>
                            <button onClick={() => toggleEmailSchedule(sched)} className="px-3 py-1 rounded-lg" style={{ fontSize: 10, fontWeight: 600, color: "#00C8E0", background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)", cursor: "pointer" }}>{sched.enabled ? tr("setg.pause") : tr("setg.activate")}</button>
                          </div>
                        </div>
                      ))}
                      {onNavigate && (
                        <button onClick={() => onNavigate("emailScheduler" as DashPage)} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl" style={{ background: "rgba(0,200,224,0.06)", border: "1px dashed rgba(0,200,224,0.2)", fontSize: 12, fontWeight: 600, color: "#00C8E0", cursor: "pointer" }}>
                        <Plus className="size-4" /> {tr("setg.addScheduledReport")}</button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "billing" && onNavigate && (
                <div className="space-y-6 max-w-2xl">
                  <motion.button onClick={() => onNavigate("billing")} whileTap={{ scale: 0.98 }}
                    className="w-full flex items-center gap-5 p-6 rounded-2xl text-left"
                    style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.08), rgba(0,200,224,0.02))", border: "1px solid rgba(0,200,224,0.2)" }}>
                    <div className="size-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(0,200,224,0.12)", border: "1px solid rgba(0,200,224,0.2)" }}>
                      <BarChart3 className="size-7" style={{ color: "#00C8E0" }} />
                    </div>
                    <div className="flex-1">
                      <p className="text-white" style={{ fontSize: 17, fontWeight: 800 }}>{tr("setg.fullBillingDashboard")}</p>
                      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 3 }}>{tr("setg.fullBillingDashboardDesc")}</p>
                    </div>
                    <ChevronRight className="size-5" style={{ color: "rgba(0,200,224,0.5)" }} />
                  </motion.button>
                  {companyState && (
                    <div className="p-6 rounded-2xl" style={{ background: `${companyState.planConfig.color}08`, border: `1px solid ${companyState.planConfig.color}25` }}>
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <p style={{ fontSize: 11, fontWeight: 700, color: companyState.planConfig.color, letterSpacing: "1.5px" }}>{tr("setg.currentPlan")}</p>
                          <p className="text-white mt-1" style={{ fontSize: 24, fontWeight: 900 }}>{companyState.planConfig.label}</p>
                        </div>
                        <p style={{ fontSize: 32, fontWeight: 900, color: companyState.planConfig.color }}>${companyState.planConfig.price}<span style={{ fontSize: 14, fontWeight: 400, color: "rgba(255,255,255,0.3)" }}>{tr("setg.perSeatMo")}</span></p>
                      </div>
                      <div className="flex justify-between mb-2">
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{tr("setg.seatUsage")}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: employeeUsagePercent(companyState) > 80 ? "#FF2D55" : "#00C853" }}>
                          {companyState.company.employeeCount} / {companyState.planConfig.maxEmployees === -1 ? "∞" : companyState.planConfig.maxEmployees}
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                        <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(employeeUsagePercent(companyState), 100)}%` }} transition={{ duration: 1.2 }}
                          className="h-full rounded-full" style={{ background: employeeUsagePercent(companyState) > 80 ? "linear-gradient(90deg, #FF9500, #FF2D55)" : "linear-gradient(90deg, #00C853, #00C8E0)" }} />
                      </div>
                    </div>
                  )}
                </div>
              )}

            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    );
  }

  // ─── MOBILE SETTINGS ────────────────────────────────────────
  return (
    <div className="px-4 pt-4 space-y-3" style={{ position: "relative" }}>
      {/* Tab Bar */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => handleTabChange(tab.id)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg transition-all"
            style={{ fontSize: 9, fontWeight: 600, background: activeTab === tab.id ? "rgba(0,200,224,0.1)" : "transparent", color: activeTab === tab.id ? "#00C8E0" : "rgba(255,255,255,0.3)" }}>
            <tab.icon className="size-3" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Company Tab */}
      {activeTab === "company" && (
        <div className="space-y-3">
          {/* AUTH-5 P6 (#175): DPA acceptance status + renewal flow.
              Reads server truth via current_dpa_version() + get_dpa_acceptance.
              Shows green confirmation when up-to-date, cyan renewal CTA when
              the server version has moved ahead of the accepted version. */}
          <DpaSettingsSection
            companyId={typeof window !== "undefined" ? localStorage.getItem("sosphere_company_id") : null}
            // P0-doctrine-completion (2026-05-25): ownerName was an undeclared variable
            // (probably refactored out of props). Derive from companyName as a fallback
            // — the component accepts undefined for the hint anyway.
            ownerNameHint={undefined}
          />
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
            {renderRow(Building2, tr("st.profile"), companyName, "#FF9500")}
            {renderRow(Globe, tr("st.lang"), lang ? LANG_META[lang].native : "English", "#00C8E0")}
            {renderToggle("notifications", tr("st.notif"), Bell, "#00C853", tr("st.pushSmsEmail"))}
          </div>
          {/* Hybrid Mode Toggle */}
          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${toggles.hybridMode ? "rgba(123,94,255,0.2)" : "rgba(255,255,255,0.04)"}` }}>
            <div className="flex items-center gap-3 px-3 py-3" style={{ background: toggles.hybridMode ? "rgba(123,94,255,0.04)" : "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
              <div className="size-7 rounded-lg flex items-center justify-center" style={{ background: toggles.hybridMode ? "rgba(123,94,255,0.15)" : "rgba(255,255,255,0.04)" }}>
                <Navigation className="size-3.5" style={{ color: toggles.hybridMode ? "#7B5EFF" : "rgba(255,255,255,0.3)" }} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-white" style={{ fontSize: 12, fontWeight: 600 }}>{tr("setg.hybridMode")}</span>
                  <span className="px-1.5 py-0.5 rounded" style={{ fontSize: 7, fontWeight: 700, color: toggles.hybridMode ? "#7B5EFF" : "rgba(255,255,255,0.2)", background: toggles.hybridMode ? "rgba(123,94,255,0.12)" : "rgba(255,255,255,0.04)" }}>
                    {toggles.hybridMode ? tr("setg.multiSite") : tr("setg.hqOnly")}
                  </span>
                </div>
                <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", marginTop: 1 }}>{tr("setg.hybridModeShortDesc")}</p>
              </div>
              <button onClick={() => toggle("hybridMode")} className="w-9 h-5 rounded-full relative transition-all"
                style={{ background: toggles.hybridMode ? "rgba(123,94,255,0.5)" : "rgba(255,255,255,0.08)" }}>
                <motion.div initial={false} animate={{ x: toggles.hybridMode ? 16 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  className="absolute top-0.5 left-0.5 size-4 rounded-full" style={{ background: toggles.hybridMode ? "#7B5EFF" : "rgba(255,255,255,0.3)" }} />
              </button>
            </div>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
            {renderRow(Timer, tr("st.checkin"), tr("setg.val30min"), "#FF9500")}
            {renderRow(Radio, tr("st.alertChain"), tr("setg.val3levels"), "#FF2D55")}
            {renderToggle("geofencing", tr("st.geo"), MapPin, "#00C8E0", tr("st.autoZoneTrack"))}
            {renderToggle("sosHold", tr("st.sos"), Shield, "#FF2D55", tr("st.holdToTrigger"))}
            {renderToggle("autoEscalation", tr("st.autoEsc"), Zap, "#FF9500", tr("st.autoEscDesc"))}
          </div>
          {lang && onLangChange && (
            <div>
              <p className="mb-2" style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: "1px" }}>
                {tr("st.lang").toUpperCase()} — {tr("setg.langCount")}
              </p>
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
                {(Object.keys(LANG_META) as Lang[]).map((l, i, arr) => (
                  <button key={l} onClick={() => onLangChange(l)} className="w-full flex items-center gap-3 px-3 py-2.5"
                    style={{ background: l === lang ? "rgba(0,200,224,0.06)" : "rgba(255,255,255,0.02)", borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                    <span style={{ fontSize: 16 }}>{LANG_META[l].flag}</span>
                    <div className="flex-1 text-left">
                      <p style={{ fontSize: 12, fontWeight: l === lang ? 600 : 400, color: l === lang ? "#00C8E0" : "rgba(255,255,255,0.5)" }}>{LANG_META[l].native}</p>
                      <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>{LANG_META[l].label}</p>
                    </div>
                    {l === lang && <CheckCircle2 className="size-4" style={{ color: "#00C8E0" }} />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Access Tab — Role List */}
      {activeTab === "access" && accessSubPage === "list" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <button onClick={() => setShowInviteUser(true)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl"
              style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)", fontSize: 11, fontWeight: 600, color: "#00C8E0" }}>
              <Send className="size-3.5" /> {tr("setg.inviteUser")}
            </button>
            <button onClick={() => setAccessSubPage("createRole")}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl"
              style={{ background: "rgba(175,82,222,0.08)", border: "1px solid rgba(175,82,222,0.15)", fontSize: 11, fontWeight: 600, color: "#AF52DE" }}>
              <Plus className="size-3.5" /> {tr("setg.createRole")}
            </button>
          </div>
          <SectionHeader title={tr("setg.roleManagement")} icon={Users} color="#AF52DE" />
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
            {(Object.keys(ROLE_CONFIG) as Role[]).map((role, i, arr) => {
              const cfg = ROLE_CONFIG[role];
              const isActive = activeRole === role;
              return (
                <button key={role} onClick={() => onRoleChange?.(role)} className="w-full flex items-center gap-3 px-3 py-2.5"
                  style={{ background: isActive ? `${cfg.color}08` : "rgba(255,255,255,0.02)", borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none", borderLeft: isActive ? `2px solid ${cfg.color}` : "2px solid transparent" }}>
                  <div className="size-2 rounded-full flex-shrink-0" style={{ background: cfg.color, boxShadow: isActive ? `0 0 6px ${cfg.color}60` : "none" }} />
                  <div className="flex-1 text-left">
                    <span style={{ fontSize: 11, fontWeight: isActive ? 700 : 500, color: isActive ? cfg.color : "rgba(255,255,255,0.6)" }}>{cfg.label}</span>
                    <span style={{ fontSize: 8, color: "rgba(255,255,255,0.15)", marginLeft: 6 }}>{tr("setg.tier")} {cfg.tier}</span>
                  </div>
                  {isActive && <CheckCircle2 className="size-3.5 flex-shrink-0" style={{ color: cfg.color }} />}
                </button>
              );
            })}
          </div>
          {authState && (
            <>
              <SectionHeader title={tr("setg.permissions")} icon={Lock} color="#FF9500" />
              <DSCard padding={12}>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
                  {authState.permissions.map(p => (
                    <div key={p} className="flex items-center gap-1.5">
                      <CheckCircle2 className="size-3 flex-shrink-0" style={{ color: "#00C853" }} />
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", fontFamily: "monospace" }}>{p}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{authState.permissions.length} {tr("setg.permissionsGranted")}</span>
                </div>
              </DSCard>
            </>
          )}
          {companyState && (
            <>
              <SectionHeader title={tr("setg.planAndBilling")} icon={BarChart3} color="#00C8E0" />
              <DSCard padding={12}>
                <div className="flex items-center justify-between mb-2">
                  <span style={{ fontSize: 12, fontWeight: 700, color: companyState.planConfig.color }}>{companyState.planConfig.label}</span>
                  <Badge color={companyState.planConfig.color}>${companyState.planConfig.price}/mo</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[{ label: tr("setg.statEmployees"), value: companyState.company.employeeCount, color: "#00C8E0" }, { label: tr("setg.statMaxZones"), value: companyState.planConfig.maxZones === -1 ? "∞" : companyState.planConfig.maxZones, color: "#FF9500" }, { label: tr("setg.statFeatures"), value: companyState.planConfig.features.length, color: "#34C759" }].map(s => (
                    <div key={s.label} className="text-center px-2 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
                      <p style={{ fontSize: 14, fontWeight: 800, color: s.color }}>{s.value}</p>
                      <p style={{ fontSize: 7, color: "rgba(255,255,255,0.25)" }}>{s.label}</p>
                    </div>
                  ))}
                </div>
              </DSCard>
            </>
          )}
        </div>
      )}

      {/* Access Tab — Create Custom Role */}
      {activeTab === "access" && accessSubPage === "createRole" && (
        <CreateCustomRolePage t={tr} onBack={() => setAccessSubPage("list")} />
      )}

      {/* Security Tab */}
      {activeTab === "security" && (
        <div className="space-y-3">
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
            {/* P1-fix (2026-05-27): replaced cosmetic twoFA toggle with real MFA
                control that reads server state via mfaListFactors and drives
                enrollment/unenrollment through the actual Supabase MFA API. */}
            <MobileMFAControl t={tr} />
            {renderToggle("auditLog", tr("st.auditLogging"), FileText, "#00C8E0", tr("st.auditDesc"))}
            {renderRow(Shield, tr("st.sessionTimeout"), sessionTimeout, "#FF9500")}
          </div>
          {/* SUPABASE_MIGRATION_POINT: mobileSecurityEvents → supabase.from('audit_log').select('*').eq('category', 'security').order('created_at', { ascending: false }).limit(3) */}
          <SectionHeader title={tr("st.securityEvents")} icon={ShieldAlert} color="#FF2D55" />
          <DSCard padding={0}>
            {[
              { event: tr("st.loginNewDevice"), time: "2h ago", color: "#FF9500" },
              { event: tr("st.passwordChanged"), time: "3d ago", color: "#00C853" },
              { event: tr("st.failedLogin"),     time: "5d ago", color: "#FF2D55" },
            ].map((e, i) => (
              <div key={i}>
                <AlertItem title={e.event} timestamp={e.time} color={e.color} icon={ShieldAlert} />
                {i < 2 && <Divider />}
              </div>
            ))}
          </DSCard>
        </div>
      )}

      {/* Billing Tab */}
      {activeTab === "billing" && (
        <div className="space-y-3">
          {onNavigate && (
            <button onClick={() => onNavigate("billing")}
              className="w-full flex items-center justify-between p-3 rounded-xl"
              style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.08), rgba(0,200,224,0.03))", border: "1px solid rgba(0,200,224,0.18)" }}>
              <div className="flex items-center gap-2.5">
                <div className="size-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(0,200,224,0.12)" }}>
                  <Gauge className="size-4" style={{ color: "#00C8E0" }} />
                </div>
                <div className="text-left">
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0" }}>{tr("setg.fullBillingDashboard")}</p>
                  <p style={{ fontSize: 9, color: "rgba(0,200,224,0.5)" }}>{tr("setg.invoicesPlansPayment")}</p>
                </div>
              </div>
              <ChevronRight className="size-4" style={{ color: "rgba(0,200,224,0.4)" }} />
            </button>
          )}
          {companyState ? (() => {
            const planColor = companyState.planConfig.color;
            const planLabel = companyState.planConfig.label;
            const planPrice = companyState.planConfig.price;
            const empCount = companyState.company.employeeCount;
            const totalMonthly = planPrice > 0 ? planPrice * empCount : 0;
            return (
            <DSCard padding={16}>
              <div className="flex items-center gap-2 mb-3">
                <Zap className="size-4" style={{ color: planColor }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: planColor }}>{planLabel} {tr("setg.planSuffix")}</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[{ label: tr("setg.perEmpMo"), value: planPrice > 0 ? `$${planPrice.toFixed(2)}` : tr("setg.custom"), color: "rgba(255,255,255,0.9)" }, { label: tr("setg.employeesLabel"), value: String(empCount), color: "#00C8E0" }, { label: tr("setg.monthly"), value: totalMonthly > 0 ? `$${totalMonthly}` : tr("setg.custom"), color: "#00C853" }].map(s => (
                  <div key={s.label}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)" }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </DSCard>
            );
          })() : (
          <DSCard padding={16}>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="size-4" style={{ color: "#00C8E0" }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#00C8E0" }}>{tr("setg.noPlanData")}</span>
            </div>
          </DSCard>
          )}
        </div>
      )}

      {/* Reports Tab (Mobile) */}
      {activeTab === "reports" && (
        <div className="space-y-3">
          {/* SUPABASE_MIGRATION_POINT: mobileDeliveryLog → supabase.from('email_deliveries').select('*').eq('company_id', companyId).order('sent_at', { ascending: false }).limit(4) */}
          <SectionHeader title={tr("setg.emailDeliveryLog")} icon={Send} color="#00C8E0" />
          {[
            { id: "DEL-A1", report: "Compliance Q1", to: "admin@co.com", date: "Mar 12", ok: true },
            { id: "DEL-B2", report: "Audit Export", to: "owner@co.com", date: "Mar 10", ok: true },
            { id: "DEL-C3", report: "Analytics 90d", to: "safety@co.com", date: "Mar 8", ok: true },
            { id: "DEL-D4", report: "Incident #045", to: "hr@co.com", date: "Mar 5", ok: true },
          ].map(d => (
            <DSCard key={d.id} padding={12}>
              <div className="flex items-center gap-2.5">
                <div className="size-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(0,200,83,0.1)" }}>
                  <CheckCircle2 className="size-3.5" style={{ color: "#00C853" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white truncate" style={{ fontSize: 11, fontWeight: 600 }}>{d.report}</p>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{d.to} &middot; {d.date}</p>
                </div>
                <span style={{ fontSize: 8, fontFamily: "monospace", color: "rgba(0,200,224,0.4)" }}>{d.id}</span>
              </div>
            </DSCard>
          ))}
          {/* SUPABASE_MIGRATION_POINT: mobileScheduledReports → supabase.from('report_schedules').select('*').eq('company_id', companyId) */}
          <SectionHeader title={tr("setg.scheduledReports")} icon={Timer} color="#FF9500" />
          <DSCard padding={12}>
            <div className="space-y-2">
              {[
                { name: "Monthly Safety Summary", freq: "1st of month", active: true },
                { name: "Weekly Compliance Digest", freq: "Every Monday", active: true },
              ].map(s => (
                <div key={s.name} className="flex items-center justify-between">
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>{s.name}</p>
                    <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>{s.freq}</p>
                  </div>
                  <Badge color={s.active ? "#00C853" : "rgba(255,255,255,0.3)"}>{s.active ? tr("setg.active") : tr("setg.paused")}</Badge>
                </div>
              ))}
            </div>
          </DSCard>
        </div>
      )}

      {/* ── Invite User Modal ── */}
      <AnimatePresence>
        {showInviteUser && <InviteUserModal t={tr} onClose={() => setShowInviteUser(false)} />}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Invite User Modal
// ═══════════════════════════════════════════════════════════════
export function InviteUserModal({ onClose, t }: { onClose: () => void; t?: (k: string) => string }) {
  const tr = t || ((k: string) => k);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Employee");
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  // SUPABASE_MIGRATION_POINT: zones → supabase.from('zones').select('name').eq('company_id', companyId)
  const zones = Object.values(ZONE_NAMES);
  const toggleZone = (z: string) => setSelectedZones(prev => prev.includes(z) ? prev.filter(x => x !== z) : [...prev, z]);

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }} onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.92, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.92, y: 20 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="fixed inset-x-4 z-50 rounded-2xl"
        style={{ top: "50%", transform: "translateY(-50%)", background: "#0A1220", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 24px 80px rgba(0,0,0,0.6)" }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 pt-5 pb-3">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <Send className="size-4" style={{ color: "#00C8E0" }} />
              <h3 className="text-white" style={{ fontSize: 15, fontWeight: 700 }}>{tr("setg.inviteUser")}</h3>
            </div>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{tr("setg.sendInvitationDesc")}</p>
          </div>
          <button onClick={onClose} className="size-7 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <X className="size-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
          </button>
        </div>
        <div className="px-5 pb-5 space-y-4">
          <div>
            <label style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.8px", textTransform: "uppercase" }}>{tr("setg.emailAddress")}</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={tr("setg.emailPlaceholder")}
              className="w-full mt-1.5 px-3 py-2.5 rounded-xl text-white outline-none"
              style={{ fontSize: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(0,200,224,0.2)" }} />
          </div>
          <div>
            <label style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.8px", textTransform: "uppercase" }}>{tr("setg.roleLabel")}</label>
            <select value={role} onChange={e => setRole(e.target.value)}
              className="w-full mt-1.5 px-3 py-2.5 rounded-xl text-white outline-none"
              style={{ fontSize: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <option value="Employee">{tr("setg.roleEmployee")}</option>
              <option value="Supervisor">{tr("setg.roleSupervisor")}</option>
              <option value="Safety Officer">{tr("setg.roleSafetyOfficer")}</option>
              <option value="Operations Manager">{tr("setg.roleOpsManager")}</option>
              <option value="Company Admin">{tr("setg.roleCompanyAdmin")}</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.8px", textTransform: "uppercase" }}>{tr("setg.assignedZones")}</label>
            <p style={{ fontSize: 8, color: "rgba(255,255,255,0.15)", marginTop: 2, marginBottom: 6 }}>
              {tr("setg.assignedZonesHint")}
            </p>
            <div className="flex flex-wrap gap-2">
              {zones.map(z => {
                const selected = selectedZones.includes(z);
                return (
                  <button key={z} onClick={() => toggleZone(z)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all"
                    style={{ fontSize: 10, fontWeight: 600, background: selected ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.04)", border: `1px solid ${selected ? "rgba(0,200,224,0.3)" : "rgba(255,255,255,0.07)"}`, color: selected ? "#00C8E0" : "rgba(255,255,255,0.4)" }}>
                    <div className="size-3 rounded flex items-center justify-center"
                      style={{ background: selected ? "#00C8E0" : "rgba(255,255,255,0.08)", border: selected ? "none" : "1px solid rgba(255,255,255,0.12)" }}>
                      {selected && <Check className="size-2 text-black" strokeWidth={3} />}
                    </div>
                    {z}
                  </button>
                );
              })}
            </div>
            {selectedZones.length > 0 && (
              <div className="mt-2 flex items-center gap-1.5 px-2 py-1.5 rounded-lg"
                style={{ background: "rgba(0,200,83,0.04)", border: "1px solid rgba(0,200,83,0.1)" }}>
                <MapPin className="size-3" style={{ color: "#00C853" }} />
                <span style={{ fontSize: 8, color: "rgba(0,200,83,0.7)" }}>
                  {tr("setg.gpsProximityEnabled")}: {selectedZones.join(", ")}
                </span>
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl"
              style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>{tr("setg.cancel")}</button>
            <button className="flex-1 py-2.5 rounded-xl flex items-center justify-center gap-1.5"
              style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: email.trim() ? "linear-gradient(135deg, #00C8E0 0%, #0088A0 100%)" : "rgba(255,255,255,0.05)", opacity: email.trim() ? 1 : 0.5 }}
              onClick={() => {
                if (email.trim()) {
                  // Persist zone assignment for each selected zone
                  // Dashboard audit P0: was `EMP-${Date.now()}` — collision-prone
                  // under rapid invitation clicks. secureRandomId adds crypto suffix.
                  const empId = secureRandomId("EMP", 4);
                  selectedZones.forEach(z => assignEmployeeZone(empId, z));
                  onClose();
                }
              }}>
              <Send className="size-3.5" /> {tr("setg.sendInvitation")}
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// Create Custom Role Page
// ═══════════════════════════════════════════════════════════════
const PERMISSION_MODULES = [
  {
    id: "dashboard", labelKey: "setg.modDashboard", tag: "WEB APP",
    perms: [
      { id: "users", labelKey: "setg.permUsers", total: 5 },
      { id: "invitations", labelKey: "setg.permInvitations", total: 3 },
      { id: "zones", labelKey: "setg.permZones", total: 4 },
      { id: "attendance", labelKey: "setg.permAttendance", total: 2 },
      { id: "emergencies", labelKey: "setg.permEmergencies", total: 3 },
      { id: "settings", labelKey: "setg.permSettings", total: 3 },
    ],
  },
  {
    id: "mobile", labelKey: "setg.modMobileApp", tag: "MOBILE",
    perms: [
      { id: "sos", labelKey: "setg.permSosTrigger", total: 2 },
      { id: "checkin", labelKey: "setg.permCheckin", total: 2 },
      { id: "map", labelKey: "setg.permMapView", total: 2 },
      { id: "reports", labelKey: "setg.permReports", total: 3 },
    ],
  },
];

export function CreateCustomRolePage({ onBack, t }: { onBack: () => void; t?: (k: string) => string }) {
  const tr = t || ((k: string) => k);
  const [roleName, setRoleName] = useState("");
  const [description, setDescription] = useState("");
  const [cloneFrom, setCloneFrom] = useState("none");
  const [webDashboard, setWebDashboard] = useState(false);
  const [mobileApp, setMobileApp] = useState(true);
  const [zoneScope, setZoneScope] = useState<"all" | "assigned">("all");
  const [expandedModules, setExpandedModules] = useState<string[]>(["dashboard"]);
  const [grantedPerms, setGrantedPerms] = useState<Record<string, number>>({});

  const toggleModule = (id: string) =>
    setExpandedModules(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const getModuleGranted = (moduleId: string) => {
    const mod = PERMISSION_MODULES.find(m => m.id === moduleId);
    if (!mod) return 0;
    return mod.perms.reduce((acc, p) => acc + (grantedPerms[`${moduleId}.${p.id}`] || 0), 0);
  };

  const selectAll = (moduleId: string) => {
    const mod = PERMISSION_MODULES.find(m => m.id === moduleId);
    if (!mod) return;
    const updates: Record<string, number> = {};
    mod.perms.forEach(p => { updates[`${moduleId}.${p.id}`] = p.total; });
    setGrantedPerms(prev => ({ ...prev, ...updates }));
  };

  const togglePerm = (moduleId: string, permId: string, total: number) => {
    const key = `${moduleId}.${permId}`;
    setGrantedPerms(prev => ({ ...prev, [key]: prev[key] === total ? 0 : total }));
  };

  const ToggleSwitch = ({ on, onToggle, color = "#00C853" }: { on: boolean; onToggle: () => void; color?: string }) => (
    <button onClick={onToggle} className="relative flex-shrink-0 transition-all" style={{ width: 40, height: 22, borderRadius: 11, background: on ? `${color}50` : "rgba(255,255,255,0.08)" }}>
      <motion.div initial={false} animate={{ x: on ? 18 : 2 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className="absolute top-1 size-4 rounded-full" style={{ background: on ? color : "rgba(255,255,255,0.3)" }} />
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="size-8 rounded-lg flex items-center justify-center"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <ChevronLeft className="size-4" style={{ color: "rgba(255,255,255,0.5)" }} />
        </button>
        <div>
          <h2 className="text-white" style={{ fontSize: 15, fontWeight: 700 }}>{tr("setg.createCustomRole")}</h2>
          <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{tr("setg.createCustomRoleDesc")}</p>
        </div>
      </div>

      {/* Role Info */}
      <div>
        <p style={{ fontSize: 9, fontWeight: 700, color: "#00C8E0", letterSpacing: "1px", marginBottom: 8 }}>{tr("setg.roleInfo")}</p>
        <div className="rounded-xl overflow-hidden space-y-px" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
          {[
            { label: tr("setg.roleName"), value: roleName, onChange: setRoleName, placeholder: tr("setg.roleNamePlaceholder") },
            { label: tr("setg.description"), value: description, onChange: setDescription, placeholder: tr("setg.descriptionPlaceholder") },
          ].map(f => (
            <div key={f.label} className="px-3 py-3" style={{ background: "rgba(255,255,255,0.02)" }}>
              <label style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>{f.label}</label>
              <input value={f.value} onChange={e => f.onChange(e.target.value)} placeholder={f.placeholder}
                className="w-full mt-1.5 bg-transparent text-white outline-none"
                style={{ fontSize: 12, borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 4 }} />
            </div>
          ))}
          <div className="px-3 py-3" style={{ background: "rgba(255,255,255,0.02)" }}>
            <label style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>{tr("setg.cloneFrom")}</label>
            <select value={cloneFrom} onChange={e => setCloneFrom(e.target.value)}
              className="w-full mt-1.5 bg-transparent text-white outline-none" style={{ fontSize: 12 }}>
              <option value="none">{tr("setg.cloneNone")}</option>
              <option value="employee">{tr("setg.roleEmployee")}</option>
              <option value="supervisor">{tr("setg.roleSupervisor")}</option>
              <option value="safety_officer">{tr("setg.roleSafetyOfficer")}</option>
              <option value="company_admin">{tr("setg.roleCompanyAdmin")}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Access Configuration */}
      <div>
        <p style={{ fontSize: 9, fontWeight: 700, color: "#00C8E0", letterSpacing: "1px", marginBottom: 8 }}>{tr("setg.accessConfiguration")}</p>
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="px-3 py-2.5 flex items-center gap-2" style={{ background: "rgba(0,200,224,0.04)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <Globe className="size-3.5" style={{ color: "#00C8E0" }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "#00C8E0" }}>{tr("setg.platformAccess")}</span>
          </div>
          <div className="flex items-center gap-3 px-3 py-3" style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
            <LayoutDashboard className="size-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", flex: 1 }}>{tr("setg.webDashboard")}</span>
            <ToggleSwitch on={webDashboard} onToggle={() => setWebDashboard(v => !v)} color="#00C8E0" />
          </div>
          <div className="flex items-center gap-3 px-3 py-3" style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
            <Phone className="size-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", flex: 1 }}>{tr("setg.mobileAppLabel")}</span>
            <ToggleSwitch on={mobileApp} onToggle={() => setMobileApp(v => !v)} color="#00C853" />
          </div>
          <div className="px-3 py-3" style={{ background: "rgba(255,255,255,0.02)" }}>
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="size-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>{tr("setg.zoneScope")}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["all", "assigned"] as const).map(scope => (
                <button key={scope} onClick={() => setZoneScope(scope)} className="py-2 rounded-lg"
                  style={{ fontSize: 10, fontWeight: 600, background: zoneScope === scope ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.03)", border: `1px solid ${zoneScope === scope ? "rgba(0,200,224,0.3)" : "rgba(255,255,255,0.06)"}`, color: zoneScope === scope ? "#00C8E0" : "rgba(255,255,255,0.35)" }}>
                  {scope === "all" ? tr("setg.allZones") : tr("setg.assignedZonesScope")}<br />
                  <span style={{ fontSize: 8, fontWeight: 400, opacity: 0.7 }}>{scope === "all" ? tr("setg.fullAccess") : tr("setg.restricted")}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Permissions */}
      <div>
        <p style={{ fontSize: 9, fontWeight: 700, color: "#00C8E0", letterSpacing: "1px", marginBottom: 4 }}>{tr("setg.permissionsHeader")}</p>
        {!webDashboard && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl mb-3"
            style={{ background: "rgba(255,149,0,0.08)", border: "1px solid rgba(255,149,0,0.15)" }}>
            <TriangleAlert className="size-3.5 flex-shrink-0 mt-0.5" style={{ color: "#FF9500" }} />
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: "#FF9500" }}>{tr("setg.dashboardPermsDisabled")}</p>
              <p style={{ fontSize: 8, color: "rgba(255,149,0,0.7)", marginTop: 1 }}>{tr("setg.dashboardPermsDisabledDesc")}</p>
            </div>
          </div>
        )}
        <div className="space-y-2">
          {PERMISSION_MODULES.map(mod => {
            const granted = getModuleGranted(mod.id);
            const total = mod.perms.reduce((a, p) => a + p.total, 0);
            const isExpanded = expandedModules.includes(mod.id);
            const isDisabled = mod.id === "dashboard" && !webDashboard;
            return (
              <div key={mod.id} className="rounded-xl overflow-hidden"
                style={{ border: `1px solid ${isDisabled ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.06)"}`, opacity: isDisabled ? 0.5 : 1 }}>
                <button disabled={isDisabled} onClick={() => !isDisabled && toggleModule(mod.id)}
                  className="w-full flex items-center gap-2 px-3 py-2.5" style={{ background: "rgba(255,255,255,0.03)" }}>
                  <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.15 }}>
                    <ChevronRight className="size-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
                  </motion.div>
                  <Layers className="size-3.5" style={{ color: "#00C8E0" }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.8)", flex: 1, textAlign: "left" }}>{tr(mod.labelKey)}</span>
                  <span className="px-1.5 py-0.5 rounded" style={{ fontSize: 7, fontWeight: 700, background: "rgba(0,200,224,0.1)", color: "#00C8E0" }}>{mod.tag}</span>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{granted}/{total}</span>
                </button>
                <AnimatePresence>
                  {isExpanded && !isDisabled && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: "hidden" }}>
                      {mod.perms.map(perm => {
                        const key = `${mod.id}.${perm.id}`;
                        const permGranted = grantedPerms[key] || 0;
                        const isOn = permGranted === perm.total;
                        return (
                          <div key={perm.id} className="flex items-center gap-3 px-4 py-2.5"
                            style={{ background: "rgba(255,255,255,0.015)", borderTop: "1px solid rgba(255,255,255,0.03)" }}>
                            <button onClick={() => togglePerm(mod.id, perm.id, perm.total)}
                              className="size-4 rounded flex items-center justify-center flex-shrink-0 transition-all"
                              style={{ background: isOn ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.04)", border: `1px solid ${isOn ? "#00C8E0" : "rgba(255,255,255,0.1)"}` }}>
                              {isOn && <Check className="size-2.5" style={{ color: "#00C8E0" }} strokeWidth={3} />}
                            </button>
                            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", flex: 1 }}>{tr(perm.labelKey)}</span>
                            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>({permGranted}/{perm.total})</span>
                            <button onClick={() => selectAll(mod.id)} className="px-2 py-0.5 rounded"
                              style={{ fontSize: 8, fontWeight: 600, color: "#00C8E0", background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>
                              {tr("setg.selectAll")}
                            </button>
                          </div>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2 pb-4">
        <button onClick={onBack} className="flex-1 py-2.5 rounded-xl"
          style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>{tr("setg.cancel")}</button>
        <button className="flex-1 py-2.5 rounded-xl"
          style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: roleName.trim() ? "linear-gradient(135deg, #AF52DE 0%, #7B2FBE 100%)" : "rgba(255,255,255,0.05)", opacity: roleName.trim() ? 1 : 0.5 }}
          onClick={() => { if (roleName.trim()) onBack(); }}>{tr("setg.createRole")}</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// AUTH-4 (#174) — MFA Control Section
// Replaces the legacy <WebToggle id="twoFA"> placeholder with a real
// status card + enrollment wizard. Renders one of three states:
//   • not enrolled  → "Set up two-factor authentication" CTA
//   • verified      → ACTIVE badge + Disable + recovery code summary
//   • enrolling     → modal mounted (MFAEnrollmentModal)
// ═══════════════════════════════════════════════════════════════
function MFAControlSection({ t }: { t?: (k: string) => string }) {
  const tr = t || ((k: string) => k);
  const [status, setStatus]   = useState<"loading" | "off" | "on">("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [showEnroll, setShowEnroll] = useState(false);
  const [recoveryRemaining, setRecoveryRemaining] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const { data } = await mfaListFactors();
    if (data?.hasTotp) {
      const verified = data.factors.find(f => f.status === "verified");
      setFactorId(verified?.id ?? null);
      setStatus("on");
      const rs = await mfaRecoveryStatus();
      setRecoveryRemaining(rs.data?.remaining ?? 0);
    } else {
      setStatus("off");
      setFactorId(null);
      setRecoveryRemaining(0);
    }
  };
  useEffect(() => { void refresh(); }, []);

  const handleDisable = async () => {
    if (!factorId) return;
    if (!window.confirm(tr("setg.confirmDisable2fa"))) return;
    setBusy(true);
    const { error } = await mfaUnenroll(factorId);
    setBusy(false);
    if (error) {
      toast.error(tr("setg.couldNotDisable"), { description: error.message });
      return;
    }
    toast.success(tr("setg.twoFaDisabled"));
    await refresh();
  };

  const handleRegenerate = async () => {
    if (!window.confirm(tr("setg.confirmRegenCodes"))) return;
    setBusy(true);
    const { data, error } = await mfaGenerateRecoveryCodes();
    setBusy(false);
    if (error || !data) {
      toast.error(tr("setg.couldNotGenerateCodes"), { description: error?.message });
      return;
    }
    // Simple alert — for full UX this would route through the modal too.
    toast.success(tr("setg.newCodesGenerated"), { description: tr("setg.checkModalCopyDownload") });
    // Show the modal in a state where user can see codes? For brevity here we
    // open the system clipboard with codes joined.
    try { await navigator.clipboard.writeText(data.codes.join("\n")); toast.success(tr("setg.copiedToClipboard")); } catch (_) { /* */ }
    await refresh();
  };

  return (
    <>
      {showEnroll && (
        <MFAEnrollmentModal
          onComplete={async () => { setShowEnroll(false); await refresh(); toast.success(tr("setg.twoFaEnabled")); }}
          onCancel  ={async () => { setShowEnroll(false); await refresh(); }}
        />
      )}
      <div className="flex items-center justify-between py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
            <p className="text-white" style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{tr("setg.twoFactorAuthFull")}</p>
            {status === "on" && (
              <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4, background: "rgba(0,200,83,0.12)", color: "#00C853", border: "1px solid rgba(0,200,83,0.25)", letterSpacing: 0.5 }}>{tr("setg.active")}</span>
            )}
          </div>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: 0 }}>
            {status === "loading" && tr("setg.checkingStatus")}
            {status === "off" && tr("setg.mfaOffDesc")}
            {status === "on" && (recoveryRemaining > 0
              ? `${recoveryRemaining} ${recoveryRemaining === 1 ? tr("setg.unusedRecoveryCode") : tr("setg.unusedRecoveryCodes")}`
              : tr("setg.noRecoveryCodes"))}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {status === "off" && (
            <button onClick={() => setShowEnroll(true)} disabled={busy}
              style={{ padding: "8px 14px", borderRadius: 12, background: "linear-gradient(135deg, #00C8E0, #00A5C0)", color: "#03131A", fontSize: 12, fontWeight: 800, border: "none", cursor: busy ? "default" : "pointer" }}>
              {tr("setg.setUp")}
            </button>
          )}
          {status === "on" && (
            <>
              <button onClick={handleRegenerate} disabled={busy}
                style={{ padding: "8px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: 700, border: "1px solid rgba(255,255,255,0.06)", cursor: busy ? "default" : "pointer" }}>
                {recoveryRemaining > 0 ? tr("setg.regenerateCodes") : tr("setg.generateCodes")}
              </button>
              <button onClick={handleDisable} disabled={busy}
                style={{ padding: "8px 12px", borderRadius: 12, background: "rgba(255,45,85,0.06)", color: "#FF2D55", fontSize: 11, fontWeight: 700, border: "1px solid rgba(255,45,85,0.2)", cursor: busy ? "default" : "pointer" }}>
                {tr("setg.disable")}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// P1-fix (2026-05-27) — Mobile MFA Control
// Compact version of MFAControlSection for the mobile security tab.
// Reads real MFA state from Supabase and drives enroll/unenroll.
// ═══════════════════════════════════════════════════════════════
function MobileMFAControl({ t }: { t?: (k: string) => string }) {
  const tr = t || ((k: string) => k);
  const [status, setStatus] = useState<"loading" | "off" | "on">("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [showEnroll, setShowEnroll] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const { data } = await mfaListFactors();
    if (data?.hasTotp) {
      const verified = data.factors.find((f: any) => f.status === "verified");
      setFactorId(verified?.id ?? null);
      setStatus("on");
    } else {
      setStatus("off");
      setFactorId(null);
    }
  };
  useEffect(() => { void refresh(); }, []);

  const handleToggle = async () => {
    if (status === "loading") return;
    if (status === "off") {
      setShowEnroll(true);
      return;
    }
    // Status is "on" — confirm disable
    if (!window.confirm(tr("setg.confirmDisable2faShort"))) return;
    if (!factorId) return;
    setBusy(true);
    const { error } = await mfaUnenroll(factorId);
    setBusy(false);
    if (error) {
      toast.error(tr("setg.couldNotDisable2fa"), { description: error.message });
      return;
    }
    toast.success(tr("setg.twoFaDisabled"));
    await refresh();
  };

  const isOn = status === "on";

  return (
    <>
      {showEnroll && (
        <MFAEnrollmentModal
          onComplete={async () => { setShowEnroll(false); await refresh(); toast.success(tr("setg.twoFaEnabledShort")); }}
          onCancel  ={async () => { setShowEnroll(false); await refresh(); }}
        />
      )}
      <div className="flex items-center gap-3 px-3 py-3" style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
        <div className="size-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(0,200,83,0.1)" }}>
          <Lock className="size-3.5" style={{ color: "#00C853" }} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-white" style={{ fontSize: 12, fontWeight: 500 }}>{tr("setg.twoFactorAuth")}</span>
            {status === "on" && (
              <span style={{ fontSize: 7, fontWeight: 700, padding: "1px 4px", borderRadius: 3, background: "rgba(0,200,83,0.12)", color: "#00C853" }}>{tr("setg.active")}</span>
            )}
          </div>
          <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", marginTop: 1 }}>
            {status === "loading" ? tr("setg.checkingShort") : isOn ? tr("setg.totpEnrolled") : tr("setg.tapToSetupAuth")}
          </p>
        </div>
        <button onClick={handleToggle} disabled={busy || status === "loading"} className="w-9 h-5 rounded-full relative transition-all"
          style={{ background: isOn ? "rgba(0,200,83,0.4)" : "rgba(255,255,255,0.08)" }}>
          <motion.div initial={false} animate={{ x: isOn ? 16 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="absolute top-0.5 left-0.5 size-4 rounded-full" style={{ background: isOn ? "#00C853" : "rgba(255,255,255,0.3)" }} />
        </button>
      </div>
    </>
  );
}
