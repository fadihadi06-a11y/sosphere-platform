# SOSphere DPA — Counsel Review Pack

> **Hand this file plus the deployed DPA at `/legal/dpa` to your data-protection
> counsel when you're ready to launch to enterprise customers in EU / KSA / US.**
> Everything here is engineering's best attempt at a defensible draft, written
> with peer-DPA cross-references. Counsel decides what to keep, change, and add.

## 1. What's already engineered (counsel doesn't need to verify)

These are **technical** facts that are server-enforced — counsel can rely on them
when drafting controller obligations / TOMs language:

| Fact | Where it lives | Evidence for an audit |
|---|---|---|
| Tamper-resistant acceptance ledger | `public.company_dpa_acceptances` (FORCE RLS, RPC-only writes) | Row per acceptance with signer name/title/email, IP, UA, ISO timestamp, version |
| Forensic audit log | `public.audit_log` (never deleted) | Every authentication event + billing change + DPA acceptance + SOS escalation; ISO 27001 / SOC 2 grade |
| Encryption | TLS 1.2+ everywhere; AES-256 at rest (Supabase managed) | Supabase platform attestation |
| Authentication | Email+password OR Google OAuth; optional TOTP MFA | `auth.users` + `auth.mfa_factors` |
| Per-tenant isolation | Postgres FORCE RLS on every PII table; partial UNIQUE on `subscriptions(company_id)` | Schema migrations under `supabase/migrations/` |
| Retention enforcement | Cron job from `crit16_data_retention_cron.sql` | SOS=90d, GPS=30d, Evidence=90d, audit=indefinite |
| SAR pipeline | `sar_request_history` + in-app export | Migrations + privacy-page Section 5 |
| Sub-processor list | Annex III on `/legal/dpa` | Public, change-noticed |

**Bottom line:** the drafting effort is "make the words match what the platform
already does", not "promise things and hope it works".

---

## 2. Peer-DPA cross-references used while drafting

Public DPAs that informed each section. Citations live as `// CITES:` comments
in `src/app/components/dpa-page.tsx` so counsel can follow the trail.

| SOSphere section | Borrowed structure from | Why this peer |
|---|---|---|
| §2 Subject matter & duration | Stripe DPA §3.1 | EU template wording, regulator-tested |
| §4 Categories of data + subjects | AWS DPA §1.4 + Annex I | Comprehensive enumeration, US Big-Tech tested |
| §5–6 Controller / Processor obligations | Stripe DPA §3.2 + GDPR Art. 28(3) verbatim | Direct GDPR alignment |
| §7 Confidentiality | GitHub DPA §6 | Personnel-binding language, balanced |
| §8 TOMs (Annex II) | Stripe DPA Annex II + ISO 27002 controls | Annex II is what auditors actually read |
| §9 Sub-processors | Stripe DPA §6 (30-day notice + objection right) | Industry-standard mechanism |
| §10 International transfers | Stripe DPA §7 + EU SCC 2021/914 Module 2 | Required since Schrems II for EU→US flows |
| §11 Data-subject rights assistance | AWS DPA §3.3 | Clear "we forward, you decide" carve-out |
| §12 Breach notification SLA | EU GDPR Art. 33 (72h to authorities) + KSA PDPL Art. 28 | Aligns both regimes |
| §13 Audit rights | Stripe DPA §10 (annual cap + SOC 2 in lieu) | Realistic operationally |
| §14 Insurance | Salesforce DPA §15 | Concrete amounts, lawyers expect to see this |
| §15 Liability | Stripe MSA §11 (12 mo cap, fraud carve-outs) | Defensible posture |
| §19 Governing law | Stripe MSA §13 (state-law fallback) | Removes ambiguity |
| Annex V | KSA PDPL implementing regulations 2024 | Local-market specific |

---

## 3. Open questions for counsel

These are decisions only counsel + business leadership can make. The DPA
deliberately uses placeholder defaults that counsel should challenge.

### 3.1 Governing law and jurisdiction

**Current draft:** "Laws of the State of Delaware, USA, with exclusive
jurisdiction in Delaware courts."

**Why this default:** Delaware is the most common US default for SaaS, has
well-developed business-law jurisprudence, and is acceptable to most
enterprise procurement teams.

**Counsel must decide:**
- Should this change for **EU customers** (Irish law more EU-friendly)?
- Should this change for **KSA customers** (KSA Commercial Court mandatory for KSA-domiciled controllers)?
- Should we offer a **carve-out / alternative-jurisdiction** addendum at the customer's request?

### 3.2 Liability cap

**Current draft:** Aggregate liability capped at the greater of (a) 12 months
of subscription fees paid by the controller, or (b) US $100,000.

**Carve-outs from cap:**
- Indemnification obligations
- Breach of confidentiality
- Gross negligence or wilful misconduct
- Personal data breaches caused by SOSphere's failure to implement Annex II TOMs

**Counsel must decide:**
- Is $100K floor reasonable for an early-stage emergency-safety SaaS?
- Should breach-of-data-protection have its own super-cap (e.g. 24 months fees + $250K)? Many enterprise customers demand this.

### 3.3 Insurance minimums

**Current draft:** SOSphere shall maintain at all times during the term:
- Cyber liability insurance: USD $5,000,000 per occurrence
- Errors & omissions: USD $2,000,000 per occurrence
- Commercial general liability: USD $1,000,000 per occurrence

**Counsel must verify:** Does SOSphere actually have these policies? If not,
the clause must be removed or marked "shall obtain prior to first paid
enterprise contract."

### 3.4 SCC modules and annexes

The current DPA references EU SCCs 2021/914 by inclusion. Counsel should:
- Decide whether **Module 2** (Controller→Processor) is enough, or whether
  Module 3 (Processor→Sub-processor) needs to be flow-down to all sub-processors
- Fill in the **Annex I.A / I.B / I.C** of the SCCs (data exporter, importer,
  competent supervisory authority)
- Decide whether to **execute SCCs as a separate document** vs. inline

### 3.5 KSA-specific (PDPL implementing regs 2024)

The KSA PDPL was amended in 2024 to require:
- Data residency for "sensitive" data (medical records, biometric)
- 72-hour notification to SDAIA (Saudi data authority) for breaches
- Specific cross-border transfer authorisations

The current draft has Annex V acknowledging these. Counsel must verify:
- Does our Supabase region ever host KSA "sensitive" data outside KSA? (Currently EU/US)
- If so, do we need to offer **KSA region** as a paid tier and update the DPA accordingly?

### 3.6 SOC 2 Type II

The DPA promises a SOC 2 Type II report "in lieu of on-site audit." We DO NOT
yet have one. Counsel options:
- (a) Remove the promise until we get one (cost: $15-25K + 6 months observation)
- (b) Replace with "SOC 2 Type I" (cheaper, ~$10K, point-in-time)
- (c) Replace with "ISO 27001 self-assessment + penetration test report"

### 3.7 Data subject rights — DPO contact

GDPR requires a DPO contact for organisations meeting certain thresholds.
SOSphere may or may not need one yet; counsel decides. If yes, the DPA must
list `dpo@sosphere.co` (or similar) and we must wire it to a real inbox.

### 3.8 Insurance certificate delivery

Some enterprise customers require an Insurance Certificate (COI) before
signing. Counsel: do we add a clause "SOSphere will provide a current COI
within 5 business days of written request"?

---

## 4. Things counsel does NOT need to draft (already done)

- The **technical security infrastructure** (it exists; describe what's there).
- The **acceptance flow** (atomic, audited, IP-stamped).
- The **retention enforcement** (cron-driven).
- The **sub-processor change-notice mechanism** (in-app notification).

Counsel just needs to verify the **wording of the legal commitment**, not the
implementation.

---

## 5. Suggested cost & timeline

| Step | Cost | Time |
|---|---|---|
| Counsel review of current draft | $1,500–$3,000 | 1–2 weeks |
| Cyber insurance quote + bind | $2,500–$8,000/year | 2–4 weeks |
| SOC 2 Type I observation + report | $10,000–$15,000 | 8–12 weeks |
| **Minimum viable enterprise-ready posture** | **~$15K + ~3 months** | |
| (Optional) SOC 2 Type II | +$15K | +6 months |
| (Optional) ISO 27001 certification | +$30K | +12 months |

The first row is the only one strictly required to start signing enterprise
deals. Rows 2–4 increase the size and trust of customers that will sign.

---

## 6. What to send your counsel

1. This file (`docs/DPA-LAWYER-REVIEW.md`).
2. A **printout** of the current `/legal/dpa` page (or the rendered PDF).
3. The **technical-fact sheet** in §1 above.
4. A copy of the **terms-page.tsx** content (the underlying TOS that the DPA
   references for liability cap and governing law).
5. The **sub-processor list** from `/legal/dpa` Annex III (kept fresh in code).

Counsel will return a redlined version. Engineering then updates `dpa-page.tsx`
SECTIONS to match exactly, refreshes the DPA_VERSION constant, and the existing
acceptance flow forces all owners to re-sign on next dashboard visit.
