// ═══════════════════════════════════════════════════════════════
// SOSphere — L2-H-Admin: admin emergency-response surface invariants
// ─────────────────────────────────────────────────────────────
// Locks the contract that EmergencyResponseRecord (the admin's
// post-incident review screen) surfaces the L2-F SMS replies AND
// the L2-G forensic photo — pulled from the authoritative tables
// rather than client-only state.
//
// Why this guard exists:
//   • Admins are the people coordinating the response. The user-
//     side debrief (PostEmergencyDebrief) is for the SOS owner,
//     but during a B2B incident the company admin needs the SAME
//     forensic visibility — or they're flying blind while the
//     evidence sits in the database.
//   • L1-C "first ack time" SLA must be prominently displayed on
//     the admin screen — that's where SLA reviews happen.
//   • A refactor that drops the Service-aware Supabase query or
//     the signed-URL path for the photo silently breaks admin
//     visibility while the user-side keeps working.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let adminSrc = "";

beforeAll(() => {
  adminSrc = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/components/emergency-response-record.tsx"),
    "utf8",
  );
});

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("L2-H-Admin: state declarations + lazy load", () => {
  it("declares smsReplies + forensicPhotoUrl + evidenceLoaded", () => {
    expect(adminSrc).toMatch(/const \[smsReplies,\s*setSmsReplies\]\s*=\s*useState<SmsReplyRow\[\]>\(\[\]\)/);
    expect(adminSrc).toMatch(/const \[forensicPhotoUrl,\s*setForensicPhotoUrl\]\s*=\s*useState<string \| null>\(null\)/);
    expect(adminSrc).toMatch(/const \[evidenceLoaded,\s*setEvidenceLoaded\]\s*=\s*useState\(false\)/);
  });

  it("SmsReplyRow type mirrors the sos_sms_replies migration columns 1:1", () => {
    for (const col of [
      "contact_index",
      "contact_name",
      "from_phone",
      "body",
      "is_ack",
      "ack_keyword",
      "received_at",
    ]) {
      expect(adminSrc).toMatch(new RegExp(`\\b${col}:\\s*`));
    }
  });

  it("dynamic-imports the supabase client (chunk slim)", () => {
    const code = stripComments(adminSrc);
    expect(code).toMatch(/await import\(\s*["']\.\/api\/supabase-client["']\s*\)/);
  });

  it("declares useEffect import alongside useState", () => {
    expect(adminSrc).toMatch(/import \{ useState, useEffect \} from ["']react["']/);
  });
});

describe("L2-H-Admin: Supabase queries — correct filters + ordering", () => {
  it("sms_replies query filters by emergency_id (no cross-session leak)", () => {
    const code = stripComments(adminSrc);
    expect(code).toMatch(/from\(\s*["']sos_sms_replies["']\s*\)[\s\S]{0,500}\.eq\(\s*["']emergency_id["']\s*,\s*record\.id\s*\)/);
  });

  it("sms_replies query orders ascending (chronological timeline)", () => {
    expect(adminSrc).toMatch(/\.order\(\s*["']received_at["']\s*,\s*\{\s*ascending:\s*true\s*\}\s*\)/);
  });

  it("sms_replies query is bounded (no unbounded pull)", () => {
    expect(adminSrc).toMatch(/\.limit\(\s*\d+\s*\)/);
  });

  it("forensic photo path matches the writer (sos-forensic-capture.ts)", () => {
    expect(adminSrc).toMatch(/`sos\/\$\{record\.id\}\/forensic\.jpg`/);
  });

  it("uses signed URL on private 'evidence' bucket (NOT public path)", () => {
    const code = stripComments(adminSrc);
    expect(code).toMatch(/\.createSignedUrl\(/);
    expect(code).toMatch(/\.from\(\s*["']evidence["']\s*\)/);
  });

  it("cleanup flag prevents setState on unmount", () => {
    const code = stripComments(adminSrc);
    expect(code).toMatch(/let cancelled = false/);
    expect(code).toMatch(/if \(!cancelled\)/);
    expect(code).toMatch(/return\s*\(\s*\)\s*=>\s*\{\s*cancelled\s*=\s*true/);
  });
});

describe("L2-H-Admin: first-ack SLA metric (L1-C contract)", () => {
  it("firstAckSec is derived from the first ack row + record.startTime", () => {
    const code = stripComments(adminSrc);
    expect(code).toMatch(/firstAckSec/);
    expect(code).toMatch(/smsReplies\.find\(r\s*=>\s*r\.is_ack\)/);
    // Math.max(0, ...) — never negative even on clock skew
    expect(code).toMatch(/Math\.max\(0,\s*Math\.round/);
  });

  it("FIRST ACK badge renders when firstAckSec !== null", () => {
    const code = stripComments(adminSrc);
    expect(code).toMatch(/firstAckSec\s*!==\s*null\s*&&/);
    // JSX expression — `{firstAckSec}` (no `$` prefix, that's template-literal syntax).
    expect(code).toMatch(/FIRST ACK \+\{firstAckSec\}s/);
  });
});

describe("L2-H-Admin: render — conditional sections, ack distinction, photo caption", () => {
  it("Contact-responses section ONLY renders when smsReplies.length > 0", () => {
    const code = stripComments(adminSrc);
    expect(code).toMatch(/evidenceLoaded\s*&&\s*smsReplies\.length\s*>\s*0\s*&&/);
  });

  it("Forensic-photo section ONLY renders when signed URL resolved", () => {
    const code = stripComments(adminSrc);
    expect(code).toMatch(/evidenceLoaded\s*&&\s*forensicPhotoUrl\s*&&/);
  });

  it("ack replies get ShieldCheck + green styling + ack_keyword pill", () => {
    expect(adminSrc).toMatch(/ShieldCheck/);
    expect(adminSrc).toMatch(/r\.is_ack\s*&&\s*<ShieldCheck/);
    expect(adminSrc).toMatch(/r\.is_ack\s*&&\s*r\.ack_keyword/);
  });

  it("uses the project-wide rgba(0,200,83,*) green palette for acks", () => {
    expect(adminSrc).toMatch(/rgba\(0,200,83/);
  });

  it("photo <img> uses lazy loading + signed URL", () => {
    expect(adminSrc).toMatch(/<img[\s\S]{0,400}src=\{forensicPhotoUrl\}/);
    expect(adminSrc).toMatch(/loading=["']lazy["']/);
  });

  it("photo caption asserts chain-of-custody (SHA-256 / forensic framing)", () => {
    // The visual must NOT look like a casual snapshot — admins
    // viewing this need to read it as forensic evidence.
    expect(adminSrc).toMatch(/SHA-256/);
    expect(adminSrc).toMatch(/chain-of-custody/);
  });

  it("section labels use admin-screen visual conventions (ALL CAPS, letterSpacing)", () => {
    expect(adminSrc).toMatch(/CONTACT RESPONSES/);
    expect(adminSrc).toMatch(/POST-CALL FORENSIC SCENE/);
  });
});
