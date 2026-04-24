-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: twilio_spend_protection_2026_04_24
-- Version:   20260424195653
-- Applied:   2026-04-24 via Supabase MCP
-- Source of truth: this file matches what was applied to prod
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- Twilio Cost Protection — Fix #6
-- ─────────────────────────────────────────────────────────────────────────
-- Three defensive layers:
--   1. check_sos_rate_limit RPC — reads audit_log to count recent SOS triggers
--   2. twilio_spend_ledger table — records every SMS/call cost
--   3. check_company_twilio_budget RPC — reads ledger, returns remaining $
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Rate-limit check (counts sos_triggered audit entries by this user) ──
create or replace function public.check_sos_rate_limit(
  p_user_id uuid,
  p_hours int default 1,
  p_days int default 1
) returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'last_hour', (
      select count(*) from public.audit_log
      where action = 'sos_triggered'
        and actor_id = p_user_id::text
        and created_at > now() - (p_hours || ' hours')::interval
    ),
    'last_day', (
      select count(*) from public.audit_log
      where action = 'sos_triggered'
        and actor_id = p_user_id::text
        and created_at > now() - (p_days || ' days')::interval
    )
  );
$$;
grant execute on function public.check_sos_rate_limit(uuid, int, int) to service_role;
comment on function public.check_sos_rate_limit is
  '2026-04-24 Fix #6: returns recent SOS trigger counts for rate-limiting in sos-alert.';

-- ── Twilio spend ledger table ──────────────────────────────────────────
create table if not exists public.twilio_spend_ledger (
  id              bigserial primary key,
  company_id      uuid    references public.companies(id) on delete cascade,
  user_id         uuid,                    -- who triggered (civilian or employee)
  emergency_id    text,                    -- links back to sos_queue/sos_sessions
  channel         text    not null check (channel in ('sms', 'call')),
  twilio_sid      text,                    -- Twilio's own message/call sid (idempotency)
  cost_estimate   numeric(10, 4) not null default 0,  -- USD
  duration_sec    int,                     -- for calls
  created_at      timestamptz not null default now()
);

create index if not exists twilio_spend_company_day_idx
  on public.twilio_spend_ledger (company_id, created_at desc);
create index if not exists twilio_spend_user_day_idx
  on public.twilio_spend_ledger (user_id, created_at desc);
create index if not exists twilio_spend_sid_idx
  on public.twilio_spend_ledger (twilio_sid);

-- RLS: owners can read their company's ledger; others see nothing.
-- Writes only via service_role (edge functions).
alter table public.twilio_spend_ledger enable row level security;

create policy twilio_ledger_owner_read on public.twilio_spend_ledger
  for select to authenticated
  using (
    company_id is not null
    and public.is_company_owner(company_id)
  );

comment on table public.twilio_spend_ledger is
  '2026-04-24 Fix #6: append-only log of every Twilio SMS/call cost. Read by check_company_twilio_budget to enforce daily caps.';

-- ── Company budget table ──────────────────────────────────────────────
create table if not exists public.company_twilio_budgets (
  company_id        uuid primary key references public.companies(id) on delete cascade,
  daily_cap_usd     numeric(10, 2) not null default 30.00,  -- default $30/day
  monthly_cap_usd   numeric(10, 2) not null default 500.00,
  alert_at_percent  int not null default 80,                -- email at 80% of daily
  notes             text,
  updated_at        timestamptz not null default now()
);

alter table public.company_twilio_budgets enable row level security;

create policy budgets_member_read on public.company_twilio_budgets
  for select to authenticated
  using (public.is_company_member(company_id));

create policy budgets_owner_write on public.company_twilio_budgets
  for all to authenticated
  using      (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));

-- ── Budget-remaining check ────────────────────────────────────────────
create or replace function public.check_company_twilio_budget(p_company_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  with budgets as (
    select coalesce(b.daily_cap_usd, 30.00) as daily_cap,
           coalesce(b.monthly_cap_usd, 500.00) as monthly_cap
    from public.companies c
    left join public.company_twilio_budgets b on b.company_id = c.id
    where c.id = p_company_id
  ),
  spent as (
    select
      coalesce(sum(cost_estimate) filter (where created_at > now() - interval '1 day'),   0) as day_spend,
      coalesce(sum(cost_estimate) filter (where created_at > now() - interval '30 days'), 0) as month_spend
    from public.twilio_spend_ledger
    where company_id = p_company_id
  )
  select jsonb_build_object(
    'daily_cap',       (select daily_cap from budgets),
    'daily_spent',     (select day_spend from spent),
    'daily_remaining', greatest(0, (select daily_cap from budgets) - (select day_spend from spent)),
    'monthly_cap',     (select monthly_cap from budgets),
    'monthly_spent',   (select month_spend from spent),
    'monthly_remaining', greatest(0, (select monthly_cap from budgets) - (select month_spend from spent)),
    'daily_exceeded',  ((select day_spend from spent)   >= (select daily_cap from budgets)),
    'monthly_exceeded',((select month_spend from spent) >= (select monthly_cap from budgets))
  );
$$;
grant execute on function public.check_company_twilio_budget(uuid) to service_role, authenticated;
comment on function public.check_company_twilio_budget is
  '2026-04-24 Fix #6: returns {daily_cap, daily_spent, daily_remaining, ...} for company. Called by sos-alert before fanout.';

-- ── Ledger insert helper (service_role writes) ────────────────────────
create or replace function public.record_twilio_spend(
  p_company_id    uuid,
  p_user_id       uuid,
  p_emergency_id  text,
  p_channel       text,
  p_twilio_sid    text,
  p_cost_estimate numeric,
  p_duration_sec  int default null
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.twilio_spend_ledger
    (company_id, user_id, emergency_id, channel, twilio_sid, cost_estimate, duration_sec)
  values
    (p_company_id, p_user_id, p_emergency_id, p_channel, p_twilio_sid, p_cost_estimate, p_duration_sec);
$$;
grant execute on function public.record_twilio_spend(uuid, uuid, text, text, text, numeric, int) to service_role;
comment on function public.record_twilio_spend is
  '2026-04-24 Fix #6: appends a single Twilio cost row to twilio_spend_ledger.';
