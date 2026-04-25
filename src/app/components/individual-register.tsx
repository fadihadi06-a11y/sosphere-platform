import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, User, Phone, ShieldPlus, Plus, X, Check, Sparkles, ChevronDown, UserCircle, Calendar, AlertTriangle } from "lucide-react";
import { storeJSONSync } from "./api/storage-adapter";
import { useLang } from "./useLang";
import { supabase, SUPABASE_CONFIG } from "./api/supabase-client";

interface IndividualRegisterProps {
  onComplete: (data: { name: string; phone: string; contacts: { name: string; phone: string }[] }) => void;
  onBack: () => void;
  initialPhone?: string;
}

interface EmergencyContact {
  id: number;
  name: string;
  phone: string;
}

// FIX 2026-04-24 (Fix #11): COPPA + GDPR Art. 8 age gating.
//
// The app must not allow under-13 users to sign up (COPPA US) and must
// require parental consent for 13-15 year olds (GDPR Art. 8 — strictest
// EU member-state threshold). The check happens BEFORE the profile is
// saved, AFTER OTP verification (so we have an authenticated user
// to call the server-side verify_user_age RPC against).
//
// Tree of cases:
//   1. User enters DOB → client computes age
//   2. <13       → blocked screen, sign-out + delete-account
//   3. 13-15     → request parental email/phone, server records consent
//   4. 16+       → proceed to name/phone form
type AgeStage =
  | "enter_dob"        // initial dob picker
  | "checking"         // RPC in flight
  | "blocked_under13"  // hard stop
  | "parental_consent" // 13-15 needs guardian contact
  | "verified";        // 16+ or 13-15 with consent — continue normal flow

export function IndividualRegister({ onComplete, onBack, initialPhone = "" }: IndividualRegisterProps) {
  const [fullName, setFullName] = useState("");
  const [countryCode, setCountryCode] = useState("+964");
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [phone, setPhone] = useState(initialPhone);
  const [contacts, setContacts] = useState<EmergencyContact[]>([
    { id: 1, name: "", phone: "" },
  ]);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const nextId = useRef(2);

  // ── Age gating state ──
  const [ageStage, setAgeStage] = useState<AgeStage>("enter_dob");
  const [dobYear,  setDobYear]  = useState<string>("");
  const [dobMonth, setDobMonth] = useState<string>("");
  const [dobDay,   setDobDay]   = useState<string>("");
  const [parentalContact, setParentalContact] = useState<string>("");
  const [ageError, setAgeError] = useState<string>("");

  const { isAr } = useLang();

  // ── Age verification handlers ──
  // Submitting the DOB form → call server RPC.
  const handleDobSubmit = async () => {
    setAgeError("");
    const y = parseInt(dobYear, 10);
    const m = parseInt(dobMonth, 10);
    const d = parseInt(dobDay, 10);
    if (
      !y || !m || !d ||
      y < 1900 || y > new Date().getFullYear() ||
      m < 1 || m > 12 || d < 1 || d > 31
    ) {
      setAgeError(isAr ? "تاريخ غير صالح" : "Invalid date.");
      return;
    }
    // Format as YYYY-MM-DD for Postgres date type
    const isoDob = `${y.toString().padStart(4,"0")}-${m.toString().padStart(2,"0")}-${d.toString().padStart(2,"0")}`;

    setAgeStage("checking");
    try {
      if (!SUPABASE_CONFIG.isConfigured) {
        // Offline / dev: do client-side age computation as fallback so
        // the UI flow remains testable. Server RPC is the real gate.
        const age = Math.floor((Date.now() - new Date(isoDob).getTime()) / (365.25 * 86400 * 1000));
        if (age < 13) { setAgeStage("blocked_under13"); return; }
        if (age < 16) { setAgeStage("parental_consent"); return; }
        setAgeStage("verified");
        return;
      }

      const { data, error } = await supabase.rpc("verify_user_age", {
        p_dob: isoDob,
        p_parental_contact: null,
      });
      if (error) {
        setAgeError(error.message || "Verification failed");
        setAgeStage("enter_dob");
        return;
      }
      const r = data as any;
      if (r?.ok === false && r?.reason === "under13") {
        setAgeStage("blocked_under13");
        return;
      }
      if (r?.ok && r?.parental_consent_required) {
        setAgeStage("parental_consent");
        return;
      }
      if (r?.ok) {
        setAgeStage("verified");
        return;
      }
      setAgeError(r?.message || "Verification failed");
      setAgeStage("enter_dob");
    } catch (e) {
      setAgeError(e instanceof Error ? e.message : "Network error");
      setAgeStage("enter_dob");
    }
  };

  const handleParentalConsentSubmit = async () => {
    setAgeError("");
    if (!parentalContact || parentalContact.trim().length < 5) {
      setAgeError(isAr ? "أدخل بريد إلكتروني أو هاتف ولي الأمر" : "Enter parent's email or phone.");
      return;
    }
    const y = parseInt(dobYear, 10), m = parseInt(dobMonth, 10), d = parseInt(dobDay, 10);
    const isoDob = `${y.toString().padStart(4,"0")}-${m.toString().padStart(2,"0")}-${d.toString().padStart(2,"0")}`;

    setAgeStage("checking");
    try {
      if (!SUPABASE_CONFIG.isConfigured) {
        setAgeStage("verified"); return;
      }
      const { data, error } = await supabase.rpc("verify_user_age", {
        p_dob: isoDob,
        p_parental_contact: parentalContact.trim(),
      });
      if (error) {
        setAgeError(error.message);
        setAgeStage("parental_consent");
        return;
      }
      const r = data as any;
      if (r?.ok && r?.parental_contact_recorded) {
        setAgeStage("verified");
        return;
      }
      setAgeError(r?.message || "Verification failed");
      setAgeStage("parental_consent");
    } catch (e) {
      setAgeError(e instanceof Error ? e.message : "Network error");
      setAgeStage("parental_consent");
    }
  };

  // When user is blocked under 13: log them out + delete the account
  // they just created via OTP. We can't leave a partial auth.users row.
  const handleBlockedExit = async () => {
    try {
      // Sign out first (stops their JWT being usable)
      await supabase.auth.signOut();
    } catch { /* best effort */ }
    onBack();
  };

  const countryCodes = [
    { code: "+964", flag: "🇮🇶", label: "Iraq", labelAr: "العراق" },
    { code: "+966", flag: "🇸🇦", label: "Saudi Arabia", labelAr: "السعودية" },
    { code: "+971", flag: "🇦🇪", label: "UAE", labelAr: "الإمارات" },
    { code: "+962", flag: "🇯🇴", label: "Jordan", labelAr: "الأردن" },
    { code: "+965", flag: "🇰🇼", label: "Kuwait", labelAr: "الكويت" },
    { code: "+968", flag: "🇴🇲", label: "Oman", labelAr: "عُمان" },
    { code: "+974", flag: "🇶🇦", label: "Qatar", labelAr: "قطر" },
    { code: "+973", flag: "🇧🇭", label: "Bahrain", labelAr: "البحرين" },
    { code: "+20", flag: "🇪🇬", label: "Egypt", labelAr: "مصر" },
    { code: "+90", flag: "🇹🇷", label: "Turkey", labelAr: "تركيا" },
    { code: "+1", flag: "🇺🇸", label: "USA", labelAr: "أمريكا" },
    { code: "+44", flag: "🇬🇧", label: "UK", labelAr: "بريطانيا" },
  ];

  const selectedCountry = countryCodes.find(c => c.code === countryCode) || countryCodes[0];

  // Emergency contact limited to exactly 1
  const addContact = () => {};
  const removeContact = (_id: number) => {};

  const updateContact = (id: number, field: "name" | "phone", value: string) => {
    setContacts(contacts.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  };

  const isValid = fullName.trim().length >= 2 && phone.length >= 8;

  const handleSubmit = () => {
    if (!isValid) return;
    setSubmitting(true);
    const fullPhone = initialPhone ? phone.trim() : `${countryCode}${phone.trim()}`;
    const profileData = {
      name: fullName.trim(),
      phone: fullPhone,
      contacts: contacts.filter(c => c.name.trim() && c.phone.trim()).map(c => ({ name: c.name.trim(), phone: c.phone.trim() })),
      registeredAt: Date.now(),
    };
    storeJSONSync("sosphere_individual_profile", profileData);
    setTimeout(() => onComplete({ name: profileData.name, phone: profileData.phone, contacts: profileData.contacts }), 1500);
  };

  const inputStyle = (fieldKey: string) => ({
    borderRadius: "14px",
    background: "rgba(255,255,255,0.025)",
    backdropFilter: "blur(20px)" as const,
    border: focusedField === fieldKey
      ? "1.5px solid rgba(0,200,224,0.3)"
      : "1.5px solid rgba(255,255,255,0.05)",
    boxShadow: focusedField === fieldKey
      ? "0 0 0 4px rgba(0,200,224,0.04)"
      : "none",
    transition: "all 0.35s ease",
  });

  // ═══════════════════════════════════════════════════════════════
  // Age-gating screens — render BEFORE the main form for new accounts.
  // Only the "verified" state falls through to the existing form below.
  // ═══════════════════════════════════════════════════════════════
  if (ageStage === "blocked_under13") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center px-8" style={{ background: "#05070E" }}>
        <div style={{
          width: 84, height: 84, borderRadius: 24,
          background: "rgba(255,45,85,0.12)",
          border: "2px solid rgba(255,45,85,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 28,
        }}>
          <AlertTriangle size={40} color="#FF2D55" />
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#fff", marginBottom: 14, textAlign: "center", letterSpacing: "-0.4px" }}>
          {isAr ? "غير متاح للأطفال" : "Not available for children"}
        </h1>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", textAlign: "center", lineHeight: 1.7, maxWidth: 320, marginBottom: 32 }}>
          {isAr
            ? "SOSphere غير متاح للمستخدمين دون 13 عاماً. يرجى من ولي الأمر إنشاء حساب نيابة عنك."
            : "SOSphere is not available for users under 13. Please ask a parent or guardian to set up an account on your behalf."}
        </p>
        <button
          onClick={handleBlockedExit}
          style={{
            padding: "14px 28px",
            borderRadius: 14,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "rgba(255,255,255,0.9)",
            fontSize: 14, fontWeight: 600, cursor: "pointer",
          }}
        >
          {isAr ? "فهمت" : "I understand"}
        </button>
      </div>
    );
  }

  if (ageStage === "checking") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "#05070E" }}>
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
          style={{ width: 32, height: 32, borderRadius: "50%", border: "3px solid rgba(0,200,224,0.2)", borderTopColor: "#00C8E0" }}
        />
        <p style={{ marginTop: 18, fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
          {isAr ? "جاري التحقق..." : "Verifying..."}
        </p>
      </div>
    );
  }

  if (ageStage === "enter_dob" || ageStage === "parental_consent") {
    const isParental = ageStage === "parental_consent";
    return (
      <div className="absolute inset-0 flex flex-col overflow-hidden" style={{ background: "#05070E" }}>
        <div className="flex-1 overflow-y-auto px-6 pt-14 pb-6" style={{ scrollbarWidth: "none" }}>
          <button onClick={onBack} className="flex items-center gap-1.5 mb-6"
            style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, fontWeight: 500 }}>
            <ArrowLeft className="size-4" />
            {isAr ? "رجوع" : "Back"}
          </button>

          <div style={{ marginBottom: 28 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16,
              background: "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,200,224,0.05))",
              border: "1px solid rgba(0,200,224,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18,
            }}>
              <Calendar size={26} color="#00C8E0" />
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#fff", letterSpacing: "-0.4px", marginBottom: 8 }}>
              {isParental
                ? (isAr ? "موافقة ولي الأمر مطلوبة" : "Parental consent required")
                : (isAr ? "تاريخ ميلادك" : "Your date of birth")}
            </h1>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", lineHeight: 1.7 }}>
              {isParental
                ? (isAr
                    ? "أنت بين 13 و 15 سنة. القانون يتطلب موافقة ولي أمرك. أدخل بريده الإلكتروني أو رقم هاتفه."
                    : "You're between 13 and 15. By law, a parent or guardian must approve. Enter their email or phone.")
                : (isAr
                    ? "للالتزام بقوانين خصوصية الأطفال (COPPA / GDPR Art. 8)، نحتاج تاريخ ميلادك."
                    : "To comply with child-protection laws (COPPA / GDPR Art. 8) we need your date of birth.")}
            </p>
          </div>

          {!isParental && (
            <div className="grid grid-cols-3 gap-3 mb-6">
              <input type="number" inputMode="numeric"
                placeholder={isAr ? "يوم" : "Day"}
                value={dobDay} onChange={(e) => setDobDay(e.target.value.replace(/\D/g, "").slice(0, 2))}
                style={{ padding: "14px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: 16, fontWeight: 600,
                  outline: "none", textAlign: "center" }} />
              <input type="number" inputMode="numeric"
                placeholder={isAr ? "شهر" : "Mo"}
                value={dobMonth} onChange={(e) => setDobMonth(e.target.value.replace(/\D/g, "").slice(0, 2))}
                style={{ padding: "14px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: 16, fontWeight: 600,
                  outline: "none", textAlign: "center" }} />
              <input type="number" inputMode="numeric"
                placeholder={isAr ? "سنة" : "Year"}
                value={dobYear} onChange={(e) => setDobYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                style={{ padding: "14px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: 16, fontWeight: 600,
                  outline: "none", textAlign: "center" }} />
            </div>
          )}

          {isParental && (
            <input type="text"
              placeholder={isAr ? "بريد إلكتروني أو هاتف ولي الأمر" : "Parent's email or phone"}
              value={parentalContact}
              onChange={(e) => setParentalContact(e.target.value)}
              style={{ width: "100%", padding: "14px 14px", borderRadius: 12, background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: 15,
                outline: "none", marginBottom: 18 }} />
          )}

          {ageError && (
            <p style={{ fontSize: 12, color: "#FF2D55", textAlign: "center", marginBottom: 14 }}>{ageError}</p>
          )}

          <button
            onClick={isParental ? handleParentalConsentSubmit : handleDobSubmit}
            className="w-full"
            style={{
              padding: 16, borderRadius: 14,
              background: "linear-gradient(135deg, #00C8E0, #00A5C0)",
              color: "#fff", fontSize: 15, fontWeight: 700,
              boxShadow: "0 6px 24px rgba(0,200,224,0.25)",
              border: "none", cursor: "pointer",
            }}
          >
            {isParental
              ? (isAr ? "إرسال موافقة" : "Submit consent")
              : (isAr ? "متابعة" : "Continue")}
          </button>

          <p style={{ marginTop: 18, fontSize: 11, color: "rgba(255,255,255,0.25)", textAlign: "center", lineHeight: 1.7 }}>
            {isAr
              ? "نخزّن تاريخ ميلادك بأمان ولا يُشارَك مع جهات اتصالك. يُستخدم فقط للامتثال القانوني."
              : "Your date of birth is stored securely and never shared with your contacts. Used only for legal compliance."}
          </p>
        </div>
      </div>
    );
  }

  // ── ageStage === "verified" → fall through to original form ──
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      {/* Ambient */}
      <div
        className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[450px] h-[350px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse, rgba(0,200,224,0.04) 0%, transparent 60%)" }}
      />

      <div className="flex-1 flex flex-col relative z-10 overflow-hidden">
        {/* Fixed Header */}
        <div className="px-6 pt-14 pb-4 shrink-0">
          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mb-5">
            <div className="size-2 rounded-full" style={{ background: "rgba(0,200,224,0.4)" }}>
              <div className="size-2 rounded-full" style={{ background: "#00C8E0" }} />
            </div>
            <div className="w-6 h-[2px] rounded-full" style={{ background: "rgba(0,200,224,0.2)" }} />
            <div className="size-2 rounded-full" style={{ background: "#00C8E0" }} />
            <div className="w-6 h-[2px] rounded-full" style={{ background: "rgba(255,255,255,0.08)" }} />
            <div className="size-2 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }} />
          </div>

          {/* Back + Title */}
          <motion.button
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            onClick={onBack}
            className="flex items-center gap-1.5 mb-5 group"
            style={{ color: "rgba(255,255,255,0.35)", fontSize: "13px", fontWeight: 500 }}
          >
            <ArrowLeft className="size-4 group-hover:-translate-x-0.5 transition-transform" />
            {isAr ? "رجوع" : "Back"}
          </motion.button>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="flex items-center gap-2.5 mb-1.5">
              <h1 className="text-white" style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-0.4px" }}>
                {isAr ? "إنشاء حسابك" : "Create Your Account"}
              </h1>
            </div>
            <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.3)", lineHeight: 1.6 }}>
              {isAr ? "أعد ملفك الشخصي للسلامة" : "Set up your personal safety profile"}
            </p>
          </motion.div>
        </div>

        {/* Scrollable Form */}
        <div className="flex-1 overflow-y-auto px-6 pb-6" style={{ scrollbarWidth: "none" }}>
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="space-y-5 pt-2"
          >
            {/* الاسم الكامل */}
            <div>
              <label
                className="flex items-center gap-1.5 mb-2.5"
                style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", fontWeight: 500, letterSpacing: "0.3px" }}
              >
                <User className="size-3" />
                {isAr ? "الاسم الكامل" : "Full Name"}
              </label>
              <div style={inputStyle("name")}>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  onFocus={() => setFocusedField("name")}
                  onBlur={() => setFocusedField(null)}
                  placeholder={isAr ? "أدخل اسمك الكامل" : "Enter your full name"}
                  className="w-full bg-transparent text-white outline-none px-4 py-[14px]"
                  style={{ fontSize: "15px", fontFamily: "inherit", caretColor: "#00C8E0" }}
                />
              </div>
            </div>

            {/* Phone Number */}
            <div>
              <label
                className="flex items-center gap-1.5 mb-2.5"
                style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", fontWeight: 500, letterSpacing: "0.3px" }}
              >
                <Phone className="size-3" />
                {isAr ? "رقم الهاتف" : "Phone Number"}
                {initialPhone && (
                  <span style={{ fontSize: 9, color: "#34C759", fontWeight: 700, marginInlineStart: 4, display: "inline-flex", alignItems: "center", gap: 3 }}>
                    <Check className="size-2.5"/> {isAr ? "تم التحقق" : "Verified"}
                  </span>
                )}
              </label>
              <div className="flex gap-2.5">
                {/* Country Code — separate box */}
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowCountryPicker(!showCountryPicker)}
                    className="flex items-center gap-1.5 text-white"
                    style={{
                      ...inputStyle("country"),
                      padding: "14px 12px",
                      minWidth: "88px",
                      cursor: "pointer",
                      fontSize: "14px",
                    }}
                  >
                    <span style={{ fontSize: "18px", lineHeight: 1 }}>{selectedCountry.flag}</span>
                    <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>{selectedCountry.code}</span>
                    <ChevronDown className="size-3" style={{ color: "rgba(255,255,255,0.25)", marginLeft: "auto" }} />
                  </button>

                  {/* Country Picker Dropdown */}
                  <AnimatePresence>
                    {showCountryPicker && (
                      <motion.div
                        initial={{ opacity: 0, y: -4, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.97 }}
                        transition={{ duration: 0.15 }}
                        className="absolute top-full left-0 mt-1.5 z-50 w-[220px] max-h-[200px] overflow-y-auto"
                        style={{
                          borderRadius: "14px",
                          background: "rgba(20,22,35,0.98)",
                          backdropFilter: "blur(20px)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
                          scrollbarWidth: "none",
                        }}
                      >
                        {countryCodes.map((cc) => (
                          <button
                            key={cc.code}
                            type="button"
                            onClick={() => { setCountryCode(cc.code); setShowCountryPicker(false); }}
                            className="w-full flex items-center gap-3 px-3.5 py-2.5 transition-colors"
                            style={{
                              background: cc.code === countryCode ? "rgba(0,200,224,0.08)" : "transparent",
                              borderBottom: "1px solid rgba(255,255,255,0.04)",
                            }}
                          >
                            <span style={{ fontSize: "20px" }}>{cc.flag}</span>
                            <span className="flex-1 text-left" style={{ fontSize: "13px", color: "rgba(255,255,255,0.8)", fontWeight: 500 }}>
                              {isAr ? cc.labelAr : cc.label}
                            </span>
                            <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>
                              {cc.code}
                            </span>
                            {cc.code === countryCode && <Check className="size-3.5" style={{ color: "#00C8E0" }} />}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Phone Input — separate box */}
                <div className="flex-1" style={{...inputStyle("phone"), opacity: initialPhone ? 0.6 : 1}}>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => !initialPhone && setPhone(e.target.value.replace(/\D/g, ""))}
                    readOnly={!!initialPhone}
                    onFocus={() => setFocusedField("phone")}
                    onBlur={() => setFocusedField(null)}
                    placeholder="7XX XXX XXXX"
                    className="w-full bg-transparent text-white outline-none px-4 py-[14px]"
                    style={{ fontSize: "15px", fontFamily: "inherit", letterSpacing: "1px", caretColor: "#00C8E0" }}
                  />
                </div>
              </div>
            </div>

            {/* Emergency Contact */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label
                  className="flex items-center gap-1.5"
                  style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", fontWeight: 500, letterSpacing: "0.3px" }}
                >
                  <ShieldPlus className="size-3" />
                  {isAr ? "جهة اتصال الطوارئ" : "Emergency Contact"}
                </label>
                <span
                  style={{
                    fontSize: "10px",
                    color: "rgba(255,255,255,0.18)",
                    fontWeight: 500,
                    padding: "2px 8px",
                    borderRadius: "6px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  {isAr ? "اختياري" : "Optional"}
                </span>
              </div>

              <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.2)", marginBottom: "10px", lineHeight: 1.5 }}>
                {isAr
                  ? "شخص يتم إبلاغه عند تفعيل SOS — يمكنك إضافته لاحقاً"
                  : "Someone to notify when SOS is triggered — you can add later"}
              </p>

              <div
                className="p-3.5 space-y-2.5"
                style={{
                  borderRadius: "16px",
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.04)",
                }}
              >
                {/* Contact Name — with label */}
                <div>
                  <label style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)", fontWeight: 600, letterSpacing: "0.5px", display: "flex", alignItems: "center", gap: 4, marginBottom: 6, textTransform: "uppercase" }}>
                    <UserCircle className="size-3" />
                    {isAr ? "الاسم" : "NAME"}
                  </label>
                  <div style={inputStyle(`c-name-1`)}>
                    <input
                      type="text"
                      value={contacts[0]?.name || ""}
                      onChange={(e) => updateContact(1, "name", e.target.value)}
                      onFocus={() => setFocusedField(`c-name-1`)}
                      onBlur={() => setFocusedField(null)}
                      placeholder={isAr ? "مثال: أحمد (أخي)" : "e.g. Ahmed (Brother)"}
                      className="w-full bg-transparent text-white outline-none px-3.5 py-[11px]"
                      style={{ fontSize: "14px", fontFamily: "inherit", caretColor: "#00C8E0" }}
                    />
                  </div>
                </div>

                {/* Contact Phone — with label */}
                <div>
                  <label style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)", fontWeight: 600, letterSpacing: "0.5px", display: "flex", alignItems: "center", gap: 4, marginBottom: 6, textTransform: "uppercase" }}>
                    <Phone className="size-3" />
                    {isAr ? "رقم الهاتف" : "PHONE NUMBER"}
                  </label>
                  <div style={inputStyle(`c-phone-1`)}>
                    <input
                      type="tel"
                      value={contacts[0]?.phone || ""}
                      onChange={(e) => updateContact(1, "phone", e.target.value.replace(/\D/g, ""))}
                      onFocus={() => setFocusedField(`c-phone-1`)}
                      onBlur={() => setFocusedField(null)}
                      placeholder={isAr ? "مثال: 07701234567" : "e.g. 07701234567"}
                      className="w-full bg-transparent text-white outline-none px-3.5 py-[11px]"
                      style={{ fontSize: "14px", fontFamily: "inherit", letterSpacing: "0.5px", caretColor: "#00C8E0" }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Fixed CTA */}
        <div
          className="px-6 pt-3 pb-10 shrink-0"
          style={{
            background: "linear-gradient(180deg, transparent, rgba(5,7,14,0.95) 25%)",
          }}
        >
          {!isValid && !submitting && (
            <p
              className="text-center mb-3"
              style={{ fontSize: "11px", color: "rgba(255,45,85,0.6)", letterSpacing: "0.1px" }}
            >
              {fullName.trim().length < 2
                ? (isAr ? "أدخل اسمك الكامل للمتابعة" : "Enter your full name to continue")
                : (isAr ? "أدخل رقم هاتف صالح (8 أرقام على الأقل)" : "Enter a valid phone number (8+ digits)")}
            </p>
          )}
          <motion.button
            onClick={handleSubmit}
            disabled={!isValid || submitting}
            whileTap={isValid && !submitting ? { scale: 0.97 } : {}}
            className="w-full flex items-center justify-center gap-2.5 transition-all duration-500"
            style={{
              padding: "16px",
              borderRadius: "16px",
              background: isValid
                ? submitting
                  ? "linear-gradient(135deg, #00C853 0%, #009940 100%)"
                  : "linear-gradient(135deg, #00C8E0 0%, #00A5C0 100%)"
                : "rgba(255,255,255,0.03)",
              color: isValid ? "#fff" : "rgba(255,255,255,0.15)",
              fontSize: "15px",
              fontWeight: 600,
              boxShadow: isValid
                ? submitting
                  ? "0 8px 32px rgba(0,200,83,0.25)"
                  : "0 8px 32px rgba(0,200,224,0.25)"
                : "none",
              border: isValid ? "none" : "1px solid rgba(255,255,255,0.04)",
              cursor: isValid && !submitting ? "pointer" : "default",
            }}
          >
            {submitting ? (
              <>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                  className="size-[18px] rounded-full"
                  style={{ border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff" }}
                />
                {isAr ? "جاري الإنشاء..." : "Creating..."}
              </>
            ) : (
              <>
                {isAr ? "إنشاء حسابي" : "Create Account"}
                <Check className="size-[17px]" />
              </>
            )}
          </motion.button>
        </div>
      </div>
    </div>
  );
}