export type UserRole =
  | 'ADMIN'
  | 'MANAGER'
  | 'SUPERVISOR'
  | 'TECHNICIAN'
  | 'VIEWER'
  | 'CLIENT';

export interface SessionUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  departmentId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Team {
  id: string;
  tenantId?: string;
  departmentId?: string;
  organizationId?: string | null;
  branchId?: string | null;
  mainheadId?: string | null;
  code: string;
  name: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Mainhead {
  id: string;
  name: string;
  code?: string | null;
  branchId: string;
  organizationId?: string | null;
  description?: string | null;
  isActive?: boolean;
  branch?: {
    id: string;
    organizationId?: string | null;
    name: string;
    code?: string | null;
    region?: string | null;
    isActive?: boolean;
    organization?: {
      id: string;
      name: string;
      code?: string | null;
      type?: string | null;
      isActive?: boolean;
    } | null;
  } | null;
}

export type OperationMode = 'INSPECTION' | 'MAINTENANCE';
export type OperationalScope =
  | 'SAVR'
  | 'SAVT'
  | 'PENCAWANG'
  | 'FEEDER_PILLAR'
  | 'CABLE_BRIDGE'
  | 'LINK_BOX';
export type OperationalSessionScope = OperationalScope;
export type OperationalSessionStatus =
  | 'DRAFT'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'QA_REVIEW'
  | 'AMENDMENT_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';
export type SessionKind = 'PENCENTRIC' | 'ROUTE' | 'STANDALONE';

export type SiteVisitType = 'DISCOVERY' | 'REINSPECTION' | 'SPECIAL' | 'AUDIT';

export interface Substation {
  id: string;
  tenantId?: string;
  name: string;
  code: string;
  location?: string | null;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SiteVisitUser {
  id: string;
  siteVisitId: string;
  userId: string;
  joinedAt: string;
  createdAt?: string;
  updatedAt?: string;
  user: SessionUser;
}

export interface AssetType {
  id: string;
  code: string;
  name: string;
  capabilityId?: string | null;
  capability?: {
    id: string;
    code: string;
    name: string;
  } | null;
  operationalScope?: OperationalScope | null;
  description?: string | null;
  isActive?: boolean;
  sortOrder?: number | null;
}

export type AssetStatus = 'ACTIVE' | 'INACTIVE' | 'NOT_FOUND' | 'REMOVED' | 'DUPLICATE';

export interface Asset {
  id: string;
  tenantId?: string;
  substationId: string;
  assetTypeId: string;
  assetCode: string;
  name: string | null;
  latitude?: number | null;
  longitude?: number | null;
  metadata?: Record<string, unknown> | null;
  status: AssetStatus;
  createdDuringVisitId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  assetType: AssetType;
  substation?: Pick<Substation, 'id' | 'code' | 'name'>;
}

export type AssetDetailImageType = 'BEFORE' | 'DURING' | 'AFTER';

export interface AssetDetailImage {
  uri?: string;
  url?: string;
  type?: AssetDetailImageType;
}

export interface AssetDetailInspection {
  id: string;
  cycleNumber: number;
  status: string;
  submittedAt: string;
  remarks: string;
  images: AssetDetailImage[];
}

export interface AssetDetailResponse {
  id: string;
  assetCode: string;
  name?: string | null;
  assetType: string;
  assetTypeId?: string;
  assetTypeCode?: string;
  assetTypeName?: string;
  status: AssetStatus;
  latitude: number | null;
  longitude: number | null;
  metadata?: Record<string, unknown> | null;
  location?: string | null;
  pencawangName?: string;
  substation?: Pick<Substation, 'id' | 'code' | 'name' | 'location'>;
  latestInspection: AssetDetailInspection | null;
}

export type InspectionCompletionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'NEED_AMENDMENT'
  | 'REJECTED'
  | 'APPROVED';
export type InspectionItemResultValue = 'PASS' | 'FAIL' | 'NA';

export interface InspectionSummary {
  id: string;
  tenantId?: string;
  siteVisitId: string;
  assetId: string;
  templateId: string;
  createdByUserId?: string;
  operationalSessionId?: string | null;
  inspectionCycle: number;
  completionStatus: InspectionCompletionStatus;
  operationMode?: OperationMode | null;
  operationalScope?: OperationalScope | null;
  requiresQAQC?: boolean | null;
  reportingGroup?: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt?: string;
  asset?: Pick<Asset, 'id' | 'assetCode' | 'name'>;
  inspectionImages?: InspectionImage[];
  images?: InspectionImage[];
}

export interface SiteVisitSummary {
  totalAssets: number;
  inspectedAssets: number;
  pendingAssets: number;
  defectsFound: number;
  completionPercentage: number;
}

export interface SiteVisitImage {
  id?: string;
  uri?: string | null;
  url?: string | null;
  path?: string | null;
  fileName?: string;
  contentType?: string | null;
  createdAt?: string;
}

export interface SiteVisit {
  id: string;
  tenantId?: string;
  teamId: string;
  substationId: string;
  createdByUserId?: string;
  status: string;
  visitType?: SiteVisitType | null;
  operationMode?: OperationMode | null;
  operationalScope?: OperationalScope | null;
  sessionKind?: SessionKind | null;
  fromPencawangId?: string | null;
  toPencawangId?: string | null;
  fromPencawang?: Pick<Substation, 'id' | 'code' | 'name' | 'location'> | null;
  toPencawang?: Pick<Substation, 'id' | 'code' | 'name' | 'location'> | null;
  requiresQAQC?: boolean | null;
  reportingGroup?: string | null;
  mainhead?: string | null;
  pencawangCode?: string | null;
  pencawangName?: string | null;
  functionalLocation?: string | null;
  checkInLatitude?: number | null;
  checkInLongitude?: number | null;
  checkInAccuracyMeters?: number | null;
  checkInCapturedAt?: string | null;
  startedAt: string;
  endedAt: string | null;
  completedAt?: string | null;
  notes: string | null;
  completionNotes?: string | null;
  createdAt?: string;
  updatedAt?: string;
  team: Pick<Team, 'id' | 'code' | 'name'>;
  substation: Pick<Substation, 'id' | 'code' | 'name' | 'location'>;
  createdBy?: Pick<SessionUser, 'id' | 'email' | 'name' | 'role'>;
  users?: SiteVisitUser[];
  teamMembers?: Array<Pick<SessionUser, 'id' | 'email' | 'name' | 'role'> & {
    siteVisitUserId?: string;
    joinedAt?: string;
  }>;
  inspections?: InspectionSummary[];
  images?: SiteVisitImage[];
  summary?: SiteVisitSummary;
  totalAssets?: number;
  inspectedAssets?: number;
  pendingAssets?: number;
  defectsFound?: number;
  completionPercentage?: number;
}

export interface OperationalSessionRecord {
  id: string;
  code?: string | null;
  name: string;
}

export type OperationalSessionUser = Pick<SessionUser, 'id' | 'email' | 'name' | 'role'>;

export interface OperationalSessionProgress {
  totalAssets: number;
  inspectedAssets: number;
  completedAssets: number;
  completionPercentage: number;
}

export interface OperationalSessionAssignedAsset {
  id: string;
  assetCode: string;
  name: string | null;
  assetType: Pick<AssetType, 'id' | 'code' | 'name'>;
  latitude: number | null;
  longitude: number | null;
  status: AssetStatus;
  latestInspectionId: string | null;
  latestInspectionStatus: InspectionCompletionStatus | null;
  inspected: boolean;
  assignment: {
    id: string;
    operationalSessionId: string;
    assetId: string;
    assignedAt: string;
    assignedByUserId: string | null;
    assignedBy?: OperationalSessionUser | null;
    removedAt: string | null;
    removedByUserId: string | null;
    removedBy?: OperationalSessionUser | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
  };
}

export interface OperationalSessionAssignedAssetsSummary {
  count: number;
  activeCount: number;
  recent: OperationalSessionAssignedAsset[];
}

export interface OperationalSession {
  id: string;
  sessionNo: string;
  workspaceId: string;
  organizationId: string;
  branchId?: string | null;
  mainheadId?: string | null;
  assignedCompanyId: string;
  assignedQaUserId?: string | null;
  scope: OperationalSessionScope;
  status: OperationalSessionStatus;
  metadata?: Record<string, unknown> | null;
  targetDate?: string | null;
  dueDate?: string | null;
  startedAt?: string | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  remarks?: string | null;
  createdAt: string;
  updatedAt: string;
  workspace?: OperationalSessionRecord | null;
  organization?: OperationalSessionRecord | null;
  branch?: OperationalSessionRecord | null;
  mainhead?: OperationalSessionRecord | null;
  assignedCompany?: OperationalSessionRecord | null;
  assignedQaUser?: OperationalSessionUser | null;
  progress?: OperationalSessionProgress;
  assignedAssets?: OperationalSessionAssignedAssetsSummary;
}

export interface OperationalSessionFilters {
  workspaceId?: string;
  scope?: OperationalSessionScope;
  status?: OperationalSessionStatus;
  assignedCompanyId?: string;
  assignedQaUserId?: string;
  mainheadId?: string;
}

export interface SiteVisitAssetLink {
  id: string;
  siteVisitId: string;
  assetId: string;
  addedByUserId?: string | null;
  addedAt?: string;
  source?: string | null;
  notes?: string | null;
  asset: Asset;
}

export interface LoginResponse {
  access_token: string;
  user: SessionUser;
}

export type InspectionItemInputType =
  | 'TEXT'
  | 'BOOLEAN'
  | 'NUMBER'
  | 'SELECT'
  | 'MULTI_SELECT'
  | 'IMAGE'
  | 'DATE'
  | 'DATETIME'
  | 'GPS'
  | 'READING'
  | 'JSON';

export interface InspectionValue {
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  valueDate: string | null;
  valueDateTime: string | null;
  valueJson: unknown;
}

export interface InspectionTemplateItem {
  id: string;
  key: string;
  label: string;
  helperText: string | null;
  inputType: InspectionItemInputType;
  isRequired: boolean;
  isDefectTrigger?: boolean;
  severity?: DefectSeverity | null;
  sortOrder: number;
  optionsJson: unknown;
  fieldType?: string;
  value: InspectionValue | null;
}

export interface InspectionTemplateSection {
  id: string;
  title: string;
  description: string | null;
  sortOrder: number;
  items: InspectionTemplateItem[];
}

export interface InspectionFormResponse {
  inspection: {
    id: string;
    tenantId: string;
    siteVisitId: string;
    assetId: string;
    templateId: string;
    operationalSessionId: string | null;
    inspectionCycle: number;
    completionStatus: InspectionCompletionStatus;
    operationMode?: OperationMode | null;
    operationalScope?: OperationalScope | null;
    requiresQAQC?: boolean | null;
    reportingGroup?: string | null;
    submittedAt: string | null;
    createdAt: string;
    updatedAt: string;
    siteVisit: {
      id: string;
      status: string;
      operationMode?: OperationMode | null;
      operationalScope?: OperationalScope | null;
      sessionKind?: SessionKind | null;
      requiresQAQC?: boolean | null;
      reportingGroup?: string | null;
      startedAt: string;
      team: Pick<Team, 'id' | 'code' | 'name'>;
      substation: Pick<Substation, 'id' | 'code' | 'name'>;
    };
    asset: Pick<Asset, 'id' | 'assetCode' | 'name'> & {
      assetType: AssetType;
      substation: Pick<Substation, 'id' | 'code' | 'name'>;
    };
    createdBy: Pick<SessionUser, 'id' | 'email' | 'name' | 'role'>;
  };
  template: {
    id: string;
    name: string;
    version: number;
    assetTypeId?: string;
    capabilityId?: string | null;
    scopeLevel?: ChecklistTemplateScopeLevel;
    organizationId?: string | null;
    branchId?: string | null;
    mainheadId?: string | null;
    operationalScope?: OperationalScope | null;
    requiresQAQC?: boolean | null;
    sections: InspectionTemplateSection[];
  };
  results: Array<{
    id: string;
    templateItemId: string;
    valueText: string | null;
    valueNumber: number | null;
    valueBoolean: boolean | null;
    valueDate: string | null;
    valueDateTime: string | null;
    valueJson: unknown;
    createdAt: string;
    updatedAt: string;
  }>;
  items?: InspectionItemResult[];
}

export interface SaveInspectionResultItemInput {
  templateItemId: string;
  valueText?: string | null;
  valueNumber?: number | null;
  valueBoolean?: boolean | null;
  valueDate?: string | null;
  valueDateTime?: string | null;
  valueJson?: unknown;
}

export interface SaveInspectionItemResultInput {
  checklistItemId?: string | null;
  label: string;
  result: InspectionItemResultValue;
  remark?: string | null;
}

export interface InspectionImageUploadInput {
  uri: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  type?: string | null;
}

export interface SiteVisitImageUploadInput {
  uri: string;
  timestamp?: string;
}

export interface InspectionImage {
  id?: string;
  inspectionId?: string;
  uri?: string;
  url?: string;
  path?: string;
  type?: string | null;
  filename?: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  timestamp?: string | null;
  createdAt?: string;
}

export interface DefectEvidenceImage extends InspectionImage {
  defectId?: string;
  uploadedByUserId?: string | null;
  evidenceType?: string | null;
  storageKey?: string | null;
  fileName?: string | null;
  contentType?: string | null;
  note?: string | null;
  uploadedAt?: string;
  updatedAt?: string;
}

export interface DefectEvidenceImageUploadInput {
  uri: string;
  latitude?: number | null;
  longitude?: number | null;
  timestamp: string;
  note?: string | null;
}

export type AssetInspectionHistoryItem = {
  id: string;
  assetId: string;
  cycleNumber: number;
  status: string;
  submittedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  remarks?: string | null;
  imageCount?: number;
  images?: InspectionImage[];
};

export type DefectStatus = 'OPEN' | 'IN_PROGRESS' | 'MONITORING' | 'RESOLVED' | 'CLOSED';

export type DefectSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type DefectLifecycleStatus =
  | 'DETECTED'
  | 'UNDER_REVIEW'
  | 'VERIFIED'
  | 'REJECTED'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'VERIFICATION_PENDING'
  | 'CLOSED';
export type DefectResolutionOutcome =
  | 'RESOLVED'
  | 'TEMPORARY_FIX'
  | 'MONITORING_REQUIRED'
  | 'EXTERNAL_CONSTRAINT'
  | 'DUPLICATE'
  | 'FALSE_POSITIVE'
  | 'DEFERRED'
  | 'REPAIRED'
  | 'PARTIAL'
  | 'MONITOR_ONLY'
  | 'ESCALATED';

export type DashboardRecentDefect = {
  id: string;
  assetCode?: string;
  label: string;
  status: DefectStatus;
  severity?: DefectSeverity | null;
  createdAt: string;
};

export type DashboardData = {
  totalAssets: number;
  totalInspections: number;
  totalDefects: number;
  openDefects: number;
  inProgressDefects: number;
  closedDefects: number;
  recentDefects: DashboardRecentDefect[];
};

export type InspectionDetail = {
  id: string;
  assetId: string;
  operationalSessionId?: string | null;
  cycleNumber: number;
  status: string;
  operationMode?: OperationMode | null;
  operationalScope?: OperationalScope | null;
  requiresQAQC?: boolean | null;
  reportingGroup?: string | null;
  submittedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  remarks?: string | null;
  items?: InspectionItemResult[];
  totalDefects?: number;
  images?: InspectionImage[];
};

export type DefectListItem = {
  id: string;
  inspectionItemResultId?: string;
  inspectionId: string;
  assetId: string;
  assetCode?: string;
  assetType?: string;
  cycleNumber?: number;
  assignedUserId?: string | null;
  assignedTeamId?: string | null;
  assignedToUserId?: string | null;
  assignedToTeamId?: string | null;
  assignedAt?: string | null;
  label: string;
  result: 'FAIL';
  remark?: string | null;
  status: DefectStatus;
  lifecycleStatus?: DefectLifecycleStatus | null;
  severity?: DefectSeverity | null;
  resolutionOutcome?: DefectResolutionOutcome | null;
  actionRemark?: string | null;
  verificationNotes?: string | null;
  verificationRemarks?: string | null;
  maintenanceNotes?: string | null;
  closureVerificationNotes?: string | null;
  closureRemarks?: string | null;
  verifiedAt?: string | null;
  maintainedAt?: string | null;
  closureVerifiedAt?: string | null;
  closedAt?: string | null;
  submittedAt?: string | null;
  createdAt: string;
};

export type DefectDetail = {
  id: string;
  inspectionItemResultId: string;
  status: DefectStatus;
  lifecycleStatus?: DefectLifecycleStatus | null;
  severity?: DefectSeverity | null;
  assignedUserId?: string | null;
  assignedTeamId?: string | null;
  assignedToUserId?: string | null;
  assignedToTeamId?: string | null;
  assignedTo?: string | null;
  assignedAt?: string | null;
  resolutionOutcome?: DefectResolutionOutcome | null;
  actionRemark: string | null;
  verificationNotes?: string | null;
  verificationRemarks?: string | null;
  maintenanceNotes?: string | null;
  closureVerificationNotes?: string | null;
  closureRemarks?: string | null;
  verifiedAt?: string | null;
  maintainedAt?: string | null;
  closureVerifiedAt?: string | null;
  closedAt: string | null;
  label: string;
  checklistRemark: string | null;
  inspectionId: string;
  assetId: string;
  assetCode?: string;
  assetType?: string;
  cycleNumber?: number;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  images: InspectionImage[];
  evidenceImages?: DefectEvidenceImage[];
  maintenanceProofImages?: DefectEvidenceImage[];
};

export interface InspectionItemResult {
  id: string;
  inspectionId?: string;
  checklistItemId: string | null;
  label: string;
  result: InspectionItemResultValue;
  remark: string | null;
  isDefect: boolean;
  severity?: DefectSeverity | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SelectOption {
  label: string;
  value: string;
  prefix?: string;
}

export type ChecklistTemplateScopeLevel = 'GLOBAL' | 'ORGANIZATION' | 'BRANCH' | 'MAINHEAD';

export interface ChecklistTemplateItem {
  id: string;
  templateId: string;
  key?: string;
  label: string;
  fieldType?: string;
  inputType?: InspectionItemInputType;
  options?: SelectOption[];
  optionsJson?: unknown;
  sortOrder: number;
  isRequired: boolean;
  isActive: boolean;
  isDefectTrigger?: boolean;
  severity?: DefectSeverity | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ChecklistTemplate {
  id: string;
  assetType: string;
  assetTypeId: string;
  assetTypeCode?: string;
  assetTypeName?: string;
  capabilityId?: string | null;
  capability?: {
    id: string;
    code: string;
    name: string;
  } | null;
  scopeLevel?: ChecklistTemplateScopeLevel;
  organizationId?: string | null;
  branchId?: string | null;
  mainheadId?: string | null;
  operationalDomain?: string | null;
  operationalScope?: OperationalScope | null;
  requiresQAQC?: boolean | null;
  resolutionSource?: string;
  name: string;
  version: number;
  status: string;
  isActive: boolean;
  itemCount: number;
  inspectionCount?: number;
  createdAt?: string;
  updatedAt?: string;
  items: ChecklistTemplateItem[];
}

export interface ChecklistTemplateItemInput {
  id?: string;
  label: string;
  fieldType?: string;
  inputType?: string;
  sortOrder?: number;
  isRequired?: boolean;
  isActive?: boolean;
  isDefectTrigger?: boolean;
  severity?: DefectSeverity | null;
  options?: SelectOption[];
  optionsJson?: unknown;
}

export interface CreateChecklistTemplateInput {
  assetType?: string;
  assetTypeId?: string;
  capabilityId?: string | null;
  scopeLevel?: ChecklistTemplateScopeLevel | null;
  organizationId?: string | null;
  branchId?: string | null;
  mainheadId?: string | null;
  name: string;
  isActive?: boolean;
  items: ChecklistTemplateItemInput[];
}

export interface UpdateChecklistTemplateInput {
  assetType?: string;
  assetTypeId?: string;
  capabilityId?: string | null;
  scopeLevel?: ChecklistTemplateScopeLevel | null;
  organizationId?: string | null;
  branchId?: string | null;
  mainheadId?: string | null;
  name?: string;
  isActive?: boolean;
  items?: ChecklistTemplateItemInput[];
}

export interface CreateAssetInput {
  substationId: string;
  assetTypeId: string;
  assetCode: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  metadata?: Record<string, unknown>;
  status?: AssetStatus;
  createdDuringVisitId?: string;
}

export interface UpdateAssetInput {
  assetTypeId?: string;
  assetCode?: string;
  name?: string;
  latitude?: number | null;
  longitude?: number | null;
  metadata?: Record<string, unknown> | null;
}

export type DraftValue = string | string[] | boolean | null;
export type DraftValues = Record<string, DraftValue>;
export type ChecklistItemDraftValue = {
  result: InspectionItemResultValue | null;
  remark: string;
};
export type ChecklistDraftValues = Record<string, ChecklistItemDraftValue>;
