-- ═══════════════════════════════════════════════════════════════════════════
-- SOSphere — Platform Super-Admin Console (2026-06-17)
-- ───────────────────────────────────────────────────────────────────────────
-- Pins the standalone /super-admin console's backend into version control so
-- it is reproducible on every deploy. Everything here was first created live
-- via the dashboard; this migration is the canonical, idempotent definition.
--
-- Security model:
--   • public.platform_admins is the allow-list. RLS is ENABLED with NO policies
--     → it is unreadable/unwritable by anon or authenticated roles directly.
--     The only read path is is_platform_admin() (SECURITY DEFINER), and the
--     only write path is the service_role (which bypasses RLS).
--   • Every platform_* reporting/mutation function is SECURITY DEFINER and
--     begins with an is_platform_admin() guard that raises 42501 for non-admins.
--   • search_path is pinned to public, pg_temp on every function.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Allow-list table ────────────────────────────────────────────────────
create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;
-- Intentionally NO policies: deny-all to anon/authenticated. Access is solely
-- through the SECURITY DEFINER functions below and the service_role.

-- ── 1b. Audit log (every privileged action is recorded) ────────────────────
create table if not exists public.platform_audit_log (
  id            bigint generated always as identity primary key,
  actor_user_id uuid,
  actor_email   text,
  action        text not null,
  target        text,
  detail        jsonb,
  created_at    timestamptz not null default now()
);
alter table public.platform_audit_log enable row level security;
-- deny-all: readable only via SECURITY DEFINER platform_audit_list().

-- ── 2. Gate function ───────────────────────────────────────────────────────
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists(select 1 from public.platform_admins where user_id = auth.uid())
$$;
revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated;

-- ── 3. Platform-wide overview KPIs ─────────────────────────────────────────
create or replace function public.platform_overview()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'companies_total',    (select count(*) from public.companies),
    'companies_active',   (select count(*) from public.companies where is_active),
    'users_total',        (select count(*) from public.profiles),
    'users_company',      (select count(*) from public.profiles where company_id is not null),
    'users_civilian',     (select count(*) from public.profiles where company_id is null),
    'emergencies_active', (select count(*) from public.emergencies where is_active = true),
    'emergencies_total',  (select count(*) from public.emergencies),
    'subs_active',        (select count(*) from public.subscriptions where status in ('active','trialing','past_due')),
    'subs_basic',         (select count(*) from public.subscriptions where tier='basic' and status in ('active','trialing','past_due')),
    'subs_elite',         (select count(*) from public.subscriptions where tier='elite' and status in ('active','trialing','past_due')),
    'subs_company',       (select count(*) from public.subscriptions where company_id is not null and status in ('active','trialing','past_due')),
    'generated_at',       now()
  ) into result;
  return result;
end;
$$;
revoke all on function public.platform_overview() from public;
grant execute on function public.platform_overview() to authenticated;

-- ── 4. Companies listing ───────────────────────────────────────────────────
create or replace function public.platform_companies()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(j order by ca desc nulls last), '[]'::jsonb)
  into result
  from (
    select jsonb_build_object(
      'id', c.id, 'name', c.name, 'plan', c.plan, 'is_active', c.is_active,
      'admin_email', c.admin_email, 'industry', c.industry, 'country', c.country,
      'billing_cycle', c.billing_cycle, 'trial_ends_at', c.trial_ends_at,
      'created_at', c.created_at,
      'members', (select count(*) from public.profiles p where p.company_id = c.id),
      'active_emergencies', (select count(*) from public.emergencies e where e.company_id = c.id and e.is_active = true)
    ) as j, c.created_at as ca
    from public.companies c
  ) t;
  return result;
end;
$$;
revoke all on function public.platform_companies() from public;
grant execute on function public.platform_companies() to authenticated;

-- ── 5. Users listing ───────────────────────────────────────────────────────
create or replace function public.platform_users()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(j order by ca desc nulls last), '[]'::jsonb)
  into result
  from (
    select jsonb_build_object(
      'id', p.id, 'user_id', p.user_id, 'full_name', p.full_name, 'email', p.email,
      'role', p.role, 'user_type', p.user_type, 'status', p.status,
      'company_id', p.company_id, 'company_name', co.name, 'created_at', p.created_at,
      'tier', s.tier, 'sub_status', s.status
    ) as j, p.created_at as ca
    from public.profiles p
    left join public.companies co on co.id = p.company_id
    left join public.subscriptions s on s.user_id = p.user_id and s.status in ('active','trialing','past_due')
  ) t;
  return result;
end;
$$;
revoke all on function public.platform_users() from public;
grant execute on function public.platform_users() to authenticated;

-- ── 6. Subscriptions listing ───────────────────────────────────────────────
create or replace function public.platform_subscriptions()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(j order by ca desc nulls last), '[]'::jsonb)
  into result
  from (
    select jsonb_build_object(
      'user_id', s.user_id, 'company_id', s.company_id,
      'owner_name', coalesce(p.full_name, co.name),
      'owner_email', coalesce(p.email, co.admin_email),
      'scope', case when s.company_id is not null then 'company' else 'civilian' end,
      'tier', s.tier, 'status', s.status, 'current_period_end', s.current_period_end,
      'manual', (s.stripe_subscription_id is null), 'updated_at', s.updated_at
    ) as j, s.updated_at as ca
    from public.subscriptions s
    left join public.profiles p on p.user_id = s.user_id
    left join public.companies co on co.id = s.company_id
  ) t;
  return result;
end;
$$;
revoke all on function public.platform_subscriptions() from public;
grant execute on function public.platform_subscriptions() to authenticated;

-- ── 7. Manual civilian upgrade / downgrade ─────────────────────────────────
-- Grants a B2C user a paid tier without Stripe. stripe_subscription_id is left
-- NULL so the subscriptions table's "manual" flag distinguishes these rows.
create or replace function public.platform_set_civilian_subscription(
  p_user_id uuid, p_tier text, p_duration text
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_end timestamptz; v_status text; v_tier text; v_name text; v_actor text;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_tier not in ('basic','elite','free') then
    raise exception 'invalid tier: %', p_tier using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'user not found' using errcode = '22023';
  end if;
  if p_tier <> 'free' and p_duration not in ('1month','2months','lifetime') then
    raise exception 'invalid duration: %', p_duration using errcode = '22023';
  end if;

  if p_tier = 'free' then
    v_tier := 'free'; v_status := 'inactive'; v_end := null;
  else
    v_tier := p_tier; v_status := 'active';
    v_end := case p_duration
      when '1month'   then now() + interval '1 month'
      when '2months'  then now() + interval '2 months'
      when 'lifetime' then now() + interval '100 years'
    end;
  end if;

  insert into public.subscriptions
    (user_id, tier, status, current_period_end, stripe_subscription_id, cancel_at_period_end, updated_at)
  values (p_user_id, v_tier, v_status, v_end, null, false, now())
  on conflict (user_id) do update
    set tier = excluded.tier, status = excluded.status,
        current_period_end = excluded.current_period_end,
        stripe_subscription_id = null, cancel_at_period_end = false, updated_at = now();

  select full_name into v_name from public.profiles where user_id = p_user_id limit 1;
  select email into v_actor from public.platform_admins where user_id = auth.uid();

  insert into public.platform_audit_log(actor_user_id, actor_email, action, target, detail)
  values (auth.uid(), v_actor, 'subscription.set', coalesce(v_name, p_user_id::text),
    jsonb_build_object('user_id', p_user_id, 'tier', v_tier, 'status', v_status,
      'duration', p_duration, 'current_period_end', v_end));

  return jsonb_build_object('ok', true, 'user_id', p_user_id, 'name', v_name,
    'tier', v_tier, 'status', v_status, 'current_period_end', v_end);
end;
$$;
revoke all on function public.platform_set_civilian_subscription(uuid, text, text) from public;
grant execute on function public.platform_set_civilian_subscription(uuid, text, text) to authenticated;

-- ── 7b. Platform Tools: audit list, admin management, plans ─────────────────
create or replace function public.platform_audit_list()
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'actor_email', a.actor_email, 'action', a.action,
    'target', a.target, 'detail', a.detail, 'created_at', a.created_at
  ) order by a.id desc), '[]'::jsonb)
  into result
  from (select * from public.platform_audit_log order by id desc limit 200) a;
  return result;
end;
$$;
revoke all on function public.platform_audit_list() from public;
grant execute on function public.platform_audit_list() to authenticated;

create or replace function public.platform_list_admins()
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', pa.user_id, 'email', pa.email, 'created_at', pa.created_at,
    'is_self', pa.user_id = auth.uid()
  ) order by pa.created_at), '[]'::jsonb)
  into result from public.platform_admins pa;
  return result;
end;
$$;
revoke all on function public.platform_list_admins() from public;
grant execute on function public.platform_list_admins() to authenticated;

create or replace function public.platform_add_admin(p_email text)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_id uuid; v_email text; v_actor text;
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select email into v_actor from public.platform_admins where user_id = auth.uid();
  select id, email into v_id, v_email from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_id is null then
    raise exception 'no account exists with that email' using errcode='22023';
  end if;
  insert into public.platform_admins(user_id, email) values (v_id, v_email)
    on conflict (user_id) do nothing;
  insert into public.platform_audit_log(actor_user_id, actor_email, action, target, detail)
    values (auth.uid(), v_actor, 'admin.add', v_email, jsonb_build_object('user_id', v_id));
  return jsonb_build_object('ok', true, 'user_id', v_id, 'email', v_email);
end;
$$;
revoke all on function public.platform_add_admin(text) from public;
grant execute on function public.platform_add_admin(text) to authenticated;

create or replace function public.platform_remove_admin(p_user_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_count int; v_email text; v_actor text;
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select email into v_actor from public.platform_admins where user_id = auth.uid();
  select count(*) into v_count from public.platform_admins;
  if v_count <= 1 then
    raise exception 'cannot remove the last platform admin' using errcode='22023';
  end if;
  select email into v_email from public.platform_admins where user_id = p_user_id;
  if v_email is null then
    raise exception 'that user is not an admin' using errcode='22023';
  end if;
  delete from public.platform_admins where user_id = p_user_id;
  insert into public.platform_audit_log(actor_user_id, actor_email, action, target, detail)
    values (auth.uid(), v_actor, 'admin.remove', v_email, jsonb_build_object('user_id', p_user_id));
  return jsonb_build_object('ok', true, 'removed', v_email);
end;
$$;
revoke all on function public.platform_remove_admin(uuid) from public;
grant execute on function public.platform_remove_admin(uuid) to authenticated;

create or replace function public.platform_plans_overview()
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'tier', tier, 'scope', scope, 'active', active, 'total', total
  ) order by sortk, tier), '[]'::jsonb)
  into result
  from (
    select coalesce(s.tier,'free') as tier,
      case when s.company_id is not null then 'company' else 'civilian' end as scope,
      count(*) filter (where s.status in ('active','trialing','past_due')) as active,
      count(*) as total,
      min(case coalesce(s.tier,'free')
        when 'basic' then 1 when 'elite' then 2 when 'starter' then 3
        when 'growth' then 4 when 'business' then 5 when 'enterprise' then 6 else 9 end) as sortk
    from public.subscriptions s
    group by 1, 2
  ) t;
  return result;
end;
$$;
revoke all on function public.platform_plans_overview() from public;
grant execute on function public.platform_plans_overview() to authenticated;

-- Self-service password change for a super-admin. Verifies the current
-- password against the stored bcrypt hash, then rewrites it. Runs as a
-- SECURITY DEFINER (postgres-owned) function so it can update auth.users —
-- this sidesteps GoTrue's email-OTP reauthentication requirement while still
-- proving knowledge of the current password. pgcrypto lives in `extensions`.
create or replace function public.platform_change_my_password(p_current text, p_new text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare v_uid uuid; v_actor text;
begin
  v_uid := auth.uid();
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if length(coalesce(p_new,'')) < 8 then
    raise exception 'password too short' using errcode = '22023';
  end if;
  if not exists (
    select 1 from auth.users
    where id = v_uid and encrypted_password = crypt(p_current, encrypted_password)
  ) then
    raise exception 'current password is incorrect' using errcode = '28P01';
  end if;
  update auth.users
    set encrypted_password = crypt(p_new, gen_salt('bf')), updated_at = now()
    where id = v_uid;
  select email into v_actor from public.platform_admins where user_id = v_uid;
  insert into public.platform_audit_log(actor_user_id, actor_email, action, target, detail)
    values (v_uid, v_actor, 'password.change', v_actor, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.platform_change_my_password(text, text) from public;
grant execute on function public.platform_change_my_password(text, text) to authenticated;

-- ── 8. Seed the platform owner(s) ──────────────────────────────────────────
-- Idempotent: looks the account up by email in auth.users and inserts it into
-- the allow-list only if that user already exists. Safe to run on any DB —
-- does nothing when the email has no account yet. Add/remove emails here to
-- manage who has super-admin access in version control.
insert into public.platform_admins (user_id, email)
select u.id, u.email
from auth.users u
where u.email in ('fadi1988319@yahoo.com', 'fadihadi06@gmail.com')
on conflict (user_id) do nothing;
