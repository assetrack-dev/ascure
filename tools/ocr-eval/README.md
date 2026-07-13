# OCR eval harness — Smart Sensor seven-segment decoder

The **scoreboard** for fine-tuning the seven-segment reading decoder. It runs the
*exact* shared pipeline the mobile app and (later) the admin auto-check use —
`@ascure/shared-utils`: `regionToRect` → crop to `READING_AIM_BOX` → resize to
`SS_DECODE_WIDTH` → `decodeReadingFromRgba` — against a folder of photos, and
prints predicted-vs-actual, accuracy %, and a failure breakdown. One decoder,
one source of truth: tuning the constants in
`packages/shared-utils/src/seven-segment/index.ts` retunes mobile + admin + this
harness together.

## Run

```bash
# rebuild the shared decoder first if you changed its constants
pnpm --filter @ascure/shared-utils build

node tools/ocr-eval/run.cjs <photos-dir> [labels.csv] [--min 3] [--max 20]
```

`labels.csv` (optional; header optional):

```
filename,reading
IMG_0001.jpg,3.67
IMG_0002.jpg,6.42
IMG_0003.jpg,LO
```

- Readings are the true value on the LCD. `LO` marks a below-range capture — the
  decoder isn't expected to read it (that's the ML-Kit sentinel path on device),
  so `LO` rows are reported separately, never counted as decoder misses.
- Without a CSV the harness just prints each photo's prediction (eyeballing).
- The run header records the exact constants used, so each result is reproducible.

## Smoke test (no real photos needed)

```bash
node tools/ocr-eval/make-synthetic.cjs
node tools/ocr-eval/run.cjs tools/ocr-eval/samples-synthetic tools/ocr-eval/samples-synthetic/labels.csv
```

This renders seven-segment readings into the aim box and decodes them back —
a self-test of the image IO → crop → resize → decode wiring (not an accuracy
test). It is expected to be ~mostly green; the crude rectangular glyphs are not a
perfect LCD.

## Phase B (the gate) — real photos

Drop ~30–100 labeled real Smart Sensor photos into a folder + a `labels.csv`.
Best captured **through the in-app camera** (aim box filled) so the crop matches
production. Cover the hard cases: glare, tilt, dim light, different decimal
positions, and the `LO` case.

## Phase C — tune

Use the harness as the scoreboard: change one constant in the shared module,
rebuild, re-run, keep only regression-free gains. Fix systematic pipeline
failures it exposes.

### Known Phase-C leads (surfaced while building the harness)

- **Bounding-box segment sampling shifts for digits missing left segments.** The
  decoder samples the 7 segment windows over each digit's *tight* bounding box.
  A leftmost digit with no left verticals (2, 3, 7) has a right-shifted box, so
  the top/middle bars can bleed into the `f`/`e` (left) sample windows → a false
  left-segment hit (seen in the synthetic `3`→`9`). Candidate fix: sample over a
  fixed digit *pitch/cell* rather than the tight box. **Validate on real photos
  before changing** — don't tune to the synthetic.
