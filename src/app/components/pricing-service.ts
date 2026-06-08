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

// ───────── ADMIN WRITE WRAPPERS (28th pattern app) ─────────
// 2026-06-08: pricing changes were previously DBA-only (raw SQL,
// no audit). The 28th pattern app added upsert_plan + delete_plan
// SECDEF RPCs gated on is_super_admin() — these wrappers are the
// client side. Audit_log writes happen INSIDE the RPC (DB-level
// guarantee), not here, so a UI bug can't suppress the record.

export interface PlanInput {
  id:                   string;
  kind:                 PlanKind;
  name:                 string;
  name_ar?:             string | null;
  description?:         string | null;
  color?:               string | null;
  monthly_price?:       number | null;
  annual_price?:        number | null;
  annual_monthly?:      number | null;
  max_employees?:       number | null;
  max_zones?:           number | null;
  extra_employee_price?: number | null;
  features?:            string[];
  popular?:             boolean;
  sort_order?:          number;
  active?:              boolean;
}

/** Pure: trim string fields + clamp numeric fields to non-negative.
 *  Same shape returned for the same input — Vitest-testable. */
export function normalizePlanInput(raw: PlanInput): PlanInput {
  const clampNN = (n: number | null | undefined): number | null =>
    n == null || !Number.isFinite(n) ? null : Math.max(0, Number(n));
  return {
    id:                   String(raw.id ?? "").trim(),
    kind:                 raw.kind,
    name:                 String(raw.name ?? "").trim(),
    name_ar:              raw.name_ar ? String(raw.name_ar).trim() || null : null,
    description:          raw.description ? String(raw.description).trim() || null : null,
    color:                raw.color ? String(raw.color).trim() || null : null,
    monthly_price:        clampNN(raw.monthly_price),
    annual_price:         clampNN(raw.annual_price),
    annual_monthly:       clampNN(raw.annual_monthly),
    max_employees:        clampNN(raw.max_employees),
    max_zones:            clampNN(raw.max_zones),
    extra_employee_price: clampNN(raw.extra_employee_price),
    features:             Array.isArray(raw.features) ? raw.features.filter(f => typeof f === "string" && f.trim().length > 0).map(f => f.trim()) : [],
    popular:              Boolean(raw.popular),
    sort_order:           Number.isFinite(raw.sort_order) ? Number(raw.sort_order) : 100,
    active:               raw.active === undefined ? true : Boolean(raw.active),
  };
}

/** Pure: validate the normalized input. Returns null on success
 *  or a human-readable reason string on failure. */
export function validatePlanInput(input: PlanInput): string | null {
  if (!input.id || input.id.length < 2) return "Plan id must be at least 2 characters";
  if (!/^[a-z0-9_-]+$/.test(input.id)) return "Plan id must be lowercase alphanumeric, dash or underscore";
  if (input.kind !== "unified" && input.kind !== "individual" && input.kind !== "addon") {
    return "Plan kind must be unified, individual, or addon";
  }
  if (!input.name || input.name.length < 2) return "Plan name required";
  return null;
}

/** Upsert a plan. Super-admin only (gated server-side). Invalidates
 *  the in-memory + localStorage cache on success so the next
 *  loadPlans() returns fresh data. */
export async function upsertPlan(input: PlanInput): Promise<{ ok: boolean; error?: string }> {
  const normalized = validatePlanInput(normalizePlanInput(input));
  if (normalized) return { ok: false, error: normalized };
  const clean = normalizePlanInput(input);
  try {
    const { supabase, SUPABASE_CONFIG } = await import("./api/supabase-client");
    if (!SUPABASE_CONFIG.isConfigured) return { ok: false, error: "Supabase not configured" };
    const { error } = await supabase.rpc("upsert_plan", {
      p_id:                   clean.id,
      p_kind:                 clean.kind,
      p_name:                 clean.name,
      p_name_ar:              clean.name_ar,
      p_description:          clean.description,
      p_color:                clean.color,
      p_monthly_price:        clean.monthly_price,
      p_annual_price:         clean.annual_price,
      p_annual_monthly:       clean.annual_monthly,
      p_max_employees:        clean.max_employees,
      p_max_zones:            clean.max_zones,
      p_extra_employee_price: clean.extra_employee_price,
      p_features:             clean.features ?? [],
      p_popular:              clean.popular ?? false,
      p_sort_order:           clean.sort_order ?? 100,
      p_active:               clean.active ?? true,
    });
    if (error) {
      console.warn("[pricing-service] upsert_plan failed:", error.message);
      return { ok: false, error: error.message };
    }
    // Bust the cache so the next loadPlans() hits the server.
    _serverPlans = null;
    try { localStorage.removeItem(PLANS_CACHE_KEY); } catch { /* ignore */ }
    return { ok: true };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.warn("[pricing-service] upsert_plan threw:", msg);
    return { ok: false, error: msg };
  }
}

/** Delete a plan by id. Super-admin only (gated server-side).
 *  Idempotent — deleting a non-existent plan returns ok:true. */
export async function deletePlan(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!id || typeof id !== "string") return { ok: false, error: "Plan id required" };
  try {
    const { supabase, SUPABASE_CONFIG } = await import("./api/supabase-client");
    if (!SUPABASE_CONFIG.isConfigured) return { ok: false, error: "Supabase not configured" };
    const { error } = await supabase.rpc("delete_plan", { p_id: id });
    if (error) {
      console.warn("[pricing-service] delete_plan failed:", error.message);
      return { ok: false, error: error.message };
    }
    _serverPlans = null;
    try { localStorage.removeItem(PLANS_CACHE_KEY); } catch { /* ignore */ }
    return { ok: true };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.warn("[pricing-service] delete_plan threw:", msg);
    return { ok: false, error: msg };
  }
}
