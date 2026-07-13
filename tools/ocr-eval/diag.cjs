#!/usr/bin/env node
/**
 * Phase C diagnostic — dumps the decoder's internal view of a photo so we can
 * SEE why it fails: the aim-box crop (grayscale), the Otsu binary mask, the
 * detected digit band, and the cluster x-ranges. Writes PNGs to .ocr-crop-preview/
 * and prints stats. Diagnostic-only (re-implements the early pipeline stages so
 * we can visualise them); the production decoder stays in @ascure/shared-utils.
 *
 *   node tools/ocr-eval/diag.cjs 1 32 56 100
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ss = require('@ascure/shared-utils');

const OUT = path.join(process.cwd(), '.ocr-crop-preview');

function otsu(gray, n) {
  const hist = new Int32Array(256);
  for (let i = 0; i < n; i++) hist[gray[i] | 0]++;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, maxVar = -1, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) { maxVar = between; threshold = t; }
  }
  return threshold;
}

async function loadGrayCrop(file) {
  const meta = await sharp(file).metadata();
  let w = meta.width, h = meta.height;
  if (meta.orientation && meta.orientation >= 5) [w, h] = [h, w];
  let aim = ss.READING_AIM_BOX;
  if (process.env.REGION) {
    const [x, y, ww, hh] = process.env.REGION.split(',').map(Number);
    aim = { x, y, w: ww, h: hh };
  }
  const rect = ss.regionToRect(aim, w, h);
  const { data, info } = await sharp(file)
    .rotate()
    .extract({ left: rect.originX, top: rect.originY, width: rect.width, height: rect.height })
    .resize({ width: ss.SS_DECODE_WIDTH })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const gray = ss.rgbaToGray(data, info.width, info.height);
  return { gray, width: info.width, height: info.height };
}

async function diag(num) {
  const file = path.join('sample-image', `${num}.jpg`);
  const { gray, width, height } = await loadGrayCrop(file);
  const n = width * height;

  // Adaptive local-mean mask (mirror the shared decoder).
  const th = 0;
  const iw = width + 1;
  const integral = new Float64Array(iw * (height + 1));
  for (let y = 0; y < height; y++) { let rs = 0; for (let x = 0; x < width; x++) { rs += gray[y * width + x]; integral[(y + 1) * iw + (x + 1)] = integral[y * iw + (x + 1)] + rs; } }
  const r = Math.max(3, Math.round(Math.min(width, height) * ss.ADAPTIVE_WINDOW_FRAC));
  const on = new Uint8Array(n);
  let onCount = 0;
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(height - 1, y + r);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(width - 1, x + r);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = integral[(y1 + 1) * iw + (x1 + 1)] - integral[y0 * iw + (x1 + 1)] - integral[(y1 + 1) * iw + x0] + integral[y0 * iw + x0];
      if (gray[y * width + x] < sum / area - ss.ADAPTIVE_C) { on[y * width + x] = 1; onCount++; }
    }
  }
  const flipped = false;

  // Row projection → band (mirror the decoder).
  const rowSum = new Int32Array(height);
  for (let y = 0; y < height; y++) { let s = 0; for (let x = 0; x < width; x++) s += on[y * width + x]; rowSum[y] = s; }
  let maxRow = 0; for (let y = 0; y < height; y++) if (rowSum[y] > maxRow) maxRow = rowSum[y];
  const rowThresh = maxRow * 0.15;
  let yTop = 0; while (yTop < height && rowSum[yTop] < rowThresh) yTop++;
  let yBot = height - 1; while (yBot > yTop && rowSum[yBot] < rowThresh) yBot--;
  const bandH = yBot - yTop + 1;

  // Column projection within band → runs.
  const colSum = new Int32Array(width);
  for (let x = 0; x < width; x++) { let s = 0; for (let y = yTop; y <= yBot; y++) s += on[y * width + x]; colSum[x] = s; }
  const colThresh = Math.max(1, bandH * 0.08);
  const runs = [];
  let x = 0;
  while (x < width) {
    if (colSum[x] >= colThresh) { const st = x; while (x < width && colSum[x] >= colThresh) x++; runs.push([st, x - 1]); }
    else x++;
  }

  // Render: grayscale crop + binary mask (on=black), with the band drawn.
  const maskRgb = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) { const v = on[i] ? 0 : 255; maskRgb[i * 3] = v; maskRgb[i * 3 + 1] = v; maskRgb[i * 3 + 2] = v; }
  // Draw band edges (red) on the mask.
  for (const y of [yTop, yBot]) { if (y >= 0 && y < height) for (let xx = 0; xx < width; xx++) { const i = (y * width + xx) * 3; maskRgb[i] = 255; maskRgb[i + 1] = 0; maskRgb[i + 2] = 0; } }
  await sharp(maskRgb, { raw: { width, height, channels: 3 } }).png().toFile(path.join(OUT, `mask-${num}.png`));
  await sharp(gray, { raw: { width, height, channels: 1 } }).png().toFile(path.join(OUT, `gray-${num}.png`));

  const full = ss.decodeSevenSegment(gray, width, height, { min: 3, max: 20 });
  console.log(
    `${num}.jpg ${width}x${height} th=${th} on=${(onCount / n * 100).toFixed(0)}%${flipped ? '(flipped)' : ''} ` +
      `band=[${yTop},${yBot}] bandH=${bandH} runs=${runs.length} [${runs.map((r) => r.join('-')).join(', ')}]  => ${full.debug}`,
  );
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const nums = process.argv.slice(2);
  if (!nums.length) { console.error('usage: node tools/ocr-eval/diag.cjs 1 32 56'); process.exit(2); }
  for (const num of nums) await diag(num);
}
main().catch((e) => { console.error(e); process.exit(1); });
