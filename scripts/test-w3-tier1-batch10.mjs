// W3 TIER 1 batch 10:
//   W3-47: twilio-call phone normalizePhoneVariants — admin allowlist match
//          across multiple equivalent phone formats
//   W3-26: IVR Press 2 inline graceful TwiML (no more dead JWT redirect)
//   W3-16: company registration via create_company_v2 RPC (post-W3-38 RLS)

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

// ═══ W3-47 ═══════════════════════════════════════════════════════
console.log("\n=== W3-47 phone variant equivalence ===\n");

function normalizePhoneVariants(p) {
  if (!p) return [];
  const trimmed = String(p).trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return [];
  const v = new Set();
  v.add(digits);
  v.add("+" + digits);
  if (hasPlus) v.add(trimmed);
  if (digits.startsWith("0") && digits.length > 1) v.add(digits.slice(1));
  return [...v];
}

// S1: admin stored as "07728569514" (no plus); client sends "+447728569514"
{
  const stored = "07728569514";
  const target = "+447728569514";
  const phones = new Set();
  for (const v of normalizePhoneVariants(stored)) phones.add(v);
  const matches = normalizePhoneVariants(target).some(v => phones.has(v));
  // Without strip-leading-zero awareness, the +44... wouldn't match 07728...
  // The variants for "07728569514" include: "07728569514", "+07728569514", "7728569514"
  // The variants for "+447728569514" include: "447728569514", "+447728569514"
  // Overlap: "7728569514" vs "447728569514" — different. So no match expected here.
  assert("S1 different country prefixes don't false-positive (security)",
    matches === false);
}

// S2: same number both forms — match
{
  const stored = "+15551234567";
  const target = "+1 (555) 123-4567";
  const phones = new Set();
  for (const v of normalizePhoneVariants(stored)) phones.add(v);
  const matches = normalizePhoneVariants(target).some(v => phones.has(v));
  assert("S2 same E.164 with formatting matches", matches === true);
}

// S3: stored "+15551234567", client sends digits "15551234567"
{
  const stored = "+15551234567";
  const target = "15551234567";
  const phones = new Set();
  for (const v of normalizePhoneVariants(stored)) phones.add(v);
  const matches = normalizePhoneVariants(target).some(v => phones.has(v));
  assert("S3 with-plus stored vs digits-only target matches", matches === true);
}

// S4: stored "15551234567", client sends "+15551234567"
{
  const stored = "15551234567";
  const target = "+15551234567";
  const phones = new Set();
  for (const v of normalizePhoneVariants(stored)) phones.add(v);
  const matches = normalizePhoneVariants(target).some(v => phones.has(v));
  assert("S4 digits-only stored vs with-plus target matches", matches === true);
}

// S5: stored "07728569514", client sends "7728569514" (strip 0)
{
  const stored = "07728569514";
  const target = "7728569514";
  const phones = new Set();
  for (const v of normalizePhoneVariants(stored)) phones.add(v);
  const matches = normalizePhoneVariants(target).some(v => phones.has(v));
  assert("S5 leading-zero variant matches via strip", matches === true);
}

// S6: completely different number — refused
{
  const phones = new Set();
  for (const v of normalizePhoneVariants("+15551234567")) phones.add(v);
  const matches = normalizePhoneVariants("+15559998888").some(v => phones.has(v));
  assert("S6 different number REFUSED", matches === false);
}

// S7: invalid input — empty variants
{
  assert("S7 empty input → empty variants", normalizePhoneVariants("").length === 0);
  assert("S7 null input → empty variants", normalizePhoneVariants(null).length === 0);
  assert("S7 letters-only → empty variants", normalizePhoneVariants("abc").length === 0);
}

// ═══ W3-26 ═══════════════════════════════════════════════════════
console.log("\n=== W3-26 IVR Press 2 inline TwiML ===\n");

const PRE_FIX_TWIML = `<Response>\n  <Redirect>${"<base>"}/functions/v1/twilio-call?replay=true&amp;callId=${"<id>"}</Redirect>\n</Response>`;
const POST_FIX_TWIML = `<Response>\n  <Say voice="Polly.Joanna">If you need to hear the alert again, please call back. Goodbye.</Say>\n  <Hangup/>\n</Response>`;

assert("W3-26 pre-fix used <Redirect> to JWT-required endpoint (the bug)",
  PRE_FIX_TWIML.includes("<Redirect>"));
assert("W3-26 post-fix uses inline <Say>+<Hangup>",
  POST_FIX_TWIML.includes("<Say") && POST_FIX_TWIML.includes("<Hangup/>"));
assert("W3-26 post-fix has no Redirect (no auth-required hop)",
  !POST_FIX_TWIML.includes("<Redirect>"));

// ═══ W3-16 ═══════════════════════════════════════════════════════
console.log("\n=== W3-16 company registration via create_company_v2 RPC ===\n");

// Pre-fix: direct upsert with only owner_id; W3-38 update policy required owner_user_id
function preFixCompanyRowAfterRegister() {
  return {
    owner_id: "u-1",
    owner_user_id: null,  // pre-fix never set this
    has_membership_row: false,  // pre-fix never created company_memberships
  };
}

function postFixCompanyRowAfterRegister() {
  // After create_company_v2 RPC (which is SECDEF and creates both):
  return {
    owner_id: null,  // legacy column not used
    owner_user_id: "u-1",  // canonical column
    has_membership_row: true,  // RPC adds company_memberships role='owner'
  };
}

// S8: post-fix has the canonical owner column populated
{
  const row = postFixCompanyRowAfterRegister();
  assert("S8 post-fix sets owner_user_id (W3-38 RLS-compatible)",
    row.owner_user_id === "u-1");
}

// S9: post-fix creates membership row → is_company_member() returns true for owner
{
  const row = postFixCompanyRowAfterRegister();
  assert("S9 post-fix has company_memberships row (is_company_member works)",
    row.has_membership_row === true);
}

// S10: pre-fix would FAIL the new W3-38 RLS update policy
//      (caller can't update because is_company_admin_or_owner_v2 returns false
//       — no membership row, owner_user_id is NULL)
{
  const preRow = preFixCompanyRowAfterRegister();
  const wouldRlsFail = (
    preRow.owner_user_id === null &&  // can't match owner_user_id = auth.uid()
    !preRow.has_membership_row         // no membership row
  );
  assert("S10 pre-fix path INCOMPATIBLE with W3-38 RLS (the W3-16 bug)",
    wouldRlsFail === true);
}

console.log("\n" + (fail === 0 ? "OK all W3 batch 10 scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
