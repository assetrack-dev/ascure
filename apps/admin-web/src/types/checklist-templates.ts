export type ChecklistTemplateStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export type ChecklistFieldType = "YES_NO" | "DROPDOWN" | "TEXT" | "NUMBER" | "DATE" | "DATETIME";

export type DefectSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface AssetType {
  id: string;
  code: string;
  name: string;
  capabilityId?: string | null;
  capability?: TemplateCapability | null;
  description?: string | null;
  isActive?: boolean;
  sortOrder?: number | null;
}

export interface TemplateCapability {
  id: string;
  code: string;
  name: string;
  isActive?: boolean | null;
}

export interface TemplateMainhead {
  id: string;
  code?: string | null;
  name: string;
}

export interface ChecklistTemplateOption {
  label: string;
  value: string;
}

export interface ChecklistTemplateItem {
  id: string;
  templateId: string;
  key?: string;
  label: string;
  fieldType: ChecklistFieldType;
  inputType?: string;
  options: ChecklistTemplateOption[];
  optionsJson?: unknown;
  sortOrder: number;
  isRequired: boolean;
  isActive: boolean;
  isDefectTrigger: boolean;
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
  capability?: TemplateCapability | null;
  mainheadId?: string | null;
  mainhead?: TemplateMainhead | null;
  operationalDomain?: string | null;
  resolutionSource?: string;
  name: string;
  version: number;
  status: ChecklistTemplateStatus;
  isActive: boolean;
  itemCount: number;
  inspectionCount: number;
  createdAt?: string;
  updatedAt?: string;
  items: ChecklistTemplateItem[];
}

export interface ChecklistTemplateItemPayload {
  id?: string;
  label: string;
  fieldType: ChecklistFieldType;
  sortOrder: number;
  isRequired: boolean;
  isActive: boolean;
  isDefectTrigger: boolean;
  severity?: DefectSeverity;
  options?: ChecklistTemplateOption[];
}

export interface CreateChecklistTemplatePayload {
  assetType?: string;
  assetTypeId?: string;
  capabilityId?: string | null;
  mainheadId?: string | null;
  operationalDomain?: string | null;
  name: string;
  isActive?: boolean;
  items: ChecklistTemplateItemPayload[];
}

export interface UpdateChecklistTemplatePayload {
  assetType?: string;
  assetTypeId?: string;
  capabilityId?: string | null;
  mainheadId?: string | null;
  operationalDomain?: string | null;
  name?: string;
  isActive?: boolean;
  items?: ChecklistTemplateItemPayload[];
}
