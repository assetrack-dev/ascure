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
  code: string;
  name: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

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
  status: AssetStatus;
  latitude: number | null;
  longitude: number | null;
  metadata?: Record<string, unknown> | null;
  location?: string | null;
  pencawangName?: string;
  substation?: Pick<Substation, 'id' | 'code' | 'name' | 'location'>;
  latestInspection: AssetDetailInspection | null;
}

export type InspectionCompletionStatus = 'DRAFT' | 'SUBMITTED';
export type InspectionItemResultValue = 'PASS' | 'FAIL' | 'NA';

export interface InspectionSummary {
  id: string;
  tenantId?: string;
  siteVisitId: string;
  assetId: string;
  templateId: string;
  createdByUserId?: string;
  inspectionCycle: number;
  completionStatus: InspectionCompletionStatus;
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
  uri?: string | null;
  url?: string | null;
  path?: string | null;
}

export interface SiteVisit {
  id: string;
  tenantId?: string;
  teamId: string;
  substationId: string;
  createdByUserId?: string;
  status: string;
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
  | 'DATE'
  | 'DATETIME'
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
    inspectionCycle: number;
    completionStatus: InspectionCompletionStatus;
    submittedAt: string | null;
    createdAt: string;
    updatedAt: string;
    siteVisit: {
      id: string;
      status: string;
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
  cycleNumber: number;
  status: string;
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
  label: string;
  result: 'FAIL';
  remark?: string | null;
  status: DefectStatus;
  severity?: DefectSeverity | null;
  actionRemark?: string | null;
  closedAt?: string | null;
  submittedAt?: string | null;
  createdAt: string;
};

export type DefectDetail = {
  id: string;
  inspectionItemResultId: string;
  status: DefectStatus;
  severity?: DefectSeverity | null;
  actionRemark: string | null;
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
}

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
  assetType: string;
  name: string;
  isActive?: boolean;
  items: ChecklistTemplateItemInput[];
}

export interface UpdateChecklistTemplateInput {
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

export type DraftValue = string | boolean | null;
export type DraftValues = Record<string, DraftValue>;
export type ChecklistItemDraftValue = {
  result: InspectionItemResultValue | null;
  remark: string;
};
export type ChecklistDraftValues = Record<string, ChecklistItemDraftValue>;
