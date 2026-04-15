// ═══════════════════════════════════════════════════════════════
// SOSphere — Sentry Client (P3-#12)
// ─────────────────────────────────────────────────────────────
// Central wiring for production error tracking. Three responsibilities:
//
//   1. initSentry()        — called once from main.tsx. Only activates
//                            when VITE_SENTRY_DSN is set AND we're in
//                            production mode. In dev / tests / missing
//                            DSN, it's a no-op so local work never
//                            trips the network or pollutes the Sentry
//                            dashboard with dev noise.
//
//   2. captureException()  — safe wrapper used by error boundaries
//                            and the log-and-swallow service layer.
//                            Never throws, never rejects — if Sentry
//                            isn't initialized this drops to a
//                            console.warn so errors are still visible
//                            locally.
//
//   3. setSentryUser() /   — surface light identity + company context
//      setSentryCompany()   on every event so multi-tenant bug reports
//                            can be filtered by tenant without
//                            embedding PII. We deliberately pass only
//                            `id` + `email` for the user — no names,
//                            no phone numbers, no roles (roles live
//                            in audit_log if we need to cross-ref).
//
// Privacy note: `beforeSend` strips any accidental PII from breadcrumb
// URLs (search params commonly contain tokens) and drops events from
// localhost so a misconfigured local build can't leak to production
// Sentry. This is belt-and-braces — we also gate on import.meta.env.PROD.
// ═══════════════════════════════════════════════════════════════

import * as Sentry from "@sentry/react";
import { supabase } from "./api/supabase-client";

/** Module-local flag so captureException/setSentryUser know whether
 *  init actually took effect, even if the DSN was missing and init
 *  silently bailed. */
let sentryReady = false;

/**
 * Idempotent init. Safe to call repeatedly — second and subsequent
 * calls are no-ops. Intended entry point: main.tsx bootstrap.
 */
export async function initSentry(): Promise<void> {
  if (sentryReady) return;

  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined) ?? "";
  const isProd = Boolean(import.meta.env.PROD);

  // In dev and in envs without a DSN we deliberately skip init. This
  // keeps local development flows free of any Sentry traffic and
  // ensures the landmines around PII replay can't bite while we iterate.
  if (!dsn || !isProd) {
    if (!dsn && isProd) {
      // Only complain loudly in prod — a prod build without a DSN is a
      // deploy-time mistake that a humans should fix immediately.
      console.error(
        "[sentry] VITE_SENTRY_DSN is not set. Production errors will be invisible.",
      );
    }
    return;
  }

  try {
    Sentry.init({
      dsn,
      // Lower sample rate than default; SOS is a low-traffic / high-impact
      // app so we don't need full tracing, but we do want every hard error.
      tracesSampleRate: 0.05,
      // Replay integration is not enabled by default — recording touches
      // PII surfaces (dashboards show worker names, zones, etc.). Opt-in
      // per-page later if we need it, but never globally.
      integrations: [],
      environment: (import.meta.env.VITE_ENVIRONMENT as string | undefined) ?? "production",
      release: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? undefined,

      // Belt-and-braces filters. Drop localhost events (misconfigured
      // dev builds), drop noisy Chrome-extension stack frames, and
      // scrub common token-bearing URL params from breadcrumbs.
      beforeSend(event) {
        const req = event.request;
        if (req?.url && /localhost|127\.0\.0\.1/.test(req.url)) return null;
        return scrubEvent(event);
      },
      beforeBreadcrumb(crumb) {
        if (crumb?.data && typeof crumb.data.url === "string") {
          crumb.data.url = scrubUrl(crumb.data.url);
        }
        return crumb;
      },

      // Ignore noisy errors that aren't actionable. These are thrown
      // by browser quirks (ResizeObserver loop, autofill cancellation,
      // etc.) and swamp the dashboard if left on.
      ignoreErrors: [
        "ResizeObserver loop limit exceeded",
        "ResizeObserver loop completed with undelivered notifications",
        "Non-Error promise rejection captured",
      ],
    });
    sentryReady = true;

    // Keep Sentry's user identity in sync with Supabase auth. One
    // subscription, set up once — we never unsubscribe because the
    // Sentry context should live for the whole app lifetime. If
    // supabase isn't configured (no URL/anon key), .auth methods
    // become no-ops and this just attaches a dead listener.
    try {
      // Initial identity (if the user was already signed in when the
      // app booted — e.g. returning user with a valid session token).
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        setSentryUser({ id: data.session.user.id, email: data.session.user.email ?? undefined });
      }
      supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user) {
          setSentryUser({ id: session.user.id, email: session.user.email ?? undefined });
        } else {
          setSentryUser(null);
        }
      });
    } catch {
      // Auth bridge is best-effort — never fatal for init.
    }
  } catch (err) {
    // init itself can fail if the DSN is malformed. Don't let this
    // take down the app — we already log-and-swallow everywhere else.
    console.warn("[sentry] init failed:", err);
  }
}

/**
 * Send an exception to Sentry. Safe if Sentry was never initialized —
 * in that case we log to console so the developer still sees it.
 *
 * Tags help filter in the dashboard: pass `{ area: "sos", zone: "..." }`
 * to split by feature surface.
 */
export function captureException(
  err: unknown,
  context?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
): void {
  if (!sentryReady) {
    // Local fallback so nothing is silently swallowed when Sentry is off.
    console.warn("[sentry:offline]", err, context ?? {});
    return;
  }
  try {
    Sentry.withScope((scope) => {
      if (context?.tags) {
        for (const [k, v] of Object.entries(context.tags)) scope.setTag(k, v);
      }
      if (context?.extra) scope.setExtras(context.extra);
      Sentry.captureException(err);
    });
  } catch {
    // Don't let Sentry errors become new errors.
  }
}

/** Attach user identity to subsequent events. Pass `null` on sign-out. */
export function setSentryUser(user: { id: string; email?: string } | null): void {
  if (!sentryReady) return;
  try {
    Sentry.setUser(user ? { id: user.id, email: user.email } : null);
  } catch {}
}

/** Attach current company as a tag so multi-tenant filtering works. */
export function setSentryCompany(companyId: string | null): void {
  if (!sentryReady) return;
  try {
    Sentry.setTag("company_id", companyId ?? "none");
  } catch {}
}

// ── Internal scrubbing helpers ───────────────────────────────
// Strip common token-bearing query params from any URL that lands
// in an event. We keep the path + host so you can still see where
// the error happened.
const SENSITIVE_PARAMS = [
  "token",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "key",
  "password",
  "secret",
  "auth",
];

function scrubUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const p of SENSITIVE_PARAMS) {
      if (u.searchParams.has(p)) u.searchParams.set(p, "[redacted]");
    }
    return u.toString();
  } catch {
    return url;
  }
}

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request?.url) event.request.url = scrubUrl(event.request.url);
  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs.forEach((c) => {
      if (c?.data?.url && typeof c.data.url === "string") {
        c.data.url = scrubUrl(c.data.url);
      }
    });
  }
  return event;
}
