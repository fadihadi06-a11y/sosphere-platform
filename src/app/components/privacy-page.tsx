import { motion } from "motion/react";
import { ArrowLeft, Lock } from "lucide-react";
export function PrivacyPage({ onBack }: { onBack: () => void }) {
  const S = { fontFamily: "'Tajawal','Outfit',sans-serif" };
  const sections = [
    { title: "١. البيانات التي نجمعها", body: "نجمع: بيانات الموقع GPS عند تفعيل الطوارئ، رقم الهاتف للتحقق والتواصل، بيانات الحوادث وسجلات الاتصال، ومعلومات الجهاز لتحسين الأداء." },
    { title: "٢. كيف نستخدم بياناتك", body: "نستخدم بياناتك حصراً لأغراض السلامة: تفعيل نظام الطوارئ، التواصل مع جهات الإنقاذ، تحسين دقة التتبع، وإرسال تنبيهات السلامة." },
    { title: "٣. مشاركة البيانات", body: "لا نبيع بياناتك لأي طرف. نشارك فقط مع Twilio لإرسال تنبيهات الطوارئ وSupabase لتخزين البيانات بأمان." },
    { title: "٤. حماية البيانات", body: "بياناتك مشفرة بمعايير أمان عالية. نستخدم Supabase مع سياسات وصول مقيدة RLS. بيانات الموقع تُحفظ محلياً وتُزامن عند الاتصال." },
    { title: "٥. مدة الاحتفاظ", body: "نحتفظ ببيانات الطوارئ 90 يوماً للمراجعة. بيانات الموقع الروتينية تُحذف بعد 30 يوماً. يمكنك طلب حذف بياناتك في أي وقت." },
    { title: "٦. حقوقك", body: "لديك الحق في الاطلاع على بياناتك وتصحيحها وحذفها والانسحاب من جمع بيانات الموقع مع الاحتفاظ بالوظائف الأساسية." },
    { title: "٧. التواصل معنا", body: "لأي استفسار حول خصوصيتك: sosphere.support@gmail.com" },
  ];
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden" style={{ background: "#05070E", ...S }}>
      <div className="flex items-center gap-3 px-5 py-4" style={{ paddingTop: "max(20px,env(safe-area-inset-top))", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
        <button onClick={onBack} style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ArrowLeft size={18} color="rgba(255,255,255,.6)" />
        </button>
        <Lock size={16} color="#00C8E0" />
        <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>سياسة الخصوصية</span>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-6" style={{ direction: "rtl" }}>
        <div className="mb-4 p-3" style={{ borderRadius: 12, background: "rgba(0,200,224,.06)", border: "1px solid rgba(0,200,224,.15)" }}>
          <p style={{ fontSize: 12, color: "rgba(0,200,224,.8)", lineHeight: 1.7 }}>🔒 نأخذ خصوصيتك بجدية. هذه السياسة توضح كيف نجمع بياناتك ونحميها.</p>
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
