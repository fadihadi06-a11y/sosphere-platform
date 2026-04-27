// ═══════════════════════════════════════════════════════════════
// SOSphere — subscribeSubscriptionChanges test suite (CRIT-#3)
// ─────────────────────────────────────────────────────────────
// Pins the Stripe→Realtime→tier-refresh contract so a future change
// cannot regress into the original "user pays, app doesn't notice
// for 5 min" behaviour.
//
// What we lock in:
//   • subscribes once per user under sub-tier:<uid>
//   • postgres_changes filter is user-scoped (filter=user_id=eq.<uid>)
//   • onChange fires for INSERT / UPDATE / DELETE on the row
//   • auth-state changes re-subscribe under the new user_id
//   • sign-out tears down the channel
//   • no subscription when there is no session
//   • cleanup is idempotent
//   • channel errors are logged-and-swallowed (FAIL-SECURE)
//   • the "real" user_id leaks ONLY to the user-scoped channel name
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Hoisted spies that the supabase mock factory references ────
const {
  channelMock,
  removeChannelMock,
  getSessionMock,
  onAuthStateChangeMock,
  authUnsubMock,
} = vi.hoisted(() => {
  const removeChannelMock = vi.fn();
  const getSessionMock = vi.fn();
  const authUnsubMock = vi.fn();
  const onAuthStateChangeMock = vi.fn();
  // channel() returns a chainable object whose .on().subscribe() captures
  // the callbacks so tests can simulate Postgres NOTIFY → callback.
  const channelMock = vi.fn();
  return { channelMock, removeChannelMock, getSessionMock, onAuthStateChangeMock, authUnsubMock };
});

// IMPORTANT: vi.mock() resolves the path RELATIVE TO THIS TEST FILE, not
// relative to the file under test. subscription-realtime.ts imports
// "./supabase-client" from inside src/app/components/api/. From this test
// file's location (src/app/components/__tests__/) the same module is at
// "../api/supabase-client". A wrong path causes the mock to NEVER apply
// and the real supabase client gets pulled in (which then no-ops the
// mocks defined here).
vi.mock("../api/supabase-client", () => ({
  supabase: {
    channel: channelMock,
    removeChannel: removeChannelMock,
    auth: {
      getSession: getSessionMock,
      onAuthStateChange: onAuthStateChangeMock,
    },
  },
}));

import { subscribeSubscriptionChanges } from "../api/subscription-realtime";

// Helper: each test re-builds the chain factory so it can capture the
// `on` listener and the `subscribe` status callback for assertions.
interface ChainCapture {
  channelName: string;
  onCalls: Array<{ event: string; cfg: any; cb: (payload: unknown) => void }>;
  subscribeStatus: ((status: string) => void) | null;
}
function makeChannelChain(): ChainCapture {
  const cap: ChainCapture = { channelName: "", onCalls: [], subscribeStatus: null };
  channelMock.mockImplementation((name: string) => {
    cap.channelName = name;
    const chain: any = {
      on: (event: string, cfg: any, cb: any) => {
        cap.onCalls.push({ event, cfg, cb });
        return chain;
      },
      subscribe: (statusCb?: (s: string) => void) => {
        cap.subscribeStatus = statusCb ?? null;
        return chain;
      },
    };
    return chain;
  });
  return cap;
}

describe("subscribeSubscriptionChanges — CRIT-#3 contract", () => {
  beforeEach(() => {
    channelMock.mockReset();
    removeChannelMock.mockReset();
    getSessionMock.mockReset();
    onAuthStateChangeMock.mockReset();
    authUnsubMock.mockReset();
    onAuthStateChangeMock.mockReturnValue({ data: { subscription: { unsubscribe: authUnsubMock } } });
  });

  it("subscribes under sub-tier:<uid> when a session exists", async () => {
    const cap = makeChannelChain();
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "USR-aaa" } } } });

    const cleanup = await subscribeSubscriptionChanges(() => {});

    expect(channelMock).toHaveBeenCalledTimes(1);
    expect(cap.channelName).toBe("sub-tier:USR-aaa");
    expect(cap.onCalls).toHaveLength(1);
    expect(cap.onCalls[0].event).toBe("postgres_changes");
    expect(cap.onCalls[0].cfg).toMatchObject({
      event: "*",
      schema: "public",
      table: "subscriptions",
      filter: "user_id=eq.USR-aaa",
    });

    cleanup();
  });

  it("does NOT subscribe when no session exists (anonymous browse)", async () => {
    makeChannelChain();
    getSessionMock.mockResolvedValue({ data: { session: null } });

    const cleanup = await subscribeSubscriptionChanges(() => {});

    expect(channelMock).not.toHaveBeenCalled();
    cleanup();
  });

  it("invokes the onChange callback when Postgres fires INSERT / UPDATE / DELETE", async () => {
    const cap = makeChannelChain();
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "USR-aaa" } } } });
    const onChange = vi.fn();
    const cleanup = await subscribeSubscriptionChanges(onChange);

    // Simulate Postgres NOTIFY for each event type.
    cap.onCalls[0].cb({ eventType: "INSERT", new: { user_id: "USR-aaa", tier: "elite" } });
    cap.onCalls[0].cb({ eventType: "UPDATE", new: { user_id: "USR-aaa", tier: "basic" } });
    cap.onCalls[0].cb({ eventType: "DELETE", old: { user_id: "USR-aaa" } });

    expect(onChange).toHaveBeenCalledTimes(3);
    cleanup();
  });

  it("re-subscribes when auth changes to a different user", async () => {
    const cap1 = makeChannelChain();
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "USR-aaa" } } } });

    let authCb: (event: string, session: any) => void = () => {};
    onAuthStateChangeMock.mockImplementation((cb: any) => {
      authCb = cb;
      return { data: { subscription: { unsubscribe: authUnsubMock } } };
    });

    const cleanup = await subscribeSubscriptionChanges(() => {});

    expect(cap1.channelName).toBe("sub-tier:USR-aaa");
    expect(channelMock).toHaveBeenCalledTimes(1);

    // Simulate signing out + signing in as a different user.
    authCb("SIGNED_IN", { user: { id: "USR-bbb" } });
    // Allow the async subscribeFor() to run.
    await new Promise((r) => setImmediate(r));

    expect(removeChannelMock).toHaveBeenCalledTimes(1);  // old channel torn down
    expect(channelMock).toHaveBeenCalledTimes(2);        // new one opened
    cleanup();
  });

  it("tears down the channel on sign-out", async () => {
    const cap = makeChannelChain();
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "USR-aaa" } } } });
    let authCb: (event: string, session: any) => void = () => {};
    onAuthStateChangeMock.mockImplementation((cb: any) => {
      authCb = cb;
      return { data: { subscription: { unsubscribe: authUnsubMock } } };
    });

    const cleanup = await subscribeSubscriptionChanges(() => {});
    expect(channelMock).toHaveBeenCalledTimes(1);

    authCb("SIGNED_OUT", null);
    await new Promise((r) => setImmediate(r));

    expect(removeChannelMock).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("ignores duplicate auth-state callbacks for the same user (no extra subscribe)", async () => {
    makeChannelChain();
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "USR-aaa" } } } });
    let authCb: (event: string, session: any) => void = () => {};
    onAuthStateChangeMock.mockImplementation((cb: any) => {
      authCb = cb;
      return { data: { subscription: { unsubscribe: authUnsubMock } } };
    });

    const cleanup = await subscribeSubscriptionChanges(() => {});
    expect(channelMock).toHaveBeenCalledTimes(1);

    // TOKEN_REFRESHED fires periodically — same user, must NOT re-subscribe.
    authCb("TOKEN_REFRESHED", { user: { id: "USR-aaa" } });
    await new Promise((r) => setImmediate(r));

    expect(channelMock).toHaveBeenCalledTimes(1);  // still 1
    expect(removeChannelMock).not.toHaveBeenCalled();
    cleanup();
  });

  it("cleanup is idempotent (calling it twice does not throw)", async () => {
    makeChannelChain();
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "USR-aaa" } } } });

    const cleanup = await subscribeSubscriptionChanges(() => {});

    cleanup();
    expect(() => cleanup()).not.toThrow();
    // Should only remove once — second call is a no-op.
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
    expect(authUnsubMock).toHaveBeenCalledTimes(1);
  });

  it("FAIL-SECURE: getSession() throwing does not crash the caller", async () => {
    makeChannelChain();
    getSessionMock.mockRejectedValueOnce(new Error("network down"));

    const cleanup = await subscribeSubscriptionChanges(() => {});

    expect(channelMock).not.toHaveBeenCalled();  // never opens
    expect(() => cleanup()).not.toThrow();        // safe to clean up anyway
  });

  it("FAIL-SECURE: channel() throwing does not crash the caller", async () => {
    channelMock.mockImplementationOnce(() => { throw new Error("channel constructor crash"); });
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "USR-aaa" } } } });

    const cleanup = await subscribeSubscriptionChanges(() => {});
    expect(() => cleanup()).not.toThrow();
  });

  it("FAIL-SECURE: an onChange handler that throws does not break the listener", async () => {
    const cap = makeChannelChain();
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "USR-aaa" } } } });

    const onChange = vi.fn(() => { throw new Error("handler boom"); });
    const cleanup = await subscribeSubscriptionChanges(onChange);

    // First fire: handler throws — must be caught.
    expect(() => cap.onCalls[0].cb({ eventType: "UPDATE", new: { user_id: "USR-aaa" } })).not.toThrow();
    // Second fire: listener still alive, must call again.
    cap.onCalls[0].cb({ eventType: "UPDATE", new: { user_id: "USR-aaa" } });
    expect(onChange).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it("after stopped, auth-state callbacks are ignored (no resurrection)", async () => {
    makeChannelChain();
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "USR-aaa" } } } });
    let authCb: (event: string, session: any) => void = () => {};
    onAuthStateChangeMock.mockImplementation((cb: any) => {
      authCb = cb;
      return { data: { subscription: { unsubscribe: authUnsubMock } } };
    });

    const cleanup = await subscribeSubscriptionChanges(() => {});
    cleanup();  // stop
    channelMock.mockClear();

    // Simulate a sign-in arriving AFTER cleanup — listener must NOT respawn.
    authCb("SIGNED_IN", { user: { id: "USR-ccc" } });
    await new Promise((r) => setImmediate(r));

    expect(channelMock).not.toHaveBeenCalled();
  });
});
