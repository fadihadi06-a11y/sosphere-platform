// ═══════════════════════════════════════════════════════════════
// SOSphere — Packet Preferences Service (26th pattern application)
// ─────────────────────────────────────────────────────────────
// 2026-06-06 roots-of-roots M2-#2: per-user privacy-consent toggles
// for the SOS Emergency Packet. Pre-pattern, these lived ONLY in
// localStorage (sosphere_packet_modules). That's a GDPR Art.7
// problem: opt-out doesn't travel between devices.
//
// Mobile emergency-packet.tsx now dual-writes:
//   • localStorage: instant UI render (toggle reflects immediately)
//   • SECDEF RPC:   durable cross-device mirror (the source of truth)
//
// On mount the page hydrates from server (overrides localStorage
// when present) so opt-out follows the user, not the device.
//
// DB:
//   public.user_packet_preferences  — PK user_id (one row per user)
//
// RPCs:
//   upsert_user_packet_preferences(p_modules jsonb)
//   get_user_packet_preferences()
// ═══════════════════════════════════════════════════════════════

export interface PacketModules {
  /** Always true — cannot be disabled (responders need lat/lng). */
  location:  boolean;
  medical:   boolean;
  contacts:  boolean;
  device:    boolean;
  recording: boolean;
  incident:  boolean;
}

export const DEFAULT_PACKET_MODULES: PacketModules = {
  location:  true,
  medical:   true,
  contacts:  true,
  device:    true,
  recording: true,
  incident:  true,
};

// ───────── IN-MEMORY CACHE ─────────

let _cachedModules: PacketModules | null = null;

export function setCachedPacketModules(m: PacketModules): void {
  _cachedModules = { ...m };
}

export function getCachedPacketModules(): PacketModules | null {
  return _cachedModules ? { ..._cachedModules } : null;
}

/** Drop the in-memory cache. Called by complete-logout so a shared
 *  device doesn't leak the previous user's consent state. */
export function clearPacketPreferencesCache(): void {
  _cachedModules = null;
}

// ───────── PURE HELPERS (Vitest-testable) ─────────

/** Merge a server-returned partial-modules object with defaults so
 *  every required key has a boolean. Pure. */
export function hydrateModules(raw: unknown): PacketModules {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PACKET_MODULES };
  const r = raw as Record<string, unknown>;
  return {
    // `location` is ALWAYS true regardless of server payload — without
    // a position the SOS is useless to responders.
    location:  true,
    medical:   r.medical   !== false,
    contacts:  r.contacts  !== false,
    device:    r.device    !== false,
    recording: r.recording !== false,
    incident:  r.incident  !== false,
  };
}

/** Reduce the modules object to a count of opt-ins (excluding the
 *  always-on `location`). Pure. Useful for the "X of 5 enabled" hint. */
export function countOptIns(m: PacketModules): number {
  return [m.medical, m.contacts, m.device, m.recording, m.incident]
    .filter(Boolean).length;
}

// ───────── RPC WRAPPERS ─────────

export async function loadPacketPreferences(): Promise<PacketModules> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("get_user_packet_preferences");
    if (error || !Array.isArray(data) || data.length === 0) {
      if (error) console.warn("[packet-prefs] load RPC failed:", error.message);
      return { ...DEFAULT_PACKET_MODULES };
    }
    const row = data[0] as { modules: unknown };
    const hydrated = hydrateModules(row.modules);
    setCachedPacketModules(hydrated);
    return hydrated;
  } catch (err) {
    console.warn("[packet-prefs] load threw:", err);
    return { ...DEFAULT_PACKET_MODULES };
  }
}

export async function upsertPacketPreferences(modules: PacketModules): Promise<boolean> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { error } = await supabase.rpc("upsert_user_packet_preferences", {
      p_modules: modules as unknown as Record<string, boolean>,
    });
    if (error) {
      console.warn("[packet-prefs] upsert RPC failed:", error.message);
      return false;
    }
    setCachedPacketModules(modules);
    return true;
  } catch (err) {
    console.warn("[packet-prefs] upsert threw:", err);
    return false;
  }
}
