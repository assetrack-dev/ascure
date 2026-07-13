#!/usr/bin/env node
/**
 * OCR eval harness (Phase A) — the scoreboard for fine-tuning the seven-segment
 * decoder. Runs the SAME shared pipeline the mobile app + admin auto-check use
 * (@ascure/shared-utils: regionToRect → crop to READING_AIM_BOX → resize to
 * SS_DECODE_WIDTH → decodeReadingFromRgba), against a folder of real photos, and
 * prints predicted-vs-actual + accuracy% + a failure breakdown.
 *
 * Usage:
 *   node tools/ocr-eval/run.cjs <photos-dir> [labels.csv] [--min 3] [--max 20]
 *
 * labels.csv (optional; header optional):
 *   filename,reading
 *   IMG_001.jpg,3.67
 *   IMG_002.jpg,6.42
 *   IMG_003.jpg,LO         # sentinel — decoder is not expected to read it
 *
 * Without labels it just prints each photo's prediction (for eyeballing). The
 * decoder handles NUMBERS; "LO"/below-range is an ML-Kit sentinel path on device,
 * so labeled "LO" rows are reported separately, not counted as decoder misses.
 *
 * Phase B: drop the owner's labeled photos in the dir + a labels.csv, re-run.
 * Phase C: sweep the constants in packages/shared-utils/src/seven-segment (rebuild
 * shared-utils), re-run, keep only regression-free gains.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ss = require('@ascure/shared-utils');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);

function parseArgs(argv) {
  const args = { dir: null, labels: null, min: 3, max: 20, region: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--min') args.min = Number(argv[++i]);
    else if (a === '--max') args.max = Number(argv[++i]);
    else if (a === '--region') {
      // --region x,y,w,h (normalized 0..1) to simulate a tighter capture guide.
      const [x, y, w, h] = String(argv[++i]).split(',').map(Number);
      args.region = { x, y, w, h };
    } else rest.push(a);
  }
  args.dir = rest[0] ?? null;
  args.labels = rest[1] ?? null;
  return args;
}

/** Read filename,reading CSV → Map<filename, expected>. Header tolerated. */
function loadLabels(csvPath) {
  const map = new Map();
  const raw = fs.readFileSync(csvPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [file, reading] = trimmed.split(',').map((s) => (s ?? '').trim());
    if (!file || !reading) continue;
    if (/^(file|filename|image)$/i.test(file)) continue; // header
    map.set(file, reading);
  }
  return map;
}

function isSentinel(v) {
  return typeof v === 'string' && /^lo$/i.test(v.trim());
}

/** Compare a decoder reading to an expected label numerically (3.67 == 3.670). */
function readingsMatch(predicted, expected) {
  if (predicted == null) return false;
  const p = Number(predicted);
  const e = Number(expected);
  if (Number.isFinite(p) && Number.isFinite(e)) return Math.abs(p - e) < 1e-9;
  return String(predicted) === String(expected);
}

async function decodeFile(filePath, constraints, region) {
  const aim = region || ss.READING_AIM_BOX;
  // rotate() applies EXIF orientation so the crop lines up with what the camera
  // showed (mobile bakes orientation before OCR too). metadata() reports the
  // STORED dims; for a 90°/270° EXIF rotation (orientation 5-8) the upright dims
  // are swapped — use the oriented dims so the aim-box crop lands correctly (and
  // doesn't exceed bounds → "bad extract area").
  const meta = await sharp(filePath).metadata();
  let width = meta.width;
  let height = meta.height;
  if (meta.orientation && meta.orientation >= 5) {
    [width, height] = [height, width];
  }
  if (!width || !height) {
    return { error: 'no dimensions', decoded: null };
  }
  const rect = ss.regionToRect(aim, width, height);
  if (!rect) {
    return { error: 'region unusable', decoded: null, dims: { width, height } };
  }
  const { data, info } = await sharp(filePath)
    .rotate()
    .extract({
      left: rect.originX,
      top: rect.originY,
      width: rect.width,
      height: rect.height,
    })
    .resize({ width: ss.SS_DECODE_WIDTH })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const decoded = ss.decodeReadingFromRgba(data, info.width, info.height, constraints);
  return { error: null, decoded, dims: { width, height }, crop: { w: info.width, h: info.height } };
}

/** Bucket a non-confident decode by its debug reason for the breakdown. */
function failureBucket(debug) {
  if (!debug) return 'other';
  if (debug.includes('unknown segments')) return 'unknown-segments';
  if (debug.includes('band too short')) return 'band-too-short';
  if (debug.includes('no dark pixels')) return 'no-dark-pixels';
  if (debug.includes('no clusters') || debug.includes('no columns') || debug.includes('no digits'))
    return 'no-digits-found';
  if (debug.includes('too many digits')) return 'too-many-digits';
  if (debug.includes('too small')) return 'crop-too-small';
  if (debug.includes('(rej)')) return 'out-of-range-or-badplace';
  if (debug.startsWith('err:')) return 'pipeline-error';
  return 'other';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir) {
    console.error('usage: node tools/ocr-eval/run.cjs <photos-dir> [labels.csv] [--min N] [--max N]');
    process.exit(2);
  }
  const dir = path.resolve(args.dir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`not a directory: ${dir}`);
    process.exit(2);
  }
  const constraints = { min: args.min, max: args.max };
  const labels = args.labels ? loadLabels(path.resolve(args.labels)) : null;

  const files = fs
    .readdirSync(dir)
    .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
    .sort();
  if (files.length === 0) {
    console.error(`no images in ${dir}`);
    process.exit(1);
  }

  // Record the exact tuning that produced these numbers (essential for Phase C).
  console.log(`\nOCR eval — ${dir}  (${files.length} image${files.length === 1 ? '' : 's'})`);
  console.log(
    `constraints min=${constraints.min} max=${constraints.max} · SS_DECODE_WIDTH=${ss.SS_DECODE_WIDTH} · aim=${JSON.stringify(ss.READING_AIM_BOX)}`,
  );
  console.log(
    `tuning: SEG_ON=${ss.SEG_ON_THRESH} ROW_BAND=${ss.ROW_BAND_FRAC} COL_GAP=${ss.COL_GAP_FRAC} MERGE_GAP=${ss.MERGE_GAP_FRAC} DEC_MAX=${ss.DECIMAL_MAX_FRAC} ONE_MAX_W=${ss.ONE_MAX_W_FRAC} MIN_CLUSTER=${ss.MIN_CLUSTER_ON}`,
  );
  console.log('─'.repeat(96));
  console.log(
    `${'file'.padEnd(26)} ${'expect'.padEnd(8)} ${'predict'.padEnd(8)} ok  trace`,
  );
  console.log('─'.repeat(96));

  let labeled = 0;
  let confident = 0;
  let correct = 0;
  let sentinelRows = 0;
  const failures = {};
  const wrong = [];

  for (const file of files) {
    let res;
    try {
      res = await decodeFile(path.join(dir, file), constraints, args.region);
    } catch (e) {
      res = { error: e && e.message ? e.message : String(e), decoded: null };
    }
    const expected = labels ? labels.get(file) : undefined;
    const decoded = res.decoded;
    const predicted = decoded && decoded.confident ? decoded.text : null;
    const trace = res.error ? `ERR: ${res.error}` : decoded ? decoded.debug : '(none)';

    if (predicted != null) confident++;

    let okMark = ' ';
    if (expected !== undefined) {
      if (isSentinel(expected)) {
        okMark = 'S'; // sentinel — decoder N/A
        sentinelRows++;
      } else {
        labeled++;
        if (readingsMatch(predicted, expected)) {
          okMark = '✓';
          correct++;
        } else {
          okMark = '✗';
          wrong.push({ file, expected, predicted });
          const bucket = predicted != null ? 'wrong-value' : failureBucket(trace);
          failures[bucket] = (failures[bucket] || 0) + 1;
        }
      }
    }

    console.log(
      `${file.padEnd(26)} ${String(expected ?? '·').padEnd(8)} ${String(predicted ?? '·').padEnd(8)} ${okMark}   ${trace}`,
    );
  }

  console.log('─'.repeat(96));
  if (labeled > 0) {
    const pct = ((correct / labeled) * 100).toFixed(1);
    console.log(`Summary: ${correct}/${labeled} correct (${pct}%) · confident reads: ${confident}/${files.length}` + (sentinelRows ? ` · ${sentinelRows} sentinel row(s) skipped` : ''));
    const buckets = Object.entries(failures).sort((a, b) => b[1] - a[1]);
    if (buckets.length) {
      console.log('Failure breakdown:');
      for (const [k, v] of buckets) console.log(`  ${k.padEnd(26)} ${v}`);
    }
    if (wrong.length) {
      console.log('Misses:');
      for (const w of wrong) console.log(`  ${w.file}: expected ${w.expected}, got ${w.predicted ?? '(no confident read)'}`);
    }
  } else {
    console.log(`No labels provided → ${confident}/${files.length} confident reads (predictions only).`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
