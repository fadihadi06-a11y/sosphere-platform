// ═══════════════════════════════════════════════════════════════
// SOSphere — Weather Service (29th pattern application)
// ─────────────────────────────────────────────────────────────
// 2026-06-08 — Weather observations land in the public.weather_log
// table via the weather-fetch Edge function (which calls OpenWeather
// then RPC-writes through record_weather_observation). This client-
// side service is the read surface:
//
//   • Doctrine cache trio — in-memory + localStorage cache of the
//     latest-per-zone snapshot for sub-second first paint.
//   • Pure helpers (severityFromCondition, formatTempC, isStaleObs)
//     exposed for Vitest contract tests.
//   • loadLatestPerZone() / loadObservations() — RPC wrappers with
//     structured warn on failure, falls back to cached snapshot.
//
// Cache is busted on requestObservation() because a successful
// observation invalidates the "latest" snapshot.
// ═══════════════════════════════════════════════════════════════

export type WeatherSeverity = "info" | "warning" | "severe";

export interface WeatherObservation {
  id:             string;
  company_id:     string;
  zone_id:        string | null;
  observed_at:    string; // ISO timestamp
  lat:            number;
  lng:            number;
  condition:      string;
  temp_c:         number | null;
  feels_like_c:   number | null;
  humidity_pct:   number | null;
  wind_speed_ms:  number | null;
  wind_gust_ms:   number | null;
  visibility_m:   number | null;
  severity:       WeatherSeverity;
  provider:       string;
  payload:        Record<string, unknown>;
  observer_id:    string | null;
  created_at:     string;
}

// ───────── DOCTRINE CACHE TRIO ─────────

const LATEST_CACHE_KEY = "sosphere_weather_latest_cache";
let _latestSnapshot: WeatherObservation[] | null = null;

export function setCachedLatest(rows: WeatherObservation[]): void {
  _latestSnapshot = rows.slice();
  try {
    localStorage.setItem(LATEST_CACHE_KEY, JSON.stringify(rows));
  } catch { /* unavailable */ }
}

export function getCachedLatest(): WeatherObservation[] {
  if (_latestSnapshot) return _latestSnapshot.slice();
  try {
    const raw = localStorage.getItem(LATEST_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as WeatherObservation[];
      if (Array.isArray(parsed)) {
        _latestSnapshot = parsed;
        return parsed.slice();
      }
    }
  } catch { /* ignore */ }
  return [];
}

/** Wired to complete-logout so user-switch doesn't leak previous tenant
 *  weather cache to a different company on shared devices. */
export function clearWeatherCache(): void {
  _latestSnapshot = null;
  try { localStorage.removeItem(LATEST_CACHE_KEY); } catch { /* ignore */ }
}

// ───────── PURE HELPERS (Vitest-testable) ─────────

/** Pure: derive severity from a normalized condition + extremes.
 *  Mirrors the DB-side rules in record_weather_observation. Used
 *  for client-side preview rendering before the row hits the DB. */
export function severityFromCondition(
  condition: string,
  temp_c?: number | null,
  wind_gust_ms?: number | null,
  visibility_m?: number | null,
): WeatherSeverity {
  if (condition === "Thunderstorm" || condition === "Tornado" || condition === "Squall") return "severe";
  if (condition === "Sand" || condition === "Dust" || condition === "Ash") return "severe";
  if (temp_c != null && temp_c >= 45) return "severe";
  if (wind_gust_ms != null && wind_gust_ms >= 20) return "severe";
  if (condition === "Snow" || condition === "Fog" || condition === "Mist" || condition === "Haze") return "warning";
  if (temp_c != null && temp_c >= 40) return "warning";
  if (visibility_m != null && visibility_m < 1000) return "warning";
  return "info";
}

/** Pure: format Celsius with a degree sign + sensible rounding.
 *  Returns "—" for null so the UI never shows "null°C". */
export function formatTempC(temp: number | null | undefined): string {
  if (temp == null || !Number.isFinite(temp)) return "—";
  return `${Math.round(temp)}°C`;
}

/** Pure: is the observation older than freshnessMinutes (default 60)?
 *  Used to grey-out stale rows on the panel so workers don't trust
 *  hour-old wind speeds when planning a high-risk task. */
export function isStaleObs(observedAt: string, nowMs: number = Date.now(), freshnessMinutes: number = 60): boolean {
  const t = Date.parse(observedAt);
  if (!Number.isFinite(t)) return true;
  return nowMs - t > freshnessMinutes * 60_000;
}

/** Pure: pick the highest severity from a list. Used to drive the
 *  fleet-wide weather badge color on the dashboard header. */
export function aggregateSeverity(rows: WeatherObservation[]): WeatherSeverity {
  let worst: WeatherSeverity = "info";
  for (const r of rows) {
    if (r.severity === "severe") return "severe";
    if (r.severity === "warning" && worst !== "severe") worst = "warning";
  }
  return worst;
}

// ───────── RPC WRAPPERS ─────────

function rowFromRpc(r: Record<string, unknown>): WeatherObservation {
  return {
    id:            String(r.id),
    company_id:    String(r.company_id),
    zone_id:       (r.zone_id as string | null) ?? null,
    observed_at:   String(r.observed_at),
    lat:           Number(r.lat),
    lng:           Number(r.lng),
    condition:     String(r.condition ?? "Unknown"),
    temp_c:        r.temp_c == null ? null : Number(r.temp_c),
    feels_like_c:  r.feels_like_c == null ? null : Number(r.feels_like_c),
    humidity_pct:  r.humidity_pct == null ? null : Number(r.humidity_pct),
    wind_speed_ms: r.wind_speed_ms == null ? null : Number(r.wind_speed_ms),
    wind_gust_ms:  r.wind_gust_ms == null ? null : Number(r.wind_gust_ms),
    visibility_m:  r.visibility_m == null ? null : Number(r.visibility_m),
    severity:      (r.severity === "severe" || r.severity === "warning" ? r.severity : "info") as WeatherSeverity,
    provider:      String(r.provider ?? "openweather"),
    payload:       (r.payload as Record<string, unknown>) ?? {},
    observer_id:   (r.observer_id as string | null) ?? null,
    created_at:    String(r.created_at),
  };
}

/** Load the latest weather observation per zone for the company.
 *  Returns an empty array on failure so callers can fall back to
 *  getCachedLatest() without a TypeError. */
export async function loadLatestPerZone(companyId: string): Promise<WeatherObservation[]> {
  if (!companyId) return [];
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("latest_weather_per_zone", { p_company_id: companyId });
    if (error || !Array.isArray(data)) {
      console.warn("[weather-service] latest_weather_per_zone failed:", error?.message);
      return [];
    }
    const rows = (data as Array<Record<string, unknown>>).map(rowFromRpc);
    setCachedLatest(rows);
    return rows;
  } catch (err) {
    console.warn("[weather-service] loadLatestPerZone threw:", err);
    return [];
  }
}

export interface ObservationFilter {
  zoneId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

/** Load historic weather observations for the company, optionally
 *  filtered by zone + date range. Used by the compliance reports
 *  weather_log section and the dashboard weather alerts page. */
export async function loadObservations(companyId: string, filter: ObservationFilter = {}): Promise<WeatherObservation[]> {
  if (!companyId) return [];
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("list_weather_observations", {
      p_company_id: companyId,
      p_zone_id:    filter.zoneId ?? null,
      p_from:       filter.from?.toISOString() ?? null,
      p_to:         filter.to?.toISOString() ?? null,
      p_limit:      filter.limit ?? 200,
    });
    if (error || !Array.isArray(data)) {
      console.warn("[weather-service] list_weather_observations failed:", error?.message);
      return [];
    }
    return (data as Array<Record<string, unknown>>).map(rowFromRpc);
  } catch (err) {
    console.warn("[weather-service] loadObservations threw:", err);
    return [];
  }
}

/** Trigger a fresh observation by calling the weather-fetch Edge
 *  function. The Edge function does the OpenWeather API call +
 *  record_weather_observation RPC write. On success, invalidates
 *  the latest-per-zone cache. */
export async function requestObservation(
  companyId: string,
  zoneId: string | null,
  lat: number,
  lng: number,
): Promise<{ ok: boolean; error?: string }> {
  if (!companyId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, error: "Invalid request parameters" };
  }
  try {
    const { supabase, SUPABASE_CONFIG } = await import("./api/supabase-client");
    if (!SUPABASE_CONFIG.isConfigured) return { ok: false, error: "Supabase not configured" };
    const { error } = await supabase.functions.invoke("weather-fetch", {
      body: { companyId, zoneId, lat, lng },
    });
    if (error) {
      console.warn("[weather-service] weather-fetch failed:", error.message);
      return { ok: false, error: error.message };
    }
    // Bust the cache so the next loadLatestPerZone hits fresh data.
    _latestSnapshot = null;
    try { localStorage.removeItem(LATEST_CACHE_KEY); } catch { /* ignore */ }
    return { ok: true };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.warn("[weather-service] requestObservation threw:", msg);
    return { ok: false, error: msg };
  }
}
