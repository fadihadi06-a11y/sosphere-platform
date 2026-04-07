import { useState } from "react";
import { motion } from "motion/react";
import {
  Shield, Building2, ShieldCheck, Sparkles, ArrowRight,
  Users, Timer, ClipboardCheck, Radio, Link2, KeyRound,
  Smartphone, CheckCircle2,
} from "lucide-react";
import { useLang } from "./useLang";

interface OnboardingSelectProps {
  onSelectIndividual: () => void;
  onSelectCompany: () => void;
}

type Selection = "individual" | "company-join" | null;

export function OnboardingSelect({ onSelectIndividual, onSelectCompany }: OnboardingSelectProps) {
  const { isAr } = useLang();
  const [selected, setSelected] = useState<Selection>(null);

  const handleContinue = () => {
    console.log("[SUPABASE_READY] path_selected", { selected });
    if (selected === "individual") onSelectIndividual();
    if (selected === "company-join") onSelectCompany();
  };

  const S = { fontFamily: isAr ? "'Tajawal','Outfit',sans-serif" : "'Outfit','Tajawal',sans-serif" };

  return (
    <div className="absolute inset-0 flex flex-col" style={{ direction: isAr ? "rtl" : "ltr", ...S }}>
      <div className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[500px] h-[400px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse, rgba(0,200,224,0.05) 0%, transparent 60%)" }} />

      <div className="flex-1 overflow-y-auto flex flex-col px-6 pt-12 pb-6 relative z-10">
        {/* Step indicator */}
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          className="flex items-center justify-center gap-2 mb-8">
          <div className="size-2 rounded-full" style={{ background: "#00C8E0" }} />
          <div className="w-6 h-[2px] rounded-full" style={{ background: "rgba(255,255,255,0.08)" }} />
          <div className="size-2 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }} />
        </motion.div>

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }} className="mb-2">
          <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5, delay: 0.1 }}
            className="inline-flex items-center gap-2 px-3.5 py-[7px] mb-5"
            style={{ borderRadius: "100px", background: "rgba(0,200,224,0.05)", border: "1px solid rgba(0,200,224,0.08)" }}>
            <Sparkles className="size-3" style={{ color: "#00C8E0" }} />
            <span style={{ fontSize: "11px", color: "rgba(0,200,224,0.7)", fontWeight: 500, letterSpacing: "0.4px" }}>
              {isAr ? "اختر مسارك" : "Choose your path"}
            </span>
          </motion.div>

          <h1 className="text-white" style={{ fontSize: "26px", fontWeight: 700, letterSpacing: "-0.5px", lineHeight: 1.25 }}>
            {isAr ? <>كيف ستستخدم<br /><span style={{ color: "#00C8E0" }}>SOSphere</span>؟</> : <>How will you use<br /><span style={{ color: "#00C8E0" }}>SOSphere</span>?</>}
          </h1>
          <p className="mt-2.5" style={{ fontSize: "14px", color: "rgba(255,255,255,0.3)", lineHeight: 1.65 }}>
            {isAr ? "سنخصص تجربة السلامة الخاصة بك" : "We'll personalize your safety experience"}
          </p>
        </motion.div>

        {/* Cards */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-4 py-4">
          <SelectionCard
            delay={0.15}
            selected={selected === "individual"}
            onClick={() => setSelected("individual")}
            icon={ShieldCheck}
            title={isAr ? "سلامة شخصية" : "Personal Safety"}
            description={isAr ? "تنبيهات SOS، مؤقت الحضور، تتبع العائلة — احمِ نفسك ومن تحب" : "SOS alerts, check-in timer, family tracking — protect yourself and loved ones"}
            color="#00C8E0"
            pills={[
              { icon: Radio, text: "SOS" },
              { icon: Users, text: isAr ? "دائرة العائلة" : "Family Circle" },
              { icon: Timer, text: isAr ? "المؤقت" : "Timer" },
            ]}
          />

          <SelectionCard
            delay={0.22}
            selected={selected === "company-join"}
            onClick={() => setSelected("company-join")}
            icon={Building2}
            title={isAr ? "انضم لشركتي" : "Join My Company"}
            description={isAr ? "شركتك تستخدم SOSphere — أدخل رمز الدعوة أو الصق الرابط الذي استلمته" : "Your company uses SOSphere — enter your invite code or paste the link you received"}
            color="#7B5EFF"
            pills={[
              { icon: KeyRound, text: isAr ? "رمز الدعوة" : "Invite Code" },
              { icon: ClipboardCheck, text: isAr ? "تحقق تلقائي" : "Auto-Verify" },
              { icon: Shield, text: isAr ? "أمان المنطقة" : "Zone Safety" },
            ]}
          />

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
            className="flex items-start gap-2.5 px-4 py-3 rounded-xl"
            style={{ background: "rgba(255,150,0,0.03)", border: "1px solid rgba(255,150,0,0.08)" }}>
            <Smartphone className="size-4 shrink-0 mt-0.5" style={{ color: "#FF9500" }} />
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
              <span style={{ color: "#FF9500", fontWeight: 700 }}>{isAr ? "مسؤولو الشركات:" : "Company admins:"}</span>{" "}
              {isAr ? "أنشئ مؤسستك من" : "Create your organization from the"}{" "}
              <span style={{ color: "#00C8E0", fontWeight: 600 }}>{isAr ? "لوحة التحكم" : "web dashboard"}</span>{" "}
              {isAr ? "على" : "at"} sosphere.app/dashboard
            </p>
          </motion.div>
        </div>

        {/* Continue button */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4 }}>
          <motion.button onClick={handleContinue} disabled={!selected} whileTap={selected ? { scale: 0.97 } : {}}
            className="w-full flex items-center justify-center gap-2.5 transition-all duration-500"
            style={{
              padding: "17px", borderRadius: "16px",
              background: selected ? "linear-gradient(135deg, #00C8E0 0%, #00A5C0 100%)" : "rgba(255,255,255,0.03)",
              color: selected ? "#fff" : "rgba(255,255,255,0.15)",
              fontSize: "15px", fontWeight: 600,
              boxShadow: selected ? "0 8px 32px rgba(0,200,224,0.25)" : "none",
              border: selected ? "none" : "1px solid rgba(255,255,255,0.04)",
              cursor: selected ? "pointer" : "default",
            }}>
            {isAr ? "متابعة" : "Continue"}
            <ArrowRight className="size-[17px]" />
          </motion.button>
          <p className="text-center mt-5" style={{ fontSize: "11px", color: "rgba(255,255,255,0.15)" }}>
            {isAr ? "يمكنك تغيير هذا لاحقاً من الإعدادات" : "You can change this later in Settings"}
          </p>
        </motion.div>
      </div>
    </div>
  );
}

function SelectionCard({ delay, selected, onClick, icon: Icon, title, description, color, pills }: {
  delay: number; selected: boolean; onClick: () => void; icon: typeof Shield;
  title: string; description: string; color: string; pills: { icon: typeof Shield; text: string }[];
}) {
  return (
    <motion.button initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay }}
      whileTap={{ scale: 0.975 }} onClick={onClick}
      className="relative text-left transition-all duration-400 overflow-hidden"
      style={{ padding: "20px", borderRadius: "18px", background: selected ? `${color}08` : "rgba(255,255,255,0.018)",
        backdropFilter: "blur(40px)", border: selected ? `1.5px solid ${color}40` : "1.5px solid rgba(255,255,255,0.05)",
        boxShadow: selected ? `0 0 0 4px ${color}08, 0 6px 24px ${color}0A` : "0 2px 16px rgba(0,0,0,0.06)" }}>
      <div className="absolute top-0 right-0 w-32 h-32 pointer-events-none transition-opacity duration-500"
        style={{ opacity: selected ? 1 : 0, background: `radial-gradient(circle at top right, ${color}15, transparent 65%)`, borderRadius: "18px" }} />
      <div className="flex items-start gap-3.5 relative z-10">
        <div className="size-[48px] rounded-[14px] flex items-center justify-center shrink-0 transition-all duration-400"
          style={{ background: selected ? `${color}15` : "rgba(255,255,255,0.025)", border: `1px solid ${selected ? `${color}25` : "rgba(255,255,255,0.05)"}` }}>
          <Icon className="size-[22px]" style={{ color: selected ? color : "rgba(255,255,255,0.25)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className="text-white" style={{ fontSize: "15px", fontWeight: 600 }}>{title}</p>
            <div className="size-[20px] rounded-full shrink-0 flex items-center justify-center transition-all duration-400"
              style={{ border: `2px solid ${selected ? color : "rgba(255,255,255,0.1)"}`, background: selected ? `${color}10` : "transparent" }}>
              {selected && <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 25 }}
                className="size-[9px] rounded-full" style={{ background: color }} />}
            </div>
          </div>
          <p className="mt-1.5" style={{ fontSize: "12px", color: "rgba(255,255,255,0.3)", lineHeight: 1.55 }}>{description}</p>
          <div className="flex items-center gap-1.5 mt-3 flex-wrap">
            {pills.map((pill) => (
              <span key={pill.text} className="inline-flex items-center gap-1 px-2 py-[3px] transition-all duration-400"
                style={{ borderRadius: "7px", background: selected ? `${color}0A` : "rgba(255,255,255,0.025)",
                  border: `1px solid ${selected ? `${color}18` : "rgba(255,255,255,0.04)"}`,
                  fontSize: "9.5px", fontWeight: 500, color: selected ? `${color}CC` : "rgba(255,255,255,0.2)" }}>
                <pill.icon className="size-[9px]" />
                {pill.text}
              </span>
            ))}
          </div>
        </div>
      </div>
    </motion.button>
  );
}
