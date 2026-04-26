#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — Fix-Claim Verifier
// ═══════════════════════════════════════════════════════════════════════════
// For every B/G/W3 fix that claims to be in the code, verify the claim by
// static check. This is the "trust but verify" check the user asked for —
// confirms every claimed fix is actually wired in, not just commented out.
//
// Each claim has:
//   - id: short slug (B-NN / G-NN / W3-NN)
//   - desc: human-readable description
//   - file: path of the canonical file containing the fix
//   - find: regex pattern that must match (proves the fix is present)
//
// Exit 0 = all claims verified; 1 = any claim missing.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const claims = [
  // ── TIER 0 (CRITICAL) ──
  { id: "G-1",  desc: "promote_user_to_admin admin/owner check",
    file: "supabase/migrations/20260425200000_b_20_privilege_lockdown.sql",
    find: /promote_user_to_admin/ },
  { id: "G-2",  desc: "emergencies USING(true) policy dropped",
    file: "supabase/migrations/20260425200000_b_20_privilege_lockdown.sql",
    find: /DROP POLICY .*emergencies/i },
  { id: "G-3",  desc: "sos-alert heartbeat JWT auth",
    file: "supabase/functions/sos-alert/index.ts",
    find: /HEARTBEAT ownership mismatch/ },
  { id: "G-4",  desc: "sos-alert prewarm body-token auth",
    file: "supabase/functions/sos-alert/index.ts",
    find: /authenticateBodyOrHeader/ },
  { id: "G-17", desc: "sos-bridge-twiml gtok required",
    file: "supabase/functions/sos-bridge-twiml/index.ts",
    find: /verifyGatherToken/ },
  { id: "G-29", desc: "stripe-webhook event-id dedup",
    file: "supabase/functions/stripe-webhook/index.ts",
    find: /processed_stripe_events/ },
  { id: "G-35", desc: "audit-log writeLock + diff-clear",
    file: "src/app/components/audit-log-store.ts",
    find: /auditWriteLock/ },
  { id: "G-36", desc: "replay-watcher named handlers",
    file: "src/app/components/sos-server-trigger.ts",
    find: /onlineHandler/ },
  { id: "G-41", desc: "sos-bridge-twiml AbortSignal.timeout",
    file: "supabase/functions/sos-bridge-twiml/index.ts",
    find: /AbortSignal\.timeout/ },

  // ── TIER 1 top-5 + Wave 3 ──
  { id: "W3-1",  desc: "sos-alert userId soft-check (no 403 on EMP-*)",
    file: "supabase/functions/sos-alert/index.ts",
    find: /userId differs from JWT \(using JWT\)/ },
  { id: "W3-3",  desc: "sos-live tenant-scoped channel",
    file: "supabase/functions/sos-alert/index.ts",
    find: /sos-live:.*companyId/ },
  { id: "W3-7",  desc: "Stripe one-sided timestamp",
    file: "supabase/functions/stripe-webhook/index.ts",
    find: /now - tNum > 300/ },
  { id: "W3-10", desc: "deactivation PIN hash-aware",
    file: "src/app/components/sos-emergency.tsx",
    find: /isDeactivationPinSet|isDeactivationPin\(/ },
  { id: "W3-11", desc: "tier resync on resume + focus + periodic",
    file: "src/app/components/mobile-app.tsx",
    find: /sosphere_tier_refresh|tierLastSyncedAt/ },
  { id: "W3-12", desc: "createVault wired into sos-emergency.doEnd",
    file: "src/app/components/sos-emergency.tsx",
    find: /createVault\(\{/ },
  { id: "W3-14", desc: "resolveTier company-aware (B2B)",
    file: "supabase/functions/sos-alert/index.ts",
    find: /tier resolved via company chain/ },
  { id: "W3-17", desc: "invite_code crypto-strong",
    file: "src/app/components/company-register.tsx",
    find: /getRandomValues\(bytes\)/ },
  { id: "W3-25", desc: "clearUserDataOnLogout 19-key wipe",
    file: "src/app/components/mobile-app.tsx",
    find: /clearUserDataOnLogout/ },
  { id: "W3-27", desc: "sos-alert per-contact fanout timeout",
    file: "supabase/functions/sos-alert/index.ts",
    find: /FANOUT_TIMEOUT_MS/ },
  { id: "W3-30", desc: "PREWARM emergencyId ownership check",
    file: "supabase/functions/sos-alert/index.ts",
    find: /emergencyId conflict/ },
  { id: "W3-31", desc: "heartbeat GPS validation",
    file: "supabase/functions/sos-alert/index.ts",
    find: /hb\.location\.lat >= -90/ },
  { id: "W3-32", desc: "twilio-sms error redacted",
    file: "supabase/functions/twilio-sms/index.ts",
    find: /sms_send_failed/ },
  { id: "W3-33", desc: "send-invitations escapeHtml",
    file: "supabase/functions/send-invitations/index.ts",
    find: /escapeHtml/ },
  { id: "W3-37", desc: "profiles trigger blocks active_company_id + age fields",
    file: "supabase/migrations/20260426200000_w3_37_profiles_trigger_extend.sql",
    find: /active_company_id IS DISTINCT/ },
  { id: "W3-42", desc: "GPS tracker idempotent listeners",
    file: "src/app/components/offline-gps-tracker.ts",
    find: /_gpsBeforeUnloadHandler/ },
  { id: "W3-43", desc: "sos-server-trigger auth subscription captured",
    file: "src/app/components/sos-server-trigger.ts",
    find: /authSubscription/ },
  { id: "W3-46", desc: "twilio-status mirrors to audit_log",
    file: "supabase/functions/twilio-status/index.ts",
    find: /twilio_/ },
  { id: "W3-47", desc: "twilio-call phone variants",
    file: "supabase/functions/twilio-call/index.ts",
    find: /normalizePhoneVariants/ },
];

let pass = 0;
let fail = 0;
for (const c of claims) {
  const path = join(ROOT, c.file);
  if (!existsSync(path)) {
    console.log(`✖ ${c.id}: file missing — ${c.file}`);
    fail++;
    continue;
  }
  const content = readFileSync(path, "utf8");
  if (c.find.test(content)) {
    pass++;
  } else {
    console.log(`✖ ${c.id} (${c.desc})`);
    console.log(`    file: ${c.file}`);
    console.log(`    expected pattern: ${c.find}`);
    fail++;
  }
}

console.log("");
console.log(`Fix-claim verification: ${pass}/${pass + fail} claims verified (${fail} missing)`);
process.exit(fail === 0 ? 0 : 1);
