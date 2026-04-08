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
  // Web context: no-op, return granted
  if (!isNativeApp()) {
    return {
      permission,
      granted: true, // Browser APIs have implicit permission
    };
  }

  const platform = getNativePlatform();

  try {
    // TODO: Install @capacitor/camera, @capacitor/geolocation, @capacitor/device
    // This is a stub that should be replaced with actual plugin calls

    const capacitor = (window as any).Capacitor;
    if (!capacitor) {
      return { permission, granted: false, error: 'Capacitor not available' };
    }

    // Placeholder implementation
    console.info(`[Capacitor] Requesting ${permission} permission on ${platform}`);

    // In production, this would invoke the appropriate plugin:
    // - Camera: capacitor.plugins.Camera.checkPermissions()
    // - Geolocation: capacitor.plugins.Geolocation.requestPermissions()
    // - Microphone: requires custom implementation

    return {
      permission,
      granted: true,
      error: undefined,
    };
  } catch (err) {
    console.error(`[Capacitor] Permission request failed for ${permission}:`, err);
    return {
      permission,
      granted: false,
      error: String(err),
    };
  }
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

  try {
    // TODO: Install @capacitor/status-bar
    const capacitor = (window as any).Capacitor;
    if (!capacitor?.plugins?.StatusBar) {
      console.warn('[Capacitor] StatusBar plugin not available');
      return;
    }

    const isDark = style === 'dark';

    // Placeholder: would be:
    // await capacitor.plugins.StatusBar.setStyle({ style: isDark ? 'DARK' : 'LIGHT' });
    // await capacitor.plugins.StatusBar.setBackgroundColor({ color: '#05070E' });

    console.info(`[Capacitor] StatusBar style set to ${style}`);
  } catch (err) {
    console.error('[Capacitor] Failed to set status bar style:', err);
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

  try {
    // TODO: Install @capacitor-community/keep-awake
    const capacitor = (window as any).Capacitor;
    if (!capacitor?.plugins?.KeepAwake) {
      console.warn('[Capacitor] KeepAwake plugin not available');
      return;
    }

    // Placeholder: would be:
    // await capacitor.plugins.KeepAwake.keepAwake();

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

  try {
    // TODO: Install @capacitor-community/keep-awake
    const capacitor = (window as any).Capacitor;
    if (!capacitor?.plugins?.KeepAwake) {
      console.warn('[Capacitor] KeepAwake plugin not available');
      return;
    }

    // Placeholder: would be:
    // await capacitor.plugins.KeepAwake.allowScreenToTurnOff();

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

  try {
    // TODO: Install @capacitor/haptics
    const capacitor = (window as any).Capacitor;
    if (!capacitor?.plugins?.Haptics) {
      console.debug('[Capacitor] Haptics plugin not available');
      return;
    }

    // Placeholder: would be:
    // const styleMap = {
    //   light: 'ImpactMedium',
    //   medium: 'ImpactHeavy',
    //   heavy: 'ImpactHeavy',
    //   success: 'NotificationSuccess',
    //   warning: 'NotificationWarning',
    //   error: 'NotificationError',
    // };
    // await capacitor.plugins.Haptics.impact({ style: styleMap[type] });

    console.debug(`[Capacitor] Haptic feedback triggered: ${type}`);
  } catch (err) {
    console.error('[Capacitor] Failed to trigger haptic feedback:', err);
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
}

/**
 * Cleanup on app shutdown (if needed)
 */
export function cleanupCapacitorBridge(): void {
  disableKeepAwake().catch(err =>
    console.warn('[Capacitor] Error during cleanup:', err)
  );
}
