// ═══════════════════════════════════════════════════════════════
// SOSphere — fetchWithTimeout  (D-M5)
// ─────────────────────────────────────────────────────────────
// Dashboard pages often await `fetch(…)` without a timeout. On a
// hung TCP connection the request can sit for 60–120 s before the
// browser's default gives up, during which the page appears frozen
// and any React state that depends on the response is stuck in a
// loading spinner. This helper:
//
//   • Aborts the request after `timeoutMs` (default 15 s).
//   • Throws a clearly-tagged `FetchTimeoutError` the caller can
//     distinguish from a network failure.
//   • Is a drop-in for `fetch(…)` — same URL + init args.
//
// Prefer this over raw `fetch` in any dashboard code path that
// renders a spinner while awaiting.
// ═══════════════════════════════════════════════════════════════

export class FetchTimeoutError extends Error {
  public readonly url: string;
  public readonly timeoutMs: number;
  constructor(url: string, timeoutMs: number) {
    super(`fetch(${url}) timed out after ${timeoutMs}ms`);
    this.name = "FetchTimeoutError";
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

export interface FetchWithTimeoutInit extends RequestInit {
  /** Request timeout in milliseconds. Default 15000. */
  timeoutMs?: number;
}

/**
 * `fetch` with a hard timeout. Returns the Response if the server
 * responds within `timeoutMs`, otherwise throws FetchTimeoutError.
 *
 * If the caller passed their own `signal`, we compose it with the
 * timeout signal so either can trigger the abort.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: FetchWithTimeoutInit = {},
): Promise<Response> {
  const { timeoutMs = 15000, signal: callerSignal, ...rest } = init;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // If the caller supplied their own signal, link it to our controller
  // so either path (caller-abort or our timeout) cancels the request.
  let callerAbortHandler: (() => void) | null = null;
  if (callerSignal) {
    if (callerSignal.aborted) {
      clearTimeout(timeoutId);
      throw new DOMException("Aborted", "AbortError");
    }
    callerAbortHandler = () => controller.abort();
    callerSignal.addEventListener("abort", callerAbortHandler);
  }

  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } catch (err) {
    // Distinguish timeout from other aborts / network failures.
    if (err instanceof Error && err.name === "AbortError") {
      if (callerSignal?.aborted) throw err; // caller-initiated abort
      throw new FetchTimeoutError(String(input), timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (callerSignal && callerAbortHandler) {
      callerSignal.removeEventListener("abort", callerAbortHandler);
    }
  }
}
