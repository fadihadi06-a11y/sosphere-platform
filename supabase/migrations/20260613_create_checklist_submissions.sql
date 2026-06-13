-- ═══════════════════════════════════════════════════════════════
-- checklist_submissions — durable pre-shift safety checklist records
-- ─────────────────────────────────────────────────────────────
-- A worker completes their pre-shift safety checklist in the mobile app; the
-- submission persists here as a real compliance record (legal/audit proof that
-- the worker confirmed PPE, equipment, evacuation route, etc. before the shift).
-- Previously the dashboard showed only DEMO submissions (gated to empty in
-- prod) because there was no backend. This makes pre-shift compliance REAL.
--
-- RLS mirrors the `evidence` table (the existing worker-submitted safety data
-- path): company members (workers + admins) can read/write within their own
-- company; the company owner has full access. Cross-tenant access is denied.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.checklist_submissions (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  -- worker identity as text to match the mobile employeeId (auth uid OR an
  -- "EMP-<name>" fallback), exactly like evidence.submitted_by.
  employee_id    text,
  employee_name  text not null default 'Worker',
  template_id    text not null,
  template_name  text,
  completed_items text[] not null default '{}',
  flagged_items   text[] not null default '{}',
  total_items    integer not null default 0,
  is_complete    boolean not null default false,
  zone           text,
  submitted_at   timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

alter table public.checklist_submissions enable row level security;

-- Company members (workers + admins) read submissions in their company.
create policy checklist_company_read on public.checklist_submissions
  for select
  using ((company_id is null) or is_company_member(company_id));

-- Company members write (workers insert their own pre-shift submission).
create policy checklist_company_write on public.checklist_submissions
  for all
  using ((company_id is null) or is_company_member(company_id))
  with check ((company_id is null) or is_company_member(company_id));

-- Owner has full access (mirrors evidence_all).
create policy checklist_owner_all on public.checklist_submissions
  for all
  using (company_id in (select id from companies where owner_id = (select auth.uid())));

create index if not exists idx_checklist_sub_company_time
  on public.checklist_submissions (company_id, submitted_at desc);
