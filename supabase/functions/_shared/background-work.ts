// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — _shared/background-work.ts (R-8)
// ─────────────────────────────────────────────────────────────────────────
// THE BUG THIS HELPER EXISTS TO PREVENT
//   `void (async () => {})()` (fire-and-forget IIFE) is unsafe in Deno Edge
//   Functions. When the request handler returns, the V8 isolate is eligible
//   for termination — any pending background promises are DROPPED without
//   warning. R-4b discovered this in sos-alert's L2-B dispatch ledger:
//   ZERO ledger rows were landing in production for every real SOS because
//   the void async block never completed.
//
//   For purely-DB writes that must persist (ledger, audit), we use direct
//   `await`. For external HTTP calls (push notifications, webhooks) that
//   would add too much latency to await synchronously, we need
//   `EdgeRuntime.waitUntil(promise)` — the official primitive that extends
//   the worker lifetime until the promise settles, without blocking the
//   response.
//
// WHAT THIS HELPER DOES
//   - If running on Deno Deploy / Supabase Edge Functions (where
//     EdgeRuntime.waitUntil is defined): hand the promise to waitUntil so
//     the runtime keeps the worker alive until completion. The response
//     can return immediately.
//   - If running on a runtime without waitUntil (local `deno run`, older
//     Deno, tests): fall back to a synchronous `await`. This is SAFER than
//     `void` because it never silently drops work — the cost is added
//     latency, which is acceptable in dev / fallback contexts.
//
// USAGE
//   import { backgroundOrAwait } from "../_shared/background-work.ts";
//
//   // Before (UNSAFE — see R-4b retrospective):
//   void (async () => { await doExpensiveWork(); })();
//
//   // After (SAFE):
//   await backgroundOrAwait((async () => { await doExpensiveWork(); })());
//
// WHY `await` ON THE WRAPPER ITSELF
//   The wrapper is async because in fallback mode it actually awaits the
//   promise. In waitUntil mode it returns immediately (the await resolves
//   instantly after handing the promise off). Calling code uses one
//   uniform `await backgroundOrAwait(...)` pattern in both cases.
// ═══════════════════════════════════════════════════════════════════════════

/** Background-work scheduler.
 *  - If `EdgeRuntime.waitUntil` is available, hands the promise off to the
 *    runtime so the worker stays alive until completion. Returns immediately.
 *  - Otherwise: awaits the promise to completion (slower but never drops
 *    the work). Errors are caught + warned, never thrown — the caller's
 *    primary response must not be broken by a background failure.
 */
export async function backgroundOrAwait(promise: Promise<unknown>): Promise<void> {
  // EdgeRuntime is a Deno Deploy / Supabase Edge Functions global. It is
  // undefined in pure Deno or Node test environments.
  // deno-lint-ignore no-explicit-any
  const er: any = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") {
    try {
      er.waitUntil(
        promise.catch((e) => {
          console.warn("[backgroundOrAwait] waitUntil promise rejected (non-fatal):", e);
        }),
      );
      return;
    } catch (e) {
      console.warn("[backgroundOrAwait] waitUntil threw, falling back to await:", e);
      // Fall through to the synchronous-await fallback below.
    }
  }
  // Fallback: await the promise synchronously. This is the safe path —
  // never silently drop work. The cost is that the caller's response is
  // delayed until the background work completes. This only triggers in
  // local dev / unsupported runtimes; production Supabase Edge Functions
  // hit the waitUntil branch above.
  try {
    await promise;
  } catch (e) {
    console.warn("[backgroundOrAwait] background work threw (non-fatal):", e);
  }
}
