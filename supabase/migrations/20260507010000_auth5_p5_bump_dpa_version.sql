-- AUTH-5 P5 — bump current_dpa_version() from 2026-05-06 → 2026-05-07.
-- The legal text was materially strengthened (peer-borrowed liability cap,
-- insurance commitment, SCC reference, KSA addendum, governing-law clause).
-- Bumping the version forces every owner to re-accept on next dashboard visit
-- so the acceptance ledger reflects the binding text.
CREATE OR REPLACE FUNCTION public.current_dpa_version()
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT '2026-05-07'::text $$;
GRANT EXECUTE ON FUNCTION public.current_dpa_version() TO authenticated, anon;
