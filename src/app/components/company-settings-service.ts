// ═══════════════════════════════════════════════════════════════
// SOSphere — Company Settings Service (19th pattern application)
// ─────────────────────────────────────────────────────────────
// Server-state durable company settings. Replaces the silent-failure
// path where dashboard-settings-page.tsx upserted to a
// company_settings table whose schema didn't have the columns it
// was writing — every "Save Settings" click failed at the DB while
// the localStorage mirror kept the UI happy. Settings vanished
// across devices / browsers / shared-device sessions.
//
// Architecture (matches the 18 prior pattern applications):
//   • DB = source of truth (company_settings.settings jsonb +
//     2 SECDEF RPCs).
//   • In-memory _serverSettings cache + bootstrap localStorage.
//   • clearCompanySettingsCache() called by complete-logout.
//   • Pure helpers (Vitest-testable): mergeSettings,
//     extractToggleValue.
// ═══════════════════════════════════════════════════════════════

import { getCompanyId } from "./shared-store";

export type CompanySettings = Record<string, unknown> & {
  company_name?:     string;
  language?:         string;
  checkin_interval?: string;
  // 2026-06-03 type-fix: dashboard-store keeps sessionTimeout as a
  // string ("30m" / "1h" / "8h" / "24h") — matching the dropdown choice
  // labels. Mirror that shape here so the payload typechecks end-to-end.
  session_timeout?:  string;
  toggles?:          Record<string, boolean>;
};

// ───────── IN-MEMORY CACHE ─────────

const SETTINGS_CACHE_KEY = "sosphere_company_settings_cache";
let _serverSettings: CompanySettings | null = null;

export function setCachedCompanySettings(settings: CompanySettings): void {
  _serverSettings = { ...settings };
  try {
    localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings));
  } catch { /* unavailable */ }
}

export function getCachedCompanySettings(): CompanySettings | null {
  if (_serverSettings) return { ..._serverSettings };
  try {
    const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CompanySettings;
      if (parsed && typeof parsed === "object") {
        _serverSettings = parsed;
        return { ...parsed };
      }
    }
  } catch { /* ignore */ }
  return null;
}

export function clearCompanySettingsCache(): void {
  _serverSettings = null;
  try { localStorage.removeItem(SETTINGS_CACHE_KEY); } catch { /* unavailable */ }
}

// ───────── PURE HELPERS ─────────

/** Shallow merge incoming settings into the existing cache.
 *  Pure — used by partial-update flows where only one toggle changes
 *  but the whole settings object needs to round-trip through the RPC. */
export function mergeSettings(prev: CompanySettings | null, patch: Partial<CompanySettings>): CompanySettings {
  const base = prev ?? {};
  return { ...base, ...patch, toggles: { ...(base.toggles ?? {}), ...(patch.toggles ?? {}) } };
}

/** Extract a single toggle value with a typed default. Pure. */
export function extractToggleValue(
  settings: CompanySettings | null,
  key: string,
  defaultValue: boolean,
): boolean {
  if (!settings || !settings.toggles) return defaultValue;
  const v = settings.toggles[key];
  return typeof v === "boolean" ? v : defaultValue;
}

// ───────── RPC WRAPPERS ─────────

/** Load company settings from the server. Returns null on failure
 *  so the caller can decide whether to fall back to the cache. */
export async function loadCompanySettings(): Promise<{
  ok: boolean; settings: CompanySettings; error?: string;
}> {
  const companyId = getCompanyId();
  if (!companyId) return { ok: false, settings: {}, error: "no_company_id" };
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("get_company_settings", {
      p_company_id: companyId,
    });
    if (error) return { ok: false, settings: {}, error: error.message };
    const settings: CompanySettings = (data && typeof data === "object")
      ? (data as CompanySettings)
      : {};
    setCachedCompanySettings(settings);
    return { ok: true, settings };
  } catch (err) {
    return {
      ok: false, settings: {},
      error: err instanceof Error ? err.message : "Unexpected error",
    };
  }
}

/** Upsert the full settings object via the SECDEF RPC. The RPC is
 *  owner/admin-only — workers / dispatchers will get a 42501. */
export async function saveCompanySettings(settings: CompanySettings): Promise<boolean> {
  const companyId = getCompanyId();
  if (!companyId) return false;
  try {
    const { supabase } = await import("./api/supabase-client");
    const { error } = await supabase.rpc("upsert_company_settings", {
      p_company_id: companyId,
      p_settings:   settings,
    });
    if (error) {
      console.warn("[company-settings] save failed:", error.message);
      return false;
    }
    setCachedCompanySettings(settings);
    return true;
  } catch (err) {
    console.warn("[company-settings] save threw:", err);
    return false;
  }
}
