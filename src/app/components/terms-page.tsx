import { ArrowLeft, Scale } from "lucide-react";

export function TermsPage({ onBack }: { onBack: () => void }) {
  const S = { fontFamily: "'Tajawal','Outfit',sans-serif" };

  const sections = [
    {
      enTitle: "1. Acceptance of Terms",
      enBody: "By accessing, downloading, or using the SOSphere mobile application and services (collectively, the \"Service\"), you agree to be bound by these Terms of Service (\"Terms\"). If you do not agree to these Terms, do not use the Service.\n\nThese Terms apply to all users, including those accessing the Service on behalf of an organization (\"Organizational Users\"). If you are an Organizational User, you represent that you have authority to bind the organization to these Terms.\n\nSOSphere reserves the right to modify these Terms at any time. Material changes will be communicated 30 days in advance. Continued use constitutes acceptance of updated Terms.",
      arTitle: "١. قبول الشروط",
      arBody: "بالوصول إلى تطبيق SOSphere الجوال والخدمات أو تنزيلها أو استخدامها (مجتمعة، \"الخدمة\")، فإنك توافق على الالتزام بشروط الخدمة هذه (\"الشروط\"). إذا كنت لا توافق على هذه الشروط، فلا تستخدم الخدمة.\n\nتنطبق هذه الشروط على جميع المستخدمين، بما في ذلك الذين يصلون إلى الخدمة نيابة عن منظمة (\"مستخدمي المؤسسة\"). إذا كنت مستخدم مؤسسة، فإنك تقر بأن لديك سلطة ربط المنظمة بهذه الشروط.\n\nتحتفظ SOSphere بالحق في تعديل هذه الشروط في أي وقت. سيتم توصيل التغييرات الجوهرية قبل 30 يوماً مقدماً. الاستخدام المستمر يشكل قبول الشروط المحدثة."
    },
    {
      enTitle: "2. Service Description",
      enBody: "SOSphere provides a workplace emergency safety platform featuring:\n\n• Real-time SOS activation and emergency alerts\n• GPS location tracking during emergency events\n• Emergency contact notifications and communication\n• Offline capability for critical SOS functionality\n• Integration with first responders (where available)\n• Optional medical information storage\n• Emergency event history and analytics\n\nThe Service is designed to supplement—not replace—professional emergency response services (911, police, fire services, etc.). In emergencies, always call local emergency services directly.\n\nSOSphere aims to provide accurate, timely emergency support, but does not guarantee that:\n• Emergency services will respond to alerts\n• Location data will be 100% accurate\n• Services will be uninterrupted or error-free\n• All features will be available in all jurisdictions",
      arTitle: "٢. وصف الخدمة",
      arBody: "توفر SOSphere منصة سلامة الطوارئ في مكان العمل بميزات تشمل:\n\n• تفعيل SOS في الوقت الفعلي والتنبيهات الطارئة\n• تتبع موقع GPS أثناء أحداث الطوارئ\n• إخطارات جهات الاتصال الطارئة والتواصل\n• قدرة غير متصلة للوظائف الحرجة SOS\n• التكامل مع أول المستجيبين (حيث تكون متاحة)\n• تخزين المعلومات الطبية الاختيارية\n• سجل أحداث الطوارئ والتحليلات\n\nتم تصميم الخدمة لتكملة—لا تحل محل—خدمات الاستجابة للطوارئ المهنية (911، الشرطة، خدمات الإطفاء، إلخ.). في حالات الطوارئ، اتصل دائماً بخدمات الطوارئ المحلية مباشرة.\n\nتسعى SOSphere لتوفير دعم طوارئ دقيق وفي الوقت المناسب، لكنها لا تضمن:\n• أن خدمات الطوارئ ستستجيب للتنبيهات\n• أن بيانات الموقع ستكون دقيقة بنسبة 100٪\n• أن الخدمات ستكون غير متقطعة أو خالية من الأخطاء\n• أن جميع الميزات ستكون متاحة في جميع الاختصاصات"
    },
    {
      enTitle: "3. User Responsibilities & Account Terms",
      enBody: "By using SOSphere, you agree to:\n\n• Provide accurate, current, and complete registration information\n• Maintain the confidentiality of your account credentials\n• Immediately notify us of any unauthorized access to your account\n• Keep contact information (phone numbers, emergency contacts) up-to-date\n• Verify that emergency contacts have consented to being notified\n• Use the Service only for its intended purpose (workplace safety)\n• Not impersonate any person or entity\n• Not share your account credentials with unauthorized parties\n• Accept responsibility for all activities under your account\n• Not attempt to access the Service through unauthorized means\n\nYou are responsible for all data accuracy, including medical information and emergency contact details. Inaccurate information may prevent proper emergency response.",
      arTitle: "٣. مسؤوليات المستخدم وشروط الحساب",
      arBody: "باستخدام SOSphere، فإنك توافق على:\n\n• توفير معلومات تسجيل دقيقة وحالية وكاملة\n• الحفاظ على سرية بيانات اعتماد حسابك\n• إخطارنا فوراً بأي وصول غير مصرح إلى حسابك\n• إبقاء معلومات الاتصال (أرقام الهاتف، جهات الاتصال الطارئة) محدثة\n• التحقق من موافقة جهات الاتصال الطارئة على تلقي الإخطارات\n• استخدام الخدمة فقط لغرضها المقصود (سلامة مكان العمل)\n• عدم انتحال شخصية أي شخص أو كيان\n• عدم مشاركة بيانات اعتماد حسابك مع أطراف غير مصرح لهم\n• قبول المسؤولية عن جميع الأنشطة تحت حسابك\n• عدم محاولة الوصول إلى الخدمة من خلال وسائل غير مصرح بها\n\nأنت مسؤول عن دقة جميع البيانات، بما في ذلك المعلومات الطبية وتفاصيل جهات الاتصال الطارئة. قد تمنع المعلومات غير الدقيقة الاستجابة الطارئة المناسبة."
    },
    {
      enTitle: "4. Prohibited Uses",
      enBody: "You agree NOT to:\n\n• Use the Service to make false, fraudulent, or harassing emergency reports\n• Misuse emergency alerts to interfere with or distract emergency services\n• Use the Service for any illegal purpose or in violation of any law\n• Harass, threaten, or intimidate other users or emergency responders\n• Attempt to reverse-engineer, hack, or compromise the Service security\n• Scrape, crawl, or extract data from the Service without authorization\n• Send unsolicited bulk communications (spam) through the platform\n• Transmit malware, viruses, or harmful code\n• Impersonate SOSphere staff or first responders\n• Share your account to allow others unauthorized access\n• Use the Service in any manner that could harm infrastructure, privacy, or data security\n• Disable or circumvent security features\n• Make excessive requests that overload the system\n\nViolations may result in immediate account suspension and legal action. False emergency reports may violate criminal statutes in your jurisdiction.",
      arTitle: "٤. الاستخدامات المحظورة",
      arBody: "أنت توافق على عدم:\n\n• استخدام الخدمة لتقديم تقارير طوارئ كاذبة أو احتيالية أو تحرشية\n• إساءة استخدام التنبيهات الطارئة للتدخل في خدمات الطوارئ أو تشتيتها\n• استخدام الخدمة لأي غرض غير قانوني أو بانتهاك أي قانون\n• المضايقة أو التهديد أو الترهيب لمستخدمين آخرين أو المستجيبين للطوارئ\n• محاولة الهندسة العكسية أو اختراق أو تقويض أمان الخدمة\n• كشط أو زحف أو استخراج البيانات من الخدمة دون تفويض\n• إرسال اتصالات بدون مقابل (بريد عشوائي) عبر المنصة\n• نقل البرامج الضارة أو الفيروسات أو الأكواس الضارة\n• انتحال شخصية موظفي SOSphere أو المستجيبين الأوائل\n• مشاركة حسابك للسماح للآخرين بالوصول غير المصرح به\n• استخدام الخدمة بطريقة قد تضر البنية التحتية أو الخصوصية أو أمان البيانات\n• تعطيل أو تجاوز ميزات الأمان\n• تقديم طلبات مفرطة قد تثقل النظام\n\nقد تؤدي الانتهاكات إلى تعليق حساب فوري واتخاذ إجراءات قانونية. قد تنتهك التقارير الطارئة الكاذبة القوانين الجنائية في منطقتك القضائية."
    },
    {
      enTitle: "5. Intellectual Property Rights",
      enBody: "SOSphere and all components of the Service (software, design, graphics, text, functionality) are owned by or licensed to SOSphere and are protected by copyright, trademark, and other intellectual property laws.\n\nYou are granted a limited, non-exclusive, non-transferable license to use the Service solely for your personal, non-commercial purposes. This license does not include:\n\n• Right to modify or create derivative works\n• Right to reverse-engineer or decompile the code\n• Right to sublicense or resell the Service\n• Right to remove copyright or proprietary notices\n• Right to copy large portions of the code or design for other use\n\nAll feedback, suggestions, or ideas you provide about the Service may be used by SOSphere without compensation or credit.\n\nYou retain ownership of any content you create in the Service (emergency notes, medical info) and grant SOSphere a license to store, process, and display it for service operation.",
      arTitle: "٥. حقوق الملكية الفكرية",
      arBody: "SOSphere وجميع مكونات الخدمة (البرنامج والتصميم والرسومات والنص والوظيفة) مملوكة لـ SOSphere أو مرخصة لها وتحمى بموجب قوانين حقوق الطبع والعلامات التجارية وقوانين الملكية الفكرية الأخرى.\n\nيتم منحك ترخيص محدود وغير حصري وغير قابل للتحويل لاستخدام الخدمة فقط لأغراضك الشخصية غير التجارية. لا يتضمن هذا الترخيص:\n\n• الحق في تعديل أو إنشاء أعمال مشتقة\n• الحق في الهندسة العكسية أو فك تجميع الكود\n• الحق في ترخيص فرعي أو إعادة بيع الخدمة\n• الحق في إزالة إشعارات حقوق الطبع أو الملكية\n• الحق في نسخ أجزاء كبيرة من الكود أو التصميم للاستخدام الآخر\n\nقد تستخدم SOSphere جميع التعليقات أو الاقتراحات أو الأفكار التي تقدمها حول الخدمة دون تعويض أو نسبة.\n\nأنت تحتفظ بملكية أي محتوى تنشئه في الخدمة (ملاحظات الطوارئ والمعلومات الطبية) وتمنح SOSphere ترخيصاً لتخزينه ومعالجته وعرضه لتشغيل الخدمة."
    },
    {
      enTitle: "6. Limitation of Liability",
      enBody: "TO THE MAXIMUM EXTENT PERMITTED BY LAW, SOSPHERE, ITS OFFICERS, DIRECTORS, EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR:\n\n• Indirect, incidental, consequential, special, or punitive damages\n• Loss of revenue, profits, data, use, or goodwill\n• Damages arising from unauthorized access to your account\n• Damages from service interruptions, delays, or errors\n• Failure of emergency services to respond to alerts\n• Inaccuracy of location data or medical information\n• Any claim arising from your use of the Service\n\nThe Service is provided \"AS IS\" without warranties of any kind, express or implied, including:\n\n• Merchantability or fitness for a particular purpose\n• Title or non-infringement of third-party rights\n• Accuracy, completeness, or reliability of content\n• Uninterrupted or error-free service operation\n\nSOME JURISDICTIONS DO NOT ALLOW LIMITATION OF LIABILITY. IN SUCH CASES, OUR LIABILITY IS LIMITED TO THE AMOUNT YOU PAID FOR THE SERVICE IN THE LAST 12 MONTHS.\n\nYou acknowledge that SOSphere supplements but does not replace professional emergency services. The platform aids emergency response but cannot guarantee that responders will act on alerts or that your location will be accurately transmitted.",
      arTitle: "٦. تحديد المسؤولية",
      arBody: "إلى الحد الأقصى المسموح به بموجب القانون، لن تكون SOSphere وضباطها والمديرين والموظفين والوكلاء مسؤولين عن:\n\n• الأضرار غير المباشرة أو العرضية أو الناجمة أو الخاصة أو العقابية\n• فقدان الإيرادات أو الأرباح أو البيانات أو الاستخدام أو حسن النية\n• الأضرار الناجمة عن وصول غير مصرح إلى حسابك\n• الأضرار من انقطاع الخدمة أو التأخير أو الأخطاء\n• فشل خدمات الطوارئ في الاستجابة للتنبيهات\n• عدم دقة بيانات الموقع أو المعلومات الطبية\n• أي مطالبة ناشئة عن استخدامك للخدمة\n\nيتم توفير الخدمة \"كما هي\" بدون ضمانات من أي نوع، صريحة أو ضمنية، بما في ذلك:\n\n• قابلية التسويق أو الملاءمة لغرض معين\n• الملكية أو عدم الانتهاك من حقوق الطرف الثالث\n• دقة أو اكتمال أو موثوقية المحتوى\n• عملية الخدمة غير المتقطعة أو الخالية من الأخطاء\n\nلا تسمح بعض الاختصاصات بتحديد المسؤولية. في هذه الحالات، تقتصر مسؤوليتنا على المبلغ الذي دفعته للخدمة في آخر 12 شهراً.\n\nأنت تقر بأن SOSphere تكمل ولا تحل محل خدمات الطوارئ المهنية. تساعد المنصة في الاستجابة للطوارئ لكنها لا يمكن أن تضمن أن المستجيبين سيعملون على التنبيهات أو أن موقعك سيتم نقله بدقة."
    },
    {
      enTitle: "7. Indemnification",
      enBody: "You agree to defend, indemnify, and hold harmless SOSphere, its owners, operators, employees, and agents from:\n\n• Any claims, damages, or liabilities arising from your use of the Service\n• Any violations of these Terms by you\n• Any infringement of third-party rights caused by your content or activity\n• Your negligence or willful misconduct\n• False or fraudulent emergency reports you submit\n• Any harm to emergency responders or services caused by your actions\n\nThis indemnification survives termination of these Terms and your use of the Service.\n\nSOSphere reserves the right to assume the defense of any such claim at your expense if you fail to do so.",
      arTitle: "٧. التعويض",
      arBody: "أنت توافق على الدفاع والتعويض وحماية SOSphere ومالكيها والعاملين والوكلاء من:\n\n• أي مطالبات أو أضرار أو التزامات ناشئة عن استخدامك للخدمة\n• أي انتهاكات لهذه الشروط من قبلك\n• أي انتهاك لحقوق الطرف الثالث الناجمة عن محتواك أو نشاطك\n• إهمالك أو سلوكك المتعمد\n• تقارير الطوارئ الكاذبة أو الاحتيالية التي تقدمها\n• أي ضرر للمستجيبين الطارئين أو الخدمات الناجم عن أفعالك\n\nيستمر هذا التعويض بعد إنهاء هذه الشروط واستخدامك للخدمة.\n\nتحتفظ SOSphere بالحق في تحمل الدفاع عن أي مطالبة من هذا القبيل على نفقتك إذا فشلت في القيام بذلك."
    },
    {
      enTitle: "8. Termination",
      enBody: "Either party may terminate your account and use of the Service:\n\nYou can terminate:\n• By requesting account deletion via info@sosphere.co\n• Your data will be deleted within 60 days per our Privacy Policy\n• You remain liable for all activity before termination\n\nSOSphere can terminate your account if:\n• You violate these Terms\n• You engage in illegal activity\n• You make false emergency reports\n• You threaten or harm emergency responders\n• You attempt to compromise platform security\n• You violate the Privacy Policy\n• You engage in abusive behavior toward other users\n• Due to legal requirements or law enforcement request\n\nUpon termination:\n• Your access to the Service ceases immediately\n• Any outstanding emergency alerts may be canceled\n• Your data is handled according to the Privacy Policy\n• Indemnification and liability limitations survive termination\n\nTermination does not relieve you of obligations incurred before termination.",
      arTitle: "٨. الإنهاء",
      arBody: "يمكن لأي طرف إنهاء حسابك واستخدام الخدمة:\n\nيمكنك إنهاء:\n• بطلب حذف الحساب عبر info@sosphere.co\n• سيتم حذف بياناتك في غضون 60 يوماً وفقاً لسياسة الخصوصية الخاصة بنا\n• أنت تبقى مسؤولاً عن جميع الأنشطة قبل الإنهاء\n\nيمكن لـ SOSphere إنهاء حسابك إذا:\n• انتهكت هذه الشروط\n• قمت بنشاط غير قانوني\n• قدمت تقارير طوارئ كاذبة\n• هددت أو أضررت بالمستجيبين الطارئين\n• حاولت تقويض أمان المنصة\n• انتهكت سياسة الخصوصية\n• قمت بسلوك مسيء تجاه مستخدمين آخرين\n• بسبب المتطلبات القانونية أو طلب إنفاذ القانون\n\nعند الإنهاء:\n• ينقطع وصولك إلى الخدمة فوراً\n• قد يتم إلغاء أي تنبيهات طوارئ معلقة\n• يتم التعامل مع بياناتك وفقاً لسياسة الخصوصية\n• يستمر التعويض وتحديد المسؤولية بعد الإنهاء\n\nالإنهاء لا يعفيك من الالتزامات المتكبدة قبل الإنهاء."
    },
    {
      enTitle: "9. Governing Law & Dispute Resolution",
      enBody: "These Terms are governed by and construed in accordance with:\n• The laws of the jurisdiction where the Service is primarily operated\n• Applicable international privacy and emergency services regulations\n\nDispute Resolution:\n1. Informal Resolution: Before legal action, attempt good faith negotiation with SOSphere within 30 days\n2. Mandatory Arbitration: Any dispute shall be settled by binding arbitration under international arbitration rules, not in court (except for emergency injunctions)\n3. Venue: Arbitration shall take place in a mutually agreed location or by remote proceedings\n4. Costs: Each party bears its own attorneys' fees; arbitrator fees split unless arbitrator rules otherwise\n5. Right to Legal Counsel: You have the right to legal representation\n6. Exceptions: Claims for IP infringement, account security breaches, or emergency services failures may be brought in court\n\nNo Class Actions: You agree that disputes shall be brought only in your individual capacity, not as part of any class or consolidated proceeding.\n\nEscalation for Emergency Claims: If your claim involves failure to provide emergency response, expedited arbitration procedures will apply.",
      arTitle: "٩. القانون الحاكم وحل النزاعات",
      arBody: "يتم التحكم في هذه الشروط وتفسيرها وفقاً لـ:\n• قوانين الاختصاص القضائي الذي تعمل فيه الخدمة في الأساس\n• لوائح الخصوصية الدولية المعمول بها ولوائح خدمات الطوارئ\n\nحل النزاعات:\n1. الحل غير الرسمي: قبل الإجراء القانوني، حاول التفاوض بحسن نية مع SOSphere في غضون 30 يوماً\n2. التحكيم الإلزامي: سيتم تسوية أي نزاع بواسطة التحكيم الملزم بموجب القواعس التحكيمية الدولية وليس في المحكمة (ما عدا الأوامر الطارئة)\n3. الاختصاص: يجب أن يتم التحكيم في مكان متفق عليه متبادلاً أو عن طريق الإجراءات البعيدة\n4. التكاليف: يتحمل كل طرف رسوم محاميه الخاصة؛ يتم تقسيم رسوم المحكم إلا إذا حكم المحكم بخلاف ذلك\n5. الحق في المشورة القانونية: لديك الحق في تمثيل قانوني\n6. الاستثناءات: يمكن طرح المطالبات المتعلقة بانتهاك الملكية الفكرية أو انتهاكات أمان الحساب أو فشل خدمات الطوارئ في المحكمة\n\nلا تصنيفات جماعية: أنت توافق على تقديم النزاعات فقط بصفتك الفردية وليس كجزء من أي إجراء جماعي أو موحد.\n\nالتصعيد للمطالبات الطارئة: إذا تضمنت مطالبتك فشل في توفير الاستجابة للطوارئ، ستنطبق إجراءات التحكيم المعجلة."
    },
    {
      enTitle: "10. Modifications to Terms",
      enBody: "SOSphere reserves the right to modify these Terms at any time:\n\n• Material changes: Communicated via email 30 days before effective date\n• You must accept updated Terms to continue using the Service\n• Non-material changes (links, clarifications): Effective immediately\n• If you do not agree to updates, you must delete your account\n• Continued use after updates constitutes acceptance\n\nWe will maintain a history of previous versions available upon request.",
      arTitle: "١٠. تعديلات الشروط",
      arBody: "تحتفظ SOSphere بالحق في تعديل هذه الشروط في أي وقت:\n\n• التغييرات الجوهرية: يتم إخطارك عبر البريد الإلكتروني قبل 30 يوماً من تاريخ سريانها\n• يجب أن توافق على الشروط المحدثة لمتابعة استخدام الخدمة\n• التغييرات غير الجوهرية (الروابط والتوضيحات): سارية فوراً\n• إذا كنت لا توافق على التحديثات، يجب عليك حذف حسابك\n• الاستخدام المستمر بعد التحديثات يشكل قبول\n\nسنحافظ على سجل الإصدارات السابقة متاح عند الطلب."
    },
    {
      enTitle: "11. Contact & Support",
      enBody: "For questions about these Terms, to exercise your rights, or to report violations:\n\n• Email: info@sosphere.co\n• Legal Inquiries: legal@sosphere.co\n• Emergency Escalation: emergency-support@sosphere.co\n• Response Time: 5 business days\n\nFor GDPR-related inquiries:\n• Data Protection Officer: privacy@sosphere.co\n\nMailing Address:\nSOSphere Safety Platform\nSupport & Legal Team\n\nWe maintain support channels 24/7 for emergency-related issues.",
      arTitle: "١١. الاتصال والدعم",
      arBody: "للأسئلة حول هذه الشروط أو لممارسة حقوقك أو الإبلاغ عن الانتهاكات:\n\n• البريد الإلكتروني: info@sosphere.co\n• الاستفسارات القانونية: legal@sosphere.co\n• تصعيد الطوارئ: emergency-support@sosphere.co\n• وقت الرد: 5 أيام عمل\n\nللاستفسارات المتعلقة بـ GDPR:\n• مسؤول حماية البيانات: privacy@sosphere.co\n\nعنوان البريد:\nمنصة SOSphere Safety\nفريق الدعم والشؤون القانونية\n\nنحتفظ بقنوات الدعم 24/7 للمشاكل المتعلقة بالطوارئ."
    },
    {
      enTitle: "12. Entire Agreement & Severability",
      enBody: "These Terms constitute the entire agreement between you and SOSphere regarding the Service, superseding all prior agreements, whether written or oral.\n\nSeverability:\nIf any provision of these Terms is found to be unenforceable or invalid:\n• That provision will be modified to the minimum extent necessary to make it valid\n• If modification is not possible, that provision will be severed\n• All other provisions remain in full force and effect\n• The parties' intent to be legally bound shall be preserved\n\nNo waiver of any provision shall be effective unless in writing and signed by an authorized SOSphere representative.\n\nThese Terms do not create a partnership, agency, or joint venture between you and SOSphere. Nothing in these Terms grants you authority to bind or represent SOSphere.\n\nLast Updated: April 2026\nVersion: 1.0 (International Legal Compliant)\nCompany: SOSphere (operated by Fadi Hadi)\nDomain: sosphere.co",
      arTitle: "١٢. الاتفاق الكامل والفصل",
      arBody: "تشكل هذه الشروط الاتفاق الكامل بينك وبين SOSphere فيما يتعلق بالخدمة، وتحل محل جميع الاتفاقات السابقة سواء كانت مكتوبة أو شفوية.\n\nالفصل:\nإذا تبين أن أي حكم من هذه الشروط غير قابل للتنفيذ أو غير صحيح:\n• سيتم تعديل هذا الحكم إلى الحد الأدنى الضروري لجعله صحيحاً\n• إذا كان التعديل غير ممكن، سيتم حذف هذا الحكم\n• تبقى جميع الأحكام الأخرى سارية بكامل قوتها\n• سيتم الحفاظ على نية الأطراف في الالتزام القانوني\n\nلن يكون التنازل عن أي حكم فعالاً إلا إذا كان مكتوباً وموقعاً من قبل ممثل مفوض SOSphere.\n\nلا تنشئ هذه الشروط شراكة أو وكالة أو مشروع مشترك بينك وبين SOSphere. لا يمنح شيء في هذه الشروط لك سلطة ربط أو تمثيل SOSphere.\n\nآخر تحديث: أبريل ٢٠٢٦\nالإصدار: ١.٠ (متوافق قانوني دولي)\nالشركة: SOSphere (يديرها Fadi Hadi)\nالمجال: sosphere.co"
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
        <Scale size={16} color="#FF2D55" />
        <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>Terms of Service</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-6">
        {/* Intro Card */}
        <div
          className="mb-6 p-4"
          style={{
            borderRadius: 12,
            background: "rgba(255,45,85,.06)",
            border: "1px solid rgba(255,45,85,.15)"
          }}
        >
          <p style={{ fontSize: 13, color: "rgba(255,45,85,.9)", lineHeight: 1.7, margin: 0 }}>
            ⚖️ <strong>Legal Agreement.</strong> These Terms of Service govern your use of SOSphere. Please read carefully. By using SOSphere, you accept these Terms in full. Last updated: April 2026.
          </p>
        </div>

        {/* Sections */}
        {sections.map((section, i) => (
          <div key={i} className="mb-8">
            {/* English Section */}
            <div className="mb-6">
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "#FF2D55", marginBottom: 10, margin: 0 }}>
                {section.enTitle}
              </h3>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,.65)", lineHeight: 1.8, margin: 0, whiteSpace: "pre-wrap" }}>
                {section.enBody}
              </p>
            </div>

            {/* Arabic Section */}
            <div style={{ direction: "rtl" }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "#00C8E0", marginBottom: 10, margin: 0 }}>
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
            SOSphere Terms of Service v1.0<br/>
            © 2026 SOSphere. All rights reserved.<br/>
            Operated by Fadi Hadi | sosphere.co
          </p>
        </div>
      </div>
    </div>
  );
}
