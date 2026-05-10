export type ChecklistTemplateStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export type ChecklistFieldType = "YES_NO" | "DROPDOWN" | "TEXT" | "NUMBER" | "DATE" | "DATETIME";

export interface AssetType {
  id: string;
  code: string;
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
  options?: ChecklistTemplateOption[];
}

export interface CreateChecklistTemplatePayload {
  assetType: string;
  name: string;
  isActive?: boolean;
  items: ChecklistTemplateItemPayload[];
}

export interface UpdateChecklistTemplatePayload {
  name?: string;
  isActive?: boolean;
  items?: ChecklistTemplateItemPayload[];
}
