# Weather Integration Setup Guide (29th Pattern App)

**Audience**: SOSphere super_admin operating the production deployment.
**Outcome**: Live OpenWeather observations flowing into `weather_log`,
visible on the dashboard, with severe weather auto-writing audit rows.

---

## 1. OpenWeather API Key (5 min)

1. Visit **https://openweathermap.org/api** → click "Get API key"
2. Create a free account (no credit card required).
3. Go to your account → **API Keys** tab → copy the default key.
4. **Wait ~10 minutes** — OpenWeather requires an activation delay before
   the key starts returning data. New keys return HTTP 401 until activated.

### Verify the key works (curl, no Supabase needed)
```bash
curl "https://api.openweathermap.org/data/2.5/weather?lat=24.7&lon=46.7&appid=YOUR_KEY&units=metric"
```
Expected: JSON with `weather`, `main.temp`, `wind`, etc. If you get
`{"cod":401,"message":"Invalid API key"}`, wait longer — activation isn't done.

### Free tier limits
| Limit | Value | SOSphere headroom |
|---|---|---|
| Calls per minute | 60 | Up to 60 zones per sweep |
| Calls per day | 1,000 | ~42 zones × 24 hourly fetches |
| Severe weather alerts | Included in 3.0 One Call (paid) | Set `OPENWEATHER_USE_ONECALL=true` after upgrading |

If you'll have more than ~40 zones with hourly sweeps, plan on the
$40/month tier (100k calls/day, unlocks One Call 3.0 with NWS alerts).

---

## 2. Supabase Function Secrets (3 min)

1. **Supabase Dashboard** → your project → **Project Settings** → **Edge Functions** → **Secrets**.
2. Add these secrets:

| Name | Value | Required? |
|---|---|---|
| `OPENWEATHER_API_KEY` | your key from step 1 | **Yes** |
| `OPENWEATHER_USE_ONECALL` | `false` (free) or `true` (paid 3.0 One Call) | No (default false) |
| `CRON_SECRET` | already set if bulk-invite worker is configured | No (vault preferred) |

3. Click **Save**. Secrets propagate to running Edge functions within ~30s.

---

## 3. Vault secrets for the cron sweep (one-time, 2 min)

The pg_cron job (`sosphere_weather_sweep`, every 15 min) needs two Vault entries
so it can call back to the Edge function with an authentication header.

Run this SQL in the **Supabase SQL Editor** (replace `<project>` with your project ref):

```sql
-- 1. The Edge function URL (no trailing /sweep — the cron appends ?action=sweep)
INSERT INTO vault.secrets (name, secret, description)
VALUES (
  'weather_fetch_url',
  'https://<project>.supabase.co/functions/v1/weather-fetch',
  'Weather sweep target (29th pattern app)'
)
ON CONFLICT (name) DO UPDATE SET secret = EXCLUDED.secret;

-- 2. The shared secret (skip if already configured for bulk-invite worker)
-- Generate one with: openssl rand -hex 32
INSERT INTO vault.secrets (name, secret, description)
VALUES (
  'cron_shared_secret',
  '<paste-output-of-openssl-rand-hex-32>',
  'Shared bearer for pg_cron → Edge function auth'
)
ON CONFLICT (name) DO NOTHING;  -- preserve existing secret if any
```

After this, **also** add the same `cron_shared_secret` value to Supabase
Function Secrets as `CRON_SECRET` (env fallback when vault is unreachable).

### Verify
```sql
SELECT public.trigger_weather_sweep();
```
- Before secrets configured: `{"ok": false, "skipped": "secrets_not_configured", ...}`
- After secrets configured + no schedules yet: `{"ok": true, "due_count": 0, "requests_fired": 0, ...}`
- After at least one schedule + active fetch: `{"ok": true, "due_count": 1, "requests_fired": 1, ...}`

---

## 4. Schedule your first zone (1 min per zone)

Insert a schedule for each company + zone you want monitored:

```sql
-- Example: monitor Riyadh (Zone A) for company X every 60 min
SELECT public.upsert_weather_schedule(
  p_company_id        => 'YOUR-COMPANY-UUID',
  p_zone_id           => 'Z-A',  -- or NULL for site-wide
  p_lat               => 24.7136,
  p_lng               => 46.6753,
  p_frequency_minutes => 60,
  p_enabled           => true
);
```

| Parameter | Notes |
|---|---|
| `p_company_id` | UUID from `companies` table |
| `p_zone_id` | Text matching the zone (NULL = site-level, single observation) |
| `p_lat`, `p_lng` | Validated to ±90 / ±180 |
| `p_frequency_minutes` | Between 15 (sweeps min) and 1440 (daily) |
| `p_enabled` | Set false to pause without deleting |

Caller must be `super_admin` (the RPC enforces this — same gate as pricing-admin).

---

## 5. Watch it run

After the next 15-min cron tick (`*/15 * * * *`):
- `SELECT * FROM weather_log ORDER BY observed_at DESC LIMIT 5;`
- `SELECT * FROM weather_fetch_schedule;` — check `last_fetched_at` updates
- Dashboard → **Compliance Reports** → **Weather Alert History** now renders real data
- Dashboard → **Weather Alerts** page (existing) reads via `weather-service.ts`

### Severe weather behavior
- Conditions: Thunderstorm / Tornado / Squall / Sand / Dust / Ash
- Or: temp ≥ 45 °C / wind gust ≥ 20 m/s / visibility < 1000 m
- Auto-writes an `audit_log` row with `action='weather_severe'`,
  `operation='monitoring'`, `severity='critical'` — visible to the company
  in the Audit Log page.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `weather_provider_not_configured` (503) | Missing `OPENWEATHER_API_KEY` secret | Step 2 |
| `provider_401` from sweep | API key not activated yet (or wrong key) | Wait 10 min, or re-copy from openweathermap.org |
| `trigger_weather_sweep` says `secrets_not_configured` | Vault entries missing | Step 3 |
| Sweep returns 401 in function logs | `cron_shared_secret` mismatch between Vault & env | Re-paste same value in both |
| No rows in `weather_log` after 30 min | `enabled=false` on the schedule, or zone deleted | `SELECT * FROM weather_fetch_schedule;` + re-upsert |
| Severe weather not in audit log | `company_id` mismatch — RPC stamps cron rows with the schedule's company | Verify `company_id` matches your active company |

---

## Security model

| Path | Auth | Write target |
|---|---|---|
| User-initiated (UI button) | Bearer JWT | `record_weather_observation` (auth.uid() enforced) |
| Cron sweep | `x-cron-secret` header | `record_weather_observation_cron` (service_role only) |
| Probe (synthetic monitor) | Bearer JWT | No write |

Anonymous calls are rejected at the Supabase Edge gateway (verify_jwt=true)
PLUS at the RPC layer (REVOKE from anon). Three independent gates.
