// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — Shared probe handler (M3-#23, 2026-06-06)
// ─────────────────────────────────────────────────────────────────────────
// Synthetic-monitoring probe contract — extracted from sos-alert/index.ts
// (the only function that had a probe handler until now) so every other
// edge function can opt in with a single import + one if-check.
//
// CONTRACT
//   POST /<function>  with body { probe: true, probeId: "uuid", ... }
//   Auth: caller's normal auth (JWT or function-specific bearer); the
//         caller decides whether to gate the probe on auth by passing
//         the authenticate fn — most probes ARE auth-gated to prove the
//         JWT → user resolution path works end-to-end.
//
//   Success: 200 { ok: true, probeId, durationMs, stagesExecuted: string[] }
//   Failure: 401 / 400 / 500 with { ok: false, error: "<reason>", ... }
//
// USAGE
//   import { handleProbe } from "../_shared/probe-handler.ts";
//   // ... inside your function:
//   if (action === "probe") {
//     return await handleProbe(req, {
//       functionName: "twilio-call",
//       cors,
//       supabase,           // optional — only needed if logToAudit=true
//       authenticate,       // optional — gate the probe on a real JWT
//       logToAudit: true,   // write a "synthetic_probe" row via log_sos_audit
//     });
//   }
//
// WHY EXTRACTED
//   sos-alert had the handler inline (~70 LOC). Copying that into 10+
//   other functions guarantees drift — fix a bug in one, miss the
//   others. Shared module = one fix everywhere.
// ═══════════════════════════════════════════════════════════════════════════

export interface ProbeAuthResult {
  userId: string;
  email?: string;
}

export interface ProbeOptions {
  /** Function name surfaced in audit metadata + error messages. */
  functionName: string;
  /** CORS headers map applied to the probe response. */
  cors: Record<string, string>;
  /** Supabase admin client — required ONLY when logToAudit=true. */
  supabase?: {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
  };
  /** Authenticate the caller. Return null to deny. Most probes pass an
   *  auth fn so the probe proves the JWT → user resolution path. */
  authenticate?: (req: Request) => Promise<ProbeAuthResult | null>;
  /** Write a "synthetic_probe" row via log_sos_audit RPC. Off by default
   *  because some functions don't have audit_log write access. */
  logToAudit?: boolean;
}

/**
 * Handle a synthetic-monitoring probe request. Caller checks
 *   action === "probe"
 * before invoking. Returns a Response ready to send back to the client.
 */
export async function handleProbe(req: Request, opts: ProbeOptions): Promise<Response> {
  const probeStart = Date.now();
  const stages: string[] = [];

  try {
    // Stage 1: auth (proves JWT → user resolution path) — skip if no
    // authenticate fn provided (some probes are unauth by design, e.g.,
    // twilio webhooks gated by signature instead).
    let probeAuth: ProbeAuthResult | null = null;
    if (opts.authenticate) {
      probeAuth = await opts.authenticate(req);
      if (!probeAuth?.userId) {
        return new Response(
          JSON.stringify({ ok: false, error: "probe_unauthenticated", functionName: opts.functionName }),
          { status: 401, headers: { ...opts.cors, "Content-Type": "application/json" } },
        );
      }
      stages.push("auth");
    }

    // Stage 2: body shape
    const probeBody = await req.json().catch(() => null) as
      | { probe?: boolean; probeId?: string; region?: string; slaMs?: number }
      | null;
    if (!probeBody || probeBody.probe !== true || typeof probeBody.probeId !== "string") {
      return new Response(
        JSON.stringify({ ok: false, error: "probe_body_invalid", functionName: opts.functionName }),
        { status: 400, headers: { ...opts.cors, "Content-Type": "application/json" } },
      );
    }
    stages.push("body_shape");

    // Stage 3: optional audit log (proves the audit channel works
    // end-to-end). Failure is non-fatal — the stages list omits
    // "audit_log" if the RPC errored, which is visible on the
    // dashboard side.
    if (opts.logToAudit && opts.supabase && probeAuth) {
      try {
        const { error } = await opts.supabase.rpc("log_sos_audit", {
          p_action:       "synthetic_probe",
          p_actor:        probeAuth.email ?? probeAuth.userId,
          p_actor_level:  "probe",
          p_operation:    "monitoring",
          p_metadata: {
            functionName: opts.functionName,
            probeId:      probeBody.probeId,
            region:       probeBody.region ?? "unknown",
            slaMs:        probeBody.slaMs ?? null,
          },
        });
        if (error) {
          console.warn(`[${opts.functionName} probe] log_sos_audit RPC error:`, error.message.slice(0, 200));
        } else {
          stages.push("audit_log");
        }
      } catch (rpcErr) {
        // R-9 contract: never silent. Warn so operators can spot drift.
        console.warn(`[${opts.functionName} probe] log_sos_audit RPC threw:`,
          String((rpcErr as Error)?.message ?? rpcErr).slice(0, 200));
      }
    }

    // Stage 4: ack contract — probeId echoed back so the script can
    // verify it talked to the right deployment, not a stale cache.
    const durationMs = Date.now() - probeStart;
    return new Response(
      JSON.stringify({
        ok: true,
        functionName: opts.functionName,
        probeId: probeBody.probeId,
        durationMs,
        stagesExecuted: stages,
      }),
      { status: 200, headers: { ...opts.cors, "Content-Type": "application/json" } },
    );
  } catch (probeErr) {
    return new Response(
      JSON.stringify({
        ok:    false,
        error: "probe_internal_error",
        functionName: opts.functionName,
        message: String((probeErr as Error)?.message ?? probeErr).slice(0, 300),
        stagesExecuted: stages,
      }),
      { status: 500, headers: { ...opts.cors, "Content-Type": "application/json" } },
    );
  }
}
