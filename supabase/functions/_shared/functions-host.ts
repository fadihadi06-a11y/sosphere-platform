// ═══════════════════════════════════════════════════════════════
// _shared/functions-host — canonical form-B URL builder
// ─────────────────────────────────────────────────────────────
// R-3 (2026-05-13): single source of truth for building edge-function
// URLs that we hand to external callers (Twilio webhooks, etc).
//
// Supabase exposes edge functions on TWO host forms:
//   • form A: <project>.supabase.co/functions/v1/<fn>  (API gateway)
//   • form B: <project>.functions.supabase.co/<fn>     (functions hostname)
//
// Both forms route to the same handler internally, BUT signature
// validators inside the handler compare against req.url which reflects
// whichever form the caller fetched. Twilio Console (after
// twilio-config-fix) writes form B; the previous sos-alert built form A
// — so sos-bridge-twiml had to accept both with `urlFormVariants`.
//
// R-3 unifies: every URL we hand Twilio is built via fnUrl() below,
// which produces form B. After R-3 lands, sos-bridge-twiml's
// urlFormVariants helper can be removed and signature validation
// becomes single-form-only.
//
// USAGE
//   const url = fnUrl(SUPABASE_URL, 'twilio-status', { callId: 'abc' });
//   // → https://<project>.functions.supabase.co/twilio-status?callId=abc
// ═══════════════════════════════════════════════════════════════

/**
 * Derive the form-B functions hostname from a Supabase project URL.
 * Idempotent — if the input is already form B it returns as-is.
 */
export function functionsHost(supabaseUrl: string): string {
  return supabaseUrl.replace(
    /^(https?:\/\/[^.]+)\.supabase\.co(\/.*)?$/,
    "$1.functions.supabase.co",
  );
}

/**
 * Build a fully-qualified form-B URL for an edge function. Optional
 * query params are URL-encoded automatically.
 */
export function fnUrl(
  supabaseUrl: string,
  functionName: string,
  query?: Record<string, string | number | null | undefined>,
): string {
  const base = `${functionsHost(supabaseUrl)}/${functionName}`;
  if (!query) return base;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === null || v === undefined) continue;
    usp.append(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `${base}?${qs}` : base;
}
