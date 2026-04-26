// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — last-breath-service.ts (DEPRECATED)
// ═══════════════════════════════════════════════════════════════════════════
//
// W3-13 (B-20, 2026-04-26): dead code, superseded by B-06.
//
// The audit found sendBeacon stripped Authorization headers, causing every
// last-breath fallback to 401. But this module had ZERO call sites — B-06
// already routes battery-panic through the canonical SOS-trigger flow.
// Two parallel implementations = bug magnet. We kept B-06.
//
// If you want to remove this file from the repo, run `git rm` on it.
// ═══════════════════════════════════════════════════════════════════════════

// Intentionally empty. See B-06 for battery-panic SOS handling.
export const LAST_BREATH_DEPRECATED = true as const;
