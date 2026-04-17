/**
 * SOSphere — Panic Siren Service
 * ═══════════════════════════════
 * "صفّارة الذعر" — Emits a loud, piercing alarm tone through the device
 * speaker at maximum volume to attract attention and deter attackers.
 *
 * Two activation modes:
 *   1. MANUAL — User taps a dedicated siren button in the SOS screen.
 *   2. AUTO   — Optionally auto-fires N seconds after SOS is confirmed
 *               (configurable, disabled by default).
 *
 * Design principles:
 *   • Purely additive — no existing SOS flow is modified.
 *   • Uses Web Audio API (AudioContext + OscillatorNode) for the tone.
 *   • Alternates between two frequencies (750 Hz ↔ 1500 Hz) every 0.5s
 *     to create an attention-grabbing "European siren" effect.
 *   • Sets device volume to max via Capacitor if available.
 *   • All tiers get this feature — it's a universal safety tool.
 *   • Automatically stops after MAX_DURATION_SEC to preserve battery.
 *
 * NOTE: On some Android devices the OS may limit maximum volume for
 * headphone output, but speaker output should be unrestricted.
 */

// ── Configuration ───────────────────────────────────────────
const FREQ_LOW           = 750;        // Hz — lower tone
const FREQ_HIGH          = 1500;       // Hz — upper tone
const ALTERNATE_INTERVAL = 500;        // ms — switch frequency every 0.5s
// E-H4: raised safety cap; end-SOS should call stopSiren() explicitly
const MAX_DURATION_SEC   = 30 * 60;    // 30 minutes — safety-only auto-stop
const STORAGE_KEY        = "sosphere_panic_siren";

// ── Types ───────────────────────────────────────────────────
interface SirenConfig {
  /** Whether the siren feature is enabled (user toggle). Default: true */
  enabled: boolean;
  /** Auto-trigger N seconds after SOS confirm. 0 = manual only. */
  autoTriggerDelaySec: number;
}

type SirenState = "idle" | "active" | "stopping";

// ── State ───────────────────────────────────────────────────
let _state: SirenState = "idle";
let _audioCtx: AudioContext | null = null;
let _oscillator: OscillatorNode | null = null;
let _gainNode: GainNode | null = null;
let _alternateTimer: ReturnType<typeof setInterval> | null = null;
let _autoStopTimer: ReturnType<typeof setTimeout> | null = null;
let _currentFreqHigh = false;
let _listeners: Set<(state: SirenState) => void> = new Set();
let _autoTriggerTimer: ReturnType<typeof setTimeout> | null = null;

// ── Storage helpers ─────────────────────────────────────────
function getConfig(): SirenConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { enabled: true, autoTriggerDelaySec: 0 };
}

function setConfig(patch: Partial<SirenConfig>): void {
  try {
    const current = getConfig();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {}
}

// ── Notify listeners ────────────────────────────────────────
function notify(): void {
  _listeners.forEach(cb => {
    try { cb(_state); } catch {}
  });
}

// ── Volume maximizer (Capacitor native) ─────────────────────
async function setMaxVolume(): Promise<void> {
  // Try Capacitor plugin if available
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      // Use JavaScript bridge to set Android media volume to max
      const w = window as any;
      if (w.Android?.setMaxVolume) {
        w.Android.setMaxVolume();
        console.info("[PanicSiren] Volume set to max via native bridge.");
        return;
      }
    }
  } catch {}

  // Web fallback: no direct volume control, but AudioContext gain is at max
  console.info("[PanicSiren] No native volume control — using max gain.");
}

// ── Core: Start siren ───────────────────────────────────────
/**
 * Start the panic siren. Safe to call multiple times (idempotent).
 * Returns true if siren started successfully.
 */
export async function startSiren(): Promise<boolean> {
  if (_state === "active") return true; // Already running

  const config = getConfig();
  if (!config.enabled) {
    console.info("[PanicSiren] Feature disabled by user.");
    return false;
  }

  try {
    // Set volume to max
    await setMaxVolume();

    // Create audio context
    _audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

    // Create gain node (full volume)
    _gainNode = _audioCtx.createGain();
    _gainNode.gain.value = 1.0;
    _gainNode.connect(_audioCtx.destination);

    // Create oscillator
    _oscillator = _audioCtx.createOscillator();
    _oscillator.type = "square"; // Square wave = loudest/most piercing
    _oscillator.frequency.value = FREQ_LOW;
    _oscillator.connect(_gainNode);
    _oscillator.start();

    _currentFreqHigh = false;
    _state = "active";
    notify();

    // Alternate frequencies for siren effect
    _alternateTimer = setInterval(() => {
      if (_oscillator) {
        _currentFreqHigh = !_currentFreqHigh;
        _oscillator.frequency.value = _currentFreqHigh ? FREQ_HIGH : FREQ_LOW;
      }
    }, ALTERNATE_INTERVAL);

    // E-H4: 60s warning before the safety cap trips
    if (MAX_DURATION_SEC > 60) {
      setTimeout(() => {
        if (_state === "active") {
          console.warn(
            "[PanicSiren] safety cap will trigger in 60s — call stopSiren() explicitly to extend"
          );
        }
      }, (MAX_DURATION_SEC - 60) * 1000);
    }

    // Auto-stop after MAX_DURATION_SEC
    _autoStopTimer = setTimeout(() => {
      console.info("[PanicSiren] Auto-stop after max duration.");
      stopSiren();
    }, MAX_DURATION_SEC * 1000);

    console.info("[PanicSiren] SIREN ACTIVE — alternating 750Hz/1500Hz.");
    return true;
  } catch (err: any) {
    console.error("[PanicSiren] Failed to start:", err.message || err);
    _state = "idle";
    notify();
    return false;
  }
}

/**
 * Stop the panic siren.
 */
export function stopSiren(): void {
  if (_state === "idle") return;

  _state = "stopping";
  notify();

  // Clear timers
  if (_alternateTimer) { clearInterval(_alternateTimer); _alternateTimer = null; }
  if (_autoStopTimer) { clearTimeout(_autoStopTimer); _autoStopTimer = null; }
  if (_autoTriggerTimer) { clearTimeout(_autoTriggerTimer); _autoTriggerTimer = null; }

  // Stop audio
  if (_oscillator) {
    try { _oscillator.stop(); } catch {}
    try { _oscillator.disconnect(); } catch {}
    _oscillator = null;
  }
  if (_gainNode) {
    try { _gainNode.disconnect(); } catch {}
    _gainNode = null;
  }
  if (_audioCtx) {
    try { _audioCtx.close(); } catch {}
    _audioCtx = null;
  }

  _state = "idle";
  notify();
  console.info("[PanicSiren] Siren stopped.");
}

/**
 * Toggle siren on/off. Returns the new state.
 */
export async function toggleSiren(): Promise<SirenState> {
  if (_state === "active") {
    stopSiren();
    return "idle";
  }
  await startSiren();
  return _state;
}

// ── Auto-trigger integration (called from SOS flow) ─────────

/**
 * Called when SOS is confirmed. If autoTriggerDelaySec > 0,
 * schedules the siren to start after the delay.
 */
export function onSOSConfirmed(): void {
  const config = getConfig();
  if (!config.enabled || config.autoTriggerDelaySec <= 0) return;

  // Cancel any previous auto-trigger
  if (_autoTriggerTimer) { clearTimeout(_autoTriggerTimer); }

  _autoTriggerTimer = setTimeout(() => {
    console.info("[PanicSiren] Auto-trigger after SOS confirmation.");
    startSiren();
  }, config.autoTriggerDelaySec * 1000);
}

/**
 * Called when SOS is cancelled or ended. Stops the siren and
 * cancels any pending auto-trigger.
 */
export function onSOSEnded(): void {
  if (_autoTriggerTimer) { clearTimeout(_autoTriggerTimer); _autoTriggerTimer = null; }
  stopSiren();
}

// ── Settings API ────────────────────────────────────────────

/**
 * Enable or disable the siren feature.
 */
export function setSirenEnabled(enabled: boolean): void {
  setConfig({ enabled });
  if (!enabled) stopSiren();
  console.info(`[PanicSiren] ${enabled ? "Enabled" : "Disabled"} by user.`);
}

/**
 * Set the auto-trigger delay (0 = manual only).
 */
export function setAutoTriggerDelay(seconds: number): void {
  setConfig({ autoTriggerDelaySec: Math.max(0, Math.floor(seconds)) });
}

/**

/**
 * Get current siren config (read-only snapshot).
 */
export function getSirenConfig(): SirenConfig {
  return { ...getConfig() };
}

export function getSirenState(): SirenState {
  return _state;
}

export function isSirenActive(): boolean {
  return _state === "active";
}

export function subscribeSiren(cb: (state: SirenState) => void): () => void {
  _listeners.add(cb);
  cb(_state);
  return () => _listeners.delete(cb);
}
