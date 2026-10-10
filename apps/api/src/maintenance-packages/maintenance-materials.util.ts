import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Materials used to repair a Kejanggalan (TNB feedback #1, 2026-10-11): picked
 * from TNB's catalogue ("LIST BARANG IMBANGAN TNB — SAVR") with a quantity, so
 * the contractor's repair report and claim summary list what was used.
 * Optional; the crew or the office may set or correct it at any time.
 */

/** Countable units take whole numbers; M / KG may carry decimals. */
const WHOLE_UNITS = new Set(['EA', 'UNT', 'SET']);
const MAX_QUANTITY = 100_000;

export const MATERIAL_SELECT = {
  quantity: true,
  material: { select: { id: true, catalogueNo: true, description: true, unit: true } },
} satisfies Prisma.DefectMaterialSelect;

export type MaterialRow = Prisma.DefectMaterialGetPayload<{ select: typeof MATERIAL_SELECT }>;

export interface MaterialLine {
  materialId: string;
  catalogueNo: string;
  description: string;
  unit: string;
  quantity: number;
}

export function serializeMaterials(rows: MaterialRow[]): MaterialLine[] {
  return rows
    .map((row) => ({
      materialId: row.material.id,
      catalogueNo: row.material.catalogueNo,
      description: row.material.description,
      unit: row.material.unit,
      quantity: row.quantity.toNumber(),
    }))
    .sort((left, right) => left.description.localeCompare(right.description));
}

/** The active catalogue, in TNB's list order. */
export function loadMaterialCatalog(db: Prisma.TransactionClient) {
  return db.materialCatalogItem.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { description: 'asc' }],
    select: { id: true, catalogueNo: true, description: true, unit: true },
  });
}

/**
 * Replace a Kejanggalan's materials with `items` (an empty list clears them).
 * Validates each line against the catalogue; a material repeated in the list
 * is a 400 (send one line per material).
 */
export async function replaceDefectMaterials(
  tx: Prisma.TransactionClient,
  defectId: string,
  items: Array<{ materialId: string; quantity: number }>,
  actorUserId: string,
): Promise<MaterialLine[]> {
  const ids = items.map((item) => item.materialId);
  if (new Set(ids).size !== ids.length) {
    throw new BadRequestException('Each material may appear once — add the quantities together.');
  }
  const catalog = new Map(
    (
      await tx.materialCatalogItem.findMany({
        where: { id: { in: ids } },
        select: { id: true, unit: true, description: true, isActive: true },
      })
    ).map((row) => [row.id, row]),
  );
  const existing = new Set(
    (await tx.defectMaterial.findMany({ where: { defectId }, select: { materialId: true } })).map(
      (row) => row.materialId,
    ),
  );
  for (const item of items) {
    const material = catalog.get(item.materialId);
    // A retired material already on the Kejanggalan may stay (corrections).
    if (!material || (!material.isActive && !existing.has(item.materialId))) {
      throw new BadRequestException('That material is not on the TNB list.');
    }
    if (!(item.quantity > 0) || item.quantity > MAX_QUANTITY) {
      throw new BadRequestException(`Quantity for ${material.description} must be more than 0.`);
    }
    if (WHOLE_UNITS.has(material.unit.toUpperCase()) && !Number.isInteger(item.quantity)) {
      throw new BadRequestException(`${material.description} is counted in ${material.unit} — use a whole number.`);
    }
    if (Math.round(item.quantity * 1000) !== item.quantity * 1000) {
      throw new BadRequestException('Use at most 3 decimal places.');
    }
  }

  await tx.defectMaterial.deleteMany({ where: { defectId, materialId: { notIn: ids } } });
  for (const item of items) {
    await tx.defectMaterial.upsert({
      where: { defectId_materialId: { defectId, materialId: item.materialId } },
      create: { defectId, materialId: item.materialId, quantity: item.quantity, updatedByUserId: actorUserId },
      update: { quantity: item.quantity, updatedByUserId: actorUserId },
    });
  }
  return serializeMaterials(await tx.defectMaterial.findMany({ where: { defectId }, select: MATERIAL_SELECT }));
}
