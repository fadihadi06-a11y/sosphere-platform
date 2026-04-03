import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "motion/react";

// ── SOSphere Landing Page ──────────────────────────────────────
// Dark enterprise. Precision safety. Multi-language.
// ──────────────────────────────────────────────────────────────

const LANGS = {
  en: {
    nav: { product: "Product", pricing: "Pricing", demo: "Live Demo", login: "Sign In", cta: "Start Free Trial" },
    hero: {
      badge: "Enterprise Safety Platform",
      h1a: "Real-time Safety",
      h1b: "Intelligence",
      h1c: "for Field Workers",
      sub: "Monitor, protect, and respond to field emergencies in real-time. Built for industries where lives depend on rapid action.",
      cta1: "Start 14-Day Free Trial",
      cta2: "Watch Live Demo",
      trust: "Trusted by 400+ enterprises worldwide",
      nocard: "No credit card required",
    },
    stats: [
      { v: "12,847", l: "Protected Workers" },
      { v: "< 30s", l: "SOS Response Time" },
      { v: "99.97%", l: "Platform Uptime" },
      { v: "284", l: "Active Zones" },
    ],
    features: {
      title: "Everything you need to keep your team safe",
      sub: "From real-time SOS alerts to AI-powered risk analysis",
      items: [
        { icon: null, svg: true, t: "SOS Emergency Response", d: "Instant alerts with GPS location, fall detection, and automatic escalation protocols." },
        { icon: null, svg: true, t: "Live Zone Monitoring", d: "Geofenced zones with real-time worker tracking, risk scoring, and hazard alerts." },
        { icon: null, svg: true, t: "Safety Intelligence", d: "AI-powered insights, incident patterns, and predictive risk analysis." },
        { icon: null, svg: true, t: "Team Management", d: "Full RBAC with 8 roles, invite workflows, and attendance tracking." },
        { icon: null, svg: true, t: "Mobile Field App", d: "Offline-capable iOS/Android app with fall detection and shake-to-SOS." },
        { icon: null, svg: true, t: "Compliance Reports", d: "ISO 45001 compliance, audit logs, and automated regulatory reporting." },
      ],
    },
    plans: {
      title: "Simple, transparent pricing",
      sub: "Start free, scale as you grow",
      items: [
        { name: "Starter", price: "$149", period: "/mo", desc: "For small teams up to 25 workers", color: "#00C8E0", features: ["25 employees", "3 zones", "Basic dashboard", "SOS response", "Attendance tracking"] },
        { name: "Growth", price: "$349", period: "/mo", desc: "For growing operations up to 100 workers", color: "#7B5EFF", hot: true, features: ["100 employees", "10 zones", "Risk map", "Command center", "Audit logs", "Incident history"] },
        { name: "Business", price: "$799", period: "/mo", desc: "For large teams up to 500 workers", color: "#F59E0B", features: ["500 employees", "Unlimited zones", "AI Co-Admin", "SLA management", "Advanced analytics", "API access"] },
        { name: "Enterprise", price: "Custom", period: "", desc: "For enterprise with unlimited scale", color: "#00C853", features: ["Unlimited employees", "Multi-site", "Custom branding", "Dedicated support", "Custom integrations", "On-premise option"] },
      ],
    },
    flow: {
      title: "Get your team protected in minutes",
      steps: [
        { n: "1", t: "Register Company", d: "Sign in with Google, complete 6-step setup with zones and team members." },
        { n: "2", t: "Invite Your Team", d: "Employees receive email with app download link. Admins get dashboard access." },
        { n: "3", t: "Go Live", d: "Monitor in real-time. Respond to emergencies. Keep your team safe." },
      ],
    },
    footer: {
      tagline: "Enterprise safety intelligence for the field.",
      links: ["Privacy Policy", "Terms of Service", "Documentation", "Contact Sales"],
      copy: "© 2025 SOSphere. All rights reserved.",
    },
  },
  ar: {
    nav: { product: "المنتج", pricing: "الأسعار", demo: "عرض حي", login: "تسجيل الدخول", cta: "ابدأ مجاناً" },
    hero: {
      badge: "منصة السلامة المؤسسية",
      h1a: "ذكاء السلامة",
      h1b: "اللحظي",
      h1c: "للعمال الميدانيين",
      sub: "راقب وحمِّ واستجب لحالات الطوارئ الميدانية في الوقت الفعلي. مصمم للصناعات التي تعتمد على الاستجابة السريعة.",
      cta1: "ابدأ تجربة 14 يوم مجاناً",
      cta2: "شاهد العرض الحي",
      trust: "موثوق به من قبل 400+ مؤسسة حول العالم",
      nocard: "لا يلزم بطاقة ائتمان",
    },
    stats: [
      { v: "12,847", l: "عامل محمي" },
      { v: "< 30ث", l: "وقت الاستجابة للطوارئ" },
      { v: "99.97%", l: "وقت تشغيل المنصة" },
      { v: "284", l: "منطقة نشطة" },
    ],
    features: {
      title: "كل ما تحتاجه للحفاظ على سلامة فريقك",
      sub: "من تنبيهات SOS الفورية إلى تحليل المخاطر بالذكاء الاصطناعي",
      items: [
        { icon: null, svg: true, t: "استجابة طوارئ SOS", d: "تنبيهات فورية مع موقع GPS، اكتشاف السقوط، وبروتوكولات التصعيد التلقائي." },
        { icon: null, svg: true, t: "مراقبة المناطق المباشرة", d: "مناطق محاطة بسياج جغرافي مع تتبع العمال في الوقت الفعلي وتقييم المخاطر." },
        { icon: null, svg: true, t: "ذكاء السلامة", d: "رؤى مدعومة بالذكاء الاصطناعي، وأنماط الحوادث، وتحليل المخاطر التنبؤي." },
        { icon: null, svg: true, t: "إدارة الفريق", d: "RBAC كامل مع 8 أدوار وسير عمل الدعوة وتتبع الحضور." },
        { icon: null, svg: true, t: "تطبيق الهاتف الميداني", d: "تطبيق iOS/Android يعمل دون اتصال مع اكتشاف السقوط وـSOS بالاهتزاز." },
        { icon: null, svg: true, t: "تقارير الامتثال", d: "امتثال ISO 45001 وسجلات التدقيق والتقارير التنظيمية الآلية." },
      ],
    },
    plans: {
      title: "أسعار بسيطة وشفافة",
      sub: "ابدأ مجاناً، وتوسع مع نمو عملك",
      items: [
        { name: "مبتدئ", price: "$149", period: "/شهر", desc: "للفرق الصغيرة حتى 25 عاملاً", color: "#00C8E0", features: ["25 موظف", "3 مناطق", "لوحة تحكم أساسية", "استجابة SOS", "تتبع الحضور"] },
        { name: "نمو", price: "$349", period: "/شهر", desc: "للعمليات المتنامية حتى 100 عامل", color: "#7B5EFF", hot: true, features: ["100 موظف", "10 مناطق", "خريطة المخاطر", "مركز القيادة", "سجلات التدقيق", "تاريخ الحوادث"] },
        { name: "أعمال", price: "$799", period: "/شهر", desc: "للفرق الكبيرة حتى 500 عامل", color: "#F59E0B", features: ["500 موظف", "مناطق غير محدودة", "المساعد الذكي", "إدارة SLA", "تحليلات متقدمة", "وصول API"] },
        { name: "مؤسسي", price: "مخصص", period: "", desc: "للمؤسسات ذات الحجم غير المحدود", color: "#00C853", features: ["موظفون غير محدودون", "مواقع متعددة", "علامة تجارية مخصصة", "دعم مخصص", "تكاملات مخصصة", "خيار محلي"] },
      ],
    },
    flow: {
      title: "احمِ فريقك في دقائق",
      steps: [
        { n: "1", t: "سجّل شركتك", d: "سجّل الدخول بـ Google، أكمل الإعداد المكون من 6 خطوات مع المناطق وأعضاء الفريق." },
        { n: "2", t: "ادعُ فريقك", d: "يستلم الموظفون بريداً إلكترونياً برابط تحميل التطبيق. يحصل المشرفون على وصول للوحة التحكم." },
        { n: "3", t: "انطلق", d: "راقب في الوقت الفعلي. استجب للطوارئ. حافظ على سلامة فريقك." },
      ],
    },
    footer: {
      tagline: "ذكاء السلامة المؤسسي للعمل الميداني.",
      links: ["سياسة الخصوصية", "شروط الخدمة", "التوثيق", "تواصل مع المبيعات"],
      copy: "© 2025 SOSphere. جميع الحقوق محفوظة.",
    },
  },
};

type LangKey = keyof typeof LANGS;


// ── Feature Icons (SVG) ───────────────────────────────────────
const FEATURE_ICONS = [
  <svg key={0} viewBox="0 0 24 24" fill="none" stroke="#00C8E0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:22,height:22}}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  <svg key={1} viewBox="0 0 24 24" fill="none" stroke="#FF9500" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:22,height:22}}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  <svg key={2} viewBox="0 0 24 24" fill="none" stroke="#7B5EFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:22,height:22}}><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>,
  <svg key={3} viewBox="0 0 24 24" fill="none" stroke="#00C853" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:22,height:22}}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  <svg key={4} viewBox="0 0 24 24" fill="none" stroke="#00C8E0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:22,height:22}}><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>,
  <svg key={5} viewBox="0 0 24 24" fill="none" stroke="#FF2D55" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:22,height:22}}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
];

export function LandingPage() {
  const navigate = useNavigate();
  const [lang, setLang] = useState<LangKey>("en");
  const [langOpen, setLangOpen] = useState(false);
  const handleSignIn = () => navigate("/dashboard");
  const handleStartTrial = () => navigate("/dashboard?new=true");
  const [scrolled, setScrolled] = useState(false);
  const t = LANGS[lang];
  const heroRef = useRef<HTMLDivElement>(null);
  const isRtl = lang === "ar";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      style={{
        background: "#05070E",
        color: "rgba(255,255,255,0.9)",
        fontFamily: "'Outfit', sans-serif",
        overflowX: "hidden",
        minHeight: "100vh",
      }}
    >

      {/* ── NAV ─────────────────────────────────────────────────── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        transition: "all 0.3s",
        background: scrolled ? "rgba(5,7,14,0.95)" : "transparent",
        backdropFilter: scrolled ? "blur(20px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(255,255,255,0.06)" : "none",
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg, rgba(0,200,224,0.25), rgba(0,200,224,0.06))", border: "1px solid rgba(0,200,224,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00C8E0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.4px", color: "#fff" }}>SOSphere</div>
              <div style={{ fontSize: 8, color: "rgba(0,200,224,0.5)", fontWeight: 700, letterSpacing: "2px", lineHeight: 1 }}>ENTERPRISE</div>
            </div>
          </div>

          {/* Desktop nav */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }} className="hidden-mobile">
            {[
              { label: t.nav.product, id: "features" },
              { label: t.nav.pricing, id: "pricing" },
              { label: t.nav.demo, id: "demo" },
            ].map(item => (
              <button key={item.id} onClick={() => scrollTo(item.id)}
                style={{ padding: "6px 14px", borderRadius: 8, background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", fontSize: 14, fontWeight: 500, cursor: "pointer", transition: "color 0.2s", fontFamily: "inherit" }}
                onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
                onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.5)")}
              >{item.label}</button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Lang picker */}
            <div style={{ position: "relative" }}>
              <button onClick={() => setLangOpen(!langOpen)}
                style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontFamily: "inherit" }}>
                <span>{lang.toUpperCase()}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <AnimatePresence>
                {langOpen && (
                  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    style={{ position: "absolute", top: "calc(100% + 6px)", [isRtl ? "left" : "right"]: 0, background: "#0c0e1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 6, minWidth: 140, zIndex: 200, boxShadow: "0 16px 40px rgba(0,0,0,0.6)" }}>
                    {(Object.keys(LANGS) as LangKey[]).map(l => (
                      <button key={l} onClick={() => { setLang(l); setLangOpen(false); }}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 7, background: lang === l ? "rgba(0,200,224,0.08)" : "transparent", border: "none", color: lang === l ? "#00C8E0" : "rgba(255,255,255,0.6)", fontSize: 13, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                        <span style={{ fontSize: 15 }}>{l === "en" ? "🇺🇸" : l === "ar" ? "🇸🇦" : l === "fr" ? "🇫🇷" : l === "es" ? "🇪🇸" : l === "de" ? "🇩🇪" : "🌐"}</span>
                        {l === "en" ? "English" : l === "ar" ? "العربية" : l === "fr" ? "Français" : l === "es" ? "Español" : l === "de" ? "Deutsch" : l.toUpperCase()}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button onClick={handleSignIn}
              style={{ padding: "7px 16px", borderRadius: 9, background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
              className="hidden-mobile">
              {t.nav.login}
            </button>
            <button onClick={handleStartTrial}
              style={{ padding: "7px 18px", borderRadius: 9, background: "linear-gradient(135deg, #00C8E0, #0098B8)", border: "none", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 16px rgba(0,200,224,0.3)", fontFamily: "inherit" }}>
              {t.nav.cta}
            </button>
          </div>
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section ref={heroRef} style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "120px 24px 80px", position: "relative", overflow: "hidden" }}>
        {/* Ambient glows */}
        <div style={{ position: "absolute", top: "10%", left: "15%", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,200,224,0.06) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: "10%", right: "10%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(123,94,255,0.05) 0%, transparent 70%)", pointerEvents: "none" }} />

        {/* Grid pattern */}
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.015, pointerEvents: "none" }}>
          <defs><pattern id="grid" width="52" height="52" patternUnits="userSpaceOnUse"><path d="M 52 0 L 0 0 0 52" fill="none" stroke="white" strokeWidth="1"/></pattern></defs>
          <rect width="100%" height="100%" fill="url(#grid)"/>
        </svg>

        <div style={{ maxWidth: 1200, margin: "0 auto", width: "100%", display: "flex", alignItems: "center", gap: 64, flexWrap: "wrap" }}>
          {/* Left content */}
          <div style={{ flex: "1 1 480px", minWidth: 0 }}>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
              {/* Badge */}
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 14px", borderRadius: 999, background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.2)", marginBottom: 24 }}>
                <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2, repeat: Infinity }} style={{ width: 6, height: 6, borderRadius: "50%", background: "#00C8E0" }} />
                <span style={{ fontSize: 12, color: "#00C8E0", fontWeight: 600, letterSpacing: "0.5px" }}>{t.hero.badge}</span>
              </div>

              {/* Headline */}
              <h1 style={{ fontSize: "clamp(36px, 5vw, 64px)", fontWeight: 800, letterSpacing: "-1.5px", lineHeight: 1.1, marginBottom: 24 }}>
                <span style={{ color: "#fff" }}>{t.hero.h1a} </span>
                <span style={{ background: "linear-gradient(135deg, #00C8E0, #7B5EFF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{t.hero.h1b}</span>
                <br />
                <span style={{ color: "rgba(255,255,255,0.7)" }}>{t.hero.h1c}</span>
              </h1>

              <p style={{ fontSize: "clamp(15px, 2vw, 18px)", color: "rgba(255,255,255,0.45)", lineHeight: 1.75, marginBottom: 36, maxWidth: 520 }}>
                {t.hero.sub}
              </p>

              {/* CTAs */}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 40 }}>
                <motion.button whileTap={{ scale: 0.97 }} onClick={handleStartTrial}
                  style={{ padding: "14px 28px", borderRadius: 14, background: "linear-gradient(135deg, #00C8E0, #0098B8)", border: "none", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", boxShadow: "0 8px 32px rgba(0,200,224,0.3)", fontFamily: "inherit" }}>
                  {t.hero.cta1}
                </motion.button>
                <motion.button whileTap={{ scale: 0.97 }} onClick={() => navigate("/demo")}
                  style={{ padding: "14px 28px", borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.8)", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16 }}>▶</span> {t.hero.cta2}
                </motion.button>
              </div>

              {/* Trust */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex" }}>
                  {["#00C8E0","#7B5EFF","#FF9500","#00C853","#FF2D55"].map((c,i) => (
                    <div key={i} style={{ width: 28, height: 28, borderRadius: "50%", background: `${c}18`, border: `2px solid #05070E`, marginLeft: i ? -8 : 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                    </div>
                  ))}
                </div>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{t.hero.trust}</span>
                <span style={{ fontSize: 11, color: "rgba(0,200,224,0.5)", fontWeight: 600 }}>✓ {t.hero.nocard}</span>
              </div>
            </motion.div>
          </div>

          {/* Right — phone mockup */}
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.2 }}
            style={{ flex: "0 0 auto", display: "flex", justifyContent: "center" }}>
            <div style={{ position: "relative" }}>
              {/* Glow behind phone */}
              <div style={{ position: "absolute", inset: -40, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,200,224,0.12) 0%, transparent 70%)", pointerEvents: "none" }} />
              {/* Phone frame */}
              <div style={{ width: 260, height: 520, borderRadius: 40, background: "#0c0e1a", border: "2px solid rgba(255,255,255,0.12)", boxShadow: "0 40px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)", overflow: "hidden", position: "relative" }}>
                {/* Notch */}
                <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", width: 80, height: 22, background: "#0c0e1a", borderRadius: 12, zIndex: 10, border: "2px solid rgba(255,255,255,0.06)" }} />
                {/* Screen content */}
                <div style={{ width: "100%", height: "100%", background: "#05070E", padding: "52px 16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* Status bar */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>9:41</span>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      {[1,2,3,4].map(i => <div key={i} style={{ width: 3, height: i*2+4, background: `rgba(255,255,255,${0.15*i+0.15})`, borderRadius: 2 }} />)}
                      <div style={{ width: 16, height: 8, borderRadius: 2, border: "1px solid rgba(255,255,255,0.3)", marginLeft: 2, position: "relative" }}>
                        <div style={{ position: "absolute", left: 2, top: 1.5, width: 8, height: 5, background: "#00C853", borderRadius: 1 }} />
                      </div>
                    </div>
                  </div>
                  {/* SOS Button preview */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <div style={{ width: 90, height: 90, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,45,85,0.2), rgba(255,45,85,0.05))", border: "2px solid rgba(255,45,85,0.4)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 30px rgba(255,45,85,0.15)" }}>
                      <span style={{ fontSize: 28, fontWeight: 900, color: "#FF2D55" }}>SOS</span>
                    </div>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", letterSpacing: 1 }}>HOLD 3s TO ACTIVATE</span>
                  </div>
                  {/* Mini cards */}
                  {[
                    { color: "#00C8E0", label: "Zone A - North Gate", sub: "12 workers active", icon: <svg viewBox="0 0 24 24" fill="none" stroke="#00C8E0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{width:13,height:13}}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="2"/></svg> },
                    { color: "#00C853", label: "Check-in Complete", sub: "Today 08:30 AM", icon: <svg viewBox="0 0 24 24" fill="none" stroke="#00C853" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{width:13,height:13}}><polyline points="20 6 9 17 4 12"/></svg> },
                    { color: "#FF9500", label: "Mission Active", sub: "Warehouse B", icon: <svg viewBox="0 0 24 24" fill="none" stroke="#FF9500" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{width:13,height:13}}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> },
                  ].map((item, i) => (
                    <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 + i * 0.1 }}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <div style={{ width: 28, height: 28, borderRadius: 8, background: `${item.color}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>{item.icon}</div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>{item.label}</div>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{item.sub}</div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
              {/* Store badges */}
              <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "center" }}>
                {["App Store", "Google Play"].map(s => (
                  <div key={s} style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 6 }}>
                    {s === "App Store" 
                      ? <svg viewBox="0 0 24 24" fill="rgba(255,255,255,0.5)" style={{width:14,height:14}}><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                      : <svg viewBox="0 0 24 24" fill="rgba(255,255,255,0.5)" style={{width:14,height:14}}><path d="M3.18 23.76c.28.15.59.19.91.1l12.44-7.19-2.79-2.79-10.56 9.88zM.54 1.18C.2 1.53 0 2.08 0 2.79v18.42c0 .71.2 1.26.55 1.61l.08.08 10.32-10.32v-.24L.62 1.1l-.08.08zM20.1 10.23l-2.62-1.52-3.12 3.12 3.12 3.12 2.65-1.53c.76-.44.76-1.15-.03-1.59v-.6zM3.18.24L15.62 7.43l-2.79 2.79L2.27.14l.91.1z"/></svg>}
                    <div>
                      <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>Download on</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{s}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── STATS ────────────────────────────────────────────────── */}
      <section style={{ padding: "40px 24px", borderTop: "1px solid rgba(255,255,255,0.04)", borderBottom: "1px solid rgba(255,255,255,0.04)", background: "rgba(255,255,255,0.01)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 24 }}>
          {t.stats.map((s, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
              style={{ textAlign: "center", padding: "20px 16px" }}>
              <div style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-1px", color: "#00C8E0", marginBottom: 4 }}>{s.v}</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", fontWeight: 500 }}>{s.l}</div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────────────────────────── */}
      <section id="features" style={{ padding: "80px 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} style={{ textAlign: "center", marginBottom: 56 }}>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 800, letterSpacing: "-1px", marginBottom: 12 }}>{t.features.title}</h2>
            <p style={{ fontSize: 16, color: "rgba(255,255,255,0.35)", maxWidth: 480, margin: "0 auto" }}>{t.features.sub}</p>
          </motion.div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
            {t.features.items.map((f, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }}
                style={{ padding: "24px", borderRadius: 16, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", transition: "all 0.2s", cursor: "default" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,200,224,0.2)"; (e.currentTarget as HTMLElement).style.background = "rgba(0,200,224,0.03)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)"; }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                  {FEATURE_ICONS[i]}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: "#fff" }}>{f.t}</div>
                <div style={{ fontSize: 14, color: "rgba(255,255,255,0.35)", lineHeight: 1.65 }}>{f.d}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────── */}
      <section style={{ padding: "80px 24px", background: "rgba(255,255,255,0.01)", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} style={{ textAlign: "center", marginBottom: 56 }}>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 800, letterSpacing: "-1px" }}>{t.flow.title}</h2>
          </motion.div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 24 }}>
            {t.flow.steps.map((s, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.15 }}
                style={{ display: "flex", flexDirection: "column", alignItems: isRtl ? "flex-end" : "flex-start", gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: 14, background: "linear-gradient(135deg, rgba(0,200,224,0.2), rgba(0,200,224,0.05))", border: "1px solid rgba(0,200,224,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: "#00C8E0" }}>{s.n}</span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{s.t}</div>
                <div style={{ fontSize: 14, color: "rgba(255,255,255,0.35)", lineHeight: 1.65 }}>{s.d}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ──────────────────────────────────────────────── */}
      <section id="pricing" style={{ padding: "80px 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} style={{ textAlign: "center", marginBottom: 56 }}>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 800, letterSpacing: "-1px", marginBottom: 12 }}>{t.plans.title}</h2>
            <p style={{ fontSize: 16, color: "rgba(255,255,255,0.35)" }}>{t.plans.sub}</p>
          </motion.div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
            {t.plans.items.map((p, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                style={{ padding: "28px 24px", borderRadius: 20, background: (p as any).hot ? "rgba(123,94,255,0.06)" : "rgba(255,255,255,0.02)", border: `1px solid ${(p as any).hot ? "rgba(123,94,255,0.3)" : "rgba(255,255,255,0.06)"}`, position: "relative" }}>
                {(p as any).hot && (
                  <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", padding: "3px 12px", borderRadius: 999, background: "#7B5EFF", fontSize: 11, fontWeight: 700, color: "#fff", whiteSpace: "nowrap" }}>
                    Most Popular
                  </div>
                )}
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, marginBottom: 16, boxShadow: `0 0 12px ${p.color}` }} />
                <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>{p.name}</div>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 32, fontWeight: 800, color: p.color }}>{p.price}</span>
                  <span style={{ fontSize: 14, color: "rgba(255,255,255,0.3)" }}>{p.period}</span>
                </div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginBottom: 20, lineHeight: 1.5 }}>{p.desc}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
                  {p.features.map((f, fi) => (
                    <div key={fi} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "rgba(255,255,255,0.6)" }}>
                      <span style={{ color: p.color, fontSize: 14, flexShrink: 0 }}>✓</span> {f}
                    </div>
                  ))}
                </div>
                <button onClick={handleStartTrial}
                  style={{ width: "100%", padding: "10px 16px", borderRadius: 12, background: (p as any).hot ? "#7B5EFF" : "rgba(255,255,255,0.06)", border: "none", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.2s" }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
                  onMouseLeave={e => (e.currentTarget.style.opacity = "1")}>
                  {p.price === "Custom" || p.price === "مخصص" ? "Contact Sales" : "Start Free Trial"}
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ───────────────────────────────────────────── */}
      <section id="demo" style={{ padding: "80px 24px" }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            style={{ textAlign: "center", padding: "56px 40px", borderRadius: 24, background: "linear-gradient(135deg, rgba(0,200,224,0.08), rgba(123,94,255,0.06))", border: "1px solid rgba(0,200,224,0.15)", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: -60, right: -60, width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,200,224,0.08), transparent)", pointerEvents: "none" }} />
            <h2 style={{ fontSize: "clamp(24px, 3vw, 36px)", fontWeight: 800, letterSpacing: "-0.8px", marginBottom: 14 }}>
              {lang === "ar" ? "ابدأ حماية فريقك اليوم" : "Start protecting your team today"}
            </h2>
            <p style={{ fontSize: 16, color: "rgba(255,255,255,0.4)", marginBottom: 32, maxWidth: 440, margin: "0 auto 32px" }}>
              {lang === "ar" ? "تجربة مجانية 14 يوم. لا يلزم بطاقة ائتمان." : "14-day free trial. No credit card required."}
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <motion.button whileTap={{ scale: 0.97 }} onClick={handleStartTrial}
                style={{ padding: "14px 32px", borderRadius: 14, background: "linear-gradient(135deg, #00C8E0, #0098B8)", border: "none", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 8px 32px rgba(0,200,224,0.35)" }}>
                {t.hero.cta1}
              </motion.button>
              <motion.button whileTap={{ scale: 0.97 }} onClick={() => navigate("/demo")}
                style={{ padding: "14px 32px", borderRadius: 14, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.8)", fontSize: 16, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                {t.hero.cta2}
              </motion.button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────── */}
      <footer style={{ padding: "40px 24px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00C8E0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>SOSphere</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", lineHeight: 1.2 }}>{t.footer.tagline}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            {t.footer.links.map((l, i) => (
              <button key={i} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.25)", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
                onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.6)")}
                onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.25)")}>{l}</button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.15)" }}>{t.footer.copy}</div>
        </div>
      </footer>

      {/* Mobile responsive CSS */}
      <style>{`
        @media (max-width: 768px) {
          .hidden-mobile { display: none !important; }
        }
      `}</style>
    </div>
  );
}
