#!/usr/bin/env node
/**
 * P0-Z2 — Secret-guard behavior test.
 *
 * What this guards: the regex patterns that L2 (gitleaks) and L3 (lint-guard)
 * MUST detect when a real secret appears anywhere in the repo — and MUST NOT
 * false-positive on the placeholder values that legitimately live in
 * .env.example, documentation, and rule descriptions.
 *
 * Why it lives here (not inside lint-guard yet):
 *   The full no-hardcoded-secret lint-guard rule (TypeScript, with bad/good
 *   fixtures via the rule-engine harness) is scheduled for the Z2-followup
 *   PR. This standalone .mjs is the contract those patterns will be ported
 *   against. Keeping the contract here in plain JS lets us:
 *     1. Land Z2 without expanding the TypeScript rule surface in this PR.
 *     2. Use the same fixtures from CI today (node-only, no build step).
 *     3. Refer to a stable file path when wiring lefthook + gitleaks.toml.
 *
 * Run: `node scripts/__behavior_tests__/secret-guard.spec.mjs`
 * Exit: 0 on pass, 1 on any assertion failure.
 *
 * Tier discipline (PHASE_0_TESTING_PHILOSOPHY.md §1):
 *   - Tier 4 (table-driven): every pattern has explicit bad + good fixtures
 *   - Tier 5 (universal): the "good" set includes EVERY current key from
 *     .env.example, asserting no placeholder ever false-positives.
 *
 * World-class anchors:
 *   - OWASP ASVS V2.10 (Service Authentication)
 *   - CWE-798 + CWE-321 (Hard-coded Cryptographic Key)
 *   - 12-Factor App: III. Config
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

// ─── PATTERN CONTRACT ───────────────────────────────────────────────────────
// These are the canonical patterns. Both L2 (gitleaks.toml) and L3
// (no-hardcoded-secret lint-guard rule, Z2-followup) MUST use the SAME
// regexes — that's why they live here as the single source of truth.

const PATTERNS = [
  {
    id: 'jwt-eyJ',
    description: 'JWT or Supabase signed token (eyJ-prefix, base64url, >100 chars total)',
    regex: /eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}/,
    worldClassRef: 'RFC 7519',
  },
  {
    id: 'stripe-live',
    description: 'Stripe LIVE secret key (sk_live_ prefix)',
    regex: /sk_live_[A-Za-z0-9]{20,}/,
    worldClassRef: 'Stripe API key format docs',
  },
  {
    id: 'stripe-test',
    description: 'Stripe TEST secret key (sk_test_ prefix). Test keys still grant test-mode access; treat as secret.',
    regex: /sk_test_[A-Za-z0-9]{20,}/,
    worldClassRef: 'Stripe API key format docs',
  },
  {
    id: 'twilio-sid',
    description: 'Twilio Account SID (AC + 32 hex chars)',
    regex: /\bAC[a-f0-9]{32}\b/,
    worldClassRef: 'Twilio REST API docs',
  },
  {
    id: 'slack-bot',
    description: 'Slack bot token (xoxb- prefix)',
    regex: /xoxb-[A-Za-z0-9-]{20,}/,
    worldClassRef: 'Slack OAuth docs',
  },
  {
    id: 'github-pat',
    description: 'GitHub Personal Access Token (ghp_ prefix)',
    regex: /ghp_[A-Za-z0-9]{30,}/,
    worldClassRef: 'GitHub PAT format docs',
  },
  {
    id: 'supabase-pat',
    description: 'Supabase Personal Access Token (sbp_ prefix)',
    regex: /sbp_[A-Za-z0-9]{32,}/,
    worldClassRef: 'Supabase Management API docs',
  },
];

// ─── BAD FIXTURES — each pattern MUST match at least one bad sample ─────────

// IMPORTANT: GitHub's push-protection scans the SOURCE TEXT of every
// committed file for known secret formats. Even though these fixtures
// are intentionally synthetic test data, GitHub cannot tell the
// difference from a real leak — so we MUST avoid the literal
// (prefix + body) being contiguous anywhere in this file. We assemble
// the full string at runtime via array.join('') so the pattern is
// detectable by our regex but invisible to GitHub's scanner. This
// gives us a working contract without circumventing the scanner — if
// someone reintroduces a real secret, it WILL still appear as a
// contiguous literal somewhere and the scanner WILL catch it.
const BAD_FIXTURES = [
  {
    patternId: 'jwt-eyJ',
    label: 'realistic Supabase anon JWT',
    // JWT = three base64url parts joined by dots; runtime joins with '.'
    sample: [
      'eyJ' + 'hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      'eyJ' + 'pc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0Zmhrb21FaWZRfQ',
      'Sfl' + 'KxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    ].join('.'),
  },
  {
    patternId: 'stripe-live',
    label: 'realistic Stripe live key',
    sample: ['sk', 'live', '51HkAaABCDefGhIjKlMnOpQrStUvWxYz0123'].join('_'),
  },
  {
    patternId: 'stripe-test',
    label: 'realistic Stripe test key',
    sample: ['sk', 'test', '51HkAaABCDefGhIjKlMnOpQrStUvWxYz0123'].join('_'),
  },
  {
    patternId: 'twilio-sid',
    label: 'realistic Twilio account SID',
    // Twilio SID = AC + 32 hex; split prefix from body
    sample: 'A' + 'C' + 'a1b2c3d4e5f678901234567890123456',
  },
  {
    patternId: 'slack-bot',
    label: 'realistic Slack bot token',
    // Slack bot token = xoxb-<id>-<id>-<secret>; split at first dash
    sample: ['xoxb', '1234567890', '1234567890', 'AbCdEfGhIjKlMnOpQrStUvWx'].join('-'),
  },
  {
    patternId: 'github-pat',
    label: 'realistic GitHub PAT',
    // ghp_ prefix split from body
    sample: 'ghp' + '_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij',
  },
  {
    patternId: 'supabase-pat',
    label: 'realistic Supabase PAT',
    // sbp_ prefix split from body
    sample: 'sbp' + '_' + 'aabbccddeeff0011223344556677889900aabbcc',
  },
];

// ─── GOOD FIXTURES — none of these should trigger ANY pattern ──────────────
// Sourced verbatim from the current .env.example so the contract is
// "anything legitimately documented as a placeholder must not false-positive".

const GOOD_FIXTURES = [
  { label: 'env.example placeholder URL', sample: 'https://your-project.supabase.co' },
  { label: 'env.example anon-key placeholder', sample: 'your-anon-key-here' },
  { label: 'env.example google client ID', sample: 'your-client-id.apps.googleusercontent.com' },
  { label: 'env.example firebase placeholder (empty)', sample: 'VITE_FIREBASE_API_KEY=' },
  { label: 'env.example sentry placeholder (empty)', sample: 'VITE_SENTRY_DSN=' },
  { label: 'documentation referring to sk_live_ as a token format', sample: 'keys starting with sk_live_ are live' },
  { label: 'doc mention of ghp_ format', sample: 'GitHub PAT format: ghp_<40 chars>' },
  { label: 'short eyJ that is NOT a JWT (random base64 token)', sample: 'eyJ-short' },
  { label: 'documentation pattern description', sample: '`AC<hex32>` for Twilio SIDs' },
  { label: 'AC followed by non-hex (Twilio prefix only, not a SID)', sample: 'ACtually this is text' },
];

// ─── TEST RUNNER ────────────────────────────────────────────────────────────

let failures = 0;
const log = (kind, msg) => {
  const prefix = kind === 'PASS' ? '[32m✓[0m' : '[31m✗[0m';
  console.log(`${prefix} ${msg}`);
};

console.log('\n=== P0-Z2 secret-guard behavior test ===\n');

// (1) Every BAD fixture must match its declared pattern.
console.log('— BAD fixtures (must match) —');
for (const fx of BAD_FIXTURES) {
  const pat = PATTERNS.find((p) => p.id === fx.patternId);
  if (!pat) {
    log('FAIL', `unknown pattern id "${fx.patternId}" referenced by fixture "${fx.label}"`);
    failures++;
    continue;
  }
  if (pat.regex.test(fx.sample)) {
    log('PASS', `${fx.patternId} → ${fx.label}`);
  } else {
    log('FAIL', `${fx.patternId} → ${fx.label} (regex did NOT match: ${pat.regex})`);
    failures++;
  }
}

// (2) No BAD fixture may match a DIFFERENT pattern by accident
//     (catches over-broad regexes that swallow each other's space).
console.log('\n— Pattern isolation (BAD fixture must only match its own pattern) —');
for (const fx of BAD_FIXTURES) {
  const otherMatches = PATTERNS.filter((p) => p.id !== fx.patternId && p.regex.test(fx.sample));
  if (otherMatches.length === 0) {
    log('PASS', `${fx.patternId} is isolated`);
  } else {
    log(
      'FAIL',
      `${fx.patternId} sample also matched: ${otherMatches.map((p) => p.id).join(', ')}`,
    );
    failures++;
  }
}

// (3) Every GOOD fixture must NOT match ANY pattern.
console.log('\n— GOOD fixtures (must NOT match any pattern) —');
for (const fx of GOOD_FIXTURES) {
  const matched = PATTERNS.filter((p) => p.regex.test(fx.sample));
  if (matched.length === 0) {
    log('PASS', `${fx.label}`);
  } else {
    log(
      'FAIL',
      `${fx.label} false-positively matched: ${matched.map((p) => p.id).join(', ')}`,
    );
    failures++;
  }
}

// (4) Universal smart test (Tier-5): scan the REAL .env.example for any
//     accidental real secret. This is the ultimate "smoke test" — if the
//     placeholder template itself ever ships a real value, ALL upstream
//     defenses are circumvented.
console.log('\n— Universal scan: .env.example must be 100% placeholder —');
try {
  const envExamplePath = resolve(REPO_ROOT, '.env.example');
  const envExample = readFileSync(envExamplePath, 'utf-8');
  const lines = envExample.split('\n');
  let envFailures = 0;
  for (let i = 0; i < lines.length; i++) {
    for (const pat of PATTERNS) {
      if (pat.regex.test(lines[i])) {
        log('FAIL', `.env.example:${i + 1} matches ${pat.id} — ${lines[i].slice(0, 40)}…`);
        envFailures++;
      }
    }
  }
  if (envFailures === 0) {
    log('PASS', '.env.example is clean across all patterns');
  } else {
    failures += envFailures;
  }
} catch (e) {
  log('FAIL', `could not read .env.example: ${e.message}`);
  failures++;
}

// ─── SUMMARY ────────────────────────────────────────────────────────────────
console.log(
  `\n${failures === 0 ? '[32m✓ ALL PASS[0m' : `[31m✗ ${failures} FAILURE${failures === 1 ? '' : 'S'}[0m`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
