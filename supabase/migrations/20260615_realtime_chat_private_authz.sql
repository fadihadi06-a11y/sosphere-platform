-- ═══════════════════════════════════════════════════════════════
-- SOSphere — Max isolation: server-side authorization for emergency
-- chat PRIVATE realtime channels
-- ─────────────────────────────────────────────────────────────
-- BACKGROUND
--   The emergency chat broadcasts over a Supabase Realtime channel.
--   Step 1 (commit 0dd7aff) namespaced the channel by company_id
--   (chat-<company_id>-<emergency_id>) so the short, guessable
--   emergency_id alone can't reach another tenant. That closed the
--   practical attack but relied on the channel name being secret.
--
--   This migration adds DEFENSE-IN-DEPTH: the client now opens the
--   chat channel as PRIVATE, and Supabase enforces these RLS policies
--   on realtime.messages before letting anyone join. A user may only
--   read/send on a chat topic whose company_id prefix equals their own
--   JWT company_id claim — server-enforced, not name-secrecy.
--
-- SCOPE / SAFETY
--   • Only affects PRIVATE channels. Every existing channel in the app
--     is public and bypasses realtime authorization entirely — zero
--     regression to missions/evac/sync/etc.
--   • Civilian emergencies (no company_id) keep using a public channel,
--     so they are unaffected by these policies.
--   • broadcast receive = SELECT, broadcast send = INSERT.
--   • Verified by simulation: same-company topic → allow; other-company
--     topic → deny; missing company_id → deny.
-- ═══════════════════════════════════════════════════════════════

drop policy if exists "chat_realtime_company_read"  on realtime.messages;
drop policy if exists "chat_realtime_company_write" on realtime.messages;

-- Receive emergency-chat broadcasts: only for topics prefixed with the
-- caller's own company_id.
create policy "chat_realtime_company_read"
  on realtime.messages
  for select
  to authenticated
  using (
    extension = 'broadcast'
    and coalesce(auth.jwt() ->> 'company_id', '') <> ''
    and realtime.topic() like ('chat-' || (auth.jwt() ->> 'company_id') || '-%')
  );

-- Send emergency-chat broadcasts: same company-prefix constraint.
create policy "chat_realtime_company_write"
  on realtime.messages
  for insert
  to authenticated
  with check (
    extension = 'broadcast'
    and coalesce(auth.jwt() ->> 'company_id', '') <> ''
    and realtime.topic() like ('chat-' || (auth.jwt() ->> 'company_id') || '-%')
  );
