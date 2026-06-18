// ═══════════════════════════════════════════════════════════════
// SOSphere — Platform Super-Admin Console (standalone, gated)
// ─────────────────────────────────────────────────────────────
// Route: /super-admin
// Access: ONLY users present in public.platform_admins, verified
//         SERVER-SIDE via the is_platform_admin() RPC (SECURITY
//         DEFINER). The client never trusts an email string — the
//         gate is the database's answer, not the browser's.
// Bilingual (Arabic / English) via useLang().
// Built step-by-step: v1 = secure gate + shell + overview.
// ═══════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { supabase } from "./api/supabase-client";
import { useLang } from "./useLang";
import {
  ShieldCheck, LogOut, LayoutDashboard, Building2, Users,
  CreditCard, SlidersHorizontal, Lock, Loader2, AlertTriangle, Globe,
  KeyRound, UserPlus, Trash2, ScrollText, Check,
} from "lucide-react";

type Gate = "checking" | "anon" | "denied" | "granted";

interface CompanyRow {
  id: string;
  name: string | null;
  plan: string | null;
  is_active: boolean | null;
  admin_email: string | null;
  industry: string | null;
  country: string | null;
  billing_cycle: string | null;
  trial_ends_at: string | null;
  created_at: string | null;
  members: number;
  active_emergencies: number;
}

interface UserRow {
  id: string;
  user_id: string | null;
  full_name: string | null;
  email: string | null;
  role: string | null;
  user_type: string | null;
  status: string | null;
  company_id: string | null;
  company_name: string | null;
  created_at: string | null;
  tier: string | null;
  sub_status: string | null;
}

interface SubRow {
  user_id: string | null;
  company_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  scope: string | null;
  tier: string | null;
  status: string | null;
  current_period_end: string | null;
  manual: boolean | null;
  updated_at: string | null;
}

interface AdminRow { user_id: string; email: string | null; created_at: string | null; is_self: boolean; }
interface PlanRow { tier: string; scope: string; active: number; total: number; }
interface AuditRow { id: number; actor_email: string | null; action: string; target: string | null; detail: Record<string, unknown> | null; created_at: string; }

const BG = "#05070E";
const PANEL = "rgba(255,255,255,0.02)";
const BORDER = "1px solid rgba(255,255,255,0.06)";
const ACCENT = "#00C8E0";

export function SuperAdminConsole() {
  const { isAr } = useLang();
  const tr = (en: string, ar: string) => (isAr ? ar : en);
  const dir = isAr ? "rtl" : "ltr";

  const [gate, setGate] = useState<Gate>("checking");
  const [email, setEmail] = useState("");
  const [section, setSection] = useState("overview");

  // overview KPIs (platform-wide, via platform_overview RPC)
  const [ov, setOv] = useState<Record<string, number> | null>(null);
  const [ovErr, setOvErr] = useState("");
  const [ovLoading, setOvLoading] = useState(false);

  // companies (via platform_companies RPC)
  const [companies, setCompanies] = useState<CompanyRow[] | null>(null);
  const [coErr, setCoErr] = useState("");
  const [coLoading, setCoLoading] = useState(false);

  // users (via platform_users RPC)
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [usErr, setUsErr] = useState("");
  const [usLoading, setUsLoading] = useState(false);
  const [usQuery, setUsQuery] = useState("");

  // subscriptions (via platform_subscriptions RPC)
  const [subs, setSubs] = useState<SubRow[] | null>(null);
  const [subErr, setSubErr] = useState("");
  const [subLoading, setSubLoading] = useState(false);

  // manual civilian upgrade tool
  const [upPick, setUpPick] = useState<UserRow | null>(null);
  const [upQuery, setUpQuery] = useState("");
  const [upTier, setUpTier] = useState<"basic" | "elite" | "free">("basic");
  const [upDur, setUpDur] = useState<"1month" | "2months" | "lifetime">("1month");
  const [upBusy, setUpBusy] = useState(false);
  const [upMsg, setUpMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // platform tools
  const [admins, setAdmins] = useState<AdminRow[] | null>(null);
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [toolsErr, setToolsErr] = useState("");
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminMsg, setAdminMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwCur, setPwCur] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // login form
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [busy, setBusy] = useState(false);

  const checkAccess = useCallback(async () => {
    setGate("checking");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { setGate("anon"); return; }
    setEmail(session.user.email || "");
    try {
      const { data, error } = await supabase.rpc("is_platform_admin");
      setGate(!error && data === true ? "granted" : "denied");
    } catch { setGate("denied"); }
  }, []);

  useEffect(() => { void checkAccess(); }, [checkAccess]);

  const loadOverview = useCallback(async () => {
    setOvLoading(true); setOvErr("");
    try {
      const { data, error } = await supabase.rpc("platform_overview");
      if (error) setOvErr(error.message);
      else setOv(data as Record<string, number>);
    } catch (e) {
      setOvErr(e instanceof Error ? e.message : String(e));
    } finally {
      setOvLoading(false);
    }
  }, []);

  useEffect(() => {
    if (gate === "granted" && section === "overview" && ov === null && !ovLoading) {
      void loadOverview();
    }
  }, [gate, section, ov, ovLoading, loadOverview]);

  const loadCompanies = useCallback(async () => {
    setCoLoading(true); setCoErr("");
    try {
      const { data, error } = await supabase.rpc("platform_companies");
      if (error) setCoErr(error.message);
      else setCompanies((data as CompanyRow[]) || []);
    } catch (e) {
      setCoErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCoLoading(false);
    }
  }, []);

  useEffect(() => {
    if (gate === "granted" && section === "companies" && companies === null && !coLoading) {
      void loadCompanies();
    }
  }, [gate, section, companies, coLoading, loadCompanies]);

  const loadUsers = useCallback(async () => {
    setUsLoading(true); setUsErr("");
    try {
      const { data, error } = await supabase.rpc("platform_users");
      if (error) setUsErr(error.message);
      else setUsers((data as UserRow[]) || []);
    } catch (e) {
      setUsErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (gate === "granted" && section === "users" && users === null && !usLoading) {
      void loadUsers();
    }
  }, [gate, section, users, usLoading, loadUsers]);

  const loadSubs = useCallback(async () => {
    setSubLoading(true); setSubErr("");
    try {
      const { data, error } = await supabase.rpc("platform_subscriptions");
      if (error) setSubErr(error.message);
      else setSubs((data as SubRow[]) || []);
    } catch (e) {
      setSubErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubLoading(false);
    }
  }, []);

  useEffect(() => {
    if (gate === "granted" && section === "subscriptions") {
      if (subs === null && !subLoading) void loadSubs();
      if (users === null && !usLoading) void loadUsers();
    }
  }, [gate, section, subs, subLoading, loadSubs, users, usLoading, loadUsers]);

  const loadTools = useCallback(async () => {
    setToolsErr("");
    try {
      const [a, p, l] = await Promise.all([
        supabase.rpc("platform_list_admins"),
        supabase.rpc("platform_plans_overview"),
        supabase.rpc("platform_audit_list"),
      ]);
      if (a.error || p.error || l.error) {
        setToolsErr((a.error || p.error || l.error)?.message || "error");
      } else {
        setAdmins((a.data as AdminRow[]) || []);
        setPlans((p.data as PlanRow[]) || []);
        setAudit((l.data as AuditRow[]) || []);
      }
    } catch (e) {
      setToolsErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (gate === "granted" && section === "tools" && admins === null) {
      void loadTools();
    }
  }, [gate, section, admins, loadTools]);

  const addAdmin = async () => {
    if (!newAdminEmail.trim()) return;
    setAdminBusy(true); setAdminMsg(null);
    try {
      const { data, error } = await supabase.rpc("platform_add_admin", { p_email: newAdminEmail.trim() });
      if (error) setAdminMsg({ ok: false, text: error.message });
      else {
        const r = data as { email?: string };
        setAdminMsg({ ok: true, text: tr(`Added ${r.email} as super-admin.`, `أُضيف ${r.email} كسوبر-أدمن.`) });
        setNewAdminEmail(""); setAdmins(null); setAudit(null);
      }
    } catch (e) { setAdminMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setAdminBusy(false); }
  };

  const removeAdmin = async (u: AdminRow) => {
    setAdminBusy(true); setAdminMsg(null);
    try {
      const { error } = await supabase.rpc("platform_remove_admin", { p_user_id: u.user_id });
      if (error) setAdminMsg({ ok: false, text: error.message });
      else { setAdminMsg({ ok: true, text: tr(`Removed ${u.email}.`, `أُزيل ${u.email}.`) }); setAdmins(null); setAudit(null); }
    } catch (e) { setAdminMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setAdminBusy(false); }
  };

  const changePassword = async () => {
    if (!pwCur) { setPwMsg({ ok: false, text: tr("Enter your current password.", "أدخل كلمة المرور الحالية.") }); return; }
    if (pw1.length < 8) { setPwMsg({ ok: false, text: tr("New password must be at least 8 characters.", "كلمة المرور الجديدة 8 أحرف على الأقل.") }); return; }
    if (pw1 !== pw2) { setPwMsg({ ok: false, text: tr("Passwords do not match.", "كلمتا المرور غير متطابقتين.") }); return; }
    setPwBusy(true); setPwMsg(null);
    try {
      const { data, error } = await supabase.rpc("platform_change_my_password", { p_current: pwCur, p_new: pw1 });
      if (error) {
        const incorrect = /incorrect|28P01/i.test(error.message);
        setPwMsg({ ok: false, text: incorrect
          ? tr("Current password is incorrect.", "كلمة المرور الحالية غير صحيحة.")
          : error.message });
      } else if ((data as { ok?: boolean })?.ok) {
        setPwMsg({ ok: true, text: tr("Password changed successfully.", "تم تغيير كلمة المرور بنجاح.") });
        setPwCur(""); setPw1(""); setPw2(""); setAudit(null);
      }
    } catch (e) { setPwMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setPwBusy(false); }
  };

  const applyUpgrade = async () => {
    if (!upPick?.user_id) return;
    setUpBusy(true); setUpMsg(null);
    try {
      const { data, error } = await supabase.rpc("platform_set_civilian_subscription", {
        p_user_id: upPick.user_id,
        p_tier: upTier,
        p_duration: upDur,
      });
      if (error) { setUpMsg({ ok: false, text: error.message }); }
      else {
        const r = data as { tier?: string; current_period_end?: string };
        setUpMsg({ ok: true, text: tr(
          `Done — ${upPick.full_name || upPick.email} is now ${r.tier}.`,
          `تمّ — ${upPick.full_name || upPick.email} صار ${r.tier}.`) });
        setSubs(null); setUsers(null); setUpPick(null); setUpQuery("");
      }
    } catch (e) {
      setUpMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setUpBusy(false);
    }
  };

  const doLogin = async () => {
    if (!loginEmail.trim() || !loginPass) return;
    setBusy(true); setLoginErr("");
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail.trim(), password: loginPass });
    setBusy(false);
    if (error) setLoginErr(error.message);
    else { setLoginPass(""); void checkAccess(); }
  };
  const doLogout = async () => { await supabase.auth.signOut(); setLoginEmail(""); setGate("anon"); };

  const center: CSSProperties = {
    minHeight: "100vh", background: BG, color: "#fff", direction: dir,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontFamily: "'Tajawal','Outfit',sans-serif", padding: 24,
  };

  // ── Checking ──────────────────────────────────────────────
  if (gate === "checking") {
    return (
      <div style={center}>
        <div style={{ textAlign: "center" }}>
          <Loader2 className="size-8" style={{ color: ACCENT, animation: "spin 1s linear infinite", margin: "0 auto" }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          <p style={{ marginTop: 14, color: "rgba(255,255,255,0.5)", fontSize: 14 }}>
            {tr("Verifying super-admin access…", "جارٍ التحقّق من صلاحية السوبر-أدمن…")}
          </p>
        </div>
      </div>
    );
  }

  // ── Anonymous → login ─────────────────────────────────────
  if (gate === "anon") {
    return (
      <div style={center}>
        <div style={{ width: 380, maxWidth: "100%", background: PANEL, border: BORDER, borderRadius: 20, padding: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <ShieldCheck className="size-6" style={{ color: ACCENT }} />
            <h1 style={{ fontSize: 18, fontWeight: 800 }}>{tr("Super-Admin Sign in", "دخول السوبر-أدمن")}</h1>
          </div>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 18 }}>
            {tr("Restricted to platform administrators.", "مقصور على مشرفي المنصّة.")}
          </p>
          <input
            type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} dir="ltr"
            placeholder={tr("Email", "البريد الإلكتروني")}
            style={{ width: "100%", boxSizing: "border-box", marginBottom: 10, padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: BORDER, color: "#fff", fontSize: 14, outline: "none" }}
          />
          <input
            type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} dir="ltr"
            onKeyDown={e => { if (e.key === "Enter") void doLogin(); }}
            placeholder={tr("Password", "كلمة المرور")}
            style={{ width: "100%", boxSizing: "border-box", marginBottom: 14, padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: BORDER, color: "#fff", fontSize: 14, outline: "none" }}
          />
          {loginErr && (
            <p style={{ fontSize: 12, color: "#FF6B6B", marginBottom: 12 }}>{loginErr}</p>
          )}
          <button
            onClick={() => void doLogin()} disabled={busy}
            style={{ width: "100%", padding: "12px", borderRadius: 12, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#03212a", background: `linear-gradient(135deg, ${ACCENT}, #00A6C0)` }}
          >
            {busy ? tr("Signing in…", "جارٍ الدخول…") : tr("Sign in", "تسجيل الدخول")}
          </button>
        </div>
      </div>
    );
  }

  // ── Denied ────────────────────────────────────────────────
  if (gate === "denied") {
    return (
      <div style={center}>
        <div style={{ width: 400, maxWidth: "100%", textAlign: "center", background: PANEL, border: "1px solid rgba(255,45,85,0.2)", borderRadius: 20, padding: 32 }}>
          <Lock className="size-9" style={{ color: "#FF2D55", margin: "0 auto 12px" }} />
          <h1 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{tr("Access denied", "تم رفض الوصول")}</h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginBottom: 6 }}>
            {tr("This account is not a platform super-admin.", "هذا الحساب ليس سوبر-أدمن للمنصّة.")}
          </p>
          {email && <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginBottom: 18 }} dir="ltr">{email}</p>}
          <button onClick={() => void doLogout()} style={{ padding: "10px 18px", borderRadius: 12, border: BORDER, background: "rgba(255,255,255,0.04)", color: "#fff", cursor: "pointer", fontSize: 13 }}>
            {tr("Sign out", "تسجيل الخروج")}
          </button>
        </div>
      </div>
    );
  }

  // ── Granted → console ─────────────────────────────────────
  const NAV: { id: string; en: string; ar: string; icon: typeof Globe }[] = [
    { id: "overview", en: "Overview", ar: "نظرة عامة", icon: LayoutDashboard },
    { id: "companies", en: "Companies", ar: "الشركات", icon: Building2 },
    { id: "users", en: "Users", ar: "المستخدمون", icon: Users },
    { id: "subscriptions", en: "Subscriptions", ar: "الاشتراكات", icon: CreditCard },
    { id: "tools", en: "Platform Tools", ar: "أدوات المنصّة", icon: SlidersHorizontal },
  ];

  return (
    <div style={{ height: "100vh", overflow: "hidden", background: BG, color: "#fff", direction: dir, display: "flex", fontFamily: "'Tajawal','Outfit',sans-serif" }}>
      {/* Sidebar */}
      <aside style={{ width: 240, flexShrink: 0, borderInlineEnd: BORDER, background: "rgba(255,255,255,0.015)", padding: "20px 14px", display: "flex", flexDirection: "column", gap: 6, overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 18px" }}>
          <div style={{ width: 36, height: 36, borderRadius: 11, background: `${ACCENT}18`, border: `1px solid ${ACCENT}30`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ShieldCheck className="size-5" style={{ color: ACCENT }} />
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 800, lineHeight: 1 }}>{tr("Super-Admin", "السوبر-أدمن")}</p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 3 }}>{tr("Platform control", "تحكّم المنصّة")}</p>
          </div>
        </div>
        {NAV.map(n => {
          const active = section === n.id;
          return (
            <button key={n.id} onClick={() => setSection(n.id)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, border: active ? `1px solid ${ACCENT}25` : "1px solid transparent", background: active ? `${ACCENT}10` : "transparent", color: active ? ACCENT : "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: 13, fontWeight: active ? 700 : 500, textAlign: isAr ? "right" : "left" }}>
              <n.icon className="size-4" style={{ flexShrink: 0 }} />
              {tr(n.en, n.ar)}
            </button>
          );
        })}
        <div style={{ marginTop: "auto", borderTop: BORDER, paddingTop: 12 }}>
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", padding: "0 8px 8px" }} dir="ltr">{email}</p>
          <button onClick={() => void doLogout()} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", width: "100%", borderRadius: 12, border: BORDER, background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 12 }}>
            <LogOut className="size-4" /> {tr("Sign out", "تسجيل الخروج")}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, minWidth: 0, minHeight: 0, padding: "28px 32px", overflowY: "auto" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.3px" }}>
              {tr(NAV.find(n => n.id === section)?.en || "", NAV.find(n => n.id === section)?.ar || "")}
            </h1>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
              {tr("Platform-wide control center", "مركز التحكّم على مستوى المنصّة")}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 999, background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.2)" }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: "#00C853" }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#00C853" }}>{tr("Verified", "موثّق")}</span>
          </div>
        </header>

        {section === "overview" ? (
          (() => {
            const fmt = (n: number | undefined) => (typeof n === "number" ? n.toLocaleString(isAr ? "ar-EG" : "en-US") : "—");
            const cards: { en: string; ar: string; key: string; sub?: string; subAr?: string; accent?: string }[] = [
              { en: "Companies", ar: "الشركات", key: "companies_total", sub: `${ov?.companies_active ?? "—"} active`, subAr: `${ov?.companies_active ?? "—"} نشطة` },
              { en: "Users", ar: "المستخدمون", key: "users_total", sub: `${ov?.users_company ?? "—"} company · ${ov?.users_civilian ?? "—"} civilian`, subAr: `${ov?.users_company ?? "—"} شركات · ${ov?.users_civilian ?? "—"} مدنيون` },
              { en: "Active Emergencies", ar: "الطوارئ النشطة", key: "emergencies_active", sub: `${ov?.emergencies_total ?? "—"} all-time`, subAr: `${ov?.emergencies_total ?? "—"} إجمالاً`, accent: "#FF2D55" },
              { en: "Active Subscriptions", ar: "الاشتراكات النشطة", key: "subs_active", sub: `${ov?.subs_basic ?? "—"} basic · ${ov?.subs_elite ?? "—"} elite · ${ov?.subs_company ?? "—"} company`, subAr: `${ov?.subs_basic ?? "—"} أساسي · ${ov?.subs_elite ?? "—"} نخبة · ${ov?.subs_company ?? "—"} شركات` },
            ];
            return (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                    {ovErr ? "" : tr("Live platform metrics", "مقاييس المنصّة الحيّة")}
                  </p>
                  <button onClick={() => { setOv(null); }} disabled={ovLoading}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 10, border: BORDER, background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 12 }}>
                    {ovLoading ? <Loader2 className="size-3.5" style={{ animation: "spin 1s linear infinite" }} /> : null}
                    {tr("Refresh", "تحديث")}
                  </button>
                </div>
                {ovErr ? (
                  <div style={{ background: PANEL, border: "1px solid rgba(255,45,85,0.2)", borderRadius: 16, padding: 24, textAlign: "center" }}>
                    <AlertTriangle className="size-6" style={{ color: "#FF2D55", margin: "0 auto 8px" }} />
                    <p style={{ fontSize: 13, fontWeight: 700 }}>{tr("Could not load metrics", "تعذّر تحميل المقاييس")}</p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 6 }} dir="ltr">{ovErr}</p>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
                    {cards.map(c => (
                      <div key={c.en} style={{ background: PANEL, border: BORDER, borderRadius: 16, padding: 18 }}>
                        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{tr(c.en, c.ar)}</p>
                        <p style={{ fontSize: 30, fontWeight: 900, marginTop: 8, color: c.accent || ACCENT }}>
                          {ovLoading && ov === null ? "…" : fmt(ov?.[c.key])}
                        </p>
                        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 6 }}>{tr(c.sub || "", c.subAr || "")}</p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            );
          })()
        ) : section === "companies" ? (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                {coErr ? "" : tr(`${companies?.length ?? "…"} ${(companies?.length ?? 0) === 1 ? "company" : "companies"} on the platform`, `${companies?.length ?? "…"} شركة على المنصّة`)}
              </p>
              <button onClick={() => setCompanies(null)} disabled={coLoading}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 10, border: BORDER, background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 12 }}>
                {coLoading ? <Loader2 className="size-3.5" style={{ animation: "spin 1s linear infinite" }} /> : null}
                {tr("Refresh", "تحديث")}
              </button>
            </div>
            {coErr ? (
              <div style={{ background: PANEL, border: "1px solid rgba(255,45,85,0.2)", borderRadius: 16, padding: 24, textAlign: "center" }}>
                <AlertTriangle className="size-6" style={{ color: "#FF2D55", margin: "0 auto 8px" }} />
                <p style={{ fontSize: 13, fontWeight: 700 }}>{tr("Could not load companies", "تعذّر تحميل الشركات")}</p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 6 }} dir="ltr">{coErr}</p>
              </div>
            ) : coLoading && companies === null ? (
              <div style={{ textAlign: "center", padding: 40 }}>
                <Loader2 className="size-7" style={{ color: ACCENT, animation: "spin 1s linear infinite", margin: "0 auto" }} />
              </div>
            ) : (companies && companies.length > 0) ? (
              <div style={{ background: PANEL, border: BORDER, borderRadius: 16, overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
                    <thead>
                      <tr style={{ textAlign: isAr ? "right" : "left", color: "rgba(255,255,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        <th style={{ padding: "12px 16px", fontWeight: 600 }}>{tr("Company", "الشركة")}</th>
                        <th style={{ padding: "12px 16px", fontWeight: 600 }}>{tr("Plan", "الخطة")}</th>
                        <th style={{ padding: "12px 16px", fontWeight: 600 }}>{tr("Members", "الأعضاء")}</th>
                        <th style={{ padding: "12px 16px", fontWeight: 600 }}>{tr("Active SOS", "طوارئ نشطة")}</th>
                        <th style={{ padding: "12px 16px", fontWeight: 600 }}>{tr("Status", "الحالة")}</th>
                        <th style={{ padding: "12px 16px", fontWeight: 600 }}>{tr("Country", "الدولة")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {companies.map(co => (
                        <tr key={co.id} style={{ borderTop: BORDER }}>
                          <td style={{ padding: "12px 16px" }}>
                            <div style={{ fontWeight: 700 }}>{co.name || tr("(unnamed)", "(بلا اسم)")}</div>
                            {co.admin_email && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }} dir="ltr">{co.admin_email}</div>}
                          </td>
                          <td style={{ padding: "12px 16px" }}>
                            <span style={{ padding: "3px 10px", borderRadius: 999, background: `${ACCENT}14`, color: ACCENT, fontSize: 11, fontWeight: 700, textTransform: "capitalize" }}>{co.plan || "free"}</span>
                          </td>
                          <td style={{ padding: "12px 16px", fontWeight: 700 }}>{co.members}</td>
                          <td style={{ padding: "12px 16px", fontWeight: 700, color: co.active_emergencies > 0 ? "#FF2D55" : "rgba(255,255,255,0.5)" }}>{co.active_emergencies}</td>
                          <td style={{ padding: "12px 16px" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: co.is_active ? "#00C853" : "rgba(255,255,255,0.4)" }}>
                              <span style={{ width: 7, height: 7, borderRadius: 999, background: co.is_active ? "#00C853" : "rgba(255,255,255,0.3)" }} />
                              {co.is_active ? tr("Active", "نشطة") : tr("Inactive", "غير نشطة")}
                            </span>
                          </td>
                          <td style={{ padding: "12px 16px", color: "rgba(255,255,255,0.55)" }}>{co.country || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div style={{ background: PANEL, border: BORDER, borderRadius: 16, padding: 40, textAlign: "center" }}>
                <Building2 className="size-7" style={{ color: "rgba(255,255,255,0.3)", margin: "0 auto 10px" }} />
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}>{tr("No companies yet", "لا توجد شركات بعد")}</p>
              </div>
            )}
          </>
        ) : section === "users" ? (
          (() => {
            const q = usQuery.trim().toLowerCase();
            const list = (users || []).filter(u =>
              !q ||
              (u.full_name || "").toLowerCase().includes(q) ||
              (u.email || "").toLowerCase().includes(q) ||
              (u.company_name || "").toLowerCase().includes(q));
            return (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
                  <input
                    value={usQuery} onChange={e => setUsQuery(e.target.value)}
                    placeholder={tr("Search name, email, company…", "ابحث بالاسم أو البريد أو الشركة…")}
                    style={{ flex: 1, minWidth: 220, padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: BORDER, color: "#fff", fontSize: 13, outline: "none" }}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                      {usErr ? "" : tr(`${list.length} of ${users?.length ?? "…"}`, `${list.length} من ${users?.length ?? "…"}`)}
                    </span>
                    <button onClick={() => setUsers(null)} disabled={usLoading}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 10, border: BORDER, background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 12 }}>
                      {usLoading ? <Loader2 className="size-3.5" style={{ animation: "spin 1s linear infinite" }} /> : null}
                      {tr("Refresh", "تحديث")}
                    </button>
                  </div>
                </div>
                {usErr ? (
                  <div style={{ background: PANEL, border: "1px solid rgba(255,45,85,0.2)", borderRadius: 16, padding: 24, textAlign: "center" }}>
                    <AlertTriangle className="size-6" style={{ color: "#FF2D55", margin: "0 auto 8px" }} />
                    <p style={{ fontSize: 13, fontWeight: 700 }}>{tr("Could not load users", "تعذّر تحميل المستخدمين")}</p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 6 }} dir="ltr">{usErr}</p>
                  </div>
                ) : usLoading && users === null ? (
                  <div style={{ textAlign: "center", padding: 40 }}>
                    <Loader2 className="size-7" style={{ color: ACCENT, animation: "spin 1s linear infinite", margin: "0 auto" }} />
                  </div>
                ) : (
                  <div style={{ background: PANEL, border: BORDER, borderRadius: 16, overflow: "hidden" }}>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 760 }}>
                        <thead>
                          <tr style={{ textAlign: isAr ? "right" : "left", color: "rgba(255,255,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            <th style={{ padding: "12px 16px", fontWeight: 600 }}>{tr("User", "المستخدم")}</th>
                            <th style={{ padding: "12px 16px", fontWeight: 600 }}>{tr("Role", "الدور")}</th>
                            <th style={{ padding: "12px 16px", fontWeight: 600 }}>{tr("Type", "النوع")}</th>
                            <th style={{ padding: "12px 16px", fontWeight: 600 }}>{tr("Company", "الشركة")}</th>
                            <th style={{ padding: "12px 16px", fontWeight: 600 }}>{tr("Plan", "الخطة")}</th>
                            <th style={{ padding: "12px 16px", fontWeight: 600 }}>{tr("Status", "الحالة")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map(u => (
                            <tr key={u.id} style={{ borderTop: BORDER }}>
                              <td style={{ padding: "12px 16px" }}>
                                <div style={{ fontWeight: 700 }}>{u.full_name || tr("(no name)", "(بلا اسم)")}</div>
                                {u.email && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }} dir="ltr">{u.email}</div>}
                              </td>
                              <td style={{ padding: "12px 16px", color: "rgba(255,255,255,0.6)" }}>{u.role || "—"}</td>
                              <td style={{ padding: "12px 16px", color: "rgba(255,255,255,0.6)" }}>{u.user_type || "—"}</td>
                              <td style={{ padding: "12px 16px", color: "rgba(255,255,255,0.6)" }}>{u.company_name || tr("Civilian", "مدني")}</td>
                              <td style={{ padding: "12px 16px" }}>
                                <span style={{ padding: "3px 10px", borderRadius: 999, background: u.tier ? `${ACCENT}14` : "rgba(255,255,255,0.05)", color: u.tier ? ACCENT : "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: 700, textTransform: "capitalize" }}>{u.tier || "free"}</span>
                              </td>
                              <td style={{ padding: "12px 16px" }}>
                                <span style={{ fontSize: 12, color: u.status === "active" ? "#00C853" : "rgba(255,255,255,0.45)" }}>{u.status || "—"}</span>
                              </td>
                            </tr>
                          ))}
                          {list.length === 0 && (
                            <tr><td colSpan={6} style={{ padding: 28, textAlign: "center", color: "rgba(255,255,255,0.4)", fontSize: 13 }}>{tr("No matching users", "لا مستخدمين مطابقين")}</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            );
          })()
        ) : section === "subscriptions" ? (
          (() => {
            const pickQ = upQuery.trim().toLowerCase();
            const picks = pickQ && !upPick
              ? (users || []).filter(u =>
                  (u.full_name || "").toLowerCase().includes(pickQ) ||
                  (u.email || "").toLowerCase().includes(pickQ)).slice(0, 6)
              : [];
            const durOpts: { id: "1month" | "2months" | "lifetime"; en: string; ar: string }[] = [
              { id: "1month", en: "1 month", ar: "شهر" },
              { id: "2months", en: "2 months", ar: "شهران" },
              { id: "lifetime", en: "Lifetime", ar: "مدى الحياة" },
            ];
            const tierOpts: { id: "basic" | "elite" | "free"; en: string; ar: string }[] = [
              { id: "basic", en: "Basic", ar: "أساسي" },
              { id: "elite", en: "Elite", ar: "نخبة" },
              { id: "free", en: "Free (revoke)", ar: "مجاني (إلغاء)" },
            ];
            return (
              <>
                {/* ── Manual upgrade tool ── */}
                <div style={{ background: PANEL, border: `1px solid ${ACCENT}25`, borderRadius: 16, padding: 20, marginBottom: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <CreditCard className="size-5" style={{ color: ACCENT }} />
                    <h3 style={{ fontSize: 15, fontWeight: 800 }}>{tr("Manual upgrade", "ترقية يدوية")}</h3>
                  </div>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 16 }}>
                    {tr("Grant a civilian a paid plan without Stripe.", "امنح مدنيّاً خطّة مدفوعة بدون Stripe.")}
                  </p>

                  {/* user picker */}
                  <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{tr("1 · Choose user", "١ · اختر المستخدم")}</label>
                  {upPick ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6, marginBottom: 14, padding: "10px 14px", borderRadius: 12, background: "rgba(255,255,255,0.04)", border: BORDER }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{upPick.full_name || tr("(no name)", "(بلا اسم)")}</div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }} dir="ltr">{upPick.email}</div>
                      </div>
                      <button onClick={() => { setUpPick(null); setUpMsg(null); }} style={{ padding: "5px 12px", borderRadius: 9, border: BORDER, background: "transparent", color: "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: 12 }}>{tr("Change", "تغيير")}</button>
                    </div>
                  ) : (
                    <div style={{ position: "relative", marginTop: 6, marginBottom: 14 }}>
                      <input
                        value={upQuery} onChange={e => setUpQuery(e.target.value)}
                        placeholder={tr("Search name or email…", "ابحث بالاسم أو البريد…")}
                        style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: BORDER, color: "#fff", fontSize: 13, outline: "none" }}
                      />
                      {picks.length > 0 && (
                        <div style={{ position: "absolute", zIndex: 10, top: "calc(100% + 4px)", insetInline: 0, background: "#0B0E16", border: BORDER, borderRadius: 12, overflow: "hidden", boxShadow: "0 8px 28px rgba(0,0,0,0.5)" }}>
                          {picks.map(u => (
                            <button key={u.id} onClick={() => { setUpPick(u); setUpQuery(""); setUpMsg(null); }}
                              style={{ display: "block", width: "100%", textAlign: isAr ? "right" : "left", padding: "10px 14px", border: "none", borderBottom: BORDER, background: "transparent", color: "#fff", cursor: "pointer" }}>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>{u.full_name || tr("(no name)", "(بلا اسم)")}</div>
                              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }} dir="ltr">{u.email}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* tier */}
                  <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{tr("2 · Plan", "٢ · الخطة")}</label>
                  <div style={{ display: "flex", gap: 8, marginTop: 6, marginBottom: 14, flexWrap: "wrap" }}>
                    {tierOpts.map(o => (
                      <button key={o.id} onClick={() => setUpTier(o.id)}
                        style={{ padding: "8px 16px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700, border: upTier === o.id ? `1px solid ${ACCENT}` : BORDER, background: upTier === o.id ? `${ACCENT}14` : "transparent", color: upTier === o.id ? ACCENT : "rgba(255,255,255,0.55)" }}>
                        {tr(o.en, o.ar)}
                      </button>
                    ))}
                  </div>

                  {/* duration (hidden when revoking) */}
                  {upTier !== "free" && (
                    <>
                      <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{tr("3 · Duration", "٣ · المدّة")}</label>
                      <div style={{ display: "flex", gap: 8, marginTop: 6, marginBottom: 14, flexWrap: "wrap" }}>
                        {durOpts.map(o => (
                          <button key={o.id} onClick={() => setUpDur(o.id)}
                            style={{ padding: "8px 16px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700, border: upDur === o.id ? `1px solid ${ACCENT}` : BORDER, background: upDur === o.id ? `${ACCENT}14` : "transparent", color: upDur === o.id ? ACCENT : "rgba(255,255,255,0.55)" }}>
                            {tr(o.en, o.ar)}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  <button onClick={() => void applyUpgrade()} disabled={!upPick || upBusy}
                    style={{ marginTop: 4, padding: "11px 22px", borderRadius: 12, border: "none", cursor: upPick ? "pointer" : "not-allowed", fontSize: 14, fontWeight: 800, color: "#03212a", opacity: upPick ? 1 : 0.4, background: `linear-gradient(135deg, ${ACCENT}, #00A6C0)` }}>
                    {upBusy ? tr("Applying…", "جارٍ التنفيذ…") : tr("Apply", "تنفيذ")}
                  </button>
                  {upMsg && (
                    <p style={{ marginTop: 12, fontSize: 12, fontWeight: 600, color: upMsg.ok ? "#00C853" : "#FF6B6B" }}>{upMsg.text}</p>
                  )}
                </div>

                {/* ── Subscriptions list ── */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                    {subErr ? "" : tr(`${subs?.length ?? "…"} subscription rows`, `${subs?.length ?? "…"} سجلّ اشتراك`)}
                  </p>
                  <button onClick={() => setSubs(null)} disabled={subLoading}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 10, border: BORDER, background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 12 }}>
                    {subLoading ? <Loader2 className="size-3.5" style={{ animation: "spin 1s linear infinite" }} /> : null}
                    {tr("Refresh", "تحديث")}
                  </button>
                </div>
                {subErr ? (
                  <div style={{ background: PANEL, border: "1px solid rgba(255,45,85,0.2)", borderRadius: 16, padding: 24, textAlign: "center" }}>
                    <AlertTriangle className="size-6" style={{ color: "#FF2D55", margin: "0 auto 8px" }} />
                    <p style={{ fontSize: 13, fontWeight: 700 }}>{tr("Could not load subscriptions", "تعذّر تحميل الاشتراكات")}</p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 6 }} dir="ltr">{subErr}</p>
                  </div>
                ) : (subs && subs.length > 0) ? (
                  <div style={{ background: PANEL, border: BORDER, borderRadius: 16, overflow: "hidden" }}>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
                        <thead>
                          <tr style={{ textAlign: isAr ? "right" : "left", color: "rgba(255,255,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            <th style={{ padding: "12px 16px", fontWeight: 600 }}>{tr("Owner", "المالك")}</th>
                            <th style={{ padding: "12px 16px", fontWeight: 600 }}>{tr("Scope", "النطاق")}</th>
                            <th style={{ padding: "12px 16px", fontWeight: 600 }}>{tr("Plan", "الخطة")}</th>
                            <th style={{ padding: "12px 16px", fontWeight: 600 }}>{tr("Status", "الحالة")}</th>
                            <th style={{ padding: "12px 16px", fontWeight: 600 }}>{tr("Renews / Ends", "يتجدّد / ينتهي")}</th>
                            <th style={{ padding: "12px 16px", fontWeight: 600 }}>{tr("Source", "المصدر")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {subs.map((s, i) => (
                            <tr key={(s.user_id || s.company_id || "") + i} style={{ borderTop: BORDER }}>
                              <td style={{ padding: "12px 16px" }}>
                                <div style={{ fontWeight: 700 }}>{s.owner_name || tr("(unknown)", "(غير معروف)")}</div>
                                {s.owner_email && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }} dir="ltr">{s.owner_email}</div>}
                              </td>
                              <td style={{ padding: "12px 16px", color: "rgba(255,255,255,0.6)" }}>{s.scope === "company" ? tr("Company", "شركة") : tr("Civilian", "مدني")}</td>
                              <td style={{ padding: "12px 16px" }}>
                                <span style={{ padding: "3px 10px", borderRadius: 999, background: `${ACCENT}14`, color: ACCENT, fontSize: 11, fontWeight: 700, textTransform: "capitalize" }}>{s.tier || "free"}</span>
                              </td>
                              <td style={{ padding: "12px 16px" }}>
                                <span style={{ fontSize: 12, color: s.status === "active" || s.status === "trialing" ? "#00C853" : "rgba(255,255,255,0.45)" }}>{s.status || "—"}</span>
                              </td>
                              <td style={{ padding: "12px 16px", color: "rgba(255,255,255,0.55)" }}>
                                {s.current_period_end ? new Date(s.current_period_end).toLocaleDateString(isAr ? "ar-EG" : "en-US", { year: "numeric", month: "short", day: "numeric" }) : "—"}
                              </td>
                              <td style={{ padding: "12px 16px" }}>
                                <span style={{ fontSize: 11, color: s.manual ? "#FF9500" : "rgba(255,255,255,0.4)" }}>{s.manual ? tr("Manual", "يدوي") : "Stripe"}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div style={{ background: PANEL, border: BORDER, borderRadius: 16, padding: 40, textAlign: "center" }}>
                    <CreditCard className="size-7" style={{ color: "rgba(255,255,255,0.3)", margin: "0 auto 10px" }} />
                    <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}>{tr("No subscriptions yet — use the tool above to create one.", "لا اشتراكات بعد — استخدم الأداة أعلاه لإنشاء واحد.")}</p>
                  </div>
                )}
              </>
            );
          })()
        ) : section === "tools" ? (
          (() => {
            const sectionCard: CSSProperties = { background: PANEL, border: BORDER, borderRadius: 16, padding: 20 };
            const h3: CSSProperties = { fontSize: 15, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 };
            const fieldStyle: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: BORDER, color: "#fff", fontSize: 13, outline: "none" };
            const actLabel = (a: string) => {
              if (a === "subscription.set") return tr("Subscription change", "تغيير اشتراك");
              if (a === "admin.add") return tr("Admin added", "إضافة مشرف");
              if (a === "admin.remove") return tr("Admin removed", "إزالة مشرف");
              return a;
            };
            return (
              <>
                {toolsErr && (
                  <div style={{ background: PANEL, border: "1px solid rgba(255,45,85,0.2)", borderRadius: 14, padding: 16, marginBottom: 16 }}>
                    <p style={{ fontSize: 12, color: "#FF6B6B" }} dir="ltr">{toolsErr}</p>
                  </div>
                )}

                {/* Privacy boundary note */}
                <div style={{ background: "rgba(0,200,224,0.05)", border: `1px solid ${ACCENT}25`, borderRadius: 14, padding: "14px 18px", marginBottom: 18, display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <Lock className="size-4" style={{ color: ACCENT, flexShrink: 0, marginTop: 2 }} />
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>
                    {tr(
                      "By design, super-admins manage the platform — not individuals. Live locations, SOS recordings, personal emergency contacts and passwords are never exposed here. Every action below is recorded in the audit log.",
                      "بحكم التصميم، السوبر-أدمن يدير المنصّة لا الأفراد. المواقع الحيّة وتسجيلات الطوارئ وجهات الاتصال الشخصية وكلمات المرور لا تُعرض هنا أبداً. وكل إجراء أدناه يُسجّل في سجلّ التدقيق."
                    )}
                  </p>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
                  {/* ── Admins ── */}
                  <div style={sectionCard}>
                    <h3 style={h3}><ShieldCheck className="size-5" style={{ color: ACCENT }} />{tr("Super-admins", "المشرفون")}</h3>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", margin: "6px 0 14px" }}>{tr("Who can access this console.", "من يمكنه دخول هذه اللوحة.")}</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                      {(admins || []).map(a => (
                        <div key={a.user_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: BORDER }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }} dir="ltr">{a.email}</div>
                            {a.is_self && <span style={{ fontSize: 10, color: ACCENT }}>{tr("you", "أنت")}</span>}
                          </div>
                          <button onClick={() => void removeAdmin(a)} disabled={adminBusy || a.is_self || (admins || []).length <= 1}
                            title={a.is_self ? tr("You can't remove yourself", "لا يمكنك إزالة نفسك") : ""}
                            style={{ flexShrink: 0, padding: 7, borderRadius: 8, border: BORDER, background: "transparent", color: a.is_self || (admins || []).length <= 1 ? "rgba(255,255,255,0.2)" : "#FF6B6B", cursor: a.is_self || (admins || []).length <= 1 ? "not-allowed" : "pointer" }}>
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      ))}
                      {admins === null && <Loader2 className="size-5" style={{ color: ACCENT, animation: "spin 1s linear infinite" }} />}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input value={newAdminEmail} onChange={e => setNewAdminEmail(e.target.value)} dir="ltr"
                        onKeyDown={e => { if (e.key === "Enter") void addAdmin(); }}
                        placeholder={tr("new.admin@email.com", "بريد المشرف الجديد")} style={{ ...fieldStyle, flex: 1 }} />
                      <button onClick={() => void addAdmin()} disabled={adminBusy}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 16px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#03212a", background: ACCENT }}>
                        <UserPlus className="size-4" />{tr("Add", "إضافة")}
                      </button>
                    </div>
                    {adminMsg && <p style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: adminMsg.ok ? "#00C853" : "#FF6B6B" }}>{adminMsg.text}</p>}
                  </div>

                  {/* ── Change password ── */}
                  <div style={sectionCard}>
                    <h3 style={h3}><KeyRound className="size-5" style={{ color: ACCENT }} />{tr("Change my password", "تغيير كلمة مروري")}</h3>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", margin: "6px 0 14px" }}>{tr("Update your own sign-in password.", "حدّث كلمة مرور دخولك.")}</p>
                    <input type="password" value={pwCur} onChange={e => setPwCur(e.target.value)} dir="ltr" placeholder={tr("Current password", "كلمة المرور الحالية")} style={{ ...fieldStyle, marginBottom: 10 }} />
                    <input type="password" value={pw1} onChange={e => setPw1(e.target.value)} dir="ltr" placeholder={tr("New password", "كلمة المرور الجديدة")} style={{ ...fieldStyle, marginBottom: 10 }} />
                    <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} dir="ltr" onKeyDown={e => { if (e.key === "Enter") void changePassword(); }} placeholder={tr("Confirm new password", "تأكيد كلمة المرور")} style={{ ...fieldStyle, marginBottom: 14 }} />
                    <button onClick={() => void changePassword()} disabled={pwBusy}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#03212a", background: ACCENT }}>
                      <Check className="size-4" />{pwBusy ? tr("Saving…", "جارٍ الحفظ…") : tr("Update password", "تحديث كلمة المرور")}
                    </button>
                    {pwMsg && <p style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: pwMsg.ok ? "#00C853" : "#FF6B6B" }}>{pwMsg.text}</p>}
                  </div>

                  {/* ── Plans & subscribers ── */}
                  <div style={sectionCard}>
                    <h3 style={h3}><CreditCard className="size-5" style={{ color: ACCENT }} />{tr("Plans & subscribers", "الخطط والمشتركون")}</h3>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", margin: "6px 0 14px" }}>{tr("Active subscribers per plan.", "المشتركون النشطون بكل خطة.")}</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {(plans || []).map((pl, i) => (
                        <div key={pl.tier + pl.scope + i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: BORDER }}>
                          <div>
                            <span style={{ fontSize: 13, fontWeight: 700, textTransform: "capitalize" }}>{pl.tier}</span>
                            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginInlineStart: 8 }}>{pl.scope === "company" ? tr("company", "شركات") : tr("civilian", "مدني")}</span>
                          </div>
                          <div style={{ fontSize: 13 }}>
                            <span style={{ fontWeight: 800, color: ACCENT }}>{pl.active}</span>
                            <span style={{ color: "rgba(255,255,255,0.35)" }}> / {pl.total}</span>
                          </div>
                        </div>
                      ))}
                      {plans === null && <Loader2 className="size-5" style={{ color: ACCENT, animation: "spin 1s linear infinite" }} />}
                      {plans !== null && plans.length === 0 && <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{tr("No subscribers yet.", "لا مشتركين بعد.")}</p>}
                    </div>
                  </div>

                  {/* ── Audit log ── */}
                  <div style={{ ...sectionCard, gridColumn: "1 / -1" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <h3 style={h3}><ScrollText className="size-5" style={{ color: ACCENT }} />{tr("Audit log", "سجلّ التدقيق")}</h3>
                      <button onClick={() => { setAudit(null); setAdmins(null); }}
                        style={{ padding: "6px 12px", borderRadius: 9, border: BORDER, background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 12 }}>{tr("Refresh", "تحديث")}</button>
                    </div>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", margin: "6px 0 14px" }}>{tr("Last 200 super-admin actions.", "آخر 200 إجراء للسوبر-أدمن.")}</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
                      {(audit || []).map(ev => (
                        <div key={ev.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "9px 12px", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: BORDER }}>
                          <div style={{ minWidth: 0 }}>
                            <span style={{ fontSize: 12, fontWeight: 700 }}>{actLabel(ev.action)}</span>
                            {ev.target && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}> · {ev.target}</span>}
                            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }} dir="ltr">{ev.actor_email}</div>
                          </div>
                          <span style={{ flexShrink: 0, fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
                            {new Date(ev.created_at).toLocaleString(isAr ? "ar-EG" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                      ))}
                      {audit === null && <Loader2 className="size-5" style={{ color: ACCENT, animation: "spin 1s linear infinite" }} />}
                      {audit !== null && audit.length === 0 && <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{tr("No actions recorded yet.", "لا إجراءات مسجّلة بعد.")}</p>}
                    </div>
                  </div>
                </div>
              </>
            );
          })()
        ) : (
          <div style={{ background: PANEL, border: BORDER, borderRadius: 16, padding: 40, textAlign: "center" }}>
            <AlertTriangle className="size-7" style={{ color: "#FF9500", margin: "0 auto 10px" }} />
            <p style={{ fontSize: 14, fontWeight: 700 }}>{tr("Coming in the next step", "قادم في الخطوة التالية")}</p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 6 }}>
              {tr("This module is being built step by step.", "هذه الوحدة قيد البناء خطوة-خطوة.")}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
