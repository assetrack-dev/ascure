/**
 * Deterministic SEVEN-SEGMENT decoder for the Smart Sensor ultrasonic height
 * meter's LCD — reads the big clearance reading by detecting which of each
 * digit's 7 segments are lit, rather than asking a general OCR (ML Kit) to
 * recognise the glyph. Immune to the two things that defeat ML Kit here: the
 * ambient TEMPERATURE distractor (cropped out by the aim box before this runs)
 * and seven-segment digit-shape confusion (6↔5, 7↔0…) — a lit segment is a lit
 * segment.
 *
 * SHARED / PLATFORM-AGNOSTIC. Everything here operates on a grayscale (or RGBA)
 * pixel array, so the SAME decoder runs on:
 *   - mobile (expo-image-manipulator crop + jpeg-js decode → RGBA),
 *   - the Node eval harness (sharp crop/resize → raw RGBA),
 *   - admin-web (canvas drawImage crop → getImageData → RGBA).
 * The only per-platform seam is loading + cropping pixels; decoding is one code
 * path. Keep the tunable constants below in one place so calibrating them (the
 * OCR "fine-tune") lands everywhere at once.
 *
 * Pipeline (all pure JS):
 *   1. Otsu threshold → binary "on" mask, auto-polarity.
 *   2. Row projection → the digit BAND (trims unit glyphs / crop slack).
 *   3. Column projection within the band → per-digit clusters + decimal point.
 *   4. Per digit: sample the 7 segment regions → a 7-bit pattern → a digit.
 *   5. Assemble digits + decimal (detected, else fixed 2 places).
 *
 * Confidence is deterministic: EVERY digit must match a known pattern exactly
 * and the value must land in range → else not confident, and the caller falls
 * back to the ML Kit read. So the decoder can only add correct reads.
 */

export interface SevenSegmentConstraints {
  min: number;
  max: number;
}

export interface SevenSegmentResult {
  /** Decoded reading, e.g. "3.67"; null when it couldn't decode confidently. */
  text: string | null;
  /** Parsed numeric value, or null. */
  value: number | null;
  /** True only when every digit matched exactly AND the value is in range. */
  confident: boolean;
  /** Number of digit cells found (excludes the decimal point). */
  digitCount: number;
  /** Human-readable trace for the on-screen / harness tuning diagnostic. */
  debug: string;
}

/** A normalized aim-box region ([0..1] of image width/height). */
export interface ReadingAimBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A pixel crop rectangle (expo-image-manipulator / sharp / canvas compatible). */
export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

// --- Tunable constants (calibrated blind; adjust against real field crops). ---
// These are THE OCR fine-tune surface. Changing them here retunes mobile, the
// admin auto-check, and the eval harness together.
export const ROW_BAND_FRAC = 0.15; // rows with > this * maxRowSum belong to the digit band
export const COL_GAP_FRAC = 0.08; // a column with < this * bandHeight on-pixels is a gap
export const MERGE_GAP_FRAC = 0.02; // merge clusters whose gap < this * bandHeight (heal splits)
export const DECIMAL_MAX_FRAC = 0.4; // a cluster smaller than this * bandHeight (both dims) + low = "."
export const ONE_MAX_W_FRAC = 0.36; // a cluster narrower than this * bandHeight (and tall) = "1"
export const MIN_CLUSTER_ON = 0.03; // drop clusters with fewer on-pixels than this * bandH² (noise)
export const SEG_ON_THRESH = 0.34; // a segment sample region with > this on-fraction is "lit"
export const MAX_DIGITS = 4;
// Adaptive-threshold window (as a fraction of min(width,height)) + darkness margin
// C. A pixel is a lit segment when it's > C darker than its local mean — robust
// to the uneven LCD illumination / glare that defeats a single global threshold.
export const ADAPTIVE_WINDOW_FRAC = 0.3;
export const ADAPTIVE_C = 14;
// A connected component counts as a digit when it's at least this tall (fraction
// of crop height) and no wider than DIGIT_MAX_WH × its own height (rejects small
// mode glyphs + wide shadow blobs).
export const DIGIT_MIN_H_FRAC = 0.35;
export const DIGIT_MAX_WH = 1.1;

/**
 * The band of the meter's LCD the big reading sits in — a wide central strip.
 * The ambient temperature (top-right corner) and the buttons (bottom) fall
 * OUTSIDE it, so cropping to this region isolates the reading from the two
 * distractors that defeat full-frame OCR. MUST stay in sync with the camera's
 * on-screen aim box (mobile CameraCaptureHost) so "fill the box" == what we OCR.
 */
export const READING_AIM_BOX: ReadingAimBox = { x: 0.08, y: 0.32, w: 0.84, h: 0.26 };

/** Width (px) to resize a crop to before the pixel decode, on every platform. */
export const SS_DECODE_WIDTH = 500;

// Segment order a,b,c,d,e,f,g (a=MSB). a=top, b=top-right, c=bottom-right,
// d=bottom, e=bottom-left, f=top-left, g=middle.
const DIGIT_PATTERNS: Record<string, string> = {
  '1111110': '0',
  '0110000': '1',
  '1101101': '2',
  '1111001': '3',
  '0110011': '4',
  '1011011': '5',
  '1011111': '6',
  '1110000': '7',
  '1111111': '8',
  '1111011': '9',
};

export function decodeSevenSegment(
  gray: ArrayLike<number>,
  width: number,
  height: number,
  constraints: SevenSegmentConstraints = { min: 3, max: 20 },
): SevenSegmentResult {
  const fail = (debug: string): SevenSegmentResult => ({
    text: null,
    value: null,
    confident: false,
    digitCount: 0,
    debug,
  });
  if (width < 8 || height < 8 || gray.length < width * height) {
    return fail('too small');
  }

  // 1) Adaptive (local-mean) threshold → segment mask. A single global cutoff
  //    (Otsu) fails on real photos: uneven LCD illumination / glare makes it
  //    split the lit centre from the shadowed edges rather than the segments
  //    from the background. A local mean marks a pixel "on" only when it is
  //    meaningfully darker than its neighbourhood — robust to vignette/glare,
  //    and it needs no polarity guess (a lit segment is locally dark).
  const on = adaptiveMask(gray, width, height);

  // 2) Row projection → the digit BAND. Seven-segment digits have GAPS between
  //    their segments, so connected-components would split each digit into ~7
  //    blobs; column/row projection is the right tool. The band is the rows with
  //    the most lit pixels (the big digits), trimming indicator/unit glyphs above
  //    and below when the crop is reasonably tight (what guided capture gives).
  const rowSum = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    let s = 0;
    const base = y * width;
    for (let x = 0; x < width; x++) s += on[base + x];
    rowSum[y] = s;
  }
  let maxRow = 0;
  for (let y = 0; y < height; y++) if (rowSum[y] > maxRow) maxRow = rowSum[y];
  if (maxRow <= 0) return fail('no dark pixels');
  const rowThresh = maxRow * ROW_BAND_FRAC;
  let yTop = 0;
  while (yTop < height && rowSum[yTop] < rowThresh) yTop++;
  let yBot = height - 1;
  while (yBot > yTop && rowSum[yBot] < rowThresh) yBot--;
  const bandH = yBot - yTop + 1;
  if (bandH < 8) return fail('band too short');

  // 3) Column projection within the band → per-digit clusters (gaps between
  //    digits have ~no lit pixels; the segments within a digit keep its columns
  //    lit, so a digit is one run).
  const colSum = new Int32Array(width);
  for (let x = 0; x < width; x++) {
    let s = 0;
    for (let y = yTop; y <= yBot; y++) s += on[y * width + x];
    colSum[x] = s;
  }
  const colThresh = Math.max(1, bandH * COL_GAP_FRAC);
  const rawRuns: Array<{ x0: number; x1: number }> = [];
  let rx = 0;
  while (rx < width) {
    if (colSum[rx] >= colThresh) {
      const start = rx;
      while (rx < width && colSum[rx] >= colThresh) rx++;
      rawRuns.push({ x0: start, x1: rx - 1 });
    } else {
      rx++;
    }
  }
  if (rawRuns.length === 0) return fail('no columns');

  // Merge runs separated by a small gap (heals a digit split across a sparse
  // column, e.g. the "1"); keep the clear gaps between digits as separators.
  const mergeGap = Math.max(2, bandH * MERGE_GAP_FRAC);
  const merged: Array<{ x0: number; x1: number }> = [rawRuns[0]];
  for (let i = 1; i < rawRuns.length; i++) {
    const prev = merged[merged.length - 1];
    if (rawRuns[i].x0 - prev.x1 <= mergeGap) prev.x1 = rawRuns[i].x1;
    else merged.push(rawRuns[i]);
  }

  // Build each cluster's true vertical extent + on-count; drop noise specks
  // (min on-count relative to a digit cell, so a thin "1" survives).
  const minClusterOn = bandH * bandH * MIN_CLUSTER_ON;
  const clusters: Array<{ x0: number; x1: number; yTop: number; yBot: number }> = [];
  for (const run of merged) {
    let cyTop = yBot;
    let cyBot = yTop;
    let cOn = 0;
    for (let cx = run.x0; cx <= run.x1; cx++) {
      for (let cy = yTop; cy <= yBot; cy++) {
        if (on[cy * width + cx]) {
          cOn++;
          if (cy < cyTop) cyTop = cy;
          if (cy > cyBot) cyBot = cy;
        }
      }
    }
    if (cOn >= minClusterOn) {
      clusters.push({ x0: run.x0, x1: run.x1, yTop: cyTop, yBot: cyBot });
    }
  }
  if (clusters.length === 0) return fail('no clusters');

  // 4) Classify + decode each cluster left-to-right.
  const digitChars: string[] = [];
  let decimalIndex: number | null = null; // digits emitted before the point
  const traces: string[] = [];
  for (const cl of clusters) {
    const w = cl.x1 - cl.x0 + 1;
    const h = cl.yBot - cl.yTop + 1;
    const lowCenter = (cl.yTop + cl.yBot) / 2 > yTop + bandH * 0.55;

    // Decimal point: small in both dims, sitting low.
    if (w <= bandH * DECIMAL_MAX_FRAC && h <= bandH * DECIMAL_MAX_FRAC && lowCenter) {
      if (decimalIndex === null) decimalIndex = digitChars.length;
      traces.push('.');
      continue;
    }
    if (digitChars.length >= MAX_DIGITS) {
      return fail(`too many digits (${clusters.length} clusters)`);
    }
    // "1": a narrow, tall cluster (only the right verticals b,c lit).
    if (w <= bandH * ONE_MAX_W_FRAC && h >= bandH * 0.5) {
      digitChars.push('1');
      traces.push('1');
      continue;
    }
    // General digit: sample the 7 segments over the cluster's own box.
    const pattern = sampleSegments(on, width, cl.x0, cl.yTop, cl.x1, cl.yBot);
    const digit = DIGIT_PATTERNS[pattern];
    if (!digit) {
      return fail(`unknown segments ${pattern} @${cl.x0}-${cl.x1}`);
    }
    digitChars.push(digit);
    traces.push(`${digit}[${pattern}]`);
  }

  if (digitChars.length === 0) return fail('no digits');

  // 5) Assemble with the decimal point (detected, else placed to fit the range).
  const finalized = finalize(digitChars, decimalIndex, constraints);
  const debug = `segs ${traces.join(' ')} -> ${finalized.text ?? '?'}${finalized.confident ? '' : ' (rej)'}`;
  return {
    text: finalized.confident ? finalized.text : null,
    value: finalized.confident ? finalized.value : null,
    confident: finalized.confident,
    digitCount: digitChars.length,
    debug,
  };
}

/**
 * Adaptive local-mean threshold → binary "on" mask where a lit segment is a
 * pixel meaningfully darker (> ADAPTIVE_C) than the mean of its neighbourhood.
 * Uses an integral image so each pixel's box mean is O(1). Robust to uneven LCD
 * lighting/glare that a single global threshold (Otsu) can't handle.
 */
function adaptiveMask(gray: ArrayLike<number>, width: number, height: number): Uint8Array {
  const n = width * height;
  const iw = width + 1;
  // Integral image (Float64 to avoid overflow on large crops).
  const integral = new Float64Array(iw * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += gray[y * width + x];
      integral[(y + 1) * iw + (x + 1)] = integral[y * iw + (x + 1)] + rowSum;
    }
  }
  const r = Math.max(3, Math.round(Math.min(width, height) * ADAPTIVE_WINDOW_FRAC));
  const on = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height - 1, y + r);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width - 1, x + r);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * iw + (x1 + 1)] -
        integral[y0 * iw + (x1 + 1)] -
        integral[(y1 + 1) * iw + x0] +
        integral[y0 * iw + x0];
      const mean = sum / area;
      if (gray[y * width + x] < mean - ADAPTIVE_C) on[y * width + x] = 1;
    }
  }
  return on;
}

/** Sample the 7 segments over a digit box → a 7-char "abcdefg" on/off string. */
function sampleSegments(
  on: Uint8Array,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): string {
  const w = x1 - x0;
  const h = y1 - y0;
  const frac = (rx0: number, ry0: number, rx1: number, ry1: number): number => {
    const ax0 = Math.round(x0 + rx0 * w);
    const ay0 = Math.round(y0 + ry0 * h);
    const ax1 = Math.round(x0 + rx1 * w);
    const ay1 = Math.round(y0 + ry1 * h);
    let lit = 0;
    let total = 0;
    for (let y = ay0; y <= ay1; y++) {
      for (let x = ax0; x <= ax1; x++) {
        total++;
        if (on[y * width + x]) lit++;
      }
    }
    return total > 0 ? lit / total : 0;
  };
  const seg = (v: number) => (v > SEG_ON_THRESH ? '1' : '0');
  const a = seg(frac(0.25, 0.04, 0.75, 0.2));
  const b = seg(frac(0.78, 0.16, 0.97, 0.44));
  const c = seg(frac(0.78, 0.56, 0.97, 0.84));
  const d = seg(frac(0.25, 0.8, 0.75, 0.96));
  const e = seg(frac(0.03, 0.56, 0.22, 0.84));
  const f = seg(frac(0.03, 0.16, 0.22, 0.44));
  const g = seg(frac(0.25, 0.42, 0.75, 0.58));
  return `${a}${b}${c}${d}${e}${f}${g}`;
}

/** Place the decimal point + validate against the range. */
function finalize(
  digits: string[],
  decimalIndex: number | null,
  c: SevenSegmentConstraints,
): { text: string | null; value: number | null; confident: boolean } {
  const raw = digits.join('');
  // Place the decimal at its DETECTED position if we found the dot; otherwise at
  // a FIXED 2 places from the right — the meter's format is always X.XX / XX.XX.
  // We deliberately do NOT search placements for one that fits the range: that
  // would turn a genuine below-range 1.50 into a bogus in-range 15.0.
  let text: string;
  if (decimalIndex !== null && decimalIndex > 0 && decimalIndex < digits.length) {
    text = `${raw.slice(0, decimalIndex)}.${raw.slice(decimalIndex)}`;
  } else {
    const places = Math.min(2, raw.length - 1);
    if (places < 1) {
      return { text: raw, value: null, confident: false };
    }
    text = `${raw.slice(0, raw.length - places)}.${raw.slice(raw.length - places)}`;
  }
  const value = Number(text);
  const confident = Number.isFinite(value) && value >= c.min && value <= c.max;
  return { text, value: confident ? value : null, confident };
}

/** Convert an RGBA byte array (from jpeg-js / sharp / canvas) to grayscale (luma). */
export function rgbaToGray(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    gray[i] = (r * 77 + g * 150 + b * 29) >> 8; // 0.299/0.587/0.114 fixed-point
  }
  return gray;
}

/** Convenience: RGBA crop → grayscale → decode, in one call (the common path). */
export function decodeReadingFromRgba(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  constraints?: SevenSegmentConstraints,
): SevenSegmentResult {
  const gray = rgbaToGray(rgba, width, height);
  return decodeSevenSegment(gray, width, height, constraints);
}

/**
 * Convert a normalized aim-box region + source dims into a clamped pixel crop
 * rectangle. Pure. Returns null when the geometry is unusable. Shared so mobile,
 * the harness, and admin-web all crop the SAME region.
 */
export function regionToRect(
  region: ReadingAimBox,
  imageWidth: number,
  imageHeight: number,
): CropRect | null {
  if (!(imageWidth > 0) || !(imageHeight > 0)) {
    return null;
  }
  const originX = Math.min(imageWidth - 1, Math.max(0, Math.round(region.x * imageWidth)));
  const originY = Math.min(imageHeight - 1, Math.max(0, Math.round(region.y * imageHeight)));
  const width = Math.min(imageWidth - originX, Math.round(region.w * imageWidth));
  const height = Math.min(imageHeight - originY, Math.round(region.h * imageHeight));
  if (width < 1 || height < 1) {
    return null;
  }
  return { originX, originY, width, height };
}
