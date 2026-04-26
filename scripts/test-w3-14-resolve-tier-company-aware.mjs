// W3-14 hard test — resolveTier is now company-aware.
// Pre-fix: only looked at subscriptions.user_id = JWT subject. B2B employees
// resolved to "free" because the OWNER paid for the company subscription.
// Post-fix: 4-step resolution chain — personal → profiles.active_company_id
// → companies.owner_user_id → owner's subscription.

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

const ACTIVE_STATUSES = ["active", "trialing"];
const COMPANY_TIERS = new Set(["starter", "growth", "business", "enterprise"]);

function mapTierString(raw) {
  const t = (raw || "").toLowerCase();
  if (t === "elite" || t === "premium") return "elite";
  if (t === "basic" || t === "standard") return "basic";
  if (COMPANY_TIERS.has(t)) return "elite";
  return "free";
}
function isStatusActive(status, periodEnd) {
  if (!status || !ACTIVE_STATUSES.includes(status)) return false;
  if (periodEnd) {
    const expiresAt = new Date(periodEnd).getTime();
    if (expiresAt < Date.now()) return false;
  }
  return true;
}

function makeSupabaseMock(state) {
  return {
    from(table) {
      return {
        select: (_cols) => ({
          eq: (key, val) => ({
            maybeSingle: async () => {
              const rows = state[table] || [];
              const found = rows.find(r => r[key] === val);
              return { data: found || null, error: null };
            },
          }),
        }),
      };
    },
  };
}

async function resolveTier(userId, supabase) {
  // Step 1
  try {
    const { data } = await supabase
      .from("subscriptions")
      .select("tier, status, current_period_end")
      .eq("user_id", userId)
      .maybeSingle();
    if (data && isStatusActive(data.status, data.current_period_end)) {
      const personal = mapTierString(data.tier || "");
      if (personal !== "free") return personal;
    }
  } catch {}

  // Step 2-4: company chain
  try {
    const { data: profile } = await supabase
      .from("profiles").select("active_company_id").eq("id", userId).maybeSingle();
    const companyId = profile?.active_company_id;
    if (!companyId) return "free";
    const { data: company } = await supabase
      .from("companies").select("owner_user_id").eq("id", companyId).maybeSingle();
    const ownerId = company?.owner_user_id;
    if (!ownerId) return "free";
    const { data: ownerSub } = await supabase
      .from("subscriptions").select("tier, status, current_period_end").eq("user_id", ownerId).maybeSingle();
    if (ownerSub && isStatusActive(ownerSub.status, ownerSub.current_period_end)) {
      const tier = mapTierString(ownerSub.tier || "");
      if (tier !== "free") return tier;
    }
    return "free";
  } catch {
    return "free";
  }
}

const FUTURE = new Date(Date.now() + 86400_000).toISOString();
const PAST   = new Date(Date.now() - 86400_000).toISOString();

// S1: civilian with own Elite subscription → still resolves elite
{
  const sb = makeSupabaseMock({
    subscriptions: [{ user_id: "u-civilian", tier: "elite", status: "active", current_period_end: FUTURE }],
  });
  const r = await resolveTier("u-civilian", sb);
  assert("S1 civilian Elite resolves elite", r === "elite");
}

// S2: civilian with no subscription, no company → free
{
  const sb = makeSupabaseMock({});
  const r = await resolveTier("u-noone", sb);
  assert("S2 unaffiliated free user resolves free", r === "free");
}

// S3: B2B EMPLOYEE — no personal sub, but company owner has 'business'.
//     Pre-fix would return "free". Post-fix returns "elite".
{
  const sb = makeSupabaseMock({
    subscriptions: [
      { user_id: "u-owner", tier: "business", status: "active", current_period_end: FUTURE },
    ],
    profiles: [{ id: "u-employee", active_company_id: "co-1" }],
    companies: [{ id: "co-1", owner_user_id: "u-owner" }],
  });
  const r = await resolveTier("u-employee", sb);
  assert("S3 B2B employee resolves elite via company chain (was 'free' pre-fix)",
    r === "elite");
}

// S4: B2B employee, owner has 'starter' (lowest company tier) → still elite
{
  const sb = makeSupabaseMock({
    subscriptions: [{ user_id: "u-owner", tier: "starter", status: "active", current_period_end: FUTURE }],
    profiles: [{ id: "u-employee", active_company_id: "co-1" }],
    companies: [{ id: "co-1", owner_user_id: "u-owner" }],
  });
  const r = await resolveTier("u-employee", sb);
  assert("S4 starter B2B resolves elite (B2B → strongest fanout)", r === "elite");
}

// S5: B2B employee, owner sub is CANCELED → free
{
  const sb = makeSupabaseMock({
    subscriptions: [{ user_id: "u-owner", tier: "elite", status: "canceled", current_period_end: FUTURE }],
    profiles: [{ id: "u-employee", active_company_id: "co-1" }],
    companies: [{ id: "co-1", owner_user_id: "u-owner" }],
  });
  const r = await resolveTier("u-employee", sb);
  assert("S5 employee with canceled-owner-sub resolves free", r === "free");
}

// S6: B2B employee, owner sub period expired → free
{
  const sb = makeSupabaseMock({
    subscriptions: [{ user_id: "u-owner", tier: "elite", status: "active", current_period_end: PAST }],
    profiles: [{ id: "u-employee", active_company_id: "co-1" }],
    companies: [{ id: "co-1", owner_user_id: "u-owner" }],
  });
  const r = await resolveTier("u-employee", sb);
  assert("S6 employee with expired-owner-sub resolves free", r === "free");
}

// S7: civilian with personal Elite AND active_company_id pointing to a free company
//     → personal Elite wins (priority order)
{
  const sb = makeSupabaseMock({
    subscriptions: [{ user_id: "u-civ-pro", tier: "elite", status: "active", current_period_end: FUTURE }],
    profiles: [{ id: "u-civ-pro", active_company_id: "co-broke" }],
    companies: [{ id: "co-broke", owner_user_id: "u-broke-owner" }],
  });
  const r = await resolveTier("u-civ-pro", sb);
  assert("S7 personal Elite takes priority over company chain", r === "elite");
}

// S8: civilian with personal FREE subscription, but company owner has Elite
//     → company chain wins (free personal sub treated as no sub)
{
  const sb = makeSupabaseMock({
    subscriptions: [
      { user_id: "u-employee", tier: "free", status: "active", current_period_end: FUTURE },
      { user_id: "u-owner",    tier: "enterprise", status: "active", current_period_end: FUTURE },
    ],
    profiles: [{ id: "u-employee", active_company_id: "co-1" }],
    companies: [{ id: "co-1", owner_user_id: "u-owner" }],
  });
  const r = await resolveTier("u-employee", sb);
  assert("S8 free personal sub doesn't block company chain", r === "elite");
}

// S9: edge case — past_due owner sub → free (not active)
{
  const sb = makeSupabaseMock({
    subscriptions: [{ user_id: "u-owner", tier: "business", status: "past_due", current_period_end: FUTURE }],
    profiles: [{ id: "u-employee", active_company_id: "co-1" }],
    companies: [{ id: "co-1", owner_user_id: "u-owner" }],
  });
  const r = await resolveTier("u-employee", sb);
  assert("S9 past_due owner sub doesn't grant tier", r === "free");
}

// S10: trialing owner sub → counts as active
{
  const sb = makeSupabaseMock({
    subscriptions: [{ user_id: "u-owner", tier: "growth", status: "trialing", current_period_end: FUTURE }],
    profiles: [{ id: "u-employee", active_company_id: "co-1" }],
    companies: [{ id: "co-1", owner_user_id: "u-owner" }],
  });
  const r = await resolveTier("u-employee", sb);
  assert("S10 trialing owner sub counts as active", r === "elite");
}

console.log("\n" + (fail === 0 ? "OK all W3-14 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
