import { TermsPage } from "./terms-page";
import { PrivacyPage } from "./privacy-page";
import { useState } from "react";
import { Shield, ArrowRight, Mail, Lock, Eye, EyeOff } from "lucide-react";
import { CountrySheet, COUNTRIES, type Country } from "./country-picker";
import { OTPVerify } from "./otp-verify";
import { useLang } from "./useLang";

interface LoginPhoneProps {
  onSendOTP: (phone: string) => void;
  onGmailLogin: () => void;
  onDemoAccess?: (role?: string, name?: string) => void;
  onEmailLogin?: (email: string, name: string) => void;
  onLoginComplete?: (phone: string) => void;
}

export function LoginPhone({ onSendOTP, onGmailLogin, onDemoAccess, onEmailLogin, onLoginComplete }: LoginPhoneProps) {
  const { isAr } = useLang();
  const [showOTP, setShowOTP] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [pendingPhone, setPendingPhone] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState<Country>(COUNTRIES.find(c => c.code === "SA")!);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  // #170 fix C (2026-05-02): email + password fallback for employees whose
  // company invite created a yahoo/hotmail/outlook/custom-domain account.
  // Phone+SMS (Twilio) is region-locked and Google OAuth only works for
  // Google accounts — neither serves a yahoo employee who set their
  // password 2 minutes ago in welcome-activation.tsx.
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [showEmailPassword, setShowEmailPassword] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState("");

  const handleEmailPasswordSubmit = async () => {
    setEmailError("");
    if (!email || !emailPassword) return;
    if (emailPassword.length < 8) {
      setEmailError(isAr ? "كلمة المرور يجب أن تكون 8 أحرف على الأقل" : "Password must be at least 8 characters");
      return;
    }
    setEmailLoading(true);
    try {
      const { supabase } = await import("./api/supabase-client");
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: emailPassword,
      });
      if (error) {
        setEmailError(error.message || (isAr ? "بيانات الدخول غير صحيحة" : "Invalid credentials"));
        setEmailLoading(false);
        return;
      }
      // #170 design choice: full-page reload instead of in-React routing.
      // Reason: mobile-app.tsx restoreSession() runs once on mount and is
      // the ONLY code that performs the company-employee fast-path (#170
      // fix B). A reload guarantees that path runs with the fresh session
      // → routes employees straight to employee-dashboard. In-React
      // navigation would require duplicating the membership query +
      // routing logic here, which would drift from the canonical path.
      const name =
        data.user?.user_metadata?.full_name ||
        data.user?.email?.split("@")[0] ||
        "";
      if (onEmailLogin) {
        // Best-effort hint to parent (current handleEmailLogin is a no-op
        // for our flow but might be useful for analytics later).
        try { onEmailLogin(email, name); } catch { /* ignore */ }
      }
      window.location.reload();
    } catch (e) {
      console.warn("[LoginPhone] signInWithPassword threw:", e);
      setEmailError(isAr ? "خطأ في الاتصال. حاول مرة أخرى." : "Connection error. Please try again.");
      setEmailLoading(false);
    }
  };

  const isPhoneValid = phone.length >= 8;

  const handlePhoneSubmit = async () => {
    setOtpError("");
    if (!isPhoneValid) return;
    setOtpLoading(true);
    const full = `${country.dial}${phone}`;
    try {
      const { signInWithPhone } = await import("./api/supabase-client");
      const { error } = await signInWithPhone(full);
      if (error) { setOtpError(error); setOtpLoading(false); return; }
      setOtpLoading(false);
      setPendingPhone(full);
      setShowOTP(true);
    } catch {
      setOtpError(isAr ? "خطأ في الاتصال. حاول مرة أخرى." : "Connection error. Please try again.");
      setOtpLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      await onGmailLogin();
    } catch (e: any) {
      console.error("[LoginPhone] Google sign-in error:", e?.message || e);
    }
    setGoogleLoading(false);
  };

  if (showTerms) return <TermsPage onBack={() => setShowTerms(false)} />;
  if (showPrivacy) return <PrivacyPage onBack={() => setShowPrivacy(false)} />;
  if (showOTP) {
    return (
      <div className="app-screen" style={{ background: "#05070E" }}>
        <OTPVerify
          phone={pendingPhone}
          onVerify={() => { setShowOTP(false); if (onLoginComplete) onLoginComplete(pendingPhone); else onSendOTP(pendingPhone); }}
          onBack={() => setShowOTP(false)}
        />
      </div>
    );
  }

  const S = { fontFamily: isAr ? "'Tajawal','Outfit',sans-serif" : "'Outfit','Tajawal',sans-serif" };
  const dir = isAr ? "rtl" as const : "ltr" as const;

  return (
    <div className="app-screen" style={{ background: "#05070E", ...S, direction: dir }}>
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute" style={{ top: "-20%", left: "50%", transform: "translateX(-50%)", width: "min(140vw,560px)", height: "min(140vw,560px)", borderRadius: "50%", background: "radial-gradient(circle,rgba(0,200,224,.06) 0%,transparent 60%)" }} />
      </div>

      <div className="scroll-area relative z-10">
        <div className="px-6" style={{ paddingTop: "max(70px,env(safe-area-inset-top))", paddingBottom: "max(32px,env(safe-area-inset-bottom))" }}>

          {/* Logo + branding */}
          <div className="flex flex-col items-center" style={{ marginBottom: 36 }}>
            <div className="relative mb-3">
              <div className="absolute" style={{ inset: -14, borderRadius: 32, background: "radial-gradient(circle,rgba(0,200,224,.12) 0%,transparent 70%)", filter: "blur(10px)" }} />
              <div style={{ width: 60, height: 60, borderRadius: 18, background: "linear-gradient(135deg,rgba(0,200,224,.15),rgba(0,200,224,.05))", border: "1px solid rgba(0,200,224,.18)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                <Shield size={28} color="#00C8E0" />
              </div>
            </div>
            <span style={{ fontSize: 22, fontWeight: 900, color: "#fff", letterSpacing: "-.5px" }}>SOSphere</span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,.25)", marginTop: 4, ...S }}>
              {isAr ? "منصة سلامة العمال الميدانيين" : "Field Worker Safety Platform"}
            </span>
          </div>

          {/* Title */}
          <div style={{ marginBottom: 28 }}>
            <p style={{ fontSize: 22, fontWeight: 800, color: "#fff", textAlign: "center", ...S }}>
              {isAr ? "تسجيل الدخول" : "Sign In"}
            </p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,.3)", textAlign: "center", marginTop: 6, lineHeight: 1.6, ...S }}>
              {isAr ? "أدخل رقم هاتفك أو سجّل بحساب Google" : "Enter your phone number or sign in with Google"}
            </p>
          </div>

          {/* ═══════════════════════════════════════════════════════ */}
          {/* Phone Input Section                                    */}
          {/* ═══════════════════════════════════════════════════════ */}
          <div style={{ marginBottom: 14 }}>
            {/* Label */}
            <p style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,.4)", marginBottom: 8, ...S }}>
              {isAr ? "رقم الهاتف" : "Phone Number"}
            </p>

            {/* Country code + phone input row */}
            <div style={{ display: "flex", alignItems: "stretch", gap: 8, width: "100%" }}>
              {/* Country Code Selector */}
              <div
                onClick={() => setPickerOpen(true)}
                style={{
                  borderRadius: 14,
                  background: "rgba(255,255,255,.04)",
                  border: "1px solid rgba(255,255,255,.08)",
                  padding: "0 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  cursor: "pointer",
                  flexShrink: 0,
                  minHeight: 52,
                }}
              >
                <span style={{ fontSize: 20 }}>{country.flag}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,.6)", fontFamily: "'Outfit',sans-serif", direction: "ltr" }}>{country.dial}</span>
                <svg width="8" height="5" viewBox="0 0 8 5" fill="none"><path d="M1 1L4 4L7 1" stroke="rgba(255,255,255,.25)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>

              {/* Phone Number Input */}
              <div style={{
                flex: 1,
                borderRadius: 14,
                background: "rgba(255,255,255,.03)",
                border: phoneFocused ? "1px solid rgba(0,200,224,.4)" : "1px solid rgba(255,255,255,.08)",
                boxShadow: phoneFocused ? "0 0 0 3px rgba(0,200,224,.07)" : "none",
                transition: "all .2s",
                display: "flex",
                alignItems: "center",
              }}>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={e => setPhone(e.target.value.replace(/\D/g, ""))}
                  onFocus={() => setPhoneFocused(true)}
                  onBlur={() => setPhoneFocused(false)}
                  placeholder={isAr ? "رقم الهاتف" : "5XX XXX XXXX"}
                  maxLength={15}
                  style={{
                    width: "100%",
                    background: "transparent",
                    color: "#fff",
                    fontSize: 16,
                    fontWeight: 600,
                    fontFamily: "'Outfit',sans-serif",
                    letterSpacing: ".8px",
                    caretColor: "#00C8E0",
                    padding: "15px 14px",
                    direction: "ltr",
                    textAlign: "left",
                    outline: "none",
                    border: "none",
                  }}
                />
              </div>
            </div>

            {otpError && <p style={{ fontSize: 12, color: "#FF2D55", marginTop: 8, textAlign: "center" }}>{otpError}</p>}
          </div>

          {/* Send Verification Code Button */}
          <button
            onClick={handlePhoneSubmit}
            disabled={!isPhoneValid || otpLoading}
            className="w-full flex items-center justify-center gap-2"
            style={{
              height: 52,
              borderRadius: 14,
              background: isPhoneValid
                ? "linear-gradient(135deg,#00C8E0,#00A5C0)"
                : "rgba(255,255,255,.04)",
              color: isPhoneValid ? "#fff" : "rgba(255,255,255,.18)",
              fontSize: 15,
              fontWeight: 700,
              border: isPhoneValid ? "none" : "1px solid rgba(255,255,255,.06)",
              boxShadow: isPhoneValid ? "0 6px 24px rgba(0,200,224,.25)" : "none",
              transition: "all .25s",
              cursor: isPhoneValid ? "pointer" : "default",
              ...S,
            }}
          >
            {otpLoading
              ? (<><div style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", animation: "spin .8s linear infinite" }} />{isAr ? "جاري الإرسال..." : "Sending..."}</>)
              : (<>{isAr ? "إرسال رمز التحقق" : "Send Verification Code"}<ArrowRight size={16} /></>)}
          </button>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

          {/* Divider */}
          <div className="flex items-center gap-3" style={{ margin: "22px 0" }}>
            <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,.06)" }} />
            <span style={{ fontSize: 11, color: "rgba(255,255,255,.2)", fontWeight: 500, ...S }}>
              {isAr ? "أو" : "or"}
            </span>
            <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,.06)" }} />
          </div>

          {/* ═══════════════════════════════════════════════════════ */}
          {/* Google Sign-In Button                                  */}
          {/* ═══════════════════════════════════════════════════════ */}
          <button
            onClick={handleGoogleSignIn}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-3"
            style={{
              height: 52,
              borderRadius: 14,
              background: "rgba(255,255,255,.06)",
              border: "1px solid rgba(255,255,255,.1)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: googleLoading ? "wait" : "pointer",
              transition: "all .2s",
              ...S,
            }}
          >
            {googleLoading ? (
              <>
                <div style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid rgba(255,255,255,.2)", borderTopColor: "#fff", animation: "spin .8s linear infinite" }} />
                <span style={{ color: "rgba(255,255,255,.5)" }}>{isAr ? "جاري التسجيل..." : "Signing in..."}</span>
              </>
            ) : (
              <>
                {/* Official Google G logo */}
                <svg width="18" height="18" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                </svg>
                <span>{isAr ? "تسجيل الدخول بحساب Google" : "Sign in with Google"}</span>
              </>
            )}
          </button>

          {/* #170 fix C: email + password (collapsed by default).
              For employees from invitation flow whose email is yahoo /
              hotmail / outlook / custom domain — they have a password
              from welcome-activation but no Phone/Google path. */}
          {!showEmailForm && (
            <button
              onClick={() => { setShowEmailForm(true); setEmailError(""); }}
              className="w-full"
              style={{
                marginTop: 12, padding: "10px 14px", borderRadius: 12,
                background: "transparent", border: "1px dashed rgba(255,255,255,.08)",
                color: "rgba(255,255,255,.45)", fontSize: 12, fontWeight: 600,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, ...S,
              }}
            >
              <Mail size={13} />
              {isAr ? "تسجيل الدخول بالبريد وكلمة المرور" : "Sign in with email & password"}
            </button>
          )}

          {showEmailForm && (
            <div style={{ marginTop: 14, padding: 14, borderRadius: 14, background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.06)" }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(0,200,224,.7)", marginBottom: 10, textAlign: "center", letterSpacing: ".5px", ...S }}>
                {isAr ? "للموظفين الذين سجّلوا عبر دعوة الشركة" : "For employees who joined via company invite"}
              </p>

              {/* Email */}
              <div style={{ position: "relative", marginBottom: 8 }}>
                <Mail size={14} style={{ position: "absolute", insetInlineStart: 12, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,.25)" }} />
                <input
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={isAr ? "البريد الإلكتروني" : "Email address"}
                  style={{
                    width: "100%", height: 46, borderRadius: 12,
                    background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)",
                    color: "#fff", fontSize: 14, fontWeight: 600,
                    paddingInlineStart: 36, paddingInlineEnd: 14,
                    outline: "none", direction: "ltr", textAlign: "left",
                    fontFamily: "'Outfit',sans-serif",
                  }}
                />
              </div>

              {/* Password */}
              <div style={{ position: "relative", marginBottom: 8 }}>
                <Lock size={14} style={{ position: "absolute", insetInlineStart: 12, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,.25)" }} />
                <input
                  type={showEmailPassword ? "text" : "password"}
                  value={emailPassword}
                  onChange={(e) => setEmailPassword(e.target.value)}
                  placeholder={isAr ? "كلمة المرور" : "Password"}
                  style={{
                    width: "100%", height: 46, borderRadius: 12,
                    background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)",
                    color: "#fff", fontSize: 14, fontWeight: 600,
                    paddingInlineStart: 36, paddingInlineEnd: 40,
                    outline: "none", direction: "ltr", textAlign: "left",
                    fontFamily: "'Outfit',sans-serif",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowEmailPassword(!showEmailPassword)}
                  style={{
                    position: "absolute", insetInlineEnd: 10, top: "50%", transform: "translateY(-50%)",
                    background: "transparent", border: "none", cursor: "pointer",
                    padding: 4, display: "flex", alignItems: "center",
                  }}
                >
                  {showEmailPassword
                    ? <EyeOff size={14} style={{ color: "rgba(255,255,255,.35)" }} />
                    : <Eye size={14} style={{ color: "rgba(255,255,255,.35)" }} />}
                </button>
              </div>

              {emailError && (
                <p style={{ fontSize: 11, color: "#FF2D55", marginBottom: 8, textAlign: "center", ...S }}>{emailError}</p>
              )}

              <button
                onClick={handleEmailPasswordSubmit}
                disabled={!email || !emailPassword || emailLoading}
                className="w-full flex items-center justify-center gap-2"
                style={{
                  height: 46, borderRadius: 12,
                  background: (email && emailPassword && !emailLoading)
                    ? "linear-gradient(135deg,#00C8E0,#00A5C0)"
                    : "rgba(255,255,255,.04)",
                  color: (email && emailPassword && !emailLoading) ? "#fff" : "rgba(255,255,255,.25)",
                  fontSize: 14, fontWeight: 700,
                  border: "none",
                  cursor: (email && emailPassword && !emailLoading) ? "pointer" : "default",
                  ...S,
                }}
              >
                {emailLoading
                  ? (<><div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", animation: "spin .8s linear infinite" }} />{isAr ? "جاري الدخول..." : "Signing in..."}</>)
                  : (<>{isAr ? "تسجيل الدخول" : "Sign In"}<ArrowRight size={14} /></>)}
              </button>

              <button
                onClick={() => { setShowEmailForm(false); setEmail(""); setEmailPassword(""); setEmailError(""); }}
                style={{
                  width: "100%", marginTop: 8, padding: 6,
                  background: "transparent", border: "none",
                  color: "rgba(255,255,255,.3)", fontSize: 11, fontWeight: 500,
                  cursor: "pointer", ...S,
                }}
              >
                {isAr ? "إلغاء" : "Cancel"}
              </button>
            </div>
          )}

          {/* Dev-only quick access */}
          {import.meta.env.DEV && onDemoAccess && (
            <button
              onClick={() => onDemoAccess?.()}
              style={{
                width: "100%", height: 40, borderRadius: 12, marginTop: 14,
                background: "rgba(255,150,0,.05)", border: "1px dashed rgba(255,150,0,.2)",
                color: "rgba(255,150,0,.6)", fontSize: 11, fontWeight: 600, ...S,
              }}
            >
              {isAr ? "دخول سريع للاختبار (dev only)" : "Quick Test Entry (dev only)"}
            </button>
          )}

          {/* Terms footer */}
          <p className="text-center" style={{ marginTop: 28, fontSize: 10, color: "rgba(255,255,255,.12)", lineHeight: 1.8, ...S }}>
            {isAr ? "بتسجيل الدخول، أنت توافق على" : "By signing in, you agree to our"}{" "}
            <button onClick={() => setShowTerms(true)} style={{ color: "rgba(0,200,224,.5)", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", textDecoration: "underline" }}>
              {isAr ? "شروط الاستخدام" : "Terms of Service"}
            </button>{" "}{isAr ? "و" : "and"}{" "}
            <button onClick={() => setShowPrivacy(true)} style={{ color: "rgba(0,200,224,.5)", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", textDecoration: "underline" }}>
              {isAr ? "سياسة الخصوصية" : "Privacy Policy"}
            </button>
          </p>
        </div>
      </div>

      <CountrySheet open={pickerOpen} selected={country} onSelect={setCountry} onClose={() => setPickerOpen(false)} />
    </div>
  );
}
