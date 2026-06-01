// ═══════════════════════════════════════════════════════════════
// SOSphere — invitation-service (CRIT-3 world-class)
// ─────────────────────────────────────────────────────────────
// Server-state RPC client for the bulk-invite flow.
//
// Architecture (mirrors CRIT-2 / CRIT-4):
//   • DB is THE source of truth (public.invitations + unique
//     index on (company_id, email))
//   • All writes go through SECDEF RPC create_employee_invitations_bulk
//     which authorizes the caller as owner/admin of the company
//   • Idempotent: re-sending same email refreshes the row (status
//     reset to 'pending', expiry extended) rather than inserting
//     a duplicate.  Accepted invites are NEVER reverted to pending.
//   • Companion accept_invitation() already exists in the DB and
//     is wired into welcome-activation.tsx + dashboard-web-page.tsx.
//
// This file contains:
//   1. parseInviteRowsForRpc(): pure normalizer of client rows
//      → the JSON shape the RPC expects.  Lives here so it is
//      Vitest-testable without touching Supabase.
//   2. sendInvitations(): RPC call wrapper returning a summary the
//      UI can use to render success / partial / failure states.
//   3. loadCompanyInvitations(): paired reader RPC wrapper.
// ═══════════════════════════════════════════════════════════════

export interface InviteRowInput {
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  role?: string | null;
  department?: string | null;
  zone?: string | null;
  zone_name?: string | null;
}

export interface InviteRowForRpc {
  email: string;
  name: string | null;
  phone: string | null;
  role: string;
  department: string | null;
  zone_name: string | null;
}

/** Raw row returned by the RPC.  Column names are r_-prefixed to avoid
 *  collisions with `public.invitations` column names inside the SECDEF
 *  body (PostgreSQL treated unprefixed OUT params + identical column
 *  names as ambiguous and refused to plan the query). */
export interface InviteResultRowRaw {
  r_invite_id:  string | null;
  r_email:      string;
  r_token:      string | null;
  r_status:     string;
  r_expires_at: string | null;
  r_was_new:    boolean;
}

/** Normalized row returned to UI code — strips the r_ prefix. */
export interface InviteResultRow {
  invite_id:  string | null;
  email:      string;
  token:      string | null;
  status:     string;
  expires_at: string | null;
  was_new:    boolean;
}

function normalizeRpcRow(r: InviteResultRowRaw): InviteResultRow {
  return {
    invite_id:  r.r_invite_id,
    email:      r.r_email,
    token:      r.r_token,
    status:     r.r_status,
    expires_at: r.r_expires_at,
    was_new:    r.r_was_new,
  };
}

export interface SendInvitationsSummary {
  ok: boolean;
  /** Rows we attempted to send to the RPC (after normalization). */
  attempted: number;
  /** Rows the RPC reported as `was_new = true`. */
  created: number;
  /** Rows updated (re-send to existing email). */
  refreshed: number;
  /** Rows the RPC rejected as malformed email. */
  invalid: number;
  /** Rows whose email was already accepted (left untouched). */
  alreadyAccepted: number;
  /** Successful invite IDs (so the caller can mark them in the UI). */
  acceptedIds: string[];
  /** Error message if the RPC call itself failed. */
  error?: string;
  /** Raw rows returned by the RPC (one per attempted invite). */
  rows: InviteResultRow[];
}

/** Validate an email with a deliberately conservative regex.
 *  Matches the server-side regex in create_employee_invitations_bulk
 *  so client + server agree on what counts as malformed. */
export function isValidEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

const VALID_ROLES = new Set([
  "owner", "admin", "employee", "member", "zone_admin",
]);

/**
 * Pure helper: normalize a list of client-facing invite rows into the
 * shape the RPC expects.  Drops rows missing email entirely (so the
 * RPC doesn't waste round-trip work reporting them as invalid).
 *
 * - Trims and lowercases email
 * - Trims name/phone/department/zone, converts "" to null
 * - Defaults role to "employee" if missing or unknown
 * - Accepts either `zone` or `zone_name` on input
 */
export function parseInviteRowsForRpc(rows: InviteRowInput[]): InviteRowForRpc[] {
  const out: InviteRowForRpc[] = [];
  for (const r of rows) {
    const email = (r.email ?? "").trim().toLowerCase();
    if (email === "") continue;
    const roleRaw = (r.role ?? "employee").trim().toLowerCase();
    const role = VALID_ROLES.has(roleRaw) ? roleRaw : "employee";
    out.push({
      email,
      name:        nullIfEmpty(r.name),
      phone:       nullIfEmpty(r.phone),
      role,
      department:  nullIfEmpty(r.department),
      zone_name:   nullIfEmpty(r.zone_name ?? r.zone),
    });
  }
  return out;
}

function nullIfEmpty(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Summarize the RPC's per-row response.  Pure — testable without
 * Supabase.  Exposed so the UI can re-summarize partial results.
 */
export function summarizeInviteResult(
  rows: InviteResultRow[],
): Omit<SendInvitationsSummary, "ok" | "attempted" | "error"> {
  let created = 0;
  let refreshed = 0;
  let invalid = 0;
  let alreadyAccepted = 0;
  const acceptedIds: string[] = [];
  for (const r of rows) {
    if (r.status === "invalid_email") { invalid++; continue; }
    if (r.status === "accepted") { alreadyAccepted++; }
    if (r.was_new) created++; else refreshed++;
    if (r.invite_id) acceptedIds.push(r.invite_id);
  }
  return { created, refreshed, invalid, alreadyAccepted, acceptedIds, rows };
}

/**
 * Bulk-send invitations.  Wraps the RPC call so the UI gets a single
 * `SendInvitationsSummary` object regardless of partial success.
 *
 * Failure modes:
 *   • RPC itself throws / returns error → ok=false, error set, rows=[]
 *   • RPC returns 0 rows → ok=true but summary all zeros
 *   • RPC returns mixed (some invalid_email + some success) → ok=true,
 *     summary breaks them down so the UI can show "5 sent, 1 invalid"
 */
export async function sendInvitations(
  companyId: string,
  rows: InviteRowInput[],
): Promise<SendInvitationsSummary> {
  const normalized = parseInviteRowsForRpc(rows);
  const empty: SendInvitationsSummary = {
    ok: true, attempted: normalized.length,
    created: 0, refreshed: 0, invalid: 0, alreadyAccepted: 0,
    acceptedIds: [], rows: [],
  };
  if (normalized.length === 0) return empty;

  const { supabase } = await import("./api/supabase-client");
  const { data, error } = await supabase.rpc(
    "create_employee_invitations_bulk",
    { p_company_id: companyId, p_invites: normalized },
  );

  if (error) {
    return { ...empty, ok: false, error: error.message };
  }

  const resultRows: InviteResultRow[] = Array.isArray(data)
    ? (data as InviteResultRowRaw[]).map(normalizeRpcRow)
    : [];
  const summary = summarizeInviteResult(resultRows);
  return {
    ok: true,
    attempted: normalized.length,
    ...summary,
  };
}

/** Paired reader RPC — returns the company's invitation rows (admin/owner only). */
export interface CompanyInvitationRow {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  role: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  accepted_at: string | null;
}

export async function loadCompanyInvitations(
  companyId: string,
): Promise<{ ok: boolean; rows: CompanyInvitationRow[]; error?: string }> {
  const { supabase } = await import("./api/supabase-client");
  const { data, error } = await supabase.rpc(
    "get_company_invitations",
    { p_company_id: companyId },
  );
  if (error) {
    return { ok: false, rows: [], error: error.message };
  }
  return { ok: true, rows: Array.isArray(data) ? (data as CompanyInvitationRow[]) : [] };
}
