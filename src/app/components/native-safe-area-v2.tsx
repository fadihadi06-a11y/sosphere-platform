/**
 * Native Safe Area Provider
 *
 * Handles safe area insets for notched devices (iPhone X+, Android punch-hole cameras).
 * Uses CSS env(safe-area-inset-*) values with React context for easy access.
 *
 * Usage:
 * 1. Wrap your app with <SafeAreaProvider> (in App.tsx or main layout)
 * 2. Use useSafeArea() hook to get current inset values
 * 3. Apply .safe-top, .safe-bottom, .safe-x classes to elements
 */

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface SafeAreaContextType {
  insets: SafeAreaInsets;
  isReady: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

const SafeAreaContext = createContext<SafeAreaContextType | null>(null);

/**
 * Parse CSS env(safe-area-inset-*) values
 *
 * These values are automatically set by the browser/Capacitor runtime.
 * On modern iOS/Android, they account for notches, punch-holes, and rounded corners.
 *
 * @returns Object with top, bottom, left, right inset values in pixels
 */
function parseSafeAreaInsets(): SafeAreaInsets {
  // getComputedStyle is the most reliable way to read CSS env() values
  const root = document.documentElement;
  const styles = getComputedStyle(root);

  const parseValue = (varName: string): number => {
    const value = styles.getPropertyValue(varName).trim();

    // Value is usually like "16px" or "0px"
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  return {
    top: parseValue('--safe-area-inset-top'),
    bottom: parseValue('--safe-area-inset-bottom'),
    left: parseValue('--safe-area-inset-left'),
    right: parseValue('--safe-area-inset-right'),
  };
}

/**
 * Extract numeric value from CSS env(safe-area-inset-*) expression
 *
 * CSS env() values are computed by the browser, so we need to use
 * computed styles rather than getPropertyValue.
 *
 * Fallback: use viewport dimensions and device pixel ratio to estimate
 */
function getComputedSafeAreaInsets(): SafeAreaInsets {
  // Try modern approach: set CSS variables in root and read them
  const root = document.documentElement;

  // These CSS variables should be set to env() values in native-compat.css
  const getVariable = (name: string): number => {
    const value = getComputedStyle(root).getPropertyValue(name).trim();
    const num = parseFloat(value);
    return Number.isNaN(num) ? 0 : num;
  };

  return {
    top: getVariable('--safe-area-inset-top') || getViewportSafeAreaEstimate().top,
    bottom: getVariable('--safe-area-inset-bottom') || getViewportSafeAreaEstimate().bottom,
    left: getVariable('--safe-area-inset-left') || getViewportSafeAreaEstimate().left,
    right: getVariable('--safe-area-inset-right') || getViewportSafeAreaEstimate().right,
  };
}

/**
 * Estimate safe area from viewport size when env() is not available
 *
 * Fallback for older browsers that don't support CSS env(safe-area-inset-*)
 */
function getViewportSafeAreaEstimate(): SafeAreaInsets {
  // Most notched phones have safe areas of 20-50px
  // This is a safe fallback for testing
  return {
    top: window.visualViewport?.offsetTop || 0,
    bottom: 0,
    left: 0,
    right: 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDER COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export interface SafeAreaProviderProps {
  children: ReactNode;
  /**
   * Optional override for safe area insets
   * Useful for testing or manual adjustment
   */
  override?: SafeAreaInsets;
}

/**
 * SafeAreaProvider — Wrap your app with this to enable safe area support
 *
 * @example
 * export function App() {
 *   return (
 *     <SafeAreaProvider>
 *       <YourAppContent />
 *     </SafeAreaProvider>
 *   );
 * }
 */
export function SafeAreaProvider({ children, override }: SafeAreaProviderProps) {
  const [insets, setInsets] = useState<SafeAreaInsets>(() =>
    override || getComputedSafeAreaInsets()
  );

  useEffect(() => {
    // Re-read insets on viewport resize (orientation change, virtual keyboard, etc.)
    const handleResize = () => {
      setInsets(override || getComputedSafeAreaInsets());
    };

    // Also monitor for orientation changes
    const handleOrientationChange = () => {
      // Slight delay to allow layout to settle
      setTimeout(handleResize, 100);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientationChange);

    // On mobile, also check for keyboard visibility changes
    if ('visualViewport' in window) {
      window.visualViewport?.addEventListener('resize', handleResize);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
      if ('visualViewport' in window) {
        window.visualViewport?.removeEventListener('resize', handleResize);
      }
    };
  }, [override]);

  return (
    <SafeAreaContext.Provider value={{ insets, isReady: true }}>
      {children}
    </SafeAreaContext.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * useSafeArea — Get current safe area insets
 *
 * Returns inset values for notched devices.
 * On non-notched devices or web, returns zeros.
 *
 * @returns SafeAreaInsets with top, bottom, left, right values
 *
 * @example
 * function MyComponent() {
 *   const { top, bottom } = useSafeArea();
 *   return (
 *     <div style={{ paddingTop: top, paddingBottom: bottom }}>
 *       Content
 *     </div>
 *   );
 * }
 */
export function useSafeArea(): SafeAreaInsets {
  const context = useContext(SafeAreaContext);

  if (!context) {
    console.warn(
      '[SafeArea] useSafeArea called outside SafeAreaProvider. ' +
      'Wrap your app with <SafeAreaProvider> to use this hook.'
    );

    // Return sensible defaults
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }

  return context.insets;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * SafeAreaView — A div that automatically applies safe area padding
 *
 * Applies padding to all sides based on safe area insets.
 * Use for full-bleed layouts that need to avoid notches.
 *
 * @example
 * <SafeAreaView className="flex flex-col">
 *   <Header />
 *   <Content />
 * </SafeAreaView>
 */
export function SafeAreaView({
  children,
  className = '',
  style = {},
  edges = ['top', 'bottom', 'left', 'right'],
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}) {
  const insets = useSafeArea();

  const safeStyle: React.CSSProperties = {
    paddingTop: edges.includes('top') ? `max(16px, ${insets.top}px)` : undefined,
    paddingBottom: edges.includes('bottom') ? `max(24px, ${insets.bottom}px)` : undefined,
    paddingLeft: edges.includes('left') ? `max(20px, ${insets.left}px)` : undefined,
    paddingRight: edges.includes('right') ? `max(20px, ${insets.right}px)` : undefined,
    ...style,
  };

  return (
    <div className={className} style={safeStyle}>
      {children}
    </div>
  );
}

/**
 * SafeAreaSpacing — A spacer component that fills safe area height
 *
 * Useful for positioning elements relative to safe area boundaries.
 *
 * @example
 * <Header />
 * <SafeAreaSpacing edge="top" />
 * <Content />
 */
export function SafeAreaSpacing({
  edge = 'top',
  className = '',
}: {
  edge?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}) {
  const insets = useSafeArea();

  const dimension = edge === 'top' ? insets.top : edge === 'bottom' ? insets.bottom :
                   edge === 'left' ? insets.left : insets.right;

  if (dimension === 0) return null;

  const style: React.CSSProperties =
    edge === 'top' || edge === 'bottom'
      ? { height: `${dimension}px` }
      : { width: `${dimension}px` };

  return <div className={className} style={style} />;
}
