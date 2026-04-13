// ═══════════════════════════════════════════════════════════════
// SOSphere — Spring Physics Presets (Apple Enterprise Grade)
// ─────────────────────────────────────────────────────────────
// Centralized spring animation configurations for modals, dialogs,
// and UI components. Provides Apple-like smooth, bouncy animations
// with consistent physics across the entire application.
// ═══════════════════════════════════════════════════════════════

import { Variants } from "motion/react";

// ─────────────────────────────────────────────────────────────
// Spring Physics Presets
// ─────────────────────────────────────────────────────────────
export const springPresets = {
  // Modal entry — bouncy but controlled (like iOS sheet presentation)
  modalEntry: { type: "spring" as const, stiffness: 400, damping: 30, mass: 1 },

  // Gentle sheet slide
  sheetSlide: { type: "spring" as const, stiffness: 300, damping: 35, mass: 0.8 },

  // Snappy button press
  buttonPress: { type: "spring" as const, stiffness: 500, damping: 25, mass: 0.5 },

  // Smooth page transition
  pageTransition: { type: "spring" as const, stiffness: 200, damping: 25, mass: 1 },

  // Quick tooltip/popover
  popover: { type: "spring" as const, stiffness: 600, damping: 35, mass: 0.5 },

  // Card hover lift
  cardHover: { type: "spring" as const, stiffness: 400, damping: 20, mass: 0.8 },

  // Overlay backdrop fade
  backdrop: { type: "spring" as const, stiffness: 200, damping: 30, mass: 1 },

  // Drawer/sidebar slide
  drawer: { type: "spring" as const, stiffness: 350, damping: 25, mass: 0.9 },
};

// ─────────────────────────────────────────────────────────────
// Reusable Animation Variants
// ─────────────────────────────────────────────────────────────

export const modalVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, y: 5 },
};

export const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

export const slideUpVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 10 },
};

export const slideRightVariants: Variants = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -10 },
};

export const slideLeftVariants: Variants = {
  hidden: { opacity: 0, x: 20 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 10 },
};

export const slideDownVariants: Variants = {
  hidden: { opacity: 0, y: -20 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
};

export const scaleInVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.9 },
};

export const popoverVariants: Variants = {
  hidden: { opacity: 0, scale: 0.85, y: -10 },
  visible: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.85, y: -10 },
};

// Content fade variants for state transitions
export const contentFadeVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
};

// ─────────────────────────────────────────────────────────────
// Dev logging utility
// ─────────────────────────────────────────────────────────────
if (import.meta.env.DEV) {
  console.debug("[SpringPresets] Spring presets and variants loaded.");
}
