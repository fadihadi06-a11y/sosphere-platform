import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Mic, Shield, AlertTriangle, CheckCircle,
  X, ChevronRight, Globe, Lock, FileText,
} from "lucide-react";
import { useReducedMotion, springPresets, backdropVariants, slideUpVariants } from "./view-transitions";

interface RecordingConsentModalProps {
  visible: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

const legalPoints = [
  {
    flag: "🇸🇦",
    country: "السعودية / UAE / KSA",
    rule: "يُسمح بالتسجيل لطرف واحد مشارك في المحادثة",
    allowed: true,
  },
  {
    flag: "🇺🇸",
    country: "United States",
    rule: "يختلف حسب الولاية — بعضها يحتاج موافقة الطرفين",
    allowed: null,
  },
  {
    flag: "🇬🇧",
    country: "United Kingdom",
    rule: "يُسمح للمشارك بالتسجيل لأغراض شخصية وأمنية",
    allowed: true,
  },
  {
    flag: "🇩🇪",
    country: "Germany / Europe",
    rule: "يتطلب موافقة صريحة من جميع الأطراف — قانون صارم",
    allowed: false,
  },
  {
    flag: "🇦🇺",
    country: "Australia",
    rule: "يحتاج إذن المشاركين في معظم الولايات",
    allowed: null,
  },
];

export function RecordingConsentModal({
  visible,
  onAccept,
  onDecline,
}: RecordingConsentModalProps) {
  const [scrolled, setScrolled] = useState(false);
  const [checked1, setChecked1] = useState(false);
  const [checked2, setChecked2] = useState(false);
  const [checked3, setChecked3] = useState(false);

  const allChecked = checked1 && checked2 && checked3;
  const prefersReduced = useReducedMotion();

  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Backdrop */}
          <motion.div
            key="rc-bg"
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={prefersReduced ? { duration: 0 } : springPresets.backdrop}
            className="absolute inset-0 z-50"
            style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(12px)" }}
          />

          {/* Sheet */}
          <motion.div
            key="rc-sheet"
            variants={slideUpVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={prefersReduced ? { duration: 0 } : springPresets.sheetSlide}
            className="absolute inset-x-0 bottom-0 z-50 flex flex-col"
            style={{
              maxHeight: "92%",
              borderRadius: "28px 28px 0 0",
              background: "rgba(8,14,26,0.99)",
              backdropFilter: "blur(40px)",
              borderTop: "1px solid rgba(255,150,0,0.25)",
            }}
          >
            {/* Handle */}
            <div className="flex justify-center pt-4 pb-2 shrink-0">
              <div style={{ width: 36, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.1)" }} />
            </div>

            {/* ── Header ── */}
            <div className="shrink-0 px-5 pb-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <div
                      className="size-9 rounded-[11px] flex items-center justify-center"
                      style={{ background: "rgba(255,150,0,0.12)", border: "1.5px solid rgba(255,150,0,0.25)" }}
                    >
                      <Mic style={{ width: 17, height: 17, color: "#FF9500" }} />
                    </div>
                    <div>
                      <p style={{ fontSize: 16, fontWeight: 700, color: "#fff", fontFamily: "inherit", letterSpacing: "-0.2px" }}>
                        تنبيه قانوني — التسجيل الصوتي
                      </p>
                      <p style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,150,0,0.6)", fontFamily: "inherit", letterSpacing: "0.4px" }}>
                        LEGAL NOTICE — AUDIO RECORDING
                      </p>
                    </div>
                  </div>
                </div>
                <button onClick={onDecline} className="p-1 mt-0.5">
                  <X style={{ width: 16, height: 16, color: "rgba(255,255,255,0.25)" }} />
                </button>
              </div>

              {/* Warning banner */}
              <div
                className="flex items-start gap-3 px-3.5 py-3 mt-3"
                style={{
                  borderRadius: 14,
                  background: "rgba(255,150,0,0.07)",
                  border: "1px solid rgba(255,150,0,0.18)",
                }}
              >
                <AlertTriangle style={{ width: 15, height: 15, color: "#FF9500", flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: 12, color: "rgba(255,200,100,0.85)", lineHeight: 1.65, fontFamily: "inherit" }}>
                  تسجيل المحادثات قد يكون{" "}
                  <span style={{ color: "#FF2D55", fontWeight: 700 }}>مخالفاً للقانون</span>
                  {" "}في بعض الدول بدون موافقة جميع الأطراف. أنت وحدك تتحمل المسؤولية القانونية الكاملة عن استخدام هذه الميزة.
                </p>
              </div>
            </div>

            {/* ── Scrollable content ── */}
            <div
              className="flex-1 overflow-y-auto px-5"
              style={{ scrollbarWidth: "none" }}
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop > 60) setScrolled(true);
              }}
            >
              {/* Section: What it does */}
              <div className="mb-5">
                <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px", marginBottom: 10, fontFamily: "inherit" }}>
                  ماذا يفعل التسجيل الصوتي؟
                </p>
                <div className="space-y-2.5">
                  {[
                    { icon: Mic, text: "يبدأ تسجيل صوتي فور إجابة أي جهة طوارئ على المكالمة", color: "#FF2D55" },
                    { icon: Lock, text: "يُرفَع التسجيل مشفراً إلى خادمنا الآمن ويُحفظ في سجل الحادث", color: "#00C8E0" },
                    { icon: FileText, text: "مدة التسجيل: 60 ثانية (مجاني) · 120 ثانية (مدفوع)", color: "#FF9500" },
                    { icon: Shield, text: "لا يُشارَك مع أي طرف ثالث إلا بأمر قضائي رسمي", color: "#00C853" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-3 px-3.5 py-2.5" style={{ borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                      <div className="size-7 rounded-[9px] flex items-center justify-center shrink-0" style={{ background: `${item.color}10` }}>
                        <item.icon style={{ width: 13, height: 13, color: item.color }} />
                      </div>
                      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, fontFamily: "inherit" }}>{item.text}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section: Countries */}
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-3">
                  <Globe style={{ width: 12, height: 12, color: "rgba(255,255,255,0.2)" }} />
                  <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px", fontFamily: "inherit" }}>
                    القوانين حسب الدولة (أمثلة غير حصرية)
                  </p>
                </div>
                <div className="space-y-2">
                  {legalPoints.map((lp, i) => (
                    <div key={i} className="flex items-start gap-3 px-3.5 py-2.5" style={{ borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                      <span style={{ fontSize: 18, lineHeight: 1 }}>{lp.flag}</span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.55)", fontFamily: "inherit" }}>{lp.country}</p>
                          <span
                            style={{
                              fontSize: 9, fontWeight: 700, letterSpacing: "0.4px", fontFamily: "inherit",
                              color: lp.allowed === true ? "#00C853" : lp.allowed === false ? "#FF2D55" : "#FF9500",
                              padding: "2px 7px", borderRadius: 6,
                              background: lp.allowed === true ? "rgba(0,200,83,0.08)" : lp.allowed === false ? "rgba(255,45,85,0.08)" : "rgba(255,150,0,0.08)",
                            }}
                          >
                            {lp.allowed === true ? "مسموح" : lp.allowed === false ? "محظور" : "يتفاوت"}
                          </span>
                        </div>
                        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginTop: 2, lineHeight: 1.5, fontFamily: "inherit" }}>{lp.rule}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.15)", marginTop: 8, textAlign: "center", lineHeight: 1.6, fontFamily: "inherit" }}>
                  هذه المعلومات للتوعية فقط وليست استشارة قانونية.{"\n"}تحقق دائماً من القوانين المحلية في دولتك.
                </p>
              </div>

              {/* Section: Disclaimer */}
              <div
                className="mb-5 px-4 py-4"
                style={{
                  borderRadius: 16,
                  background: "rgba(255,45,85,0.04)",
                  border: "1px solid rgba(255,45,85,0.12)",
                }}
              >
                <p style={{ fontSize: 11, fontWeight: 700, color: "#FF2D55", marginBottom: 8, fontFamily: "inherit", letterSpacing: "0.3px" }}>
                  إخلاء مسؤولية SOSphere
                </p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", lineHeight: 1.75, fontFamily: "inherit" }}>
                  تقدّم SOSphere ميزة التسجيل الصوتي كأداة أمان شخصية اختيارية. الشركة لا تتحمل أي مسؤولية قانونية عن سوء الاستخدام أو الاستخدام المخالف لقوانين الدولة التي تتواجد فيها. بتفعيل هذه الميزة أنت تؤكد أنك على دراية بالقوانين المحلية المعمول بها وتتحمل المسؤولية الكاملة.
                </p>
              </div>

              {/* Spacer for checkboxes */}
              <div style={{ height: 8 }} />
            </div>

            {/* ── Checkboxes + Button (fixed bottom) ── */}
            <div
              className="shrink-0 px-5 pb-8 pt-4"
              style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
            >
              {/* Checkboxes */}
              <div className="space-y-3 mb-5">
                {[
                  {
                    checked: checked1,
                    setter: setChecked1,
                    text: "أؤكد أنني مشارك في المحادثة وأحق قانونياً بتسجيلها في دولتي",
                  },
                  {
                    checked: checked2,
                    setter: setChecked2,
                    text: "أتحمل المسؤولية القانونية الكاملة وأعفي SOSphere من أي تبعات",
                  },
                  {
                    checked: checked3,
                    setter: setChecked3,
                    text: "أوافق على سياسة الخصوصية وشروط الاستخدام المتعلقة بالتسجيل",
                  },
                ].map((item, i) => (
                  <button
                    key={i}
                    onClick={() => item.setter(!item.checked)}
                    className="flex items-start gap-3 w-full text-left"
                  >
                    <div
                      className="size-5 rounded-[6px] flex items-center justify-center shrink-0 mt-0.5 transition-all duration-200"
                      style={{
                        background: item.checked ? "#00C853" : "rgba(255,255,255,0.05)",
                        border: `1.5px solid ${item.checked ? "#00C853" : "rgba(255,255,255,0.12)"}`,
                        boxShadow: item.checked ? "0 0 10px rgba(0,200,83,0.3)" : "none",
                      }}
                    >
                      {item.checked && (
                        <CheckCircle style={{ width: 13, height: 13, color: "#fff" }} />
                      )}
                    </div>
                    <p style={{ fontSize: 12, color: item.checked ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.3)", lineHeight: 1.6, fontFamily: "inherit", transition: "color 0.2s" }}>
                      {item.text}
                    </p>
                  </button>
                ))}
              </div>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={onDecline}
                  style={{
                    flex: 1, height: 48, borderRadius: 14,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.07)",
                    color: "rgba(255,255,255,0.35)",
                    fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                  }}
                >
                  تخطي التسجيل
                </button>
                <motion.button
                  whileTap={{ scale: allChecked ? 0.97 : 1 }}
                  onClick={() => allChecked && onAccept()}
                  style={{
                    flex: 2, height: 48, borderRadius: 14,
                    background: allChecked
                      ? "linear-gradient(135deg, #00C853, #009940)"
                      : "rgba(255,255,255,0.04)",
                    border: `1.5px solid ${allChecked ? "transparent" : "rgba(255,255,255,0.06)"}`,
                    color: allChecked ? "#fff" : "rgba(255,255,255,0.2)",
                    fontSize: 13, fontWeight: 700, fontFamily: "inherit",
                    boxShadow: allChecked ? "0 6px 24px rgba(0,200,83,0.25)" : "none",
                    transition: "all 0.3s ease",
                    cursor: allChecked ? "pointer" : "not-allowed",
                  }}
                >
                  {allChecked ? "✓ أوافق — تفعيل التسجيل" : "وافق على جميع الشروط"}
                </motion.button>
              </div>

              <p className="text-center mt-3" style={{ fontSize: 10, color: "rgba(255,255,255,0.12)", lineHeight: 1.6, fontFamily: "inherit" }}>
                يمكنك تعطيل التسجيل في أي وقت من الإعدادات
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
