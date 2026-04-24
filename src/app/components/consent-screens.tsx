// SOSphere — Consent Screens (Bilingual AR/EN)
import { useState } from "react";
import { motion } from "motion/react";
import { Shield, MapPin, FileText, Lock, Eye, CheckCircle, AlertTriangle, ChevronRight, ExternalLink } from "lucide-react";
import { useLang } from "./useLang";

const TOS_CONSENT_KEY = "sosphere_tos_consent";
const GPS_CONSENT_KEY = "sosphere_gps_consent";

// AUDIT-FIX (2026-04-18): legacy key from a previous version that
// used a different naming convention. Live audit on vercel.app
// found a real user with `sosphere_terms_consent: true` and no
// `sosphere_tos_consent` — the upgrade had silently dropped their
// consent. We read both keys (preferring the new one) and migrate
// transparently on first read.
const LEGACY_TOS_CONSENT_KEY = "sosphere_terms_consent";

export interface TosConsent { accepted: boolean; timestamp: number; version: string; }
export interface GpsConsent { allowed: boolean; timestamp: number; declinedWarningShown: boolean; }

export function getTosConsent(): TosConsent | null {
  try {
    // 1. Prefer the canonical (current) key.
    const raw = localStorage.getItem(TOS_CONSENT_KEY);
    if (raw) return JSON.parse(raw) as TosConsent;
    // 2. Fall back to the legacy key. If found, migrate forward
    //    (write under the new key, remove the old one) so the
    //    next read is fast and the old key doesn't linger.
    //
    // Handles three known legacy storage shapes:
    //   • Full object  → {accepted, timestamp, version}
    //   • Bare boolean → JSON `true` (parses as boolean, not object)
    //   • Bare string  → "true" (not valid JSON, hits the catch)
    const legacy = localStorage.getItem(LEGACY_TOS_CONSENT_KEY);
    if (legacy) {
      let parsed: TosConsent;
      try {
        const raw = JSON.parse(legacy);
        if (raw && typeof raw === "object" && "accepted" in raw) {
          parsed = raw as TosConsent;
        } else {
          // Bare boolean (true) or other primitive → treat truthy as accepted.
          parsed = {
            accepted: raw === true || raw === "true",
            timestamp: 0,
            version: "legacy",
          };
        }
      } catch {
        // Not even valid JSON — bare unquoted "true" or similar.
        parsed = { accepted: legacy === "true", timestamp: 0, version: "legacy" };
      }
      if (parsed?.accepted) {
        try {
          localStorage.setItem(TOS_CONSENT_KEY, JSON.stringify(parsed));
          localStorage.removeItem(LEGACY_TOS_CONSENT_KEY);
        } catch { /* best effort migration */ }
      }
      return parsed;
    }
    return null;
  } catch { return null; }
}
export function getGpsConsent(): GpsConsent | null {
  try { const raw = localStorage.getItem(GPS_CONSENT_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function hasCompletedConsent(): boolean { const c = getTosConsent(); return c?.accepted === true; }
export function hasCompletedGpsConsent(): boolean { const c = getGpsConsent(); return c !== null; }

// ── Terms Consent Screen ──────────────────────────────────────
interface TermsConsentScreenProps { onAccept: () => void; }

export function TermsConsentScreen({ onAccept }: TermsConsentScreenProps) {
  const { isAr } = useLang();
  const [checked, setChecked] = useState(false);
  const [showTos, setShowTos] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  const S = { fontFamily: isAr ? "'Tajawal','Outfit',sans-serif" : "'Outfit',sans-serif" };

  const DATA_ITEMS = [
    { icon: MapPin,    label: isAr ? "بيانات الموقع"        : "Location Data",        desc: isAr ? "إحداثيات GPS خلال حالات الطوارئ وتسجيل الحضور لتوجيه المساعدة"                         : "GPS coordinates during emergencies and check-ins to send help to the right place", color: "#00C8E0" },
    { icon: Shield,    label: isAr ? "المعلومات الطبية"     : "Medical Information",   desc: isAr ? "فصيلة الدم والحساسية والأدوية — تُشارك مع المسعفين فقط"                              : "Blood type, allergies, and medications — shared with emergency responders only",    color: "#FF2D55" },
    { icon: FileText,  label: isAr ? "جهات اتصال الطوارئ"  : "Emergency Contacts",    desc: isAr ? "أسماء وأرقام هواتف الأشخاص الذين سيُبلَّغون خلال الطوارئ"                             : "Names and phone numbers of people to notify during an emergency",                  color: "#FF9500" },
    { icon: Lock,      label: isAr ? "تفاصيل الحساب"        : "Account Details",       desc: isAr ? "الاسم ورقم الهاتف والشركة لأغراض التحقق من الهوية"                                   : "Name, phone number, and company affiliation for identity verification",             color: "#7B5EFF" },
  ];

  const handleAccept = () => {
    if (!checked) return;
    try { localStorage.setItem(TOS_CONSENT_KEY, JSON.stringify({ accepted: true, timestamp: Date.now(), version: "1.0" })); } catch {}
    onAccept();
  };

  if (showTos || showPrivacy) {
    return (
      <div className="absolute inset-0 flex flex-col overflow-hidden" style={{ background: "#05070E", direction: isAr ? "rtl" : "ltr", ...S }}>
        <div className="flex items-center gap-3 px-5 pt-14 pb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <button onClick={() => { setShowTos(false); setShowPrivacy(false); }} style={{ color: "#00C8E0", fontSize: 13, fontWeight: 600 }}>
            {isAr ? "→ رجوع" : "← Back"}
          </button>
          <span style={{ color: "white", fontSize: 15, fontWeight: 700 }}>
            {showTos ? (isAr ? "شروط الاستخدام" : "Terms of Service") : (isAr ? "سياسة الخصوصية" : "Privacy Policy")}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-6">
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, lineHeight: 1.8 }}>
            {showTos ? (
              <div className="flex flex-col gap-4">
                <p style={{ color: "#00C8E0", fontSize: 11, fontWeight: 700 }}>{isAr ? "شروط استخدام SOSphere — v2.0" : "SOSPHERE TERMS OF SERVICE — v2.0"}</p>
                <p>{isAr ? "باستخدامك SOSphere، أنت تقر بما يلي:" : "By using SOSphere, you acknowledge:"}</p>
                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "١. ليس بديلاً عن خدمات الطوارئ." : "1. Not a replacement for emergency services."}</span> {isAr ? "SOSphere لا يحل محل الاتصال بالإسعاف أو الشرطة. اتصل دائماً بخدمات الطوارئ الرسمية (911 / 999 / 112) في الحالات الخطيرة." : "SOSphere does not replace calling 911, 999, 112, or your local emergency number. Always call official emergency services in a life-threatening situation."}</p>
                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "٢. معالجة البيانات عبر الإنترنت." : "2. Cloud data processing."}</span> {isAr ? "بياناتك تُخزَّن وتُعالَج على خوادم سحابية (Supabase) لتأمين نسخة احتياطية ومزامنة بين الأجهزة وتشغيل لوحة تحكم الشركات. خلال حالة SOS يُرسل الرسائل/المكالمات عبر مزوّد الاتصالات Twilio." : "Your data is stored and processed on cloud servers (Supabase) to provide durable backup, cross-device sync, and company dashboard operations. During SOS events, SMS and voice calls are delivered through the Twilio communications provider."}</p>
                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "٣. ما نجمعه." : "3. What we collect."}</span> {isAr ? "موقع GPS (أثناء الطوارئ والتشغيل الموافق عليه)، معلومات طبية تدخلها أنت، جهات اتصال طوارئ، وسجلات حوادث SOS (مكالمات، رسائل، صوت، صور) للأغراض القانونية والتوثيق." : "GPS location (during emergencies and opted-in tracking), medical information you enter, emergency contacts, and SOS incident records (calls, SMS, audio, photos) for legal/audit documentation."}</p>
                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "٤. المدفوعات." : "4. Payments."}</span> {isAr ? "إذا اشتركت في باقة مدفوعة، يعالج Stripe معلومات الدفع. لا نخزّن أرقام بطاقات الدفع على خوادمنا." : "If you subscribe to a paid plan, payment details are processed by Stripe. We never store card numbers on our servers."}</p>
                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "٥. تقارير الأعطال." : "5. Crash / error reporting."}</span> {isAr ? "نستخدم Sentry لاستقبال تقارير الأعطال. قد تشمل هذه التقارير معرّف حسابك وبريدك الإلكتروني." : "We use Sentry for crash and error reporting. Reports may include your user ID and email."}</p>
                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "٦. حقوقك." : "6. Your rights."}</span> {isAr ? "تستطيع حذف حسابك من قائمة الإعدادات، وتصدير بياناتك (\"تحميل بياناتي\"). تذكّر: قد لا تختفي سجلات SOS التي سبق وشُورِكت مع جهات الاتصال أو الشرطة بمجرد إرسالها." : "You can delete your account from Settings and export your data (\"Download My Data\"). Note: SOS records already shared with your contacts or with police/emergency services may persist with those recipients after your account is deleted."}</p>
                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "٧. إخلاء مسؤولية." : "7. No warranty."}</span> {isAr ? "نسعى لأعلى مستوى من الموثوقية لكن المنصة تُقدَّم \"كما هي\". قد تحدث أعطال شبكة أو فشل مزودي خدمة (Twilio/Supabase) خارج سيطرتنا." : "We strive for maximum reliability but the platform is provided \"as-is\". Network failures or third-party outages (Twilio, Supabase) are outside our direct control."}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <p style={{ color: "#00C8E0", fontSize: 11, fontWeight: 700 }}>{isAr ? "سياسة خصوصية SOSphere — v2.0" : "SOSPHERE PRIVACY POLICY — v2.0"}</p>
                <p>{isAr ? "خصوصيتك مهمة. إليك كيفية تعامل SOSphere مع بياناتك بصراحة تامة:" : "Your privacy matters. Here is how SOSphere handles your data, stated honestly:"}</p>

                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "أين تُخزَّن بياناتك:" : "Where your data is stored:"}</span> {isAr ? "خوادمنا عند Supabase في منطقة ap-south-1 (مومباي، الهند). لو كنت من الاتحاد الأوروبي أو المملكة العربية السعودية، فإن نقل البيانات خارج بلدك يخضع لضوابط قانونية سنوفر اتفاقيات الحماية القياسية (SCCs) عند الطلب." : "Our servers are hosted on Supabase in the ap-south-1 region (Mumbai, India). If you are in the EU or Saudi Arabia, cross-border data transfer is subject to additional safeguards; we can provide Standard Contractual Clauses (SCCs) on request."}</p>

                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "بيانات الموقع (GPS):" : "GPS Location:"}</span> {isAr ? "تُجمع فقط أثناء حوادث SOS النشطة أو مؤقتات تسجيل الحضور أو جلسات المشي الآمن. تُخزَّن على خوادمنا وتُعرض للديسباتشر (لو كنت موظفا) أو لجهات اتصالك (لو كنت مدنيا)." : "Collected only during active SOS events, check-in timers, or safe-walk sessions. Stored on our servers and visible to your dispatcher (employees) or your emergency contacts (civilians)."}</p>

                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "المعلومات الطبية:" : "Medical Information:"}</span> {isAr ? "فصيلة الدم، الحساسية، الأدوية — تُحفَظ في حساب المستخدم على خوادمنا. أثناء SOS، تُدرَج في الرسائل النصية التي تُرسَل لجهات اتصالك (عبر Twilio) ما لم تُعطِّل خيار \"المعلومات الطبية\" في شاشة \"حزمة الطوارئ\"." : "Blood type, allergies, medications — stored in your account on our servers. During SOS, they are included in the SMS sent to your emergency contacts via Twilio unless you turn OFF the 'Medical' toggle in the Emergency Packet screen."}</p>

                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "جهات اتصال الطوارئ:" : "Emergency Contacts:"}</span> {isAr ? "أسماء وأرقام تُرسَل إلى Twilio عند ضغط SOS للسماح بالاتصال/الرسائل. تبقى على خوادمنا لإعادة استخدامها في الحوادث القادمة." : "Names and phone numbers are sent to Twilio at the moment of SOS to allow outbound calls and SMS. They remain on our servers for reuse in future incidents."}</p>

                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "أدلة الحوادث (صوت وصور):" : "Incident Evidence (audio & photos):"}</span> {isAr ? "الصوت والصور المُلتقطة أثناء SOS تُرفَع إلى وحدة التخزين الآمنة لدينا. لوحة تحكم شركتك (إن وُجدت) تستطيع مراجعتها لأغراض التحقيق." : "Audio and photos captured during SOS are uploaded to our secure storage. Your company dashboard (if you are an employee) can review them for investigation purposes."}</p>

                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "أطراف ثالثة:" : "Third Parties:"}</span> {isAr ? "نستخدم Twilio (رسائل ومكالمات)، Stripe (الدفع، إن اشتركت)، Sentry (تقارير الأعطال). لا نبيع ولا نشارك بياناتك مع معلنين." : "We use Twilio (SMS + voice), Stripe (payments, if you subscribe), Sentry (crash reports). We do not sell or share your data with advertisers."}</p>

                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "حقوقك:" : "Your rights:"}</span> {isAr ? "يمكنك في أي وقت: (أ) تصدير بياناتك (تحميل JSON من الإعدادات)، (ب) حذف حسابك، (ج) تعطيل مشاركة أجزاء من حزمة الطوارئ. بعد الحذف، النسخ التي استلمتها جهات اتصالك قد تبقى بحوزتهم." : "You can at any time: (a) export your data (download JSON from Settings), (b) delete your account, (c) disable specific Emergency Packet toggles. After deletion, copies already received by your contacts may remain in their possession."}</p>

                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "بيانات الأطفال:" : "Children's data:"}</span> {isAr ? "SOSphere غير مُصمَّم للأطفال دون سن 13 عاما. لو اكتشفنا أن حسابا يخص طفلا تحت هذا السن، سنحذفه." : "SOSphere is not designed for children under 13. If we discover an account belongs to a child under this age, we will delete it."}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden" style={{ background: "#05070E", direction: isAr ? "rtl" : "ltr", ...S }}>
      <div className="flex flex-col items-center pt-16 pb-4 px-6">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.1, duration: 0.4 }}
          className="size-16 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,200,224,0.05))", border: "1px solid rgba(0,200,224,0.2)" }}>
          <FileText size={28} color="#00C8E0" />
        </motion.div>
        <motion.h1 initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}
          style={{ fontSize: 22, fontWeight: 800, color: "white", textAlign: "center" }}>
          {isAr ? "قبل المتابعة" : "Before You Continue"}
        </motion.h1>
        <motion.p initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}
          style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", textAlign: "center", marginTop: 6, lineHeight: 1.5 }}>
          {isAr ? "SOSphere يجمع بعض البيانات لحماية سلامتك. يرجى مراجعة ما نجمعه ولماذا." : "SOSphere collects certain data to protect your safety. Please review what we collect and why."}
        </motion.p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <div className="flex flex-col gap-2.5 mt-2">
          {DATA_ITEMS.map((item, i) => (
            <motion.div key={item.label} initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.3 + i * 0.08 }}
              className="flex items-start gap-3 p-3 rounded-xl"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <div className="size-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: `${item.color}15`, border: `1px solid ${item.color}25` }}>
                <item.icon size={16} color={item.color} />
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 13, fontWeight: 700, color: "white" }}>{item.label}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.4, marginTop: 2 }}>{item.desc}</div>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65 }} className="flex gap-2 mt-4">
          <button onClick={() => setShowTos(true)} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl"
            style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>
            <ExternalLink size={12} color="#00C8E0" />
            <span style={{ fontSize: 11, color: "#00C8E0", fontWeight: 600 }}>{isAr ? "شروط الاستخدام" : "Terms of Service"}</span>
          </button>
          <button onClick={() => setShowPrivacy(true)} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl"
            style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>
            <Eye size={12} color="#00C8E0" />
            <span style={{ fontSize: 11, color: "#00C8E0", fontWeight: 600 }}>{isAr ? "سياسة الخصوصية" : "Privacy Policy"}</span>
          </button>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.75 }} className="mt-5">
          <button onClick={() => setChecked(!checked)} className="flex items-start gap-3 w-full text-left p-3 rounded-xl transition-all"
            style={{ background: checked ? "rgba(0,200,224,0.06)" : "rgba(255,255,255,0.02)", border: checked ? "1px solid rgba(0,200,224,0.2)" : "1px solid rgba(255,255,255,0.06)" }}>
            <div className="size-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 transition-all"
              style={{ background: checked ? "#00C8E0" : "transparent", border: checked ? "none" : "2px solid rgba(255,255,255,0.2)" }}>
              {checked && <CheckCircle size={14} color="#000" strokeWidth={3} />}
            </div>
            <span style={{ fontSize: 12, color: checked ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
              {isAr
                ? <>لقد قرأت وأوافق على <span style={{ color: "#00C8E0", fontWeight: 600 }}>شروط الاستخدام</span> و<span style={{ color: "#00C8E0", fontWeight: 600 }}>سياسة الخصوصية</span>. أفهم كيف ستُجمع بياناتي وتُستخدم.</>
                : <>I have read and agree to the <span style={{ color: "#00C8E0", fontWeight: 600 }}>Terms of Service</span> and <span style={{ color: "#00C8E0", fontWeight: 600 }}>Privacy Policy</span>. I understand how my data will be collected and used.</>}
            </span>
          </button>
        </motion.div>
      </div>

      <div className="px-5 pb-8 pt-3">
        <motion.button initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.85 }}
          onClick={handleAccept} disabled={!checked}
          className="w-full py-3.5 rounded-2xl flex items-center justify-center gap-2 transition-all"
          style={{ background: checked ? "linear-gradient(135deg, #00C8E0, #0088A0)" : "rgba(255,255,255,0.05)", opacity: checked ? 1 : 0.4, cursor: checked ? "pointer" : "not-allowed" }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: checked ? "#fff" : "rgba(255,255,255,0.3)" }}>
            {isAr ? "متابعة" : "Continue"}
          </span>
          <ChevronRight size={18} color={checked ? "#fff" : "rgba(255,255,255,0.3)"} />
        </motion.button>
      </div>
    </div>
  );
}

// ── GPS Consent Screen ────────────────────────────────────────
interface GpsConsentScreenProps { onComplete: (allowed: boolean) => void; }

export function GpsConsentScreen({ onComplete }: GpsConsentScreenProps) {
  const { isAr } = useLang();
  const [showDeclinedWarning, setShowDeclinedWarning] = useState(false);
  const S = { fontFamily: isAr ? "'Tajawal','Outfit',sans-serif" : "'Outfit',sans-serif" };

  const handleAllow = () => {
    try { localStorage.setItem(GPS_CONSENT_KEY, JSON.stringify({ allowed: true, timestamp: Date.now(), declinedWarningShown: false })); } catch {}
    onComplete(true);
  };
  const handleDecline = () => {
    if (!showDeclinedWarning) { setShowDeclinedWarning(true); return; }
    try { localStorage.setItem(GPS_CONSENT_KEY, JSON.stringify({ allowed: false, timestamp: Date.now(), declinedWarningShown: true })); } catch {}
    onComplete(false);
  };

  const GPS_FEATURES = [
    { icon: Shield,        text: isAr ? "يحدد موقعك بدقة خلال SOS"       : "Pinpoints your exact location during SOS",    sub: isAr ? "يصل المنقذون أسرع"                 : "Rescuers find you faster" },
    { icon: MapPin,        text: isAr ? "يتحقق أنك في منطقتك المخصصة"    : "Verifies you're in your assigned zone",         sub: isAr ? "الامتثال لتسجيل الحضور والسلامة"  : "Check-in compliance & safety" },
    { icon: AlertTriangle, text: isAr ? "ينبّه جهات الاتصال عند مغادرتك" : "Alerts contacts if you leave safe areas",      sub: isAr ? "حماية الحدود الجغرافية"            : "Geofence protection" },
  ];

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden" style={{ background: "#05070E", direction: isAr ? "rtl" : "ltr", ...S }}>
      <div className="flex flex-col items-center pt-20 pb-6 px-6">
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", damping: 15, stiffness: 200 }}
          className="relative size-24 rounded-full flex items-center justify-center mb-6"
          style={{ background: "rgba(0,200,224,0.08)", border: "1.5px solid rgba(0,200,224,0.15)" }}>
          <motion.div animate={{ scale: [1, 1.4, 1], opacity: [0.3, 0, 0.3] }} transition={{ duration: 2, repeat: Infinity }}
            className="absolute inset-0 rounded-full" style={{ border: "1px solid rgba(0,200,224,0.2)" }} />
          <motion.div animate={{ scale: [1, 1.7, 1], opacity: [0.15, 0, 0.15] }} transition={{ duration: 2, repeat: Infinity, delay: 0.3 }}
            className="absolute inset-0 rounded-full" style={{ border: "1px solid rgba(0,200,224,0.1)" }} />
          <MapPin size={36} color="#00C8E0" />
        </motion.div>
        <motion.h1 initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}
          style={{ fontSize: 24, fontWeight: 800, color: "white", textAlign: "center" }}>
          {isAr ? "الوصول للموقع" : "Location Access"}
        </motion.h1>
        <motion.p initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}
          style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", textAlign: "center", marginTop: 8, lineHeight: 1.6, maxWidth: 300 }}>
          {isAr ? "SOSphere يحتاج موقعك لإرسال المساعدة إلى المكان الصحيح خلال الطوارئ." : "SOSphere needs your location to send help to the right place during emergencies."}
        </motion.p>
      </div>

      <div className="flex-1 px-6">
        <div className="flex flex-col gap-3">
          {GPS_FEATURES.map((item, i) => (
            <motion.div key={i} initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.4 + i * 0.1 }}
              className="flex items-start gap-3 p-3.5 rounded-xl"
              style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.08)" }}>
              <div className="size-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(0,200,224,0.1)" }}>
                <item.icon size={16} color="#00C8E0" />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "white" }}>{item.text}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{item.sub}</div>
              </div>
            </motion.div>
          ))}
        </div>

        {showDeclinedWarning && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 p-3 rounded-xl"
            style={{ background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.2)" }}>
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} color="#FF9500" className="mt-0.5 flex-shrink-0" />
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#FF9500" }}>
                  {isAr ? "دقة SOS ستكون محدودة" : "SOS accuracy will be limited"}
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 2, lineHeight: 1.4 }}>
                  {isAr ? "بدون الوصول للموقع، لن يعرف المسعفون أين أنت. يمكنك تفعيل هذا لاحقاً من الإعدادات." : "Without location access, emergency responders won't know where you are. You can enable this later in Settings."}
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
                  {isAr ? "اضغط مجدداً للتأكيد." : "Tap again to confirm."}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      <div className="px-6 pb-8 pt-4 flex flex-col gap-2.5">
        <motion.button initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.7 }}
          onClick={handleAllow} className="w-full py-3.5 rounded-2xl flex items-center justify-center gap-2"
          style={{ background: "linear-gradient(135deg, #00C8E0, #0088A0)" }}>
          <MapPin size={18} color="#fff" />
          <span style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>
            {isAr ? "السماح بالموقع" : "Allow Location"}
          </span>
        </motion.button>
        <motion.button initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.8 }}
          onClick={handleDecline} className="w-full py-3 rounded-2xl flex items-center justify-center"
          style={{ background: showDeclinedWarning ? "rgba(255,150,0,0.08)" : "rgba(255,255,255,0.04)", border: showDeclinedWarning ? "1px solid rgba(255,150,0,0.2)" : "1px solid rgba(255,255,255,0.06)" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: showDeclinedWarning ? "#FF9500" : "rgba(255,255,255,0.4)" }}>
            {showDeclinedWarning
              ? (isAr ? "تأكيد — تخطي الموقع" : "Confirm — Skip Location")
              : (isAr ? "ليس الآن" : "Not Now")}
          </span>
        </motion.button>
      </div>
    </div>
  );
}
