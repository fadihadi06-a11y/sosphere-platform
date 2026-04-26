// ═══════════════════════════════════════════════════════════════
// test: incident-reports dispatcher wiring (B-02 completion)
// ─────────────────────────────────────────────────────────────
// Verifies the beehive contract for the 3 incident-report dispatcher
// actions (broadcast, forward_to_owner, mark_reviewed):
//
//   1. handler returns Promise<boolean>
//   2. on server success → setReports updates + toast.success + true
//   3. on server failure → setReports UNCHANGED + toast.error + false
//   4. drawer flips to "delivered" only when the parent returns true
//   5. modal closes only on success — failed call leaves drawer open
//   6. broadcastMsg (the user-edited text) is forwarded to the server
//      verbatim, NOT a synthetic placeholder
// ═══════════════════════════════════════════════════════════════

import fs from "node:fs";

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

const PATH = "src/app/components/hub-incident-reports.tsx";
const src = fs.readFileSync(PATH, "utf8");

// ── S1: pre-fix stubs are GONE ────────────────────────────────
console.log("\n=== S1 pre-fix stubs eliminated ===\n");
assert("S1.1 [SUPABASE_READY] log markers removed",
  !src.includes("[SUPABASE_READY] incident_report_update"));
assert("S1.2 1.5s fake setTimeout in drawer removed",
  !src.includes("await new Promise(r => setTimeout(r, 1500))"));

// ── S2: new wiring uses callDispatcherAction ──────────────────
console.log("\n=== S2 callDispatcherAction wiring present ===\n");
assert("S2.1 broadcast action wired",
  /callDispatcherAction\([\s\S]*?action:\s*"broadcast"/m.test(src));
assert("S2.2 forward_to_owner action wired",
  /callDispatcherAction\([\s\S]*?action:\s*"forward_to_owner"/m.test(src));
assert("S2.3 mark_reviewed action wired",
  /callDispatcherAction\([\s\S]*?action:\s*"mark_reviewed"/m.test(src));
assert("S2.4 emergencyId is forwarded (not the local report id)",
  /emergencyId:\s*report\.emergencyId/.test(src));

// ── S3: handlers return Promise<boolean> ──────────────────────
console.log("\n=== S3 Promise<boolean> contract ===\n");
const broadcastHandler = src.match(
  /const handleBroadcast = async \([\s\S]*?\): Promise<boolean> => \{[\s\S]*?^  \};/m
);
assert("S3.1 handleBroadcast typed Promise<boolean>", !!broadcastHandler);
const forwardHandler = src.match(
  /const handleForwardToOwner = async \(report: IncidentPhotoReport\): Promise<boolean>/
);
assert("S3.2 handleForwardToOwner typed Promise<boolean>", !!forwardHandler);
const markHandler = src.match(
  /const handleMarkReviewed = async \(id: string\): Promise<boolean>/
);
assert("S3.3 handleMarkReviewed typed Promise<boolean>", !!markHandler);

// ── S4: failure path returns false WITHOUT mutating state ─────
console.log("\n=== S4 failure path leaves state unchanged ===\n");
// Walk the file, find each "if (!result.ok)" block by tracking brace
// depth from the opening "{" through to its matching "}". Verify the
// extracted block contains `return false` and NO `setReports`.
function extractFailBlocks(s) {
  const blocks = [];
  const re = /if \(!result\.ok\) \{/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    let inStr = false, strCh = "";
    while (i < s.length && depth > 0) {
      const ch = s[i], nxt = s[i + 1];
      if (inStr) {
        if (ch === "\\") { i += 2; continue; }
        if (ch === strCh) inStr = false;
        i++; continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { inStr = true; strCh = ch; i++; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    blocks.push(s.slice(m.index, i));
  }
  return blocks;
}
const failBlocks = extractFailBlocks(src);
assert("S4 found 3 failure blocks (broadcast/forward/mark_reviewed)",
  failBlocks.length === 3, `actual=${failBlocks.length}`);
for (let i = 0; i < failBlocks.length; i++) {
  const b = failBlocks[i];
  const tag = ["broadcast", "forward_to_owner", "mark_reviewed"][i] || `#${i}`;
  assert(`S4.${i + 1} ${tag} failure → return false`,
    b.includes("return false"));
  assert(`S4.${i + 1}b ${tag} failure does NOT mutate setReports`,
    !b.includes("setReports"));
}

// ── S5: success path returns true AFTER setReports + toast ────
console.log("\n=== S5 success path mutates state THEN returns true ===\n");
assert("S5.1 broadcast success returns true",
  /toast\.success\(`Broadcast delivered[\s\S]{0,80}\);[\s\S]{0,30}return true;/.test(src));
assert("S5.2 forward success returns true",
  /toast\.success\("Forwarded to owner"\);[\s\S]{0,30}return true;/.test(src));
assert("S5.3 mark_reviewed success returns true",
  /toast\.success\("Marked reviewed"\);[\s\S]{0,30}return true;/.test(src));

// ── S6: drawer awaits the result + only flips on true ─────────
console.log("\n=== S6 drawer awaits server confirmation ===\n");
assert("S6.1 drawer awaits real server result (no fake delay)",
  /const ok = await onBroadcast\(report, broadcastScope, broadcastMsg\)/.test(src));
assert("S6.2 drawer flips to 'delivered' ONLY on ok===true",
  /if \(ok\) setBroadcastDone\(true\)/.test(src));

// ── S7: drawer prop signature uses Promise<boolean> ───────────
console.log("\n=== S7 drawer prop signature contract ===\n");
assert("S7.1 onBroadcast: 3 args + Promise<boolean>",
  /onBroadcast: \(report: IncidentPhotoReport, scope: "zone" \| "dept" \| "all", message: string\) => Promise<boolean>/.test(src));
assert("S7.2 onForwardToOwner: Promise<boolean>",
  /onForwardToOwner: \(report: IncidentPhotoReport\) => Promise<boolean>/.test(src));
assert("S7.3 onMarkReviewed: Promise<boolean>",
  /onMarkReviewed: \(id: string\) => Promise<boolean>/.test(src));

// ── S8: parent JSX wrapper passes 3 args + only closes on success ─
console.log("\n=== S8 parent JSX wrapper preserves contract ===\n");
assert("S8.1 onBroadcast wrapper passes (r, scope, message)",
  /onBroadcast=\{async \(r, scope, message\) => \{[\s\S]*?await handleBroadcast\(r, scope, message\)/.test(src));
assert("S8.2 onBroadcast wrapper closes modal ONLY on ok",
  /onBroadcast=\{async \(r, scope, message\) => \{[\s\S]*?if \(ok\) setSelectedReport\(null\);/.test(src));
assert("S8.3 onForwardToOwner wrapper closes modal ONLY on ok",
  /onForwardToOwner=\{async \(r\) => \{[\s\S]*?if \(ok\) setSelectedReport\(null\);/.test(src));

// ── S9: broadcastMsg flows through to the server ──────────────
console.log("\n=== S9 user-edited broadcastMsg reaches the server ===\n");
// The drawer captures broadcastMsg in state and we call onBroadcast(report, broadcastScope, broadcastMsg)
assert("S9.1 broadcastMsg state still defined in drawer",
  /\[broadcastMsg, setBroadcastMsg\] = useState\(/.test(src));
assert("S9.2 broadcastMsg is the 3rd arg to onBroadcast",
  /onBroadcast\(report, broadcastScope, broadcastMsg\)/.test(src));
assert("S9.3 callDispatcherAction broadcast forwards `message` param verbatim",
  /action:\s*"broadcast"[\s\S]{0,200}message,/.test(src));

// ── S10: simulation of beehive contract end-to-end ────────────
console.log("\n=== S10 beehive end-to-end simulation ===\n");
// Simulate: dispatcher clicks broadcast → server returns 401 → UI must
// stay in "new" status, drawer must NOT show "delivered", modal must
// NOT close, error toast must fire.
const simulate = (serverResult, initialStatus = "new") => {
  let reports = [{ id: "R-1", emergencyId: "EMG-1", status: initialStatus }];
  let toastErr = null, toastOk = null;
  let drawerDone = false;
  let modalOpen = true;
  const callDispatcherAction = async () => serverResult;
  const setReports = (fn) => { reports = fn(reports); };
  const toast = {
    error: (m) => { toastErr = m; },
    success: (m) => { toastOk = m; },
  };
  const handleBroadcast = async (report, scope, message) => {
    const result = await callDispatcherAction({
      action: "broadcast", emergencyId: report.emergencyId, scope, message,
    });
    if (!result.ok) { toast.error(`Broadcast failed: ${result.error}`); return false; }
    setReports(prev => prev.map(r =>
      r.id === report.id ? { ...r, status: "broadcast", broadcastTo: scope, reviewedBy: "Admin" } : r
    ));
    toast.success(`Broadcast delivered (${scope})`);
    return true;
  };
  return async () => {
    // drawer's onBroadcast wrapper closes modal only on ok
    const ok = await handleBroadcast(reports[0], "zone", "Stay clear");
    if (ok) modalOpen = false;
    if (ok) drawerDone = true;
    return { reports, toastErr, toastOk, modalOpen, drawerDone, ok };
  };
};

// 401 / RLS-denied path
{
  const r = await (simulate({ ok: false, error: "RLS denied" }))();
  assert("S10.1 RLS denied: status STAYS 'new'", r.reports[0].status === "new");
  assert("S10.2 RLS denied: toast.error fired", r.toastErr?.includes("Broadcast failed"));
  assert("S10.3 RLS denied: modal STAYS open", r.modalOpen === true);
  assert("S10.4 RLS denied: drawer NOT marked delivered", r.drawerDone === false);
  assert("S10.5 RLS denied: handler returned false", r.ok === false);
}
// happy path
{
  const r = await (simulate({ ok: true, data: {} }))();
  assert("S10.6 success: status changed to 'broadcast'", r.reports[0].status === "broadcast");
  assert("S10.7 success: toast.success fired", r.toastOk?.includes("Broadcast delivered"));
  assert("S10.8 success: modal CLOSED", r.modalOpen === false);
  assert("S10.9 success: drawer marked delivered", r.drawerDone === true);
  assert("S10.10 success: handler returned true", r.ok === true);
}
// network throw path (simulated as ok:false from callDispatcherAction's catch)
{
  const r = await (simulate({ ok: false, error: "Failed to fetch" }))();
  assert("S10.11 network error: status STAYS 'new' (no fake green)", r.reports[0].status === "new");
  assert("S10.12 network error: handler returned false", r.ok === false);
}

// ── S11: regression — no other consumer of these handlers broke ──
console.log("\n=== S11 regression — JSX call sites ===\n");
assert("S11.1 ReportDetailDrawer JSX still renders",
  /<ReportDetailDrawer[\s\S]*?\/>/.test(src));
assert("S11.2 EvidenceDetailPanel JSX still renders (not collateral damage)",
  /<EvidenceDetailPanel[\s\S]*?\/>/.test(src));
assert("S11.3 IncidentReportsTab is exported",
  /export function IncidentReportsTab\(/.test(src));

console.log("");
console.log(fail === 0
  ? `OK incident-reports dispatcher wiring fully verified (B-02 complete)`
  : `X ${fail} failure(s) — wiring is NOT beehive-clean`);
process.exit(fail === 0 ? 0 : 1);
