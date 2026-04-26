import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { CompanyDashboard } from "./company-dashboard";
import { CompanyRegister } from "./company-register";
import { setDashboardSession, clearDashboardSession, getDashboardSession, isSessionExpired } from "./utils/dashboard-auth-guard";
import {
  Shield, Lock, ArrowRight, CheckCircle2,
  Building2, Users, AlertTriangle, Wifi,
  Globe, Eye, Mail, AtSign, RefreshCw,
  XCircle, AlertCircle, ChevronDown,
} from "lucide-react";
import { supabase } from "./api/supabase-client";
import { Country, COUNTRIES } from "./country-picker";
import { initRealtimeChannels } from "./shared-store";
import { useDashboardStore, useDashboardAutoRefresh } from "./stores/dashboard-store";

const MAX_OTP_ATTEMPTS = 3;
const LOCKOUT_SECONDS = 60;
const RESEND_COOLDOWN = 30;

// ═══════════════════════════════════════════════════════════════
// SOSphere Enterprise — Dashboard Login
// Phone + OTP  |  Google Sign-in
// ═══════════════════════════════════════════════════════════════

type LoginTab = "phone" | "email";
type LoginStep =
  | "form"
  | "email-otp"
  | "loading"
  | "welcome"
  | "dashboard"
  | "register"
  | "pin-setup"
  | "pin-verify";

// ── Lightweight Toast ─────────────────────────────────────────
type ToastType = "error" | "success" | "info";
interface ToastState { message: string; type: ToastType; id: number }

// Demo accounts removed — dashboard uses real Supabase auth

const STATS = [
  { label: "Active Field Workers", value: "12,847", delta: "+3.2%", up: true,  color: "#00C8E0", icon: Users },
  { label: "SOS Events Today",     value: "3",       delta: "-67%",  up: false, color: "#FF2D55", icon: AlertTriangle },
  { label: "Zones Monitored",      value: "284",     delta: "+12",   up: true,  color: "#00C853", icon: Globe },
  { label: "System Uptime",        value: "99.97%",  delta: "30d",   up: true,  color: "#7B5EFF", icon: Wifi },
];

// ── Animated grid background ─────────────────────────────────
function GridBg() {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.018]" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="grid" width="52" height="52" patternUnits="userSpaceOnUse">
          <path d="M 52 0 L 0 0 0 52" fill="none" stroke="white" strokeWidth="1"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)"/>
    </svg>
  );
}

// ── Toast notification ──────────────────────────────────────
function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [toast.id]);

  const colors: Record<ToastType, { bg: string; border: string; icon: string }> = {
    error:   { bg: "rgba(255,45,85,0.1)",  border: "rgba(255,45,85,0.25)",  icon: "#FF2D55" },
    success: { bg: "rgba(0,200,83,0.1)",   border: "rgba(0,200,83,0.25)",   icon: "#00C853" },
    info:    { bg: "rgba(0,200,224,0.08)", border: "rgba(0,200,224,0.2)",   icon: "#00C8E0" },
  };
  const c = colors[toast.type];
  const Icon = toast.type === "error" ? XCircle : toast.type === "success" ? CheckCircle2 : AlertCircle;

  return (
    <motion.div
      initial={{ opacity: 0, y: -16, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.95 }}
      className="fixed top-5 left-1/2 z-[9999] flex items-center gap-3 px-4 py-3 rounded-2xl"
      style={{
        transform: "translateX(-50%)",
        background: c.bg,
        border: `1px solid ${c.border}`,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        backdropFilter: "blur(20px)",
        minWidth: 280, maxWidth: 400,
      }}
    >
      <Icon className="size-4 shrink-0" style={{ color: c.icon }} />
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>{toast.message}</p>
      <button onClick={onDismiss} className="ml-auto shrink-0" style={{ color: "rgba(255,255,255,0.3)" }}>
        <XCircle className="size-4" />
      </button>
    </motion.div>
  );
}

// ── Country picker dropdown (adapted for web) ─────────────────
function WebCountryPicker({ selected, onChange }: { selected: Country; onChange: (c: Country) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = query
    ? COUNTRIES.filter(c => c.name.toLowerCase().includes(query.toLowerCase()) || c.dial.includes(query))
    : COUNTRIES;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3 h-full rounded-l-[16px] transition-colors"
        style={{
          background: "rgba(255,255,255,0.03)",
          borderRight: "1px solid rgba(255,255,255,0.07)",
          minWidth: 90,
        }}
      >
        <span style={{ fontSize: 18 }}>{selected.flag}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>{selected.dial}</span>
        <ChevronDown className="size-3.5 ml-0.5" style={{ color: "rgba(255,255,255,0.3)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="absolute left-0 top-full mt-2 rounded-2xl overflow-hidden z-50"
            style={{
              width: 280,
              background: "rgba(10,18,32,0.98)",
              border: "1px solid rgba(0,200,224,0.15)",
              boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
              backdropFilter: "blur(40px)",
            }}
          >
            <div className="p-2 border-b" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
                <Search className="size-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search country..."
                  className="flex-1 bg-transparent outline-none text-white"
                  style={{ fontSize: 13, fontFamily: "inherit" }}
                />
              </div>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 240, scrollbarWidth: "none" }}>
              {filtered.slice(0, 60).map(c => (
                <button
                  key={c.code}
                  onClick={() => { onChange(c); setOpen(false); setQuery(""); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                  style={{
                    background: selected.code === c.code ? "rgba(0,200,224,0.07)" : "transparent",
                    color: selected.code === c.code ? "#00C8E0" : "rgba(255,255,255,0.5)",
                  }}
                >
                  <span style={{ fontSize: 18 }}>{c.flag}</span>
                  <span style={{ fontSize: 13, flex: 1 }}>{c.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.35)" }}>{c.dial}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── OTP Input (6 boxes) — uses hidden input to prevent autocomplete popups
function OTPInput({ value, onChange, disabled = false }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const hiddenRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      onChange(value.slice(0, -1));
    }
  };

  const handleInput = (e: React.FormEvent<HTMLInputElement>) => {
    const raw = (e.target as HTMLInputElement).value.replace(/\D/g, "");
    if (raw && value.length < 6) {
      onChange((value + raw).slice(0, 6));
    }
    (e.target as HTMLInputElement).value = "";
  };

  return (
    <div
      className="relative flex gap-2.5 justify-center"
      onClick={() => !disabled && hiddenRef.current?.focus()}
      style={{ opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? "none" : "auto" }}
    >
      <input
        ref={hiddenRef}
        autoFocus={!disabled}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="OTP code"
        style={{ position: "absolute", opacity: 0, width: 1, height: 1, pointerEvents: "none" }}
        tabIndex={-1}
      />
      {Array.from({ length: 6 }).map((_, i) => {
        const filled = !!value[i];
        const isCursor = i === value.length && value.length < 6;
        return (
          <motion.div
            key={i}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => hiddenRef.current?.focus()}
            className="flex items-center justify-center text-white cursor-text select-none"
            style={{
              width: 52, height: 60,
              borderRadius: 14,
              fontSize: 24, fontWeight: 800,
              background: filled ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.04)",
              border: isCursor ? "1.5px solid rgba(0,200,224,0.6)" : filled ? "1.5px solid rgba(0,200,224,0.4)" : "1.5px solid rgba(255,255,255,0.08)",
              boxShadow: filled ? "0 0 0 4px rgba(0,200,224,0.06)" : isCursor ? "0 0 0 4px rgba(0,200,224,0.1)" : "none",
              transition: "all 0.2s",
              fontFamily: "inherit",
            }}
          >
            {value[i] || (isCursor ? (
              <motion.span
                animate={{ opacity: [1, 0] }}
                transition={{ repeat: Infinity, duration: 0.8 }}
                style={{ display: "inline-block", width: 2, height: 24, background: "#00C8E0", borderRadius: 1 }}
              />
            ) : "")}
          </motion.div>
        );
      })}
    </div>
  );
}

// ═════════════════════════════════════════════��═════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════
export function DashboardWebPage() {
  const navigate = useNavigate();
  // Auto-refresh dashboard data every 30 seconds when logged in
  useDashboardAutoRefresh(30_000);
  const mountedRef = useRef(true);
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const toastCounter = useRef(0);
  const processingRef = useRef(false);
  const pendingLoginRef = useRef<{ name: string; company: string } | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinStage, setPinStage] = useState<"enter" | "confirm">("enter");
  const [pinError, setPinError] = useState("");
  const PIN_KEY = "sosphere_dashboard_pin";
  const PIN_SALT_KEY = "sosphere_dashboard_pin_salt";  // W3-49: per-install
  const PIN_LEGACY_SALT = "sosphere_pin_salt_2026";    // for legacy hash recognition
  const getStoredPin = () => localStorage.getItem(PIN_KEY);

  // W3-49 (B-20, 2026-04-26): per-install random salt instead of a single
  // constant. Pre-fix used `"sosphere_pin_salt_2026"` for every install, so
  // a single rainbow table cracked every dashboard PIN. Now: 16-byte random
  // salt generated on first hash, stored alongside. Order is `salt + ":" +
  // pin` to match the canonical pattern in duress-service.ts.
  // Backward compat: if no per-install salt exists yet (first run after
  // upgrade) and a legacy-hash matches, accept once and re-hash.
  const getOrCreateSalt = (): string => {
    try {
      let salt = localStorage.getItem(PIN_SALT_KEY);
      if (salt && /^[a-f0-9]{32}$/.test(salt)) return salt;
      const bytes = new Uint8Array(16);
      (globalThis.crypto || (globalThis as any).msCrypto).getRandomValues(bytes);
      salt = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(PIN_SALT_KEY, salt);
      return salt;
    } catch {
      return "fallback-salt-00000000000000000";
    }
  };
  const hashPinWithSalt = async (pin: string, salt: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(salt + ":" + pin);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  };
  const hashPinLegacy = async (pin: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin + PIN_LEGACY_SALT);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  };
  const storePin = async (pin: string) => {
    const salt = getOrCreateSalt();
    localStorage.setItem(PIN_KEY, await hashPinWithSalt(pin, salt));
  };
  const checkPin = async (pin: string) => {
    const stored = getStoredPin();
    if (!stored) return false;
    const salt = getOrCreateSalt();
    const newHash = await hashPinWithSalt(pin, salt);
    if (newHash === stored) return true;
    // Backward compat: legacy hash check + re-hash on success.
    const legacyHash = await hashPinLegacy(pin);
    if (legacyHash === stored) {
      // upgrade in place
      try { await storePin(pin); } catch {}
      return true;
    }
    return false;
  };
  const [step, setStep] = useState<LoginStep>("loading");
  const [loginName, setLoginName] = useState("Admin");
  const [loginCompany, setLoginCompany] = useState("Your Company");

  // Toast
  const [toast, setToast] = useState<ToastState | null>(null);
  const showToast = useCallback((message: string, type: ToastType = "error") => {
    toastCounter.current += 1;
    setToast({ message, type, id: toastCounter.current });
  }, []);

  // Email
  const [email, setEmail] = useState("");
  const [emailFocused, setEmailFocused] = useState(false);
  const [emailOtp, setEmailOtp] = useState("");
  const [emailOtpError, setEmailOtpError] = useState(false);
  const [emailOtpLoading, setEmailOtpLoading] = useState(false);
  const [emailResendTimer, setEmailResendTimer] = useState(RESEND_COOLDOWN);

  // Security
  const [otpAttempts, setOtpAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [lockTimer, setLockTimer] = useState(0);

  // Stats
  const [statsIdx, setStatsIdx] = useState(0);

  // ── Check session on mount — auto-login if already authenticated ──
  useEffect(() => {
    if (window.location.hash.includes("access_token")) return; // OAuth redirect handled by onAuthStateChange
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mountedRef.current) return;
      if (!session) {
        localStorage.removeItem("sosphere_dashboard_pin");
        setStep("form");
        return;
      }
      const name = session.user.user_metadata?.full_name || session.user.email || "Admin";

      try {
        // Check if OWNER
        const { data: company, error: companyError } = await supabase
          .from("companies").select("id, name")
          .eq("owner_id", session.user.id).maybeSingle();
        if (!mountedRef.current) return;

        // If table doesn't exist (406) → go straight to dashboard with mock data
        if (companyError) {
          console.warn("[Auth] companies query failed on mount:", companyError.message);
          useDashboardStore.getState().initDashboard();
          doLogin(name, "SOSphere Demo");
          return;
        }

        if (company) {
          initRealtimeChannels(company.id);
          useDashboardStore.getState().initDashboard();
          pendingLoginRef.current = { name, company: company.name || "Your Company" };
          setLoginName(name);
          if (getStoredPin()) {
            setPinInput(""); setPinError("");
            setStep("pin-verify");
          } else {
            doLogin(name, company.name || "Your Company");
          }
          return;
        }

        // Check if ADMIN via invitation
        const { data: invitation, error: invError } = await supabase
          .from("invitations")
          .select("id, company_id, companies(name)")
          .eq("email", session.user.email || "")
          .in("status", ["pending", "accepted"])
          .order("created_at", { ascending: false })
          .maybeSingle();
        if (!mountedRef.current) return;

        if (invError) {
          console.warn("[Auth] invitations query failed on mount:", invError.message);
          useDashboardStore.getState().initDashboard();
          doLogin(name, "SOSphere Demo");
          return;
        }

        if (invitation) {
          const companyName = (invitation.companies as any)?.name || "Your Company";
          initRealtimeChannels(invitation.company_id);
          useDashboardStore.getState().initDashboard();
          pendingLoginRef.current = { name, company: companyName };
          setLoginName(name);
          if (getStoredPin()) {
            setPinInput(""); setPinError("");
            setStep("pin-verify");
          } else {
            doLogin(name, companyName);
          }
          return;
        }

        // No company or invitation — show login form
        localStorage.removeItem("sosphere_dashboard_pin");
        setStep("form");
      } catch (err) {
        console.error("[Auth] Unexpected error on mount:", err);
        useDashboardStore.getState().initDashboard();
        doLogin(name, "SOSphere Demo");
      }
    });
  }, []);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      timerRefs.current.forEach(clearTimeout);
    };
  }, []);

  // ── Core login ──
  const doLogin = useCallback((name: string, company: string) => {
    if (!mountedRef.current) return;
    setLoginName(name);
    setLoginCompany(company);
    setDashboardSession(name, company);
    useDashboardStore.getState().initDashboard();
    setStep("welcome");
    const t1 = setTimeout(() => { if (mountedRef.current) setStep("dashboard"); }, 2600);
    timerRefs.current.push(t1);
  }, []);

  // ── Auth State Change ──
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mountedRef.current) return;
      if (event === "SIGNED_OUT") {
        if (mountedRef.current) setStep("form");
        return;
      }
      if (event === "SIGNED_IN" && session?.user) {
        if (processingRef.current) return;
        processingRef.current = true;
        window.history.replaceState({}, "", "/dashboard");
        const name = session.user.user_metadata?.full_name || session.user.email || "Admin";
        const userEmail = session.user.email || "";

        try {
          // Step 1: Check if OWNER (has company)
          const { data: company, error: companyError } = await supabase
            .from("companies").select("id, name")
            .eq("owner_id", session.user.id).maybeSingle();

          if (!mountedRef.current) { processingRef.current = false; return; }

          // If table doesn't exist (406) or other DB error → go straight to dashboard with mock data
          if (companyError) {
            console.warn("[Auth] companies query failed:", companyError.message, "→ loading dashboard with mock data");
            useDashboardStore.getState().initDashboard();
            pendingLoginRef.current = { name, company: "SOSphere Demo" };
            setLoginName(name);
            doLogin(name, "SOSphere Demo");
            setTimeout(() => { processingRef.current = false; }, 3000);
            return;
          }

          if (company) {
            // ── OWNER FLOW ──
            initRealtimeChannels(company.id);
            useDashboardStore.getState().initDashboard();
            pendingLoginRef.current = { name, company: company.name || "Your Company" };
            setLoginName(name);
            if (getStoredPin()) {
              setPinInput(""); setPinError("");
              setStep("pin-verify");
            } else {
              setPinInput(""); setPinConfirm(""); setPinStage("enter");
              setStep("pin-setup");
            }
          } else {
            // Step 2: Check if ADMIN (has invitation)
            const { data: invitation, error: invError } = await supabase
              .from("invitations")
              .select("id, company_id, role, status, companies(name)")
              .eq("email", userEmail)
              .in("status", ["pending", "accepted"])
              .order("created_at", { ascending: false })
              .maybeSingle();

            if (!mountedRef.current) { processingRef.current = false; return; }

            // If invitations table doesn't exist → go to register
            if (invError) {
              console.warn("[Auth] invitations query failed:", invError.message, "→ showing register");
              setLoginName(name);
              setStep("register");
            } else if (invitation) {
              // ── ADMIN FLOW ──
              initRealtimeChannels(invitation.company_id);
              useDashboardStore.getState().initDashboard();
              const companyName = (invitation.companies as any)?.name || "Your Company";
              // Non-blocking: accept invitation in background (don't block login on this)
              supabase.from("invitations").update({ status: "accepted" }).eq("id", invitation.id)
                .then(({ error: updateErr }) => { if (updateErr) console.warn("[Auth] Failed to accept invitation:", updateErr.message); });
              pendingLoginRef.current = { name, company: companyName };
              setLoginName(name);
              if (getStoredPin()) {
                setPinInput(""); setPinError("");
                setStep("pin-verify");
              } else {
                setPinInput(""); setPinConfirm(""); setPinStage("enter");
                setStep("pin-setup");
              }
            } else {
              // ── NEW USER → REGISTER ──
              localStorage.removeItem("sosphere_dashboard_pin");
              setLoginName(name);
              setStep("register");
            }
          }
        } catch (err) {
          // Network or unexpected error → go to dashboard with mock data
          console.error("[Auth] Unexpected error:", err);
          useDashboardStore.getState().initDashboard();
          pendingLoginRef.current = { name, company: "SOSphere Demo" };
          setLoginName(name);
          doLogin(name, "SOSphere Demo");
        }
        setTimeout(() => { processingRef.current = false; }, 3000);
      }
    });
    return () => { subscription.unsubscribe(); };
  }, [doLogin]);

  // ── Stats ticker ──
  useEffect(() => {
    const t = setInterval(() => setStatsIdx(i => (i + 1) % STATS.length), 3200);
    return () => clearInterval(t);
  }, []);

  // ── Resend countdown ──
  useEffect(() => {
    if (step !== "email-otp") return;
    setEmailResendTimer(RESEND_COOLDOWN);
    const t = setInterval(() => setEmailResendTimer(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [step]);

  // ── Lockout countdown ──
  useEffect(() => {
    if (!lockedUntil) return;
    const t = setInterval(() => {
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (!mountedRef.current) return;
      if (remaining <= 0) {
        setLockedUntil(null); setLockTimer(0); setOtpAttempts(0);
      } else {
        setLockTimer(remaining);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const isLocked = !!lockedUntil && Date.now() < lockedUntil;

  // ── Google Sign In ──
  const handleGoogleSignIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
        queryParams: { prompt: "select_account" },
      },
    });
  };

  // ── Email OTP Send ──
  const handleEmailSend = async () => {
    if (!isEmailValid) return;
    setEmailOtpLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });
      if (error) { showToast("Failed to send code: " + error.message); return; }
      setEmailOtp(""); setOtpAttempts(0); setLockedUntil(null);
      setStep("email-otp");
      showToast("Code sent to " + email, "success");
    } finally {
      if (mountedRef.current) setEmailOtpLoading(false);
    }
  };

  // ── Email OTP Verify ──
  const handleEmailOtpVerify = async () => {
    if (emailOtp.length < 6 || isLocked) return;
    setEmailOtpLoading(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email, token: emailOtp, type: "email",
      });
      if (error) {
        const newAttempts = otpAttempts + 1;
        setOtpAttempts(newAttempts);
        setEmailOtpError(true);
        setTimeout(() => { if (mountedRef.current) setEmailOtpError(false); }, 1200);
        if (newAttempts >= MAX_OTP_ATTEMPTS) {
          setLockedUntil(Date.now() + LOCKOUT_SECONDS * 1000);
          setEmailOtp("");
          showToast(`Too many attempts. Try again in ${LOCKOUT_SECONDS}s.`);
        } else {
          const left = MAX_OTP_ATTEMPTS - newAttempts;
          showToast(`Incorrect code. ${left} attempt${left === 1 ? "" : "s"} remaining.`);
        }
        return;
      }
      const name = data.user?.user_metadata?.full_name || data.user?.email || "Admin";
      const { data: company } = await supabase
        .from("companies").select("id, name")
        .eq("owner_id", data.user?.id).maybeSingle();
      if (!mountedRef.current) return;
      if (company) {
        doLogin(name, company.name || "Your Company");
      } else {
        setLoginName(name);
        setStep("register");
      }
    } finally {
      if (mountedRef.current) setEmailOtpLoading(false);
    }
  };

  // ── Email OTP Resend ──
  const handleEmailResend = async () => {
    if (emailResendTimer > 0) return;
    setEmailResendTimer(RESEND_COOLDOWN);
    setEmailOtp(""); setOtpAttempts(0); setLockedUntil(null);
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) showToast("Failed to resend: " + error.message);
    else showToast("New code sent to " + email, "success");
  };

  // ── Render: Loading (only shown during init) ──
  if (step === "loading") {
    return (
      <div style={{ width: "100vw", height: "100vh", background: "#05070E", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Shield className="size-6" style={{ color: "#00C8E0" }} />
          </div>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, margin: 0 }}>Loading SOSphere...</p>
        </motion.div>
      </div>
    );
  }

  // ── Render: PIN Setup ──
  if (step === "pin-setup") {
    return (
      <div className="relative flex items-center justify-center w-screen h-screen overflow-hidden"
        style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}>
        <GridBg />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="relative z-10 flex flex-col items-center gap-6" style={{ width: 340 }}>
          <div className="flex flex-col items-center gap-2">
            <div style={{ width: 64, height: 64, borderRadius: 20, background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Lock className="size-7" style={{ color: "#00C8E0" }} />
            </div>
            <h2 style={{ color: "#fff", fontSize: 22, fontWeight: 700, margin: 0 }}>
              {pinStage === "enter" ? "Set Dashboard PIN" : "Confirm PIN"}
            </h2>
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, textAlign: "center", margin: 0 }}>
              {pinStage === "enter" ? "Choose a 6-digit PIN to secure your dashboard" : "Enter the same PIN again to confirm"}
            </p>
          </div>
          <div className="flex gap-3">
            {Array.from({ length: 6 }).map((_, i) => {
              const val = pinStage === "enter" ? pinInput : pinConfirm;
              const filled = i < val.length;
              return (
                <div key={i} style={{ width: 44, height: 52, borderRadius: 12, background: filled ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.04)", border: filled ? "1.5px solid rgba(0,200,224,0.5)" : "1.5px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {filled && <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#00C8E0" }} />}
                </div>
              );
            })}
          </div>
          {pinError && <p style={{ color: "#FF2D55", fontSize: 13, margin: 0 }}>{pinError}</p>}
          <div className="grid grid-cols-3 gap-3" style={{ width: "100%" }}>
            {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k, i) => (
              <button key={i} disabled={!k}
                onClick={async () => {
                  if (!k) return;
                  const current = pinStage === "enter" ? pinInput : pinConfirm;
                  const setter = pinStage === "enter" ? setPinInput : setPinConfirm;
                  setPinError("");
                  if (k === "⌫") { setter(current.slice(0, -1)); return; }
                  if (current.length >= 6) return;
                  const next = current + k;
                  setter(next);
                  if (next.length === 6) {
                    if (pinStage === "enter") {
                      setTimeout(() => { setPinStage("confirm"); }, 300);
                    } else {
                      if (next === pinInput) {
                        await storePin(pinInput);
                        const pending = pendingLoginRef.current;
                        if (pending) {
                          doLogin(pending.name, pending.company);
                        } else {
                          const n = loginName || "Admin";
                          const c = loginCompany || "Your Company";
                          doLogin(n, c);
                        }
                      } else {
                        setPinError("PINs do not match. Try again.");
                        setPinInput(""); setPinConfirm(""); setPinStage("enter");
                        setTimeout(() => setPinError(""), 2000);
                      }
                    }
                  }
                }}
                style={{ height: 56, borderRadius: 14, background: k ? "rgba(255,255,255,0.06)" : "transparent", border: k ? "1px solid rgba(255,255,255,0.08)" : "none", color: "#fff", fontSize: 20, fontWeight: 600, cursor: k ? "pointer" : "default", opacity: k ? 1 : 0 }}
              >{k}</button>
            ))}
          </div>
          <p style={{ color: "rgba(255,255,255,0.2)", fontSize: 11, textAlign: "center" }}>
            This PIN protects your dashboard from unauthorized access
          </p>
        </motion.div>
      </div>
    );
  }

  // ── Render: PIN Verify ──
  if (step === "pin-verify") {
    return (
      <div className="relative flex items-center justify-center w-screen h-screen overflow-hidden"
        style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}>
        <GridBg />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="relative z-10 flex flex-col items-center gap-6" style={{ width: 340 }}>
          <div className="flex flex-col items-center gap-2">
            <div style={{ width: 64, height: 64, borderRadius: 20, background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Lock className="size-7" style={{ color: "#00C8E0" }} />
            </div>
            <h2 style={{ color: "#fff", fontSize: 22, fontWeight: 700, margin: 0 }}>Welcome back, {loginName.split(" ")[0]}</h2>
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, textAlign: "center", margin: 0 }}>Enter your 6-digit PIN to continue</p>
          </div>
          <div className="flex gap-3">
            {Array.from({ length: 6 }).map((_, i) => {
              const filled = i < pinInput.length;
              return (
                <div key={i} style={{ width: 44, height: 52, borderRadius: 12, background: filled ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.04)", border: filled ? "1.5px solid rgba(0,200,224,0.5)" : "1.5px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {filled && <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#00C8E0" }} />}
                </div>
              );
            })}
          </div>
          {pinError && <p style={{ color: "#FF2D55", fontSize: 13, margin: 0 }}>{pinError}</p>}
          <div className="grid grid-cols-3 gap-3" style={{ width: "100%" }}>
            {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k, i) => (
              <button key={i} disabled={!k}
                onClick={async () => {
                  if (!k) return;
                  setPinError("");
                  if (k === "⌫") { setPinInput(p => p.slice(0, -1)); return; }
                  if (pinInput.length >= 6) return;
                  const next = pinInput + k;
                  setPinInput(next);
                  if (next.length === 6) {
                    const valid = await checkPin(next);
                    if (valid) {
                      const pending = pendingLoginRef.current;
                      if (pending) doLogin(pending.name, pending.company);
                    } else {
                      setPinError("Incorrect PIN. Try again.");
                      setTimeout(() => { setPinInput(""); setPinError(""); }, 800);
                    }
                  }
                }}
                style={{ height: 56, borderRadius: 14, background: k ? "rgba(255,255,255,0.06)" : "transparent", border: k ? "1px solid rgba(255,255,255,0.08)" : "none", color: "#fff", fontSize: 20, fontWeight: 600, cursor: k ? "pointer" : "default", opacity: k ? 1 : 0 }}
              >{k}</button>
            ))}
          </div>
          <button onClick={async () => { const { completeLogout } = await import("./api/complete-logout"); await completeLogout(); setStep("form"); setPinInput(""); }}
            style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, background: "none", border: "none", cursor: "pointer" }}>
            Sign in with different account
          </button>
        </motion.div>
      </div>
    );
  }

  // ── Render: Dashboard ──
  if (step === "dashboard") {
    return (
      <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#05070E", fontFamily: "'Outfit', sans-serif" }}>
        <CompanyDashboard
          companyName={loginCompany}
          webMode={true}
          onSOSTrigger={() => {}}
          onLogout={async () => {
            // S-H5: completeLogout handles dashboard session + all
            // other sosphere_* keys + supabase.auth.signOut() + event.
            const { completeLogout } = await import("./api/complete-logout");
            await completeLogout();
            // Dashboard PIN is a user-chosen admin PIN; completeLogout
            // also sweeps it via the prefix scan, but be explicit here
            // so intent is obvious to future readers.
            try { localStorage.removeItem("sosphere_dashboard_pin"); } catch { /* ignore */ }
            if (mountedRef.current) { setStep("form"); setEmailOtp(""); setEmail(""); }
          }}
        />
      </div>
    );
  }

  // ── Render: Register ──
  if (step === "register") {
    return (
      <div className="relative flex w-screen h-screen overflow-hidden"
        style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}>
        <GridBg />
        <div className="absolute inset-0 pointer-events-none">
          <div style={{ position: "absolute", top: "-10%", left: "20%", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,200,224,0.04) 0%, transparent 70%)" }} />
          <div style={{ position: "absolute", bottom: "-5%", right: "30%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(123,94,255,0.03) 0%, transparent 70%)" }} />
        </div>
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-8 py-5">
          <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3">
            <div className="size-10 rounded-[12px] flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.2), rgba(0,200,224,0.06))", border: "1px solid rgba(0,200,224,0.22)" }}>
              <Shield className="size-5" style={{ color: "#00C8E0" }} />
            </div>
            <div>
              <p className="text-white" style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.3px" }}>SOSphere</p>
              <p style={{ fontSize: 8, color: "rgba(0,200,224,0.45)", fontWeight: 700, letterSpacing: "2px" }}>FREE TRIAL</p>
            </div>
          </motion.div>
          <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} whileTap={{ scale: 0.97 }}
            onClick={() => setStep("form")}
            className="flex items-center gap-2 px-4 py-2 rounded-xl"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.4)" }}>
            <ArrowRight className="size-4 rotate-180" /> Back to Login
          </motion.button>
        </div>
        <div className="flex-1 flex items-center justify-center overflow-y-auto pt-20 pb-10 relative z-10" style={{ scrollbarWidth: "thin" }}>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full max-w-2xl mx-auto px-6">
            <CompanyRegister
              onComplete={async (companyName, regResult) => {
                const name = loginName || "Admin";
                const company = companyName || "New Company";
                if (regResult) {
                  try { localStorage.setItem("sos_reg_result", JSON.stringify(regResult)); } catch {}
                }
                // Init Realtime after registration
                try {
                  const { data: { session } } = await supabase.auth.getSession();
                  if (session?.user) {
                    const { data: co } = await supabase
                      .from("companies").select("id")
                      .eq("owner_id", session.user.id).maybeSingle();
                    if (co?.id) initRealtimeChannels(co.id);
                  }
                } catch (_) {}
                // After registration → show PIN setup
                setLoginName(name);
                setLoginCompany(company);
                setDashboardSession(name, company);
                pendingLoginRef.current = { name, company };
                processingRef.current = true;
                setPinInput("");
                setPinConfirm("");
                setPinStage("enter");
                setStep("pin-setup");
              }}
              onBack={() => setStep("form")}
            />
          </motion.div>
        </div>
      </div>
    );
  }

  // ── Render: Login Form ──
  return (
    <div className="relative flex w-screen h-screen overflow-hidden"
      style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}>
      <GridBg />
      <AnimatePresence>
        {toast && <Toast key={toast.id} toast={toast} onDismiss={() => setToast(null)} />}
      </AnimatePresence>
      <div className="absolute inset-0 pointer-events-none">
        <div style={{ position: "absolute", top: "-10%", left: "20%", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,200,224,0.045) 0%, transparent 70%)" }} />
        <div style={{ position: "absolute", bottom: "-5%", right: "30%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(123,94,255,0.035) 0%, transparent 70%)" }} />
      </div>

      {/* WELCOME */}
      <AnimatePresence>
        {step === "welcome" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.6 } }}
            className="absolute inset-0 z-50 flex items-center justify-center"
            style={{ background: "#05070E" }}>
            <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: [0, 2, 1.5], opacity: [0, 0.12, 0.07] }} transition={{ duration: 1.6 }}
              style={{ position: "absolute", width: 900, height: 900, borderRadius: "50%", background: "radial-gradient(circle, #00C8E0 0%, transparent 70%)" }} />
            <div className="flex flex-col items-center text-center relative z-10">
              <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.7, delay: 0.1, ease: [0.34,1.56,0.64,1] }} className="relative mb-10">
                <div className="size-32 rounded-[36px] flex items-center justify-center"
                  style={{ background: "linear-gradient(145deg, rgba(0,200,224,0.14), rgba(0,200,224,0.04))", border: "1px solid rgba(0,200,224,0.25)", boxShadow: "0 0 80px rgba(0,200,224,0.2), inset 0 1px 0 rgba(255,255,255,0.08)" }}>
                  <Shield className="size-16" style={{ color: "#00C8E0" }} />
                </div>
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.6, ease: [0.34,1.56,0.64,1] }}
                  className="absolute -bottom-3 -right-3 size-11 rounded-full flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, #00C853, #009940)", border: "3px solid #05070E", boxShadow: "0 4px 20px rgba(0,200,83,0.4)" }}>
                  <CheckCircle2 className="size-5 text-white" />
                </motion.div>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.7 }}>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", marginBottom: 8, letterSpacing: "2.5px", textTransform: "uppercase" }}>Welcome back</p>
                <h1 style={{ fontSize: 56, fontWeight: 800, letterSpacing: "-1.5px", background: "linear-gradient(135deg, #fff 0%, rgba(0,200,224,0.9) 50%, rgba(123,94,255,0.8) 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", lineHeight: 1.1 }}>
                  {loginName}
                </h1>
              </motion.div>
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.7 }}
                className="mt-4 flex items-center gap-2.5 px-5 py-2.5 rounded-full"
                style={{ background: "rgba(255,149,0,0.07)", border: "1px solid rgba(255,149,0,0.2)" }}>
                <Building2 className="size-4" style={{ color: "#FF9500" }} />
                <span style={{ fontSize: 14, color: "#FF9500", fontWeight: 600 }}>{loginCompany}</span>
              </motion.div>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="mt-7">
                <div className="flex items-center gap-2 justify-center mb-6">
                  <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }} className="size-2 rounded-full" style={{ background: "#00C853" }} />
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>Loading your enterprise dashboard…</span>
                </div>
                <div className="rounded-full overflow-hidden" style={{ width: 300, height: 2, background: "rgba(255,255,255,0.05)" }}>
                  <motion.div initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 2.8, delay: 0.3, ease: "easeInOut" }}
                    className="h-full rounded-full" style={{ background: "linear-gradient(90deg, #00C8E0, #7B5EFF)", boxShadow: "0 0 12px rgba(0,200,224,0.6)" }} />
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* LOGIN FORM */}
      <AnimatePresence>
        {(step === "form" || step === "email-otp") && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex w-full h-full">
            {/* LEFT Branding */}
            <div className="hidden lg:flex flex-col justify-between relative overflow-hidden"
              style={{ width: "42%", background: "linear-gradient(160deg, #060c1d 0%, #070b19 50%, #05070e 100%)", borderRight: "1px solid rgba(0,200,224,0.06)" }}>
              <GridBg />
              <div className="absolute top-[15%] left-[15%] w-[280px] h-[280px] rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(0,200,224,0.06) 0%, transparent 70%)" }} />
              <div className="absolute bottom-[20%] right-[10%] w-[200px] h-[200px] rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(123,94,255,0.05) 0%, transparent 70%)" }} />
              <div className="relative z-10 p-12 pt-14">
                <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.7 }} className="flex items-center gap-3 mb-14">
                  <div className="size-11 rounded-[14px] flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.2), rgba(0,200,224,0.06))", border: "1px solid rgba(0,200,224,0.22)", boxShadow: "0 4px 20px rgba(0,200,224,0.1)" }}>
                    <Shield className="size-5" style={{ color: "#00C8E0" }} />
                  </div>
                  <div>
                    <p className="text-white" style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.5px" }}>SOSphere</p>
                    <p style={{ fontSize: 9, color: "rgba(0,200,224,0.45)", fontWeight: 700, letterSpacing: "2.5px" }}>ENTERPRISE PLATFORM</p>
                  </div>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.7 }}>
                  <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-1px", lineHeight: 1.15, color: "white", marginBottom: 14 }}>
                    Real-time Safety<br />
                    <span style={{ background: "linear-gradient(135deg, #00C8E0, #7B5EFF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Intelligence</span>
                  </h1>
                  <p style={{ fontSize: 15, color: "rgba(255,255,255,0.3)", lineHeight: 1.75, maxWidth: 310 }}>
                    Enterprise-grade safety platform for managing field workers, responding to emergencies, and monitoring high-risk zones.
                  </p>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="flex flex-wrap gap-2 mt-8">
                  {["SOS Response", "Live Tracking", "Risk Mapping", "Attendance AI", "Incident Reports", "Command Center"].map((f, i) => (
                    <motion.span key={f} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.35 + i * 0.055 }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                      style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 11, color: "rgba(255,255,255,0.35)", fontWeight: 500 }}>
                      <div className="size-1.5 rounded-full" style={{ background: "#00C8E0" }} /> {f}
                    </motion.span>
                  ))}
                </motion.div>
              </div>
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="relative z-10 p-12 pb-14">
                <p style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.18)", letterSpacing: "2px", marginBottom: 12 }}>LIVE PLATFORM METRICS</p>
                <AnimatePresence mode="wait">
                  <motion.div key={statsIdx} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }}
                    className="flex items-center gap-4 p-4 rounded-2xl"
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", backdropFilter: "blur(20px)" }}>
                    {(() => {
                      const s = STATS[statsIdx]; const Icon = s.icon;
                      return (<>
                        <div className="size-11 rounded-xl flex items-center justify-center" style={{ background: `${s.color}12`, border: `1px solid ${s.color}20` }}>
                          <Icon className="size-5" style={{ color: s.color }} />
                        </div>
                        <div>
                          <p className="text-white" style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px" }}>{s.value}</p>
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{s.label}</p>
                        </div>
                        <div className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-full" style={{ background: `${s.color}10`, border: `1px solid ${s.color}20` }}>
                          <span style={{ fontSize: 11, color: s.color, fontWeight: 700 }}>{s.delta}</span>
                        </div>
                      </>);
                    })()}
                  </motion.div>
                </AnimatePresence>
                <div className="flex gap-1.5 mt-3 justify-center">
                  {STATS.map((_, i) => (
                    <motion.div key={i} animate={{ width: i === statsIdx ? 22 : 6, background: i === statsIdx ? "#00C8E0" : "rgba(255,255,255,0.08)" }} className="h-1 rounded-full" />
                  ))}
                </div>
                <div className="mt-8 flex items-center gap-3">
                  <div className="flex -space-x-2">
                    {["#00C8E0","#7B5EFF","#FF9500","#00C853"].map((c, i) => (
                      <div key={i} className="size-7 rounded-full flex items-center justify-center" style={{ background: `${c}14`, border: "2px solid #05070E" }}>
                        <Building2 className="size-3" style={{ color: c }} />
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
                    Trusted by <span style={{ color: "rgba(255,255,255,0.45)", fontWeight: 600 }}>400+</span> enterprises worldwide
                  </p>
                </div>
              </motion.div>
            </div>

            {/* RIGHT - Login Form */}
            <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 overflow-y-auto relative" style={{ scrollbarWidth: "none" }}>
              <div className="absolute top-5 right-6">
                <button onClick={() => navigate("/")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                  style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  ← Field App
                </button>
              </div>
              <div style={{ width: "100%", maxWidth: 420 }}>
                <AnimatePresence mode="wait">
                  {step === "email-otp" && (
                    <motion.div key="email-otp" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.35 }}>
                      <button onClick={() => { setStep("form"); setEmailOtp(""); setOtpAttempts(0); setLockedUntil(null); }}
                        className="flex items-center gap-2 mb-8" style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", fontWeight: 500 }}>
                        <ArrowRight className="size-4 rotate-180" /> Back
                      </button>
                      <div className="mb-8">
                        <div className="size-14 rounded-[18px] flex items-center justify-center mb-5"
                          style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.18)" }}>
                          <Mail className="size-6" style={{ color: "#00C8E0" }} />
                        </div>
                        <h2 className="text-white" style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.6px" }}>Verify Your Email</h2>
                        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.3)", marginTop: 6, lineHeight: 1.6 }}>
                          6-digit code sent to<br /><span style={{ color: "#00C8E0", fontWeight: 600 }}>{email}</span>
                        </p>
                      </div>
                      <div className="flex items-start gap-3 p-3.5 rounded-[14px] mb-5"
                        style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.1)" }}>
                        <Shield className="size-4 shrink-0 mt-0.5" style={{ color: "rgba(0,200,224,0.5)" }} />
                        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", lineHeight: 1.6 }}>
                          Expires in 10 minutes. SOSphere will never ask for your code via phone or chat.
                        </p>
                      </div>
                      <AnimatePresence>
                        {isLocked && (
                          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className="flex items-center gap-3 p-3.5 rounded-[14px] mb-5"
                            style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.2)" }}>
                            <Lock className="size-4 shrink-0" style={{ color: "#FF2D55" }} />
                            <div>
                              <p style={{ fontSize: 12, fontWeight: 700, color: "#FF2D55" }}>Too many attempts</p>
                              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                                Try again in <span style={{ color: "#FF2D55", fontWeight: 600 }}>{lockTimer}s</span>
                              </p>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                      {otpAttempts > 0 && !isLocked && (
                        <div className="flex gap-1.5 justify-center mb-4">
                          {Array.from({ length: MAX_OTP_ATTEMPTS }).map((_, i) => (
                            <div key={i} className="h-1.5 w-8 rounded-full transition-all"
                              style={{ background: i < otpAttempts ? "#FF2D55" : "rgba(255,255,255,0.08)" }} />
                          ))}
                        </div>
                      )}
                      <div className="mb-8">
                        <OTPInput value={emailOtp} onChange={v => { setEmailOtp(v); setEmailOtpError(false); }} disabled={isLocked} />
                        {emailOtpError && !isLocked && (
                          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                            className="text-center mt-3" style={{ fontSize: 13, color: "#FF2D55" }}>
                            Incorrect code. Please try again.
                          </motion.p>
                        )}
                      </div>
                      <motion.button whileTap={{ scale: 0.97 }} onClick={handleEmailOtpVerify}
                        disabled={emailOtp.length < 6 || emailOtpLoading || isLocked}
                        className="w-full flex items-center justify-center gap-2 py-[17px] rounded-[16px]"
                        style={{
                          background: emailOtp.length >= 6 && !emailOtpLoading && !isLocked ? "linear-gradient(135deg, #00C8E0, #0098B8)" : "rgba(255,255,255,0.04)",
                          boxShadow: emailOtp.length >= 6 && !emailOtpLoading && !isLocked ? "0 8px 32px rgba(0,200,224,0.28)" : "none",
                          fontSize: 15, fontWeight: 700,
                          color: emailOtp.length >= 6 && !emailOtpLoading && !isLocked ? "#fff" : "rgba(255,255,255,0.2)",
                          transition: "all 0.3s",
                          cursor: emailOtp.length >= 6 && !emailOtpLoading && !isLocked ? "pointer" : "not-allowed",
                        }}>
                        {emailOtpLoading
                          ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                              style={{ width: 18, height: 18, border: "2px solid rgba(255,255,255,0.2)", borderTopColor: "#fff", borderRadius: "50%" }} />
                          : <><Lock className="size-4" /> Verify & Sign In</>}
                      </motion.button>
                      <div className="text-center mt-5">
                        {emailResendTimer > 0
                          ? <p style={{ fontSize: 13, color: "rgba(255,255,255,0.2)" }}>Resend in <span style={{ color: "#00C8E0" }}>{emailResendTimer}s</span></p>
                          : <button onClick={handleEmailResend} style={{ fontSize: 13, color: "#00C8E0", fontWeight: 600 }} className="flex items-center gap-1.5 mx-auto">
                              <RefreshCw className="size-3.5" /> Resend Code
                            </button>}
                      </div>
                    </motion.div>
                  )}
                  {step === "form" && (
                    <motion.div key="form" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.35 }}>
                      <div className="mb-8">
                        <div className="flex items-center gap-2 mb-5">
                          <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.04)" }} />
                          <div className="flex items-center gap-2 px-3 py-1 rounded-full"
                            style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.14)" }}>
                            <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2, repeat: Infinity }} className="size-1.5 rounded-full" style={{ background: "#00C853" }} />
                            <span style={{ fontSize: 9, color: "#00C853", fontWeight: 700, letterSpacing: "1.5px" }}>SYSTEM ONLINE</span>
                          </div>
                          <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.04)" }} />
                        </div>
                        <h2 className="text-white" style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.7px" }}>Dashboard Access</h2>
                        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.3)", marginTop: 5, lineHeight: 1.65 }}>Sign in to manage your safety operations</p>
                      </div>
                      <motion.button whileTap={{ scale: 0.97 }} onClick={handleGoogleSignIn}
                        className="w-full flex items-center justify-center gap-3 py-4 rounded-[16px] mb-4 transition-all"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>
                        <svg width="18" height="18" viewBox="0 0 24 24">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                        </svg>
                        Continue with Google
                      </motion.button>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.06)" }} />
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", fontWeight: 500 }}>or sign in with work email</span>
                        <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.06)" }} />
                      </div>
                      <div className="space-y-4">
                        <div className="rounded-[16px] overflow-visible transition-all"
                          style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(40px)", border: emailFocused ? "1px solid rgba(0,200,224,0.35)" : "1px solid rgba(255,255,255,0.07)", boxShadow: emailFocused ? "0 0 0 4px rgba(0,200,224,0.06)" : "none" }}>
                          <div className="flex items-stretch" style={{ height: 58 }}>
                            <div className="flex items-center pl-4 pr-2">
                              <AtSign className="size-4" style={{ color: emailFocused ? "#00C8E0" : "rgba(255,255,255,0.25)", transition: "color 0.2s" }} />
                            </div>
                            <input type="email" value={email}
                              onChange={e => setEmail(e.target.value)}
                              onFocus={() => setEmailFocused(true)}
                              onBlur={() => setEmailFocused(false)}
                              placeholder="your.name@company.com" maxLength={150}
                              className="flex-1 bg-transparent text-white outline-none px-2"
                              style={{ fontSize: 15, fontFamily: "inherit", caretColor: "#00C8E0" }}
                              onKeyDown={e => e.key === "Enter" && handleEmailSend()} />
                            {isEmailValid && (
                              <div className="flex items-center pr-4">
                                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="size-5 rounded-full flex items-center justify-center" style={{ background: "rgba(0,200,83,0.15)" }}>
                                  <CheckCircle2 className="size-3" style={{ color: "#00C853" }} />
                                </motion.div>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-start gap-2.5 p-3 rounded-[12px]" style={{ background: "rgba(255,149,0,0.04)", border: "1px solid rgba(255,149,0,0.1)" }}>
                          <Shield className="size-3.5 shrink-0 mt-0.5" style={{ color: "rgba(255,149,0,0.5)" }} />
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", lineHeight: 1.55 }}>
                            Use your <span style={{ color: "rgba(255,149,0,0.7)", fontWeight: 600 }}>business email</span> to sign in. A verification code will be sent to confirm your identity.
                          </p>
                        </div>
                        <motion.button whileTap={{ scale: 0.97 }} onClick={handleEmailSend}
                          disabled={!isEmailValid || emailOtpLoading}
                          className="w-full flex items-center justify-center gap-2 py-[17px] rounded-[16px]"
                          style={{
                            background: isEmailValid && !emailOtpLoading ? "linear-gradient(135deg, #00C8E0, #0098B8)" : "rgba(255,255,255,0.04)",
                            boxShadow: isEmailValid && !emailOtpLoading ? "0 8px 32px rgba(0,200,224,0.28)" : "none",
                            fontSize: 15, fontWeight: 700,
                            color: isEmailValid && !emailOtpLoading ? "#fff" : "rgba(255,255,255,0.2)",
                            transition: "all 0.3s",
                            cursor: isEmailValid && !emailOtpLoading ? "pointer" : "not-allowed",
                          }}>
                          {emailOtpLoading
                            ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                style={{ width: 18, height: 18, border: "2px solid rgba(255,255,255,0.2)", borderTopColor: "#fff", borderRadius: "50%" }} />
                            : <>Send Verification Code <ArrowRight className="size-4" /></>}
                        </motion.button>
                      </div>
                      <div className="mt-8 text-center space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.05)" }} />
                          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", fontWeight: 500 }}>New to SOSphere?</span>
                          <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.05)" }} />
                        </div>
                        <div className="flex gap-3">
                          <motion.button whileTap={{ scale: 0.97 }} onClick={() => setStep("register")}
                            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-[14px]"
                            style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.12), rgba(0,200,224,0.04))", border: "1px solid rgba(0,200,224,0.2)", fontSize: 13, fontWeight: 700, color: "#00C8E0" }}>
                            Start Free Trial
                          </motion.button>
                          <motion.button whileTap={{ scale: 0.97 }}
                            onClick={() => window.open("mailto:sales@sosphere.io?subject=Demo Request", "_blank")}
                            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-[14px]"
                            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.45)" }}>
                            Request Demo
                          </motion.button>
                        </div>
                        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.15)", lineHeight: 1.5 }}>14-day free trial · No credit card required</p>
                        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                          onClick={() => navigate("/demo")}
                          className="mt-3 flex items-center justify-center gap-2 w-full py-2 rounded-xl"
                          style={{ background: "rgba(175,82,222,0.06)", border: "1px solid rgba(175,82,222,0.12)", fontSize: 12, fontWeight: 600, color: "rgba(175,82,222,0.7)" }}>
                          <Eye className="size-3.5" /> Watch 60s Live Demo
                        </motion.button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

