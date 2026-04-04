import { useEffect, useRef, useCallback } from "react";

interface UseShakeOptions {
  threshold?: number;     // acceleration threshold (m/s²) — default 18
  minShakes?: number;     // how many spikes needed — default 3
  resetMs?: number;       // window to count shakes — default 1200ms
  cooldownMs?: number;    // cooldown after trigger — default 5000ms
  enabled?: boolean;
}

/**
 * Detects a rapid "shake" gesture via DeviceMotionEvent.
 * Works in mobile browsers (requires HTTPS or localhost).
 * Falls back silently on desktop.
 */
export function useShake(
  onShake: () => void,
  options: UseShakeOptions = {}
) {
  const {
    threshold = 18,
    minShakes = 3,
    resetMs = 1200,
    cooldownMs = 5000,
    enabled = true,
  } = options;

  const shakesRef = useRef(0);
  const lastShakeRef = useRef(0);
  const cooldownRef = useRef(false);
  const lastAccelRef = useRef({ x: 0, y: 0, z: 0 });
  const onShakeRef = useRef(onShake);
  onShakeRef.current = onShake;

  const handleMotion = useCallback(
    (e: DeviceMotionEvent) => {
      if (!enabled || cooldownRef.current) return;

      const acc = e.accelerationIncludingGravity;
      if (!acc || acc.x == null || acc.y == null || acc.z == null) return;

      const dx = Math.abs(acc.x - lastAccelRef.current.x);
      const dy = Math.abs(acc.y - lastAccelRef.current.y);
      const dz = Math.abs(acc.z - lastAccelRef.current.z);

      lastAccelRef.current = { x: acc.x, y: acc.y, z: acc.z };

      const magnitude = Math.max(dx, dy, dz);

      if (magnitude > threshold) {
        const now = Date.now();

        // Reset counter if window expired
        if (now - lastShakeRef.current > resetMs) {
          shakesRef.current = 0;
        }

        shakesRef.current += 1;
        lastShakeRef.current = now;

        if (shakesRef.current >= minShakes) {
          shakesRef.current = 0;
          cooldownRef.current = true;
          setTimeout(() => { cooldownRef.current = false; }, cooldownMs);
          onShakeRef.current();
        }
      }
    },
    [enabled, threshold, minShakes, resetMs, cooldownMs]
  );

  useEffect(() => {
    if (!enabled) return;

    // iOS 13+ requires permission request
    const requestAndListen = async () => {
      try {
        // @ts-ignore – iOS specific API
        if (typeof DeviceMotionEvent?.requestPermission === "function") {
          // @ts-ignore
          const perm = await DeviceMotionEvent.requestPermission();
          if (perm !== "granted") return;
        }
        window.addEventListener("devicemotion", handleMotion, { passive: true });
      } catch {
        // Permission denied or desktop — silent fail
      }
    };

    requestAndListen();
    return () => {
      window.removeEventListener("devicemotion", handleMotion);
    };
  }, [enabled, handleMotion]);

  /** Call this from a user-gesture (button tap) to request iOS permission */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      // @ts-ignore
      if (typeof DeviceMotionEvent?.requestPermission === "function") {
        // @ts-ignore
        const perm = await DeviceMotionEvent.requestPermission();
        return perm === "granted";
      }
      return true; // Android / desktop — always granted
    } catch {
      return false;
    }
  }, []);

  return { requestPermission };
}
