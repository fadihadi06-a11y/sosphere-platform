// =================================================================
// SOSphere — Error Boundary System
// =================================================================
// Prevents a single component crash from taking down the entire app.
// CRITICAL for a safety application — SOS must always be accessible.
//
// Three levels:
//   1. AppErrorBoundary     — Wraps the entire router (last resort)
//   2. PageErrorBoundary    — Wraps each dashboard page
//   3. WidgetErrorBoundary  — Wraps individual widgets/cards
//
// PRODUCTION: Connect to Sentry/LogRocket for error reporting:
//   componentDidCatch(error, errorInfo) {
//     Sentry.captureException(error, { extra: errorInfo });
//   }
// =================================================================

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Shield, Home } from "lucide-react";

// ── Sentry Integration ──
// Now installed as @sentry/react dependency
let _sentryInitialized = false;
let _Sentry: any = null;

/** Initialize Sentry for production error tracking */
export async function initSentry(dsn?: string): Promise<void> {
  if (_sentryInitialized) return;
  const sentryDsn = dsn || import.meta.env.VITE_SENTRY_DSN;
  if (!sentryDsn) {
    console.warn("[Sentry] No DSN configured. Set VITE_SENTRY_DSN in .env to enable error tracking.");
    return;
  }
  try {
    // Try to import the actual package first (it's now installed)
    try {
      _Sentry = await import("@sentry/react");
    } catch {
      // Fallback to dynamic import if package isn't available
      const sentryModule = "@sentry/" + "react";
      _Sentry = await import(/* @vite-ignore */ sentryModule);
    }

    _Sentry.init({
      dsn: sentryDsn,
      environment: import.meta.env.MODE || "production",
      release: `sosphere@${import.meta.env.VITE_APP_VERSION || "1.0.0"}`,
      tracesSampleRate: 0.1, // 10% of transactions for performance monitoring
      replaysSessionSampleRate: 0.0, // Disable session replay for privacy
      replaysOnErrorSampleRate: 1.0, // Capture replay on every error
      beforeSend(event: any) {
        // Scrub sensitive data
        if (event.request?.headers) delete event.request.headers["Authorization"];
        if (event.extra?.phone) event.extra.phone = "[REDACTED]";
        return event;
      },
    });
    _sentryInitialized = true;
    console.log("[Sentry] Initialized successfully");
  } catch (err) {
    console.warn("[Sentry] Failed to initialize:", err);
  }
}

/** Set Sentry user context (call when user logs in) */
export function setSentryUser(userId: string, email?: string, phone?: string): void {
  if (_sentryInitialized && _Sentry?.setUser) {
    _Sentry.setUser({
      id: userId,
      email: email || undefined,
      username: phone || undefined,
    });
  }
}

/** Clear Sentry user context (call on logout) */
export function clearSentryUser(): void {
  if (_sentryInitialized && _Sentry?.setUser) {
    _Sentry.setUser(null);
  }
}

/** Tag events with emergency context (critical for safety) */
export function setSentryEmergencyContext(active: boolean): void {
  if (_sentryInitialized && _Sentry?.setTag) {
    _Sentry.setTag("emergency_active", active ? "true" : "false");
  }
}

// ── SOSphere Error Telemetry ──
// Production-ready error reporting. Sentry integration point.
// When Sentry is connected, replace reportError() body with Sentry.captureException()
interface ErrorReport {
  error: Error;
  context?: Record<string, any>;
  severity: "fatal" | "error" | "warning";
  component?: string;
}

const _errorQueue: ErrorReport[] = [];
const _errorListeners: ((report: ErrorReport) => void)[] = [];

/** Report an error to telemetry. In production, this sends to Sentry. */
export function reportError(
  error: Error | string,
  context?: Record<string, any>,
  severity: "fatal" | "error" | "warning" = "error"
): void {
  const err = typeof error === "string" ? new Error(error) : error;
  const report: ErrorReport = { error: err, context, severity };

  // Always log to console with structured data
  const logFn = severity === "fatal" ? console.error : severity === "warning" ? console.warn : console.error;
  logFn(`[SOSphere:${severity}]`, err.message, context || "");

  // Queue for telemetry (Sentry, DataDog, etc.)
  _errorQueue.push(report);
  if (_errorQueue.length > 100) _errorQueue.shift();

  // Notify listeners (for UI error indicators)
  for (const cb of _errorListeners) {
    try { cb(report); } catch { /* prevent listener errors from cascading */ }
  }

  // Send to Sentry if initialized
  if (_sentryInitialized && _Sentry) {
    try {
      _Sentry.captureException(err, {
        extra: context,
        level: severity,
        tags: { component: context?.component || "unknown" },
      });
    } catch { /* Sentry send failed — don't recurse */ }
  }
}

/** Subscribe to error reports (for dashboard error indicators) */
export function onErrorReport(cb: (report: ErrorReport) => void): () => void {
  _errorListeners.push(cb);
  return () => {
    const idx = _errorListeners.indexOf(cb);
    if (idx >= 0) _errorListeners.splice(idx, 1);
  };
}

/** Get queued errors (for debugging / admin panel) */
export function getErrorQueue(): ErrorReport[] {
  return [..._errorQueue];
}

// =================================================================
// Types
// =================================================================

interface ErrorBoundaryProps {
  children: ReactNode;
  level?: "app" | "page" | "widget";
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** If true, shows a minimal inline error instead of full-page */
  inline?: boolean;
  /** Label for the section (shown in error message) */
  label?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

// =================================================================
// Error Boundary Component (Class — React requires it)
// =================================================================

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });

    // Report to telemetry using structured error reporting
    reportError(error, { componentStack: errorInfo?.componentStack, level: this.props.level, label: this.props.label }, "fatal");

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback
      if (this.props.fallback) return this.props.fallback;

      // Inline error (for widgets)
      if (this.props.inline || this.props.level === "widget") {
        return (
          <div className="flex items-center gap-2 p-3 rounded-xl" style={{
            background: "rgba(255,45,85,0.06)",
            border: "1px solid rgba(255,45,85,0.12)",
          }}>
            <AlertTriangle className="size-4 shrink-0" style={{ color: "#FF2D55" }} />
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
              {this.props.label || "Component"} failed to load
            </span>
            <button
              onClick={this.handleRetry}
              className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg"
              style={{
                fontSize: 10,
                color: "#00C8E0",
                background: "rgba(0,200,224,0.08)",
                border: "1px solid rgba(0,200,224,0.15)",
              }}
            >
              <RefreshCw className="size-3" /> Retry
            </button>
          </div>
        );
      }

      // Full page error (for pages)
      if (this.props.level === "page") {
        return (
          <div className="flex flex-col items-center justify-center p-8 min-h-[400px] gap-4">
            <div className="p-4 rounded-2xl" style={{
              background: "rgba(255,45,85,0.08)",
              border: "1px solid rgba(255,45,85,0.15)",
            }}>
              <AlertTriangle className="size-8" style={{ color: "#FF2D55" }} />
            </div>
            <div className="text-center">
              <p style={{ fontSize: 16, color: "rgba(255,255,255,0.9)", fontWeight: 600 }}>
                {this.props.label || "Page"} encountered an error
              </p>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
                {this.state.error?.message || "Something went wrong"}
              </p>
            </div>
            <button
              onClick={this.handleRetry}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl"
              style={{
                fontSize: 13,
                color: "#fff",
                background: "linear-gradient(135deg, #00C8E0, #0088A0)",
                fontWeight: 600,
              }}
            >
              <RefreshCw className="size-4" /> Try Again
            </button>
          </div>
        );
      }

      // App-level error (last resort — keeps SOS accessible)
      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-6 gap-6"
          style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}>
          <div className="p-5 rounded-3xl" style={{
            background: "rgba(255,45,85,0.08)",
            border: "1px solid rgba(255,45,85,0.15)",
            boxShadow: "0 0 60px rgba(255,45,85,0.1)",
          }}>
            <Shield className="size-12" style={{ color: "#FF2D55" }} />
          </div>

          <div className="text-center max-w-md">
            <h1 style={{ fontSize: 22, color: "#fff", fontWeight: 700, marginBottom: 8 }}>
              SOSphere Error
            </h1>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
              The application encountered an unexpected error. Your safety data is preserved.
            </p>
            {this.state.error && (
              <p className="mt-3 p-3 rounded-xl" style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.3)",
                background: "rgba(255,255,255,0.03)",
                fontFamily: "monospace",
                wordBreak: "break-all",
              }}>
                {this.state.error.message}
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={this.handleRetry}
              className="flex items-center gap-2 px-5 py-3 rounded-xl"
              style={{
                fontSize: 14,
                color: "#fff",
                background: "linear-gradient(135deg, #00C8E0, #0088A0)",
                fontWeight: 600,
              }}
            >
              <RefreshCw className="size-4" /> Reload App
            </button>
            <button
              onClick={() => window.location.href = "/"}
              className="flex items-center gap-2 px-5 py-3 rounded-xl"
              style={{
                fontSize: 14,
                color: "rgba(255,255,255,0.6)",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
                fontWeight: 500,
              }}
            >
              <Home className="size-4" /> Go Home
            </button>
          </div>

          {/* Emergency SOS — ALWAYS accessible even after crash */}
          <div className="mt-8 pt-6" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 8, textAlign: "center" }}>
              In case of emergency, call directly:
            </p>
            <div className="flex gap-3">
              <a href="tel:911" className="flex items-center gap-2 px-4 py-2 rounded-xl"
                style={{ fontSize: 13, color: "#FF2D55", background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.15)", fontWeight: 700 }}>
                Call 911
              </a>
              <a href="tel:999" className="flex items-center gap-2 px-4 py-2 rounded-xl"
                style={{ fontSize: 13, color: "#FF2D55", background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.15)", fontWeight: 700 }}>
                Call 999
              </a>
              <a href="tel:112" className="flex items-center gap-2 px-4 py-2 rounded-xl"
                style={{ fontSize: 13, color: "#FF2D55", background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.15)", fontWeight: 700 }}>
                Call 112
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// =================================================================
// Convenience Wrappers
// =================================================================

/** Wraps the entire app router */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary level="app" label="SOSphere App">
      {children}
    </ErrorBoundary>
  );
}

/** Wraps a dashboard page */
export function PageErrorBoundary({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ErrorBoundary level="page" label={label}>
      {children}
    </ErrorBoundary>
  );
}

/** Wraps a widget/card (inline error) */
export function WidgetErrorBoundary({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ErrorBoundary level="widget" label={label} inline>
      {children}
    </ErrorBoundary>
  );
}

// =================================================================
// Sentry Test Button (Dev-Only)
// =================================================================

/**
 * Dev-only button to trigger a test error and verify Sentry integration.
 * Visible only in development mode (import.meta.env.MODE !== 'production')
 */
export function SentryTestButton() {
  if (import.meta.env.MODE === 'production') return null;

  const handleTestError = () => {
    try {
      throw new Error('[Sentry Test] This is a intentional test error to verify Sentry integration');
    } catch (err) {
      reportError(err, { type: 'sentry_test_error', context: 'SentryTestButton', severity: 'warning' }, 'warning');
    }
  };

  return (
    <button
      onClick={handleTestError}
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        padding: '8px 12px',
        fontSize: 12,
        backgroundColor: '#00C8E0',
        color: '#000',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        zIndex: 9999,
        opacity: 0.7,
        transition: 'opacity 0.2s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
      onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
      title="Dev: Click to test Sentry error reporting"
    >
      Test Sentry
    </button>
  );
}

// ── Global Unhandled Error Catchers ──
// Catches async errors that ErrorBoundary can't intercept
if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    reportError(
      event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
      { type: "unhandled_promise_rejection" },
      "error"
    );
  });

  window.addEventListener("error", (event) => {
    if (event.error) {
      reportError(event.error, { type: "uncaught_error", filename: event.filename, lineno: event.lineno }, "fatal");
    }
  });
}
