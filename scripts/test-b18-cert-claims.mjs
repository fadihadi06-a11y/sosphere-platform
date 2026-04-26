// B-18 regression: walks the source tree and asserts that the
// specific false-certification phrases removed in B-18 do NOT
// re-appear in user-visible files, AND that their replacements
// ARE present (so a future innocent edit can't silently flip the
// strings back).
//
// Why grep-as-test: the only meaningful regression here is the
// EXACT string surface that ships to users. A unit test on a
// component would only test what a dev mocked; a grep over the
// real files tests what a customer actually sees.

import { promises as fs } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

// ── helpers ─────────────────────────────────────────────────────────
async function readAll(dir, exts) {
  const out = [];
  async function walk(d) {
    let ents;
    try { ents = await fs.readdir(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of ents) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "dist" ||
          e.name === ".next" || e.name === "build") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
    }
  }
  await walk(dir);
  return out;
}

const files = await readAll(join(ROOT, "src"), [".tsx", ".ts"]);
const publicFiles = await readAll(join(ROOT, "public"), [".html", ".md"]);
const allFiles = [...files, ...publicFiles];

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`);
}

// Banned phrases and one safe context where each may legitimately appear.
// `safe` is a regex (or null) — if a hit's surrounding line matches the
// safe context, the hit is ignored.
const BANNED = [
  // SOC 2 Type II (compliance claim implying audit complete)
  { phrase: /SOC ?2 Type ?II/i, safeLine: /CC7|principles|not.yet|aligned|design/i,
    label: "SOC 2 Type II (claim of audit-complete)" },

  // ISO 27001 standards / compliant / certified
  { phrase: /ISO[ -]?27001 (standards|compliant|certified)/i, safeLine: null,
    label: "ISO 27001 standards/compliant/certified (false claim)" },

  // GDPR Compliant (absolute claim)
  { phrase: /GDPR (Compliant|certified)/i, safeLine: null,
    label: "GDPR Compliant/certified (use 'GDPR-aligned')" },

  // PCI DSS Level 1 (claim badge — Stripe holds, not us)
  { phrase: /PCI DSS Level 1/i, safeLine: null,
    label: "PCI DSS Level 1 (Stripe's cert, not ours)" },

  // tamper-proof (too strong; tamper-evident is correct)
  { phrase: /tamper[- ]proof/i, safeLine: /was too strong|tamper-EVIDENT|outlier|B-18/i,
    label: "tamper-proof (use tamper-evident)" },

  // COURT-ADMISSIBLE (jurisdictional claim we can't make)
  { phrase: /COURT[- ]ADMISSIBLE/i, safeLine: /courtroom call|cross-examination|over-promising|B-18/i,
    label: "COURT-ADMISSIBLE (jurisdictional claim)" },

  // 99.9x% guaranteed (contractual without published SLA)
  { phrase: /\b99\.9[0-9]?% guaranteed\b/i, safeLine: null,
    label: "99.99% guaranteed (use 'target')" },

  // Privacy Guaranteed banner
  { phrase: /Privacy Guaranteed/i, safeLine: /Privacy First|B-18/i,
    label: "Privacy Guaranteed (use 'Privacy First')" },
];

console.log("\n=== B-18 banned-phrase audit ===\n");

const violations = {};
for (const f of allFiles) {
  let body;
  try { body = await fs.readFile(f, "utf8"); } catch { continue; }
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const b of BANNED) {
      if (b.phrase.test(line)) {
        if (b.safeLine && b.safeLine.test(line)) continue;
        // Also check ±1 line context for "B-18 …"-style remediation comments.
        const ctx = (lines[i - 1] || "") + "\n" + line + "\n" + (lines[i + 1] || "");
        if (b.safeLine && b.safeLine.test(ctx)) continue;
        if (!violations[b.label]) violations[b.label] = [];
        violations[b.label].push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
      }
    }
  }
}

for (const b of BANNED) {
  const v = violations[b.label] || [];
  assert(b.label, v.length === 0,
    v.length === 0 ? "" : `(${v.length} hits — first: ${v[0]})`);
}

// ── Required replacements ──────────────────────────────────────────
// These strings MUST exist now (post-fix). If a future edit deletes
// them, the test fires.
console.log("\n=== B-18 required replacements ===\n");

const REQUIRED = [
  { label: "pricing badges replaced", file: "src/app/components/dashboard-pricing-page.tsx",
    needles: [/PCI DSS via Stripe/, /GDPR-Aligned/, /99\.9% Uptime Target/] },
  { label: "enterprise import wizard wording", file: "src/app/components/enterprise-import-wizard.tsx",
    needles: [/designed to align with PDPL .* GDPR.*ISO 27001 principles/] },
  { label: "emergency packet GDPR-aligned", file: "src/app/components/emergency-packet.tsx",
    needles: [/GDPR-aligned/] },
  { label: "audit log PDF section retitled", file: "src/app/components/dashboard-audit-log-page.tsx",
    needles: [/STANDARDS THIS LOG IS DESIGNED FOR ALIGNMENT WITH/, /SOC 2 CC7 event-logging/] },
  { label: "compliance dashboard wording", file: "src/app/components/compliance-dashboard-v2.tsx",
    needles: [/internal security-controls catalogue/, /no certification has yet been/] },
  { label: "lifecycle report header softened", file: "src/app/components/emergency-lifecycle-report.tsx",
    needles: [/Designed for alignment with ISO 45001 \/ ISO 27001/] },
  { label: "evidence vault tamper-evident", file: "src/app/components/evidence-vault-service.ts",
    needles: [/tamper-EVIDENT, encrypted/] },
  { label: "smart-timeline header softened", file: "src/app/components/smart-timeline-tracker.ts",
    needles: [/Tamper-Evident Event Log/, /jurisdiction, on the discovery process/] },
  { label: "pricing 99.99 target not guaranteed", file: "src/app/constants/pricing.ts",
    needles: [/99\.99% uptime target/] },
  { label: "billing page Privacy First", file: "src/app/components/dashboard-billing-page.tsx",
    needles: [/Privacy First/] },
];

for (const r of REQUIRED) {
  let body;
  try { body = await fs.readFile(join(ROOT, r.file), "utf8"); }
  catch { assert(`${r.label} (file missing!)`, false); continue; }
  for (const n of r.needles) {
    assert(`${r.label} :: ${n}`, n.test(body));
  }
}

console.log(`\n${fail === 0 ? "✅ all B-18 assertions passed" : `❌ ${fail} failed`}`);
process.exit(fail === 0 ? 0 : 1);
