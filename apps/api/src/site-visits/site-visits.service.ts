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
  AssetStatus,
  InspectionCompletionStatus,
  InspectionItemInputType,
  Prisma,
  SiteVisitStatus,
  SiteVisitType,
  SiteVisitValidationStatus,
  SurveyLifecycleStatus,
  UserRole,
} from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import {
  buildScopeContext,
  ScopeContext,
} from '../common/authorization/scope-context';
import {
  siteVisitAccessWhere,
  siteVisitOversightWhere,
} from '../common/authorization/site-visit-scope';
import {
  calculateOperationalHealthStatus,
  isSiteVisitOverdue,
  parseOperationalOverdueThresholdHours,
} from '../common/operational-health';
import { describeInspectionRecency } from '../common/inspection-cadence';
import {
  deriveDisplayStatus,
  DISPLAY_STATUS_LABEL,
} from '@ascure/shared-utils';
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
import { ReassignSiteVisitDto } from './dto/reassign-site-visit.dto';
import { UpdateSiteVisitDto } from './dto/update-site-visit.dto';

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
      // Latest inspection so the in-visit map can color poles by status
      // (lime = inspected/submitted, red = not yet) — mirrors what
      // masterDataService.listAssets returns for the no-visit map. Filter to
      // SUBMITTED so an amended-to-DRAFT or newer-cycle draft cannot mask a
      // real submission and leave an inspected pole red.
      inspections: {
        where: { completionStatus: InspectionCompletionStatus.SUBMITTED },
        take: 1,
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          completionStatus: true,
          submittedAt: true,
          // Which checklist template this inspection ran — resolves the full set
          // of template-defined fields the DC can turn on as Linked-Assets columns.
          templateId: true,
          // Recorded checklist VALUES (InspectionResult, keyed by template-item
          // label) surfaced as Linked-Assets columns for DC checking — the same
          // source the Download Checklist uses, NOT itemResults.remark.
          results: {
            select: {
              templateItemId: true,
              valueText: true,
              valueNumber: true,
              // Non-text field types so a toggled BOOLEAN / DATE checklist column
              // shows its answer instead of a blank (KELEGAAN/CATITAN are text, so
              // the fixed columns are unaffected).
              valueBoolean: true,
              valueDate: true,
              valueDateTime: true,
              templateItem: { select: { label: true } },
            },
          },
          // Item-tagged photos (the Smart Sensor / OCR captures) so the DC can
          // eyeball the LCD in the Linked-Assets table and re-verify the recorded
          // reading against the real measurement. Mobile tags each OCR capture
          // with its checklist item's templateItemId (InspectionFormScreen), so a
          // reading pairs with its photo by that id. Only item-bound photos are
          // needed here — general inspection photos live in the visit Images tab.
          inspectionImages: {
            where: { templateItemId: { not: null } },
            select: {
              url: true,
              filename: true,
              templateItemId: true,
              latitude: true,
              longitude: true,
              timestamp: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
          },
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
  lifecycleEvents: {
    include: {
      createdBy: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
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

/** A checklist field the DC can toggle on as a Linked-Assets column. `key` is the
 *  normalized (upper, single-spaced) label used to match recorded values; `label`
 *  is shown as-is; `section` is the template group for the picker. */
type ChecklistColumnDef = { key: string; label: string; section: string | null };

type SiteVisitRollup = {
  totalAssets: number;
  inspectedAssets: number;
  pendingAssets: number;
  defectsFound: number;
  completionPercentage: number;
};

type ObservedPole = {
  id: string;
  assetCode: string;
  noTiangLama: string | null;
  status: AssetStatus;
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

    // Durable structural link: a Pencawang belongs to a MAINHEAD via
    // Substation.mainheadId, which drives the hierarchical Asset Map
    // (Region -> Mainhead -> Pencawang). New Pencawang created in the field only
    // ever recorded the crew's free-text mainhead, never this FK, so their poles
    // fell into the map's "Unassigned" bucket. Here the check-in Pencawang adopts
    // the visit's already-validated Mainhead. `updateMany` + `mainheadId: null`
    // makes it idempotent: it only fills an unset link (never overwrites a real
    // one), so it ALSO self-heals any pre-existing Pencawang the next time it's
    // visited. See [[project_hierarchical_map]].
    if (operationalLinks.mainheadId) {
      await this.prisma.substation.updateMany({
        where: { id: substation.id, mainheadId: null },
        data: { mainheadId: operationalLinks.mainheadId },
      });
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
          routeCode: operationalSession.routeCode,
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
          // A new visit opens the cycle survey in DALAM RONDAAN (north-star §4).
          lifecycleStatus: SurveyLifecycleStatus.DALAM_RONDAAN,
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
    const ctx = await buildScopeContext(this.prisma, user);
    const siteVisits = await this.prisma.siteVisit.findMany({
      where: this.buildListWhere(user, query, ctx),
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
    const ctx = await buildScopeContext(this.prisma, user);
    const siteVisit = await this.prisma.siteVisit.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
        ...this.oversightScope(user, ctx),
      },
      include: SITE_VISIT_READ_DETAIL_INCLUDE,
    });

    if (!siteVisit) {
      throw new NotFoundException('Site visit not found.');
    }

    const [rollup, lastActivityByVisitId, checklistColumns] = await Promise.all([
      this.getRollup(siteVisit.id),
      this.getLastActivityByVisitId([siteVisit.id], [siteVisit]),
      this.resolveChecklistColumns(siteVisit),
    ]);
    const now = new Date();
    const overdueThresholdHours = this.getOverdueThresholdHours();

    return this.serializeSiteVisitDetail(
      siteVisit,
      rollup,
      lastActivityByVisitId.get(siteVisit.id) ?? siteVisit.updatedAt,
      now,
      overdueThresholdHours,
      checklistColumns,
    );
  }

  async getById(user: RequestUser, id: string) {
    const ctx = await buildScopeContext(this.prisma, user);
    const siteVisit = await this.prisma.siteVisit.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
        ...this.oversightScope(user, ctx),
      },
      include: SITE_VISIT_DETAIL_INCLUDE,
    });

    if (!siteVisit) {
      throw new NotFoundException('Site visit not found.');
    }

    const [rollup, lastActivityByVisitId, checklistColumns] = await Promise.all([
      this.getRollup(siteVisit.id),
      this.getLastActivityByVisitId([siteVisit.id], [siteVisit]),
      this.resolveChecklistColumns(siteVisit),
    ]);
    const now = new Date();
    const overdueThresholdHours = this.getOverdueThresholdHours();

    return this.serializeSiteVisitDetail(
      siteVisit,
      rollup,
      lastActivityByVisitId.get(siteVisit.id) ?? siteVisit.updatedAt,
      now,
      overdueThresholdHours,
      checklistColumns,
    );
  }

  /**
   * Minimal scoped read of a visit's lifecycle state, used by
   * SurveyLifecycleService to validate a transition's from-status. Enforces
   * tenant + access scope (throws NotFound if the user can't see the visit).
   */
  async getLifecycleState(user: RequestUser, id: string) {
    const siteVisit = await this.findAccessibleSiteVisit(user, id);
    return {
      id: siteVisit.id,
      status: siteVisit.status,
      lifecycleStatus: siteVisit.lifecycleStatus,
    };
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

  /**
   * Reassign a site visit's owning team (ADR 0002 §4). Hands the in-flight
   * survey from one team to another, preserving all child work (inspections,
   * photos, defects hang off the SiteVisit), snapshotting the outgoing team's
   * billing contribution, and writing an audit row — atomically.
   *
   * NOTE: the "outgoing team must be fully synced first" rule is enforced at
   * the client/UI layer — the server cannot see a device's local sync queue.
   * Late-arriving sync from the outgoing team is reconciled in the sync path
   * (follow-up), not here.
   */
  async reassign(user: RequestUser, id: string, dto: ReassignSiteVisitDto) {
    this.assertCanMutate(user);

    const siteVisit = await this.findAccessibleSiteVisit(user, id);
    this.assertReassignable(siteVisit);

    if (siteVisit.teamId === dto.toTeamId) {
      throw new BadRequestException('Site visit is already assigned to this team.');
    }

    const [fromTeam, toTeam] = await Promise.all([
      this.prisma.team.findFirst({
        where: { id: siteVisit.teamId, tenantId: user.tenantId },
        select: { id: true, name: true, organizationId: true },
      }),
      this.prisma.team.findFirst({
        where: { id: dto.toTeamId, tenantId: user.tenantId, isActive: true },
        select: { id: true, name: true, organizationId: true },
      }),
    ]);

    if (!fromTeam) {
      throw new BadRequestException('Current team for this site visit was not found.');
    }
    if (!toTeam) {
      throw new BadRequestException('Target team was not found or is inactive.');
    }

    await this.assertCanReassignBetween(user, fromTeam, toTeam);
    await this.assertOutgoingTeamSynced(fromTeam.id);

    // Billing snapshot for the OUTGOING team at the handover (ADR 0002 §5).
    const contributionData = await this.buildContributionSnapshot(
      siteVisit.id,
      fromTeam.id,
      'REASSIGNED',
    );

    await this.prisma.$transaction([
      this.prisma.siteVisitTeamContribution.create({ data: contributionData }),
      this.prisma.siteVisitReassignment.create({
        data: {
          siteVisitId: siteVisit.id,
          fromTeamId: fromTeam.id,
          toTeamId: toTeam.id,
          reason: dto.reason,
          reassignedByUserId: user.id,
        },
      }),
      this.prisma.siteVisit.update({
        where: { id: siteVisit.id },
        data: { teamId: toTeam.id },
      }),
    ]);

    return this.getById(user, siteVisit.id);
  }

  private assertReassignable(siteVisit: {
    status: SiteVisitStatus;
    lifecycleStatus: SurveyLifecycleStatus | null;
  }) {
    this.assertVisitIsMutable(siteVisit); // blocks COMPLETED / CANCELLED

    // Only work still in the field can move: in progress (DALAM RONDAAN) or
    // bounced back for amendment (PERLU PINDAAN). A null lifecycle on a live
    // visit is treated as in-progress. (ADR 0002 §4)
    const reassignableLifecycle =
      siteVisit.lifecycleStatus === null ||
      siteVisit.lifecycleStatus === SurveyLifecycleStatus.DALAM_RONDAAN ||
      siteVisit.lifecycleStatus === SurveyLifecycleStatus.PERLU_PINDAAN;

    if (!reassignableLifecycle) {
      throw new BadRequestException(
        'A site visit can only be reassigned while in progress (DALAM RONDAAN) or pending amendment (PERLU PINDAAN).',
      );
    }
  }

  private async assertCanReassignBetween(
    user: RequestUser,
    fromTeam: { id: string; organizationId: string | null },
    toTeam: { id: string; organizationId: string | null },
  ) {
    if (user.role === UserRole.ADMIN) {
      return; // admin can reassign anywhere, including across organizations
    }

    const crossOrg =
      (fromTeam.organizationId ?? null) !== (toTeam.organizationId ?? null);
    if (crossOrg) {
      throw new ForbiddenException(
        'Only an administrator can reassign work across organizations.',
      );
    }

    if (user.role === UserRole.MANAGER) {
      // A manager governs their own company: both teams must be in their org.
      if (
        user.organizationId &&
        fromTeam.organizationId === user.organizationId &&
        toTeam.organizationId === user.organizationId
      ) {
        return;
      }
      throw new ForbiddenException(
        'A manager can only reassign between teams in their own organization.',
      );
    }

    if (user.role === UserRole.SUPERVISOR) {
      // A supervisor must be assigned to supervise BOTH the current and target team.
      const supervisedCount = await this.prisma.teamSupervisor.count({
        where: {
          supervisorUserId: user.id,
          isActive: true,
          teamId: { in: [fromTeam.id, toTeam.id] },
        },
      });
      if (supervisedCount >= 2) {
        return;
      }
      throw new ForbiddenException(
        'A supervisor can only reassign between teams they are assigned to supervise.',
      );
    }

    throw new ForbiddenException('You are not allowed to reassign site visits.');
  }

  /**
   * Offline handover gate (ADR 0002 §4): the outgoing team's devices must have
   * flushed their local mutation queue first, so Team B inherits a fully-synced
   * Pencawang and nothing is lost in transit. Backed by self-reported device
   * heartbeats (`POST /sync/heartbeat`); a member's count defaults to 0, so
   * until the mobile app starts reporting this never blocks — purely additive
   * for the live pilot.
   */
  private async assertOutgoingTeamSynced(fromTeamId: string) {
    const pendingMember = await this.prisma.user.findFirst({
      where: {
        isActive: true,
        syncPendingCount: { gt: 0 },
        teamMemberships: {
          some: { teamId: fromTeamId, isActive: true },
        },
      },
      select: { name: true, syncPendingCount: true },
      orderBy: { syncPendingCount: 'desc' },
    });

    if (pendingMember) {
      throw new ConflictException(
        `Cannot reassign yet — ${pendingMember.name} still has ${pendingMember.syncPendingCount} unsynced change(s) on their device. Wait for the outgoing team's app to finish syncing, then try again.`,
      );
    }
  }

  /**
   * Build a billing contribution snapshot (ADR 0002 §5) for a team — at a
   * handover (REASSIGNED) or at completion (COMPLETED). "Done" = an asset with a
   * SUBMITTED inspection. The team is credited only the increment since the
   * previous snapshots, so a Pencawang split across teams sums to its total
   * completed assets across all contribution rows (no double-counting).
   */
  private async buildContributionSnapshot(
    siteVisitId: string,
    teamId: string,
    snapshotReason: 'REASSIGNED' | 'COMPLETED',
  ): Promise<Prisma.SiteVisitTeamContributionUncheckedCreateInput> {
    const [completedAssetIds, scopeAssetIds, priorContributions] =
      await Promise.all([
        this.prisma.inspection.findMany({
          where: {
            siteVisitId,
            completionStatus: InspectionCompletionStatus.SUBMITTED,
          },
          distinct: ['assetId'],
          select: { assetId: true },
        }),
        this.prisma.inspection.findMany({
          where: { siteVisitId },
          distinct: ['assetId'],
          select: { assetId: true },
        }),
        this.prisma.siteVisitTeamContribution.findMany({
          where: { siteVisitId },
          select: { assetsCompleted: true },
        }),
      ]);

    const cumulativeCompleted = completedAssetIds.length;
    const priorCredited = priorContributions.reduce(
      (sum, row) => sum + row.assetsCompleted,
      0,
    );

    return {
      siteVisitId,
      teamId,
      assetsCompleted: Math.max(0, cumulativeCompleted - priorCredited),
      totalAssets: scopeAssetIds.length,
      snapshotReason,
    };
  }

  /**
   * Per-team billing contribution for a Pencawang (ADR 0002 §5). Aggregates the
   * contribution ledger — a row per handover (REASSIGNED) and at completion
   * (COMPLETED) — into each team's share of the completed assets, alongside the
   * reassignment trail. Sum of the shares = the survey's completed-asset count,
   * which is the basis for contractor billing when work is split across teams.
   */
  async getContributions(user: RequestUser, id: string) {
    const siteVisit = await this.findVisibleSiteVisit(user, id);

    const [contributions, reassignments] = await Promise.all([
      this.prisma.siteVisitTeamContribution.findMany({
        where: { siteVisitId: siteVisit.id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.siteVisitReassignment.findMany({
        where: { siteVisitId: siteVisit.id },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const teamIds = new Set<string>([siteVisit.teamId]);
    for (const row of contributions) {
      teamIds.add(row.teamId);
    }
    for (const row of reassignments) {
      teamIds.add(row.fromTeamId);
      teamIds.add(row.toTeamId);
    }

    const teams = await this.prisma.team.findMany({
      where: { id: { in: Array.from(teamIds) } },
      select: { id: true, name: true },
    });
    const teamNameById = new Map(teams.map((team) => [team.id, team.name]));

    const byTeam = new Map<
      string,
      {
        teamId: string;
        teamName: string | null;
        assetsCompleted: number;
        isCurrent: boolean;
        snapshots: {
          reason: string;
          assetsCompleted: number;
          totalAssets: number;
          at: Date;
        }[];
      }
    >();

    const ensureTeam = (teamId: string) => {
      let entry = byTeam.get(teamId);
      if (!entry) {
        entry = {
          teamId,
          teamName: teamNameById.get(teamId) ?? null,
          assetsCompleted: 0,
          isCurrent: teamId === siteVisit.teamId,
          snapshots: [],
        };
        byTeam.set(teamId, entry);
      }
      return entry;
    };

    let totalAssets = 0;
    for (const row of contributions) {
      const entry = ensureTeam(row.teamId);
      entry.assetsCompleted += row.assetsCompleted;
      entry.snapshots.push({
        reason: row.snapshotReason,
        assetsCompleted: row.assetsCompleted,
        totalAssets: row.totalAssets,
        at: row.createdAt,
      });
      totalAssets = Math.max(totalAssets, row.totalAssets);
    }

    // Always surface the current team, even before its first snapshot (an
    // in-progress visit that was handed over has no COMPLETED row yet).
    ensureTeam(siteVisit.teamId);

    const totalCompleted = contributions.reduce(
      (sum, row) => sum + row.assetsCompleted,
      0,
    );

    return {
      siteVisitId: siteVisit.id,
      currentTeamId: siteVisit.teamId,
      totalAssets,
      totalCompleted,
      teams: Array.from(byTeam.values()).sort(
        (a, b) => b.assetsCompleted - a.assetsCompleted,
      ),
      reassignments: reassignments.map((row) => ({
        fromTeamId: row.fromTeamId,
        fromTeamName: teamNameById.get(row.fromTeamId) ?? null,
        toTeamId: row.toTeamId,
        toTeamName: teamNameById.get(row.toTeamId) ?? null,
        reason: row.reason,
        at: row.createdAt,
        byUserId: row.reassignedByUserId,
      })),
    };
  }

  async getAssets(user: RequestUser, id: string) {
    const siteVisit = await this.findVisibleSiteVisit(user, id);

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

    // Billing snapshot for the FINAL team at completion (ADR 0002 §5) — credited
    // the increment since any earlier handover snapshots, so the team that
    // finished gets its share even when the work was reassigned mid-survey.
    const contributionData = await this.buildContributionSnapshot(
      siteVisit.id,
      siteVisit.teamId,
      'COMPLETED',
    );

    // Completing the visit is the field crew's "submit for review". DC-first:
    // a FIRST completion goes straight to the DC (RONDAAN SELESAI); a
    // re-completion after an amendment bounce (from PERLU PINDAAN) routes to the
    // team's MANAGER first (PINDAAN SELESAI) to verify the rework. Conservative —
    // only advances from a pre-review state (never regresses a survey the DC /
    // manager has already moved on).
    const submitsForReview =
      siteVisit.lifecycleStatus === null ||
      siteVisit.lifecycleStatus === SurveyLifecycleStatus.DALAM_RONDAAN ||
      siteVisit.lifecycleStatus === SurveyLifecycleStatus.PERLU_PINDAAN;
    const reviewTarget =
      siteVisit.lifecycleStatus === SurveyLifecycleStatus.PERLU_PINDAAN
        ? SurveyLifecycleStatus.PINDAAN_SELESAI
        : SurveyLifecycleStatus.RONDAAN_SELESAI;

    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.siteVisit.update({
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
          ...(submitsForReview
            ? {
                lifecycleStatus: reviewTarget,
                ...(reviewTarget === SurveyLifecycleStatus.RONDAAN_SELESAI
                  ? { rondaanSelesaiAt: completedAt }
                  : {}),
              }
            : {}),
        },
      }),
      this.prisma.siteVisitTeamContribution.create({ data: contributionData }),
    ];

    if (submitsForReview) {
      ops.push(
        this.prisma.siteVisitLifecycleEvent.create({
          data: {
            siteVisitId: siteVisit.id,
            fromStatus: siteVisit.lifecycleStatus,
            toStatus: reviewTarget,
            remark:
              reviewTarget === SurveyLifecycleStatus.PINDAAN_SELESAI
                ? 'Amendment completed; submitted for manager recheck.'
                : 'Submitted for DC review on visit completion.',
            createdByUserId: user.id,
          },
        }),
      );
    }

    await this.prisma.$transaction(ops);

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

  /**
   * Correct a started visit's identity / location (wrong Pencawang, mainhead, or
   * GPS) instead of recreating it. The crew may fix its own details before the
   * survey is submitted (or while bounced back); after RONDAAN SELESAI only a
   * manager may; a finalised (LAPORAN SELESAI / ARKIB) survey is locked. Scope is
   * the caller's own (findAccessibleSiteVisit) — a manager is confined to their
   * company, a technician to their team.
   */
  async updateDetails(user: RequestUser, id: string, dto: UpdateSiteVisitDto) {
    const visit = await this.findAccessibleSiteVisit(user, id);
    this.assertCanEditDetails(user, visit.lifecycleStatus);

    const data: Prisma.SiteVisitUpdateInput = {};

    // Pencawang re-point — validate it's in the tenant; refresh the denormalised
    // label/location from it unless the caller set them explicitly this request.
    if (dto.substationId && dto.substationId !== visit.substationId) {
      const substation = await this.prisma.substation.findFirst({
        where: { id: dto.substationId, tenantId: user.tenantId },
        select: { id: true, code: true, name: true, location: true },
      });
      if (!substation) {
        throw new NotFoundException('The selected Pencawang was not found.');
      }
      data.substation = { connect: { id: substation.id } };
      if (dto.pencawangCode === undefined) data.pencawangCode = substation.code;
      if (dto.pencawangName === undefined) data.pencawangName = substation.name;
      if (dto.functionalLocation === undefined && substation.location) {
        data.functionalLocation = substation.location;
      }
    }

    if (dto.mainhead !== undefined) {
      data.mainhead = this.normalizeOptionalString(dto.mainhead);
    }
    if (dto.pencawangCode !== undefined) {
      data.pencawangCode = this.normalizeOptionalString(dto.pencawangCode);
    }
    if (dto.pencawangName !== undefined) {
      data.pencawangName = this.normalizeOptionalString(dto.pencawangName);
    }
    if (dto.functionalLocation !== undefined) {
      data.functionalLocation = this.normalizeOptionalString(dto.functionalLocation);
    }
    if (dto.notes !== undefined) {
      data.notes = this.normalizeOptionalString(dto.notes);
    }

    // GPS correction — a re-captured fix or a manual pin. lat/lng move as a pair;
    // accuracy/time are optional companions (time defaults to "now").
    if (dto.checkInLatitude !== undefined || dto.checkInLongitude !== undefined) {
      if (dto.checkInLatitude === undefined || dto.checkInLongitude === undefined) {
        throw new BadRequestException(
          'A location fix needs both latitude and longitude.',
        );
      }
      data.checkInLatitude = dto.checkInLatitude;
      data.checkInLongitude = dto.checkInLongitude;
      data.checkInAccuracyMeters = dto.checkInAccuracyMeters ?? null;
      data.checkInCapturedAt = dto.checkInCapturedAt
        ? this.parseDate(dto.checkInCapturedAt, 'Check-in captured at')
        : new Date();
    } else if (dto.checkInAccuracyMeters !== undefined) {
      data.checkInAccuracyMeters = dto.checkInAccuracyMeters;
    }

    if (Object.keys(data).length === 0) {
      return this.getById(user, id);
    }

    await this.prisma.siteVisit.update({ where: { id }, data });
    return this.getById(user, id);
  }

  /** Preview a survey deletion — what gets removed vs kept (ADMIN, or a MANAGER for own-company surveys). */
  async previewDeleteWithAssets(user: RequestUser, id: string) {
    this.assertCanDeleteSurvey(user);
    const plan = await this.resolveSurveyDeletionPlan(user, id);
    return {
      siteVisitId: plan.visit.id,
      pencawang: this.pencawangLabelFromPlanVisit(plan.visit),
      inspections: plan.inspectionCount,
      createdAssets: plan.createdAssetIds.length,
      assetsToDelete: plan.deletableAssetIds.length,
      sharedAssetsKept: plan.sharedAssetIds.length,
    };
  }

  /**
   * ADMIN (or own-company MANAGER): hard-delete a site survey AND the poles created during it (skipping
   * poles shared with another survey). Order matters — the visit's inspections
   * are onDelete:Restrict, so they're cleared first (cascading their results /
   * defects / inspection images); the created-and-unshared poles are then hard-
   * deleted (cascade mirrors AssetsService.hardDeleteAssets: inspection / link /
   * session rows first, then the asset → feeder memberships + NOP tie edges);
   * finally the visit is deleted, cascading its users / participants / asset
   * links / reassignments / contributions / lifecycle events / frozen report (the
   * SiteVisit-level Image rows are SetNull, matching asset-delete behaviour). One
   * transaction = all-or-nothing.
   */
  async deleteWithAssets(user: RequestUser, id: string) {
    this.assertCanDeleteSurvey(user);
    const plan = await this.resolveSurveyDeletionPlan(user, id);
    const deletable = plan.deletableAssetIds;
    const pencawangLabel = this.pencawangLabelFromPlanVisit(plan.visit);

    await this.prisma.$transaction(async (tx) => {
      // 1. Clear this survey's inspections (Inspection.siteVisit is Restrict).
      await tx.inspection.deleteMany({
        where: { siteVisitId: id, tenantId: user.tenantId },
      });

      // 2. Hard-delete the poles created during this survey (minus shared ones).
      if (deletable.length > 0) {
        await tx.inspection.deleteMany({
          where: { assetId: { in: deletable }, tenantId: user.tenantId },
        });
        await tx.siteVisitAsset.deleteMany({ where: { assetId: { in: deletable } } });
        await tx.operationalSessionAsset.deleteMany({
          where: { assetId: { in: deletable } },
        });
        await tx.asset.deleteMany({
          where: { id: { in: deletable }, tenantId: user.tenantId },
        });
      }

      // 3. Delete the survey itself (cascades its remaining children).
      await tx.siteVisit.delete({ where: { id } });

      // 4. Audit the irreversible delete (atomic with it).
      await tx.deletionLog.create({
        data: {
          tenantId: user.tenantId,
          actorUserId: user.id,
          actorEmail: user.email,
          actorName: user.name,
          entityType: 'SITE_VISIT',
          entityId: id,
          label: pencawangLabel,
          summary: {
            deletedInspections: plan.inspectionCount,
            deletedAssets: deletable.length,
            skippedSharedAssets: plan.sharedAssetIds.length,
          },
        },
      });
    });

    return {
      deleted: true,
      siteVisitId: id,
      deletedInspections: plan.inspectionCount,
      deletedAssets: deletable.length,
      skippedSharedAssets: plan.sharedAssetIds.length,
    };
  }

  /**
   * Open the next annual cycle (north-star §2/§4): a fresh survey against the
   * same persistent poles, mirroring the prior survey's substation / team /
   * operational links with cycleNumber + 1, opened in DALAM RONDAAN. The poles
   * (Assets) carry over untouched — archive archived the *cycle*, not the asset.
   */
  async openNextCycle(user: RequestUser, id: string) {
    this.assertCanMutate(user);

    const prior = await this.findAccessibleSiteVisit(user, id);

    const activeTeamMembers = await this.prisma.teamMember.findMany({
      where: {
        teamId: prior.teamId,
        isActive: true,
        user: { isActive: true },
      },
      select: { userId: true },
    });
    const visitUserIds = new Set(activeTeamMembers.map((member) => member.userId));
    visitUserIds.add(user.id);

    const created = await this.prisma.siteVisit.create({
      data: {
        tenantId: user.tenantId,
        teamId: prior.teamId,
        substationId: prior.substationId,
        createdByUserId: user.id,
        organizationId: prior.organizationId,
        branchId: prior.branchId,
        mainheadId: prior.mainheadId,
        projectId: prior.projectId,
        workPackageId: prior.workPackageId,
        status: SiteVisitStatus.ACTIVE,
        cycleNumber: (prior.cycleNumber ?? 1) + 1,
        // A year-N re-survey of an existing register is, by definition, a re-inspection.
        visitType: SiteVisitType.REINSPECTION,
        operationalDomain: prior.operationalDomain,
        operationMode: prior.operationMode,
        operationalScope: prior.operationalScope,
        sessionKind: prior.sessionKind,
        fromPencawangId: prior.fromPencawangId,
        toPencawangId: prior.toPencawangId,
        requiresQAQC: prior.requiresQAQC,
        reportingGroup: prior.reportingGroup,
        mainhead: prior.mainhead,
        pencawangCode: prior.pencawangCode,
        pencawangName: prior.pencawangName,
        functionalLocation: prior.functionalLocation,
        validationStatus: SiteVisitValidationStatus.PENDING,
        lifecycleStatus: SurveyLifecycleStatus.DALAM_RONDAAN,
        users: {
          create: Array.from(visitUserIds).map((userId) => ({ userId })),
        },
      },
    });

    return this.getReadById(user, created.id);
  }

  /**
   * The year-over-year delta for a cycle survey (north-star §2): compares the
   * poles observed in this cycle against the prior cycle for the same Pencawang.
   * "Observed" = created during, linked to, or inspected in that survey.
   * Reports new / removed / carried poles. Route/source-change detection needs
   * per-cycle edge snapshots and is deferred to a later slice.
   */
  async getCycleDelta(user: RequestUser, id: string) {
    const visit = await this.findVisibleSiteVisit(user, id);

    const prior = await this.prisma.siteVisit.findFirst({
      where: {
        tenantId: user.tenantId,
        substationId: visit.substationId,
        id: { not: visit.id },
        status: { not: SiteVisitStatus.CANCELLED },
        startedAt: { lt: visit.startedAt },
      },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        startedAt: true,
        completedAt: true,
        cycleNumber: true,
        pencawangCode: true,
      },
    });

    // The annual cadence in human terms: when was this Pencawang last inspected,
    // and how overdue is it now? Prefer the prior survey's date; for a baseline
    // (no prior) the survey is itself the only inspection, so use its own date.
    const lastInspectedAt = prior
      ? prior.completedAt ?? prior.startedAt
      : visit.completedAt ?? visit.startedAt;
    const recency = describeInspectionRecency(lastInspectedAt, new Date());

    const thisPoles = await this.observedPoles(visit.id);
    const priorPoles = prior ? await this.observedPoles(prior.id) : new Map();

    const goneStatuses = new Set<AssetStatus>([
      AssetStatus.REMOVED,
      AssetStatus.NOT_FOUND,
    ]);
    const newPoles: ObservedPole[] = [];
    const carriedPoles: ObservedPole[] = [];
    const removedById = new Map<string, ObservedPole>();

    for (const [assetId, pole] of thisPoles) {
      if (goneStatuses.has(pole.status)) {
        removedById.set(assetId, pole);
      } else if (priorPoles.has(assetId)) {
        carriedPoles.push(pole);
      } else {
        newPoles.push(pole);
      }
    }
    // Poles present last cycle but not re-surveyed this cycle.
    for (const [assetId, pole] of priorPoles) {
      if (!thisPoles.has(assetId)) {
        removedById.set(assetId, pole);
      }
    }

    const byCode = (a: ObservedPole, b: ObservedPole) =>
      a.assetCode.localeCompare(b.assetCode, 'en', { numeric: true });
    const removedPoles = Array.from(removedById.values()).sort(byCode);
    newPoles.sort(byCode);
    carriedPoles.sort(byCode);

    return {
      isBaseline: !prior,
      cycleNumber: visit.cycleNumber,
      recency,
      priorCycle: prior
        ? {
            id: prior.id,
            startedAt: prior.startedAt,
            cycleNumber: prior.cycleNumber,
            pencawangCode: prior.pencawangCode,
          }
        : null,
      summary: {
        observed: thisPoles.size,
        added: newPoles.length,
        removed: removedPoles.length,
        carried: carriedPoles.length,
      },
      newPoles,
      removedPoles,
      carriedPoles,
    };
  }

  /** Distinct poles a survey touched: created during it, linked to it, or
   *  inspected in it. Keyed by assetId. */
  private async observedPoles(
    siteVisitId: string,
  ): Promise<Map<string, ObservedPole>> {
    const poleSelect = {
      id: true,
      assetCode: true,
      noTiangLama: true,
      status: true,
    } satisfies Prisma.AssetSelect;

    const [created, linked, inspected] = await Promise.all([
      this.prisma.asset.findMany({
        where: { createdDuringVisitId: siteVisitId },
        select: poleSelect,
      }),
      this.prisma.siteVisitAsset.findMany({
        where: { siteVisitId },
        select: { asset: { select: poleSelect } },
      }),
      this.prisma.inspection.findMany({
        where: { siteVisitId },
        select: { asset: { select: poleSelect } },
        distinct: ['assetId'],
      }),
    ]);

    const poles = new Map<string, ObservedPole>();
    const add = (asset: ObservedPole) => poles.set(asset.id, asset);
    created.forEach(add);
    linked.forEach((link) => add(link.asset));
    inspected.forEach((inspection) => add(inspection.asset));
    return poles;
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
      this.resolveToPencawangId(user, dto),
    ]);

    return {
      operationMode: dto.operationMode ?? DEFAULT_OPERATION_MODE,
      operationalScope,
      sessionKind: dto.sessionKind ?? getSessionKindForScope(operationalScope),
      fromPencawangId,
      toPencawangId,
      requiresQAQC: dto.requiresQAQC ?? scopeRequiresQAQC(operationalScope),
      reportingGroup: this.normalizeOperationalString(dto.reportingGroup),
      // Plain trim (not normalizeOperationalString) so the route code is stored
      // exactly as entered — e.g. "MI - KUK" keeps its spacing.
      routeCode: this.normalizeOptionalString(dto.routeCode),
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

  // Resolve the route's To Pencawang: an existing id, OR — when the destination
  // isn't in the system yet (SAVT "New To") — create/reuse a Substation from the
  // name + code the crew typed. Reuses an existing case-insensitive match (and
  // reactivates it if it was deactivated) so a destination never spawns a
  // duplicate or trips the unique [tenantId, code] constraint.
  private async resolveToPencawangId(user: RequestUser, dto: CreateSiteVisitDto) {
    if (dto.toPencawangId) {
      return this.resolveOptionalPencawangId(
        user,
        dto.toPencawangId,
        'To Pencawang',
      );
    }

    const name = this.normalizeOperationalString(dto.toPencawangName);
    const code = this.normalizePencawangCode(dto.toPencawangCode);

    if (!name || !code) {
      return null;
    }

    const existing = await this.prisma.substation.findFirst({
      where: {
        tenantId: user.tenantId,
        OR: [
          { code: { equals: code, mode: 'insensitive' } },
          { name: { equals: name, mode: 'insensitive' } },
        ],
      },
      select: { id: true, isActive: true },
    });

    if (existing) {
      if (!existing.isActive) {
        await this.prisma.substation.update({
          where: { id: existing.id },
          data: { isActive: true },
        });
      }

      return existing.id;
    }

    const created = await this.prisma.substation.create({
      data: {
        tenantId: user.tenantId,
        code,
        name,
        location: name,
      },
      select: { id: true },
    });

    return created.id;
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

  /**
   * READ-ONLY counterpart of {@link findAccessibleSiteVisit}: resolves a visit a
   * user may SEE (oversight scope — a MANAGER also sees the company's active
   * subcontractor subtree), for read endpoints only (asset register, billing
   * contributions, cycle delta). Never gate a mutation with this — those MUST
   * stay on findAccessibleSiteVisit (strict, own-org) so a main contractor can
   * monitor but never mutate a subcontractor's visit.
   */
  private async findVisibleSiteVisit(user: RequestUser, id: string) {
    const ctx = await buildScopeContext(this.prisma, user);
    const siteVisit = await this.prisma.siteVisit.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
        ...this.oversightScope(user, ctx),
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

  /** The one user-facing status (list, detail, mobile all read this) — collapses
   *  the operational + review lifecycle into a single word. See @ascure/shared-utils. */
  private displayStatusFields(siteVisit: {
    status: SiteVisitStatus;
    lifecycleStatus: SurveyLifecycleStatus | null;
  }) {
    const displayStatus = deriveDisplayStatus(
      siteVisit.status,
      siteVisit.lifecycleStatus,
    );
    return {
      displayStatus,
      displayStatusLabel: DISPLAY_STATUS_LABEL[displayStatus],
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
      ...this.displayStatusFields(siteVisit),
    };
  }

  /**
   * The full set of template-defined checklist fields the DC may turn on as
   * Linked-Assets columns, in template order (section, then item). Sourced from
   * the templates the visit's SUBMITTED inspections actually ran, so it tracks
   * the live checklist and includes fields not yet filled on any pole. IMAGE
   * items are skipped (they need a photo cell, not a text column), and labels
   * already shown as fixed columns (the Kelegaan reading/photo, Catitan) are
   * excluded so the picker never offers a duplicate. Deduped by normalized label.
   */
  private async resolveChecklistColumns(
    siteVisit: SiteVisitDetail,
  ): Promise<ChecklistColumnDef[]> {
    const norm = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();
    const PINNED = new Set(
      [
        'GAMBAR KELEGAAN 1',
        'BACAAN KELEGAAN 1',
        'KELEGAAN 1',
        'CATITAN',
        'CATATAN',
        'CATATAN / REMARK',
      ].map(norm),
    );

    const templateIds = Array.from(
      new Set(
        siteVisit.visitAssets
          .map((link) => link.asset.inspections[0]?.templateId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (templateIds.length === 0) {
      return [];
    }

    const templates = await this.prisma.inspectionTemplate.findMany({
      where: { id: { in: templateIds } },
      select: {
        sections: { select: { id: true, title: true, sortOrder: true } },
        items: {
          where: {
            isActive: true,
            inputType: { not: InspectionItemInputType.IMAGE },
          },
          select: { label: true, sortOrder: true, sectionId: true },
        },
      },
    });

    const columns: (ChecklistColumnDef & { s: number; i: number })[] = [];
    const seen = new Set<string>();
    for (const template of templates) {
      const sectionById = new Map(
        template.sections.map((section) => [section.id, section]),
      );
      for (const item of template.items) {
        const key = norm(item.label);
        if (!key || PINNED.has(key) || seen.has(key)) {
          continue;
        }
        seen.add(key);
        const section = sectionById.get(item.sectionId) ?? null;
        columns.push({
          key,
          label: item.label,
          section: section?.title ?? null,
          s: section?.sortOrder ?? 0,
          i: item.sortOrder,
        });
      }
    }

    columns.sort((a, b) => a.s - b.s || a.i - b.i || a.label.localeCompare(b.label));
    return columns.map(({ key, label, section }) => ({ key, label, section }));
  }

  private serializeSiteVisitDetail(
    siteVisit: SiteVisitDetail,
    rollup: SiteVisitRollup,
    lastActivityAt: Date,
    now: Date,
    overdueThresholdHours: number,
    checklistColumns: ChecklistColumnDef[] = [],
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
      // Template-defined checklist fields the DC can toggle on as extra
      // Linked-Assets columns (values ride on each link's checklistValues).
      checklistColumns,
      lastActivityAt: lastActivityAt.toISOString(),
      operationalHealthStatus,
      isOverdue,
      overdueThresholdHours,
      ...this.displayStatusFields(siteVisit),
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
      lifecycle: {
        status: siteVisit.lifecycleStatus,
        rondaanSelesaiAt: siteVisit.rondaanSelesaiAt,
        managerApprovedAt: siteVisit.managerApprovedAt,
        amendmentRequestedAt: siteVisit.amendmentRequestedAt,
        amendmentRemark: siteVisit.amendmentRemark,
        laporanSelesaiAt: siteVisit.laporanSelesaiAt,
        archivedAt: siteVisit.archivedAt,
      },
      lifecycleEvents: siteVisit.lifecycleEvents.map((event) => ({
        id: event.id,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        remark: event.remark,
        createdAt: event.createdAt,
        createdBy: event.createdBy,
      })),
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
    const { inspections, ...asset } = link.asset;
    const latest = inspections[0] ?? null;
    type ResultRow = NonNullable<typeof latest>['results'][number];
    type ImageRow = NonNullable<typeof latest>['inspectionImages'][number];
    const norm = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();
    // Recorded value of a checklist result — text/OCR fields use valueText;
    // numeric readings fall back to valueNumber. Same source as the Download
    // Checklist.
    const valueOf = (match: ResultRow | null): string | null => {
      if (!match) return null;
      const text = match.valueText?.trim();
      if (text) return text;
      if (match.valueNumber != null) return match.valueNumber.toString();
      if (match.valueBoolean != null) return match.valueBoolean ? 'Yes' : 'No';
      if (match.valueDate != null) return match.valueDate.toISOString().slice(0, 10);
      if (match.valueDateTime != null) return match.valueDateTime.toISOString();
      return null;
    };
    // Results matching any of the given label aliases, in alias priority order.
    const matchRows = (...labels: string[]): ResultRow[] => {
      const rows: ResultRow[] = [];
      for (const want of labels.map(norm)) {
        const match = latest?.results?.find(
          (r) => r.templateItem?.label != null && norm(r.templateItem.label) === want,
        );
        if (match) rows.push(match);
      }
      return rows;
    };
    // Displayed value for a set of aliases: the first alias carrying a non-empty
    // value (preserving the old reading() behavior), else the first that exists.
    const pickValue = (...labels: string[]): string | null => {
      const rows = matchRows(...labels);
      return valueOf(rows.find((r) => valueOf(r)) ?? rows[0] ?? null);
    };

    const kelegaanRows = matchRows('GAMBAR KELEGAAN 1', 'BACAAN KELEGAAN 1', 'KELEGAAN 1');
    const kelegaanValue = valueOf(
      kelegaanRows.find((r) => valueOf(r)) ?? kelegaanRows[0] ?? null,
    );
    // The Smart Sensor photo behind the reading: the item-tagged image whose
    // templateItemId matches one of the alias-matched items (mobile tags each OCR
    // capture by its item id). Trying every alias-matched item covers templates
    // that split the reading and the GAMBAR photo across separate checklist items;
    // the current production template combines them on a single item.
    let kelegaanImage: ImageRow | null = null;
    for (const row of kelegaanRows) {
      const img = latest?.inspectionImages?.find(
        (i) => i.templateItemId === row.templateItemId,
      );
      if (img) {
        kelegaanImage = img;
        break;
      }
    }

    // Every recorded checklist value for this pole, keyed by normalized label, so
    // the client can render any template field the DC toggles on as a column. The
    // first non-empty value wins for a label (a later blank never clobbers it); a
    // label present but unfilled maps to null. Same source as the Download
    // Checklist / the fixed columns above.
    const checklistValues: Record<string, string | null> = {};
    for (const row of latest?.results ?? []) {
      const label = row.templateItem?.label;
      if (!label) continue;
      const key = norm(label);
      if (checklistValues[key] == null) {
        checklistValues[key] = valueOf(row);
      }
    }

    return {
      id: link.id,
      siteVisitId: link.siteVisitId,
      assetId: link.assetId,
      addedByUserId: link.addedByUserId,
      addedAt: link.addedAt,
      source: link.source,
      notes: link.notes,
      addedBy: link.addedBy,
      asset: {
        ...asset,
        // Flatten to the same shape the no-visit map already consumes so the
        // client can color markers by inspection status inside a visit too.
        latestInspection: latest
          ? {
              id: latest.id,
              status: latest.completionStatus,
              submittedAt: latest.submittedAt?.toISOString() ?? null,
            }
          : null,
      },
      // Checklist readings surfaced as Linked-Assets columns for DC checking.
      checklist: {
        bacaanKelegaan1: kelegaanValue,
        // The Smart Sensor photo behind the reading, so the DC can re-verify the
        // recorded value against the LCD. url is the API-relative /uploads path;
        // timestamp is the capture time, createdAt the upload/record time (the
        // client falls back to createdAt when the capture time is missing).
        bacaanKelegaan1Image: kelegaanImage
          ? {
              url: kelegaanImage.url,
              filename: kelegaanImage.filename,
              latitude: kelegaanImage.latitude,
              longitude: kelegaanImage.longitude,
              timestamp: kelegaanImage.timestamp?.toISOString() ?? null,
              createdAt: kelegaanImage.createdAt.toISOString(),
            }
          : null,
        catitan: pickValue('CATITAN', 'CATATAN', 'CATATAN / REMARK'),
      },
      // Generic per-field values for the DC's toggleable checklist columns.
      checklistValues,
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

  private assertCanDeleteSurvey(user: RequestUser) {
    // Deleting a survey (+ its cascade) is irreversible — restrict to ADMIN and
    // MANAGER. A MANAGER is further confined to their own company by the access
    // scope applied in resolveSurveyDeletionPlan (the lookup 404s otherwise).
    if (user.role === UserRole.ADMIN || user.role === UserRole.MANAGER) {
      return;
    }
    throw new ForbiddenException('Only a manager or administrator can delete a site survey.');
  }

  private assertCanEditDetails(
    user: RequestUser,
    lifecycleStatus: SurveyLifecycleStatus | null,
  ) {
    if (
      lifecycleStatus === SurveyLifecycleStatus.LAPORAN_SELESAI ||
      lifecycleStatus === SurveyLifecycleStatus.ARKIB
    ) {
      throw new BadRequestException(
        'This survey is finalised — its report is compiled, so its details can no longer be edited.',
      );
    }

    const preSubmission =
      lifecycleStatus == null ||
      lifecycleStatus === SurveyLifecycleStatus.DALAM_RONDAAN ||
      lifecycleStatus === SurveyLifecycleStatus.PERLU_PINDAAN;

    if (preSubmission) {
      // Before submission (or while bounced back) the crew may fix its own
      // details; assertCanMutate blocks only VIEWER/CLIENT.
      this.assertCanMutate(user);
      return;
    }

    // Submitted and under review (RONDAAN_SELESAI / DISAHKAN_PENGURUS /
    // PINDAAN_SELESAI) — only a manager (or admin) may correct details now.
    if (user.role === UserRole.ADMIN || user.role === UserRole.MANAGER) {
      return;
    }
    throw new ForbiddenException(
      'Once submitted for review, only a manager can edit this survey’s details.',
    );
  }

  private pencawangLabelFromPlanVisit(visit: {
    pencawangName: string | null;
    pencawangCode: string | null;
    substation: { name: string; code: string } | null;
  }): string | null {
    return (
      visit.pencawangName?.trim() ||
      visit.pencawangCode?.trim() ||
      visit.substation?.name?.trim() ||
      visit.substation?.code?.trim() ||
      null
    );
  }

  /**
   * Resolve what an admin "delete this survey + its assets" would remove. The
   * deletable poles are those CREATED during this survey (Asset.createdDuringVisitId)
   * MINUS any also referenced by another survey (an inspection or asset link in a
   * different site visit) — those shared poles are KEPT so deleting one survey can
   * never corrupt another (owner decision 2026-06-22). Tenant-scoped.
   */
  private async resolveSurveyDeletionPlan(user: RequestUser, id: string) {
    const visit = await this.prisma.siteVisit.findFirst({
      // Own-company confinement for a MANAGER (accessScope = {} for ADMIN, so
      // unrestricted there). An out-of-scope id reads as "not found".
      where: { id, tenantId: user.tenantId, ...this.accessScope(user) },
      select: {
        id: true,
        pencawangCode: true,
        pencawangName: true,
        substation: { select: { name: true, code: true } },
      },
    });

    if (!visit) {
      throw new NotFoundException('Site visit not found.');
    }

    const createdAssets = await this.prisma.asset.findMany({
      where: { createdDuringVisitId: id, tenantId: user.tenantId },
      select: { id: true },
    });
    const createdAssetIds = createdAssets.map((asset) => asset.id);

    let sharedAssetIds: string[] = [];
    if (createdAssetIds.length > 0) {
      const [sharedByInspection, sharedByLink] = await Promise.all([
        this.prisma.inspection.findMany({
          where: { assetId: { in: createdAssetIds }, siteVisitId: { not: id } },
          select: { assetId: true },
          distinct: ['assetId'],
        }),
        this.prisma.siteVisitAsset.findMany({
          where: { assetId: { in: createdAssetIds }, siteVisitId: { not: id } },
          select: { assetId: true },
          distinct: ['assetId'],
        }),
      ]);
      sharedAssetIds = Array.from(
        new Set([
          ...sharedByInspection.map((row) => row.assetId),
          ...sharedByLink.map((row) => row.assetId),
        ]),
      );
    }

    const sharedSet = new Set(sharedAssetIds);
    const deletableAssetIds = createdAssetIds.filter(
      (assetId) => !sharedSet.has(assetId),
    );

    const inspectionCount = await this.prisma.inspection.count({
      where: { siteVisitId: id, tenantId: user.tenantId },
    });

    return { visit, createdAssetIds, deletableAssetIds, sharedAssetIds, inspectionCount };
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
    ctx?: ScopeContext,
  ): Prisma.SiteVisitWhereInput {
    const filters: Prisma.SiteVisitWhereInput[] = [
      {
        tenantId: user.tenantId,
      },
      this.oversightScope(user, ctx),
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

  /**
   * Governance Fix Package G3.
   *
   * - ADMIN     : empty filter (full tenant visibility).
   * - QA actor  : visit must belong to a MAINHEAD the QA user has access to.
   *               If the QA user has zero accessible MAINHEADs, no visits
   *               are returned (the in-clause becomes an empty array).
   * - Everyone  : legacy team-membership filter.
   *
   * The optional `ctx` is built once per request by buildScopeContext().
   * When omitted, legacy behaviour is preserved so callers that haven't
   * been migrated yet keep working.
   */
  private accessScope(
    user: RequestUser,
    ctx?: ScopeContext,
  ): Prisma.SiteVisitWhereInput {
    // Canonical matrix lives in common/authorization/site-visit-scope so the
    // site-visit, defect, and asset-map scopes cannot drift apart.
    return siteVisitAccessWhere(user, ctx);
  }

  /**
   * READ-ONLY oversight scope. Like {@link accessScope} but a MANAGER also sees
   * the site visits of the company's active subcontractor subtree (work it
   * delegated). Use ONLY on read paths (list / getReadById / getById); every
   * mutation gate (findAccessibleSiteVisit) must stay on accessScope so a main
   * contractor can monitor — but never mutate — a subcontractor's visit. See
   * siteVisitOversightWhere for the read-vs-mutate boundary rationale.
   */
  private oversightScope(
    user: RequestUser,
    ctx?: ScopeContext,
  ): Prisma.SiteVisitWhereInput {
    return siteVisitOversightWhere(user, ctx);
  }

  private normalizeOptionalString(value?: string | null) {
    if (!value) {
      return null;
    }

    const trimmedValue = value.trim();

    return trimmedValue ? trimmedValue : null;
  }
}
