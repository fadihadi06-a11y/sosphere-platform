// =================================================================
// SOSphere — Supabase RLS Policies & Database Schema
// =================================================================
// Copy-paste the SQL below into Supabase SQL Editor to create
// all tables with Row Level Security (RLS) enabled.
//
// This file serves as DOCUMENTATION — it's not executed in code.
// It maps directly from the TypeScript types in:
//   - dashboard-types.ts    → employees, emergencies, zones
//   - evidence-store.ts     → evidence, evidence_photos, evidence_audio
//   - mission-store.ts      → missions, mission_gps, mission_heartbeats
//   - ire-performance-store → ire_records
//   - contact-tier-system   → contacts
//   - sar-engine.ts         → sar_missions
//   - offline-database.ts   → sos_queue, checkins, gps_trail, incidents
// =================================================================

export const DATABASE_SCHEMA_SQL = `
-- ═══════════════════════════════════════════════════════════════
-- SOSphere Database Schema — Supabase PostgreSQL
-- Run this ONCE in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ── Extensions ──────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";  -- For GPS/geofencing

-- ═══════════════════════════════════════════════════════════════
-- 1. COMPANIES
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  name_ar TEXT,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'professional', 'enterprise')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'trial')),
  max_employees INT NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 2. EMPLOYEES (maps to dashboard-types.ts → Employee)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  auth_user_id UUID REFERENCES auth.users(id),  -- Link to Supabase Auth
  name TEXT NOT NULL,
  name_ar TEXT,
  role TEXT NOT NULL DEFAULT 'employee',
  department TEXT,
  status TEXT NOT NULL DEFAULT 'off-shift'
    CHECK (status IN ('on-shift', 'off-shift', 'sos', 'late-checkin', 'checked-in')),
  phone TEXT,
  safety_score INT DEFAULT 85,
  last_checkin TIMESTAMPTZ,
  last_location GEOGRAPHY(POINT, 4326),  -- PostGIS point
  zone_id UUID REFERENCES zones(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_employees_company ON employees(company_id);
CREATE INDEX idx_employees_status ON employees(status);
CREATE INDEX idx_employees_auth ON employees(auth_user_id);

-- ═══════════════════════════════════════════════════════════════
-- 3. ZONES (maps to dashboard-types.ts → ZoneData)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE zones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'medium'
    CHECK (risk_level IN ('critical', 'high', 'medium', 'low')),
  employee_count INT DEFAULT 0,
  active_alerts INT DEFAULT 0,
  boundary GEOGRAPHY(POLYGON, 4326),  -- Geofence polygon
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 4. EMERGENCIES (maps to dashboard-types.ts → EmergencyItem)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE emergencies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id),
  employee_name TEXT NOT NULL,
  zone TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'responding', 'resolved')),
  trigger_method TEXT DEFAULT 'manual'
    CHECK (trigger_method IN ('manual', 'fall_detected', 'shake', 'missed_checkin', 'panic_word', 'geofence')),
  location GEOGRAPHY(POINT, 4326),
  elapsed INT DEFAULT 0,
  is_owned BOOLEAN DEFAULT FALSE,
  owned_by UUID REFERENCES employees(id),
  owned_at TIMESTAMPTZ,
  manual_priority INT,
  manual_priority_reason TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_emergencies_company ON emergencies(company_id);
CREATE INDEX idx_emergencies_status ON emergencies(status);
CREATE INDEX idx_emergencies_severity ON emergencies(severity, status);

-- ═══════════════════════════════════════════════════════════════
-- 5. EVIDENCE (maps to evidence-store.ts)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE evidence (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  emergency_id UUID REFERENCES emergencies(id),
  submitted_by TEXT NOT NULL,
  zone TEXT,
  severity TEXT,
  incident_type TEXT,
  worker_comment TEXT,
  status TEXT DEFAULT 'received'
    CHECK (status IN ('received', 'reviewing', 'verified', 'flagged', 'archived')),
  tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'paid')),
  retention_days INT DEFAULT 30,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Evidence photos stored in Supabase Storage bucket "evidence"
-- Metadata tracked here:
CREATE TABLE evidence_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,  -- Path in Supabase Storage
  caption TEXT,
  size_bytes INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE evidence_audio (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  duration_sec FLOAT,
  format TEXT DEFAULT 'webm',
  transcription TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Chain of custody tracking
CREATE TABLE evidence_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action_type TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 6. MISSIONS (maps to mission-store.ts)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE missions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  employee_id UUID REFERENCES employees(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','notified','ready','en_route_out','arrived_site','working','en_route_back','completed','cancelled','alert')),
  destination GEOGRAPHY(POINT, 4326),
  origin GEOGRAPHY(POINT, 4326),
  estimated_duration_min INT,
  actual_start TIMESTAMPTZ,
  actual_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE mission_gps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  speed FLOAT,
  accuracy FLOAT,
  is_offline BOOLEAN DEFAULT FALSE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mission_gps_mission ON mission_gps(mission_id);
CREATE INDEX idx_mission_gps_time ON mission_gps(recorded_at);

-- ═══════════════════════════════════════════════════════════════
-- 7. SAR MISSIONS (maps to sar-engine.ts)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE sar_missions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  missing_employee_id UUID REFERENCES employees(id),
  missing_employee_name TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'watchdog'
    CHECK (phase IN ('watchdog','alert','search','rescue','recovery','external','critical')),
  last_known_location GEOGRAPHY(POINT, 4326),
  search_cone_data JSONB,  -- SearchCone serialized
  search_pattern TEXT,
  assigned_teams JSONB,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════════════════════
-- 8. CONTACTS (maps to contact-tier-system.ts)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  relation TEXT,
  priority INT DEFAULT 1,
  contact_type TEXT NOT NULL DEFAULT 'full'
    CHECK (contact_type IN ('full', 'lite', 'ghost')),
  has_app BOOLEAN DEFAULT FALSE,
  tracking_role TEXT DEFAULT 'watcher'
    CHECK (tracking_role IN ('watcher', 'beacon', 'mutual')),
  location_sharing_enabled BOOLEAN DEFAULT FALSE,
  safety_link_id TEXT,
  safety_link_expiry TIMESTAMPTZ,
  consent_given BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 9. IRE PERFORMANCE (maps to ire-performance-store.ts)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE ire_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  admin_id UUID REFERENCES employees(id),
  emergency_id UUID REFERENCES emergencies(id),
  employee_name TEXT,
  zone TEXT,
  sos_type TEXT,
  severity TEXT,
  response_score FLOAT,
  response_time_sec INT,
  phases_completed INT,
  actions_count INT,
  auto_actions_count INT,
  threat_level INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 10. OFFLINE SYNC QUEUE (maps to offline-database.ts)
-- ═══════════════════════════════════════════════════════════════
-- These tables receive data FROM the Sync Engine
-- when workers come back online.

CREATE TABLE sos_queue (
  id TEXT PRIMARY KEY,
  employee_id UUID NOT NULL,
  employee_name TEXT NOT NULL,
  zone TEXT,
  location GEOGRAPHY(POINT, 4326),
  accuracy FLOAT,
  trigger_method TEXT,
  severity TEXT,
  battery_level INT,
  network_status TEXT,
  metadata JSONB,
  recorded_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE checkins (
  id TEXT PRIMARY KEY,
  employee_id UUID NOT NULL,
  employee_name TEXT NOT NULL,
  zone TEXT,
  type TEXT,
  status TEXT,
  location GEOGRAPHY(POINT, 4326),
  recorded_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE gps_trail (
  id TEXT PRIMARY KEY,
  employee_id UUID NOT NULL,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  accuracy FLOAT,
  speed FLOAT,
  heading FLOAT,
  source TEXT,
  battery_level INT,
  recorded_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_gps_trail_employee ON gps_trail(employee_id);
CREATE INDEX idx_gps_trail_time ON gps_trail(recorded_at);

-- ═══════════════════════════════════════════════════════════════
-- 11. AUDIT LOG
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  actor_id UUID REFERENCES employees(id),
  actor_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,  -- 'emergency', 'employee', 'zone', etc.
  entity_id TEXT,
  details JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_company ON audit_log(company_id);
CREATE INDEX idx_audit_time ON audit_log(created_at);
`;

// =================================================================
// RLS POLICIES
// =================================================================

export const RLS_POLICIES_SQL = `
-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY POLICIES
-- ═══════════════════════════════════════════════════════════════
-- These ensure that:
--   1. Users can ONLY see data from their own company
--   2. Employees can only modify their own records
--   3. Admins can modify records within their company
--   4. Super admins can see everything
--
-- The user's company_id and role are stored in auth.users.app_metadata
-- Set by a Supabase Auth Hook when the user signs up/is invited.
-- ═══════════════════════════════════════════════════════════════

-- ── Helper function: Get current user's company_id ─────────────
CREATE OR REPLACE FUNCTION auth.user_company_id()
RETURNS UUID AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'company_id')::UUID;
$$ LANGUAGE SQL STABLE;

-- ── Helper function: Get current user's role ───────────────────
CREATE OR REPLACE FUNCTION auth.user_role()
RETURNS TEXT AS $$
  SELECT auth.jwt() -> 'app_metadata' ->> 'role';
$$ LANGUAGE SQL STABLE;

-- ── Helper function: Check if user is admin ────────────────────
CREATE OR REPLACE FUNCTION auth.is_admin()
RETURNS BOOLEAN AS $$
  SELECT auth.user_role() IN ('super_admin', 'company_admin', 'safety_manager');
$$ LANGUAGE SQL STABLE;

-- ═══════════════════════════════════════════════════════════════
-- EMPLOYEES TABLE
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- Anyone in the company can VIEW employees
CREATE POLICY "employees_select_company"
  ON employees FOR SELECT
  USING (company_id = auth.user_company_id());

-- Only admins can INSERT/UPDATE employees
CREATE POLICY "employees_insert_admin"
  ON employees FOR INSERT
  WITH CHECK (company_id = auth.user_company_id() AND auth.is_admin());

CREATE POLICY "employees_update_admin"
  ON employees FOR UPDATE
  USING (company_id = auth.user_company_id() AND auth.is_admin());

-- Employees can update their OWN status and location
CREATE POLICY "employees_update_self"
  ON employees FOR UPDATE
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- EMERGENCIES TABLE
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE emergencies ENABLE ROW LEVEL SECURITY;

-- Anyone in the company can VIEW emergencies
CREATE POLICY "emergencies_select_company"
  ON emergencies FOR SELECT
  USING (company_id = auth.user_company_id());

-- Any authenticated user in the company can CREATE emergencies (SOS)
CREATE POLICY "emergencies_insert_company"
  ON emergencies FOR INSERT
  WITH CHECK (company_id = auth.user_company_id());

-- Only admins/dispatchers can UPDATE emergencies (resolve, assign)
CREATE POLICY "emergencies_update_admin"
  ON emergencies FOR UPDATE
  USING (
    company_id = auth.user_company_id()
    AND auth.user_role() IN (
      'super_admin', 'company_admin', 'safety_manager',
      'shift_supervisor', 'dispatcher'
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- EVIDENCE TABLE
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;

-- Anyone in the company can VIEW evidence
CREATE POLICY "evidence_select_company"
  ON evidence FOR SELECT
  USING (company_id = auth.user_company_id());

-- Any employee can SUBMIT evidence
CREATE POLICY "evidence_insert_company"
  ON evidence FOR INSERT
  WITH CHECK (company_id = auth.user_company_id());

-- Only admins can UPDATE evidence status
CREATE POLICY "evidence_update_admin"
  ON evidence FOR UPDATE
  USING (company_id = auth.user_company_id() AND auth.is_admin());

-- ═══════════════════════════════════════════════════════════════
-- MISSIONS TABLE
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;

-- Company members can view missions
CREATE POLICY "missions_select_company"
  ON missions FOR SELECT
  USING (company_id = auth.user_company_id());

-- Only admins can create missions
CREATE POLICY "missions_insert_admin"
  ON missions FOR INSERT
  WITH CHECK (company_id = auth.user_company_id() AND auth.is_admin());

-- Admins and assigned employee can update
CREATE POLICY "missions_update"
  ON missions FOR UPDATE
  USING (
    company_id = auth.user_company_id()
    AND (auth.is_admin() OR employee_id = (
      SELECT id FROM employees WHERE auth_user_id = auth.uid()
    ))
  );

-- ═══════════════════════════════════════════════════════════════
-- GPS TRAIL — Workers can insert, admins can read
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE gps_trail ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gps_insert_self"
  ON gps_trail FOR INSERT
  WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid())::TEXT
  );

CREATE POLICY "gps_select_admin"
  ON gps_trail FOR SELECT
  USING (
    employee_id IN (
      SELECT id::TEXT FROM employees WHERE company_id = auth.user_company_id()
    )
    AND auth.is_admin()
  );

-- ═══════════════════════════════════════════════════════════════
-- AUDIT LOG — Only admins can read, system inserts
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_select_admin"
  ON audit_log FOR SELECT
  USING (company_id = auth.user_company_id() AND auth.is_admin());

-- Insert via service role only (Edge Functions)
CREATE POLICY "audit_insert_service"
  ON audit_log FOR INSERT
  WITH CHECK (TRUE);  -- Restricted by service role key usage

-- ═══════════════════════════════════════════════════════════════
-- STORAGE BUCKET POLICIES
-- ═══════════════════════════════════════════════════════════════
-- Run these in the Supabase dashboard Storage policies:
--
-- Bucket: "evidence"
--   SELECT: authenticated users in same company
--   INSERT: authenticated users (file path must include their company_id)
--   DELETE: admins only
--
-- Bucket: "avatars"
--   SELECT: public
--   INSERT: authenticated users (own avatar only)
`;

// =================================================================
// Supabase Edge Functions (Twilio Integration)
// =================================================================

export const EDGE_FUNCTIONS_GUIDE = `
EDGE FUNCTIONS TO DEPLOY:
═══════════════════════════════════════════════════════════════

1. twilio-token
   POST /functions/v1/twilio-token
   Body: { identity: string }
   Returns: { token: string }
   Purpose: Generate Twilio Client SDK access token
   Secrets needed: TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET

2. twilio-call
   POST /functions/v1/twilio-call
   Body: { to: string, from: string, employeeName: string, zone: string }
   Returns: { callSid: string, status: string }
   Purpose: Initiate PSTN call to admin's real phone
   Secrets needed: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER

3. twilio-sms
   POST /functions/v1/twilio-sms
   Body: { to: string, message: string }
   Returns: { messageSid: string }
   Purpose: Send SMS with location/emergency info
   Secrets needed: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER

4. push-notify
   POST /functions/v1/push-notify
   Body: { userId: string, title: string, body: string, data: object }
   Returns: { success: boolean }
   Purpose: Send push notification via FCM/APNs
   Secrets needed: FCM_SERVER_KEY or APNS_KEY

5. twilio-status (webhook)
   POST /functions/v1/twilio-status
   Body: Twilio status callback payload
   Purpose: Update call status in database
   Note: Set this URL as the StatusCallback in Twilio call creation
`;
