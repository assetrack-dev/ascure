import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DefectStatus,
  FeederKind,
  InspectionCompletionStatus,
  Prisma,
  SwitchState,
  TieEdgeKind,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { feederLineCode, renderNoTiangRondaan } from '../common/rondaan';
import { CreateTieEdgeDto } from './dto/create-tie-edge.dto';

const MEMBERSHIP_SELECT = {
  sequenceIndex: true,
  branchSuffix: true,
  fedFromAssetId: true,
  feeder: { select: { code: true, originKind: true, originNumber: true } },
} as const;

// This service is the RONDAAN (LV) network graph. SAVT route feeders live in
// the same tables (a From-Pencawang owns both kinds) but are a different
// domain — always filter memberships to RONDAAN feeders here or SAVT poles
// leak into the Pencawang graph, its isolation math, and the RONDAAN lint.
const RONDAAN_MEMBERSHIPS = {
  where: { feeder: { kind: FeederKind.RONDAAN } },
  select: MEMBERSHIP_SELECT,
} as const;

type RenderablePole = {
  id: string;
  assetCode: string;
  noTiangLama: string | null;
  feederMemberships: {
    sequenceIndex: number;
    branchSuffix: string;
    fedFromAssetId: string | null;
    feeder: { code: string; originKind: string; originNumber: number };
  }[];
};

const POLE_SELECT = {
  id: true,
  assetCode: true,
  noTiangLama: true,
  feederMemberships: RONDAAN_MEMBERSHIPS,
} as const;

/**
 * Checklist item keys the route drawing (Lukisan Laluan) renders — the
 * SAVR-KLB data-capture items that correspond to the layers of the DC's
 * manual CAD drawing. Cable keys color the span feeding the pole; the rest
 * become symbols/annotations at the pole.
 */
const ROUTE_DRAWING_KEYS = [
  'saiz_tiang',
  'jenis_tiang',
  'cable_185_nmp',
  'cable_95_nmp',
  'cable_3x16_nmp',
  'cable_1x16_nmp',
  'cable_pvc_9064_4_cable',
  'cable_pvc_7083_2_cable_1_cable',
  'cable_pvc_7044',
  'bare_7173',
  'bare_7122',
  'jumlah_umbang',
  'umbang_terbang_support_pole',
  'jumlah_blackbox',
  'lvpt',
  'jumlah_service',
  'catatan_cable',
];

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
        where: { substationId, kind: FeederKind.RONDAAN },
        select: {
          id: true,
          code: true,
          originKind: true,
          originNumber: true,
          name: true,
        },
        orderBy: [{ code: 'asc' }, { originKind: 'asc' }, { originNumber: 'asc' }],
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
          feederMemberships: RONDAAN_MEMBERSHIPS,
        },
      }),
      this.prisma.networkTieEdge.findMany({
        where: { tenantId: user.tenantId, fromAsset: { substationId } },
        select: { id: true, fromAssetId: true, toAssetId: true, kind: true, switchState: true },
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
        // LINE display tokens ("A", "FP1 A") — an origin line is its own line.
        feeders: [...new Set(asset.feederMemberships.map((m) => feederLineCode(m.feeder)))].sort(),
      }));

    const poleIds = new Set(poles.map((pole) => pole.id));
    // Per-feeder radial edges: each pole's parent ON EACH FEEDER it sits on, so a
    // multi-feeder pole yields one edge per feeder (the single Asset.fedFromAssetId
    // could only express one — which collapsed every shared run onto the
    // alphabetically-first feeder). Each edge carries its feeder LINE token.
    const radial = assets.flatMap((asset) =>
      asset.feederMemberships
        .filter((m) => m.fedFromAssetId && poleIds.has(m.fedFromAssetId as string))
        .map((m) => ({
          from: m.fedFromAssetId as string,
          to: asset.id,
          feeder: feederLineCode(m.feeder),
        })),
    );

    return {
      substation,
      // The API speaks LINE tokens: the code the admin renders is "FP1 A" for
      // an origin line — the bare column value stays internal.
      feeders: feeders.map((feeder) => ({
        id: feeder.id,
        code: feederLineCode(feeder),
        name: feeder.name,
      })),
      poles,
      edges: {
        radial,
        tie: tieEdges.map((edge) => ({
          id: edge.id,
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
   * Breadth-first with a cycle guard. NOP back-feed is not applied here.
   */
  async getDownstream(user: RequestUser, assetId: string) {
    const root = await this.prisma.asset.findFirst({
      where: { id: assetId, tenantId: user.tenantId },
      select: { ...POLE_SELECT, substationId: true },
    });
    if (!root) {
      throw new NotFoundException('Asset not found.');
    }

    const assets = await this.prisma.asset.findMany({
      where: { substationId: root.substationId },
      select: { ...POLE_SELECT, fedFromAssetId: true },
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

    return {
      root: this.renderPole(root),
      deEnergizedCount: order.length,
      deEnergized: order.map((id) => this.renderPole(byId.get(id) as RenderablePole)),
    };
  }

  /** Capture a tie-edge (a NOP by default) between two poles — the back-feed
   *  links that make the network more than a set of radial trees (north-star §3). */
  async createTieEdge(user: RequestUser, dto: CreateTieEdgeDto) {
    this.assertCanMutate(user);

    if (dto.fromAssetId === dto.toAssetId) {
      throw new BadRequestException('A tie-edge needs two distinct assets.');
    }
    const endpoints = await this.prisma.asset.findMany({
      where: { id: { in: [dto.fromAssetId, dto.toAssetId] }, tenantId: user.tenantId },
      select: { id: true },
    });
    if (endpoints.length !== 2) {
      throw new NotFoundException('Both tie-edge assets must exist in your tenant.');
    }
    if (dto.deviceAssetId) {
      const device = await this.prisma.asset.findFirst({
        where: { id: dto.deviceAssetId, tenantId: user.tenantId },
        select: { id: true },
      });
      if (!device) {
        throw new NotFoundException('NOP device asset not found.');
      }
    }

    try {
      return await this.prisma.networkTieEdge.create({
        data: {
          tenantId: user.tenantId,
          fromAssetId: dto.fromAssetId,
          toAssetId: dto.toAssetId,
          deviceAssetId: dto.deviceAssetId ?? null,
          kind: dto.kind ?? TieEdgeKind.NOP,
          switchState: dto.switchState ?? SwitchState.OPEN,
          notes: dto.notes ?? null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A tie-edge of this kind already exists between these assets.');
      }
      throw error;
    }
  }

  /** Open / close a tie-edge (the switching action that drives back-feed). */
  async setTieEdgeState(user: RequestUser, id: string, switchState: SwitchState) {
    this.assertCanMutate(user);
    const edge = await this.prisma.networkTieEdge.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!edge) {
      throw new NotFoundException('Tie-edge not found.');
    }
    return this.prisma.networkTieEdge.update({ where: { id }, data: { switchState } });
  }

  /**
   * Feeder-level isolation (the "killer" view): opening this feeder's breaker
   * de-energizes every pole on it (radial), and the NOP tie-edges with exactly
   * one de-energized endpoint are the back-feed options — closing one re-feeds
   * the dead section from a still-energized neighbour.
   */
  async getFeederIsolation(user: RequestUser, feederId: string) {
    const feeder = await this.prisma.feeder.findFirst({
      // RONDAAN-only: SAVT route isolation is a different electrical question
      // (an HV route de-energizes downstream PENCAWANG, not just poles).
      where: { id: feederId, tenantId: user.tenantId, kind: FeederKind.RONDAAN },
      select: {
        id: true,
        code: true,
        originKind: true,
        originNumber: true,
        name: true,
        substationId: true,
      },
    });
    if (!feeder) {
      throw new NotFoundException('Feeder not found.');
    }

    // Opening this feeder's breaker de-energizes the poles fed ONLY by it. A pole
    // that also sits on another (still-live) feeder keeps power from that feeder —
    // e.g. a shared "B 2 & D 1/1" pole stays live via B when D is opened — so
    // isolating one feeder must NOT drop a feeder it merely shares poles with.
    // (Whole-feeder isolation; the per-feeder fedFromAssetId edges drive partial
    // switch-level isolation, not this.)
    const memberships = await this.prisma.poleFeederMembership.findMany({
      where: {
        feeder: { substationId: feeder.substationId, kind: FeederKind.RONDAAN },
      },
      select: { assetId: true, feederId: true },
    });
    const feederCountByAsset = new Map<string, number>();
    const onThisFeeder = new Set<string>();
    for (const m of memberships) {
      feederCountByAsset.set(m.assetId, (feederCountByAsset.get(m.assetId) ?? 0) + 1);
      if (m.feederId === feederId) {
        onThisFeeder.add(m.assetId);
      }
    }
    const deEnergizedIds = new Set<string>();
    for (const assetId of onThisFeeder) {
      if ((feederCountByAsset.get(assetId) ?? 0) <= 1) {
        deEnergizedIds.add(assetId);
      }
    }

    const deEnergized = deEnergizedIds.size
      ? await this.prisma.asset.findMany({
          where: { id: { in: [...deEnergizedIds] } },
          select: POLE_SELECT,
        })
      : [];

    const tieEdges = deEnergizedIds.size
      ? await this.prisma.networkTieEdge.findMany({
          where: {
            tenantId: user.tenantId,
            OR: [
              { fromAssetId: { in: [...deEnergizedIds] } },
              { toAssetId: { in: [...deEnergizedIds] } },
            ],
          },
          select: {
            id: true,
            kind: true,
            switchState: true,
            fromAssetId: true,
            toAssetId: true,
            fromAsset: { select: POLE_SELECT },
            toAsset: { select: POLE_SELECT },
          },
        })
      : [];

    const backfeed = tieEdges
      .filter((edge) => deEnergizedIds.has(edge.fromAssetId) !== deEnergizedIds.has(edge.toAssetId))
      .map((edge) => {
        const fromDead = deEnergizedIds.has(edge.fromAssetId);
        return {
          tieEdgeId: edge.id,
          kind: edge.kind,
          switchState: edge.switchState,
          deEnergizedPole: this.renderPole(fromDead ? edge.fromAsset : edge.toAsset),
          sourcePole: this.renderPole(fromDead ? edge.toAsset : edge.fromAsset),
        };
      });

    return {
      feeder: { id: feeder.id, code: feederLineCode(feeder), name: feeder.name },
      deEnergizedCount: deEnergized.length,
      deEnergized: deEnergized.map((asset) => this.renderPole(asset)),
      backfeed,
    };
  }

  private renderPole(asset: RenderablePole) {
    return {
      id: asset.id,
      noTiangRondaan: renderNoTiangRondaan(asset.feederMemberships) ?? asset.assetCode,
      noTiangLama: asset.noTiangLama,
    };
  }

  /**
   * The TNB route drawing (Lukisan Laluan): the substation graph PLUS each
   * pole's drawing attributes read from its latest SUBMITTED inspection — the
   * SAVR-KLB checklist keys that the DC's manual CAD drawing encodes as layers
   * (cable per span, pole height, stays, blackboxes, LVPT, service count) —
   * and its open defect labels (the orange notes on the DC's sheet).
   * Keys missing from a template simply come back absent — the drawing shows
   * "Tiada Data Kabel" styling rather than failing.
   */
  async getRouteDrawing(user: RequestUser, substationId: string) {
    const network = await this.getSubstationNetwork(user, substationId);
    const assetIds = network.poles.map((pole) => pole.id);
    if (assetIds.length === 0) {
      return { ...network, drawing: {} };
    }

    // Latest SUBMITTED inspection per pole (newest-first, first seen wins).
    const inspections = await this.prisma.inspection.findMany({
      where: {
        tenantId: user.tenantId,
        assetId: { in: assetIds },
        completionStatus: InspectionCompletionStatus.SUBMITTED,
      },
      orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, assetId: true },
    });
    const latestByAsset = new Map<string, string>();
    for (const inspection of inspections) {
      if (!latestByAsset.has(inspection.assetId)) {
        latestByAsset.set(inspection.assetId, inspection.id);
      }
    }
    const latestIds = [...latestByAsset.values()];
    const assetByInspection = new Map(
      [...latestByAsset.entries()].map(([assetId, id]) => [id, assetId]),
    );

    const [results, defects] = await Promise.all([
      latestIds.length === 0
        ? []
        : this.prisma.inspectionResult.findMany({
            where: {
              inspectionId: { in: latestIds },
              templateItem: { key: { in: ROUTE_DRAWING_KEYS } },
            },
            select: {
              inspectionId: true,
              valueText: true,
              valueNumber: true,
              valueBoolean: true,
              valueJson: true,
              templateItem: { select: { key: true } },
            },
          }),
      this.prisma.defect.findMany({
        where: {
          status: {
            in: [
              DefectStatus.OPEN,
              DefectStatus.IN_PROGRESS,
              DefectStatus.MONITORING,
            ],
          },
          inspectionItemResult: {
            inspection: { tenantId: user.tenantId, assetId: { in: assetIds } },
          },
        },
        select: {
          severity: true,
          isEmergency: true,
          inspectionItemResult: {
            select: { label: true, inspection: { select: { assetId: true } } },
          },
        },
      }),
    ]);

    const drawing: Record<
      string,
      {
        items: Record<string, string | number | boolean | unknown>;
        defects: Array<{ label: string; severity: string; isEmergency: boolean }>;
      }
    > = {};
    const entryFor = (assetId: string) =>
      (drawing[assetId] ??= { items: {}, defects: [] });

    for (const result of results) {
      const assetId = assetByInspection.get(result.inspectionId);
      if (!assetId) continue;
      const value =
        result.valueText ??
        (result.valueNumber != null ? Number(result.valueNumber) : null) ??
        result.valueBoolean ??
        result.valueJson;
      if (value === null || value === undefined || value === '') continue;
      entryFor(assetId).items[result.templateItem.key] = value;
    }

    for (const defect of defects) {
      const assetId = defect.inspectionItemResult.inspection.assetId;
      if (!assetId) continue;
      entryFor(assetId).defects.push({
        label: defect.inspectionItemResult.label,
        severity: defect.severity,
        isEmergency: defect.isEmergency,
      });
    }

    return { ...network, drawing };
  }

  private assertCanMutate(user: RequestUser) {
    if (user.role === UserRole.VIEWER || user.role === UserRole.CLIENT) {
      throw new ForbiddenException('This role is read-only for network actions.');
    }
  }
}
