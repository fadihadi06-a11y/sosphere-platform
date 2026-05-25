# Security by design — localStorage usage

**Status:** Active doctrine — last updated 2026-05-26 (PR for B1)
**Owner:** Platform security
**Scope:** All files writing tenant-scoped data to `window.localStorage`
**Reviewer cadence:** quarterly + immediately on multi-user device support

---

## What this document is

This is a written justification for **why CodeQL's `js/clear-text-storage-of-sensitive-data` rule is excluded** in `.github/codeql-config.yml` for the SOSphere platform code. CodeQL is not wrong — it is correctly identifying that we write employee data, audit-log entries, broadcast history, evacuation state, etc. into `localStorage` without encryption. The exclusion is a deliberate doctrine decision, not a security gap, and this document records the reasoning so a future investigator (auditor, new engineer, security review) can understand the choice without spelunking git history.

## The platform's threat model for client-side storage

SOSphere is an **offline-first life-safety platform**:

- The mobile worker app installs on the worker's **own phone**.
- The admin dashboard runs in the admin's **own browser** on the admin's **own device**.
- Field workers may lose cellular / WiFi connectivity in tunnels, basements, remote sites — the app **must keep functioning offline** so SOS, evacuation, and audit logging never depend on a live network round-trip.

The data we keep in `localStorage`:

- Worker status snapshots (`sosphere_emp_status`)
- Outgoing SOS / SyncEvent queue (`sosphere_sync`)
- Broadcast history (`sosphere_broadcasts`)
- Audit log (`sosphere_audit_log`)
- Evacuation state (`sosphere_active_evacuation`, `sosphere_evac_status`)
- Zone configuration (`sosphere_zone_gps`, `sosphere_evac_points`)
- Buddy pairings (`sosphere_buddy_pairs`)
- GPS trails (`sosphere_gps_trail`)

All of the above is **tenant-scoped** — i.e. it belongs to one company's data, on one user's device, owned and operated by that user. The data never leaves that device in plaintext: sync to other devices goes over **Supabase Realtime over TLS**, with row-level security on the receiving side.

The CodeQL rule assumes the worst case where `localStorage` is a sink that an attacker can read (e.g. XSS exfiltration, browser disk dump, malicious extension). For this platform:

- **XSS exfiltration** is mitigated separately by the platform's Content-Security-Policy and React's default escaping; if XSS exists, the attacker already has the same DOM access the legitimate code does, encryption would not help.
- **Browser disk dump** requires physical access to the user's own device — the same device the user is legitimately authorized to use. The threat-model perimeter is the device boundary, not the localStorage row.
- **Malicious extension** has full DOM and storage API access by design, again equivalent to legitimate access.

In other words, the localStorage data **is** the rightful, legitimate destination of this information, not an unauthorized one. The CodeQL rule is firing because it cannot distinguish "data in storage on the data's owner's own device" from "data on a server an attacker could exfiltrate from."

## What the exclusion does NOT cover

The exclusion is narrowly for `js/clear-text-storage-of-sensitive-data`. All other CodeQL rules remain active for the same files:

- SQL injection (`js/sql-injection`)
- Cross-site scripting (`js/xss`, `js/reflected-xss`, etc.)
- Open redirect (`js/open-redirect`)
- Insecure randomness (`js/insecure-randomness`)
- Hard-coded credentials (`js/hardcoded-credentials`)
- Path traversal (`js/path-injection`)
- Prototype pollution
- All other vulnerability classes

If any of those fire on the same lines, the build still fails — we just stop **this one rule** from generating noise on the offline-first architecture.

## When this doctrine MUST be revisited

The exclusion is **not** valid if any of the following changes:

1. **Multi-user shared device.** If we ever support a single physical device being used by multiple distinct workers (e.g. shift handover on a shared tablet), encryption becomes mandatory because worker A would otherwise be able to read worker B's audit log by inspecting `localStorage`. Today the doctrine is one-user-per-device.

2. **Web embed in untrusted host.** If the dashboard is ever embedded as an iframe inside a third-party page where the parent could access cross-origin storage (it can't today thanks to the same-origin policy, but storage partitioning rules can change), the threat model shifts.

3. **Compliance regulation requires encryption-at-rest on client.** Specific Saudi/GCC labour-safety regulations, ISO 27001 §A.10.1, GDPR Article 32 paragraph 1(a), or HIPAA technical safeguards may explicitly require encryption-at-rest including on client devices. If a customer signs a contract that obligates such encryption, the doctrine must change.

4. **Sensitive PHI / PII expands beyond name / phone / zone.** Today the most sensitive item in localStorage is medical-ID fields (blood type, allergies). If we begin storing things like government ID numbers, biometric templates, financial account data, or psychiatric history, the calculus changes and encryption becomes required.

5. **The user explicitly requests it.** If `fadihadi06@gmail.com` (the platform owner) ever requests encryption, this doctrine is overridden by the migration PR.

## Migration path — when we need to flip the switch

The follow-up PR (tracked as **Task #73 in the project task list, branch `phase-2/encrypted-localstorage`** when opened) will:

1. Generate a device-bound 256-bit key once at first run, derived from `crypto.subtle.deriveKey` over a per-device random seed kept in IndexedDB (so the seed never lives in localStorage itself).
2. Wrap every `safeSetItem` so the value is **AES-GCM-encrypted** before `localStorage.setItem`.
3. Wrap every `safeGetItem` so the value is **AES-GCM-decrypted** after `localStorage.getItem`.
4. Convert the `safeSetItem` / `safeGetItem` API to `async` (Web Crypto is async-only) and update every caller — roughly 50 sites in `shared-store.ts`, `audit-log-store.ts`, and consumers.
5. Add a one-pass migration on app load: read legacy plaintext values, rewrite them encrypted, then return the value to the caller. After the migration pass, all reads go through decryption.
6. Once the migration PR is merged and validated in staging, **remove the `js/clear-text-storage-of-sensitive-data` exclusion from `.github/codeql-config.yml`**. The rule will then re-enable platform-wide and find any future regressions automatically.

That is the long-term plan. The B1 exclusion in this PR is the short-term documented "we know about it, we've decided not to do it yet, here is why" record.

## Auditor checklist

If you are an auditor reading this:

- [ ] You can confirm the CodeQL config exclusion is exactly **one** rule (`js/clear-text-storage-of-sensitive-data`), not a blanket exclusion.
- [ ] You can confirm no other security rule has been weakened by this change.
- [ ] You can confirm the doctrine reasoning above matches the platform's actual deployment model (single-tenant device).
- [ ] You can confirm the migration PR (Task #73) is tracked and will land before any of the "MUST be revisited" triggers occur.

If any of those checks fail, this exclusion should be removed and the build allowed to fail until proper encryption is implemented.

---

*References*

- `.github/codeql-config.yml` — the exclusion itself
- `src/app/components/shared-store.ts` — primary localStorage writer
- `src/app/components/audit-log-store.ts` — secondary localStorage writer
- Project task #73 — deferred encryption PR
- CodeQL query: [https://codeql.github.com/codeql-query-help/javascript/js-clear-text-storage/](https://codeql.github.com/codeql-query-help/javascript/js-clear-text-storage/) (rule documentation)
