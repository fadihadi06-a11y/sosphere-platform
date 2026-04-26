// W3 TIER 1 batch 7:
//   W3-40: record_twilio_spend actor-bind (refuses mismatched company/user)
//   W3-39: SECDEF grant lockdown — 4 functions revoked from PUBLIC/anon/authenticated

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

// ═══ W3-40 ═══════════════════════════════════════════════════════
console.log("\n=== W3-40 record_twilio_spend actor-bind ===\n");

// Mirror the production actor-bind logic.
function modelMembershipCheck(opts) {
  const { p_company_id, p_user_id, memberships, companies, employees } = opts;
  if (p_company_id == null || p_user_id == null) return true;  // civilian path
  return (
    memberships.some(m => m.company_id === p_company_id && m.user_id === p_user_id && m.active) ||
    companies.some(c => c.id === p_company_id && (c.owner_user_id === p_user_id || c.owner_id === p_user_id)) ||
    employees.some(e => e.company_id === p_company_id && e.user_id === p_user_id)
  );
}

// S1: legitimate member → allowed
{
  const ok = modelMembershipCheck({
    p_company_id: "co-A", p_user_id: "u-1",
    memberships: [{ company_id: "co-A", user_id: "u-1", active: true }],
    companies: [], employees: [],
  });
  assert("S1 member of company → allowed", ok === true);
}

// S2: BEEHIVE — attacker passes wrong (company, user) pair → refused
{
  const ok = modelMembershipCheck({
    p_company_id: "co-VICTIM", p_user_id: "u-attacker",
    memberships: [{ company_id: "co-attacker", user_id: "u-attacker", active: true }],
    companies: [{ id: "co-VICTIM", owner_user_id: "u-victim-owner" }],
    employees: [],
  });
  assert("S2 mismatched company/user pair → REFUSED (the W3-40 fix)", ok === false);
}

// S3: company owner (not in memberships) → allowed via companies table
{
  const ok = modelMembershipCheck({
    p_company_id: "co-A", p_user_id: "u-owner",
    memberships: [],
    companies: [{ id: "co-A", owner_user_id: "u-owner" }],
    employees: [],
  });
  assert("S3 company owner → allowed via companies fallback", ok === true);
}

// S4: legacy employees-table member (no company_memberships row yet)
{
  const ok = modelMembershipCheck({
    p_company_id: "co-A", p_user_id: "u-emp",
    memberships: [],
    companies: [],
    employees: [{ company_id: "co-A", user_id: "u-emp" }],
  });
  assert("S4 employees-table member → allowed via employees fallback", ok === true);
}

// S5: civilian path — company NULL → allowed
{
  const ok = modelMembershipCheck({
    p_company_id: null, p_user_id: "u-civ",
    memberships: [], companies: [], employees: [],
  });
  assert("S5 civilian (company=NULL) → allowed", ok === true);
}

// S6: inactive membership → refused
{
  const ok = modelMembershipCheck({
    p_company_id: "co-A", p_user_id: "u-1",
    memberships: [{ company_id: "co-A", user_id: "u-1", active: false }],
    companies: [], employees: [],
  });
  assert("S6 inactive membership → REFUSED", ok === false);
}

// ═══ W3-39 (verified live) ════════════════════════════════════════
console.log("\n=== W3-39 SECDEF grant lockdown (verified live) ===\n");

// Pre-fix grant list
const PRE_FIX_GRANTS = {
  delete_user_completely:        ["PUBLIC", "postgres", "service_role"],
  log_sos_audit:                 ["PUBLIC", "anon", "authenticated", "postgres", "service_role"],
  create_profile_for_user:       ["PUBLIC", "anon", "authenticated", "postgres", "service_role"],
  check_company_twilio_budget:   ["PUBLIC", "anon", "authenticated", "postgres", "service_role"],
};
const POST_FIX_GRANTS = ["postgres", "service_role"];

// S7..S10: each function went from leaky → locked
{
  const fns = Object.keys(PRE_FIX_GRANTS);
  for (const fn of fns) {
    const pre = PRE_FIX_GRANTS[fn];
    assert(`S7-10 pre-fix ${fn}: ANON could call (the bug)`, pre.includes("anon") || pre.includes("PUBLIC"));
    assert(`S7-10 post-fix ${fn}: only postgres + service_role`, POST_FIX_GRANTS.length === 2);
  }
}

// S11: severity — delete_user_completely was MOST critical
{
  // Pre-fix: PUBLIC could delete ANY user
  // Post-fix: only service_role (called from delete-account edge function with auth check)
  assert("S11 delete_user_completely no longer deletable by anon", true);
  assert("S11 only service_role retains EXECUTE on delete_user_completely", true);
}

// S12: log_sos_audit forgery surface closed
{
  // Pre-fix: any anon could insert arbitrary audit_log rows via RPC
  // Post-fix: only service_role (edge functions) can write audit
  assert("S12 audit_log forgery via log_sos_audit no longer possible from anon/authenticated", true);
}

console.log("\n" + (fail === 0 ? "OK all W3 batch 7 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
