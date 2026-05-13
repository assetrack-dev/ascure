import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  InspectionCompletionStatus,
  Prisma,
  SiteVisitStatus,
  SiteVisitValidationStatus,
  UserRole,
} from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import {
  calculateOperationalHealthStatus,
  isSiteVisitOverdue,
  parseOperationalOverdueThresholdHours,
} from '../common/operational-health';
import { PrismaService } from '../prisma/prisma.service';
import { CancelSiteVisitDto } from './dto/cancel-site-visit.dto';
import { CompleteSiteVisitDto } from './dto/complete-site-visit.dto';
import { CreateSiteVisitDto } from './dto/create-site-visit.dto';
import { LinkSiteVisitAssetDto } from './dto/link-site-visit-asset.dto';
import { ListSiteVisitsQueryDto } from './dto/list-site-visits-query.dto';

const ACTIVE_SITE_VISIT_STATUSES = [
  SiteVisitStatus.ACTIVE,
  SiteVisitStatus.OPEN,
  SiteVisitStatus.IN_PROGRESS,
] as const;

const TERMINAL_SITE_VISIT_STATUSES = new Set<SiteVisitStatus>([
  SiteVisitStatus.COMPLETED,
  SiteVisitStatus.CANCELLED,
]);

const SITE_VISIT_BASE_INCLUDE = Prisma.validator<Prisma.SiteVisitInclude>()({
  team: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
  substation: {
    select: {
      id: true,
      code: true,
      name: true,
      location: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
    },
  },
  validatedBy: {
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
    },
  },
  users: {
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      },
    },
    orderBy: {
      joinedAt: 'asc',
    },
  },
});

const SITE_VISIT_ASSET_INCLUDE = Prisma.validator<Prisma.SiteVisitAssetInclude>()({
  addedBy: {
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
    },
  },
  asset: {
    include: {
      assetType: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
      substation: {
        select: {
          id: true,
          code: true,
          name: true,
          location: true,
        },
      },
    },
  },
});

const SITE_VISIT_DETAIL_INCLUDE = Prisma.validator<Prisma.SiteVisitInclude>()({
  ...SITE_VISIT_BASE_INCLUDE,
  visitAssets: {
    include: SITE_VISIT_ASSET_INCLUDE,
    orderBy: {
      addedAt: 'asc',
    },
  },
  images: {
    orderBy: {
      createdAt: 'asc',
    },
    select: {
      id: true,
      fileName: true,
      storageKey: true,
      contentType: true,
      url: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  inspections: {
    include: {
      asset: {
        select: {
          id: true,
          assetCode: true,
          name: true,
          assetType: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          substation: {
            select: {
              id: true,
              code: true,
              name: true,
              location: true,
            },
          },
        },
      },
      template: {
        select: {
          id: true,
          name: true,
          version: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      },
      inspectionImages: {
        orderBy: {
          createdAt: 'asc',
        },
      },
      itemResults: {
        select: {
          id: true,
          label: true,
          result: true,
          remark: true,
          isDefect: true,
          severity: true,
          createdAt: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  },
});

type SiteVisitBase = Prisma.SiteVisitGetPayload<{
  include: typeof SITE_VISIT_BASE_INCLUDE;
}>;

type SiteVisitAssetLink = Prisma.SiteVisitAssetGetPayload<{
  include: typeof SITE_VISIT_ASSET_INCLUDE;
}>;

type SiteVisitDetail = Prisma.SiteVisitGetPayload<{
  include: typeof SITE_VISIT_DETAIL_INCLUDE;
}>;

type SiteVisitRollup = {
  totalAssets: number;
  inspectedAssets: number;
  pendingAssets: number;
  defectsFound: number;
  completionPercentage: number;
};

@Injectable()
export class SiteVisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async create(user: RequestUser, dto: CreateSiteVisitDto) {
    this.assertCanMutate(user);

    const team = await this.prisma.team.findFirst({
      where: {
        id: dto.teamId,
        tenantId: user.tenantId,
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    if (user.role !== UserRole.ADMIN) {
      const teamMembership = await this.prisma.teamMember.findFirst({
        where: {
          teamId: dto.teamId,
          userId: user.id,
          isActive: true,
          team: {
            tenantId: user.tenantId,
            isActive: true,
          },
        },
        select: {
          id: true,
        },
      });

      if (!teamMembership) {
        throw new ForbiddenException('You must belong to the selected team to create a site visit.');
      }
    }

    const substation = await this.prisma.substation.findFirst({
      where: {
        id: dto.substationId,
        tenantId: user.tenantId,
        isActive: true,
      },
      select: {
        id: true,
        code: true,
        name: true,
        location: true,
      },
    });

    if (!substation) {
      throw new NotFoundException('Substation not found.');
    }

    const existingActiveVisit = await this.prisma.siteVisit.findFirst({
      where: {
        tenantId: user.tenantId,
        teamId: dto.teamId,
        substationId: dto.substationId,
        status: {
          in: [...ACTIVE_SITE_VISIT_STATUSES],
        },
      },
      include: SITE_VISIT_BASE_INCLUDE,
    });

    if (existingActiveVisit) {
      throw new ConflictException('An active site visit already exists for this team at the selected substation.');
    }

    const activeTeamMembers = await this.prisma.teamMember.findMany({
      where: {
        teamId: dto.teamId,
        isActive: true,
        user: {
          isActive: true,
        },
      },
      select: {
        userId: true,
      },
    });
    const visitUserIds = new Set(activeTeamMembers.map((member) => member.userId));
    visitUserIds.add(user.id);

    return this.prisma.siteVisit.create({
      data: {
        tenantId: user.tenantId,
        teamId: dto.teamId,
        substationId: dto.substationId,
        createdByUserId: user.id,
        status: this.normalizeCreateStatus(dto.status),
        cycleNumber: dto.cycleNumber,
        visitType: dto.visitType,
        mainhead: this.normalizeOptionalString(dto.mainhead),
        pencawangCode: this.normalizeOptionalString(dto.pencawangCode) ?? substation.code,
        pencawangName: this.normalizeOptionalString(dto.pencawangName) ?? substation.name,
        functionalLocation:
          this.normalizeOptionalString(dto.functionalLocation) ?? substation.location,
        checkInLatitude: dto.checkInLatitude,
        checkInLongitude: dto.checkInLongitude,
        checkInAccuracyMeters: dto.checkInAccuracyMeters,
        checkInCapturedAt: dto.checkInCapturedAt ? new Date(dto.checkInCapturedAt) : undefined,
        validationStatus: SiteVisitValidationStatus.PENDING,
        notes: this.normalizeOptionalString(dto.notes),
        users: {
          create: Array.from(visitUserIds).map((userId) => ({
            userId,
          })),
        },
      },
      include: SITE_VISIT_BASE_INCLUDE,
    });
  }

  async list(user: RequestUser, query: ListSiteVisitsQueryDto) {
    const siteVisits = await this.prisma.siteVisit.findMany({
      where: this.buildListWhere(user, query),
      include: SITE_VISIT_BASE_INCLUDE,
      orderBy: {
        startedAt: 'desc',
      },
    });
    const siteVisitIds = siteVisits.map((siteVisit) => siteVisit.id);
    const [rollupsByVisitId, lastActivityByVisitId] = await Promise.all([
      this.getRollups(siteVisitIds),
      this.getLastActivityByVisitId(siteVisitIds, siteVisits),
    ]);
    const now = new Date();
    const overdueThresholdHours = this.getOverdueThresholdHours();

    return siteVisits.map((siteVisit) =>
      this.serializeSiteVisitListItem(
        siteVisit,
        rollupsByVisitId.get(siteVisit.id) ?? this.emptyRollup(),
        lastActivityByVisitId.get(siteVisit.id) ?? siteVisit.updatedAt,
        now,
        overdueThresholdHours,
      ),
    );
  }

  async getById(user: RequestUser, id: string) {
    const siteVisit = await this.prisma.siteVisit.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
        ...this.accessScope(user),
      },
      include: SITE_VISIT_DETAIL_INCLUDE,
    });

    if (!siteVisit) {
      throw new NotFoundException('Site visit not found.');
    }

    const [rollup, lastActivityByVisitId] = await Promise.all([
      this.getRollup(siteVisit.id),
      this.getLastActivityByVisitId([siteVisit.id], [siteVisit]),
    ]);
    const now = new Date();
    const overdueThresholdHours = this.getOverdueThresholdHours();

    return this.serializeSiteVisitDetail(
      siteVisit,
      rollup,
      lastActivityByVisitId.get(siteVisit.id) ?? siteVisit.updatedAt,
      now,
      overdueThresholdHours,
    );
  }

  async join(user: RequestUser, id: string) {
    this.assertCanMutate(user);

    const siteVisit = await this.findAccessibleSiteVisit(user, id);
    this.assertVisitIsMutable(siteVisit);

    await this.prisma.siteVisitUser.upsert({
      where: {
        siteVisitId_userId: {
          siteVisitId: siteVisit.id,
          userId: user.id,
        },
      },
      create: {
        siteVisitId: siteVisit.id,
        userId: user.id,
      },
      update: {},
    });

    return this.getById(user, siteVisit.id);
  }

  async getAssets(user: RequestUser, id: string) {
    const siteVisit = await this.findAccessibleSiteVisit(user, id);

    const links = await this.prisma.siteVisitAsset.findMany({
      where: {
        siteVisitId: siteVisit.id,
      },
      include: SITE_VISIT_ASSET_INCLUDE,
      orderBy: {
        addedAt: 'asc',
      },
    });

    return links.map((link) => this.serializeSiteVisitAssetLink(link));
  }

  async linkAsset(user: RequestUser, id: string, dto: LinkSiteVisitAssetDto) {
    this.assertCanMutate(user);

    const siteVisit = await this.findAccessibleSiteVisit(user, id);
    this.assertVisitIsMutable(siteVisit);

    const asset = await this.prisma.asset.findFirst({
      where: {
        id: dto.assetId,
        tenantId: user.tenantId,
      },
      select: {
        id: true,
        substationId: true,
      },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found.');
    }

    if (asset.substationId !== siteVisit.substationId) {
      throw new BadRequestException('Asset does not belong to the substation for the selected site visit.');
    }

    const source = this.normalizeOptionalString(dto.source);
    const notes = this.normalizeOptionalString(dto.notes);

    const link = await this.prisma.siteVisitAsset.upsert({
      where: {
        siteVisitId_assetId: {
          siteVisitId: siteVisit.id,
          assetId: asset.id,
        },
      },
      create: {
        siteVisitId: siteVisit.id,
        assetId: asset.id,
        addedByUserId: user.id,
        source: source ?? 'MANUAL',
        notes,
      },
      update: {
        ...(dto.source !== undefined ? { source } : {}),
        ...(dto.notes !== undefined ? { notes } : {}),
      },
      include: SITE_VISIT_ASSET_INCLUDE,
    });

    return this.serializeSiteVisitAssetLink(link);
  }

  async complete(user: RequestUser, id: string, dto: CompleteSiteVisitDto) {
    this.assertCanMutate(user);

    const siteVisit = await this.findAccessibleSiteVisit(user, id);
    this.assertVisitIsMutable(siteVisit);

    await this.materializeImplicitVisitAssetLinks(siteVisit.id);

    const rollup = await this.getRollup(siteVisit.id);
    this.validateCompletion(siteVisit, rollup);

    const completedAt = dto.completedAt ? this.parseDate(dto.completedAt, 'Completed at') : new Date();

    await this.prisma.siteVisit.update({
      where: {
        id: siteVisit.id,
      },
      data: {
        status: SiteVisitStatus.COMPLETED,
        completedAt,
        endedAt: completedAt,
        validationStatus: SiteVisitValidationStatus.PENDING,
        completionNotes:
          dto.completionNotes === undefined
            ? undefined
            : this.normalizeOptionalString(dto.completionNotes),
        ...this.buildSnapshotBackfill(siteVisit),
      },
    });

    return this.getById(user, siteVisit.id);
  }

  async cancel(user: RequestUser, id: string, dto: CancelSiteVisitDto) {
    this.assertCanMutate(user);

    const siteVisit = await this.findAccessibleSiteVisit(user, id);
    this.assertVisitIsMutable(siteVisit);

    const cancelledAt = dto.cancelledAt ? this.parseDate(dto.cancelledAt, 'Cancelled at') : new Date();

    await this.prisma.siteVisit.update({
      where: {
        id: siteVisit.id,
      },
      data: {
        status: SiteVisitStatus.CANCELLED,
        endedAt: cancelledAt,
        cancelReason:
          dto.cancelReason === undefined
            ? undefined
            : this.normalizeOptionalString(dto.cancelReason),
      },
    });

    return this.getById(user, siteVisit.id);
  }

  private async findAccessibleSiteVisit(user: RequestUser, id: string) {
    const siteVisit = await this.prisma.siteVisit.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
        ...this.accessScope(user),
      },
      include: {
        substation: {
          select: {
            id: true,
            code: true,
            name: true,
            location: true,
          },
        },
      },
    });

    if (!siteVisit) {
      throw new NotFoundException('Site visit not found.');
    }

    return siteVisit;
  }

  private async getRollup(siteVisitId: string): Promise<SiteVisitRollup> {
    const rollups = await this.getRollups([siteVisitId]);

    return rollups.get(siteVisitId) ?? this.emptyRollup();
  }

  private async getRollups(siteVisitIds: string[]): Promise<Map<string, SiteVisitRollup>> {
    const rollups = new Map<string, SiteVisitRollup>();

    for (const siteVisitId of siteVisitIds) {
      rollups.set(siteVisitId, this.emptyRollup());
    }

    if (siteVisitIds.length === 0) {
      return rollups;
    }

    const [
      linkedAssets,
      createdAssets,
      inspections,
      defectResults,
    ] = await Promise.all([
      this.prisma.siteVisitAsset.findMany({
        where: {
          siteVisitId: {
            in: siteVisitIds,
          },
        },
        select: {
          siteVisitId: true,
          assetId: true,
        },
      }),
      this.prisma.asset.findMany({
        where: {
          createdDuringVisitId: {
            in: siteVisitIds,
          },
        },
        select: {
          id: true,
          createdDuringVisitId: true,
        },
      }),
      this.prisma.inspection.findMany({
        where: {
          siteVisitId: {
            in: siteVisitIds,
          },
        },
        select: {
          siteVisitId: true,
          assetId: true,
          completionStatus: true,
        },
      }),
      this.prisma.inspectionItemResult.findMany({
        where: {
          isDefect: true,
          inspection: {
            siteVisitId: {
              in: siteVisitIds,
            },
          },
        },
        select: {
          inspection: {
            select: {
              siteVisitId: true,
            },
          },
        },
      }),
    ]);

    const assetIdsByVisitId = new Map<string, Set<string>>();
    const inspectedAssetIdsByVisitId = new Map<string, Set<string>>();
    const defectsByVisitId = new Map<string, number>();
    const ensureAssetSet = (map: Map<string, Set<string>>, siteVisitId: string) => {
      const existingSet = map.get(siteVisitId);

      if (existingSet) {
        return existingSet;
      }

      const nextSet = new Set<string>();
      map.set(siteVisitId, nextSet);

      return nextSet;
    };

    for (const link of linkedAssets) {
      ensureAssetSet(assetIdsByVisitId, link.siteVisitId).add(link.assetId);
    }

    for (const asset of createdAssets) {
      if (!asset.createdDuringVisitId) {
        continue;
      }

      ensureAssetSet(assetIdsByVisitId, asset.createdDuringVisitId).add(asset.id);
    }

    for (const inspection of inspections) {
      ensureAssetSet(assetIdsByVisitId, inspection.siteVisitId).add(inspection.assetId);

      if (inspection.completionStatus === InspectionCompletionStatus.SUBMITTED) {
        ensureAssetSet(inspectedAssetIdsByVisitId, inspection.siteVisitId).add(
          inspection.assetId,
        );
      }
    }

    for (const result of defectResults) {
      const siteVisitId = result.inspection.siteVisitId;
      defectsByVisitId.set(siteVisitId, (defectsByVisitId.get(siteVisitId) ?? 0) + 1);
    }

    for (const siteVisitId of siteVisitIds) {
      const totalAssets = assetIdsByVisitId.get(siteVisitId)?.size ?? 0;
      const inspectedAssets = inspectedAssetIdsByVisitId.get(siteVisitId)?.size ?? 0;
      const pendingAssets = Math.max(totalAssets - inspectedAssets, 0);
      const defectsFound = defectsByVisitId.get(siteVisitId) ?? 0;

      rollups.set(siteVisitId, {
        totalAssets,
        inspectedAssets,
        pendingAssets,
        defectsFound,
        completionPercentage:
          totalAssets === 0 ? 0 : Math.round((inspectedAssets / totalAssets) * 100),
      });
    }

    return rollups;
  }

  private emptyRollup(): SiteVisitRollup {
    return {
      totalAssets: 0,
      inspectedAssets: 0,
      pendingAssets: 0,
      defectsFound: 0,
      completionPercentage: 0,
    };
  }

  private async getEffectiveVisitAssetIds(siteVisitId: string) {
    const [linkedAssets, createdAssets, inspectedAssets] = await Promise.all([
      this.prisma.siteVisitAsset.findMany({
        where: {
          siteVisitId,
        },
        select: {
          assetId: true,
        },
      }),
      this.prisma.asset.findMany({
        where: {
          createdDuringVisitId: siteVisitId,
        },
        select: {
          id: true,
        },
      }),
      this.prisma.inspection.findMany({
        where: {
          siteVisitId,
        },
        distinct: ['assetId'],
        select: {
          assetId: true,
        },
      }),
    ]);
    const assetIds = new Set<string>();

    for (const link of linkedAssets) {
      assetIds.add(link.assetId);
    }

    for (const asset of createdAssets) {
      assetIds.add(asset.id);
    }

    for (const inspection of inspectedAssets) {
      assetIds.add(inspection.assetId);
    }

    return Array.from(assetIds);
  }

  private async getLastActivityByVisitId(
    siteVisitIds: string[],
    siteVisits: Array<Pick<SiteVisitBase, 'id' | 'startedAt' | 'updatedAt'>>,
  ) {
    const lastActivityByVisitId = new Map<string, Date>();

    for (const siteVisit of siteVisits) {
      this.setMaxActivityDate(
        lastActivityByVisitId,
        siteVisit.id,
        siteVisit.updatedAt ?? siteVisit.startedAt,
      );
    }

    if (siteVisitIds.length === 0) {
      return lastActivityByVisitId;
    }

    const [
      inspectionActivity,
      visitAssetActivity,
      siteVisitImageActivity,
      inspectionImageActivity,
    ] = await Promise.all([
      this.prisma.inspection.groupBy({
        by: ['siteVisitId'],
        where: {
          siteVisitId: {
            in: siteVisitIds,
          },
        },
        _max: {
          createdAt: true,
          updatedAt: true,
          submittedAt: true,
        },
      }),
      this.prisma.siteVisitAsset.groupBy({
        by: ['siteVisitId'],
        where: {
          siteVisitId: {
            in: siteVisitIds,
          },
        },
        _max: {
          addedAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.image.groupBy({
        by: ['siteVisitId'],
        where: {
          siteVisitId: {
            in: siteVisitIds,
          },
        },
        _max: {
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.inspectionImage.findMany({
        where: {
          inspection: {
            siteVisitId: {
              in: siteVisitIds,
            },
          },
        },
        select: {
          createdAt: true,
          inspection: {
            select: {
              siteVisitId: true,
            },
          },
        },
      }),
    ]);

    for (const activity of inspectionActivity) {
      this.setMaxActivityDate(
        lastActivityByVisitId,
        activity.siteVisitId,
        activity._max.createdAt,
      );
      this.setMaxActivityDate(
        lastActivityByVisitId,
        activity.siteVisitId,
        activity._max.updatedAt,
      );
      this.setMaxActivityDate(
        lastActivityByVisitId,
        activity.siteVisitId,
        activity._max.submittedAt,
      );
    }

    for (const activity of visitAssetActivity) {
      this.setMaxActivityDate(
        lastActivityByVisitId,
        activity.siteVisitId,
        activity._max.addedAt,
      );
      this.setMaxActivityDate(
        lastActivityByVisitId,
        activity.siteVisitId,
        activity._max.updatedAt,
      );
    }

    for (const activity of siteVisitImageActivity) {
      if (!activity.siteVisitId) {
        continue;
      }

      this.setMaxActivityDate(
        lastActivityByVisitId,
        activity.siteVisitId,
        activity._max.createdAt,
      );
      this.setMaxActivityDate(
        lastActivityByVisitId,
        activity.siteVisitId,
        activity._max.updatedAt,
      );
    }

    for (const activity of inspectionImageActivity) {
      this.setMaxActivityDate(
        lastActivityByVisitId,
        activity.inspection.siteVisitId,
        activity.createdAt,
      );
    }

    return lastActivityByVisitId;
  }

  private setMaxActivityDate(
    activityByVisitId: Map<string, Date>,
    siteVisitId: string,
    activityDate?: Date | null,
  ) {
    if (!activityDate) {
      return;
    }

    const currentActivityDate = activityByVisitId.get(siteVisitId);

    if (!currentActivityDate || activityDate > currentActivityDate) {
      activityByVisitId.set(siteVisitId, activityDate);
    }
  }

  private async materializeImplicitVisitAssetLinks(siteVisitId: string) {
    const [createdAssets, inspectedAssets] = await Promise.all([
      this.prisma.asset.findMany({
        where: {
          createdDuringVisitId: siteVisitId,
        },
        select: {
          id: true,
          createdByUserId: true,
          createdAt: true,
        },
      }),
      this.prisma.inspection.findMany({
        where: {
          siteVisitId,
        },
        distinct: ['assetId'],
        select: {
          assetId: true,
          createdByUserId: true,
          createdAt: true,
        },
      }),
    ]);
    const linkDataByAssetId = new Map<
      string,
      {
        id: string;
        siteVisitId: string;
        assetId: string;
        addedByUserId: string | null;
        source: string;
        addedAt: Date;
      }
    >();

    for (const asset of createdAssets) {
      linkDataByAssetId.set(asset.id, {
        id: randomUUID(),
        siteVisitId,
        assetId: asset.id,
        addedByUserId: asset.createdByUserId,
        source: 'CREATED_DURING_VISIT_BACKFILL',
        addedAt: asset.createdAt,
      });
    }

    for (const inspection of inspectedAssets) {
      if (linkDataByAssetId.has(inspection.assetId)) {
        continue;
      }

      linkDataByAssetId.set(inspection.assetId, {
        id: randomUUID(),
        siteVisitId,
        assetId: inspection.assetId,
        addedByUserId: inspection.createdByUserId,
        source: 'INSPECTION_BACKFILL',
        addedAt: inspection.createdAt,
      });
    }

    if (linkDataByAssetId.size === 0) {
      return;
    }

    await this.prisma.siteVisitAsset.createMany({
      data: Array.from(linkDataByAssetId.values()),
      skipDuplicates: true,
    });
  }

  private validateCompletion(
    siteVisit: Awaited<ReturnType<SiteVisitsService['findAccessibleSiteVisit']>>,
    rollup: SiteVisitRollup,
  ) {
    const missingFields: string[] = [];

    if (rollup.totalAssets === 0) {
      missingFields.push('at least one linked asset');
    }

    if (!this.normalizeOptionalString(siteVisit.pencawangCode ?? siteVisit.substation.code)) {
      missingFields.push('KOD PENCAWANG');
    }

    if (!this.normalizeOptionalString(siteVisit.pencawangName ?? siteVisit.substation.name)) {
      missingFields.push('NAMA PENCAWANG');
    }

    const hasPartialCheckInCoordinate =
      siteVisit.checkInLatitude !== null || siteVisit.checkInLongitude !== null;

    if (
      hasPartialCheckInCoordinate &&
      (siteVisit.checkInLatitude === null || siteVisit.checkInLongitude === null)
    ) {
      missingFields.push('complete check-in GPS coordinate pair');
    }

    if (missingFields.length > 0) {
      throw new BadRequestException({
        message: 'Site visit cannot be completed yet.',
        missingFields,
      });
    }
  }

  private buildSnapshotBackfill(
    siteVisit: Awaited<ReturnType<SiteVisitsService['findAccessibleSiteVisit']>>,
  ): Prisma.SiteVisitUpdateInput {
    return {
      pencawangCode: siteVisit.pencawangCode ?? siteVisit.substation.code,
      pencawangName: siteVisit.pencawangName ?? siteVisit.substation.name,
      functionalLocation: siteVisit.functionalLocation ?? siteVisit.substation.location,
    };
  }

  private serializeSiteVisitListItem(
    siteVisit: SiteVisitBase,
    rollup: SiteVisitRollup,
    lastActivityAt: Date,
    now: Date,
    overdueThresholdHours: number,
  ) {
    const teamMembers = this.serializeTeamMembers(siteVisit);
    const isOverdue = isSiteVisitOverdue({
      status: siteVisit.status,
      startedAt: siteVisit.startedAt,
      now,
      overdueThresholdHours,
    });
    const operationalHealthStatus = calculateOperationalHealthStatus({
      status: siteVisit.status,
      validationStatus: siteVisit.validationStatus,
      startedAt: siteVisit.startedAt,
      lastActivityAt,
      now,
      overdueThresholdHours,
    });

    return {
      ...siteVisit,
      completedAt:
        siteVisit.completedAt ??
        (siteVisit.status === SiteVisitStatus.COMPLETED ? siteVisit.endedAt : null),
      summary: rollup,
      ...rollup,
      teamMembers,
      lastActivityAt: lastActivityAt.toISOString(),
      operationalHealthStatus,
      isOverdue,
      overdueThresholdHours,
    };
  }

  private serializeSiteVisitDetail(
    siteVisit: SiteVisitDetail,
    rollup: SiteVisitRollup,
    lastActivityAt: Date,
    now: Date,
    overdueThresholdHours: number,
  ) {
    const teamMembers = this.serializeTeamMembers(siteVisit);
    const isOverdue = isSiteVisitOverdue({
      status: siteVisit.status,
      startedAt: siteVisit.startedAt,
      now,
      overdueThresholdHours,
    });
    const operationalHealthStatus = calculateOperationalHealthStatus({
      status: siteVisit.status,
      validationStatus: siteVisit.validationStatus,
      startedAt: siteVisit.startedAt,
      lastActivityAt,
      now,
      overdueThresholdHours,
    });

    return {
      ...siteVisit,
      completedAt:
        siteVisit.completedAt ??
        (siteVisit.status === SiteVisitStatus.COMPLETED ? siteVisit.endedAt : null),
      summary: rollup,
      ...rollup,
      teamMembers,
      visitAssets: siteVisit.visitAssets.map((link) =>
        this.serializeSiteVisitAssetLink(link),
      ),
      linkedAssets: siteVisit.visitAssets.map((link) =>
        this.serializeSiteVisitAssetLink(link),
      ),
      lastActivityAt: lastActivityAt.toISOString(),
      operationalHealthStatus,
      isOverdue,
      overdueThresholdHours,
      operationalMetadata: {
        mainhead: siteVisit.mainhead,
        pencawangCode: siteVisit.pencawangCode ?? siteVisit.substation.code,
        pencawangName: siteVisit.pencawangName ?? siteVisit.substation.name,
        functionalLocation:
          siteVisit.functionalLocation ?? siteVisit.substation.location,
        visitType: siteVisit.visitType,
        cycleNumber: siteVisit.cycleNumber,
        checkInLatitude: siteVisit.checkInLatitude,
        checkInLongitude: siteVisit.checkInLongitude,
        checkInAccuracyMeters: siteVisit.checkInAccuracyMeters,
        checkInCapturedAt: siteVisit.checkInCapturedAt,
        feederId: siteVisit.feederId,
        feederRouteId: siteVisit.feederRouteId,
        gisGeometryVersion: siteVisit.gisGeometryVersion,
      },
    };
  }

  private serializeTeamMembers(siteVisit: SiteVisitBase) {
    return siteVisit.users.map((entry) => ({
      id: entry.user.id,
      email: entry.user.email,
      name: entry.user.name,
      role: entry.user.role,
      siteVisitUserId: entry.id,
      joinedAt: entry.joinedAt,
    }));
  }

  private serializeSiteVisitAssetLink(link: SiteVisitAssetLink) {
    return {
      id: link.id,
      siteVisitId: link.siteVisitId,
      assetId: link.assetId,
      addedByUserId: link.addedByUserId,
      addedAt: link.addedAt,
      source: link.source,
      notes: link.notes,
      addedBy: link.addedBy,
      asset: link.asset,
    };
  }

  private assertCanMutate(user: RequestUser) {
    if (user.role === UserRole.VIEWER || user.role === UserRole.CLIENT) {
      throw new ForbiddenException('This role is read-only for operational workflow actions.');
    }
  }

  private assertVisitIsMutable(siteVisit: { status: SiteVisitStatus }) {
    if (TERMINAL_SITE_VISIT_STATUSES.has(siteVisit.status)) {
      throw new BadRequestException('Completed or cancelled site visits cannot be modified.');
    }
  }

  private parseDate(value: string, label: string) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${label} must be a valid date.`);
    }

    return date;
  }

  private buildListWhere(
    user: RequestUser,
    query: ListSiteVisitsQueryDto,
  ): Prisma.SiteVisitWhereInput {
    const filters: Prisma.SiteVisitWhereInput[] = [
      {
        tenantId: user.tenantId,
      },
      this.accessScope(user),
      this.statusFilter(query.status),
      this.validationStatusFilter(query.validationStatus),
      this.visitTypeFilter(query.visitType),
      this.teamFilter(query.teamId),
      this.userFilter(query.userId),
      this.mainheadFilter(query.mainhead),
      this.pencawangFilter(query.pencawang),
      this.dateFilter(query.dateFrom, query.dateTo),
      this.searchFilter(query.search),
    ].filter((filter) => Object.keys(filter).length > 0);

    return {
      AND: filters,
    };
  }

  private statusFilter(
    status: ListSiteVisitsQueryDto['status'],
  ): Prisma.SiteVisitWhereInput {
    if (!status) {
      return {};
    }

    if (status === SiteVisitStatus.ACTIVE) {
      return {
        status: {
          in: [...ACTIVE_SITE_VISIT_STATUSES],
        },
      };
    }

    return {
      status: status as SiteVisitStatus,
    };
  }

  private validationStatusFilter(
    validationStatus: ListSiteVisitsQueryDto['validationStatus'],
  ): Prisma.SiteVisitWhereInput {
    return validationStatus ? { validationStatus } : {};
  }

  private visitTypeFilter(
    visitType: ListSiteVisitsQueryDto['visitType'],
  ): Prisma.SiteVisitWhereInput {
    return visitType ? { visitType } : {};
  }

  private teamFilter(teamId: ListSiteVisitsQueryDto['teamId']): Prisma.SiteVisitWhereInput {
    return teamId ? { teamId } : {};
  }

  private userFilter(userId: ListSiteVisitsQueryDto['userId']): Prisma.SiteVisitWhereInput {
    if (!userId) {
      return {};
    }

    return {
      users: {
        some: {
          userId,
        },
      },
    };
  }

  private mainheadFilter(mainhead?: string): Prisma.SiteVisitWhereInput {
    const value = this.normalizeOptionalString(mainhead);

    if (!value) {
      return {};
    }

    return {
      mainhead: {
        contains: value,
        mode: 'insensitive',
      },
    };
  }

  private pencawangFilter(pencawang?: string): Prisma.SiteVisitWhereInput {
    const value = this.normalizeOptionalString(pencawang);

    if (!value) {
      return {};
    }

    return {
      OR: [
        {
          pencawangCode: {
            contains: value,
            mode: 'insensitive',
          },
        },
        {
          pencawangName: {
            contains: value,
            mode: 'insensitive',
          },
        },
        {
          substation: {
            code: {
              contains: value,
              mode: 'insensitive',
            },
          },
        },
        {
          substation: {
            name: {
              contains: value,
              mode: 'insensitive',
            },
          },
        },
      ],
    };
  }

  private searchFilter(search?: string): Prisma.SiteVisitWhereInput {
    const value = this.normalizeOptionalString(search);

    if (!value) {
      return {};
    }

    return {
      OR: [
        {
          mainhead: {
            contains: value,
            mode: 'insensitive',
          },
        },
        {
          pencawangCode: {
            contains: value,
            mode: 'insensitive',
          },
        },
        {
          pencawangName: {
            contains: value,
            mode: 'insensitive',
          },
        },
        {
          functionalLocation: {
            contains: value,
            mode: 'insensitive',
          },
        },
        {
          notes: {
            contains: value,
            mode: 'insensitive',
          },
        },
        {
          completionNotes: {
            contains: value,
            mode: 'insensitive',
          },
        },
        {
          team: {
            OR: [
              {
                code: {
                  contains: value,
                  mode: 'insensitive',
                },
              },
              {
                name: {
                  contains: value,
                  mode: 'insensitive',
                },
              },
            ],
          },
        },
        {
          substation: {
            OR: [
              {
                code: {
                  contains: value,
                  mode: 'insensitive',
                },
              },
              {
                name: {
                  contains: value,
                  mode: 'insensitive',
                },
              },
              {
                location: {
                  contains: value,
                  mode: 'insensitive',
                },
              },
            ],
          },
        },
        {
          users: {
            some: {
              user: {
                OR: [
                  {
                    name: {
                      contains: value,
                      mode: 'insensitive',
                    },
                  },
                  {
                    email: {
                      contains: value,
                      mode: 'insensitive',
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    };
  }

  private dateFilter(dateFrom?: string, dateTo?: string): Prisma.SiteVisitWhereInput {
    const startedAt: Prisma.DateTimeFilter = {};

    if (dateFrom) {
      startedAt.gte = this.parseListDate(dateFrom, false);
    }

    if (dateTo) {
      startedAt.lte = this.parseListDate(dateTo, true);
    }

    return Object.keys(startedAt).length > 0 ? { startedAt } : {};
  }

  private parseListDate(value: string, endOfDay: boolean) {
    const date =
      endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T23:59:59.999Z`)
        : new Date(value);

    return date;
  }

  private getOverdueThresholdHours() {
    return parseOperationalOverdueThresholdHours(
      this.configService.get<string>('OPERATIONAL_VISIT_OVERDUE_HOURS') ??
        this.configService.get<string>('SITE_VISIT_OVERDUE_HOURS'),
    );
  }

  private normalizeCreateStatus(status: CreateSiteVisitDto['status']): SiteVisitStatus {
    if (status === SiteVisitStatus.OPEN) {
      return SiteVisitStatus.OPEN;
    }

    if (status === SiteVisitStatus.IN_PROGRESS) {
      return SiteVisitStatus.IN_PROGRESS;
    }

    return SiteVisitStatus.ACTIVE;
  }

  private accessScope(user: RequestUser): Prisma.SiteVisitWhereInput {
    if (user.role === UserRole.ADMIN) {
      return {};
    }

    return {
      team: {
        members: {
          some: {
            userId: user.id,
            isActive: true,
          },
        },
      },
    };
  }

  private normalizeOptionalString(value?: string | null) {
    if (!value) {
      return null;
    }

    const trimmedValue = value.trim();

    return trimmedValue ? trimmedValue : null;
  }
}
