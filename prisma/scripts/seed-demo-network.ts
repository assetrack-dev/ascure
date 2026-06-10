/**
 * Seed an idempotent demo network graph so the admin "Network" view has
 * something to show: two feeders (A: A1-A5 with a branch A2/1-A2/2; B: B1-B4)
 * and a NOP tie between A 5 and B 4. Uses the real services (so memberships +
 * fed-from edges are captured exactly as in production).
 *
 *   tsx prisma/scripts/seed-demo-network.ts
 */
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { AssetsService } from '../../apps/api/src/assets/assets.service';
import { NetworkService } from '../../apps/api/src/assets/network.service';

const prisma = new PrismaClient();
const SUB_CODE = 'PE-DEMO';

const POLES: { code: string; lat: number; lng: number }[] = [
  { code: 'A 1', lat: 3.149, lng: 101.6869 },
  { code: 'A 2', lat: 3.1495, lng: 101.6875 },
  { code: 'A 3', lat: 3.15, lng: 101.6881 },
  { code: 'A 4', lat: 3.1505, lng: 101.6887 },
  { code: 'A 5', lat: 3.151, lng: 101.6893 },
  { code: 'A 2/1', lat: 3.1492, lng: 101.6883 },
  { code: 'A 2/2', lat: 3.149, lng: 101.689 },
  { code: 'B 1', lat: 3.1486, lng: 101.6869 },
  { code: 'B 2', lat: 3.1482, lng: 101.6875 },
  { code: 'B 3', lat: 3.1478, lng: 101.6881 },
  { code: 'B 4', lat: 3.1474, lng: 101.6887 },
];

async function main() {
  const tenant = await prisma.tenant.findFirstOrThrow({ select: { id: true } });
  const assetType = await prisma.assetType.findFirstOrThrow({
    where: { tenantId: tenant.id },
    select: { id: true },
  });
  const admin = await prisma.user.findFirstOrThrow({
    where: { tenantId: tenant.id, role: 'ADMIN' },
    select: { id: true },
  });

  const sub = await prisma.substation.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: SUB_CODE } },
    create: { tenantId: tenant.id, code: SUB_CODE, name: 'Demo Network Pencawang', location: 'KL (demo)' },
    update: {},
    select: { id: true },
  });

  const user = { id: admin.id, tenantId: tenant.id, role: 'ADMIN' } as any;
  const assets = new AssetsService(prisma as any);
  const net = new NetworkService(prisma as any);

  const idByCode = new Map<string, string>();
  for (const pole of POLES) {
    const existing = await prisma.asset.findFirst({
      where: { tenantId: tenant.id, substationId: sub.id, assetCode: pole.code },
      select: { id: true },
    });
    if (existing) {
      idByCode.set(pole.code, existing.id);
      console.log(`= ${pole.code} (exists)`);
      continue;
    }
    const created = await assets.create(user, {
      substationId: sub.id,
      assetTypeId: assetType.id,
      assetCode: pole.code,
      latitude: pole.lat,
      longitude: pole.lng,
    } as any);
    idByCode.set(pole.code, (created as { id: string }).id);
    console.log(`+ ${pole.code}`);
  }

  const a5 = idByCode.get('A 5');
  const b4 = idByCode.get('B 4');
  if (a5 && b4) {
    const existingTie = await prisma.networkTieEdge.findFirst({
      where: { fromAssetId: a5, toAssetId: b4 },
      select: { id: true },
    });
    if (existingTie) {
      console.log('= NOP A 5 <-> B 4 (exists)');
    } else {
      await net.createTieEdge(user, { fromAssetId: a5, toAssetId: b4 } as any);
      console.log('+ NOP A 5 <-> B 4');
    }
  }

  console.log(`\nDemo Pencawang ready: ${SUB_CODE} (substation ${sub.id})`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERR', e instanceof Error ? e.message : e);
  process.exit(1);
});
