-- ═══════════════════════════════════════════════════════════════
-- P2 drift fix — user_2fa
-- ─────────────────────────────────────────────────────────────
-- Schema derived from totp-engine.ts:163 (saveTOTPSecret) +
-- totp-engine.ts:185 (is2FAEnabled). Without this table the entire
-- 2FA enrollment + verification flow was SILENTLY FAILING — the
-- upsert returned PostgREST 404 which the wrapper swallowed in a
-- try/catch, so users thought 2FA was on while no secret existed.
--
-- Security notes:
--   • totp_secret is stored as TEXT (Base32 of raw bytes). For a
--     defence-in-depth layer, follow-up migration should encrypt
--     it via pgcrypto with a key from Vault. Tracked as P2-FOLLOWUP.
--   • RLS: a user can read/write ONLY their own row. SECURITY DEFINER
--     RPCs (server-side verification) bypass via the service role.
--   • Hardened from day 1: split policies, auth.uid() cached.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.user_2fa (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  totp_secret  text not null,
  enabled      boolean not null default false,
  enabled_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists user_2fa_touch_updated_at on public.user_2fa;
create trigger user_2fa_touch_updated_at
  before update on public.user_2fa
  for each row execute function public.touch_updated_at();

alter table public.user_2fa enable row level security;

drop policy if exists "user_2fa_select" on public.user_2fa;
create policy "user_2fa_select" on public.user_2fa
  for select using (user_id = (select auth.uid()));

drop policy if exists "user_2fa_insert" on public.user_2fa;
create policy "user_2fa_insert" on public.user_2fa
  for insert with check (user_id = (select auth.uid()));

drop policy if exists "user_2fa_update" on public.user_2fa;
create policy "user_2fa_update" on public.user_2fa
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "user_2fa_delete" on public.user_2fa;
create policy "user_2fa_delete" on public.user_2fa
  for delete using (user_id = (select auth.uid()));
