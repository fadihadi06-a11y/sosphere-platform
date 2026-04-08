-- ═══════════════════════════════════════════════════════════════════════════
-- SOSphere — Immutable Audit Trail Table (Append-Only)
-- ISO 27001 §A.12.4 — Event Logging & Protection of Log Information
-- ═══════════════════════════════════════════════════════════════════════════
--
-- This table implements an immutable, append-only audit log using:
--   - RLS policies that DENY all UPDATE and DELETE operations
--   - Only INSERT and SELECT (for admins) are allowed
--   - Checksums create a blockchain-like chain for tamper detection
--   - All timestamps in UTC (ISO 8601)
--
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop existing table if migrating
DROP TABLE IF EXISTS audit_log CASCADE;

-- Create the immutable audit log table
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TEXT NOT NULL,                                  -- ISO 8601 timestamp
  timestampMs BIGINT NOT NULL,                              -- Milliseconds since epoch (for sorting)

  -- Actor (who performed the action)
  actor JSONB NOT NULL,                                     -- {userId, email, role, displayName}

  -- Action (what was done)
  action VARCHAR(50) NOT NULL,                              -- SensitiveAction enum value
  severity VARCHAR(10) NOT NULL DEFAULT 'info',             -- 'info', 'warning', 'critical'

  -- Target (what was affected)
  target JSONB,                                             -- {type, id, name} or null

  -- Metadata and forensics
  metadata JSONB,                                           -- Additional context
  deviceId VARCHAR(100),                                    -- Device fingerprint
  ipHash VARCHAR(255),                                      -- SHA-256 hash of IP
  userAgent VARCHAR(500),                                   -- Browser user agent

  -- Checksum chain (tamper detection)
  checksum VARCHAR(255) NOT NULL,                           -- SHA-256 of this entry
  previousChecksum VARCHAR(255) NOT NULL DEFAULT '',        -- SHA-256 of previous entry (chain link)

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  company_id UUID                                           -- For multi-tenant isolation (optional)
);

-- Enable Row Level Security
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- ── RLS Policy 1: Allow authenticated users to INSERT ──
CREATE POLICY "audit_insert_authenticated"
  ON audit_log
  FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
  );

-- ── RLS Policy 2: DENY all UPDATE operations (immutable) ──
CREATE POLICY "audit_no_update"
  ON audit_log
  FOR UPDATE
  WITH CHECK (false);  -- This policy always denies, making the table immutable

-- ── RLS Policy 3: DENY all DELETE operations (immutable) ──
CREATE POLICY "audit_no_delete"
  ON audit_log
  FOR DELETE
  WITH CHECK (false);  -- This policy always denies

-- ── RLS Policy 4: Allow admins to SELECT audit logs ──
CREATE POLICY "audit_select_admin"
  ON audit_log
  FOR SELECT
  USING (
    -- Check if user has admin or compliance role in their JWT claims
    auth.jwt() ->> 'role' IN ('admin', 'compliance_officer')
    OR (auth.jwt() ->> 'role' = 'owner')
  );

-- ── Indexes for efficient querying ──

-- Index on timestamp for range queries (e.g., logs from date X to Y)
CREATE INDEX idx_audit_log_timestamp ON audit_log(timestampMs DESC);

-- Index on actor.userId for filtering by user
CREATE INDEX idx_audit_log_actor_user_id ON audit_log USING GIN(actor);

-- Index on action for filtering by action type
CREATE INDEX idx_audit_log_action ON audit_log(action);

-- Index on severity for finding critical events
CREATE INDEX idx_audit_log_severity ON audit_log(severity);

-- Composite index for common query pattern: (actor + timestamp)
CREATE INDEX idx_audit_log_actor_timestamp ON audit_log((actor->>'userId'), timestampMs DESC);

-- ── Comments for documentation ──

COMMENT ON TABLE audit_log IS
  'Immutable append-only audit trail for ISO 27001 compliance. '
  'RLS policies prevent all modifications after creation. '
  'Checksum chain detects tampering.';

COMMENT ON COLUMN audit_log.id IS
  'Unique identifier for this audit entry (UUID)';

COMMENT ON COLUMN audit_log.timestamp IS
  'ISO 8601 timestamp when the event occurred';

COMMENT ON COLUMN audit_log.timestampMs IS
  'Unix timestamp in milliseconds (for efficient sorting)';

COMMENT ON COLUMN audit_log.actor IS
  'JSON object with userId, email, role, displayName of the actor';

COMMENT ON COLUMN audit_log.action IS
  'The sensitive action performed (e.g., sos_viewed, user_deleted)';

COMMENT ON COLUMN audit_log.target IS
  'JSON object describing what was affected: {type, id, name}';

COMMENT ON COLUMN audit_log.deviceId IS
  'Stable fingerprint of the device (browser + screen size + timezone)';

COMMENT ON COLUMN audit_log.ipHash IS
  'Privacy-preserving SHA-256 hash of the source IP address';

COMMENT ON COLUMN audit_log.checksum IS
  'SHA-256(timestamp|action|actorId|targetId|previousChecksum) — detects tampering';

COMMENT ON COLUMN audit_log.previousChecksum IS
  'Checksum of the previous entry — creates blockchain-like chain for integrity verification';

-- ── Verification View: Check chain integrity ──
-- This view can be used to verify that the checksum chain is unbroken
CREATE OR REPLACE VIEW audit_log_chain_verification AS
SELECT
  current.id,
  current.timestamp,
  current.action,
  current.actor->>'userId' as actor_user_id,
  current.checksum,
  current.previousChecksum,
  -- Flag any break in the chain
  CASE
    WHEN current.previousChecksum = '' THEN 'CHAIN_START'
    WHEN prev.checksum = current.previousChecksum THEN 'CHAIN_VALID'
    ELSE 'CHAIN_BREAK_DETECTED'
  END as chain_status,
  -- If we can't find the previous entry, that's also a break
  COALESCE(prev.id, 'MISSING') as prev_entry_id
FROM
  audit_log current
LEFT JOIN
  audit_log prev ON prev.checksum = current.previousChecksum
ORDER BY
  current.timestampMs ASC;

COMMENT ON VIEW audit_log_chain_verification IS
  'Verification view to detect breaks in the audit trail checksum chain. '
  'Should show CHAIN_VALID for all entries. Any CHAIN_BREAK_DETECTED indicates tampering.';

-- ── Grants ──
-- Audit log table should only be accessible to authenticated users and admins
-- RLS policies handle the granular access control

GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON TABLE audit_log TO anon;  -- RLS policies will restrict
GRANT INSERT ON TABLE audit_log TO authenticated;

GRANT SELECT ON audit_log_chain_verification TO authenticated;
