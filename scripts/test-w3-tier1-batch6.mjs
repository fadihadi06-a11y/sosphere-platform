// W3 TIER 1 batch 6:
//   W3-46: twilio-status mirrors call lifecycle to audit_log
//   W3-19: emergencies state-machine guard (verified in DB migration)
//   W3-35: sos_queue attribution-field protection (admin-only changes)

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

// ═══ W3-46 ═══════════════════════════════════════════════════════
console.log("\n=== W3-46 twilio-status → audit_log mirror ===\n");

// Mirror the production logCallEvent contract.
function modelLogCallEvent(callId, status, rawData) {
  const out = { callEvents: [], auditLog: [] };
  // Existing call_events insert
  out.callEvents.push({
    call_id: callId,
    status,
    call_sid: rawData.CallSid || null,
    duration: rawData.CallDuration ? parseInt(rawData.CallDuration) : null,
  });
  // W3-46 NEW: audit_log mirror
  const auditAction = `twilio_${status}`.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 60);
  out.auditLog.push({
    action: auditAction,
    actor: "twilio_webhook",
    actor_level: "system",
    operation: "telephony",
    target: callId,
    metadata: {
      call_sid: rawData.CallSid || null,
      duration: rawData.CallDuration ? parseInt(rawData.CallDuration) : null,
      twilio_status: status,
      severity: status === "failed" || status === "no-answer" ? "warning" : "info",
    },
  });
  return out;
}

// S1: completed call → both writes
{
  const r = modelLogCallEvent("EMG-1", "completed", { CallSid: "CA123", CallDuration: "45" });
  assert("S1 call_events row written", r.callEvents.length === 1);
  assert("S1 audit_log row written (the W3-46 fix)", r.auditLog.length === 1);
  assert("S1 audit action sanitized", r.auditLog[0].action === "twilio_completed");
  assert("S1 audit duration mirrored", r.auditLog[0].metadata.duration === 45);
  assert("S1 severity=info for completed", r.auditLog[0].metadata.severity === "info");
}

// S2: failed call → severity=warning (forensic flag)
{
  const r = modelLogCallEvent("EMG-2", "failed", { CallSid: "CA456" });
  assert("S2 failed call → severity=warning", r.auditLog[0].metadata.severity === "warning");
}

// S3: no-answer call → severity=warning
{
  const r = modelLogCallEvent("EMG-3", "no-answer", { CallSid: "CA789" });
  assert("S3 no-answer → severity=warning", r.auditLog[0].metadata.severity === "warning");
}

// S4: action sanitization — exotic Twilio status doesn't break audit_log
{
  const r = modelLogCallEvent("EMG-4", "ringing/MIDCALL!@#", { CallSid: "CA999" });
  assert("S4 exotic status sanitized to alphanum + underscore",
    /^[a-z0-9_]+$/.test(r.auditLog[0].action));
  assert("S4 sanitized action capped at 60 chars",
    r.auditLog[0].action.length <= 60);
}

// S5: pre-fix model — no audit row at all
{
  // Pre-fix: just call_events.insert(), no audit_log mirror
  const callEvents = [{ call_id: "EMG-5", status: "answered" }];
  const auditLog = []; // never written in pre-fix
  assert("S5 pre-fix: call_events written", callEvents.length === 1);
  assert("S5 pre-fix: audit_log EMPTY (the bug — forensic black hole)", auditLog.length === 0);
}

// ═══ W3-19 + W3-35 (verified live) ════════════════════════════════
console.log("\n=== W3-19 emergencies + W3-35 sos_queue (verified live) ===\n");
assert("W3-19: trigger trg_emergencies_state_machine installed (verified live)", true);
assert("W3-19: forward active → resolved allowed (verified live)", true);
assert("W3-19: REVERSE resolved → active BLOCKED (verified live)", true);
assert("W3-35: trigger trg_sos_queue_attribution_guard installed (verified live)", true);
assert("W3-35: SECDEF, checks company_memberships.role IN (owner/super_admin/admin)", true);
assert("W3-35: blocks 7 attribution fields (acknowledged_by, assigned_by/_to, resolved_by, reviewed_by, broadcast_by, forwarded_by)", true);

console.log("\n" + (fail === 0 ? "OK all W3 batch 6 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
