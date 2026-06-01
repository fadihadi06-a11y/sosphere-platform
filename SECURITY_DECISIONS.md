# SOSphere Security Decisions Log

Append-only record of intentional security design choices that auditors
or future developers might question. Each entry explains *why* a feature
that looks like a security control was removed, weakened, or restructured.

---

## 2026-05-31 — Removed PIN Authentication (CRIT-1)

### What was removed
- `src/app/components/pin-verify-modal.tsx` (the modal component)
- `requirePIN()` helper + `pinModal` state in `dashboard-roles-page.tsx`
- `public.user_pins` table (was empty — never populated in production)
- Migration: `supabase/migrations/20260530_p2_drift_user_pins.sql`
  (kept in git as historical record; reverted via DROP TABLE)

### Why
PIN auth as previously implemented was **security theater**:

1. **Same auth-factor type as password** — both are "knowledge" factors per
   NIST SP 800-63B. A real step-up requires a *different* factor (TOTP/MFA
   = "possession"; biometric = "inherence"). Adding a second knowledge
   factor adds UX friction without raising the trust ceiling.

2. **Implementation bug** — the lookup key was
   `` `${actorLevel}-${actorName}` `` (e.g. `"main_admin-Ahmed Khalil"`),
   but the `user_pins` row was keyed on `auth.uid()` UUID. The two values
   could never match. In production, the modal would always reject; in
   dev, it would always accept `123456`. So the PIN ceremony was either
   blocking or accepting based on environment, never on actual auth state.

3. **Low entropy** — 6 digits = 10⁶ possibilities. Without rate limiting
   that fails closed across all sessions (the modal had a 3-attempt
   per-mount cooldown only), brute force is feasible. By contrast, a
   Supabase password is bcrypt-hashed and rate-limited at the Auth layer.

4. **Not actually wired to the critical ops it claimed to gate** — the
   `OPERATION_CONFIG` declared `revoke_access`, `suspend_user`,
   `bulk_import` as PIN-protected, but no code path ever called
   `requirePIN("revoke_access", ...)` etc. Billing, owner-transfer,
   MFA-disable, and delete-account also had no PIN gate despite UI
   suggesting otherwise.

### What protects sensitive ops now
The real authorization stack — already in place and well-tested:

| Layer | Mechanism | Where |
|---|---|---|
| **Identity** | Supabase Auth (JWT, bcrypt password, MFA-TOTP available) | `mfa-client.ts` + Supabase built-in |
| **Step-up auth** (optional) | Supabase MFA `auth.mfa.challenge()` re-verify | `mfa-enrollment-modal.tsx` + `mfa-challenge-modal.tsx` |
| **Authorization** | `verify_permission` SECDEF RPC, 30s in-memory cache, fail-closed | `api/server-permission.ts` |
| **Row-level isolation** | RLS policies on every PII table (`is_company_member`, `is_company_owner`) | `supabase/migrations/*_rls_*.sql` |
| **Audit trail** | `audit_log` table, hash-chained, tamper-evident | `audit-log-store.ts` + `log_sos_audit` RPC |

Result: any UI action that's not allowed for the actor's role will be
rejected server-side regardless of whether the client UI displays a
fake PIN prompt. UI now matches reality.

### Future: if real step-up auth is needed
For specific high-risk operations (delete-account, owner-transfer,
billing-change), the gold-standard pattern is to re-challenge MFA via
Supabase's `auth.mfa.challenge()` API. This:
- Uses a **different factor** (TOTP code from user's phone)
- Reuses existing `mfa-challenge-modal.tsx` infrastructure
- Is industry standard (Google, AWS, GitHub all do this)
- Skips gracefully for users without MFA enrolled (security tradeoff)

This is **NOT implemented yet** — defer until a concrete need is identified.

### Compliance impact
- ISO 45001 / 27001: authorization is documented (verify_permission), audit
  trail is hash-chained, PII access is RLS-scoped. PIN removal does not
  weaken any documented control.
- GDPR Art. 32: appropriate technical measures are unchanged — Supabase
  Auth + MFA + RLS + audit are the documented controls.
- No regulator requires a 6-digit PIN as a separate auth factor.

---

## 2026-05-31 — Marked Custom TOTP Engine as Dead Code (CRIT-6)

### Status
Not yet removed. Tracked for follow-up.

### What it is
`src/app/components/api/totp-engine.ts` plus the RPCs
`save_totp_secret`, `verify_user_2fa`, `get_totp_secret_for_verify`
and the `public.user_2fa` table. Built in P2-Followup A + C as a
server-side TOTP system with pgp_sym_encrypt'd secrets and HMAC
verification entirely in Postgres (RFC 6238 test vectors pass).

### Why it's dead
Audited 2026-05-31: zero files in `src/` import `totp-engine.ts`. The
live MFA flow uses Supabase native `auth.mfa.*` via
`api/mfa-client.ts` → `mfa-enrollment-modal.tsx` /
`mfa-challenge-modal.tsx`. Two parallel 2FA systems coexist; only
Supabase's is wired to UI.

### Why not remove yet
- The DB plumbing is verified against RFC test vectors and could be
  useful if a future flow needs custom factor management (e.g. employee
  PINs that ARE separate from password, hardware-token rotation).
- Removing also requires dropping `user_2fa` table + 3 RPCs + 1
  migration; merits its own ticket.

### What to do
Either:
(a) Remove in a single cleanup PR once we confirm no plans for it, OR
(b) Wire the existing MFA UI to ALSO record into `user_2fa` so the
    custom system stays in sync as a redundancy.

Decision deferred to product owner.
