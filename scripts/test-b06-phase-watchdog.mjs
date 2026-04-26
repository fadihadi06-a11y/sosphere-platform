// Synthetic test for B-06 PhaseWatchdog. Inline copies of the decision
// function and helper class — kept in sync with source.

const PHASE_RULES_DEFAULT = {
  detection:     { budgetMs:  30_000, nextPhase: "contact" },
  contact:       { budgetMs:  90_000, nextPhase: "evidence" },
  evidence:      { budgetMs: 120_000, nextPhase: "decision" },
  decision:      { budgetMs:  60_000, nextPhase: "emergency" },
  emergency:     { budgetMs: 5 * 60_000, isTerminal: true },
  search:        { budgetMs: 10 * 60_000, nextPhase: "documentation" },
  false_alarm:   { budgetMs:  60_000, nextPhase: "documentation" },
  documentation: { budgetMs: 5 * 60_000, nextPhase: "closing" },
  closing:       { budgetMs: Number.POSITIVE_INFINITY, isTerminal: true },
};
const BATTERY_FORCE = 5;
const BATTERY_PANIC = 10;
const STALE_EMERGENCY_MS = 5 * 60_000;
const EARLY = new Set(["detection","contact","evidence","decision"]);

function decidePhaseAction(state, rules = PHASE_RULES_DEFAULT, nowMs = Date.now()) {
  const r = rules[state.phase] ?? { budgetMs: 60_000 };
  const elapsed = Math.max(0, nowMs - state.startedAt);
  if (typeof state.batteryLevel === "number" && state.batteryLevel <= BATTERY_FORCE) {
    if (state.phase !== "emergency" && state.phase !== "closing") {
      return { action: "fast_path_emergency", reason: `battery_critical_${state.batteryLevel}pct` };
    }
  }
  if (typeof state.batteryLevel === "number" && state.batteryLevel <= BATTERY_PANIC) {
    if (EARLY.has(state.phase)) {
      return { action: "fast_path_emergency", reason: `battery_low_${state.batteryLevel}pct` };
    }
  }
  if (state.phase === "emergency" && !state.hasAdminActed && elapsed >= STALE_EMERGENCY_MS) {
    return { action: "forward_to_owner", reason: `stale_emergency_${Math.floor(elapsed/1000)}s_no_action` };
  }
  if (elapsed >= r.budgetMs && r.nextPhase && !r.isTerminal) {
    return { action: "advance", toPhase: r.nextPhase, reason: `phase_budget_exceeded_${Math.floor(elapsed/1000)}s` };
  }
  return { action: "wait" };
}

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`);
}

console.log("\n=== B-06 PhaseWatchdog scenarios ===\n");

const fixedNow = 2_000_000_000_000; // arbitrary stable epoch

// S1: phase just started — wait
{
  const s = { phase: "detection", startedAt: fixedNow, severity: "high", hasAdminActed: false };
  const d = decidePhaseAction(s, PHASE_RULES_DEFAULT, fixedNow + 5_000);
  assert("S1 detection 5s in: wait", d.action === "wait");
}

// S2: detection budget exceeded → advance to contact
{
  const s = { phase: "detection", startedAt: fixedNow, severity: "high", hasAdminActed: false };
  const d = decidePhaseAction(s, PHASE_RULES_DEFAULT, fixedNow + 31_000);
  assert("S2 detection 31s: advance to contact",
    d.action === "advance" && d.toPhase === "contact");
}

// S3: evidence with battery 8% → fast-path emergency (panic)
{
  const s = { phase: "evidence", startedAt: fixedNow, severity: "critical", hasAdminActed: false, batteryLevel: 8 };
  const d = decidePhaseAction(s, PHASE_RULES_DEFAULT, fixedNow + 1_000);
  assert("S3 evidence + battery 8%: fast_path_emergency",
    d.action === "fast_path_emergency" && d.reason === "battery_low_8pct");
}

// S4: evidence with battery 4% → battery FORCE override
{
  const s = { phase: "evidence", startedAt: fixedNow, severity: "critical", hasAdminActed: false, batteryLevel: 4 };
  const d = decidePhaseAction(s, PHASE_RULES_DEFAULT, fixedNow + 1_000);
  assert("S4 evidence + battery 4%: fast_path_emergency (force)",
    d.action === "fast_path_emergency" && d.reason === "battery_critical_4pct");
}

// S5: emergency phase with battery 4% → DO NOT fast-path again
{
  const s = { phase: "emergency", startedAt: fixedNow, severity: "critical", hasAdminActed: false, batteryLevel: 4 };
  const d = decidePhaseAction(s, PHASE_RULES_DEFAULT, fixedNow + 1_000);
  assert("S5 emergency + battery 4%: NOT re-fast-pathed",
    d.action !== "fast_path_emergency");
}

// S6: emergency phase with no admin action for 5 min → forward_to_owner
{
  const s = { phase: "emergency", startedAt: fixedNow, severity: "critical", hasAdminActed: false };
  const d = decidePhaseAction(s, PHASE_RULES_DEFAULT, fixedNow + 5 * 60_000 + 1_000);
  assert("S6 emergency stale 5min no action: forward_to_owner",
    d.action === "forward_to_owner");
}

// S7: emergency phase but admin DID act → no forward
{
  const s = { phase: "emergency", startedAt: fixedNow, severity: "critical", hasAdminActed: true };
  const d = decidePhaseAction(s, PHASE_RULES_DEFAULT, fixedNow + 10 * 60_000);
  assert("S7 emergency + admin acted: no forward (waiting)",
    d.action === "wait");
}

// S8: contact phase battery 11% (above threshold) → just wait
{
  const s = { phase: "contact", startedAt: fixedNow, severity: "high", hasAdminActed: false, batteryLevel: 11 };
  const d = decidePhaseAction(s, PHASE_RULES_DEFAULT, fixedNow + 1_000);
  assert("S8 contact + battery 11%: wait (above panic threshold)",
    d.action === "wait");
}

// S9: documentation phase budget exceeded → advance to closing
{
  const s = { phase: "documentation", startedAt: fixedNow, severity: "low", hasAdminActed: false };
  const d = decidePhaseAction(s, PHASE_RULES_DEFAULT, fixedNow + 5 * 60_000 + 1_000);
  assert("S9 documentation 5min: advance to closing",
    d.action === "advance" && d.toPhase === "closing");
}

// S10: closing phase is terminal — never advances
{
  const s = { phase: "closing", startedAt: fixedNow, severity: "low", hasAdminActed: true };
  const d = decidePhaseAction(s, PHASE_RULES_DEFAULT, fixedNow + 24 * 60 * 60_000);
  assert("S10 closing 24h later: still wait (terminal)",
    d.action === "wait");
}

// S11: false_alarm budget exceeded → advance to documentation
{
  const s = { phase: "false_alarm", startedAt: fixedNow, severity: "low", hasAdminActed: false };
  const d = decidePhaseAction(s, PHASE_RULES_DEFAULT, fixedNow + 61_000);
  assert("S11 false_alarm 61s: advance to documentation",
    d.action === "advance" && d.toPhase === "documentation");
}

// S12: search phase 10min budget
{
  const s = { phase: "search", startedAt: fixedNow, severity: "high", hasAdminActed: false };
  const d = decidePhaseAction(s, PHASE_RULES_DEFAULT, fixedNow + 10 * 60_000 + 1_000);
  assert("S12 search 10min: advance to documentation",
    d.action === "advance" && d.toPhase === "documentation");
}

// S13: detection 25s in + battery 9% → battery rule wins (advance to emergency)
{
  const s = { phase: "detection", startedAt: fixedNow, severity: "high", hasAdminActed: false, batteryLevel: 9 };
  const d = decidePhaseAction(s, PHASE_RULES_DEFAULT, fixedNow + 25_000);
  assert("S13 detection 25s + battery 9%: battery rule wins (fast_path)",
    d.action === "fast_path_emergency");
}

// S14: detection 35s in + battery 50% → standard advance (battery doesn't fire)
{
  const s = { phase: "detection", startedAt: fixedNow, severity: "high", hasAdminActed: false, batteryLevel: 50 };
  const d = decidePhaseAction(s, PHASE_RULES_DEFAULT, fixedNow + 35_000);
  assert("S14 detection 35s + battery 50%: advance to contact (battery OK)",
    d.action === "advance" && d.toPhase === "contact");
}

// S15: undefined battery + early phase → no fast-path
{
  const s = { phase: "evidence", startedAt: fixedNow, severity: "high", hasAdminActed: false };
  const d = decidePhaseAction(s, PHASE_RULES_DEFAULT, fixedNow + 1_000);
  assert("S15 evidence + battery undefined: wait (no panic)",
    d.action === "wait");
}

console.log(`\n${fail === 0 ? "✅ all scenarios passed" : `❌ ${fail} failed`}`);
process.exit(fail === 0 ? 0 : 1);
