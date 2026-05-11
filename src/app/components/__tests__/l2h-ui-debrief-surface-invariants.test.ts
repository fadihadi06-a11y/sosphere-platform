// ═══════════════════════════════════════════════════════════════
// SOSphere — L2-H-UI: PostEmergencyDebrief forensic-surface invariants
// ─────────────────────────────────────────────────────────────
// Locks the contract that the debrief screen surfaces the
// forensic evidence captured during the SOS — SMS replies
// (L2-F) and the forensic photo (L2-G) — pulled from the
// authoritative tables rather than client-only state.
//
// What this guards against:
//   • A refactor that drops the sos_sms_replies query — would
//     make the contact-response evidence invisible to the user
//     even though the audit log still has it
//   • A refactor that hard-codes a SELECT for columns that
//     drift from the migration schema (would 500 on prod)
//   • A refactor that fetches without filtering by emergency_id
//     — would leak cross-SOS replies (debrief for incident A
//     shows replies from incident B)
//   • A refactor that bypasses Supabase storage signed-URL
//     for the forensic photo (would either fail RLS or expose
//     a permanent public URL — both regressions)
//   • A refactor that renders the section even when there's no
//     data (empty boxes for users with old incidents)
//   • A refactor that drops the L2-F ack-keyword highlight UX
//     — that's the operationally meaningful event surfacing
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let debriefSrc = "";

beforeAll(() => {
  debriefSrc = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/components/post-emergency-debrief.tsx"),
    "utf8",
  );
});

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("L2-H-UI: state declarations + lazy load contract", () => {
  it("declares smsReplies + forensicPhotoUrl + evidenceLoaded state", () => {
    expect(debriefSrc).toMatch(/const \[smsReplies,\s*setSmsReplies\]\s*=\s*useState<SmsReplyRow\[\]>\(\[\]\)/);
    expect(debriefSrc).toMatch(/const \[forensicPhotoUrl,\s*setForensicPhotoUrl\]\s*=\s*useState<string \| null>\(null\)/);
    expect(debriefSrc).toMatch(/const \[evidenceLoaded,\s*setEvidenceLoaded\]\s*=\s*useState\(false\)/);
  });

  it("SmsReplyRow type mirrors the migration column set 1:1", () => {
    // If the migration adds a column the UI needs, that column should
    // appear here. If a column is renamed/removed in the migration,
    // this test breaks first — which is the invariant intent.
    for (const col of [
      "contact_index",
      "contact_name",
      "from_phone",
      "body",
      "is_ack",
      "ack_keyword",
      "received_at",
    ]) {
      expect(debriefSrc).toMatch(new RegExp(`\\b${col}:\\s*`));
    }
  });

  it("dynamic-imports the supabase client (chunk slim — file is React.lazy()'d)", () => {
    const code = stripComments(debriefSrc);
    expect(code).toMatch(/await import\(\s*["']\.\/api\/supabase-client["']\s*\)/);
  });
});

describe("L2-H-UI: Supabase queries — correct filters + ordering", () => {
  it("sms_replies query filters by emergency_id (no cross-SOS leak)", () => {
    const code = stripComments(debriefSrc);
    expect(code).toMatch(/from\(\s*["']sos_sms_replies["']\s*\)[\s\S]{0,500}\.eq\(\s*["']emergency_id["']\s*,\s*record\.id\s*\)/);
  });

  it("sms_replies query orders by received_at ascending (chronological timeline)", () => {
    expect(debriefSrc).toMatch(/\.order\(\s*["']received_at["']\s*,\s*\{\s*ascending:\s*true\s*\}\s*\)/);
  });

  it("sms_replies query caps result count (no unbounded pull)", () => {
    expect(debriefSrc).toMatch(/\.limit\(\s*\d+\s*\)/);
  });

  it("forensic photo path matches the writer (sos-forensic-capture.ts)", () => {
    // The path scheme MUST stay in lockstep with sos-forensic-capture
    // — divergence would mean the photo writes to one location and
    // the debrief looks somewhere else. Same string both places.
    expect(debriefSrc).toMatch(/`sos\/\$\{record\.id\}\/forensic\.jpg`/);
  });

  it("uses signed URL (NOT public path) for the forensic photo", () => {
    const code = stripComments(debriefSrc);
    // Signed URL respects the storage RLS on the evidence bucket.
    // A public URL would either fail (the bucket isn't public) or
    // leak (if someone made it public). Test asserts signed.
    expect(code).toMatch(/\.createSignedUrl\(/);
    // Bucket name: "evidence" — same as the audio path.
    expect(code).toMatch(/\.from\(\s*["']evidence["']\s*\)/);
  });

  it("cleanup flag prevents state updates after unmount", () => {
    const code = stripComments(debriefSrc);
    // The useEffect cleanup must guard against late-resolving promises
    // calling setState on an unmounted component.
    expect(code).toMatch(/let cancelled = false/);
    expect(code).toMatch(/if \(!cancelled\)/);
    expect(code).toMatch(/return\s*\(\s*\)\s*=>\s*\{\s*cancelled\s*=\s*true/);
  });
});

describe("L2-H-UI: render — conditional sections, no empty boxes", () => {
  it("Contact-responses section ONLY renders when smsReplies.length > 0", () => {
    const code = stripComments(debriefSrc);
    expect(code).toMatch(/evidenceLoaded\s*&&\s*smsReplies\.length\s*>\s*0\s*&&/);
  });

  it("Forensic-photo section ONLY renders when the signed URL resolved", () => {
    const code = stripComments(debriefSrc);
    expect(code).toMatch(/evidenceLoaded\s*&&\s*forensicPhotoUrl\s*&&/);
  });

  it("ack replies get the ShieldCheck visual highlight (L1-C SLA UX)", () => {
    // The L1-C "did anyone ACK" SLA contract is operationally the most
    // meaningful event. The UI must distinguish ack vs non-ack replies
    // — losing this would dilute the metric to "any inbound = same".
    expect(debriefSrc).toMatch(/ShieldCheck/);
    expect(debriefSrc).toMatch(/r\.is_ack\s*&&\s*<ShieldCheck/);
    expect(debriefSrc).toMatch(/r\.is_ack\s*&&\s*r\.ack_keyword/);
  });

  it("ack background uses the SOSphere green (color contract)", () => {
    // 0,200,83 is the project-wide green for "operationally positive
    // event acknowledged". The first-ack-banner in sos-emergency.tsx
    // uses the same palette — keeps the UX language coherent.
    expect(debriefSrc).toMatch(/rgba\(0,200,83/);
  });

  it("forensic photo renders <img> with lazy loading", () => {
    expect(debriefSrc).toMatch(/<img[\s\S]{0,400}src=\{forensicPhotoUrl\}/);
    expect(debriefSrc).toMatch(/loading=["']lazy["']/);
  });

  it("forensic photo card carries the chain-of-custody caption", () => {
    // The user needs to know the photo is hash-anchored — otherwise it
    // looks like a casual snapshot. The Arabic/English caption asserts
    // the forensic chain explicitly so the visual is interpreted
    // correctly in any review.
    expect(debriefSrc).toMatch(/chain-of-custody/);
    expect(debriefSrc).toMatch(/سلسلة الأدلّة/);
  });

  it("bilingual headers present (Contact responses + Scene captured)", () => {
    expect(debriefSrc).toMatch(/Contact responses[\s\S]{0,80}ردود جهات الاتصال/);
    expect(debriefSrc).toMatch(/Scene captured[\s\S]{0,80}صورة المشهد/);
  });
});
