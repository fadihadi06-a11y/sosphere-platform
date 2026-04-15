-- ═══════════════════════════════════════════════════════════════
-- SOSphere — P3-#11c investigations table (ISO 45001 §10.2)
-- ─────────────────────────────────────────────────────────────
-- Persists incident investigations and their CAPA (Corrective and
-- Preventive Actions) lifecycle. Previously the page merged mock
-- data with a localStorage mirror, so a root cause finding written
-- on one admin's laptop never reached the wider compliance team.
--
-- Data shape note: we use jsonb for the nested structures
-- (root_causes, actions, timeline, affected_workers) to keep the
-- migration focused and match the client's Investigation type
-- 1:1. A future migration can split these into normalized tables
-- if reporting needs demand it — the jsonb columns keep all
-- information queryable today via `->>` / `@>` operators.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.investigations (
  id                 text primary key,
  company_id         uuid not null references public.companies(id) on delete cascade,

  -- Link back to the triggering incident (sos_queue row) if one exists.
  -- Not a FK because investigations can also be created manually without
  -- a matching incident record.
  incident_id        text,

  title              text not null,
  description        text,
  severity           text not null,                -- critical | high | medium | low
  zone               text,
  incident_date      timestamptz not null,
  reported_by        text,
  investigator       text,
  status             text not null default 'open', -- open | investigating | pending_capa | capa_in_progress | closed | overdue

  root_causes        jsonb not null default '[]'::jsonb,
  actions            jsonb not null default '[]'::jsonb,
  timeline           jsonb not null default '[]'::jsonb,
  affected_workers   jsonb not null default '[]'::jsonb,

  iso_reference      text,
  final_report_date  timestamptz,
  source             text,                         -- "Emergency Response" | "Reports" | "Manual" | etc.

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists investigations_company_idx
  on public.investigations(company_id);

create index if not exists investigations_company_status_idx
  on public.investigations(company_id, status);

-- "Show me all investigations for this specific incident" — used when
-- an admin clicks through from an emergency to see its investigation.
create index if not exists investigations_incident_idx
  on public.investigations(incident_id) where incident_id is not null;

-- ── Row Level Security ───────────────────────────────────────
alter table public.investigations enable row level security;

drop policy if exists "investigations_select" on public.investigations;
create policy "investigations_select" on public.investigations
  for select using (
    company_id in (select company_id from public.employees where user_id = auth.uid())
    or company_id in (select id from public.companies where owner_id = auth.uid())
  );

drop policy if exists "investigations_write" on public.investigations;
create policy "investigations_write" on public.investigations
  for all using (
    company_id in (select company_id from public.employees where user_id = auth.uid())
    or company_id in (select id from public.companies where owner_id = auth.uid())
  ) with check (
    company_id in (select company_id from public.employees where user_id = auth.uid())
    or company_id in (select id from public.companies where owner_id = auth.uid())
  );

-- Reuse the touch_updated_at function created in the risk_register
-- migration. `create or replace` in that migration makes this safe on
-- re-run in any order.
drop trigger if exists investigations_touch_updated_at on public.investigations;
create trigger investigations_touch_updated_at
  before update on public.investigations
  for each row execute function public.touch_updated_at();
