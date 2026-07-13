/**
 * Deterministic SEVEN-SEGMENT decoder for the Smart Sensor ultrasonic height
 * meter's LCD — reads the big clearance reading by detecting which of each
 * digit's 7 segments are lit, rather than asking a general OCR (ML Kit) to
 * recognise the glyph. Immune to the two things that defeat ML Kit here: the
 * ambient TEMPERATURE distractor (it's cropped out by the aim box before this
 * runs) and seven-segment digit-shape confusion (6↔5, 7↔0…) — a lit segment is
 * a lit segment.
 *
 * Pipeline (all pure JS, operates on a GRAYSCALE array so it's unit-testable):
 *   1. Otsu threshold → binary "on" mask, with auto-polarity (dark segments on a
 *      light LCD, but flips if the crop came in inverted).
 *   2. Row projection → the digit BAND (trims unit glyphs / crop slack).
 *   3. Column projection within the band → split into per-digit clusters + the
 *      decimal-point cluster.
 *   4. Per digit: sample the 7 segment regions → a 7-bit pattern → a digit.
 *      Narrow-tall clusters are "1" (only the right verticals); small low
 *      clusters are the decimal point.
 *   5. Assemble digits + decimal (detected, else placed to fit the range).
 *
 * Confidence is deterministic: EVERY digit must match a known pattern exactly
 * and the value must land in the plausible band. Anything less → not confident,
 * and the caller falls back to the ML Kit read. So the decoder can only add
 * correct reads, never introduce a silent wrong one.
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
  /** Human-readable trace for the on-screen tuning diagnostic. */
  debug: string;
}

// --- Tunable constants (calibrated blind; adjust against real field crops). ---
const ROW_BAND_FRAC = 0.15; // rows with > this * maxRowSum belong to the digit band
const COL_GAP_FRAC = 0.08; // a column with < this * bandHeight on-pixels is a gap
const MERGE_GAP_FRAC = 0.1; // merge clusters whose gap < this * bandHeight (heal splits)
const DECIMAL_MAX_FRAC = 0.4; // a cluster smaller than this * bandHeight (both dims) + low = "."
const ONE_MAX_W_FRAC = 0.36; // a cluster narrower than this * bandHeight (and tall) = "1"
const MIN_CLUSTER_ON = 0.03; // drop clusters with fewer on-pixels than this * bandH² (noise)
const SEG_ON_THRESH = 0.34; // a segment sample region with > this on-fraction is "lit"
const MAX_DIGITS = 4;

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

type Cluster = { x0: number; x1: number; yTop: number; yBot: number; on: number };

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

  // 1) Otsu threshold + binary mask (dark = "on"), auto-polarity.
  const threshold = otsu(gray, width, height);
  const on = new Uint8Array(width * height);
  let onCount = 0;
  for (let i = 0; i < width * height; i++) {
    // <= so a pixel exactly at the threshold counts as dark (matters for the
    // near-bimodal case where Otsu lands on the dark mode itself).
    if (gray[i] <= threshold) {
      on[i] = 1;
      onCount++;
    }
  }
  // Segments are a MINORITY of the LCD area; if "dark" is the majority the crop
  // is inverted (dark background) — flip so "on" means lit segment.
  if (onCount > width * height * 0.5) {
    for (let i = 0; i < on.length; i++) on[i] = on[i] ? 0 : 1;
  }

  // 2) Row projection → digit band.
  const rowSum = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    let s = 0;
    const base = y * width;
    for (let x = 0; x < width; x++) s += on[base + x];
    rowSum[y] = s;
  }
  const maxRow = Math.max(...rowSum);
  if (maxRow <= 0) return fail('no dark pixels');
  const rowThresh = maxRow * ROW_BAND_FRAC;
  let yTop = 0;
  while (yTop < height && rowSum[yTop] < rowThresh) yTop++;
  let yBot = height - 1;
  while (yBot > yTop && rowSum[yBot] < rowThresh) yBot--;
  const bandH = yBot - yTop + 1;
  if (bandH < 8) return fail('band too short');

  // 3) Column projection within the band → clusters.
  const colSum = new Int32Array(width);
  for (let x = 0; x < width; x++) {
    let s = 0;
    for (let y = yTop; y <= yBot; y++) s += on[y * width + x];
    colSum[x] = s;
  }
  const colThresh = Math.max(1, bandH * COL_GAP_FRAC);
  const rawRuns: Array<{ x0: number; x1: number }> = [];
  let x = 0;
  while (x < width) {
    if (colSum[x] >= colThresh) {
      const start = x;
      while (x < width && colSum[x] >= colThresh) x++;
      rawRuns.push({ x0: start, x1: x - 1 });
    } else {
      x++;
    }
  }
  if (rawRuns.length === 0) return fail('no columns');

  // Merge runs separated by a small gap (heals a digit split across a sparse
  // column); keep clear gaps (between digits) as separators.
  const mergeGap = Math.max(2, bandH * MERGE_GAP_FRAC);
  const merged: Array<{ x0: number; x1: number }> = [rawRuns[0]];
  for (let i = 1; i < rawRuns.length; i++) {
    const prev = merged[merged.length - 1];
    if (rawRuns[i].x0 - prev.x1 <= mergeGap) prev.x1 = rawRuns[i].x1;
    else merged.push(rawRuns[i]);
  }

  // Build clusters with their true vertical extent + on-count. The min on-count
  // is relative to a DIGIT CELL (~bandH tall), NOT the full image width, so a
  // thin "1" (two short verticals) survives while noise specks are dropped.
  const minClusterOn = bandH * bandH * MIN_CLUSTER_ON;
  const clusters: Cluster[] = [];
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
      clusters.push({ x0: run.x0, x1: run.x1, yTop: cyTop, yBot: cyBot, on: cOn });
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

/** Otsu's method → a global threshold in [0,255]. */
function otsu(gray: ArrayLike<number>, width: number, height: number): number {
  const hist = new Int32Array(256);
  const n = width * height;
  for (let i = 0; i < n; i++) hist[gray[i] | 0]++;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return threshold;
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

/** Convert an RGBA byte array (from jpeg-js) to a grayscale array (luma). */
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
