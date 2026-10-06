import { EPIC7_PALETTE_HEX } from './types.ts';

export interface RGB {
  r: number; // 0..255
  g: number; // 0..255
  b: number; // 0..255
}

export interface Lab {
  L: number; // 0..100
  a: number; // -128..127
  b: number; // -128..127
}

/**
 * Parses a 3-character or 6-character hex color into RGB.
 */
export function hexToRgb(hex: string): RGB {
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map(c => c + c).join('');
  }
  const num = parseInt(clean, 16);
  if (isNaN(num)) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

/**
 * Converts RGB [0..255] to CIE Lab color space under standard D65 illuminant.
 */
export function rgbToLab(rgb: RGB): Lab {
  // 1. sRGB to linear sRGB
  const rLin = rgb.r / 255;
  const gLin = rgb.g / 255;
  const bLin = rgb.b / 255;

  const rSrgb = rLin > 0.04045 ? Math.pow((rLin + 0.055) / 1.055, 2.4) : rLin / 12.92;
  const gSrgb = gLin > 0.04045 ? Math.pow((gLin + 0.055) / 1.055, 2.4) : gLin / 12.92;
  const bSrgb = bLin > 0.04045 ? Math.pow((bLin + 0.055) / 1.055, 2.4) : bLin / 12.92;

  // 2. linear sRGB to XYZ (D65)
  const X = (rSrgb * 0.4124564 + gSrgb * 0.3575761 + bSrgb * 0.1804375) / 0.95047;
  const Y = (rSrgb * 0.2126729 + gSrgb * 0.7151522 + bSrgb * 0.0721750) / 1.00000;
  const Z = (rSrgb * 0.0193339 + gSrgb * 0.1191920 + bSrgb * 0.9503041) / 1.08883;

  // 3. XYZ to Lab
  const delta = 6 / 29;
  const f = (t: number) => (t > Math.pow(delta, 3) ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29);

  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz)
  };
}

/**
 * Computes perceptual color distance between two RGB colors using CIE76 delta-E,
 * normalized to [0, 1] range.
 */
export function colorDifferenceNormalized(c1: RGB, c2: RGB): number {
  const lab1 = rgbToLab(c1);
  const lab2 = rgbToLab(c2);
  const dL = lab1.L - lab2.L;
  const da = lab1.a - lab2.a;
  const db = lab1.b - lab2.b;
  const deltaE = Math.sqrt(dL * dL + da * da + db * db);
  // Maximum deltaE across RGB gamut is ~100-120
  return Math.min(1.0, deltaE / 100.0);
}

// Precomputed Lab values for the 26 Epic Seven palette colors for fast lookup
const PALETTE_LAB_CACHE: { hex: string; rgb: RGB; lab: Lab }[] = EPIC7_PALETTE_HEX.map(hex => {
  const rgb = hexToRgb(hex);
  return { hex, rgb, lab: rgbToLab(rgb) };
});

/**
 * Finds the closest authoritative Epic Seven palette color for an arbitrary RGB color.
 */
export function findClosestPaletteColor(rgb: RGB): { hex: string; distance: number } {
  return findClosestPaletteColorFromLab(rgbToLab(rgb));
}

/**
 * Finds the closest authoritative Epic Seven palette color for an arbitrary Lab color.
 */
export function findClosestPaletteColorFromLab(targetLab: Lab): { hex: string; distance: number; paletteIndex: number } {
  let bestHex = PALETTE_LAB_CACHE[0].hex;
  let bestIndex = 0;
  let minDistance = Infinity;

  for (let i = 0; i < PALETTE_LAB_CACHE.length; i++) {
    const entry = PALETTE_LAB_CACHE[i];
    const dL = targetLab.L - entry.lab.L;
    const da = targetLab.a - entry.lab.a;
    const db = targetLab.b - entry.lab.b;
    const dE = Math.sqrt(dL * dL + da * da + db * db);
    if (dE < minDistance) {
      minDistance = dE;
      bestHex = entry.hex;
      bestIndex = i;
    }
  }

  return { hex: bestHex, distance: minDistance / 100.0, paletteIndex: bestIndex };
}

/**
 * Converts CIE Lab back to sRGB [0..255] under D65 illuminant.
 */
export function labToRgb(lab: Lab): RGB {
  const fy = (lab.L + 16) / 116;
  const fx = lab.a / 500 + fy;
  const fz = fy - lab.b / 200;

  const delta = 6 / 29;
  const invF = (t: number) => (t > delta ? t * t * t : 3 * delta * delta * (t - 4 / 29));

  const X = 0.95047 * invF(fx);
  const Y = 1.00000 * invF(fy);
  const Z = 1.08883 * invF(fz);

  // XYZ to linear sRGB
  const rLin = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
  const gLin = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
  const bLin = X * 0.0557 + Y * -0.2040 + Z * 1.0570;

  // linear sRGB to sRGB
  const gamma = (c: number) => (c > 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

  return {
    r: clamp(gamma(rLin) * 255),
    g: clamp(gamma(gLin) * 255),
    b: clamp(gamma(bLin) * 255)
  };
}
