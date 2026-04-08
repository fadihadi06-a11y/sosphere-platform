import { ArrowLeft, Lock } from "lucide-react";

export function PrivacyPage({ onBack }: { onBack: () => void }) {
  const S = { fontFamily: "'Tajawal','Outfit',sans-serif" };

  const sections = [
    {
      enTitle: "1. Information We Collect",
      enBody: "We collect the following categories of personal data to provide the SOSphere safety platform:\n\n• GPS Location Data: Precise latitude and longitude when emergency features are activated, transmitted to emergency contacts and response services\n• Mobile Device Information: Device type, OS version, app version, and device identifiers for performance optimization and debugging\n• Contact Information: Phone number(s) for verification, emergency alerts, and communication with emergency services\n• Emergency Event Data: Timestamps, duration of SOS activations, emergency level designation, and associated notes\n• Health/Medical Data: Optional medical history, allergies, or emergency medical information you provide\n• Offline Cache Data: Locally stored location history and event logs synced when connectivity is restored\n• Communication Logs: Records of emergency contacts, SMS/voice calls facilitated through Twilio\n• Usage Analytics: App engagement metrics, feature usage patterns (anonymous unless tied to account)",
      arTitle: "١. المعلومات التي نجمعها",
      arBody: "نجمع فئات البيانات الشخصية التالية لتوفير منصة السلامة SOSphere:\n\n• بيانات الموقع GPS: خط العرض وخط الطول الدقيقين عند تفعيل ميزات الطوارئ، يتم نقلها إلى جهات الاتصال الطارئة وخدمات الاستجابة\n• معلومات جهاز الجوال: نوع الجهاز وإصدار نظام التشغيل وإصدار التطبيق ومعرّفات الجهاز لتحسين الأداء والتصحيح\n• معلومات الاتصال: رقم(ات) الهاتف للتحقق والتنبيهات الطارئة والتواصل مع خدمات الطوارئ\n• بيانات أحداث الطوارئ: الطوابع الزمنية ومدة تفعيلات SOS ومستوى الطوارئ والملاحظات المرتبطة\n• البيانات الصحية/الطبية: السجل الطبي الاختياري والحساسيات أو معلومات الطوارئ الطبية التي تقدمها\n• بيانات الذاكرة المؤقتة المحلية: سجل الموقع المخزن محلياً وسجلات الأحداث المزامنة عند استعادة الاتصال\n• سجلات الاتصال: سجلات جهات الاتصال الطارئة واستدعاءات SMS/الصوتية التي يتم تسهيلها عبر Twilio\n• تحليلات الاستخدام: مقاييس مشاركة التطبيق وأنماط استخدام الميزات (مجهولة الهوية إلا إذا ارتبطت بالحساب)"
    },
    {
      enTitle: "2. Legal Basis & Purpose of Processing",
      enBody: "We process your data under the following lawful bases (GDPR Article 6):\n\n• Legitimate Interests: Operating the safety platform and emergency response system\n• Vital Interests: Processing location and health data to protect your physical safety in emergencies\n• Contractual Obligation: Fulfilling our service agreement to provide emergency response capabilities\n• Legal Obligation: Compliance with emergency services regulations and law enforcement requests\n• Consent: For non-essential features, location sharing preferences, and marketing communications\n\nWe will never use your data for profiling, automated decision-making, or commercial purposes unrelated to your safety.",
      arTitle: "٢. الأساس القانوني والغرض من المعالجة",
      arBody: "نعالج بياناتك بموجب الأسس القانونية التالية (المادة 6 من GDPR):\n\n• المصالح المشروعة: تشغيل منصة السلامة ونظام الاستجابة للطوارئ\n• المصالح الحيوية: معالجة بيانات الموقع والصحة لحماية سلامتك الجسدية في حالات الطوارئ\n• الالتزام التعاقدي: الوفاء باتفاقية الخدمة لتوفير قدرات الاستجابة للطوارئ\n• الالتزام القانوني: الامتثال للوائح خدمات الطوارئ وطلبات إنفاذ القانون\n• الموافقة: للميزات غير الأساسية وتفضيلات مشاركة الموقع والاتصالات التسويقية\n\nلن نستخدم بياناتك أبداً للتنميط أو الاتخاذ الآلي للقرارات أو الأغراض التجارية غير المتعلقة بسلامتك."
    },
    {
      enTitle: "3. Data Storage & Security",
      enBody: "Your data is protected through multiple security layers:\n\n• Server Storage: Primary data stored in Supabase (PostgreSQL) with encryption at rest using AES-256\n• Database Security: Row-level security (RLS) policies restrict access to authorized personnel only\n• Transport Layer: All data in transit encrypted with TLS 1.3\n• Client-Side Encryption: Sensitive data (location, medical info) encrypted in IndexedDB using Web Crypto API\n• Offline Cache: GPS tracks and events cached locally in encrypted IndexedDB, synced when online\n• Backup Encryption: Database backups encrypted and stored securely\n• Access Controls: Administrative access restricted to essential personnel with MFA\n• Audit Logs: All data access and modifications logged for compliance verification\n\nWe do not store passwords. Authentication handled through secure token-based systems.",
      arTitle: "٣. تخزين البيانات والأمان",
      arBody: "تحمى بياناتك من خلال طبقات أمان متعددة:\n\n• تخزين الخادم: البيانات الأساسية مخزنة في Supabase (PostgreSQL) بتشفير في وقت السكون باستخدام AES-256\n• أمان قاعدة البيانات: سياسات الأمان على مستوى الصف (RLS) تقيد الوصول للموظفين المصرح لهم فقط\n• طبقة النقل: جميع البيانات أثناء النقل مشفرة باستخدام TLS 1.3\n• التشفير من جانب العميل: البيانات الحساسة (الموقع والمعلومات الطبية) مشفرة في IndexedDB باستخدام Web Crypto API\n• الذاكرة المؤقتة المحلية: مسارات GPS والأحداث مخزنة مؤقتاً محلياً في IndexedDB المشفرة، وتتم مزامنتها عند الاتصال\n• تشفير النسخ الاحتياطية: نسخ قاعدة البيانات الاحتياطية مشفرة ومخزنة بأمان\n• التحكم في الوصول: الوصول الإداري مقيد بالموظفين الأساسيين فقط مع MFA\n• سجلات التدقيق: جميع عمليات الوصول إلى البيانات والتعديلات مسجلة للتحقق من الامتثال\n\nلا نقوم بتخزين كلمات المرور. المصادقة معالجة من خلال أنظمة آمنة قائمة على الرموز."
    },
    {
      enTitle: "4. Data Sharing & Third Parties",
      enBody: "We share your data only with essential service providers:\n\n• Twilio: SMS/voice alerts and emergency communications. Processes phone numbers and messages. Privacy: https://www.twilio.com/legal/privacy\n• Supabase: Database and authentication infrastructure. Processes all stored data. Privacy: https://supabase.com/privacy\n• Mapbox: Maps and location visualization. Processes location data. Privacy: https://www.mapbox.com/legal/privacy\n• Sentry: Error tracking and crash reporting (anonymized). Processes error logs only. Privacy: https://sentry.io/privacy/\n• Law Enforcement: We may disclose data when legally required (court orders, emergency situations)\n• Emergency Services: GPS location and medical info shared with first responders during active SOS\n\nWe do NOT sell, rent, or commercialize your personal data. No data brokers or advertisers have access.\n\nCross-border transfers occur only to GDPR-compliant jurisdictions using Standard Contractual Clauses (SCCs).",
      arTitle: "٤. مشاركة البيانات والأطراف الثالثة",
      arBody: "نشارك بياناتك فقط مع مقدمي الخدمات الأساسيين:\n\n• Twilio: تنبيهات SMS/الصوت والاتصالات الطارئة. معالجة أرقام الهاتف والرسائل. الخصوصية: https://www.twilio.com/legal/privacy\n• Supabase: قاعدة البيانات والمصادقة. معالجة جميع البيانات المخزنة. الخصوصية: https://supabase.com/privacy\n• Mapbox: الخرائط وتصور الموقع. معالجة بيانات الموقع. الخصوصية: https://www.mapbox.com/legal/privacy\n• Sentry: تتبع الأخطاء والإبلاغ عن الأعطال (مجهول الهوية). معالجة سجلات الأخطاء فقط. الخصوصية: https://sentry.io/privacy/\n• إنفاذ القانون: قد نفصح عن البيانات عند الحاجة القانونية (أوامر المحاكم وحالات الطوارئ)\n• خدمات الطوارئ: يتم مشاركة موقع GPS والمعلومات الطبية مع المستجيبين الأوائل أثناء SOS النشطة\n\nلا نبيع أو نؤجر أو نسيّس بياناتك الشخصية. لا يمكن لوسطاء البيانات أو المعلنين الوصول.\n\nتحدث التحويلات عبر الحدود فقط إلى الولايات القضائية المتوافقة مع GDPR باستخدام Clause Contractual Standard (SCCs)."
    },
    {
      enTitle: "5. Data Retention Schedule",
      enBody: "We retain your data according to legal requirements and operational necessity:\n\n• Active Account Data: Retained as long as your account is active\n• Emergency Event Records: Retained for 90 days (for incident review and compliance) then archived for 1 year\n• Location History: Recent 30-day history kept; older data anonymized and archived for 6 months\n• Medical Information: Retained 1 year from last SOS activation, then deleted\n• Failed Authentication Logs: 30 days\n• System Audit Logs: 1 year\n• Deleted Account Data: Permanently purged within 60 days of deletion request\n• Communication Records: 90 days for operational purposes, then deleted\n\nYou can request deletion at any time via info@sosphere.co. We will honor your request within 30 days unless legal obligations require retention.",
      arTitle: "٥. جدول الاحتفاظ بالبيانات",
      arBody: "نحتفظ ببياناتك وفقاً للمتطلبات القانونية والضرورة التشغيلية:\n\n• بيانات الحساب النشط: محفوظة طالما حسابك نشط\n• سجلات أحداث الطوارئ: محفوظة لمدة 90 يوماً (لمراجعة الحادثة والامتثال) ثم مؤرشفة لمدة سنة واحدة\n• سجل الموقع: يتم الاحتفاظ بآخر سجل مدته 30 يوماً؛ البيانات الأقدم مجهولة الهوية ومؤرشفة لمدة 6 أشهر\n• المعلومات الطبية: محفوظة سنة واحدة من آخر تفعيل SOS، ثم حذفها\n• سجلات المصادقة الفاشلة: 30 يوماً\n• سجلات تدقيق النظام: سنة واحدة\n• بيانات الحساب المحذوفة: يتم حذفها بشكل دائم في غضون 60 يوماً من طلب الحذف\n• سجلات الاتصال: 90 يوماً للأغراض التشغيلية، ثم حذفها\n\nيمكنك طلب الحذف في أي وقت عبر info@sosphere.co. سنحترم طلبك في غضون 30 يوماً ما لم تتطلب التزامات قانونية الاحتفاظ."
    },
    {
      enTitle: "6. Your GDPR Rights",
      enBody: "Under the GDPR, you have the following rights (Chapters 3-4 of GDPR):\n\n• Right of Access (Art. 15): Request a copy of all your personal data\n• Right to Rectification (Art. 16): Correct inaccurate or incomplete data\n• Right to Erasure (Art. 17): Request deletion of your data (\"Right to be Forgotten\")\n• Right to Restrict Processing (Art. 18): Limit how we use your data\n• Right to Data Portability (Art. 20): Receive your data in machine-readable format (JSON/CSV)\n• Right to Object (Art. 21): Oppose processing for marketing or profiling\n• Right to Withdraw Consent (Art. 7): Withdraw consent at any time without penalty\n• Right to Lodge a Complaint: File a complaint with your supervisory authority (DPA)\n• Automated Decision-Making (Art. 22): Right not to be subject to fully automated decisions\n\nTo exercise any of these rights, contact: info@sosphere.co with your request and proof of identity. We will respond within 30 days (or 60 days for complex requests).",
      arTitle: "٦. حقوقك بموجب GDPR",
      arBody: "بموجب GDPR، لديك الحقوق التالية (الفصول 3-4 من GDPR):\n\n• حق الوصول (المادة 15): طلب نسخة من جميع بياناتك الشخصية\n• حق التصحيح (المادة 16): تصحيح البيانات غير الدقيقة أو غير المكتملة\n• حق الحذف (المادة 17): طلب حذف بياناتك (\"الحق في النسيان\")\n• حق تقييد المعالجة (المادة 18): تحديد طريقة استخدامنا لبياناتك\n• حق نقل البيانات (المادة 20): الحصول على بياناتك بصيغة قابلة للقراءة الآلية (JSON/CSV)\n• حق الاعتراض (المادة 21): الاعتراض على المعالجة للتسويق أو التنميط\n• حق سحب الموافقة (المادة 7): سحب الموافقة في أي وقت دون عقوبة\n• حق تقديم شكوى: تقديم شكوى لسلطتك الإشرافية (DPA)\n• المعالجة الآلية للقرارات (المادة 22): الحق في عدم الخضوع للقرارات المؤتمتة بالكامل\n\nلممارسة أي من هذه الحقوق، اتصل بـ: info@sosphere.co مع طلبك وإثبات الهوية. سنرد في غضون 30 يوماً (أو 60 يوماً للطلبات المعقدة)."
    },
    {
      enTitle: "7. Children's Privacy (COPPA/GDPR)",
      enBody: "SOSphere is designed for workplace safety and is not intentionally directed to children under 13 (or the applicable age of digital consent in your jurisdiction).\n\nIf a child under 13 uses the platform:\n• Parental/guardian consent is required for data collection\n• We will request verifiable parental consent before processing\n• Data collection is minimized to essential safety information only\n• Children under 13 cannot opt into optional features without parental approval\n\nIf we discover unauthorized collection from children under 13, we will delete that data immediately.\n\nParents/guardians can contact us to review or request deletion of a child's data: info@sosphere.co",
      arTitle: "٧. خصوصية الأطفال (COPPA/GDPR)",
      arBody: "تم تصميم SOSphere لسلامة مكان العمل وليس موجهة بقصد للأطفال دون سن 13 (أو سن الموافقة الرقمية المعمول به في منطقتك القضائية).\n\nإذا استخدم طفل دون سن 13 المنصة:\n• يلزم موافقة ولي الأمر/الوصي لجمع البيانات\n• سننطلب موافقة ولي أمر قابلة للتحقق قبل المعالجة\n• يتم تقليل جمع البيانات إلى المعلومات الأمنية الأساسية فقط\n• لا يمكن للأطفال دون سن 13 اختيار الميزات الاختيارية دون موافقة ولي الأمر\n\nإذا اكتشفنا جمعاً غير مصرح من الأطفال دون سن 13، سنحذف تلك البيانات على الفور.\n\nيمكن لأولياء الأمور/الأوصياء الاتصال بنا لمراجعة أو طلب حذف بيانات الطفل: info@sosphere.co"
    },
    {
      enTitle: "8. International Data Transfers",
      enBody: "SOSphere operates globally and your data may be transferred to:\n\n• European Union (primary servers)\n• United States (via Supabase US regions)\n• Other jurisdictions for emergency response\n\nFor transfers outside the EU/EEA:\n• We use Standard Contractual Clauses (SCCs) approved by the EU Commission\n• Supplementary technical measures (encryption, access controls) address adequacy gaps\n• Transfers only to jurisdictions with comparable legal protection standards\n• You can request information about the specific transfer mechanism\n\nBy using SOSphere, you consent to necessary data transfers for emergency response services. You can object via info@sosphere.co.",
      arTitle: "٨. تحويل البيانات الدولية",
      arBody: "تعمل SOSphere عالمياً وقد يتم نقل بياناتك إلى:\n\n• الاتحاد الأوروبي (الخوادم الأساسية)\n• الولايات المتحدة (عبر مناطق Supabase الأمريكية)\n• ولايات قضائية أخرى لخدمات الاستجابة للطوارئ\n\nللتحويلات خارج الاتحاد الأوروبي/المنطقة الاقتصادية الأوروبية:\n• نستخدم Standard Contractual Clauses (SCCs) الموافق عليها من قبل اللجنة الأوروبية\n• التدابير التقنية الإضافية (التشفير والتحكم في الوصول) تعالج فجوات الكفاية\n• التحويلات فقط إلى ولايات قضائية ذات معايير حماية قانونية قابلة للمقارنة\n• يمكنك طلب معلومات حول آلية التحويل المحددة\n\nباستخدامك SOSphere، توافق على التحويلات الضرورية للبيانات لخدمات الاستجابة للطوارئ. يمكنك الاعتراض عبر info@sosphere.co."
    },
    {
      enTitle: "9. Cookies & Tracking Technology",
      enBody: "SOSphere uses minimal tracking:\n\n• Essential Cookies: Session tokens, authentication, CSRF protection (required for security)\n• Analytics Cookies: Optional usage metrics (sent only with consent). Powered by privacy-respecting methods\n• Location Tracking: Only when you explicitly activate SOS features\n• Service Worker Cache: Progressive Web App functionality (essential)\n• Local Storage: App preferences, offline queue (non-identifying)\n• No Third-Party Cookies: We do not use cookies from advertisers or data brokers\n• No User Tracking Across Sites: No behavior tracking between websites\n\nYou can disable non-essential cookies in settings. This may limit some features but won't prevent emergency functionality.",
      arTitle: "٩. ملفات تعريف الارتباط وتكنولوجيا التتبع",
      arBody: "تستخدم SOSphere تتبعاً محدوداً:\n\n• ملفات تعريف الارتباط الأساسية: رموز الجلسة والمصادقة وحماية CSRF (مطلوبة للأمان)\n• ملفات تعريف الارتباط لتحليلات: مقاييس الاستخدام الاختيارية (يتم الإرسال بالموافقة فقط). مدعوم بطرق تحترم الخصوصية\n• تتبع الموقع: فقط عند تفعيل ميزات SOS بشكل صريح\n• ذاكرة تخزين مؤقت لخادم الخدمة: وظيفة تطبيق الويب التقدمي (أساسي)\n• التخزين المحلي: تفضيلات التطبيق وقائمة الانتظار دون اتصال (غير محدد الهوية)\n• لا توجد ملفات تعريف ارتباط من طرف ثالث: لا نستخدم ملفات تعريف من المعلنين أو وسطاء البيانات\n• لا يوجد تتبع للمستخدم عبر المواقع: لا يوجد تتبع للسلوك بين المواقع\n\nيمكنك تعطيل ملفات تعريف الارتباط غير الأساسية في الإعدادات. قد يحد هذا من بعض الميزات لكنه لن يمنع وظيفة الطوارئ."
    },
    {
      enTitle: "10. Security Incident Notification",
      enBody: "In the event of a personal data breach:\n\n• We will notify affected individuals without undue delay (max. 72 hours)\n• Notification will include: nature of breach, data involved, likely consequences, and mitigation measures\n• We will notify the relevant Data Protection Authority (supervisory authority)\n• Notification will be sent via email to your registered address\n• No notification required if data was encrypted or anonymized beyond recovery\n• We maintain incident response procedures and conduct regular security audits\n\nReport suspected breaches to: info@sosphere.co with evidence and details.",
      arTitle: "١٠. إخطار حادث الأمان",
      arBody: "في حالة انتهاك البيانات الشخصية:\n\n• سنخطر الأفراد المتأثرين دون تأخير غير ضروري (أقصى 72 ساعة)\n• سيتضمن الإخطار: طبيعة الانتهاك والبيانات المعنية والعواقب المحتملة والتدابير التخفيفية\n• سنخطر سلطة حماية البيانات ذات الصلة (السلطة الإشرافية)\n• سيتم إرسال الإخطار عبر البريد الإلكتروني إلى عنوانك المسجل\n• لا يلزم إخطار إذا كانت البيانات مشفرة أو مجهولة الهوية بما يتجاوز الاسترجاع\n• نحتفظ بإجراءات الاستجابة للحوادث وننفذ تدقيقات أمان منتظمة\n\nأبلغ عن الانتهاكات المشبوهة إلى: info@sosphere.co مع الأدلة والتفاصيل."
    },
    {
      enTitle: "11. Data Protection Officer & Contact",
      enBody: "SOSphere appoints a Data Protection Officer (DPO) to oversee GDPR compliance:\n\n• DPO Email: privacy@sosphere.co\n• General Inquiries: info@sosphere.co\n• Mailing Address: SOSphere Safety Platform, Support Team\n• Response Time: We aim to respond to all inquiries within 5 business days\n• For GDPR subject access requests or rights exercises, please clearly state your request\n\nSupervisory Authority Contact:\nIf you believe your rights have been violated, you have the right to lodge a complaint with your national Data Protection Authority (e.g., GDPR supervisory authority in your country).",
      arTitle: "١١. مسؤول حماية البيانات والاتصال",
      arBody: "تعين SOSphere مسؤول حماية البيانات (DPO) للإشراف على امتثال GDPR:\n\n• بريد DPO: privacy@sosphere.co\n• الاستفسارات العامة: info@sosphere.co\n• عنوان البريد: منصة SOSphere Safety، فريق الدعم\n• وقت الاستجابة: نهدف إلى الرد على جميع الاستفسارات في غضون 5 أيام عمل\n• لطلبات الوصول إلى موضوع GDPR أو ممارسة الحقوق، يرجى تحديد طلبك بوضوح\n\nجهة الاتصال بالسلطة الإشرافية:\nإذا اعتقدت أن حقوقك قد انتهكت، فلديك الحق في تقديم شكوى لسلطة حماية البيانات الوطنية (مثل سلطة الإشراف GDPR في بلدك)."
    },
    {
      enTitle: "12. Policy Changes & Updates",
      enBody: "We may update this Privacy Policy:\n\n• Material changes will be communicated 30 days in advance via email\n• Non-material updates (clarifications, link fixes) effective immediately\n• Continued use of SOSphere after updates constitutes acceptance\n• You can request the previous version via info@sosphere.co\n• Historic versions available upon request\n\nLast Updated: April 2026\nCompany: SOSphere (operated by Fadi Hadi)\nDomain: sosphere.co\nVersion: 2.0 (GDPR Compliant)",
      arTitle: "١٢. تغييرات السياسة والتحديثات",
      arBody: "قد نحدث سياسة الخصوصية هذه:\n\n• سيتم توصيل التغييرات الجوهرية قبل 30 يوماً عبر البريد الإلكتروني\n• التحديثات غير الجوهرية (التوضيحات وإصلاحات الروابط) نافذة فوراً\n• استمرار استخدام SOSphere بعد التحديثات يشكل قبولاً\n• يمكنك طلب الإصدار السابق عبر info@sosphere.co\n• النسخ التاريخية متاحة عند الطلب\n\nآخر تحديث: أبريل ٢٠٢٦\nالشركة: SOSphere (يديرها Fadi Hadi)\nالمجال: sosphere.co\nالإصدار: ٢.٠ (متوافق مع GDPR)"
    }
  ];

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden" style={{ background: "#05070E", ...S }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
        style={{
          paddingTop: "max(20px,env(safe-area-inset-top))",
          borderBottom: "1px solid rgba(255,255,255,.06)"
        }}
      >
        <button
          onClick={onBack}
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "rgba(255,255,255,.05)",
            border: "1px solid rgba(255,255,255,.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer"
          }}
        >
          <ArrowLeft size={18} color="rgba(255,255,255,.6)" />
        </button>
        <Lock size={16} color="#00C8E0" />
        <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>Privacy Policy</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-6">
        {/* Intro Card */}
        <div
          className="mb-6 p-4"
          style={{
            borderRadius: 12,
            background: "rgba(0,200,224,.06)",
            border: "1px solid rgba(0,200,224,.15)"
          }}
        >
          <p style={{ fontSize: 13, color: "rgba(0,200,224,.9)", lineHeight: 1.7, margin: 0 }}>
            🔒 <strong>Your privacy is our priority.</strong> This Privacy Policy explains how SOSphere collects, processes, and protects your personal data in compliance with GDPR, CCPA, and international privacy standards. Last updated: April 2026.
          </p>
        </div>

        {/* Sections */}
        {sections.map((section, i) => (
          <div key={i} className="mb-8">
            {/* English Section */}
            <div className="mb-6">
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "#00C8E0", marginBottom: 10, margin: 0 }}>
                {section.enTitle}
              </h3>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,.65)", lineHeight: 1.8, margin: 0, whiteSpace: "pre-wrap" }}>
                {section.enBody}
              </p>
            </div>

            {/* Arabic Section */}
            <div style={{ direction: "rtl" }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "#FF2D55", marginBottom: 10, margin: 0 }}>
                {section.arTitle}
              </h3>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,.65)", lineHeight: 1.8, margin: 0, whiteSpace: "pre-wrap" }}>
                {section.arBody}
              </p>
            </div>

            {/* Divider */}
            {i < sections.length - 1 && (
              <div style={{ height: 1, background: "rgba(255,255,255,.08)", margin: "24px 0" }} />
            )}
          </div>
        ))}

        {/* Footer */}
        <div style={{ textAlign: "center", paddingTop: 24, paddingBottom: "max(24px, env(safe-area-inset-bottom))", borderTop: "1px solid rgba(255,255,255,.08)" }}>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,.3)", margin: 0, lineHeight: 1.6 }}>
            SOSphere Privacy Policy v2.0<br/>
            © 2026 SOSphere. All rights reserved.<br/>
            Operated by Fadi Hadi | sosphere.co
          </p>
        </div>
      </div>
    </div>
  );
}
