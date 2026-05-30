-- ═══════════════════════════════════════════════════════════════
-- P2 drift fix — user_pins
-- ─────────────────────────────────────────────────────────────
-- Schema derived from pin-verify-modal.tsx:70 (verifyPIN). Without
-- this table the PIN verification fell back to the DEV-ONLY DEMO_PIN
-- in development and outright DENIED ACCESS in production — meaning
-- no end user could ever PIN-authorize a sensitive action.
--
-- Security notes:
--   • pin_hash is the result of hashPIN() (caller-side hash; see
--     pin-verify-modal.tsx). Never stores the raw PIN.
--   • Same per-user RLS as user_2fa: user can only see/write own row.
--   • Hardened from day 1.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.user_pins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  pin_hash   text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists user_pins_touch_updated_at on public.user_pins;
create trigger user_pins_touch_updated_at
  before update on public.user_pins
  for each row execute function public.touch_updated_at();

alter table public.user_pins enable row level security;

drop policy if exists "user_pins_select" on public.user_pins;
create policy "user_pins_select" on public.user_pins
  for select using (user_id = (select auth.uid()));

drop policy if exists "user_pins_insert" on public.user_pins;
create policy "user_pins_insert" on public.user_pins
  for insert with check (user_id = (select auth.uid()));

drop policy if exists "user_pins_update" on public.user_pins;
create policy "user_pins_update" on public.user_pins
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "user_pins_delete" on public.user_pins;
create policy "user_pins_delete" on public.user_pins
  for delete using (user_id = (select auth.uid()));
