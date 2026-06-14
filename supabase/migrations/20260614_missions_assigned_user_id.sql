-- ═══════════════════════════════════════════════════════════════
-- 2026-06-14 — missions.assigned_user_id (link missions to real workers)
-- ─────────────────────────────────────────────────────────────
-- The legacy missions.employee_id is bigint and never matched the uuid
-- employees, so a created mission could not be shown to its assigned worker
-- (and the dashboard create path wrote only to localStorage). assigned_user_id
-- holds the worker's real auth user_id so the mobile worker app can load its
-- own missions, with an additive worker-read RLS policy.
-- ═══════════════════════════════════════════════════════════════
alter table public.missions add column if not exists assigned_user_id uuid;
create index if not exists idx_missions_assigned_user on public.missions(assigned_user_id);

drop policy if exists missions_assigned_worker_read on public.missions;
create policy missions_assigned_worker_read on public.missions
  for select to authenticated
  using (assigned_user_id = (select auth.uid()));
