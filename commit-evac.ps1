# 2026-06-02 Evacuation durability Phase A — commit + push
# Run: powershell -ExecutionPolicy Bypass -File commit-evac.ps1
$ErrorActionPreference = "Continue"

Set-Location C:\Users\user\Downloads\sosphere-platform

# Defensive lock clear
Remove-Item -Force .git\index.lock -ErrorAction SilentlyContinue
Remove-Item -Force push-result.txt -ErrorAction SilentlyContinue

git add -A
git status --short

@"
feat(evacuation): durable evacuations table + 4 SECDEF RPCs (10th pattern app)

Audit gap (Phase 1 #2 PARTIAL): "No evacuations table — broadcast-only;
offline/late-onboarding workers miss event silently. Worker onboarding
after broadcast time misses it forever."

Before: every evacuation artefact (ActiveEvacuation, EmployeeEvacuationStatus,
EvacuationPoint) lived in localStorage on the admin's browser tab.
Tab close = data gone. Cross-device admins saw only ACKs that arrived via
the live Realtime broadcast they were subscribed to at emit time — no replay,
no DB. A worker who came online AFTER the broadcast missed it forever.

After (10th application of the world-class pattern):
  * evacuations table (server-side source of truth)
  * evacuation_acks table (per-worker ack with phase:
    acknowledged | evacuating | arrived) + GPS + accuracy
  * 4 SECDEF RPCs:
    - start_evacuation: admin/owner only; returns evacuation id
    - ack_evacuation:   worker records ack with phase + GPS
    - end_evacuation:   admin marks completed/cancelled
    - get_active_evacuations: admin reader with derived counts
  * RLS company-scoped reads; writes only via SECDEF
  * evacuation-service.ts: pure helpers (classifyAckProgress with
    none/partial/most/complete buckets, formatTriggeredAge) +
    in-memory cache trio + RPC wrappers
  * 10 Vitest contract tests + 9 smoke pass via node
  * complete-logout 9th cache cleanup (clearEvacuationCache)
  * migrations.lock.json: 157 migrations, sha a90419f0d7e7a275

Lifecycle smoke verified on staging (rolled back):
  start_evacuation -> ack(acknowledged) -> ack(evacuating) ->
  end_evacuation(completed) -> get_active_evacuations = 0 rows.

Phase B (dashboard-evacuation-page + mobile evacuation-screen refactor
to call these RPCs instead of writing to localStorage) is queued for
the next commit.

Files:
  + supabase/migrations/20260602_evacuation_durability_phase_a.sql
  + src/app/components/evacuation-service.ts
  + src/app/components/__tests__/evacuation-service-state.test.ts
  ~ src/app/components/api/complete-logout.ts
  ~ supabase/migrations.lock.json
"@ | Out-File -FilePath commit-msg.txt -Encoding utf8

git commit -F commit-msg.txt 2>&1 | Tee-Object -FilePath commit-result.txt

Write-Host ""
Write-Host "=== PUSHING ===" -ForegroundColor Cyan
git push origin main 2>&1 | Tee-Object -FilePath push-result.txt
Write-Host ""
Write-Host "=== LAST 25 LINES ===" -ForegroundColor Cyan
Get-Content push-result.txt | Select-Object -Last 25

Remove-Item -Force commit-msg.txt -ErrorAction SilentlyContinue
