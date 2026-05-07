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
import {
  Card as DSCard, SectionHeader, Badge, AlertItem, Divider,
} from "./design-system";
import { setHybridMode as setHybridModeStore, getHybridMode, assignEmployeeZone, ZONE_NAMES } from "./shared-store";
import { useDashboardStore } from "./stores/dashboard-store";
import { storeJSONSync, loadJSONSync } from "./api/storage-adapter";
import { MFAEnrollmentModal } from "./mfa-enrollment-modal";
import { DpaSettingsSection } from "./dpa-settings-section";  // AUTH-5 P6
import { mfaListFactors, mfaUnenroll, mfaRecoveryStatus, mfaGenerateRecoveryCodes } from "./api/mfa-client";

type DashPage = "overview" | "employees" | "emergencies" | "zones" | "incidents" | "attendance" | "settings" | "commandCenter" | "riskMap" | "billing" | "analytics" | "shiftScheduling" | "geofencing";

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
      const adminProfile = {
        name: authState.userId || "Admin",
        role: activeRole || "admin",
        phone: authState.phone || "",
      };
      localStorage.setItem("sosphere_admin_profile", JSON.stringify(adminProfile));
      localStorage.setItem("sosphere_admin_phone", (authState.phone || "").replace(/\s/g, ""));
    }
    // Sync to Supabase (background)
    try {
      const { SUPABASE_CONFIG } = await import("./api/supabase-client");
      if (SUPABASE_CONFIG.isConfigured) {
        const { supabase } = await import("./api/supabase-client");
        supabase.from("company_settings").upsert({
          id: companyName || "default",
          company_id: companyName || "default",
          settings: {
            company_name: companyName,
            language: lang || "en",
            checkin_interval: checkinInterval,
            session_timeout: useDashboardStore.getState().sessionTimeout,
            toggles,
          },
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" }).then(() => {
          console.log("[Settings] Synced to Supabase");
        }).catch((e: any) => console.warn("[Settings] Supabase sync failed:", e));
      }
    } catch { /* Supabase not available */ }

    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
    hapticSuccess();
    toast.success("Settings Saved", { description: "Settings saved and synced" });
  };

  // ── CRITICAL FIX 3: Session timeout from Zustand store (not local state) ──
  const { sessionTimeout, setSessionTimeout } = useDashboardStore();

  const tabs: { id: SettingsTab; label: string; icon: typeof Building2 }[] = [
    { id: "company", label: tr("st.company"), icon: Building2 },
    { id: "access", label: tr("st.access"), icon: Users },
    { id: "security", label: tr("st.security"), icon: Lock },
    { id: "billing", label: tr("st.billing"), icon: BarChart3 },
    { id: "reports", label: "Reports", icon: Send },
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
        <motion.div animate={{ x: toggles[key] ? 16 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="absolute top-0.5 left-0.5 size-4 rounded-full" style={{ background: toggles[key] ? color : "rgba(255,255,255,0.3)" }} />
      </button>
    </div>
  );

  const renderRow = (icon: typeof Bell, label: string, value: string, color: string) => (
    <button className="w-full flex items-center gap-3 px-3 py-3"
      onClick={() => { hapticLight(); toast(`${label}`, { description: `Current: ${value}. Tap to modify this setting.` }); }}
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
      { id: "company",  label: "Company",        icon: Building2, desc: "Profile & preferences" },
      { id: "access",   label: "Access Control", icon: Users,     desc: "Roles & permissions" },
      { id: "security", label: "Security",        icon: Lock,      desc: "Auth & audit" },
      { id: "billing",  label: "Billing",         icon: BarChart3, desc: "Plan & invoices" },
      { id: "reports",  label: "Email & Reports", icon: Send,      desc: "Delivery history & scheduling" },
    ];

    const WebToggle = ({ id, label, desc, color }: { id: string; label: string; desc: string; color: string }) => (
      <div className="flex items-center justify-between py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div>
          <p className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>{label}</p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{desc}</p>
        </div>
        <button onClick={() => toggle(id)} className="relative flex-shrink-0"
          style={{ width: 44, height: 24, borderRadius: 12, background: toggles[id] ? color : "rgba(255,255,255,0.08)", transition: "background 0.3s" }}>
          <motion.div animate={{ x: toggles[id] ? 22 : 2 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="absolute top-1 size-4 rounded-full" style={{ background: toggles[id] ? "#fff" : "rgba(255,255,255,0.4)", boxShadow: toggles[id] ? `0 2px 8px ${color}60` : "none" }} />
        </button>
      </div>
    );

    // SUPABASE_MIGRATION_POINT: TEAM_MEMBERS → supabase.from('employees').select('name, email, role, status, last_active').eq('company_id', companyId)
    const TEAM_MEMBERS = [
      { name: "Jane Mitchell",     email: "j.mitchell@acmeindustries.com",  role: "Admin",       status: "active",   color: "#00C8E0", lastActive: "Just now" },
      { name: "Carlos Silva",   email: "c.silva@buildco.com",      role: "Site Admin",  status: "active",   color: "#7B5EFF", lastActive: "5m ago"   },
      { name: "Emma Wilson",   email: "l.chen@acmeindustries.com",     role: "HSE Manager", status: "active",   color: "#00C853", lastActive: "1h ago"   },
      { name: "Khalid Nouri",    email: "k.nouri@aramco.com",      role: "Supervisor",  status: "inactive", color: "#FF9500", lastActive: "2d ago"   },
      { name: "Laura Chen", email: "e.wilson@acmeindustries.com",       role: "Viewer",      status: "pending",  color: "#FF2D55", lastActive: "Pending"  },
    ];

    // SUPABASE_MIGRATION_POINT: SECURITY_EVENTS → supabase.from('audit_log').select('*').eq('category', 'security').order('created_at', { ascending: false }).limit(5)
    const SECURITY_EVENTS = [
      { event: "New login from Chrome / Windows 11", time: "Today, 09:14", color: "#FF9500", icon: Lock       },
      { event: "Password changed successfully",       time: "Mar 5, 2026",  color: "#00C853", icon: CheckCircle2 },
      { event: "Failed login attempt (×3)",           time: "Mar 2, 2026",  color: "#FF2D55", icon: ShieldAlert  },
      { event: "API key rotated",                     time: "Feb 28, 2026", color: "#00C8E0", icon: RefreshCw  },
      { event: "2FA enrolled for all admin accounts", time: "Feb 20, 2026", color: "#7B5EFF", icon: Shield     },
    ];

    return (
      <div className="flex h-full" style={{ minHeight: "calc(100vh - 56px)" }}>
        {/* ── Left nav ── */}
        <div className="flex-shrink-0 p-5" style={{ width: 240, borderRight: "1px solid rgba(255,255,255,0.05)" }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: "1.5px", marginBottom: 16 }}>SETTINGS</p>
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
                        <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Company Profile</p>
                      </div>
                      <button onClick={saveAllSettings} className="px-4 py-2 rounded-xl flex items-center gap-2" style={{ fontSize: 12, fontWeight: 700, color: settingsSaved ? "#00C853" : "#00C8E0", background: settingsSaved ? "rgba(0,200,83,0.08)" : "rgba(0,200,224,0.08)", border: settingsSaved ? "1px solid rgba(0,200,83,0.2)" : "1px solid rgba(0,200,224,0.2)", cursor: "pointer", transition: "all 0.3s" }}>{settingsSaved ? <span>✓ Saved</span> : "Save Changes"}</button>
                    </div>
                    <div className="p-6 space-y-5" style={{ background: "rgba(255,255,255,0.01)" }}>
                      <div className="flex items-center gap-5">
                        <div className="size-20 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, rgba(255,149,0,0.15), rgba(255,149,0,0.05))", border: "1px solid rgba(255,149,0,0.2)" }}>
                          <Building2 className="size-9" style={{ color: "#FF9500" }} />
                        </div>
                        <div>
                          <p className="text-white" style={{ fontSize: 18, fontWeight: 800 }}>{companyName}</p>
                          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginTop: 3 }}>Enterprise Account · Since Jan 2024</p>
                          <button onClick={() => { hapticLight(); toast("Upload Logo", { description: "File picker would open here to upload company logo" }); }} className="mt-2 px-3 py-1.5 rounded-lg" style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer" }}>Upload Logo</button>
                        </div>
                      </div>
                      {/* SUPABASE_MIGRATION_POINT: companyProfile → supabase.from('companies').select('*').eq('id', companyId).single() */}
                      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
                        {[
                          { label: "Company Name",     value: companyName,                   icon: Building2, color: "#FF9500" },
                          { label: "Industry",          value: "Oil & Gas / Energy",           icon: Layers,    color: "#00C8E0" },
                          { label: "Company Size",      value: "501–1000 employees",           icon: Users,     color: "#00C853" },
                          { label: "Country / Region",  value: "Saudi Arabia (KSA)",           icon: Globe,     color: "#7B5EFF" },
                          { label: "Time Zone",         value: "GMT+3 (Arabian Standard Time)",icon: Clock,     color: "#FF9500" },
                          { label: "Contact Email",     value: "ops@acmeindustries.com",        icon: Send,      color: "#00C8E0" },
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
                            <p className="text-white" style={{ fontSize: 16, fontWeight: 800 }}>Hybrid Mode</p>
                            <span className="px-2 py-0.5 rounded-full" style={{
                              fontSize: 9, fontWeight: 700, letterSpacing: "0.5px",
                              color: toggles.hybridMode ? "#7B5EFF" : "rgba(255,255,255,0.3)",
                              background: toggles.hybridMode ? "rgba(123,94,255,0.12)" : "rgba(255,255,255,0.04)",
                            }}>
                              {toggles.hybridMode ? "MULTI-SITE" : "HQ ONLY"}
                            </span>
                          </div>
                          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 3, maxWidth: 400 }}>
                            Enable if your company has external field sites or zones. When OFF, only HQ-based features are shown.
                          </p>
                        </div>
                      </div>
                      <button onClick={() => toggle("hybridMode")} className="relative flex-shrink-0"
                        style={{ width: 52, height: 28, borderRadius: 14, background: toggles.hybridMode ? "#7B5EFF" : "rgba(255,255,255,0.08)", transition: "background 0.3s", boxShadow: toggles.hybridMode ? "0 0 16px rgba(123,94,255,0.3)" : "none" }}>
                        <motion.div animate={{ x: toggles.hybridMode ? 26 : 2 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}
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
                            <p style={{ fontSize: 10, fontWeight: 700, color: "#7B5EFF", letterSpacing: "1px" }}>ENABLED FEATURES</p>
                            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                              {[
                                { icon: MapPin, label: "Zone Management", desc: "Create & manage field zones" },
                                { icon: Crosshair, label: "Geofencing Editor", desc: "Draw zone boundaries on map" },
                                { icon: Map, label: "Risk Map", desc: "Live risk visualization" },
                                { icon: Navigation, label: "Proximity Attend", desc: "Auto-attend when near zone" },
                                { icon: Clock, label: "Shift Scheduling", desc: "Assign shifts per zone" },
                                { icon: Bell, label: "Zone Alerts", desc: "Entry/exit/dwell alerts" },
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
                                <p style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0" }}>Zone Creation via GPS</p>
                                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>
                                  Admin creates zones by entering GPS coordinates or sharing Google Maps location. Employees are assigned to zones, and the Attend button appears when they enter the zone radius.
                                </p>
                              </div>
                              {onNavigate && (
                                <button onClick={() => onNavigate("geofencing")} className="px-3 py-1.5 rounded-lg flex-shrink-0"
                                  style={{ fontSize: 10, fontWeight: 700, color: "#00C8E0", background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)" }}>
                                  Open Editor
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
                        <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Operational Preferences</p>
                      </div>
                    </div>
                    <div className="px-6" style={{ background: "rgba(255,255,255,0.01)" }}>
                      <WebToggle id="notifications"  label="Push & SMS Notifications"  desc="Send real-time alerts to supervisors and admins"           color="#00C853" />
                      <WebToggle id="geofencing"     label="Automatic Geofencing"      desc="Auto-create safety zones based on employee GPS data"       color="#00C8E0" />
                      <WebToggle id="sosHold"        label="Hold-to-Activate SOS"      desc="Require 3-second hold to prevent accidental SOS triggers"  color="#FF2D55" />
                      <WebToggle id="autoEscalation" label="Auto Escalation Engine"    desc="Automatically escalate unresponded alerts up the chain"    color="#FF9500" />
                      <div className="flex items-center justify-between py-4">
                        <div>
                          <p className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>Check-in Interval</p>
                          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>How often field workers must check in</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {["15m", "30m", "1h", "2h"].map(v => (
                            <button key={v} onClick={() => { setCheckinInterval(v); hapticLight(); toast.success("Check-in Interval Updated", { description: `Workers must check in every ${v}` }); }} className="px-3 py-1.5 rounded-lg" style={{ fontSize: 12, fontWeight: v === checkinInterval ? 700 : 500, background: v === checkinInterval ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.04)", color: v === checkinInterval ? "#00C8E0" : "rgba(255,255,255,0.35)", border: v === checkinInterval ? "1px solid rgba(0,200,224,0.25)" : "1px solid rgba(255,255,255,0.06)", cursor: "pointer" }}>
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
                            <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Language & Localization</p>
                            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>12 languages supported</p>
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
                        <Send className="size-4" /> Invite Member
                      </button>
                      <button onClick={() => setAccessSubPage("createRole")} className="flex items-center gap-2 px-5 py-2.5 rounded-xl"
                        style={{ fontSize: 13, fontWeight: 700, color: "#7B5EFF", background: "rgba(123,94,255,0.08)", border: "1px solid rgba(123,94,255,0.2)" }}>
                        <Plus className="size-4" /> Create Role
                      </button>
                    </div>
                  </div>

                  {accessSubPage === "createRole" ? (
                    <CreateCustomRolePage onBack={() => setAccessSubPage("list")} />
                  ) : (
                    <>
                      {/* Team table */}
                      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div className="px-6 py-4 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.025)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <div className="flex items-center gap-3">
                            <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,200,224,0.12)" }}>
                              <Users className="size-4" style={{ color: "#00C8E0" }} />
                            </div>
                            <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Team Members</p>
                          </div>
                          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{TEAM_MEMBERS.length} members</span>
                        </div>
                        <div className="grid px-6 py-3" style={{ gridTemplateColumns: "48px 1fr 160px 120px 100px 80px", background: "rgba(255,255,255,0.015)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                          {["", "Member", "Role", "Last Active", "Status", ""].map((h, i) => (
                            <span key={i} style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.22)", textTransform: "uppercase", letterSpacing: "0.8px" }}>{h}</span>
                          ))}
                        </div>
                        {TEAM_MEMBERS.map((member, i) => {
                          const statusColor = member.status === "active" ? "#00C853" : member.status === "pending" ? "#FF9500" : "rgba(255,255,255,0.2)";
                          const statusLabel = member.status === "active" ? "Active" : member.status === "pending" ? "Pending" : "Inactive";
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
                              <button onClick={() => { hapticLight(); toast("Edit Role", { description: "Role editor — use Roles & Access page for full control" }); }} style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", fontWeight: 600, cursor: "pointer" }}>Edit</button>
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
                              <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Role Permissions Matrix</p>
                              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>Current role: <span style={{ color: activeRole ? ROLE_CONFIG[activeRole]?.color : "#00C8E0", fontWeight: 700 }}>{activeRole}</span> — click to switch</p>
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
                                      {authState.permissions.length > 4 && <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>+{authState.permissions.length - 4} more</p>}
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
                        <p style={{ fontSize: 13, fontWeight: 700, color: "#00C853", letterSpacing: "1px" }}>SECURITY SCORE — STRONG</p>
                        <p className="text-white mt-1" style={{ fontSize: 20, fontWeight: 800 }}>Your account is well protected</p>
                        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 4, lineHeight: 1.6 }}>2FA enabled · Sessions monitored · Audit logging active</p>
                      </div>
                      <div className="ml-auto flex flex-col gap-2">
                        {[{ label: "2FA Active", color: "#00C853" }, { label: "SSO Enabled", color: "#00C853" }].map(b => (
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
                        <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Authentication & Access</p>
                      </div>
                    </div>
                    <div className="px-6" style={{ background: "rgba(255,255,255,0.01)" }}>
                      <MFAControlSection />
                      <WebToggle id="auditLog" label="Audit Logging"                   desc="Record all admin actions with timestamps and IP" color="#00C8E0" />
                      <div className="flex items-center justify-between py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <div>
                          <p className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>Session Timeout</p>
                          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>Auto-logout after inactivity</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {["15m", "30m", "1h", "4h"].map(v => (
                            <button key={v} onClick={() => { setSessionTimeout(v); hapticLight(); toast.success("Session Timeout Updated", { description: `Auto-logout set to ${v}. Timer resets on activity. Suspended during emergencies.` }); }} className="px-3 py-1.5 rounded-lg" style={{ fontSize: 12, fontWeight: v === sessionTimeout ? 700 : 500, background: v === sessionTimeout ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.04)", color: v === sessionTimeout ? "#00C8E0" : "rgba(255,255,255,0.35)", border: v === sessionTimeout ? "1px solid rgba(0,200,224,0.25)" : "1px solid rgba(255,255,255,0.06)", cursor: "pointer" }}>
                              {v}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between py-4">
                        <div>
                          <p className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>API Access</p>
                          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>External API key management</p>
                        </div>
                        <button onClick={() => { hapticSuccess(); toast.success("API Key Rotated", { description: "New key generated. Old key expires in 24h" }); }} className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ fontSize: 12, fontWeight: 700, color: "#7B5EFF", background: "rgba(123,94,255,0.08)", border: "1px solid rgba(123,94,255,0.2)", cursor: "pointer" }}>
                          <RefreshCw className="size-3.5" /> Rotate Key
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
                        <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Security Audit Log</p>
                      </div>
                      <button onClick={() => { hapticSuccess(); toast.success("Exporting Audit Log", { description: "Security audit log PDF is being prepared..." }); }} className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ fontSize: 12, fontWeight: 600, color: "#00C8E0", background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.15)", cursor: "pointer" }}>
                        <Download className="size-3.5" /> Export Log
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
                  {/* Delivery History */}
                  {/* SUPABASE_MIGRATION_POINT: deliveryHistory → supabase.from('email_deliveries').select('*').eq('company_id', companyId).order('sent_at', { ascending: false }).limit(5) */}
                  <div>
                    <p className="text-white mb-3" style={{ fontSize: 15, fontWeight: 700 }}>Recent Deliveries</p>
                    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.05)" }}>
                      {[
                        { id: "DEL-20260312-A1", report: "Compliance Report Q1 2026", to: "admin@company.com", date: "Mar 12, 2026 09:45", status: "delivered", encrypted: true },
                        { id: "DEL-20260310-B2", report: "Audit Log Export", to: "owner@company.com", date: "Mar 10, 2026 14:22", status: "delivered", encrypted: true },
                        { id: "DEL-20260308-C3", report: "Analytics Report (90d)", to: "safety@company.com", date: "Mar 8, 2026 11:15", status: "delivered", encrypted: false },
                        { id: "DEL-20260305-D4", report: "Incident Report #IR-2026-045", to: "hr@company.com, legal@company.com", date: "Mar 5, 2026 16:30", status: "delivered", encrypted: true },
                        { id: "DEL-20260301-E5", report: "Monthly Safety Summary", to: "all-admins@company.com", date: "Mar 1, 2026 08:00", status: "scheduled", encrypted: false },
                      ].map((del, i) => (
                        <div key={del.id} className="flex items-center gap-4 px-5 py-3.5"
                          style={{ borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.03)" : "none", background: del.status === "scheduled" ? "rgba(255,150,0,0.03)" : "transparent" }}>
                          <div className="size-8 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ background: del.status === "delivered" ? "rgba(0,200,83,0.1)" : "rgba(255,150,0,0.1)" }}>
                            {del.status === "delivered"
                              ? <CheckCircle2 className="size-4" style={{ color: "#00C853" }} />
                              : <Clock className="size-4" style={{ color: "#FF9500" }} />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white truncate" style={{ fontSize: 13, fontWeight: 600 }}>{del.report}</p>
                            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>
                              To: {del.to}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {del.encrypted && (
                              <div className="px-1.5 py-0.5 rounded-md" style={{ background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.15)" }}>
                                <Lock className="size-3 inline-block mr-0.5" style={{ color: "#00C853" }} />
                                <span style={{ fontSize: 8, fontWeight: 700, color: "#00C853" }}>AES</span>
                              </div>
                            )}
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", whiteSpace: "nowrap" }}>{del.date}</span>
                          </div>
                          <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", color: "rgba(0,200,224,0.5)", minWidth: 90, textAlign: "right" }}>{del.id}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Scheduled Reports */}
                  {/* SUPABASE_MIGRATION_POINT: scheduledReports → supabase.from('report_schedules').select('*').eq('company_id', companyId) */}
                  <div>
                    <p className="text-white mb-3" style={{ fontSize: 15, fontWeight: 700 }}>Scheduled Reports</p>
                    <div className="space-y-2">
                      {[
                        { report: "Monthly Safety Summary", freq: "1st of every month", to: "all-admins@company.com", active: true },
                        { report: "Weekly Compliance Digest", freq: "Every Monday 8:00 AM", to: "compliance@company.com", active: true },
                        { report: "Quarterly Audit Export", freq: "Quarterly (Jan, Apr, Jul, Oct)", to: "owner@company.com", active: false },
                      ].map(sched => (
                        <div key={sched.report} className="flex items-center gap-4 px-5 py-3.5 rounded-xl"
                          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                          <div className="size-8 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ background: sched.active ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.04)" }}>
                            <Timer className="size-4" style={{ color: sched.active ? "#00C8E0" : "rgba(255,255,255,0.2)" }} />
                          </div>
                          <div className="flex-1">
                            <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{sched.report}</p>
                            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>{sched.freq} -- {sched.to}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-full"
                              style={{ fontSize: 9, fontWeight: 700, color: sched.active ? "#00C853" : "rgba(255,255,255,0.3)", background: sched.active ? "rgba(0,200,83,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${sched.active ? "rgba(0,200,83,0.15)" : "rgba(255,255,255,0.06)"}` }}>
                              {sched.active ? "ACTIVE" : "PAUSED"}
                            </span>
                            <button onClick={() => { hapticLight(); toast.success(sched.active ? "Schedule paused" : "Schedule activated"); }}
                              className="px-3 py-1 rounded-lg" style={{ fontSize: 10, fontWeight: 600, color: "#00C8E0", background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)", cursor: "pointer" }}>
                              {sched.active ? "Pause" : "Activate"}
                            </button>
                          </div>
                        </div>
                      ))}
                      <button onClick={() => { hapticSuccess(); toast.success("Schedule builder opening", { description: "Configure auto-generated report delivery" }); }}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl"
                        style={{ background: "rgba(0,200,224,0.06)", border: "1px dashed rgba(0,200,224,0.2)", fontSize: 12, fontWeight: 600, color: "#00C8E0", cursor: "pointer" }}>
                        <Plus className="size-4" /> Add Scheduled Report
                      </button>
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
                      <p className="text-white" style={{ fontSize: 17, fontWeight: 800 }}>Full Billing Dashboard</p>
                      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 3 }}>View invoices, change plans, and manage payment methods</p>
                    </div>
                    <ChevronRight className="size-5" style={{ color: "rgba(0,200,224,0.5)" }} />
                  </motion.button>
                  {companyState && (
                    <div className="p-6 rounded-2xl" style={{ background: `${companyState.planConfig.color}08`, border: `1px solid ${companyState.planConfig.color}25` }}>
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <p style={{ fontSize: 11, fontWeight: 700, color: companyState.planConfig.color, letterSpacing: "1.5px" }}>CURRENT PLAN</p>
                          <p className="text-white mt-1" style={{ fontSize: 24, fontWeight: 900 }}>{companyState.planConfig.label}</p>
                        </div>
                        <p style={{ fontSize: 32, fontWeight: 900, color: companyState.planConfig.color }}>${companyState.planConfig.price}<span style={{ fontSize: 14, fontWeight: 400, color: "rgba(255,255,255,0.3)" }}>/seat/mo</span></p>
                      </div>
                      <div className="flex justify-between mb-2">
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Seat Usage</span>
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
            ownerNameHint={ownerName}
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
                  <span className="text-white" style={{ fontSize: 12, fontWeight: 600 }}>Hybrid Mode</span>
                  <span className="px-1.5 py-0.5 rounded" style={{ fontSize: 7, fontWeight: 700, color: toggles.hybridMode ? "#7B5EFF" : "rgba(255,255,255,0.2)", background: toggles.hybridMode ? "rgba(123,94,255,0.12)" : "rgba(255,255,255,0.04)" }}>
                    {toggles.hybridMode ? "MULTI-SITE" : "HQ ONLY"}
                  </span>
                </div>
                <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", marginTop: 1 }}>Enable for companies with external field zones</p>
              </div>
              <button onClick={() => toggle("hybridMode")} className="w-9 h-5 rounded-full relative transition-all"
                style={{ background: toggles.hybridMode ? "rgba(123,94,255,0.5)" : "rgba(255,255,255,0.08)" }}>
                <motion.div animate={{ x: toggles.hybridMode ? 16 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  className="absolute top-0.5 left-0.5 size-4 rounded-full" style={{ background: toggles.hybridMode ? "#7B5EFF" : "rgba(255,255,255,0.3)" }} />
              </button>
            </div>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
            {renderRow(Timer, tr("st.checkin"), "30 min", "#FF9500")}
            {renderRow(Radio, tr("st.alertChain"), "3 levels", "#FF2D55")}
            {renderToggle("geofencing", tr("st.geo"), MapPin, "#00C8E0", tr("st.autoZoneTrack"))}
            {renderToggle("sosHold", tr("st.sos"), Shield, "#FF2D55", tr("st.holdToTrigger"))}
            {renderToggle("autoEscalation", tr("st.autoEsc"), Zap, "#FF9500", tr("st.autoEscDesc"))}
          </div>
          {lang && onLangChange && (
            <div>
              <p className="mb-2" style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: "1px" }}>
                {tr("st.lang").toUpperCase()} — 12 LANGUAGES
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
              <Send className="size-3.5" /> Invite User
            </button>
            <button onClick={() => setAccessSubPage("createRole")}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl"
              style={{ background: "rgba(175,82,222,0.08)", border: "1px solid rgba(175,82,222,0.15)", fontSize: 11, fontWeight: 600, color: "#AF52DE" }}>
              <Plus className="size-3.5" /> Create Role
            </button>
          </div>
          <SectionHeader title={`Role — Role Management`} icon={Users} color="#AF52DE" />
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
                    <span style={{ fontSize: 8, color: "rgba(255,255,255,0.15)", marginLeft: 6 }}>Tier {cfg.tier}</span>
                  </div>
                  {isActive && <CheckCircle2 className="size-3.5 flex-shrink-0" style={{ color: cfg.color }} />}
                </button>
              );
            })}
          </div>
          {authState && (
            <>
              <SectionHeader title="Permissions" icon={Lock} color="#FF9500" />
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
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{authState.permissions.length} permissions granted</span>
                </div>
              </DSCard>
            </>
          )}
          {companyState && (
            <>
              <SectionHeader title="Plan & Billing" icon={BarChart3} color="#00C8E0" />
              <DSCard padding={12}>
                <div className="flex items-center justify-between mb-2">
                  <span style={{ fontSize: 12, fontWeight: 700, color: companyState.planConfig.color }}>{companyState.planConfig.label}</span>
                  <Badge color={companyState.planConfig.color}>${companyState.planConfig.price}/mo</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[{ label: "EMPLOYEES", value: companyState.company.employeeCount, color: "#00C8E0" }, { label: "MAX ZONES", value: companyState.planConfig.maxZones === -1 ? "∞" : companyState.planConfig.maxZones, color: "#FF9500" }, { label: "FEATURES", value: companyState.planConfig.features.length, color: "#34C759" }].map(s => (
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
        <CreateCustomRolePage onBack={() => setAccessSubPage("list")} />
      )}

      {/* Security Tab */}
      {activeTab === "security" && (
        <div className="space-y-3">
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
            {renderToggle("twoFA", tr("st.twoFA"), Lock, "#00C853", tr("st.twoFADesc"))}
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
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0" }}>Full Billing Dashboard</p>
                  <p style={{ fontSize: 9, color: "rgba(0,200,224,0.5)" }}>Invoices · Plans · Payment Methods</p>
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
                <span style={{ fontSize: 13, fontWeight: 700, color: planColor }}>{planLabel} Plan</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[{ label: "per emp/mo", value: planPrice > 0 ? `$${planPrice.toFixed(2)}` : "Custom", color: "rgba(255,255,255,0.9)" }, { label: "employees", value: String(empCount), color: "#00C8E0" }, { label: "monthly", value: totalMonthly > 0 ? `$${totalMonthly}` : "Custom", color: "#00C853" }].map(s => (
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
              <span style={{ fontSize: 13, fontWeight: 700, color: "#00C8E0" }}>No Plan Data</span>
            </div>
          </DSCard>
          )}
        </div>
      )}

      {/* Reports Tab (Mobile) */}
      {activeTab === "reports" && (
        <div className="space-y-3">
          {/* SUPABASE_MIGRATION_POINT: mobileDeliveryLog → supabase.from('email_deliveries').select('*').eq('company_id', companyId).order('sent_at', { ascending: false }).limit(4) */}
          <SectionHeader title="Email Delivery Log" icon={Send} color="#00C8E0" />
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
          <SectionHeader title="Scheduled Reports" icon={Timer} color="#FF9500" />
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
                  <Badge color={s.active ? "#00C853" : "rgba(255,255,255,0.3)"}>{s.active ? "ACTIVE" : "PAUSED"}</Badge>
                </div>
              ))}
            </div>
          </DSCard>
        </div>
      )}

      {/* ── Invite User Modal ── */}
      <AnimatePresence>
        {showInviteUser && <InviteUserModal onClose={() => setShowInviteUser(false)} />}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Invite User Modal
// ═══════════════════════════════════════════════════════════════
export function InviteUserModal({ onClose }: { onClose: () => void }) {
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
              <h3 className="text-white" style={{ fontSize: 15, fontWeight: 700 }}>Invite User</h3>
            </div>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Send an invitation to a new employee</p>
          </div>
          <button onClick={onClose} className="size-7 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <X className="size-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
          </button>
        </div>
        <div className="px-5 pb-5 space-y-4">
          <div>
            <label style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.8px", textTransform: "uppercase" }}>Email Address</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com"
              className="w-full mt-1.5 px-3 py-2.5 rounded-xl text-white outline-none"
              style={{ fontSize: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(0,200,224,0.2)" }} />
          </div>
          <div>
            <label style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.8px", textTransform: "uppercase" }}>Role</label>
            <select value={role} onChange={e => setRole(e.target.value)}
              className="w-full mt-1.5 px-3 py-2.5 rounded-xl text-white outline-none"
              style={{ fontSize: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <option value="Employee">Employee</option>
              <option value="Supervisor">Supervisor</option>
              <option value="Safety Officer">Safety Officer</option>
              <option value="Operations Manager">Operations Manager</option>
              <option value="Company Admin">Company Admin</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.8px", textTransform: "uppercase" }}>Assigned Zone(s)</label>
            <p style={{ fontSize: 8, color: "rgba(255,255,255,0.15)", marginTop: 2, marginBottom: 6 }}>
              Employee will see "Attend" button when they enter the zone radius
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
                  GPS proximity attend enabled for: {selectedZones.join(", ")}
                </span>
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl"
              style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>Cancel</button>
            <button className="flex-1 py-2.5 rounded-xl flex items-center justify-center gap-1.5"
              style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: email.trim() ? "linear-gradient(135deg, #00C8E0 0%, #0088A0 100%)" : "rgba(255,255,255,0.05)", opacity: email.trim() ? 1 : 0.5 }}
              onClick={() => {
                if (email.trim()) {
                  // Persist zone assignment for each selected zone
                  const empId = `EMP-${Date.now()}`;
                  selectedZones.forEach(z => assignEmployeeZone(empId, z));
                  onClose();
                }
              }}>
              <Send className="size-3.5" /> Send Invitation
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
    id: "dashboard", label: "Dashboard", tag: "WEB APP",
    perms: [
      { id: "users", label: "Users", total: 5 },
      { id: "invitations", label: "Invitations", total: 3 },
      { id: "zones", label: "Zones", total: 4 },
      { id: "attendance", label: "Attendance", total: 2 },
      { id: "emergencies", label: "Emergencies", total: 3 },
      { id: "settings", label: "Settings", total: 3 },
    ],
  },
  {
    id: "mobile", label: "Mobile App", tag: "MOBILE",
    perms: [
      { id: "sos", label: "SOS Trigger", total: 2 },
      { id: "checkin", label: "Check-in", total: 2 },
      { id: "map", label: "Map View", total: 2 },
      { id: "reports", label: "Reports", total: 3 },
    ],
  },
];

export function CreateCustomRolePage({ onBack }: { onBack: () => void }) {
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
      <motion.div animate={{ x: on ? 18 : 2 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}
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
          <h2 className="text-white" style={{ fontSize: 15, fontWeight: 700 }}>Create Custom Role</h2>
          <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Define role name, permissions, and platform access</p>
        </div>
      </div>

      {/* Role Info */}
      <div>
        <p style={{ fontSize: 9, fontWeight: 700, color: "#00C8E0", letterSpacing: "1px", marginBottom: 8 }}>ROLE INFO</p>
        <div className="rounded-xl overflow-hidden space-y-px" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
          {[
            { label: "Role Name", value: roleName, onChange: setRoleName, placeholder: "e.g. Field Supervisor" },
            { label: "Description", value: description, onChange: setDescription, placeholder: "Brief description..." },
          ].map(f => (
            <div key={f.label} className="px-3 py-3" style={{ background: "rgba(255,255,255,0.02)" }}>
              <label style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>{f.label}</label>
              <input value={f.value} onChange={e => f.onChange(e.target.value)} placeholder={f.placeholder}
                className="w-full mt-1.5 bg-transparent text-white outline-none"
                style={{ fontSize: 12, borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 4 }} />
            </div>
          ))}
          <div className="px-3 py-3" style={{ background: "rgba(255,255,255,0.02)" }}>
            <label style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>Clone from (optional)</label>
            <select value={cloneFrom} onChange={e => setCloneFrom(e.target.value)}
              className="w-full mt-1.5 bg-transparent text-white outline-none" style={{ fontSize: 12 }}>
              <option value="none">— None —</option>
              <option value="employee">Employee</option>
              <option value="supervisor">Supervisor</option>
              <option value="safety_officer">Safety Officer</option>
              <option value="company_admin">Company Admin</option>
            </select>
          </div>
        </div>
      </div>

      {/* Access Configuration */}
      <div>
        <p style={{ fontSize: 9, fontWeight: 700, color: "#00C8E0", letterSpacing: "1px", marginBottom: 8 }}>ACCESS CONFIGURATION</p>
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="px-3 py-2.5 flex items-center gap-2" style={{ background: "rgba(0,200,224,0.04)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <Globe className="size-3.5" style={{ color: "#00C8E0" }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "#00C8E0" }}>Platform Access</span>
          </div>
          <div className="flex items-center gap-3 px-3 py-3" style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
            <LayoutDashboard className="size-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", flex: 1 }}>Web Dashboard</span>
            <ToggleSwitch on={webDashboard} onToggle={() => setWebDashboard(v => !v)} color="#00C8E0" />
          </div>
          <div className="flex items-center gap-3 px-3 py-3" style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
            <Phone className="size-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", flex: 1 }}>Mobile App</span>
            <ToggleSwitch on={mobileApp} onToggle={() => setMobileApp(v => !v)} color="#00C853" />
          </div>
          <div className="px-3 py-3" style={{ background: "rgba(255,255,255,0.02)" }}>
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="size-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Zone Scope</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["all", "assigned"] as const).map(scope => (
                <button key={scope} onClick={() => setZoneScope(scope)} className="py-2 rounded-lg"
                  style={{ fontSize: 10, fontWeight: 600, background: zoneScope === scope ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.03)", border: `1px solid ${zoneScope === scope ? "rgba(0,200,224,0.3)" : "rgba(255,255,255,0.06)"}`, color: zoneScope === scope ? "#00C8E0" : "rgba(255,255,255,0.35)" }}>
                  {scope === "all" ? "All Zones" : "Assigned Zones"}<br />
                  <span style={{ fontSize: 8, fontWeight: 400, opacity: 0.7 }}>{scope === "all" ? "Full access" : "Restricted"}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Permissions */}
      <div>
        <p style={{ fontSize: 9, fontWeight: 700, color: "#00C8E0", letterSpacing: "1px", marginBottom: 4 }}>PERMISSIONS</p>
        {!webDashboard && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl mb-3"
            style={{ background: "rgba(255,149,0,0.08)", border: "1px solid rgba(255,149,0,0.15)" }}>
            <TriangleAlert className="size-3.5 flex-shrink-0 mt-0.5" style={{ color: "#FF9500" }} />
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: "#FF9500" }}>Dashboard Permissions Disabled</p>
              <p style={{ fontSize: 8, color: "rgba(255,149,0,0.7)", marginTop: 1 }}>Enable Web Dashboard Access to manage dashboard permissions</p>
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
                  <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.8)", flex: 1, textAlign: "left" }}>{mod.label}</span>
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
                            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", flex: 1 }}>{perm.label}</span>
                            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>({permGranted}/{perm.total})</span>
                            <button onClick={() => selectAll(mod.id)} className="px-2 py-0.5 rounded"
                              style={{ fontSize: 8, fontWeight: 600, color: "#00C8E0", background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>
                              Select all
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
          style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>Cancel</button>
        <button className="flex-1 py-2.5 rounded-xl"
          style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: roleName.trim() ? "linear-gradient(135deg, #AF52DE 0%, #7B2FBE 100%)" : "rgba(255,255,255,0.05)", opacity: roleName.trim() ? 1 : 0.5 }}
          onClick={() => { if (roleName.trim()) onBack(); }}>Create Role</button>
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
function MFAControlSection() {
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
    if (!window.confirm("Disable two-factor authentication?\n\nYour account will be protected by password only — significantly less secure. Continue?")) return;
    setBusy(true);
    const { error } = await mfaUnenroll(factorId);
    setBusy(false);
    if (error) {
      toast.error("Could not disable", { description: error.message });
      return;
    }
    toast.success("Two-factor authentication disabled");
    await refresh();
  };

  const handleRegenerate = async () => {
    if (!window.confirm("Generate new recovery codes?\n\nYour current codes will stop working immediately.")) return;
    setBusy(true);
    const { data, error } = await mfaGenerateRecoveryCodes();
    setBusy(false);
    if (error || !data) {
      toast.error("Could not generate codes", { description: error?.message });
      return;
    }
    // Simple alert — for full UX this would route through the modal too.
    toast.success("8 new codes generated", { description: "Check the modal — copy or download immediately." });
    // Show the modal in a state where user can see codes? For brevity here we
    // open the system clipboard with codes joined.
    try { await navigator.clipboard.writeText(data.codes.join("\n")); toast.success("Copied to clipboard"); } catch (_) { /* */ }
    await refresh();
  };

  return (
    <>
      {showEnroll && (
        <MFAEnrollmentModal
          onComplete={async () => { setShowEnroll(false); await refresh(); toast.success("Two-factor authentication enabled"); }}
          onCancel  ={async () => { setShowEnroll(false); await refresh(); }}
        />
      )}
      <div className="flex items-center justify-between py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
            <p className="text-white" style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Two-Factor Authentication (2FA)</p>
            {status === "on" && (
              <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4, background: "rgba(0,200,83,0.12)", color: "#00C853", border: "1px solid rgba(0,200,83,0.25)", letterSpacing: 0.5 }}>ACTIVE</span>
            )}
          </div>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: 0 }}>
            {status === "loading" && "Checking status…"}
            {status === "off" && "Add a 6-digit code from your authenticator app at every sign-in."}
            {status === "on" && (recoveryRemaining > 0
              ? `${recoveryRemaining} unused recovery code${recoveryRemaining === 1 ? "" : "s"}.`
              : "No recovery codes — generate a fresh set so you can sign in if you lose your device.")}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {status === "off" && (
            <button onClick={() => setShowEnroll(true)} disabled={busy}
              style={{ padding: "8px 14px", borderRadius: 12, background: "linear-gradient(135deg, #00C8E0, #00A5C0)", color: "#03131A", fontSize: 12, fontWeight: 800, border: "none", cursor: busy ? "default" : "pointer" }}>
              Set up
            </button>
          )}
          {status === "on" && (
            <>
              <button onClick={handleRegenerate} disabled={busy}
                style={{ padding: "8px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: 700, border: "1px solid rgba(255,255,255,0.06)", cursor: busy ? "default" : "pointer" }}>
                {recoveryRemaining > 0 ? "Regenerate codes" : "Generate codes"}
              </button>
              <button onClick={handleDisable} disabled={busy}
                style={{ padding: "8px 12px", borderRadius: 12, background: "rgba(255,45,85,0.06)", color: "#FF2D55", fontSize: 11, fontWeight: 700, border: "1px solid rgba(255,45,85,0.2)", cursor: busy ? "default" : "pointer" }}>
                Disable
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

