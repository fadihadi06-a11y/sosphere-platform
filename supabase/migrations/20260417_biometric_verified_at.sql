-- S-H2: server-side biometric verification timestamp
CREATE TABLE IF NOT EXISTS biometric_verifications (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_verified_method TEXT CHECK (last_verified_method IN ('webauthn','fingerprint','face','pin')),
  device_fingerprint_hash TEXT
);
ALTER TABLE biometric_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "biometric_verifications_self" ON biometric_verifications FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
