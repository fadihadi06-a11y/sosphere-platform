// ═══════════════════════════════════════════════════════════════
// SOSphere — dashboard-auth-guard contract (12th pattern app)
// ─────────────────────────────────────────────────────────────
// 2026-06-03 CRIT-AUTH. Locks the post-refactor contract:
//
//   1. setDashboardSession writes ONLY hint fields (no role)
//   2. setDashboardSession does NOT write permissions
//   3. setDashboardSession does NOT write userId
//   4. getDashboardSession returns hint fields only
//   5. clearDashboardSession wipes the key
//   6. isSessionExpired: pre-V5 session (v4 or older) → expired
//   7. isSessionExpired: V5 within TTL → valid
//   8. isSessionExpired: V5 past TTL → expired
//   9. canAccessPage: null verified session → not authenticated
//  10. canAccessPage: super_admin can access roles page
//  11. canAccessPage: company_admin allowed billing (tier 2)
//  12. canAccessPage: lower tier role denied roles page
//  13. canAccessPage: missing permission denies even with right tier
//  14. getAccessiblePages: filters correctly per role
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from "vitest";

const lsStore: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem:    (k: string) => lsStore[k] ?? null,
  setItem:    (k: string, v: string) => { lsStore[k] = v; },
  removeItem: (k: string) => { delete lsStore[k]; },
  clear:      () => { for (const k of Object.keys(lsStore)) delete lsStore[k]; },
});

async function loadFresh() {
  vi.resetModules();
  return await import("../dashboard-auth-guard");
}

const KEY = "sosphere_dashboard_hint";

describe("dashboard-auth-guard — 12th pattern contract (CRIT-AUTH)", () => {
  beforeEach(() => {
    for (const k of Object.keys(lsStore)) delete lsStore[k];
  });

  it("1. setDashboardSession writes ONLY hint fields (no role)", async () => {
    const { setDashboardSession } = await loadFresh();
    setDashboardSession("Alice", "Acme Co");
    const stored = JSON.parse(lsStore[KEY]);
    expect(stored.name).toBe("Alice");
    expect(stored.company).toBe("Acme Co");
    expect(stored.role).toBeUndefined();
  });

  it("2. setDashboardSession does NOT write permissions", async () => {
    const { setDashboardSession } = await loadFresh();
    setDashboardSession("Alice", "Acme Co");
    const stored = JSON.parse(lsStore[KEY]);
    expect(stored.permissions).toBeUndefined();
  });

  it("3. setDashboardSession does NOT write userId", async () => {
    const { setDashboardSession } = await loadFresh();
    setDashboardSession("Alice", "Acme Co");
    const stored = JSON.parse(lsStore[KEY]);
    expect(stored.userId).toBeUndefined();
  });

  it("4. getDashboardSession returns hint fields only", async () => {
    const { setDashboardSession, getDashboardSession } = await loadFresh();
    setDashboardSession("Bob", "Beta Inc");
    const s = getDashboardSession();
    expect(s?.name).toBe("Bob");
    expect(s?.company).toBe("Beta Inc");
    expect(typeof s?.loginAt).toBe("number");
    expect(s?.version).toBe(1);
  });

  it("5. clearDashboardSession wipes the key", async () => {
    const { setDashboardSession, clearDashboardSession, getDashboardSession } = await loadFresh();
    setDashboardSession("X", "Y");
    clearDashboardSession();
    expect(getDashboardSession()).toBeNull();
    expect(lsStore[KEY]).toBeUndefined();
  });

  it("6. isSessionExpired: pre-V1 session (v0 / missing version) → expired", async () => {
    const { isSessionExpired } = await loadFresh();
    // SESSION_VERSION = 1 (the new HINT format). Any session with version
    // below 1 (legacy v0/v4 sessions, or no version field at all) is
    // refused, forcing the user through the new clean-write path.
    expect(isSessionExpired({ name: "x", company: "y", loginAt: Date.now(), version: 0 })).toBe(true);
    expect(isSessionExpired({ name: "x", company: "y", loginAt: Date.now() })).toBe(true);
  });

  it("7. isSessionExpired: V1 within TTL → valid", async () => {
    const { isSessionExpired } = await loadFresh();
    expect(isSessionExpired({
      name: "x", company: "y", loginAt: Date.now() - 60_000, version: 1,
    })).toBe(false);
  });

  it("8. isSessionExpired: V1 past TTL → expired", async () => {
    const { isSessionExpired } = await loadFresh();
    expect(isSessionExpired({
      name: "x", company: "y", loginAt: Date.now() - 9 * 60 * 60_000, version: 1,
    })).toBe(true);
  });

  it("9. canAccessPage: null verified session → not authenticated", async () => {
    const { canAccessPage } = await loadFresh();
    const r = canAccessPage(null, "overview");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("Not authenticated");
  });

  it("10. canAccessPage: super_admin can access roles page", async () => {
    const { canAccessPage } = await loadFresh();
    const r = canAccessPage({
      hint: null, role: "super_admin", userId: "u1",
      permissions: ["users:manage"], companyId: "c1",
    }, "roles");
    expect(r.allowed).toBe(true);
  });

  it("11. canAccessPage: company_admin allowed billing (tier 2)", async () => {
    const { canAccessPage } = await loadFresh();
    const r = canAccessPage({
      hint: null, role: "company_admin", userId: "u1",
      permissions: ["billing:view"], companyId: "c1",
    }, "billing");
    expect(r.allowed).toBe(true);
  });

  it("12. canAccessPage: lower tier role denied roles page", async () => {
    const { canAccessPage } = await loadFresh();
    const r = canAccessPage({
      hint: null, role: "dispatcher", userId: "u1",
      permissions: ["users:manage"], companyId: "c1",
    }, "roles");
    expect(r.allowed).toBe(false);
  });

  it("13. canAccessPage: missing permission denies even with right tier", async () => {
    const { canAccessPage } = await loadFresh();
    const r = canAccessPage({
      hint: null, role: "company_admin", userId: "u1",
      permissions: [], companyId: "c1",
    }, "billing");
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("billing:view");
  });

  it("14. getAccessiblePages: filters correctly per role", async () => {
    const { getAccessiblePages } = await loadFresh();
    // company_admin (tier 2) with full permissions can access all 16 pages
    const adminPages = getAccessiblePages({
      hint: null, role: "company_admin", userId: "u1",
      permissions: [
        "users:view","zones:view","emergency:view","emergency:broadcast",
        "zones:edit","emergency:escalate","reports:view","command:view",
        "users:manage","audit:view","billing:view","settings:edit",
      ], companyId: "c1",
    });
    expect(adminPages.length).toBeGreaterThanOrEqual(15);
    // dispatcher (tier 5) cannot reach roles/billing/settings
    const dispatcherPages = getAccessiblePages({
      hint: null, role: "dispatcher", userId: "u1",
      permissions: ["emergency:view","emergency:broadcast"], companyId: "c1",
    });
    expect(dispatcherPages).not.toContain("roles");
    expect(dispatcherPages).not.toContain("billing");
    expect(dispatcherPages).not.toContain("settings");
  });
});

// ───────── dashboardSessionLoader (fresh-audit #2, 2026-06-04) ─────────

describe("dashboardSessionLoader - fresh-audit #2 non-redirecting loader", () => {
  beforeEach(() => {
    for (const k of Object.keys(lsStore)) delete lsStore[k];
    vi.resetModules();
  });

  it("15. returns verified=null + expired=false when no session at all", async () => {
    vi.doMock("../../api/authenticated-role", () => ({
      getAuthenticatedRole: async () => ({ verified: false, role: null, userId: null, companyId: null }),
    }));
    const { dashboardSessionLoader } = await import("../dashboard-auth-guard");
    const r = await dashboardSessionLoader();
    expect(r.verified).toBeNull();
    expect(r.expired).toBe(false);
  });

  it("16. clears expired hint + reports expired=true (the bug it fixes)", async () => {
    // Place a stale hint that is past TTL
    lsStore["sosphere_dashboard_hint"] = JSON.stringify({
      name: "Stale", company: "Old Co",
      loginAt: Date.now() - (9 * 60 * 60 * 1000), // 9h ago, beyond 8h TTL
      version: 1,
    });
    vi.doMock("../../api/authenticated-role", () => ({
      getAuthenticatedRole: async () => ({ verified: false, role: null, userId: null, companyId: null }),
    }));
    const { dashboardSessionLoader } = await import("../dashboard-auth-guard");
    const r = await dashboardSessionLoader();
    expect(r.expired).toBe(true);
    // Hint must be wiped from localStorage
    expect(lsStore["sosphere_dashboard_hint"]).toBeUndefined();
  });

  it("17. returns verified session when getAuthenticatedRole resolves", async () => {
    lsStore["sosphere_dashboard_hint"] = JSON.stringify({
      name: "Alice", company: "Acme", loginAt: Date.now(), version: 1,
    });
    vi.doMock("../../api/authenticated-role", () => ({
      getAuthenticatedRole: async () => ({
        verified: true, role: "company_admin", userId: "user-1", companyId: "company-1",
      }),
    }));
    const { dashboardSessionLoader } = await import("../dashboard-auth-guard");
    const r = await dashboardSessionLoader();
    expect(r.verified).not.toBeNull();
    expect(r.verified?.role).toBe("company_admin");
    expect(r.verified?.userId).toBe("user-1");
    expect(r.verified?.companyId).toBe("company-1");
    expect(r.expired).toBe(false);
  });

  it("18. NEVER throws on getAuthenticatedRole rejection (preserves UX contract)", async () => {
    vi.doMock("../../api/authenticated-role", () => ({
      getAuthenticatedRole: async () => { throw new Error("network down"); },
    }));
    const { dashboardSessionLoader } = await import("../dashboard-auth-guard");
    // The promise must resolve, not reject. The page renders its
    // in-component PIN+MFA flow when verified is null.
    const r = await dashboardSessionLoader();
    expect(r.verified).toBeNull();
    expect(r.expired).toBe(false);
  });
});
