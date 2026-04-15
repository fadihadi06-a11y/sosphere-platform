// ═══════════════════════════════════════════════════════════════
// SOSphere — Offline Database Coercion Tests (P3-#14)
// ─────────────────────────────────────────────────────────────
// IndexedDB does NOT accept booleans as index keys. Before v4, every
// queue record (SOS, audio, check-in, GPS, incident, message) stored
// its `synced` field as a boolean — which meant the `by_synced` index
// silently excluded every record and the offline replay watchers were
// draining an always-empty queue.
//
// These tests lock in the v4 boundary-coercion contract so a future
// change can never regress the fix:
//
//   • writes:  `synced: boolean` → `synced: 0 | 1` before hitting IDB
//   • reads:   `synced: 0 | 1`   → `synced: boolean` before callers
//   • queries: `dbGetByIndex(..., false)` → internally queries key `0`
//
// The helpers are pure, so we can test them in vitest's default Node
// environment without pulling in fake-indexeddb.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import {
  coerceSyncedForIDB,
  coerceSyncedFromIDB,
  coerceSyncedKey,
} from "../offline-database";

describe("coerceSyncedForIDB — write-side boolean → 0|1", () => {
  it("converts synced:true to synced:1", () => {
    const input = { id: "A", synced: true, payload: "x" };
    const out = coerceSyncedForIDB(input);
    expect(out).toEqual({ id: "A", synced: 1, payload: "x" });
  });

  it("converts synced:false to synced:0", () => {
    const input = { id: "B", synced: false };
    const out = coerceSyncedForIDB(input);
    expect((out as { synced: unknown }).synced).toBe(0);
  });

  it("leaves numeric synced values untouched", () => {
    // If code already passes 0 or 1 (e.g. markGPSBatchSynced), we must
    // not double-flip it and accidentally zero out a truthful '1'.
    const input = { id: "C", synced: 1 };
    const out = coerceSyncedForIDB(input);
    expect((out as { synced: unknown }).synced).toBe(1);
  });

  it("leaves records without a synced field alone", () => {
    const input = { id: "D", other: 42 };
    expect(coerceSyncedForIDB(input)).toEqual(input);
  });

  it("does not mutate the input record", () => {
    const input = { id: "E", synced: true };
    const out = coerceSyncedForIDB(input);
    expect(input.synced).toBe(true); // original preserved
    expect((out as { synced: unknown }).synced).toBe(1);
  });
});

describe("coerceSyncedFromIDB — read-side 0|1 → boolean", () => {
  it("converts synced:1 back to synced:true", () => {
    const row = { id: "A", synced: 1, payload: "x" };
    const out = coerceSyncedFromIDB(row);
    expect(out).toEqual({ id: "A", synced: true, payload: "x" });
  });

  it("converts synced:0 back to synced:false", () => {
    const row = { id: "B", synced: 0 };
    const out = coerceSyncedFromIDB(row);
    expect((out as { synced: unknown }).synced).toBe(false);
  });

  it("returns undefined unchanged (store.get miss)", () => {
    expect(coerceSyncedFromIDB(undefined)).toBeUndefined();
  });

  it("leaves records without a synced field alone", () => {
    const row = { id: "C", other: 42 };
    expect(coerceSyncedFromIDB(row)).toEqual(row);
  });
});

describe("coerceSyncedKey — query-side boolean → 0|1", () => {
  it("maps false → 0 (the unsynced-index query)", () => {
    expect(coerceSyncedKey(false)).toBe(0);
  });

  it("maps true → 1 (the synced-index query)", () => {
    expect(coerceSyncedKey(true)).toBe(1);
  });

  it("passes non-boolean keys through unchanged", () => {
    expect(coerceSyncedKey("some-id")).toBe("some-id");
    expect(coerceSyncedKey(42)).toBe(42);
  });
});

describe("round-trip: write → read is identity at the boundary", () => {
  // A record that makes a round-trip through coerceSyncedForIDB (on
  // write) and coerceSyncedFromIDB (on read) must come back shaped
  // identically to what callers originally passed in. This is the
  // contract that keeps existing TypeScript interfaces (synced:
  // boolean) valid across the fix.
  it("preserves synced:true across write/read", () => {
    const original = { id: "A", synced: true, extra: 1 };
    const written = coerceSyncedForIDB(original);
    const readBack = coerceSyncedFromIDB(written);
    expect(readBack).toEqual(original);
  });

  it("preserves synced:false across write/read", () => {
    const original = { id: "B", synced: false, extra: 2 };
    const written = coerceSyncedForIDB(original);
    const readBack = coerceSyncedFromIDB(written);
    expect(readBack).toEqual(original);
  });

  it("non-synced records survive both directions untouched", () => {
    const original = { id: "C", foo: "bar" };
    const written = coerceSyncedForIDB(original);
    const readBack = coerceSyncedFromIDB(written);
    expect(readBack).toEqual(original);
  });
});
