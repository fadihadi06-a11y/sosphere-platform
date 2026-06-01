-- ═══════════════════════════════════════════════════════════════
-- 2026-06-01 CRIT-3: world-class invitation flow (admin bulk send)
-- ─────────────────────────────────────────────────────────────
-- Problem (pre-fix):
--   employee-invite-manager.tsx:handleConfirmSent only printed
--   `[SUPABASE_READY] invite_status:` to console — NO database write.
--   Admins thought they sent invites; the DB stayed empty; employees
--   never received the invitation row that accept_invitation() needs.
--
-- World-class fix (mirrors CRIT-2 / CRIT-4 pattern):
--   1. Server is THE source of truth (this migration)
--   2. SECDEF RPC gates all bulk writes (owner/admin only)
--   3. Idempotent: re-sending the same email refreshes the invite
--      (resets status to 'pending', extends expires_at) rather than
--      creating a duplicate row.
--   4. Client calls the RPC and surfaces failures (no more silent log).
--
-- Note on OUT-param naming: PostgreSQL refused to plan the INSERT...ON
-- CONFLICT body when the OUT params were named identically to columns
-- on `public.invitations` (email, status, expires_at) — it treated them
-- as ambiguous.  Prefixing with `r_` resolves this cleanly and keeps
-- the SQL readable.  Client (invitation-service.ts) strips the prefix
-- before exposing rows to UI code.
--
-- Companion: accept_invitation() already exists and is wired up via
-- welcome-activation.tsx + dashboard-web-page.tsx safety-net prefetch.
-- See SECURITY_DECISIONS.md for the pattern's rationale.
-- ═══════════════════════════════════════════════════════════════

-- 1. Dedupe existing invitations (keep most-recent per company+lower(email))
with ranked as (
  select id,
         row_number() over (
           partition by company_id, lower(trim(email))
           order by coalesce(accepted_at, created_at) desc, created_at desc
         ) as rn
  from public.invitations
  where email is not null
)
delete from public.invitations
where id in (select id from ranked where rn > 1);

-- Normalize email casing so the unique index is stable
update public.invitations
   set email = lower(trim(email))
 where email is distinct from lower(trim(email));

-- 2. Unique constraint enabling ON CONFLICT upsert in the RPC below.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and tablename='invitations'
      and indexname='invitations_company_email_unique'
  ) then
    create unique index invitations_company_email_unique
      on public.invitations(company_id, email);
  end if;
end $$;

-- 3. Bulk-create SECDEF RPC
drop function if exists public.create_employee_invitations_bulk(uuid, jsonb);

create or replace function public.create_employee_invitations_bulk(
  p_company_id uuid,
  p_invites    jsonb
) returns table (
  r_invite_id  uuid,
  r_email      text,
  r_token      text,
  r_status     text,
  r_expires_at timestamptz,
  r_was_new    boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_allowed boolean;
  v_row     jsonb;
  v_email   text;
  v_name    text;
  v_phone   text;
  v_role    text;
  v_dept    text;
  v_zone    text;
  v_existed boolean;
  v_id      uuid;
  v_token   text;
  v_exp     timestamptz;
  v_status  text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_company_id is null then
    raise exception 'p_company_id is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_invites) <> 'array' then
    raise exception 'p_invites must be a JSON array' using errcode = '22023';
  end if;

  -- Authorize: owner of the company OR active admin/owner membership
  select exists (
    select 1 from public.companies c
    where c.id = p_company_id and c.owner_id = v_uid
  ) or exists (
    select 1 from public.company_memberships m
    where m.company_id = p_company_id
      and m.user_id    = v_uid
      and m.active     = true
      and m.role in ('owner','admin')
  ) into v_allowed;
  if not v_allowed then
    raise exception 'not authorized for company %', p_company_id using errcode = '42501';
  end if;

  for v_row in select * from jsonb_array_elements(p_invites)
  loop
    v_email := lower(trim(coalesce(v_row->>'email','')));
    if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      r_invite_id  := null;
      r_email      := coalesce(v_row->>'email','');
      r_token      := null;
      r_status     := 'invalid_email';
      r_expires_at := null;
      r_was_new    := false;
      return next;
      continue;
    end if;

    v_name := nullif(trim(coalesce(v_row->>'name','')),'');
    v_phone := nullif(trim(coalesce(v_row->>'phone','')),'');
    v_role  := lower(trim(coalesce(v_row->>'role','employee')));
    if v_role not in ('owner','admin','employee','member','zone_admin') then
      v_role := 'employee';
    end if;
    v_dept := nullif(trim(coalesce(v_row->>'department','')),'');
    v_zone := nullif(trim(coalesce(v_row->>'zone_name', v_row->>'zone', '')),'');

    v_existed := null;
    select true into v_existed
      from public.invitations i
     where i.company_id = p_company_id
       and i.email      = v_email
     limit 1;

    insert into public.invitations (
      company_id, email, name, phone, role, role_type,
      department, zone_name, invited_by, status, expires_at
    ) values (
      p_company_id, v_email, v_name, v_phone, v_role, v_role,
      v_dept, v_zone, v_uid, 'pending', now() + interval '30 days'
    )
    on conflict (company_id, email) do update
       set name        = coalesce(excluded.name, public.invitations.name),
           phone       = coalesce(excluded.phone, public.invitations.phone),
           role        = excluded.role,
           role_type   = excluded.role_type,
           department  = coalesce(excluded.department, public.invitations.department),
           zone_name   = coalesce(excluded.zone_name, public.invitations.zone_name),
           invited_by  = excluded.invited_by,
           status      = case when public.invitations.status = 'accepted'
                              then public.invitations.status else 'pending' end,
           expires_at  = case when public.invitations.status = 'accepted'
                              then public.invitations.expires_at
                              else now() + interval '30 days' end
    returning id, token, expires_at, status
      into v_id, v_token, v_exp, v_status;

    r_invite_id  := v_id;
    r_email      := v_email;
    r_token      := v_token;
    r_status     := v_status;
    r_expires_at := v_exp;
    r_was_new    := coalesce(not v_existed, true);
    return next;
  end loop;
end $$;

revoke execute on function public.create_employee_invitations_bulk(uuid, jsonb) from public, anon;
grant  execute on function public.create_employee_invitations_bulk(uuid, jsonb) to authenticated;

-- 4. Get invitation statuses (paired RPC so client never needs raw SELECT)
create or replace function public.get_company_invitations(p_company_id uuid)
returns table (
  id          uuid,
  email       text,
  name        text,
  phone       text,
  role        text,
  status      text,
  created_at  timestamptz,
  expires_at  timestamptz,
  accepted_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_allowed boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select exists (
    select 1 from public.companies c
    where c.id = p_company_id and c.owner_id = v_uid
  ) or exists (
    select 1 from public.company_memberships m
    where m.company_id = p_company_id
      and m.user_id    = v_uid
      and m.active     = true
      and m.role in ('owner','admin')
  ) into v_allowed;
  if not v_allowed then
    raise exception 'not authorized for company %', p_company_id using errcode = '42501';
  end if;
  return query
  select i.id, i.email, i.name, i.phone, coalesce(i.role, i.role_type) as role,
         i.status, i.created_at, i.expires_at, i.accepted_at
  from public.invitations i
  where i.company_id = p_company_id
  order by i.created_at desc;
end $$;

revoke execute on function public.get_company_invitations(uuid) from public, anon;
grant  execute on function public.get_company_invitations(uuid) to authenticated;
