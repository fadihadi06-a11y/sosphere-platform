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
                <p style={{ color: "#00C8E0", fontSize: 11, fontWeight: 700 }}>{isAr ? "شروط استخدام SOSphere — v1.0" : "SOSPHERE TERMS OF SERVICE — v1.0 (PROTOTYPE)"}</p>
                <p>{isAr ? "هذا تطبيق نموذجي للأغراض التجريبية. باستخدامك SOSphere، أنت تقر بما يلي:" : <>This is a <span style={{ color: "#FF9500", fontWeight: 600 }}>prototype application</span> for demonstration purposes. By using SOSphere, you acknowledge:</>}</p>
                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "١. ليس بديلاً عن خدمات الطوارئ." : "1. Not a replacement for emergency services."}</span> {isAr ? "SOSphere لا يحل محل الاتصال بالإسعاف أو الشرطة. اتصل دائماً بخدمات الطوارئ أولاً في الحالات الخطيرة." : "SOSphere does not replace calling 911, 999, 112, or your local emergency number. Always call emergency services first in a life-threatening situation."}</p>
                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "٢. قيود النموذج." : "2. Prototype limitations."}</span> {isAr ? "يستخدم هذا النموذج بيانات محاكاة وتخزيناً محلياً. لا تُرسل بيانات لخوادم خارجية." : "This prototype uses simulated data and local storage. No data is transmitted to external servers."}</p>
                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "٣. جمع البيانات." : "3. Data collection."}</span> {isAr ? "نجمع: موقع GPS (خلال الطوارئ)، معلومات طبية (إذا قُدِّمت)، جهات اتصال طوارئ، وتفاصيل الحساب. في هذا النموذج، جميع البيانات محفوظة محلياً على جهازك فقط." : "We collect: GPS location (during emergencies), medical information (if provided), emergency contacts, and account details. In this prototype, all data is stored locally on your device only."}</p>
                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "٤. لا مسؤولية." : "4. No liability."}</span> {isAr ? "SOSphere ومنشئوها لا يتحملون أي مسؤولية عن أي ضرر ناجم عن الاعتماد على هذا النموذج." : "SOSphere and its creators accept no liability for any harm arising from reliance on this prototype."}</p>
                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "٥. الاحتفاظ بالبيانات." : "5. Data retention."}</span> {isAr ? "جميع البيانات مخزنة في التخزين المحلي للمتصفح ويمكن مسحها في أي وقت." : "All data is stored in your browser's local storage and can be cleared at any time by clearing browser data."}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <p style={{ color: "#00C8E0", fontSize: 11, fontWeight: 700 }}>{isAr ? "سياسة خصوصية SOSphere — v1.0" : "SOSPHERE PRIVACY POLICY — v1.0 (PROTOTYPE)"}</p>
                <p>{isAr ? "خصوصيتك مهمة. إليك كيفية تعامل SOSphere مع بياناتك:" : "Your privacy matters. Here is how SOSphere handles your data:"}</p>
                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "بيانات الموقع:" : "Location Data:"}</span> {isAr ? "تُجمع إحداثيات GPS فقط خلال حالات الطوارئ النشطة وجلسات تسجيل الحضور والمشي الآمن." : "GPS coordinates are collected only during active emergencies, check-in timers, and safe-walk sessions."}</p>
                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "المعلومات الطبية:" : "Medical Information:"}</span> {isAr ? "تُحفظ فصيلة الدم والحساسية والأدوية محلياً. تُشارك مع المسعفين فقط خلال أحداث SOS النشطة." : "Blood type, allergies, medications, and emergency medical contacts are stored locally. This data is shared with emergency responders only during active SOS events."}</p>
                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "جهات اتصال الطوارئ:" : "Emergency Contacts:"}</span> {isAr ? "تُحفظ الأسماء والأرقام محلياً وتُستخدم فقط لإشعارات الطوارئ." : "Contact names and phone numbers are stored locally and used only for emergency notifications."}</p>
                <p><span style={{ fontWeight: 700, color: "white" }}>{isAr ? "أطراف ثالثة:" : "Third Parties:"}</span> {isAr ? "لا تُشارك أي بيانات مع أطراف ثالثة في هذا النموذج." : "No data is shared with third parties in this prototype."}</p>
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
