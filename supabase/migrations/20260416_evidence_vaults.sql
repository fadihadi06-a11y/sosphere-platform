-- ============================================================================
-- evidence_vaults -- tamper-proof evidence packages for SOS incidents
-- ============================================================================
-- Each completed SOS creates a vault containing GPS trail, photo refs,
-- audio metadata, and a SHA-256 integrity hash. Vaults auto-lock after
-- 24 hours. Client code: evidence-vault-service.ts
--
-- Idempotent: safe to re-run.
-- ============================================================================

create table if not exists public.evidence_vaults (
    vault_id            text primary key,
    emergency_id        text not null,
    user_id             text not null,
    user_name           text,
    start_time          timestamptz,
    end_time            timestamptz,
    duration_sec        int default 0,
    tier                text default 'free',
    contacts_notified   jsonb default '[]'::jsonb,
    gps_trail           jsonb default '[]'::jsonb,
    photo_count         int default 0,
    audio_available     boolean default false,
    audio_duration_sec  int default 0,
    integrity_hash      text not null,
    locked_at           timestamptz,
    created_at          timestamptz not null default now()
);

-- Fast lookups by emergency and user
create index if not exists evidence_vaults_emergency_id_idx
    on public.evidence_vaults (emergency_id);

create index if not exists evidence_vaults_user_id_idx
    on public.evidence_vaults (user_id);

-- ── Row Level Security ──────────────────────────────────────
alter table public.evidence_vaults enable row level security;

-- Users can read/insert their own vaults only
create policy "Users can view own vaults"
    on public.evidence_vaults for select
    using (auth.uid()::text = user_id);

create policy "Users can insert own vaults"
    on public.evidence_vaults for insert
    with check (auth.uid()::text = user_id);

-- Users can update only their own unlocked vaults (locked_at IS NULL)
create policy "Users can update own unlocked vaults"
    on public.evidence_vaults for update
    using (auth.uid()::text = user_id and locked_at is null);

-- No delete allowed — vaults are permanent evidence
-- Service role retains full access for admin/analytics
