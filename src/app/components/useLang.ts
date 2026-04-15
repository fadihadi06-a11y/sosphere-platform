// ═══════════════════════════════════════════════════════════════
// SOSphere — Mobile Language Hook (P2-#9)
// ─────────────────────────────────────────────────────────────
// Single source of truth for the mobile-side language (en / ar).
//
// Storage key: `sosphere_lang` — set by welcome-onboarding,
// employee-welcome, employee-quick-setup, and anything else that
// lets the user pick a language on the mobile surface.
//
// Why this file changed:
//   Before P2-#9, `useLang()` was not a real React hook — it read
//   localStorage once per render and returned a value. Components
//   mounted BEFORE the user picked a language stayed frozen on the
//   default ("ar") forever. Language changes in other tabs were
//   also invisible.
//
// Behaviour now:
//   • `useLang()` subscribes via useSyncExternalStore so every
//     mounted component re-renders when the language changes, no
//     matter which screen performed setLang().
//   • `setLang(l)` writes localStorage AND notifies subscribers in
//     the same tab (the browser's native `storage` event only fires
//     in OTHER tabs, not the tab that performed the write).
//   • Cross-tab sync still works via the `storage` event — useful
//     on web where an admin might have two tabs open.
// ═══════════════════════════════════════════════════════════════

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "sosphere_lang";
const DEFAULT_LANG: "ar" | "en" = "ar";
type Lang = "ar" | "en";

// In-tab listener set. The native `storage` event only fires in
// OTHER tabs, so we need our own pub/sub for same-tab updates.
const listeners = new Set<() => void>();

function readLang(): Lang {
  try {
    const saved = typeof window !== "undefined"
      ? window.localStorage.getItem(STORAGE_KEY)
      : null;
    return saved === "en" ? "en" : saved === "ar" ? "ar" : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // Cross-tab: listen for localStorage changes made in other tabs.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) listener();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }

  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

// Server render: always return the default. Avoids hydration mismatches
// when running in SSR / static-render contexts.
function getServerSnapshot(): Lang {
  return DEFAULT_LANG;
}

/**
 * React hook returning the current mobile language and whether it is
 * Arabic. Re-renders on every change, same tab or across tabs.
 */
export function useLang(): { lang: Lang; isAr: boolean } {
  const lang = useSyncExternalStore(subscribe, readLang, getServerSnapshot);
  return { lang, isAr: lang === "ar" };
}

/**
 * Imperatively set the mobile language. Persists to localStorage and
 * notifies all in-tab subscribers. Safe to call from anywhere, not
 * just React components.
 */
export function setLang(next: Lang): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  } catch {
    // Private-mode Safari / disk full — still notify in-memory so the
    // UI updates for the rest of the session.
  }
  // Snapshot listeners into an array before iterating: a listener
  // could unsubscribe itself during its own callback, which would
  // mutate the set mid-iteration.
  for (const l of Array.from(listeners)) {
    try { l(); } catch { /* listener errors never block propagation */ }
  }
}

/**
 * Read the current language outside of a React context. Prefer
 * `useLang()` inside components — this is for imperative code
 * (telemetry, service layers, etc.).
 */
export function getLang(): Lang {
  return readLang();
}
