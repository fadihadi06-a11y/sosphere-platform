import { motion } from "motion/react";
import { ArrowLeft, Shield } from "lucide-react";
export function TermsPage({ onBack }: { onBack: () => void }) {
  const S = { fontFamily: "'Tajawal','Outfit',sans-serif" };
  const sections = [
    { title: "١. القبول بالشروط", body: "باستخدامك لتطبيق SOSphere فإنك توافق على الالتزام بهذه الشروط. إذا كنت لا توافق يرجى عدم استخدام التطبيق." },
    { title: "٢. وصف الخدمة", body: "SOSphere تطبيق لسلامة العمال الميدانيين في مرحلة تجريبية. لا يُعتمد عليه كبديل عن خدمات الطوارئ الرسمية (911/122/112)." },
    { title: "٣. مسؤولية المستخدم", body: "أنت مسؤول عن دقة المعلومات التي تدخلها. يجب الاحتفاظ بمعلومات حسابك سرية وعدم مشاركتها." },
    { title: "٤. حدود المسؤولية", body: "في مرحلة التجربة لا يتحمل فريق SOSphere أي مسؤولية عن أضرار ناجمة عن الاستخدام. لا يُعد التطبيق بديلاً عن الطوارئ الرسمية." },
    { title: "٥. البيانات والخصوصية", body: "نجمع بيانات الموقع وبيانات الطوارئ لأغراض السلامة فقط. راجع سياسة الخصوصية للتفاصيل." },
    { title: "٦. التعديلات", body: "نحتفظ بالحق في تعديل هذه الشروط في أي وقت مع إخطار المستخدمين بالتغييرات الجوهرية." },
    { title: "٧. القانون المطبق", body: "تخضع هذه الشروط للقوانين المعمول بها في منطقة تشغيل الخدمة." },
  ];
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden" style={{ background: "#05070E", ...S }}>
      <div className="flex items-center gap-3 px-5 py-4" style={{ paddingTop: "max(20px,env(safe-area-inset-top))", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
        <button onClick={onBack} style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ArrowLeft size={18} color="rgba(255,255,255,.6)" />
        </button>
        <Shield size={16} color="#00C8E0" />
        <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>شروط الاستخدام</span>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-6" style={{ direction: "rtl" }}>
        <div className="mb-4 p-3" style={{ borderRadius: 12, background: "rgba(255,150,0,.08)", border: "1px solid rgba(255,150,0,.2)" }}>
          <p style={{ fontSize: 12, color: "rgba(255,150,0,.9)", lineHeight: 1.7 }}>⚠️ هذا التطبيق في مرحلة تجريبية. البيانات المستخدمة حالياً للاختبار فقط.</p>
        </div>
        {sections.map((s, i) => (
          <div key={i} className="mb-5">
            <p style={{ fontSize: 14, fontWeight: 700, color: "#00C8E0", marginBottom: 8 }}>{s.title}</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,.55)", lineHeight: 1.8 }}>{s.body}</p>
          </div>
        ))}
        <p style={{ fontSize: 11, color: "rgba(255,255,255,.2)", textAlign: "center", marginTop: 24 }}>آخر تحديث: مارس ٢٠٢٦ — SOSphere Safety Platform</p>
      </div>
    </div>
  );
}
