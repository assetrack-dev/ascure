import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { extname, resolve } from 'path';
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
import {
  DEFAULT_OPERATION_MODE,
  DEFAULT_OPERATIONAL_SCOPE,
  getSessionKindForScope,
  scopeRequiresQAQC,
} from '../common/operational-scope';
import { normalizeOperationalText } from '../common/operational-text';
import {
  buildSiteVisitImagePath,
  buildSiteVisitImagesDirectory,
  buildSiteVisitImageUrl,
} from '../common/uploads.constants';
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
  fromPencawang: {
    select: {
      id: true,
      code: true,
      name: true,
      location: true,
    },
  },
  toPencawang: {
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

const SITE_VISIT_ENTERPRISE_INCLUDE = Prisma.validator<Prisma.SiteVisitInclude>()({
  organization: {
    select: {
      id: true,
      name: true,
      code: true,
      type: true,
      isActive: true,
    },
  },
  branch: {
    select: {
      id: true,
      organizationId: true,
      name: true,
      code: true,
      region: true,
      isActive: true,
    },
  },
  mainheadRecord: {
    select: {
      id: true,
      branchId: true,
      name: true,
      code: true,
      description: true,
      isActive: true,
    },
  },
  project: {
    select: {
      id: true,
      branchId: true,
      mainheadId: true,
      clientOrganizationId: true,
      name: true,
      code: true,
      status: true,
      operationalDomain: true,
      mainhead: {
        select: {
          id: true,
          branchId: true,
          name: true,
          code: true,
          isActive: true,
        },
      },
    },
  },
  workPackage: {
    select: {
      id: true,
      projectId: true,
      mainheadId: true,
      name: true,
      code: true,
      area: true,
      mainhead: true,
      status: true,
      operationalDomain: true,
      mainheadRecord: {
        select: {
          id: true,
          branchId: true,
          name: true,
          code: true,
          isActive: true,
        },
      },
    },
  },
  participants: {
    select: {
      id: true,
      siteVisitId: true,
      userId: true,
      role: true,
      joinedAt: true,
      leftAt: true,
      isActive: true,
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

const SITE_VISIT_READ_BASE_INCLUDE = Prisma.validator<Prisma.SiteVisitInclude>()({
  ...SITE_VISIT_BASE_INCLUDE,
  ...SITE_VISIT_ENTERPRISE_INCLUDE,
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

const SITE_VISIT_READ_DETAIL_INCLUDE = Prisma.validator<Prisma.SiteVisitInclude>()({
  ...SITE_VISIT_DETAIL_INCLUDE,
  ...SITE_VISIT_ENTERPRISE_INCLUDE,
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

type UploadedSiteVisitImageFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
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

    const substation = await this.resolveCreateSubstation(user, dto);
    const operationalLinks = await this.resolveCreateOperationalLinks(dto);
    const operationalSession = await this.resolveCreateOperationalSession(user, dto);

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

    try {
      return await this.prisma.siteVisit.create({
        data: {
          tenantId: user.tenantId,
          teamId: dto.teamId,
          substationId: substation.id,
          createdByUserId: user.id,
          organizationId: operationalLinks.organizationId,
          branchId: operationalLinks.branchId,
          mainheadId: operationalLinks.mainheadId,
          projectId: operationalLinks.projectId,
          workPackageId: operationalLinks.workPackageId,
          status: this.normalizeCreateStatus(dto.status),
          cycleNumber: dto.cycleNumber,
          visitType: dto.visitType,
          operationalDomain: operationalLinks.operationalDomain,
          operationMode: operationalSession.operationMode,
          operationalScope: operationalSession.operationalScope,
          sessionKind: operationalSession.sessionKind,
          fromPencawangId: operationalSession.fromPencawangId,
          toPencawangId: operationalSession.toPencawangId,
          requiresQAQC: operationalSession.requiresQAQC,
          reportingGroup: operationalSession.reportingGroup,
          mainhead:
            this.normalizeOperationalString(dto.mainhead) ??
            operationalLinks.mainheadLabel,
          pencawangCode: dto.substationId
            ? this.normalizePencawangCode(dto.pencawangCode) ??
              this.normalizePencawangCode(substation.code) ??
              substation.code
            : substation.code,
          pencawangName:
            this.normalizeOperationalString(dto.pencawangName) ??
            this.normalizeOperationalString(substation.name) ??
            substation.name,
          functionalLocation:
            this.normalizeOperationalString(dto.functionalLocation) ??
            this.normalizeOperationalString(substation.location) ??
            substation.location,
          checkInLatitude: dto.checkInLatitude,
          checkInLongitude: dto.checkInLongitude,
          checkInAccuracyMeters: dto.checkInAccuracyMeters,
          checkInCapturedAt: dto.checkInCapturedAt ? new Date(dto.checkInCapturedAt) : undefined,
          validationStatus: SiteVisitValidationStatus.PENDING,
          notes: this.normalizeOperationalString(dto.notes),
          users: {
            create: Array.from(visitUserIds).map((userId) => ({
              userId,
            })),
          },
        },
        include: SITE_VISIT_READ_BASE_INCLUDE,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A Pencawang with this code already exists.');
      }

      throw error;
    }
  }

  async list(user: RequestUser, query: ListSiteVisitsQueryDto) {
    const siteVisits = await this.prisma.siteVisit.findMany({
      where: this.buildListWhere(user, query),
      include: SITE_VISIT_READ_BASE_INCLUDE,
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

  async getReadById(user: RequestUser, id: string) {
    const siteVisit = await this.prisma.siteVisit.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
        ...this.accessScope(user),
      },
      include: SITE_VISIT_READ_DETAIL_INCLUDE,
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

  async uploadImage(
    user: RequestUser,
    id: string,
    file: UploadedSiteVisitImageFile | undefined,
  ) {
    this.assertCanMutate(user);

    if (!file?.buffer?.length) {
      throw new BadRequestException('Image file is required.');
    }

    const siteVisit = await this.findAccessibleSiteVisit(user, id);
    this.assertVisitIsMutable(siteVisit);

    const uploadDirectory = buildSiteVisitImagesDirectory(siteVisit.id);

    await mkdir(uploadDirectory, { recursive: true });

    const fileExtension = this.getSafeFileExtension(file.originalname);
    const fileName = `${Date.now()}-${randomUUID()}${fileExtension}`;
    const storageKey = buildSiteVisitImagePath(siteVisit.id, fileName);
    const filePath = resolve(uploadDirectory, fileName);

    await writeFile(filePath, file.buffer);

    const image = await this.prisma.image.create({
      data: {
        tenantId: user.tenantId,
        siteVisitId: siteVisit.id,
        createdByUserId: user.id,
        fileName,
        storageKey,
        contentType: file.mimetype || null,
        url: buildSiteVisitImageUrl(siteVisit.id, fileName),
      },
    });

    return this.serializeSiteVisitImage(image);
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
    const notes = this.normalizeOperationalString(dto.notes);

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
            : this.normalizeOperationalString(dto.completionNotes),
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
            : this.normalizeOperationalString(dto.cancelReason),
      },
    });

    return this.getById(user, siteVisit.id);
  }

  private async resolveCreateSubstation(user: RequestUser, dto: CreateSiteVisitDto) {
    if (dto.substationId) {
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

      return substation;
    }

    this.validateManualPencawangCreate(dto);

    const pencawangCode = this.normalizePencawangCode(dto.pencawangCode);
    const pencawangName = this.normalizeOperationalString(dto.pencawangName);
    const functionalLocation = this.normalizeOperationalString(dto.functionalLocation);

    if (!pencawangCode || !pencawangName || !functionalLocation) {
      throw new BadRequestException('New Pencawang details are required.');
    }

    const existingSubstation = await this.prisma.substation.findFirst({
      where: {
        tenantId: user.tenantId,
        OR: [
          {
            code: {
              equals: pencawangCode,
              mode: 'insensitive',
            },
          },
          {
            name: {
              equals: pencawangName,
              mode: 'insensitive',
            },
          },
        ],
      },
      select: {
        id: true,
      },
    });

    if (existingSubstation) {
      throw new ConflictException('A Pencawang with this code or name already exists. Use Existing Pencawang mode to check in.');
    }

    try {
      return await this.prisma.substation.create({
        data: {
          tenantId: user.tenantId,
          code: pencawangCode,
          name: pencawangName,
          location: functionalLocation,
        },
        select: {
          id: true,
          code: true,
          name: true,
          location: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A Pencawang with this code already exists. Use Existing Pencawang mode to check in.');
      }

      throw error;
    }
  }

  private async resolveCreateOperationalLinks(dto: CreateSiteVisitDto) {
    const [organization, branch, mainhead, project, workPackage] =
      await Promise.all([
        dto.organizationId
          ? this.prisma.organization.findUnique({
              where: {
                id: dto.organizationId,
              },
              select: {
                id: true,
              },
            })
          : null,
        dto.branchId
          ? this.prisma.branch.findUnique({
              where: {
                id: dto.branchId,
              },
              select: {
                id: true,
                organizationId: true,
              },
            })
          : null,
        dto.mainheadId
          ? this.prisma.mainhead.findUnique({
              where: {
                id: dto.mainheadId,
              },
              select: {
                id: true,
                branchId: true,
                name: true,
                code: true,
                branch: {
                  select: {
                    organizationId: true,
                  },
                },
              },
            })
          : null,
        dto.projectId
          ? this.prisma.project.findUnique({
              where: {
                id: dto.projectId,
              },
              select: {
                id: true,
                branchId: true,
                mainheadId: true,
                clientOrganizationId: true,
                operationalDomain: true,
              },
            })
          : null,
        dto.workPackageId
          ? this.prisma.workPackage.findUnique({
              where: {
                id: dto.workPackageId,
              },
              select: {
                id: true,
                projectId: true,
                mainheadId: true,
                mainhead: true,
                operationalDomain: true,
                project: {
                  select: {
                    branchId: true,
                    mainheadId: true,
                    clientOrganizationId: true,
                    operationalDomain: true,
                  },
                },
                mainheadRecord: {
                  select: {
                    id: true,
                    branchId: true,
                    name: true,
                    code: true,
                    branch: {
                      select: {
                        organizationId: true,
                      },
                    },
                  },
                },
              },
            })
          : null,
      ]);

    if (dto.organizationId && !organization) {
      throw new NotFoundException('Organization not found.');
    }

    if (dto.branchId && !branch) {
      throw new NotFoundException('Branch not found.');
    }

    if (dto.mainheadId && !mainhead) {
      throw new NotFoundException('MAINHEAD not found.');
    }

    if (dto.projectId && !project) {
      throw new NotFoundException('Project not found.');
    }

    if (dto.workPackageId && !workPackage) {
      throw new NotFoundException('Work package not found.');
    }

    if (workPackage && project && workPackage.projectId !== project.id) {
      throw new BadRequestException(
        'Work package does not belong to the selected project.',
      );
    }

    if (mainhead && project?.mainheadId && project.mainheadId !== mainhead.id) {
      throw new BadRequestException(
        'Project does not belong to the selected MAINHEAD.',
      );
    }

    if (
      mainhead &&
      workPackage?.mainheadId &&
      workPackage.mainheadId !== mainhead.id
    ) {
      throw new BadRequestException(
        'Work package does not belong to the selected MAINHEAD.',
      );
    }

    const resolvedMainhead =
      mainhead ?? workPackage?.mainheadRecord ?? null;
    const resolvedProject = project ?? workPackage?.project ?? null;
    const branchId =
      branch?.id ??
      resolvedMainhead?.branchId ??
      resolvedProject?.branchId ??
      null;

    return {
      organizationId:
        organization?.id ??
        branch?.organizationId ??
        resolvedMainhead?.branch?.organizationId ??
        resolvedProject?.clientOrganizationId ??
        null,
      branchId,
      mainheadId:
        resolvedMainhead?.id ??
        resolvedProject?.mainheadId ??
        null,
      projectId: project?.id ?? workPackage?.projectId ?? null,
      workPackageId: workPackage?.id ?? null,
      operationalDomain:
        dto.operationalDomain ??
        workPackage?.operationalDomain ??
        resolvedProject?.operationalDomain ??
        null,
      mainheadLabel:
        resolvedMainhead?.name ??
        resolvedMainhead?.code ??
        this.normalizeOperationalString(workPackage?.mainhead) ??
        null,
    };
  }

  private async resolveCreateOperationalSession(
    user: RequestUser,
    dto: CreateSiteVisitDto,
  ) {
    const operationalScope = dto.operationalScope ?? DEFAULT_OPERATIONAL_SCOPE;

    const [fromPencawangId, toPencawangId] = await Promise.all([
      this.resolveOptionalPencawangId(
        user,
        dto.fromPencawangId,
        'From Pencawang',
      ),
      this.resolveOptionalPencawangId(
        user,
        dto.toPencawangId,
        'To Pencawang',
      ),
    ]);

    return {
      operationMode: dto.operationMode ?? DEFAULT_OPERATION_MODE,
      operationalScope,
      sessionKind: dto.sessionKind ?? getSessionKindForScope(operationalScope),
      fromPencawangId,
      toPencawangId,
      requiresQAQC: dto.requiresQAQC ?? scopeRequiresQAQC(operationalScope),
      reportingGroup: this.normalizeOperationalString(dto.reportingGroup),
    };
  }

  private async resolveOptionalPencawangId(
    user: RequestUser,
    pencawangId: string | undefined,
    label: string,
  ) {
    if (!pencawangId) {
      return null;
    }

    const pencawang = await this.prisma.substation.findFirst({
      where: {
        id: pencawangId,
        tenantId: user.tenantId,
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    if (!pencawang) {
      throw new NotFoundException(`${label} not found.`);
    }

    return pencawang.id;
  }

  private validateManualPencawangCreate(dto: CreateSiteVisitDto) {
    const missingFields: Array<{ key: string; label: string }> = [];

    if (!this.normalizeOptionalString(dto.pencawangName)) {
      missingFields.push({ key: 'pencawangName', label: 'Nama Pencawang' });
    }

    if (!this.normalizeOptionalString(dto.functionalLocation)) {
      missingFields.push({ key: 'functionalLocation', label: 'Functional Location' });
    }

    if (!this.normalizeOptionalString(dto.pencawangCode)) {
      missingFields.push({ key: 'pencawangCode', label: 'Kod Pencawang' });
    }

    if (!dto.mainheadId) {
      missingFields.push({ key: 'mainheadId', label: 'MAINHEAD' });
    }

    if (dto.checkInLatitude === undefined || dto.checkInLongitude === undefined) {
      missingFields.push({ key: 'checkInLocation', label: 'GPS location' });
    }

    if (dto.checkInAccuracyMeters === undefined) {
      missingFields.push({ key: 'checkInAccuracyMeters', label: 'GPS accuracy' });
    }

    if (missingFields.length > 0) {
      throw new BadRequestException({
        message: 'New Pencawang check-in requires manual site details.',
        missingFields,
      });
    }
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
      pencawangCode:
        this.normalizePencawangCode(siteVisit.pencawangCode ?? siteVisit.substation.code) ??
        siteVisit.pencawangCode ??
        siteVisit.substation.code,
      pencawangName:
        this.normalizeOperationalString(siteVisit.pencawangName ?? siteVisit.substation.name) ??
        siteVisit.pencawangName ??
        siteVisit.substation.name,
      functionalLocation:
        this.normalizeOperationalString(
          siteVisit.functionalLocation ?? siteVisit.substation.location,
        ) ??
        siteVisit.functionalLocation ??
        siteVisit.substation.location,
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
        operationMode: siteVisit.operationMode,
        operationalScope: siteVisit.operationalScope,
        sessionKind: siteVisit.sessionKind,
        fromPencawangId: siteVisit.fromPencawangId,
        toPencawangId: siteVisit.toPencawangId,
        fromPencawang: siteVisit.fromPencawang,
        toPencawang: siteVisit.toPencawang,
        requiresQAQC: siteVisit.requiresQAQC,
        reportingGroup: siteVisit.reportingGroup,
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

  private serializeSiteVisitImage(image: {
    id: string;
    fileName: string;
    storageKey: string;
    contentType: string | null;
    url: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: image.id,
      fileName: image.fileName,
      storageKey: image.storageKey,
      contentType: image.contentType,
      url: image.url,
      path: image.storageKey,
      createdAt: image.createdAt.toISOString(),
      updatedAt: image.updatedAt.toISOString(),
    };
  }

  private getSafeFileExtension(originalName: string | undefined) {
    const extension = extname(originalName || '').toLowerCase();

    if (/^\.[a-z0-9]{1,10}$/.test(extension)) {
      return extension;
    }

    return '.jpg';
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
      this.operationalDomainFilter(query.operationalDomain),
      this.operationModeFilter(query.operationMode),
      this.operationalScopeFilter(query.operationalScope),
      this.sessionKindFilter(query.sessionKind),
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

  private operationalDomainFilter(
    operationalDomain: ListSiteVisitsQueryDto['operationalDomain'],
  ): Prisma.SiteVisitWhereInput {
    return operationalDomain ? { operationalDomain } : {};
  }

  private operationModeFilter(
    operationMode: ListSiteVisitsQueryDto['operationMode'],
  ): Prisma.SiteVisitWhereInput {
    return operationMode ? { operationMode } : {};
  }

  private operationalScopeFilter(
    operationalScope: ListSiteVisitsQueryDto['operationalScope'],
  ): Prisma.SiteVisitWhereInput {
    return operationalScope ? { operationalScope } : {};
  }

  private sessionKindFilter(
    sessionKind: ListSiteVisitsQueryDto['sessionKind'],
  ): Prisma.SiteVisitWhereInput {
    return sessionKind ? { sessionKind } : {};
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

  private normalizePencawangCode(value?: string | null) {
    return this.normalizeOperationalString(value);
  }

  private normalizeOperationalString(value?: string | null) {
    const normalizedValue = this.normalizeOptionalString(value);

    return normalizedValue ? normalizeOperationalText(normalizedValue) : null;
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
