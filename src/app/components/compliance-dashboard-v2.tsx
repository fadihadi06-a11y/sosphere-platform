// ═══════════════════════════════════════════════════════════════
// SOSphere — Compliance Dashboard (D-C2)
// ─────────────────────────────────────────────────────────────
// Placeholder for the /compliance route. The original live
// dashboard was removed pending a rebuild of its data-layer
// dependencies. Route remains wired because SOC2/ISO-27001
// auditors expect a discoverable compliance entry point — this
// stub shows a clear "not yet available" panel instead of a
// blank screen.
// ═══════════════════════════════════════════════════════════════

import { createElement } from "react";

export function ComplianceDashboard() {
  return createElement(
    "div",
    {
      style: {
        minHeight: "100vh",
        width: "100vw",
        background: "#05070E",
        color: "#fff",
        fontFamily: "'Outfit', system-ui, sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      },
    },
    createElement(
      "div",
      {
        style: {
          maxWidth: 560,
          textAlign: "center",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16,
          padding: "40px 32px",
        },
      },
      createElement(
        "div",
        {
          style: {
            fontSize: 11,
            letterSpacing: 2,
            color: "rgba(0,200,224,0.8)",
            fontWeight: 600,
            marginBottom: 12,
          },
        },
        "SOSPHERE · COMPLIANCE PORTAL",
      ),
      createElement(
        "h1",
        {
          style: {
            fontSize: 28,
            fontWeight: 700,
            margin: "0 0 16px",
            letterSpacing: "-0.5px",
          },
        },
        "Audit dashboard coming soon",
      ),
      createElement(
        "p",
        {
          style: {
            fontSize: 15,
            lineHeight: 1.6,
            color: "rgba(255,255,255,0.65)",
            margin: "0 0 24px",
          },
        },
        // B-18 (2026-04-25): the prior copy implied SOSphere holds SOC 2 /
        // ISO 27001 today. It does not. Truthful framing only.
        "This portal exposes the internal security-controls catalogue, " +
          "risk register, and incident investigation summaries for " +
          "enrolled SOSphere tenants — structured for future SOC 2 / " +
          "ISO 27001 audit readiness, but no certification has yet been " +
          "awarded. It is currently being rebuilt following a core " +
          "infrastructure migration.",
      ),
      createElement(
        "div",
        {
          style: {
            fontSize: 12,
            color: "rgba(255,255,255,0.4)",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            paddingTop: 20,
            lineHeight: 1.6,
          },
        },
        createElement("div", null, "Required role: compliance_admin or company_owner"),
        createElement(
          "div",
          null,
          "Enrolled tenants: contact compliance@sosphere.co for early access",
        ),
      ),
    ),
  );
}

export default ComplianceDashboard;
