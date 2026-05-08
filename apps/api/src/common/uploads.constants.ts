import { resolve } from 'path';

export const UPLOADS_DIRECTORY = resolve(
  process.env.UPLOADS_DIR ?? resolve(__dirname, '..', '..', 'uploads'),
);

export const INSPECTION_IMAGES_URL_PREFIX = '/uploads/inspections';

export function buildInspectionImagesDirectory(inspectionId: string) {
  return resolve(UPLOADS_DIRECTORY, 'inspections', inspectionId);
}

export function buildInspectionImagePath(inspectionId: string, filename: string) {
  return `inspections/${inspectionId}/${filename}`;
}

export function buildInspectionImageUrl(inspectionId: string, filename: string) {
  return `${INSPECTION_IMAGES_URL_PREFIX}/${inspectionId}/${filename}`;
}
