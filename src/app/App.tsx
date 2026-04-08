import { useEffect } from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { AppErrorBoundary } from "./components/error-boundary";
import { registerServiceWorker } from "./components/service-worker-register";
import { SafeAreaProvider } from "./components/native-safe-area";

export default function App() {
  useEffect(() => {
    registerServiceWorker();
  }, []);

  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <RouterProvider router={router} />
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}