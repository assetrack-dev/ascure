#!/usr/bin/env node
/**
 * Generate synthetic Smart-Sensor-style photos to smoke-test the eval harness
 * end-to-end (image IO → crop to aim box → resize → decode) WITHOUT real photos.
 * Draws seven-segment digits into the READING_AIM_BOX band of a portrait canvas,
 * saves JPEGs + a labels.csv. This is a PIPELINE self-test, not an accuracy test
 * (real accuracy comes from the owner's photos in Phase B).
 *
 *   node tools/ocr-eval/make-synthetic.cjs
 *   node tools/ocr-eval/run.cjs tools/ocr-eval/samples-synthetic tools/ocr-eval/samples-synthetic/labels.csv
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ss = require('@ascure/shared-utils');

const W = 900;
const H = 1200;
const BG = 235; // light LCD background
const FG = 25; // dark lit segment
const OUT = path.join(__dirname, 'samples-synthetic');

// Lit segments per digit, order a,b,c,d,e,f,g (mirror of the decoder table).
const SEGMENTS = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
};

function fillRect(buf, x0, y0, x1, y1) {
  const ax0 = Math.max(0, Math.round(x0));
  const ay0 = Math.max(0, Math.round(y0));
  const ax1 = Math.min(W - 1, Math.round(x1));
  const ay1 = Math.min(H - 1, Math.round(y1));
  for (let y = ay0; y <= ay1; y++) {
    for (let x = ax0; x <= ax1; x++) {
      buf[y * W + x] = FG;
    }
  }
}

/**
 * Draw one seven-segment digit inside cell (x,y,w,h). Segment rectangles are
 * sized to fully cover the decoder's sampleSegments() sampling windows, so a
 * drawn segment reads as clearly lit (this is a self-consistency smoke test of
 * the image→decode path; real-glyph robustness is Phase C on owner photos).
 */
function drawDigit(buf, digit, x, y, w, h) {
  const segs = SEGMENTS[digit] || '';
  const has = (s) => segs.includes(s);
  const rx = (fx0, fy0, fx1, fy1) =>
    fillRect(buf, x + fx0 * w, y + fy0 * h, x + fx1 * w, y + fy1 * h);
  // horizontals a/g/d span x[.30,.70] — inside the a/g/d sample windows but clear
  // of the f/b/e/c vertical windows (x<.24, x>.76) so they don't bleed a false
  // vertical-segment hit. verticals f/b/e/c cover the side windows.
  if (has('a')) rx(0.3, 0.02, 0.7, 0.22);
  if (has('g')) rx(0.3, 0.4, 0.7, 0.6);
  if (has('d')) rx(0.3, 0.78, 0.7, 0.98);
  if (has('f')) rx(0.0, 0.14, 0.24, 0.46);
  if (has('b')) rx(0.76, 0.14, 1.0, 0.46);
  if (has('e')) rx(0.0, 0.54, 0.24, 0.86);
  if (has('c')) rx(0.76, 0.54, 1.0, 0.86);
}

/** Render a reading string ("3.67") centered in the aim-box band. */
function renderReading(reading) {
  const buf = new Uint8Array(W * H).fill(BG);
  const aim = ss.READING_AIM_BOX;
  const bandX0 = aim.x * W;
  const bandX1 = (aim.x + aim.w) * W;
  const bandY0 = aim.y * H;
  const bandH = aim.h * H;
  const dh = bandH * 0.72; // digit height (fills most of the band)
  const dy = bandY0 + (bandH - dh) / 2;
  const wideW = dh * 0.6; // normal digit width
  const oneW = dh * 0.24; // "1" is narrow
  const dotW = dh * 0.16;
  const gap = dh * 0.14;

  // Measure total width to center it.
  let total = 0;
  for (const ch of reading) {
    if (ch === '.') total += dotW + gap;
    else if (ch === '1') total += oneW + gap;
    else total += wideW + gap;
  }
  total -= gap;
  let x = bandX0 + (bandX1 - bandX0 - total) / 2;

  for (const ch of reading) {
    if (ch === '.') {
      fillRect(buf, x, dy + dh - dotW, x + dotW, dy + dh);
      x += dotW + gap;
    } else if (ch === '1') {
      drawDigit(buf, '1', x, dy, oneW, dh);
      x += oneW + gap;
    } else {
      drawDigit(buf, ch, x, dy, wideW, dh);
      x += wideW + gap;
    }
  }

  // Add a distractor "temperature" up in the top-right corner (outside the aim
  // box) — the decoder must never see it, proving the crop isolates the reading.
  drawDigit(buf, '3', W * 0.72, H * 0.06, 40, 70);
  drawDigit(buf, '0', W * 0.8, H * 0.06, 40, 70);

  // Grayscale → RGB buffer for sharp, then JPEG (mimics camera compression).
  const rgb = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    rgb[i * 3] = buf[i];
    rgb[i * 3 + 1] = buf[i];
    rgb[i * 3 + 2] = buf[i];
  }
  return sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 88 });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const cases = ['3.67', '6.42', '12.45', '7.58', '4.05'];
  const rows = ['filename,reading'];
  for (let i = 0; i < cases.length; i++) {
    const reading = cases[i];
    const file = `synth_${String(i + 1).padStart(2, '0')}_${reading.replace('.', 'p')}.jpg`;
    await renderReading(reading).toFile(path.join(OUT, file));
    rows.push(`${file},${reading}`);
  }
  fs.writeFileSync(path.join(OUT, 'labels.csv'), rows.join('\n') + '\n');
  console.log(`wrote ${cases.length} synthetic photos + labels.csv to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
