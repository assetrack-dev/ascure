import { resolve } from 'path';

export const UPLOADS_DIRECTORY = resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'uploads',
);

export const INSPECTION_IMAGES_DIRECTORY = resolve(
  UPLOADS_DIRECTORY,
  'inspection-images',
);

export const INSPECTION_IMAGES_URL_PREFIX = '/uploads/inspection-images';

export function buildInspectionImageUrl(filename: string) {
  return `${INSPECTION_IMAGES_URL_PREFIX}/${filename}`;
}
