-- ═══════════════════════════════════════════════════════════════
-- SOSphere — P3-#11e RRP Sessions (Rapid Response Protocol)
-- ─────────────────────────────────────────────────────────────
-- Tracks every admin-initiated Rapid Response Protocol session:
-- how long it took to triage + act on an incident, how many of the
-- pre-authored response steps they completed, whether the system
-- auto-escalated, and whether the admin chose to open the fuller
-- Incident Response Engine (IRE).
--
-- The client (rrp-analytics-store.ts) was already attempting to
-- `.insert()` into this table on every session, but the table
-- didn't exist — so every production session was silently dropped
-- and only the device's localStorage ever retained history. That
-- meant the Response Analytics dashboard was device-local: open
-- it on a new laptop and you'd see zero sessions even if the team
-- had run dozens. This migration makes the insert path actually
-- durable.
--
-- Shape note: per_action_times is a jsonb array of ints (seconds)
-- rather than a normalized child table — the array is always read
-- as a unit when computing avg-per-action, and keeping it jsonb
-- matches the client's in-memory shape 1:1.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.rrp_sessions (
  id                 text primary key,
  company_id         uuid not null references public.companies(id) on delete cascade,

  -- Link back to the triggering SOS row if one exists. Not a FK
  -- because an admin can run a drill session without a real incident.
  emergency_id       text,

  employee_name      text,
  zone               text,
  sos_type           text,                           -- sos_button | fall_detected | shake_sos | missed_checkin | journey_sos | medical | evacuation | h2s_gas
  severity           text,                           -- critical | high | medium | low
  threat_level       text,                           -- CRITICAL | HIGH | ELEVATED

  total_time_sec     integer not null default 0,
  actions_total      integer not null default 0,
  actions_completed  integer not null default 0,
  per_action_times   jsonb   not null default '[]'::jsonb,   -- number[] (seconds per action)

  auto_escalated     boolean not null default false,
  opened_ire         boolean not null default false,

  created_at         timestamptz not null default now()
);

-- Analytics usually asks "give me this company's last N sessions" and
-- "group this company's sessions by sos_type / severity over time".
-- The (company_id, created_at desc) index covers both.
create index if not exists rrp_sessions_company_idx
  on public.rrp_sessions(company_id, created_at desc);

-- Incident-detail pages want all sessions attached to a specific
-- emergency: partial index keeps it small (most rows have no
-- emergency_id because they came from drills).
create index if not exists rrp_sessions_emergency_idx
  on public.rrp_sessions(emergency_id) where emergency_id is not null;

-- ── Row Level Security ───────────────────────────────────────
alter table public.rrp_sessions enable row level security;

drop policy if exists "rrp_sessions_select" on public.rrp_sessions;
create policy "rrp_sessions_select" on public.rrp_sessions
  for select using (
    company_id in (select company_id from public.employees where user_id = auth.uid())
    or company_id in (select id from public.companies where owner_id = auth.uid())
  );

drop policy if exists "rrp_sessions_write" on public.rrp_sessions;
create policy "rrp_sessions_write" on public.rrp_sessions
  for all using (
    company_id in (select company_id from public.employees where user_id = auth.uid())
    or company_id in (select id from public.companies where owner_id = auth.uid())
  ) with check (
    company_id in (select company_id from public.employees where user_id = auth.uid())
    or company_id in (select id from public.companies where owner_id = auth.uid())
  );

-- No updated_at column: sessions are immutable once recorded (like
-- audit_log). If an admin re-runs the same emergency, that's a new
-- session with a new id.
