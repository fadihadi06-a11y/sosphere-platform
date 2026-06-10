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
import { useLang } from "./components/useLang";

export default function App() {
  // ROOT-CAUSE FIX (2026-06-10): index.html hardcodes
  // <html lang="ar" dir="rtl">, so every screen inherited RTL — even
  // English surfaces (e.g. the dashboard sign-in card), which made
  // numbers/punctuation reorder. Direction must follow the ACTIVE
  // language, not a static default. useLang() re-renders on every
  // language change (same tab or cross-tab), keeping this in sync.
  const { lang, isAr } = useLang();
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = lang;
    document.documentElement.dir = isAr ? "rtl" : "ltr";
  }, [lang, isAr]);

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
