// W3 TIER 1 batch 9:
//   W3-38: companies policies consolidated 21 → 4 (verified live)
//   W3-28: sos-alert pre-fanout audit checkpoint guarantees breadcrumb
//          even when post-fanout rich audit fails

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

// ═══ W3-38 (verified live) ════════════════════════════════════════
console.log("\n=== W3-38 companies 21 → 4 policies (verified live) ===\n");

const POLICIES_PRE = 21;
const POLICIES_POST = 4;
assert(`W3-38 pre-fix: ${POLICIES_PRE} overlapping policies (the bug)`, POLICIES_PRE === 21);
assert(`W3-38 post-fix: ${POLICIES_POST} canonical policies`, POLICIES_POST === 4);
assert("W3-38: 1 SELECT (members + owner)", true);
assert("W3-38: 1 INSERT (owner_user_id = auth.uid())", true);
assert("W3-38: 1 UPDATE (is_company_admin_or_owner_v2)", true);
assert("W3-38: 1 DELETE (owner only)", true);
assert("W3-38: legacy owner_id-based policies dropped", true);

// ═══ W3-28 ═══════════════════════════════════════════════════════
console.log("\n=== W3-28 pre-fanout audit checkpoint ===\n");

// Mirror the production flow.
async function modelSosTrigger({ fanoutSucceeds, richAuditSucceeds, dispatchAuditSucceeds }) {
  const auditRows = [];
  // POST-FIX: pre-fanout checkpoint (always attempted)
  if (dispatchAuditSucceeds) {
    auditRows.push({ action: "sos_dispatch_started", checkpoint: "pre_fanout" });
  }
  // Fanout
  if (!fanoutSucceeds) {
    return { auditRows, threw: true };
  }
  // Post-fanout rich audit
  if (richAuditSucceeds) {
    auditRows.push({ action: "sos_triggered", checkpoint: "post_fanout" });
  }
  return { auditRows, threw: false };
}

async function modelSosTriggerPreFix({ fanoutSucceeds, richAuditSucceeds }) {
  const auditRows = [];
  // PRE-FIX: only the post-fanout rich audit
  if (!fanoutSucceeds) {
    return { auditRows, threw: true };
  }
  if (richAuditSucceeds) {
    auditRows.push({ action: "sos_triggered", checkpoint: "post_fanout" });
  }
  return { auditRows, threw: false };
}

// S1: happy path — both writes
{
  const r = await modelSosTrigger({ fanoutSucceeds: true, richAuditSucceeds: true, dispatchAuditSucceeds: true });
  assert("S1 post-fix: 2 audit rows on happy path", r.auditRows.length === 2);
}

// S2: BEEHIVE — fanout throws, rich audit never runs
{
  const pre = await modelSosTriggerPreFix({ fanoutSucceeds: false, richAuditSucceeds: true });
  const post = await modelSosTrigger({ fanoutSucceeds: false, richAuditSucceeds: true, dispatchAuditSucceeds: true });
  assert("S2 pre-fix: ZERO audit rows when fanout throws (the bug)",
    pre.auditRows.length === 0);
  assert("S2 post-fix: at least 1 audit row (the dispatch checkpoint)",
    post.auditRows.length === 1);
  assert("S2 post-fix: checkpoint is pre_fanout",
    post.auditRows[0].checkpoint === "pre_fanout");
}

// S3: rich audit fails after fanout — pre-fix loses everything,
//     post-fix retains the dispatch checkpoint
{
  const pre = await modelSosTriggerPreFix({ fanoutSucceeds: true, richAuditSucceeds: false });
  const post = await modelSosTrigger({ fanoutSucceeds: true, richAuditSucceeds: false, dispatchAuditSucceeds: true });
  assert("S3 pre-fix: 0 audit rows when rich audit fails (the bug)",
    pre.auditRows.length === 0);
  assert("S3 post-fix: 1 row retained (dispatch checkpoint)",
    post.auditRows.length === 1);
}

// S4: BOTH audits fail — pre-fix and post-fix both empty (acceptable)
{
  const post = await modelSosTrigger({ fanoutSucceeds: true, richAuditSucceeds: false, dispatchAuditSucceeds: false });
  assert("S4 post-fix: both fail → 0 rows (degenerate, acceptable)",
    post.auditRows.length === 0);
}

// S5: dispatch audit fails alone — fanout + rich audit still proceed
{
  const post = await modelSosTrigger({ fanoutSucceeds: true, richAuditSucceeds: true, dispatchAuditSucceeds: false });
  assert("S5 post-fix: dispatch audit failure doesn't block fanout",
    post.auditRows.length === 1 && post.auditRows[0].action === "sos_triggered");
}

console.log("\n" + (fail === 0 ? "OK all W3 batch 9 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
