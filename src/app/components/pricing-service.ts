// ═══════════════════════════════════════════════════════════════
// SOSphere — Pricing Service (20th pattern application)
// ─────────────────────────────────────────────────────────────
// Reference-data pattern (different shape from the 19 prior
// tenant-scoped pattern apps):
//   • Pricing is the same across all tenants — no RLS by company.
//   • No clearXCache in complete-logout (not tenant-scoped data).
//   • Service caches the fetched config in memory + localStorage
//     for sub-second first paint and offline survivability.
//   • Anon allowed on the RPC — pricing surfaces on the public
//     landing page before login.
//
// Constants in src/app/constants/pricing.ts remain as the
// COMPILE-TIME default / fallback. Pages can now opt into
// loadPlans() for live data without breaking when offline or
// before the network call resolves.
// ═══════════════════════════════════════════════════════════════

export type PlanKind = "unified" | "individual" | "addon";

export interface PlanRow {
  id:                   string;
  kind:                 PlanKind;
  name:                 string;
  name_ar:              string | null;
  description:          string | null;
  color:                string | null;
  monthly_price:        number | null;
  annual_price:         number | null;
  annual_monthly:       number | null;
  max_employees:        number | null;
  max_zones:            number | null;
  extra_employee_price: number | null;
  features:             string[];
  popular:              boolean;
  sort_order:           number;
}

// ───────── IN-MEMORY CACHE ─────────

const PLANS_CACHE_KEY = "sosphere_plans_cache";
let _serverPlans: PlanRow[] | null = null;

export function setCachedPlans(rows: PlanRow[]): void {
  _serverPlans = rows.slice();
  try {
    localStorage.setItem(PLANS_CACHE_KEY, JSON.stringify(rows));
  } catch { /* unavailable */ }
}

export function getCachedPlans(): PlanRow[] {
  if (_serverPlans) return _serverPlans.slice();
  try {
    const raw = localStorage.getItem(PLANS_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PlanRow[];
      if (Array.isArray(parsed)) {
        _serverPlans = parsed;
        return parsed.slice();
      }
    }
  } catch { /* ignore */ }
  return [];
}

// ───────── PURE HELPERS ─────────

/** Filter cached plans by kind. Pure. */
export function filterByKind(rows: PlanRow[], kind: PlanKind): PlanRow[] {
  return rows.filter(r => r.kind === kind);
}

/** Lookup a plan by id. Pure. */
export function findPlanById(rows: PlanRow[], id: string): PlanRow | undefined {
  return rows.find(r => r.id === id);
}

/** Recommend a unified tier by company employee count. Pure.
 *  Mirrors the existing constants/pricing.ts:recommendPlan logic. */
export function recommendUnifiedTier(employeeCount: number): string {
  if (employeeCount <= 25)  return "starter";
  if (employeeCount <= 100) return "growth";
  if (employeeCount <= 500) return "business";
  return "enterprise";
}

// ───────── RPC WRAPPER ─────────

/** Load pricing config from the server (anon allowed). Returns
 *  empty array on failure so the caller can fall back to the
 *  hardcoded constants without a TypeError. */
export async function loadPlans(kind?: PlanKind): Promise<PlanRow[]> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("list_plans", {
      p_kind: kind ?? null,
    });
    if (error || !Array.isArray(data)) return [];
    const rows = (data as Array<Record<string, unknown>>).map((r) => ({
      id:                   String(r.id),
      kind:                 (r.kind as PlanKind) ?? "unified",
      name:                 String(r.name ?? ""),
      name_ar:              (r.name_ar as string | null) ?? null,
      description:          (r.description as string | null) ?? null,
      color:                (r.color as string | null) ?? null,
      monthly_price:        toNumberOrNull(r.monthly_price),
      annual_price:         toNumberOrNull(r.annual_price),
      annual_monthly:       toNumberOrNull(r.annual_monthly),
      max_employees:        toNumberOrNull(r.max_employees),
      max_zones:            toNumberOrNull(r.max_zones),
      extra_employee_price: toNumberOrNull(r.extra_employee_price),
      features:             Array.isArray(r.features) ? r.features as string[] : [],
      popular:              Boolean(r.popular),
      sort_order:           Number(r.sort_order ?? 0),
    } satisfies PlanRow));
    setCachedPlans(rows);
    return rows;
  } catch (err) {
    console.warn("[pricing-service] loadPlans threw:", err);
    return [];
  }
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
