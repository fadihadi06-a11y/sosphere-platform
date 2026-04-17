-- S-H4: server-side onboarding completion flag
ALTER TABLE IF EXISTS profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE IF EXISTS profiles ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
