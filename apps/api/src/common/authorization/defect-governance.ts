export type DefectGovernanceMode = 'INSPECTOR_OWNS' | 'QA_GATED';

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
 *
 * Selected by the DEFECT_GOVERNANCE_MODE env var so a live pilot can switch — and
 * switch back — without a code change. This is a *relaxation*, not a deletion:
 * the QA-gated code paths remain intact behind the flag.
 */
export function resolveDefectGovernanceMode(): DefectGovernanceMode {
  return process.env.DEFECT_GOVERNANCE_MODE === 'QA_GATED'
    ? 'QA_GATED'
    : 'INSPECTOR_OWNS';
}

export function inspectorOwnsDefects(): boolean {
  return resolveDefectGovernanceMode() === 'INSPECTOR_OWNS';
}
