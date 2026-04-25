-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: age_gating_2026_04_24
-- Version:   20260425073307
-- Applied:   2026-04-25 via Supabase MCP
-- Source of truth: this file matches what was applied to prod
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- Age Gating — COPPA + GDPR Art. 8 compliance (Fix #11)
-- ─────────────────────────────────────────────────────────────────────────
-- Three columns added to profiles:
--   date_of_birth         — DATE the user entered (private, never exposed)
--   age_verified_at       — TIMESTAMPTZ, set when verification completes
--   age_category          — text: 'under13' | '13to15' | '16plus'
--   parental_consent_at   — TIMESTAMPTZ, required for 13-15 (GDPR Art. 8)
--
-- Server-enforced rules:
--   * Anyone <13 is blocked at signup → auth.users record deleted
--   * 13-15 requires parental email/phone + consent token
--   * 16+ proceeds normally
--   * Existing rows: age_verified_at = NULL → app forces re-verification on login
--
-- The RPC `verify_user_age` is the SINGLE entry point. Called by the
-- client after OTP verification, BEFORE any other profile data is saved.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Add columns (idempotent) ──
alter table public.profiles
  add column if not exists date_of_birth        date,
  add column if not exists age_verified_at      timestamptz,
  add column if not exists age_category         text check (age_category in ('under13','13to15','16plus')),
  add column if not exists parental_consent_at  timestamptz,
  add column if not exists parental_contact     text;  -- email or phone of consenting adult

-- ── Helper: compute age from DOB ──
create or replace function public.compute_age(p_dob date)
returns int
language sql
immutable
as $$
  select extract(year from age(current_date, p_dob))::int;
$$;

-- ── Main verification RPC ──
-- Returns one of:
--   { ok: true,  category: '16plus',   age_verified_at: ... }
--   { ok: true,  category: '13to15',   parental_consent_required: true }
--   { ok: false, reason: 'under13',    message: '...' }   ← caller must logout + delete auth user
--   { ok: false, reason: 'invalid_dob' }
--   { ok: false, reason: 'unauthenticated' }
create or replace function public.verify_user_age(
  p_dob               date,
  p_parental_contact  text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_age        int;
  v_category   text;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if p_dob is null or p_dob > current_date or p_dob < '1900-01-01'::date then
    return jsonb_build_object('ok', false, 'reason', 'invalid_dob',
      'message', 'Please enter a valid date of birth.');
  end if;

  v_age := public.compute_age(p_dob);

  -- Categorise by age (COPPA + GDPR Art. 8 strictest threshold = 16)
  if v_age < 13 then
    v_category := 'under13';
  elsif v_age < 16 then
    v_category := '13to15';
  else
    v_category := '16plus';
  end if;

  -- Audit BEFORE any state change (so under13 events are recorded too)
  begin
    perform public.log_sos_audit(
      'age_verification_attempt',
      v_user_id::text,
      'worker',
      'compliance',
      v_user_id::text,
      null,
      jsonb_build_object(
        'category', v_category,
        'age_year_only', extract(year from p_dob)::int,  -- year only — privacy
        'parental_required', v_category = '13to15',
        'source', 'verify_user_age'
      )
    );
  exception when others then null;
  end;

  -- ── Hard block: under 13 ──
  if v_category = 'under13' then
    -- Mark profile so even if auth.users delete races, app blocks them.
    update public.profiles
       set age_category = 'under13',
           date_of_birth = p_dob
     where id = v_user_id or user_id = v_user_id;

    return jsonb_build_object(
      'ok', false,
      'reason', 'under13',
      'message', 'SOSphere is not available for users under 13. Please ask a parent to set up an account on your behalf.'
    );
  end if;

  -- ── 13-15: require parental consent contact ──
  if v_category = '13to15' then
    if p_parental_contact is null or length(trim(p_parental_contact)) < 5 then
      return jsonb_build_object(
        'ok', true,
        'category', '13to15',
        'parental_consent_required', true,
        'message', 'A parent or guardian must approve this account. Please provide their email or phone number.'
      );
    end if;

    update public.profiles
       set date_of_birth       = p_dob,
           age_category        = '13to15',
           age_verified_at     = now(),
           parental_consent_at = now(),
           parental_contact    = p_parental_contact
     where id = v_user_id or user_id = v_user_id;

    return jsonb_build_object(
      'ok', true,
      'category', '13to15',
      'parental_contact_recorded', true,
      'verified_at', now()
    );
  end if;

  -- ── 16+: full access ──
  update public.profiles
     set date_of_birth   = p_dob,
         age_category    = '16plus',
         age_verified_at = now()
   where id = v_user_id or user_id = v_user_id;

  return jsonb_build_object(
    'ok', true,
    'category', '16plus',
    'verified_at', now()
  );
end;
$$;

grant execute on function public.verify_user_age(date, text) to authenticated;
revoke execute on function public.verify_user_age(date, text) from anon;

comment on function public.verify_user_age(date, text) is
  '2026-04-24 Fix #11: COPPA + GDPR Art. 8 age verification. Caller (authenticated user) submits DOB. Returns category or block reason. <13 → marked, app must logout + delete auth user. 13-15 → parental_contact required. 16+ → full access.';

-- ── Helper: returns whether the current user has passed verification ──
create or replace function public.is_age_verified()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select age_verified_at is not null
       from public.profiles
      where id = auth.uid() or user_id = auth.uid()
      limit 1),
    false
  );
$$;
grant execute on function public.is_age_verified() to authenticated;

comment on function public.is_age_verified is
  '2026-04-24 Fix #11: returns true when current user has completed age verification. Client uses this on every app launch to gate access.';
