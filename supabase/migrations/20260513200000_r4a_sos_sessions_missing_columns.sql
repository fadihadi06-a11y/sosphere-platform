-- ═══════════════════════════════════════════════════════════════════════════
-- SOSphere — R-4a: sos_sessions schema reconcile (silent-fail UPDATE fix)
-- ─────────────────────────────────────────────────────────────────────────
-- THE BUG R-4 EXPOSED
--   The R-4 end-to-end SOS verify probe (sos-dispatch-probe) discovered that
--   public.sos_sessions is MISSING six columns that supabase/functions/sos-alert
--   writes to on every trigger + end:
--
--     server_results       (jsonb)        — written at trigger fanout completion
--     ended_at             (timestamptz)  — written in end action
--     end_reason           (text)         — written in end action
--     recording_seconds    (integer)      — written in end action
--     photo_count          (integer)      — written in end action
--     comment              (text)         — written in end action
--
--   Postgres rejects the WHOLE UPDATE statement when ANY column setter targets
--   a non-existent column. Supabase-js doesn't throw — it returns {data:null,
--   error:{...}} — and sos-alert's code path doesn't check `error` after
--   the UPDATE, so the failure is INVISIBLE in edge logs.
--
--   Practical impact in prod (HIGH severity):
--     • "End SOS" button (sos-alert?action=end) appears to succeed (200 OK)
--       but the sos_sessions row stays at status='active' forever.
--     • dispatcher dashboard cannot mark sessions resolved through this path.
--     • forensic timeline shows "started_at" but never "ended_at".
--     • server_results array (per-contact dispatch outcomes) is never
--       persisted, so dashboards lose the per-leg method/sid metadata.
--
--   R-4's value: the probe couldn't have surfaced this without exercising
--   the end action against real schema. Static tests in r3/r5 contract
--   layers couldn't catch it. This is exactly the gap R-4 was designed to
--   close.
--
-- THE FIX
--   Purely additive — add the six columns sos-alert already writes. No
--   data backfill needed (every existing row gets NULL for these, which
--   matches the pre-fix state where the writes were dropped). Cheap,
--   safe, reversible.
--
-- ALTERNATIVE CONSIDERED
--   Rewriting sos-alert to use existing columns (e.g. resolved_at instead
--   of ended_at). Rejected because:
--     1. resolved_at lives on sos_queue (dispatcher-resolve flow), not
--        sos_sessions (user-end flow) — they're semantically distinct.
--     2. Other readers (compliance reports, audit trails, debrief screens)
--        already query for ended_at / end_reason in code; renaming creates
--        a different drift problem.
--     3. Additive migrations are zero-risk; renames are not.
--
-- RELATED FILES
--   supabase/functions/sos-alert/index.ts  (the writer)
--   src/app/components/__tests__/r4-sos-dispatch-probe-invariants.test.ts
--
-- VERIFICATION
--   After this migration, the R-4 probe (sos-dispatch-probe) should pass
--   all 20 assertions including the four end-state ones:
--     session_status_ended, session_ended_at_set,
--     session_end_reason_recorded, session_server_results_recorded.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.sos_sessions
  add column if not exists server_results    jsonb,
  add column if not exists ended_at          timestamptz,
  add column if not exists end_reason        text,
  add column if not exists recording_seconds integer,
  add column if not exists photo_count       integer,
  add column if not exists comment           text;

-- Index for dispatcher-dashboard "show me sessions ended today" queries.
-- Partial index on NOT NULL keeps it tight even after the table grows.
create index if not exists sos_sessions_ended_at_idx
  on public.sos_sessions (ended_at desc)
  where ended_at is not null;

comment on column public.sos_sessions.server_results is
  'R-4a (2026-05-14): per-contact dispatch outcomes captured at sos-alert fanout completion. Array of {contactName, phone, callSid, smsSid, method, error?} — one element per dispatched contact. Read by post-emergency debrief + compliance reports.';

comment on column public.sos_sessions.ended_at is
  'R-4a (2026-05-14): server time when sos-alert?action=end successfully ended the session. Distinct from sos_queue.resolved_at (dispatcher-resolve flow). NULL while active.';

comment on column public.sos_sessions.end_reason is
  'R-4a (2026-05-14): free-text reason captured from the End SOS button or watchdog auto-resolve. Domain: user_ended | cancelled | false_alarm | partial | no_ack | timeout | other. NULL while active.';

comment on column public.sos_sessions.recording_seconds is
  'R-4a (2026-05-14): total seconds of voice recording captured during the SOS session. NULL if recording was disabled (silent mode / Free tier / packet.recording=false).';

comment on column public.sos_sessions.photo_count is
  'R-4a (2026-05-14): number of forensic photos uploaded during + immediately after the SOS. Read by post-emergency debrief screen.';

comment on column public.sos_sessions.comment is
  'R-4a (2026-05-14): optional free-text comment from the user at End SOS (e.g. "false alarm, accidental press"). Read by dispatcher dashboard + compliance reports.';
