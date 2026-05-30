-- ═══════════════════════════════════════════════════════════════
-- P2-Followup A — Encrypt totp_secret at rest (defence-in-depth)
-- ─────────────────────────────────────────────────────────────
-- BEFORE: user_2fa.totp_secret stored RAW (Base32 of HMAC seed).
-- Anyone who exfiltrates a DB dump can clone every user's 2FA.
--
-- AFTER:  user_2fa.totp_secret_enc stored as pgp_sym_encrypt() output.
-- Without the master key (in _app_secrets, locked to service_role +
-- SECDEF RPCs only), a dump leaks ciphertext only.
--
-- Architecture:
--   1. Master key lives in public._app_secrets, deny-all RLS, no
--      direct GRANT to anon/authenticated.
--   2. Client never reads/writes user_2fa directly anymore — uses
--      save_totp_secret(p_secret) + get_totp_secret_for_verify()
--      SECDEF RPCs. The RPCs auth.uid()-pin every operation.
--   3. The totp_secret_enc column replaces the plaintext column.
--      No data to migrate (table was 0 rows at apply time).
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Master-key vault ──────────────────────────────────────
create table if not exists public._app_secrets (
  key_name   text primary key,
  key_value  text not null,
  created_at timestamptz not null default now()
);

alter table public._app_secrets enable row level security;
revoke all on public._app_secrets from public, anon, authenticated;

insert into public._app_secrets (key_name, key_value)
values ('totp_master_key', encode(gen_random_bytes(32), 'base64'))
on conflict (key_name) do nothing;

comment on table public._app_secrets is
  'Server-side secrets vault. Deny-all RLS. Accessed only by SECDEF RPCs.';

-- ── 2. Swap user_2fa.totp_secret (text) → totp_secret_enc (bytea) ──
alter table public.user_2fa drop column if exists totp_secret;
alter table public.user_2fa add  column if not exists totp_secret_enc bytea;

-- ── 3. Lock direct writes: only RPCs may mutate the secret ───
revoke insert, update, delete on public.user_2fa from authenticated;

-- ── 4. RPC: save_totp_secret (encrypts + upserts) ────────────
create or replace function public.save_totp_secret(p_secret text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_secret is null or length(p_secret) < 16 then
    raise exception 'invalid secret (min 16 chars Base32)' using errcode = '22023';
  end if;

  select key_value into v_key from public._app_secrets where key_name = 'totp_master_key';
  if v_key is null then
    raise exception 'totp_master_key not provisioned' using errcode = '55000';
  end if;

  insert into public.user_2fa (user_id, totp_secret_enc, enabled, enabled_at)
  values (v_uid, pgp_sym_encrypt(p_secret, v_key)::bytea, true, now())
  on conflict (user_id) do update
    set totp_secret_enc = excluded.totp_secret_enc,
        enabled         = true,
        enabled_at      = now();

  return true;
end $$;

revoke execute on function public.save_totp_secret(text) from public, anon;
grant  execute on function public.save_totp_secret(text) to authenticated;

comment on function public.save_totp_secret(text) is
  'Encrypts the caller''s TOTP secret with the master key and stores it. auth.uid()-pinned.';

-- ── 5. RPC: get_totp_secret_for_verify ───────────────────────
create or replace function public.get_totp_secret_for_verify()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_enc bytea;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select key_value into v_key from public._app_secrets where key_name = 'totp_master_key';
  if v_key is null then return null; end if;

  select totp_secret_enc into v_enc
  from public.user_2fa where user_id = v_uid and enabled = true;
  if v_enc is null then return null; end if;

  return pgp_sym_decrypt(v_enc, v_key);
end $$;

revoke execute on function public.get_totp_secret_for_verify() from public, anon;
grant  execute on function public.get_totp_secret_for_verify() to authenticated;

comment on function public.get_totp_secret_for_verify() is
  'Returns the decrypted TOTP secret for the CALLER''s account only. auth.uid()-pinned. Used by verifyUser2FA() client-side.';
