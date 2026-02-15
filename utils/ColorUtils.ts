// Utilities for color manipulation and contrast calculation
// Based on W3C accessibility guidelines and simplified APCA concepts

export class ColorUtils {
  
  // Static cache for the canvas context to avoid re-creation overhead
  private static cachedCtx: CanvasRenderingContext2D | null = null;

  // Lazy getter for the context
  private static getContext(): CanvasRenderingContext2D | null {
    if (!this.cachedCtx) {
      const canvas = document.createElement('canvas');
      // 'willReadFrequently' forces software rendering, which is faster for frequent readbacks
      this.cachedCtx = canvas.getContext('2d', { willReadFrequently: true });
    }
    return this.cachedCtx;
  }

  // Parse hex/rgb/name to [r, g, b]
  static parseColor(color: string): [number, number, number] | null {
    if (!color) return null;
    const c = color.trim();

    // --- FAST PATH 1: Hex Colors (#fff or #ffffff) ---
    // Avoids DOM interaction completely
    if (c.startsWith('#')) {
      const hex = c.slice(1);
      if (hex.length === 3) {
        return [
          parseInt(hex[0] + hex[0], 16),
          parseInt(hex[1] + hex[1], 16),
          parseInt(hex[2] + hex[2], 16)
        ];
      } else if (hex.length === 6) {
        return [
          parseInt(hex.slice(0, 2), 16),
          parseInt(hex.slice(2, 4), 16),
          parseInt(hex.slice(4, 6), 16)
        ];
      }
    }

    // --- FAST PATH 2: RGB/RGBA Colors ---
    // Matches rgb(10, 20, 30) or rgba(10, 20, 30, 0.5)
    // Avoids DOM interaction completely
    const rgbMatch = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbMatch) {
      return [
        parseInt(rgbMatch[1], 10),
        parseInt(rgbMatch[2], 10),
        parseInt(rgbMatch[3], 10)
      ];
    }

    // --- SLOW PATH: Named Colors (e.g., "red", "tomato") ---
    // Falls back to Canvas to let the browser resolve the name
    const ctx = this.getContext();
    if (!ctx) return null;

    // We must clear previous state or ensure we are parsing correctly.
    // Setting fillStyle to a known invalid ensures we don't get a stale color if input is invalid.
    ctx.fillStyle = '#000000'; 
    ctx.fillStyle = c;
    
    const computed = ctx.fillStyle; // Returns normalized #rrggbb
    
    // Check if the browser successfully parsed it (it converts names to #rrggbb)
    if (computed && computed.startsWith('#') && computed !== c) {
       // If input was 'black' or '#000000', computed is '#000000'. 
       // This logic assumes if computed is valid hex, we are good.
       const r = parseInt(computed.slice(1, 3), 16);
       const g = parseInt(computed.slice(3, 5), 16);
       const b = parseInt(computed.slice(5, 7), 16);
       return [r, g, b];
    }
    // Special check for black since we used it as fallback
    if (c.toLowerCase() === 'black') return [0, 0, 0];

    return null;
  }

  // Calculate relative luminance
  static getLuminance(r: number, g: number, b: number): number {
    const a = [r, g, b].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  }

  // Calculate contrast ratio (standard WCAG 2.0)
  static getContrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
    const lum1 = this.getLuminance(fg[0], fg[1], fg[2]);
    const lum2 = this.getLuminance(bg[0], bg[1], bg[2]);
    const brightest = Math.max(lum1, lum2);
    const darkest = Math.min(lum1, lum2);
    return (brightest + 0.05) / (darkest + 0.05);
  }

  // Convert RGB to HSL
  static rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s, l = (max + min) / 2;

    if (max === min) {
      h = s = 0; // achromatic
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return [h * 360, s * 100, l * 100];
  }

  // Convert HSL back to Hex
  static hslToHex(h: number, s: number, l: number): string {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  // Main function: Adapt a color to ensure readability on a dark background
  // Target background updated to #2e2e2e (lighter dark gray)
  static adaptForDarkMode(colorStr: string, bgHex: string = '#2e2e2e'): string {
    const fg = this.parseColor(colorStr);
    const bg = this.parseColor(bgHex);
    
    if (!fg || !bg) return colorStr; // Fallback

    const currentContrast = this.getContrastRatio(fg, bg);
    
    // WCAG AA for normal text is 4.5:1. For dark mode, we aim for good readability without glare.
    if (currentContrast >= 4.5) {
      return colorStr; // It's already readable
    }

    // If contrast is low, lighten the color
    const [h, s, l] = this.rgbToHsl(fg[0], fg[1], fg[2]);
    
    // Strategy: Boost lightness significantly, reduce saturation slightly to prevent neon effect
    let newL = Math.max(l, 60); // Ensure at least 60% lightness
    
    // If it was very dark (black text), make it off-white/light-gray
    if (l < 20) {
      return '#e0e0e0'; 
    }

    // Iteratively increase lightness until contrast is met
    let safety = 0;
    let bestHex = this.hslToHex(h, s, newL);
    
    while (safety < 10) {
       const testFg = this.parseColor(bestHex);
       if (testFg && this.getContrastRatio(testFg, bg) >= 4.5) {
         return bestHex;
       }
       newL += 5;
       if (newL > 100) {
         return '#ffffff'; // Fallback to white
       }
       bestHex = this.hslToHex(h, s, newL);
       safety++;
    }

    return bestHex;
  }

  // Process a CSS string and replace colors for dark mode
  static processCSSForDarkMode(css: string): string {
    // Regex to find hex colors and rgb/rgba
    const colorRegex = /#([0-9a-fA-F]{3}){1,2}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)/g;
    
    // We want to replace colors, but not inside selectors (usually colors are values)
    return css.replace(colorRegex, (match) => {
      return this.adaptForDarkMode(match);
    });
  }
}