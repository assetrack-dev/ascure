import { UnsupportedMediaTypeException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { extname } from 'path';

const MB = 1024 * 1024;

/**
 * Build MulterOptions that bound upload size and gate the file type by MIME OR
 * extension — either match accepts. (Accepting on extension too means a
 * correctly-named file isn't rejected just because a client sent a generic
 * Content-Type, while obvious wrong types are still kept out.) A rejected type →
 * 415 (thrown here); an oversized file → 413 (mapped by MulterExceptionFilter).
 */
function uploadOptions(
  maxBytes: number,
  mimeTypes: string[],
  extensions: string[],
): MulterOptions {
  const allowedMimes = new Set(mimeTypes.map((m) => m.toLowerCase()));
  const allowedExts = new Set(extensions.map((e) => e.toLowerCase()));
  return {
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      const mimeOk = allowedMimes.has((file.mimetype || '').toLowerCase());
      const extOk = allowedExts.has(extname(file.originalname || '').toLowerCase());
      if (mimeOk || extOk) {
        cb(null, true);
      } else {
        cb(
          new UnsupportedMediaTypeException(
            `Unsupported file type. Allowed: ${extensions.join(', ')}.`,
          ),
          false,
        );
      }
    },
  };
}

/** Field / evidence photos (inspections, site-visits, defects). */
export const IMAGE_UPLOAD_OPTIONS = uploadOptions(
  25 * MB,
  ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'],
);

/**
 * Defect evidence — photos OR a short clip (e.g. an emergency NCV live-current
 * check, or maintenance proof). Allows the image types plus mp4/quicktime at a
 * higher cap; the mobile caps recording at ~30s so a clip stays well under this.
 */
export const EVIDENCE_MEDIA_UPLOAD_OPTIONS = uploadOptions(
  60 * MB,
  [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/quicktime',
  ],
  ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.mp4', '.mov'],
);

/** AppSheet / masterlist spreadsheet imports. */
export const SPREADSHEET_UPLOAD_OPTIONS = uploadOptions(
  25 * MB,
  [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
  ],
  ['.xlsx', '.xls', '.csv'],
);

/** Visual-report .docx templates (flow to LibreOffice / Gotenberg). */
export const DOCX_UPLOAD_OPTIONS = uploadOptions(
  10 * MB,
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.docx'],
);
