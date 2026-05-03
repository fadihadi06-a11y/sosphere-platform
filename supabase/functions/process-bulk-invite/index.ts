// SOSphere — Edge Function: process-bulk-invite (E1.4 + E1.5 + E1.6.1 + E1.7)
// World-class async worker. Reads pgmq, drives Supabase Auth admin API
// directly. E1.6.1 inserts invitations rows for accept_invitation().
// E1.7 skips insert if invitation already pending (register_company_full
// path + retry safety).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET               = Deno.env.get("CRON_SECRET") || "";

const VISIBILITY_TIMEOUT_SECS = 300;
const BATCH_QTY               = 10;
const CHUNK_SIZE              = 100;
const MAX_RUNTIME_MS          = 50_000;
const BACKOFF_SCHEDULE        = [60, 300, 1800];

interface JobMetadata {
  id: string;
  pgmq_msg_id: number;
  job_type: string;
  company_id: string;
  created_by: string | null;
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
    items?: Array<{
      email: string;
      full_name?: string;
      phone?: string;
      department?: string;
      job_title?: string;
      employee_id?: string;
      zone?: string;
      shift?: string;
      name_ar?: string;
      emergency_contact?: string;
      company_id?: string;
    }>;
    company_id?: string;
    estimated_count?: number;
    source?: string;
  };
}

Deno.serve(async (req: Request) => {
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
    const { data: msgs, error: readErr } = await supabase.rpc("worker_read_jobs", {
      p_queue_name: "bulk_invite",
      p_qty:        BATCH_QTY,
      p_vt_secs:    VISIBILITY_TIMEOUT_SECS,
    });

    if (readErr) {
      console.error("[process-bulk-invite] pgmq.read failed:", readErr);
      return jsonResponse({ ok: false, error: readErr.message }, 500);
    }

    const messages = (msgs as PgmqMessage[] | null) || [];
    if (messages.length === 0) {
      return jsonResponse({ ok: true, processed: 0, note: "queue empty" });
    }

    console.log(`[process-bulk-invite] read ${messages.length} message(s)`);

    let processedCount = 0;
    let failedCount    = 0;
    const results: Array<{ msg_id: number; outcome: string; detail?: string }> = [];

    for (const msg of messages) {
      if (Date.now() - startedAt > MAX_RUNTIME_MS) {
        console.warn("[process-bulk-invite] runtime budget exhausted");
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

async function processMessage(
  supabase: ReturnType<typeof createClient>,
  msg: PgmqMessage,
): Promise<{ outcome: "completed" | "failed" | "retried" | "skipped"; detail?: string }> {
  const { data: meta, error: metaErr } = await supabase
    .from("async_job_metadata")
    .select("id, pgmq_msg_id, job_type, company_id, created_by, status, progress, attempt_count, max_attempts")
    .eq("pgmq_msg_id", msg.msg_id)
    .maybeSingle();

  if (metaErr || !meta) {
    console.warn(`[process-bulk-invite] orphan msg_id=${msg.msg_id}, archiving`);
    await archiveMessage(supabase, msg.msg_id);
    return { outcome: "skipped", detail: "orphan-no-metadata" };
  }

  const job = meta as unknown as JobMetadata;

  if (job.status === "cancelled" || job.status === "completed" || job.status === "failed") {
    await archiveMessage(supabase, msg.msg_id);
    return { outcome: "skipped", detail: `already ${job.status}` };
  }

  await supabase.from("async_job_metadata")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      attempt_count: job.attempt_count + 1,
    })
    .eq("id", job.id);

  const items     = msg.message.items || [];
  const companyId = msg.message.company_id || job.company_id;
  const createdBy = job.created_by;

  let processed  = job.progress.processed || 0;
  let succeeded  = job.progress.succeeded || 0;
  let failed     = job.progress.failed    || 0;

  try {
    for (let i = processed; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);

      const SITE_URL    = Deno.env.get("SITE_URL") || "https://sosphere-platform.vercel.app";
      const redirectTo  = `${SITE_URL}/welcome`;

      const chunkResults = await Promise.allSettled(
        chunk.map(async (emp) => {
          if (!emp.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emp.email)) {
            return { email: emp.email, success: false, reason: "invalid-email" };
          }

          // ── E1.6.1 (Q1+Q2): persist rich CSV fields via invitations row ──
          // accept_invitation() reads from public.invitations to materialize
          // employees rows on magic-link click.
          //
          // ── E1.7 GUARD: skip insert if a pending invitation already
          //    exists for this (company_id, email). Prevents:
          //      • duplicate rows when register_company_full already
          //        seeded invitations and the wizard then enqueues the
          //        email-dispatch job (the canonical E1.7 flow);
          //      • duplicate rows during re-entrant retries.
          const lowerEmail = emp.email.toLowerCase();
          const { data: existingInv } = await supabase
            .from("invitations")
            .select("id")
            .eq("company_id", companyId)
            .eq("email", lowerEmail)
            .eq("status", "pending")
            .limit(1)
            .maybeSingle();

          if (!existingInv) {
            const { error: invInsertErr } = await supabase
              .from("invitations")
              .insert({
                company_id: companyId,
                email:      lowerEmail,
                name:       emp.full_name || null,
                phone:      emp.phone || null,
                department: emp.department || null,
                role:       emp.job_title || "employee",
                role_type:  "employee",
                invited_by: createdBy,
                status:     "pending",
              });
            if (invInsertErr) {
              return { email: emp.email, success: false, reason: `invitations insert: ${invInsertErr.message}` };
            }
          }

          const { error } = await supabase.auth.admin.inviteUserByEmail(lowerEmail, {
            redirectTo,
            data: {
              full_name:  emp.full_name || "",
              company_id: companyId,
              role:       "employee",
            },
          });
          if (error) {
            if (/already|registered|exists/i.test(error.message || "")) {
              return { email: emp.email, success: true, reason: "already-exists" };
            }
            return { email: emp.email, success: false, reason: error.message };
          }
          return { email: emp.email, success: true };
        })
      );

      let chunkSent = 0, chunkFailed = 0;
      for (const r of chunkResults) {
        if (r.status === "fulfilled") {
          if (r.value.success) chunkSent++;
          else                 chunkFailed++;
        } else {
          chunkFailed++;
        }
      }

      succeeded += chunkSent;
      failed    += chunkFailed;
      processed += chunk.length;

      await supabase.from("async_job_metadata")
        .update({
          progress: { total: items.length, processed, succeeded, failed },
        })
        .eq("id", job.id);
    }

    await supabase.from("async_job_metadata")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        progress: { total: items.length, processed, succeeded, failed },
        error_message: null,
      })
      .eq("id", job.id);

    await archiveMessage(supabase, msg.msg_id);
    await writeAudit(supabase, job, "job_completed", { succeeded, failed });

    return { outcome: "completed", detail: `${succeeded} sent, ${failed} failed` };

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[process-bulk-invite] job ${job.id} chunk failed:`, errMsg);

    await supabase.from("async_job_metadata")
      .update({
        progress: { total: items.length, processed, succeeded, failed },
        error_message: errMsg.substring(0, 500),
      })
      .eq("id", job.id);

    const willRetry = (job.attempt_count + 1) < job.max_attempts;
    if (willRetry) {
      const delaySec = BACKOFF_SCHEDULE[Math.min(job.attempt_count, BACKOFF_SCHEDULE.length - 1)];
      await archiveMessage(supabase, msg.msg_id);
      const { data: newMsg } = await supabase.rpc("worker_requeue_job_with_delay", {
        p_queue_name:  "bulk_invite",
        p_payload:     msg.message,
        p_delay_secs:  delaySec,
      });
      await supabase.from("async_job_metadata")
        .update({
          status: "pending",
          pgmq_msg_id: newMsg as unknown as number,
        })
        .eq("id", job.id);

      await writeAudit(supabase, job, "job_retry_scheduled", { delay_sec: delaySec, attempt: job.attempt_count + 1 });
      return { outcome: "retried", detail: `retry in ${delaySec}s` };
    } else {
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

async function archiveMessage(
  supabase: ReturnType<typeof createClient>,
  msgId: number,
): Promise<void> {
  try {
    await supabase.rpc("worker_archive_job", {
      p_queue_name: "bulk_invite",
      p_msg_id:     msgId,
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
