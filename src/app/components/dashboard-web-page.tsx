import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { CompanyDashboard } from "./company-dashboard";
import { NotificationPermissionBanner } from "./notification-permission-banner";
import { CompanyRegister } from "./company-register";
import { setDashboardSession, clearDashboardSession, getDashboardSession, isSessionExpired } from "./utils/dashboard-auth-guard";
import {
  Shield, Lock, ArrowRight, CheckCircle2,
  Building2, Users, AlertTriangle, Wifi,
  Globe, Eye, Mail, AtSign, RefreshCw,
  XCircle, AlertCircle, ChevronDown,
} from "lucide-react";
import { supabase, bindSessionToDevice } from "./api/supabase-client";
import { loadCanonicalIdentity } from "./api/canonical-identity";
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
  // Audit 2026-04-30 (HIGH#10): now stores the userId being processed
  // (or null when idle), not just a boolean flag. Lets us detect
  // genuine duplicates from the SAME user vs allow a different user
  // (rare race during account switch) to be processed.
  const processingRef = useRef<string | null>(null);
  const pendingLoginRef = useRef<{ name: string; company: string } | null>(null);
  // ────────────────────────────────────────────────────────────
  // ROOT-CAUSE PIN GATE (audit 2026-05-01)
  //
  // Single source of truth: dashboard is reachable ONLY when this
  // ref is true. Closes 6 historical bypass paths in handler #1 +
  // handler #2 (lines 438, 451, 469, 494, 587, 666 pre-fix) where
  // doLogin() was called directly without PIN verification — a
  // race between the two auth listeners could land the user on the
  // dashboard while the PIN screen was still rendering.
  //
  // Why a ref (not state):
  //   • doLogin() must read the LATEST value synchronously when
  //     called from PIN handlers — useState would create a stale
  //     closure (the same bug class that produced the original
  //     "first digit logs me in" PIN bypass).
  //   • The value is intentionally NOT persisted to localStorage —
  //     a page reload MUST restart the verification process. This
  //     follows OWASP Auth Cheat Sheet §"Re-authentication on
  //     session resumption" + NIST SP 800-63B §5.1.1.2.
  //
  // State machine (no shortcuts allowed):
  //   anonymous → form → [OAuth] → checking-session
  //                              → if no PIN: pin-setup
  //                              → if PIN exists: pin-verify
  //                              → on PIN success: pinVerifiedRef=true
  //                                              → welcome → dashboard
  // Reset to false on: SIGNED_OUT, completeLogout, page reload.
  // ────────────────────────────────────────────────────────────
  const pinVerifiedRef = useRef(false);
  // Audit 2026-05-01 (lifesaving fix): tracks the auth user_id so the
  // NotificationPermissionBanner can scope the saved subscription to
  // the correct user. Uses STATE (not just ref) so the banner
  // re-renders the moment the auth listener fires SIGNED_IN /
  // INITIAL_SESSION. Earlier ref-only attempt left the banner with
  // userId=undefined permanently, hiding it forever.
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinStage, setPinStage] = useState<"enter" | "confirm">("enter");
  const [pinError, setPinError] = useState("");
  // Audit 2026-05-01 (CRITICAL UX + security fix):
  //
  // OLD design: single shared key `sosphere_dashboard_pin` — every user on
  // this device shared one slot, AND the key was wiped on every page load
  // without a Supabase session (line 421 + 521 + 757 + 1175). Result:
  //   1. user closes tab → next visit sees "Set Dashboard PIN" again
  //      (PIN was wiped) → confused they enter the same 6 twice → screen
  //      shows "Confirm PIN" → enter same 6 → "match" → dashboard.
  //      User experiences this as "wrong PIN logged me in" but it was
  //      actually a fresh setup they didn't realize they were doing.
  //   2. user A sets PIN, logs out → user B logs in → user A's PIN
  //      hash (which is still in the key user B's keypad now writes
  //      against) gets overwritten → user A locked out of their own
  //      device on next visit.
  //
  // NEW design: PIN is keyed by Supabase user.id. Each user has their
  // own persistent PIN. Logout DOES NOT wipe it. Different user on
  // same device = different key = own PIN setup. Auto-detects legacy
  // single-key PIN on first migration so existing users aren't locked
  // out.
  const PIN_KEY_PREFIX = "sosphere_dashboard_pin:";
  const LEGACY_PIN_KEY = "sosphere_dashboard_pin"; // pre-2026-05-01 unscoped key
  const PIN_SALT_KEY = "sosphere_dashboard_pin_salt";  // W3-49: per-install (kept shared)
  const PIN_LEGACY_SALT = "sosphere_pin_salt_2026";    // for legacy hash recognition
  const pinKeyFor = (userId: string | null | undefined): string | null =>
    userId && userId.length >= 8 ? PIN_KEY_PREFIX + userId : null;
  const getStoredPin = (userId: string | null | undefined): string | null => {
    const k = pinKeyFor(userId);
    if (!k) return null;
    const scoped = localStorage.getItem(k);
    if (scoped) return scoped;
    // ── One-time migration from legacy unscoped key ──
    // If the user has no scoped PIN but a legacy PIN exists in the
    // pre-2026-05-01 single-key slot, adopt it so existing users do
    // not get locked out. The legacy slot is removed atomically so
    // a different user on this device cannot reuse the same hash.
    const legacy = localStorage.getItem(LEGACY_PIN_KEY);
    if (legacy) {
      try {
        localStorage.setItem(k, legacy);
        localStorage.removeItem(LEGACY_PIN_KEY);
      } catch { /* ignore */ }
      return legacy;
    }
    return null;
  };

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
  // Audit 2026-04-30 (CRITICAL #14): single-round SHA-256 with a
  // 6-digit PIN keyspace = 10^6 hashes/second on a single GPU, so a
  // leaked salt+hash pair is cracked in milliseconds. PBKDF2 with
  // 600,000 iterations (OWASP 2023+ recommendation) raises the cost
  // by ~1e6x — full keyspace now takes weeks of GPU time per device.
  // The old single-round hash format is still recognised for
  // backward compatibility; it auto-upgrades on the next correct PIN
  // entry. The new format uses a "v2:" prefix so we can distinguish
  // and never accidentally treat a v1 hash as a v2 hash.
  const PBKDF2_ITERATIONS = 600000;
  const PBKDF2_KEYLEN_BITS = 256;

  const hashPinPbkdf2 = async (pin: string, salt: string): Promise<string> => {
    const enc = new TextEncoder();
    const saltBytes = enc.encode("sosphere-pin-v2:" + salt);
    const baseKey = await crypto.subtle.importKey(
      "raw", enc.encode(pin), { name: "PBKDF2" }, false, ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      baseKey,
      PBKDF2_KEYLEN_BITS,
    );
    const hex = Array.from(new Uint8Array(bits))
      .map(b => b.toString(16).padStart(2, "0")).join("");
    return "v2:" + hex;
  };

  // Legacy single-round SHA-256 forms. Kept ONLY for recognition during
  // migration — never used to write a new PIN. Two variants existed:
  //   v1a: SHA-256(salt + ":" + pin)   — per-install salt era
  //   v1b: SHA-256(pin + PIN_LEGACY_SALT) — pre-W3-49 constant salt
  const hashPinLegacyPerInstall = async (pin: string, salt: string): Promise<string> => {
    const data = new TextEncoder().encode(salt + ":" + pin);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  };
  const hashPinLegacyConstant = async (pin: string): Promise<string> => {
    const data = new TextEncoder().encode(pin + PIN_LEGACY_SALT);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  };

  const storePin = async (userId: string | null | undefined, pin: string) => {
    const k = pinKeyFor(userId);
    if (!k) {
      console.warn("[PIN] storePin refused — missing userId");
      return;
    }
    const salt = getOrCreateSalt();
    localStorage.setItem(k, await hashPinPbkdf2(pin, salt));
  };

  const checkPin = async (userId: string | null | undefined, pin: string) => {
    const stored = getStoredPin(userId);
    if (!stored) return false;
    const salt = getOrCreateSalt();
    // Path 1: current v2 PBKDF2 hash.
    if (stored.startsWith("v2:")) {
      const candidate = await hashPinPbkdf2(pin, salt);
      return candidate === stored;
    }
    // Path 2: legacy hash. Try both variants, and if either matches,
    // re-hash with PBKDF2 transparently (under the user-scoped key).
    if (stored === (await hashPinLegacyPerInstall(pin, salt))
        || stored === (await hashPinLegacyConstant(pin))) {
      try { await storePin(userId, pin); } catch { /* keep legacy hash if upgrade fails */ }
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
    // Audit 2026-04-30 (BREAKING after PKCE pivot): the OAuth callback
    // gate must also accept the PKCE ?code=... query param — implicit
    // flow returned tokens in the hash, PKCE returns the auth code in
    // the query string. Without this, the gate skips deferral and we
    // race the auto-refresh that exchanges the code for a session.
    if (window.location.hash.includes("access_token")) return;
    if (new URLSearchParams(window.location.search).has("code")) return;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mountedRef.current) return;
      if (!session) {
        /* Audit 2026-05-01: removed destructive PIN wipe. PIN is now scoped
       per-user via PIN_KEY_PREFIX, persists across logout, and is
       independently set up by each user on the same device. */ void 0;
        setStep("form");
        return;
      }
      const name = session.user.user_metadata?.full_name || session.user.email || "Admin";

      try {
        // FOUNDATION-1 / Phase 5d (#180): single-RPC identity resolution.
        // Replaces the previous 2-query pattern (companies → invitations) with
        // one atomic call to public.get_my_identity(). The legacy "ADMIN via
        // invitation" path read from invitations (workflow history) instead of
        // company_memberships (current state) — that was the root cause of
        // stale invitees being shown as admins. Now identity reflects only
        // CURRENT membership rows, which the L1 invariants guarantee correct.
        const identity = await loadCanonicalIdentity(supabase);
        if (!mountedRef.current) return;

        if (identity.active_company) {
          // Owner / employee / dispatcher with active membership → dashboard
          initRealtimeChannels(identity.active_company.id);
          useDashboardStore.getState().initDashboard();
          pendingLoginRef.current = { name, company: identity.active_company.name };
          setLoginName(name);
          if (getStoredPin(session.user.id)) {
            setPinInput(""); setPinError("");
            setStep("pin-verify");
          } else {
            doLogin(name, identity.active_company.name);
          }
          return;
        }

        // No active membership → show login form (civilian / unconfirmed)
        /* Audit 2026-05-01: removed destructive PIN wipe. PIN is now scoped
       per-user via PIN_KEY_PREFIX, persists across logout, and is
       independently set up by each user on the same device. */ void 0;
        setStep("form");
      } catch (err) {
        // L3-followup-2 (#181): also persist mount-time errors.
        const errInfo = err instanceof Error
          ? { name: err.name, message: err.message, stack: (err.stack||"").split("\n").slice(0,3).join(" | ") }
          : { raw: String(err) };
        try {
          const diag = { ts: new Date().toISOString(), route: "mount", err: errInfo };
          const prior = JSON.parse(localStorage.getItem("_auth_diag") || "[]");
          prior.push(diag);
          localStorage.setItem("_auth_diag", JSON.stringify(prior.slice(-10)));
        } catch (_) { /* ignore */ }
        console.error("[Auth] Unexpected error on mount:", errInfo);
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

  // ── Core login (PIN-gated) ──
  //
  // Audit 2026-05-01 (CRITICAL ROOT FIX): every reachable path to
  // the dashboard now passes through this gate. If pinVerifiedRef is
  // false (the default for every fresh page load), we redirect to
  // pin-setup or pin-verify INSTEAD of stepping to dashboard. The
  // 6 historical bypass paths (handler #1 + handler #2 catch-alls,
  // DB-error paths, no-PIN owner branch) all funnel through here
  // and are now safe.
  const doLogin = useCallback((name: string, company: string) => {
    if (!mountedRef.current) return;

    // ── PIN GATE ──
    if (!pinVerifiedRef.current) {
      // Always remember the pending login destination so the PIN
      // success handler can resume it.
      pendingLoginRef.current = { name, company };
      setLoginName(name);
      if (getStoredPin(session.user.id)) {
        setPinInput(""); setPinError("");
        setStep("pin-verify");
      } else {
        setPinInput(""); setPinConfirm(""); setPinStage("enter");
        setStep("pin-setup");
      }
      return;
    }

    // ── PIN already verified — proceed to welcome → dashboard ──
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
        // Audit 2026-05-01: close the PIN gate so the next sign-in
        // is forced through PIN verification again. Without this,
        // a returning session inside the same tab would inherit
        // pinVerifiedRef=true from the previous user.
        pinVerifiedRef.current = false;
        if (mountedRef.current) setStep("form");
        return;
      }
      // Pivot 2026-04-30: also trigger on INITIAL_SESSION so that a page
      // reload with an existing session still registers the Web Push
      // subscription. Previously SIGNED_IN was the only path, which
      // meant a returning user (Supabase auto-restores the session
      // from localStorage and fires INITIAL_SESSION instead) never
      // got their PushSubscription persisted into push_tokens.
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session?.user) {
        // Audit 2026-04-30 (HIGH#10): dedupe by user.id, not bare flag.
        if (processingRef.current === session.user.id) return;
        processingRef.current = session.user.id;
        // Audit 2026-04-30 (HIGH#11): require verified email before wizard.
        if (session.user.email_confirmed_at == null && !session.user.user_metadata?.email_verified) {
          console.warn("[Auth] email not verified — refusing to register company");
          processingRef.current = null;
          if (mountedRef.current) setStep("form");
          return;
        }
        // Audit 2026-04-30 (CRITICAL #4): bind fingerprint to this device
        // so a stolen JWT used from another device fails validateSession-
        // Fingerprint() on the next page load. Existing dead code in
        // supabase-client.ts:433 is now wired to its actual purpose.
        // Best-effort — never fails sign-in. SOS pages can later call
        // validateSessionFingerprint(true) to skip validation during
        // emergencies (already supported by the function).
        bindSessionToDevice().catch((e) => console.warn("[Auth] fingerprint bind failed (non-fatal):", e));
        window.history.replaceState({}, "", "/dashboard");
        const name = session.user.user_metadata?.full_name || session.user.email || "Admin";
        // Audit 2026-05-01: expose user id to the
        // NotificationPermissionBanner (it scopes the saved subscription
        // to this user). Uses setState so React re-renders the banner.
        setAuthUserId(session.user.id);

        // BLOCKER #19 / Audit #4 (2026-04-29): register the FCM push
        // token now that we have a userId. Dynamic-imported so a
        // missing firebase dep / VAPID key only produces a warning,
        // never blocks the dashboard load.
        void (async () => {
          try {
            const { initFCM } = await import("./api/fcm-push");
            await initFCM(session.user.id);
          } catch (err) {
            console.warn("[Dashboard] initFCM failed (non-fatal):", err);
          }
        })();

        try {
          // FOUNDATION-1 / Phase 5d (#180): single-RPC identity resolution +
          // safety-net accept_invitation. welcome-activation.tsx normally
          // claims pending invitations on /welcome; this defensive call
          // covers the case where a freshly-OAuthed user lands on /dashboard
          // directly with a still-pending invitation. Idempotent — returns
          // ok:false with reason='no_pending_invitation' when there is
          // nothing to claim, so it is safe to always run.
          await supabase.rpc("accept_invitation").catch((e) =>
            console.warn("[Auth] accept_invitation prefetch failed (non-fatal):", e),
          );

          const identity = await loadCanonicalIdentity(supabase);
          if (!mountedRef.current) { processingRef.current = null; return; }

          if (identity.active_company) {
            // Active membership (owner | admin | employee | dispatcher) → dashboard
            initRealtimeChannels(identity.active_company.id);
            useDashboardStore.getState().initDashboard();
            pendingLoginRef.current = { name, company: identity.active_company.name };
            setLoginName(name);
            if (getStoredPin(session.user.id)) {
              setPinInput(""); setPinError("");
              setStep("pin-verify");
            } else {
              setPinInput(""); setPinConfirm(""); setPinStage("enter");
              setStep("pin-setup");
            }
          } else {
            // ── NEW USER → REGISTER ──
            /* Audit 2026-05-01: removed destructive PIN wipe. PIN is now scoped
       per-user via PIN_KEY_PREFIX, persists across logout, and is
       independently set up by each user on the same device. */ void 0;
            setLoginName(name);
            setStep("register");
          }
        } catch (err) {
          // L3-followup-2 (#181): EnvShield + minification mask console
          // output, so persist a structured breadcrumb to localStorage we
          // can read back via JS without EnvShield's redaction.
          const errInfo = err instanceof Error
            ? { name: err.name, message: err.message, stack: (err.stack||"").split("\n").slice(0,3).join(" | ") }
            : { raw: String(err) };
          try {
            const diag = { ts: new Date().toISOString(), route: "onAuthStateChange", err: errInfo };
            const prior = JSON.parse(localStorage.getItem("_auth_diag") || "[]");
            prior.push(diag);
            localStorage.setItem("_auth_diag", JSON.stringify(prior.slice(-10)));
          } catch (_) { /* localStorage full or disabled — ignore */ }
          console.error("[Auth] Unexpected error:", errInfo);
          useDashboardStore.getState().initDashboard();
          pendingLoginRef.current = { name, company: "SOSphere Demo" };
          setLoginName(name);
          doLogin(name, "SOSphere Demo");
        }
        // Audit 2026-04-30 (Medium#28): release lock immediately, not
        // after 3-second timeout. The user.id-based dedupe prevents double-fire.
        processingRef.current = null;
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
  // Audit 2026-04-30 (HIGH#16): wrap in try/catch + loading state.
  const [oauthLoading, setOauthLoading] = useState(false);
  const handleGoogleSignIn = async () => {
    if (oauthLoading) return;
    setOauthLoading(true);
    try {
      // Audit 2026-04-30 (HIGH #9): redirect URL allowlist. Trusting
      // window.location.origin let preview-domain or attacker-controlled
      // subdomains catch the OAuth return. We pin redirectTo to the
      // canonical production origin in production builds; dev mode falls
      // back to the live origin so localhost still works.
      const PROD_ORIGIN = "https://sosphere-platform.vercel.app";
      const redirectOrigin = import.meta.env.PROD ? PROD_ORIGIN : window.location.origin;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${redirectOrigin}/dashboard`,
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) {
        showToast("Sign-in failed: " + (error.message || "please try again"));
        setOauthLoading(false);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      showToast("Sign-in failed: " + msg);
      setOauthLoading(false);
    }
  };

  // ── Email OTP Send ──
  // Audit 2026-04-30 (CRITICAL #5): server-side rate-limit before
  // touching Supabase. Previously the lockout (3 attempts/60s) was
  // pure React state — bypassed by reload. Now check_rate_limit RPC
  // enforces 5 sends/hour per email regardless of client state.
  const handleEmailSend = async () => {
    if (!isEmailValid) return;
    setEmailOtpLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const { data: rl } = await supabase.rpc("check_rate_limit", {
        p_bucket: "otp_send",
        p_identifier: normalizedEmail,
        p_max_attempts: 5,
        p_window_seconds: 3600,
      });
      if (rl && (rl as any).allowed === false) {
        const wait = (rl as any).retry_after_s || 60;
        showToast("Too many attempts — try again in " + Math.ceil(wait / 60) + " minute(s)");
        return;
      }
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: { shouldCreateUser: true },
      });
      if (error) { showToast("Failed to send code: " + error.message); return; }
      setEmailOtp(""); setOtpAttempts(0); setLockedUntil(null);
      setStep("email-otp");
      showToast("Code sent to " + normalizedEmail, "success");
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
      // FOUNDATION-1 / Phase 5d (#180 follow-up): use canonical identity here too.
      // The previous block only checked `companies WHERE owner_id` — meaning an
      // employee/dispatcher who completed email OTP (e.g. invited user signing
      // in via OTP for the first time) was sent to /register instead of dashboard.
      // loadCanonicalIdentity reads memberships, so all roles route correctly.
      const identity = await loadCanonicalIdentity(supabase);
      if (!mountedRef.current) return;
      if (identity.active_company) {
        doLogin(name, identity.active_company.name);
      } else {
        setLoginName(name);
        setStep("register");
      }
    } finally {
      if (mountedRef.current) setEmailOtpLoading(false);
    }
  };

  // ── Email OTP Resend ──
  // Audit 2026-04-30 (CRITICAL): same server-side rate-limit as send.
  // Previously this path bypassed the otp_send hardening — clicking
  // "Resend" repeatedly let an attacker probe for valid emails or
  // trigger Supabase's email-quota limits.
  const handleEmailResend = async () => {
    if (emailResendTimer > 0) return;
    const normalizedEmail = email.trim().toLowerCase();
    const { data: rl } = await supabase.rpc("check_rate_limit", {
      p_bucket: "otp_send",
      p_identifier: normalizedEmail,
      p_max_attempts: 5,
      p_window_seconds: 3600,
    });
    if (rl && (rl as any).allowed === false) {
      const wait = (rl as any).retry_after_s || 60;
      showToast("Too many attempts — try again in " + Math.ceil(wait / 60) + " minute(s)");
      return;
    }
    setEmailResendTimer(RESEND_COOLDOWN);
    setEmailOtp(""); setOtpAttempts(0); setLockedUntil(null);
    const { error } = await supabase.auth.signInWithOtp({ email: normalizedEmail });
    if (error) showToast("Failed to resend: " + error.message);
    else showToast("New code sent to " + normalizedEmail, "success");
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
                onClick={() => {
                  if (!k) return;
                  const setter = pinStage === "enter" ? setPinInput : setPinConfirm;
                  setPinError("");
                  if (k === "⌫") { setter(p => p.slice(0, -1)); return; }
                  // Same atomic pattern as pin-verify (Audit 2026-04-30):
                  // functional updater so the length gate is checked against
                  // the LATEST state, not a stale closure capture.
                  setter(prev => {
                    if (prev.length >= 6) return prev;
                    const next = prev + k;
                    if (next.length === 6) {
                      if (pinStage === "enter") {
                        setTimeout(() => {
                          if (!mountedRef.current) return;
                          setPinStage("confirm");
                        }, 300);
                      } else {
                        // pinStage === "confirm" — verify the second entry
                        // matches the first, then store + log in.
                        if (next === pinInput) {
                          void (async () => {
                            await storePin(authUserId, pinInput);
                            if (!mountedRef.current) return;
                            // Audit 2026-05-01: PIN was just set + stored
                            // — open the gate so doLogin proceeds to
                            // dashboard. Without this we would loop back
                            // to pin-verify (which would now succeed but
                            // is a wasted round-trip).
                            pinVerifiedRef.current = true;
                            const pending = pendingLoginRef.current;
                            if (pending) {
                              doLogin(pending.name, pending.company);
                            } else {
                              const n = loginName || "Admin";
                              const c = loginCompany || "Your Company";
                              doLogin(n, c);
                            }
                          })();
                        } else {
                          setPinError("PINs do not match. Try again.");
                          setPinInput(""); setPinConfirm(""); setPinStage("enter");
                          setTimeout(() => {
                            if (!mountedRef.current) return;
                            setPinError("");
                          }, 2000);
                        }
                      }
                    }
                    return next;
                  });
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
                onClick={() => {
                  if (!k) return;
                  setPinError("");
                  if (k === "⌫") { setPinInput(p => p.slice(0, -1)); return; }
                  // Audit 2026-04-30 (CRITICAL bug fix): use functional
                  // updater so the length check sees the LATEST pinInput,
                  // not a stale closure capture. Without this, fast clicks
                  // before React re-renders could compute the wrong `next`
                  // and trigger validation on a partial PIN — or worse,
                  // skip the length === 6 gate entirely.
                  setPinInput(prev => {
                    if (prev.length >= 6) return prev;
                    const next = prev + k;
                    if (next.length === 6) {
                      // Run validation OUTSIDE the updater (no side effects
                      // inside setState). The updater only computes the
                      // new value; validation is fired-and-forgotten.
                      void (async () => {
                        const valid = await checkPin(authUserId, next);
                        if (!mountedRef.current) return;
                        if (valid) {
                          // Audit 2026-05-01: open the PIN gate before
                          // calling doLogin so it proceeds to dashboard
                          // instead of looping back to pin-verify.
                          pinVerifiedRef.current = true;
                          const pending = pendingLoginRef.current;
                          if (pending) doLogin(pending.name, pending.company);
                        } else {
                          setPinError("Incorrect PIN. Try again.");
                          setTimeout(() => {
                            if (!mountedRef.current) return;
                            setPinInput(""); setPinError("");
                          }, 800);
                        }
                      })();
                    }
                    return next;
                  });
                }}
                style={{ height: 56, borderRadius: 14, background: k ? "rgba(255,255,255,0.06)" : "transparent", border: k ? "1px solid rgba(255,255,255,0.08)" : "none", color: "#fff", fontSize: 20, fontWeight: 600, cursor: k ? "pointer" : "default", opacity: k ? 1 : 0 }}
              >{k}</button>
            ))}
          </div>
          <button onClick={async () => {
              // Audit 2026-05-01: explicitly close the PIN gate on
              // "Sign in with different account" so the next user
              // is forced through PIN verification.
              pinVerifiedRef.current = false;
              const { completeLogout } = await import("./api/complete-logout");
              await completeLogout();
              setStep("form"); setPinInput("");
            }}
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
      <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#05070E", fontFamily: "'Outfit', sans-serif", position: "relative" }}>
        {/* Lifesaving fix (audit 2026-05-01): prompt user to enable
            Web Push if permission is "default". Without this, browsers
            silently block requestPermission() outside user gestures and
            push_tokens stays empty -> SOS alerts never reach the owner.
            Banner overlays on top of the dashboard so it does not
            disturb the existing CompanyDashboard layout. Hides itself
            when permission is granted, denied, or snoozed for 24h. */}
        <div style={{
          position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)",
          zIndex: 100, width: "min(720px, calc(100% - 32px))", pointerEvents: "auto",
        }}>
          <NotificationPermissionBanner userId={authUserId ?? undefined} />
        </div>
        <CompanyDashboard
          companyName={loginCompany}
          webMode={true}
          onSOSTrigger={() => {}}
          onLogout={async () => {
            // S-H5: completeLogout handles dashboard session + all
            // other sosphere_* keys + supabase.auth.signOut() + event.
            // Audit 2026-05-01: also close the PIN gate so a re-login
            // in the same tab is forced through PIN verification.
            pinVerifiedRef.current = false;
            const { completeLogout } = await import("./api/complete-logout");
            await completeLogout();
            // Dashboard PIN is a user-chosen admin PIN; completeLogout
            // also sweeps it via the prefix scan, but be explicit here
            // so intent is obvious to future readers.
            try { /* Audit 2026-05-01: removed destructive PIN wipe. PIN is now scoped
       per-user via PIN_KEY_PREFIX, persists across logout, and is
       independently set up by each user on the same device. */ void 0; } catch { /* ignore */ }
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
                  // FOUNDATION-1 / Phase 5d (#180 follow-up): ditto. Right
                  // after register_company_full, the new owner-membership
                  // exists. Use the canonical RPC so we get the real
                  // company_id from active_company without an extra query.
                  const identity = await loadCanonicalIdentity(supabase);
                  if (identity.active_company?.id) initRealtimeChannels(identity.active_company.id);
                } catch (_) {}
                // After registration → show PIN setup.
                // Audit 2026-04-30 (CRITICAL bug fix): do NOT call
                // setDashboardSession() here — that pre-authorizes the
                // user via the dashboardAuthLoader BEFORE a PIN exists.
                // If the user reloads the tab between register and
                // pin-setup, the next mount finds a session + company
                // + NO stored PIN → falls through the `else` branch of
                // the auth listener and calls doLogin() directly,
                // bypassing PIN entirely. Session is now persisted only
                // inside doLogin() AFTER PIN is verified.
                setLoginName(name);
                setLoginCompany(company);
                pendingLoginRef.current = { name, company };
                {
                  const sid = (await supabase.auth.getSession()).data.session?.user.id || "post-register";
                  processingRef.current = sid;
                }
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
                      <motion.button whileTap={{ scale: oauthLoading ? 1 : 0.97 }} onClick={handleGoogleSignIn}
                        disabled={oauthLoading}
                        className="w-full flex items-center justify-center gap-3 py-4 rounded-[16px] mb-4 transition-all"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.9)", opacity: oauthLoading ? 0.55 : 1, cursor: oauthLoading ? "wait" : "pointer" }}>
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
