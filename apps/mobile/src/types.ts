export type UserRole = 'ADMIN' | 'MANAGER' | 'SUPERVISOR' | 'TECHNICIAN';

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
  assetType: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  latestInspection: AssetDetailInspection | null;
}

export type InspectionCompletionStatus = 'DRAFT' | 'SUBMITTED';

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
  notes: string | null;
  createdAt?: string;
  updatedAt?: string;
  team: Pick<Team, 'id' | 'code' | 'name'>;
  substation: Pick<Substation, 'id' | 'code' | 'name' | 'location'>;
  createdBy?: Pick<SessionUser, 'id' | 'email' | 'name' | 'role'>;
  users?: SiteVisitUser[];
  inspections?: InspectionSummary[];
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

export interface InspectionImageUploadInput {
  uri: string;
  latitude: number;
  longitude: number;
  timestamp: string;
}

export interface InspectionImage {
  id?: string;
  inspectionId?: string;
  uri?: string;
  url?: string;
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

export type InspectionDetail = {
  id: string;
  assetId: string;
  cycleNumber: number;
  status: string;
  submittedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  remarks?: string | null;
  images?: InspectionImage[];
};

export interface SelectOption {
  label: string;
  value: string;
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
