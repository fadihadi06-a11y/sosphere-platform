-- ═══════════════════════════════════════════════════════════════
-- P3 DRIFT BASELINE — 88 tables backfilled from production
-- ─────────────────────────────────────────────────────────────
-- Auto-generated 2026-05-30 from public._tmp_drift_emit_table_ddl()
-- against project rtfhkbskgrasamhjraul. Re-applies idempotently
-- (CREATE TABLE IF NOT EXISTS + DO/IF NOT EXISTS guards on every
-- constraint, index, and policy).
--
-- This restores the migration audit trail for tables that drifted
-- into production without committed migration files. Running this
-- against a clean database after the other migrations reproduces
-- the full production schema. Re-running against production is a
-- no-op (every statement is guarded).
--
-- See SUPABASE_DRIFT_AUDIT.md for the full backfill rationale.
-- ═══════════════════════════════════════════════════════════════
-- ──────────────────────────────────────────────────────────
-- profiles
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid NOT NULL,
  company_id uuid,
  full_name text NOT NULL DEFAULT ''::text,
  role text NOT NULL DEFAULT 'employee'::text,
  created_at timestamp with time zone DEFAULT now(),
  status text DEFAULT 'off_duty'::text,
  user_type text NOT NULL DEFAULT 'individual'::text,
  updated_at timestamp with time zone DEFAULT now(),
  email text,
  active_company_id uuid,
  user_id uuid,
  avatar_url text,
  phone text,
  onboarding_completed boolean NOT NULL DEFAULT false,
  onboarding_completed_at timestamp with time zone,
  date_of_birth date,
  age_verified_at timestamp with time zone,
  age_category text,
  parental_consent_at timestamp with time zone,
  parental_contact text,
  tos_consent_at timestamp with time zone,
  tos_consent_version text,
  gps_consent_at timestamp with time zone,
  gps_consent_decision text,
  neighbor_receive_at timestamp with time zone,
  neighbor_receive_decision text,
  admin_pin_hash text,
  admin_pin_salt text,
  admin_pin_set_at timestamp with time zone,
  admin_pin_failed_attempts integer NOT NULL DEFAULT 0,
  admin_pin_locked_until timestamp with time zone
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_pkey' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_user_id_key' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_age_category_check' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_age_category_check CHECK ((age_category = ANY (ARRAY['under13'::text, '13to15'::text, '16plus'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_gps_consent_decision_check' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_gps_consent_decision_check CHECK (((gps_consent_decision IS NULL) OR (gps_consent_decision = ANY (ARRAY['granted'::text, 'declined'::text]))));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_neighbor_receive_decision_check' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_neighbor_receive_decision_check CHECK (((neighbor_receive_decision IS NULL) OR (neighbor_receive_decision = ANY (ARRAY['granted'::text, 'declined'::text]))));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_role_check' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['employee'::text, 'admin'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_status_allowed' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_status_allowed CHECK ((status = ANY (ARRAY['on_duty'::text, 'off_duty'::text, 'absent'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_user_type_check' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_type_check CHECK ((user_type = ANY (ARRAY['individual'::text, 'family_admin'::text, 'family_member'::text, 'company_admin'::text, 'business'::text, 'responder'::text, 'dispatcher'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_company_id_fkey' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_id_fkey' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enforce_profile_active_company_match' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT enforce_profile_active_company_match TRIGGER DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_profiles_company') THEN
    EXECUTE 'CREATE INDEX idx_profiles_company ON public.profiles USING btree (company_id)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_profiles_user') THEN
    EXECUTE 'CREATE INDEX idx_profiles_user ON public.profiles USING btree (user_id)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='profiles_email_unique') THEN
    EXECUTE 'CREATE UNIQUE INDEX profiles_email_unique ON public.profiles USING btree (lower(email))';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='profiles_role_idx') THEN
    EXECUTE 'CREATE INDEX profiles_role_idx ON public.profiles USING btree (role)';
  END IF;
END $do$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = id));
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = id));
DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
CREATE POLICY "Users view own profile" ON public.profiles AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = id));
DROP POLICY IF EXISTS auth_admin_insert_profiles ON public.profiles;
CREATE POLICY auth_admin_insert_profiles ON public.profiles AS PERMISSIVE FOR INSERT TO supabase_auth_admin
  WITH CHECK (true);
DROP POLICY IF EXISTS profiles_company_read ON public.profiles;
CREATE POLICY profiles_company_read ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING (((company_id IS NOT NULL) AND is_company_member(company_id)));
DROP POLICY IF EXISTS profiles_own ON public.profiles;
CREATE POLICY profiles_own ON public.profiles AS PERMISSIVE FOR ALL TO public
  USING (((user_id = auth.uid()) OR ((id)::text = (auth.uid())::text)));
DROP POLICY IF EXISTS profiles_read_own ON public.profiles;
CREATE POLICY profiles_read_own ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING ((id = auth.uid()));
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING ((id = auth.uid()));
DROP POLICY IF EXISTS profiles_select_own_or_admin ON public.profiles;
CREATE POLICY profiles_select_own_or_admin ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING (((id = auth.uid()) OR is_admin()));
DROP POLICY IF EXISTS profiles_self_read ON public.profiles;
CREATE POLICY profiles_self_read ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING (((id = auth.uid()) OR (user_id = auth.uid())));
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((id = auth.uid()) OR (user_id = auth.uid())))
  WITH CHECK (((id = auth.uid()) OR (user_id = auth.uid())));
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((id = auth.uid()))
  WITH CHECK ((id = auth.uid()));
DROP POLICY IF EXISTS profiles_update_own_active_company ON public.profiles;
CREATE POLICY profiles_update_own_active_company ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((id = auth.uid()))
  WITH CHECK ((id = auth.uid()));
DROP POLICY IF EXISTS profiles_update_own_or_admin ON public.profiles;
CREATE POLICY profiles_update_own_or_admin ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((id = auth.uid()) OR is_admin()))
  WITH CHECK (((id = auth.uid()) OR is_admin()));
DROP POLICY IF EXISTS profiles_update_safe ON public.profiles;
CREATE POLICY profiles_update_safe ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((id = auth.uid()))
  WITH CHECK (((id = auth.uid()) AND (role = ( SELECT p2.role
   FROM profiles p2
  WHERE (p2.id = auth.uid()))) AND (NOT (company_id IS DISTINCT FROM ( SELECT p2.company_id
   FROM profiles p2
  WHERE (p2.id = auth.uid())))) AND (user_type = ( SELECT p2.user_type
   FROM profiles p2
  WHERE (p2.id = auth.uid())))));
DROP POLICY IF EXISTS "read own profile" ON public.profiles;
CREATE POLICY "read own profile" ON public.profiles AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = id));
DROP POLICY IF EXISTS service_role_can_insert_profiles ON public.profiles;
CREATE POLICY service_role_can_insert_profiles ON public.profiles AS PERMISSIVE FOR INSERT TO service_role
  WITH CHECK (true);
DROP POLICY IF EXISTS "update own profile" ON public.profiles;
CREATE POLICY "update own profile" ON public.profiles AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = id))
  WITH CHECK ((auth.uid() = id));
DROP POLICY IF EXISTS "user can insert own profile" ON public.profiles;
CREATE POLICY "user can insert own profile" ON public.profiles AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = id));

COMMENT ON COLUMN public.profiles.tos_consent_at IS 'B-08 2026-04-25: server-authoritative timestamp of ToS+Privacy acceptance.';
COMMENT ON COLUMN public.profiles.gps_consent_at IS 'B-08 2026-04-25: server-authoritative timestamp of the GPS-permission decision.';
COMMENT ON COLUMN public.profiles.neighbor_receive_at IS 'S-15 (2026-04-27): server-authoritative timestamp of the neighbor-alert receive decision.';
COMMENT ON COLUMN public.profiles.neighbor_receive_decision IS 'S-15 (2026-04-27): granted|declined for receiving nearby-SOS alerts. NULL means user has not made a decision yet.';
COMMENT ON COLUMN public.profiles.admin_pin_hash IS '#1 (2026-04-27): SHA-256(pin || salt) for server-side admin PIN gate. Never client-trusted.';

-- ──────────────────────────────────────────────────────────
-- companies
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.companies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  owner_user_id uuid,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  owner_id uuid,
  admin_email text,
  plan text DEFAULT 'starter'::text,
  is_active boolean DEFAULT true,
  invite_code text,
  industry text,
  country text DEFAULT 'SA'::text,
  employee_estimate integer DEFAULT 25,
  billing_cycle text DEFAULT 'monthly'::text,
  trial_ends_at timestamp with time zone DEFAULT (now() + '14 days'::interval),
  has_zones boolean DEFAULT false
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_pkey' AND conrelid = 'public.companies'::regclass) THEN
    ALTER TABLE public.companies ADD CONSTRAINT companies_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_owner_id_key' AND conrelid = 'public.companies'::regclass) THEN
    ALTER TABLE public.companies ADD CONSTRAINT companies_owner_id_key UNIQUE (owner_id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_owner_fkey' AND conrelid = 'public.companies'::regclass) THEN
    ALTER TABLE public.companies ADD CONSTRAINT companies_owner_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_owner_id_fkey' AND conrelid = 'public.companies'::regclass) THEN
    ALTER TABLE public.companies ADD CONSTRAINT companies_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='companies_invite_code_idx') THEN
    EXECUTE 'CREATE UNIQUE INDEX companies_invite_code_idx ON public.companies USING btree (invite_code) WHERE (invite_code IS NOT NULL)';
  END IF;
END $do$;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS companies_delete_owner ON public.companies;
CREATE POLICY companies_delete_owner ON public.companies AS PERMISSIVE FOR DELETE TO authenticated
  USING (((owner_user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = companies.id) AND (m.user_id = auth.uid()) AND (m.active = true) AND (m.role = 'owner'::text))))));
DROP POLICY IF EXISTS companies_insert_self ON public.companies;
CREATE POLICY companies_insert_self ON public.companies AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((owner_user_id = auth.uid()));
DROP POLICY IF EXISTS companies_select_members ON public.companies;
CREATE POLICY companies_select_members ON public.companies AS PERMISSIVE FOR SELECT TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = companies.id) AND (m.user_id = auth.uid()) AND (m.active = true)))) OR (owner_user_id = auth.uid())));
DROP POLICY IF EXISTS companies_update_admin_owner ON public.companies;
CREATE POLICY companies_update_admin_owner ON public.companies AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_company_admin_or_owner_v2(id))
  WITH CHECK (is_company_admin_or_owner_v2(id));


-- ──────────────────────────────────────────────────────────
-- employees
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employees (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'off_duty'::text,
  last_lat double precision,
  last_lon double precision,
  last_seen_at timestamp with time zone,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  name text DEFAULT ''::text,
  name_ar text,
  department text DEFAULT 'General'::text,
  phone text,
  safety_score integer DEFAULT 85,
  last_checkin timestamp with time zone,
  zone_id uuid,
  updated_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_pkey' AND conrelid = 'public.employees'::regclass) THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_company_id_user_id_key' AND conrelid = 'public.employees'::regclass) THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_company_id_user_id_key UNIQUE (company_id, user_id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_role_check' AND conrelid = 'public.employees'::regclass) THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'employee'::text, 'dispatcher'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_status_check' AND conrelid = 'public.employees'::regclass) THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_status_check CHECK ((status = ANY (ARRAY['off_duty'::text, 'on_duty'::text, 'on_task'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_company_id_fkey' AND conrelid = 'public.employees'::regclass) THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_user_id_fkey' AND conrelid = 'public.employees'::regclass) THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_employees_company') THEN
    EXECUTE 'CREATE INDEX idx_employees_company ON public.employees USING btree (company_id)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_employees_company_lastseen') THEN
    EXECUTE 'CREATE INDEX idx_employees_company_lastseen ON public.employees USING btree (company_id, last_seen_at DESC NULLS LAST)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_employees_company_status') THEN
    EXECUTE 'CREATE INDEX idx_employees_company_status ON public.employees USING btree (company_id, status)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_employees_user') THEN
    EXECUTE 'CREATE INDEX idx_employees_user ON public.employees USING btree (user_id)';
  END IF;
END $do$;

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employees_all ON public.employees;
CREATE POLICY employees_all ON public.employees AS PERMISSIVE FOR ALL TO public
  USING (((company_id IN ( SELECT companies.id
   FROM companies
  WHERE (companies.owner_id = auth.uid()))) OR (user_id = auth.uid())));
DROP POLICY IF EXISTS employees_company_read ON public.employees;
CREATE POLICY employees_company_read ON public.employees AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));
DROP POLICY IF EXISTS employees_own_company ON public.employees;
CREATE POLICY employees_own_company ON public.employees AS PERMISSIVE FOR ALL TO public
  USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));
DROP POLICY IF EXISTS employees_owner_write ON public.employees;
CREATE POLICY employees_owner_write ON public.employees AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_owner(company_id))
  WITH CHECK (is_company_owner(company_id));
DROP POLICY IF EXISTS employees_self_read ON public.employees;
CREATE POLICY employees_self_read ON public.employees AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));


-- ──────────────────────────────────────────────────────────
-- workspaces
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  type text NOT NULL,
  name text NOT NULL,
  owner_user_id uuid NOT NULL,
  company_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_pkey' AND conrelid = 'public.workspaces'::regclass) THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_type_check' AND conrelid = 'public.workspaces'::regclass) THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_type_check CHECK ((type = ANY (ARRAY['individual'::text, 'family'::text, 'company'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_company_id_fkey' AND conrelid = 'public.workspaces'::regclass) THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_owner_user_id_fkey' AND conrelid = 'public.workspaces'::regclass) THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uniq_individual_workspace_per_user') THEN
    EXECUTE 'CREATE UNIQUE INDEX uniq_individual_workspace_per_user ON public.workspaces USING btree (owner_user_id) WHERE (type = ''individual''::text)';
  END IF;
END $do$;

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspaces_insert_owner_only ON public.workspaces;
CREATE POLICY workspaces_insert_owner_only ON public.workspaces AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((owner_user_id = auth.uid()));
DROP POLICY IF EXISTS workspaces_own_company ON public.workspaces;
CREATE POLICY workspaces_own_company ON public.workspaces AS PERMISSIVE FOR ALL TO public
  USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));
DROP POLICY IF EXISTS workspaces_select_if_member ON public.workspaces;
CREATE POLICY workspaces_select_if_member ON public.workspaces AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = workspaces.id) AND (wm.user_id = auth.uid())))));


-- ──────────────────────────────────────────────────────────
-- workspace_members
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_members (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  joined_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_members_pkey' AND conrelid = 'public.workspace_members'::regclass) THEN
    ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (workspace_id, user_id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_members_role_check' AND conrelid = 'public.workspace_members'::regclass) THEN
    ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_members_user_id_fkey' AND conrelid = 'public.workspace_members'::regclass) THEN
    ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_members_workspace_id_fkey' AND conrelid = 'public.workspace_members'::regclass) THEN
    ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
  END IF;
END $do$;


ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS members_insert_owner_only ON public.workspace_members;
CREATE POLICY members_insert_owner_only ON public.workspace_members AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (workspaces w
     JOIN workspace_members wm ON ((wm.workspace_id = w.id)))
  WHERE ((w.id = workspace_members.workspace_id) AND (w.owner_user_id = auth.uid()) AND (wm.user_id = auth.uid()) AND (wm.role = 'owner'::text)))));
DROP POLICY IF EXISTS members_select_if_same_workspace ON public.workspace_members;
CREATE POLICY members_select_if_same_workspace ON public.workspace_members AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM workspace_members me
  WHERE ((me.workspace_id = workspace_members.workspace_id) AND (me.user_id = auth.uid())))));


-- ──────────────────────────────────────────────────────────
-- company_memberships
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_memberships (
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_memberships_pkey' AND conrelid = 'public.company_memberships'::regclass) THEN
    ALTER TABLE public.company_memberships ADD CONSTRAINT company_memberships_pkey PRIMARY KEY (company_id, user_id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_memberships_role_check' AND conrelid = 'public.company_memberships'::regclass) THEN
    ALTER TABLE public.company_memberships ADD CONSTRAINT company_memberships_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'employee'::text, 'dispatcher'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_memberships_company_id_fkey' AND conrelid = 'public.company_memberships'::regclass) THEN
    ALTER TABLE public.company_memberships ADD CONSTRAINT company_memberships_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_memberships_user_fk' AND conrelid = 'public.company_memberships'::regclass) THEN
    ALTER TABLE public.company_memberships ADD CONSTRAINT company_memberships_user_fk FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_memberships_user_id_fkey' AND conrelid = 'public.company_memberships'::regclass) THEN
    ALTER TABLE public.company_memberships ADD CONSTRAINT company_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enforce_owner_membership_consistency' AND conrelid = 'public.company_memberships'::regclass) THEN
    ALTER TABLE public.company_memberships ADD CONSTRAINT enforce_owner_membership_consistency TRIGGER DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_memberships_company_role_active') THEN
    EXECUTE 'CREATE INDEX idx_memberships_company_role_active ON public.company_memberships USING btree (company_id, role, active)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_memberships_user') THEN
    EXECUTE 'CREATE INDEX idx_memberships_user ON public.company_memberships USING btree (user_id)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_one_active_company_per_user') THEN
    EXECUTE 'CREATE UNIQUE INDEX uq_one_active_company_per_user ON public.company_memberships USING btree (user_id) WHERE (active = true)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_one_owner_per_company') THEN
    EXECUTE 'CREATE UNIQUE INDEX uq_one_owner_per_company ON public.company_memberships USING btree (company_id) WHERE ((role = ''owner''::text) AND (active = true))';
  END IF;
END $do$;

ALTER TABLE public.company_memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memberships_company_read ON public.company_memberships;
CREATE POLICY memberships_company_read ON public.company_memberships AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));
DROP POLICY IF EXISTS memberships_owner_write ON public.company_memberships;
CREATE POLICY memberships_owner_write ON public.company_memberships AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_owner(company_id))
  WITH CHECK (is_company_owner(company_id));
DROP POLICY IF EXISTS memberships_self_read ON public.company_memberships;
CREATE POLICY memberships_self_read ON public.company_memberships AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));


-- ──────────────────────────────────────────────────────────
-- company_invitations
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_invitations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + '7 days'::interval),
  accepted_at timestamp with time zone
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_invitations_pkey' AND conrelid = 'public.company_invitations'::regclass) THEN
    ALTER TABLE public.company_invitations ADD CONSTRAINT company_invitations_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_invitations_role_check' AND conrelid = 'public.company_invitations'::regclass) THEN
    ALTER TABLE public.company_invitations ADD CONSTRAINT company_invitations_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'employee'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_invitations_company_id_fkey' AND conrelid = 'public.company_invitations'::regclass) THEN
    ALTER TABLE public.company_invitations ADD CONSTRAINT company_invitations_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_invitations_created_by_fkey' AND conrelid = 'public.company_invitations'::regclass) THEN
    ALTER TABLE public.company_invitations ADD CONSTRAINT company_invitations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_invites_email_lower') THEN
    EXECUTE 'CREATE INDEX idx_invites_email_lower ON public.company_invitations USING btree (lower(email))';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_invites_token') THEN
    EXECUTE 'CREATE INDEX idx_invites_token ON public.company_invitations USING btree (token)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_invite_company_email_active') THEN
    EXECUTE 'CREATE UNIQUE INDEX uq_invite_company_email_active ON public.company_invitations USING btree (company_id, lower(email)) WHERE (accepted_at IS NULL)';
  END IF;
END $do$;

ALTER TABLE public.company_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owners_admins_can_create_invites ON public.company_invitations;
CREATE POLICY owners_admins_can_create_invites ON public.company_invitations AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = company_invitations.company_id) AND (m.user_id = auth.uid()) AND (m.active = true) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));
DROP POLICY IF EXISTS owners_admins_can_read_invites ON public.company_invitations;
CREATE POLICY owners_admins_can_read_invites ON public.company_invitations AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = company_invitations.company_id) AND (m.user_id = auth.uid()) AND (m.active = true) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));
DROP POLICY IF EXISTS owners_admins_can_update_invites ON public.company_invitations;
CREATE POLICY owners_admins_can_update_invites ON public.company_invitations AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = company_invitations.company_id) AND (m.user_id = auth.uid()) AND (m.active = true) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = company_invitations.company_id) AND (m.user_id = auth.uid()) AND (m.active = true) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


-- ──────────────────────────────────────────────────────────
-- company_invites
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_invites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  email text NOT NULL,
  invited_user_id uuid,
  role text NOT NULL DEFAULT 'member'::text,
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + '30 days'::interval),
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  accepted_by uuid,
  accepted_at timestamp with time zone,
  revoked_at timestamp with time zone,
  invite_code text,
  max_uses integer DEFAULT 100,
  used_count integer DEFAULT 0
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_invites_pkey' AND conrelid = 'public.company_invites'::regclass) THEN
    ALTER TABLE public.company_invites ADD CONSTRAINT company_invites_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_invites_role_check' AND conrelid = 'public.company_invites'::regclass) THEN
    ALTER TABLE public.company_invites ADD CONSTRAINT company_invites_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'super_admin'::text, 'admin'::text, 'member'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_invites_company_id_fkey' AND conrelid = 'public.company_invites'::regclass) THEN
    ALTER TABLE public.company_invites ADD CONSTRAINT company_invites_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_company_invites_code') THEN
    EXECUTE 'CREATE INDEX idx_company_invites_code ON public.company_invites USING btree (invite_code)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_company_invites_active') THEN
    EXECUTE 'CREATE UNIQUE INDEX uq_company_invites_active ON public.company_invites USING btree (company_id, lower(email)) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL))';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_company_invites_token') THEN
    EXECUTE 'CREATE UNIQUE INDEX uq_company_invites_token ON public.company_invites USING btree (token)';
  END IF;
END $do$;

ALTER TABLE public.company_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invites_no_direct_delete ON public.company_invites;
CREATE POLICY invites_no_direct_delete ON public.company_invites AS PERMISSIVE FOR DELETE TO authenticated
  USING (false);
DROP POLICY IF EXISTS invites_no_direct_insert ON public.company_invites;
CREATE POLICY invites_no_direct_insert ON public.company_invites AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (false);
DROP POLICY IF EXISTS invites_no_direct_update ON public.company_invites;
CREATE POLICY invites_no_direct_update ON public.company_invites AS PERMISSIVE FOR UPDATE TO authenticated
  USING (false);
DROP POLICY IF EXISTS invites_no_direct_write ON public.company_invites;
CREATE POLICY invites_no_direct_write ON public.company_invites AS PERMISSIVE FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);
DROP POLICY IF EXISTS invites_select_admins ON public.company_invites;
CREATE POLICY invites_select_admins ON public.company_invites AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM company_memberships cm
  WHERE ((cm.company_id = company_invites.company_id) AND (cm.user_id = auth.uid()) AND (cm.active = true) AND (cm.role = ANY (ARRAY['owner'::text, 'super_admin'::text, 'admin'::text]))))));


-- ──────────────────────────────────────────────────────────
-- company_settings
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_settings (
  company_id uuid NOT NULL,
  hidden_cost_hour_rate numeric NOT NULL DEFAULT 10
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_settings_pkey' AND conrelid = 'public.company_settings'::regclass) THEN
    ALTER TABLE public.company_settings ADD CONSTRAINT company_settings_pkey PRIMARY KEY (company_id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_settings_company_id_fkey' AND conrelid = 'public.company_settings'::regclass) THEN
    ALTER TABLE public.company_settings ADD CONSTRAINT company_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_settings_company') THEN
    EXECUTE 'CREATE UNIQUE INDEX idx_settings_company ON public.company_settings USING btree (company_id)';
  END IF;
END $do$;

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_settings_member_read ON public.company_settings;
CREATE POLICY company_settings_member_read ON public.company_settings AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));
DROP POLICY IF EXISTS company_settings_owner_write ON public.company_settings;
CREATE POLICY company_settings_owner_write ON public.company_settings AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_owner(company_id))
  WITH CHECK (is_company_owner(company_id));


-- ──────────────────────────────────────────────────────────
-- company_employees
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_employees (
  id bigint NOT NULL DEFAULT nextval('company_employees_id_seq'::regclass),
  company_id uuid,
  user_id uuid,
  employee_role text DEFAULT 'employee'::text,
  status text DEFAULT 'off_duty'::text,
  current_task text,
  risk_level text DEFAULT 'low'::text,
  last_lat double precision,
  last_lon double precision,
  last_location_at timestamp with time zone,
  shift_start time without time zone,
  shift_end time without time zone,
  joined_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_employees_pkey' AND conrelid = 'public.company_employees'::regclass) THEN
    ALTER TABLE public.company_employees ADD CONSTRAINT company_employees_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_employees_company_id_fkey' AND conrelid = 'public.company_employees'::regclass) THEN
    ALTER TABLE public.company_employees ADD CONSTRAINT company_employees_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_employees_user_id_fkey' AND conrelid = 'public.company_employees'::regclass) THEN
    ALTER TABLE public.company_employees ADD CONSTRAINT company_employees_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_company_employees_company') THEN
    EXECUTE 'CREATE INDEX idx_company_employees_company ON public.company_employees USING btree (company_id)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_company_employees_user') THEN
    EXECUTE 'CREATE INDEX idx_company_employees_user ON public.company_employees USING btree (user_id)';
  END IF;
END $do$;

ALTER TABLE public.company_employees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_employees_member_read ON public.company_employees;
CREATE POLICY company_employees_member_read ON public.company_employees AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));
DROP POLICY IF EXISTS users_read_own_membership ON public.company_employees;
CREATE POLICY users_read_own_membership ON public.company_employees AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));


-- ──────────────────────────────────────────────────────────
-- feature_flags
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feature_flags (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feature_flags_pkey' AND conrelid = 'public.feature_flags'::regclass) THEN
    ALTER TABLE public.feature_flags ADD CONSTRAINT feature_flags_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feature_flags_company_id_feature_key_key' AND conrelid = 'public.feature_flags'::regclass) THEN
    ALTER TABLE public.feature_flags ADD CONSTRAINT feature_flags_company_id_feature_key_key UNIQUE (company_id, feature_key);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feature_flags_company_id_fkey' AND conrelid = 'public.feature_flags'::regclass) THEN
    ALTER TABLE public.feature_flags ADD CONSTRAINT feature_flags_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $do$;


ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feature_flags_member_read ON public.feature_flags;
CREATE POLICY feature_flags_member_read ON public.feature_flags AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));
DROP POLICY IF EXISTS feature_flags_owner_write ON public.feature_flags;
CREATE POLICY feature_flags_owner_write ON public.feature_flags AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_owner(company_id))
  WITH CHECK (is_company_owner(company_id));


-- ──────────────────────────────────────────────────────────
-- individual_users
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.individual_users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  name text,
  phone text,
  plan text DEFAULT 'free'::text,
  emergency_contacts jsonb,
  blood_type text,
  gps_consent boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'individual_users_pkey' AND conrelid = 'public.individual_users'::regclass) THEN
    ALTER TABLE public.individual_users ADD CONSTRAINT individual_users_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'individual_users_user_id_fkey' AND conrelid = 'public.individual_users'::regclass) THEN
    ALTER TABLE public.individual_users ADD CONSTRAINT individual_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
  END IF;
END $do$;


ALTER TABLE public.individual_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS individual_users_self ON public.individual_users;
CREATE POLICY individual_users_self ON public.individual_users AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));


-- ──────────────────────────────────────────────────────────
-- announcement_responses
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.announcement_responses (
  id bigint NOT NULL DEFAULT nextval('announcement_responses_id_seq'::regclass),
  announcement_id bigint,
  user_id uuid,
  response text NOT NULL,
  responded_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcement_responses_pkey' AND conrelid = 'public.announcement_responses'::regclass) THEN
    ALTER TABLE public.announcement_responses ADD CONSTRAINT announcement_responses_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcement_responses_announcement_id_user_id_key' AND conrelid = 'public.announcement_responses'::regclass) THEN
    ALTER TABLE public.announcement_responses ADD CONSTRAINT announcement_responses_announcement_id_user_id_key UNIQUE (announcement_id, user_id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcement_responses_announcement_id_fkey' AND conrelid = 'public.announcement_responses'::regclass) THEN
    ALTER TABLE public.announcement_responses ADD CONSTRAINT announcement_responses_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcement_responses_user_id_fkey' AND conrelid = 'public.announcement_responses'::regclass) THEN
    ALTER TABLE public.announcement_responses ADD CONSTRAINT announcement_responses_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_ann_responses_ann') THEN
    EXECUTE 'CREATE INDEX idx_ann_responses_ann ON public.announcement_responses USING btree (announcement_id)';
  END IF;
END $do$;

ALTER TABLE public.announcement_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own responses" ON public.announcement_responses;
CREATE POLICY "Users manage own responses" ON public.announcement_responses AS PERMISSIVE FOR ALL TO public
  USING ((user_id = auth.uid()));


-- ──────────────────────────────────────────────────────────
-- announcements
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.announcements (
  id bigint NOT NULL DEFAULT nextval('announcements_id_seq'::regclass),
  company_id uuid,
  sender_id uuid,
  title text NOT NULL,
  body text NOT NULL,
  type text DEFAULT 'general'::text,
  priority text DEFAULT 'normal'::text,
  target text DEFAULT 'all'::text,
  scheduled_at timestamp with time zone,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_pkey' AND conrelid = 'public.announcements'::regclass) THEN
    ALTER TABLE public.announcements ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_company_id_fkey' AND conrelid = 'public.announcements'::regclass) THEN
    ALTER TABLE public.announcements ADD CONSTRAINT announcements_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_sender_id_fkey' AND conrelid = 'public.announcements'::regclass) THEN
    ALTER TABLE public.announcements ADD CONSTRAINT announcements_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES profiles(id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_announcements_company') THEN
    EXECUTE 'CREATE INDEX idx_announcements_company ON public.announcements USING btree (company_id, created_at DESC)';
  END IF;
END $do$;

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin creates announcements" ON public.announcements;
CREATE POLICY "Admin creates announcements" ON public.announcements AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM company_employees ce
  WHERE ((ce.company_id = announcements.company_id) AND (ce.user_id = auth.uid()) AND (ce.employee_role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));
DROP POLICY IF EXISTS "Company members view announcements" ON public.announcements;
CREATE POLICY "Company members view announcements" ON public.announcements AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM company_employees ce
  WHERE ((ce.company_id = announcements.company_id) AND (ce.user_id = auth.uid())))));
DROP POLICY IF EXISTS announcements_own_company ON public.announcements;
CREATE POLICY announcements_own_company ON public.announcements AS PERMISSIVE FOR ALL TO public
  USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));


-- ──────────────────────────────────────────────────────────
-- audit_logs
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  user_id uuid,
  action text,
  resource text,
  details jsonb,
  ip_address text,
  created_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_pkey' AND conrelid = 'public.audit_logs'::regclass) THEN
    ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_company_id_fkey' AND conrelid = 'public.audit_logs'::regclass) THEN
    ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
  END IF;
END $do$;


ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_company_read ON public.audit_logs;
CREATE POLICY audit_logs_company_read ON public.audit_logs AS PERMISSIVE FOR SELECT TO authenticated
  USING (((company_id IS NULL) OR is_company_member(company_id)));
DROP POLICY IF EXISTS audit_logs_own_company ON public.audit_logs;
CREATE POLICY audit_logs_own_company ON public.audit_logs AS PERMISSIVE FOR ALL TO public
  USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));


-- ──────────────────────────────────────────────────────────
-- broadcasts
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.broadcasts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  sent_by bigint,
  title text,
  message text,
  priority text DEFAULT 'normal'::text,
  audience text DEFAULT 'all'::text,
  sent_at timestamp with time zone DEFAULT now(),
  read_count integer DEFAULT 0
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broadcasts_pkey' AND conrelid = 'public.broadcasts'::regclass) THEN
    ALTER TABLE public.broadcasts ADD CONSTRAINT broadcasts_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broadcasts_company_id_fkey' AND conrelid = 'public.broadcasts'::regclass) THEN
    ALTER TABLE public.broadcasts ADD CONSTRAINT broadcasts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broadcasts_sent_by_fkey' AND conrelid = 'public.broadcasts'::regclass) THEN
    ALTER TABLE public.broadcasts ADD CONSTRAINT broadcasts_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES company_employees(id);
  END IF;
END $do$;


ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS broadcasts_member_read ON public.broadcasts;
CREATE POLICY broadcasts_member_read ON public.broadcasts AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));
DROP POLICY IF EXISTS broadcasts_member_write ON public.broadcasts;
CREATE POLICY broadcasts_member_write ON public.broadcasts AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_member(company_id))
  WITH CHECK (is_company_member(company_id));
DROP POLICY IF EXISTS broadcasts_own_company ON public.broadcasts;
CREATE POLICY broadcasts_own_company ON public.broadcasts AS PERMISSIVE FOR ALL TO public
  USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));


-- ──────────────────────────────────────────────────────────
-- buddy_pairs
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.buddy_pairs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  employee_a bigint,
  employee_b bigint,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'buddy_pairs_pkey' AND conrelid = 'public.buddy_pairs'::regclass) THEN
    ALTER TABLE public.buddy_pairs ADD CONSTRAINT buddy_pairs_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'buddy_pairs_company_id_fkey' AND conrelid = 'public.buddy_pairs'::regclass) THEN
    ALTER TABLE public.buddy_pairs ADD CONSTRAINT buddy_pairs_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'buddy_pairs_employee_a_fkey' AND conrelid = 'public.buddy_pairs'::regclass) THEN
    ALTER TABLE public.buddy_pairs ADD CONSTRAINT buddy_pairs_employee_a_fkey FOREIGN KEY (employee_a) REFERENCES company_employees(id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'buddy_pairs_employee_b_fkey' AND conrelid = 'public.buddy_pairs'::regclass) THEN
    ALTER TABLE public.buddy_pairs ADD CONSTRAINT buddy_pairs_employee_b_fkey FOREIGN KEY (employee_b) REFERENCES company_employees(id);
  END IF;
END $do$;


ALTER TABLE public.buddy_pairs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS buddy_pairs_member_read ON public.buddy_pairs;
CREATE POLICY buddy_pairs_member_read ON public.buddy_pairs AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));
DROP POLICY IF EXISTS buddy_pairs_member_write ON public.buddy_pairs;
CREATE POLICY buddy_pairs_member_write ON public.buddy_pairs AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_member(company_id))
  WITH CHECK (is_company_member(company_id));


-- ──────────────────────────────────────────────────────────
-- call_chains
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.call_chains (
  id bigint NOT NULL DEFAULT nextval('call_chains_id_seq'::regclass),
  emergency_id bigint,
  user_id uuid,
  current_index integer DEFAULT 0,
  max_ring_seconds integer DEFAULT 15,
  status text DEFAULT 'active'::text,
  contacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  claimed_by uuid,
  claimed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_chains_pkey' AND conrelid = 'public.call_chains'::regclass) THEN
    ALTER TABLE public.call_chains ADD CONSTRAINT call_chains_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_chains_claimed_by_fkey' AND conrelid = 'public.call_chains'::regclass) THEN
    ALTER TABLE public.call_chains ADD CONSTRAINT call_chains_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES profiles(id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_chains_emergency_id_fkey' AND conrelid = 'public.call_chains'::regclass) THEN
    ALTER TABLE public.call_chains ADD CONSTRAINT call_chains_emergency_id_fkey FOREIGN KEY (emergency_id) REFERENCES emergencies(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_chains_user_id_fkey' AND conrelid = 'public.call_chains'::regclass) THEN
    ALTER TABLE public.call_chains ADD CONSTRAINT call_chains_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_call_chains_emergency') THEN
    EXECUTE 'CREATE INDEX idx_call_chains_emergency ON public.call_chains USING btree (emergency_id)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_call_chains_status') THEN
    EXECUTE 'CREATE INDEX idx_call_chains_status ON public.call_chains USING btree (status) WHERE (status = ''active''::text)';
  END IF;
END $do$;

ALTER TABLE public.call_chains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own chains" ON public.call_chains;
CREATE POLICY "Users view own chains" ON public.call_chains AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = auth.uid()));


-- ──────────────────────────────────────────────────────────
-- call_logs
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.call_logs (
  id bigint NOT NULL DEFAULT nextval('call_logs_id_seq'::regclass),
  emergency_id bigint,
  contact_id bigint,
  contact_phone text,
  status text DEFAULT 'pending'::text,
  started_at timestamp with time zone,
  answered_at timestamp with time zone,
  duration_seconds integer DEFAULT 0,
  twilio_sid text,
  created_at timestamp with time zone DEFAULT now(),
  chain_id bigint
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_logs_pkey' AND conrelid = 'public.call_logs'::regclass) THEN
    ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_logs_chain_id_fkey' AND conrelid = 'public.call_logs'::regclass) THEN
    ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_chain_id_fkey FOREIGN KEY (chain_id) REFERENCES call_chains(id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_logs_contact_id_fkey' AND conrelid = 'public.call_logs'::regclass) THEN
    ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES emergency_contacts(id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_logs_emergency_id_fkey' AND conrelid = 'public.call_logs'::regclass) THEN
    ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_emergency_id_fkey FOREIGN KEY (emergency_id) REFERENCES emergencies(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_call_logs_emergency') THEN
    EXECUTE 'CREATE INDEX idx_call_logs_emergency ON public.call_logs USING btree (emergency_id)';
  END IF;
END $do$;

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS call_logs_owner_read ON public.call_logs;
CREATE POLICY call_logs_owner_read ON public.call_logs AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM emergencies e
  WHERE ((e.id = call_logs.emergency_id) AND ((e.user_id = auth.uid()) OR ((e.company_id IS NOT NULL) AND is_company_member(e.company_id)))))));


-- ──────────────────────────────────────────────────────────
-- chat_messages
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id text NOT NULL,
  emergency_id text NOT NULL,
  sender text NOT NULL,
  sender_name text NOT NULL DEFAULT 'Unknown'::text,
  message text NOT NULL,
  is_preset boolean DEFAULT false,
  msg_type text DEFAULT 'text'::text,
  sent_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  server_sender_uid uuid,
  signature text
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_pkey' AND conrelid = 'public.chat_messages'::regclass) THEN
    ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_msg_type_check' AND conrelid = 'public.chat_messages'::regclass) THEN
    ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_msg_type_check CHECK ((msg_type = ANY (ARRAY['text'::text, 'location'::text, 'status'::text, 'audio'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_sender_check' AND conrelid = 'public.chat_messages'::regclass) THEN
    ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_sender_check CHECK ((sender = ANY (ARRAY['employee'::text, 'admin'::text])));
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_chat_emergency') THEN
    EXECUTE 'CREATE INDEX idx_chat_emergency ON public.chat_messages USING btree (emergency_id)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_chat_sent_at') THEN
    EXECUTE 'CREATE INDEX idx_chat_sent_at ON public.chat_messages USING btree (sent_at)';
  END IF;
END $do$;

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_messages_emergency_read ON public.chat_messages;
CREATE POLICY chat_messages_emergency_read ON public.chat_messages AS PERMISSIVE FOR SELECT TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM sos_queue q
  WHERE ((q.emergency_id = chat_messages.emergency_id) AND is_company_member(q.company_id)))) OR (EXISTS ( SELECT 1
   FROM sos_sessions s
  WHERE (((s.id)::text = chat_messages.emergency_id) AND ((s.user_id = auth.uid()) OR ((s.company_id IS NOT NULL) AND is_company_member(s.company_id))))))));
DROP POLICY IF EXISTS chat_messages_emergency_write ON public.chat_messages;
CREATE POLICY chat_messages_emergency_write ON public.chat_messages AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((EXISTS ( SELECT 1
   FROM sos_queue q
  WHERE ((q.emergency_id = chat_messages.emergency_id) AND is_company_member(q.company_id)))) OR (EXISTS ( SELECT 1
   FROM sos_sessions s
  WHERE (((s.id)::text = chat_messages.emergency_id) AND ((s.user_id = auth.uid()) OR ((s.company_id IS NOT NULL) AND is_company_member(s.company_id))))))));

COMMENT ON COLUMN public.chat_messages.server_sender_uid IS 'A-12 (2026-04-27): the auth.uid() that actually inserted this row. Server-stamped, never client-supplied.';
COMMENT ON COLUMN public.chat_messages.signature IS 'A-12 (2026-04-27): SHA-256 over canonical tuple (id|emergency_id|server_sender_uid|message|sent_at). Receivers recompute and verify before trusting sender_name. Tampering invalidates.';

-- ──────────────────────────────────────────────────────────
-- checkin_events
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.checkin_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id text NOT NULL,
  employee_name text,
  zone text,
  event_type text NOT NULL,
  duration_min integer,
  remaining_sec integer,
  created_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkin_events_pkey' AND conrelid = 'public.checkin_events'::regclass) THEN
    ALTER TABLE public.checkin_events ADD CONSTRAINT checkin_events_pkey PRIMARY KEY (id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_checkin_date') THEN
    EXECUTE 'CREATE INDEX idx_checkin_date ON public.checkin_events USING btree (created_at DESC)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_checkin_employee') THEN
    EXECUTE 'CREATE INDEX idx_checkin_employee ON public.checkin_events USING btree (employee_id)';
  END IF;
END $do$;

ALTER TABLE public.checkin_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS checkin_events_self_read ON public.checkin_events;
CREATE POLICY checkin_events_self_read ON public.checkin_events AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE (((e.id)::text = checkin_events.employee_id) AND ((e.user_id = auth.uid()) OR is_company_member(e.company_id))))));
DROP POLICY IF EXISTS checkin_events_self_write ON public.checkin_events;
CREATE POLICY checkin_events_self_write ON public.checkin_events AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE (((e.id)::text = checkin_events.employee_id) AND (e.user_id = auth.uid())))));


-- ──────────────────────────────────────────────────────────
-- checkins
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.checkins (
  id text NOT NULL,
  company_id uuid,
  employee_id uuid,
  employee_name text NOT NULL,
  zone text,
  type text DEFAULT 'manual'::text,
  status text DEFAULT 'ok'::text,
  lat double precision,
  lng double precision,
  recorded_at timestamp with time zone NOT NULL,
  synced_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkins_pkey' AND conrelid = 'public.checkins'::regclass) THEN
    ALTER TABLE public.checkins ADD CONSTRAINT checkins_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkins_company_id_fkey' AND conrelid = 'public.checkins'::regclass) THEN
    ALTER TABLE public.checkins ADD CONSTRAINT checkins_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkins_employee_id_fkey' AND conrelid = 'public.checkins'::regclass) THEN
    ALTER TABLE public.checkins ADD CONSTRAINT checkins_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
  END IF;
END $do$;


ALTER TABLE public.checkins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS checkins_company_read ON public.checkins;
CREATE POLICY checkins_company_read ON public.checkins AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));
DROP POLICY IF EXISTS checkins_company_write ON public.checkins;
CREATE POLICY checkins_company_write ON public.checkins AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_member(company_id))
  WITH CHECK (is_company_member(company_id));
DROP POLICY IF EXISTS checkins_own_company ON public.checkins;
CREATE POLICY checkins_own_company ON public.checkins AS PERMISSIVE FOR ALL TO public
  USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));


-- ──────────────────────────────────────────────────────────
-- commands
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.commands (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  title text NOT NULL,
  title_ar text,
  type text DEFAULT 'announcement'::text,
  description text,
  description_ar text,
  date_time timestamp with time zone,
  issued_by text,
  status text DEFAULT 'active'::text,
  location text,
  survey_options jsonb,
  expires_at timestamp with time zone,
  confirmed_count integer DEFAULT 0,
  declined_count integer DEFAULT 0,
  no_response_count integer DEFAULT 0,
  total_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commands_pkey' AND conrelid = 'public.commands'::regclass) THEN
    ALTER TABLE public.commands ADD CONSTRAINT commands_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commands_company_id_fkey' AND conrelid = 'public.commands'::regclass) THEN
    ALTER TABLE public.commands ADD CONSTRAINT commands_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $do$;


ALTER TABLE public.commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commands_member_read ON public.commands;
CREATE POLICY commands_member_read ON public.commands AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));
DROP POLICY IF EXISTS commands_member_write ON public.commands;
CREATE POLICY commands_member_write ON public.commands AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_member(company_id))
  WITH CHECK (is_company_member(company_id));


-- ──────────────────────────────────────────────────────────
-- company_checkin_sessions
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_checkin_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  qr_token text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  is_active boolean DEFAULT true
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_checkin_sessions_pkey' AND conrelid = 'public.company_checkin_sessions'::regclass) THEN
    ALTER TABLE public.company_checkin_sessions ADD CONSTRAINT company_checkin_sessions_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_checkin_sessions_qr_token_key' AND conrelid = 'public.company_checkin_sessions'::regclass) THEN
    ALTER TABLE public.company_checkin_sessions ADD CONSTRAINT company_checkin_sessions_qr_token_key UNIQUE (qr_token);
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_checkin_token') THEN
    EXECUTE 'CREATE INDEX idx_checkin_token ON public.company_checkin_sessions USING btree (qr_token)';
  END IF;
END $do$;

ALTER TABLE public.company_checkin_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS checkin_sessions_member_read ON public.company_checkin_sessions;
CREATE POLICY checkin_sessions_member_read ON public.company_checkin_sessions AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member((company_id)::uuid));
DROP POLICY IF EXISTS checkin_sessions_member_write ON public.company_checkin_sessions;
CREATE POLICY checkin_sessions_member_write ON public.company_checkin_sessions AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_member((company_id)::uuid))
  WITH CHECK (is_company_member((company_id)::uuid));


-- ──────────────────────────────────────────────────────────
-- company_message_recipients
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_message_recipients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  delivered_in_app boolean NOT NULL DEFAULT false,
  delivered_email boolean NOT NULL DEFAULT false,
  delivered_whatsapp boolean NOT NULL DEFAULT false,
  delivered_at timestamp with time zone
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_message_recipients_pkey' AND conrelid = 'public.company_message_recipients'::regclass) THEN
    ALTER TABLE public.company_message_recipients ADD CONSTRAINT company_message_recipients_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_message_recipients_message_id_employee_id_key' AND conrelid = 'public.company_message_recipients'::regclass) THEN
    ALTER TABLE public.company_message_recipients ADD CONSTRAINT company_message_recipients_message_id_employee_id_key UNIQUE (message_id, employee_id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_message_recipients_employee_id_fkey' AND conrelid = 'public.company_message_recipients'::regclass) THEN
    ALTER TABLE public.company_message_recipients ADD CONSTRAINT company_message_recipients_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_message_recipients_message_id_fkey' AND conrelid = 'public.company_message_recipients'::regclass) THEN
    ALTER TABLE public.company_message_recipients ADD CONSTRAINT company_message_recipients_message_id_fkey FOREIGN KEY (message_id) REFERENCES company_messages(id) ON DELETE CASCADE;
  END IF;
END $do$;


ALTER TABLE public.company_message_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cmr_recipient_or_company_read ON public.company_message_recipients;
CREATE POLICY cmr_recipient_or_company_read ON public.company_message_recipients AS PERMISSIVE FOR SELECT TO public
  USING (((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = company_message_recipients.employee_id) AND (e.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM company_messages m
  WHERE ((m.id = company_message_recipients.message_id) AND is_company_member(m.company_id))))));
DROP POLICY IF EXISTS recipients_self_read ON public.company_message_recipients;
CREATE POLICY recipients_self_read ON public.company_message_recipients AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = company_message_recipients.employee_id) AND ((e.user_id = auth.uid()) OR is_company_member(e.company_id))))));


-- ──────────────────────────────────────────────────────────
-- company_message_rsvps
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_message_rsvps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  response text NOT NULL,
  note text,
  responded_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_message_rsvps_pkey' AND conrelid = 'public.company_message_rsvps'::regclass) THEN
    ALTER TABLE public.company_message_rsvps ADD CONSTRAINT company_message_rsvps_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_message_rsvps_message_id_employee_id_key' AND conrelid = 'public.company_message_rsvps'::regclass) THEN
    ALTER TABLE public.company_message_rsvps ADD CONSTRAINT company_message_rsvps_message_id_employee_id_key UNIQUE (message_id, employee_id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_message_rsvps_response_check' AND conrelid = 'public.company_message_rsvps'::regclass) THEN
    ALTER TABLE public.company_message_rsvps ADD CONSTRAINT company_message_rsvps_response_check CHECK ((response = ANY (ARRAY['yes'::text, 'no'::text, 'excused'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_message_rsvps_employee_id_fkey' AND conrelid = 'public.company_message_rsvps'::regclass) THEN
    ALTER TABLE public.company_message_rsvps ADD CONSTRAINT company_message_rsvps_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_message_rsvps_message_id_fkey' AND conrelid = 'public.company_message_rsvps'::regclass) THEN
    ALTER TABLE public.company_message_rsvps ADD CONSTRAINT company_message_rsvps_message_id_fkey FOREIGN KEY (message_id) REFERENCES company_messages(id) ON DELETE CASCADE;
  END IF;
END $do$;


ALTER TABLE public.company_message_rsvps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cmr_rsvps_recipient_or_company_read ON public.company_message_rsvps;
CREATE POLICY cmr_rsvps_recipient_or_company_read ON public.company_message_rsvps AS PERMISSIVE FOR SELECT TO public
  USING (((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = company_message_rsvps.employee_id) AND (e.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM company_messages m
  WHERE ((m.id = company_message_rsvps.message_id) AND is_company_member(m.company_id))))));
DROP POLICY IF EXISTS cmr_rsvps_recipient_update ON public.company_message_rsvps;
CREATE POLICY cmr_rsvps_recipient_update ON public.company_message_rsvps AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = company_message_rsvps.employee_id) AND (e.user_id = auth.uid())))));
DROP POLICY IF EXISTS cmr_rsvps_recipient_write ON public.company_message_rsvps;
CREATE POLICY cmr_rsvps_recipient_write ON public.company_message_rsvps AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = company_message_rsvps.employee_id) AND (e.user_id = auth.uid())))));
DROP POLICY IF EXISTS rsvps_self ON public.company_message_rsvps;
CREATE POLICY rsvps_self ON public.company_message_rsvps AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = company_message_rsvps.employee_id) AND (e.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = company_message_rsvps.employee_id) AND (e.user_id = auth.uid())))));


-- ──────────────────────────────────────────────────────────
-- company_messages
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  created_by_employee_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'announcement'::text,
  title text NOT NULL,
  body text NOT NULL,
  requires_rsvp boolean NOT NULL DEFAULT false,
  rsvp_deadline timestamp with time zone,
  send_channels jsonb NOT NULL DEFAULT '["in_app"]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_messages_pkey' AND conrelid = 'public.company_messages'::regclass) THEN
    ALTER TABLE public.company_messages ADD CONSTRAINT company_messages_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_messages_kind_check' AND conrelid = 'public.company_messages'::regclass) THEN
    ALTER TABLE public.company_messages ADD CONSTRAINT company_messages_kind_check CHECK ((kind = ANY (ARRAY['announcement'::text, 'meeting'::text, 'task_update'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_messages_company_id_fkey' AND conrelid = 'public.company_messages'::regclass) THEN
    ALTER TABLE public.company_messages ADD CONSTRAINT company_messages_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_messages_created_by_employee_id_fkey' AND conrelid = 'public.company_messages'::regclass) THEN
    ALTER TABLE public.company_messages ADD CONSTRAINT company_messages_created_by_employee_id_fkey FOREIGN KEY (created_by_employee_id) REFERENCES employees(id) ON DELETE CASCADE;
  END IF;
END $do$;


ALTER TABLE public.company_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_messages_member_read ON public.company_messages;
CREATE POLICY company_messages_member_read ON public.company_messages AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));
DROP POLICY IF EXISTS company_messages_member_write ON public.company_messages;
CREATE POLICY company_messages_member_write ON public.company_messages AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_member(company_id))
  WITH CHECK (is_company_member(company_id));


-- ──────────────────────────────────────────────────────────
-- company_working_hours
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_working_hours (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  day_of_week integer NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_working_hours_pkey' AND conrelid = 'public.company_working_hours'::regclass) THEN
    ALTER TABLE public.company_working_hours ADD CONSTRAINT company_working_hours_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_working_hours_day_of_week_check' AND conrelid = 'public.company_working_hours'::regclass) THEN
    ALTER TABLE public.company_working_hours ADD CONSTRAINT company_working_hours_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_working_hours_company_id_fkey' AND conrelid = 'public.company_working_hours'::regclass) THEN
    ALTER TABLE public.company_working_hours ADD CONSTRAINT company_working_hours_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $do$;


ALTER TABLE public.company_working_hours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS working_hours_member_read ON public.company_working_hours;
CREATE POLICY working_hours_member_read ON public.company_working_hours AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));
DROP POLICY IF EXISTS working_hours_owner_write ON public.company_working_hours;
CREATE POLICY working_hours_owner_write ON public.company_working_hours AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_owner(company_id))
  WITH CHECK (is_company_owner(company_id));


-- ──────────────────────────────────────────────────────────
-- contacts
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  employee_id uuid NOT NULL,
  name text NOT NULL,
  phone text NOT NULL,
  relation text,
  priority integer DEFAULT 1,
  contact_type text NOT NULL DEFAULT 'full'::text,
  has_app boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_pkey' AND conrelid = 'public.contacts'::regclass) THEN
    ALTER TABLE public.contacts ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);
  END IF;
END $do$;


ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contacts_self ON public.contacts;
CREATE POLICY contacts_self ON public.contacts AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = contacts.employee_id) AND (e.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = contacts.employee_id) AND (e.user_id = auth.uid())))));


-- ──────────────────────────────────────────────────────────
-- direct_messages
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.direct_messages (
  id bigint NOT NULL DEFAULT nextval('direct_messages_id_seq'::regclass),
  company_id uuid,
  sender_id uuid,
  receiver_id uuid,
  message text NOT NULL,
  is_read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'direct_messages_pkey' AND conrelid = 'public.direct_messages'::regclass) THEN
    ALTER TABLE public.direct_messages ADD CONSTRAINT direct_messages_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'direct_messages_company_id_fkey' AND conrelid = 'public.direct_messages'::regclass) THEN
    ALTER TABLE public.direct_messages ADD CONSTRAINT direct_messages_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'direct_messages_receiver_id_fkey' AND conrelid = 'public.direct_messages'::regclass) THEN
    ALTER TABLE public.direct_messages ADD CONSTRAINT direct_messages_receiver_id_fkey FOREIGN KEY (receiver_id) REFERENCES profiles(id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'direct_messages_sender_id_fkey' AND conrelid = 'public.direct_messages'::regclass) THEN
    ALTER TABLE public.direct_messages ADD CONSTRAINT direct_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES profiles(id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_dm_receiver') THEN
    EXECUTE 'CREATE INDEX idx_dm_receiver ON public.direct_messages USING btree (receiver_id, is_read)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_dm_sender') THEN
    EXECUTE 'CREATE INDEX idx_dm_sender ON public.direct_messages USING btree (sender_id, created_at DESC)';
  END IF;
END $do$;

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Chat participants only" ON public.direct_messages;
CREATE POLICY "Chat participants only" ON public.direct_messages AS PERMISSIVE FOR SELECT TO public
  USING (((sender_id = auth.uid()) OR (receiver_id = auth.uid())));
DROP POLICY IF EXISTS "Receiver marks as read" ON public.direct_messages;
CREATE POLICY "Receiver marks as read" ON public.direct_messages AS PERMISSIVE FOR UPDATE TO public
  USING ((receiver_id = auth.uid()));
DROP POLICY IF EXISTS "Users send messages" ON public.direct_messages;
CREATE POLICY "Users send messages" ON public.direct_messages AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((sender_id = auth.uid()));


-- ──────────────────────────────────────────────────────────
-- duty_status
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.duty_status (
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'off_duty'::text,
  updated_at timestamp with time zone DEFAULT now(),
  workspace_id uuid NOT NULL
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'duty_status_pkey' AND conrelid = 'public.duty_status'::regclass) THEN
    ALTER TABLE public.duty_status ADD CONSTRAINT duty_status_pkey PRIMARY KEY (user_id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'duty_status_status_check' AND conrelid = 'public.duty_status'::regclass) THEN
    ALTER TABLE public.duty_status ADD CONSTRAINT duty_status_status_check CHECK ((status = ANY (ARRAY['on_duty'::text, 'off_duty'::text, 'busy'::text, 'leave'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'duty_status_user_id_fkey' AND conrelid = 'public.duty_status'::regclass) THEN
    ALTER TABLE public.duty_status ADD CONSTRAINT duty_status_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'duty_status_workspace_fk' AND conrelid = 'public.duty_status'::regclass) THEN
    ALTER TABLE public.duty_status ADD CONSTRAINT duty_status_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'duty_status_workspace_id_fkey' AND conrelid = 'public.duty_status'::regclass) THEN
    ALTER TABLE public.duty_status ADD CONSTRAINT duty_status_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='duty_status_unique_user_workspace') THEN
    EXECUTE 'CREATE UNIQUE INDEX duty_status_unique_user_workspace ON public.duty_status USING btree (workspace_id, user_id)';
  END IF;
END $do$;

ALTER TABLE public.duty_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can insert their own duty status" ON public.duty_status;
CREATE POLICY "Users can insert their own duty status" ON public.duty_status AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((user_id = auth.uid()));
DROP POLICY IF EXISTS "Users can read their own duty status" ON public.duty_status;
CREATE POLICY "Users can read their own duty status" ON public.duty_status AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = auth.uid()));
DROP POLICY IF EXISTS "Users can update their own duty status" ON public.duty_status;
CREATE POLICY "Users can update their own duty status" ON public.duty_status AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
DROP POLICY IF EXISTS admin_can_update_company_duty_status ON public.duty_status;
CREATE POLICY admin_can_update_company_duty_status ON public.duty_status AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text) AND (p.company_id = ( SELECT profiles.company_id
           FROM profiles
          WHERE (profiles.id = duty_status.user_id)))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text) AND (p.company_id = ( SELECT profiles.company_id
           FROM profiles
          WHERE (profiles.id = duty_status.user_id)))))));
DROP POLICY IF EXISTS admin_can_view_company_duty_status ON public.duty_status;
CREATE POLICY admin_can_view_company_duty_status ON public.duty_status AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text) AND (p.company_id = ( SELECT profiles.company_id
           FROM profiles
          WHERE (profiles.id = duty_status.user_id)))))));
DROP POLICY IF EXISTS duty_status_own ON public.duty_status;
CREATE POLICY duty_status_own ON public.duty_status AS PERMISSIVE FOR ALL TO public
  USING ((user_id = auth.uid()));
DROP POLICY IF EXISTS duty_status_select_own ON public.duty_status;
CREATE POLICY duty_status_select_own ON public.duty_status AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));
DROP POLICY IF EXISTS duty_status_update_own ON public.duty_status;
CREATE POLICY duty_status_update_own ON public.duty_status AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
DROP POLICY IF EXISTS members_can_read_duty_status ON public.duty_status;
CREATE POLICY members_can_read_duty_status ON public.duty_status AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));
DROP POLICY IF EXISTS user_can_insert_own_duty_status ON public.duty_status;
CREATE POLICY user_can_insert_own_duty_status ON public.duty_status AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((user_id = auth.uid()) AND is_workspace_member(workspace_id)));
DROP POLICY IF EXISTS user_can_update_own_duty_status ON public.duty_status;
CREATE POLICY user_can_update_own_duty_status ON public.duty_status AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((user_id = auth.uid()) AND is_workspace_member(workspace_id)))
  WITH CHECK (((user_id = auth.uid()) AND is_workspace_member(workspace_id)));
DROP POLICY IF EXISTS "users can upsert their duty status" ON public.duty_status;
CREATE POLICY "users can upsert their duty status" ON public.duty_status AS PERMISSIVE FOR ALL TO authenticated
  USING (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.user_id = auth.uid()) AND (wm.workspace_id = duty_status.workspace_id))))))
  WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.user_id = auth.uid()) AND (wm.workspace_id = duty_status.workspace_id))))));


-- ──────────────────────────────────────────────────────────
-- emergencies
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.emergencies (
  id bigint NOT NULL DEFAULT nextval('emergencies_id_seq'::regclass),
  user_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  note text,
  lat double precision,
  lon double precision,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  resolved_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now(),
  archived boolean DEFAULT false,
  status text DEFAULT 'active'::text,
  response_time_seconds integer,
  contacts_notified integer DEFAULT 0,
  sms_sent boolean DEFAULT false,
  voice_called boolean DEFAULT false,
  company_id uuid,
  employee_id uuid,
  employee_name text DEFAULT ''::text,
  zone text DEFAULT ''::text,
  type text DEFAULT 'SOS Button'::text,
  severity text DEFAULT 'high'::text,
  trigger_method text DEFAULT 'manual'::text,
  lng double precision,
  accuracy double precision,
  elapsed integer DEFAULT 0,
  is_owned boolean DEFAULT false,
  owned_by text,
  owned_at timestamp with time zone,
  manual_priority integer,
  manual_priority_reason text,
  manual_priority_by text,
  manual_priority_at timestamp with time zone,
  resolved_by text
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergencies_pkey' AND conrelid = 'public.emergencies'::regclass) THEN
    ALTER TABLE public.emergencies ADD CONSTRAINT emergencies_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_lat_range' AND conrelid = 'public.emergencies'::regclass) THEN
    ALTER TABLE public.emergencies ADD CONSTRAINT chk_lat_range CHECK (((lat >= ('-90'::integer)::double precision) AND (lat <= (90)::double precision)));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_lon_range' AND conrelid = 'public.emergencies'::regclass) THEN
    ALTER TABLE public.emergencies ADD CONSTRAINT chk_lon_range CHECK (((lon >= ('-180'::integer)::double precision) AND (lon <= (180)::double precision)));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergencies_status_check' AND conrelid = 'public.emergencies'::regclass) THEN
    ALTER TABLE public.emergencies ADD CONSTRAINT emergencies_status_check CHECK ((status = ANY (ARRAY['active'::text, 'resolved'::text, 'cancelled'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergencies_user_id_fkey' AND conrelid = 'public.emergencies'::regclass) THEN
    ALTER TABLE public.emergencies ADD CONSTRAINT emergencies_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_emergencies_active') THEN
    EXECUTE 'CREATE INDEX idx_emergencies_active ON public.emergencies USING btree (is_active) WHERE (is_active = true)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_emergencies_archived') THEN
    EXECUTE 'CREATE INDEX idx_emergencies_archived ON public.emergencies USING btree (archived) WHERE (archived = false)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_emergencies_company') THEN
    EXECUTE 'CREATE INDEX idx_emergencies_company ON public.emergencies USING btree (company_id)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_emergencies_created') THEN
    EXECUTE 'CREATE INDEX idx_emergencies_created ON public.emergencies USING btree (created_at DESC)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_emergencies_status') THEN
    EXECUTE 'CREATE INDEX idx_emergencies_status ON public.emergencies USING btree (status)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_emergencies_user_id') THEN
    EXECUTE 'CREATE INDEX idx_emergencies_user_id ON public.emergencies USING btree (user_id)';
  END IF;
END $do$;

ALTER TABLE public.emergencies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS emergencies_all ON public.emergencies;
CREATE POLICY emergencies_all ON public.emergencies AS PERMISSIVE FOR ALL TO public
  USING ((company_id IN ( SELECT companies.id
   FROM companies
  WHERE (companies.owner_id = auth.uid()))));
DROP POLICY IF EXISTS emergencies_own ON public.emergencies;
CREATE POLICY emergencies_own ON public.emergencies AS PERMISSIVE FOR ALL TO public
  USING ((user_id = auth.uid()));
DROP POLICY IF EXISTS emergencies_owner_or_company_read ON public.emergencies;
CREATE POLICY emergencies_owner_or_company_read ON public.emergencies AS PERMISSIVE FOR SELECT TO public
  USING (((user_id = auth.uid()) OR ((company_id IS NOT NULL) AND is_company_member(company_id))));
DROP POLICY IF EXISTS emergencies_owner_write ON public.emergencies;
CREATE POLICY emergencies_owner_write ON public.emergencies AS PERMISSIVE FOR ALL TO public
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));


-- ──────────────────────────────────────────────────────────
-- emergency_call_attempts
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.emergency_call_attempts (
  id bigint NOT NULL DEFAULT nextval('emergency_call_attempts_id_seq'::regclass),
  emergency_id bigint NOT NULL,
  target_type text NOT NULL,
  target_ref text NOT NULL,
  phone text,
  attempt_no integer NOT NULL,
  status text NOT NULL DEFAULT 'queued'::text,
  twilio_call_sid text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_call_attempts_pkey' AND conrelid = 'public.emergency_call_attempts'::regclass) THEN
    ALTER TABLE public.emergency_call_attempts ADD CONSTRAINT emergency_call_attempts_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_call_attempts_status_check' AND conrelid = 'public.emergency_call_attempts'::regclass) THEN
    ALTER TABLE public.emergency_call_attempts ADD CONSTRAINT emergency_call_attempts_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'ringing'::text, 'answered'::text, 'no_answer'::text, 'failed'::text, 'completed'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_call_attempts_target_type_check' AND conrelid = 'public.emergency_call_attempts'::regclass) THEN
    ALTER TABLE public.emergency_call_attempts ADD CONSTRAINT emergency_call_attempts_target_type_check CHECK ((target_type = ANY (ARRAY['admin'::text, 'contact'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_call_attempts_emergency_id_fkey' AND conrelid = 'public.emergency_call_attempts'::regclass) THEN
    ALTER TABLE public.emergency_call_attempts ADD CONSTRAINT emergency_call_attempts_emergency_id_fkey FOREIGN KEY (emergency_id) REFERENCES emergencies(id) ON DELETE CASCADE;
  END IF;
END $do$;


ALTER TABLE public.emergency_call_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS call_attempts_owner_read ON public.emergency_call_attempts;
CREATE POLICY call_attempts_owner_read ON public.emergency_call_attempts AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM emergencies e
  WHERE ((e.id = emergency_call_attempts.emergency_id) AND ((e.user_id = auth.uid()) OR ((e.company_id IS NOT NULL) AND is_company_member(e.company_id)))))));


-- ──────────────────────────────────────────────────────────
-- emergency_claims
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.emergency_claims (
  id bigint NOT NULL DEFAULT nextval('emergency_claims_id_seq'::regclass),
  emergency_id bigint NOT NULL,
  claimed_by_employee_id uuid,
  claimed_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_claims_pkey' AND conrelid = 'public.emergency_claims'::regclass) THEN
    ALTER TABLE public.emergency_claims ADD CONSTRAINT emergency_claims_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_claims_emergency_id_key' AND conrelid = 'public.emergency_claims'::regclass) THEN
    ALTER TABLE public.emergency_claims ADD CONSTRAINT emergency_claims_emergency_id_key UNIQUE (emergency_id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_claims_claimed_by_employee_id_fkey' AND conrelid = 'public.emergency_claims'::regclass) THEN
    ALTER TABLE public.emergency_claims ADD CONSTRAINT emergency_claims_claimed_by_employee_id_fkey FOREIGN KEY (claimed_by_employee_id) REFERENCES employees(id) ON DELETE SET NULL;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_claims_emergency_id_fkey' AND conrelid = 'public.emergency_claims'::regclass) THEN
    ALTER TABLE public.emergency_claims ADD CONSTRAINT emergency_claims_emergency_id_fkey FOREIGN KEY (emergency_id) REFERENCES emergencies(id) ON DELETE CASCADE;
  END IF;
END $do$;


ALTER TABLE public.emergency_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS claims_owner_read ON public.emergency_claims;
CREATE POLICY claims_owner_read ON public.emergency_claims AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM emergencies e
  WHERE ((e.id = emergency_claims.emergency_id) AND ((e.user_id = auth.uid()) OR ((e.company_id IS NOT NULL) AND is_company_member(e.company_id)))))));


-- ──────────────────────────────────────────────────────────
-- emergency_contacts
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.emergency_contacts (
  id bigint NOT NULL DEFAULT nextval('emergency_contacts_id_seq'::regclass),
  user_id uuid NOT NULL,
  name text NOT NULL,
  phone text NOT NULL,
  relation text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  priority integer DEFAULT 1,
  is_active boolean DEFAULT true
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_contacts_pkey' AND conrelid = 'public.emergency_contacts'::regclass) THEN
    ALTER TABLE public.emergency_contacts ADD CONSTRAINT emergency_contacts_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_contacts_user_id_fkey' AND conrelid = 'public.emergency_contacts'::regclass) THEN
    ALTER TABLE public.emergency_contacts ADD CONSTRAINT emergency_contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_emergency_contacts_user') THEN
    EXECUTE 'CREATE INDEX idx_emergency_contacts_user ON public.emergency_contacts USING btree (user_id)';
  END IF;
END $do$;

ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contacts_crud_own ON public.emergency_contacts;
CREATE POLICY contacts_crud_own ON public.emergency_contacts AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));


-- ──────────────────────────────────────────────────────────
-- emergency_locations
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.emergency_locations (
  id bigint NOT NULL DEFAULT nextval('emergency_locations_id_seq'::regclass),
  emergency_id bigint NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy_m integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_locations_pkey' AND conrelid = 'public.emergency_locations'::regclass) THEN
    ALTER TABLE public.emergency_locations ADD CONSTRAINT emergency_locations_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_locations_emergency_id_fkey' AND conrelid = 'public.emergency_locations'::regclass) THEN
    ALTER TABLE public.emergency_locations ADD CONSTRAINT emergency_locations_emergency_id_fkey FOREIGN KEY (emergency_id) REFERENCES emergencies(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_emergency_locations_eid') THEN
    EXECUTE 'CREATE INDEX idx_emergency_locations_eid ON public.emergency_locations USING btree (emergency_id)';
  END IF;
END $do$;

ALTER TABLE public.emergency_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own locations" ON public.emergency_locations;
CREATE POLICY "Users view own locations" ON public.emergency_locations AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM emergencies e
  WHERE ((e.id = emergency_locations.emergency_id) AND (e.user_id = auth.uid())))));


-- ──────────────────────────────────────────────────────────
-- emergency_logs
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.emergency_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  emergency_id bigint,
  action text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_logs_pkey' AND conrelid = 'public.emergency_logs'::regclass) THEN
    ALTER TABLE public.emergency_logs ADD CONSTRAINT emergency_logs_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_logs_emergency_id_fkey' AND conrelid = 'public.emergency_logs'::regclass) THEN
    ALTER TABLE public.emergency_logs ADD CONSTRAINT emergency_logs_emergency_id_fkey FOREIGN KEY (emergency_id) REFERENCES emergencies(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_emergency_logs_emg') THEN
    EXECUTE 'CREATE INDEX idx_emergency_logs_emg ON public.emergency_logs USING btree (emergency_id)';
  END IF;
END $do$;

ALTER TABLE public.emergency_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own emergency logs" ON public.emergency_logs;
CREATE POLICY "Users read own emergency logs" ON public.emergency_logs AS PERMISSIVE FOR SELECT TO public
  USING ((emergency_id IN ( SELECT emergencies.id
   FROM emergencies
  WHERE (emergencies.user_id = auth.uid()))));
DROP POLICY IF EXISTS emergency_logs_owner_read ON public.emergency_logs;
CREATE POLICY emergency_logs_owner_read ON public.emergency_logs AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM emergencies e
  WHERE ((e.id = emergency_logs.emergency_id) AND ((e.user_id = auth.uid()) OR ((e.company_id IS NOT NULL) AND is_company_member(e.company_id)))))));


-- ──────────────────────────────────────────────────────────
-- emergency_recipients
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.emergency_recipients (
  id bigint NOT NULL,
  emergency_id bigint NOT NULL,
  recipient_user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_recipients_pkey' AND conrelid = 'public.emergency_recipients'::regclass) THEN
    ALTER TABLE public.emergency_recipients ADD CONSTRAINT emergency_recipients_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_recipients_emergency_id_fkey' AND conrelid = 'public.emergency_recipients'::regclass) THEN
    ALTER TABLE public.emergency_recipients ADD CONSTRAINT emergency_recipients_emergency_id_fkey FOREIGN KEY (emergency_id) REFERENCES emergencies(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_recipients_recipient_user_id_fkey' AND conrelid = 'public.emergency_recipients'::regclass) THEN
    ALTER TABLE public.emergency_recipients ADD CONSTRAINT emergency_recipients_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $do$;


ALTER TABLE public.emergency_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recipients delete by owner" ON public.emergency_recipients;
CREATE POLICY "recipients delete by owner" ON public.emergency_recipients AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM emergencies e
  WHERE ((e.id = emergency_recipients.emergency_id) AND (e.user_id = auth.uid())))));
DROP POLICY IF EXISTS "recipients insert by owner" ON public.emergency_recipients;
CREATE POLICY "recipients insert by owner" ON public.emergency_recipients AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM emergencies e
  WHERE ((e.id = emergency_recipients.emergency_id) AND (e.user_id = auth.uid())))));
DROP POLICY IF EXISTS "recipients select owner or self" ON public.emergency_recipients;
CREATE POLICY "recipients select owner or self" ON public.emergency_recipients AS PERMISSIVE FOR SELECT TO authenticated
  USING (((recipient_user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM emergencies e
  WHERE ((e.id = emergency_recipients.emergency_id) AND (e.user_id = auth.uid()))))));
DROP POLICY IF EXISTS recipients_delete ON public.emergency_recipients;
CREATE POLICY recipients_delete ON public.emergency_recipients AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM emergencies e
  WHERE ((e.id = emergency_recipients.emergency_id) AND (e.user_id = auth.uid())))));
DROP POLICY IF EXISTS recipients_insert ON public.emergency_recipients;
CREATE POLICY recipients_insert ON public.emergency_recipients AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM emergencies e
  WHERE ((e.id = emergency_recipients.emergency_id) AND (e.user_id = auth.uid())))));
DROP POLICY IF EXISTS recipients_select ON public.emergency_recipients;
CREATE POLICY recipients_select ON public.emergency_recipients AS PERMISSIVE FOR SELECT TO authenticated
  USING (((recipient_user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM emergencies e
  WHERE ((e.id = emergency_recipients.emergency_id) AND (e.user_id = auth.uid()))))));


-- ──────────────────────────────────────────────────────────
-- employee_checkins
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_checkins (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  user_id uuid,
  qr_token text NOT NULL,
  checked_at timestamp with time zone NOT NULL DEFAULT now(),
  device_info text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_checkins_pkey' AND conrelid = 'public.employee_checkins'::regclass) THEN
    ALTER TABLE public.employee_checkins ADD CONSTRAINT employee_checkins_pkey PRIMARY KEY (id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_employee_checkins_checked_at') THEN
    EXECUTE 'CREATE INDEX idx_employee_checkins_checked_at ON public.employee_checkins USING btree (checked_at DESC)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_employee_checkins_company_id') THEN
    EXECUTE 'CREATE INDEX idx_employee_checkins_company_id ON public.employee_checkins USING btree (company_id)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_employee_checkins_qr_token') THEN
    EXECUTE 'CREATE INDEX idx_employee_checkins_qr_token ON public.employee_checkins USING btree (qr_token)';
  END IF;
END $do$;

ALTER TABLE public.employee_checkins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS checkins_member_read ON public.employee_checkins;
CREATE POLICY checkins_member_read ON public.employee_checkins AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member((company_id)::uuid));
DROP POLICY IF EXISTS checkins_self_write ON public.employee_checkins;
CREATE POLICY checkins_self_write ON public.employee_checkins AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((user_id = auth.uid()) AND is_company_member((company_id)::uuid)));


-- ──────────────────────────────────────────────────────────
-- evidence
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.evidence (
  id text NOT NULL,
  company_id uuid,
  emergency_id text,
  submitted_by text NOT NULL,
  zone text,
  severity text,
  incident_type text,
  worker_comment text,
  status text DEFAULT 'received'::text,
  tier text DEFAULT 'free'::text,
  submitted_at timestamp with time zone NOT NULL DEFAULT now(),
  retention_days integer DEFAULT 30,
  incident_report_id text,
  photos jsonb DEFAULT '[]'::jsonb,
  audio_memo text,
  reviewed_by text,
  reviewed_at timestamp with time zone,
  actions jsonb DEFAULT '[]'::jsonb,
  comments jsonb DEFAULT '[]'::jsonb,
  linked_investigation_id text,
  linked_risk_entry_id text,
  linked_audit_entry_id text,
  included_in_pdf boolean DEFAULT false
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_pkey' AND conrelid = 'public.evidence'::regclass) THEN
    ALTER TABLE public.evidence ADD CONSTRAINT evidence_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_company_id_fkey' AND conrelid = 'public.evidence'::regclass) THEN
    ALTER TABLE public.evidence ADD CONSTRAINT evidence_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_evidence_emergency_id') THEN
    EXECUTE 'CREATE INDEX idx_evidence_emergency_id ON public.evidence USING btree (emergency_id)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_evidence_incident_report_id') THEN
    EXECUTE 'CREATE INDEX idx_evidence_incident_report_id ON public.evidence USING btree (incident_report_id) WHERE (incident_report_id IS NOT NULL)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_evidence_included_in_pdf') THEN
    EXECUTE 'CREATE INDEX idx_evidence_included_in_pdf ON public.evidence USING btree (included_in_pdf) WHERE (included_in_pdf = true)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_evidence_reviewed_by') THEN
    EXECUTE 'CREATE INDEX idx_evidence_reviewed_by ON public.evidence USING btree (reviewed_by) WHERE (reviewed_by IS NOT NULL)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_evidence_status') THEN
    EXECUTE 'CREATE INDEX idx_evidence_status ON public.evidence USING btree (status)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_evidence_submitted_at') THEN
    EXECUTE 'CREATE INDEX idx_evidence_submitted_at ON public.evidence USING btree (submitted_at DESC)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_evidence_zone') THEN
    EXECUTE 'CREATE INDEX idx_evidence_zone ON public.evidence USING btree (zone)';
  END IF;
END $do$;

ALTER TABLE public.evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS evidence_all ON public.evidence;
CREATE POLICY evidence_all ON public.evidence AS PERMISSIVE FOR ALL TO public
  USING ((company_id IN ( SELECT companies.id
   FROM companies
  WHERE (companies.owner_id = auth.uid()))));
DROP POLICY IF EXISTS evidence_company_read ON public.evidence;
CREATE POLICY evidence_company_read ON public.evidence AS PERMISSIVE FOR SELECT TO authenticated
  USING (((company_id IS NULL) OR is_company_member(company_id)));
DROP POLICY IF EXISTS evidence_company_write ON public.evidence;
CREATE POLICY evidence_company_write ON public.evidence AS PERMISSIVE FOR ALL TO authenticated
  USING (((company_id IS NULL) OR is_company_member(company_id)))
  WITH CHECK (((company_id IS NULL) OR is_company_member(company_id)));

COMMENT ON COLUMN public.evidence.photos IS 'Audit 2026-04-30: array of photo URL/metadata objects. Schema drift fix.';
COMMENT ON COLUMN public.evidence.actions IS 'Audit 2026-04-30: array of dispatcher action records. Schema drift fix.';
COMMENT ON COLUMN public.evidence.comments IS 'Audit 2026-04-30: array of comment objects on the evidence. Schema drift fix.';

-- ──────────────────────────────────────────────────────────
-- evidence_actions
-- G-31 (B-20): service-role only (deny-all-clients). Internal evidence-flow event log.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.evidence_actions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  evidence_id text NOT NULL,
  actor text NOT NULL,
  action_type text NOT NULL,
  details text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_actions_pkey' AND conrelid = 'public.evidence_actions'::regclass) THEN
    ALTER TABLE public.evidence_actions ADD CONSTRAINT evidence_actions_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_actions_evidence_id_fkey' AND conrelid = 'public.evidence_actions'::regclass) THEN
    ALTER TABLE public.evidence_actions ADD CONSTRAINT evidence_actions_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE CASCADE;
  END IF;
END $do$;


ALTER TABLE public.evidence_actions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.evidence_actions IS 'G-31 (B-20): service-role only (deny-all-clients). Internal evidence-flow event log.';

-- ──────────────────────────────────────────────────────────
-- evidence_audio
-- G-31 (B-20): service-role only (deny-all-clients). Internal audio metadata; payloads in storage bucket.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.evidence_audio (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  evidence_id uuid NOT NULL,
  storage_path text NOT NULL,
  duration_sec double precision,
  format text DEFAULT 'webm'::text,
  transcription text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_audio_pkey' AND conrelid = 'public.evidence_audio'::regclass) THEN
    ALTER TABLE public.evidence_audio ADD CONSTRAINT evidence_audio_pkey PRIMARY KEY (id);
  END IF;
END $do$;


ALTER TABLE public.evidence_audio ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.evidence_audio IS 'G-31 (B-20): service-role only (deny-all-clients). Internal audio metadata; payloads in storage bucket.';

-- ──────────────────────────────────────────────────────────
-- evidence_photos
-- G-31 (B-20): service-role only (deny-all-clients). Internal photo metadata; payloads in storage bucket.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.evidence_photos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  evidence_id text NOT NULL,
  data_url text,
  caption text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_photos_pkey' AND conrelid = 'public.evidence_photos'::regclass) THEN
    ALTER TABLE public.evidence_photos ADD CONSTRAINT evidence_photos_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_photos_evidence_id_fkey' AND conrelid = 'public.evidence_photos'::regclass) THEN
    ALTER TABLE public.evidence_photos ADD CONSTRAINT evidence_photos_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE CASCADE;
  END IF;
END $do$;


ALTER TABLE public.evidence_photos ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.evidence_photos IS 'G-31 (B-20): service-role only (deny-all-clients). Internal photo metadata; payloads in storage bucket.';

-- ──────────────────────────────────────────────────────────
-- families
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.families (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'families_pkey' AND conrelid = 'public.families'::regclass) THEN
    ALTER TABLE public.families ADD CONSTRAINT families_pkey PRIMARY KEY (id);
  END IF;
END $do$;


ALTER TABLE public.families ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS families_delete ON public.families;
CREATE POLICY families_delete ON public.families AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM family_memberships fm
  WHERE ((fm.family_id = families.id) AND (fm.user_id = auth.uid()) AND (fm.role = 'owner'::text)))));
DROP POLICY IF EXISTS families_insert_blocked ON public.families;
CREATE POLICY families_insert_blocked ON public.families AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (false);
DROP POLICY IF EXISTS families_select ON public.families;
CREATE POLICY families_select ON public.families AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM family_memberships fm
  WHERE ((fm.family_id = families.id) AND (fm.user_id = auth.uid())))));
DROP POLICY IF EXISTS families_update ON public.families;
CREATE POLICY families_update ON public.families AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM family_memberships fm
  WHERE ((fm.family_id = families.id) AND (fm.user_id = auth.uid()) AND (fm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM family_memberships fm
  WHERE ((fm.family_id = families.id) AND (fm.user_id = auth.uid()) AND (fm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


-- ──────────────────────────────────────────────────────────
-- family_contacts
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.family_contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  contact_user_id uuid,
  contact_phone text,
  display_name text NOT NULL,
  priority integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'family_contacts_pkey' AND conrelid = 'public.family_contacts'::regclass) THEN
    ALTER TABLE public.family_contacts ADD CONSTRAINT family_contacts_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'family_contacts_unique_priority' AND conrelid = 'public.family_contacts'::regclass) THEN
    ALTER TABLE public.family_contacts ADD CONSTRAINT family_contacts_unique_priority UNIQUE (owner_user_id, priority);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'family_contacts_one_target' AND conrelid = 'public.family_contacts'::regclass) THEN
    ALTER TABLE public.family_contacts ADD CONSTRAINT family_contacts_one_target CHECK (((contact_user_id IS NOT NULL) OR (contact_phone IS NOT NULL)));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'family_contacts_priority_check' AND conrelid = 'public.family_contacts'::regclass) THEN
    ALTER TABLE public.family_contacts ADD CONSTRAINT family_contacts_priority_check CHECK (((priority >= 1) AND (priority <= 3)));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'family_contacts_contact_user_id_fkey' AND conrelid = 'public.family_contacts'::regclass) THEN
    ALTER TABLE public.family_contacts ADD CONSTRAINT family_contacts_contact_user_id_fkey FOREIGN KEY (contact_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'family_contacts_owner_user_id_fkey' AND conrelid = 'public.family_contacts'::regclass) THEN
    ALTER TABLE public.family_contacts ADD CONSTRAINT family_contacts_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='family_contacts_contact_user_idx') THEN
    EXECUTE 'CREATE INDEX family_contacts_contact_user_idx ON public.family_contacts USING btree (contact_user_id)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='family_contacts_owner_idx') THEN
    EXECUTE 'CREATE INDEX family_contacts_owner_idx ON public.family_contacts USING btree (owner_user_id)';
  END IF;
END $do$;

ALTER TABLE public.family_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS family_contacts_delete_own ON public.family_contacts;
CREATE POLICY family_contacts_delete_own ON public.family_contacts AS PERMISSIVE FOR DELETE TO authenticated
  USING ((owner_user_id = auth.uid()));
DROP POLICY IF EXISTS family_contacts_insert_own ON public.family_contacts;
CREATE POLICY family_contacts_insert_own ON public.family_contacts AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((owner_user_id = auth.uid()));
DROP POLICY IF EXISTS family_contacts_select_own ON public.family_contacts;
CREATE POLICY family_contacts_select_own ON public.family_contacts AS PERMISSIVE FOR SELECT TO authenticated
  USING ((owner_user_id = auth.uid()));
DROP POLICY IF EXISTS family_contacts_update_own ON public.family_contacts;
CREATE POLICY family_contacts_update_own ON public.family_contacts AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((owner_user_id = auth.uid()))
  WITH CHECK ((owner_user_id = auth.uid()));


-- ──────────────────────────────────────────────────────────
-- family_memberships
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.family_memberships (
  family_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  id uuid NOT NULL DEFAULT gen_random_uuid()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'family_memberships_pkey' AND conrelid = 'public.family_memberships'::regclass) THEN
    ALTER TABLE public.family_memberships ADD CONSTRAINT family_memberships_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'family_memberships_role_check' AND conrelid = 'public.family_memberships'::regclass) THEN
    ALTER TABLE public.family_memberships ADD CONSTRAINT family_memberships_role_check CHECK ((role = ANY (ARRAY['guardian'::text, 'member'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'family_memberships_family_id_fkey' AND conrelid = 'public.family_memberships'::regclass) THEN
    ALTER TABLE public.family_memberships ADD CONSTRAINT family_memberships_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'family_memberships_user_id_fkey' AND conrelid = 'public.family_memberships'::regclass) THEN
    ALTER TABLE public.family_memberships ADD CONSTRAINT family_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='one_active_family_per_user') THEN
    EXECUTE 'CREATE UNIQUE INDEX one_active_family_per_user ON public.family_memberships USING btree (user_id) WHERE (active = true)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uniq_family_user_pair') THEN
    EXECUTE 'CREATE UNIQUE INDEX uniq_family_user_pair ON public.family_memberships USING btree (family_id, user_id)';
  END IF;
END $do$;

ALTER TABLE public.family_memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insert own family membership" ON public.family_memberships;
CREATE POLICY "insert own family membership" ON public.family_memberships AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((user_id = auth.uid()));
DROP POLICY IF EXISTS "read own family membership" ON public.family_memberships;
CREATE POLICY "read own family membership" ON public.family_memberships AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = auth.uid()));
DROP POLICY IF EXISTS "update own family membership" ON public.family_memberships;
CREATE POLICY "update own family membership" ON public.family_memberships AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));


-- ──────────────────────────────────────────────────────────
-- files
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.files (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  employee_id text,
  file_name text NOT NULL,
  file_type text,
  file_size integer,
  storage_path text NOT NULL,
  bucket text DEFAULT 'evidence'::text,
  uploaded_by text,
  created_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'files_pkey' AND conrelid = 'public.files'::regclass) THEN
    ALTER TABLE public.files ADD CONSTRAINT files_pkey PRIMARY KEY (id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_files_company') THEN
    EXECUTE 'CREATE INDEX idx_files_company ON public.files USING btree (company_id)';
  END IF;
END $do$;

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS files_member_read ON public.files;
CREATE POLICY files_member_read ON public.files AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));
DROP POLICY IF EXISTS files_member_write ON public.files;
CREATE POLICY files_member_write ON public.files AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_member(company_id))
  WITH CHECK (is_company_member(company_id));


-- ──────────────────────────────────────────────────────────
-- geofences
-- R-1 (2026-05-13): tenant-scoped via company_id. Writes via upsert_geofence/delete_geofence RPCs (SECDEF + admin-only). Reads via is_company_member(company_id) policy.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.geofences (
  id text NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  center jsonb NOT NULL,
  radius numeric,
  points jsonb,
  risk text NOT NULL DEFAULT 'low'::text,
  status text NOT NULL DEFAULT 'active'::text,
  color text DEFAULT '#00C8E0'::text,
  locked boolean DEFAULT false,
  visible boolean DEFAULT true,
  alerts jsonb DEFAULT '{"exitAlert": false, "dwellAlert": false, "entryAlert": true, "maxCapacity": 20, "dwellMinutes": 30}'::jsonb,
  employee_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  company_id uuid
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'geofences_pkey' AND conrelid = 'public.geofences'::regclass) THEN
    ALTER TABLE public.geofences ADD CONSTRAINT geofences_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'geofences_risk_check' AND conrelid = 'public.geofences'::regclass) THEN
    ALTER TABLE public.geofences ADD CONSTRAINT geofences_risk_check CHECK ((risk = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'geofences_status_check' AND conrelid = 'public.geofences'::regclass) THEN
    ALTER TABLE public.geofences ADD CONSTRAINT geofences_status_check CHECK ((status = ANY (ARRAY['active'::text, 'restricted'::text, 'evacuated'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'geofences_type_check' AND conrelid = 'public.geofences'::regclass) THEN
    ALTER TABLE public.geofences ADD CONSTRAINT geofences_type_check CHECK ((type = ANY (ARRAY['circle'::text, 'polygon'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'geofences_company_id_fkey' AND conrelid = 'public.geofences'::regclass) THEN
    ALTER TABLE public.geofences ADD CONSTRAINT geofences_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_geofences_company_id') THEN
    EXECUTE 'CREATE INDEX idx_geofences_company_id ON public.geofences USING btree (company_id)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_geofences_risk') THEN
    EXECUTE 'CREATE INDEX idx_geofences_risk ON public.geofences USING btree (risk)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_geofences_status') THEN
    EXECUTE 'CREATE INDEX idx_geofences_status ON public.geofences USING btree (status)';
  END IF;
END $do$;

ALTER TABLE public.geofences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS geofences_company_read ON public.geofences;
CREATE POLICY geofences_company_read ON public.geofences AS PERMISSIVE FOR SELECT TO authenticated
  USING (((company_id IS NOT NULL) AND is_company_member(company_id)));

COMMENT ON TABLE public.geofences IS 'R-1 (2026-05-13): tenant-scoped via company_id. Writes via upsert_geofence/delete_geofence RPCs (SECDEF + admin-only). Reads via is_company_member(company_id) policy.';

-- ──────────────────────────────────────────────────────────
-- gps_trail
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gps_trail (
  id text NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  employee_id uuid,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy double precision,
  speed double precision,
  battery_level integer,
  is_emergency boolean DEFAULT false,
  recorded_at timestamp with time zone NOT NULL,
  synced_at timestamp with time zone DEFAULT now(),
  heading double precision,
  source text,
  altitude double precision,
  battery integer,
  session_id text
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gps_trail_pkey' AND conrelid = 'public.gps_trail'::regclass) THEN
    ALTER TABLE public.gps_trail ADD CONSTRAINT gps_trail_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gps_trail_company_id_fkey' AND conrelid = 'public.gps_trail'::regclass) THEN
    ALTER TABLE public.gps_trail ADD CONSTRAINT gps_trail_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_gps_trail_company_emp_time') THEN
    EXECUTE 'CREATE INDEX idx_gps_trail_company_emp_time ON public.gps_trail USING btree (company_id, employee_id, recorded_at DESC)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_gps_trail_employee') THEN
    EXECUTE 'CREATE INDEX idx_gps_trail_employee ON public.gps_trail USING btree (employee_id)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_gps_trail_recorded') THEN
    EXECUTE 'CREATE INDEX idx_gps_trail_recorded ON public.gps_trail USING btree (recorded_at DESC)';
  END IF;
END $do$;

ALTER TABLE public.gps_trail ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gps_own_user ON public.gps_trail;
CREATE POLICY gps_own_user ON public.gps_trail AS PERMISSIVE FOR ALL TO authenticated
  USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));
DROP POLICY IF EXISTS gps_trail_company_read ON public.gps_trail;
CREATE POLICY gps_trail_company_read ON public.gps_trail AS PERMISSIVE FOR SELECT TO authenticated
  USING (((company_id IS NOT NULL) AND is_company_member(company_id)));
DROP POLICY IF EXISTS gps_trail_self ON public.gps_trail;
CREATE POLICY gps_trail_self ON public.gps_trail AS PERMISSIVE FOR ALL TO authenticated
  USING (((employee_id = auth.uid()) OR ((company_id IS NULL) AND (employee_id IS NULL))))
  WITH CHECK (((employee_id = auth.uid()) OR ((company_id IS NULL) AND (employee_id IS NULL))));

COMMENT ON COLUMN public.gps_trail.employee_id IS 'B-15 2026-04-25: migrated text → uuid so RLS policies use the index directly without a cast (previously caused seq-scans during SOS load).';

-- ──────────────────────────────────────────────────────────
-- handover_notes
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.handover_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  from_admin uuid,
  to_admin uuid,
  note text,
  active_emergencies jsonb,
  created_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handover_notes_pkey' AND conrelid = 'public.handover_notes'::regclass) THEN
    ALTER TABLE public.handover_notes ADD CONSTRAINT handover_notes_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handover_notes_company_id_fkey' AND conrelid = 'public.handover_notes'::regclass) THEN
    ALTER TABLE public.handover_notes ADD CONSTRAINT handover_notes_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
  END IF;
END $do$;


ALTER TABLE public.handover_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS handover_notes_member_read ON public.handover_notes;
CREATE POLICY handover_notes_member_read ON public.handover_notes AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));
DROP POLICY IF EXISTS handover_notes_member_write ON public.handover_notes;
CREATE POLICY handover_notes_member_write ON public.handover_notes AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_member(company_id))
  WITH CHECK (is_company_member(company_id));


-- ──────────────────────────────────────────────────────────
-- invitations
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invitations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  email text NOT NULL,
  role text DEFAULT 'zone_admin'::text,
  level text DEFAULT 'zone_admin'::text,
  invited_by uuid,
  token text DEFAULT (gen_random_uuid())::text,
  status text DEFAULT 'pending'::text,
  expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval),
  created_at timestamp with time zone DEFAULT now(),
  name text,
  phone text,
  department text,
  zone_name text,
  role_type text DEFAULT 'employee'::text,
  accepted_at timestamp with time zone
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invitations_pkey' AND conrelid = 'public.invitations'::regclass) THEN
    ALTER TABLE public.invitations ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invitations_token_key' AND conrelid = 'public.invitations'::regclass) THEN
    ALTER TABLE public.invitations ADD CONSTRAINT invitations_token_key UNIQUE (token);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invitations_company_id_fkey' AND conrelid = 'public.invitations'::regclass) THEN
    ALTER TABLE public.invitations ADD CONSTRAINT invitations_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invitations_invited_by_fkey' AND conrelid = 'public.invitations'::regclass) THEN
    ALTER TABLE public.invitations ADD CONSTRAINT invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_invitations_company') THEN
    EXECUTE 'CREATE INDEX idx_invitations_company ON public.invitations USING btree (company_id)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_invitations_company_status') THEN
    EXECUTE 'CREATE INDEX idx_invitations_company_status ON public.invitations USING btree (company_id, status)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_invitations_email') THEN
    EXECUTE 'CREATE INDEX idx_invitations_email ON public.invitations USING btree (email)';
  END IF;
END $do$;

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invitations_owner_read ON public.invitations;
CREATE POLICY invitations_owner_read ON public.invitations AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_owner(company_id));
DROP POLICY IF EXISTS invitations_owner_write ON public.invitations;
CREATE POLICY invitations_owner_write ON public.invitations AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_owner(company_id))
  WITH CHECK (is_company_owner(company_id));


-- ──────────────────────────────────────────────────────────
-- invites
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  invited_role text NOT NULL DEFAULT 'employee'::text,
  invite_code text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  max_uses integer NOT NULL DEFAULT 1,
  used_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invites_pkey' AND conrelid = 'public.invites'::regclass) THEN
    ALTER TABLE public.invites ADD CONSTRAINT invites_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invites_invited_role_check' AND conrelid = 'public.invites'::regclass) THEN
    ALTER TABLE public.invites ADD CONSTRAINT invites_invited_role_check CHECK ((invited_role = ANY (ARRAY['admin'::text, 'employee'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invites_company_id_fkey' AND conrelid = 'public.invites'::regclass) THEN
    ALTER TABLE public.invites ADD CONSTRAINT invites_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $do$;


ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invites_owner_read ON public.invites;
CREATE POLICY invites_owner_read ON public.invites AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_owner(company_id));
DROP POLICY IF EXISTS invites_owner_write ON public.invites;
CREATE POLICY invites_owner_write ON public.invites AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_owner(company_id))
  WITH CHECK (is_company_owner(company_id));


-- ──────────────────────────────────────────────────────────
-- ire_records
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ire_records (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  company_id uuid,
  admin_id uuid,
  emergency_id uuid,
  employee_name text,
  zone text,
  sos_type text,
  severity text,
  response_score double precision,
  response_time_sec integer,
  phases_completed integer,
  actions_count integer,
  auto_actions_count integer,
  threat_level integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ire_records_pkey' AND conrelid = 'public.ire_records'::regclass) THEN
    ALTER TABLE public.ire_records ADD CONSTRAINT ire_records_pkey PRIMARY KEY (id);
  END IF;
END $do$;


ALTER TABLE public.ire_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ire_records_member_read ON public.ire_records;
CREATE POLICY ire_records_member_read ON public.ire_records AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));


-- ──────────────────────────────────────────────────────────
-- medical_profiles
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.medical_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id bigint,
  blood_type text,
  allergies text[],
  medications text[],
  conditions text[],
  emergency_contacts jsonb,
  updated_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'medical_profiles_pkey' AND conrelid = 'public.medical_profiles'::regclass) THEN
    ALTER TABLE public.medical_profiles ADD CONSTRAINT medical_profiles_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'medical_profiles_employee_id_fkey' AND conrelid = 'public.medical_profiles'::regclass) THEN
    ALTER TABLE public.medical_profiles ADD CONSTRAINT medical_profiles_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES company_employees(id);
  END IF;
END $do$;


ALTER TABLE public.medical_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS medical_own_user ON public.medical_profiles;
CREATE POLICY medical_own_user ON public.medical_profiles AS PERMISSIVE FOR ALL TO public
  USING ((id = auth.uid()));


-- ──────────────────────────────────────────────────────────
-- mission_gps
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mission_gps (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  mission_id uuid NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  speed double precision,
  accuracy double precision,
  is_offline boolean DEFAULT false,
  recorded_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mission_gps_pkey' AND conrelid = 'public.mission_gps'::regclass) THEN
    ALTER TABLE public.mission_gps ADD CONSTRAINT mission_gps_pkey PRIMARY KEY (id);
  END IF;
END $do$;


ALTER TABLE public.mission_gps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mission_gps_member_read ON public.mission_gps;
CREATE POLICY mission_gps_member_read ON public.mission_gps AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM missions m
  WHERE ((m.id = mission_gps.mission_id) AND is_company_member(m.company_id)))));


-- ──────────────────────────────────────────────────────────
-- mission_heartbeats
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mission_heartbeats (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  mission_id uuid NOT NULL,
  battery_level integer,
  signal_strength integer,
  recorded_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mission_heartbeats_pkey' AND conrelid = 'public.mission_heartbeats'::regclass) THEN
    ALTER TABLE public.mission_heartbeats ADD CONSTRAINT mission_heartbeats_pkey PRIMARY KEY (id);
  END IF;
END $do$;


ALTER TABLE public.mission_heartbeats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mission_heartbeats_member_read ON public.mission_heartbeats;
CREATE POLICY mission_heartbeats_member_read ON public.mission_heartbeats AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM missions m
  WHERE ((m.id = mission_heartbeats.mission_id) AND is_company_member(m.company_id)))));


-- ──────────────────────────────────────────────────────────
-- missions
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.missions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  employee_id bigint,
  title text,
  from_location text,
  to_location text,
  vehicle text,
  status text DEFAULT 'scheduled'::text,
  start_time timestamp with time zone,
  duration_hours integer DEFAULT 4,
  waypoints jsonb,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  dest_lat double precision,
  dest_lng double precision,
  origin_lat double precision,
  origin_lng double precision,
  estimated_duration_min integer,
  actual_start timestamp with time zone,
  actual_end timestamp with time zone
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'missions_pkey' AND conrelid = 'public.missions'::regclass) THEN
    ALTER TABLE public.missions ADD CONSTRAINT missions_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'missions_company_id_fkey' AND conrelid = 'public.missions'::regclass) THEN
    ALTER TABLE public.missions ADD CONSTRAINT missions_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'missions_employee_id_fkey' AND conrelid = 'public.missions'::regclass) THEN
    ALTER TABLE public.missions ADD CONSTRAINT missions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES company_employees(id);
  END IF;
END $do$;


ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS missions_all ON public.missions;
CREATE POLICY missions_all ON public.missions AS PERMISSIVE FOR ALL TO public
  USING ((company_id IN ( SELECT companies.id
   FROM companies
  WHERE (companies.owner_id = auth.uid()))));
DROP POLICY IF EXISTS missions_member_read ON public.missions;
CREATE POLICY missions_member_read ON public.missions AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));
DROP POLICY IF EXISTS missions_member_write ON public.missions;
CREATE POLICY missions_member_write ON public.missions AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_member(company_id))
  WITH CHECK (is_company_member(company_id));
DROP POLICY IF EXISTS missions_own_company ON public.missions;
CREATE POLICY missions_own_company ON public.missions AS PERMISSIVE FOR ALL TO public
  USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));


-- ──────────────────────────────────────────────────────────
-- notification_broadcasts
-- G-31 (B-20): service-role only (deny-all-clients). Pushed via realtime; clients consume the broadcast, not the row.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_broadcasts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  admin_id uuid,
  title text NOT NULL,
  body text NOT NULL,
  target text DEFAULT 'all'::text,
  recipients_count integer DEFAULT 0,
  sent_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_broadcasts_pkey' AND conrelid = 'public.notification_broadcasts'::regclass) THEN
    ALTER TABLE public.notification_broadcasts ADD CONSTRAINT notification_broadcasts_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_broadcasts_target_check' AND conrelid = 'public.notification_broadcasts'::regclass) THEN
    ALTER TABLE public.notification_broadcasts ADD CONSTRAINT notification_broadcasts_target_check CHECK ((target = ANY (ARRAY['all'::text, 'companies'::text, 'users'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_broadcasts_admin_id_fkey' AND conrelid = 'public.notification_broadcasts'::regclass) THEN
    ALTER TABLE public.notification_broadcasts ADD CONSTRAINT notification_broadcasts_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES auth.users(id);
  END IF;
END $do$;


ALTER TABLE public.notification_broadcasts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.notification_broadcasts IS 'G-31 (B-20): service-role only (deny-all-clients). Pushed via realtime; clients consume the broadcast, not the row.';

-- ──────────────────────────────────────────────────────────
-- notifications
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id bigint NOT NULL DEFAULT nextval('notifications_id_seq'::regclass),
  user_id uuid,
  title text NOT NULL,
  body text,
  type text DEFAULT 'info'::text,
  is_read boolean DEFAULT false,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_pkey' AND conrelid = 'public.notifications'::regclass) THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_user_id_fkey' AND conrelid = 'public.notifications'::regclass) THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_notifications_user') THEN
    EXECUTE 'CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id)';
  END IF;
END $do$;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications" ON public.notifications AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
CREATE POLICY "Users update own notifications" ON public.notifications AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
DROP POLICY IF EXISTS notifications_own_user ON public.notifications;
CREATE POLICY notifications_own_user ON public.notifications AS PERMISSIVE FOR ALL TO public
  USING ((user_id = auth.uid()));
DROP POLICY IF EXISTS notifications_self_mark ON public.notifications;
CREATE POLICY notifications_self_mark ON public.notifications AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
DROP POLICY IF EXISTS notifications_self_read ON public.notifications;
CREATE POLICY notifications_self_read ON public.notifications AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));


-- ──────────────────────────────────────────────────────────
-- outbox_messages
-- G-31 (B-20): service-role only (deny-all-clients). Outbox queue, drained by edge functions.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.outbox_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  to_phone text NOT NULL,
  channel text NOT NULL,
  body text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  sent_at timestamp with time zone,
  status text NOT NULL DEFAULT 'pending'::text
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbox_messages_pkey' AND conrelid = 'public.outbox_messages'::regclass) THEN
    ALTER TABLE public.outbox_messages ADD CONSTRAINT outbox_messages_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbox_messages_channel_check' AND conrelid = 'public.outbox_messages'::regclass) THEN
    ALTER TABLE public.outbox_messages ADD CONSTRAINT outbox_messages_channel_check CHECK ((channel = ANY (ARRAY['sms'::text, 'whatsapp'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbox_messages_status_check' AND conrelid = 'public.outbox_messages'::regclass) THEN
    ALTER TABLE public.outbox_messages ADD CONSTRAINT outbox_messages_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbox_messages_session_id_fkey' AND conrelid = 'public.outbox_messages'::regclass) THEN
    ALTER TABLE public.outbox_messages ADD CONSTRAINT outbox_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES sos_sessions(id) ON DELETE CASCADE;
  END IF;
END $do$;


ALTER TABLE public.outbox_messages ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.outbox_messages IS 'G-31 (B-20): service-role only (deny-all-clients). Outbox queue, drained by edge functions.';

-- ──────────────────────────────────────────────────────────
-- process_instances
-- G-31 (B-20): service-role only. Internal IRE process state.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.process_instances (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  process_id uuid,
  title text NOT NULL DEFAULT ''::text,
  status text NOT NULL DEFAULT 'active'::text,
  started_at timestamp with time zone DEFAULT now(),
  completed_at timestamp with time zone
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_instances_pkey' AND conrelid = 'public.process_instances'::regclass) THEN
    ALTER TABLE public.process_instances ADD CONSTRAINT process_instances_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_instances_status_check' AND conrelid = 'public.process_instances'::regclass) THEN
    ALTER TABLE public.process_instances ADD CONSTRAINT process_instances_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'cancelled'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_instances_process_id_fkey' AND conrelid = 'public.process_instances'::regclass) THEN
    ALTER TABLE public.process_instances ADD CONSTRAINT process_instances_process_id_fkey FOREIGN KEY (process_id) REFERENCES processes(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_instances_process') THEN
    EXECUTE 'CREATE INDEX idx_instances_process ON public.process_instances USING btree (process_id)';
  END IF;
END $do$;

ALTER TABLE public.process_instances ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.process_instances IS 'G-31 (B-20): service-role only. Internal IRE process state.';

-- ──────────────────────────────────────────────────────────
-- process_steps
-- G-31 (B-20): service-role only. Internal IRE step definitions.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.process_steps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  process_id uuid,
  step_order integer NOT NULL,
  step_name text NOT NULL,
  expected_minutes integer NOT NULL DEFAULT 60
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_steps_pkey' AND conrelid = 'public.process_steps'::regclass) THEN
    ALTER TABLE public.process_steps ADD CONSTRAINT process_steps_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_steps_process_id_step_order_key' AND conrelid = 'public.process_steps'::regclass) THEN
    ALTER TABLE public.process_steps ADD CONSTRAINT process_steps_process_id_step_order_key UNIQUE (process_id, step_order);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_steps_process_id_fkey' AND conrelid = 'public.process_steps'::regclass) THEN
    ALTER TABLE public.process_steps ADD CONSTRAINT process_steps_process_id_fkey FOREIGN KEY (process_id) REFERENCES processes(id) ON DELETE CASCADE;
  END IF;
END $do$;


ALTER TABLE public.process_steps ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.process_steps IS 'G-31 (B-20): service-role only. Internal IRE step definitions.';

-- ──────────────────────────────────────────────────────────
-- processes
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.processes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processes_pkey' AND conrelid = 'public.processes'::regclass) THEN
    ALTER TABLE public.processes ADD CONSTRAINT processes_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processes_company_id_fkey' AND conrelid = 'public.processes'::regclass) THEN
    ALTER TABLE public.processes ADD CONSTRAINT processes_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_process_company') THEN
    EXECUTE 'CREATE INDEX idx_process_company ON public.processes USING btree (company_id)';
  END IF;
END $do$;

ALTER TABLE public.processes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS processes_member_read ON public.processes;
CREATE POLICY processes_member_read ON public.processes AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));
DROP POLICY IF EXISTS processes_owner_write ON public.processes;
CREATE POLICY processes_owner_write ON public.processes AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_owner(company_id))
  WITH CHECK (is_company_owner(company_id));


-- ──────────────────────────────────────────────────────────
-- profile_trigger_logs
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profile_trigger_logs (
  id bigint NOT NULL DEFAULT nextval('profile_trigger_logs_id_seq'::regclass),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  user_id uuid,
  message text
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_trigger_logs_pkey' AND conrelid = 'public.profile_trigger_logs'::regclass) THEN
    ALTER TABLE public.profile_trigger_logs ADD CONSTRAINT profile_trigger_logs_pkey PRIMARY KEY (id);
  END IF;
END $do$;


ALTER TABLE public.profile_trigger_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no access" ON public.profile_trigger_logs;
CREATE POLICY "no access" ON public.profile_trigger_logs AS PERMISSIVE FOR ALL TO public
  USING (false);


-- ──────────────────────────────────────────────────────────
-- push_tokens
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  token text NOT NULL,
  platform text DEFAULT 'android'::text,
  device_name text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_tokens_pkey' AND conrelid = 'public.push_tokens'::regclass) THEN
    ALTER TABLE public.push_tokens ADD CONSTRAINT push_tokens_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_tokens_user_id_token_key' AND conrelid = 'public.push_tokens'::regclass) THEN
    ALTER TABLE public.push_tokens ADD CONSTRAINT push_tokens_user_id_token_key UNIQUE (user_id, token);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_tokens_platform_check' AND conrelid = 'public.push_tokens'::regclass) THEN
    ALTER TABLE public.push_tokens ADD CONSTRAINT push_tokens_platform_check CHECK ((platform = ANY (ARRAY['android'::text, 'ios'::text, 'web'::text, 'desktop-web'::text, 'mobile-web'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_tokens_user_id_fkey' AND conrelid = 'public.push_tokens'::regclass) THEN
    ALTER TABLE public.push_tokens ADD CONSTRAINT push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_push_tokens_platform') THEN
    EXECUTE 'CREATE INDEX idx_push_tokens_platform ON public.push_tokens USING btree (platform)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_push_tokens_user') THEN
    EXECUTE 'CREATE INDEX idx_push_tokens_user ON public.push_tokens USING btree (user_id)';
  END IF;
END $do$;

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own tokens" ON public.push_tokens;
CREATE POLICY "Users manage own tokens" ON public.push_tokens AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id));
DROP POLICY IF EXISTS push_tokens_own_user ON public.push_tokens;
CREATE POLICY push_tokens_own_user ON public.push_tokens AS PERMISSIVE FOR ALL TO public
  USING ((user_id = auth.uid()));


-- ──────────────────────────────────────────────────────────
-- risk_scores
-- G-31 (B-20): service-role only. Computed risk scores; written by cron job.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.risk_scores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id bigint,
  score integer DEFAULT 0,
  factors jsonb,
  calculated_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_scores_pkey' AND conrelid = 'public.risk_scores'::regclass) THEN
    ALTER TABLE public.risk_scores ADD CONSTRAINT risk_scores_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_scores_employee_id_fkey' AND conrelid = 'public.risk_scores'::regclass) THEN
    ALTER TABLE public.risk_scores ADD CONSTRAINT risk_scores_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES company_employees(id);
  END IF;
END $do$;


ALTER TABLE public.risk_scores ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.risk_scores IS 'G-31 (B-20): service-role only. Computed risk scores; written by cron job.';

-- ──────────────────────────────────────────────────────────
-- safe_trips
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.safe_trips (
  id bigint NOT NULL DEFAULT nextval('safe_trips_id_seq'::regclass),
  user_id uuid,
  destination text,
  destination_lat double precision,
  destination_lon double precision,
  expected_return timestamp with time zone NOT NULL,
  extended_until timestamp with time zone,
  status text DEFAULT 'active'::text,
  guardian_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  check_in_count integer DEFAULT 0,
  last_check_in timestamp with time zone,
  route_points jsonb DEFAULT '[]'::jsonb,
  emergency_triggered_at timestamp with time zone
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'safe_trips_pkey' AND conrelid = 'public.safe_trips'::regclass) THEN
    ALTER TABLE public.safe_trips ADD CONSTRAINT safe_trips_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'safe_trips_guardian_id_fkey' AND conrelid = 'public.safe_trips'::regclass) THEN
    ALTER TABLE public.safe_trips ADD CONSTRAINT safe_trips_guardian_id_fkey FOREIGN KEY (guardian_id) REFERENCES profiles(id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'safe_trips_user_id_fkey' AND conrelid = 'public.safe_trips'::regclass) THEN
    ALTER TABLE public.safe_trips ADD CONSTRAINT safe_trips_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_safe_trips_user') THEN
    EXECUTE 'CREATE INDEX idx_safe_trips_user ON public.safe_trips USING btree (user_id)';
  END IF;
END $do$;

ALTER TABLE public.safe_trips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS safe_trips_own ON public.safe_trips;
CREATE POLICY safe_trips_own ON public.safe_trips AS PERMISSIVE FOR ALL TO public
  USING ((user_id = auth.uid()));
DROP POLICY IF EXISTS safe_trips_self ON public.safe_trips;
CREATE POLICY safe_trips_self ON public.safe_trips AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));


-- ──────────────────────────────────────────────────────────
-- safety_timers
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.safety_timers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid,
  status text NOT NULL DEFAULT 'running'::text,
  ends_at timestamp with time zone NOT NULL,
  last_prompt_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  ended_at timestamp with time zone
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'safety_timers_pkey' AND conrelid = 'public.safety_timers'::regclass) THEN
    ALTER TABLE public.safety_timers ADD CONSTRAINT safety_timers_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'safety_timers_status_check' AND conrelid = 'public.safety_timers'::regclass) THEN
    ALTER TABLE public.safety_timers ADD CONSTRAINT safety_timers_status_check CHECK ((status = ANY (ARRAY['running'::text, 'ended'::text, 'expired'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'safety_timers_company_id_fkey' AND conrelid = 'public.safety_timers'::regclass) THEN
    ALTER TABLE public.safety_timers ADD CONSTRAINT safety_timers_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
  END IF;
END $do$;


ALTER TABLE public.safety_timers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS safety_timers_company_read ON public.safety_timers;
CREATE POLICY safety_timers_company_read ON public.safety_timers AS PERMISSIVE FOR SELECT TO authenticated
  USING (((company_id IS NOT NULL) AND is_company_member(company_id)));
DROP POLICY IF EXISTS safety_timers_own ON public.safety_timers;
CREATE POLICY safety_timers_own ON public.safety_timers AS PERMISSIVE FOR ALL TO public
  USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));
DROP POLICY IF EXISTS safety_timers_self ON public.safety_timers;
CREATE POLICY safety_timers_self ON public.safety_timers AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));


-- ──────────────────────────────────────────────────────────
-- sar_missions
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sar_missions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  missing_employee_id uuid,
  missing_employee_name text NOT NULL,
  phase text NOT NULL DEFAULT 'watchdog'::text,
  last_known_lat double precision,
  last_known_lng double precision,
  search_cone_data jsonb,
  status text DEFAULT 'active'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  resolved_at timestamp with time zone
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sar_missions_pkey' AND conrelid = 'public.sar_missions'::regclass) THEN
    ALTER TABLE public.sar_missions ADD CONSTRAINT sar_missions_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sar_missions_company_id_fkey' AND conrelid = 'public.sar_missions'::regclass) THEN
    ALTER TABLE public.sar_missions ADD CONSTRAINT sar_missions_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sar_missions_missing_employee_id_fkey' AND conrelid = 'public.sar_missions'::regclass) THEN
    ALTER TABLE public.sar_missions ADD CONSTRAINT sar_missions_missing_employee_id_fkey FOREIGN KEY (missing_employee_id) REFERENCES employees(id);
  END IF;
END $do$;


ALTER TABLE public.sar_missions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sar_missions_member_read ON public.sar_missions;
CREATE POLICY sar_missions_member_read ON public.sar_missions AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));
DROP POLICY IF EXISTS sar_missions_member_write ON public.sar_missions;
CREATE POLICY sar_missions_member_write ON public.sar_missions AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_member(company_id))
  WITH CHECK (is_company_member(company_id));


-- ──────────────────────────────────────────────────────────
-- sensor_events
-- R-1 (2026-05-13): per-user via user_id. Writes via record_sensor_event RPC (SECDEF + auth.uid() pin). Reads via user_id = auth.uid() policy.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sensor_events (
  id text NOT NULL,
  event_type text NOT NULL,
  acceleration numeric NOT NULL,
  detected_at timestamp with time zone NOT NULL DEFAULT now(),
  resolved boolean DEFAULT false,
  resolved_by text,
  resolved_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  user_id uuid
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sensor_events_pkey' AND conrelid = 'public.sensor_events'::regclass) THEN
    ALTER TABLE public.sensor_events ADD CONSTRAINT sensor_events_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sensor_events_event_type_check' AND conrelid = 'public.sensor_events'::regclass) THEN
    ALTER TABLE public.sensor_events ADD CONSTRAINT sensor_events_event_type_check CHECK ((event_type = ANY (ARRAY['fall'::text, 'shake'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sensor_events_user_id_fkey' AND conrelid = 'public.sensor_events'::regclass) THEN
    ALTER TABLE public.sensor_events ADD CONSTRAINT sensor_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sensor_events_detected') THEN
    EXECUTE 'CREATE INDEX idx_sensor_events_detected ON public.sensor_events USING btree (detected_at DESC)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sensor_events_detected_at') THEN
    EXECUTE 'CREATE INDEX idx_sensor_events_detected_at ON public.sensor_events USING btree (detected_at DESC)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sensor_events_resolved') THEN
    EXECUTE 'CREATE INDEX idx_sensor_events_resolved ON public.sensor_events USING btree (resolved)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sensor_events_type') THEN
    EXECUTE 'CREATE INDEX idx_sensor_events_type ON public.sensor_events USING btree (event_type)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sensor_events_user_id') THEN
    EXECUTE 'CREATE INDEX idx_sensor_events_user_id ON public.sensor_events USING btree (user_id)';
  END IF;
END $do$;

ALTER TABLE public.sensor_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sensor_events_owner_read ON public.sensor_events;
CREATE POLICY sensor_events_owner_read ON public.sensor_events AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id IS NOT NULL) AND (user_id = auth.uid())));

COMMENT ON TABLE public.sensor_events IS 'R-1 (2026-05-13): per-user via user_id. Writes via record_sensor_event RPC (SECDEF + auth.uid() pin). Reads via user_id = auth.uid() policy.';

-- ──────────────────────────────────────────────────────────
-- sos_dispatch_logs
-- G-31 (B-20): service-role only. Audit trail of dispatch decisions.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sos_dispatch_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  ok boolean NOT NULL,
  status text,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_dispatch_logs_pkey' AND conrelid = 'public.sos_dispatch_logs'::regclass) THEN
    ALTER TABLE public.sos_dispatch_logs ADD CONSTRAINT sos_dispatch_logs_pkey PRIMARY KEY (id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='sos_dispatch_logs_request_id_idx') THEN
    EXECUTE 'CREATE INDEX sos_dispatch_logs_request_id_idx ON public.sos_dispatch_logs USING btree (request_id)';
  END IF;
END $do$;

ALTER TABLE public.sos_dispatch_logs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.sos_dispatch_logs IS 'G-31 (B-20): service-role only. Audit trail of dispatch decisions.';

-- ──────────────────────────────────────────────────────────
-- sos_events
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sos_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  employee_id bigint,
  triggered_at timestamp with time zone DEFAULT now(),
  resolved_at timestamp with time zone,
  lat double precision,
  lng double precision,
  accuracy integer,
  battery_level integer,
  signal_strength text,
  type text DEFAULT 'manual_sos'::text,
  status text DEFAULT 'active'::text,
  blood_type text,
  allergies text,
  medications text,
  is_silent boolean DEFAULT false,
  offline_queued boolean DEFAULT false
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_events_pkey' AND conrelid = 'public.sos_events'::regclass) THEN
    ALTER TABLE public.sos_events ADD CONSTRAINT sos_events_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_events_company_id_fkey' AND conrelid = 'public.sos_events'::regclass) THEN
    ALTER TABLE public.sos_events ADD CONSTRAINT sos_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_events_employee_id_fkey' AND conrelid = 'public.sos_events'::regclass) THEN
    ALTER TABLE public.sos_events ADD CONSTRAINT sos_events_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES company_employees(id);
  END IF;
END $do$;


ALTER TABLE public.sos_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sos_events_member_read ON public.sos_events;
CREATE POLICY sos_events_member_read ON public.sos_events AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));
DROP POLICY IF EXISTS sos_events_member_write ON public.sos_events;
CREATE POLICY sos_events_member_write ON public.sos_events AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_member(company_id))
  WITH CHECK (is_company_member(company_id));
DROP POLICY IF EXISTS sos_events_own_company ON public.sos_events;
CREATE POLICY sos_events_own_company ON public.sos_events AS PERMISSIVE FOR ALL TO public
  USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));


-- ──────────────────────────────────────────────────────────
-- sos_logs
-- G-31 (B-20): service-role only. Operational logging from sos-* edge functions.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sos_logs (
  id bigint NOT NULL DEFAULT nextval('sos_logs_id_seq'::regclass),
  request_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  action text,
  "timestamp" timestamp with time zone DEFAULT now(),
  details jsonb
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_logs_pkey' AND conrelid = 'public.sos_logs'::regclass) THEN
    ALTER TABLE public.sos_logs ADD CONSTRAINT sos_logs_pkey PRIMARY KEY (id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='sos_logs_request_id_idx') THEN
    EXECUTE 'CREATE INDEX sos_logs_request_id_idx ON public.sos_logs USING btree (request_id)';
  END IF;
END $do$;

ALTER TABLE public.sos_logs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.sos_logs IS 'G-31 (B-20): service-role only. Operational logging from sos-* edge functions.';

-- ──────────────────────────────────────────────────────────
-- sos_outbox
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sos_outbox (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  channel text NOT NULL,
  to_phone text,
  to_user_id uuid,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  sent_at timestamp with time zone
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_outbox_pkey' AND conrelid = 'public.sos_outbox'::regclass) THEN
    ALTER TABLE public.sos_outbox ADD CONSTRAINT sos_outbox_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_outbox_channel_check' AND conrelid = 'public.sos_outbox'::regclass) THEN
    ALTER TABLE public.sos_outbox ADD CONSTRAINT sos_outbox_channel_check CHECK ((channel = ANY (ARRAY['sms'::text, 'push'::text, 'email'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_outbox_status_check' AND conrelid = 'public.sos_outbox'::regclass) THEN
    ALTER TABLE public.sos_outbox ADD CONSTRAINT sos_outbox_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_outbox_target' AND conrelid = 'public.sos_outbox'::regclass) THEN
    ALTER TABLE public.sos_outbox ADD CONSTRAINT sos_outbox_target CHECK (((to_phone IS NOT NULL) OR (to_user_id IS NOT NULL)));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_outbox_session_id_fkey' AND conrelid = 'public.sos_outbox'::regclass) THEN
    ALTER TABLE public.sos_outbox ADD CONSTRAINT sos_outbox_session_id_fkey FOREIGN KEY (session_id) REFERENCES sos_sessions(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_outbox_to_user_id_fkey' AND conrelid = 'public.sos_outbox'::regclass) THEN
    ALTER TABLE public.sos_outbox ADD CONSTRAINT sos_outbox_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='sos_outbox_status_idx') THEN
    EXECUTE 'CREATE INDEX sos_outbox_status_idx ON public.sos_outbox USING btree (status, created_at)';
  END IF;
END $do$;

ALTER TABLE public.sos_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sos_outbox_select_own_sessions ON public.sos_outbox;
CREATE POLICY sos_outbox_select_own_sessions ON public.sos_outbox AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM sos_sessions s
  WHERE ((s.id = sos_outbox.session_id) AND (s.user_id = auth.uid())))));


-- ──────────────────────────────────────────────────────────
-- sos_public_links
-- G-31 (B-20): service-role only. Pre-signed share links; expiry enforced server-side.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sos_public_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  token text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_public_links_pkey' AND conrelid = 'public.sos_public_links'::regclass) THEN
    ALTER TABLE public.sos_public_links ADD CONSTRAINT sos_public_links_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_public_links_token_key' AND conrelid = 'public.sos_public_links'::regclass) THEN
    ALTER TABLE public.sos_public_links ADD CONSTRAINT sos_public_links_token_key UNIQUE (token);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_public_links_session_id_fkey' AND conrelid = 'public.sos_public_links'::regclass) THEN
    ALTER TABLE public.sos_public_links ADD CONSTRAINT sos_public_links_session_id_fkey FOREIGN KEY (session_id) REFERENCES sos_sessions(id) ON DELETE CASCADE;
  END IF;
END $do$;


ALTER TABLE public.sos_public_links ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.sos_public_links IS 'G-31 (B-20): service-role only. Pre-signed share links; expiry enforced server-side.';

-- ──────────────────────────────────────────────────────────
-- sos_queue
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sos_queue (
  id text NOT NULL,
  company_id uuid,
  employee_id uuid,
  employee_name text NOT NULL,
  zone text,
  lat double precision,
  lng double precision,
  trigger_method text,
  severity text DEFAULT 'critical'::text,
  battery_level integer,
  metadata jsonb,
  recorded_at timestamp with time zone NOT NULL,
  synced_at timestamp with time zone DEFAULT now(),
  accuracy double precision,
  network_status text,
  status text DEFAULT 'active'::text,
  resolved_at timestamp with time zone,
  emergency_id text,
  assigned_to text,
  dispatch_note text,
  dispatched_at timestamp with time zone,
  notes text,
  acknowledged_by uuid,
  acknowledged_at timestamp with time zone,
  assigned_by uuid,
  assigned_at timestamp with time zone,
  resolved_by uuid,
  resolution_note text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  review_note text,
  broadcast_by uuid,
  broadcast_at timestamp with time zone,
  broadcast_scope text,
  broadcast_message text,
  broadcast_recipients integer,
  forwarded_by uuid,
  forwarded_at timestamp with time zone,
  forwarded_to text
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_queue_pkey' AND conrelid = 'public.sos_queue'::regclass) THEN
    ALTER TABLE public.sos_queue ADD CONSTRAINT sos_queue_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_queue_acknowledged_by_fkey' AND conrelid = 'public.sos_queue'::regclass) THEN
    ALTER TABLE public.sos_queue ADD CONSTRAINT sos_queue_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES auth.users(id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_queue_assigned_by_fkey' AND conrelid = 'public.sos_queue'::regclass) THEN
    ALTER TABLE public.sos_queue ADD CONSTRAINT sos_queue_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_queue_company_id_fkey' AND conrelid = 'public.sos_queue'::regclass) THEN
    ALTER TABLE public.sos_queue ADD CONSTRAINT sos_queue_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_queue_employee_id_fkey' AND conrelid = 'public.sos_queue'::regclass) THEN
    ALTER TABLE public.sos_queue ADD CONSTRAINT sos_queue_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_queue_resolved_by_fkey' AND conrelid = 'public.sos_queue'::regclass) THEN
    ALTER TABLE public.sos_queue ADD CONSTRAINT sos_queue_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sos_company') THEN
    EXECUTE 'CREATE INDEX idx_sos_company ON public.sos_queue USING btree (company_id)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sos_status') THEN
    EXECUTE 'CREATE INDEX idx_sos_status ON public.sos_queue USING btree (status)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='sos_queue_broadcast_at_idx') THEN
    EXECUTE 'CREATE INDEX sos_queue_broadcast_at_idx ON public.sos_queue USING btree (broadcast_at DESC)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='sos_queue_reviewed_by_idx') THEN
    EXECUTE 'CREATE INDEX sos_queue_reviewed_by_idx ON public.sos_queue USING btree (reviewed_by, reviewed_at DESC)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='sos_queue_status_company_idx') THEN
    EXECUTE 'CREATE INDEX sos_queue_status_company_idx ON public.sos_queue USING btree (company_id, status)';
  END IF;
END $do$;

ALTER TABLE public.sos_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sos_queue_company_read ON public.sos_queue;
CREATE POLICY sos_queue_company_read ON public.sos_queue AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));
DROP POLICY IF EXISTS sos_queue_company_write ON public.sos_queue;
CREATE POLICY sos_queue_company_write ON public.sos_queue AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_member(company_id))
  WITH CHECK (is_company_member(company_id));

COMMENT ON COLUMN public.sos_queue.review_note IS '2026-04-24: tamper-evident note on who reviewed this incident from the dispatcher dashboard. Paired with an audit_log row.';

-- ──────────────────────────────────────────────────────────
-- sos_requests
-- G-31 (B-20): service-role only. Legacy queue; superseded by sos_sessions + sos_queue.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sos_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  note text,
  recipients jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  request_id text,
  status text NOT NULL DEFAULT 'NEW'::text,
  lng double precision,
  dispatched_at timestamp with time zone,
  error text
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_requests_pkey' AND conrelid = 'public.sos_requests'::regclass) THEN
    ALTER TABLE public.sos_requests ADD CONSTRAINT sos_requests_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_requests_request_id_key' AND conrelid = 'public.sos_requests'::regclass) THEN
    ALTER TABLE public.sos_requests ADD CONSTRAINT sos_requests_request_id_key UNIQUE (request_id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='sos_requests_request_id_idx') THEN
    EXECUTE 'CREATE INDEX sos_requests_request_id_idx ON public.sos_requests USING btree (request_id)';
  END IF;
END $do$;

ALTER TABLE public.sos_requests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.sos_requests IS 'G-31 (B-20): service-role only. Legacy queue; superseded by sos_sessions + sos_queue.';

-- ──────────────────────────────────────────────────────────
-- sos_sessions
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sos_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  context_type text,
  company_id uuid,
  status text NOT NULL DEFAULT 'active'::text,
  triggered_at timestamp with time zone DEFAULT now(),
  resolved_at timestamp with time zone,
  trigger_source text NOT NULL DEFAULT 'manual'::text,
  created_at timestamp with time zone DEFAULT now(),
  user_name text,
  user_phone text,
  tier text,
  started_at timestamp with time zone,
  last_heartbeat timestamp with time zone,
  lat double precision,
  lng double precision,
  last_lat double precision,
  last_lng double precision,
  accuracy double precision,
  address text,
  blood_type text,
  zone text,
  contact_count integer,
  silent_mode boolean,
  ai_script jsonb,
  battery_level integer,
  elapsed_sec integer,
  server_triggered_at timestamp with time zone,
  escalated boolean,
  escalation_stage text,
  bridge_dialed_at timestamp with time zone,
  contact_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  trace_id uuid,
  client_claimed_at timestamp with time zone,
  server_received_at timestamp with time zone,
  server_results jsonb,
  ended_at timestamp with time zone,
  end_reason text,
  recording_seconds integer,
  photo_count integer,
  comment text
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_sessions_pkey' AND conrelid = 'public.sos_sessions'::regclass) THEN
    ALTER TABLE public.sos_sessions ADD CONSTRAINT sos_sessions_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_sessions_status_check' AND conrelid = 'public.sos_sessions'::regclass) THEN
    ALTER TABLE public.sos_sessions ADD CONSTRAINT sos_sessions_status_check CHECK (((status IS NULL) OR (status = ANY (ARRAY['prewarm'::text, 'active'::text, 'escalated'::text, 'resolved'::text, 'canceled'::text, 'cancelled'::text, 'ended'::text]))));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_sessions_user_id_fkey' AND conrelid = 'public.sos_sessions'::regclass) THEN
    ALTER TABLE public.sos_sessions ADD CONSTRAINT sos_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sos_sessions_trace_id') THEN
    EXECUTE 'CREATE INDEX idx_sos_sessions_trace_id ON public.sos_sessions USING btree (trace_id) WHERE (trace_id IS NOT NULL)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sos_sessions_user_active') THEN
    EXECUTE 'CREATE INDEX idx_sos_sessions_user_active ON public.sos_sessions USING btree (user_id, status, triggered_at DESC)';
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='sos_sessions_ended_at_idx') THEN
    EXECUTE 'CREATE INDEX sos_sessions_ended_at_idx ON public.sos_sessions USING btree (ended_at DESC) WHERE (ended_at IS NOT NULL)';
  END IF;
END $do$;

ALTER TABLE public.sos_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sos_sessions_company_read ON public.sos_sessions;
CREATE POLICY sos_sessions_company_read ON public.sos_sessions AS PERMISSIVE FOR SELECT TO authenticated
  USING (((company_id IS NOT NULL) AND is_company_member(company_id)));
DROP POLICY IF EXISTS sos_sessions_self_read ON public.sos_sessions;
CREATE POLICY sos_sessions_self_read ON public.sos_sessions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));
DROP POLICY IF EXISTS sos_sessions_self_write ON public.sos_sessions;
CREATE POLICY sos_sessions_self_write ON public.sos_sessions AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

COMMENT ON COLUMN public.sos_sessions.bridge_dialed_at IS 'G-27 (B-20): set atomically by sos-bridge-twiml when it dials the SOS user into the conference. Subsequent accept retries see non-null and skip the dial.';
COMMENT ON COLUMN public.sos_sessions.contact_snapshot IS 'C-7 (2026-04-27): exact list of contacts dialed at trigger time. Each entry: {name, phone (E.164), relation, normalized_at}. Used for forensic audit AND for retry/escalation drift detection. Never mutated after the SOS starts.';
COMMENT ON COLUMN public.sos_sessions.trace_id IS 'L1-A observability: UUID v4 generated at SOS button press, propagated through every layer for end-to-end forensic reconstruction. NULL on rows pre-dating this migration.';
COMMENT ON COLUMN public.sos_sessions.client_claimed_at IS 'L1-B observability: client wall-clock timestamp at the moment the user pressed SOS. Compared against server_received_at to detect clock skew, offline replay (>30s), or clock manipulation (<0).';
COMMENT ON COLUMN public.sos_sessions.server_received_at IS 'L1-B observability: server wall-clock timestamp at the moment sos-alert edge function received the trigger HTTP request. Authoritative for forensic timing analysis.';
COMMENT ON COLUMN public.sos_sessions.server_results IS 'R-4a (2026-05-14): per-contact dispatch outcomes captured at sos-alert fanout completion.';
COMMENT ON COLUMN public.sos_sessions.ended_at IS 'R-4a (2026-05-14): server time when sos-alert?action=end successfully ended the session.';
COMMENT ON COLUMN public.sos_sessions.end_reason IS 'R-4a (2026-05-14): free-text reason captured from the End SOS button or watchdog auto-resolve.';
COMMENT ON COLUMN public.sos_sessions.recording_seconds IS 'R-4a (2026-05-14): total seconds of voice recording captured during the SOS session.';
COMMENT ON COLUMN public.sos_sessions.photo_count IS 'R-4a (2026-05-14): number of forensic photos uploaded during + immediately after the SOS.';
COMMENT ON COLUMN public.sos_sessions.comment IS 'R-4a (2026-05-14): optional free-text comment from the user at End SOS.';

-- ──────────────────────────────────────────────────────────
-- sos_timers
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sos_timers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ends_at timestamp with time zone NOT NULL,
  confirmed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sos_timers_pkey' AND conrelid = 'public.sos_timers'::regclass) THEN
    ALTER TABLE public.sos_timers ADD CONSTRAINT sos_timers_pkey PRIMARY KEY (id);
  END IF;
END $do$;


ALTER TABLE public.sos_timers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sos_timers_self ON public.sos_timers;
CREATE POLICY sos_timers_self ON public.sos_timers AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));


-- ──────────────────────────────────────────────────────────
-- step_activity
-- G-31 (B-20): service-role only. IRE step activity log.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.step_activity (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  instance_id uuid,
  step_id uuid,
  assigned_to uuid,
  started_at timestamp with time zone,
  completed_at timestamp with time zone
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'step_activity_pkey' AND conrelid = 'public.step_activity'::regclass) THEN
    ALTER TABLE public.step_activity ADD CONSTRAINT step_activity_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'step_activity_assigned_to_fkey' AND conrelid = 'public.step_activity'::regclass) THEN
    ALTER TABLE public.step_activity ADD CONSTRAINT step_activity_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'step_activity_instance_id_fkey' AND conrelid = 'public.step_activity'::regclass) THEN
    ALTER TABLE public.step_activity ADD CONSTRAINT step_activity_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES process_instances(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'step_activity_step_id_fkey' AND conrelid = 'public.step_activity'::regclass) THEN
    ALTER TABLE public.step_activity ADD CONSTRAINT step_activity_step_id_fkey FOREIGN KEY (step_id) REFERENCES process_steps(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_activity_instance') THEN
    EXECUTE 'CREATE INDEX idx_activity_instance ON public.step_activity USING btree (instance_id)';
  END IF;
END $do$;

ALTER TABLE public.step_activity ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.step_activity IS 'G-31 (B-20): service-role only. IRE step activity log.';

-- ──────────────────────────────────────────────────────────
-- system_logs
-- G-31 (B-20): service-role only. Internal operational logging.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.system_logs (
  id bigint NOT NULL DEFAULT nextval('system_logs_id_seq'::regclass),
  scope text NOT NULL,
  ref_id text,
  action text NOT NULL,
  details jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'system_logs_pkey' AND conrelid = 'public.system_logs'::regclass) THEN
    ALTER TABLE public.system_logs ADD CONSTRAINT system_logs_pkey PRIMARY KEY (id);
  END IF;
END $do$;


ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.system_logs IS 'G-31 (B-20): service-role only. Internal operational logging.';

-- ──────────────────────────────────────────────────────────
-- tasks
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active'::text,
  expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_pkey' AND conrelid = 'public.tasks'::regclass) THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_status_check' AND conrelid = 'public.tasks'::regclass) THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'canceled'::text])));
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_company_id_fkey' AND conrelid = 'public.tasks'::regclass) THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_user_id_fkey' AND conrelid = 'public.tasks'::regclass) THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_tasks_company') THEN
    EXECUTE 'CREATE INDEX idx_tasks_company ON public.tasks USING btree (company_id)';
  END IF;
END $do$;

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tasks_member_read ON public.tasks;
CREATE POLICY tasks_member_read ON public.tasks AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));
DROP POLICY IF EXISTS tasks_member_write ON public.tasks;
CREATE POLICY tasks_member_write ON public.tasks AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_member(company_id))
  WITH CHECK (is_company_member(company_id));
DROP POLICY IF EXISTS tasks_own_company ON public.tasks;
CREATE POLICY tasks_own_company ON public.tasks AS PERMISSIVE FOR ALL TO public
  USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));


-- ──────────────────────────────────────────────────────────
-- trip_checkins
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trip_checkins (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  trip_id bigint,
  latitude double precision,
  longitude double precision,
  battery_level integer,
  note text,
  created_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_checkins_pkey' AND conrelid = 'public.trip_checkins'::regclass) THEN
    ALTER TABLE public.trip_checkins ADD CONSTRAINT trip_checkins_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_checkins_trip_id_fkey' AND conrelid = 'public.trip_checkins'::regclass) THEN
    ALTER TABLE public.trip_checkins ADD CONSTRAINT trip_checkins_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES safe_trips(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_trip_checkins_trip') THEN
    EXECUTE 'CREATE INDEX idx_trip_checkins_trip ON public.trip_checkins USING btree (trip_id)';
  END IF;
END $do$;

ALTER TABLE public.trip_checkins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own checkins" ON public.trip_checkins;
CREATE POLICY "Users manage own checkins" ON public.trip_checkins AS PERMISSIVE FOR ALL TO public
  USING ((trip_id IN ( SELECT safe_trips.id
   FROM safe_trips
  WHERE (safe_trips.user_id = auth.uid()))));


-- ──────────────────────────────────────────────────────────
-- user_contacts
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  priority integer NOT NULL,
  name text NOT NULL,
  phone text,
  whatsapp text,
  email text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_contacts_pkey' AND conrelid = 'public.user_contacts'::regclass) THEN
    ALTER TABLE public.user_contacts ADD CONSTRAINT user_contacts_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_contacts_user_id_priority_key' AND conrelid = 'public.user_contacts'::regclass) THEN
    ALTER TABLE public.user_contacts ADD CONSTRAINT user_contacts_user_id_priority_key UNIQUE (user_id, priority);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_contacts_priority_check' AND conrelid = 'public.user_contacts'::regclass) THEN
    ALTER TABLE public.user_contacts ADD CONSTRAINT user_contacts_priority_check CHECK (((priority >= 1) AND (priority <= 3)));
  END IF;
END $do$;


ALTER TABLE public.user_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_contacts_self ON public.user_contacts;
CREATE POLICY user_contacts_self ON public.user_contacts AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));


-- ──────────────────────────────────────────────────────────
-- user_permissions
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_permissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  user_id uuid,
  permissions text[] DEFAULT '{}'::text[],
  level text DEFAULT 'zone_admin'::text,
  role text DEFAULT 'shift_supervisor'::text,
  assigned_zones text[] DEFAULT '{}'::text[],
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_permissions_pkey' AND conrelid = 'public.user_permissions'::regclass) THEN
    ALTER TABLE public.user_permissions ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_permissions_company_id_user_id_key' AND conrelid = 'public.user_permissions'::regclass) THEN
    ALTER TABLE public.user_permissions ADD CONSTRAINT user_permissions_company_id_user_id_key UNIQUE (company_id, user_id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_permissions_company_id_fkey' AND conrelid = 'public.user_permissions'::regclass) THEN
    ALTER TABLE public.user_permissions ADD CONSTRAINT user_permissions_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_permissions_updated_by_fkey' AND conrelid = 'public.user_permissions'::regclass) THEN
    ALTER TABLE public.user_permissions ADD CONSTRAINT user_permissions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_permissions_user_id_fkey' AND conrelid = 'public.user_permissions'::regclass) THEN
    ALTER TABLE public.user_permissions ADD CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_perms_company') THEN
    EXECUTE 'CREATE INDEX idx_perms_company ON public.user_permissions USING btree (company_id)';
  END IF;
END $do$;

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS permissions_owner_admin ON public.user_permissions;
CREATE POLICY permissions_owner_admin ON public.user_permissions AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_owner(company_id))
  WITH CHECK (is_company_owner(company_id));
DROP POLICY IF EXISTS permissions_self_read ON public.user_permissions;
CREATE POLICY permissions_self_read ON public.user_permissions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));
DROP POLICY IF EXISTS user_permissions_all ON public.user_permissions;
CREATE POLICY user_permissions_all ON public.user_permissions AS PERMISSIVE FOR ALL TO public
  USING (((company_id IN ( SELECT companies.id
   FROM companies
  WHERE (companies.owner_id = auth.uid()))) OR (user_id = auth.uid())));


-- ──────────────────────────────────────────────────────────
-- zone_reports
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zone_reports (
  id bigint NOT NULL DEFAULT nextval('zone_reports_id_seq'::regclass),
  user_id uuid,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  reason text NOT NULL,
  description text,
  votes_agree integer DEFAULT 0,
  votes_disagree integer DEFAULT 0,
  is_verified boolean DEFAULT false,
  expires_at timestamp with time zone DEFAULT (now() + '90 days'::interval),
  created_at timestamp with time zone DEFAULT now()
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zone_reports_pkey' AND conrelid = 'public.zone_reports'::regclass) THEN
    ALTER TABLE public.zone_reports ADD CONSTRAINT zone_reports_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zone_reports_user_id_fkey' AND conrelid = 'public.zone_reports'::regclass) THEN
    ALTER TABLE public.zone_reports ADD CONSTRAINT zone_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_zone_reports_location') THEN
    EXECUTE 'CREATE INDEX idx_zone_reports_location ON public.zone_reports USING btree (lat, lon)';
  END IF;
END $do$;

ALTER TABLE public.zone_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users create zone reports" ON public.zone_reports;
CREATE POLICY "Users create zone reports" ON public.zone_reports AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
DROP POLICY IF EXISTS zone_reports_own ON public.zone_reports;
CREATE POLICY zone_reports_own ON public.zone_reports AS PERMISSIVE FOR ALL TO public
  USING ((user_id = auth.uid()));
DROP POLICY IF EXISTS zone_reports_self_read ON public.zone_reports;
CREATE POLICY zone_reports_self_read ON public.zone_reports AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));


-- ──────────────────────────────────────────────────────────
-- zones
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  name text NOT NULL,
  name_ar text,
  type text DEFAULT 'standard'::text,
  risk_level text DEFAULT 'low'::text,
  capacity integer DEFAULT 50,
  lat double precision,
  lon double precision,
  radius integer DEFAULT 100,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  evacuation_point text,
  evac_lat double precision,
  evac_lng double precision,
  radius_meters integer,
  lng double precision,
  employee_count integer DEFAULT 0,
  active_alerts integer DEFAULT 0,
  status text DEFAULT 'active'::text
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zones_pkey' AND conrelid = 'public.zones'::regclass) THEN
    ALTER TABLE public.zones ADD CONSTRAINT zones_pkey PRIMARY KEY (id);
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zones_company_id_fkey' AND conrelid = 'public.zones'::regclass) THEN
    ALTER TABLE public.zones ADD CONSTRAINT zones_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_zones_company') THEN
    EXECUTE 'CREATE INDEX idx_zones_company ON public.zones USING btree (company_id)';
  END IF;
END $do$;

ALTER TABLE public.zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS zones_all ON public.zones;
CREATE POLICY zones_all ON public.zones AS PERMISSIVE FOR ALL TO public
  USING ((company_id IN ( SELECT companies.id
   FROM companies
  WHERE (companies.owner_id = auth.uid()))));
DROP POLICY IF EXISTS zones_member_read ON public.zones;
CREATE POLICY zones_member_read ON public.zones AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_company_member(company_id));
DROP POLICY IF EXISTS zones_owner_write ON public.zones;
CREATE POLICY zones_owner_write ON public.zones AS PERMISSIVE FOR ALL TO authenticated
  USING (is_company_owner(company_id))
  WITH CHECK (is_company_owner(company_id));


-- ──────────────────────────────────────────────────────────
-- _migration_rollback_snapshots
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public._migration_rollback_snapshots (
  snapshot_id text NOT NULL,
  taken_at timestamp with time zone NOT NULL DEFAULT now(),
  function_name text NOT NULL,
  function_args text NOT NULL,
  function_body text NOT NULL,
  reason text NOT NULL
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_migration_rollback_snapshots_pkey' AND conrelid = 'public._migration_rollback_snapshots'::regclass) THEN
    ALTER TABLE public._migration_rollback_snapshots ADD CONSTRAINT _migration_rollback_snapshots_pkey PRIMARY KEY (snapshot_id);
  END IF;
END $do$;


ALTER TABLE public._migration_rollback_snapshots ENABLE ROW LEVEL SECURITY;


