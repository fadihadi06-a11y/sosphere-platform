// ═══════════════════════════════════════════════════════════════
// pickDefault — resilient export picker for React.lazy() chunks
// ─────────────────────────────────────────────────────────────
// After a deploy, an old hashed chunk can 404 or resolve to an empty/partial
// module. The common pattern `import("./x").then(m => ({ default: m.Page }))`
// then throws "Cannot read properties of undefined (reading 'Page')" — a
// message the error boundary's stale-chunk self-heal does NOT recognize, so the
// user is left on the error fallback instead of getting an auto-reload.
//
// pickDefault closes that gap: when the module or the named export is missing,
// it (1) triggers a single guarded reload to fetch fresh assets, and (2) throws
// an error whose message the error boundary already recognizes as a chunk
// failure — belt and suspenders. When the export is present it just returns it.
// ═══════════════════════════════════════════════════════════════

/** One-time, loop-guarded reload to pull fresh hashed chunks after a deploy. */
function triggerChunkReloadOnce(): void {
  try {
    const k = "sos_chunk_reloaded_at";
    const last = Number(sessionStorage.getItem(k) || 0);
    if (Date.now() - last > 15000) {
      sessionStorage.setItem(k, String(Date.now()));
      window.location.reload();
    }
  } catch { /* sessionStorage unavailable — error boundary remains the fallback */ }
}

/**
 * Pick a named export and shape it for React.lazy ({ default: Component }).
 * If the module is undefined or the export is missing (stale/partial chunk),
 * self-heal with a reload and throw a chunk-recognized error.
 */
export function pickDefault<T = unknown>(mod: unknown, name: string): { default: T } {
  const comp = mod ? (mod as Record<string, unknown>)[name] : undefined;
  if (!comp) {
    triggerChunkReloadOnce();
    // Message intentionally contains "dynamically imported module" so the
    // existing error-boundary self-heal regex also matches it.
    throw new Error(`Failed to fetch dynamically imported module (missing export: ${name})`);
  }
  return { default: comp as T };
}
