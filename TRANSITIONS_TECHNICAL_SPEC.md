# SOSphere View Transitions — Technical Specification

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     React Router                            │
│           (routes.ts with RouteTransitionLayout)            │
└────────────────┬────────────────────────────────────────────┘
                 │
        ┌────────▼─────────┐
        │ PageTransition   │  (wraps entire pages)
        │ AnimatePresence  │
        └────────┬─────────┘
                 │
    ┌────────────▼────────────────┐
    │  CompanyDashboard Component │
    │  (Main hub container)       │
    └───┬────────────────┬────────┘
        │                │
   ┌────▼────┐    ┌──────▼──────┐
   │ Page     │    │ 6 Hub Areas │
   │Trans-    │    │ (each with  │
   │itions    │    │  tab switch │
   │ (7 main) │    │  anim)      │
   └──────────┘    └─────────────┘
        │                │
   ┌────▼──────────────────┴──────┐
   │ motion.div with               │
   │ AnimatePresence mode="wait"   │
   │ (smooth fade + slide-up)      │
   └───────────────────────────────┘
```

## Component Hierarchy

### 1. view-transitions.tsx (Core Library)

```typescript
// Exports:
export const motionConfig = { ... }
export function useReducedMotion(): boolean { ... }

// Components:
export function PageTransition({ children, className, delay })
export function CardReveal({ children, className, staggerDelay })
export function SlidePanel({ children, direction, className, delay })
export function ScaleIn({ children, className, delay })
export function ListStagger({ children, className, itemDelay })

// Variants (for direct usage):
export const pageVariants: Variants = { ... }
export const cardVariants: Variants = { ... }
export const listItemVariants: Variants = { ... }
```

### 2. route-layout.tsx (Route Wrapper)

```typescript
export function RouteTransitionLayout()
export function withRouteTransition<P>(Component: React.ComponentType<P>)
```

### 3. company-dashboard.tsx (Dashboard Integration)

```typescript
// Imports
import { PageTransition, motionConfig, useReducedMotion }

// Usage:
<AnimatePresence mode="wait">
  <motion.div key={currentPage} initial={...} animate={...} exit={...}>
    {/* Page content */}
  </motion.div>
</AnimatePresence>
```

## Animation Specifications

### Motion Config Structure

```typescript
const motionConfig = {
  // Cubic-bezier easing curves
  easeInOutCubic: [0.25, 0.46, 0.45, 0.94],
  easeOutQuad: [0.25, 0.46, 0.45, 0.94],
  easeInOutQuad: [0.455, 0.03, 0.515, 0.955],

  // Timing (seconds)
  fast: 0.15,
  normal: 0.3,
  slow: 0.45,

  // Spring physics
  spring: {
    type: "spring",
    stiffness: 300,
    damping: 30,
  },

  // Stagger timing
  staggerDelay: 0.05,
  listItemDelay: 0.03,
}
```

### PageTransition Animation

```typescript
{
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: {
    duration: 0.3,
    ease: [0.25, 0.46, 0.45, 0.94],
  }
}
```

**Timeline (in seconds):**
- 0.0s: Start fade-in + slide-up
- 0.3s: Reach opacity: 1, y: 0
- On exit: Fade out immediately (0.15s)

### CardReveal Animation (Staggered)

```typescript
// Parent
{
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: {
    staggerChildren: 0.05,
    delayChildren: 0.1,
  }
}

// Child (each card)
{
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1, y: 0,
    transition: { duration: 0.3 }
  }
}
```

**Timeline for 3 cards:**
- 0.1s: Card 1 starts
- 0.15s: Card 2 starts (0.1 + 0.05)
- 0.2s: Card 3 starts (0.1 + 0.05 + 0.05)
- 0.4s: All cards visible

### SlidePanel Animation

```typescript
{
  initial: { x: -100, opacity: 0 },      // direction: "left"
  animate: { x: 0, y: 0, opacity: 1 },
  exit: { x: -100, opacity: 0 },
  transition: {
    type: "spring",
    stiffness: 300,
    damping: 30,
  }
}
```

**For different directions:**
- left: `initial: { x: -100, opacity: 0 }`
- right: `initial: { x: 100, opacity: 0 }`
- top: `initial: { y: -100, opacity: 0 }`
- bottom: `initial: { y: 100, opacity: 0 }`

### ScaleIn Animation

```typescript
{
  initial: { scale: 0.95, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  exit: { scale: 0.95, opacity: 0 },
  transition: {
    type: "spring",
    stiffness: 300,
    damping: 30,
  }
}
```

### ListStagger Animation

```typescript
// Parent
{
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.03,
      delayChildren: 0.05,
    }
  }
}

// Child (each row)
{
  hidden: { opacity: 0, x: -8 },
  visible: {
    opacity: 1, x: 0,
    transition: { duration: 0.3 }
  }
}
```

## Integration Points

### 1. Main Page Transitions (company-dashboard.tsx)

**Location:** Line ~1654-1669
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
      {/* Page conditionals */}
    </Suspense>
  </motion.div>
</AnimatePresence>
```

**Affected Pages (7 total):**
1. Overview
2. Emergency Hub
3. Operations Hub
4. People Hub
5. Incident & Risk Hub
6. Reports & Analytics Hub
7. Governance Hub
8. Location
9. CSV Guide
10. Safety Intel
11. Weather Alerts
12. RRP Analytics

### 2. Hub Tab Transitions (6 hubs × AnimatePresence blocks)

**Pattern (repeated 6 times):**
```tsx
<HubTabBar hubId="emergencyHub" activeTab={...} onTabChange={...} />
<AnimatePresence mode="wait">
  <motion.div
    key={getHubTab("emergencyHub")}
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0 }}
    transition={{
      duration: motionConfig.normal,
      ease: motionConfig.easeInOutCubic,
    }}
  >
    {/* Tab content */}
  </motion.div>
</AnimatePresence>
```

**Hub Locations:**
- Line ~1690: Emergency Hub (5 tabs: active, reports, history, command, sar, playbook)
- Line ~1777: Operations Hub (5 tabs: missions, journey, workforce, comms, offline)
- Line ~1798: People Hub (4 tabs: directory, buddy, checklist, score)
- Line ~1816: Incident & Risk Hub (2 tabs: investigation, register)
- Line ~1832: Reports & Analytics Hub (4 tabs: reports, analytics, leaderboard, scheduler)
- Line ~1850: Governance Hub (2 tabs: audit, roles)

### 3. Route-Level Transitions (routes.ts)

**Location:** Lines 10-32
```tsx
export const router = createBrowserRouter([
  {
    Component: RouteTransitionLayout,
    children: [
      { path: "/", Component: LandingPage, HydrateFallback: RouteLoading },
      { path: "/dashboard", lazy: () => ... },
      // ... other routes
    ],
  },
]);
```

**Wrapped Routes:**
- / (Landing)
- /app (Mobile app)
- /dashboard (Main dashboard)
- /welcome (Welcome activation)
- /demo (WOW demo)
- /training (Training center)
- /dev/stress-test (Dev-only)
- /privacy (Privacy policy)
- /terms (Terms of service)
- /compliance (Compliance dashboard)
- * (404 Not Found)

## Accessibility Implementation

### useReducedMotion Hook

```typescript
export function useReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReduced(mediaQuery.matches);

    const listener = (e: MediaQueryListEvent) => {
      setPrefersReduced(e.matches);
    };

    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, []);

  return prefersReduced;
}
```

**Usage in Components:**
```typescript
const prefersReduced = useReducedMotion();

if (prefersReduced) {
  return <div className={className}>{children}</div>;
}

// Animated version
return <motion.div>...</motion.div>;
```

### Detection Mechanism

```
┌────────────────────────────────────┐
│ window.matchMedia()                │
│ (prefers-reduced-motion: reduce)   │
└────┬───────────────────────────────┘
     │
  ┌──▼─┐
  │YES │ → return true → render static content
  └────┘
     │
  ┌──▼─┐
  │NO  │ → return false → render animated content
  └────┘
     │
  ┌──▼────────────────────────────────┐
  │ Listen for preference changes      │
  │ (e.g., OS accessibility setting)   │
  └───────────────────────────────────┘
```

## Performance Optimization

### Transform-Only Animations

All animations use transform properties (GPU-accelerated):
- ✓ `x`, `y` (transform: translate)
- ✓ `scale` (transform: scale)
- ✓ `rotate` (transform: rotate)
- ✓ `opacity` (composite layer)

**Never animated:**
- ✗ `width`, `height` (layout thrashing)
- ✗ `margin`, `padding` (layout thrashing)
- ✗ `left`, `right`, `top`, `bottom` (expensive)
- ✗ `box-shadow` (expensive)
- ✗ `border-radius` (expensive)

### Stagger Optimization

```typescript
// Efficient: Parent orchestrates children
<motion.div variants={parentVariants}>
  <motion.div variants={childVariants} custom={0} />
  <motion.div variants={childVariants} custom={1} />
  <motion.div variants={childVariants} custom={2} />
</motion.div>

// Inefficient: Individual transitions
<motion.div transition={{ delay: 0.0 }} />
<motion.div transition={{ delay: 0.05 }} />
<motion.div transition={{ delay: 0.1 }} />
```

### AnimatePresence Modes

```typescript
// Sequential: Wait for exit before enter
<AnimatePresence mode="wait">
  <motion.div key={page} exit={{ opacity: 0 }} />
</AnimatePresence>

// Synchronous: Exit and enter together
<AnimatePresence>
  <motion.div key={page} exit={{ opacity: 0 }} />
</AnimatePresence>
```

**Used:** `mode="wait"` (cleanest transitions, no overlap)

## Memory & Cleanup

### Event Listeners (useReducedMotion)

```typescript
useEffect(() => {
  const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const listener = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);

  mediaQuery.addEventListener("change", listener);
  
  return () => {
    // Cleanup: Remove listener on unmount
    mediaQuery.removeEventListener("change", listener);
  };
}, []);
```

### No Inline Variant Objects

**Good:**
```typescript
const cardVariants: Variants = { hidden: {...}, visible: {...} };

<motion.div variants={cardVariants} />
<motion.div variants={cardVariants} />
```

**Bad:**
```typescript
<motion.div variants={{ hidden: {...}, visible: {...} }} />  // Recreated every render
<motion.div variants={{ hidden: {...}, visible: {...} }} />  // Recreated every render
```

## Browser Compatibility

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome 90+ | ✓ Full | Optimized |
| Firefox 88+ | ✓ Full | Optimized |
| Safari 14+ | ✓ Full | Optimized |
| Edge 90+ | ✓ Full | Optimized |
| Mobile Safari | ✓ Full | Touch-optimized |
| Chrome Mobile | ✓ Full | Touch-optimized |

## Testing Strategy

### Unit Tests (Future)
```typescript
describe("PageTransition", () => {
  it("renders children when reduced motion is disabled", () => { })
  it("renders without animation when reduced motion is enabled", () => { })
  it("applies correct animation variants", () => { })
})
```

### Integration Tests
1. Navigation between pages (verify smooth transition)
2. Tab switching within hub (verify tab animation)
3. Reduced motion preference (verify static render)
4. Mobile responsiveness (verify animation smoothness)

### Performance Tests
```
Metrics to monitor:
- FCP (First Contentful Paint) < 2.5s
- LCP (Largest Contentful Paint) < 4s
- CLS (Cumulative Layout Shift) < 0.1
- FID (First Input Delay) < 100ms
- INP (Interaction to Next Paint) < 200ms
```

## Monitoring & Debugging

### Dev Logging

```typescript
i