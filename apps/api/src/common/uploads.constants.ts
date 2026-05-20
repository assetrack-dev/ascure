import { resolve } from 'path';

export const UPLOADS_DIRECTORY = resolve(
  process.env.UPLOADS_DIR ?? resolve(__dirname, '..', '..', 'uploads'),
);

export const INSPECTION_IMAGES_URL_PREFIX = '/uploads/inspections';
export const SITE_VISIT_IMAGES_URL_PREFIX = '/uploads/site-visits';
export const DEFECT_EVIDENCE_IMAGES_URL_PREFIX = '/uploads/defects';

export function buildInspectionImagesDirectory(inspectionId: string) {
  return resolve(UPLOADS_DIRECTORY, 'inspections', inspectionId);
}

export function buildInspectionImagePath(inspectionId: string, filename: string) {
  return `inspections/${inspectionId}/${filename}`;
}

export function buildInspectionImageUrl(inspectionId: string, filename: string) {
  return `${INSPECTION_IMAGES_URL_PREFIX}/${inspectionId}/${filename}`;
}

export function buildSiteVisitImagesDirectory(siteVisitId: string) {
  return resolve(UPLOADS_DIRECTORY, 'site-visits', siteVisitId);
}

export function buildSiteVisitImagePath(siteVisitId: string, filename: string) {
  return `site-visits/${siteVisitId}/${filename}`;
}

export function buildSiteVisitImageUrl(siteVisitId: string, filename: string) {
  return `${SITE_VISIT_IMAGES_URL_PREFIX}/${siteVisitId}/${filename}`;
}

export function buildDefectEvidenceImagesDirectory(defectId: string) {
  return resolve(UPLOADS_DIRECTORY, 'defects', defectId);
}

export function buildDefectEvidenceImagePath(defectId: string, filename: string) {
  return `defects/${defectId}/${filename}`;
}

export function buildDefectEvidenceImageUrl(defectId: string, filename: string) {
  return `${DEFECT_EVIDENCE_IMAGES_URL_PREFIX}/${defectId}/${filename}`;
}
