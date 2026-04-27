// ═══════════════════════════════════════════════════════════════
// SOSphere — CDC subscription tenant-scoping test (CRIT-#6)
// ─────────────────────────────────────────────────────────────
// Pins three contracts:
//   1. initRealtimeChannels() registers a postgres_changes subscription
//      on audit_log WITH `filter: company_id=eq.<cid>`. Without the
//      filter the realtime server fans audit rows out across tenants
//      (and only RLS catches them at delivery — defense-in-depth lost).
//   2. sos_queue + gps_trail subscriptions also carry the company_id
//      filter (no regression on already-scoped tables).
//   3. The CDC channel name itself is per-tenant (`cdc:<cid>`).
//
// We do NOT pin the LACK of a filter on sos_messages / evidence —
// those legitimately have no company_id column and rely on RLS, as
// documented inline in shared-store.ts.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from "vitest";

// localStorage shim
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
}
(globalThis as any).localStorage = (globalThis as any).localStorage ?? new MemoryStorage();
(globalThis as any).window = (globalThis as any).window ?? {
  addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
};

// Capture every postgres_changes registration on the CDC channel.
interface CdcReg { event: string; schema: string; table: string; filter?: string; }
const { channelMock, removeChannelMock, lastChannelName, lastCdcRegs } = vi.hoisted(() => ({
  channelMock: vi.fn(),
  removeChannelMock: vi.fn(),
  lastChannelName: { value: "" },
  lastCdcRegs: { value: [] as CdcReg[] },
}));

channelMock.mockImplementation((name: string) => {
  // Track the most recent CDC channel only (the one we care about).
  const isCdc = name.startsWith("cdc:");
  if (isCdc) {
    lastChannelName.value = name;
    lastCdcRegs.value = [];
  }
  const chain: any = {
    on: (_event: string, cfg: any, _cb: any) => {
      if (isCdc) lastCdcRegs.value.push({
        event: cfg.event, schema: cfg.schema, table: cfg.table, filter: cfg.filter,
      });
      return chain;
    },
    subscribe: (_status?: any) => chain,
    send: () => Promise.resolve(),
  };
  return chain;
});

vi.mock("../api/supabase-client", () => ({
  supabase: {
    channel: channelMock,
    removeChannel: removeChannelMock,
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
  SUPABASE_CONFIG: { isConfigured: false },
}));
vi.mock("../sentry-client", () => ({ setSentryCompany: vi.fn() }));
vi.mock("../audit-log-store", () => ({ flushAuditRetryQueue: vi.fn().mockResolvedValue(0) }));

import { initRealtimeChannels } from "../shared-store";

const COMPANY = "co-CRIT6-aaa";

describe("CRIT-#6 — CDC subscriptions are tenant-scoped", () => {
  beforeEach(() => {
    channelMock.mockClear();
    lastChannelName.value = "";
    lastCdcRegs.value = [];
    // Force a fresh init for a never-seen company so initRealtimeChannels
    // actually creates the channel chain. We cannot reset the module-level
    // _companyId from outside, but switching to a brand-new id triggers init.
    initRealtimeChannels(`co-prev-${Math.random().toString(36).slice(2)}`);
    // Clear capture for the subsequent test-target init.
    channelMock.mockClear();
    lastChannelName.value = "";
    lastCdcRegs.value = [];
  });

  it("CRIT-#6: registers an audit_log subscription with company_id filter", () => {
    initRealtimeChannels(COMPANY);
    expect(lastChannelName.value).toBe(`cdc:${COMPANY}`);
    const auditRegs = lastCdcRegs.value.filter(r => r.table === "audit_log");
    expect(auditRegs.length, "audit_log must have exactly 1 INSERT subscription").toBe(1);
    expect(auditRegs[0].event).toBe("INSERT");
    expect(auditRegs[0].filter, "audit_log subscription MUST carry company_id filter").toBe(`company_id=eq.${COMPANY}`);
  });

  it("CRIT-#6: sos_queue subscriptions (INSERT + UPDATE) keep their company_id filter", () => {
    initRealtimeChannels(COMPANY);
    const sosRegs = lastCdcRegs.value.filter(r => r.table === "sos_queue");
    expect(sosRegs.length).toBe(2);
    for (const reg of sosRegs) {
      expect(reg.filter, `sos_queue ${reg.event} must carry company_id filter`)
        .toBe(`company_id=eq.${COMPANY}`);
    }
  });

  it("CRIT-#6: gps_trail subscription keeps its company_id filter", () => {
    initRealtimeChannels(COMPANY);
    const gpsRegs = lastCdcRegs.value.filter(r => r.table === "gps_trail");
    expect(gpsRegs.length).toBe(1);
    expect(gpsRegs[0].filter).toBe(`company_id=eq.${COMPANY}`);
  });

  it("CRIT-#6: CDC channel name embeds the company id (per-tenant routing)", () => {
    initRealtimeChannels(COMPANY);
    expect(lastChannelName.value).toBe(`cdc:${COMPANY}`);
  });

  it("CRIT-#6: every CDC subscription on a table that has company_id is filtered", () => {
    initRealtimeChannels(COMPANY);
    // Tables that DO have company_id (per migrations):
    const SHOULD_FILTER = ["sos_queue", "audit_log", "gps_trail"];
    // Tables WITHOUT company_id (rely on RLS only — see inline comments in
    // shared-store.ts at the postgres_changes registration sites):
    const RLS_ONLY = ["sos_messages", "evidence"];

    for (const tbl of SHOULD_FILTER) {
      const regs = lastCdcRegs.value.filter(r => r.table === tbl);
      expect(regs.length).toBeGreaterThan(0);
      for (const r of regs) {
        expect(r.filter, `${tbl} ${r.event} MUST be filtered`).toBe(`company_id=eq.${COMPANY}`);
      }
    }

    // Sanity: RLS-only tables ARE present but explicitly UNFILTERED — so
    // a future maintainer who naively adds a filter (which would fail with
    // a server error because the column does not exist) gets caught.
    for (const tbl of RLS_ONLY) {
      const regs = lastCdcRegs.value.filter(r => r.table === tbl);
      expect(regs.length, `${tbl} must remain subscribed`).toBeGreaterThan(0);
      for (const r of regs) {
        expect(r.filter,
          `${tbl} has NO company_id column — adding a filter would break the subscription`)
          .toBeUndefined();
      }
    }
  });

  it("CRIT-#6: switching to a new company re-creates the CDC channel with the NEW company_id in every filter", () => {
    initRealtimeChannels(COMPANY);
    const NEW_CO = "co-CRIT6-bbb";
    channelMock.mockClear();
    lastChannelName.value = "";
    lastCdcRegs.value = [];
    initRealtimeChannels(NEW_CO);
    expect(lastChannelName.value).toBe(`cdc:${NEW_CO}`);
    const filtered = lastCdcRegs.value.filter(r => r.filter !== undefined);
    for (const r of filtered) {
      expect(r.filter, `${r.table} must rebind to new company`).toBe(`company_id=eq.${NEW_CO}`);
    }
  });
});
