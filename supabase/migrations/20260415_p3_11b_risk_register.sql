-- ═══════════════════════════════════════════════════════════════
-- SOSphere — P3-#11b risk_register + training_records
-- ─────────────────────────────────────────────────────────────
-- Persistent, company-scoped store for the Risk Register page
-- (ISO 45001 §6.1 — Risk Assessment) and the training matrix.
--
-- Previously both lists were seeded from MOCK_RISKS / MOCK_TRAINING
-- and mirrored to localStorage — so risk reassessments made on one
-- device never reached the compliance officer's dashboard. This
-- migration moves them to Supabase with full RLS.
-- ═══════════════════════════════════════════════════════════════

-- ── Risk Register ────────────────────────────────────────────
create table if not exists public.risk_register (
  id                  text primary key,
  company_id          uuid not null references public.companies(id) on delete cascade,

  zone                text not null,
  hazard              text not null,
  description         text,
  category            text not null,           -- physical | chemical | biological | ergonomic | psychosocial | environmental

  -- 5×5 risk matrix inputs and computed outputs. We persist the
  -- computed score/level so reports read a single row without doing
  -- client-side math, and so an auditor can see the exact value the
  -- assessor recorded (not a recomputed one).
  likelihood          smallint not null check (likelihood between 1 and 5),
  consequence         smallint not null check (consequence between 1 and 5),
  risk_score          smallint not null,
  risk_level          text not null,            -- extreme | high | medium | low | negligible

  existing_controls   jsonb not null default '[]'::jsonb,
  control_status      text not null,            -- effective | partially_effective | ineffective | not_implemented
  preventive_measures jsonb not null default '[]'::jsonb,

  responsible_person  text,
  last_reviewed_by    text,
  review_date         timestamptz,
  iso_reference       text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists risk_register_company_idx
  on public.risk_register(company_id);

create index if not exists risk_register_company_level_idx
  on public.risk_register(company_id, risk_level);

create index if not exists risk_register_company_zone_idx
  on public.risk_register(company_id, zone);

-- ── Training Records ─────────────────────────────────────────
-- We do NOT store `status` here — it is a function of (expiry_date, now())
-- and so is computed client-side. Storing it would let the DB go stale
-- as dates tick over without a write. The expiry date is the source of
-- truth.
create table if not exists public.training_records (
  id                  text primary key,
  company_id          uuid not null references public.companies(id) on delete cascade,

  employee_id         text,                     -- optional back-ref to employees.id
  employee_name       text not null,
  certification       text not null,
  provider            text,
  zone                text,

  issue_date          timestamptz not null,
  expiry_date         timestamptz not null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists training_records_company_idx
  on public.training_records(company_id);

-- Fast "what expires in the next N days" query used by the dashboard.
create index if not exists training_records_company_expiry_idx
  on public.training_records(company_id, expiry_date);

-- ── Row Level Security ───────────────────────────────────────
-- Read + write restricted to the user's own company. Training records
-- are modified by admins (CSV upload, expiry updates) so we allow
-- insert/update/delete from authenticated company members. Risk
-- register rows are likewise edited in-place when controls or scores
-- change during review — no need for an append-only history here
-- because the page itself keeps a last_reviewed_by + review_date
-- audit trail on each row.
-- ─────────────────────────────────────────────────────────────
alter table public.risk_register enable row level security;
alter table public.training_records enable row level security;

-- Policy helper expression reused in all four policies: "user belongs
-- to this company". Inlined (rather than a SECURITY DEFINER function)
-- to keep the migration self-contained.
do $$ begin
  -- risk_register
  drop policy if exists "risk_register_select" on public.risk_register;
  create policy "risk_register_select" on public.risk_register
    for select using (
      company_id in (select company_id from public.employees where user_id = auth.uid())
      or company_id in (select id from public.companies where owner_id = auth.uid())
    );
  drop policy if exists "risk_register_write" on public.risk_register;
  create policy "risk_register_write" on public.risk_register
    for all using (
      company_id in (select company_id from public.employees where user_id = auth.uid())
      or company_id in (select id from public.companies where owner_id = auth.uid())
    ) with check (
      company_id in (select company_id from public.employees where user_id = auth.uid())
      or company_id in (select id from public.companies where owner_id = auth.uid())
    );

  -- training_records
  drop policy if exists "training_records_select" on public.training_records;
  create policy "training_records_select" on public.training_records
    for select using (
      company_id in (select company_id from public.employees where user_id = auth.uid())
      or company_id in (select id from public.companies where owner_id = auth.uid())
    );
  drop policy if exists "training_records_write" on public.training_records;
  create policy "training_records_write" on public.training_records
    for all using (
      company_id in (select company_id from public.employees where user_id = auth.uid())
      or company_id in (select id from public.companies where owner_id = auth.uid())
    ) with check (
      company_id in (select company_id from public.employees where user_id = auth.uid())
      or company_id in (select id from public.companies where owner_id = auth.uid())
    );
end $$;

-- ── Keep updated_at current on UPDATE ─────────────────────────
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists risk_register_touch_updated_at on public.risk_register;
create trigger risk_register_touch_updated_at
  before update on public.risk_register
  for each row execute function public.touch_updated_at();

drop trigger if exists training_records_touch_updated_at on public.training_records;
create trigger training_records_touch_updated_at
  before update on public.training_records
  for each row execute function public.touch_updated_at();
