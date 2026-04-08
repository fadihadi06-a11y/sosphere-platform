// ═══════════════════════════════════════════════════════════════
// SOSphere — Smooth View Transitions (Apple-grade Framer Motion)
// ─────────────────────────────────────────────────────────────
// Reusable animation wrapper components for premium SaaS feel
// All animations respect prefers-reduced-motion for accessibility
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useState, ReactNode } from "react";
import { motion, AnimatePresence, Variants } from "motion/react";
import { springPresets, modalVariants, backdropVariants, slideUpVariants, slideRightVariants, slideLeftVariants, slideDownVariants, scaleInVariants, popoverVariants, contentFadeVariants } from "./spring-presets";

// ─────────────────────────────────────────────────────────────
// Motion Configuration — Apple-grade easing curves
// ─────────────────────────────────────────────────────────────
export const motionConfig = {
  // Easing curves: [x1, y1, x2, y2] cubic-bezier format
  easeInOutCubic: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number],
  easeOutQuad: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number],
  easeInOutQuad: [0.455, 0.03, 0.515, 0.955] as [number, number, number, number],

  // Durations (in seconds)
  fast: 0.15,
  normal: 0.3,
  slow: 0.45,

  // Spring physics for smooth, natural motion
  spring: {
    type: "spring" as const,
    stiffness: 300,
    damping: 30,
  },

  // Stagger timing for card/list reveals
  staggerDelay: 0.05,
  listItemDelay: 0.03,
};

// ─────────────────────────────────────────────────────────────
// useReducedMotion Hook
// ─────────────────────────────────────────────────────────────
/**
 * Check if the user prefers reduced motion (accessibility)
 * Returns true if prefers-reduced-motion is enabled
 */
export function useReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(false);

  useEffect(() => {
    // Check current preference
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReduced(mediaQuery.matches);

    // Listen for changes
    const listener = (e: MediaQueryListEvent) => {
      setPrefersReduced(e.matches);
    };

    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, []);

  return prefersReduced;
}

// ─────────────────────────────────────────────────────────────
// PageTransition Component
// ─────────────────────────────────────────────────────────────
/**
 * Wraps dashboard pages/tabs with smooth enter/exit animations
 * - Enter: fade in + subtle slide up
 * - Exit: fade out
 * - Mode: "wait" for clean sequential transitions
 *
 * Usage:
 * <AnimatePresence mode="wait">
 *   <PageTransition key={currentPage}>
 *     <YourPageContent />
 *   </PageTransition>
 * </AnimatePresence>
 */
export function PageTransition({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{
        duration: motionConfig.normal,
        ease: motionConfig.easeInOutCubic,
        delay,
      }}
    >
      {children}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// CardReveal Component
// ─────────────────────────────────────────────────────────────
/**
 * Staggered reveal for card grids
 * Each card fades in with slight upward motion, staggered by delay
 *
 * Usage:
 * <CardReveal>
 *   {cards.map((card) => (
 *     <motion.div key={card.id} variants={cardVariant}>
 *       {card.content}
 *     </motion.div>
 *   ))}
 * </CardReveal>
 */
export function CardReveal({
  children,
  className = "",
  staggerDelay = motionConfig.staggerDelay,
}: {
  children: ReactNode;
  className?: string;
  staggerDelay?: number;
}) {
  const prefersReduced = useReducedMotion();

  const parentVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: staggerDelay,
        delayChildren: 0.1,
      },
    },
  };

  const cardVariants: Variants = {
    hidden: { opacity: 0, y: 12 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: motionConfig.normal,
        ease: motionConfig.easeInOutCubic,
      },
    },
  };

  if (prefersReduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      variants={parentVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Inject variants into children via React.Children */}
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child, {
            variants: cardVariants,
          } as any);
        }
        return child;
      })}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// SlidePanel Component
// ─────────────────────────────────────────────────────────────
/**
 * Sidebars and panels that slide in from edges
 *
 * Usage:
 * <SlidePanel direction="left">
 *   <PanelContent />
 * </SlidePanel>
 */
export function SlidePanel({
  children,
  direction = "left",
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  direction?: "left" | "right" | "top" | "bottom";
  className?: string;
  delay?: number;
}) {
  const prefersReduced = useReducedMotion();

  const initialPosition = {
    left: { x: -100, opacity: 0 },
    right: { x: 100, opacity: 0 },
    top: { y: -100, opacity: 0 },
    bottom: { y: 100, opacity: 0 },
  }[direction];

  if (prefersReduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={initialPosition}
      animate={{ x: 0, y: 0, opacity: 1 }}
      exit={initialPosition}
      transition={{
        type: "spring",
        stiffness: motionConfig.spring.stiffness,
        damping: motionConfig.spring.damping,
        delay,
      }}
    >
      {children}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// ScaleIn Component
// ─────────────────────────────────────────────────────────────
/**
 * Modals and popups that scale in with spring physics
 *
 * Usage:
 * <ScaleIn>
 *   <Modal />
 * </ScaleIn>
 */
export function ScaleIn({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.95, opacity: 0 }}
      transition={{
        type: "spring",
        stiffness: motionConfig.spring.stiffness,
        damping: motionConfig.spring.damping,
        delay,
      }}
    >
      {children}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// ListStagger Component
// ─────────────────────────────────────────────────────────────
/**
 * Table rows and list items with staggered fade-in
 *
 * Usage:
 * <ListStagger>
 *   {items.map((item) => (
 *     <motion.tr key={item.id} variants={listItemVariants}>
 *       ...
 *     </motion.tr>
 *   ))}
 * </ListStagger>
 */
export function ListStagger({
  children,
  className = "",
  itemDelay = motionConfig.listItemDelay,
}: {
  children: ReactNode;
  className?: string;
  itemDelay?: number;
}) {
  const prefersReduced = useReducedMotion();

  const parentVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: itemDelay,
        delayChildren: 0.05,
      },
    },
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, x: -8 },
    visible: {
      opacity: 1,
      x: 0,
      transition: {
        duration: motionConfig.normal,
        ease: motionConfig.easeInOutCubic,
      },
    },
  };

  if (prefersReduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      variants={parentVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Inject variants into children via React.Children */}
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child, {
            variants: itemVariants,
          } as any);
        }
        return child;
      })}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// Export variants for direct use with motion.div
// ─────────────────────────────────────────────────────────────

export const pageVariants: Variants = {
  enter: {
    opacity: 0,
    y: 12,
  },
  center: {
    opacity: 1,
    y: 0,
  },
  exit: {
    opacity: 0,
  },
};

export const cardVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * motionConfig.staggerDelay,
      duration: motionConfig.normal,
      ease: motionConfig.easeInOutCubic,
    },
  }),
};

export const listItemVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: {
      delay: i * motionConfig.listItemDelay,
      duration: motionConfig.normal,
      ease: motionConfig.easeInOutCubic,
    },
  }),
};

// ─────────────────────────────────────────────────────────────
// Re-export Spring Presets from spring-presets.ts
// ─────────────────────────────────────────────────────────────
export {
  springPresets,
  modalVariants,
  backdropVariants,
  slideUpVariants,
  slideRightVariants,
  slideLeftVariants,
  slideDownVariants,
  scaleInVariants,
  popoverVariants,
  contentFadeVariants,
} from "./spring-presets";

// ─────────────────────────────────────────────────────────────
// Dev logging utility
// ─────────────────────────────────────────────────────────────
if (import.meta.env.DEV) {
  console.debug("[ViewTransitions] Motion config loaded. useReducedMotion() hook available.");
  console.debug("[ViewTransitions] Spring presets re-exported from spring-presets.ts");
}
