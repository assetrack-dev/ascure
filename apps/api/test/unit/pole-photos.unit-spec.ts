import { pickPolePhotos } from '../../src/maintenance-packages/pole-photos.util';

/**
 * Which survey photos a maintenance crew sees to recognise a pole
 * (docs/PLAN-maintenance-flow.md §14): the whole-pole IMAGE field first,
 * then general photos, then other item photos; capped.
 */
describe('pickPolePhotos', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 7, 8, minute));
  const labels = new Map([
    ['item-tiang', 'GAMBAR TIANG'],
    ['item-kelegaan', 'GAMBAR KELEGAAN 1'],
    ['item-rentis', 'RENTIS'],
  ]);

  it('puts the whole-pole photo first, then general, then other items', () => {
    const photos = pickPolePhotos(
      [
        { id: 'kelegaan', url: '/k.jpg', templateItemId: 'item-kelegaan', sizeBytes: null, createdAt: at(1) },
        { id: 'general', url: '/g.jpg', templateItemId: null, sizeBytes: null, createdAt: at(2) },
        { id: 'tiang', url: '/t.jpg', templateItemId: 'item-tiang', sizeBytes: null, createdAt: at(3) },
      ],
      labels,
    );
    expect(photos.map((photo) => photo.id)).toEqual(['tiang', 'general', 'kelegaan']);
    expect(photos[0].label).toBe('GAMBAR TIANG');
    expect(photos[1].label).toBeNull();
  });

  it('does not treat KELEGAAN as a whole-pole photo just because it mentions a pole item', () => {
    const photos = pickPolePhotos(
      [
        { id: 'rentis', url: '/r.jpg', templateItemId: 'item-rentis', sizeBytes: null, createdAt: at(1) },
        { id: 'kelegaan', url: '/k.jpg', templateItemId: 'item-kelegaan', sizeBytes: null, createdAt: at(2) },
      ],
      labels,
    );
    expect(photos.map((photo) => photo.id)).toEqual(['rentis', 'kelegaan']);
  });

  it('caps the list and tolerates unknown item ids', () => {
    const images = Array.from({ length: 7 }, (_, index) => ({
      id: `p${index}`,
      url: `/p${index}.jpg`,
      templateItemId: index === 6 ? 'missing-item' : null,
      sizeBytes: null, createdAt: at(index),
    }));
    const photos = pickPolePhotos(images, labels);
    expect(photos).toHaveLength(4);
    expect(photos.map((photo) => photo.id)).toEqual(['p0', 'p1', 'p2', 'p3']);
    expect(pickPolePhotos([images[6]], labels)[0].label).toBeNull();
  });
});
