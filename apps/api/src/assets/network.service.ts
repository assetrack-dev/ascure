import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { renderNoTiangRondaan } from '../common/rondaan';

const MEMBERSHIP_SELECT = {
  sequenceIndex: true,
  branchSuffix: true,
  feeder: { select: { code: true } },
} as const;

type RenderablePole = {
  id: string;
  assetCode: string;
  noTiangLama: string | null;
  feederMemberships: { sequenceIndex: number; branchSuffix: string; feeder: { code: string } }[];
};

@Injectable()
export class NetworkService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The persisted network graph for a Pencawang (north-star §2): feeders, poles
   * (rendered RONDAAN + GPS + fed-from parent), the radial `fed-from` edges, and
   * NOP tie-edges. The schematic + map render this; isolation traverses it.
   */
  async getSubstationNetwork(user: RequestUser, substationId: string) {
    const substation = await this.prisma.substation.findFirst({
      where: { id: substationId, tenantId: user.tenantId },
      select: { id: true, code: true, name: true },
    });
    if (!substation) {
      throw new NotFoundException('Substation not found.');
    }

    const [feeders, assets, tieEdges] = await Promise.all([
      this.prisma.feeder.findMany({
        where: { substationId },
        select: { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.asset.findMany({
        where: { substationId },
        select: {
          id: true,
          assetCode: true,
          noTiangLama: true,
          latitude: true,
          longitude: true,
          fedFromAssetId: true,
          feederMemberships: { select: MEMBERSHIP_SELECT },
        },
      }),
      this.prisma.networkTieEdge.findMany({
        where: { tenantId: user.tenantId, fromAsset: { substationId } },
        select: { fromAssetId: true, toAssetId: true, kind: true, switchState: true },
      }),
    ]);

    const poles = assets
      .filter((asset) => asset.feederMemberships.length > 0)
      .map((asset) => ({
        id: asset.id,
        noTiangRondaan: renderNoTiangRondaan(asset.feederMemberships) ?? asset.assetCode,
        noTiangLama: asset.noTiangLama,
        latitude: asset.latitude,
        longitude: asset.longitude,
        fedFromAssetId: asset.fedFromAssetId,
        feeders: [...new Set(asset.feederMemberships.map((m) => m.feeder.code))].sort(),
      }));

    const poleIds = new Set(poles.map((pole) => pole.id));
    const radial = poles
      .filter((pole) => pole.fedFromAssetId && poleIds.has(pole.fedFromAssetId))
      .map((pole) => ({ from: pole.fedFromAssetId as string, to: pole.id }));

    return {
      substation,
      feeders,
      poles,
      edges: {
        radial,
        tie: tieEdges.map((edge) => ({
          from: edge.fromAssetId,
          to: edge.toAssetId,
          kind: edge.kind,
          switchState: edge.switchState,
        })),
      },
    };
  }

  /**
   * Radial isolation: the poles fed THROUGH `assetId` (its descendants in the
   * fed-from tree) — i.e. what de-energizes if this pole's supply is cut.
   * Breadth-first with a cycle guard (defensive against bad data). NOP back-feed
   * is not applied (those points are normally open).
   */
  async getDownstream(user: RequestUser, assetId: string) {
    const root = await this.prisma.asset.findFirst({
      where: { id: assetId, tenantId: user.tenantId },
      select: {
        id: true,
        substationId: true,
        assetCode: true,
        noTiangLama: true,
        feederMemberships: { select: MEMBERSHIP_SELECT },
      },
    });
    if (!root) {
      throw new NotFoundException('Asset not found.');
    }

    const assets = await this.prisma.asset.findMany({
      where: { substationId: root.substationId },
      select: {
        id: true,
        fedFromAssetId: true,
        assetCode: true,
        noTiangLama: true,
        feederMemberships: { select: MEMBERSHIP_SELECT },
      },
    });

    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const childrenByParent = new Map<string, string[]>();
    for (const asset of assets) {
      if (asset.fedFromAssetId) {
        const siblings = childrenByParent.get(asset.fedFromAssetId) ?? [];
        siblings.push(asset.id);
        childrenByParent.set(asset.fedFromAssetId, siblings);
      }
    }

    const order: string[] = [];
    const seen = new Set<string>([assetId]);
    const queue = [...(childrenByParent.get(assetId) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      order.push(id);
      queue.push(...(childrenByParent.get(id) ?? []));
    }

    const render = (asset: RenderablePole) => ({
      id: asset.id,
      noTiangRondaan: renderNoTiangRondaan(asset.feederMemberships) ?? asset.assetCode,
      noTiangLama: asset.noTiangLama,
    });

    return {
      root: render(root),
      deEnergizedCount: order.length,
      deEnergized: order.map((id) => render(byId.get(id) as RenderablePole)),
    };
  }
}
