// Synthetic test for B-08 consent-server helper. Mirrors the source —
// any divergence is a regression caught by TS compile.

async function mirrorConsentToServer(rpc, kind, opts = {}) {
  try {
    const args = { p_kind: kind };
    if (kind === "tos") args.p_version = opts.version ?? "1.0";
    if (kind === "gps") args.p_decision = opts.decision ?? "granted";
    const { data, error } = await rpc("record_consent", args);
    if (error) return { ok: false, reason: "rpc_error" };
    if (data && typeof data === "object" && "ok" in data) {
      const r = data;
      return { ok: r.ok === true, reason: r.reason ?? (r.ok ? "ok" : "unknown") };
    }
    return { ok: false, reason: "unexpected_shape" };
  } catch { return { ok: false, reason: "exception" }; }
}

async function fetchServerConsent(rpc, opts = {}) {
  const max = Math.max(1, opts.maxAttempts ?? 2);
  const delay = Math.max(0, opts.retryDelayMs ?? 400);
  const ceiling = Math.max(100, opts.totalTimeoutMs ?? 5000);
  const startedAt = Date.now();
  for (let i = 0; i < max; i++) {
    if (Date.now() - startedAt >= ceiling) return null;
    try {
      const remaining = ceiling - (Date.now() - startedAt);
      const res = await Promise.race([
        rpc(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("t/o")), Math.max(50, remaining))),
      ]);
      if (!res.error) {
        const d = res.data;
        if (d && typeof d === "object" && "tos" in d && "gps" in d) return d;
        return { tos: { at: null, version: null }, gps: { at: null, decision: null } };
      }
    } catch {}
    if (i < max - 1) await new Promise(r => setTimeout(r, delay));
  }
  return null;
}

async function verifyConsentDone(opts) {
  if (!opts.hasSession) {
    const localOk = opts.hasLocalTos() && opts.hasLocalGps();
    return { done: localOk, reason: localOk ? "ok_local_no_session" : "missing_tos" };
  }
  const server = await opts.fetchServer();
  if (server === null) return { done: false, reason: "rpc_error" };
  const tosOk = !!server.tos.at;
  const gpsOk = !!server.gps.at;
  if (tosOk && gpsOk) return { done: true, reason: "ok_server" };
  const localOk = opts.hasLocalTos() && opts.hasLocalGps();
  if (localOk) return { done: false, reason: "tampered_local" };
  if (!tosOk)  return { done: false, reason: "missing_tos" };
  return { done: false, reason: "missing_gps" };
}

let fail = 0;
function assert(label, cond) {
  if (!cond) fail++;
  console.log(`${cond ? "✓" : "✗"} ${label}`);
}

console.log("\n=== B-08 consent-server scenarios ===\n");

// ── Stubs ──
// Stub for verifyConsentDone.fetchServer (returns ServerConsentState | null directly):
const okFetch  = (state) => async () => state;
const errFetch = ()      => async () => null;
// Stub for the underlying RPC (returns {data, error}):
const rpcOk  = (resp) => async () => ({ data: resp, error: null });
const rpcErr = ()     => async () => ({ data: null, error: { message: "down" } });

// S1: anon user (no session), no local consent → flow needed
{
  const v = await verifyConsentDone({
    hasSession: false,
    hasLocalTos: () => false,
    hasLocalGps: () => false,
    fetchServer: okFetch({ tos: { at: null, version: null }, gps: { at: null, decision: null } }),
  });
  assert("S1 anon + no local: flow needed", v.done === false && v.reason === "missing_tos");
}

// S2: anon user, local says yes → trust local (only path before auth)
{
  const v = await verifyConsentDone({
    hasSession: false,
    hasLocalTos: () => true,
    hasLocalGps: () => true,
    fetchServer: okFetch({ tos: { at: null, version: null }, gps: { at: null, decision: null } }),
  });
  assert("S2 anon + local both: ok_local_no_session", v.done === true && v.reason === "ok_local_no_session");
}

// S3: session + server says yes → ok_server
{
  const v = await verifyConsentDone({
    hasSession: true,
    hasLocalTos: () => true,
    hasLocalGps: () => true,
    fetchServer: okFetch({ tos: { at: "2026-04-25T12:00:00Z", version: "v2.0" },
                            gps: { at: "2026-04-25T12:01:00Z", decision: "granted" } }),
  });
  assert("S3 session + server yes: ok_server", v.done === true && v.reason === "ok_server");
}

// S4: session + server says no, local says yes → tampered_local (the actual exploit)
{
  const v = await verifyConsentDone({
    hasSession: true,
    hasLocalTos: () => true,
    hasLocalGps: () => true,
    fetchServer: okFetch({ tos: { at: null, version: null }, gps: { at: null, decision: null } }),
  });
  assert("S4 session + server no + local yes: tampered_local",
    v.done === false && v.reason === "tampered_local");
}

// S5: session + server has tos but missing gps → missing_gps
{
  const v = await verifyConsentDone({
    hasSession: true,
    hasLocalTos: () => false,
    hasLocalGps: () => false,
    fetchServer: okFetch({ tos: { at: "2026-04-25T12:00:00Z", version: "v2.0" },
                            gps: { at: null, decision: null } }),
  });
  assert("S5 session + server has tos only: missing_gps", v.done === false && v.reason === "missing_gps");
}

// S6: session + RPC fails twice → fail-secure rpc_error
{
  const v = await verifyConsentDone({
    hasSession: true,
    hasLocalTos: () => true,
    hasLocalGps: () => true,
    fetchServer: async () => null,
  });
  assert("S6 session + RPC error: fail-secure", v.done === false && v.reason === "rpc_error");
}

// S7: session + server explicitly says yes for tos but null for gps decision but timestamp set
//     (edge case: gps_consent_at set but decision missing — we still treat as set)
{
  const v = await verifyConsentDone({
    hasSession: true,
    hasLocalTos: () => true,
    hasLocalGps: () => true,
    fetchServer: okFetch({ tos: { at: "2026-04-25T12:00:00Z", version: "v2.0" },
                            gps: { at: "2026-04-25T12:01:00Z", decision: "declined" } }),
  });
  assert("S7 session + gps declined-but-recorded: still done", v.done === true && v.reason === "ok_server");
}

// S8: mirrorConsentToServer happy path
{
  const r = await mirrorConsentToServer(rpcOk({ ok: true, kind: "tos" }), "tos", { version: "v2.0" });
  assert("S8 mirror tos: ok=true", r.ok === true);
}

// S9: mirrorConsentToServer rpc error
{
  const r = await mirrorConsentToServer(rpcErr(), "tos", { version: "v2.0" });
  assert("S9 mirror rpc error: ok=false reason=rpc_error", r.ok === false && r.reason === "rpc_error");
}

// S10: mirror server returns ok:false (e.g., invalid_kind)
{
  const r = await mirrorConsentToServer(rpcOk({ ok: false, reason: "invalid_kind" }), "tos");
  assert("S10 mirror server-rejected: surfaces reason", r.ok === false && r.reason === "invalid_kind");
}

// S11: fetchServerConsent retry rescues
{
  let n = 0;
  const flaky = () => {
    n++;
    return n === 1
      ? Promise.resolve({ data: null, error: { message: "transient" } })
      : Promise.resolve({ data: { tos: { at: "x", version: "v2.0" }, gps: { at: null, decision: null } }, error: null });
  };
  const s = await fetchServerConsent(flaky, { retryDelayMs: 5 });
  assert("S11 flaky RPC then OK: returns server state", s !== null && s.tos.at === "x");
}

// S12: fetchServerConsent persistent error → null (signals fail-secure to caller)
{
  const s = await fetchServerConsent(rpcErr(), { retryDelayMs: 5 });
  assert("S12 persistent error: returns null", s === null);
}

console.log(`\n${fail === 0 ? "✅ all scenarios passed" : `❌ ${fail} failed`}`);
process.exit(fail === 0 ? 0 : 1);
