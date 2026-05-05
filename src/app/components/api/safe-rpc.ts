/**
 * safe-rpc.ts — direct fetch to PostgREST/RPC, bypasses supabase-js auth lock.
 *
 * WHY THIS EXISTS (E1.6-PHASE3, 2026-05-04)
 * ─────────────────────────────────────────
 * supabase-js wraps every rpc/select/insert call in `_acquireLock` (an
 * internal LockManager-backed queue). Live capture proved that on some
 * boot paths the lock holder never releases — pendingInLock grows
 * unbounded and EVERY subsequent rpc/select deadlocks across the entire
 * page.
 *
 * Phase 2 (JWT-claim caching) eliminated the explicit getSession spam
 * from data-layer.ts, but supabase-js itself calls _getAccessToken
 * (which calls getSession → _acquireLock) on every from().select() and
 * every rpc(). So critical pages — Jobs, Mission Control, anything that
 * MUST render — could still be wedged by an unrelated boot-time
 * acquisition.
 *
 * This helper provides safeRpc / safeSelect that:
 *   • Read the JWT directly from localStorage (sb-<ref>-auth-token).
 *   • Call PostgREST via window.fetch with Authorization: Bearer <jwt>.
 *   • Apply an 8 s default timeout so a network hang never freezes UI.
 *   • Are 100% independent of supabase-js auth state — they do not
 *     touch _acquireLock, getSession, or _getAccessToken.
 *
 * Use these in pages where freezing the UI is not an option (Jobs,
 * Mission Control, any "live ops" surface). Continue using the regular
 * supabase client elsewhere — it gives writes proper realtime broadcast,
 * RLS-aware errors, and a uniform interface.
 */

const SUPABASE_URL: string =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((import.meta as any).env?.VITE_SUPABASE_URL as string | undefined) || "";
const SUPABASE_ANON_KEY: string =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined) || "";

function _projectRef(): string | null {
  const m = SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  return m ? m[1] : null;
}

/**
 * Read access_token from localStorage. Supports both modern (object) and
 * legacy (array) layouts emitted by supabase-js v2.x. Rejects expired
 * tokens so we never hand a dead bearer to PostgREST.
 */
function _getBearer(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const ref = _projectRef();
    if (!ref) return null;
    const raw = localStorage.getItem(`sb-${ref}-auth-token`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    let token: string | undefined;
    if (Array.isArray(parsed)) {
      token = typeof parsed[0] === "string" ? parsed[0] : undefined;
    } else if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      token = typeof o.access_token === "string" ? o.access_token : undefined;
    }
    if (!token) return null;
    // Reject expired
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const padLen = (4 - (parts[1].length % 4)) % 4;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(parts[1].length + padLen, "=");
    const payload = JSON.parse(atob(b64));
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
    return token;
  } catch {
    return null;
  }
}

export interface SafeResult<T> {
  data: T | null;
  error: { message: string; status?: number; code?: string } | null;
}

function _composeSignal(timeoutMs: number, external?: AbortSignal): { signal: AbortSignal; clear: () => void } {
  const ctrl = new AbortController();
  const tmId = setTimeout(() => ctrl.abort(new Error("safe-rpc timeout")), timeoutMs);
  if (external) {
    if (external.aborted) ctrl.abort(external.reason);
    else external.addEventListener("abort", () => ctrl.abort(external.reason), { once: true });
  }
  return { signal: ctrl.signal, clear: () => clearTimeout(tmId) };
}

/**
 * Call a PostgreSQL function via PostgREST, bypassing supabase-js entirely.
 * Default timeout 8 s. Returns supabase-js-like { data, error } shape so
 * callers can drop it in as a near-replacement for `supabase.rpc()`.
 */
export async function safeRpc<T = unknown>(
  fnName: string,
  args: Record<string, unknown> = {},
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<SafeResult<T>> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { data: null, error: { message: "Supabase not configured" } };
  }
  const token = _getBearer();
  if (!token) return { data: null, error: { message: "no-session", code: "PGRST301" } };

  const { signal, clear } = _composeSignal(opts.timeoutMs ?? 8000, opts.signal);
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(fnName)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(args),
      signal,
    });
    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      let code: string | undefined;
      try {
        const body = await resp.json();
        if (typeof body?.message === "string") msg = body.message;
        if (typeof body?.code === "string") code = body.code;
      } catch { /* response not json */ }
      return { data: null, error: { message: msg, status: resp.status, code } };
    }
    if (resp.status === 204) return { data: null as T, error: null };
    const data = await resp.json();
    return { data: data as T, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { data: null, error: { message: msg } };
  } finally {
    clear();
  }
}

export interface SafeSelectOpts {
  /** PostgREST select string, default "*" */
  select?: string;
  /** Map of column → PostgREST filter (e.g. { company_id: "eq.uuid", status: "in.(pending,running)" }) */
  filters?: Record<string, string>;
  /** Order clause, e.g. "created_at.desc" */
  order?: string;
  limit?: number;
  offset?: number;
  /** Return only the first row as an object (PostgREST `Accept: application/vnd.pgrst.object+json`) */
  single?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Read from a PostgREST table view, bypassing supabase-js. Same contract
 * as safeRpc — returns { data, error }. `data` is an array unless
 * `single: true` (then a single object or null).
 */
export async function safeSelect<T = unknown>(
  table: string,
  opts: SafeSelectOpts = {},
): Promise<SafeResult<T>> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { data: null, error: { message: "Supabase not configured" } };
  }
  const token = _getBearer();
  if (!token) return { data: null, error: { message: "no-session", code: "PGRST301" } };

  const params = new URLSearchParams();
  params.set("select", opts.select || "*");
  if (opts.filters) {
    for (const [k, v] of Object.entries(opts.filters)) params.set(k, v);
  }
  if (opts.order) params.set("order", opts.order);
  if (typeof opts.limit === "number") params.set("limit", String(opts.limit));
  if (typeof opts.offset === "number") params.set("offset", String(opts.offset));

  const { signal, clear } = _composeSignal(opts.timeoutMs ?? 8000, opts.signal);
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?${params.toString()}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        Accept: opts.single ? "application/vnd.pgrst.object+json" : "application/json",
      },
      signal,
    });
    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      let code: string | undefined;
      try {
        const body = await resp.json();
        if (typeof body?.message === "string") msg = body.message;
        if (typeof body?.code === "string") code = body.code;
      } catch { /* ignore */ }
      // PGRST116 = no rows for single — treat as null, not error
      if (opts.single && (resp.status === 406 || code === "PGRST116")) {
        return { data: null, error: null };
      }
      return { data: null, error: { message: msg, status: resp.status, code } };
    }
    const data = await resp.json();
    return { data: data as T, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { data: null, error: { message: msg } };
  } finally {
    clear();
  }
}

/**
 * For diagnostics: returns true iff a non-expired JWT is available without
 * going through the auth lock. Useful for "should I render this page?"
 * gates that previously called supabase.auth.getSession().
 */
export function hasValidStoredSession(): boolean {
  return _getBearer() !== null;
}

/**
 * Returns the stored bearer token from localStorage without touching the
 * supabase-js auth lock. Use this in SOS / payment / any hot path that
 * needs to call an Edge Function with Authorization: Bearer <jwt>, where
 * deadlocking on auth.getSession() is not an acceptable failure mode.
 *
 * Returns null if no session is stored, the token can't be parsed, or
 * the token has expired.
 */
export function getStoredBearerToken(): string | null {
  return _getBearer();
}
