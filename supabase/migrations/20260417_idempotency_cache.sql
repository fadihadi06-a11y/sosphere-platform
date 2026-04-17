-- B-C4/B-H1: request-scoped idempotency for edge functions
CREATE TABLE IF NOT EXISTS idempotency_cache (
  function_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  response_body JSONB NOT NULL,
  response_status INT NOT NULL DEFAULT 200,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  PRIMARY KEY (function_name, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_cache_expires ON idempotency_cache(expires_at);
ALTER TABLE idempotency_cache ENABLE ROW LEVEL SECURITY;
-- Edge functions use service role; block all anon/authenticated reads
CREATE POLICY "idempotency_cache_block_all" ON idempotency_cache FOR ALL TO authenticated USING (false) WITH CHECK (false);
