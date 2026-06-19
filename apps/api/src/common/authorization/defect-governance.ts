import { DefectLifecycleStatus } from '@prisma/client';

export type DefectGovernanceMode =
  | 'INSPECTOR_OWNS'
  | 'QA_GATED'
  | 'RELEASE_ON_REPORT';

/**
 * North-star §5/§6/§10 — the inspector owns the defect call: competence-based,
 * authoritative on submit, with no QA approve/reject ceremony. The survey-level
 * amendment (PERLU PINDAAN) is the only "reject" the process wants, and it lives
 * on the cycle survey, not on individual defects.
 *
 * - INSPECTOR_OWNS (default): a detected defect is immediately maintenance-ready
 *   (no QA verify/reject gate), and the assigned maintainer / DC can close it.
 * - QA_GATED: the legacy enterprise defect-QA flow (DETECTED → UNDER_REVIEW →
 *   VERIFIED/REJECTED → … → QA closure).
 * - RELEASE_ON_REPORT (maintenance handoff Phase 3): inspection and maintenance
 *   are separate companies. A detected defect opens DORMANT (DETECTED) and is
 *   NOT yet maintenance-ready; it RELEASES (→ VERIFIED) and auto-routes to the
 *   MAINHEAD's registered maintenance company only at LAPORAN SELESAI (report
 *   complete). Emergency-flagged defects bypass the wait — they open VERIFIED
 *   and route at inspection submit. See defect-release.util.ts.
 *
 * Selected by the DEFECT_GOVERNANCE_MODE env var so a live pilot can switch — and
 * switch back — without a code change. This is a *relaxation*, not a deletion:
 * the QA-gated code paths remain intact behind the flag.
 */
export function resolveDefectGovernanceMode(): DefectGovernanceMode {
  switch (process.env.DEFECT_GOVERNANCE_MODE) {
    case 'QA_GATED':
      return 'QA_GATED';
    case 'RELEASE_ON_REPORT':
      return 'RELEASE_ON_REPORT';
    default:
      return 'INSPECTOR_OWNS';
  }
}

export function inspectorOwnsDefects(): boolean {
  return resolveDefectGovernanceMode() === 'INSPECTOR_OWNS';
}

/**
 * True when defects release to the maintenance company at LAPORAN SELESAI rather
 * than being maintenance-ready at inspection submit (maintenance handoff). Used
 * to gate the release/auto-route side effects and the board relabel.
 */
export function releaseDefectsOnReport(): boolean {
  return resolveDefectGovernanceMode() === 'RELEASE_ON_REPORT';
}

/**
 * The lifecycle status a freshly-materialized defect opens in. Single source of
 * truth shared by every defect-creation path (inspection submit + the lazy
 * materializers in defects.service / dashboard.service) so they can't drift.
 *
 * - QA_GATED: opens at DETECTED (awaits QA review).
 * - INSPECTOR_OWNS: opens at VERIFIED — immediately maintenance-ready.
 * - RELEASE_ON_REPORT: opens DORMANT at DETECTED, EXCEPT emergency-flagged
 *   defects which open VERIFIED so they can be claimed/routed instantly at
 *   submit (the org stamp is applied by the release step).
 */
export function initialDefectLifecycleStatus(opts?: {
  isEmergency?: boolean;
}): DefectLifecycleStatus {
  const mode = resolveDefectGovernanceMode();

  if (mode === 'QA_GATED') {
    return DefectLifecycleStatus.DETECTED;
  }

  if (mode === 'RELEASE_ON_REPORT') {
    return opts?.isEmergency
      ? DefectLifecycleStatus.VERIFIED
      : DefectLifecycleStatus.DETECTED;
  }

  // INSPECTOR_OWNS
  return DefectLifecycleStatus.VERIFIED;
}
