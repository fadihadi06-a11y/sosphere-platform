// ═══════════════════════════════════════════════════════════════
// SOSphere — Employee Quick Setup (Hybrid Onboarding)
// Pre-populated from CSV data. Employee only adds personal info.
// Flow: Verify Identity → Safety Profile → Emergency Contact → Done
// ═══════════════════════════════════════════════════════════════
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Shield, User, Phone, Camera, Heart, AlertTriangle,
  ArrowRight, ArrowLeft, CheckCircle2, Lock, Droplets,
  Fingerprint, MapPin, Building2, Briefcase, UserCheck,
  Eye, EyeOff, ChevronDown, Sparkles, Bell,
} from "lucide-react";

interface EmployeeQuickSetupProps {
  // Pre-populated from CSV (admin already entered this)
  prefilledData: {
    name: string;
    phone: string;
    email: string;
    role: string;
    department: string;
    zone?: string;
    companyName: string;
    managerName?: string;
    adminPhone?: string;
  };
  onComplete: () => void;
  onBack?: () => void;
}

const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

// FIX: Compress image to max 200x200 before saving to localStorage
// Prevents localStorage quota exceeded error (photos can be 2-5MB uncompressed)
function compressImage(file: File, maxSize = 200, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject("no context"); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function EmployeeQuickSetup({ prefilledData, onComplete, onBack }: EmployeeQuickSetupProps) {
  const [step, setStep] = useState(1); // 1=verify, 2=safety profile, 3=emergency contact, 4=done
  const [pin, setPin] = useState(["", "", "", ""]);
  const [pinConfirm, setPinConfirm] = useState(["", "", "", ""]);
  const [pinStage, setPinStage] = useState<"create" | "confirm">("create");
  const [showPin, setShowPin] = useState(false);
  const [pinError, setPinError] = useState(false);

  // Safety profile
  const [bloodType, setBloodType] = useState("");
  const [allergies, setAllergies] = useState("");
  const [conditions, setConditions] = useState("");
  const [showBloodDropdown, setShowBloodDropdown] = useState(false);
  const [photoSet, setPhotoSet] = useState(false);

  // Emergency contact
  const [emergName, setEmergName] = useState("");
  const [emergPhone, setEmergPhone] = useState("");
  const [emergRelation, setEmergRelation] = useState("");

  // Notifications
  const [notifEnabled, setNotifEnabled] = useState(true);

  const firstName = prefilledData.name.split(" ")[0];

  // Read language from localStorage — set by welcome screen
  const [lang] = useState<"ar"|"en">(() => {
    try { return (localStorage.getItem("sosphere_lang") as "ar"|"en") || "ar"; } catch { return "ar"; }
  });
  const isAr = lang === "ar";

  // FIX: Use refs instead of getElementById — works reliably in Android WebView
  const pinRefs = useRef<(HTMLInputElement | null)[]>([]);
  const confirmRefs = useRef<(HTMLInputElement | null)[]>([]);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  // FIX: Auto-focus first field when pinStage changes to confirm
  useEffect(() => {
    if (pinStage === "confirm") {
      setTimeout(() => confirmRefs.current[0]?.focus(), 350);
    }
  }, [pinStage]);

  const handlePinInput = (index: number, value: string, isConfirm = false) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const setter = isConfirm ? setPinConfirm : setPin;
    const current = isConfirm ? pinConfirm : pin;
    const refs = isConfirm ? confirmRefs : pinRefs;
    const newPin = [...current];
    newPin[index] = digit;
    setter(newPin);
    setPinError(false);

    // FIX: use refs — document.getElementById fails in Android WebView
    if (digit && index < 3) {
      refs.current[index + 1]?.focus();
    }

    if (index === 3 && digit) {
      if (!isConfirm && pinStage === "create") {
        setTimeout(() => setPinStage("confirm"), 300);
      } else if (isConfirm) {
        const pinStr = [...pin.slice(0, 3), pin[3] || digit].join("");
        const confirmStr = [...newPin].join("");
        if (pinStr === confirmStr) {
          setTimeout(() => setStep(2), 400);
        } else {
          setPinError(true);
          setPinConfirm(["", "", "", ""]);
          setTimeout(() => confirmRefs.current[0]?.focus(), 150);
        }
      }
    }
  };

  const canFinish = emergName.length >= 2 && emergPhone.length >= 8;

  /*
    SUPABASE_MIGRATION_POINT: employee_onboarding
    On step 4 completion, persist to Supabase:
    await supabase
      .from('employee_profiles')
      .upsert({
        employee_id: prefilledData.employeeId,
        blood_type: bloodType,
        allergies, conditions,
        emergency_contact_name: emergName,
        emergency_contact_phone: emergPhone,
        emergency_contact_relation: emergRelation,
        pin_hash: hashPin(pin),
        onboarded_at: new Date().toISOString(),
      })
  */

  // FIX 2: Safety profile validation — blood type + zone REQUIRED
  const safetyProfileComplete = bloodType !== "" && (prefilledData.zone !== undefined && prefilledData.zone !== "");
  const canProceedFromSafety = safetyProfileComplete;

  return (
    <div className="relative flex flex-col h-full" style={{ background: "#05070E" }}>
      {/* Ambient */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-60px] left-1/2 -translate-x-1/2 w-[450px] h-[350px]"
          style={{ background: "radial-gradient(circle, rgba(0,200,224,0.05) 0%, transparent 55%)" }} />
      </div>

      <div className="flex-1 flex flex-col relative z-10 overflow-hidden">
        {/* Progress Header */}
        <div className="px-5 pt-14 pb-4 shrink-0">
          <div className="flex items-center justify-between mb-4">
            {step > 1 && step < 4 ? (
              <button onClick={() => setStep(step - 1)} className="flex items-center gap-1"
                style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>
                <ArrowLeft className="size-4" /> Back
              </button>
            ) : onBack && step === 1 ? (
              <button onClick={onBack} className="flex items-center gap-1"
                style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>
                <ArrowLeft className="size-4" /> Back
              </button>
            ) : <div />}
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full"
              style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>
              <UserCheck className="size-3" style={{ color: "#00C8E0" }} />
              <span style={{ fontSize: 10, color: "#00C8E0", fontWeight: 600 }}>Quick Setup</span>
            </div>
          </div>

          {/* Progress dots */}
          {step < 4 && (
            <div className="flex gap-1.5">
              {[1, 2, 3].map(s => (
                <div key={s} className="flex-1 h-1 rounded-full transition-all"
                  style={{ background: s <= step ? "#00C8E0" : "rgba(255,255,255,0.06)" }} />
              ))}
            </div>
          )}
        </div>

        {/* Prefilled identity badge - always visible */}
        {step < 4 && (
          <div className="px-5 mb-4 shrink-0">
            <div className="flex items-center gap-3 p-3 rounded-xl"
              style={{ background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.1)" }}>
              <div className="size-10 rounded-xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,200,224,0.05))" }}>
                <span style={{ fontSize: 16, fontWeight: 800, color: "#00C8E0" }}>{firstName.charAt(0)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white truncate" style={{ fontSize: 14, fontWeight: 700 }}>{prefilledData.name}</p>
                <p className="truncate" style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                  {prefilledData.role} · {prefilledData.department}
                  {prefilledData.zone ? ` · ${prefilledData.zone}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1 px-2 py-1 rounded-md"
                style={{ background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.15)" }}>
                <CheckCircle2 className="size-3" style={{ color: "#00C853" }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: "#00C853" }}>Matched</span>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5" style={{ scrollbarWidth: "none", paddingBottom: "max(100px, env(safe-area-inset-bottom, 24px))" }}>
          <AnimatePresence mode="wait">
            {/* ═══ STEP 1: Security PIN ═══ */}
            {step === 1 && (
              <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h2 className="text-white mb-1" style={{ fontSize: 22, fontWeight: 900 }}>
                  {isAr ? <>ضبط <span style={{ color: "#00C8E0" }}>رمز الأمان</span></> : <>Set Security <span style={{ color: "#00C8E0" }}>PIN</span></>}
                </h2>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", lineHeight: 1.6, marginBottom: 24 }}>
                  {pinStage === "create"
                    ? (isAr ? "أنشئ رمزاً من 4 أرقام لتأمين SOS وتسجيل الحضور" : "Create a 4-digit PIN to secure your SOS and check-in features")
                    : (isAr ? "أكّد رمزك مجدداً" : "Confirm your PIN")}
                </p>

                <div className="flex flex-col items-center">
                  <div className="size-16 rounded-2xl flex items-center justify-center mb-6"
                    style={{
                      background: pinError ? "rgba(255,45,85,0.1)" : `rgba(0,200,224,0.08)`,
                      border: `1px solid ${pinError ? "rgba(255,45,85,0.2)" : "rgba(0,200,224,0.2)"}`,
                    }}>
                    {pinError ? (
                      <motion.div animate={{ x: [-5, 5, -5, 5, 0] }} transition={{ duration: 0.4 }}>
                        <Lock className="size-8" style={{ color: "#FF2D55" }} />
                      </motion.div>
                    ) : (
                      <Fingerprint className="size-8" style={{ color: "#00C8E0" }} />
                    )}
                  </div>

                  {pinError && (
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      style={{ fontSize: 12, color: "#FF2D55", fontWeight: 600, marginBottom: 12 }}>
                      {isAr ? "الرمزان لا يتطابقان. حاول مجدداً." : "PINs don't match. Try again."}
                    </motion.p>
                  )}

                  <p style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.4)", marginBottom: 16 }}>
                    {pinStage === "create"
                      ? (isAr ? "أدخل الرمز" : "CREATE PIN")
                      : (isAr ? "أكّد الرمز" : "CONFIRM PIN")}
                  </p>

                  {/* FIX: direction ltr — prevents RTL from reversing fields visually */}
                  <div className="flex gap-3 mb-6" style={{ direction: "ltr" }}>
                    {(pinStage === "create" ? pin : pinConfirm).map((digit, i) => (
                      <input
                        key={`${pinStage}-${i}`}
                        ref={el => {
                          if (pinStage === "create") pinRefs.current[i] = el;
                          else confirmRefs.current[i] = el;
                        }}
                        // FIX: type="text" — type="password" breaks numeric input on Android WebView
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={1}
                        // FIX: show bullet instead of digit when PIN hidden
                        value={showPin ? digit : (digit ? "•" : "")}
                        autoFocus={i === 0 && pinStage === "create"}
                        onChange={e => {
                          // Strip bullets and non-digits
                          const raw = e.target.value.replace(/[•\D]/g, "").slice(-1);
                          handlePinInput(i, raw, pinStage === "confirm");
                        }}
                        onKeyDown={e => {
                          if (e.key === "Backspace") {
                            const refs = pinStage === "create" ? pinRefs : confirmRefs;
                            const setter = pinStage === "create" ? setPin : setPinConfirm;
                            const current = pinStage === "create" ? pin : pinConfirm;
                            if (current[i]) {
                              // Clear current field
                              const newPin = [...current];
                              newPin[i] = "";
                              setter(newPin);
                            } else if (i > 0) {
                              refs.current[i - 1]?.focus();
                            }
                          }
                        }}
                        onFocus={e => e.target.select()}
                        className="size-14 rounded-xl text-center outline-none transition-all"
                        style={{
                          background: digit ? "rgba(0,200,224,0.06)" : "rgba(255,255,255,0.025)",
                          border: `1.5px solid ${digit ? "rgba(0,200,224,0.25)" : "rgba(255,255,255,0.06)"}`,
                          color: "#fff", fontSize: digit && !showPin ? 28 : 24, fontWeight: 700,
                          fontFamily: "inherit", caretColor: "#00C8E0",
                        }}
                      />
                    ))}
                  </div>

                  <button onClick={() => setShowPin(!showPin)}
                    className="flex items-center gap-1.5"
                    style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", fontWeight: 500 }}>
                    {showPin ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    {isAr ? (showPin ? "إخفاء الرمز" : "إظهار الرمز") : (showPin ? "Hide PIN" : "Show PIN")}
                  </button>
                </div>

                <div className="mt-8 p-3 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)" }}>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", lineHeight: 1.6 }}>
                    🔐 {isAr
                      ? "الرمز مطلوب لتفعيل SOS وإلغاء التنبيهات والوصول لمزايا الأمان الحساسة. احتفظ به سراً."
                      : "Your PIN is required to trigger SOS, cancel alerts, and access sensitive safety features. Keep it private."}
                  </p>
                </div>
              </motion.div>
            )}

            {/* ═══ STEP 2: Safety Profile ═══ */}
            {step === 2 && (
              <motion.div key="s2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h2 className="text-white mb-1" style={{ fontSize: 22, fontWeight: 900 }}>
                  {isAr ? <>الملف <span style={{ color: "#FF2D55" }}>الطبي</span></> : <>Safety <span style={{ color: "#FF2D55" }}>Profile</span></>}
                </h2>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", lineHeight: 1.6, marginBottom: 20 }}>
                  {isAr ? "هذه المعلومات تساعد المسعفين في حالات الطوارئ" : "This info helps first responders in emergencies"}
                </p>

                {/* FIX 2: Red banner if profile incomplete */}
                {!safetyProfileComplete && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 rounded-xl mb-5"
                    style={{
                      background: "rgba(255,45,85,0.08)",
                      border: "1px solid rgba(255,45,85,0.25)",
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="size-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: "rgba(255,45,85,0.15)", border: "1px solid rgba(255,45,85,0.3)" }}>
                        <AlertTriangle className="size-4" style={{ color: "#FF2D55" }} />
                      </div>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 700, color: "#FF2D55", marginBottom: 4 }}>
                          ⚠️ Your safety profile is incomplete
                        </p>
                        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
                          Paramedics need this information to save your life. Complete now → takes 60 seconds.
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Profile Photo */}
                <div className="mb-6">
                  <input ref={photoInputRef} type="file" accept="image/*" capture="environment"
                    style={{ display: "none" }}
                    onChange={async e => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try {
                        const compressed = await compressImage(f);
                        setPhotoSet(true);
                        setPhotoUrl(compressed);
                        localStorage.setItem("sosphere_employee_avatar", compressed);
                      } catch { console.warn("Photo compression failed"); }
                    }} />
                  <input ref={galleryInputRef} type="file" accept="image/*"
                    style={{ display: "none" }}
                    onChange={async e => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try {
                        const compressed = await compressImage(f);
                        setPhotoSet(true);
                        setPhotoUrl(compressed);
                        localStorage.setItem("sosphere_employee_avatar", compressed);
                      } catch { console.warn("Photo compression failed"); }
                    }} />

                  <div className="flex items-center gap-4">
                    {/* Preview */}
                    <div className="relative size-20 rounded-2xl flex items-center justify-center shrink-0 overflow-hidden"
                      style={{ background: photoSet ? "transparent" : "rgba(255,255,255,0.025)", border: `1.5px dashed ${photoSet ? "rgba(0,200,224,0.3)" : "rgba(255,255,255,0.08)"}` }}>
                      {photoUrl
                        ? <img src={photoUrl} alt="profile" className="size-full object-cover" />
                        : photoSet
                          ? <div className="size-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #00C8E0, #0090A0)" }}>
                              <span className="text-white" style={{ fontSize: 28, fontWeight: 900 }}>{firstName.charAt(0)}</span>
                            </div>
                          : <Camera className="size-7" style={{ color: "rgba(255,255,255,0.15)" }} />}
                    </div>

                    <div className="flex-1">
                      <p className="text-white mb-2" style={{ fontSize: 14, fontWeight: 700 }}>
                        {isAr ? "صورة الملف الشخصي" : "Profile Photo"}
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginRight: 6, marginLeft: 6 }}>
                          {isAr ? "اختياري" : "Optional"}
                        </span>
                      </p>
                      <div className="flex gap-2">
                        <button onClick={() => photoInputRef.current?.click()}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                          style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.2)", fontSize: 11, fontWeight: 600, color: "#00C8E0" }}>
                          <Camera className="size-3.5" />
                          {isAr ? "كاميرا" : "Camera"}
                        </button>
                        <button onClick={() => galleryInputRef.current?.click()}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)" }}>
                          📁 {isAr ? "المعرض" : "Gallery"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Blood Type */}
                <div className="mb-4">
                  <label className="flex items-center gap-1.5 mb-2"
                    style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", fontWeight: 600 }}>
                    <Droplets className="size-3.5" style={{ color: "#FF2D55" }} />
                    Blood Type
                    <span style={{ fontSize: 9, color: "#FF2D55", marginLeft: 4, fontWeight: 700 }}>REQUIRED</span>
                  </label>
                  <div className="relative">
                    <button onClick={() => setShowBloodDropdown(!showBloodDropdown)}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all"
                      style={{
                        background: "rgba(255,255,255,0.025)",
                        border: `1.5px solid ${showBloodDropdown ? "rgba(0,200,224,0.3)" : "rgba(255,255,255,0.06)"}`,
                        color: bloodType ? "#fff" : "rgba(255,255,255,0.2)",
                        fontSize: 14, fontWeight: bloodType ? 600 : 400,
                      }}>
                      {bloodType || "Select blood type"}
                      <ChevronDown className="size-4" style={{ color: "rgba(255,255,255,0.2)" }} />
                    </button>
                    <AnimatePresence>
                      {showBloodDropdown && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                          className="absolute top-full left-0 right-0 mt-1 p-2 rounded-xl z-20 grid grid-cols-4 gap-1"
                          style={{ background: "#0A1220", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
                          {BLOOD_TYPES.map(bt => (
                            <button key={bt}
                              onClick={() => { setBloodType(bt); setShowBloodDropdown(false); }}
                              className="py-2 rounded-lg text-center transition-all"
                              style={{
                                background: bloodType === bt ? "rgba(255,45,85,0.12)" : "rgba(255,255,255,0.03)",
                                border: `1px solid ${bloodType === bt ? "rgba(255,45,85,0.2)" : "rgba(255,255,255,0.05)"}`,
                                color: bloodType === bt ? "#FF2D55" : "rgba(255,255,255,0.5)",
                                fontSize: 14, fontWeight: 700,
                              }}>
                              {bt}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Allergies */}
                <InputField
                  label={isAr ? "الحساسية" : "Allergies"} icon={AlertTriangle} color="#FF9500"
                  placeholder={isAr ? "مثال: بنسلين، غبار، لسعة نحل" : "e.g., Penicillin, Dust, Bee stings"}
                  value={allergies} onChange={setAllergies}
                  hint={isAr ? "اختياري — مهم للاستجابة الطبية" : "Optional — critical for medical response"}
                />

                <InputField
                  label={isAr ? "الحالات الطبية" : "Medical Conditions"} icon={Heart} color="#FF2D55"
                  placeholder={isAr ? "مثال: ربو، سكري، أمراض قلب" : "e.g., Asthma, Diabetes, Heart condition"}
                  value={conditions} onChange={setConditions}
                  hint={isAr ? "اختياري — يساعد المسعفين في الاستجابة" : "Optional — helps paramedics respond faster"}
                />

                <div className="mt-4" />
                <motion.button whileTap={{ scale: 0.97 }} onClick={() => setStep(3)}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl"
                  style={{ background: "linear-gradient(135deg, #00C8E0, #00A5C0)", color: "#fff", fontSize: 15, fontWeight: 700, boxShadow: "0 6px 24px rgba(0,200,224,0.25)" }}>
                  {isAr ? "متابعة" : "Continue"} <ArrowRight className="size-5" />
                </motion.button>
                <button onClick={() => setStep(3)} className="w-full mt-3 py-3 text-center"
                  style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", fontWeight: 500 }}>
                  {isAr ? "تخطي الآن" : "Skip for now"}
                </button>
              </motion.div>
            )}

            {/* ═══ STEP 3: Emergency Contact ═══ */}
            {step === 3 && (
              <motion.div key="s3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h2 className="text-white mb-1" style={{ fontSize: 22, fontWeight: 900 }}>
                  {isAr ? <>جهة اتصال <span style={{ color: "#FF9500" }}>الطوارئ</span></> : <>Emergency <span style={{ color: "#FF9500" }}>Contact</span></>}
                </h2>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", lineHeight: 1.6, marginBottom: 20 }}>
                  {isAr ? "من نتصل به إذا حدث لك شيء؟" : "Who should we contact if something happens to you?"}
                </p>

                <div className="p-3 rounded-xl mb-5"
                  style={{ background: "rgba(255,45,85,0.04)", border: "1px solid rgba(255,45,85,0.1)" }}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="size-4 shrink-0 mt-0.5" style={{ color: "#FF2D55" }} />
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
                      <span style={{ color: "#FF2D55", fontWeight: 700 }}>{isAr ? "مطلوب" : "Required"}</span> — {isAr ? "سيُبلَّغ هذا الشخص تلقائياً خلال حالات الطوارئ." : "This person will be notified automatically during SOS emergencies."}
                    </p>
                  </div>
                </div>

                {/* Auto-added admin as Tier 1 */}
                <div className="p-3.5 rounded-xl mb-5"
                  style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.12)" }}>
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,200,224,0.05))", border: "1px solid rgba(0,200,224,0.25)" }}>
                      <Shield className="size-5" style={{ color: "#00C8E0" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-white truncate" style={{ fontSize: 14, fontWeight: 700 }}>
                          {prefilledData.managerName || (isAr ? "مسؤول الشركة" : "Company Admin")}
                        </p>
                        <span className="shrink-0 px-1.5 py-0.5 rounded"
                          style={{ fontSize: 8, fontWeight: 800, color: "#00C8E0", background: "rgba(0,200,224,0.12)", border: "1px solid rgba(0,200,224,0.2)" }}>
                          TIER 1
                        </span>
                      </div>
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                        {isAr ? "مسؤول السلامة" : "Company Safety Admin"} · {prefilledData.adminPhone || (isAr ? "مُعيَّن تلقائياً" : "Auto-assigned")}
                      </p>
                      <p style={{ fontSize: 10, color: "rgba(0,200,224,0.5)", marginTop: 3, fontWeight: 600 }}>
                        {isAr ? "مُضاف تلقائياً — مسؤول شركتك" : "Added automatically — your company admin"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 px-2 py-1 rounded-md shrink-0"
                      style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>
                      <Lock className="size-3" style={{ color: "rgba(0,200,224,0.5)" }} />
                      <span style={{ fontSize: 9, color: "rgba(0,200,224,0.5)", fontWeight: 600 }}>{isAr ? "ثابت" : "Fixed"}</span>
                    </div>
                  </div>
                </div>

                {/* Personal emergency contact */}
                <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px", marginBottom: 12 }}>
                  {isAr ? "أضف جهة اتصال شخصية للطوارئ" : "ADD PERSONAL EMERGENCY CONTACT"}
                </p>

                <InputField
                  label={isAr ? "اسم جهة الاتصال" : "Contact Name"} icon={User} color="#00C8E0"
                  placeholder={isAr ? "مثال: محمد أحمد" : "e.g., Sarah Ahmed"}
                  value={emergName} onChange={setEmergName}
                  required
                />

                <InputField
                  label={isAr ? "رقم الهاتف" : "Contact Phone"} icon={Phone} color="#00C853"
                  placeholder="+XXX XXXX XXXX"
                  value={emergPhone} onChange={setEmergPhone}
                  type="tel" required
                />

                <div className="mb-4">
                  <label className="flex items-center gap-1.5 mb-2"
                    style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", fontWeight: 600 }}>
                    <Heart className="size-3.5" style={{ color: "#7B5EFF" }} />
                    {isAr ? "صلة القرابة" : "Relationship"}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {(isAr
                      ? ["زوج/زوجة", "أحد الوالدين", "أخ/أخت", "صديق", "أخرى"]
                      : ["Spouse", "Parent", "Sibling", "Friend", "Other"]
                    ).map((rel, idx) => {
                      const enVal = ["Spouse", "Parent", "Sibling", "Friend", "Other"][idx];
                      return (
                        <button key={enVal} onClick={() => setEmergRelation(enVal)}
                          className="px-4 py-2 rounded-lg transition-all"
                          style={{
                            background: emergRelation === enVal ? "rgba(123,94,255,0.1)" : "rgba(255,255,255,0.025)",
                            border: `1.5px solid ${emergRelation === enVal ? "rgba(123,94,255,0.25)" : "rgba(255,255,255,0.06)"}`,
                            color: emergRelation === enVal ? "#7B5EFF" : "rgba(255,255,255,0.3)",
                            fontSize: 13, fontWeight: 600,
                          }}>
                          {rel}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Notifications toggle */}
                <div className="flex items-center justify-between p-3 rounded-xl mt-5"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="flex items-center gap-2.5">
                    <Bell className="size-4" style={{ color: "#00C8E0" }} />
                    <div>
                      <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>
                        {isAr ? "الإشعارات الفورية" : "Push Notifications"}
                      </p>
                      <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
                        {isAr ? "تنبيهات SOS والإخلاء والمنطقة" : "Receive SOS, evacuation & zone alerts"}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setNotifEnabled(!notifEnabled)}
                    className="w-11 h-6 rounded-full transition-all relative"
                    style={{ background: notifEnabled ? "#00C8E0" : "rgba(255,255,255,0.1)" }}>
                    <div className="absolute top-0.5 size-5 rounded-full bg-white transition-all"
                      style={{ left: notifEnabled ? 22 : 2 }} />
                  </button>
                </div>

                <div className="mt-6" />
                <motion.button
                  whileTap={canFinish ? { scale: 0.97 } : {}}
                  onClick={() => { if (canFinish) setStep(4); }}
                  disabled={!canFinish}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl transition-all"
                  style={{
                    background: canFinish ? "linear-gradient(135deg, #00C8E0, #00A5C0)" : "rgba(255,255,255,0.03)",
                    color: canFinish ? "#fff" : "rgba(255,255,255,0.15)",
                    fontSize: 15, fontWeight: 700,
                    boxShadow: canFinish ? "0 6px 24px rgba(0,200,224,0.25)" : "none",
                    border: canFinish ? "none" : "1px solid rgba(255,255,255,0.04)",
                  }}>
                  {isAr ? "إكمال الإعداد" : "Complete Setup"}
                  <CheckCircle2 className="size-5" />
                </motion.button>
              </motion.div>
            )}

            {/* ═══ STEP 4: Complete ═══ */}
            {step === 4 && (
              <motion.div key="s4" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center py-8">

                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ duration: 0.8, ease: [0.34, 1.56, 0.64, 1] }}
                  className="relative mb-6"
                >
                  <motion.div
                    animate={{ scale: [1, 1.3, 1], opacity: [0.15, 0.3, 0.15] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="absolute inset-0 rounded-full"
                    style={{ background: "rgba(0,200,83,0.2)", filter: "blur(20px)" }}
                  />
                  <div className="relative size-24 rounded-full flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg, rgba(0,200,83,0.2), rgba(0,200,83,0.08))", border: "2px solid rgba(0,200,83,0.4)" }}>
                    <Sparkles className="size-12" style={{ color: "#00C853" }} />
                  </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                  className="text-center mb-8">
                  <h2 className="text-white mb-2" style={{ fontSize: 26, fontWeight: 900 }}>
                    {isAr ? "اكتمل الإعداد!" : "Setup Complete!"}
                  </h2>
                  <p style={{ fontSize: 14, color: "rgba(255,255,255,0.35)", lineHeight: 1.7, maxWidth: 280, margin: "0 auto" }}>
                    {isAr
                      ? `ملفك الآمن جاهز يا ${firstName}. أنت الآن محمي بـ SOSphere.`
                      : `Your safety profile is ready, ${firstName}. You're now protected by SOSphere.`}
                  </p>
                </motion.div>

                {/* Summary */}
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
                  className="w-full p-4 rounded-2xl mb-6"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px", marginBottom: 10 }}>
                    {isAr ? "ملفك الشخصي" : "YOUR PROFILE"}
                  </p>
                  <div className="space-y-2">
                    <SummaryRow icon={Building2} label={prefilledData.companyName} color="#00C8E0" />
                    <SummaryRow icon={Briefcase} label={`${prefilledData.role} · ${prefilledData.department}`} color="#7B5EFF" />
                    {prefilledData.zone && <SummaryRow icon={MapPin} label={prefilledData.zone} color="#FF9500" />}
                    <SummaryRow icon={Lock} label={isAr ? "تم ضبط رمز الأمان" : "Security PIN set"} color="#00C853" />
                    {bloodType && <SummaryRow icon={Droplets} label={`${isAr ? "فصيلة الدم:" : "Blood type:"} ${bloodType}`} color="#FF2D55" />}
                    <SummaryRow icon={Shield} label={`${isAr ? "مسؤول السلامة:" : "Safety Admin:"} ${prefilledData.managerName || (isAr ? "مسؤول الشركة" : "Company Admin")}`} color="#00C8E0" />
                    {emergName && <SummaryRow icon={Phone} label={`${isAr ? "شخصي:" : "Personal:"} ${emergName}`} color="#FF9500" />}
                  </div>
                </motion.div>

                <motion.button
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    // Save employee profile data to localStorage for dashboard
                    try {
                      localStorage.setItem("sosphere_employee_profile", JSON.stringify({
                        role: prefilledData.role,
                        department: prefilledData.department,
                        zone: prefilledData.zone,
                        companyName: prefilledData.companyName,
                        managerName: prefilledData.managerName,
                      }));
                    } catch {}
                    console.log("[SUPABASE_READY] employee_onboarding:", JSON.stringify({
                      name: prefilledData.name, bloodType, allergies, conditions,
                      emergencyContact: { name: emergName, phone: emergPhone, relation: emergRelation }
                    }));
                    onComplete();
                  }}
                  className="w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl"
                  style={{
                    background: "linear-gradient(135deg, #00C8E0, #00A5C0)",
                    color: "#fff", fontSize: 16, fontWeight: 700,
                    boxShadow: "0 8px 30px rgba(0,200,224,0.3)",
                  }}>
                  <Shield className="size-5" />
                  {isAr ? "ادخل SOSphere" : "Enter SOSphere"}
                  <ArrowRight className="size-5" />
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ── Reusable Components ──────────────────────────────────────
function InputField({ label, icon: Icon, color, placeholder, value, onChange, type = "text", required = false, hint, maxLength }: {
  label: string; icon: typeof User; color: string; placeholder: string;
  value: string; onChange: (v: string) => void;
  type?: string; required?: boolean; hint?: string; maxLength?: number;
}) {
  const [focused, setFocused] = useState(false);
  // FIX 5: Default maxLength based on type
  const effectiveMaxLength = maxLength || (type === "tel" ? 16 : 100);
  return (
    <div className="mb-4">
      <label className="flex items-center gap-1.5 mb-2"
        style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", fontWeight: 600 }}>
        <Icon className="size-3.5" style={{ color }} />
        {label}
        {required && <span style={{ color: "#FF2D55", fontSize: 10 }}>*</span>}
      </label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        placeholder={placeholder}
        maxLength={effectiveMaxLength}
        className="w-full bg-transparent text-white outline-none px-4 py-3 rounded-xl transition-all"
        style={{
          background: "rgba(255,255,255,0.025)",
          border: `1.5px solid ${focused ? "rgba(0,200,224,0.3)" : "rgba(255,255,255,0.06)"}`,
          fontSize: 14, fontFamily: "inherit", caretColor: "#00C8E0",
          boxShadow: focused ? "0 0 0 4px rgba(0,200,224,0.04)" : "none",
        }} />
      {hint && <p className="mt-1.5" style={{ fontSize: 10, color: "rgba(255,255,255,0.15)" }}>{hint}</p>}
    </div>
  );
}

function SummaryRow({ icon: Icon, label, color }: { icon: typeof User; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      <div className="size-6 rounded-md flex items-center justify-center"
        style={{ background: `${color}10`, border: `1px solid ${color}20` }}>
        <Icon className="size-3" style={{ color }} />
      </div>
      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{label}</span>
    </div>
  );
}