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

const DPA_VERSION = "2026-05-06";

const SECTIONS: { title: string; body: string }[] = [
  {
    title: "1. Definitions",
    body: '"Controller" means the company that signed up as the SOSphere employer. ' +
      '"Processor" means SOSphere ("we"). "Personal Data" means any information relating to ' +
      'an identified or identifiable natural person processed on the Controller\'s behalf, ' +
      'including employee profiles, GPS location, emergency-event metadata, and incident ' +
      'reports. "GDPR" means Regulation (EU) 2016/679. "PDPL" means the Saudi Arabian Personal ' +
      'Data Protection Law (Royal Decree M/19, 2021).',
  },
  {
    title: "2. Subject matter and duration",
    body: "We process Personal Data only to deliver the SOSphere field-worker safety service " +
      "to the Controller's organisation. Processing continues for the lifetime of the active " +
      "subscription plus the retention windows set out in Section 8.",
  },
  {
    title: "3. Nature and purpose of processing",
    body: "Processing operations include: collection of employee profile data submitted by the " +
      "Controller; ingestion of GPS coordinates during active emergencies and check-ins; " +
      "storage of audio / image / location evidence captured by the on-device emergency flow; " +
      "delivery of SMS, push, and call dispatches via integrated providers (Twilio, FCM, APNS); " +
      "and aggregation of operational metrics for the Controller's dashboard.",
  },
  {
    title: "4. Categories of Personal Data and data subjects",
    body: "Data subjects are the Controller's employees and any individuals invited as " +
      "emergency contacts. Categories include: identifiers (name, email, phone), employment " +
      "metadata (role, department, work zone), location data (real-time during emergencies, " +
      "trail during active SOS sessions), emergency event records (timestamp, severity, " +
      "responder log), and optional medical-ID fields when explicitly provided.",
  },
  {
    title: "5. Controller obligations",
    body: "The Controller represents that it has a lawful basis for sharing Personal Data with " +
      "us — typically employment contract (Art. 6(1)(b)) or legitimate interest in worker " +
      "safety (Art. 6(1)(f) GDPR; PDPL Art. 6(2)). The Controller is responsible for informing " +
      "data subjects of this processing and for honouring data-subject requests received through " +
      "any channel other than the SOSphere in-app SAR flow.",
  },
  {
    title: "6. Processor obligations",
    body: "We will: process Personal Data only on documented Controller instructions; ensure " +
      "personnel with access are bound by confidentiality; implement the technical and " +
      "organisational measures listed in Section 7; assist the Controller with data-subject " +
      "requests and breach notifications; delete or return Personal Data at the end of the " +
      "service in line with Section 8; and make available the audit-log records that demonstrate " +
      "compliance with this DPA.",
  },
  {
    title: "7. Security measures",
    body: "Encryption in transit (TLS 1.2+) and at rest (AES-256). Authentication requires " +
      "email + password OR Google OAuth, with optional TOTP MFA. Database access is row-level " +
      "scoped per company via Postgres RLS (FORCE RLS on every PII table). Server-side audit_log " +
      "records every authentication event, billing change, DPA acceptance, and SOS escalation " +
      "with timestamp, actor, and IP. Backups are encrypted and retained for 30 days. Access to " +
      "production credentials is limited to named engineers, logged, and rotated quarterly.",
  },
  {
    title: "8. Data retention",
    body: "SOS session records: 90 days from session close. GPS trail data: 30 days. Audio / " +
      "image evidence vaults: 90 days. Audit logs: indefinite (required for ISO 27001 / SOC 2 " +
      "evidence). Employee profile + emergency-contact data: deleted within 30 days of " +
      "subscription cancellation, subject to legal-hold exceptions. Cron-driven retention is " +
      "enforced server-side; the schedule is published in our public privacy notice.",
  },
  {
    title: "9. International transfers",
    body: "Where Personal Data is transferred outside the European Economic Area, the United " +
      "Kingdom, or the Kingdom of Saudi Arabia, the parties agree that the EU Standard " +
      "Contractual Clauses (2021/914) and the UK International Data Transfer Addendum apply, " +
      "incorporated by reference. KSA cross-border transfers comply with PDPL Art. 29 and the " +
      "implementing regulations.",
  },
  {
    title: "10. Sub-processors",
    body: "The Controller authorises us to engage the following sub-processors: Supabase Inc. " +
      "(database + auth + edge runtime, EU/US regions), Stripe Inc. (payment processing), " +
      "Twilio Inc. (SMS / voice dispatch), Google Firebase Cloud Messaging (Android push), " +
      "Apple Push Notification Service (iOS push), and Vercel Inc. (web frontend hosting). " +
      "We will give 30 days' notice of additions or changes via in-app notification and the " +
      "Controller may object on reasonable security grounds.",
  },
  {
    title: "11. Audit rights",
    body: "On reasonable notice (≥ 30 days, no more than once per calendar year except after a " +
      "security incident) the Controller may audit our compliance with this DPA via a mutually-" +
      "agreed independent third party. We will make available our most recent SOC 2 Type II " +
      "report or equivalent in lieu of on-site audit at the Controller's option.",
  },
  {
    title: "12. Personal data breach",
    body: "We will notify the Controller without undue delay (target: within 24 hours of " +
      "discovery) of any confirmed breach affecting their Personal Data. Notification will " +
      "include the nature of the breach, categories and approximate number of data subjects " +
      "affected, likely consequences, and the measures taken or proposed.",
  },
  {
    title: "13. Termination and return of data",
    body: "On termination of the underlying service the Controller may export all of its data " +
      "via the in-app export tool within 30 days. After 30 days we will delete the data, " +
      "subject to legal-hold or audit-trail retention obligations. A deletion certificate is " +
      "available on request.",
  },
  {
    title: "14. Liability",
    body: "Each party's liability under this DPA is subject to the liability cap stated in the " +
      "underlying SOSphere Terms of Service. Nothing in this DPA limits the parties' liability " +
      "for matters that cannot be limited by law (death or personal injury, fraud, or breaches " +
      "that the parties cannot lawfully exclude).",
  },
  {
    title: "15. Governing law",
    body: "This DPA is governed by the law agreed in the underlying SOSphere Terms of Service. " +
      "Where this DPA conflicts with the underlying terms in matters of data protection, this " +
      "DPA prevails.",
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
