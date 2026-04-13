import { useState } from "react";
import { motion } from "motion/react";
import {
  Shield, Building2, ShieldCheck, ArrowRight,
  Users, Timer, Radio, Link2, KeyRound,
  ClipboardCheck, Smartphone,
} from "lucide-react";
import { useLang } from "./useLang";

interface RoleSelectProps {
  onSelectCivilian: () => void;
  onSelectEmployee: () => void;
}

type Role = "civilian" | "employee" | null;

export function RoleSelect({ onSelectCivilian, onSelectEmployee }: RoleSelectProps) {
  const { isAr } = useLang();
  const [selected, setSelected] = useState<Role>(null);

  const handleContinue = () => {
    if (selected === "civilian") onSelectCivilian();
    if (selected === "employee") onSelectEmployee();
  };

  const S = { fontFamily: isAr ? "'Tajawal','Outfit',sans-serif" : "'Outfit','Tajawal',sans-serif" };
  const dir = isAr ? "rtl" as const : "ltr" as const;

  return (
    <div className="app-screen" style={{ background: "#05070E", ...S, direction: dir }}>
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute" style={{ top: "-15%", left: "50%", transform: "translateX(-50%)", width: "min(140vw,560px)", height: "min(140vw,560px)", borderRadius: "50%", background: "radial-gradient(circle,rgba(0,200,224,.06) 0%,transparent 60%)" }} />
      </div>

      <div className="scroll-area relative z-10">
        <div className="px-6" style={{ paddingTop: "max(70px,env(safe-area-inset-top))", paddingBottom: "max(32px,env(safe-area-inset-bottom))" }}>

          {/* Logo + branding */}
          <div className="flex flex-col items-center" style={{ marginBottom: 28 }}>
            <div className="relative mb-3">
              <div className="absolute" style={{ inset: -14, borderRadius: 32, background: "radial-gradient(circle,rgba(0,200,224,.12) 0%,transparent 70%)", filter: "blur(10px)" }} />
              <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg,rgba(0,200,224,.15),rgba(0,200,224,.05))", border: "1px solid rgba(0,200,224,.18)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                <Shield size={26} color="#00C8E0" />
              </div>
            </div>
            <span style={{ fontSize: 20, fontWeight: 900, color: "#fff", letterSpacing: "-.5px" }}>SOSphere</span>
          </div>

          {/* Title */}
          <div style={{ marginBottom: 24, textAlign: "center" }}>
            <p style={{ fontSize: 22, fontWeight: 800, color: "#fff", ...S }}>
              {isAr ? "كيف ستستخدم التطبيق؟" : "How will you use the app?"}
            </p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,.3)", marginTop: 6, lineHeight: 1.6, ...S }}>
              {isAr ? "اختر المسار المناسب لك" : "Choose the path that fits you"}
            </p>
          </div>

          {/* ═══ Civilian Card ═══ */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            onClick={() => setSelected("civilian")}
            style={{
              borderRadius: 18,
              padding: "18px 16px",
              marginBottom: 12,
              cursor: "pointer",
              background: selected === "civilian"
                ? "linear-gradient(135deg, rgba(0,200,224,.12), rgba(0,200,224,.04))"
                : "rgba(255,255,255,.03)",
              border: selected === "civilian"
                ? "1.5px solid rgba(0,200,224,.4)"
                : "1px solid rgba(255,255,255,.06)",
              boxShadow: selected === "civilian"
                ? "0 0 0 3px rgba(0,200,224,.08), 0 8px 32px rgba(0,200,224,.08)"
                : "none",
              transition: "all .25s",
            }}
          >
            <div className="flex items-start gap-3">
              <div style={{
                width: 44, height: 44, borderRadius: 13,
                background: selected === "civilian" ? "rgba(0,200,224,.15)" : "rgba(255,255,255,.04)",
                border: `1px solid ${selected === "civilian" ? "rgba(0,200,224,.25)" : "rgba(255,255,255,.06)"}`,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                transition: "all .25s",
              }}>
                <ShieldCheck size={22} color={selected === "civilian" ? "#00C8E0" : "rgba(255,255,255,.3)"} />
              </div>
              <div className="flex-1 min-w-0">
                <p style={{ fontSize: 16, fontWeight: 700, color: selected === "civilian" ? "#fff" : "rgba(255,255,255,.7)", transition: "color .25s", ...S }}>
                  {isAr ? "مدني / فرد" : "Civilian / Individual"}
                </p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,.35)", marginTop: 4, lineHeight: 1.6, ...S }}>
                  {isAr
                    ? "سلامة شخصية — تنبيهات SOS، مؤقت الحضور، حماية العائلة"
                    : "Personal safety — SOS alerts, check-in timer, family protection"}
                </p>
              </div>
            </div>
            {/* Feature pills */}
            <div className="flex flex-wrap gap-2 mt-3" style={{ paddingRight: isAr ? 0 : 47, paddingLeft: isAr ? 47 : 0 }}>
              {[
                { icon: Radio, text: "SOS" },
                { icon: Users, text: isAr ? "العائلة" : "Family" },
                { icon: Timer, text: isAr ? "المؤقت" : "Timer" },
              ].map((pill, i) => (
                <div key={i} className="flex items-center gap-1.5" style={{
                  padding: "4px 10px", borderRadius: 20,
                  background: selected === "civilian" ? "rgba(0,200,224,.08)" : "rgba(255,255,255,.03)",
                  border: `1px solid ${selected === "civilian" ? "rgba(0,200,224,.12)" : "rgba(255,255,255,.04)"}`,
                }}>
                  <pill.icon size={11} color={selected === "civilian" ? "#00C8E0" : "rgba(255,255,255,.2)"} />
                  <span style={{ fontSize: 10, fontWeight: 600, color: selected === "civilian" ? "rgba(0,200,224,.8)" : "rgba(255,255,255,.2)", ...S }}>
                    {pill.text}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* ═══ Employee Card ═══ */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            onClick={() => setSelected("employee")}
            style={{
              borderRadius: 18,
              padding: "18px 16px",
              marginBottom: 24,
              cursor: "pointer",
              background: selected === "employee"
                ? "linear-gradient(135deg, rgba(124,58,237,.12), rgba(124,58,237,.04))"
                : "rgba(255,255,255,.03)",
              border: selected === "employee"
                ? "1.5px solid rgba(124,58,237,.4)"
                : "1px solid rgba(255,255,255,.06)",
              boxShadow: selected === "employee"
                ? "0 0 0 3px rgba(124,58,237,.08), 0 8px 32px rgba(124,58,237,.08)"
                : "none",
              transition: "all .25s",
            }}
          >
            <div className="flex items-start gap-3">
              <div style={{
                width: 44, height: 44, borderRadius: 13,
                background: selected === "employee" ? "rgba(124,58,237,.15)" : "rgba(255,255,255,.04)",
                border: `1px solid ${selected === "employee" ? "rgba(124,58,237,.25)" : "rgba(255,255,255,.06)"}`,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                transition: "all .25s",
              }}>
                <Building2 size={22} color={selected === "employee" ? "#7C3AED" : "rgba(255,255,255,.3)"} />
              </div>
              <div className="flex-1 min-w-0">
                <p style={{ fontSize: 16, fontWeight: 700, color: selected === "employee" ? "#fff" : "rgba(255,255,255,.7)", transition: "color .25s", ...S }}>
                  {isAr ? "موظف / عامل ميداني" : "Employee / Field Worker"}
                </p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,.35)", marginTop: 4, lineHeight: 1.6, ...S }}>
                  {isAr
                    ? "انضم لشركتك — تتبع GPS، نظام الإخلاء، تقارير الحوادث"
                    : "Join your company — GPS tracking, evacuation system, incident reports"}
                </p>
              </div>
            </div>
            {/* Feature pills */}
            <div className="flex flex-wrap gap-2 mt-3" style={{ paddingRight: isAr ? 0 : 47, paddingLeft: isAr ? 47 : 0 }}>
              {[
                { icon: Link2, text: isAr ? "الشركة" : "Company" },
                { icon: ClipboardCheck, text: isAr ? "الحوادث" : "Reports" },
                { icon: KeyRound, text: isAr ? "كود الدخول" : "Join Code" },
              ].map((pill, i) => (
                <div key={i} className="flex items-center gap-1.5" style={{
                  padding: "4px 10px", borderRadius: 20,
                  background: selected === "employee" ? "rgba(124,58,237,.08)" : "rgba(255,255,255,.03)",
                  border: `1px solid ${selected === "employee" ? "rgba(124,58,237,.12)" : "rgba(255,255,255,.04)"}`,
                }}>
                  <pill.icon size={11} color={selected === "employee" ? "#7C3AED" : "rgba(255,255,255,.2)"} />
                  <span style={{ fontSize: 10, fontWeight: 600, color: selected === "employee" ? "rgba(124,58,237,.8)" : "rgba(255,255,255,.2)", ...S }}>
                    {pill.text}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Continue Button */}
          <motion.button
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
            onClick={handleContinue}
            disabled={!selected}
            className="w-full flex items-center justify-center gap-2"
            style={{
              height: 52,
              borderRadius: 14,
              background: selected
                ? selected === "civilian"
                  ? "linear-gradient(135deg,#00C8E0,#00A5C0)"
                  : "linear-gradient(135deg,#7C3AED,#6D28D9)"
                : "rgba(255,255,255,.04)",
              color: selected ? "#fff" : "rgba(255,255,255,.18)",
              fontSize: 15,
              fontWeight: 700,
              border: selected ? "none" : "1px solid rgba(255,255,255,.06)",
              boxShadow: selected
                ? selected === "civilian"
                  ? "0 6px 24px rgba(0,200,224,.25)"
                  : "0 6px 24px rgba(124,58,237,.25)"
                : "none",
              transition: "all .25s",
              cursor: selected ? "pointer" : "default",
              ...S,
            }}
          >
            {isAr ? "متابعة" : "Continue"}
            <ArrowRight size={16} />
          </motion.button>

          {/* Step indicator dots */}
          <div className="flex items-center justify-center gap-2 mt-6">
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(255,255,255,.1)" }} />
            <div style={{ width: 20, height: 6, borderRadius: 3, background: "#00C8E0" }} />
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(255,255,255,.1)" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
