// ═══════════════════════════════════════════════════════════════
// SOSphere — Dev-only Logger
// ─────────────────────────────────────────────────────────────
// Replaces direct console.log / console.info calls. In DEV builds
// these forward to the console; in PRODUCTION builds they no-op
// (V8 dead-code-eliminates the body, so call sites cost ~nothing).
//
// Rule of thumb:
//   console.error  → KEEP (production errors must surface in Sentry/log aggregator)
//   console.warn   → KEEP (legitimate warnings worth seeing in prod)
//   console.log    → use `dlog`  (debug breadcrumb, dev-only)
//   console.info   → use `dinfo` (status update, dev-only)
//   console.debug  → use `ddebug` (verbose trace, dev-only)
//
// Why not just remove the log calls?
//   The [TAG] prefix convention used throughout the codebase
//   ([Auth], [SOS], [Tier], [SUPABASE_READY]...) is genuinely useful
//   during local development and incident reproduction. Killing them
//   entirely would force everyone to add them back ad-hoc. Gating
//   keeps the dev experience while clearing the prod log noise.
// ═══════════════════════════════════════════════════════════════

const IS_DEV: boolean = (() => {
  try {
    // Vite-injected env. import.meta is undefined under Node test runner
    // when the test file doesn't go through Vite, so guard defensively.
    return Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
})();

const noop = (..._args: unknown[]): void => {};

export const dlog:   (...args: unknown[]) => void = IS_DEV ? console.log.bind(console)   : noop;
export const dinfo:  (...args: unknown[]) => void = IS_DEV ? console.info.bind(console)  : noop;
export const ddebug: (...args: unknown[]) => void = IS_DEV ? console.debug.bind(console) : noop;
