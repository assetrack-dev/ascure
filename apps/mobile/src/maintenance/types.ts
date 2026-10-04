/**
 * Shapes of the contractor "my work" API (GET /maintenance-work[/:siteVisitId])
 * — docs/PLAN-maintenance-flow.md §7.1. Cached whole so the crew can work
 * offline; local (not yet synced) repair actions are overlaid on top.
 */
export type WorkState = 'TODO' | 'IN_PROGRESS' | 'SUBMITTED' | 'CLOSED';
export type WorkCounts = Record<WorkState, number>;
export type RepairStage = 'BEFORE' | 'DURING' | 'AFTER';
export type MaintenanceCategory = 'RENTIS' | 'CAT_TIANG' | 'SELENGGARAAN';
export type WorkRole = 'MANAGER' | 'SUPERVISOR' | 'TECHNICIAN';

export type WorkPackageSummary = {
  siteVisitId: string;
  pencawangName: string | null;
  pencawangCode: string | null;
  mainhead: { id: string; name: string } | null;
  cycleNumber: number | null;
  dueDate: string | null;
  notes: string | null;
  categories: MaintenanceCategory[];
  poleCount: number;
  emergencyCount: number;
  counts: WorkCounts;
  center: { latitude: number; longitude: number } | null;
};

export type WorkPackageList = {
  role: WorkRole;
  packages: WorkPackageSummary[];
};

export type WorkPhoto = { id: string; url: string; takenAt: string };

export type WorkKejanggalan = {
  id: string;
  label: string;
  remark: string | null;
  severity: string;
  isEmergency: boolean;
  category: MaintenanceCategory;
  state: WorkState;
  lifecycleStatus: string | null;
  resolutionOutcome: string | null;
  cannotRepair: boolean;
  maintenanceNotes: string | null;
  submittedAt: string | null;
  team: { id: string; name: string } | null;
  sentBackReason: string | null;
  dueDate: string | null;
  surveyedAt: string | null;
  surveyPhotos: Array<{ id: string; url: string }>;
  photos: Record<RepairStage, WorkPhoto[]>;
  /** Added during maintenance, not in the survey (plan §13). */
  isNewFinding?: boolean;
  addedBy?: string | null;
  addedAt?: string | null;
};

export type WorkPole = {
  assetId: string;
  assetCode: string;
  refCode: string | null;
  noTiangLama: string | null;
  latitude: number | null;
  longitude: number | null;
  counts: WorkCounts;
  kejanggalan: WorkKejanggalan[];
};

export type WorkPackageDetail = {
  role: WorkRole;
  siteVisitId: string;
  pencawangName: string | null;
  pencawangCode: string | null;
  mainhead: { id: string; name: string } | null;
  counts: WorkCounts;
  poles: WorkPole[];
  /** §13 — poles this crew may add a new Kejanggalan on (absent in packs cached by older builds). */
  surveyedPoles?: SurveyedPole[];
  /** §13 — per checklist template, the items that can carry a Kejanggalan. */
  findingTemplates?: Array<{ templateId: string; items: FindingItem[] }>;
  generatedAt: string;
};

export type SurveyedPole = {
  assetId: string;
  assetCode: string;
  refCode: string | null;
  noTiangLama: string | null;
  latitude: number | null;
  longitude: number | null;
  templateId: string;
  /** Work types this crew may add on this pole. */
  categories: MaintenanceCategory[];
};

export type FindingOption = { value: string; label: string; severity: string };

export type FindingItem = {
  templateItemId: string;
  label: string;
  section: string | null;
  category: MaintenanceCategory;
  severity: string;
  inputType: string;
  /** Empty for a yes/no item — adding it IS the defect answer. */
  options: FindingOption[];
};

export const CATEGORY_LABEL: Record<MaintenanceCategory, string> = {
  RENTIS: 'Rentis',
  CAT_TIANG: 'Cat tiang',
  SELENGGARAAN: 'Selenggaraan',
};

export const STAGE_LABEL: Record<RepairStage, string> = {
  BEFORE: 'Before',
  DURING: 'During',
  AFTER: 'After',
};

export const STATE_LABEL: Record<WorkState, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Submitted',
  CLOSED: 'Closed',
};
