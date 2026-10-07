/**
 * Survey photos that help a maintenance crew recognise a pole on site
 * (docs/PLAN-maintenance-flow.md §14, I27). The whole-pole IMAGE field comes
 * first, then general (untagged) photos, then any other item photo.
 */
export const MAX_POLE_PHOTOS = 4;

const WHOLE_POLE_LABEL = /\bTIANG\b|KESELURUHAN|OVERALL|\bPOLE\b/i;

export type PolePhotoSource = {
  id: string;
  url: string;
  templateItemId: string | null;
  sizeBytes: number | null;
  createdAt: Date;
};

export type PolePhoto = { id: string; url: string; label: string | null; sizeBytes: number | null };

export function pickPolePhotos(
  images: PolePhotoSource[],
  itemLabels: Map<string, string>,
  limit = MAX_POLE_PHOTOS,
): PolePhoto[] {
  const rank = (image: PolePhotoSource) => {
    if (!image.templateItemId) return 1;
    return WHOLE_POLE_LABEL.test(itemLabels.get(image.templateItemId) ?? '') ? 0 : 2;
  };
  return images
    .map((image, index) => ({ image, index, rank: rank(image) }))
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.image.createdAt.getTime() - right.image.createdAt.getTime() ||
        left.index - right.index,
    )
    .slice(0, limit)
    .map(({ image }) => ({
      id: image.id,
      url: image.url,
      label: image.templateItemId ? itemLabels.get(image.templateItemId) ?? null : null,
      sizeBytes: image.sizeBytes,
    }));
}
