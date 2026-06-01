// ═══════════════════════════════════════════════════════════════
// SOSphere — invitation-service contract
// ─────────────────────────────────────────────────────────────
// CRIT-3 (2026-06-01): the world-class refactor moved invitation
// writes from "console.log only" to the SECDEF RPC
// create_employee_invitations_bulk + a small service module.
//
// These tests lock the contract so a future refactor cannot
// silently regress us back to local-only "marked as sent" state:
//
//   1. parseInviteRowsForRpc lowercases + trims emails
//   2. parseInviteRowsForRpc drops rows missing an email
//   3. parseInviteRowsForRpc normalizes empty strings to null
//   4. parseInviteRowsForRpc accepts either `zone` or `zone_name`
//   5. parseInviteRowsForRpc defaults missing role to "employee"
//   6. parseInviteRowsForRpc coerces unknown roles to "employee"
//   7. summarizeInviteResult counts new vs refreshed vs invalid
//   8. summarizeInviteResult treats 'accepted' status as not-new
//   9. summarizeInviteResult collects all valid invite_ids
//  10. isValidEmail mirrors the server-side regex (no false negatives)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import {
  parseInviteRowsForRpc,
  summarizeInviteResult,
  isValidEmail,
} from "../invitation-service";

describe("invitation-service — CRIT-3 contract", () => {
  it("1. parseInviteRowsForRpc lowercases + trims emails", () => {
    const out = parseInviteRowsForRpc([
      { email: "  USER@Example.COM  ", name: "User", role: "employee" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe("user@example.com");
  });

  it("2. parseInviteRowsForRpc drops rows missing an email entirely", () => {
    const out = parseInviteRowsForRpc([
      { name: "No email", role: "employee" },
      { email: "", name: "Empty email" },
      { email: "valid@x.com", name: "Real" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe("valid@x.com");
  });

  it("3. parseInviteRowsForRpc normalizes empty strings to null", () => {
    const out = parseInviteRowsForRpc([
      { email: "a@b.com", name: "  ", phone: "", department: "  ", zone: "" },
    ]);
    expect(out[0].name).toBeNull();
    expect(out[0].phone).toBeNull();
    expect(out[0].department).toBeNull();
    expect(out[0].zone_name).toBeNull();
  });

  it("4. parseInviteRowsForRpc accepts either `zone` or `zone_name`", () => {
    const a = parseInviteRowsForRpc([{ email: "a@b.com", zone: "ZoneA" }]);
    const b = parseInviteRowsForRpc([{ email: "a@b.com", zone_name: "ZoneB" }]);
    expect(a[0].zone_name).toBe("ZoneA");
    expect(b[0].zone_name).toBe("ZoneB");
    // zone_name takes precedence if both are provided
    const c = parseInviteRowsForRpc([{ email: "a@b.com", zone: "Z1", zone_name: "Z2" }]);
    expect(c[0].zone_name).toBe("Z2");
  });

  it("5. parseInviteRowsForRpc defaults missing role to employee", () => {
    const out = parseInviteRowsForRpc([
      { email: "a@b.com" },
      { email: "c@d.com", role: undefined },
      { email: "e@f.com", role: "" },
    ]);
    expect(out.every(r => r.role === "employee")).toBe(true);
  });

  it("6. parseInviteRowsForRpc coerces unknown roles to employee (safe default)", () => {
    const out = parseInviteRowsForRpc([
      { email: "a@b.com", role: "MEGA_ADMIN" },
      { email: "c@d.com", role: "owner" },           // valid → preserved
      { email: "e@f.com", role: "ZONE_ADMIN" },      // case-insensitive valid
      { email: "g@h.com", role: "hacker" },          // invalid → employee
    ]);
    expect(out[0].role).toBe("employee");
    expect(out[1].role).toBe("owner");
    expect(out[2].role).toBe("zone_admin");
    expect(out[3].role).toBe("employee");
  });

  it("7. summarizeInviteResult counts new vs refreshed vs invalid", () => {
    const s = summarizeInviteResult([
      { invite_id: "i1", email: "a@b.com", token: "t1", status: "pending", expires_at: null, was_new: true },
      { invite_id: "i2", email: "c@d.com", token: "t2", status: "pending", expires_at: null, was_new: false },
      { invite_id: null,  email: "bad",     token: null, status: "invalid_email", expires_at: null, was_new: false },
    ]);
    expect(s.created).toBe(1);
    expect(s.refreshed).toBe(1);
    expect(s.invalid).toBe(1);
    expect(s.acceptedIds).toEqual(["i1", "i2"]);
  });

  it("8. summarizeInviteResult counts 'accepted' rows for alreadyAccepted", () => {
    const s = summarizeInviteResult([
      { invite_id: "i1", email: "a@b.com", token: "t", status: "accepted", expires_at: null, was_new: false },
      { invite_id: "i2", email: "c@d.com", token: "t", status: "pending",  expires_at: null, was_new: true  },
    ]);
    expect(s.alreadyAccepted).toBe(1);
    expect(s.created).toBe(1);
    expect(s.refreshed).toBe(1); // the accepted row still counts as refreshed (was_new=false)
  });

  it("9. summarizeInviteResult collects all valid invite_ids, drops nulls", () => {
    const s = summarizeInviteResult([
      { invite_id: "i1",  email: "a@b.com", token: "t", status: "pending",       expires_at: null, was_new: true },
      { invite_id: null,  email: "bad",     token: null, status: "invalid_email", expires_at: null, was_new: false },
      { invite_id: "i3",  email: "c@d.com", token: "t", status: "pending",       expires_at: null, was_new: true },
    ]);
    expect(s.acceptedIds).toEqual(["i1", "i3"]);
  });

  it("10. isValidEmail mirrors the server-side regex (no false negatives)", () => {
    // Same regex as in create_employee_invitations_bulk
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail("user.name+tag@sub.example.co")).toBe(true);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("noatsign.example.com")).toBe(false);
    expect(isValidEmail("user@nodot")).toBe(false);
    expect(isValidEmail("user @space.com")).toBe(false);
  });
});
