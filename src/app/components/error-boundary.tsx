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
import { captureException } from "./sentry-client";
import { safeTelCall } from "./utils/safe-tel";

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

    // Log to console (always) — dev gets the full React stack here
    // regardless of whether Sentry is wired.
    console.error(`[SOSphere ErrorBoundary] ${this.props.label || "Unknown"}:`, error, errorInfo);

    // Forward to Sentry (P3-#12). Tags let us filter the dashboard by
    // boundary level ("app" vs "page" vs "widget"), and the extras
    // carry the component stack so we can reproduce the failing tree.
    // captureException itself is Sentry-off safe — it degrades to a
    // console.warn when initSentry bailed (dev / no DSN / init failure).
    captureException(error, {
      tags: {
        boundary_level: this.props.level ?? "unknown",
        boundary_label: this.props.label ?? "unknown",
      },
      extra: {
        componentStack: errorInfo.componentStack ?? "",
      },
    });

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
            {/* FIX 2026-04-23: replaced <a href="tel:..."> with buttons using safeTelCall.
                On Android native the tel: URI surfaces the OS app chooser (WhatsApp / Zoom
                / Truecaller); safeTelCall routes through capacitor-call-number with
                bypassAppChooser on native, tel: on mobile web, toast on desktop. */}
            <div className="flex gap-3">
              <button type="button" onClick={() => safeTelCall("911", "Emergency")} className="flex items-center gap-2 px-4 py-2 rounded-xl"
                style={{ fontSize: 13, color: "#FF2D55", background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.15)", fontWeight: 700, cursor: "pointer" }}>
                Call 911
              </button>
              <button type="button" onClick={() => safeTelCall("999", "Emergency")} className="flex items-center gap-2 px-4 py-2 rounded-xl"
                style={{ fontSize: 13, color: "#FF2D55", background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.15)", fontWeight: 700, cursor: "pointer" }}>
                Call 999
              </button>
              <button type="button" onClick={() => safeTelCall("112", "Emergency")} className="flex items-center gap-2 px-4 py-2 rounded-xl"
                style={{ fontSize: 13, color: "#FF2D55", background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.15)", fontWeight: 700, cursor: "pointer" }}>
                Call 112
              </button>
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
