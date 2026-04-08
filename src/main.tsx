import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";
import "./styles/mobile.css";
import { testConnection, validateProductionEnvironment } from "./app/components/api/supabase-client";
import { initSentry, AppErrorBoundary } from "./app/components/error-boundary";

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

// Start the application
initializeApp().catch(err => {
  console.error("[App] Failed to initialize:", err);
  // Render app anyway — error boundary will catch issues
  createRoot(document.getElementById("root")!).render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  );
});
