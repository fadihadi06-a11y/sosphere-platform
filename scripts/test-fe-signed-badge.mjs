// Synthetic test for F-E — dashboard-incident-investigation timeline
// signed/unsigned badge logic. Simulates the data flow:
//   smart-timeline-tracker.TimelineEntry[]  (with .signed)
//     → buildInvestigationFromEmg() projection (preserves .signed)
//       → renderer (unsignedCount banner + per-entry badge)

// ── Inline replicas of the production logic under test ──

// Mirrors the projection at line 117 of dashboard-incident-investigation.tsx
function buildTimeline(timelineEntries) {
  return timelineEntries.length > 0
    ? timelineEntries.map(te => ({
        date: new Date(te.timestamp),
        event: te.event,
        by: te.actor,
        signed: te.signed,
      }))
    : [
        { date: new Date(), event: "Emergency triggered", by: "User" },
        { date: new Date(), event: "Investigation auto-created", by: "System" },
      ];
}

// Mirrors the renderer's banner + per-entry decision
function renderTimeline(timeline) {
  const unsignedCount = timeline.filter(e => e.signed === false).length;
  const banner = unsignedCount > 0
    ? `⚠ ${unsignedCount} unsigned event${unsignedCount === 1 ? "" : "s"}`
    : null;
  const rows = timeline.map(e => ({
    label: e.event,
    showBadge: e.signed === false,
    color: e.signed === false ? "amber" : "cyan",
  }));
  return { banner, rows };
}

let fail = 0;
function assert(label, cond) {
  if (!cond) fail++;
  console.log(`${cond ? "✓" : "✗"} ${label}`);
}

console.log("\n=== F-E test scenarios ===\n");

// S1: all signed → no banner, no badges
{
  const tl = buildTimeline([
    { timestamp: Date.now() - 3000, event: "SOS triggered", actor: "Alice", signed: true },
    { timestamp: Date.now() - 2000, event: "Contact called",  actor: "System", signed: true },
    { timestamp: Date.now() - 1000, event: "Resolved",        actor: "Admin", signed: true },
  ]);
  const r = renderTimeline(tl);
  assert("S1 all signed: no banner", r.banner === null);
  assert("S1 all signed: no badges shown", r.rows.every(x => !x.showBadge));
}

// S2: all unsigned → banner shows "3 unsigned events"; all badges shown
{
  const tl = buildTimeline([
    { timestamp: Date.now() - 3000, event: "SOS triggered", actor: "Alice", signed: false },
    { timestamp: Date.now() - 2000, event: "Contact called",  actor: "System", signed: false },
    { timestamp: Date.now() - 1000, event: "Resolved",        actor: "Admin", signed: false },
  ]);
  const r = renderTimeline(tl);
  assert("S2 all unsigned: banner present", r.banner?.includes("3 unsigned events"));
  assert("S2 all unsigned: all badges shown", r.rows.every(x => x.showBadge && x.color === "amber"));
}

// S3: mixed — only the unsigned one gets a badge
{
  const tl = buildTimeline([
    { timestamp: 1000, event: "SOS triggered", actor: "Alice", signed: true },
    { timestamp: 2000, event: "GPS update",    actor: "System", signed: false },
    { timestamp: 3000, event: "Resolved",      actor: "Admin", signed: true },
  ]);
  const r = renderTimeline(tl);
  assert("S3 mixed: banner shows 1 unsigned event (singular)", r.banner === "⚠ 1 unsigned event");
  assert("S3 mixed: SOS triggered NOT badged", r.rows[0].showBadge === false);
  assert("S3 mixed: GPS update IS badged",     r.rows[1].showBadge === true);
  assert("S3 mixed: Resolved NOT badged",      r.rows[2].showBadge === false);
}

// S4: legacy entries with `signed === undefined` (back-compat from older cache)
//     → not flagged false, treated as signed (back-compat preserves trust until proven otherwise via loadTimelines)
{
  const tl = buildTimeline([
    { timestamp: 1000, event: "Legacy entry", actor: "Sys", signed: undefined },
    { timestamp: 2000, event: "Newer signed", actor: "Sys", signed: true },
  ]);
  const r = renderTimeline(tl);
  assert("S4 undefined signed: no banner (treated as not-explicitly-false)", r.banner === null);
  assert("S4 undefined signed: no badge",      r.rows.every(x => !x.showBadge));
}

// S5: empty timeline → fallback default (no signed flag) → no banner
{
  const tl = buildTimeline([]);
  const r = renderTimeline(tl);
  assert("S5 empty timeline: no banner", r.banner === null);
  assert("S5 empty timeline: 2 default entries (mock)", r.rows.length === 2);
}

// S6: mock investigations (no signed flag at all) → no banner, no badges
{
  const r = renderTimeline([
    { date: new Date(), event: "Mock 1", by: "X" },
    { date: new Date(), event: "Mock 2", by: "Y" },
  ]);
  assert("S6 mock entries: no banner", r.banner === null);
  assert("S6 mock entries: no badges", r.rows.every(x => !x.showBadge));
}

// S7: 5 unsigned with 1 signed → banner pluralizes correctly + badge count = 5
{
  const tl = buildTimeline([
    { timestamp: 1, event: "A", actor: "X", signed: false },
    { timestamp: 2, event: "B", actor: "X", signed: false },
    { timestamp: 3, event: "C", actor: "X", signed: true  },
    { timestamp: 4, event: "D", actor: "X", signed: false },
    { timestamp: 5, event: "E", actor: "X", signed: false },
    { timestamp: 6, event: "F", actor: "X", signed: false },
  ]);
  const r = renderTimeline(tl);
  assert("S7 banner pluralizes", r.banner === "⚠ 5 unsigned events");
  const badgedCount = r.rows.filter(x => x.showBadge).length;
  assert("S7 badge count = 5", badgedCount === 5);
}

console.log(`\n${fail === 0 ? "✅ all scenarios passed" : `❌ ${fail} failed`}`);
process.exit(fail === 0 ? 0 : 1);
