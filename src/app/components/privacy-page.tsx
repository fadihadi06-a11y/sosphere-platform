import { motion } from "motion/react";
import { useState } from "react";
import { ArrowLeft, Lock, Download } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router";
// BLOCKER #14 (2026-04-28): GDPR Art. 15 download button calls the
// `export-my-data` edge function via supabase.functions.invoke.
import { supabase } from "./api/supabase-client";
import { useLang } from "./useLang";
// P0-ci-cleanup wave 3 (2026-05-24): onBack made optional because PrivacyPage
// is used as a lazy route in src/app/routes.ts:38, which cannot pass props.
// When invoked without onBack (route mount), fall back to router history.
export function PrivacyPage({ onBack }: { onBack?: () => void }) {
  const navigate = useNavigate();
  const { isAr } = useLang();
  const handleBack = onBack ?? (() => navigate(-1));
  const S = { fontFamily: "'Tajawal','Outfit',sans-serif" };
  const headerTitle = isAr ? "سياسة الخصوصية" : "Privacy Policy";
  const banner = isAr
    ? "🔒 نأخذ خصوصيتك على محمل الجد. توضّح هذه السياسة كيف نجمع بياناتك ونستخدمها ونحميها."
    : "🔒 We take your privacy seriously. This policy explains how we collect, use and protect your data.";
  const footer = isAr
    ? "آخر تحديث: مارس ٢٠٢٦ — SOSphere Safety Platform"
    : "Last updated: March 2026 — SOSphere Safety Platform";
  const sections = isAr
    ? [
        { title: "١. البيانات التي نجمعها", body: "نجمع: بيانات الموقع GPS عند تفعيل الطوارئ، رقم الهاتف للتحقق والتواصل، بيانات الحوادث وسجلات الاتصال، ومعلومات الجهاز لتحسين الأداء." },
        { title: "٢. كيف نستخدم بياناتك", body: "نستخدم بياناتك حصراً لأغراض السلامة: تفعيل نظام الطوارئ، التواصل مع جهات الإنقاذ، تحسين دقة التتبع، وإرسال تنبيهات السلامة." },
        { title: "٣. مشاركة البيانات", body: "لا نبيع بياناتك لأي طرف. نشارك فقط مع Twilio لإرسال تنبيهات الطوارئ وSupabase لتخزين البيانات بأمان." },
        { title: "٤. حماية البيانات", body: "بياناتك مشفرة بمعايير أمان عالية. نستخدم Supabase مع سياسات وصول مقيدة RLS. بيانات الموقع تُحفظ محلياً وتُزامن عند الاتصال." },
        { title: "٥. مدة الاحتفاظ", body: "نحتفظ ببيانات الطوارئ 90 يوماً للمراجعة. بيانات الموقع الروتينية تُحذف بعد 30 يوماً. يمكنك طلب حذف بياناتك في أي وقت." },
        { title: "٦. حقوقك", body: "لديك الحق في الاطلاع على بياناتك وتصحيحها وحذفها والانسحاب من جمع بيانات الموقع مع الاحتفاظ بالوظائف الأساسية." },
        { title: "٧. التواصل معنا", body: "لأي استفسار حول خصوصيتك: sosphere.support@gmail.com" },
      ]
    : [
        { title: "1. Data We Collect", body: "We collect: GPS location data when an emergency is activated; your phone number for verification and contact; incident records and communication logs; and device information used to improve performance and reliability." },
        { title: "2. How We Use Your Data", body: "We use your data exclusively for safety purposes: activating the emergency system, coordinating with rescue and response parties, improving location accuracy, and delivering safety alerts. We do not use your data for advertising or profiling." },
        { title: "3. Data Sharing", body: "We do not sell your data to any party. We share data only with Twilio to deliver emergency alerts and with Supabase to store your data securely, in each case strictly to operate the service on our behalf and under contractual confidentiality and data-protection obligations." },
        { title: "4. Data Protection", body: "Your data is encrypted using strong security standards. We rely on Supabase with restrictive row-level security (RLS) access policies. Location data is stored locally on your device and synchronized when a connection is available." },
        { title: "5. Retention Period", body: "We retain emergency data for 90 days for review and audit purposes. Routine location data is deleted after 30 days. You may request deletion of your data at any time." },
        { title: "6. Your Rights", body: "You have the right to access, correct and delete your data, and to withdraw from routine location collection while retaining core safety functionality. To exercise these rights, contact us using the details below." },
        { title: "7. Contact Us", body: "For any question regarding your privacy: sosphere.support@gmail.com" },
      ];
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden" style={{ background: "#05070E", ...S }}>
      <div className="flex items-center gap-3 px-5 py-4" style={{ paddingTop: "max(20px,env(safe-area-inset-top))", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
        <button onClick={handleBack} style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ArrowLeft size={18} color="rgba(255,255,255,.6)" />
        </button>
        <Lock size={16} color="#00C8E0" />
        <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{headerTitle}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-6" style={{ direction: isAr ? "rtl" : "ltr" }}>
        <div className="mb-4 p-3" style={{ borderRadius: 12, background: "rgba(0,200,224,.06)", border: "1px solid rgba(0,200,224,.15)" }}>
          <p style={{ fontSize: 12, color: "rgba(0,200,224,.8)", lineHeight: 1.7 }}>{banner}</p>
        </div>
        {sections.map((s, i) => (
          <div key={i} className="mb-5">
            <p style={{ fontSize: 14, fontWeight: 700, color: "#00C8E0", marginBottom: 8 }}>{s.title}</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,.55)", lineHeight: 1.8 }}>{s.body}</p>
          </div>
        ))}
        {/* BLOCKER #14 (2026-04-28): GDPR Art. 15 — Download my data button.
            Available to ALL tiers (free + basic + elite) — GDPR rights are
            universal. Rate-limited server-side to 1 request per 30 days.
            Returns a JSON file containing every row across ~47 tables that
            holds personal data about the user, plus a SHA-256 integrity
            hash and category-grouped metadata. */}
        <CcpaSection />
        <DataExportSection />
        <p style={{ fontSize: 11, color: "rgba(255,255,255,.2)", textAlign: "center", marginTop: 24 }}>{footer}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// DataExportSection — GDPR Art. 15 Subject Access Request UI.
// Self-contained component so privacy-page.tsx stays readable. Calls the
// `export-my-data` edge function, which:
//   1. Validates JWT + applies 30-day rate limit
//   2. Walks ~47 tables and assembles a JSON payload
//   3. Computes SHA-256 over the data section for tamper-evidence
//   4. Records the request in sar_request_history + audit_log
// On success the JSON is offered as a downloadable file.
// On 429 (rate-limited) we show the next_allowed_at date so the user
// knows when they can request again.
// ─────────────────────────────────────────────────────────────────────
function DataExportSection() {
  const { isAr } = useLang();
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    if (loading) return;
    setLoading(true);
    const tid = toast.loading("جاري تحضير بياناتك...");
    try {
      const { data, error } = await supabase.functions.invoke("export-my-data", {
        body: {},
      });
      // The edge function returns 429 when rate-limited; supabase-js
      // surfaces this as `error` with the body in error.context.
      if (error) {
        // Try to extract the rate-limit details from the error context.
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx === "object" && "status" in ctx && (ctx as Response).status === 429) {
          try {
            const body = await (ctx as Response).json();
            const next = body?.next_allowed_at
              ? new Date(body.next_allowed_at).toLocaleDateString("ar-SA")
              : "لاحقاً";
            toast.error(`الطلب مقيّد — يمكنك المحاولة مرة أخرى في ${next}.`, { id: tid, duration: 6000 });
          } catch {
            toast.error("الطلب مقيّد — حاول مرة أخرى لاحقاً.", { id: tid });
          }
        } else {
          toast.error("تعذّر تحضير البيانات. حاول مرة أخرى.", { id: tid });
        }
        return;
      }
      if (!data) {
        toast.error("لم يتم استرداد أي بيانات.", { id: tid });
        return;
      }
      // Trigger browser download as a JSON blob.
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const dateStr = new Date().toISOString().split("T")[0];
      a.download = `sosphere-data-export-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("تم تنزيل بياناتك بنجاح.", { id: tid });
    } catch (err) {
      console.error("[privacy-page] download failed:", err);
      toast.error("حدث خطأ غير متوقّع.", { id: tid });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      data-testid="gdpr-data-export-section"
      className="mt-6 p-4"
      style={{
        borderRadius: 14,
        background: "rgba(0,200,224,0.04)",
        border: "1px solid rgba(0,200,224,0.18)",
      }}
    >
      <p style={{ fontSize: 13, fontWeight: 700, color: "#00C8E0", marginBottom: 6 }}>
        {isAr ? "٨. تنزيل بياناتك (GDPR — المادة ١٥)" : "8. Download Your Data (GDPR — Article 15)"}
      </p>
      <p style={{ fontSize: 12, color: "rgba(255,255,255,.6)", lineHeight: 1.7, marginBottom: 12 }}>
        {isAr
          ? "بإمكانك طلب نسخة كاملة من جميع البيانات الشخصية التي تحتفظ بها المنصة عنك (بصيغة JSON). الطلب متاح لكل المستخدمين بدون استثناء، ومحدود بطلب واحد كل ٣٠ يوماً."
          : "You may request a complete copy of all personal data the platform holds about you (in JSON format). This request is available to every user without exception and is limited to one request every 30 days."}
      </p>
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={handleDownload}
        disabled={loading}
        className="flex items-center justify-center gap-2 w-full py-3"
        style={{
          borderRadius: 10,
          background: loading ? "rgba(0,200,224,0.10)" : "rgba(0,200,224,0.18)",
          border: "1px solid rgba(0,200,224,0.30)",
          color: "#00C8E0",
          fontSize: 13,
          fontWeight: 700,
          cursor: loading ? "wait" : "pointer",
          opacity: loading ? 0.6 : 1,
        }}
      >
        <Download size={16} />
        {loading ? (isAr ? "جاري التحضير..." : "Preparing...") : isAr ? "تنزيل بياناتي" : "Download My Data"}
      </motion.button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Pre-launch Phase 4 (2026-04-29): CCPA / CPRA disclosure for the US
// market. Even though the product is launched primarily in MENA, the
// platform is technically reachable from California, so we publish
// the required CCPA disclosures to keep the launch defensible.
//
// Mapped CCPA categories per Cal. Civ. Code § 1798.140(v):
//   • Identifiers ........... phone number, account email
//   • Geolocation .......... GPS coordinates (SENSITIVE PI under CPRA)
//   • Internet activity .... device info, app telemetry
//   • Commercial info ...... subscription tier, purchase history
//   • Inferences ........... none used for profiling
//
// SOSphere does NOT sell or share PI for cross-context behavioural
// advertising — so we are NOT required to publish a "Do Not Sell or
// Share My Personal Information" link, but we still surface the fact
// affirmatively below so users in CA know.
// ─────────────────────────────────────────────────────────────────────
function CcpaSection() {
  const { isAr } = useLang();
  return (
    <div
      data-testid="ccpa-disclosure-section"
      className="mt-6 p-4"
      style={{
        borderRadius: 14,
        background: "rgba(255,200,0,0.03)",
        border: "1px solid rgba(255,200,0,0.18)",
      }}
    >
      <p style={{ fontSize: 13, fontWeight: 700, color: "#FFC800", marginBottom: 8 }}>
        {isAr ? "٩. سكان كاليفورنيا — CCPA / CPRA Notice" : "9. California Residents — CCPA / CPRA Notice"}
      </p>
      <p style={{ fontSize: 12, color: "rgba(255,255,255,.65)", lineHeight: 1.8, marginBottom: 10 }}>
        {isAr
          ? "إذا كنت من سكان ولاية كاليفورنيا، تنطبق عليك الحقوق التالية بموجب قانون خصوصية المستهلك (CCPA / CPRA):"
          : "If you are a California resident, the following rights apply to you under the California Consumer Privacy Act (CCPA / CPRA):"}
      </p>
      <ul
        style={{
          fontSize: 12,
          color: "rgba(255,255,255,.55)",
          lineHeight: 1.9,
          paddingInlineStart: 18,
          marginBottom: 12,
        }}
      >
        {(isAr
          ? [
              "الحق في معرفة فئات البيانات الشخصية التي نجمعها (المعرّفات، الموقع GPS، نشاط التطبيق، بيانات الاشتراك)",
              "الحق في طلب نسخة كاملة من بياناتك (Right to Know — مغطّى بزر «تنزيل بياناتي» أعلاه)",
              "الحق في حذف بياناتك (Right to Delete — متاح من إعدادات الحساب)",
              "الحق في تصحيح أي بيانات غير دقيقة (Right to Correct)",
              "الحق في تقييد استخدام بياناتك الحساسة كالموقع GPS (Right to Limit Use of Sensitive PI)",
              "الحق في عدم التعرّض للتمييز عند ممارسة هذه الحقوق (Right to Non-Discrimination)",
              "الحق في رفض البيع أو المشاركة (Right to Opt-Out)",
            ]
          : [
              "The right to know which categories of personal information we collect (identifiers, GPS location, app activity, subscription data).",
              "The right to request a full copy of your data (Right to Know — covered by the “Download My Data” button above).",
              "The right to delete your data (Right to Delete — available from Account Settings).",
              "The right to correct any inaccurate data (Right to Correct).",
              "The right to limit the use of your sensitive personal information, such as GPS location (Right to Limit Use of Sensitive PI).",
              "The right not to be discriminated against for exercising these rights (Right to Non-Discrimination).",
              "The right to opt out of the sale or sharing of your data (Right to Opt-Out).",
            ]
        ).map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
      <div
        style={{
          fontSize: 12,
          color: "#7CFFB4",
          background: "rgba(0,255,128,0.05)",
          border: "1px solid rgba(0,255,128,0.18)",
          borderRadius: 10,
          padding: "10px 12px",
          marginBottom: 10,
          lineHeight: 1.7,
        }}
      >
        ✅ <strong>{isAr ? "نحن لا نبيع بياناتك الشخصية ولا نشاركها" : "We do not sell or share your personal information"}</strong>{" "}
        {isAr
          ? "لأغراض الإعلانات السلوكية عبر السياقات أو لأي غرض تجاري آخر."
          : "for cross-context behavioural advertising or any other commercial purpose."}
      </div>
      <p style={{ fontSize: 11, color: "rgba(255,255,255,.45)", lineHeight: 1.7 }}>
        {isAr ? "لممارسة أي من حقوقك أعلاه أو لتقديم طلب CCPA رسمي، راسلنا على " : "To exercise any of the rights above or to submit a formal CCPA request, contact us at "}
        <span style={{ color: "#FFC800" }}>sosphere.support@gmail.com</span>
        {isAr
          ? " مع ذكر «CCPA Request» في عنوان الرسالة. نستجيب خلال ٤٥ يوماً كحدٍّ أقصى وفقاً للقانون."
          : " with “CCPA Request” in the subject line. We respond within a maximum of 45 days as required by law."}
      </p>
    </div>
  );
}
