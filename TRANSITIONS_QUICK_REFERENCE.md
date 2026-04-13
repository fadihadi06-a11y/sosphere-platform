# SOSphere View Transitions — Quick Reference Card

## One-Line Descriptions

| Component | Purpose | Speed |
|-----------|---------|-------|
| `PageTransition` | Fade in + slide up for pages | 0.3s |
| `CardReveal` | Staggered grid reveals | 0.3s per card |
| `SlidePanel` | Sidebar slide-in from edges | Spring |
| `ScaleIn` | Modal scale with spring | Spring |
| `ListStagger` | Table row staggered fade | 0.03s stagger |
| `useReducedMotion()` | Detect accessibility setting | Instant |

## Installation

Already installed in your project! Just import:

```tsx
import {
  PageTransition,
  CardReveal,
  SlidePanel,
  ScaleIn,
  ListStagger,
  motionConfig,
  useReducedMotion,
} from "./components/view-transitions";
```

## Common Patterns

### Page or Tab Transition
```tsx
<AnimatePresence mode="wait">
  <PageTransition key={currentView}>
    {content}
  </PageTransition>
</AnimatePresence>
```

### Grid of Cards
```tsx
<CardReveal>
  {cards.map((card, i) => (
    <motion.div key={card.id} variants={cardVariants} custom={i}>
      {card}
    </motion.div>
  ))}
</CardReveal>
```

### Sidebar/Panel
```tsx
<AnimatePresence>
  {isOpen && <SlidePanel direction="left">{content}</SlidePanel>}
</AnimatePresence>
```

### Modal
```tsx
<AnimatePresence>
  {isOpen && <ScaleIn><Modal /></ScaleIn>}
</AnimatePresence>
```

### Table Rows
```tsx
<ListStagger>
  {items.map((item, i) => (
    <motion.tr key={item.id} variants={listItemVariants} custom={i}>
      {/* row content */}
    </motion.tr>
  ))}
</ListStagger>
```

## Configuration Values

```typescript
motionConfig.fast        // 0.15s — quick dismissals
motionConfig.normal      // 0.3s  — standard transitions
motionConfig.slow        // 0.45s — emphasis
motionConfig.spring      // { stiffness: 300, damping: 30 }
motionConfig.staggerDelay // 0.05s — cards
motionConfig.listItemDelay // 0.03s — rows
```

## Animation Specs at a Glance

```
PageTransition:
  enter: y: 12px, opacity: 0 → y: 0, opacity: 1 (0.3s)
  exit:  opacity: 1 → 0 (0.15s)

CardReveal:
  stagger: 0.05s between items
  spring physics available

SlidePanel:
  direction: "left" | "right" | "top" | "bottom"
  spring physics

ScaleIn:
  scale: 0.95 → 1.0 (spring)

ListStagger:
  stagger: 0.03s between items
  slide in from left
```

## Accessibility

Automatically respects `prefers-reduced-motion`:

```tsx
const prefersReduced = useReducedMotion();
// Returns true if OS accessibility setting is enabled
```

When enabled, all animations are disabled instantly.

## When to Use What

| Scenario | Component |
|----------|-----------|
| Switching pages | PageTransition |
| Grid of items | CardReveal |
| Sidebar opens | SlidePanel |
| Dialog appears | ScaleIn |
| List grows | ListStagger |
| Mobile drawer | SlidePanel (direction="left") |
| Tooltip pops | ScaleIn |
| Card grid expands | CardReveal |
| Table updates | ListStagger |
| Page changes route | Route transitions (built-in) |

## Files Location

```
src/app/components/
├── view-transitions.tsx          ← Core components
├── route-layout.tsx              ← Route wrapper
├── VIEW_TRANSITIONS_GUIDE.md      ← Full guide
├── TRANSITIONS_EXAMPLES.tsx       ← 8 examples
├── company-dashboard.tsx          ← Currently integrated
└── ...

Root files:
├── TRANSITIONS_IMPLEMENTATION_SUMMARY.md  ← Architecture
├── TRANSITIONS_TECHNICAL_SPEC.md          ← Technical details
└── TRANSITIONS_QUICK_REFERENCE.md         ← This file
```

## Common Mistakes

1. Forgetting `AnimatePresence` — no exit animation
2. Using `mode="sync"` instead of `mode="wait"` — overlapping
3. Not using unique `key` props — animations won't trigger
4. Animating layout (width, height) — causes jank
5. Forgetting `custom={i}` in staggered items — no delays
6. Using `variants` without `motion.div` — won't animate

## Performance Tips

1. Use `transform` not `position` changes
2. Use `staggerChildren` not individual delays
3. Keep durations < 0.4s for enterprise apps
4. Test with DevTools Performance tab
5. Monitor FPS — should stay at 60fps

## Testing Checklist

- [ ] Animations play smoothly
- [ ] Exit animation is quick
- [ ] `prefers-reduced-motion` disables animations
- [ ] No frame drops in DevTools
- [ ] Touch/click doesn't feel delayed
- [ ] Works on mobile browsers
- [ ] Keyboard navigation unaffected

## Troubleshooting

**Animations not working?**
- Check `AnimatePresence` is present
- Verify unique `key` is changing
- Import from `motion/react` not `framer-motion`

**Animation feels janky?**
- Check for layout property animations
- Reduce stagger delay or duration
- Profile in DevTools Performance tab

**Accessibility not working?**
- Test with `prefers-reduced-motion` enabled
- Verify `useReducedMotion()` hook is used
- Check OS setting is actually enabled

## Next Steps

1. Test in browser
2. Try CardReveal on another page
3. Add ListStagger to tables
4. Test with `prefers-reduced-motion` enabled
5. Monitor performance with DevTools

## Support

- **Guide:** VIEW_TRANSITIONS_GUIDE.md
- **Examples:** TRANSITIONS_EXAMPLES.tsx
- **Technical:** TRANSITIONS_TECHNICAL_SPEC.md
- **Architecture:** TRANSITIONS_IMPLEMENTATION_SUMMARY.md

---

**Keep it simple.** All transitions are already integrated. Just use the components!
