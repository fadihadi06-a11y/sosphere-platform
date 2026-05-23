/**
 * Rule: no-localStorage-auth
 *
 * Rationale (Wave 7 finding R-970, MASTER P0-B1): the dashboard auth guard reads its
 * "logged-in-as-super-admin" state from a JSON blob in localStorage. Any visitor with
 * devtools can do:
 *   localStorage.setItem("sosphere_dashboard_auth", JSON.stringify({version:4, role:"super_admin"}))
 * and instantly own the dashboard. localStorage is NOT an auth source — it is user-mutable
 * client storage. Auth MUST come from `supabase.auth.getSession()` (verified by SDK).
 *
 * Detection (AST, two-stage to keep false positives at zero):
 *
 *   (a) Direct write: `localStorage.setItem("sosphere_dashboard_auth", ...)` or any key
 *       in AUTH_KEY_PATTERNS.
 *   (b) Indirect: `const KEY = "sosphere_dashboard_auth"; localStorage.setItem(KEY, ...)`
 *       (we resolve top-level `const` string literals).
 *   (c) Read: `JSON.parse(localStorage.getItem("sosphere_dashboard_auth") ?? "{}")` —
 *       reading an auth blob from localStorage is the SAME vulnerability surface, since
 *       it means downstream code is going to TRUST that blob.
 *
 * World-class refs:
 *   - OWASP ASVS V3.3 (Session binding to user agent / tokens)
 *   - OWASP ASVS V8.2 (Client-side data storage — auth tokens MUST NOT live there)
 *   - CWE-922 (Insecure Storage of Sensitive Information)
 *   - Supabase Auth docs: getSession() vs localStorage
 *   - PHASE_0_DOCTRINE.md §3 [AUTH] localStorage role-write
 */

import ts from 'typescript';
import type { Rule, RuleContext, Violation } from '../types.js';
import { callChain, nodePosition, walk } from '../parsers/ts.js';

const RULE_ID = 'no-localStorage-auth';

// Keys whose presence in localStorage indicates an auth/role/session decision is being
// stored client-side. Each entry is a (regex, friendly-name) pair so the violation
// message can explain what was matched.
const AUTH_KEY_PATTERNS: Array<[RegExp, string]> = [
  [/^sosphere_dashboard_auth$/, 'dashboard auth blob (R-970)'],
  [/^sosphere_admin_session$/, 'admin session blob'],
  [/^sosphere_super_admin/, 'super-admin marker'],
  [/^sos_reg_result$/, 'registration result (R-985)'],
  [/^auth[-_](session|token|user|role)$/i, 'generic auth-* localStorage key'],
];

// localStorage methods that write OR read.
const LS_WRITE_METHODS = new Set(['setItem']);
const LS_READ_METHODS = new Set(['getItem']);

function matchAuthKey(key: string): string | null {
  for (const [re, name] of AUTH_KEY_PATTERNS) {
    if (re.test(key)) return name;
  }
  return null;
}

function check(ctx: RuleContext): Violation[] {
  if (!ctx.inScope || !ctx.ast) return [];
  const ast = ctx.ast;

  // First pass — collect top-level `const X = "<string>"` bindings so we can resolve
  // indirect uses like `localStorage.setItem(KEY, ...)`.
  const stringConsts = new Map<string, string>();
  walk(ast, (node) => {
    if (!ts.isVariableDeclaration(node) || !node.initializer || !node.name) return;
    if (!ts.isIdentifier(node.name)) return;
    const init = node.initializer;
    if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
      stringConsts.set(node.name.text, init.text);
    }
  });

  const violations: Violation[] = [];

  walk(ast, (node) => {
    if (!ts.isCallExpression(node)) return;
    const chain = callChain(node);
    // We need `localStorage.<setItem|getItem>` OR `window.localStorage.<...>`.
    const tail = chain[chain.length - 1];
    const looksLikeLs =
      (chain.includes('localStorage') &&
        (LS_WRITE_METHODS.has(tail) || LS_READ_METHODS.has(tail)));
    if (!looksLikeLs) return;

    // Extract the key argument (first arg).
    const keyArg = node.arguments[0];
    if (!keyArg) return;

    let keyText: string | null = null;
    if (ts.isStringLiteral(keyArg) || ts.isNoSubstitutionTemplateLiteral(keyArg)) {
      keyText = keyArg.text;
    } else if (ts.isIdentifier(keyArg)) {
      keyText = stringConsts.get(keyArg.text) ?? null;
    }
    if (!keyText) return;

    const matchedFriendly = matchAuthKey(keyText);
    if (!matchedFriendly) return;

    const operation = LS_WRITE_METHODS.has(tail) ? 'write' : 'read';
    const pos = nodePosition(ast, node);
    violations.push({
      ruleId: RULE_ID,
      severity: 'error',
      filePath: ctx.filePath,
      line: pos.line,
      column: pos.column,
      endLine: pos.endLine,
      endColumn: pos.endColumn,
      message:
        `localStorage ${operation} of an auth key (\`${keyText}\` — ${matchedFriendly}). ` +
        `localStorage is user-mutable client storage; trusting it for auth lets any visitor ` +
        `set "role":"super_admin" via devtools (Wave 7 R-970). Use \`supabase.auth.getSession()\` ` +
        `(SDK-verified) or an HMAC-signed payload with a server-side key. ` +
        `See PHASE_0_DOCTRINE.md §3 [AUTH] + MASTER_AUDIT P0-B1.`,
      suggestedFix:
        operation === 'write'
          ? 'Remove the localStorage write. Store only Supabase\'s session via the SDK (which uses access_token + refresh_token cookies/secure storage).'
          : 'Replace with `const { data: { session } } = await supabase.auth.getSession(); const role = session?.user?.app_metadata?.role` (SDK-verified, JWT-claim-bound).',
      worldClassRef: [
        'OWASP ASVS V3.3 (Session Binding)',
        'OWASP ASVS V8.2 (Client-Side Storage)',
        'CWE-922 (Insecure Storage of Sensitive Information)',
        'Supabase Auth: getSession() is the only verified source',
      ],
      doctrineRef: 'PHASE_0_DOCTRINE.md §3 [AUTH] + MASTER_AUDIT P0-B1',
    });
  });

  return violations;
}

// ---------- rule export ----------

const rule: Rule = {
  id: RULE_ID,
  description:
    'Forbid storing/reading auth or role state in localStorage. Auth must come from a verified SDK session (R-970, P0-B1).',
  severity: 'error',
  scope: {
    include: [
      'src/**/*.ts',
      'src/**/*.tsx',
    ],
    // The rule itself + the doctrine file + tests that explicitly document the pattern.
    exclude: [
      'src/**/__tests__/**',
      'scripts/lint-guard/**',
    ],
  },
  worldClassRef: [
    'OWASP ASVS v4.0.3 V3.3 (Session Binding)',
    'OWASP ASVS v4.0.3 V8.2 (Client-Side Storage)',
    'CWE-922 (Insecure Storage of Sensitive Information)',
    'Supabase Auth — getSession() is the only verified source',
  ],
  doctrineRef: 'PHASE_0_DOCTRINE.md §3 [AUTH] + MASTER_AUDIT P0-B1',
  check,
  fixtures: {
    bad: [
      {
        label: 'direct setItem dashboard auth (R-970)',
        filePath: 'src/utils/dashboard-auth-guard.ts',
        reason: 'Exact R-970 attack vector. The canonical bug.',
        minViolations: 1,
        code:
          'export function login(role: string) {\n' +
          '  localStorage.setItem("sosphere_dashboard_auth", JSON.stringify({ version: 4, role, loginAt: Date.now() }));\n' +
          '}\n',
      },
      {
        label: 'direct getItem dashboard auth (read = trust)',
        filePath: 'src/utils/dashboard-auth-guard.ts',
        reason: 'Reading the blob implies trusting it. Same vulnerability class.',
        minViolations: 1,
        code:
          'export function currentRole(): string | null {\n' +
          '  const raw = localStorage.getItem("sosphere_dashboard_auth");\n' +
          '  return raw ? JSON.parse(raw).role : null;\n' +
          '}\n',
      },
      {
        label: 'indirect via const KEY',
        filePath: 'src/api/auth-storage.ts',
        reason: 'Common shape — extracting the key to a const does not change the risk.',
        minViolations: 1,
        code:
          'const KEY = "sosphere_dashboard_auth";\n' +
          'export function save(payload: unknown) {\n' +
          '  localStorage.setItem(KEY, JSON.stringify(payload));\n' +
          '}\n',
      },
      {
        label: 'window.localStorage variant',
        filePath: 'src/utils/legacy-session.ts',
        reason: 'Some legacy code accesses via window.localStorage.',
        minViolations: 1,
        code:
          'export function persist(role: string) {\n' +
          '  window.localStorage.setItem("sosphere_admin_session", JSON.stringify({ role }));\n' +
          '}\n',
      },
      {
        label: 'sos_reg_result legacy key (R-985)',
        filePath: 'src/api/registration.ts',
        reason: 'The un-namespaced legacy registration key documented in Wave 7 R-985.',
        minViolations: 1,
        code:
          'export function cacheReg(result: object) {\n' +
          '  localStorage.setItem("sos_reg_result", JSON.stringify(result));\n' +
          '}\n',
      },
      {
        label: 'generic auth-token pattern',
        filePath: 'src/api/token-cache.ts',
        reason: 'Catches new keys following the auth-* naming convention.',
        minViolations: 1,
        code:
          'export function setSession(t: string) {\n' +
          '  localStorage.setItem("auth-token", t);\n' +
          '}\n',
      },
    ],
    good: [
      {
        label: 'localStorage of a NON-auth user preference',
        filePath: 'src/utils/ui-prefs.ts',
        reason: 'User preferences in localStorage are fine — not auth state.',
        code:
          'export function setTheme(theme: "dark" | "light") {\n' +
          '  localStorage.setItem("sosphere_ui_theme", theme);\n' +
          '}\n',
      },
      {
        label: 'localStorage of i18n choice',
        filePath: 'src/utils/locale.ts',
        reason: 'Locale persistence is not an auth decision.',
        code:
          'export function rememberLocale(loc: string) {\n' +
          '  localStorage.setItem("sosphere_locale", loc);\n' +
          '}\n',
      },
      {
        label: 'proper Supabase session usage (the canonical fix)',
        filePath: 'src/api/auth.ts',
        reason: 'The gold standard: getSession() from the SDK.',
        code:
          'import { supabase } from "./supabase-client.js";\n' +
          'export async function currentRole() {\n' +
          '  const { data: { session } } = await supabase.auth.getSession();\n' +
          '  return session?.user?.app_metadata?.role ?? null;\n' +
          '}\n',
      },
      {
        label: 'sessionStorage of a UI flag (not auth)',
        filePath: 'src/utils/ui-flags.ts',
        reason: 'sessionStorage is also not auth — but this rule targets auth keys regardless of API.',
        code:
          'export function markBannerSeen() {\n' +
          '  sessionStorage.setItem("sosphere_seen_banner", "1");\n' +
          '}\n',
      },
    ],
    properties: [
      {
        description: 'Any synthesized localStorage.setItem of an AUTH_KEY MUST flag.',
        arbitrary: () => null,
        invariant: (_input, violations) => violations.length >= 1,
      },
      {
        description: 'Any synthesized localStorage.setItem of a NON-auth key MUST NOT flag.',
        arbitrary: () => null,
        invariant: (_input, violations) => violations.length === 0,
      },
    ],
  },
};

export default rule;
