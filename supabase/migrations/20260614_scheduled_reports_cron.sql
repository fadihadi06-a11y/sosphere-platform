-- ═══════════════════════════════════════════════════════════════
-- 2026-06-14 — Scheduled report sender (pg_cron + pg_net → edge fn)
-- ─────────────────────────────────────────────────────────────
-- Completes the report Scheduler: email_schedules rows are now actually SENT.
-- trigger_scheduled_reports() (cron every 15 min) picks due schedules
-- (enabled + next_run null/<=now) and fires one net.http_post per schedule to
-- the send-scheduled-reports edge function with the x-cron-secret header. The
-- edge function builds a real summary from live data, emails recipients via
-- Resend, and advances next_run. Mirrors the weather-fetch sweep doctrine.
--
-- SETUP (vault): report_send_url (added below) + cron_shared_secret (pre-existing).
-- Edge function secret: RESEND_API_KEY (pre-existing) + CRON_SECRET (= cron_shared_secret).
-- ═══════════════════════════════════════════════════════════════
create or replace function public.trigger_scheduled_reports()
returns jsonb
language plpgsql security definer set search_path = public, vault, pg_catalog
as $$
declare v_url text; v_secret text; v_due integer := 0; v_row record; v_fired integer := 0;
begin
  begin select decrypted_secret into v_url from vault.decrypted_secrets where name='report_send_url';
  exception when others then v_url := null; end;
  begin select decrypted_secret into v_secret from vault.decrypted_secrets where name='cron_shared_secret';
  exception when others then v_secret := null; end;
  if v_url is null or v_secret is null then
    return jsonb_build_object('ok', false, 'skipped', 'secrets_not_configured');
  end if;
  for v_row in
    select s.id from public.email_schedules s
     where s.enabled = true
       and (s.next_run is null or s.next_run <= now())
     order by s.next_run nulls first limit 100
  loop
    v_due := v_due + 1;
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
      body := jsonb_build_object('scheduleId', v_row.id),
      timeout_milliseconds := 8000
    );
    v_fired := v_fired + 1;
  end loop;
  return jsonb_build_object('ok', true, 'due_count', v_due, 'requests_fired', v_fired, 'swept_at', now());
end $$;
revoke execute on function public.trigger_scheduled_reports() from public, anon, authenticated;
grant execute on function public.trigger_scheduled_reports() to service_role;

do $$
begin
  if not exists (select 1 from vault.secrets where name='report_send_url') then
    perform vault.create_secret('https://rtfhkbskgrasamhjraul.supabase.co/functions/v1/send-scheduled-reports','report_send_url');
  end if;
end $$;

do $$ begin perform cron.unschedule('sosphere_scheduled_reports'); exception when others then null; end $$;
select cron.schedule('sosphere_scheduled_reports', '*/15 * * * *', 'select public.trigger_scheduled_reports();');
