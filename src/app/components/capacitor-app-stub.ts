/**
 * Capacitor stub for web/Vercel builds.
 * On Android, the real @capacitor/app takes over via the native bridge.
 * This file is aliased in vite.config.ts to prevent build errors.
 */
export const App = {
  addListener: (_event: string, _handler: () => void) => {
    return Promise.resolve({ remove: () => {} });
  },
  exitApp: () => {},
};
