import { useEffect } from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { AppErrorBoundary } from "./components/error-boundary";
import { registerServiceWorker } from "./components/service-worker-register";
import { SafeAreaProvider } from "./components/native-safe-area-v2";
import { isNativeApp } from "./components/capacitor-bridge";

export default function App() {
  useEffect(() => {
    // Skip service worker on Capacitor — it conflicts with native file serving
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