// ═══════════════════════════════════════════════════════════════
// SOSphere — Haptic & Sound Feedback Utility
// ─────────────────────────────────────────────────────────────
// Provides vibration + audio feedback on mobile
// Falls back gracefully on unsupported devices
// ═══════════════════════════════════════════════════════════════

type HapticPattern = "success" | "warning" | "error" | "light" | "medium" | "heavy" | "sos" | "ireAlert" | "rrpAlarm" | "rrpAction" | "rrpComplete" | "rrpEscalate";

const VIBRATION_PATTERNS: Record<HapticPattern, number[]> = {
  light:   [10],
  medium:  [25],
  heavy:   [50],
  success: [10, 50, 15],
  warning: [30, 30, 30],
  error:   [50, 50, 50, 50, 50],
  sos:     [100, 50, 100, 50, 100, 200, 300, 50, 300, 50, 300, 200, 100, 50, 100, 50, 100],
  ireAlert: [40, 60, 40, 60, 80, 100, 80],
  rrpAlarm: [80, 40, 80, 40, 120, 60, 120],        // Rapid double-pulse: urgent, militaristic
  rrpAction: [20, 30, 40],                           // Quick confirmation burst
  rrpComplete: [15, 40, 15, 40, 20, 80, 30],       // Victory cascade
  rrpEscalate: [100, 30, 100, 30, 100, 30, 200],   // Escalation alarm
};

// Audio Context singleton
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

// Simple beep using Web Audio API
function playBeep(frequency: number = 880, duration: number = 100, volume: number = 0.15) {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
    oscillator.type = "sine";
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration / 1000);
  } catch {
    // Silently fail
  }
}

const SOUND_PRESETS: Record<HapticPattern, () => void> = {
  light:   () => playBeep(1200, 60, 0.08),
  medium:  () => playBeep(880, 100, 0.12),
  heavy:   () => playBeep(660, 150, 0.15),
  success: () => {
    playBeep(880, 80, 0.1);
    setTimeout(() => playBeep(1100, 120, 0.12), 100);
  },
  warning: () => {
    playBeep(660, 120, 0.12);
    setTimeout(() => playBeep(660, 120, 0.12), 200);
  },
  error:   () => {
    playBeep(440, 150, 0.15);
    setTimeout(() => playBeep(330, 200, 0.15), 200);
  },
  sos:     () => {
    playBeep(880, 100, 0.2);
    setTimeout(() => playBeep(880, 100, 0.2), 150);
    setTimeout(() => playBeep(880, 100, 0.2), 300);
  },
  ireAlert: () => {
    // 3-tone ascending chime: urgent but not alarming
    playBeep(523, 100, 0.12);              // C5
    setTimeout(() => playBeep(659, 100, 0.14), 130);   // E5
    setTimeout(() => playBeep(784, 150, 0.16), 260);   // G5
    // Subtle low hum fade after the chime
    setTimeout(() => playBeep(392, 300, 0.06), 440);   // G4 soft
  },
  rrpAlarm: () => {
    // RAPID ALARM: Descending tritone siren — militaristic urgency
    // F5→B4 tritone (diabolus in musica) = maximum alertness
    playBeep(698, 60, 0.22);              // F5
    setTimeout(() => playBeep(494, 60, 0.22), 90);   // B4
    setTimeout(() => playBeep(698, 60, 0.22), 180);  // F5
    setTimeout(() => playBeep(494, 60, 0.22), 270);  // B4
    // Final sustained low warning
    setTimeout(() => playBeep(349, 200, 0.18), 370);  // F4 low growl
  },
  rrpAction: () => {
    // TACTICAL CONFIRM: Sharp staccato double-tap at high freq
    playBeep(1568, 25, 0.16);            // G6 — crisp
    setTimeout(() => playBeep(2093, 35, 0.14), 50);  // C7 — bright snap
  },
  rrpComplete: () => {
    // MISSION COMPLETE: Rising major 7th cascade
    playBeep(523, 70, 0.12);             // C5
    setTimeout(() => playBeep(659, 70, 0.13), 90);   // E5
    setTimeout(() => playBeep(784, 70, 0.14), 180);  // G5
    setTimeout(() => playBeep(988, 120, 0.16), 270);  // B5 — major 7th resolve
    setTimeout(() => playBeep(1047, 200, 0.12), 420); // C6 — octave finish
  },
  rrpEscalate: () => {
    // ESCALATION WARNING: Rapid ascending chromatic + held top note
    playBeep(440, 50, 0.18);             // A4
    setTimeout(() => playBeep(523, 50, 0.19), 70);   // C5
    setTimeout(() => playBeep(622, 50, 0.20), 140);  // Eb5
    setTimeout(() => playBeep(740, 50, 0.21), 210);  // F#5
    setTimeout(() => playBeep(880, 300, 0.22), 280);  // A5 — held alarm
  },
};

/**
 * Trigger haptic feedback (vibration + optional sound)
 */
export function haptic(pattern: HapticPattern = "light", withSound: boolean = true) {
  // Vibration API
  if (navigator.vibrate) {
    try {
      navigator.vibrate(VIBRATION_PATTERNS[pattern]);
    } catch {
      // Silently fail
    }
  }

  // Sound
  if (withSound) {
    SOUND_PRESETS[pattern]?.();
  }
}

/**
 * Quick presets for common actions
 */
export const hapticSuccess = () => haptic("success");
export const hapticWarning = () => haptic("warning");
export const hapticError   = () => haptic("error");
export const hapticLight   = () => haptic("light");
export const hapticMedium  = () => haptic("medium");
export const hapticHeavy   = () => haptic("heavy");
export const hapticSOS     = () => haptic("sos");

/**
 * IRE Auto-Guide alert — distinctive 3-tone ascending chime
 * Used when the auto-guide prompt appears after admin inactivity
 */
export const hapticIreAlert = () => haptic("ireAlert");

/**
 * RRP (Rapid Response Protocol) — 4 distinct audio signatures:
 * - rrpAlarm:    Tritone siren when RRP opens (F5→B4, militaristic)
 * - rrpAction:   Sharp staccato when an action is completed (G6→C7)
 * - rrpComplete: Major 7th cascade when all actions done (C5→C6)
 * - rrpEscalate: Chromatic ascending alarm on auto-escalation (A4→A5)
 */
export const hapticRrpAlarm    = () => haptic("rrpAlarm");
export const hapticRrpAction   = () => haptic("rrpAction");
export const hapticRrpComplete = () => haptic("rrpComplete");
export const hapticRrpEscalate = () => haptic("rrpEscalate");

/**
 * Play a standalone sound without vibration — useful for UI ambient cues
 */
export function playUISound(type: "scan" | "phaseComplete" | "actionDone" | "chatOpen" | "guideHint" | "guideOpen" | "guideAction") {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    switch (type) {
      case "scan":
        // Low-frequency radar pulse
        playBeep(220, 400, 0.06);
        break;
      case "phaseComplete":
        // Quick success ding-ding
        playBeep(880, 60, 0.1);
        setTimeout(() => playBeep(1320, 100, 0.12), 80);
        break;
      case "actionDone":
        // Soft click
        playBeep(1400, 30, 0.08);
        break;
      case "chatOpen":
        // Message-in bubble pop
        playBeep(600, 60, 0.1);
        setTimeout(() => playBeep(900, 80, 0.08), 70);
        break;
      case "guideHint":
        // Subtle ambient tick — plays when rotating hints during SOS
        playBeep(1200, 20, 0.03);
        break;
      case "guideOpen":
        // Gentle ascending chime — opens Guide Me panel
        playBeep(523, 80, 0.06);
        setTimeout(() => playBeep(659, 80, 0.07), 90);
        setTimeout(() => playBeep(784, 100, 0.08), 180);
        break;
      case "guideAction":
        // Crisp confirmation tap — when an action is selected
        playBeep(880, 40, 0.07);
        setTimeout(() => playBeep(1100, 50, 0.06), 50);
        break;
    }
  } catch {
    // Silently fail
  }
}