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

/**
 * R-66 (MOBILE_AUDIT_FINDINGS / language UX, 2026-05-19): auto-detect
 * language from device locale instead of blocking the user with a
 * picker on first launch. This matches the universal pattern used by
 * WhatsApp, Telegram, Uber, Netflix and is what Apple HIG and Google
 * Material Design recommend. The picker still exists in Settings →
 * Language for the user who wants to override.
 *
 * Detection rules (highest trust first):
 *   1. localStorage[sosphere_lang]  — explicit user choice (Settings)
 *   2. navigator.language           — device OS / browser locale
 *      starts with "ar"  → Arabic
 *      starts with "en"  → English
 *   3. DEFAULT_LANG = "ar"          — Saudi market default
 */
function detectLangFromDevice(): Lang {
  if (typeof navigator === "undefined") return DEFAULT_LANG;
  const raw = (navigator.language || navigator.languages?.[0] || "").toLowerCase();
  if (raw.startsWith("ar")) return "ar";
  if (raw.startsWith("en")) return "en";
  return DEFAULT_LANG;
}

function readLang(): Lang {
  try {
    const saved = typeof window !== "undefined"
      ? window.localStorage.getItem(STORAGE_KEY)
      : null;
    if (saved === "en" || saved === "ar") return saved;
    // R-66: no explicit choice yet → auto-detect from device locale.
    // We DO NOT persist this — only an explicit user choice (via
    // setLang() from Settings) gets written to storage. This keeps the
    // detection live: if the user switches device language at the OS
    // level, the next app launch picks up the change automatically.
    return detectLangFromDevice();
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
