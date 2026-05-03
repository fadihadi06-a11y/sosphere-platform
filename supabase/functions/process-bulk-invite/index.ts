// ═══════════════════════════════════════════════════════════════
// SOSphere — Edge Function: process-bulk-invite (E1.4)
// ═══════════════════════════════════════════════════════════════
// WORLD-CLASS WORKER PATTERN
// ──────────────────────────
// • Reads messages from pgmq queue 'bulk_invite' with 5-minute visibility
//   timeout (SKIP LOCKED concurrency — N workers can run in parallel safely)
// • For each message: orchestrates the existing invite-employees edge function
//   in chunks, updates progress, exponential-backoff on failure
// • Triggered every 30 seconds by pg_cron + pg_net.http_post (E1.4 migration)
// • Auth: shared CRON_SECRET header (cron is the only legitimate caller)
//
// IDEMPOTENCY GUARANTEES
// ──────────────────────
// 1. pgmq visibility timeout: while one worker holds a message, others skip it
// 2. Each chunk-call to invite-employees is itself idempotent (Supabase Auth
//    inviteUserByEmail already handles "user already registered")
// 3. Progress updates use jsonb_set so partial failures resume correctly
// 4. On crash mid-message: visibility expires after 5 min → next worker picks
//    it up → starts from progress.processed (skips already-done items)
//
// FAILURE HANDLING
// ────────────────
// • Per-chunk error: count toward progress.failed but continue
// • Whole-message error: increment attempt_count; if < max_attempts →
//   pgmq.send_with_delay (exponential 1m / 5m / 30m); else → status='failed'
// • All terminal states write audit_log entry
//
// Deploy: supabase functions deploy process-bulk-invite
// Set secret: supabase secrets set CRON_SECRET=<long-random-string>
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET               = Deno.env.get("CRON_SECRET") || "";
const INVITE_FN_URL             = `${SUPABASE_URL}/functions/v1/invite-employees`;

// pgmq read parameters
const VISIBILITY_TIMEOUT_SECS = 300;  // 5 min — long enough for a chunk to complete
const BATCH_QTY               = 10;   // up to 10 messages per worker run
const CHUNK_SIZE              = 100;  // employees per invite-employees HTTP call
const MAX_RUNTIME_MS          = 50_000; // edge fn timeout safety (Supabase limit ~60s)

// Exponential backoff for whole-message retry (seconds)
const BACKOFF_SCHEDULE = [60, 300, 1800];  // 1 min, 5 min, 30 min

interface JobMetadata {
  id: string;
  pgmq_msg_id: number;
  job_type: string;
  company_id: string;
  status: string;
  progress: { total: number; processed: number; succeeded: number; failed: number };
  attempt_count: number;
  max_attempts: number;
}

interface PgmqMessage {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  message: {
    items?: Array<{ email: string; full_name?: string; company_id?: string }>;
    company_id?: string;
    estimated_count?: number;
    source?: string;
  };
}

Deno.serve(async (req: Request) => {
  // ── Auth: only the cron caller (or admin manual trigger with CRON_SECRET) ──
  const providedSecret = req.headers.get("x-cron-secret") || "";
  if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
    console.warn("[process-bulk-invite] rejected: missing/invalid CRON_SECRET");
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // ── Step 1: read up to BATCH_QTY messages from the queue ──
    // Supabase exposes pgmq via public.pgmq_public RPCs. Use raw SQL via
    // postgres-meta-style query if pgmq_public not enabled; otherwise call directly.
    const { data: msgs, error: readErr } = await supabase.rpc("pgmq_read", {
      queue_name: "bulk_invite",
      sleep_seconds: VISIBILITY_TIMEOUT_SECS,
      n: BATCH_QTY,
    }).then(r => r.data ? r : supabase.schema("pgmq").rpc("read", {
      queue_name: "bulk_invite",
      vt: VISIBILITY_TIMEOUT_SECS,
      qty: BATCH_QTY,
    }));

    if (readErr) {
      console.error("[process-bulk-invite] pgmq.read failed:", readErr);
      return jsonResponse({ ok: false, error: readErr.message }, 500);
    }

    const messages = (msgs as PgmqMessage[] | null) || [];
    if (messages.length === 0) {
      return jsonResponse({ ok: true, processed: 0, note: "queue empty" });
    }

    console.log(`[process-bulk-invite] read ${messages.length} message(s)`);

    // ── Step 2: process each message (sequentially within this worker; multiple
    //   workers can run in parallel safely thanks to pgmq visibility timeout) ──
    let processedCount = 0;
    let failedCount    = 0;
    const results: Array<{ msg_id: number; outcome: string; detail?: string }> = [];

    for (const msg of messages) {
      // Time-budget safety: if approaching edge function timeout, leave the
      // remaining messages for the next cron tick (visibility will release them).
      if (Date.now() - startedAt > MAX_RUNTIME_MS) {
        console.warn("[process-bulk-invite] runtime budget exhausted; deferring remaining messages");
        break;
      }

      const outcome = await processMessage(supabase, msg);
      results.push({ msg_id: msg.msg_id, outcome: outcome.outcome, detail: outcome.detail });
      if (outcome.outcome === "completed" || outcome.outcome === "skipped") processedCount++;
      else failedCount++;
    }

    return jsonResponse({
      ok: true,
      processed: processedCount,
      failed:    failedCount,
      results,
      elapsed_ms: Date.now() - startedAt,
    });

  } catch (err) {
    console.error("[process-bulk-invite] top-level error:", err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// processMessage — handles one pgmq message end-to-end
// ═══════════════════════════════════════════════════════════════════════════
async function processMessage(
  supabase: ReturnType<typeof createClient>,
  msg: PgmqMessage,
): Promise<{ outcome: "completed" | "failed" | "retried" | "skipped"; detail?: string }> {

  // ── Step A: load metadata row by pgmq_msg_id ──
  const { data: meta, error: metaErr } = await supabase
    .from("async_job_metadata")
    .select("id, pgmq_msg_id, job_type, company_id, status, progress, attempt_count, max_attempts")
    .eq("pgmq_msg_id", msg.msg_id)
    .maybeSingle();

  if (metaErr || !meta) {
    // Orphaned message (no metadata row). Archive and skip.
    console.warn(`[process-bulk-invite] orphan msg_id=${msg.msg_id}, archiving`);
    await archiveMessage(supabase, msg.msg_id);
    return { outcome: "skipped", detail: "orphan-no-metadata" };
  }

  const job = meta as unknown as JobMetadata;

  // ── Step B: terminal-state guard (cancelled/completed/failed) → archive ──
  if (job.status === "cancelled" || job.status === "completed" || job.status === "failed") {
    await archiveMessage(supabase, msg.msg_id);
    return { outcome: "skipped", detail: `already ${job.status}` };
  }

  // ── Step C: mark as running ──
  await supabase.from("async_job_metadata")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      attempt_count: job.attempt_count + 1,
    })
    .eq("id", job.id);

  const items = msg.message.items || [];
  const companyId = msg.message.company_id || job.company_id;

  // ── Step D: chunk + dispatch to invite-employees ──
  // Resume from where we left off (progress.processed) to be re-entrant.
  let processed  = job.progress.processed || 0;
  let succeeded  = job.progress.succeeded || 0;
  let failed     = job.progress.failed    || 0;

  try {
    for (let i = processed; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);

      const inviteRes = await fetch(INVITE_FN_URL, {
        method:  "POST",
        headers: {
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          employees: chunk.map(it => ({
            email:      it.email,
            full_name:  it.full_name,
            company_id: companyId,
          })),
        }),
      });

      if (!inviteRes.ok) {
        const text = await inviteRes.text();
        throw new Error(`invite-employees HTTP ${inviteRes.status}: ${text.substring(0, 200)}`);
      }

      const result = await inviteRes.json();
      const summary = result.summary || { sent: 0, failed: 0 };
      succeeded += summary.sent || 0;
      failed    += summary.failed || 0;
      processed += chunk.length;

      // Persist progress after each chunk (re-entrant resume point)
      await supabase.from("async_job_metadata")
        .update({
          progress: {
            total: items.length,
            processed,
            succeeded,
            failed,
          },
        })
        .eq("id", job.id);
    }

    // ── Step E: success — mark completed + archive pgmq message ──
    await supabase.from("async_job_metadata")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        progress: { total: items.length, processed, succeeded, failed },
      })
      .eq("id", job.id);

    await archiveMessage(supabase, msg.msg_id);
    await writeAudit(supabase, job, "job_completed", { succeeded, failed });

    return { outcome: "completed", detail: `${succeeded} sent, ${failed} failed` };

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[process-bulk-invite] job ${job.id} chunk failed:`, errMsg);

    // Persist partial progress (so retry resumes correctly)
    await supabase.from("async_job_metadata")
      .update({
        progress: { total: items.length, processed, succeeded, failed },
        error_message: errMsg.substring(0, 500),
      })
      .eq("id", job.id);

    // ── Step F: retry vs terminal-failed decision ──
    const willRetry = (job.attempt_count + 1) < job.max_attempts;
    if (willRetry) {
      // Exponential backoff: pick from BACKOFF_SCHEDULE by attempt_count
      const delaySec = BACKOFF_SCHEDULE[Math.min(job.attempt_count, BACKOFF_SCHEDULE.length - 1)];

      // Delete the current message and re-send with delay (pgmq doesn't have
      // native delay-on-fail; we re-enqueue the same payload).
      await archiveMessage(supabase, msg.msg_id);
      const { data: newMsg } = await supabase.schema("pgmq").rpc("send", {
        queue_name: "bulk_invite",
        msg: msg.message,
        delay: delaySec,
      });
      // Update metadata to point at new pgmq_msg_id and reset to pending
      await supabase.from("async_job_metadata")
        .update({
          status: "pending",
          pgmq_msg_id: newMsg as unknown as number,
        })
        .eq("id", job.id);

      await writeAudit(supabase, job, "job_retry_scheduled", { delay_sec: delaySec, attempt: job.attempt_count + 1 });
      return { outcome: "retried", detail: `retry in ${delaySec}s` };
    } else {
      // Terminal failure: archive + mark failed
      await archiveMessage(supabase, msg.msg_id);
      await supabase.from("async_job_metadata")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: errMsg.substring(0, 500),
        })
        .eq("id", job.id);

      await writeAudit(supabase, job, "job_failed", { error: errMsg.substring(0, 200) });
      return { outcome: "failed", detail: errMsg };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════
async function archiveMessage(
  supabase: ReturnType<typeof createClient>,
  msgId: number,
): Promise<void> {
  try {
    await supabase.schema("pgmq").rpc("archive", {
      queue_name: "bulk_invite",
      msg_id:     msgId,
    });
  } catch (err) {
    console.warn(`[process-bulk-invite] archive(${msgId}) failed (non-fatal):`, err);
  }
}

async function writeAudit(
  supabase: ReturnType<typeof createClient>,
  job: JobMetadata,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from("audit_log").insert({
      id:         crypto.randomUUID(),
      action,
      actor:      "system",
      actor_role: "system",
      operation:  "UPDATE",
      target:     job.company_id,
      target_id:  job.id,
      category:   "workflow",
      severity:   action === "job_failed" ? "warning" : "info",
      metadata: {
        ...metadata,
        job_type: job.job_type,
        attempt:  job.attempt_count + 1,
      },
    });
  } catch (err) {
    console.warn("[process-bulk-invite] audit write failed (non-fatal):", err);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
