import TextRecognition, {
  Frame,
  TextRecognitionResult,
} from '@react-native-ml-kit/text-recognition';
import { Image } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { decode as jpegDecode } from 'jpeg-js';
import { normalizeReadingSentinel, type ReadingSentinel } from '@ascure/shared-utils';
import { decodeSevenSegment, rgbaToGray, type SevenSegmentResult } from './sevenSegment';

/**
 * On-device OCR (Google ML Kit) for Smart Sensor readings — the cable
 * ground-clearance value on a Smart Sensor ultrasonic height meter's LCD.
 * Runs fully offline; the inspector can always correct the result.
 *
 * The display is a reflective SEVEN-SEGMENT LCD showing THREE things at once:
 * the big central distance reading (what we want, e.g. "6.98"), an ambient
 * TEMPERATURE in the top-right corner (e.g. "36.4"), and small mode/unit glyphs
 * ("HOLD", "METRIC", "M", "W1"). When the cable is below the meter's measurable
 * range it shows "-LO-" INSTEAD of a number. Generic OCR happily returns the
 * temperature or a stray glyph, so picking "the first / longest number" is
 * unreliable. Instead we:
 *   1. SENTINEL FIRST — detect "LO" (below range, clearance under ~3 m). It's a
 *      hazard, not a missing reading, and must be recorded. Only accepted when
 *      it's at least as tall as any number found, so a stray glyph can't win.
 *      Guards the nasty case where "-LO-" is misread as "10" (a plausible
 *      clearance!) — a bare integer never auto-fills (see LOW-CONFIDENCE below).
 *   2. SPATIAL TARGETING — the reading is the BIGGEST text in frame, so numeric
 *      words are scored by their ML Kit bounding-box height.
 *   3. RANGE — a clearance value has a plausible physical band (metres); the
 *      ~30-40 C temperature and small stray glyphs fall outside it and lose.
 *   4. DECIMAL RECOVERY — a dropped LCD decimal turns 6.98 into 698; if
 *      re-inserting a point lands the value in-band we recover it.
 *   5. LOW-CONFIDENCE GUARD — if nothing in-band with a decimal is found we
 *      report low confidence rather than silently filling the temperature.
 *   6. CANDIDATES — a ranked list is returned so the UI can offer a one-tap
 *      "did you mean…" instead of forcing a manual retype.
 *
 * TWO-PASS CROP + RE-READ (the accuracy fix for seven-segment digit misreads
 * like 6.42→5.42): the parser above targets the right REGION, but ML Kit still
 * misreads the individual seven-segment glyphs on the full photo. So after the
 * first pass locates the reading's bounding box, we CROP tight to it and
 * ENLARGE it (expo-image-manipulator), then OCR that clean, big region again.
 * The two reads are reconciled (see `reconcileScans`): when they AGREE we're
 * confident; when they DISAGREE the digits are ambiguous, so we surface both as
 * candidates and do NOT silently auto-fill. The crop pass is best-effort — any
 * failure falls back to the single full-image read, so it can only help.
 */

export type ReadingKind = 'NUMBER' | 'SENTINEL';

export interface ReadingCandidate {
  /** Normalized numeric string, e.g. "6.98". */
  value: string;
  /** Higher = more likely the intended reading. */
  score: number;
  /** Whether the value sits inside the plausible physical band. */
  inRange: boolean;
  /** True when produced by re-inserting a dropped decimal point. */
  recovered: boolean;
  /** True when the value appeared in BOTH the full-image and crop reads. */
  agreed?: boolean;
  /** Word bounding box in image pixels, when ML Kit provided one. */
  frame?: Frame;
}

export interface ReadingScan {
  /** Best guess — a number ("6.98") or a device sentinel ("LO"); null if none. */
  best: string | null;
  /** Which kind of reading `best` is, or null when nothing was found. */
  kind: ReadingKind | null;
  /**
   * True when the best guess is NOT a trustworthy reading (out of band, no
   * decimal, nothing found, or the two passes disagreed) — the UI should warn /
   * ask for manual entry rather than auto-accept it. A detected sentinel is
   * always confident.
   */
  lowConfidence: boolean;
  /**
   * True when the full-image and crop passes each found a confident reading but
   * they differed — the seven-segment digits are ambiguous, so the UI should
   * ask the inspector to pick / confirm.
   */
  disagreement?: boolean;
  /** Ranked, de-duplicated numeric candidates (best first). */
  candidates: ReadingCandidate[];
  /** Raw recognized text from the full image, kept for debugging / manual fallback. */
  rawText: string;
  /** Raw recognized text from the cropped+enlarged region, when a crop pass ran. */
  rawTextCrop?: string;
  /** Set when the crop/enlarge step threw — surfaced in the UI diagnostic. */
  cropError?: string;
  /** Seven-segment decoder trace (its decoded digits/segments) for the diagnostic. */
  decoderText?: string;
}

/** A pixel crop rectangle for expo-image-manipulator. */
export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/** A normalized aim-box region ([0..1] of image width/height). */
export interface ReadingAimBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The band of the meter's LCD the big reading sits in — a wide central strip.
 * The ambient temperature (top-right corner) and the buttons (bottom) fall
 * OUTSIDE it, so cropping to this region isolates the reading from the two
 * distractors that defeat full-frame OCR. MUST stay in sync with the camera's
 * on-screen aim box (CameraCaptureHost) so "fill the box" == what we OCR.
 */
export const READING_AIM_BOX: ReadingAimBox = { x: 0.08, y: 0.32, w: 0.84, h: 0.26 };

export interface ScanOptions {
  constraints?: ReadingConstraints;
  /** Normalized aim-box region to crop + OCR (from the camera guide). */
  region?: ReadingAimBox;
  /** Source image pixel dimensions (from the camera capture) — lets us crop
   *  without a fragile `Image.getSize` on the capture URI. */
  imageWidth?: number;
  imageHeight?: number;
}

export interface ReadingConstraints {
  /** Plausible physical minimum (same unit as the reading). */
  min: number;
  /** Plausible physical maximum. */
  max: number;
  /** Expected decimal places — used to recover a dropped decimal point. */
  decimals: number;
}

/**
 * Default band for a cable ground-clearance reading in METRES, tuned to real
 * field photos: readings cluster ~5-7 m and the meter tops out near 20 m, while
 * the on-screen ambient temperature is ~30-40 C — so this band cleanly rejects
 * the temperature distractor. The floor is 3 m because the meter shows "-LO-"
 * instead of a number below that, so ANY sub-3 m number is a misread.
 * TODO: make this per-item, driven by the checklist template, once OCR is used
 * for readings other than clearance.
 */
export const DEFAULT_READING_CONSTRAINTS: ReadingConstraints = {
  min: 3,
  max: 20,
  decimals: 2,
};

// Scoring weights, centralised + named so they're easy to tune against real
// field photos.
const W_HEIGHT = 3; // dominant signal: the aimed-at reading is the tallest text
const W_HAS_DECIMAL = 1; // sensor readings are decimals
const W_IN_RANGE = 2; // a physically-plausible magnitude
const P_OUT_OF_RANGE = 1.5; // penalty for an implausible magnitude
const P_RECOVERED = 0.75; // a decimal we re-inserted is less sure than one OCR saw
const P_LONG_INTEGER = 1.5; // 4+ digit bare integers look like serials / years

// Crop-and-enlarge tuning for the second OCR pass. The pad expands the ML Kit
// bounding box outward so the whole reading (plus its decimal point and a
// margin) survives any small coordinate mismatch; the target width upscales the
// crop so ML Kit sees big, crisp seven-segment glyphs.
const CROP_PAD_X_FRAC = 0.35; // horizontal pad, as a fraction of the box width
const CROP_PAD_Y_FRAC = 0.6; // vertical pad, as a fraction of the box height
const CROP_PAD_MIN_PX = 24; // …but never less than this many pixels
const UPSCALE_TARGET_WIDTH = 1000; // enlarge the crop toward this width (px)
const UPSCALE_MAX_FACTOR = 4; // …but never enlarge a tiny crop more than this
const SS_DECODE_WIDTH = 500; // resize the crop to this width for the pixel decoder

/**
 * Scan a captured image for a reading, targeting the value the inspector aimed
 * at rather than any number in the frame. Runs a full-image read, then a second
 * read on a tight crop of the located reading, and reconciles the two.
 */
export async function scanReadingFromImage(
  imageUri: string,
  options: ScanOptions = {},
): Promise<ReadingScan> {
  const {
    constraints = DEFAULT_READING_CONSTRAINTS,
    region,
    imageWidth,
    imageHeight,
  } = options;

  const full = await TextRecognition.recognize(imageUri);
  const scan1 = pickReading(full, constraints);

  // A below-range sentinel (LO) gains nothing from a re-read.
  if (scan1.kind === 'SENTINEL') {
    return scan1;
  }

  // Decide the crop rectangle. AIM-BOX MODE (preferred): the crew framed the
  // reading inside the on-screen box, so crop to that region — it isolates the
  // reading from the temperature (top-right) and buttons (bottom) that full-
  // frame OCR keeps grabbing. Otherwise fall back to LEGACY self-targeting on
  // ML Kit's best bounding box.
  const aimBoxMode = !!(region && imageWidth && imageHeight);
  let rect: CropRect | null = null;
  if (aimBoxMode) {
    rect = regionToRect(region as ReadingAimBox, imageWidth as number, imageHeight as number);
  } else if (scan1.candidates[0]?.frame) {
    const dims =
      imageWidth && imageHeight
        ? { width: imageWidth, height: imageHeight }
        : await getImageSize(imageUri);
    if (dims) {
      rect = computeCropRect(scan1.candidates[0].frame, dims.width, dims.height);
    }
  }
  if (!rect) {
    return scan1;
  }

  try {
    const cropUri = await cropAndUpscaleRect(imageUri, rect);
    const cropResult = await TextRecognition.recognize(cropUri);
    const scan2 = pickReading(cropResult, constraints);

    if (aimBoxMode) {
      // DETERMINISTIC seven-segment decode of the isolated reading — immune to
      // the temperature (cropped out) and to ML Kit's digit-shape confusion.
      // Best-effort: any failure just leaves us with the ML Kit crop read.
      let decoded: SevenSegmentResult;
      try {
        decoded = await decodeReadingFromRegion(imageUri, rect, constraints);
      } catch (decodeError) {
        decoded = {
          text: null,
          value: null,
          confident: false,
          digitCount: 0,
          debug: `err: ${errorMessage(decodeError)}`,
        };
      }

      const diag = {
        rawText: full.text,
        rawTextCrop: cropResult.text,
        decoderText: decoded.debug,
      };

      if (decoded.confident && decoded.text) {
        // The decoder read every digit exactly and the value is in range — the
        // strongest possible signal. Use it, with ML Kit's guesses as alternates.
        const decoderCandidate: ReadingCandidate = {
          value: decoded.text,
          score: 100,
          inRange: true,
          recovered: false,
        };
        return {
          best: decoded.text,
          kind: 'NUMBER',
          lowConfidence: false,
          candidates: [
            decoderCandidate,
            ...scan2.candidates.filter((c) => c.value !== decoded.text),
          ],
          ...diag,
        };
      }
      // Decoder unsure → fall back to the ML Kit crop read; keep its trace so the
      // field diagnostic shows what the decoder saw (for tuning).
      return { ...scan2, ...diag };
    }
    return reconcileScans(scan1, scan2);
  } catch (error) {
    // Surface the failure (don't swallow it) so the field diagnostic tells us
    // WHY a crop didn't run, then fall back to the full-frame read.
    return { ...scan1, cropError: errorMessage(error) };
  }
}

/**
 * Deterministic seven-segment decode of a crop region: crop → modest JPEG →
 * decode to pixels (pure JS, no native access) → grayscale → segment-decode.
 * Throws propagate to the caller (→ ML Kit fallback).
 */
async function decodeReadingFromRegion(
  uri: string,
  rect: CropRect,
  constraints: ReadingConstraints,
): Promise<SevenSegmentResult> {
  const context = ImageManipulator.manipulate(uri).crop(rect).resize({ width: SS_DECODE_WIDTH });
  const ref = await context.renderAsync();
  const out = await ref.saveAsync({ compress: 0.92, format: SaveFormat.JPEG, base64: true });
  if (!out.base64) {
    return { text: null, value: null, confident: false, digitCount: 0, debug: 'no base64' };
  }
  const bytes = base64ToBytes(out.base64);
  const decoded = jpegDecode(bytes, { useTArray: true, formatAsRGBA: true });
  const gray = rgbaToGray(decoded.data, decoded.width, decoded.height);
  return decodeSevenSegment(gray, decoded.width, decoded.height, {
    min: constraints.min,
    max: constraints.max,
  });
}

/** Decode base64 → bytes without `Buffer` (Hermes has no global Buffer). */
function base64ToBytes(b64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  let len = b64.length;
  while (len > 0 && b64[len - 1] === '=') len--;
  const out = new Uint8Array((len * 3) >> 2);
  let p = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    buffer = (buffer << 6) | lookup[b64.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}

/**
 * Back-compat: resolve to just the best reading string ("6.98" or "LO"). Returns
 * null when the scan is low-confidence, so a suspect value (e.g. the on-screen
 * temperature) is never silently written into the reading field.
 */
export async function recognizeReadingFromImage(
  imageUri: string,
  constraints: ReadingConstraints = DEFAULT_READING_CONSTRAINTS,
): Promise<string | null> {
  const { best, lowConfidence } = await scanReadingFromImage(imageUri, { constraints });
  return lowConfidence ? null : best;
}

/**
 * Core selection over an ML Kit result. Free of the native module (takes a
 * plain result) so it can be unit-tested against synthetic inputs.
 */
export function pickReading(
  result: Pick<TextRecognitionResult, 'text' | 'blocks'>,
  constraints: ReadingConstraints = DEFAULT_READING_CONSTRAINTS,
): ReadingScan {
  const rawText = result?.text ?? '';
  const words = collectWords(result);
  // No per-word geometry (older ML Kit / sparse result): fall back to flat text.
  const pool: RecognizedWord[] = words.length > 0 ? words : [{ text: rawText }];

  const sentinels: SentinelWord[] = [];
  for (const word of pool) {
    const sentinel = sentinelFromText(word.text);
    if (sentinel) {
      sentinels.push({ sentinel, frame: word.frame });
    }
  }

  const numericWords: NumericWord[] = pool.flatMap((word) =>
    numbersFromText(word.text).map((value) => ({ value, frame: word.frame })),
  );

  // A sentinel occupies the big central reading area. Accept it only when it is
  // at least as tall as any number we found — otherwise a small stray glyph
  // could hide a real reading. (With no geometry both heights are 0, so a
  // sentinel present in the text wins, which is what we want.)
  if (sentinels.length > 0) {
    const tallestSentinel = tallest(sentinels.map((entry) => entry.frame));
    const tallestNumber = tallest(numericWords.map((entry) => entry.frame));

    if (tallestSentinel >= tallestNumber) {
      return {
        best: sentinels[0].sentinel,
        kind: 'SENTINEL',
        lowConfidence: false,
        candidates: [],
        rawText,
      };
    }
  }

  const maxHeight = tallest(numericWords.map((entry) => entry.frame));
  const candidates = rankCandidates(numericWords, constraints, maxHeight);
  const best = candidates[0] ?? null;

  // Trust the reading only when it is in-band, has a decimal point (every real
  // reading on this display does — a bare in-band integer is almost always a
  // stray unit/mode glyph, or "-LO-" misread as "10"), AND was not produced by
  // decimal-RECOVERY. Recovery re-inserts a dropped point, which is exactly how
  // the on-screen temperature sneaks in (its "30.5" is read as "305" → "3.05",
  // a plausible clearance): a recovered value is offered as a tap-to-confirm
  // chip, never silently auto-filled.
  const lowConfidence =
    !best || !best.inRange || !best.value.includes('.') || best.recovered === true;

  return {
    best: best?.value ?? null,
    kind: best ? 'NUMBER' : null,
    lowConfidence,
    candidates,
    rawText,
  };
}

/**
 * Reconcile the full-image read (`full`) with the cropped+enlarged re-read
 * (`crop`). Pure so it can be unit-tested. The crop is a cleaner, bigger look at
 * the same digits, so it wins ties; but when both passes are confident AND
 * disagree, the digits are genuinely ambiguous — we flag low confidence so the
 * UI asks the inspector to confirm rather than auto-filling a guess.
 */
export function reconcileScans(full: ReadingScan, crop: ReadingScan): ReadingScan {
  // The tight crop surfaced a below-range sentinel — trust it, it's a hazard.
  if (crop.kind === 'SENTINEL') {
    return { ...crop, rawText: full.rawText, rawTextCrop: crop.rawText };
  }

  const conf1 = full.kind === 'NUMBER' && !full.lowConfidence;
  const conf2 = crop.kind === 'NUMBER' && !crop.lowConfidence;
  const c1 = full.best;
  const c2 = crop.best;

  const candidates = mergeCandidates(full.candidates, crop.candidates);

  let best: string | null;
  let lowConfidence: boolean;
  let disagreement = false;

  if (conf1 && conf2) {
    if (c1 === c2) {
      best = c2; // both passes agree — the strongest signal
      lowConfidence = false;
    } else {
      best = c2; // ambiguous digits — prefer the cleaner crop but make the
      lowConfidence = true; // inspector confirm (both are offered as chips)
      disagreement = true;
    }
  } else if (conf2) {
    best = c2; // the crop cleaned up an otherwise unsure read
    lowConfidence = false;
  } else if (conf1) {
    best = c1; // the crop couldn't read cleanly — trust the validated baseline
    lowConfidence = false;
  } else {
    best = c2 ?? c1; // neither pass is sure — surface something, flag it
    lowConfidence = true;
  }

  return {
    best,
    kind: best ? 'NUMBER' : null,
    lowConfidence,
    disagreement,
    candidates,
    rawText: full.rawText,
    rawTextCrop: crop.rawText,
  };
}

/**
 * Merge the candidate lists of two passes: de-dup by value (keeping the higher
 * score), mark values seen in BOTH passes as `agreed`, and rank agreed-in-both
 * first, then in-range, then by score. Pure.
 */
export function mergeCandidates(
  a: ReadingCandidate[],
  b: ReadingCandidate[],
): ReadingCandidate[] {
  const byValue = new Map<string, ReadingCandidate>();
  const listCount = new Map<string, number>();

  function absorb(list: ReadingCandidate[]) {
    const seenHere = new Set<string>();
    for (const candidate of list) {
      const prev = byValue.get(candidate.value);
      if (!prev || candidate.score > prev.score) {
        byValue.set(candidate.value, { ...candidate });
      }
      if (!seenHere.has(candidate.value)) {
        seenHere.add(candidate.value);
        listCount.set(candidate.value, (listCount.get(candidate.value) ?? 0) + 1);
      }
    }
  }
  absorb(a);
  absorb(b);

  const merged = [...byValue.values()].map((candidate) => ({
    ...candidate,
    agreed: (listCount.get(candidate.value) ?? 0) >= 2,
  }));

  return merged.sort((x, y) => {
    if (!!x.agreed !== !!y.agreed) {
      return x.agreed ? -1 : 1;
    }
    if (x.inRange !== y.inRange) {
      return x.inRange ? -1 : 1;
    }
    return y.score - x.score;
  });
}

/**
 * Compute a padded, clamped crop rectangle around an ML Kit word box. Pure so it
 * can be unit-tested. Returns null when the geometry is unusable.
 */
export function computeCropRect(
  frame: Frame,
  imageWidth: number,
  imageHeight: number,
): CropRect | null {
  if (
    !(imageWidth > 0) ||
    !(imageHeight > 0) ||
    !(frame.width > 0) ||
    !(frame.height > 0)
  ) {
    return null;
  }
  const padX = Math.max(frame.width * CROP_PAD_X_FRAC, CROP_PAD_MIN_PX);
  const padY = Math.max(frame.height * CROP_PAD_Y_FRAC, CROP_PAD_MIN_PX);
  const x0 = Math.max(0, Math.floor(frame.left - padX));
  const y0 = Math.max(0, Math.floor(frame.top - padY));
  const x1 = Math.min(imageWidth, Math.ceil(frame.left + frame.width + padX));
  const y1 = Math.min(imageHeight, Math.ceil(frame.top + frame.height + padY));
  const width = x1 - x0;
  const height = y1 - y0;
  if (width < 1 || height < 1) {
    return null;
  }
  return { originX: x0, originY: y0, width, height };
}

/**
 * Target width to enlarge a crop to for the re-read: push it toward
 * UPSCALE_TARGET_WIDTH, but never downscale and never blow a tiny crop up more
 * than UPSCALE_MAX_FACTOR×. Pure.
 */
export function upscaleTargetWidth(cropWidth: number): number {
  return Math.round(
    Math.min(cropWidth * UPSCALE_MAX_FACTOR, Math.max(UPSCALE_TARGET_WIDTH, cropWidth)),
  );
}

// --- Native helpers (image manipulation); isolated + best-effort. ---

/** Read an image's pixel dimensions; resolves null on failure. */
function getImageSize(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => resolve(null),
    );
  });
}

/**
 * Convert a normalized aim-box region + source dims into a clamped pixel crop
 * rectangle. Pure. Returns null when the geometry is unusable.
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

/**
 * Crop the source image to `rect` and enlarge it, returning the new file URI.
 * Throwing manipulator errors propagate to the caller's try/catch.
 */
async function cropAndUpscaleRect(uri: string, rect: CropRect): Promise<string> {
  const context = ImageManipulator.manipulate(uri)
    .crop(rect)
    .resize({ width: upscaleTargetWidth(rect.width) });
  const ref = await context.renderAsync();
  const output = await ref.saveAsync({ compress: 1, format: SaveFormat.JPEG });
  return output.uri;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface RecognizedWord {
  text: string;
  frame?: Frame;
}

interface NumericWord {
  value: string;
  frame?: Frame;
}

interface SentinelWord {
  sentinel: ReadingSentinel;
  frame?: Frame;
}

// Walk blocks -> lines -> elements (words), keeping the tightest box available.
function collectWords(result: Pick<TextRecognitionResult, 'blocks'>): RecognizedWord[] {
  const out: RecognizedWord[] = [];
  for (const block of result?.blocks ?? []) {
    for (const line of block.lines ?? []) {
      const elements = line.elements ?? [];
      if (elements.length > 0) {
        for (const element of elements) {
          out.push({ text: element.text, frame: element.frame });
        }
      } else {
        // Some results omit word-level elements; fall back to the line box.
        out.push({ text: line.text, frame: line.frame });
      }
    }
  }
  return out;
}

/**
 * A sentinel hiding in a recognized fragment. Tested per whitespace token so a
 * word like "HOLD" can never match, while "-LO-" / "L0" do.
 */
function sentinelFromText(text: string): ReadingSentinel | null {
  for (const token of text.split(/\s+/)) {
    const sentinel = normalizeReadingSentinel(token);
    if (sentinel) {
      return sentinel;
    }
  }
  return null;
}

function tallest(frames: Array<Frame | undefined>): number {
  return frames.reduce<number>((max, frame) => Math.max(max, frame?.height ?? 0), 0);
}

/**
 * Extract numeric tokens from a text fragment, repairing OCR's decimal quirks:
 * rejoin a decimal split by spaces ("5. 27" / "5 ,27") and normalise commas.
 */
export function numbersFromText(text: string): string[] {
  if (!text) {
    return [];
  }
  const normalized = text.replace(/(\d)\s*[.,]\s*(\d)/g, '$1.$2');
  return normalized.match(/\d+(?:\.\d+)?/g) ?? [];
}

function inRange(value: string, c: ReadingConstraints): boolean {
  const num = Number(value);
  return Number.isFinite(num) && num >= c.min && num <= c.max;
}

function rankCandidates(
  words: NumericWord[],
  constraints: ReadingConstraints,
  maxHeight = 0,
): ReadingCandidate[] {
  const scored: ReadingCandidate[] = [];

  for (const w of words) {
    scored.push(scoreCandidate(w.value, w.frame, false, constraints, maxHeight));

    // Decimal-recovery: if the raw token is out of band but re-inserting a
    // decimal point lands it in-band, offer that reading too.
    const recovered = recoverDecimal(w.value, constraints);
    if (recovered && recovered !== w.value) {
      scored.push(scoreCandidate(recovered, w.frame, true, constraints, maxHeight));
    }
  }

  // De-dup by value, keeping the best score.
  const byValue = new Map<string, ReadingCandidate>();
  for (const c of scored) {
    const prev = byValue.get(c.value);
    if (!prev || c.score > prev.score) {
      byValue.set(c.value, c);
    }
  }

  // In-range candidates always rank above out-of-range ones (so the ~30-40 C
  // temperature can never beat a valid clearance reading), then by score.
  return [...byValue.values()].sort((a, b) => {
    if (a.inRange !== b.inRange) {
      return a.inRange ? -1 : 1;
    }
    return b.score - a.score;
  });
}

function scoreCandidate(
  value: string,
  frame: Frame | undefined,
  recovered: boolean,
  constraints: ReadingConstraints,
  maxHeight: number,
): ReadingCandidate {
  const withinRange = inRange(value, constraints);
  let score = 1;

  // 1) Height dominance — the aimed-at reading is the tallest text in frame.
  if (frame && maxHeight > 0) {
    score += (frame.height / maxHeight) * W_HEIGHT;
  }

  // 2) Decimals — sensor readings have them.
  if (value.includes('.')) {
    score += W_HAS_DECIMAL;
  }

  // 3) Physical plausibility.
  score += withinRange ? W_IN_RANGE : -P_OUT_OF_RANGE;

  // 4) Long bare integers read like serials / years, not readings.
  if (!value.includes('.') && value.length >= 4) {
    score -= P_LONG_INTEGER;
  }

  // 5) A re-inserted decimal is less certain than one OCR actually saw.
  if (recovered) {
    score -= P_RECOVERED;
  }

  return { value, score, inRange: withinRange, recovered, frame };
}

/**
 * Turn an integer OCR likely dropped the point from ("698") into the decimal
 * that fits the expected band ("6.98"). Tries the expected decimal count first,
 * then 1 and 2 places; returns the first in-range result, else null.
 */
function recoverDecimal(
  value: string,
  constraints: ReadingConstraints,
): string | null {
  if (value.includes('.') || value.length < 2) {
    return null;
  }
  const places = [constraints.decimals, 1, 2].filter(
    (d, i, arr) => d > 0 && d < value.length && arr.indexOf(d) === i,
  );
  for (const d of places) {
    const candidate = `${value.slice(0, value.length - d)}.${value.slice(value.length - d)}`;
    if (inRange(candidate, constraints)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Back-compat helper (was the old public export). Returns the best NUMERIC
 * string from a flat text blob, now range-aware. Prefer `pickReading` when a
 * full ML Kit result (with geometry) is available.
 */
export function extractFirstNumber(
  text: string,
  constraints: ReadingConstraints = DEFAULT_READING_CONSTRAINTS,
): string | null {
  const scan = pickReading({ text, blocks: [] }, constraints);
  return scan.kind === 'NUMBER' ? scan.best : null;
}
