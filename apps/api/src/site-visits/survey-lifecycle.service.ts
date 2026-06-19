import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma, SiteVisitStatus, SurveyLifecycleStatus, UserRole } from '@prisma/client';
import { isQaActor } from '../common/authorization/qa-actor';
import { releaseDefectsOnReport } from '../common/authorization/defect-governance';
import { resolveCanReport } from '../common/authorization/reporting-actor';
import { buildVisitReleasePlan } from '../defects/defect-release.util';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { ReportGenerationService } from '../report-generation/report-generation.service';
import { UsersService } from '../users/users.service';
import { SiteVisitsService } from './site-visits.service';

const LIFECYCLE_LABEL: Record<SurveyLifecycleStatus, string> = {
  DALAM_RONDAAN: 'DALAM RONDAAN',
  RONDAAN_SELESAI: 'RONDAAN SELESAI',
  PERLU_PINDAAN: 'PERLU PINDAAN',
  LAPORAN_SELESAI: 'LAPORAN SELESAI',
  ARKIB: 'ARKIB',
};

interface TransitionOptions {
  to: SurveyLifecycleStatus;
  /** Lifecycle states this transition may run from. `null` = a legacy visit
   *  that predates the lifecycle (treated as not-yet-started). */
  allowedFrom: Array<SurveyLifecycleStatus | null>;
  /** Extra fields written on the SiteVisit (timestamps / remark). */
  data: Prisma.SiteVisitUpdateInput;
  /** Remark stored on the lifecycle event (e.g. the amendment reason). */
  remark?: string | null;
  /**
   * Run after the transition is validated but before the status is committed.
   * If it throws, the lifecycle status is left unchanged. Any Prisma operations
   * it returns are appended to the status-commit `$transaction`, so a side
   * effect (e.g. persisting the compiled report) is atomic with the status
   * change — no orphaned rows if the commit fails. Used as the gate into
   * LAPORAN SELESAI.
   */
  beforeCommit?: () => Promise<Prisma.PrismaPromise<unknown>[] | void>;
}

/**
 * The one PE-survey lifecycle (north-star §4), driven on the per-PE-per-cycle
 * SiteVisit:
 *
 *   DALAM RONDAAN → RONDAAN SELESAI ⟲ PERLU PINDAAN → LAPORAN SELESAI → ARKIB
 *
 * Roles (the relaxed governance):
 *  - Inspector owns "RONDAAN SELESAI" — competence-based, authoritative on submit.
 *  - DC (governance authority) owns the survey-level amendment "PERLU PINDAAN"
 *    and the final "ARKIB". This is where the old defect-level QA reject moves to.
 *  - Report generation (REPORTING authority) is the gate into "LAPORAN SELESAI".
 *
 * Every transition appends a SiteVisitLifecycleEvent so governance is provable.
 * This service is additive: it does not yet retire the OperationalSession /
 * defect-QA machines — it establishes the replacement spine they migrate onto.
 */
@Injectable()
export class SurveyLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly siteVisits: SiteVisitsService,
    private readonly reportGeneration: ReportGenerationService,
  ) {}

  /** Inspector marks the walk-through done. */
  async markRondaanSelesai(user: RequestUser, id: string) {
    this.assertCanMutate(user);
    return this.transition(user, id, {
      to: SurveyLifecycleStatus.RONDAAN_SELESAI,
      allowedFrom: [
        null,
        SurveyLifecycleStatus.DALAM_RONDAAN,
        SurveyLifecycleStatus.PERLU_PINDAAN,
      ],
      data: { rondaanSelesaiAt: new Date() },
    });
  }

  /** DC sends the survey back for data-quality amendments. */
  async requestAmendment(user: RequestUser, id: string, remarkInput: string) {
    await this.assertGovernance(user, 'Requesting survey amendments');
    const remark = remarkInput.trim();
    if (!remark) {
      throw new BadRequestException('An amendment remark is required.');
    }
    return this.transition(user, id, {
      to: SurveyLifecycleStatus.PERLU_PINDAAN,
      allowedFrom: [SurveyLifecycleStatus.RONDAAN_SELESAI],
      data: { amendmentRequestedAt: new Date(), amendmentRemark: remark },
      remark,
    });
  }

  /** DC generates the report — the gate into LAPORAN SELESAI. The frozen
   *  compiled PDF is produced as part of this transition; if compilation fails
   *  the survey stays in RONDAAN SELESAI so it can be retried. */
  async generateReport(user: RequestUser, id: string) {
    await this.assertReporting(user);
    return this.transition(user, id, {
      to: SurveyLifecycleStatus.LAPORAN_SELESAI,
      allowedFrom: [SurveyLifecycleStatus.RONDAAN_SELESAI],
      data: { laporanSelesaiAt: new Date() },
      // Compile the frozen report, then persist its row INSIDE the status-commit
      // transaction, so the report and the LAPORAN SELESAI status are atomic
      // (no orphaned report row if the commit fails). Under RELEASE_ON_REPORT,
      // this is also the gate where the survey's dormant defects release and
      // auto-route to the MAINHEAD's maintenance company — appended to the same
      // commit so release is atomic with reaching LAPORAN SELESAI.
      beforeCommit: async () => {
        const data = await this.reportGeneration.buildSiteVisitReportData(
          user,
          id,
        );
        const ops: Prisma.PrismaPromise<unknown>[] = [
          this.prisma.siteVisitReport.create({ data }),
        ];

        if (releaseDefectsOnReport()) {
          const releasePlan = await buildVisitReleasePlan(this.prisma, id, {
            scope: 'ALL',
            actorUserId: user.id,
            now: new Date(),
          });
          ops.push(...releasePlan.ops);
        }

        return ops;
      },
    });
  }

  /** DC / Admin archives the completed cycle. Archive archives the cycle, not
   *  the asset — next cycle opens a fresh survey against the same poles. */
  async archive(user: RequestUser, id: string) {
    await this.assertGovernance(user, 'Archiving a survey');
    return this.transition(user, id, {
      to: SurveyLifecycleStatus.ARKIB,
      allowedFrom: [SurveyLifecycleStatus.LAPORAN_SELESAI],
      data: { archivedAt: new Date() },
    });
  }

  private async transition(
    user: RequestUser,
    id: string,
    options: TransitionOptions,
  ) {
    // Enforces tenant + access scope and throws NotFound if inaccessible.
    const state = await this.siteVisits.getLifecycleState(user, id);

    if (state.status === SiteVisitStatus.CANCELLED) {
      throw new BadRequestException(
        'This site visit is cancelled; its survey lifecycle is closed.',
      );
    }

    const from = state.lifecycleStatus;
    if (!options.allowedFrom.includes(from)) {
      const fromLabel = LIFECYCLE_LABEL[from ?? SurveyLifecycleStatus.DALAM_RONDAAN];
      throw new BadRequestException(
        `Cannot move to ${LIFECYCLE_LABEL[options.to]} from ${fromLabel}.`,
      );
    }

    const extraOps = options.beforeCommit
      ? await options.beforeCommit()
      : undefined;

    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.siteVisit.update({
        where: { id },
        data: { lifecycleStatus: options.to, ...options.data },
      }),
      this.prisma.siteVisitLifecycleEvent.create({
        data: {
          siteVisitId: id,
          fromStatus: from,
          toStatus: options.to,
          remark: options.remark ?? null,
          createdByUserId: user.id,
        },
      }),
    ];
    if (extraOps) {
      ops.push(...extraOps);
    }

    await this.prisma.$transaction(ops);

    return this.siteVisits.getReadById(user, id);
  }

  private assertCanMutate(user: RequestUser) {
    if (user.role === UserRole.VIEWER || user.role === UserRole.CLIENT) {
      throw new ForbiddenException(
        'This role is read-only for operational workflow actions.',
      );
    }
  }

  private async assertGovernance(user: RequestUser, action: string) {
    if (user.role === UserRole.ADMIN) {
      return;
    }
    if (await isQaActor(this.prisma, user)) {
      return;
    }
    throw new ForbiddenException(
      `${action} requires DC governance authority (ADMIN or a QA validator).`,
    );
  }

  private async assertReporting(user: RequestUser) {
    if (await resolveCanReport(this.usersService, user)) {
      return;
    }
    throw new ForbiddenException(
      'Generating the report requires REPORTING authority (ADMIN or a reporting user).',
    );
  }
}
