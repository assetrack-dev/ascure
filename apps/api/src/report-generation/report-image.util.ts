import { readFile } from 'fs/promises';
import { extname } from 'path';
import { MimeType } from 'easy-template-x';
import type { ImageContent } from 'easy-template-x';
import { resolveUploadPath } from '../common/uploads.constants';

/** easy-template-x image formats we can embed (LibreOffice renders all of them). */
const EXTENSION_TO_FORMAT: Record<string, ImageContent['format']> = {
  '.jpg': MimeType.Jpeg,
  '.jpeg': MimeType.Jpeg,
  '.png': MimeType.Png,
  '.gif': MimeType.Gif,
  '.bmp': MimeType.Bmp,
};

/**
 * The box each report photo is scaled to fit, aspect ratio preserved. The units
 * are PIXELS — easy-template-x renders an image's width/height as px → EMU at
 * 96 dpi (px * 9525). Sized to fit inside a narrow multi-up image cell in the
 * report template: a docx table cell narrower than the rendered image does NOT
 * shrink it — LibreOffice CLIPS the right/bottom edge, which was cropping the
 * burned-in GPS/timestamp watermark at the photo's bottom-right.
 *
 * 130 px ≈ 1.35 in fits the SAVR template's ~1.45 in (≈2288 dxa) image cells
 * with margin to spare. To render LARGER report photos, widen the template's
 * image cells AND raise these two values together — the cell can't enlarge a
 * photo, only this box can.
 */
const MAX_IMAGE_WIDTH = 130;
const MAX_IMAGE_HEIGHT = 175;

/**
 * Photo records store either a `storageKey` (relative to the uploads dir, e.g.
 * `defects/<id>/<file>.jpg`) or only a public `url` (e.g.
 * `/uploads/inspections/<id>/<file>.jpg`). Both resolve to the same on-disk
 * path under UPLOADS_DIRECTORY.
 */
export function resolvePhotoDiskPath(photo: {
  storageKey?: string | null;
  url?: string | null;
}): string | null {
  if (photo.storageKey && photo.storageKey.trim()) {
    return resolveUploadPath(photo.storageKey);
  }
  if (photo.url && photo.url.trim()) {
    // Strip the public `/uploads/` prefix to get a storage-relative key.
    const key = photo.url.replace(/^\/+/, '').replace(/^uploads\//, '');
    return resolveUploadPath(key);
  }
  return null;
}

/**
 * Read a photo off disk and shape it into an easy-template-x image value. Returns
 * `null` when the file is missing or the format is unsupported so the caller can
 * skip it (a missing photo must never abort a whole report).
 */
export async function loadReportImage(photo: {
  storageKey?: string | null;
  url?: string | null;
  fileName?: string | null;
  filename?: string | null;
}): Promise<ImageContent | null> {
  const diskPath = resolvePhotoDiskPath(photo);
  if (!diskPath) {
    return null;
  }

  const nameForExt = photo.fileName ?? photo.filename ?? diskPath;
  const format = EXTENSION_TO_FORMAT[extname(nameForExt).toLowerCase()];
  if (!format) {
    return null;
  }

  let source: Buffer;
  try {
    source = await readFile(diskPath);
  } catch {
    return null;
  }

  const { width, height } = fitWithinBox(sniffImageSize(source, format));

  return { _type: 'image', source, format, width, height };
}

/** Largest plausible photo edge; anything beyond is treated as a bad header. */
const MAX_SANE_DIMENSION = 20000;

/** Scale a natural size down into MAX_IMAGE_WIDTH × MAX_IMAGE_HEIGHT, keeping aspect. */
function fitWithinBox(size: { width: number; height: number }): {
  width: number;
  height: number;
} {
  // Reject nonsense dimensions from a malformed/hostile header (negative, zero,
  // NaN, or absurdly large) and fall back to the box size — never let a bad
  // header drive a division-by-zero or a giant allocation downstream.
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0 ||
    size.width > MAX_SANE_DIMENSION ||
    size.height > MAX_SANE_DIMENSION
  ) {
    return { width: MAX_IMAGE_WIDTH, height: MAX_IMAGE_HEIGHT };
  }
  const scale = Math.min(
    MAX_IMAGE_WIDTH / size.width,
    MAX_IMAGE_HEIGHT / size.height,
    1,
  );
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/**
 * Read the pixel dimensions straight from the file header for the formats we
 * embed. Avoids pulling in an image library. Falls back to the box size when the
 * header can't be parsed (a square-ish default is the least-bad guess).
 */
function sniffImageSize(
  buffer: Buffer,
  format: ImageContent['format'],
): { width: number; height: number } {
  const fallback = { width: MAX_IMAGE_WIDTH, height: MAX_IMAGE_HEIGHT };
  try {
    if (format === MimeType.Png && buffer.length >= 24) {
      // IHDR width/height are big-endian uint32 at byte offsets 16 and 20.
      return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
      };
    }
    if (format === MimeType.Jpeg) {
      return sniffJpegSize(buffer) ?? fallback;
    }
    if (format === MimeType.Bmp && buffer.length >= 26) {
      return {
        width: buffer.readInt32LE(18),
        height: Math.abs(buffer.readInt32LE(22)),
      };
    }
    if (format === MimeType.Gif && buffer.length >= 10) {
      return {
        width: buffer.readUInt16LE(6),
        height: buffer.readUInt16LE(8),
      };
    }
  } catch {
    // fall through to fallback
  }
  return fallback;
}

/** Walk JPEG segments to the first Start-Of-Frame marker for width/height. */
function sniffJpegSize(
  buffer: Buffer,
): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    // SOF0..SOF15 carry frame dimensions, excluding the non-frame markers.
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) {
      return null;
    }
    offset += 2 + segmentLength;
  }
  return null;
}
