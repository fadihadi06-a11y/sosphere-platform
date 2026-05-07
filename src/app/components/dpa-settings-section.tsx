/**
 * dpa-settings-section.tsx — AUTH-5 P6 (#175)
 *
 * Settings → Company section that surfaces the company's DPA acceptance
 * state and gives the owner a single click to (re-)sign when the version
 * server-side has moved ahead of what was accepted.
 *
 * Design (matches Stripe / Linear / Notion DPA renewal patterns):
 *
 *   1. UP-TO-DATE STATE
 *      Server's current_dpa_version() === most-recent acceptance row's version
 *      → Green card: "Signed v2026-05-07 by [name] ([title]) on [date]"
 *      → "Download signed PDF" link (deep-links into /legal/dpa)
 *
 *   2. RENEWAL-REQUIRED STATE
 *      Either no acceptance, or accepted version < server's current version
 *      → Cyan card: "DPA v[server] requires acceptance"
 *      → "What changed" copy (last accepted version → current)
 *      → "Sign DPA" CTA opens DpaAcceptanceModal
 *
 *   3. NOT-OWNER STATE
 *      Non-owner members see read-only status (no Sign button) — server-
 *      side is_company_owner enforces it anyway, this is just honest UX.
 *
 * The DpaAcceptanceModal mirrors the Step-5 acceptance UX from the
 * company-register wizard — same signer-name + title + checkbox layout
 * the owner already saw at signup, so the renewal feels familiar.
 *
 * Acceptance flow:
 *   modal.submit()
 *     → acceptCompanyDpa(companyId, name, title, version)
 *     → on success: refresh local state, fire onAccepted() callback,
 *       close modal, toast.
 *     → on failure: keep modal open, show server-translated reason.
 */

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ShieldCheck, AlertTriangle, CheckCircle2, X, ArrowRight, Loader2, ExternalLink,
} from "lucide-react";
import {
  getCurrentDpaVersion,
  acceptCompanyDpa,
} from "./api/company-subscription-client";
import { safeRpc } from "./api/safe-rpc";

interface DpaSnapshot {
  hasSignature: boolean;
  acceptedVersion: string | null;
  signerFullName: string | null;
  signerTitle:    string | null;
  acceptedAt:     string | null;
  serverVersion:  string;
  isOwner:        boolean;
}

interface DpaSettingsSectionProps {
  companyId: string | null | undefined;
  /** From auth session — pre-fills the signer name input. */
  ownerNameHint?: string;
}

export function DpaSettingsSection({ companyId, ownerNameHint }: DpaSettingsSectionProps) {
  const [snap, setSnap]       = useState<DpaSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const refresh = useCallback(async () => {
    if (!companyId) { setSnap(null); setLoading(false); return; }
    setLoading(true);
    // Run both probes in parallel.
    const [verRes, accRes] = await Promise.all([
      getCurrentDpaVersion(),
      // Use raw safeRpc here so we can ask for the most-recent acceptance
      // regardless of version (passing NULL → server defaults to current).
      safeRpc<{
        success: boolean; has_signature?: boolean; version?: string;
        signer_full_name?: string; signer_title?: string;
        accepted_at?: string;
      }>("get_dpa_acceptance", { p_company_id: companyId, p_dpa_version: null }, { timeoutMs: 6000 }),
    ]);
    // Determine isOwner via subscription-state (has the flag we already built).
    const subRes = await safeRpc<{ success: boolean; is_owner?: boolean }>(
      "get_company_subscription_state",
      { p_company_id: companyId },
      { timeoutMs: 6000 },
    );
    const serverVersion = verRes.data || "";
    const acc = accRes.data;
    setSnap({
      hasSignature:    !!(acc?.success && acc.has_signature),
      acceptedVersion: acc?.has_signature ? (acc.version ?? null) : null,
      signerFullName:  acc?.signer_full_name ?? null,
      signerTitle:     acc?.signer_title ?? null,
      acceptedAt:      acc?.accepted_at ?? null,
      serverVersion,
      isOwner:         !!(subRes.data?.success && subRes.data.is_owner),
    });
    setLoading(false);
  }, [companyId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // AUTH-5 P6: when the LiveTrialBanner / LiveBillingPanel deep-links
  // here with the renewal intent flag set, auto-open the modal once.
  // We clear the flag immediately so a stale flag from yesterday's
  // navigation doesn't pop the modal on every settings visit.
  useEffect(() => {
    if (loading || !snap) return;
    let intent = false;
    try {
      intent = localStorage.getItem('sosphere_dpa_renewal_intent') === '1';
      if (intent) localStorage.removeItem('sosphere_dpa_renewal_intent');
    } catch { /* localStorage may be blocked */ }
    // Only auto-open when there's actually something to renew AND the
    // viewer can sign (owner). For non-owners or up-to-date state we
    // honor the click but don't pop a useless modal.
    const upToDate = snap.hasSignature && snap.acceptedVersion === snap.serverVersion;
    if (intent && !upToDate && snap.isOwner) {
      setShowModal(true);
    }
  }, [loading, snap]);

  if (!companyId) return null;

  if (loading && !snap) {
    return (
      <div style={shell("rgba(255,255,255,0.04)", "rgba(255,255,255,0.08)")}>
        <Loader2 size={14} className="animate-spin" style={{ color: "rgba(255,255,255,0.5)" }} />
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginLeft: 8 }}>Loading DPA status…</span>
      </div>
    );
  }

  if (!snap) return null;

  const upToDate = snap.hasSignature && snap.acceptedVersion === snap.serverVersion;
  const accent = upToDate ? "#00C853" : "#00C8E0";

  return (
    <>
      <div
        style={{
          marginBottom: 12,
          padding: 14,
          borderRadius: 12,
          background: `linear-gradient(135deg, ${accent}10, ${accent}04)`,
          border: `1.5px solid ${accent}30`,
          fontFamily: "'Outfit', sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9, background: `${accent}22`,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            {upToDate
              ? <CheckCircle2 size={16} style={{ color: accent }} />
              : <ShieldCheck   size={16} style={{ color: accent }} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: accent, letterSpacing: "-0.2px" }}>
              {upToDate
                ? `Data Processing Agreement v${snap.serverVersion} — accepted`
                : (snap.hasSignature
                    ? `DPA renewal required — v${snap.serverVersion}`
                    : `Sign your DPA (v${snap.serverVersion})`)}
            </p>
            <p style={{ margin: "3px 0 0", fontSize: 10.5, color: "rgba(255,255,255,0.55)", lineHeight: 1.55 }}>
              {upToDate && snap.signerFullName && (
                <>Signed by <span style={{ color: "#fff", fontWeight: 600 }}>{snap.signerFullName}</span>
                  {snap.signerTitle && ` (${snap.signerTitle})`} on {fmtDate(snap.acceptedAt)}.</>
              )}
              {!upToDate && snap.hasSignature && (
                <>Your last acceptance was v{snap.acceptedVersion}. The DPA was updated to v{snap.serverVersion} —
                  please review and re-sign on behalf of your company.</>
              )}
              {!snap.hasSignature && (
                <>The Data Processing Agreement (GDPR Art. 28, KSA PDPL Art. 7) has not been signed for your company.
                  Sign now to enable trial activation, billing, and audit-trail compliance.</>
              )}
            </p>

            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <a
                href="/legal/dpa"
                target="_blank"
                rel="noopener"
                style={{
                  fontSize: 10.5, fontWeight: 600, color: "#00C8E0",
                  textDecoration: "none", display: "inline-flex",
                  alignItems: "center", gap: 4,
                  padding: "6px 10px", borderRadius: 8,
                  background: "rgba(0,200,224,0.06)",
                  border: "1px solid rgba(0,200,224,0.18)",
                }}
              >
                Read full DPA <ExternalLink size={11} />
              </a>
              {!upToDate && snap.isOwner && (
                <button
                  onClick={() => setShowModal(true)}
                  style={{
                    fontSize: 11, fontWeight: 700, color: "#0A0E17",
                    background: accent, border: "none",
                    padding: "7px 12px", borderRadius: 8, cursor: "pointer",
                    display: "inline-flex", alignItems: "center", gap: 5,
                  }}
                >
                  Sign DPA v{snap.serverVersion} <ArrowRight size={11} />
                </button>
              )}
              {!upToDate && !snap.isOwner && (
                <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)", padding: "6px 0" }}>
                  Only the company owner can sign.
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showModal && companyId && (
          <DpaAcceptanceModal
            companyId={companyId}
            version={snap.serverVersion}
            ownerNameHint={ownerNameHint}
            previousVersion={snap.acceptedVersion}
            onClose={() => setShowModal(false)}
            onAccepted={() => {
              setShowModal(false);
              void refresh();
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ── Acceptance modal ───────────────────────────────────────────────────

interface ModalProps {
  companyId: string;
  version:   string;
  previousVersion?: string | null;
  ownerNameHint?: string;
  onClose:    () => void;
  onAccepted: () => void;
}

function DpaAcceptanceModal({ companyId, version, previousVersion, ownerNameHint, onClose, onAccepted }: ModalProps) {
  const [signerName,  setSignerName]  = useState(ownerNameHint || "");
  const [signerTitle, setSignerTitle] = useState("Owner");
  const [accepted,    setAccepted]    = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null);

  const canSubmit = !submitting && accepted
    && signerName.trim().length >= 2
    && signerTitle.trim().length >= 2;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true); setErrorMsg(null);
    const r = await acceptCompanyDpa(companyId, signerName.trim(), signerTitle.trim(), version);
    setSubmitting(false);
    if (r.error || !r.data) {
      setErrorMsg(r.error?.message || "Could not record acceptance");
      return;
    }
    onAccepted();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, background: "rgba(5,7,14,0.88)", backdropFilter: "blur(10px)",
        fontFamily: "'Outfit', sans-serif",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0,  scale: 1 }}
        exit={{    opacity: 0, y: 8,  scale: 0.97 }}
        style={{
          width: "100%", maxWidth: 480,
          background: "#0A0F1C",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 22, overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10, background: "rgba(0,200,224,0.14)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <ShieldCheck size={16} style={{ color: "#00C8E0" }} />
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.95)" }}>
                Sign DPA v{version}
              </p>
              {previousVersion && previousVersion !== version && (
                <p style={{ margin: "1px 0 0", fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
                  Previously accepted: v{previousVersion}
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px 20px" }}>
          <div style={{
            padding: "10px 12px", borderRadius: 10, marginBottom: 14,
            background: "rgba(0,200,224,0.06)",
            border: "1px solid rgba(0,200,224,0.18)",
          }}>
            <p style={{ margin: 0, fontSize: 11.5, color: "rgba(255,255,255,0.7)", lineHeight: 1.55 }}>
              You are signing on behalf of your company under the SOSphere DPA, which sets out the
              parties' GDPR Art. 28 / KSA PDPL Art. 7 obligations. Read the full text and annexes
              before accepting:
            </p>
            <a href="/legal/dpa" target="_blank" rel="noopener"
              style={{
                fontSize: 11, fontWeight: 700, color: "#00C8E0",
                textDecoration: "none", marginTop: 8, display: "inline-flex", alignItems: "center", gap: 4,
              }}>
              Open /legal/dpa <ExternalLink size={10} />
            </a>
          </div>

          <label style={{ display: "block", marginBottom: 10 }}>
            <span style={{ display: "block", fontSize: 10.5, color: "rgba(255,255,255,0.5)", fontWeight: 600, marginBottom: 4 }}>
              Signer full name
            </span>
            <input
              type="text" value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              maxLength={120}
              placeholder="e.g. Fadi Hadi"
              style={inputStyle}
            />
          </label>
          <label style={{ display: "block", marginBottom: 14 }}>
            <span style={{ display: "block", fontSize: 10.5, color: "rgba(255,255,255,0.5)", fontWeight: 600, marginBottom: 4 }}>
              Title (signer of record)
            </span>
            <input
              type="text" value={signerTitle}
              onChange={(e) => setSignerTitle(e.target.value)}
              maxLength={80}
              placeholder="e.g. CEO, CTO, DPO, IT Manager"
              style={inputStyle}
            />
          </label>

          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", marginBottom: 14 }}>
            <input
              type="checkbox" checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              style={{ marginTop: 2, accentColor: "#00C8E0", width: 14, height: 14, cursor: "pointer" }}
            />
            <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.7)", lineHeight: 1.55 }}>
              I, <span style={{ color: "#00C8E0", fontWeight: 700 }}>{signerName.trim() || "the signer"}</span>
              {signerTitle.trim() ? ` (${signerTitle.trim()})` : ""}, accept the SOSphere DPA v{version}
              on behalf of my company. I understand this is a binding electronic signature under eIDAS
              and equivalent laws, and a tamper-evident record will be stored in our audit log.
            </span>
          </label>

          {errorMsg && (
            <div style={{
              padding: "8px 12px", borderRadius: 9, marginBottom: 12,
              background: "rgba(255,45,85,0.06)",
              border: "1px solid rgba(255,45,85,0.22)",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <AlertTriangle size={13} style={{ color: "#FF2D55", flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "#FF8B9C" }}>{errorMsg}</span>
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onClose}
              disabled={submitting}
              style={{
                flex: 1, padding: "11px 14px", borderRadius: 11,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "rgba(255,255,255,0.85)",
                fontSize: 12, fontWeight: 600,
                cursor: submitting ? "default" : "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!canSubmit}
              style={{
                flex: 2, padding: "11px 14px", borderRadius: 11, border: "none",
                background: canSubmit ? "#00C8E0" : "rgba(255,255,255,0.06)",
                color:      canSubmit ? "#0A0E17" : "rgba(255,255,255,0.3)",
                fontSize: 12, fontWeight: 700,
                cursor: canSubmit ? "pointer" : "default",
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              {submitting ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
              {submitting ? "Signing…" : `Accept and sign v${version}`}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 10,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#fff", fontSize: 12.5, outline: "none",
};

function shell(bg: string, border: string): React.CSSProperties {
  return {
    margin: "0 0 12px", padding: "12px 14px", borderRadius: 12,
    background: bg, border: `1px solid ${border}`,
    display: "flex", alignItems: "center",
    fontFamily: "'Outfit', sans-serif",
  };
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch { return iso; }
}
