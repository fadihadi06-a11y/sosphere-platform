/**
 * SOSphere — Last Breath Service
 * ═══════════════════════════════
 * "آخر نَفَس" — When the device battery drops to a critical level (≤ 3%),
 * automatically sends a final SOS SMS with the last known GPS coordinates
 * to all configured emergency contacts via the Supabase Edge Function.
 *
 * This is a PASSIVE safety net — the user does NOT need to press anything.
 * If the phone dies, the emergency contacts have the last known location.
 *
 * Design principles:
 *   • Purely additive — no existing flow is altered.
 *   • Uses Capacitor Device plugin for battery level (falls back to
 *     navigator.getBattery() for web).
 *   • Fires ONCE per charge cycle (won't spam if battery fluctuates).
 *   • All tiers get this feature — it's a universal safety right.
 *   • Respects user opt-in (enabled by default, can be toggled off).
 *
 * FLOW:
 *   1. startMonitoring() registers a battery listener.
 *   2. On each level change, checks if ≤ CRITICAL_THRESHOLD%.
 *   3. If yes AND not already fired this cycle → calls sendLastBreath().
 *   4. sendLastBreath() reads cached GPS + contacts from localStorage/state,
 *      POSTs to Supabase sos-alert with action="last_breath".
 *   5. Marks as fired so it won't repeat until battery goes above 20%.
 */

// ── Configuration ───────────────────────────────────────────
const CRITICAL_THRESHOLD = 0.03;       // 3% battery
const RESET_THRESHOLD    = 0.20;       // Reset "fired" flag when battery recovers above 20%
const STORAGE_KEY        = "sosphere_last_breath";
const GPS_CACHE_KEY      = "sosphere_last_gps";

// ── Types ───────────────────────────────────────────────────
interface LastBreathState {
  enabled: boolean;
  firedThisCycle: boolean;
  lastFiredAt: number | null;
}

interface CachedGPS {
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp: number;
}

interface LastBreathResult {
  sent: boolean;
  reason?: string;
  contactsNotified?: number;
}

// ── State ───────────────────────────────────────────────────
let _monitoring = false;
let _batteryRef: any = null;           // BatteryManager reference (web)
let _capacitorListenerId: string | null = null;

// ── Storage helpers ─────────────────────────────────────────
function getState(): LastBreathState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { enabled: true, firedThisCycle: false, lastFiredAt: null };
}

function setState(patch: Partial<LastBreathState>): void {
  try {
    const current = getState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {}
}

// ── GPS cache (updated by offline-gps-tracker or SOS flow) ──
export function cacheGPS(lat: number, lng: number, accuracy?: number): void {
  try {
    const entry: CachedGPS = { lat, lng, accuracy, timestamp: Date.now() };
    localStorage.setItem(GPS_CACHE_KEY, JSON.stringify(entry));
  } catch {}
}

function getCachedGPS(): CachedGPS | null {
  try {
    const raw = localStorage.getItem(GPS_CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

// ── Emergency contacts reader (from shared-store or localStorage) ──
function getEmergencyContacts(): Array<{ name: string; phone: string }> {
  try {
    const raw = localStorage.getItem("sosphere_emergency_contacts");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

// ── Core: send the last breath SMS ──────────────────────────
async function sendLastBreath(): Promise<LastBreathResult> {
  const state = getState();
  if (!state.enabled) return { sent: false, reason: "disabled" };
  if (state.firedThisCycle) return { sent: false, reason: "already_fired" };

  const gps = getCachedGPS();
  const contacts = getEmergencyContacts();

  if (contacts.length === 0) {
    console.warn("[LastBreath] No emergency contacts configured — skipping.");
    return { sent: false, reason: "no_contacts" };
  }

  // Build the SOS payload
  const supabaseUrl = (typeof import.meta !== "undefined" &&
    (import.meta as any).env?.VITE_SUPABASE_URL) || "";
  const supabaseAnonKey = (typeof import.meta !== "undefined" &&
    (import.meta as any).env?.VITE_SUPABASE_ANON_KEY) || "";

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[LastBreath] Missing Supabase config.");
    return { sent: false, reason: "no_supabase_config" };
  }

  // S-C4: use Supabase SDK session instead of reading localStorage directly
  let authToken = "";
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data: { session } } = await supabase.auth.getSession();
    authToken = session?.access_token || "";
  } catch {}

  const mapsUrl = gps
    ? `https://maps.google.com/maps?q=${gps.lat},${gps.lng}`
    : "Location unavailable";

  const locationText = gps
    ? `${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)}`
    : "Unknown";

  const body = {
    action: "last_breath",
    contacts: contacts.map(c => ({ name: c.name, phone: c.phone })),
    location: gps ? { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy } : null,
    message: `LAST BREATH ALERT: Battery critically low. Last known location: ${locationText} — ${mapsUrl} — SOSphere`,
    messageAr: `تنبيه آخر نَفَس: البطارية على وشك النفاد. آخر موقع معروف: ${locationText} — ${mapsUrl} — SOSphere`,
    timestamp: Date.now(),
  };

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "apikey": supabaseAnonKey,
    };
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/sos-alert`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error(`[LastBreath] Server error ${response.status}: ${errText}`);
      return { sent: false, reason: `server_error_${response.status}` };
    }

    const data = await response.json().catch(() => ({}));
    const contactsNotified = Array.isArray(data.results) ? data.results.length : contacts.length;

    // Mark as fired for this charge cycle
    setState({ firedThisCycle: true, lastFiredAt: Date.now() });

    console.info(`[LastBreath] Sent to ${contactsNotified} contacts. GPS: ${locationText}`);
    return { sent: true, contactsNotified };
  } catch (err: any) {
    console.error("[LastBreath] Network error:", err.message || err);

    // Last-resort: try navigator.sendBeacon (works even as page unloads)
    try {
      const beaconData = new Blob([JSON.stringify(body)], { type: "application/json" });
      const beaconSent = navigator.sendBeacon(
        `${supabaseUrl}/functions/v1/sos-alert`,
        beaconData
      );
      if (beaconSent) {
        setState({ firedThisCycle: true, lastFiredAt: Date.now() });
        console.info("[LastBreath] Sent via sendBeacon (last resort).");
        return { sent: true, reason: "beacon_fallback" };
      }
    } catch {}

    return { sent: false, reason: "network_error" };
  }
}

// ── Battery level handler ───────────────────────────────────
function onBatteryLevelChange(level: number): void {
  const state = getState();

  // Reset the "fired" flag once battery recovers above RESET_THRESHOLD
  if (level > RESET_THRESHOLD && state.firedThisCycle) {
    setState({ firedThisCycle: false });
    console.info("[LastBreath] Battery recovered above 20% — reset for next cycle.");
    return;
  }

  // Check if we need to fire
  if (level <= CRITICAL_THRESHOLD && !state.firedThisCycle && state.enabled) {
    console.warn(`[LastBreath] Battery at ${(level * 100).toFixed(0)}% — sending last breath!`);
    sendLastBreath().catch(err => {
      console.error("[LastBreath] Failed to send:", err);
    });
  }
}

// ── Public API ──────────────────────────────────────────────

/**
 * Start monitoring battery level. Call once at app startup.
 * Safe to call multiple times (idempotent).
 */
export async function startLastBreathMonitoring(): Promise<void> {
  if (_monitoring) return;
  _monitoring = true;

  // Try Capacitor Device plugin first (native Android/iOS)
  // S-C3: replaced new Function() with native dynamic import
  try {
    const mod = await import("@capacitor/device");
    const Device = mod?.Device;
    if (Device && typeof Device.getBatteryInfo === "function") {
      // Initial check
      const info = await Device.getBatteryInfo();
      if (typeof info.batteryLevel === "number") {
        onBatteryLevelChange(info.batteryLevel);
      }

      // Poll every 60 seconds (Capacitor doesn't have a battery listener)
      setInterval(async () => {
        try {
          const latest = await Device.getBatteryInfo();
          if (typeof latest.batteryLevel === "number") {
            onBatteryLevelChange(latest.batteryLevel);
          }
        } catch {}
      }, 60_000);

      console.info("[LastBreath] Monitoring via Capacitor Device plugin.");
      return;
    }
  } catch {
    // Capacitor not available, try web API
  }

  // Fallback: Web Battery API
  try {
    if ("getBattery" in navigator) {
      const battery: any = await (navigator as any).getBattery();
      _batteryRef = battery;

      // Initial check
      onBatteryLevelChange(battery.level);

      // Listen for changes
      battery.addEventListener("levelchange", () => {
        onBatteryLevelChange(battery.level);
      });

      console.info("[LastBreath] Monitoring via Web Battery API.");
      return;
    }
  } catch {}

  console.warn("[LastBreath] No battery API available — monitoring disabled.");
  _monitoring = false;
}

/**
 * Stop monitoring (cleanup).
 */
export function stopLastBreathMonitoring(): void {
  _monitoring = false;
  if (_batteryRef) {
    try {
      _batteryRef.removeEventListener("levelchange", onBatteryLevelChange);
    } catch {}
    _batteryRef = null;
  }
}

/**
 * Enable or disable the Last Breath feature.
 */
export function setLastBreathEnabled(enabled: boolean): void {
  setState({ enabled });
  console.info(`[LastBreath] ${enabled ? "Enabled" : "Disabled"} by user.`);
}

/**
 * Check if Last Breath is currently enabled.
 */
export function isLastBreathEnabled(): boolean {
  return getState().enabled;
}

/**
 * Get the last time Last Breath fired (null if never).
 */
export function getLastBreathFiredAt(): number | null {
  return getState().lastFiredAt;
}

/**
 * Manually trigger Last Breath (for testing only).
 */
export async function testLastBreath(): Promise<LastBreathResult> {
  console.info("[LastBreath] Manual test trigger.");
  // Temporarily unflag to allow firing
  setState({ firedThisCycle: false });
  return sendLastBreath();
}
