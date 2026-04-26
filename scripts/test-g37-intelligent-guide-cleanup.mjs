// G-37 hard test — intelligent-guide auto-execute useEffect cleanup.
// Simulates the React useEffect lifecycle: when `phase` changes mid-flight,
// pending setTimeout callbacks (AUTO-EXECUTING + COMPLETED) must NOT fire
// against the new phase, and the cleanup must clearTimeout them.

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

// ── Mini phase-action engine mirroring the prod fix ──────────────
function makeGuide() {
  let phase = "contact";
  let phaseActions = {};
  let log = [];        // mirrors addLog
  let responseScore = 0;

  // Each "useEffect run" returns its cleanup function
  function runAutoExecuteEffect() {
    if (phase === "scanning" || phase === "complete") return () => {};
    const actions = phaseActions[phase];
    if (!actions) return () => {};
    let cancelled = false;
    const phaseAtStart = phase;
    const timers = [];
    actions.forEach((action, i) => {
      if (action.autoExecute && !action.completed && !action.executing) {
        const startT = setTimeout(() => {
          if (cancelled) return;
          // setPhaseActions: only touch phaseAtStart
          if (phaseActions[phaseAtStart] === undefined) return;
          const list = [...(phaseActions[phaseAtStart] || [])];
          if (list[i]?.completed) return;
          list[i] = { ...list[i], executing: true };
          phaseActions = { ...phaseActions, [phaseAtStart]: list };
          log.push("AUTO-EXECUTING:" + action.label + "@" + phaseAtStart);
          const completeT = setTimeout(() => {
            if (cancelled) return;
            if (phaseActions[phaseAtStart] === undefined) return;
            const list2 = [...(phaseActions[phaseAtStart] || [])];
            list2[i] = { ...list2[i], executing: false, completed: true };
            phaseActions = { ...phaseActions, [phaseAtStart]: list2 };
            log.push("COMPLETED:" + action.label + "@" + phaseAtStart);
            responseScore = Math.min(100, responseScore + 3);
          }, 30); // shortened from 1500+i*800 for test speed
          timers.push(completeT);
        }, 10); // shortened from 600+i*1200
        timers.push(startT);
      }
    });
    return () => {
      cancelled = true;
      timers.forEach(t => clearTimeout(t));
    };
  }

  return {
    setPhase(p) { phase = p; },
    setPhaseActions(pa) { phaseActions = pa; },
    runAutoExecuteEffect,
    peekActions: () => phaseActions,
    peekLog: () => [...log],
    peekScore: () => responseScore,
    reset() { phase = "contact"; phaseActions = {}; log = []; responseScore = 0; },
  };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// S1: happy path — single phase auto-executes both actions
{
  const g = makeGuide();
  g.setPhaseActions({
    contact: [
      { id: "a1", label: "Call", autoExecute: true, completed: false, executing: false },
      { id: "a2", label: "Text", autoExecute: true, completed: false, executing: false },
    ],
  });
  const cleanup = g.runAutoExecuteEffect();
  await sleep(80);
  cleanup();
  const acts = g.peekActions().contact;
  assert("S1 both actions completed", acts[0].completed && acts[1].completed);
  assert("S1 log has 4 entries (2 EXEC + 2 COMP)", g.peekLog().length === 4);
  assert("S1 score = 6 (3+3)", g.peekScore() === 6);
}

// S2: BEEHIVE — phase changes BEFORE startT fires. No auto-execute should happen.
{
  const g = makeGuide();
  g.setPhaseActions({
    contact: [
      { id: "a1", label: "Call", autoExecute: true, completed: false, executing: false },
    ],
    locate: [
      { id: "b1", label: "GPS", autoExecute: true, completed: false, executing: false },
    ],
  });
  const cleanup = g.runAutoExecuteEffect();  // for "contact"
  // Immediately switch phase + run new effect, cleanup old
  cleanup();
  g.setPhase("locate");
  const cleanup2 = g.runAutoExecuteEffect();
  await sleep(80);
  cleanup2();
  // Old phase ("contact") should NOT have any AUTO-EXECUTING entry
  const log = g.peekLog();
  const contactExec = log.filter(l => l.endsWith("@contact"));
  const locateExec = log.filter(l => l.endsWith("@locate"));
  assert("S2 no fires against old phase 'contact'", contactExec.length === 0,
    "got: " + JSON.stringify(contactExec));
  assert("S2 'locate' phase auto-executed", locateExec.length === 2);
  assert("S2 contact action NOT marked completed", !g.peekActions().contact[0].completed);
}

// S3: BEEHIVE — phase changes BETWEEN startT firing and completeT firing.
// Pre-fix: completeT would still fire and mark old action completed.
// Post-fix: cleanup sets cancelled=true + clearTimeout(completeT) → no fire.
{
  const g = makeGuide();
  g.setPhaseActions({
    contact: [
      { id: "a1", label: "Call", autoExecute: true, completed: false, executing: false },
    ],
    locate: [
      { id: "b1", label: "GPS", autoExecute: true, completed: false, executing: false },
    ],
  });
  const cleanup = g.runAutoExecuteEffect();
  await sleep(15);  // startT (10ms) has fired, completeT (30ms after) is pending
  // At this point contact[0].executing should be true (startT fired)
  assert("S3 startT fired before phase switch", g.peekActions().contact[0].executing === true);
  // Now switch
  cleanup();
  g.setPhase("locate");
  const cleanup2 = g.runAutoExecuteEffect();
  await sleep(80);
  cleanup2();
  // contact[0] must NOT be completed (completeT was cancelled)
  assert("S3 contact[0] NOT completed (completeT cancelled)",
    g.peekActions().contact[0].completed === false);
  assert("S3 contact[0] still shows executing: true (frozen by cleanup)",
    g.peekActions().contact[0].executing === true);
  // locate phase ran cleanly
  assert("S3 locate phase completed", g.peekActions().locate[0].completed === true);
  // Score should reflect ONLY locate's completion (3, not 6)
  assert("S3 responseScore = 3 (only locate counted)", g.peekScore() === 3);
}

// S4: 10 rapid phase switches — no leaked timers, no score inflation
{
  const g = makeGuide();
  g.setPhaseActions({
    contact: [{ id: "a", label: "X", autoExecute: true, completed: false, executing: false }],
  });
  for (let i = 0; i < 10; i++) {
    const c = g.runAutoExecuteEffect();
    await sleep(2);  // way before startT fires
    c();
  }
  // Final run, let it complete
  const cFinal = g.runAutoExecuteEffect();
  await sleep(80);
  cFinal();
  // Action completes ONCE
  assert("S4 action completed exactly once", g.peekActions().contact[0].completed === true);
  assert("S4 log has exactly 2 entries (1 EXEC + 1 COMP)", g.peekLog().length === 2);
  assert("S4 score = 3 (single completion, no leaks)", g.peekScore() === 3);
}

// S5: Idempotency — re-running effect on same phase doesn't double-fire
// (action.completed gate inside the closure prevents re-execution)
{
  const g = makeGuide();
  g.setPhaseActions({
    contact: [{ id: "a", label: "X", autoExecute: true, completed: false, executing: false }],
  });
  const c1 = g.runAutoExecuteEffect();
  await sleep(80);
  c1();
  // Now re-run with the SAME phase (mimics React re-render)
  const c2 = g.runAutoExecuteEffect();
  await sleep(80);
  c2();
  // Action remains completed (only once)
  assert("S5 action completed once after re-run",
    g.peekActions().contact[0].completed === true);
  assert("S5 log still 2 entries (no double-fire)", g.peekLog().length === 2);
  assert("S5 score = 3 (no double-bump)", g.peekScore() === 3);
}

// S6: cleanup BEFORE startT fires → no log entries, no state change
{
  const g = makeGuide();
  g.setPhaseActions({
    contact: [{ id: "a", label: "X", autoExecute: true, completed: false, executing: false }],
  });
  const c = g.runAutoExecuteEffect();
  c();  // immediate cleanup, before startT
  await sleep(80);
  assert("S6 no log after immediate cleanup", g.peekLog().length === 0);
  assert("S6 action untouched", g.peekActions().contact[0].executing === false &&
    g.peekActions().contact[0].completed === false);
  assert("S6 score still 0", g.peekScore() === 0);
}

console.log("\n" + (fail === 0 ? "OK all G-37 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
