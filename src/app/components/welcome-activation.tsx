// ═══════════════════════════════════════════════════════════════
// SOSphere — Employee Welcome & Invitation Activation
// Handles Supabase invite links: /welcome#access_token=...&type=invite
// ═══════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Shield, Eye, EyeOff, CheckCircle2, AlertTriangle, Loader2, ArrowRight, Smartphone } from "lucide-react";
import { supabase } from "./api/supabase-client";
import { useLang } from "./useLang";

type ActivationStep = "loading" | "set-password" | "success" | "error" | "already-active";

// #170 fix A helper: declarative auto-redirect on the success page.
// Renders nothing, side-effect only. Pure function component so React's
// strict-mode double-invocation in dev still results in a single timer
// (StrictMode runs the effect → cleanup → effect again, net 1 timer).
function AutoRedirect({ href, delayMs }: { href: string; delayMs: number }) {
  useEffect(() => {
    const t = window.setTimeout(() => {
      // Use replace so the user can't "Back" into the consumed activation URL.
      window.location.replace(href);
    }, delayMs);
    return () => window.clearTimeout(t);
  }, [href, delayMs]);
  return null;
}

export function WelcomeActivation() {
  const { isAr } = useLang();
  const dir = isAr ? "rtl" : "ltr";
  const font = isAr ? "'Tajawal','Outfit',sans-serif" : "'Outfit','Tajawal',sans-serif";

  const [step, setStep] = useState<ActivationStep>("loading");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [userName, setUserName] = useState("");
  const [companyName, setCompanyName] = useState("");

  // ── Parse Supabase invite tokens from URL hash OR PKCE code ──
  // Audit 2026-04-30 (BREAKING after PKCE pivot): Supabase invites
  // historically returned tokens in the URL hash. Under PKCE flow
  // they return ?code=... in the query string and must be exchanged
  // via supabase.auth.exchangeCodeForSession(). Support both paths.
  useEffect(() => {
    (async () => {
      const hash = window.location.hash.substring(1);
      const hashParams = new URLSearchParams(hash);
      const accessToken  = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const hashType     = hashParams.get("type");

      const queryParams = new URLSearchParams(window.location.search);
      const code         = queryParams.get("code");
      const queryType    = queryParams.get("type");

      const inviteType = hashType || queryType || "invite";
      let session: any = null;
      let exchangeErr: any = null;

      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        session = data?.session ?? null;
        exchangeErr = error;
      } else if (accessToken && refreshToken) {
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        session = data?.session ?? null;
        exchangeErr = error;
      } else {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          setStep("already-active");
          return;
        }
        setStep("error");
        setErrorMsg(isAr
          ? "رابط الدعوة غير صالح أو انتهت صلاحيته. تواصل مع مشرفك."
          : "Invitation link is invalid or has expired. Please contact your supervisor."
        );
        return;
      }

      if (exchangeErr || !session) {
        setStep("error");
        setErrorMsg(isAr
          ? "انتهت صلاحية رابط الدعوة. اطلب دعوة جديدة من مشرفك."
          : "Invitation link has expired. Ask your supervisor to resend the invitation."
        );
        return;
      }

      const user = session.user;
      setUserName(user.user_metadata?.full_name || user.email?.split("@")[0] || "");

      const { data: empData } = await supabase
        .from("employees")
        .select("company_id, companies(name)")
        .eq("email", user.email)
        .single();

      if (empData?.companies) {
        setCompanyName((empData.companies as any).name || "");
      }

      if (inviteType === "invite" || !user.user_metadata?.password_set) {
        setStep("set-password");
      } else {
        setStep("already-active");
      }
    })();
  }, []);

  // ── Password strength ────────────────────────────────────────
  const passwordStrength = (() => {
    if (password.length === 0) return { score: 0, label: "", color: "" };
    let score = 0;
    if (password.length >= 8)              score++;
    if (/[A-Z]/.test(password))            score++;
    if (/[0-9]/.test(password))            score++;
    if (/[^A-Za-z0-9]/.test(password))     score++;
    const labels = isAr
      ? ["ضعيف جداً", "ضعيف", "متوسط", "قوي", "قوي جداً"]
      : ["Very Weak", "Weak", "Fair", "Strong", "Very Strong"];
    const colors = ["#FF2D55", "#FF4D00", "#FF9500", "#00C8E0", "#00C853"];
    return { score, label: labels[score], color: colors[score] };
  })();

  // ── Submit new password ──────────────────────────────────────
  const handleSetPassword = async () => {
    if (password.length < 8) {
      setErrorMsg(isAr ? "كلمة المرور يجب أن تكون 8 أحرف على الأقل" : "Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg(isAr ? "كلمتا المرور غير متطابقتين" : "Passwords do not match");
      return;
    }
    setIsSubmitting(true);
    setErrorMsg("");

    const { error } = await supabase.auth.updateUser({
      password,
      data: { password_set: true },
    });

    if (error) {
      setErrorMsg(error.message);
      setIsSubmitting(false);
      return;
    }

    // Blocker A fix (2026-04-30): bridge invitation -> membership.
    // Without this RPC, the invited employee sets a password but never
    // becomes a company member (orphan account). The RPC is idempotent
    // and SECDEF, so it is safe to call here regardless of whether the
    // membership already exists. Errors are surfaced softly: success
    // card still shows, but a console warning helps debug if the
    // invitation lookup failed.
    try {
      const { data: claim, error: claimErr } = await supabase.rpc("accept_invitation");
      if (claimErr) {
        console.warn("[Welcome] accept_invitation RPC failed (non-fatal):", claimErr.message);
      } else if (claim && (claim as any).ok === false) {
        console.warn("[Welcome] No matching invitation:", (claim as any).reason);
      } else {
        console.log("[Welcome] Joined company:", (claim as any)?.company_id, "as", (claim as any)?.role);
      }
    } catch (e) {
      console.warn("[Welcome] accept_invitation threw (non-fatal):", e);
    }

    setStep("success");
    setIsSubmitting(false);
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5"
      style={{ background: "#05070E", direction: dir, fontFamily: font }}
    >
      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 mb-10"
      >
        <div className="size-10 rounded-2xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.2), rgba(0,200,224,0.05))", border: "1px solid rgba(0,200,224,0.2)" }}>
          <Shield className="size-5" style={{ color: "#00C8E0" }} />
        </div>
        <span style={{ fontSize: 20, fontWeight: 800, color: "rgba(255,255,255,0.95)", letterSpacing: "-0.4px" }}>
          SOSphere
        </span>
      </motion.div>

      <AnimatePresence mode="wait">

        {/* ── Loading ── */}
        {step === "loading" && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-4">
            <Loader2 className="size-10 animate-spin" style={{ color: "#00C8E0" }} />
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)" }}>
              {isAr ? "جاري التحقق من دعوتك..." : "Verifying your invitation..."}
            </p>
          </motion.div>
        )}

        {/* ── Set Password ── */}
        {step === "set-password" && (
          <motion.div key="set-password"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-sm"
          >
            {/* Header */}
            <div className="text-center mb-8">
              <div className="size-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)" }}>
                <Shield className="size-8" style={{ color: "#00C8E0" }} />
              </div>
              <h1 style={{ fontSize: 24, fontWeight: 800, color: "rgba(255,255,255,0.95)", letterSpacing: "-0.4px", marginBottom: 8 }}>
                {isAr ? `مرحباً، ${userName || "بك"}` : `Welcome, ${userName || "there"}`}
              </h1>
              {companyName && (
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>
                  {isAr ? `تمت دعوتك للانضمام إلى` : `You've been invited to join`}
                  {" "}
                  <span style={{ color: "#00C8E0", fontWeight: 700 }}>{companyName}</span>
                </p>
              )}
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)" }}>
                {isAr ? "اختر كلمة مرور لحساب SOSphere الخاص بك" : "Set a password for your SOSphere account"}
              </p>
            </div>

            {/* Password Field */}
            <div className="space-y-4">
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 8 }}>
                  {isAr ? "كلمة المرور" : "Password"}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={isAr ? "8 أحرف على الأقل" : "At least 8 characters"}
                    className="w-full px-4 py-3.5 rounded-xl outline-none"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      color: "rgba(255,255,255,0.9)",
                      fontSize: 14,
                      paddingInlineEnd: 44,
                    }}
                  />
                  <button
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute top-1/2 -translate-y-1/2"
                    style={{ insetInlineEnd: 14 }}
                  >
                    {showPassword
                      ? <EyeOff className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
                      : <Eye className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
                    }
                  </button>
                </div>
                {/* Strength bar */}
                {password.length > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 flex gap-1">
                      {[0,1,2,3].map(i => (
                        <div key={i} className="flex-1 h-1 rounded-full transition-all duration-300"
                          style={{ background: i < passwordStrength.score ? passwordStrength.color : "rgba(255,255,255,0.08)" }} />
                      ))}
                    </div>
                    <span style={{ fontSize: 10, color: passwordStrength.color, fontWeight: 600 }}>
                      {passwordStrength.label}
                    </span>
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 8 }}>
                  {isAr ? "تأكيد كلمة المرور" : "Confirm Password"}
                </label>
                <div className="relative">
                  <input
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder={isAr ? "أعد كتابة كلمة المرور" : "Re-enter password"}
                    className="w-full px-4 py-3.5 rounded-xl outline-none"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: `1px solid ${confirmPassword && password !== confirmPassword ? "rgba(255,45,85,0.4)" : "rgba(255,255,255,0.08)"}`,
                      color: "rgba(255,255,255,0.9)",
                      fontSize: 14,
                      paddingInlineEnd: 44,
                    }}
                  />
                  <button
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute top-1/2 -translate-y-1/2"
                    style={{ insetInlineEnd: 14 }}
                  >
                    {showConfirm
                      ? <EyeOff className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
                      : <Eye className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
                    }
                  </button>
                </div>
              </div>

              {/* Error */}
              {errorMsg && (
                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl"
                  style={{ background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.2)" }}>
                  <AlertTriangle className="size-4 shrink-0" style={{ color: "#FF2D55" }} />
                  <p style={{ fontSize: 12, color: "#FF2D55" }}>{errorMsg}</p>
                </motion.div>
              )}

              {/* Submit */}
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleSetPassword}
                disabled={isSubmitting || !password || !confirmPassword}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-xl"
                style={{
                  background: isSubmitting || !password || !confirmPassword
                    ? "rgba(255,255,255,0.04)"
                    : "linear-gradient(135deg, #00C8E0, #00A5C0)",
                  color: isSubmitting || !password || !confirmPassword ? "rgba(255,255,255,0.2)" : "#fff",
                  fontSize: 15,
                  fontWeight: 700,
                  border: "none",
                  cursor: isSubmitting || !password || !confirmPassword ? "default" : "pointer",
                }}
              >
                {isSubmitting
                  ? <Loader2 className="size-4 animate-spin" />
                  : <>
                      {isAr ? "تفعيل الحساب" : "Activate Account"}
                      <ArrowRight className="size-4" />
                    </>
                }
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* ── Success ── */}
        {step === "success" && (
          <motion.div key="success"
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center text-center max-w-xs gap-6"
          >
            <motion.div
              initial={{ scale: 0 }} animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
              className="size-20 rounded-3xl flex items-center justify-center"
              style={{ background: "rgba(0,200,83,0.15)", border: "1px solid rgba(0,200,83,0.3)" }}
            >
              <CheckCircle2 className="size-10" style={{ color: "#00C853" }} />
            </motion.div>

            <div>
              <h2 style={{ fontSize: 24, fontWeight: 800, color: "rgba(255,255,255,0.95)", letterSpacing: "-0.4px", marginBottom: 8 }}>
                {isAr ? "تم تفعيل حسابك! 🎉" : "Account Activated! 🎉"}
              </h2>
              {companyName && (
                <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.6, marginBottom: 4 }}>
                  {isAr ? `أنت الآن عضو في` : `You're now a member of`}{" "}
                  <span style={{ color: "#00C8E0", fontWeight: 700 }}>{companyName}</span>
                </p>
              )}
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
                {isAr
                  ? "سننقلك إلى التطبيق خلال ثوانٍ..."
                  : "Taking you to the app in a moment..."
                }
              </p>
            </div>

            {/* #170 fix A (2026-05-02): real CTA replacing dead Download buttons.
                Browser-native button is the primary path — the user already has a
                live Supabase session (set by exchangeCodeForSession in the load
                effect). The mobile-app entry point (#170 fix B) detects the
                active company_membership and routes them straight to
                employee-dashboard, bypassing the civilian/employee picker and
                LoginPhone screens. ?from=welcome is a hint for analytics + any
                future first-run logic on /app. */}
            <a
              href="/app?from=welcome"
              className="w-full flex items-center justify-center gap-2"
              style={{
                padding: "14px 20px",
                borderRadius: 16,
                background: "linear-gradient(135deg, #00C8E0, #00A5C0)",
                color: "#fff",
                fontSize: 15,
                fontWeight: 700,
                textDecoration: "none",
                boxShadow: "0 8px 28px rgba(0,200,224,0.35)",
              }}
            >
              {isAr ? "افتح التطبيق الآن" : "Open SOSphere App"}
              <ArrowRight className="size-4" />
            </a>

            {/* Download links shown ONLY as a secondary option — small, optional,
                does not block flow. Primary CTA above is the lifesaving path. */}
            <div className="w-full pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 8, textAlign: "center" }}>
                {isAr ? "أو حمّل التطبيق المخصّص لاحقاً" : "Or download the native app later"}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <a href="https://apps.apple.com/app/sosphere" target="_blank" rel="noopener noreferrer"
                  className="py-2 rounded-lg flex items-center justify-center gap-1.5"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", textDecoration: "none" }}>
                  <Smartphone className="size-3" style={{ color: "rgba(255,255,255,0.4)" }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>App Store</span>
                </a>
                <a href="https://play.google.com/store/apps/details?id=app.sosphere" target="_blank" rel="noopener noreferrer"
                  className="py-2 rounded-lg flex items-center justify-center gap-1.5"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", textDecoration: "none" }}>
                  <Smartphone className="size-3" style={{ color: "rgba(255,255,255,0.4)" }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>Google Play</span>
                </a>
              </div>
            </div>

            {/* Auto-redirect after 3s — the user's session is already live, so
                /app entry will fast-path them to employee-dashboard immediately
                (see mobile-app.tsx #170 fix B). */}
            <AutoRedirect href="/app?from=welcome" delayMs={3000} />
          </motion.div>
        )}

        {/* ── Already Active ── */}
        {step === "already-active" && (
          <motion.div key="already-active"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center text-center max-w-xs gap-6"
          >
            <div className="size-16 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(0,200,83,0.1)", border: "1px solid rgba(0,200,83,0.2)" }}>
              <CheckCircle2 className="size-8" style={{ color: "#00C853" }} />
            </div>
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: "rgba(255,255,255,0.95)", marginBottom: 8 }}>
                {isAr ? "حسابك نشط بالفعل" : "Your account is already active"}
              </h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
                {isAr ? "انتقل للتطبيق لتسجيل الدخول" : "Go to the app to sign in"}
              </p>
            </div>
            <a href="/app"
              className="flex items-center gap-2 px-6 py-3.5 rounded-xl"
              style={{ background: "linear-gradient(135deg, #00C8E0, #00A5C0)", color: "#fff", fontSize: 14, fontWeight: 700, textDecoration: "none" }}>
              {isAr ? "الذهاب للتطبيق" : "Go to App"}
              <ArrowRight className="size-4" />
            </a>
          </motion.div>
        )}

        {/* ── Error ── */}
        {step === "error" && (
          <motion.div key="error"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center text-center max-w-xs gap-6"
          >
            <div className="size-16 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.2)" }}>
              <AlertTriangle className="size-8" style={{ color: "#FF2D55" }} />
            </div>
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: "rgba(255,255,255,0.95)", marginBottom: 8 }}>
                {isAr ? "رابط غير صالح" : "Invalid Link"}
              </h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>{errorMsg}</p>
            </div>
            <a href="/"
              style={{ fontSize: 13, color: "#00C8E0", textDecoration: "none" }}>
              {isAr ? "العودة للصفحة الرئيسية" : "Back to Home"}
            </a>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
