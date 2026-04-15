-- ═══════════════════════════════════════════════════════════════
-- SOSphere — P3-#11 audit_log table
-- ─────────────────────────────────────────────────────────────
-- Append-only event log for every security-relevant action:
-- permission changes, role changes, logins, 2FA events,
-- emergency lifecycle, CSV imports, etc.
--
-- Read by:   dashboard-audit-log-page.tsx, compliance-reports.tsx,
--            data-layer.ts#fetchAuditLog()
-- Written by: audit-log-store.ts (client-side) and any edge
--            function that performs a privileged action.
--
-- Compliance mapping:
--   ISO 27001 §A.12.4  — Logging and monitoring
--   SOC 2   CC7.2      — System monitoring
--   GDPR    Art. 30    — Records of processing activities
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.audit_log (
  id                text primary key,
  company_id        uuid references public.companies(id) on delete cascade,

  -- Who did it
  actor_id          text,
  actor_name        text,
  actor_role        text,          -- owner | main_admin | zone_admin | worker | system

  -- What happened
  category          text not null,  -- permission_change | role_change | login | emergency | ...
  action            text not null,
  detail            text,

  -- Target of the action (optional — e.g. the user whose role was changed)
  target_id         text,
  target_name       text,
  target_role       text,

  -- Before/after snapshots for permission & setting changes
  before_value      text,
  after_value       text,

  -- Context
  zone              text,
  ip_address        inet,
  device_info       text,
  severity          text not null default 'info',  -- info | success | warning | critical
  verified_2fa      boolean not null default false,

  -- Timestamps. `created_at` is the authoritative server-side time;
  -- `client_timestamp` is what the browser reported (kept for drift
  -- debugging and offline replay).
  client_timestamp  timestamptz,
  created_at        timestamptz not null default now()
);

-- Index for the most common query: "give me the last N audit events
-- for this company in reverse-chronological order".
create index if not exists audit_log_company_time_idx
  on public.audit_log(company_id, created_at desc);

-- Category filter + company scope. Supports the page's filter chips.
create index if not exists audit_log_company_category_idx
  on public.audit_log(company_id, category);

-- Lookup by actor (for "show me everything Ahmed did") and by target.
create index if not exists audit_log_actor_idx on public.audit_log(actor_id);
create index if not exists audit_log_target_idx on public.audit_log(target_id);

-- ── Row Level Security ───────────────────────────────────────
-- Read:   anyone whose auth.uid() belongs to the same company can
--         read that company's audit log. We resolve company_id via
--         the employees table — if that row doesn't exist the user
--         sees nothing.
-- Write:  clients may insert events that belong to their own
--         company. They cannot update or delete — this is an
--         append-only log (integrity requirement for ISO 27001).
--         Edge functions running under the service role bypass RLS
--         and can insert system-generated events.
-- ─────────────────────────────────────────────────────────────
alter table public.audit_log enable row level security;

drop policy if exists "Users read company audit_log" on public.audit_log;
create policy "Users read company audit_log"
  on public.audit_log for select
  using (
    company_id in (
      select company_id from public.employees where user_id = auth.uid()
    )
    or
    company_id in (
      select id from public.companies where owner_id = auth.uid()
    )
  );

drop policy if exists "Users insert own company audit_log" on public.audit_log;
create policy "Users insert own company audit_log"
  on public.audit_log for insert
  with check (
    company_id in (
      select company_id from public.employees where user_id = auth.uid()
    )
    or
    company_id in (
      select id from public.companies where owner_id = auth.uid()
    )
  );

-- No UPDATE or DELETE policies. The log is append-only.
-- Service-role writes (from edge functions) bypass RLS entirely.
