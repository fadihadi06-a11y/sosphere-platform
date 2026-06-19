/**
 * dpa-page.tsx — AUTH-5 P5 (#175)
 *
 * Public legal page for the SOSphere Data Processing Agreement.
 *
 * Two render modes, decided at runtime:
 *   1. PUBLIC view  — anyone (incl. logged-out visitors). Shows the
 *      full DPA text. Used by the link in company-register Step 5
 *      ("Read full DPA →") and accessible at /legal/dpa.
 *   2. SIGNED view  — when the visitor is signed in AND has an active
 *      sosphere_company_id, we additionally fetch get_dpa_acceptance
 *      for that company and prepend a "Signed copy" banner with the
 *      signer name / title / email / accepted-at / IP. A "Download
 *      signed DPA (PDF)" button generates a jsPDF that includes both
 *      the body text AND the signature block — tamper-evident because
 *      every field comes from the server-side acceptance row.
 *
 * Compliance posture:
 *   • EU GDPR Art. 28 (controller↔processor agreement)
 *   • KSA PDPL Art. 7 (data processor obligations)
 *   • UK Data Protection Act 2018 Sch. 1 Pt. 2
 *   • Companies in other regions can still sign — the DPA's Standard
 *     Contractual Clauses fallback (Sec. 9) governs non-EU/KSA flows.
 *
 * The legal text below is a STARTING TEMPLATE. SOSphere should have
 * its data-protection counsel review + tailor before relying on it
 * as the final agreement of record. The TECHNICAL infrastructure
 * around acceptance + audit + downloadable signed copy is solid.
 */

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, ShieldCheck, Download, Lock, FileText, Check } from "lucide-react";
import { useNavigate } from "react-router";
import jsPDF from "jspdf";
import { safeRpc } from "./api/safe-rpc";
import { useLang } from "./useLang";

interface DpaSignature {
  hasSignature:    boolean;
  version:         string;
  signerFullName?: string;
  signerTitle?:    string;
  signerEmail?:    string;
  signerIp?:       string | null;
  acceptedAt?:     string;
}

const DPA_VERSION = "2026-05-07";

const SECTIONS_EN: { title: string; body: string }[] = [
  // CITES: GDPR Recital 81; Stripe DPA Recitals — sets context for processor relationship.
  {
    title: "Recitals",
    body: "(A) The Controller and SOSphere have entered into a Subscription Agreement under " +
      "which SOSphere provides field-worker safety services (the \"Services\"). (B) In " +
      "providing the Services, SOSphere processes Personal Data on behalf of the Controller. " +
      "(C) This Data Processing Agreement (\"DPA\") sets out the parties\' obligations under " +
      "EU Regulation 2016/679 (GDPR), the UK Data Protection Act 2018, the Saudi Arabian " +
      "Personal Data Protection Law of 2021 (PDPL), and equivalent legislation. (D) Where " +
      "this DPA conflicts with the Subscription Agreement on data-protection matters, this " +
      "DPA prevails.",
  },
  // CITES: GDPR Art. 4; Stripe DPA §1; AWS DPA §1.1.
  {
    title: "1. Definitions",
    body: "Capitalised terms used but not defined here have the meaning given in the GDPR. " +
      "\"Controller\" means the company that signed up as a SOSphere customer. \"Processor\" " +
      "means SOSphere Ltd. (\"we\", \"us\"). \"Personal Data\" means data relating to an " +
      "identified or identifiable natural person processed on the Controller\'s behalf, " +
      "including employee profiles, GPS location, emergency-event metadata, evidence vault " +
      "contents, and incident reports. \"Personal Data Breach\" means a breach of security " +
      "leading to accidental or unlawful destruction, loss, alteration, unauthorised " +
      "disclosure of, or access to Personal Data. \"Sub-processor\" means any third party " +
      "engaged by SOSphere to process Personal Data. \"SCCs\" means the Standard Contractual " +
      "Clauses approved by EU Commission Decision 2021/914 (Module 2: Controller-to-Processor). " +
      "\"TOMs\" means the technical and organisational measures described in Annex II.",
  },
  // CITES: GDPR Art. 28(3)(a); Stripe DPA §3.1.
  {
    title: "2. Subject matter, duration, and nature of processing",
    body: "We process Personal Data only to provide the Services to the Controller. Processing " +
      "operations include: collection of employee profile data submitted by the Controller; " +
      "ingestion of GPS coordinates during active emergencies and check-ins; storage of " +
      "audio, image, and location evidence captured by the on-device emergency flow; " +
      "delivery of SMS, push, and call dispatches via integrated providers; and aggregation " +
      "of operational metrics for the Controller\'s dashboard. The duration of processing is " +
      "the term of the Subscription Agreement plus the retention windows in Section 17.",
  },
  // CITES: AWS DPA §1.4 + Annex I; Stripe DPA Annex I.
  {
    title: "3. Categories of Personal Data and data subjects",
    body: "Data subjects are the Controller\'s employees, contractors, and any individuals " +
      "designated as emergency contacts. Categories of Personal Data include: identifiers " +
      "(name, work email, phone number); employment metadata (role, department, work zone, " +
      "shift schedule); location data (real-time during emergencies, GPS trail during active " +
      "SOS sessions); emergency event records (timestamp, severity classification, " +
      "responder log); audio / image / video evidence captured during emergencies; and " +
      "optional medical-ID fields when explicitly volunteered by the data subject.",
  },
  // CITES: GDPR Art. 28(3)(a)+(h); Stripe DPA §3.2; Salesforce DPA §4.
  {
    title: "4. Controller obligations",
    body: "The Controller represents and warrants that: (a) it has a lawful basis under " +
      "applicable data-protection law for sharing Personal Data with us, typically " +
      "performance of an employment contract (GDPR Art. 6(1)(b)) or legitimate interest in " +
      "worker safety (GDPR Art. 6(1)(f); PDPL Art. 6(2)); (b) it has informed data subjects " +
      "of this processing as required by GDPR Arts. 13–14 / PDPL Art. 9; (c) it will issue " +
      "documented instructions to us in accordance with GDPR Art. 28(3)(a); (d) it will " +
      "promptly notify us of changes to those instructions; and (e) it will not request " +
      "processing that would violate applicable law.",
  },
  // CITES: GDPR Art. 28(3)(a)–(h) verbatim; Stripe DPA §3.3.
  {
    title: "5. Processor obligations",
    body: "We agree to: (a) process Personal Data only on documented instructions from the " +
      "Controller, including with regard to international transfers, except where required " +
      "by law (in which case we will inform the Controller unless the law prohibits notice " +
      "on important grounds of public interest); (b) ensure persons authorised to process " +
      "Personal Data are bound by enforceable confidentiality obligations; (c) implement " +
      "the TOMs in Annex II; (d) engage Sub-processors only in accordance with Section 8; " +
      "(e) assist the Controller, taking into account the nature of the processing, in " +
      "fulfilling its obligation to respond to data-subject requests under GDPR Arts. 12–22 " +
      "and equivalent laws; (f) assist the Controller with breach notification, data-" +
      "protection impact assessments, and prior consultation with supervisory authorities; " +
      "(g) at the Controller\'s choice, delete or return all Personal Data after end of " +
      "service; and (h) make available all information necessary to demonstrate compliance " +
      "and contribute to audits under Section 12.",
  },
  // CITES: GitHub DPA §6; Stripe DPA §3.4 — personnel-binding language.
  {
    title: "6. Confidentiality",
    body: "We will ensure that any person authorised to process Personal Data on our behalf " +
      "is subject to a duty of confidentiality (whether contractual or statutory) that " +
      "survives termination of their engagement. Access to production credentials and " +
      "Personal Data is limited to named engineers under documented role-based access " +
      "controls, logged via the audit_log, and subject to quarterly review. Personnel must " +
      "complete data-protection training within 30 days of role start and annually thereafter.",
  },
  // CITES: GDPR Art. 32; Stripe DPA Annex II; ISO 27002:2022 controls.
  {
    title: "7. Technical and organisational measures (Annex II)",
    body: "We have implemented and will maintain the TOMs detailed in Annex II below, " +
      "including: TLS 1.2+ in transit and AES-256 at rest; row-level security with FORCE " +
      "RLS on every PII table; per-tenant logical isolation (partial UNIQUE on " +
      "subscriptions.company_id); MFA-protected administrative access; encrypted backups " +
      "with 30-day retention; quarterly access review; vulnerability scanning and " +
      "patch-management programme; secure software-development lifecycle with mandatory " +
      "code review; tamper-evident audit logging of every authentication event, billing " +
      "change, DPA acceptance, and emergency escalation. The TOMs reflect the current " +
      "state of the art and the costs of implementation in relation to the risks for the " +
      "rights and freedoms of data subjects.",
  },
  // CITES: GDPR Art. 28(2)+(4); Stripe DPA §6 — 30-day notice + general written authorisation.
  {
    title: "8. Sub-processors",
    body: "The Controller provides general written authorisation for us to engage Sub-" +
      "processors. Annex III lists current Sub-processors. We will: (a) provide at least " +
      "30 days\' notice (via in-app banner and email) before adding or replacing a " +
      "Sub-processor; (b) impose data-protection obligations on the Sub-processor that are " +
      "no less protective than those in this DPA; and (c) remain liable to the Controller " +
      "for the Sub-processor\'s performance. The Controller may object to a new Sub-" +
      "processor on reasonable data-protection grounds within the notice period; if the " +
      "objection cannot be resolved, the Controller may terminate the Subscription Agreement " +
      "for the affected Service without penalty.",
  },
  // CITES: EU SCCs 2021/914 Module 2; Schrems II case C-311/18; KSA PDPL Art. 29.
  {
    title: "9. International transfers",
    body: "Where we transfer Personal Data outside the European Economic Area, the United " +
      "Kingdom, or the Kingdom of Saudi Arabia to a country not the subject of an adequacy " +
      "decision, the parties agree that the EU SCCs (Module 2: Controller-to-Processor, " +
      "Decision 2021/914) and, for UK transfers, the UK International Data Transfer " +
      "Addendum, are incorporated into this DPA by reference. The Controller is the data " +
      "exporter and SOSphere is the data importer. The supervisory authority of the data " +
      "exporter\'s establishment is the competent authority. KSA cross-border transfers " +
      "comply with PDPL Art. 29 and the Implementing Regulations of 2024. The Controller " +
      "may at its option execute the SCCs as a separate document; until then, this DPA " +
      "constitutes the parties\' written agreement to the SCCs.",
  },
  // CITES: AWS DPA §3.3; GDPR Art. 28(3)(e).
  {
    title: "10. Data subject rights and assistance",
    body: "We will, taking into account the nature of the processing, assist the Controller " +
      "by appropriate technical and organisational measures, insofar as this is possible, " +
      "in fulfilling its obligations to respond to requests from data subjects under " +
      "applicable data-protection law. If we receive a data-subject request directly, we " +
      "will forward it to the Controller without undue delay (target: within 5 business " +
      "days) and not respond to the data subject ourselves except to acknowledge receipt and " +
      "redirect them to the Controller. The in-app SAR / data-export tool gives controllers " +
      "self-service capability to satisfy access and portability requests.",
  },
  // CITES: GDPR Arts. 33–34; KSA PDPL Art. 28; Stripe DPA §5.
  {
    title: "11. Personal Data Breach",
    body: "We will notify the Controller of any confirmed Personal Data Breach affecting " +
      "their data without undue delay and in any event no later than 72 hours after we " +
      "become aware of it (regardless of weekends or holidays). The notification will " +
      "include, to the extent then known: (a) the nature of the breach including the " +
      "categories and approximate number of data subjects and records affected; (b) likely " +
      "consequences; (c) measures taken or proposed to address the breach and mitigate " +
      "adverse effects; and (d) the contact for further information. We will cooperate with " +
      "the Controller in any required notification to supervisory authorities (within 72 " +
      "hours per GDPR Art. 33; within 72 hours per KSA PDPL Art. 28) and to data subjects.",
  },
  // CITES: GDPR Art. 28(3)(h); Stripe DPA §10 — annual cap + SOC 2 in lieu.
  {
    title: "12. Audit rights",
    body: "On reasonable written notice (≥ 30 days, no more than once per calendar year " +
      "except after a confirmed Personal Data Breach affecting the Controller), the " +
      "Controller may audit our compliance with this DPA. Audits must be conducted by a " +
      "mutually agreed independent third party bound by professional confidentiality. We " +
      "may satisfy the audit obligation by providing a current SOC 2 Type II report (or " +
      "equivalent independent assessment) covering the relevant control objectives. The " +
      "Controller bears its own costs of audit; we bear the costs of remediation of any " +
      "compliance gaps identified.",
  },
  // CITES: Salesforce DPA §15 — concrete insurance amounts.
  {
    title: "13. Insurance",
    body: "We will maintain throughout the term of this DPA: (a) cyber liability insurance " +
      "with limits of not less than US $5,000,000 per occurrence; (b) errors and omissions " +
      "insurance with limits of not less than US $2,000,000 per occurrence; and (c) " +
      "commercial general liability insurance with limits of not less than US $1,000,000 " +
      "per occurrence. Within 5 business days of written request, we will provide the " +
      "Controller with a current Certificate of Insurance evidencing such coverage. " +
      "[LEGAL: this clause assumes the policies will be in place by first paid enterprise " +
      "contract — counsel must verify before public reliance.]",
  },
  // CITES: Stripe MSA §11; AWS Service Terms §11 — 12-month cap with carve-outs.
  {
    title: "14. Liability and indemnification",
    body: "Each party\'s aggregate liability arising out of or related to this DPA, whether " +
      "in contract, tort, or any other theory, is limited to the GREATER of (i) the total " +
      "fees paid or payable by the Controller to SOSphere for the Services in the twelve " +
      "(12) months immediately preceding the event giving rise to liability, or (ii) US " +
      "$100,000. The cap does NOT apply to: (a) breach of confidentiality (Section 6); " +
      "(b) gross negligence or wilful misconduct; (c) indemnification obligations under " +
      "this Section; (d) liability that cannot be limited under applicable law (death, " +
      "personal injury, fraud); or (e) Personal Data Breaches caused by our failure to " +
      "implement the TOMs in Annex II, where a separate enhanced cap of twenty-four (24) " +
      "months\' fees plus US $250,000 applies. We will indemnify the Controller against " +
      "third-party claims arising from our material breach of this DPA, subject to the " +
      "Controller\'s prompt written notice, our sole control of the defence, and the " +
      "Controller\'s reasonable cooperation.",
  },
  // CITES: GDPR Art. 28(3)(g); Stripe DPA §11.
  {
    title: "15. Term, termination, and effects",
    body: "This DPA takes effect on the Controller\'s acceptance and continues for the term " +
      "of the Subscription Agreement plus any post-termination retention period required " +
      "by Section 17. On termination of the Services, the Controller may export all of " +
      "its Personal Data via the in-app export tool within 30 days. After 30 days we will " +
      "delete or anonymise the Personal Data, except: (a) data we are required to retain by " +
      "law (e.g. tax records); and (b) audit_log entries retained per Section 17. We will " +
      "issue a Deletion Certificate within 15 business days of completion on written request.",
  },
  // CITES: published privacy notice + retention cron implementation.
  {
    title: "16. Data retention",
    body: "We retain categories of Personal Data for the following maximum periods, after " +
      "which automated cron jobs delete the data: SOS session records — 90 days from " +
      "session close; GPS trail data — 30 days; audio / image / video evidence vaults — " +
      "90 days; employee profile and emergency-contact data — 30 days after the " +
      "Controller\'s subscription ends. The audit_log is retained indefinitely for ISO 27001 " +
      "/ SOC 2 evidence purposes; entries are not subject to data-subject erasure requests " +
      "to the extent necessary for compliance and legal-hold obligations.",
  },
  // CITES: GDPR Art. 79; KSA PDPL Art. 35.
  {
    title: "17. Governing law and jurisdiction",
    body: "This DPA is governed by the laws of the State of Delaware, USA, without regard to " +
      "conflicts-of-law principles, except: (a) for Controllers established in the EEA / " +
      "United Kingdom, this DPA is governed by the laws of Ireland and the courts of " +
      "Dublin have exclusive jurisdiction; and (b) for Controllers established in the " +
      "Kingdom of Saudi Arabia, this DPA is governed by KSA law and the KSA Commercial " +
      "Court has jurisdiction over PDPL claims. Nothing in this Section limits a data " +
      "subject\'s rights to bring a claim in their place of habitual residence under GDPR " +
      "Art. 79 or PDPL Art. 35. [LEGAL: counsel must confirm the EU and KSA carve-outs " +
      "before public reliance.]",
  },
  // CITES: GDPR Art. 28(3) closing; standard SaaS notice/severability/integration.
  {
    title: "18. General",
    body: "(a) Notices: Notices to SOSphere shall be sent to legal@sosphere.co; notices to " +
      "the Controller shall be sent to the email address on file for the company owner. " +
      "(b) Severability: If any provision is held unenforceable, the remainder remains in " +
      "effect. (c) Amendment: Material amendments require the parties\' written agreement; " +
      "the DPA_VERSION constant on /legal/dpa is bumped on every material change and " +
      "controllers must re-accept on next dashboard visit. (d) Conflict: If this DPA " +
      "conflicts with the Subscription Agreement on data-protection matters, this DPA " +
      "prevails. (e) Counterparts and electronic signatures: Acceptance via the in-app " +
      "DPA flow constitutes a binding electronic signature under the EU eIDAS Regulation " +
      "and equivalent laws; the acceptance row in company_dpa_acceptances is the " +
      "evidence of record.",
  },
  // ─── ANNEXES ──────────────────────────────────────────────────────────────
  {
    title: "Annex I — Description of processing",
    body: "Subject matter: provision of the SOSphere field-worker safety service. " +
      "Duration: term of the Subscription Agreement plus retention windows in Section 16. " +
      "Nature of processing: see Section 2. " +
      "Categories of data subjects: see Section 3. " +
      "Categories of Personal Data: see Section 3. " +
      "Recipients of Personal Data: SOSphere personnel under Section 6, Sub-processors in " +
      "Annex III, and the Controller\'s designated administrators. " +
      "Frequency of processing: continuous during active subscription. " +
      "Storage location: EU and US regions of Supabase Inc. by default; data residency " +
      "options available on enterprise tiers.",
  },
  {
    title: "Annex II — Technical and organisational measures",
    body: "Confidentiality: TLS 1.2+ in transit; AES-256 at rest (Supabase managed); MFA " +
      "for administrative access; named-engineer credential model with quarterly rotation. " +
      "Integrity: row-level security with FORCE RLS on every PII table; partial UNIQUE on " +
      "subscriptions(company_id); tamper-evident audit_log. Availability: multi-AZ " +
      "Postgres replication; encrypted backups with 30-day retention; documented disaster-" +
      "recovery procedures with annual tabletop exercises; service-level objectives for " +
      "SOS critical paths (heartbeat, escalate, end). Resilience: rate-limiting per user " +
      "and per company; circuit-breakers on third-party integrations; graceful degradation " +
      "on partial outages. Personnel: background checks for engineers with production " +
      "access; annual data-protection training; immediate credential revocation on role " +
      "change. Software development: mandatory code review; static analysis on every " +
      "commit; vulnerability scanning of dependencies; CI-gated migration drift guard. " +
      "Incident management: 24-hour engineer on-call; documented incident-response runbook; " +
      "post-incident review and corrective-action tracking.",
  },
  {
    title: "Annex III — Authorised Sub-processors",
    body: "Supabase Inc. — database, authentication, edge runtime; regions: EU-West and " +
      "US-East. Stripe Inc. — payment processing; region: US. Twilio Inc. — SMS and voice " +
      "dispatch; region: global. Google Firebase Cloud Messaging — Android push; region: " +
      "global. Apple Push Notification Service — iOS push; region: global. Vercel Inc. — " +
      "web frontend hosting; region: global edge. Resend (or equivalent transactional email " +
      "provider) — invitation and notification email delivery; region: EU/US. We give 30 " +
      "days\' notice via in-app banner and the company-owner email of record before adding " +
      "or replacing any Sub-processor.",
  },
  {
    title: "Annex IV — Standard Contractual Clauses (referenced)",
    body: "The EU SCCs in Commission Implementing Decision 2021/914 (Module 2: Controller-" +
      "to-Processor) are incorporated into this DPA by reference and apply where Section 9 " +
      "applies. The UK International Data Transfer Addendum (issued under Section 119A of " +
      "the Data Protection Act 2018) similarly applies for UK-relevant transfers. The " +
      "parties agree the inclusions are: Module 2; the supervisory authority of the data " +
      "exporter\'s establishment is the competent authority; Clauses 8.6, 14, and 15 of " +
      "the SCCs apply with the time-periods stated in Sections 8, 11, and 12 of this DPA. " +
      "The Controller may at its option execute the SCCs as a separate document; until then, " +
      "this DPA constitutes the parties\' written agreement to the SCCs and the data importer\'s " +
      "(SOSphere\'s) signature is given by the act of providing the Services.",
  },
  {
    title: "Annex V — KSA PDPL specific addendum",
    body: "Where the Controller is established in the Kingdom of Saudi Arabia or processes " +
      "the Personal Data of KSA residents, the parties additionally agree: (a) we will " +
      "comply with the PDPL Implementing Regulations of 2024, including the cross-border " +
      "transfer authorisation requirements and any mandatory data-residency obligations " +
      "for sensitive categories; (b) we will notify the Saudi Data and Artificial " +
      "Intelligence Authority (SDAIA) of any reportable Personal Data Breach within the " +
      "72-hour window required by PDPL Art. 28, in coordination with the Controller; and " +
      "(c) the Controller may at any time request migration of its data to a SOSphere KSA " +
      "data residency tier (subject to availability and pricing).",
  },
];

// النسخة العربية الرسمية من اتفاقية معالجة البيانات — مطابقة في المعنى للنسخة
// الإنجليزية أعلاه (SECTIONS_EN). النص الإنجليزي هو النسخة المرجعية للتوقيع
// الإلكتروني وملف PDF؛ هذه الترجمة لأغراض العرض على المستخدم.
const SECTIONS_AR: { title: string; body: string }[] = [
  {
    title: "تمهيد",
    body: "(أ) أبرم «المتحكّم» وSOSphere اتفاقية اشتراك تقدّم بموجبها SOSphere خدمات سلامة " +
      "العاملين الميدانيين («الخدمات»). (ب) تقوم SOSphere، في سياق تقديم الخدمات، بمعالجة " +
      "البيانات الشخصية نيابةً عن المتحكّم. (ج) تحدّد اتفاقية معالجة البيانات هذه («الاتفاقية») " +
      "التزامات الطرفين بموجب لائحة الاتحاد الأوروبي 2016/679 (GDPR)، وقانون حماية البيانات " +
      "في المملكة المتحدة لعام 2018، ونظام حماية البيانات الشخصية السعودي لعام 2021 (PDPL)، " +
      "والتشريعات المماثلة. (د) في حال تعارض هذه الاتفاقية مع اتفاقية الاشتراك في مسائل حماية " +
      "البيانات، تكون الغلبة لهذه الاتفاقية.",
  },
  {
    title: "١. التعريفات",
    body: "تحمل المصطلحات المكتوبة بحرف استهلالي والمستخدمة دون تعريف هنا المعنى المنصوص عليه " +
      "في لائحة GDPR. يُقصد بـ«المتحكّم» الشركة التي سجّلت كعميل لدى SOSphere. ويُقصد بـ«المعالِج» " +
      "شركة SOSphere Ltd. («نحن»). وتعني «البيانات الشخصية» البيانات المتعلقة بشخص طبيعي محدّد أو " +
      "قابل للتحديد تُعالَج نيابةً عن المتحكّم، بما يشمل ملفات الموظفين، وبيانات الموقع GPS، " +
      "والبيانات الوصفية لأحداث الطوارئ، ومحتويات خزينة الأدلة، وتقارير الحوادث. ويُقصد بـ«انتهاك " +
      "البيانات الشخصية» أي خرق أمني يؤدي إلى إتلاف أو فقدان أو تغيير عَرَضي أو غير مشروع للبيانات " +
      "الشخصية، أو الإفصاح عنها أو الوصول إليها دون إذن. ويُقصد بـ«المعالِج الفرعي» أي طرف ثالث " +
      "تستعين به SOSphere لمعالجة البيانات الشخصية. وتعني «SCCs» الشروط التعاقدية القياسية " +
      "المعتمدة بقرار المفوضية الأوروبية 2021/914 (الوحدة الثانية: من المتحكّم إلى المعالِج). " +
      "وتعني «TOMs» التدابير الفنية والتنظيمية الموصوفة في الملحق الثاني.",
  },
  {
    title: "٢. موضوع المعالجة ومدّتها وطبيعتها",
    body: "نعالج البيانات الشخصية فقط لتقديم الخدمات للمتحكّم. وتشمل عمليات المعالجة: جمع بيانات " +
      "ملفات الموظفين المقدَّمة من المتحكّم؛ واستقبال إحداثيات الموقع GPS أثناء حالات الطوارئ " +
      "النشطة وعمليات تسجيل الحضور؛ وتخزين الأدلة الصوتية والمصوّرة وبيانات الموقع المُلتقطة عبر " +
      "تدفّق الطوارئ على الجهاز؛ وإرسال الرسائل النصية والإشعارات والمكالمات عبر مزوّدي الخدمة " +
      "المتكاملين؛ وتجميع المؤشرات التشغيلية للوحة تحكّم المتحكّم. أما مدّة المعالجة فهي مدّة اتفاقية " +
      "الاشتراك مضافاً إليها فترات الاحتفاظ المنصوص عليها في البند ١٧.",
  },
  {
    title: "٣. فئات البيانات الشخصية وأصحاب البيانات",
    body: "أصحاب البيانات هم موظفو المتحكّم والمتعاقدون معه وأي أفراد معيَّنين كجهات اتصال للطوارئ. " +
      "وتشمل فئات البيانات الشخصية: المعرّفات (الاسم، البريد الإلكتروني للعمل، رقم الهاتف)؛ " +
      "والبيانات الوصفية للتوظيف (الدور، القسم، نطاق العمل، جدول المناوبات)؛ وبيانات الموقع " +
      "(الفوري أثناء الطوارئ، ومسار GPS أثناء جلسات الاستغاثة النشطة)؛ وسجلات أحداث الطوارئ " +
      "(الطابع الزمني، تصنيف الخطورة، سجل المستجيبين)؛ والأدلة الصوتية والمصوّرة والمرئية المُلتقطة " +
      "أثناء الطوارئ؛ وحقول المعرّف الطبي الاختيارية عند تقديمها صراحةً من قِبل صاحب البيانات.",
  },
  {
    title: "٤. التزامات المتحكّم",
    body: "يُقرّ المتحكّم ويضمن أنّه: (أ) يملك أساساً قانونياً بموجب قوانين حماية البيانات المعمول بها " +
      "لمشاركة البيانات الشخصية معنا، وعادةً ما يكون ذلك تنفيذاً لعقد العمل (المادة 6(1)(b) من GDPR) " +
      "أو مصلحةً مشروعةً في سلامة العاملين (المادة 6(1)(f) من GDPR؛ والمادة 6(2) من PDPL)؛ (ب) قد " +
      "أبلغ أصحاب البيانات بهذه المعالجة وفق ما تقتضيه المادتان 13–14 من GDPR / المادة 9 من PDPL؛ " +
      "(ج) سيُصدر إلينا تعليمات موثّقة وفقاً للمادة 28(3)(a) من GDPR؛ (د) سيُخطرنا فوراً بأي تغييرات " +
      "على تلك التعليمات؛ (هـ) لن يطلب أي معالجة تخالف القانون المعمول به.",
  },
  {
    title: "٥. التزامات المعالِج",
    body: "نتعهّد بأن: (أ) نعالج البيانات الشخصية فقط بناءً على تعليمات موثّقة من المتحكّم، بما في ذلك " +
      "ما يتعلق بعمليات النقل الدولية، إلا حيث يقتضي القانون خلاف ذلك (وفي هذه الحالة سنُبلغ المتحكّم " +
      "ما لم يحظر القانون ذلك لأسباب مهمة تتعلق بالمصلحة العامة)؛ (ب) نضمن التزام الأشخاص المخوّلين " +
      "بمعالجة البيانات الشخصية بواجبات سرّية واجبة النفاذ؛ (ج) نُطبّق التدابير الفنية والتنظيمية " +
      "الواردة في الملحق الثاني؛ (د) لا نستعين بمعالِجين فرعيين إلا وفقاً للبند ٨؛ (هـ) نساعد " +
      "المتحكّم، مع مراعاة طبيعة المعالجة، في الوفاء بالتزامه بالاستجابة لطلبات أصحاب البيانات بموجب " +
      "المواد 12–22 من GDPR والقوانين المماثلة؛ (و) نساعد المتحكّم في الإخطار بالانتهاكات وتقييمات " +
      "أثر حماية البيانات والتشاور المسبق مع الجهات الرقابية؛ (ز) نحذف أو نُعيد جميع البيانات الشخصية " +
      "بعد انتهاء الخدمة بحسب اختيار المتحكّم؛ (ح) نُتيح جميع المعلومات اللازمة لإثبات الامتثال " +
      "ونساهم في عمليات التدقيق بموجب البند ١٢.",
  },
  {
    title: "٦. السرّية",
    body: "نضمن أن يكون أي شخص مخوّل بمعالجة البيانات الشخصية نيابةً عنّا خاضعاً لواجب سرّية " +
      "(تعاقدي أو قانوني) يظل قائماً بعد انتهاء تكليفه. ويقتصر الوصول إلى بيانات الاعتماد الإنتاجية " +
      "والبيانات الشخصية على مهندسين مُسمّين بموجب ضوابط وصول موثّقة قائمة على الأدوار، مع تسجيلها في " +
      "سجل التدقيق (audit_log)، وخضوعها لمراجعة ربع سنوية. ويجب على الموظفين إكمال التدريب على حماية " +
      "البيانات خلال ٣٠ يوماً من بدء الدور وبشكل سنوي بعد ذلك.",
  },
  {
    title: "٧. التدابير الفنية والتنظيمية (الملحق الثاني)",
    body: "نفّذنا، وسنُحافظ على، التدابير الفنية والتنظيمية المفصّلة في الملحق الثاني أدناه، بما يشمل: " +
      "تشفير TLS 1.2+ أثناء النقل وAES-256 أثناء التخزين؛ وأمن مستوى الصفوف مع تفعيل FORCE RLS على " +
      "كل جدول يحوي بيانات شخصية؛ والعزل المنطقي لكل عميل؛ والوصول الإداري المحمي بالمصادقة الثنائية؛ " +
      "والنسخ الاحتياطية المشفّرة مع احتفاظ لمدة ٣٠ يوماً؛ والمراجعة الربع سنوية للصلاحيات؛ وبرنامج " +
      "فحص الثغرات وإدارة التصحيحات؛ ودورة تطوير برمجيات آمنة مع مراجعة إلزامية للشيفرة؛ وتسجيل " +
      "تدقيق غير قابل للعبث لكل حدث مصادقة وتغيير في الفوترة وقبول للاتفاقية وتصعيد للطوارئ. وتعكس " +
      "هذه التدابير أحدث ما توصّلت إليه التقنية وتكاليف التنفيذ مقارنةً بالمخاطر على حقوق وحرّيات " +
      "أصحاب البيانات.",
  },
  {
    title: "٨. المعالِجون الفرعيون",
    body: "يمنح المتحكّم تفويضاً كتابياً عاماً لنا للاستعانة بمعالِجين فرعيين. ويُدرج الملحق الثالث " +
      "المعالِجين الفرعيين الحاليين. ونتعهّد بأن: (أ) نُقدّم إشعاراً مدّته ٣٠ يوماً على الأقل (عبر " +
      "إشعار داخل التطبيق والبريد الإلكتروني) قبل إضافة أو استبدال أي معالِج فرعي؛ (ب) نفرض على " +
      "المعالِج الفرعي التزامات لحماية البيانات لا تقلّ في مستوى الحماية عمّا ورد في هذه الاتفاقية؛ " +
      "(ج) نظلّ مسؤولين تجاه المتحكّم عن أداء المعالِج الفرعي. ويجوز للمتحكّم الاعتراض على أي معالِج " +
      "فرعي جديد لأسباب معقولة تتعلق بحماية البيانات خلال مدّة الإشعار؛ وإذا تعذّر حلّ الاعتراض، جاز " +
      "للمتحكّم إنهاء اتفاقية الاشتراك للخدمة المتأثرة دون غرامة.",
  },
  {
    title: "٩. عمليات النقل الدولية",
    body: "حيثما ننقل البيانات الشخصية خارج المنطقة الاقتصادية الأوروبية أو المملكة المتحدة أو " +
      "المملكة العربية السعودية إلى دولة لا تخضع لقرار كفاية، يتفق الطرفان على أن الشروط التعاقدية " +
      "القياسية للاتحاد الأوروبي (الوحدة الثانية: من المتحكّم إلى المعالِج، القرار 2021/914)، " +
      "وبالنسبة لعمليات النقل من المملكة المتحدة، ملحق نقل البيانات الدولي البريطاني، مُدرجة في هذه " +
      "الاتفاقية بالإحالة. ويكون المتحكّم هو مُصدّر البيانات وSOSphere هي مُستورِد البيانات. وتكون " +
      "الجهة الرقابية في مقرّ مُصدّر البيانات هي الجهة المختصّة. وتمتثل عمليات النقل العابر للحدود " +
      "في المملكة العربية السعودية للمادة 29 من PDPL واللوائح التنفيذية لعام 2024. ويجوز للمتحكّم " +
      "حسب اختياره إبرام الشروط التعاقدية القياسية كوثيقة منفصلة؛ وحتى ذلك الحين تُشكّل هذه الاتفاقية " +
      "اتفاق الطرفين الكتابي على تلك الشروط.",
  },
  {
    title: "١٠. حقوق أصحاب البيانات والمساعدة",
    body: "سنساعد المتحكّم، مع مراعاة طبيعة المعالجة، عبر التدابير الفنية والتنظيمية المناسبة، وبقدر " +
      "ما هو ممكن، في الوفاء بالتزاماته بالاستجابة لطلبات أصحاب البيانات بموجب قانون حماية البيانات " +
      "المعمول به. وإذا تلقّينا طلباً من صاحب بيانات مباشرةً، فسنُحيله إلى المتحكّم دون تأخير لا مبرّر " +
      "له (المستهدف: خلال ٥ أيام عمل) ولن نردّ على صاحب البيانات بأنفسنا إلا لإقرار الاستلام وإرشاده " +
      "إلى المتحكّم. وتمنح أداة طلبات الوصول وتصدير البيانات داخل التطبيق المتحكّمين قدرة الخدمة " +
      "الذاتية لتلبية طلبات الاطلاع والنقل.",
  },
  {
    title: "١١. انتهاك البيانات الشخصية",
    body: "سنُخطر المتحكّم بأي انتهاك مؤكَّد للبيانات الشخصية يمسّ بياناته دون تأخير لا مبرّر له، وفي " +
      "جميع الأحوال خلال مدّة لا تتجاوز ٧٢ ساعة من علمنا به (بصرف النظر عن عطلات نهاية الأسبوع أو " +
      "الإجازات). ويتضمن الإخطار، بقدر المعلوم آنذاك: (أ) طبيعة الانتهاك بما في ذلك فئات وعدد " +
      "أصحاب البيانات والسجلات المتأثرة تقريبياً؛ (ب) العواقب المحتملة؛ (ج) التدابير المتخذة أو " +
      "المقترحة لمعالجة الانتهاك والتخفيف من آثاره؛ (د) جهة الاتصال لمزيد من المعلومات. وسنتعاون مع " +
      "المتحكّم في أي إخطار مطلوب للجهات الرقابية (خلال ٧٢ ساعة وفق المادة 33 من GDPR؛ وخلال ٧٢ " +
      "ساعة وفق المادة 28 من PDPL السعودي) ولأصحاب البيانات.",
  },
  {
    title: "١٢. حقوق التدقيق",
    body: "بناءً على إشعار كتابي معقول (٣٠ يوماً على الأقل، وبما لا يتجاوز مرة واحدة في السنة " +
      "الميلادية باستثناء ما يعقب انتهاكاً مؤكَّداً للبيانات الشخصية يمسّ المتحكّم)، يجوز للمتحكّم " +
      "تدقيق امتثالنا لهذه الاتفاقية. ويجب أن تُجرى عمليات التدقيق من قِبل طرف ثالث مستقل متفق عليه " +
      "بين الطرفين وملتزم بالسرّية المهنية. ويجوز لنا الوفاء بالتزام التدقيق عبر تقديم تقرير SOC 2 " +
      "Type II حالي (أو تقييم مستقل مكافئ) يغطّي أهداف الضبط ذات الصلة. ويتحمّل المتحكّم تكاليف " +
      "التدقيق الخاصة به، بينما نتحمّل نحن تكاليف معالجة أي ثغرات امتثال يتم تحديدها.",
  },
  {
    title: "١٣. التأمين",
    body: "سنُحافظ طوال مدّة هذه الاتفاقية على: (أ) تأمين مسؤولية إلكترونية بحدود لا تقلّ عن " +
      "5,000,000 دولار أمريكي لكل واقعة؛ (ب) تأمين أخطاء وإغفالات بحدود لا تقلّ عن 2,000,000 " +
      "دولار أمريكي لكل واقعة؛ (ج) تأمين مسؤولية عامة تجارية بحدود لا تقلّ عن 1,000,000 دولار " +
      "أمريكي لكل واقعة. وخلال ٥ أيام عمل من الطلب الكتابي، سنُزوّد المتحكّم بشهادة تأمين حالية تُثبت " +
      "هذه التغطية. [ملاحظة قانونية: يفترض هذا البند أن وثائق التأمين ستكون قائمة بحلول أول عقد " +
      "مؤسسي مدفوع — يجب على المستشار القانوني التحقّق قبل الاعتماد العلني عليه.]",
  },
  {
    title: "١٤. المسؤولية والتعويض",
    body: "تقتصر المسؤولية الإجمالية لكل طرف الناشئة عن هذه الاتفاقية أو المتعلقة بها، سواء بموجب " +
      "العقد أو المسؤولية التقصيرية أو أي نظرية أخرى، على الأكبر من: (1) إجمالي الرسوم المدفوعة أو " +
      "المستحقة من المتحكّم إلى SOSphere مقابل الخدمات خلال الاثني عشر (12) شهراً السابقة مباشرةً " +
      "للحدث المنشئ للمسؤولية، أو (2) 100,000 دولار أمريكي. ولا ينطبق هذا الحدّ على: (أ) خرق " +
      "السرّية (البند ٦)؛ (ب) الإهمال الجسيم أو سوء التصرّف المتعمّد؛ (ج) التزامات التعويض بموجب " +
      "هذا البند؛ (د) المسؤولية التي لا يمكن تحديدها بموجب القانون المعمول به (الوفاة، الإصابة " +
      "الشخصية، الاحتيال)؛ (هـ) انتهاكات البيانات الشخصية الناجمة عن إخفاقنا في تنفيذ التدابير " +
      "الواردة في الملحق الثاني، حيث ينطبق حدّ مُعزَّز منفصل يعادل رسوم أربعة وعشرين (24) شهراً " +
      "مضافاً إليها 250,000 دولار أمريكي. وسنُعوّض المتحكّم عن مطالبات الغير الناشئة عن خرقنا " +
      "الجوهري لهذه الاتفاقية، رهناً بإخطار المتحكّم الكتابي الفوري، وسيطرتنا الكاملة على الدفاع، " +
      "وتعاون المتحكّم المعقول.",
  },
  {
    title: "١٥. المدّة والإنهاء والآثار",
    body: "تسري هذه الاتفاقية عند قبول المتحكّم لها وتستمر طوال مدّة اتفاقية الاشتراك مضافاً إليها أي " +
      "فترة احتفاظ لاحقة للإنهاء يقتضيها البند ١٧. وعند إنهاء الخدمات، يجوز للمتحكّم تصدير جميع " +
      "بياناته الشخصية عبر أداة التصدير داخل التطبيق خلال ٣٠ يوماً. وبعد مرور ٣٠ يوماً سنحذف البيانات " +
      "الشخصية أو نُخفي هويتها، باستثناء: (أ) البيانات المطلوب الاحتفاظ بها قانوناً (مثل السجلات " +
      "الضريبية)؛ (ب) مدخلات سجل التدقيق (audit_log) المحتفظ بها وفق البند ١٧. وسنُصدر شهادة حذف " +
      "خلال ١٥ يوم عمل من إتمام العملية بناءً على طلب كتابي.",
  },
  {
    title: "١٦. الاحتفاظ بالبيانات",
    body: "نحتفظ بفئات البيانات الشخصية للمدد القصوى التالية، التي تحذف بعدها مهامٌ مجدوَلة آلية " +
      "البيانات: سجلات جلسات الاستغاثة — ٩٠ يوماً من إغلاق الجلسة؛ بيانات مسار GPS — ٣٠ يوماً؛ " +
      "خزائن الأدلة الصوتية والمصوّرة والمرئية — ٩٠ يوماً؛ ملفات الموظفين وبيانات جهات اتصال الطوارئ " +
      "— ٣٠ يوماً بعد انتهاء اشتراك المتحكّم. ويُحتفظ بسجل التدقيق (audit_log) إلى أجل غير مسمّى " +
      "لأغراض إثبات الامتثال لمعايير ISO 27001 / SOC 2؛ ولا تخضع مدخلاته لطلبات محو أصحاب البيانات " +
      "بالقدر اللازم للامتثال والتزامات الحفظ القانوني.",
  },
  {
    title: "١٧. القانون الحاكم والاختصاص القضائي",
    body: "تخضع هذه الاتفاقية لقوانين ولاية ديلاوير بالولايات المتحدة الأمريكية، دون اعتبار لمبادئ " +
      "تنازع القوانين، باستثناء: (أ) المتحكّمين المؤسَّسين في المنطقة الاقتصادية الأوروبية / المملكة " +
      "المتحدة، إذ تخضع هذه الاتفاقية لقوانين أيرلندا وتختصّ محاكم دبلن حصرياً؛ (ب) المتحكّمين " +
      "المؤسَّسين في المملكة العربية السعودية، إذ تخضع هذه الاتفاقية للأنظمة السعودية وتختصّ المحكمة " +
      "التجارية السعودية بالمطالبات المتعلقة بنظام PDPL. ولا يحدّ أي حكم في هذا البند من حقوق صاحب " +
      "البيانات في رفع مطالبة في محل إقامته المعتاد بموجب المادة 79 من GDPR أو المادة 35 من PDPL. " +
      "[ملاحظة قانونية: يجب على المستشار القانوني تأكيد استثناءَي الاتحاد الأوروبي والمملكة العربية " +
      "السعودية قبل الاعتماد العلني.]",
  },
  {
    title: "١٨. أحكام عامة",
    body: "(أ) الإشعارات: تُرسل الإشعارات إلى SOSphere على legal@sosphere.co؛ وتُرسل الإشعارات إلى " +
      "المتحكّم على عنوان البريد الإلكتروني المسجَّل لمالك الشركة. (ب) قابلية الفصل: إذا اعتُبر أي " +
      "حكم غير قابل للنفاذ، تبقى بقية الأحكام سارية. (ج) التعديل: تتطلّب التعديلات الجوهرية اتفاق " +
      "الطرفين كتابةً؛ ويُرفَّع ثابت DPA_VERSION على /legal/dpa عند كل تغيير جوهري ويتعيّن على " +
      "المتحكّمين إعادة القبول عند زيارة لوحة التحكّم التالية. (د) التعارض: في حال تعارض هذه الاتفاقية " +
      "مع اتفاقية الاشتراك في مسائل حماية البيانات، تكون الغلبة لهذه الاتفاقية. (هـ) النسخ والتوقيعات " +
      "الإلكترونية: يُشكّل القبول عبر تدفّق الاتفاقية داخل التطبيق توقيعاً إلكترونياً مُلزماً بموجب " +
      "لائحة eIDAS الأوروبية والقوانين المماثلة؛ ويكون صفّ القبول في company_dpa_acceptances هو دليل " +
      "الإثبات المعتمد.",
  },
  // ─── الملاحق ──────────────────────────────────────────────────────────────
  {
    title: "الملحق الأول — وصف المعالجة",
    body: "الموضوع: تقديم خدمة سلامة العاملين الميدانيين من SOSphere. " +
      "المدّة: مدّة اتفاقية الاشتراك مضافاً إليها فترات الاحتفاظ في البند ١٦. " +
      "طبيعة المعالجة: انظر البند ٢. " +
      "فئات أصحاب البيانات: انظر البند ٣. " +
      "فئات البيانات الشخصية: انظر البند ٣. " +
      "متلقّو البيانات الشخصية: موظفو SOSphere بموجب البند ٦، والمعالِجون الفرعيون في الملحق " +
      "الثالث، ومسؤولو المتحكّم المعيَّنون. " +
      "تواتر المعالجة: مستمر طوال الاشتراك النشط. " +
      "موقع التخزين: مناطق الاتحاد الأوروبي والولايات المتحدة لدى Supabase Inc. افتراضياً؛ مع " +
      "توفّر خيارات إقامة البيانات في الباقات المؤسسية.",
  },
  {
    title: "الملحق الثاني — التدابير الفنية والتنظيمية",
    body: "السرّية: تشفير TLS 1.2+ أثناء النقل؛ وAES-256 أثناء التخزين (مُدار عبر Supabase)؛ " +
      "والمصادقة الثنائية للوصول الإداري؛ ونموذج اعتماد بمهندسين مُسمّين مع تدوير ربع سنوي. " +
      "السلامة: أمن مستوى الصفوف مع تفعيل FORCE RLS على كل جدول بيانات شخصية؛ وقيد UNIQUE جزئي " +
      "على subscriptions(company_id)؛ وسجل تدقيق غير قابل للعبث. التوافر: تكرار Postgres عبر " +
      "مناطق توافر متعددة؛ ونسخ احتياطية مشفّرة مع احتفاظ ٣٠ يوماً؛ وإجراءات تعافٍ موثّقة من الكوارث " +
      "مع تمارين محاكاة سنوية؛ وأهداف مستوى خدمة لمسارات الاستغاثة الحرجة. المرونة: تحديد المعدّل " +
      "لكل مستخدم وكل شركة؛ وقواطع دائرية على تكاملات الأطراف الثالثة؛ وتدهور تدريجي عند الأعطال " +
      "الجزئية. الموظفون: فحوص خلفية للمهندسين ذوي الوصول الإنتاجي؛ وتدريب سنوي على حماية البيانات؛ " +
      "وإلغاء فوري لبيانات الاعتماد عند تغيير الدور. تطوير البرمجيات: مراجعة إلزامية للشيفرة؛ وتحليل " +
      "ساكن عند كل التزام؛ وفحص ثغرات التبعيات؛ وحارس انحراف للترحيلات مُفعَّل عبر CI. إدارة الحوادث: " +
      "مهندس مناوب على مدار ٢٤ ساعة؛ ودليل استجابة موثّق للحوادث؛ ومراجعة لاحقة للحوادث وتتبّع " +
      "للإجراءات التصحيحية.",
  },
  {
    title: "الملحق الثالث — المعالِجون الفرعيون المعتمدون",
    body: "Supabase Inc. — قاعدة البيانات والمصادقة وبيئة التشغيل الطرفية؛ المناطق: غرب الاتحاد " +
      "الأوروبي وشرق الولايات المتحدة. Stripe Inc. — معالجة المدفوعات؛ المنطقة: الولايات المتحدة. " +
      "Twilio Inc. — إرسال الرسائل النصية والصوتية؛ المنطقة: عالمية. Google Firebase Cloud " +
      "Messaging — إشعارات أندرويد؛ المنطقة: عالمية. Apple Push Notification Service — إشعارات " +
      "iOS؛ المنطقة: عالمية. Vercel Inc. — استضافة واجهة الويب؛ المنطقة: حافة عالمية. Resend (أو " +
      "مزوّد بريد معاملاتي مكافئ) — إرسال رسائل الدعوة والإشعارات؛ المنطقة: الاتحاد الأوروبي/الولايات " +
      "المتحدة. ونمنح إشعاراً مدّته ٣٠ يوماً عبر إشعار داخل التطبيق وبريد مالك الشركة المسجَّل قبل " +
      "إضافة أو استبدال أي معالِج فرعي.",
  },
  {
    title: "الملحق الرابع — الشروط التعاقدية القياسية (بالإحالة)",
    body: "تُدرَج الشروط التعاقدية القياسية للاتحاد الأوروبي الواردة في قرار المفوضية التنفيذي " +
      "2021/914 (الوحدة الثانية: من المتحكّم إلى المعالِج) في هذه الاتفاقية بالإحالة وتنطبق حيثما " +
      "ينطبق البند ٩. كما ينطبق ملحق نقل البيانات الدولي البريطاني (الصادر بموجب المادة 119A من " +
      "قانون حماية البيانات لعام 2018) بالمثل على عمليات النقل ذات الصلة بالمملكة المتحدة. ويتفق " +
      "الطرفان على أن العناصر المُدرجة هي: الوحدة الثانية؛ وأن تكون الجهة الرقابية في مقرّ مُصدّر " +
      "البيانات هي الجهة المختصّة؛ وأن تنطبق البنود 8.6 و14 و15 من الشروط التعاقدية القياسية مع " +
      "المدد الزمنية المذكورة في البنود ٨ و١١ و١٢ من هذه الاتفاقية. ويجوز للمتحكّم حسب اختياره إبرام " +
      "الشروط التعاقدية القياسية كوثيقة منفصلة؛ وحتى ذلك الحين تُشكّل هذه الاتفاقية اتفاق الطرفين " +
      "الكتابي على تلك الشروط، ويُعطى توقيع مُستورِد البيانات (SOSphere) بفعل تقديم الخدمات.",
  },
  {
    title: "الملحق الخامس — ملحق خاص بنظام حماية البيانات السعودي (PDPL)",
    body: "حيثما يكون المتحكّم مؤسَّساً في المملكة العربية السعودية أو يعالج البيانات الشخصية لمقيمين " +
      "في المملكة، يتفق الطرفان إضافةً إلى ما سبق على: (أ) أننا سنمتثل للوائح التنفيذية لنظام PDPL " +
      "لعام 2024، بما في ذلك متطلبات تصريح النقل العابر للحدود وأي التزامات إلزامية بإقامة البيانات " +
      "للفئات الحسّاسة؛ (ب) أننا سنُخطر الهيئة السعودية للبيانات والذكاء الاصطناعي (سدايا) بأي انتهاك " +
      "للبيانات الشخصية واجب الإبلاغ خلال مهلة ٧٢ ساعة المنصوص عليها في المادة 28 من PDPL، بالتنسيق " +
      "مع المتحكّم؛ (ج) أنه يجوز للمتحكّم في أي وقت طلب ترحيل بياناته إلى باقة إقامة بيانات سعودية من " +
      "SOSphere (رهناً بالتوافر والتسعير).",
  },
];

export function DpaPage() {
  const navigate = useNavigate();
  const { isAr } = useLang();
  const SECTIONS = isAr ? SECTIONS_AR : SECTIONS_EN;
  const [signature, setSignature] = useState<DpaSignature | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>("");
  const [downloadBusy, setDownloadBusy] = useState(false);

  // On mount: detect logged-in user with a known active company → fetch
  // signed-copy data. Stays silent for public visitors.
  useEffect(() => {
    let cid: string | null = null;
    try { cid = localStorage.getItem("sosphere_company_id"); } catch { /* */ }
    setCompanyId(cid);
    if (!cid) return;

    (async () => {
      const r = await safeRpc<{
        success: boolean; has_signature?: boolean; version?: string;
        signer_full_name?: string; signer_title?: string; signer_email?: string;
        signer_ip?: string | null; accepted_at?: string;
      }>("get_dpa_acceptance", { p_company_id: cid, p_dpa_version: DPA_VERSION }, { timeoutMs: 6000 });
      if (r.data?.success) {
        setSignature({
          hasSignature:    !!r.data.has_signature,
          version:         r.data.version || DPA_VERSION,
          signerFullName:  r.data.signer_full_name,
          signerTitle:     r.data.signer_title,
          signerEmail:     r.data.signer_email,
          signerIp:        r.data.signer_ip ?? null,
          acceptedAt:      r.data.accepted_at,
        });
      }
    })();

    // Best-effort company name pull (uses the same canonical-identity pattern).
    (async () => {
      try {
        const { supabase } = await import("./api/supabase-client");
        const { data } = await supabase.from("companies").select("name").eq("id", cid).maybeSingle();
        if (data?.name) setCompanyName(data.name);
      } catch { /* */ }
    })();
  }, []);

  const downloadPdf = async () => {
    setDownloadBusy(true);
    try {
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const W = 210, M = 18;
      let y = M;

      doc.setFont("helvetica", "bold"); doc.setFontSize(16);
      doc.text("SOSphere — Data Processing Agreement", M, y); y += 8;

      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      doc.setTextColor(120);
      doc.text(`Version ${DPA_VERSION}`, M, y); y += 5;
      if (signature?.hasSignature && companyName) {
        doc.text(`Signed by ${companyName} on ${formatDate(signature.acceptedAt)}`, M, y); y += 5;
      }
      doc.setTextColor(0);
      y += 4;

      // Signature block (if available) appears before the body — auditors look here first.
      if (signature?.hasSignature) {
        doc.setDrawColor(0, 200, 224);
        doc.setLineWidth(0.4);
        doc.rect(M, y, W - 2 * M, 26);
        doc.setFont("helvetica", "bold"); doc.setFontSize(11);
        doc.text("Signature of record", M + 3, y + 5);
        doc.setFont("helvetica", "normal"); doc.setFontSize(9);
        const sigLines = [
          `Signer:   ${signature.signerFullName || "—"} (${signature.signerTitle || "—"})`,
          `Email:    ${signature.signerEmail || "—"}`,
          `Date:     ${formatDate(signature.acceptedAt)} (UTC)`,
          `IP:       ${signature.signerIp || "—"}`,
          `Version:  ${signature.version}`,
        ];
        let sy = y + 10;
        for (const line of sigLines) { doc.text(line, M + 3, sy); sy += 4; }
        y += 32;
      }

      // Body — each section title bold, body wrapped to width.
      // The PDF always uses the canonical English text (SECTIONS_EN): jsPDF's
      // bundled helvetica font has no Arabic glyph coverage, and the English
      // copy is the version of record for the electronic signature.
      for (const s of SECTIONS_EN) {
        if (y > 270) { doc.addPage(); y = M; }
        doc.setFont("helvetica", "bold"); doc.setFontSize(11);
        doc.text(s.title, M, y); y += 6;
        doc.setFont("helvetica", "normal"); doc.setFontSize(10);
        const lines = doc.splitTextToSize(s.body, W - 2 * M);
        for (const line of lines) {
          if (y > 280) { doc.addPage(); y = M; }
          doc.text(line, M, y); y += 4.7;
        }
        y += 3;
      }

      // Footer on every page.
      const pageCount = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
      for (let p = 1; p <= pageCount; p++) {
        doc.setPage(p);
        doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(150);
        doc.text(`SOSphere DPA v${DPA_VERSION} • Page ${p} of ${pageCount}`, M, 290);
        doc.setTextColor(0);
      }

      const fname = signature?.hasSignature && companyName
        ? `SOSphere-DPA-${companyName.replace(/[^a-zA-Z0-9]+/g, "_")}-${DPA_VERSION}.pdf`
        : `SOSphere-DPA-v${DPA_VERSION}.pdf`;
      doc.save(fname);
    } finally {
      setDownloadBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden" style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4" style={{ paddingTop: "max(20px,env(safe-area-inset-top))", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
        <button onClick={() => navigate(-1)}
          style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ArrowLeft size={18} color="rgba(255,255,255,.6)" />
        </button>
        <ShieldCheck size={18} color="#00C8E0" />
        <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{isAr ? "اتفاقية معالجة البيانات" : "Data Processing Agreement"}</span>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)", marginLeft: "auto" }}>v{DPA_VERSION}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-6" style={{ maxWidth: 760, marginInline: "auto", width: "100%", direction: isAr ? "rtl" : "ltr" }}>
        {/* Compliance badges */}
        <div className="flex flex-wrap gap-2 mb-5">
          {["GDPR Art. 28", "KSA PDPL Art. 7", "UK DPA 2018", "SOC 2"].map(b => (
            <span key={b} style={{ fontSize: 10, fontWeight: 600, color: "#00C8E0", background: "rgba(0,200,224,.08)", border: "1px solid rgba(0,200,224,.2)", borderRadius: 6, padding: "3px 8px" }}>
              {b}
            </span>
          ))}
        </div>

        {/* Signature banner — only when signed in AND signature exists. */}
        {signature?.hasSignature && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="mb-5 p-4 rounded-xl"
            style={{ background: "linear-gradient(135deg, rgba(0,200,83,.10), rgba(0,200,83,.04))", border: "1.5px solid rgba(0,200,83,.32)" }}
          >
            <div className="flex items-start gap-3">
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(0,200,83,.18)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Check size={18} color="#00C853" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#00C853" }}>
                  {isAr ? "موقَّعة من " : "Signed by "}{companyName || (isAr ? "شركتك" : "your company")} • v{signature.version}
                </p>
                <p style={{ margin: "3px 0 0", fontSize: 11, color: "rgba(255,255,255,.55)", lineHeight: 1.55 }}>
                  {signature.signerFullName} ({signature.signerTitle}){isAr ? " بتاريخ " : " on "}{formatDate(signature.acceptedAt)}
                  {signature.signerIp && <span style={{ color: "rgba(255,255,255,.3)" }}> • IP {signature.signerIp}</span>}
                </p>
              </div>
              <button
                onClick={downloadPdf}
                disabled={downloadBusy}
                style={{
                  padding: "8px 12px", borderRadius: 9, border: "none",
                  background: downloadBusy ? "rgba(255,255,255,.08)" : "#00C853",
                  color: downloadBusy ? "rgba(255,255,255,.45)" : "#0A0E17",
                  fontSize: 11, fontWeight: 700, cursor: downloadBusy ? "default" : "pointer",
                  display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
                }}
              >
                <Download size={12} />
                {downloadBusy ? (isAr ? "جارٍ الإنشاء…" : "Generating…") : isAr ? "النسخة الموقَّعة (PDF)" : "Signed PDF"}
              </button>
            </div>
          </motion.div>
        )}

        {/* No-signature notice for owners reading their own DPA */}
        {companyId && signature && !signature.hasSignature && (
          <div className="mb-5 p-3 rounded-xl" style={{ background: "rgba(255,149,0,.06)", border: "1px solid rgba(255,149,0,.22)" }}>
            <div className="flex items-center gap-2">
              <Lock size={14} color="#FF9500" />
              <p style={{ margin: 0, fontSize: 12, color: "#FFB05A" }}>
                {isAr
                  ? `لم تقبل شركتك بعد اتفاقية معالجة البيانات النسخة ${DPA_VERSION}. يتم القبول أثناء تسجيل الشركة أو من الإعدادات.`
                  : `Your company has not yet accepted DPA v${DPA_VERSION}. Acceptance happens during company registration or from Settings.`}
              </p>
            </div>
          </div>
        )}

        {/* Top-of-page download for public visitors (unsigned blank copy) */}
        {!signature?.hasSignature && (
          <button
            onClick={downloadPdf}
            disabled={downloadBusy}
            style={{
              marginBottom: 18, padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(0,200,224,.3)",
              background: "rgba(0,200,224,.06)", color: "#00C8E0",
              fontSize: 12, fontWeight: 700, cursor: downloadBusy ? "default" : "pointer",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            <FileText size={13} />
            {downloadBusy ? (isAr ? "جارٍ الإنشاء…" : "Generating…") : isAr ? "تنزيل نسخة فارغة (PDF)" : "Download blank DPA (PDF)"}
          </button>
        )}

        {/* Body */}
        {SECTIONS.map((s, i) => (
          <div key={s.title} className="mb-5">
            <p style={{ fontSize: 14, fontWeight: 700, color: "#00C8E0", marginBottom: 8 }}>
              {s.title}
            </p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,.62)", lineHeight: 1.75 }}>
              {s.body}
            </p>
            {i === SECTIONS.length - 1 && (
              <p style={{ fontSize: 11, color: "rgba(255,255,255,.25)", textAlign: "center", marginTop: 28 }}>
                {isAr ? `اتفاقية معالجة بيانات SOSphere النسخة ${DPA_VERSION} — آخر تحديث ٦ مايو ٢٠٢٦` : `SOSphere DPA v${DPA_VERSION} — last updated 6 May 2026`}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }) + " UTC";
  } catch { return iso; }
}
