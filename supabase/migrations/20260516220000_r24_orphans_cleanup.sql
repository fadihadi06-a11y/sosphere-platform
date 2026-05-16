-- ═══════════════════════════════════════════════════════════════════════════
-- R-24 (2026-05-16) — ORPHANS.md B-tier database cleanup
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS
--   The R-21 Layer 2 connectivity scan (ORPHANS.md, 2026-05-16) surfaced
--   four database orphans that drift the repo away from production:
--
--     1. `get_active_emergency(uuid)` — zero callers anywhere in src/,
--        supabase/functions/, or scripts. Dead code on a SECURITY DEFINER
--        function. Lockdown migration 20260425200000_b_20_privilege_lockdown
--        granted it to authenticated — that grant is dead too.
--
--     2. `verify_admin_pin(text)` and `set_admin_pin(text, text)` — zero
--        callers in src/ or supabase/functions/. Defined as part of an
--        admin PIN concept that was never implemented in the UI. Dropping
--        both as a pair (they're meaningless individually). If this feature
--        ever ships, a clean migration can re-introduce them.
--
--     3. `notify_emergency()` trigger function — definition exists in repo
--        (20260426150000 + 20260426180000) but the matching `CREATE TRIGGER`
--        is NOT in any current migration. A live `pg_trigger` query against
--        production confirmed:
--          trigger_name = trg_notify_emergency
--          on_table     = public.emergencies
--          event        = AFTER INSERT FOR EACH ROW
--          executes     = notify_emergency()
--          state        = O (enabled, origin)
--        The trigger is part of the live SOS dispatch pipeline (the
--        function uses pg_notify on channel 'emergency_alerts' for
--        edge-function listeners) — dropping it would break SOS. The
--        ROOT fix is to capture this live state in a repo migration so
--        the schema-drift guard never false-positives, and so a future
--        fresh-clone deploy still creates the trigger.
--
--   Each fix is idempotent (uses IF EXISTS / DROP IF EXISTS) so this
--   migration is safe to re-run.
--
-- ROLLBACK NOTES
--   If verify_audit_chain integration (paired R-24 commit) reveals it
--   needs admin_pin-style gating, restore the functions from the original
--   migration files (20260427140000 / 20260429120000).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── ITEM 3: drop dead `get_active_emergency(uuid)` RPC ──────────────────
-- 0 callers in src/, supabase/functions/, or scripts (ORPHANS §E.1).
-- The function was a SOS-status reader that has been entirely superseded
-- by Realtime subscriptions on the `emergencies` table.
DROP FUNCTION IF EXISTS public.get_active_emergency(uuid);

-- ─── ITEM 2: drop dead admin-PIN function pair ───────────────────────────
-- Both functions exist in production but have 0 references in code. The
-- planned admin-PIN flow was never built; the functions are dead surface.
-- They're a pair: verify_admin_pin requires the hash that set_admin_pin
-- stores, so dropping individually would be incoherent.
DROP FUNCTION IF EXISTS public.verify_admin_pin(text);
DROP FUNCTION IF EXISTS public.set_admin_pin(text, text);

-- ─── ITEM 4: capture live `trg_notify_emergency` trigger in repo ────────
-- The trigger exists in production but is not captured in any migration —
-- a fresh deploy from the repo would NOT create it, silently breaking SOS
-- pg_notify on new emergency inserts. The CREATE TRIGGER is idempotent
-- via DROP+CREATE so re-running is safe.
--
-- Production state (queried 2026-05-16):
--   CREATE TRIGGER trg_notify_emergency
--     AFTER INSERT ON public.emergencies
--     FOR EACH ROW EXECUTE FUNCTION notify_emergency()
DROP TRIGGER IF EXISTS trg_notify_emergency ON public.emergencies;
CREATE TRIGGER trg_notify_emergency
  AFTER INSERT ON public.emergencies
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_emergency();

COMMENT ON TRIGGER trg_notify_emergency ON public.emergencies IS
  'R-24 (2026-05-16): captures the live trigger that was previously '
  'drift-only. Fires notify_emergency() which pg_notifies channel '
  'emergency_alerts for edge-function listeners.';

COMMIT;
