import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma, SiteVisitStatus, SurveyLifecycleStatus, UserRole } from '@prisma/client';
import { isQaActor } from '../common/authorization/qa-actor';
import { resolveCanReport } from '../common/authorization/reporting-actor';
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
  PINDAAN_SELESAI: 'PINDAAN SELESAI',
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
 * SiteVisit. DC-FIRST review chain — the crew submits straight to the DC; the
 * team's MANAGER is pulled in only on the amendment path to verify the rework:
 *
 *   DALAM RONDAAN
 *     → RONDAAN SELESAI          (crew completed; pending DC review)
 *       → LAPORAN SELESAI         (DC checked, no errors → report) → ARKIB
 *       ⟲ PERLU PINDAAN           (DC found errors → sent back to the crew)
 *   PERLU PINDAAN
 *     → PINDAAN SELESAI           (crew amended + re-completed; pending MANAGER recheck)
 *       → RONDAAN SELESAI         (manager verified the fixes → re-issued to the DC)
 *       ⟲ PERLU PINDAAN           (manager: fixes not done → back to the crew)
 *
 * Roles:
 *  - Inspector/supervisor reaches RONDAAN SELESAI / PINDAAN SELESAI by completing
 *    the visit (site-visits.service.complete) — a FIRST completion submits to the
 *    DC; a re-completion after an amendment routes to the MANAGER.
 *  - DC (governance authority) reviews RONDAAN SELESAI directly: generate the
 *    report (no errors) or request an amendment (PERLU PINDAAN). The manager no
 *    longer gates a clean first submission.
 *  - MANAGER owns the amendment recheck: PINDAAN SELESAI → re-issue (RONDAAN
 *    SELESAI, back to the DC) or bounce back (PERLU PINDAAN). Scope is enforced by
 *    getLifecycleState (a manager only sees their own company's visits).
 *  - Report generation (REPORTING authority) is the gate into LAPORAN SELESAI,
 *    reachable from RONDAAN SELESAI (and, for in-flight surveys, the now-deprecated
 *    DISAHKAN PENGURUS).
 *
 * `DISAHKAN_PENGURUS` is retained in the enum only so any in-flight prod survey
 * already there stays DC-reviewable; new surveys never reach it.
 *
 * Every transition appends a SiteVisitLifecycleEvent so governance is provable.
 */
@Injectable()
export class SurveyLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly siteVisits: SiteVisitsService,
    private readonly reportGeneration: ReportGenerationService,
  ) {}

  /** Inspector / supervisor marks the walk-through done — submits the survey for
   *  review. (The field crew normally reaches this by completing the visit; this
   *  is also the explicit admin-console fallback.) DC-first routing below. */
  async markRondaanSelesai(user: RequestUser, id: string) {
    this.assertCanMutate(user);
    // A FIRST submission goes straight to the DC (RONDAAN SELESAI); a re-submission
    // after an amendment (from PERLU PINDAAN) routes to the team's MANAGER first
    // (PINDAAN SELESAI), who verifies the rework before it returns to the DC.
    const state = await this.siteVisits.getLifecycleState(user, id);
    const reSubmit =
      state.lifecycleStatus === SurveyLifecycleStatus.PERLU_PINDAAN;
    return this.transition(user, id, {
      to: reSubmit
        ? SurveyLifecycleStatus.PINDAAN_SELESAI
        : SurveyLifecycleStatus.RONDAAN_SELESAI,
      allowedFrom: reSubmit
        ? [SurveyLifecycleStatus.PERLU_PINDAAN]
        : [null, SurveyLifecycleStatus.DALAM_RONDAAN],
      data: reSubmit ? {} : { rondaanSelesaiAt: new Date() },
    });
  }

  /** The team's MANAGER verifies a completed amendment and re-issues the survey
   *  to the DC. In the DC-first flow the manager only acts on the amendment path:
   *  PINDAAN SELESAI → RONDAAN SELESAI (back in the DC's review queue). Scope (a
   *  manager only sees their own company's visits) is enforced by
   *  getLifecycleState inside transition(). */
  async managerApprove(user: RequestUser, id: string) {
    this.assertManagerReview(user, 'Re-issuing an amended survey to the DC');
    return this.transition(user, id, {
      to: SurveyLifecycleStatus.RONDAAN_SELESAI,
      allowedFrom: [SurveyLifecycleStatus.PINDAAN_SELESAI],
      data: { managerApprovedAt: new Date(), rondaanSelesaiAt: new Date() },
      remark: 'Manager verified the amendment; re-issued for DC review.',
    });
  }

  /** The team's MANAGER decides an amendment isn't done properly and bounces it
   *  back to the field crew (PINDAAN SELESAI → PERLU PINDAAN). Mirrors the DC
   *  bounce-back: it re-opens the visit so the crew can edit + re-submit. */
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
      allowedFrom: [SurveyLifecycleStatus.PINDAAN_SELESAI],
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

  /** DC sends the survey back for data-quality amendments — directly from the
   *  DC's review queue (RONDAAN SELESAI); also accepts the deprecated DISAHKAN
   *  PENGURUS so an in-flight survey already there isn't stranded. */
  async requestAmendment(user: RequestUser, id: string, remarkInput: string) {
    await this.assertGovernance(user, 'Requesting survey amendments');
    const remark = remarkInput.trim();
    if (!remark) {
      throw new BadRequestException('An amendment remark is required.');
    }
    return this.transition(user, id, {
      to: SurveyLifecycleStatus.PERLU_PINDAAN,
      allowedFrom: [
        SurveyLifecycleStatus.RONDAAN_SELESAI,
        SurveyLifecycleStatus.DISAHKAN_PENGURUS,
      ],
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

  /** DC generates the report — the gate into LAPORAN SELESAI, from the DC's
   *  review queue (RONDAAN SELESAI; also the deprecated DISAHKAN PENGURUS for
   *  in-flight surveys). In the DC-first flow a clean first-pass report is DC-only
   *  — only amended reports carry manager sign-off. The frozen compiled PDF is
   *  produced as part of this transition; if compilation fails the survey stays
   *  put so it can be retried. */
  async generateReport(user: RequestUser, id: string) {
    await this.assertReporting(user);
    // Enforces tenant + access scope (throws NotFound if inaccessible).
    await this.siteVisits.getLifecycleState(user, id);
    // The compile runs in the BACKGROUND (a 400-pole Pencawang takes many
    // minutes): this returns a run id immediately and the admin app polls
    // GET /reports/site-visit/:id/report-status. The run itself commits the
    // volume rows, the LAPORAN SELESAI flip, its lifecycle event and the
    // RELEASE_ON_REPORT defect release in ONE transaction when it finishes —
    // the same atomicity the old in-request compile had. On failure the
    // lifecycle is untouched and the run carries the error.
    return this.reportGeneration.startCompileRun(user, id);
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
