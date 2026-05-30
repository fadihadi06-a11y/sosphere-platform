-- ═══════════════════════════════════════════════════════════════
-- P2-Followup B — get_neighbor_responses_for_request() RPC
-- ─────────────────────────────────────────────────────────────
-- Lets the original requester read all responses to their alert
-- (the table RLS only allows responder self-read, so without this
-- RPC the requester sees nothing after a realtime broadcast ends).
--
-- Privacy model:
--   • responder_user_id is NEVER returned — only behavior fields
--     (status, responded_at, optional note) so the requester sees
--     "3 people on the way" without learning identities.
--   • request_id is treated as a session-secret: anyone who knows
--     it (i.e. neighbors who received the realtime broadcast) can
--     read responses. We cannot verify "did you originate this id"
--     because neighbor alerts are realtime-broadcast-only (no
--     durable origin table). Adding one is a separate scope.
--   • Hard cap of 50 rows per call prevents enumeration / scraping.
--
-- Security:
--   • SECURITY DEFINER + auth.uid() gate — caller must be signed in.
--   • search_path pinned against schema-hijack.
--   • anon revoked; only authenticated may execute.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.get_neighbor_responses_for_request(p_request_id text)
returns table (
  status        text,
  note          text,
  responded_at  timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_request_id is null or length(p_request_id) < 4 or length(p_request_id) > 128 then
    raise exception 'invalid request_id' using errcode = '22023';
  end if;

  return query
  select nr.status, nr.note, nr.responded_at
  from public.neighbor_responses nr
  where nr.request_id = p_request_id
  order by nr.responded_at asc
  limit 50;
end $$;

revoke execute on function public.get_neighbor_responses_for_request(text) from public, anon;
grant  execute on function public.get_neighbor_responses_for_request(text) to authenticated;

comment on function public.get_neighbor_responses_for_request(text) is
  'Returns up to 50 responses for a given neighbor-alert request_id. Drops responder_user_id for privacy. auth.uid()-gated. Capped to prevent enumeration.';
