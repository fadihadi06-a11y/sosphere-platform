import { useEffect } from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { AppErrorBoundary } from "./components/error-boundary";
import { registerServiceWorker } from "./components/service-worker-register";
import { isNativeApp } from "./components/capacitor-bridge";
// Mobile audit fix (2026-05-27): bootstrap encrypted caches at app startup.
import { initStorage } from "./components/api/storage-adapter";
import { initAuditStore } from "./components/audit-log-store";
import { initDuressService } from "./components/duress-service";
import { initSosEmergency } from "./components/sos-emergency";

export default function App() {
  useEffect(() => {
    void (async () => {
      try {
        await initStorage();
        await Promise.all([initAuditStore(), initDuressService(), initSosEmergency()]);
      } catch (e) {
        console.warn("[App] secure-storage init failed:", e);
      }
    })();
    if (!isNativeApp()) {
      registerServiceWorker();
    }
  }, []);

  return (
    <AppErrorBoundary>
      <RouterProvider router={router} />
    </AppErrorBoundary>
  );
}
