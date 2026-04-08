# SOSphere Native Compatibility Guide

This guide covers the Capacitor native platform support added for iOS App Store and Google Play Store deployment.

## Quick Start

### 1. Safe Areas (Notched Devices)

Use the `useSafeArea()` hook to get safe area insets:

```tsx
import { useSafeArea } from '@/app/components/native-safe-area';

function MyComponent() {
  const { top, bottom, left, right } = useSafeArea();
  
  return (
    <div style={{ paddingTop: top, paddingBottom: bottom }}>
      Content that respects notches/punch-holes
    </div>
  );
}
```

Or use the `SafeAreaView` component:

```tsx
import { SafeAreaView } from '@/app/components/native-safe-area';

export function MyScreen() {
  return (
    <SafeAreaView className="flex flex-col p-4">
      <Header />
      <Content />
    </SafeAreaView>
  );
}
```

### 2. Touch Targets

All interactive elements must be at least 44px × 44px (Apple HIG) or 48dp × 48dp (Material Design).

Use the `.touch-target` CSS class or Tailwind utilities:

```tsx
// CSS class approach
<button className="touch-target">Tap me</button>

// Tailwind approach
<button className="min-h-11 min-w-11 px-5 py-2.5">Tap me</button>

// min-h-11 = 44px (Tailwind: 1 unit = 4px, 11 × 4 = 44px)
```

### 3. Native Platform Features

Import and use the capacitor-bridge for native features:

```tsx
import {
  isNativeApp,
  getNativePlatform,
  setStatusBarStyle,
  enableKeepAwake,
  disableKeepAwake,
  triggerHapticFeedback,
  requestNativePermissions,
} from '@/app/components/capacitor-bridge';

export function SosButton() {
  const handleSOS = async () => {
    // Check if running as native app
    if (isNativeApp()) {
      const platform = getNativePlatform(); // 'ios' | 'android' | 'web'
      
      // Keep screen awake during SOS
      await enableKeepAwake();
      
      // Set status bar to light style
      await setStatusBarStyle('light');
      
      // Trigger haptic feedback
      await triggerHapticFeedback('warning');
    }
    
    // Trigger SOS...
  };
  
  return <button onClick={handleSOS}>SOS</button>;
}
```

### 4. Safe Area CSS Classes

Use safe area utility classes for quick styling:

```tsx
// Padding-based
<div className="safe-area-top">Has safe area top padding</div>
<div className="safe-area-bottom">Has safe area bottom padding</div>
<div className="safe-area-x">Safe area left & right padding</div>
<div className="safe-area-all">All sides safe area padding</div>

// Margin-based
<div className="safe-margin-top">Safe area top margin</div>
<div className="safe-margin-bottom">Safe area bottom margin</div>
<div className="safe-margin-x">Safe area left & right margin</div>

// Min-height based (for spacers)
<div className="safe-min-top">Minimum height of safe area top</div>
<div className="safe-min-bottom">Minimum height of safe area bottom</div>
```

## File Reference

### New Files

- **`src/app/components/capacitor-bridge.ts`** (10 KB)
  - Platform detection: `isNativeApp()`, `getNativePlatform()`
  - Permissions: `requestNativePermissions()`
  - Status bar: `setStatusBarStyle()`
  - Keep awake: `enableKeepAwake()`, `disableKeepAwake()`
  - Haptics: `triggerHapticFeedback()`
  - All methods gracefully no-op on web

- **`src/app/components/native-safe-area.tsx`** (9 KB)
  - `SafeAreaProvider` - Wrap your app with this
  - `useSafeArea()` - Hook to get inset values
  - `SafeAreaView` - Component with auto-padding
  - `SafeAreaSpacing` - Spacer component for layout

- **`src/styles/native-compat.css`** (23 KB)
  - Safe area inset handling
  - Touch target sizing (44px minimum)
  - Tap feedback removal
  - Overscroll prevention
  - Keyboard avoidance
  - Orientation handling
  - Input styling for iOS/Android

### Updated Files

- **`index.html`**
  - Added `viewport-fit=cover` to viewport meta tag

- **`src/main.tsx`**
  - Imported `native-compat.css`
  - Called `initCapacitorBridge()`

- **`src/app/App.tsx`**
  - Wrapped app with `SafeAreaProvider`

## Design Guidelines

### Safe Area Padding

Apply padding equal to or greater than the safe area inset:

```css
/* Good */
.my-element {
  padding-top: max(16px, env(safe-area-inset-top));
  padding-bottom: max(24px, env(safe-area-inset-bottom));
}

/* Not recommended */
.my-element {
  padding-top: 8px; /* May be hidden under notch! */
}
```

### Touch Targets

Minimum sizes:
- **Buttons**: 44px × 44px (iOS), 48dp × 48dp (Android)
- **Form controls**: 44px height minimum
- **Tap areas**: No spacing less than 8px between targets

### Status Bar

The status bar is now handled automatically via `native-compat.css`:
- Dark content on light backgrounds
- Light content on dark backgrounds (default for SOSphere)

To override in code:

```tsx
import { setStatusBarStyle } from '@/app/components/capacitor-bridge';

// During dark SOS screen
await setStatusBarStyle('light');

// Back to normal
await setStatusBarStyle('dark');
```

### Keyboard Avoidance

The app automatically adds the `.keyboard-open` class when the virtual keyboard appears. Style affected elements:

```css
body.keyboard-open .my-floating-button {
  bottom: max(24px, var(--keyboard-height, 300px));
}
```

## Testing on Devices

### Physical Device Testing

```bash
# iOS Simulator
npx cap run ios

# iOS Physical Device
npx cap run ios --device

# Android Emulator
npx cap run android

# Android Physical Device
npx cap run android --device
```

### What to Test

1. **Notched devices**: iPhone X, 11 Pro, 12+, 14 Pro, 15 Pro
2. **Dynamic Island**: iPhone 14 Pro+, 15 Pro+
3. **Punch-hole cameras**: Samsung Galaxy S20+, Pixel 6+
4. **Orientations**: Portrait and landscape
5. **Virtual keyboard**: Open on text inputs
6. **Touch targets**: Verify 44×44px minimum
7. **Safe areas**: Content doesn't overlap notches

## Performance

- **SafeAreaProvider**: Uses React Context (minimal overhead)
- **CSS env() values**: Browser-native (zero JS overhead)
- **Capacitor methods**: Asynchronous, non-blocking
- **No polling**: Orientation changes detected via events

## Browser Support

### iOS
- iOS 11+ (safe area support)
- iOS 12+ (env() CSS variables)
- All modern iPhones (notch, Dynamic Island, etc.)

### Android
- Android 5+ (general support)
- Android 8+ (Capacitor runtime)
- Android 10+ (system gesture navigation)

## Common Issues

### Issue: Content hidden under notch

**Solution**: Use safe area padding
```tsx
<div className="safe-area-top">Content</div>
```

### Issue: Buttons too small to tap

**Solution**: Apply minimum 44px sizing
```tsx
<button className="touch-target min-h-11 min-w-11">Tap</button>
```

### Issue: Keyboard covers input field

**Solution**: Use body.keyboard-open class or SafeAreaView

### Issue: Status bar not visible

**Solution**: Call setStatusBarStyle() during init:
```tsx
import { setStatusBarStyle } from '@/app/components/capacitor-bridge';

setStatusBarStyle('light');
```

## Next Steps (Before Deployment)

### 1. Install Required Capacitor Plugins

```bash
npm install @capacitor/status-bar
npm install @capacitor/haptics
npm install @capacitor-community/keep-awake
npm install @capacitor/camera
npm install @capacitor/geolocation
```

### 2. Update `capacitor.config.ts`

```typescript
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'co.sosphere',
  appName: 'SOSphere',
  webDir: 'dist',
  plugins: {
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#05070E',
    },
    SplashScreen: {
      launchAutoHide: false,
    },
  },
};

export default config;
```

### 3. Build for Native Platforms

```bash
# Build web assets
npm run build

# iOS
npx cap add ios
npx cap sync ios
npx cap open ios

# Android
npx cap add android
npx cap sync android
npx cap open android
```

### 4. Test on Physical Devices

See "Testing on Devices" section above.

## API Reference

### capacitor-bridge.ts

```typescript
// Platform Detection
function isNativeApp(): boolean
function getNativePlatform(): 'ios' | 'android' | 'web'

// Permissions
async function requestNativePermissions(
  permission: 'camera' | 'location' | 'microphone' | 'notifications'
): Promise<{ permission; granted: boolean; error?: string }>

// Status Bar
async function setStatusBarStyle(style: 'light' | 'dark'): Promise<void>

// Keep Awake
async function enableKeepAwake(): Promise<void>
async function disableKeepAwake(): Promise<void>

// Haptics
async function triggerHapticFeedback(
  type: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error'
): Promise<void>

// Lifecycle
function initCapacitorBridge(): void
function cleanupCapacitorBridge(): void
```

### native-safe-area.tsx

```typescript
// Hook
function useSafeArea(): { top; bottom; left; right }

// Components
<SafeAreaProvider>
<SafeAreaView edges={['top', 'bottom', 'left', 'right']}>
<SafeAreaSpacing edge="top" />

// Provider Props
interface SafeAreaProviderProps {
  children: ReactNode
  override?: SafeAreaInsets
}
```

## Support

For issues or questions about native compatibility:

1. Check the [Capacitor Documentation](https://capacitorjs.com/docs)
2. Review the [iOS App Store Guidelines](https://developer.apple.com/app-store/review/guidelines/)
3. Review the [Google Play Policy](https://play.google.com/about/developer-content-policy/)
4. Check existing GitHub issues in the SOSphere repository

## License

SOSphere is licensed under the terms specified in the main repository.
