// ═══════════════════════════════════════════════════════════════════════════
// utils/lifecycle-guards — race-safe interval + dispose primitives
// ─────────────────────────────────────────────────────────────────────────
// 2026-04-25 (B-03 + B-04): the voice stack had two related bugs.
//
//   B-04 (voice-call-engine levelInterval / timerInterval):
//     The interval callbacks read `this._callActive` to self-clear. If
//     a different code path flipped `_callActive` between two ticks
//     while the analyser was being disposed, the next tick could
//     sample a nulled analyser AND a brand-new interval (created on
//     reconnect) could double up. Result: zombie ticks + audio-level
//     leak.
//
//   B-03 (voice-provider-hybrid dispose):
//     dispose() set `_disposed = true` but pending fetches and
//     Realtime channel subscriptions kept running — their `.then()`
//     handlers would early-return thanks to the flag, but the network
//     work itself ran to completion. Worse, status events fired AFTER
//     dispose against stale state.
//
// The two fixes share a pattern: a synchronous "stop everything"
// signal whose effect is observable AT THE NEXT JOIN POINT, not after
// the in-flight tick / fetch completes.
//
// ── IntervalGuard ─────────────────────────────────────────────────
// Wraps a single interval. start() always stops the previous one and
// bumps an internal generation counter. The callback closure captures
// its own generation; if a tick fires after stop(), the captured
// generation no longer matches current → tick early-returns instead
// of touching state.
//
// ── DisposeGuard ──────────────────────────────────────────────────
// Wraps an AbortController. dispose() aborts the signal SYNCHRONOUSLY,
// so any awaited fetch sees `signal.aborted === true` immediately on
// resume. Helper `aborted` lets call sites check the flag without
// reaching into the internals.
// ═══════════════════════════════════════════════════════════════════════════

export class IntervalGuard {
  private timerId: ReturnType<typeof setInterval> | null = null;
  private generation = 0;

  /**
   * Start (or restart) the interval. Any previous interval owned by
   * this guard is stopped first, and its in-flight callbacks become
   * stale (will no-op on next tick).
   */
  start(cb: () => void, intervalMs: number): void {
    this.stop();
    const myGen = ++this.generation;
    this.timerId = setInterval(() => {
      // Generation check — silently skip if stop() ran since this
      // interval was scheduled.
      if (myGen !== this.generation) return;
      cb();
    }, intervalMs);
  }

  /** Synchronously clear the interval and invalidate any in-flight tick. */
  stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    // Always bump the generation, even when there was no active
    // interval — this guarantees that if a tick is mid-execution
    // when stop() is called, its next access to current state
    // (via this guard) sees a different generation.
    this.generation++;
  }

  /** Read-only — true while the interval is set. */
  isActive(): boolean {
    return this.timerId !== null;
  }

  /** For testing/debugging only. */
  _gen(): number {
    return this.generation;
  }
}

export class DisposeGuard {
  private controller: AbortController | null = null;

  /** Begin a new lifecycle. Aborts any prior controller first. */
  begin(): AbortSignal {
    this.dispose();
    this.controller = new AbortController();
    return this.controller.signal;
  }

  /** Synchronously abort. Subsequent awaits see signal.aborted === true. */
  dispose(): void {
    if (this.controller && !this.controller.signal.aborted) {
      try { this.controller.abort(); } catch { /* ignore */ }
    }
    this.controller = null;
  }

  /** True when no active session OR the active session has been aborted. */
  get aborted(): boolean {
    return !this.controller || this.controller.signal.aborted;
  }

  /** Get the active signal — useful to pass into fetch(). null if disposed. */
  get signal(): AbortSignal | null {
    return this.controller?.signal ?? null;
  }
}
