import { useEffect } from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { AppErrorBoundary } from "./components/error-boundary";
import { registerServiceWorker } from "./components/service-worker-register";

export default function App() {
  useEffect(() => {
    registerServiceWorker();
  }, []);

  return (
    <AppErrorBoundary>
      <RouterProvider router={router} />
    </AppErrorBoundary>
  );
}