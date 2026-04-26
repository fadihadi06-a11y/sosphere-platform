// ═══════════════════════════════════════════════════════════════════════════
// utils/phase-watchdog — autonomous phase advancement at "zero hour"
// ─────────────────────────────────────────────────────────────────────────
// 2026-04-25 (B-06): the AI Co-Admin and Intelligent Guide both tracked
// phase timeouts but never acted on them. The countdown bar turned red,
// the response score decayed, and that was it. A user stuck in
// `evidence` while the battery dropped to 5% would not be escalated.
//
// This helper formalises three autonomous behaviors at zero hour:
//
//   1) PHASE BUDGET (auto-advance)
//      Each phase has a soft budget. When exceeded, the watchdog emits
//      an "advance" decision with the next phase. A human can always
//      override — the watchdog only fires when no advance has happened
//      yet.
//
//   2) BATTERY PANIC (fast-path)
//      Battery ≤ 10% AND we're still in early phases (detection /
//      contact / evidence) → jump straight to `emergency`. Battery
//      ≤ 5% → fast-path regardless of phase (except already-terminal).
//      The reasoning: a dying phone has minutes; we cannot afford
//      another 90s of evidence collection.
//
//   3) STALE EMERGENCY (forward to owner)
//      In the `emergency` phase with NO dispatcher action for 5 min,
//      auto-forward to the company owner so a real human takes over.
//      Empty phone-watch dispatch desks (small companies) are the
//      common failure mode here.
//
// Decisions are PURE (deterministic from input state) — testable in
// isolation. The runtime wrapper (PhaseWatchdog class) wires them to
// an IntervalGuard so the host React component just needs to call
// `start()` once and `notifyAdminAction()` whenever a button is
// clicked.
// ═══════════════════════════════════════════════════════════════════════════

import { IntervalGuard } from "./lifecycle-guards";

export type PhaseDecision =
  | { action: "advance"; toPhase: string; reason: string }
  | { action: "fast_path_emergency"; reason: string }
  | { action: "forward_to_owner"; reason: string }
  | { action: "wait" };

export interface WatchdogState {
  phase: string;
  /** Wall-clock timestamp (ms) when this phase started — used for budget. */
  startedAt: number;
  /** 0–100 device battery percentage. Optional; absence means we don't trigger battery rules. */
  batteryLevel?: number;
  severity: "critical" | "high" | "medium" | "low";
  /** Dispatcher (or admin) has taken at least one action this phase. */
  hasAdminActed: boolean;
}

export interface PhaseRules {
  budgetMs: number;
  nextPhase?: string;
  /** Terminal phases never auto-advance (only stale-detection applies). */
  isTerminal?: boolean;
}

/** Default rule set for AI Co-Admin / Intelligent Guide. */
export const PHASE_RULES_DEFAULT: Record<string, PhaseRules> = {
  // Pre-emergency phases — relatively short budgets so we don't burn
  // battery while the user is unresponsive.
  detection:     { budgetMs:  30_000, nextPhase: "contact" },
  contact:       { budgetMs:  90_000, nextPhase: "evidence" },
  evidence:      { budgetMs: 120_000, nextPhase: "decision" },
  decision:      { budgetMs:  60_000, nextPhase: "emergency" },
  // Emergency itself is terminal w.r.t. timeout but watched for stale.
  emergency:     { budgetMs: 5 * 60_000, isTerminal: true },
  search:        { budgetMs: 10 * 60_000, nextPhase: "documentation" },
  false_alarm:   { budgetMs:  60_000, nextPhase: "documentation" },
  documentation: { budgetMs: 5 * 60_000, nextPhase: "closing" },
  closing:       { budgetMs: Number.POSITIVE_INFINITY, isTerminal: true },
};

const BATTERY_FORCE_THRESHOLD = 5;     // hard cutoff regardless of phase
const BATTERY_PANIC_THRESHOLD = 10;    // panic only in early phases
const STALE_EMERGENCY_MS      = 5 * 60_000;
const EARLY_PHASES = new Set(["detection", "contact", "evidence", "decision"]);

/** Pure decision function — testable without timers. */
export function decidePhaseAction(
  state: WatchdogState,
  rules: Record<string, PhaseRules> = PHASE_RULES_DEFAULT,
  nowMs: number = Date.now(),
): PhaseDecision {
  const r = rules[state.phase] ?? { budgetMs: 60_000 };
  const elapsed = Math.max(0, nowMs - state.startedAt);

  // 1. Battery FORCE — highest priority, can fire from any non-terminal phase.
  if (typeof state.batteryLevel === "number" && state.batteryLevel <= BATTERY_FORCE_THRESHOLD) {
    if (state.phase !== "emergency" && state.phase !== "closing") {
      return { action: "fast_path_emergency",
        reason: `battery_critical_${state.batteryLevel}pct` };
    }
  }

  // 2. Battery PANIC — only in early phases.
  if (typeof state.batteryLevel === "number" && state.batteryLevel <= BATTERY_PANIC_THRESHOLD) {
    if (EARLY_PHASES.has(state.phase)) {
      return { action: "fast_path_emergency",
        reason: `battery_low_${state.batteryLevel}pct` };
    }
  }

  // 3. Stale emergency — emergency phase with no admin action for 5 min.
  if (state.phase === "emergency" && !state.hasAdminActed && elapsed >= STALE_EMERGENCY_MS) {
    return { action: "forward_to_owner",
      reason: `stale_emergency_${Math.floor(elapsed / 1000)}s_no_action` };
  }

  // 4. Soft phase budget exceeded → auto-advance.
  if (elapsed >= r.budgetMs && r.nextPhase && !r.isTerminal) {
    return { action: "advance", toPhase: r.nextPhase,
      reason: `phase_budget_exceeded_${Math.floor(elapsed / 1000)}s` };
  }

  return { action: "wait" };
}

/**
 * Runtime wrapper: starts a 1Hz tick (via IntervalGuard so it can never
 * leak), reads the current state, and emits decisions through onDecision.
 * The host React component is expected to:
 *   • call start() when entering the engine;
 *   • call setPhase(p) when the human (or this watchdog) advances;
 *   • call notifyAdminAction() whenever the dispatcher clicks a button;
 *   • call setBattery(level) on every heartbeat;
 *   • call stop() when the engine closes.
 *
 * Decisions fire only ONCE per state — once we emit "advance to X",
 * the consumer is expected to call setPhase("X") which resets the
 * baseline and prevents re-firing.
 */
export class PhaseWatchdog {
  private guard = new IntervalGuard();
  private state: WatchdogState | null = null;
  private rules: Record<string, PhaseRules>;
  private lastEmittedReason = "";

  constructor(rules: Record<string, PhaseRules> = PHASE_RULES_DEFAULT) {
    this.rules = rules;
  }

  start(initial: WatchdogState, onDecision: (d: PhaseDecision) => void, tickMs = 1000): void {
    this.state = { ...initial };
    this.lastEmittedReason = "";
    this.guard.start(() => {
      if (!this.state) return;
      const d = decidePhaseAction(this.state, this.rules);
      if (d.action === "wait") return;
      // Avoid spamming the same decision every tick. setPhase() clears
      // this so a second pass through the same condition (legitimately
      // different state) can re-emit.
      if ("reason" in d && d.reason === this.lastEmittedReason) return;
      this.lastEmittedReason = "reason" in d ? d.reason : "";
      onDecision(d);
    }, tickMs);
  }

  setPhase(newPhase: string): void {
    if (!this.state) return;
    this.state = { ...this.state, phase: newPhase, startedAt: Date.now(), hasAdminActed: false };
    this.lastEmittedReason = "";
  }

  notifyAdminAction(): void {
    if (!this.state) return;
    this.state = { ...this.state, hasAdminActed: true };
  }

  setBattery(level: number): void {
    if (!this.state) return;
    this.state = { ...this.state, batteryLevel: level };
  }

  setSeverity(severity: WatchdogState["severity"]): void {
    if (!this.state) return;
    this.state = { ...this.state, severity };
  }

  stop(): void {
    this.guard.stop();
    this.state = null;
    this.lastEmittedReason = "";
  }

  /** Read the current state — testing / debugging only. */
  _peek(): WatchdogState | null {
    return this.state;
  }
}
