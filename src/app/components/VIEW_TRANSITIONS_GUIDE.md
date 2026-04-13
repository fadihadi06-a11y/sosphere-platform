# SOSphere View Transitions Guide

## Overview

The View Transitions system provides smooth, Apple-grade animations throughout the SOSphere dashboard. All animations:
- Respect `prefers-reduced-motion` for accessibility
- Use carefully tuned easing curves for premium feel
- Are performant (using transform-based animations)
- Follow enterprise SaaS design patterns

## Key Components

### 1. `PageTransition` — Page/Tab Changes

Wraps dashboard pages and tab content with fade-in + subtle slide-up animation.

```tsx
import { PageTransition } from "./view-transitions";

// Wraps entire pages
<AnimatePresence mode="wait">
  <PageTransition key={currentPage}>
    <YourPageContent />
  </PageTransition>
</AnimatePresence>

// Wrap tab content within hubs
<AnimatePresence mode="wait">
  <motion.div
    key={getHubTab("emergencyHub")}
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0 }}
    transition={{
      duration: motionConfig.normal,      // 0.3s
      ease: motionConfig.easeInOutCubic,  // Apple-grade ease
    }}
  >
    {/* Tab content */}
  </motion.div>
</AnimatePresence>
```

**Animation:**
- Enter: `opacity: 0 → 1`, `y: 12px → 0` over 0.3s
- Exit: `opacity: 1 → 0` over 0.15s (quick exit)
- Easing: cubic-bezier(0.25, 0.46, 0.45, 0.94)

### 2. `CardReveal` — Grid Card Animations

Staggered fade-in with upward motion for card grids.

```tsx
import { CardReveal, cardVariants } from "./view-transitions";

<CardReveal className="grid grid-cols-3 gap-4">
  {cards.map((card, i) => (
    <motion.div
      key={card.id}
      variants={cardVariants}
      custom={i}
      className="card"
    >
      {card.content}
    </motion.div>
  ))}
</CardReveal>
```

**Animation:**
- Each card delays by 0.05s (staggerDelay)
- Fade in + slide up, spring physics
- Parent orchestrates children

### 3. `SlidePanel` — Sidebars & Modals

Smooth slide-in from edges with spring physics.

```tsx
import { SlidePanel } from "./view-transitions";

<AnimatePresence>
  {isOpen && (
    <SlidePanel direction="right" className="sidebar">
      <PanelContent />
    </SlidePanel>
  )}
</AnimatePresence>
```

**Props:**
- `direction`: "left" | "right" | "top" | "bottom"
- `className`: Additional CSS classes
- `delay`: Optional animation delay

### 4. `ScaleIn` — Popups & Modals

Scales from 0.95 to 1.0 with spring physics.

```tsx
import { ScaleIn } from "./view-transitions";

<AnimatePresence>
  {showModal && (
    <ScaleIn className="modal-backdrop">
      <Modal />
    </ScaleIn>
  )}
</AnimatePresence>
```

**Animation:**
- Scale: 0.95 → 1.0
- Opacity: 0 → 1
- Spring: stiffness 300, damping 30

### 5. `ListStagger` — Tables & Lists

Staggered fade-in for table rows and list items.

```tsx
import { ListStagger, listItemVariants } from "./view-transitions";

<ListStagger className="table-body">
  {items.map((item, i) => (
    <motion.tr key={item.id} variants={listItemVariants} custom={i}>
      <td>{item.name}</td>
      <td>{item.value}</td>
    </motion.tr>
  ))}
</ListStagger>
```

**Animation:**
- Stagger delay: 0.03s between items
- Fade in + slide in from left

## Motion Configuration

All animations use a shared `motionConfig` object:

```tsx
export const motionConfig = {
  // Easing curves (cubic-bezier format)
  easeInOutCubic: [0.25, 0.46, 0.45, 0.94],
  easeOutQuad: [0.25, 0.46, 0.45, 0.94],
  easeInOutQuad: [0.455, 0.03, 0.515, 0.955],

  // Durations
  fast: 0.15,      // Quick dismissals
  normal: 0.3,     // Standard transitions
  slow: 0.45,      // Emphasis animations

  // Spring physics
  spring: {
    type: "spring",
    stiffness: 300,
    damping: 30,
  },

  // Stagger timing
  staggerDelay: 0.05,      // Cards
  listItemDelay: 0.03,     // List items
};
```

## Accessibility: `useReducedMotion()` Hook

All components automatically respect `prefers-reduced-motion`:

```tsx
const prefersReduced = useReducedMotion();

if (prefersReduced) {
  return <div>{children}</div>;  // No animations
}

// Animated version
return <motion.div>...</motion.div>;
```

**How it works:**
- Checks `window.matchMedia("(prefers-reduced-motion: reduce)")`
- Listens for OS-level preference changes
- All wrapper components use this hook automatically
- When reduced motion is preferred, all animations are disabled

## Implementation in Dashboard

### Main Page Transitions (company-dashboard.tsx)

Currently implemented for:
- **Page-level:** Switching between Overview, Emergency Hub, Operations, etc.
- **Hub-level:** Switching tabs within each hub (Active/Reports/History in Emergency Hub, etc.)

All transitions use the improved motion config:

```tsx
<AnimatePresence mode="wait">
  <motion.div
    key={currentPage}
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0 }}
    transition={{
      duration: motionConfig.normal,
      ease: motionConfig.easeInOutCubic,
    }}
  >
    <Suspense fallback={<PageLoading />}>
      {/* Page content */}
    </Suspense>
  </motion.div>
</AnimatePresence>
```

### Route-Level Transitions (routes.ts)

All main routes (/, /dashboard, /welcome, /training, etc.) are wrapped with `RouteTransitionLayout`, which provides smooth page transitions using `PageTransition`.

```tsx
export const router = createBrowserRouter([
  {
    Component: RouteTransitionLayout,
    children: [
      { path: "/", Component: LandingPage },
      { path: "/dashboard", lazy: () => ... },
      // ... other routes
    ],
  },
]);
```

## Performance Considerations

### Will-Change Hints

For animations that run frequently, use `will-change`:

```tsx
<motion.div
  style={{ willChange: "transform" }}
  animate={{ y: [0, -10, 0] }}
>
  Pulsing element
</motion.div>
```

### Avoid Layout Animations

Never animate layout properties (width, height, padding) — use transform instead:

```tsx
// Good ✓
<motion.div animate={{ y: 0 }} exit={{ y: -20 }} />

// Bad ✗
<motion.div animate={{ marginTop: 0 }} exit={{ marginTop: -20 }} />
```

### Suspend Animations on Low-End Devices

Check device capabilities before expensive animations:

```tsx
const reducedMotion = useReducedMotion();
const isLowEnd = /Android|iPhone/.test(navigator.userAgent);

const shouldAnimate = !reducedMotion && !isLowEnd;
```

## Best Practices

1. **Keep it Subtle**
   - Durations: 0.2–0.4s (faster than desktop apps)
   - Distances: < 20px
   - Easing: Use easeInOutCubic (not bouncy)

2. **Use Staggering for Multiple Elements**
   - Cards: 0.05s stagger
   - List items: 0.03s stagger
   - Never overlap all at once

3. **Mode="wait" for Clean Transitions**
   - Prevent overlapping exits/enters
   - Always use `<AnimatePresence mode="wait">`

4. **Test Accessibility**
   - Test with `prefers-reduced-motion` enabled
   - Verify animations are optional, not required to use app
   - Check keyboard navigation works during animations

5. **Respect User Preferences**
   - Use the `useReducedMotion()` hook
   - Never override system accessibility settings
   - Provide instant feedback for actions

## Common Patterns

### Fade + Slide Up (Pages)
```tsx
initial={{ opacity: 0, y: 12 }}
animate={{ opacity: 1, y: 0 }}
exit={{ opacity: 0 }}
transition={{ duration: motionConfig.normal }}
```

### Spring Animation (Modals)
```tsx
animate={{ scale: 1, opacity: 1 }}
exit={{ scale: 0.95, opacity: 0 }}
transition={motionConfig.spring}
```

### Staggered Reveal (Cards)
```tsx
variants={parentVariants}
initial="hidden"
animate="visible"
// Parent orchestrates children with staggerChildren
```

### List Item Animation
```tsx
variants={listItemVariants}
custom={index}
// custom prop is passed to transition delay calculation
```

## Debugging

### Enable Dev Logging

View console messages about motion config in development:

```tsx
if (import.meta.env.DEV) {
  console.debug("[ViewTransitions] Motion config loaded");
}
```

### Inspect Framer Motion

Use React DevTools to inspect motion component states and transitions.

### Slow Down Animations

For testing, temporarily modify `motionConfig`:

```tsx
// In browser console:
window.motionDebug = true;  // Custom hook to slow animations
```

## File Structure

- `src/app/components/view-transitions.tsx` — Core components & config
- `src/app/components/route-layout.tsx` — Route-level wrapper
- `src/app/components/company-dashboard.tsx` — Dashboard page/hub transitions
- `src/app/routes.ts` — Route-level transitions

## Future Enhancements

1. **Gesture-based Transitions** — Swipe between tabs on mobile
2. **Shared Layout Animations** — Morphing cards across pages
3. **Page Scroll Animations** — Fade elements in as user scrolls
4. **Keyboard Navigation** — Smooth focus indicators
5. **Haptic Feedback** — Pair animations with haptic events (mobile)

## Support

For questions or issues with transitions:
1. Check if `prefers-reduced-motion` is affecting testing
2. Verify `AnimatePresence mode="wait"` is used
3. Ensure `motion/react` is imported (not `framer-motion`)
4. Check browser DevTools for performance issues
