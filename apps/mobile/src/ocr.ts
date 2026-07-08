import TextRecognition, {
  Frame,
  TextRecognitionResult,
} from '@react-native-ml-kit/text-recognition';
import { normalizeReadingSentinel, type ReadingSentinel } from '@ascure/shared-utils';

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
   * decimal, or nothing found) — the UI should warn / ask for manual entry
   * rather than auto-accept it. A detected sentinel is always confident.
   */
  lowConfidence: boolean;
  /** Ranked, de-duplicated numeric candidates (best first). */
  candidates: ReadingCandidate[];
  /** Raw recognized text, kept for debugging / manual fallback. */
  rawText: string;
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

/**
 * Scan a captured image for a reading, targeting the value the inspector aimed
 * at rather than any number in the frame.
 */
export async function scanReadingFromImage(
  imageUri: string,
  constraints: ReadingConstraints = DEFAULT_READING_CONSTRAINTS,
): Promise<ReadingScan> {
  const result = await TextRecognition.recognize(imageUri);
  return pickReading(result, constraints);
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
  const { best, lowConfidence } = await scanReadingFromImage(imageUri, constraints);
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

  // Trust the reading only when it is in-band AND has a decimal point (every
  // real reading on this display does — a bare in-band integer is almost always
  // a stray unit/mode glyph, or "-LO-" misread as "10").
  const lowConfidence = !best || !best.inRange || !best.value.includes('.');

  return {
    best: best?.value ?? null,
    kind: best ? 'NUMBER' : null,
    lowConfidence,
    candidates,
    rawText,
  };
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
