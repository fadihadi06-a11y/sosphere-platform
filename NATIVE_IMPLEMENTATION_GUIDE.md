# SOSphere Native Implementation Quick Reference

> **TL;DR:** All critical native infrastructure is in place. Use the CSS classes provided to handle safe areas. Two remaining items: wrap icon buttons (44x44px) and implement keyboard detection.

---

## Quick Start for Developers

### 1. Safe Area in Fixed Elements

**Problem:** On iPhone with notch, home indicator overlaps fixed bottom elements.

**Solution:** Use CSS class instead of `bottom-X`:

```jsx
// ❌ BAD: overlaps home indicator
<div className="fixed bottom-4 right-4">FAB</div>

// ✅ GOOD: respects safe area
<div className="fixed fixed-bottom-safe right-4">FAB</div>

// ✅ ALSO GOOD: with more bottom margin
<div className="fixed fixed-bottom-safe-lg right-4">FAB</div>
```

### 2. Touch Targets (Must be 44x44px)

**Problem:** Buttons using `size-5` (20px) are too small to tap reliably.

**Solution A: Use built-in touch-target class**
```jsx
// ✅ GOOD: button already has min-height/width 44px
<button className="touch-target">
  <X className="size-5" />
</button>
```

**Solution B: Add padding wrapper**
```jsx
// ✅ GOOD: padding makes total area 44x44
<button className="p-3 flex items-center justify-center">
  <X className="size-5" />
</button>
```

**Solution C: Explicit sizing**
```jsx
// ✅ GOOD: explicit minimum size
<button style={{ minHeight: 44, minWidth: 44 }}>
  <X className="size-5" />
</button>
```

### 3. Safe Area Padding Inside Containers

**Problem:** Content inside a container touches the screen edges near notch.

**Solution:** Use safe area padding utilities:

```jsx
// ✅ GOOD: padding respects notch
<div className="safe-area-all">
  {/* content stays away from notch on all sides */}
</div>

// ✅ GOOD: only specific sides
<header className="safe-area-top">
  Header with padding for notch
</header>

<footer className="safe-area-bottom">
  Footer with padding for home indicator
</footer>
```

### 4. Access Safe Area Values in JavaScript

```tsx
import { useSafeArea } from './components/native-safe-area';

export function MyComponent() {
  const { top, bottom, left, right } = useSafeArea();
  
  return (
    <div style={{ 
      paddingTop: top,
      paddingBottom: bottom 
    }}>
      Content with safe area spacing
    </div>
  );
}
```

---

## Safe Area CSS Classes Reference

### Padding-Based (Recommended)

| Class | Effect |
|-------|--------|
| `safe-area-top` | Adds `max(16px, env(safe-area-inset-top))` padding |
| `safe-area-bottom` | Adds `max(24px, env(safe-area-inset-bottom))` padding |
| `safe-area-left` | Adds `max(20px, env(safe-area-inset-left))` padding |
| `safe-area-right` | Adds `max(20px, env(safe-area-inset-right))` padding |
| `safe-area-x` | Adds left + right padding |
| `safe-area-all` | Adds padding on all sides |

### Fixed Positioning (For Floating Elements)

| Class | Effect | Use Case |
|-------|--------|----------|
| `fixed-bottom-safe` | `bottom: max(16px, env(...))` | Floating widgets, badges |
| `fixed-bottom-safe-lg` | `bottom: max(24px, env(...))` | FABs, prominent buttons |
| `fixed-top-safe` | `top: max(16px, env(...))` | Floating top elements |

### Margin-Based (For Flex Layouts)

| Class | Effect |
|-------|--------|
| `safe-margin-top` | Margin version of safe-area-top |
| `safe-margin-bottom` | Margin version of safe-area-bottom |
| `safe-margin-x` | Margin version of safe-area-x |

---

## Real-World Examples

### Example 1: Bottom Navigation

```jsx
function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 safe-area-bottom">
      {/* Nav items */}
    </nav>
  );
}
```

### Example 2: Floating Action Button

```jsx
function FAB() {
  return (
    <button className="fixed fixed-bottom-safe-lg right-6 size-14 rounded-full">
      <Plus className="size-6" />
    </button>
  );
}
```

### Example 3: Modal with Safe Areas

```jsx
function Modal() {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
      <div className="safe-area-all rounded-2xl bg-white">
        {/* Modal content stays away from notch */}
      </div>
    </div>
  );
}
```

### Example 4: Full-Screen Layout with Notch Awareness

```jsx
function Page() {
  return (
    <SafeAreaView className="flex flex-col min-h-screen">
      <Header className="safe-area-top" />
      <main className="flex-1 overflow-auto">
        {/* Main content */}
      </main>
      <Footer className="safe-area-bottom" />
    </SafeAreaView>
  );
}
```

---

## Platform Detection

```tsx
import { 
  isNativeApp, 
  getNativePlatform 
} from './components/capacitor-bridge';

export function MyComponent() {
  const isMobile = isNativeApp();
  const platform = getNativePlatform(); // 'ios' | 'android' | 'web'
  
  if (platform === 'ios') {
    // iOS-specific behavior
  } else if (platform === 'android') {
    // Android-specific behavior
  } else {
    // Web-only code
  }
}
```

---

## Common Patterns

### Pattern 1: Floating Badge at Bottom-Right

```jsx
// ❌ WRONG: overlaps home indicator
<div className="fixed bottom-4 right-4">99+</div>

// ✅ RIGHT: respects safe area
<div className="fixed fixed-bottom-safe right-4">99+</div>
```

### Pattern 2: Bottom Sheet Modal

```jsx
// ✅ GOOD: bottom sheet with safe area
<div className="fixed inset-x-0 bottom-0 rounded-t-2xl safe-area-bottom">
  <div className="space-y-4 p-6">
    {/* Sheet content */}
  </div>
</div>
```

### Pattern 3: Tabs/Bottom Navigation

```jsx
// ✅ GOOD: tabs extend to edges but content respects safe area
<div className="fixed bottom-0 left-0 right-0 border-t">
  <div className="flex safe-area-x">
    {/* Tab items */}
  </div>
</div>
```

### Pattern 4: Absolute Positioning (for nested elements)

```jsx
// For absolutely positioned children within safe area container:
<div className="relative safe-area-all">
  <div className="absolute top-0 right-0">
    {/* Positioned relative to container, outside of padding */}
  </div>
</div>
```

---

## Safe Area Values by Device

| Device | Top | Bottom | Left | Right | Notes |
|--------|-----|--------|------|-------|-------|
| iPhone 11-14 | 47px | 34px | 0px | 0px | Standard notch |
| iPhone 15 | 47px | 34px | 0px | 0px | Dynamic Island (treated as notch) |
| iPhone 16 Pro | 47px | 34px | 0px | 0px | Larger Dynamic Island |
| Android (notch) | 25-30px | 0px | 0px | 0px | Varies by device |
| Android (punch-hole) | 25px | 0px | 0px | 0px | Varies by placement |
| iPad (no notch) | 0px | 0px | 0px | 0px | All normal values |
| Web/Desktop | 0px | 0px | 0px | 0px | Always normal |

---

## Testing Checklist

### Per Component Change:
- [ ] Element doesn't overlap notch in portrait
- [ ] Element doesn't overlap home indicator in portrait
- [ ] Element doesn't overlap status bar in landscape
- [ ] Element is visually aligned on left/right when present
- [ ] Works on both iOS and Android

### Device Testing:
- [ ] iPhone 12, 13, or 14 (required)
- [ ] Android device with punch-hole (required)
- [ ] iPad in split view (recommended)
- [ ] Landscape orientation (recommended)

---

## CSS Custom Properties

These are set automatically by the browser/Capacitor:

```css
/* In :root, DO NOT MODIFY */
--safe-area-inset-top: env(safe-area-inset-top, 0px);
--safe-area-inset-bottom: env(safe-area-inset-bottom, 0px);
--safe-area-inset-left: env(safe-area-inset-left, 0px);
--safe-area-inset-right: env(safe-area-inset-right, 0px);
```

You can read these in CSS:

```css
.my-element {
  padding-bottom: var(--safe-area-inset-bottom);
}
```

---

## Troubleshooting

### "Element overlaps home indicator"

**Solution:** Apply `fixed-bottom-safe` or `fixed-bottom-safe-lg` class:
```jsx
// Before
<div className="fixed bottom-4">Element</div>

// After
<div className="fixed fixed-bottom-safe right-4">Element</div>
```

### "Icon button is too small to tap"

**Solution:** Add 44x44px minimum size:
```jsx
// Before
<button><X className="size-5" /></button>

// After
<button className="p-3 flex items-center justify-center">
  <X className="size-5" />
</button>
```

### "Safe area not applying"

**Checklist:**
1. Are you inside `<SafeAreaProvider>`?
2. Are you using the correct class name?
3. Is `native-compat.css` imported in your app?
4. Try using `useSafeArea()` hook to debug values

```tsx
const { top, bottom } = useSafeArea();
console.log({ top, bottom }); // Debug output
```

### "Keyboard overlaps input field"

**Solution:** Implement keyboard detection (in progress):
```jsx
// For now, use padding-bottom fallback
<div className="safe-area-bottom pb-8">
  <input type="text" />
</div>
```

---

## Performance

- **Zero JavaScript overhead:** Safe areas use pure CSS env()
- **No polling:** Layout updates on actual viewport resize
- **Memoized context:** SafeAreaProvider prevents unnecessary re-renders
- **Browser optimized:** CSS env() is computed natively by WebKit/Chrome

---

## Browser Compatibility

| Feature | iOS | Android | Web |
|---------|-----|---------|-----|
| `env(safe-area-inset-*)` | 11+ | 9+ | Chrome 88+ |
| `-webkit-overflow-scrolling` | All | N/A | Safari only |
| `viewport-fit=cover` | 11+ | 9+ | Chrome 88+ |
| CSS custom properties | All | All | All |

---

## Code Snippets to Copy-Paste

### Fixed Bottom FAB
```jsx
<button className="fixed fixed-bottom-safe-lg right-6 size-14 rounded-full bg-blue-500">
  <Plus className="size-6 text-white" />
</button>
```

### Safe Area Wrapper
```jsx
<div className="safe-area-all p-4">
  {/* Content with safe area padding */}
</div>
```

### Touch Target Button
```jsx
<button className="touch-target rounded-lg bg-gray-200">
  <Icon className="size-5" />
  Label
</button>
```

### Full Screen with Header & Footer
```jsx
<div className="h-screen flex flex-col">
  <header className="safe-area-top border-b">Header</header>
  <main className="flex-1 overflow-auto">Content</main>
  <footer className="safe-area-bottom border-t">Footer</footer>
</div>
```

---

## When to Use Each Approach

| Situation | Solution | Example |
|-----------|----------|---------|
| Floating button at bottom | `fixed-bottom-safe-lg` | FAB, action button |
| Fixed bottom bar | `safe-area-bottom` padding | Bottom nav, tab bar |
| Fixed top bar | `safe-area-top` padding | Header, toolbar |
| Container with safe padding | `safe-area-all` | Modal, dialog |
| Dynamic positioning | `useSafeArea()` hook | Complex layouts |
| Icon button touch target | `p-3` wrapper | Close buttons, icons |

---

## References

- **Audit Report:** `src/app/components/native-audit-report.ts`
- **Implementation:** `src/app/components/native-safe-area.tsx`
- **CSS Utilities:** `src/styles/native-compat.css`
- **Bridge:** `src/app/components/capacitor-bridge.ts`
- **Full Guide:** `NATIVE_AUDIT_FIXES.md`

---

**Last Updated:** 2026-04-08  
**Version:** v11  
**Status:** Production Ready
