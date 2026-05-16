// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — Compliance Dashboard (R-24 wire-up of verify_audit_chain)
// ─────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS
//   The /compliance route is the discoverable entry-point auditors expect.
//   Prior to R-24 it was a placeholder ("coming soon"). R-21 Layer 2
//   surfaced that verify_audit_chain — the L2-D hash-chain verifier RPC —
//   had zero callers anywhere in src/. The function is core ISO 27001
//   evidence: prove the audit_log has not been tampered with (no row
//   deleted, reordered, or edited post-insert).
//
//   This component wires the RPC into a live admin button. The result is
//   rendered with the cryptographic detail an auditor wants to see —
//   rows_verified, tail_hash, and on tampering, the exact tampered_row_id
//   plus expected-vs-actual hash. No data layer migration required; the
//   RPC was already granted to authenticated and enforces admin/owner
//   role internally.
//
// CALLER REQUIREMENTS
//   - User must be logged in (auth.uid() in RPC body).
//   - User must be an admin/owner on the company they pass in p_company_id.
//   - Caller-supplied company_id: this component resolves the current
//     active membership (the same shape company-dashboard uses) and passes
//     it through.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "./api/supabase-client";

type ChainVerifiedOk = {
  verified: true;
  rows_verified: number;
  tail_hash: string;
  verified_at: string;
};

type ChainVerifiedTampered = {
  verified: false;
  reason: string;
  tampered_at_index?: number;
  tampered_row_id?: string;
  expected_prev?: string | null;
  actual_prev?: string | null;
  expected_hash?: string;
  actual_hash?: string;
  post_cutoff_null_hash_row_count?: number;
  cutoff?: string;
};

type VerifyResult = ChainVerifiedOk | ChainVerifiedTampered;

const PALETTE = {
  bg: "#05070E",
  card: "rgba(255,255,255,0.03)",
  border: "rgba(255,255,255,0.08)",
  text: "#fff",
  muted: "rgba(255,255,255,0.65)",
  faint: "rgba(255,255,255,0.4)",
  accent: "#00C8E0",
  good: "#22c55e",
  bad: "#ef4444",
};

export function ComplianceDashboard() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve the caller's active admin/owner membership. The RPC will
  // reject if the role check fails, but we want a clearer "no admin
  // membership" UI rather than a raw RPC error.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u?.user) {
          if (!cancelled) setUnauthorized(true);
          return;
        }
        const { data, error: e } = await supabase
          .from("company_memberships")
          .select("company_id, companies(name)")
          .eq("user_id", u.user.id)
          .eq("active", true)
          .in("role", ["admin", "owner"])
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        if (e || !data) {
          setUnauthorized(true);
          return;
        }
        setCompanyId(data.company_id as string);
        const co = (data as { companies?: { name?: string } | null }).companies;
        setCompanyName(co?.name ?? null);
      } catch {
        if (!cancelled) setUnauthorized(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runVerification() {
    if (!companyId) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const { data, error: e } = await supabase.rpc("verify_audit_chain", {
        p_company_id: companyId,
      });
      if (e) {
        setError(e.message || "verify_audit_chain failed");
      } else {
        setResult(data as VerifyResult);
      }
    } catch (err) {
      setError((err as Error)?.message || String(err));
    } finally {
      setRunning(false);
    }
  }

  // ── render ─────────────────────────────────────────────────────────────
  const shellStyle: React.CSSProperties = {
    minHeight: "100vh",
    width: "100vw",
    background: PALETTE.bg,
    color: PALETTE.text,
    fontFamily: "'Outfit', system-ui, sans-serif",
    padding: "48px 24px",
  };
  const cardStyle: React.CSSProperties = {
    maxWidth: 760,
    margin: "0 auto",
    background: PALETTE.card,
    border: "1px solid " + PALETTE.border,
    borderRadius: 16,
    padding: "32px 28px",
  };
  const eyebrow: React.CSSProperties = {
    fontSize: 11,
    letterSpacing: 2,
    color: "rgba(0,200,224,0.8)",
    fontWeight: 600,
    marginBottom: 8,
    textTransform: "uppercase",
  };
  const buttonStyle = (disabled: boolean): React.CSSProperties => ({
    padding: "12px 20px",
    background: disabled ? "rgba(0,200,224,0.25)" : PALETTE.accent,
    color: "#05070E",
    border: "none",
    borderRadius: 10,
    fontWeight: 700,
    fontSize: 14,
    cursor: disabled ? "not-allowed" : "pointer",
    letterSpacing: 0.3,
  });

  return (
    <div style={shellStyle}>
      <div style={cardStyle}>
        <div style={eyebrow}>SOSphere · Compliance Portal</div>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 700,
            margin: "0 0 14px",
            letterSpacing: "-0.4px",
          }}
        >
          Audit-log chain integrity
        </h1>
        <p
          style={{
            fontSize: 14.5,
            lineHeight: 1.6,
            color: PALETTE.muted,
            margin: "0 0 22px",
          }}
        >
          Each row in your tenant's audit log is cryptographically chained to
          the previous row. This verifier recomputes every SHA-256 in order
          and reports the first row, if any, whose <code>row_hash</code> or
          <code> prev_hash</code> no longer matches the canonical encoding —
          which is the signal that a row was deleted, reordered, or edited
          after the fact. Truthful framing: this evidences chain integrity,
          not third-party SOC 2 / ISO 27001 certification.
        </p>

        {unauthorized ? (
          <UnauthorizedPanel />
        ) : !companyId ? (
          <div style={{ color: PALETTE.faint, fontSize: 13 }}>
            Resolving your admin membership…
          </div>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
                marginBottom: 18,
              }}
            >
              <button
                type="button"
                onClick={runVerification}
                disabled={running}
                style={buttonStyle(running)}
              >
                {running ? "Verifying…" : "Run chain verification"}
              </button>
              <div style={{ fontSize: 12, color: PALETTE.faint }}>
                Tenant:{" "}
                <span style={{ color: PALETTE.muted }}>
                  {companyName || companyId.slice(0, 8) + "…"}
                </span>
              </div>
            </div>
            {error && <ErrorPanel message={error} />}
            {result && <ResultPanel result={result} />}
          </>
        )}

        <div
          style={{
            fontSize: 11.5,
            color: PALETTE.faint,
            borderTop: "1px solid " + PALETTE.border,
            paddingTop: 18,
            marginTop: 28,
            lineHeight: 1.6,
          }}
        >
          <div>
            Required role: <strong>admin</strong> or <strong>owner</strong>{" "}
            on this tenant.
          </div>
          <div>
            Verifier RPC: <code>public.verify_audit_chain(p_company_id uuid)</code>{" "}
            — see migration <code>20260509171843_l2d_audit_chain_seq_fix</code>.
          </div>
        </div>
      </div>
    </div>
  );
}

function UnauthorizedPanel() {
  return (
    <div
      style={{
        padding: "16px 18px",
        background: "rgba(239,68,68,0.08)",
        border: "1px solid rgba(239,68,68,0.3)",
        borderRadius: 10,
        color: "#fca5a5",
        fontSize: 13.5,
        lineHeight: 1.5,
      }}
    >
      You are not signed in as an admin or owner of any active tenant. The
      verifier RPC enforces this server-side, so this portal cannot proceed.
      Contact your tenant owner to gain access.
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: "14px 16px",
        background: "rgba(239,68,68,0.08)",
        border: "1px solid rgba(239,68,68,0.3)",
        borderRadius: 10,
        color: "#fca5a5",
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      <strong>Verification call failed:</strong> {message}
    </div>
  );
}

function ResultPanel({ result }: { result: VerifyResult }) {
  if (result.verified) {
    return (
      <div
        style={{
          padding: "18px 20px",
          background: "rgba(34,197,94,0.07)",
          border: "1px solid rgba(34,197,94,0.35)",
          borderRadius: 12,
          fontSize: 13.5,
          lineHeight: 1.7,
        }}
      >
        <div
          style={{
            color: PALETTE.good,
            fontWeight: 700,
            marginBottom: 8,
            fontSize: 15,
          }}
        >
          ✓ Chain integrity verified
        </div>
        <div style={{ color: PALETTE.muted }}>
          Rows verified: <code>{result.rows_verified}</code>
        </div>
        <div style={{ color: PALETTE.muted }}>
          Tail hash: <code>{result.tail_hash?.slice(0, 32)}…</code>
        </div>
        <div style={{ color: PALETTE.faint, fontSize: 12, marginTop: 6 }}>
          Verified at {new Date(result.verified_at).toISOString()}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "18px 20px",
        background: "rgba(239,68,68,0.08)",
        border: "1px solid rgba(239,68,68,0.4)",
        borderRadius: 12,
        fontSize: 13.5,
        lineHeight: 1.7,
      }}
    >
      <div
        style={{
          color: "#fca5a5",
          fontWeight: 700,
          marginBottom: 8,
          fontSize: 15,
        }}
      >
        ✗ Chain integrity failure
      </div>
      <div style={{ color: PALETTE.muted, marginBottom: 6 }}>
        Reason: <code>{result.reason}</code>
      </div>
      {result.tampered_at_index != null && (
        <div style={{ color: PALETTE.muted }}>
          Tampered at index: <code>{result.tampered_at_index}</code>
        </div>
      )}
      {result.tampered_row_id && (
        <div style={{ color: PALETTE.muted }}>
          Tampered row id: <code>{result.tampered_row_id}</code>
        </div>
      )}
      {result.expected_hash && (
        <div style={{ color: PALETTE.muted }}>
          Expected hash: <code>{result.expected_hash.slice(0, 32)}…</code>
        </div>
      )}
      {result.actual_hash && (
        <div style={{ color: PALETTE.muted }}>
          Actual hash: <code>{result.actual_hash.slice(0, 32)}…</code>
        </div>
      )}
      {result.post_cutoff_null_hash_row_count != null && (
        <div style={{ color: PALETTE.muted }}>
          Post-cutoff rows with NULL hash:{" "}
          <code>{result.post_cutoff_null_hash_row_count}</code>{" "}
          (cutoff <code>{result.cutoff}</code>)
        </div>
      )}
      <div style={{ color: PALETTE.faint, fontSize: 12, marginTop: 10 }}>
        Forward this output to your security lead — at least one row has
        been deleted, reordered, or edited after insertion.
      </div>
    </div>
  );
}

export default ComplianceDashboard;
