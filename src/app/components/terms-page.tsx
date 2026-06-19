import { motion } from "motion/react";
import { ArrowLeft, Shield } from "lucide-react";
import { useNavigate } from "react-router";
import { useLang } from "./useLang";
// P0-ci-cleanup wave 3 (2026-05-24): onBack made optional because TermsPage
// is used as a lazy route in src/app/routes.ts:39, which cannot pass props.
// When invoked without onBack (route mount), fall back to router history.
export function TermsPage({ onBack }: { onBack?: () => void }) {
  const navigate = useNavigate();
  const { isAr } = useLang();
  const handleBack = onBack ?? (() => navigate(-1));
  const S = { fontFamily: "'Tajawal','Outfit',sans-serif" };
  const sections = isAr
    ? [
        { title: "١. القبول بالشروط", body: "باستخدامك لتطبيق SOSphere فإنك توافق على الالتزام بهذه الشروط. إذا كنت لا توافق يرجى عدم استخدام التطبيق." },
        { title: "٢. وصف الخدمة", body: "SOSphere تطبيق لسلامة العمال الميدانيين في مرحلة تجريبية. لا يُعتمد عليه كبديل عن خدمات الطوارئ الرسمية (911/122/112)." },
        { title: "٣. مسؤولية المستخدم", body: "أنت مسؤول عن دقة المعلومات التي تدخلها. يجب الاحتفاظ بمعلومات حسابك سرية وعدم مشاركتها." },
        { title: "٤. حدود المسؤولية", body: "في مرحلة التجربة لا يتحمل فريق SOSphere أي مسؤولية عن أضرار ناجمة عن الاستخدام. لا يُعد التطبيق بديلاً عن الطوارئ الرسمية." },
        { title: "٥. البيانات والخصوصية", body: "نجمع بيانات الموقع وبيانات الطوارئ لأغراض السلامة فقط. راجع سياسة الخصوصية للتفاصيل." },
        { title: "٦. التعديلات", body: "نحتفظ بالحق في تعديل هذه الشروط في أي وقت مع إخطار المستخدمين بالتغييرات الجوهرية." },
        { title: "٧. القانون المطبق", body: "تخضع هذه الشروط للقوانين المعمول بها في منطقة تشغيل الخدمة." },
      ]
    : [
        { title: "1. Acceptance of Terms", body: "By using the SOSphere app you agree to be bound by these Terms. If you do not agree, please do not use the app." },
        { title: "2. Description of Service", body: "SOSphere is a field-worker safety app in a trial phase. It must not be relied upon as a substitute for official emergency services (911/122/112)." },
        { title: "3. User Responsibility", body: "You are responsible for the accuracy of the information you enter. Keep your account credentials confidential and do not share them." },
        { title: "4. Limitation of Liability", body: "During the trial phase, the SOSphere team bears no liability for any damages arising from use. The app is not a substitute for official emergency services." },
        { title: "5. Data and Privacy", body: "We collect location and emergency data solely for safety purposes. See the Privacy Policy for details." },
        { title: "6. Modifications", body: "We reserve the right to modify these Terms at any time, giving users notice of any material changes." },
        { title: "7. Governing Law", body: "These Terms are governed by the laws applicable in the service's region of operation." },
      ];
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden" style={{ background: "#05070E", ...S }}>
      <div className="flex items-center gap-3 px-5 py-4" style={{ paddingTop: "max(20px,env(safe-area-inset-top))", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
        <button onClick={handleBack} style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ArrowLeft size={18} color="rgba(255,255,255,.6)" />
        </button>
        <Shield size={16} color="#00C8E0" />
        <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{isAr ? "شروط الاستخدام" : "Terms of Use"}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-6" style={{ direction: isAr ? "rtl" : "ltr" }}>
        <div className="mb-4 p-3" style={{ borderRadius: 12, background: "rgba(255,150,0,.08)", border: "1px solid rgba(255,150,0,.2)" }}>
          <p style={{ fontSize: 12, color: "rgba(255,150,0,.9)", lineHeight: 1.7 }}>{isAr ? "⚠️ هذا التطبيق في مرحلة تجريبية. البيانات المستخدمة حالياً للاختبار فقط." : "⚠️ This app is in a trial phase. Data currently used is for testing only."}</p>
        </div>
        {sections.map((s, i) => (
          <div key={i} className="mb-5">
            <p style={{ fontSize: 14, fontWeight: 700, color: "#00C8E0", marginBottom: 8 }}>{s.title}</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,.55)", lineHeight: 1.8 }}>{s.body}</p>
          </div>
        ))}
        <p style={{ fontSize: 11, color: "rgba(255,255,255,.2)", textAlign: "center", marginTop: 24 }}>{isAr ? "آخر تحديث: مارس ٢٠٢٦ — SOSphere Safety Platform" : "Last updated: March 2026 — SOSphere Safety Platform"}</p>
      </div>
    </div>
  );
}
