import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";
import "./styles/mobile.css";
import "./styles/native-compat.css";
import { initEnvShield } from "./app/components/env-shield-v2";
import { testConnection, validateProductionEnvironment } from "./app/components/api/supabase-client";
import { AppErrorBoundary } from "./app/components/error-boundary";
import { initSentry } from "./app/components/sentry-client";
import { initCapacitorBridge } from "./app/components/capacitor-bridge";
import { runLegacyMigrations } from "./app/components/storage-keys";

// ─────────────────────────────────────────────────────────────────
// Stale-chunk-after-deploy self-heal AT THE SOURCE.
// Vite fires `vite:preloadError` on window when a dynamically-imported
// chunk (a lazy-loaded route/page) 404s because a new deploy replaced the
// hashed filenames the user's cached index.html still points at. We reload
// ONCE to pull the fresh manifest — catching the failure BEFORE it bubbles
// into React, so the user never sees a broken page. A 20s sessionStorage
// guard prevents a reload loop if the chunk is genuinely gone (real 404).
// This is the production fix for Sentry "Failed to fetch dynamically
// imported module" (dashboard-sar-page / dashboard-incident-investigation).
// ─────────────────────────────────────────────────────────────────
window.addEventListener("vite:preloadError", (e) => {
  try {
    const k = "sos_preload_reloaded_at";
    const last = Number(sessionStorage.getItem(k) || 0);
    if (Date.now() - last > 20000) {
      sessionStorage.setItem(k, String(Date.now()));
      e.preventDefault();
      window.location.reload();
    }
  } catch { /* sessionStorage unavailable — error boundary self-heal is the fallback */ }
});

// MUST RUN FIRST: Initialize Environment Shield to prevent secret leakage
initEnvShield();

// Initialize Capacitor bridge for native platform features
initCapacitorBridge();

// CRIT-#2 (2026-04-27): migrate legacy localStorage keys to the canonical
// sosphere_* prefix. Idempotent — safe to call on every cold start.
// Without this, existing users coming from previous versions lose
// biometric / audit state on first launch after deploy.
try {
  const { migrated } = runLegacyMigrations();
  if (migrated.length > 0) {
    console.log("[Startup] Migrated legacy storage keys:", migrated);
  }
} catch (e) {
  console.warn("[Startup] runLegacyMigrations error (non-fatal):", e);
}

// Initialize application with async setup (Sentry, validation, connectivity)
async function initializeApp() {
  // Initialize Sentry for production error tracking
  await initSentry();

  // Validate production environment (logs warnings for missing critical services)
  const envValidation = validateProductionEnvironment();
  envValidation.warnings.forEach(w => console.warn(`[Startup] ${w}`));
  envValidation.missing.forEach(m => console.error(`[Startup] CRITICAL: ${m}`));

  // Test backend connectivity
  testConnection();

  // Render app wrapped in error boundary
  createRoot(document.getElementById("root")!).render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  );
}

// Start the application — delay React mount so boot screen stays visible
const doMount = () => {
  initializeApp().catch(err => {
    console.error("[App] Failed to initialize:", err);
    createRoot(document.getElementById("root")!).render(
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    );
  });
};

// Use boot delay if available (set in index.html), otherwise mount immediately
if (typeof (window as any).__delayReactMount === "function") {
  (window as any).__delayReactMount(doMount);
} else {
  doMount();
}
