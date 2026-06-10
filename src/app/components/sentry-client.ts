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
      // KEEP Sentry's default integrations so uncaught errors, unhandled
      // promise rejections, console errors, breadcrumbs, and linked
      // errors are all captured automatically. ONLY filter out:
      //   • Replay — touches PII surfaces (worker names, zones, photos);
      //              opt-in per-page later if/when we need it
      //   • BrowserTracing auto-instrumentation — performance overhead
      //                                         we don't need at this stage
      //
      // Audit 2026-05-09 (FZ verify): the previous `integrations: []`
      // unintentionally disabled globalHandlersIntegration too, so
      // every uncaught error in production was invisible — Sentry only
      // received the manual captureException calls from error boundary
      // + supabase-client + rate-limit-client. Filter approach restores
      // the safety net without re-introducing the PII risks.
      integrations: (defaults) =>
        defaults.filter(
          (i) =>
            i.name !== "Replay" &&
            i.name !== "BrowserTracing" &&
            i.name !== "BrowserProfiling",
        ),
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
        // jsPDF + recharts probe for the global object via
        // Function("return this") as a last-resort fallback. Our strict CSP
        // (no 'unsafe-eval' — intentional, must NOT be relaxed) blocks it, so
        // the browser logs a CSP violation. The libraries fall back to other
        // globalThis detection and keep working, so this is non-actionable
        // noise — not a functional failure. Filter it instead of weakening CSP.
        "unsafe-eval",
        "Refused to evaluate a string as JavaScript",
      ],
    });
    sentryReady = true;

    // ── Diagnostic helper — exposed on window for one-shot verification ──
    // Allows operators to verify Sentry is wired correctly without
    // depending on uncaught-error nuances (different browsers handle
    // anonymous-source errors differently, some are filtered by Sentry's
    // ignoreErrors, etc.). This calls captureMessage explicitly which
    // bypasses ALL integration questions and tests just one thing:
    //   "does the DSN reach Sentry's ingest endpoint?"
    //
    // Usage from browser DevTools Console on the production site:
    //   window.__sosSentryTest();
    //
    // Then check https://sosphere.sentry.io/issues/ — a message titled
    // "[Sentry diagnostic] sosphere-platform — <timestamp>" should
    // appear within ~30 seconds. If it doesn't, the DSN is wrong or
    // the network can't reach ingest.de.sentry.io.
    try {
      (window as unknown as { __sosSentryTest?: () => string }).__sosSentryTest = () => {
        const marker = `[Sentry diagnostic] sosphere-platform — ${new Date().toISOString()}`;
        try {
          Sentry.captureMessage(marker, "info");
          console.log(
            "[sentry] Diagnostic message sent:\n  '%s'\nCheck https://sosphere.sentry.io/issues/ — should appear within 30s.",
            marker,
          );
        } catch (e) {
          console.error("[sentry] Diagnostic capture failed:", e);
        }
        return marker;
      };
    } catch {
      // window may not exist in worker contexts — non-fatal.
    }

    // Keep Sentry's user identity in sync with Supabase auth. One
    // subscription, set up once — we never unsubscribe because the
    // Sentry context should live for the whole app lifetime. If
    // supabase isn't configured (no URL/anon key), .auth methods
    // become no-ops and this just attaches a dead listener.
    try {
      // Initial identity (if the user was already signed in when the
      // app booted — e.g. returning user with a valid session token).
      // E1.6-PHASE3: bootstrap Sentry user from JWT, lock-free.
      const { getStoredUser } = await import("./api/safe-rpc");
      const u = getStoredUser();
      if (u) {
        setSentryUser({ id: u.id, email: u.email ?? undefined });
      }
// W3-43 (B-20, 2026-04-26): capture + unsubscribe to prevent leak.
      if ((globalThis as any).__sentryAuthSub) {
        try { (globalThis as any).__sentryAuthSub.unsubscribe(); } catch {}
      }
      const { data: __sentryAuthData } =       supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user) {
          setSentryUser({ id: session.user.id, email: session.user.email ?? undefined });
      (globalThis as any).__sentryAuthSub = __sentryAuthData?.subscription ?? null;
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

/**
 * L1-A observability: attach the SOS trace_id as a Sentry tag so any
 * exception captured DURING an active SOS lifecycle is filterable in
 * the Sentry dashboard by the same correlation key used in DB logs +
 * Twilio statusCallback + audit_log rows.
 *
 * Set at the moment of button-press (sos-server-trigger.ts) and
 * cleared when the session ends (endServerSOS) so cross-incident
 * Sentry events don't inherit stale trace_ids. Pass `null` to clear.
 */
export function setSentryTraceId(traceId: string | null): void {
  if (!sentryReady) return;
  try {
    Sentry.setTag("sos_trace_id", traceId ?? "none");
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
