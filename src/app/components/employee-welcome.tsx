// ═══════════════════════════════════════════════════════════════
// SOSphere — Employee Welcome Screen (Post-Approval)
// Shows: Your company, zone, evacuation point, manager, quick guide
// ═══════════════════════════════════════════════════════════════
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Shield, MapPin, Navigation, User, Phone,
  CheckCircle2, ArrowRight, Sparkles, AlertTriangle,
  Radio, Clock, Bell, Heart, Zap, Building2,
} from "lucide-react";

interface EmployeeWelcomeProps {
  employeeName: string;
  companyName: string;
  zoneName?: string;
  evacuationPoint?: string;
  managerName?: string;
  managerPhone?: string;
  role?: string;
  department?: string;
  hasZones: boolean;
  onComplete: () => void;
}

export function EmployeeWelcome({
  employeeName,
  companyName,
  zoneName = "Zone A",
  evacuationPoint = "Assembly Point A",
  managerName = "Company Manager",
  managerPhone = "",
  role = "Field Engineer",
  department = "Operations",
  hasZones,
  onComplete,
}: EmployeeWelcomeProps) {
  const [step, setStep] = useState(0);
  const [lang] = useState<"ar"|"en">(() => {
    try { return (localStorage.getItem("sosphere_lang") as "ar"|"en") || "ar"; } catch { return "ar"; }
  });
  const isAr = lang === "ar";
  const firstName = employeeName.split(" ")[0];

  return (
    <div className="relative flex flex-col h-full" style={{ background: "#05070E" }}>
      {/* Ambient */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-50px] left-1/2 -translate-x-1/2 w-[500px] h-[400px]"
          style={{ background: "radial-gradient(circle, rgba(0,200,224,0.06) 0%, transparent 55%)" }} />
        <div className="absolute bottom-[-50px] right-[-50px] w-[300px] h-[300px]"
          style={{ background: "radial-gradient(circle, rgba(0,200,83,0.04) 0%, transparent 60%)" }} />
      </div>

      <div className="flex-1 flex flex-col relative z-10 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        <AnimatePresence mode="wait">
          {/* ═══════════ STEP 0: Welcome Splash ═══════════ */}
          {step === 0 && (
            <motion.div key="s0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -30 }}
              className="flex-1 flex flex-col items-center justify-center px-6">

              {/* Animated shield */}
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.8, ease: [0.34, 1.56, 0.64, 1] }}
                className="relative mb-8"
              >
                <motion.div
                  animate={{ scale: [1, 1.15, 1], opacity: [0.2, 0.4, 0.2] }}
                  transition={{ duration: 2.5, repeat: Infinity }}
                  className="absolute inset-0 rounded-[28px]"
                  style={{ background: "rgba(0,200,224,0.12)", filter: "blur(15px)" }}
                />
                <div className="relative size-24 rounded-[28px] flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,200,224,0.05))", border: "1px solid rgba(0,200,224,0.3)" }}>
                  <motion.div
                    initial={{ rotate: -20 }}
                    animate={{ rotate: 0 }}
                    transition={{ duration: 0.8, delay: 0.3 }}
                  >
                    <Shield className="size-12" style={{ color: "#00C8E0" }} />
                  </motion.div>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-center"
              >
                <h1 className="text-white mb-2" style={{ fontSize: 28, fontWeight: 900, letterSpacing: "-0.5px" }}>
                  {isAr ? `أهلاً، ${firstName}! 👋` : `Welcome, ${firstName}! 👋`}
                </h1>
                <p style={{ fontSize: 15, color: "rgba(255,255,255,0.4)", lineHeight: 1.7 }}>
                  {isAr ? "انضممت بنجاح إلى" : "You've successfully joined"}
                </p>
                <p style={{ fontSize: 18, color: "#00C8E0", fontWeight: 700, marginTop: 4 }}>
                  {companyName}
                </p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="mt-6 flex items-center gap-2 px-4 py-2 rounded-full"
                style={{ background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.15)" }}
              >
                <CheckCircle2 className="size-4" style={{ color: "#00C853" }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "#00C853" }}>
                  {isAr ? "تم التحقق والموافقة" : "Account Verified & Approved"}
                </span>
              </motion.div>

              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setStep(1)}
                className="mt-10 w-64 flex items-center justify-center gap-2 py-4 rounded-2xl"
                style={{
                  background: "linear-gradient(135deg, #00C8E0, #00A5C0)",
                  color: "#fff", fontSize: 16, fontWeight: 700,
                  boxShadow: "0 8px 30px rgba(0,200,224,0.3)",
                }}>
                {isAr ? "هيا نبدأ" : "Let's Get Started"}
                <ArrowRight className="size-5" />
              </motion.button>
            </motion.div>
          )}

          {/* ═══════════ STEP 1: Your Assignment ═══════════ */}
          {step === 1 && (
            <motion.div key="s1" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
              className="flex flex-col px-6 pt-16"
              style={{ paddingBottom: "max(40px, env(safe-area-inset-bottom))" }}>

              <h2 className="text-white mb-1" style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-0.5px" }}>
                {isAr ? <>{" "}<span style={{ color: "#00C8E0" }}>مهمتك</span></> : <>Your <span style={{ color: "#00C8E0" }}>Assignment</span></>}
              </h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", marginBottom: 24, lineHeight: 1.6 }}>
                {isAr ? "هذا موقعك الميداني المُعيَّن" : "Here's where you've been placed"}
              </p>

              {/* Profile Card */}
              <div className="p-4 rounded-2xl mb-3"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="size-12 rounded-xl flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,200,224,0.05))", border: "1px solid rgba(0,200,224,0.2)" }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: "#00C8E0" }}>{firstName.charAt(0)}</span>
                  </div>
                  <div>
                    <p className="text-white" style={{ fontSize: 16, fontWeight: 700 }}>{employeeName}</p>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{role} · {department}</p>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <InfoRow icon={Building2} label={isAr ? "الشركة" : "Company"} value={companyName} color="#00C8E0" />
                  {hasZones && (
                    <>
                      <InfoRow icon={MapPin} label={isAr ? "المنطقة المُعيَّنة" : "Assigned Zone"} value={zoneName} color="#FF9500" />
                      <InfoRow icon={Navigation} label={isAr ? "نقطة الإخلاء" : "Evacuation Point"} value={evacuationPoint} color="#FF2D55" />
                    </>
                  )}
                  {managerName && <InfoRow icon={User} label={isAr ? "مدير المنطقة" : "Zone Manager"} value={managerName} color="#7B5EFF" />}
                  {managerPhone && <InfoRow icon={Phone} label={isAr ? "رقم المدير" : "Manager Contact"} value={managerPhone} color="#00C853" />}
                </div>
              </div>

              {/* Important Notice */}
              {hasZones && (
                <div className="p-3 rounded-xl mb-3"
                  style={{ background: "rgba(255,45,85,0.04)", border: "1px solid rgba(255,45,85,0.12)" }}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="size-4 shrink-0 mt-0.5" style={{ color: "#FF2D55" }} />
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
                      {isAr
                        ? <><span style={{ color: "#FF2D55", fontWeight: 700 }}>طوارئ:</span> في حالة الإخلاء، توجّه فوراً إلى <span style={{ color: "#FF9500", fontWeight: 600 }}>{evacuationPoint}</span>. مدير منطقتك سيرشدك.</>
                        : <><span style={{ color: "#FF2D55", fontWeight: 700 }}>Emergency:</span> In case of evacuation, proceed immediately to <span style={{ color: "#FF9500", fontWeight: 600 }}>{evacuationPoint}</span>. Your zone admin will guide you.</>}
                    </p>
                  </div>
                </div>
              )}

              <motion.button whileTap={{ scale: 0.97 }} onClick={() => setStep(2)}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl mt-4"
                style={{ background: "linear-gradient(135deg, #00C8E0, #00A5C0)", color: "#fff", fontSize: 15, fontWeight: 700, boxShadow: "0 6px 24px rgba(0,200,224,0.25)" }}>
                {isAr ? "متابعة" : "Continue"} <ArrowRight className="size-5" />
              </motion.button>
            </motion.div>
          )}

          {/* ═══════════ STEP 2: Quick Safety Guide ═══════════ */}
          {step === 2 && (
            <motion.div key="s2" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
              className="flex flex-col px-6 pt-16"
              style={{ paddingBottom: "max(40px, env(safe-area-inset-bottom))" }}>

              <h2 className="text-white mb-1" style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-0.5px" }}>
                {isAr ? <>دليل <span style={{ color: "#FF2D55" }}>السلامة السريع</span></> : <>Safety <span style={{ color: "#FF2D55" }}>Quick Guide</span></>}
              </h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", marginBottom: 20, lineHeight: 1.6 }}>
                {isAr ? "٣ أشياء يجب أن يعرفها كل عضو في الفريق" : "3 things every team member must know"}
              </p>

              <div className="space-y-3 mb-4">
                <SafetyCard
                  number="1"
                  title={isAr ? "زر SOS للطوارئ" : "SOS Emergency Button"}
                  description={isAr ? "اضغط زر SOS الأحمر ٣ ثوانٍ لتفعيل تنبيه الطوارئ. سيُبلَّغ مسؤولك فوراً مع موقعك." : "Long-press the red SOS button for 3 seconds to trigger an emergency alert. Your admin will be notified instantly with your GPS location."}
                  icon={Radio} color="#FF2D55" delay={0.1}
                />
                <SafetyCard
                  number="2"
                  title={isAr ? "مؤقت تسجيل الحضور" : "Check-in Timer"}
                  description={isAr ? "ضع مؤقتاً قبل دخول المناطق الخطرة. إذا لم تسجّل في الوقت المحدد، يصل تنبيه تلقائي للمسؤول." : "Set a timer before entering hazardous areas. If you don't check in on time, your admin gets an automatic alert."}
                  icon={Clock} color="#FF9500" delay={0.2}
                />
                <SafetyCard
                  number="3"
                  title={isAr ? "ابقَ متنبهاً" : "Stay Alert"}
                  description={isAr ? "أبقِ الإشعارات مفعّلة. ستصلك أوامر الإخلاء والبث الأمني وتحديثات المنطقة فوراً." : "Keep notifications ON. You'll receive evacuation orders, safety broadcasts, and zone updates in real-time."}
                  icon={Bell} color="#00C8E0" delay={0.3}
                />
              </div>

              <motion.button whileTap={{ scale: 0.97 }} onClick={() => setStep(3)}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl mt-2"
                style={{ background: "linear-gradient(135deg, #00C8E0, #00A5C0)", color: "#fff", fontSize: 15, fontWeight: 700, boxShadow: "0 6px 24px rgba(0,200,224,0.25)" }}>
                {isAr ? "فهمت" : "I Understand"} <CheckCircle2 className="size-5" />
              </motion.button>
            </motion.div>
          )}

          {/* ═══════════ STEP 3: Ready ═══════════ */}
          {step === 3 && (
            <motion.div key="s3" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="flex-1 flex flex-col items-center justify-center px-6">

              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ duration: 0.8, ease: [0.34, 1.56, 0.64, 1] }}
                className="relative mb-8"
              >
                <motion.div
                  animate={{ scale: [1, 1.3, 1], opacity: [0.15, 0.3, 0.15] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute inset-0 rounded-full"
                  style={{ background: "rgba(0,200,83,0.2)", filter: "blur(20px)" }}
                />
                <div className="relative size-24 rounded-full flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, rgba(0,200,83,0.2), rgba(0,200,83,0.08))", border: "2px solid rgba(0,200,83,0.4)" }}>
                  <Zap className="size-12" style={{ color: "#00C853" }} />
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-center"
              >
                <h2 className="text-white mb-2" style={{ fontSize: 26, fontWeight: 900 }}>
                  {isAr ? "أنت جاهز تماماً!" : "You're All Set!"}
                </h2>
                <p style={{ fontSize: 14, color: "rgba(255,255,255,0.35)", lineHeight: 1.7, maxWidth: 280, margin: "0 auto" }}>
                  {isAr ? "لوحة السلامة جاهزة. ابقَ بأمان وسجّل حضورك بانتظام." : "Your safety dashboard is ready. Stay safe and check in regularly with your team."}
                </p>
              </motion.div>

              {/* Quick stats */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="grid grid-cols-3 gap-3 mt-8 w-full max-w-xs"
              >
                {[
                  { label: "SOS", icon: Radio, color: "#FF2D55", text: "Ready" },
                  { label: "Timer", icon: Clock, color: "#FF9500", text: "Ready" },
                  { label: "GPS", icon: MapPin, color: "#00C8E0", text: "Active" },
                ].map((item, i) => (
                  <div key={i} className="flex flex-col items-center gap-1.5 p-3 rounded-xl"
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <item.icon className="size-5" style={{ color: item.color }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: item.color }}>{item.text}</span>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{item.label}</span>
                  </div>
                ))}
              </motion.div>

              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7 }}
                whileTap={{ scale: 0.97 }}
                onClick={onComplete}
                className="mt-10 w-72 flex items-center justify-center gap-2.5 py-4 rounded-2xl"
                style={{
                  background: "linear-gradient(135deg, #00C8E0, #00A5C0)",
                  color: "#fff", fontSize: 16, fontWeight: 700,
                  boxShadow: "0 8px 30px rgba(0,200,224,0.3)",
                }}>
                <Sparkles className="size-5" />
                {isAr ? "ادخل لوحة التحكم" : "Open Dashboard"}
                <ArrowRight className="size-5" />
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Helper Components ────────────────────────────────────────
function InfoRow({ icon: Icon, label, value, color }: { icon: typeof Shield; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg"
      style={{ background: "rgba(255,255,255,0.02)" }}>
      <div className="size-7 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: `${color}10`, border: `1px solid ${color}20` }}>
        <Icon className="size-3.5" style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontWeight: 600 }}>{label}</p>
        <p className="text-white truncate" style={{ fontSize: 13, fontWeight: 600 }}>{value}</p>
      </div>
    </div>
  );
}

function SafetyCard({ number, title, description, icon: Icon, color, delay }: {
  number: string; title: string; description: string; icon: typeof Shield; color: string; delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="flex items-start gap-3 p-4 rounded-xl"
      style={{ background: `${color}06`, border: `1px solid ${color}15` }}
    >
      <div className="size-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: `${color}12`, border: `1px solid ${color}25` }}>
        <Icon className="size-5" style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="size-5 rounded-md flex items-center justify-center"
            style={{ background: `${color}15`, fontSize: 10, fontWeight: 800, color }}>
            {number}
          </span>
          <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>{title}</p>
        </div>
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>{description}</p>
      </div>
    </motion.div>
  );
}
