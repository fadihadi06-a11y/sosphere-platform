-- ═══════════════════════════════════════════════════════════════
-- P2-Followup C — Server-side TOTP verification (gold standard)
-- ─────────────────────────────────────────────────────────────
-- BEFORE: client called get_totp_secret_for_verify() to fetch the
-- decrypted secret over TLS, then ran HMAC-SHA1 locally in JS.
-- A compromised browser tab / XSS / malicious extension could
-- intercept the secret between fetch and verify.
--
-- AFTER:  client calls verify_user_2fa(p_code) — sends ONLY the
-- 6-digit code. The DB:
--   1. Decrypts the secret in-memory (never crosses process boundary)
--   2. Computes HMAC-SHA1 internally via pgcrypto
--   3. Applies RFC 6238 dynamic truncation + 10^6 mod
--   4. Compares with the supplied code (current + previous window
--      for 30s clock-skew tolerance)
--   5. Returns boolean
--
-- The TOTP secret NEVER leaves the database after enrollment.
--
-- Algorithm verified against RFC 6238 Appendix B official test
-- vectors (seed "12345678901234567890", T=59 → 287082,
-- T=1111111109 → 081804). Both passed exactly.
--
-- Storage change: secret is now stored as RAW BYTES
-- (pgp_sym_encrypt_bytea) not base32 text. This avoids per-verify
-- base32 decode and keeps the decrypted material binary all the
-- way through. user_2fa was empty at apply time (0 rows) so no
-- data migration was needed.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Base32 decode helper (used at SAVE time only) ─────────
create or replace function public._base32_decode(p_b32 text)
returns bytea
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  v_clean   text := upper(regexp_replace(coalesce(p_b32, ''), '[= ]', '', 'g'));
  v_buf     int  := 0;
  v_bits    int  := 0;
  v_hex     text := '';
  v_idx     int;
  v_code    int;
  i         int;
begin
  for i in 1..length(v_clean) loop
    v_code := ascii(substring(v_clean, i, 1));
    v_idx := case
      when v_code between 65 and 90 then v_code - 65  -- A-Z → 0-25
      when v_code between 50 and 55 then v_code - 24  -- 2-7 → 26-31
      else -1
    end;
    if v_idx < 0 then continue; end if;
    v_buf  := (v_buf << 5) | v_idx;
    v_bits := v_bits + 5;
    if v_bits >= 8 then
      v_hex  := v_hex || lpad(to_hex((v_buf >> (v_bits - 8)) & 255), 2, '0');
      v_bits := v_bits - 8;
    end if;
  end loop;
  return decode(v_hex, 'hex');
end $$;

revoke execute on function public._base32_decode(text) from public, anon, authenticated;

comment on function public._base32_decode(text) is
  'RFC 4648 base32 decode. Internal helper used by save_totp_secret. Strips padding/whitespace, ignores invalid chars.';

-- ── 2. Rewrite save_totp_secret: store RAW BYTES encrypted ───
create or replace function public.save_totp_secret(p_secret text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp, extensions
as $$
declare
  v_uid    uuid := auth.uid();
  v_key    text;
  v_bytes  bytea;
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

  v_bytes := public._base32_decode(p_secret);
  if length(v_bytes) < 10 then
    raise exception 'decoded secret too short (got % bytes, need ≥10)', length(v_bytes)
      using errcode = '22023';
  end if;

  insert into public.user_2fa (user_id, totp_secret_enc, enabled, enabled_at)
  values (v_uid, pgp_sym_encrypt_bytea(v_bytes, v_key), true, now())
  on conflict (user_id) do update
    set totp_secret_enc = excluded.totp_secret_enc,
        enabled         = true,
        enabled_at      = now();

  return true;
end $$;

-- ── 3. Server-side TOTP verifier (RFC 6238) ──────────────────
create or replace function public.verify_user_2fa(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp, extensions
as $$
declare
  v_uid       uuid := auth.uid();
  v_key       text;
  v_secret    bytea;
  v_t         bigint;
  v_t_bytes   bytea;
  v_hmac      bytea;
  v_offset    int;
  v_code_int  bigint;
  v_expected  text;
  i           int;
begin
  if v_uid is null then return false; end if;

  if p_code is null or length(p_code) != 6 or p_code !~ '^[0-9]{6}$' then
    return false;
  end if;

  select key_value into v_key from public._app_secrets where key_name = 'totp_master_key';
  if v_key is null then return false; end if;

  select pgp_sym_decrypt_bytea(totp_secret_enc, v_key) into v_secret
  from public.user_2fa where user_id = v_uid and enabled = true;
  if v_secret is null or length(v_secret) < 10 then return false; end if;

  -- Check current window (i=0) + previous window (i=1) for 30s clock skew
  for i in 0..1 loop
    v_t := (extract(epoch from now())::bigint / 30) - i;
    v_t_bytes := decode(lpad(to_hex(v_t), 16, '0'), 'hex');
    v_hmac := hmac(v_t_bytes, v_secret, 'sha1');

    -- RFC 4226 §5.3 dynamic truncation
    v_offset := get_byte(v_hmac, 19) & 15;
    v_code_int := ((get_byte(v_hmac, v_offset    ) & 127)::bigint * 16777216)
                + ( get_byte(v_hmac, v_offset + 1)::bigint        * 65536)
                + ( get_byte(v_hmac, v_offset + 2)::bigint        * 256)
                + ( get_byte(v_hmac, v_offset + 3)::bigint);
    v_code_int := v_code_int % 1000000;

    v_expected := lpad(v_code_int::text, 6, '0');
    if v_expected = p_code then return true; end if;
  end loop;

  return false;
end $$;

revoke execute on function public.verify_user_2fa(text) from public, anon;
grant  execute on function public.verify_user_2fa(text) to authenticated;

comment on function public.verify_user_2fa(text) is
  'RFC 6238 TOTP verifier. Decrypts secret + computes HMAC-SHA1 entirely server-side; secret never leaves the DB. Checks current + previous 30s window. auth.uid()-pinned.';

-- ── 4. Drop the now-unused fetch RPC ─────────────────────────
-- get_totp_secret_for_verify is no longer needed: verify_user_2fa
-- handles the entire flow server-side. Dropping it eliminates the
-- attack surface where a compromised session could exfiltrate the
-- plaintext secret.
drop function if exists public.get_totp_secret_for_verify();
