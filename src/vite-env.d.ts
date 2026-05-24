/// <reference types="vite/client" />

// P0-ci-cleanup (2026-05-23): without this triple-slash reference, TypeScript
// does not know about `import.meta.env` (a Vite-injected augmentation of the
// standard `ImportMeta` type). The vite/client types declare the
// ImportMetaEnv shape (`MODE`, `BASE_URL`, `PROD`, `DEV`, `SSR`, etc.) plus
// the generic `VITE_*` string passthrough.
//
// Affected files before this fix (TS2339 "Property 'env' does not exist on
// type 'ImportMeta'"):
//   src/app/components/api/supabase-client.ts:4-5
//   src/app/components/api/fcm-push.ts:40
// And any future file using import.meta.env.

// If a non-standard env var needs typing, add it here:
// interface ImportMetaEnv {
//   readonly VITE_MY_CUSTOM_KEY: string;
// }

// P0-ci-cleanup-deep (2026-05-24): leaflet ships its own types via
// @types/leaflet, but we don't depend on it (and don't want to). The
// `leaflet` package is imported in src/app/components/map-screen.tsx via
// a dynamic import for the lazy map widget. Without a declaration TS7016
// surfaces. Shim the module as `any` so the dynamic import keeps working
// without forcing a full @types/leaflet install (which would pull in
// additional transitive packages).
declare module "leaflet";
