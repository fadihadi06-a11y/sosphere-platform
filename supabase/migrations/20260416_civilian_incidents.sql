-- ============================================================================
-- civilian_incidents -- shadow mirror of completed SOS incidents
-- ============================================================================
-- Mirrors local IncidentRecord so history survives device loss / reinstalls.
-- The client (src/app/components/incident-sync.ts) upserts one row per
-- completed SOS. localStorage remains the source of truth for the UI.
--
-- Idempotent: safe to re-run. Enable RLS so each user only sees their own
-- rows; service role retains full access for server-side analytics.
-- ============================================================================

create table if not exists public.civilian_incidents (
    id                 text primary key,
    user_id            uuid references auth.users(id) on delete cascade,
    start_time         timestamptz,
    end_time           timestamptz,
    trigger_method     text,
    contacts_called    int     default 0,
    contacts_answered  int     default 0,
    has_recording      boolean default false,
    recording_seconds  int     default 0,
    photo_count        int     default 0,
    location           jsonb,
    payload            jsonb,
    synced_at          timestamptz not null default now(),
    created_at         timestamptz not null default now()
);

create index if not exists civilian_incidents_user_id_idx
    on public.civilian_incidents (user_id);
create index if not exists civilian_incidents_start_time_idx
    on public.civilian_incidents (start_time desc);

alter table public.civilian_incidents enable row level security;

-- Users can see only their own incidents.
drop policy if exists "civilian_incidents self select" on public.civilian_incidents;
create policy "civilian_incidents self select"
    on public.civilian_incidents
    for select
    using (auth.uid() = user_id);

-- Users can insert / upsert their own.
drop policy if exists "civilian_incidents self upsert" on public.civilian_incidents;
create policy "civilian_incidents self upsert"
    on public.civilian_incidents
    for insert
    with check (auth.uid() = user_id);

drop policy if exists "civilian_incidents self update" on public.civilian_incidents;
create policy "civilian_incidents self update"
    on public.civilian_incidents
    for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- Force PostgREST to pick up the new table without a restart.
notify pgrst, 'reload schema';
