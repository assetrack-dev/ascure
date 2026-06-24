/**
 * Local-only demo of a small multi-feeder network for verifying the per-feeder
 * graph + isolation fixes. Mirrors the field case:
 *  - a shared pole "B 2 & D 1/1" (on feeders B and D),
 *  - pure-B and pure-D poles,
 *  - a missing bare "B 8" (only B 8/1 + B 9 exist) to exercise the parent fallback.
 *
 * After seeding, run the backfill on this substation to build feeders/memberships
 * + per-feeder parents:
 *   pnpm exec tsx prisma/scripts/backfill-network-graph.ts --substation NETDEMO --apply
 *
 * NEVER run against prod.
 */
import { PrismaClient } from '@prisma/client';

const SUBSTATION_CODE = 'NETDEMO';
const CODES = [
  'B 1',
  'B 2 & D 1/1',
  'B 3',
  'D 1/2',
  'B 6',
  'B 7',
  'B 8/1',
  'B 9',
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findFirst({ select: { id: true } });
    if (!tenant) throw new Error('No tenant.');
    const assetType = await prisma.assetType.findFirst({
      where: { tenantId: tenant.id },
      select: { id: true },
    });
    if (!assetType) throw new Error('No asset type.');

    let substation = await prisma.substation.findFirst({
      where: { tenantId: tenant.id, code: SUBSTATION_CODE },
      select: { id: true },
    });
    if (!substation) {
      substation = await prisma.substation.create({
        data: {
          tenantId: tenant.id,
          code: SUBSTATION_CODE,
          name: 'Network Demo Pencawang',
        },
        select: { id: true },
      });
    }

    let created = 0;
    for (const code of CODES) {
      const existing = await prisma.asset.findFirst({
        where: { tenantId: tenant.id, substationId: substation.id, assetCode: code },
        select: { id: true },
      });
      if (existing) continue;
      await prisma.asset.create({
        data: {
          tenantId: tenant.id,
          substationId: substation.id,
          assetTypeId: assetType.id,
          assetCode: code,
        },
      });
      created += 1;
    }

    console.log(
      `Network demo ready: substation ${SUBSTATION_CODE}, ${CODES.length} poles (${created} new). Now run the backfill --substation ${SUBSTATION_CODE} --apply.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
