/**
 * Capacitor Bridge — Native platform integration
 *
 * Provides graceful abstraction for Capacitor plugins with fallbacks for web.
 * All methods are safe to call in web context and will no-op appropriately.
 */

// ═══════════════════════════════════════════════════════════════════════════
// PLATFORM DETECTION
// ═══════════════════════════════════════════════════════════════════════════

export type NativePlatform = 'ios' | 'android' | 'web';

/**
 * Detects if running inside Capacitor runtime
 */
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;

  // Check for Capacitor global
  if ((window as any).Capacitor !== undefined) {
    return true;
  }

  // Fallback: check user agent for common native indicators
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('sosphere/') || ua.includes('capacitor');
}

/**
 * Returns the native platform or 'web' if running in browser
 */
export function getNativePlatform(): NativePlatform {
  if (!isNativeApp()) {
    return 'web';
  }

  const capacitor = (window as any).Capacitor;
  if (!capacitor) return 'web';

  const platform = capacitor.getPlatform?.();
  if (platform === 'ios') return 'ios';
  if (platform === 'android') return 'android';

  return 'web';
}

// ═══════════════════════════════════════════════════════════════════════════
// PERMISSION HANDLING
// ═══════════════════════════════════════════════════════════════════════════

export type PermissionType = 'camera' | 'location' | 'microphone' | 'notifications';

export interface PermissionResult {
  permission: PermissionType;
  granted: boolean;
  error?: string;
}

/**
 * Request native permissions from the OS
 *
 * @param permission - Type of permission to request
 * @returns Promise resolving to permission status
 *
 * @example
 * const result = await requestNativePermissions('location');
 * if (result.granted) {
 *   // Use location services
 * }
 */
export async function requestNativePermissions(
  permission: PermissionType
): Promise<PermissionResult> {
  // O-H5: actual permission requests via Capacitor plugins (best-effort;
  // if plugin missing, return accurate error rather than a false "granted").
  if (permission === 'location') {
    try {
      const mod: any = await import('@capacitor/geolocation').catch(() => null);
      if (mod?.Geolocation?.requestPermissions) {
        const res = await mod.Geolocation.requestPermissions();
        return {
          permission,
          granted: res?.location === 'granted' || res?.coarseLocation === 'granted',
        };
      }
    } catch (e) { /* fall through to web branch */ }
  }

  if (permission === 'notifications') {
    try {
      const mod: any = await import('@capacitor/push-notifications').catch(() => null);
      if (mod?.PushNotifications?.requestPermissions) {
        const res = await mod.PushNotifications.requestPermissions();
        return { permission, granted: res?.receive === 'granted' };
      }
    } catch {}
    // Web fallback: actual Notification.requestPermission.
    try {
      if (typeof Notification !== 'undefined') {
        const res = await Notification.requestPermission();
        return { permission, granted: res === 'granted' };
      }
    } catch {}
  }

  if (permission === 'camera') {
    try {
      const mod: any = await import('@capacitor/camera').catch(() => null);
      if (mod?.Camera?.requestPermissions) {
        const res = await mod.Camera.requestPermissions();
        return {
          permission,
          granted: res?.camera === 'granted' || res?.photos === 'granted',
        };
      }
    } catch {}
  }

  if (permission === 'microphone') {
    // No Capacitor mic plugin in this stack — fall back to getUserMedia.
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Immediately stop tracks — this was just a permission probe.
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
        return { permission, granted: true };
      }
    } catch {
      return { permission, granted: false, error: 'denied_or_unavailable' };
    }
  }

  // Default: plugin unavailable — do NOT return granted:true unconditionally.
  return {
    permission,
    granted: false,
    error: 'plugin_unavailable',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS BAR STYLING
// ═══════════════════════════════════════════════════════════════════════════

export type StatusBarStyle = 'light' | 'dark';

/**
 * Set status bar color style (iOS & Android)
 *
 * @param style - 'light' for dark background apps, 'dark' for light apps
 *
 * @example
 * setStatusBarStyle('light'); // white text on dark background
 */
export async function setStatusBarStyle(style: StatusBarStyle): Promise<void> {
  if (!isNativeApp()) {
    // Web: update meta theme-color as best-effort
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', style === 'light' ? '#05070E' : '#FFFFFF');
    }
    return;
  }

  // CRIT-#22 (2026-04-27): @capacitor/status-bar IS installed (see
  // package.json line 23). Dynamic import keeps the plugin code out
  // of the web bundle and falls back gracefully if the plugin is
  // missing at runtime (e.g. native build forgot to register it).
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    const isDark = style === 'dark';
    await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
    // SOSphere brand background — keep status bar in sync with the app shell.
    await StatusBar.setBackgroundColor({ color: '#05070E' });
    console.info(`[Capacitor] StatusBar style set to ${style}`);
  } catch (err) {
    // Plugin not installed / not registered on this build — non-fatal.
    console.warn('[Capacitor] StatusBar setStyle skipped:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// KEEP AWAKE — Prevent screen from locking during SOS
// ═══════════════════════════════════════════════════════════════════════════

let keepAwakeActive = false;

/**
 * Keep device screen awake (prevents auto-lock)
 *
 * Useful during active SOS situations to ensure device stays on
 * and responder can see screen.
 *
 * @example
 * // During SOS incident
 * await enableKeepAwake();
 * // ... incident handling ...
 * await disableKeepAwake();
 */
export async function enableKeepAwake(): Promise<void> {
  if (keepAwakeActive) return;

  if (!isNativeApp()) {
    // Web: use Screen Wake Lock API if available
    try {
      if ('wakeLock' in navigator) {
        await (navigator as any).wakeLock.request('screen');
        console.info('[KeepAwake] Web Screen Wake Lock enabled');
      }
    } catch (err) {
      console.warn('[KeepAwake] Wake Lock not supported:', err);
    }
    return;
  }

  // CRIT-#22 (2026-04-27, fix-2 2026-04-28): @capacitor-community/keep-awake
  // is NOT in package.json yet — bundling the import (even with vite-ignore hint)
  // breaks the Vercel Rollup build because Rollup statically analyses the path.
  // We use the Capacitor runtime plugin REGISTRY instead (window.Capacitor.Plugins),
  // which is populated by the native shell at boot. No bundle-time dep, no import.
  // To activate the real plugin (one-time):
  //   npm install @capacitor-community/keep-awake
  //   npx cap sync
  // After install, Capacitor.Plugins.KeepAwake will be defined natively and
  // the call below works. Until then it silently no-ops on native (web Wake
  // Lock already handled above).
  try {
    const cap: any = (typeof window !== "undefined") ? (window as any).Capacitor : null;
    const KeepAwake = cap?.Plugins?.KeepAwake;
    if (!KeepAwake) {
      console.warn('[Capacitor] KeepAwake plugin missing — `npm i @capacitor-community/keep-awake` to enable');
      return;
    }
    await KeepAwake.keepAwake();
    keepAwakeActive = true;
    console.info('[Capacitor] Keep Awake enabled');
  } catch (err) {
    console.error('[Capacitor] Failed to enable keep awake:', err);
  }
}

/**
 * Allow device screen to lock normally
 */
export async function disableKeepAwake(): Promise<void> {
  if (!keepAwakeActive) return;

  if (!isNativeApp()) {
    // Web: release wake lock if held
    try {
      // No explicit release needed; lock is released when tab loses focus
      console.info('[KeepAwake] Web Wake Lock released');
    } catch (err) {
      console.warn('[KeepAwake] Error releasing wake lock:', err);
    }
    return;
  }

  // CRIT-#22 (fix-2): matching disable via runtime registry — see enableKeepAwake.
  try {
    const cap: any = (typeof window !== "undefined") ? (window as any).Capacitor : null;
    const KeepAwake = cap?.Plugins?.KeepAwake;
    if (!KeepAwake) {
      keepAwakeActive = false;
      return;
    }
    await KeepAwake.allowSleep();
    keepAwakeActive = false;
    console.info('[Capacitor] Keep Awake disabled');
  } catch (err) {
    console.error('[Capacitor] Failed to disable keep awake:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HAPTIC FEEDBACK
// ═══════════════════════════════════════════════════════════════════════════

export type HapticFeedbackType = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

/**
 * Trigger haptic feedback on device (iOS Haptic Engine, Android Vibration)
 *
 * Provides tactile feedback for critical actions (SOS activation, warnings, etc.)
 * No-op on web or if haptics not available.
 *
 * @param type - Type of haptic feedback
 *
 * @example
 * // On SOS activation
 * await triggerHapticFeedback('warning');
 *
 * @example
 * // On successful confirmation
 * await triggerHapticFeedback('success');
 */
export async function triggerHapticFeedback(type: HapticFeedbackType): Promise<void> {
  if (!isNativeApp()) {
    // Web: use Vibration API as fallback (limited browsers support)
    try {
      if ('vibrate' in navigator) {
        // Pattern: [delay, vibrate, delay, vibrate, ...]
        const patterns: Record<HapticFeedbackType, number | number[]> = {
          light: 10,
          medium: 20,
          heavy: 30,
          success: [10, 20, 10],
          warning: [50, 30, 50],
          error: [100, 50, 100],
        };

        navigator.vibrate(patterns[type]);
      }
    } catch (err) {
      console.debug('[Haptics] Vibration API not available');
    }
    return;
  }

  // CRIT-#22 (2026-04-27): @capacitor/haptics IS installed (package.json
  // line 21). Map our app-level types to the plugin's two surfaces:
  //   • impact()       — physical button press feedback (light/medium/heavy)
  //   • notification() — outcome feedback (success/warning/error)
  try {
    const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
    if (type === 'success' || type === 'warning' || type === 'error') {
      const notifMap = {
        success: NotificationType.Success,
        warning: NotificationType.Warning,
        error:   NotificationType.Error,
      } as const;
      await Haptics.notification({ type: notifMap[type] });
    } else {
      const impactMap = {
        light:  ImpactStyle.Light,
        medium: ImpactStyle.Medium,
        heavy:  ImpactStyle.Heavy,
      } as const;
      await Haptics.impact({ style: impactMap[type] });
    }
    console.debug(`[Capacitor] Haptic feedback triggered: ${type}`);
  } catch (err) {
    // Plugin not installed / not registered on this build — non-fatal.
    console.debug('[Capacitor] Haptics skipped:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Initialize Capacitor bridge on app startup
 *
 * Should be called once during app initialization (in main.tsx or App.tsx)
 */
export function initCapacitorBridge(): void {
  if (!isNativeApp()) {
    console.info('[Capacitor] Running as web app');
    return;
  }

  const platform = getNativePlatform();
  console.info(`[Capacitor] Initialized for ${platform}`);

  // Apply platform-specific body class for CSS hooks
  document.documentElement.classList.add(`native-${platform}`);

  // Set initial status bar style
  setStatusBarStyle('light').catch(err =>
    console.warn('[Capacitor] Failed to set initial status bar:', err)
  );

  // Splash screen handled by index.html boot screen (no plugin needed)
}

/**
 * Cleanup on app shutdown (if needed)
 */
export function cleanupCapacitorBridge(): void {
  disableKeepAwake().catch(err =>
    console.warn('[Capacitor] Error during cleanup:', err)
  );
}
