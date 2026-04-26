# SOSphere — BLOCKER Fixes Progress (2026-04-25)
**Reference:** AUDIT_MASTER_REPORT.md §2

## ✅ Completed (9/18)

### Server-side (deployed live to Supabase)
| BLOCKER | Function | Version | Change |
|---|---|---|---|
| **B-01** | `dashboard-actions` | v4 | Cross-company `.or()` lookup now scoped by `company_id` + emergencyId regex-validated. |
| **B-09** | `twilio-call` + `twilio-status` | v9 / v11 | Self-signed `gtok` HMAC token added to `<Gather action="...">`; `twilio-status` requires valid token before processing gather payload. |
| **B-11** | `invite-employees` | v13 | Every row must declare `company_id`; all rows must share the same one; caller must own it. |
| **B-12** | `send-invitations` | v16 | `inviteCode` now verified against `company_invites.created_by` or legacy `invites` + companies.owner. |
| **B-13** | `stripe-webhook` | v4 | On `UnmappedPriceError`, persists raw event to new `stripe_unmapped_events` table + returns **503** so Stripe retries (was 400). |

### Client-side (in source, deploy via `npm run build` + Vercel)
| BLOCKER | File | Change |
|---|---|---|
| **B-02** | `ai-co-admin.tsx` + `dashboard-actions-client.ts` (new) + `utils/emergency-services.ts` (new) | All toast-only emergency actions wired to real `dashboard-actions` edge function. Call-997 + Notify-Family modals use human-in-the-loop pattern (`tel:` + outcome confirmation). Removed false ISO 45001 / OSHA / Saudi-courts JSX badges. PDF redirected to `generateEmergencyLifecyclePDF`. |
| **B-05** | `smart-timeline-tracker.ts` | Removed `sha256Sync` FNV-1a fallback. Added required `signed: boolean` field. Async path uses real SHA-256 + signed:true; sync path uses `UNSIGNED:` placeholder + signed:false. `verifyChainIntegrity` excludes signed:false from tamper-evident claim. Backward-compat: cached entries auto-classified by hash format. |
| **B-07** | `individual-register.tsx` | Added typed `parseVerifyAgeResponse()` discriminated union. Removed all `as any` casts. After RPC OK, calls `is_age_verified()` RPC as a second authoritative gate before marking stage `verified`. |

### Database
| Migration | Purpose |
|---|---|
| `20260425094500_stripe_unmapped_events.sql` | Forensic recovery store for B-13 (already applied). |

### Pending deploy (source has fix; needs `supabase functions deploy`)
| BLOCKER | Function | Why pending |
|---|---|---|
| **B-10** | `sos-alert` | File is 56KB — too large for inline MCP deploy. Fix is in `supabase/functions/sos-alert/index.ts` lines 800-867. Run `supabase functions deploy sos-alert --project-ref rtfhkbskgrasamhjraul` from your machine. |

## 🟡 Remaining BLOCKERs (9/18)

| BLOCKER | Area | Fix complexity |
|---|---|---|
| B-03 | `voice-provider-hybrid.ts` dispose race | Add `AbortController` |
| B-04 | `voice-call-engine.ts` levelInterval leak | Synchronous cleanup of interval before flag flip |
| B-06 | `ai-co-admin.tsx` + `intelligent-guide.tsx` phase timeouts no auto-escalate | Force-transition on timeout + audit entry |
| B-08 | `consent-screens.tsx` localStorage-only consent | Persist `profiles.consent_at` server-side |
| B-14 | `public/sw.js` caches all GETs | Allow-list static-only paths; skip `/rest/`, `/auth/`, `/realtime/`, `/functions/` |
| B-15 | `gps_trail.employee_id` text → UUID | Migration + data backfill window |
| B-16 | `evidence_vaults.user_id` text → UUID | Migration + data backfill window |
| B-17 | Civilian Stripe payment is fake | Wire to existing `stripe-checkout` edge function |
| B-18 | More false certification claims (search-and-replace across landing/dashboard/PDF templates) | Source audit + replace |

## How to deploy what's pending

```bash
# From your project root (Windows PowerShell or Linux/Mac terminal)
supabase functions deploy sos-alert --project-ref rtfhkbskgrasamhjraul

# Or deploy all functions at once:
supabase functions deploy --project-ref rtfhkbskgrasamhjraul
```

Then commit + push the source changes:

```bash
git add -A
git commit -m "audit: B-01/B-02/B-05/B-07/B-09/B-10/B-11/B-12/B-13 — 9 BLOCKERs fixed"
git push
```

(Vercel auto-deploys client on push to main.)
