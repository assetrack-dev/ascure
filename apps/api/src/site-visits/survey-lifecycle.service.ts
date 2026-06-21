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
  DISAHKAN_PENGURUS: 'DISAHKAN PENGURUS',
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
 * SiteVisit. The review chain is technician/supervisor → MANAGER → DC:
 *
 *   DALAM RONDAAN
 *     → RONDAAN SELESAI         (field crew submitted; pending manager review)
 *       → DISAHKAN PENGURUS     (the team's MANAGER approved; pending DC checking)
 *       ⟲ PERLU PINDAAN         (manager sent it back to the crew to amend)
 *     DISAHKAN PENGURUS
 *       → LAPORAN SELESAI        (DC checked + generated the report)
 *       ⟲ PERLU PINDAAN          (DC sent it back to the crew to amend)
 *     LAPORAN SELESAI → ARKIB
 *   PERLU PINDAAN → RONDAAN SELESAI (crew re-submits; re-enters manager review)
 *
 * Roles:
 *  - Inspector/supervisor owns "RONDAAN SELESAI" — competence-based, authoritative
 *    on submit. In practice the field crew reaches it by completing the visit
 *    (site-visits.service.complete), which submits the survey for manager review.
 *  - MANAGER owns the review gate: "DISAHKAN PENGURUS" (approve, push to DC) or a
 *    bounce-back to "PERLU PINDAAN". Scope is enforced by getLifecycleState
 *    (a MANAGER only sees their own company's visits), so a manager can only
 *    review their own company's surveys.
 *  - DC (governance authority) owns the survey-level amendment "PERLU PINDAAN"
 *    (now from DISAHKAN PENGURUS) and the final "ARKIB". The DC only ever sees a
 *    survey the manager already approved — the manager step is a hard gate.
 *  - Report generation (REPORTING authority) is the gate into "LAPORAN SELESAI",
 *    reachable only from DISAHKAN PENGURUS (so every report has manager sign-off).
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

  /** Inspector / supervisor marks the walk-through done — submits the survey
   *  for the team manager's review. (The field crew normally reaches this by
   *  completing the visit; this is also the explicit admin-console fallback.) */
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

  /** The team's MANAGER approves the submitted survey — the gate that pushes it
   *  on to DC checking. Scope (a manager only sees their own company's visits) is
   *  enforced by getLifecycleState inside transition(). */
  async managerApprove(user: RequestUser, id: string) {
    this.assertManagerReview(user, 'Approving a survey for the DC');
    return this.transition(user, id, {
      to: SurveyLifecycleStatus.DISAHKAN_PENGURUS,
      allowedFrom: [SurveyLifecycleStatus.RONDAAN_SELESAI],
      data: { managerApprovedAt: new Date() },
    });
  }

  /** The team's MANAGER bounces the submitted survey back to the field crew for
   *  amendments (before it ever reaches the DC). Mirrors the DC bounce-back: it
   *  re-opens the visit so the crew can actually edit + re-submit. */
  async managerRequestAmendment(
    user: RequestUser,
    id: string,
    remarkInput: string,
  ) {
    this.assertManagerReview(user, 'Requesting survey amendments');
    const remark = remarkInput.trim();
    if (!remark) {
      throw new BadRequestException('An amendment remark is required.');
    }
    return this.transition(user, id, {
      to: SurveyLifecycleStatus.PERLU_PINDAAN,
      allowedFrom: [SurveyLifecycleStatus.RONDAAN_SELESAI],
      data: {
        amendmentRequestedAt: new Date(),
        amendmentRemark: remark,
        // Re-OPEN the visit so the crew can act on it (see requestAmendment).
        status: SiteVisitStatus.IN_PROGRESS,
        completedAt: null,
        endedAt: null,
      },
      remark,
    });
  }

  /** DC sends the survey back for data-quality amendments. Only reachable after
   *  the manager has approved (DISAHKAN PENGURUS). */
  async requestAmendment(user: RequestUser, id: string, remarkInput: string) {
    await this.assertGovernance(user, 'Requesting survey amendments');
    const remark = remarkInput.trim();
    if (!remark) {
      throw new BadRequestException('An amendment remark is required.');
    }
    return this.transition(user, id, {
      to: SurveyLifecycleStatus.PERLU_PINDAAN,
      allowedFrom: [SurveyLifecycleStatus.DISAHKAN_PENGURUS],
      data: {
        amendmentRequestedAt: new Date(),
        amendmentRemark: remark,
        // Re-OPEN the visit. The inspector usually presses "Complete Visit"
        // before submitting for review, which sets status=COMPLETED (terminal).
        // assertVisitEditable then blocks every amend/save/submit path, so a
        // bounce-back that only flips the lifecycle leaves the inspector unable
        // to act on it. Restore an active status and clear the completion stamps
        // (the inverse of complete()) so the amendment is actually workable.
        status: SiteVisitStatus.IN_PROGRESS,
        completedAt: null,
        endedAt: null,
      },
      remark,
    });
  }

  /** DC generates the report — the gate into LAPORAN SELESAI. Only reachable
   *  after the manager has approved (DISAHKAN PENGURUS), so every compiled report
   *  carries manager sign-off. The frozen compiled PDF is produced as part of
   *  this transition; if compilation fails the survey stays in DISAHKAN PENGURUS
   *  so it can be retried. */
  async generateReport(user: RequestUser, id: string) {
    await this.assertReporting(user);
    return this.transition(user, id, {
      to: SurveyLifecycleStatus.LAPORAN_SELESAI,
      allowedFrom: [SurveyLifecycleStatus.DISAHKAN_PENGURUS],
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

  /**
   * Manager review authority (the technician/supervisor → MANAGER → DC gate).
   * ADMIN may act on any survey; a MANAGER on their own company's surveys only.
   * Company scope itself is enforced by getLifecycleState (which runs the
   * role-aware access filter and 404s anything out of scope), so this only needs
   * to gate the role. SUPERVISOR/TECHNICIAN submit but do not approve their own
   * work — the separation of submit vs approve is the point of the gate.
   */
  private assertManagerReview(user: RequestUser, action: string) {
    if (user.role === UserRole.ADMIN || user.role === UserRole.MANAGER) {
      return;
    }
    throw new ForbiddenException(
      `${action} requires manager authority (ADMIN or a MANAGER).`,
    );
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
