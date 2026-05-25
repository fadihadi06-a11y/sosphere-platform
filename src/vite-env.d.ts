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

// P0-ci-cleanup-strict (2026-05-24): @types/qrcode is not in package.json
// but the qrcode library is used in certification-system.tsx. Shim it.
declare module "qrcode";

// P0-doctrine-completion (2026-05-25): papaparse is used in enterprise-import-wizard.
// We don't pull in @types/papaparse to keep the dep tree minimal; shim as any.
declare module "papaparse";

// P0-ci-cleanup-strict (2026-05-24): expand the leaflet shim above so the
// dashboard-sar-page.tsx's typed references like `leaflet.Map` and
// `leaflet.LayerGroup` type-check. We keep them as `any` because we
// intentionally don't depend on @types/leaflet.
declare module "leaflet" {
  // P0-doctrine-completion (2026-05-25): leaflet exports the same identifiers as
  // BOTH values (constructors / fns) AND types (L.Map, L.LayerGroup as type refs).
  // Without the `type` aliases, `useRef<L.Map | null>` fails TS2694.
  export const Map: any;
  export type Map = any;
  export const LayerGroup: any;
  export type LayerGroup = any;
  export const Marker: any;
  export type Marker = any;
  export const Icon: any;
  export type Icon = any;
  export const TileLayer: any;
  export type TileLayer = any;
  export const LatLngBounds: any;
  export type LatLngBounds = any;
  // P0-doctrine-completion (2026-05-25): risk-map-live + map-screen use these.
  export const Polyline: any;
  export type Polyline = any;
  export const CircleMarker: any;
  export type CircleMarker = any;
  export const latLng: any;
  export const map: any;
  export const tileLayer: any;
  export const marker: any;
  export const layerGroup: any;
  export const icon: any;
  const _default: any;
  export default _default;
}
