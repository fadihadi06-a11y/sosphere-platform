#!/usr/bin/env node
/**
 * Pre-Shift Checklist — real-backend / honesty guard.
 *
 * Protects the contract that the checklist is REAL end-to-end:
 *   1. A durable backend exists: checklist_submissions migration with RLS.
 *   2. The service reads/writes that table, company-scoped.
 *   3. The worker mobile screen persists via submitChecklistSubmission.
 *   4. The dashboard loads REAL submissions (fetchChecklistSubmissions) and no
 *      longer ships the fabricated category percentages or the hardcoded
 *      [68,72,75,...] 7-day trend.
 *   5. "Send Reminder" really delivers (sendBroadcast), not a toast-only stub.
 *   6. Worker + dashboard share ONE templates source (no drift).
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

let failures = 0;
const assert = (label, cond) => {
  console.log(`${cond ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${label}`);
  if (!cond) failures++;
};

const migDir = resolve(ROOT, "supabase/migrations");
const migFile = readdirSync(migDir).find(f => /create_checklist_submissions/.test(f));
const mig = migFile ? readFileSync(resolve(migDir, migFile), "utf8") : "";
const service = read("src/app/components/checklist-service.ts");
const worker = read("src/app/components/pre-shift-checklist-screen.tsx");
const dash = read("src/app/components/pre-shift-checklist.tsx");
const templates = existsSync(resolve(ROOT, "src/app/components/checklist-templates.ts"));

assert("checklist_submissions migration exists", !!migFile);
assert("migration creates the table + enables RLS",
  /create table[\s\S]*checklist_submissions/i.test(mig) && /enable row level security/i.test(mig));
assert("migration defines company + owner RLS policies",
  /is_company_member\(company_id\)/.test(mig) && /owner_id = \(select auth\.uid\(\)\)/.test(mig));
assert("service targets checklist_submissions, company-scoped",
  /from\("checklist_submissions"\)/.test(service) && /eq\("company_id", companyId\)/.test(service));
assert("worker screen persists via submitChecklistSubmission",
  /submitChecklistSubmission\(/.test(worker));
assert("dashboard loads REAL submissions (fetchChecklistSubmissions)",
  /fetchChecklistSubmissions\(/.test(dash));
assert("dashboard no longer hardcodes fake category percentages",
  !/mockCompliance/.test(dash) && /categoryCompliance\[key\]/.test(dash));
assert("dashboard 7-day trend is computed, not the [68,72,75,...] literal",
  !/\[68, 72, 75, 70, 78, 82, complianceRate\]/.test(dash) && /trend7/.test(dash));
assert("Send Reminder really delivers via sendBroadcast",
  /sendBroadcast\(\{/.test(dash) && /audience: \{ type: "custom"/.test(dash));
assert("worker + dashboard share one templates module",
  templates && /DEFAULT_CHECKLIST_TEMPLATES/.test(worker) && /DEFAULT_CHECKLIST_TEMPLATES/.test(dash));

// ── Realtime live-refresh ────────────────────────────────────────────────────
assert("service exposes realtime subscription (postgres_changes on checklist_submissions)",
  /subscribeChecklistSubmissions/.test(service) && /postgres_changes/.test(service) && /table: "checklist_submissions"/.test(service));
assert("realtime channel is company-filtered + cleaned up (removeChannel)",
  /filter: `company_id=eq\.\$\{companyId\}`/.test(service) && /removeChannel/.test(service));
assert("dashboard subscribes and unsubscribes on unmount",
  /subscribeChecklistSubmissions\(cid,/.test(dash) && /unsubscribe\(\)/.test(dash));
{
  const pubMig = readdirSync(migDir).find(f => /checklist_submissions_realtime/.test(f));
  const pub = pubMig ? readFileSync(resolve(migDir, pubMig), "utf8") : "";
  assert("migration adds checklist_submissions to supabase_realtime publication",
    !!pubMig && /publication supabase_realtime add table public\.checklist_submissions/i.test(pub));
}

console.log(`\n${failures === 0 ? "\x1b[32m✓ ALL PASS\x1b[0m" : `\x1b[31m✗ ${failures} FAILURE(S)\x1b[0m`}\n`);
process.exit(failures === 0 ? 0 : 1);
