/**
 * ============================================
 * COLOR PARSING SAFETY PATCH
 * ============================================
 * 
 * Problem: jspdf-autotable reads `getComputedStyle(elem).borderColor` 
 * and expects single-format values (rgb/rgba). But when an element has 
 * `border-color: var(--border)` (resolved to oklch) combined with 
 * Tailwind utilities that override individual sides, the browser returns 
 * a composite 4-value string mixing oklch + rgba + rgb formats.
 *
 * Additionally, MUI's `decomposeColor()` cannot parse oklch() at all.
 *
 * Solution: Runtime monkey-patch that normalizes oklch() to rgb() using
 * a hidden canvas element, and ensures getComputedStyle border-color 
 * values are always in a parseable format.
 * 
 * This runs once at app boot — zero performance impact after init.
 */

let _canvas: HTMLCanvasElement | null = null;
let _ctx: CanvasRenderingContext2D | null = null;

/**
 * Convert any CSS color string (including oklch) to rgb()/rgba() format
 * using the browser's own Canvas2D color resolution.
 */
function normalizeColorToRgb(color: string): string {
  if (!color || color === 'transparent' || color === 'inherit' || color === 'initial' || color === 'currentcolor') {
    return color;
  }
  
  // Already in rgb/rgba/hex — no conversion needed
  if (/^(#|rgb)/.test(color.trim())) {
    return color;
  }

  try {
    if (!_canvas) {
      _canvas = document.createElement('canvas');
      _canvas.width = 1;
      _canvas.height = 1;
      _ctx = _canvas.getContext('2d');
    }
    if (!_ctx) return color;

    // Reset and set the color — Canvas2D always serializes as rgb()/rgba()
    _ctx.clearRect(0, 0, 1, 1);
    _ctx.fillStyle = '#000000'; // Reset to known state
    _ctx.fillStyle = color;
    
    // If the browser couldn't parse it, fillStyle stays at the reset value
    if (_ctx.fillStyle === '#000000' && color.toLowerCase() !== '#000000' && color.toLowerCase() !== 'black') {
      return color; // Fallback — return as-is
    }
    
    return _ctx.fillStyle;
  } catch {
    return color;
  }
}

/**
 * Split a composite border-color value into individual side values and
 * normalize each one. Handles cases like:
 * "oklch(0.922 0 0) rgba(255,255,255,0.04) oklch(0.922 0 0) rgb(255,255,255)"
 * "rgb(229, 229, 229) rgba(255, 255, 255, 0.04) rgb(229, 229, 229) rgb(255, 255, 255)"
 */
function normalizeCompositeBorderColor(value: string): string {
  if (!value) return value;

  // Quick check: does this look like a composite (multiple color functions)?
  // Count color function starts — if more than 1, it's composite
  const colorFnCount = (value.match(/(oklch|rgba?|hsla?|lab|lch|color)\s*\(/g) || []).length;
  if (colorFnCount <= 1 && !value.includes('oklch')) return value;

  // Split on boundaries between color functions
  const colors: string[] = [];
  let depth = 0;
  let current = '';
  
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '(') depth++;
    if (char === ')') depth--;
    
    if (depth === 0 && char === ' ' && current.trim()) {
      // Check if next part starts a new color function
      const rest = value.slice(i + 1).trim();
      if (/^(oklch|rgb|rgba|hsl|hsla|#|lab|lch|color)\b/.test(rest)) {
        colors.push(current.trim());
        current = '';
        continue;
      }
    }
    current += char;
  }
  if (current.trim()) colors.push(current.trim());

  // If we got multiple colors, return only the first one (top side)
  // This is the safest approach — parsers expect a single value
  if (colors.length > 1) {
    return normalizeColorToRgb(colors[0]);
  }
  
  // Single oklch value
  if (value.includes('oklch')) {
    return normalizeColorToRgb(value);
  }

  return value;
}

/**
 * Install the monkey-patch on CSSStyleDeclaration.getPropertyValue
 * to intercept border-color reads and normalize oklch values.
 */
export function installColorParsingPatch(): void {
  if (typeof window === 'undefined') return;

  // --- Patch 1: Intercept getComputedStyle property access ---
  // jspdf-autotable accesses style[borderColorSide] which goes through
  // CSSStyleDeclaration's internal getter
  
  const borderProps = [
    'borderColor', 'borderTopColor', 'borderRightColor', 
    'borderBottomColor', 'borderLeftColor',
    'border-color', 'border-top-color', 'border-right-color',
    'border-bottom-color', 'border-left-color',
    'outlineColor', 'outline-color',
    'color', 'backgroundColor', 'background-color',
  ];

  const originalGetComputedStyle = window.getComputedStyle;

  window.getComputedStyle = function patchedGetComputedStyle(
    elt: Element,
    pseudoElt?: string | null
  ): CSSStyleDeclaration {
    const style = originalGetComputedStyle.call(window, elt, pseudoElt);
    
    // Return a Proxy that intercepts border-color property reads
    return new Proxy(style, {
      get(target, prop: string | symbol) {
        const val = Reflect.get(target, prop);
        
        // Only intercept string property reads for color-related properties
        if (typeof prop === 'string' && typeof val === 'string' && borderProps.includes(prop)) {
          // Catch oklch values OR composite multi-color values
          return normalizeCompositeBorderColor(val);
        }
        
        // For methods, bind them to the original target
        if (typeof val === 'function') {
          return val.bind(target);
        }
        
        return val;
      },
    });
  };

  // --- Patch 2: Patch getPropertyValue as well ---
  const originalGetPropertyValue = CSSStyleDeclaration.prototype.getPropertyValue;
  
  CSSStyleDeclaration.prototype.getPropertyValue = function patchedGetPropertyValue(
    property: string
  ): string {
    const val = originalGetPropertyValue.call(this, property);
    
    if (typeof val === 'string' && borderProps.includes(property)) {
      return normalizeCompositeBorderColor(val);
    }
    
    if (typeof val === 'string' && val.includes('oklch')) {
      return normalizeColorToRgb(val);
    }
    
    return val;
  };

  // eslint-disable-next-line no-console
  console.info('[SOSphere] Color parsing patch installed — oklch() → rgb() normalization active');
}