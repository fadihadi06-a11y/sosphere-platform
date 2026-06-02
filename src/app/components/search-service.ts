// ═══════════════════════════════════════════════════════════════
// SOSphere — search-service (9th application of world-class pattern)
// ─────────────────────────────────────────────────────────────
// Server-state cross-table search. Replaces the client-side filter in
// global-search.tsx (which was limited to whatever happened to be
// pre-loaded in the parent's props).
//
// Architecture (mirrors CRIT-2/3/4/4-B/8/9 + attendance + compliance):
//   • DB = source of truth via search_company SECDEF RPC. The RPC
//     scans employees + zones + invitations + sos_queue with
//     company-scope + score-based ranking server-side.
//   • Auth: owner / admin membership / employee — refused otherwise.
//   • Empty/short queries (<2 chars) short-circuit to empty array
//     server-side; this client mirrors the rule to avoid round-trips.
//   • Pure helpers (Vitest-testable): debounce, groupByType,
//     mergeAndSort.
//
// This file contains:
//   1. Types: SearchResult, SearchType
//   2. Pure helpers: groupByType, mergeAndSort, isQueryTooShort,
//      makeDebouncer
//   3. RPC wrapper: searchCompany
// ═══════════════════════════════════════════════════════════════

export type SearchType = "employee" | "zone" | "invitation" | "emergency";

export interface SearchResult {
  type:     SearchType;
  id:       string;
  title:    string;
  subtitle: string;
  snippet:  string;
  score:    number;
}

export const MIN_QUERY_LENGTH = 2;

// ───────── PURE HELPERS ─────────

export function isQueryTooShort(q: string): boolean {
  return typeof q !== "string" || q.trim().length < MIN_QUERY_LENGTH;
}

/** Stable bucket grouping for the UI's section-by-type rendering. */
export function groupByType(rows: SearchResult[]): Record<SearchType, SearchResult[]> {
  const out: Record<SearchType, SearchResult[]> = {
    employee:   [],
    zone:       [],
    invitation: [],
    emergency:  [],
  };
  for (const r of rows) {
    if (r.type in out) out[r.type].push(r);
  }
  return out;
}

/** Sort rows: higher score first, then alphabetical by title (stable). */
export function mergeAndSort(rows: SearchResult[]): SearchResult[] {
  return [...rows].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.title.localeCompare(b.title);
  });
}

/** Pure debounce factory. Returns {trigger, cancel} so tests can drive
 *  the timing deterministically via vi.useFakeTimers(). */
export function makeDebouncer<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  ms: number,
): { trigger: (...args: TArgs) => void; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout> | null = null;
  return {
    trigger: (...args: TArgs) => {
      if (handle) clearTimeout(handle);
      handle = setTimeout(() => fn(...args), Math.max(0, ms));
    },
    cancel: () => {
      if (handle) {
        clearTimeout(handle);
        handle = null;
      }
    },
  };
}

// ───────── RPC WRAPPER ─────────

export interface SearchCompanyArgs {
  companyId: string;
  query:     string;
  types?:    SearchType[];
  limit?:    number;
}

/** Call the SECDEF RPC. Returns an envelope so the UI can render
 *  either results or an error state without try/catch. */
export async function searchCompany(
  args: SearchCompanyArgs,
): Promise<{ ok: boolean; rows: SearchResult[]; error?: string }> {
  if (!args.companyId) {
    return { ok: false, rows: [], error: "company_id required" };
  }
  if (isQueryTooShort(args.query)) {
    return { ok: true, rows: [] };
  }
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("search_company", {
      p_company_id: args.companyId,
      p_query:      args.query.trim(),
      p_types:      args.types && args.types.length > 0 ? args.types : null,
      p_limit:      args.limit ?? 30,
    });
    if (error) return { ok: false, rows: [], error: error.message };
    if (!Array.isArray(data)) return { ok: true, rows: [] };
    // The RPC returns column names: result_type, result_id, title, subtitle, snippet, score
    // Normalize to the public SearchResult shape.
    const rows: SearchResult[] = (data as Array<{
      result_type: string;
      result_id:   string;
      title:       string;
      subtitle:    string;
      snippet:     string;
      score:       number;
    }>).map(r => ({
      type:     r.result_type as SearchType,
      id:       r.result_id,
      title:    r.title,
      subtitle: r.subtitle,
      snippet:  r.snippet,
      score:    r.score,
    }));
    return { ok: true, rows: mergeAndSort(rows) };
  } catch (err) {
    return {
      ok: false, rows: [],
      error: err instanceof Error ? err.message : "Unexpected error",
    };
  }
}
