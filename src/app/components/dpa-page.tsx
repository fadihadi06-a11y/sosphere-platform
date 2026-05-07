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

const SECTIONS: { title: string; body: string }[] = [
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

export function DpaPage() {
  const navigate = useNavigate();
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
      for (const s of SECTIONS) {
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
        <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>Data Processing Agreement</span>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)", marginLeft: "auto" }}>v{DPA_VERSION}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-6" style={{ maxWidth: 760, marginInline: "auto", width: "100%" }}>
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
                  Signed by {companyName || "your company"} • v{signature.version}
                </p>
                <p style={{ margin: "3px 0 0", fontSize: 11, color: "rgba(255,255,255,.55)", lineHeight: 1.55 }}>
                  {signature.signerFullName} ({signature.signerTitle}) on {formatDate(signature.acceptedAt)}
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
                {downloadBusy ? "Generating…" : "Signed PDF"}
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
                Your company has not yet accepted DPA v{DPA_VERSION}. Acceptance happens during company registration or from Settings.
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
            {downloadBusy ? "Generating…" : "Download blank DPA (PDF)"}
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
                SOSphere DPA v{DPA_VERSION} — last updated 6 May 2026
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
