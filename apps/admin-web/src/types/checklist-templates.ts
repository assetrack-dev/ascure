export type ChecklistTemplateStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
export type ChecklistTemplateScopeLevel =
  | "GLOBAL"
  | "ORGANIZATION"
  | "OPERATIONAL_REGION"
  | "BRANCH"
  | "MAINHEAD";

export type ChecklistFieldType =
  | "TEXT"
  | "NUMBER"
  | "YES_NO"
  | "DROPDOWN"
  | "MULTI_SELECT"
  | "IMAGE"
  | "DATE"
  | "DATETIME"
  | "GPS"
  | "READING"
  | "OCR";

export type DefectSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type MaintenanceCategory = "RENTIS" | "CAT_TIANG" | "SELENGGARAAN";

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
  branchId?: string | null;
}

export interface TemplateOrganization {
  id: string;
  code?: string | null;
  name: string;
  type?: string | null;
}

export interface TemplateBranch {
  id: string;
  code?: string | null;
  name: string;
  region?: string | null;
  organizationId?: string | null;
}

export interface TemplateOperationalRegion {
  id: string;
  code?: string | null;
  name: string;
  state?: string | null;
}

export interface ChecklistTemplateOption {
  label: string;
  value: string;
  prefix?: string;
  /**
   * When true, selecting this option marks the checklist answer as a defect
   * (result = FAIL) on the mobile app, regardless of the option wording. This is
   * the explicit, language-independent defect signal for SELECT / MULTI_SELECT
   * items (replaces fragile keyword guessing for Bahasa Malaysia labels).
   */
  isDefect?: boolean;
  /**
   * Per-option defect severity (only on a defect option). When set, a defect
   * raised by picking this option uses THIS severity instead of the item-level
   * one — e.g. KUANTAN's A→CRITICAL / B→HIGH / C→LOW classification.
   */
  severity?: DefectSeverity;
}

export type ChecklistShowIfOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "greater_than"
  | "less_than"
  | "is_empty"
  | "is_not_empty";

export interface ChecklistShowIfConfig {
  dependsOn: string;
  operator: ChecklistShowIfOperator;
  value?: string | null;
}

export interface ChecklistImageConfig {
  requiredPhoto: boolean;
  allowMultiplePhotos: boolean;
  cameraOnly: boolean;
  galleryAllowed: boolean;
  timestampOverlayRequired: boolean;
}

export interface ChecklistMeasurementConfig {
  unit: string | null;
  source: "manual" | "photo_ocr_future";
  requiresImage: boolean;
}

export interface ChecklistItemConfig {
  version: 2;
  fieldType: ChecklistFieldType;
  options?: ChecklistTemplateOption[];
  allowOther?: boolean;
  showIf?: ChecklistShowIfConfig;
  image?: ChecklistImageConfig;
  measurement?: ChecklistMeasurementConfig;
}

export interface ChecklistTemplateGroup {
  id?: string;
  title: string;
  description?: string | null;
  sortOrder: number;
}

export interface ChecklistTemplateItem {
  id: string;
  templateId: string;
  sectionId?: string;
  /** The named group (section) this item belongs to. */
  groupTitle?: string | null;
  key?: string;
  label: string;
  helperText?: string | null;
  fieldType: ChecklistFieldType;
  inputType?: string;
  options: ChecklistTemplateOption[];
  optionsJson?: unknown;
  config?: ChecklistItemConfig | null;
  showIf?: ChecklistShowIfConfig | null;
  imageConfig?: ChecklistImageConfig | null;
  measurementConfig?: ChecklistMeasurementConfig | null;
  sortOrder: number;
  isRequired: boolean;
  isActive: boolean;
  isDefectTrigger: boolean;
  severity?: DefectSeverity | null;
  /** Maintenance work-type. Null = SELENGGARAAN (default catch-all). */
  maintenanceCategory?: MaintenanceCategory | null;
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
  scopeLevel: ChecklistTemplateScopeLevel;
  organizationId?: string | null;
  organization?: TemplateOrganization | null;
  operationalRegionId?: string | null;
  operationalRegion?: TemplateOperationalRegion | null;
  branchId?: string | null;
  branch?: TemplateBranch | null;
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
  groups?: ChecklistTemplateGroup[];
  items: ChecklistTemplateItem[];
}

export interface ChecklistTemplateGroupPayload {
  title: string;
  sortOrder?: number;
}

export interface ChecklistTemplateItemPayload {
  id?: string;
  key?: string;
  groupTitle?: string;
  label: string;
  helperText?: string | null;
  fieldType: ChecklistFieldType;
  allowOther?: boolean;
  sortOrder: number;
  isRequired: boolean;
  isActive: boolean;
  isDefectTrigger: boolean;
  severity?: DefectSeverity;
  maintenanceCategory?: MaintenanceCategory | null;
  options?: ChecklistTemplateOption[];
  optionsJson?: unknown;
  showIf?: ChecklistShowIfConfig | null;
  imageConfig?: ChecklistImageConfig | null;
  measurementConfig?: ChecklistMeasurementConfig | null;
}

export interface CreateChecklistTemplatePayload {
  assetType?: string;
  assetTypeId?: string;
  capabilityId?: string | null;
  scopeLevel?: ChecklistTemplateScopeLevel | null;
  organizationId?: string | null;
  operationalRegionId?: string | null;
  branchId?: string | null;
  mainheadId?: string | null;
  operationalDomain?: string | null;
  name: string;
  isActive?: boolean;
  groups?: ChecklistTemplateGroupPayload[];
  items: ChecklistTemplateItemPayload[];
}

export interface UpdateChecklistTemplatePayload {
  assetType?: string;
  assetTypeId?: string;
  capabilityId?: string | null;
  scopeLevel?: ChecklistTemplateScopeLevel | null;
  organizationId?: string | null;
  operationalRegionId?: string | null;
  branchId?: string | null;
  mainheadId?: string | null;
  operationalDomain?: string | null;
  name?: string;
  isActive?: boolean;
  groups?: ChecklistTemplateGroupPayload[];
  items?: ChecklistTemplateItemPayload[];
}
