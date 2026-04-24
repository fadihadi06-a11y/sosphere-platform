-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: sos_queue_dispatcher_review_columns_2026_04_24
-- Version:   20260424120351
-- Applied:   2026-04-24 via Supabase MCP
-- Source of truth: this file matches what was applied to prod
-- ═══════════════════════════════════════════════════════════════════════════


-- Extend sos_queue with dedicated columns for the dispatcher review actions
-- (broadcast / forward / mark_reviewed). These columns are the tamper-evident
-- record of who-did-what-when from the web dashboard. The audit_log row
-- written alongside carries the same facts as a second-source record —
-- a legal investigator comparing the two proves neither was forged.
alter table public.sos_queue
  add column if not exists reviewed_by       uuid,
  add column if not exists reviewed_at       timestamptz,
  add column if not exists review_note       text,
  add column if not exists broadcast_by      uuid,
  add column if not exists broadcast_at      timestamptz,
  add column if not exists broadcast_scope   text,   -- 'zone' | 'dept' | 'all'
  add column if not exists broadcast_message text,
  add column if not exists broadcast_recipients int,
  add column if not exists forwarded_by      uuid,
  add column if not exists forwarded_at      timestamptz,
  add column if not exists forwarded_to      text;   -- 'owner' | uuid | email

-- Reader indexes: dashboard reads by status + reviewer
create index if not exists sos_queue_reviewed_by_idx
  on public.sos_queue(reviewed_by, reviewed_at desc);
create index if not exists sos_queue_broadcast_at_idx
  on public.sos_queue(broadcast_at desc);
create index if not exists sos_queue_status_company_idx
  on public.sos_queue(company_id, status);

comment on column public.sos_queue.review_note is
  '2026-04-24: tamper-evident note on who reviewed this incident from the dispatcher dashboard. Paired with an audit_log row.';
