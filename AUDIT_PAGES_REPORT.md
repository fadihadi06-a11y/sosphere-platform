# Pages Audit Report
*Generated 2026-05-30 — SOSphere*

Automated scan of 41 user-facing pages (30 dashboard + 11 mobile). Each page
checked for: data sourcing, UX states, accessibility, internationalization,
code quality, file size.

## Executive Summary

| Severity | Issue | Count | Impact |
|---|---|---|---|
| 🔴 Critical | Pages with `console.*` debug leftovers (≥10) | 4 | Production logs noise, perf |
| 🔴 Critical | Pages using mock data (`SUPABASE_MIGRATION_POINT`) | 12 | Stale demos, not real data |
| 🟡 Major | XL files needing refactor (>50KB) | 16 | Maintainability, build time |
| 🟡 Major | Pages with excessive `any` types | 9 | Type safety, runtime errors |
| 🟢 UX gap | Missing loading state | 24 | Janky UX during fetch |
| 🟢 UX gap | Missing error handling/UI | 31 | Silent failures |
| 🟢 UX gap | Missing empty state | 33 | "Where is my data?" confusion |
| ♿ A11y | No ARIA labels | 36 | Screen reader broken |
| 🌐 i18n | No `t()` helper usage | 35 | English-only / hardcoded strings |

## Top Critical Pages

### `dashboard-pages.tsx` — **259 KB MONOLITH**
The largest file in the project. Contains multiple page implementations
crammed into one module. **Refactor priority #1**: split into
`dashboard-overview.tsx`, `dashboard-emergencies.tsx`, etc.

### `sos-emergency.tsx` — 226 KB + 45 console calls
The core mobile SOS screen has heavy debug logging that should be replaced
with structured `audit_log` writes or behind a `__DEV__` flag.

### `company-dashboard.tsx` — 194 KB + 19 `any` types + 13 localStorage calls
Already partially cleaned (ESLint pass in Phase 2). Remaining: type safety
work and localStorage migration to secure-storage adapter.

### `mobile-app.tsx` — 114 KB + 51 console calls
Same console-cleanup concern as sos-emergency.

## Mock Data → Supabase migration (12 pages)

These pages still use `MOCK_*` data with `SUPABASE_MIGRATION_POINT`
comments marking the intended Supabase queries:

| Page | TODO markers | Tables referenced |
|---|---|---|
| `dashboard-analytics-page` | 10 | analytics aggregations |
| `dashboard-settings-page` | 8 | report_schedules, email_deliveries, … |
| `dashboard-pages` | 3 | responders, emergency_events, system_health |
| `dashboard-leaderboard-page` | 3 | admin_ratings, ire_history, admin_performance |
| `dashboard-risk-register` | 2 | (already migrated in P1) |
| `dashboard-billing-page` | 1 | invoices |
| `dashboard-incident-investigation` | 1 | (already migrated in P1) |
| `dashboard-shift-scheduling-page` | 1 | shifts |
| `sos-emergency` | 4 | (likely emergency-related) |
| `safe-walk-mode` | 2 | (likely tracking) |
| `mobile-app` | 1 | (likely user/profile) |
| `hub-incident-reports` | 1 | (likely incidents) |

## XL Files (>50KB) — refactor candidates

| File | Size |
|---|---|
| `dashboard-pages` | **259 KB** ⚠️ |
| `sos-emergency` | 226 KB |
| `company-dashboard` | 194 KB |
| `mobile-app` | 114 KB |
| `dashboard-settings-page` | 109 KB |
| `dashboard-web-page` | 91 KB |
| `dashboard-sar-page` | 89 KB |
| `dashboard-audit-log-page` | 83 KB |
| `dashboard-geofencing-page` | 82 KB |
| `dashboard-roles-page` | 68 KB |
| `risk-map-live` | 60 KB |
| `dashboard-evacuation-page` | 58 KB |
| `dashboard-incident-investigation` | 56 KB |
| `dashboard-broadcast` | 53 KB |
| `dashboard-billing-page` | 52 KB |
| `hub-incident-reports` | 51 KB |

## A11y disaster (36/41 pages no ARIA)

Only 5 pages have any ARIA attributes. Screen readers cannot navigate
the app. Requires systematic addition of:
- `aria-label` on icon-only buttons
- `aria-live` on dynamic regions (emergency feeds)
- `role` on custom widgets
- `aria-describedby` on form inputs

## i18n gaps (35/41 pages)

The `t()` helper is loaded via context but most pages use hardcoded
English strings. Arabic users see broken UI when `lang === "ar"`.

## Fix Tier Recommendations

### Tier S — fix immediately (security/data correctness)
1. **Console call cleanup** — `mobile-app` (51), `sos-emergency` (45)
   - Replace with `audit_log` for security events or remove
   - 1 hour
2. **`any` type elimination** — `dashboard-audit-log-page` (22), `company-dashboard` (19)
   - Replace with proper types from `dashboard-types.ts`
   - 2 hours per file

### Tier A — high user impact
3. **`dashboard-pages.tsx` split** — 259 KB monolith
   - Refactor into 5-6 sub-files by page (overview, emergencies, etc.)
   - ½ day
4. **Mock → Supabase migration** for 12 marked pages
   - Each ~1-2 hours; analytics + settings highest priority
5. **Error state UI** for 31 pages
   - Standardize on ErrorBoundary + toast.error pattern
   - 30 min/page

### Tier B — UX polish
6. **Loading state** for 24 pages — skeleton or spinner
7. **Empty state** for 33 pages — "no data yet" with action
8. **i18n** for 35 pages — wrap strings in `t()`

### Tier C — long-term hygiene
9. **A11y** for 36 pages — ARIA labels + roles
10. **XL files refactor** — split files > 50 KB

## Next Action Picker

To proceed efficiently, pick ONE tier above. I'll then split into
file-by-file commits with CI gates between each.
