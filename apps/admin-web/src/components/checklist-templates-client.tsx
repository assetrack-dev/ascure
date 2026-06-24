"use client";

import type { CSSProperties, Dispatch, FormEvent, SetStateAction } from "react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Copy,
  GripVertical,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import {
  activateChecklistTemplate,
  archiveChecklistTemplate,
  createChecklistTemplate,
  duplicateChecklistTemplate,
  fetchAssetTypes,
  fetchChecklistTemplates,
  updateChecklistTemplate,
} from "@/lib/checklist-templates";
import { fetchEnterpriseOptions } from "@/lib/enterprise";
import type { AuthSession } from "@/types/auth";
import type { EnterpriseOptionRecord } from "@/types/enterprise";
import type {
  AssetType,
  ChecklistFieldType,
  ChecklistImageConfig,
  ChecklistMeasurementConfig,
  ChecklistShowIfConfig,
  ChecklistShowIfOperator,
  ChecklistTemplate,
  ChecklistTemplateItem,
  ChecklistTemplateItemPayload,
  ChecklistTemplateOption,
  ChecklistTemplateScopeLevel,
  ChecklistTemplateStatus,
  DefectSeverity,
  MaintenanceCategory,
} from "@/types/checklist-templates";

type StatusFilter = "ALL" | ChecklistTemplateStatus;
type ModalMode = "create" | "edit";

interface TemplateFormItem {
  localId: string;
  id?: string;
  key: string;
  keyTouched: boolean;
  /** Named group this item belongs to ("" = ungrouped / default section). */
  groupTitle: string;
  label: string;
  /** Optional hint shown to the inspector under the field ("expected answer"). */
  helperText: string;
  fieldType: ChecklistFieldType;
  /** MULTI_SELECT only — allow a free-text "Other" answer beyond the options. */
  allowOther: boolean;
  isRequired: boolean;
  isActive: boolean;
  isDefectTrigger: boolean;
  severity: DefectSeverity;
  /** Maintenance work-type for defects from this item. null = SELENGGARAAN. */
  maintenanceCategory: MaintenanceCategory | null;
  optionsText: string;
  imageConfig: ChecklistImageConfig;
  measurementConfig: ChecklistMeasurementConfig;
  showIf: ChecklistShowIfConfig | null;
}

interface TemplateFormState {
  assetTypeId: string;
  capabilityId: string;
  scopeLevel: ChecklistTemplateScopeLevel;
  organizationId: string;
  operationalRegionId: string;
  branchId: string;
  mainheadId: string;
  name: string;
  /** Ordered named groups. Empty = ungrouped (single default section, legacy behavior). */
  groups: string[];
  items: TemplateFormItem[];
}

/** Section title the backend uses for an ungrouped template's single bucket. */
const DEFAULT_GROUP_TITLE = "Checklist Items";

const FIELD_TYPES: Array<{ label: string; value: ChecklistFieldType }> = [
  { label: "Text", value: "TEXT" },
  { label: "Number", value: "NUMBER" },
  { label: "Yes / No", value: "YES_NO" },
  { label: "Dropdown", value: "DROPDOWN" },
  { label: "Multi Select", value: "MULTI_SELECT" },
  { label: "Image", value: "IMAGE" },
  { label: "Date", value: "DATE" },
  { label: "Date Time", value: "DATETIME" },
  { label: "GPS", value: "GPS" },
  { label: "Reading / Measurement", value: "READING" },
  { label: "OCR / Smart Sensor", value: "OCR" },
];
const SHOW_IF_OPERATORS: Array<{ label: string; value: ChecklistShowIfOperator }> = [
  { label: "Equals", value: "equals" },
  { label: "Not equals", value: "not_equals" },
  { label: "Contains", value: "contains" },
  { label: "Greater than", value: "greater_than" },
  { label: "Less than", value: "less_than" },
  { label: "Is empty", value: "is_empty" },
  { label: "Is not empty", value: "is_not_empty" },
];
const STATUS_OPTIONS: Array<{ label: string; value: StatusFilter }> = [
  { label: "All statuses", value: "ALL" },
  { label: "DRAFT", value: "DRAFT" },
  { label: "ACTIVE", value: "ACTIVE" },
  { label: "ARCHIVED", value: "ARCHIVED" },
];
const SCOPE_LEVEL_OPTIONS: Array<{ label: string; value: ChecklistTemplateScopeLevel }> = [
  { label: "Global", value: "GLOBAL" },
  { label: "Organization", value: "ORGANIZATION" },
  { label: "Region", value: "OPERATIONAL_REGION" },
  { label: "Branch", value: "BRANCH" },
  { label: "MAINHEAD", value: "MAINHEAD" },
];
const DEFECT_SEVERITY_OPTIONS: Array<{
  label: string;
  value: DefectSeverity;
  badgeClassName: string;
  dotClassName: string;
}> = [
  {
    label: "Low",
    value: "LOW",
    badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-800",
    dotClassName: "bg-emerald-500",
  },
  {
    label: "Medium",
    value: "MEDIUM",
    badgeClassName: "border-amber-200 bg-amber-50 text-amber-800",
    dotClassName: "bg-amber-500",
  },
  {
    label: "High",
    value: "HIGH",
    badgeClassName: "border-orange-200 bg-orange-50 text-orange-800",
    dotClassName: "bg-orange-500",
  },
  {
    label: "Critical",
    value: "CRITICAL",
    badgeClassName: "border-red-200 bg-red-50 text-red-800",
    dotClassName: "bg-red-500",
  },
];
const inputClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const textareaClassName =
  "min-h-20 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const searchControlClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const secondaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const primaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-4 text-sm font-semibold text-[var(--on-brand)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300";
const dangerButtonClassName =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const rowActionButtonClassName =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const compactRowActionButtonClassName =
  "inline-flex h-7 items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-1.5 text-[11px] font-semibold leading-none text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const compactDangerButtonClassName =
  "inline-flex h-7 items-center justify-center gap-1 rounded-md border border-red-200 bg-white px-1.5 text-[11px] font-semibold leading-none text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const lastActiveItemError = "At least one checklist item must remain active.";

function createLocalId() {
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultImageConfig(): ChecklistImageConfig {
  return {
    requiredPhoto: false,
    allowMultiplePhotos: false,
    cameraOnly: true,
    galleryAllowed: false,
    timestampOverlayRequired: false,
  };
}

function defaultMeasurementConfig(): ChecklistMeasurementConfig {
  return {
    unit: "m",
    source: "manual",
    requiresImage: false,
  };
}

function createBlankItem(): TemplateFormItem {
  return {
    localId: createLocalId(),
    key: "",
    keyTouched: false,
    groupTitle: "",
    label: "",
    helperText: "",
    fieldType: "YES_NO",
    allowOther: false,
    isRequired: true,
    isActive: true,
    isDefectTrigger: true,
    severity: "MEDIUM",
    maintenanceCategory: null,
    optionsText: "",
    imageConfig: defaultImageConfig(),
    measurementConfig: defaultMeasurementConfig(),
    showIf: null,
  };
}

function isFormItemActive(item: Pick<TemplateFormItem, "isActive">) {
  return item.isActive !== false;
}

function activeFormItemCount(items: TemplateFormItem[]) {
  return items.filter(isFormItemActive).length;
}

function normalizeFieldType(value: string | undefined): ChecklistFieldType {
  if (value === "BOOLEAN") {
    return "YES_NO";
  }

  if (value === "SELECT") {
    return "DROPDOWN";
  }

  if (value === "DATE_TIME") {
    return "DATETIME";
  }

  if (value === "READING_MEASUREMENT" || value === "MEASUREMENT") {
    return "READING";
  }

  if (
    value === "YES_NO" ||
    value === "DROPDOWN" ||
    value === "MULTI_SELECT" ||
    value === "IMAGE" ||
    value === "TEXT" ||
    value === "NUMBER" ||
    value === "DATE" ||
    value === "DATETIME" ||
    value === "GPS" ||
    value === "READING" ||
    value === "OCR"
  ) {
    return value;
  }

  return "YES_NO";
}

function optionLines(options: ChecklistTemplateOption[] | undefined) {
  return (options ?? [])
    .map((option) => {
      // When flagging a defect we must emit an explicit value so the trailing
      // "defect" token is never mistaken for the value when the line is re-parsed.
      const baseLine =
        option.label === option.value && !option.isDefect
          ? option.label
          : `${option.label} | ${option.value}`;
      const withPrefix = option.prefix ? `${baseLine} | ${option.prefix}` : baseLine;
      const withDefect = option.isDefect ? `${withPrefix} | defect` : withPrefix;

      // Per-option severity rides as a final token (e.g. KUANTAN "A | A | defect | CRITICAL").
      return option.isDefect && option.severity
        ? `${withDefect} | ${option.severity}`
        : withDefect;
    })
    .join("\n");
}

function itemKeyFromLabel(label: string) {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "checklist_item"
  );
}

function normalizeEditableItemKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 100);
}

function readItemConfig(item: ChecklistTemplateItem) {
  if (item.config) {
    return item.config;
  }

  const optionsJson = item.optionsJson;

  if (!optionsJson || typeof optionsJson !== "object" || Array.isArray(optionsJson)) {
    return null;
  }

  const maybeConfig = optionsJson as { version?: unknown };

  return maybeConfig.version === 2 ? item.optionsJson as ChecklistTemplateItem["config"] : null;
}

function formItemFromTemplateItem(item: ChecklistTemplateItem): TemplateFormItem {
  const config = readItemConfig(item);

  return {
    localId: item.id,
    id: item.id,
    key: item.key ?? itemKeyFromLabel(item.label),
    keyTouched: true,
    groupTitle: item.groupTitle ?? "",
    label: item.label,
    helperText: item.helperText ?? "",
    fieldType: normalizeFieldType(item.fieldType ?? item.inputType),
    allowOther: config?.allowOther ?? false,
    isRequired: item.isRequired,
    isActive: item.isActive !== false,
    isDefectTrigger: item.isDefectTrigger,
    severity: item.severity ?? "MEDIUM",
    maintenanceCategory: item.maintenanceCategory ?? null,
    optionsText: optionLines(item.options),
    imageConfig: item.imageConfig ?? config?.image ?? defaultImageConfig(),
    measurementConfig: item.measurementConfig ?? config?.measurement ?? defaultMeasurementConfig(),
    showIf: item.showIf ?? config?.showIf ?? null,
  };
}

function defaultForm(assetTypeId = "", capabilityId = ""): TemplateFormState {
  return {
    assetTypeId,
    capabilityId,
    scopeLevel: "GLOBAL",
    organizationId: "",
    operationalRegionId: "",
    branchId: "",
    mainheadId: "",
    name: "",
    groups: [],
    items: [createBlankItem()],
  };
}

function normalizeSearchText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function requestErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatCompactDate(value: string | undefined) {
  if (!value) {
    return "No date";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  }).format(date);
}

function templateVersionLabel(template: ChecklistTemplate) {
  return `${template.assetTypeCode ?? template.assetType} V${template.version}`;
}

function optionDisplayName(option: EnterpriseOptionRecord | null | undefined) {
  if (!option) {
    return null;
  }

  return option.code ? `${option.code} - ${option.name}` : option.name;
}

function templateScopeLabel(template: ChecklistTemplate) {
  if (template.scopeLevel === "ORGANIZATION") {
    return `Organization: ${template.organization?.code ?? template.organization?.name ?? template.organizationId ?? "Unknown"}`;
  }

  if (template.scopeLevel === "OPERATIONAL_REGION") {
    return `Region: ${template.operationalRegion?.code ?? template.operationalRegion?.name ?? template.operationalRegionId ?? "Unknown"}`;
  }

  if (template.scopeLevel === "BRANCH") {
    return `Branch: ${template.branch?.code ?? template.branch?.name ?? template.branchId ?? "Unknown"}`;
  }

  if (template.scopeLevel === "MAINHEAD") {
    return `MAINHEAD: ${template.mainhead?.code ?? template.mainhead?.name ?? template.mainheadId ?? "Unknown"}`;
  }

  return "Global";
}

function templateScopeBadgeLabel(template: ChecklistTemplate) {
  if (template.scopeLevel === "ORGANIZATION") {
    return `Org: ${template.organization?.code ?? template.organization?.name ?? template.organizationId ?? "Unknown"}`;
  }

  if (template.scopeLevel === "OPERATIONAL_REGION") {
    return `Region: ${template.operationalRegion?.code ?? template.operationalRegion?.name ?? template.operationalRegionId ?? "Unknown"}`;
  }

  if (template.scopeLevel === "BRANCH") {
    return `Branch: ${template.branch?.code ?? template.branch?.name ?? template.branchId ?? "Unknown"}`;
  }

  if (template.scopeLevel === "MAINHEAD") {
    return `MAINHEAD: ${template.mainhead?.code ?? template.mainhead?.name ?? template.mainheadId ?? "Unknown"}`;
  }

  return "Global";
}

function ScopeBadge({ template }: { template: ChecklistTemplate }) {
  return (
    <span className="inline-block max-w-full whitespace-normal break-words rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold leading-tight text-slate-700">
      {templateScopeBadgeLabel(template)}
    </span>
  );
}

function sameTemplateActivationScope(left: ChecklistTemplate, right: ChecklistTemplate) {
  return (
    left.assetTypeId === right.assetTypeId &&
    (left.capabilityId ?? left.capability?.id ?? null) ===
      (right.capabilityId ?? right.capability?.id ?? null) &&
    (left.scopeLevel ?? "GLOBAL") === (right.scopeLevel ?? "GLOBAL") &&
    (left.organizationId ?? null) === (right.organizationId ?? null) &&
    (left.operationalRegionId ?? null) === (right.operationalRegionId ?? null) &&
    (left.branchId ?? null) === (right.branchId ?? null) &&
    (left.mainheadId ?? null) === (right.mainheadId ?? null)
  );
}

function duplicateTemplateNamePreview(template: ChecklistTemplate) {
  const versionPattern = new RegExp(`\\bv\\s*${template.version}\\b`, "i");
  const suffix = versionPattern.test(template.name) ? " Copy" : ` V${template.version} Copy`;

  return `${template.name.slice(0, 255 - suffix.length)}${suffix}`;
}

const STATUS_META: Record<
  ChecklistTemplateStatus,
  {
    badgeClassName: string;
    dotClassName: string;
    listDescription: string;
    modalDescription: string;
    panelClassName: string;
    rowClassName: string;
  }
> = {
  ACTIVE: {
    badgeClassName: "border-teal-200 bg-teal-50 text-teal-800",
    dotClassName: "bg-teal-600",
    listDescription: "Currently used by mobile inspections.",
    modalDescription: "This active version is currently used by mobile inspections.",
    panelClassName: "border-teal-200 bg-teal-50 text-teal-900",
    rowClassName: "bg-teal-50/20 hover:bg-teal-50/40",
  },
  DRAFT: {
    badgeClassName: "border-amber-200 bg-amber-50 text-amber-800",
    dotClassName: "bg-amber-500",
    listDescription: "Not used by mobile inspections.",
    modalDescription: "This draft is not used by mobile inspections until activated.",
    panelClassName: "border-amber-200 bg-amber-50 text-amber-900",
    rowClassName: "hover:bg-slate-50",
  },
  ARCHIVED: {
    badgeClassName: "border-slate-200 bg-slate-100 text-slate-600",
    dotClassName: "bg-slate-400",
    listDescription: "Archived; edits create a draft.",
    modalDescription: "This archived version should not be edited directly. Saving changes creates a new draft version.",
    panelClassName: "border-slate-200 bg-slate-50 text-slate-700",
    rowClassName: "bg-slate-50/60 hover:bg-slate-100/70",
  },
};

function resolveTemplateStatus(template: Pick<ChecklistTemplate, "status" | "isActive">) {
  if (template.isActive || template.status === "ACTIVE") {
    return "ACTIVE";
  }

  if (template.status === "ARCHIVED") {
    return "ARCHIVED";
  }

  return "DRAFT";
}

function StatusBadge({
  status,
  showDescription = false,
}: {
  status: ChecklistTemplateStatus;
  showDescription?: boolean;
}) {
  const meta = STATUS_META[status];

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold uppercase ${meta.badgeClassName}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClassName}`} />
        {status}
      </span>
      {showDescription ? (
        <span className="hidden max-w-36 whitespace-normal text-[11px] leading-snug text-[var(--muted)] xl:block">
          {meta.listDescription}
        </span>
      ) : null}
    </div>
  );
}

function severityMeta(severity: DefectSeverity) {
  return DEFECT_SEVERITY_OPTIONS.find((option) => option.value === severity) ?? DEFECT_SEVERITY_OPTIONS[1];
}

function SeverityBadge({ severity }: { severity: DefectSeverity }) {
  const meta = severityMeta(severity);

  return (
    <span
      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-bold uppercase ${meta.badgeClassName}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClassName}`} />
      {meta.label}
    </span>
  );
}

function parseOptions(optionsText: string) {
  const options: ChecklistTemplateOption[] = [];
  const seenValues = new Set<string>();

  for (const line of optionsText.split(/\r?\n/)) {
    const normalizedLine = line.trim();

    if (!normalizedLine) {
      continue;
    }

    const [rawLabel, rawValue, ...rest] = normalizedLine.split("|");
    const label = rawLabel.trim();
    const value = (rawValue ?? rawLabel).trim();

    // Trailing tokens after value may be a display prefix and/or the literal
    // keyword "defect", which flags this option as a defect (result = FAIL).
    let prefix: string | undefined;
    let isDefect = false;
    let severity: DefectSeverity | undefined;
    for (const token of rest) {
      const normalizedToken = token.trim();

      if (!normalizedToken) {
        continue;
      }

      if (normalizedToken.toLowerCase() === "defect") {
        isDefect = true;
      } else if (
        DEFECT_SEVERITY_OPTIONS.some((option) => option.value === normalizedToken.toUpperCase())
      ) {
        // A severity keyword (LOW/MEDIUM/HIGH/CRITICAL) → per-option defect severity.
        severity = normalizedToken.toUpperCase() as DefectSeverity;
      } else if (prefix === undefined) {
        prefix = normalizedToken;
      }
    }

    if (!label || !value) {
      throw new Error("Dropdown options need a label and value.");
    }

    if (seenValues.has(value)) {
      throw new Error(`Dropdown option value "${value}" is duplicated.`);
    }

    const option: ChecklistTemplateOption = { label, value };
    if (prefix) {
      option.prefix = prefix;
    }
    if (isDefect) {
      option.isDefect = true;
    }
    // Severity only rides on a defect option (overrides the item severity).
    if (isDefect && severity) {
      option.severity = severity;
    }

    options.push(option);
    seenValues.add(value);
  }

  return options;
}

function buildPayloadItems(items: TemplateFormItem[], groups: string[]) {
  const grouping = groups.length > 0;
  // An item's effective group: its own group if still valid, else the first group.
  const effectiveGroup = (item: TemplateFormItem) =>
    grouping ? (groups.includes(item.groupTitle) ? item.groupTitle : groups[0]) : undefined;
  // Order items by their group so the global sortOrder keeps each group contiguous
  // (downstream flat consumers — report/Excel — read items by sortOrder).
  const orderedItems = grouping
    ? items
        .map((item, index) => ({ item, index }))
        .sort(
          (left, right) =>
            groups.indexOf(effectiveGroup(left.item)!) -
              groups.indexOf(effectiveGroup(right.item)!) || left.index - right.index,
        )
        .map((entry) => entry.item)
    : items;

  const payloadItems: ChecklistTemplateItemPayload[] = [];
  const seenKeys = new Set<string>();

  orderedItems.forEach((item) => {
    const itemIsActive = isFormItemActive(item);

    if (!item.id && !itemIsActive) {
      return;
    }

    const label = item.label.trim();

    if (!label) {
      throw new Error("Every checklist item needs a label.");
    }

    const key = normalizeEditableItemKey(item.key || itemKeyFromLabel(label));
    const hasSelectableOptions =
      item.fieldType === "DROPDOWN" || item.fieldType === "MULTI_SELECT";
    const options = hasSelectableOptions ? parseOptions(item.optionsText) : [];

    if (!key) {
      throw new Error(`Checklist item "${label}" needs an item key.`);
    }

    if (seenKeys.has(key)) {
      throw new Error(`Checklist item key "${key}" is duplicated.`);
    }

    seenKeys.add(key);

    if (hasSelectableOptions && options.length === 0) {
      throw new Error(`${fieldTypeLabel(item.fieldType)} item "${label}" needs at least one option.`);
    }

    payloadItems.push({
      id: item.id,
      key,
      groupTitle: effectiveGroup(item),
      label,
      helperText: item.helperText.trim() || null,
      fieldType: item.fieldType,
      allowOther: item.fieldType === "MULTI_SELECT" ? item.allowOther : undefined,
      sortOrder: payloadItems.length + 1,
      isRequired: item.isRequired,
      isActive: itemIsActive,
      isDefectTrigger: item.isDefectTrigger,
      severity: item.severity,
      maintenanceCategory: item.maintenanceCategory,
      options,
      optionsJson: buildItemOptionsJson(item, options),
      showIf: item.showIf,
      imageConfig: item.fieldType === "IMAGE" ? item.imageConfig : null,
      measurementConfig: item.fieldType === "READING" ? item.measurementConfig : null,
    });
  });

  if (!payloadItems.some((item) => item.isActive)) {
    throw new Error(lastActiveItemError);
  }

  return payloadItems;
}

function fieldTypeLabel(fieldType: ChecklistFieldType) {
  return FIELD_TYPES.find((option) => option.value === fieldType)?.label ?? fieldType;
}

function buildItemOptionsJson(
  item: TemplateFormItem,
  options: ChecklistTemplateOption[],
) {
  const config: {
    version: 2;
    fieldType: ChecklistFieldType;
    options?: ChecklistTemplateOption[];
    showIf?: ChecklistShowIfConfig;
    image?: ChecklistImageConfig;
    measurement?: ChecklistMeasurementConfig;
  } = {
    version: 2,
    fieldType: item.fieldType,
  };

  if (options.length > 0) {
    config.options = options;
  }

  if (item.showIf?.dependsOn.trim()) {
    config.showIf = {
      dependsOn: item.showIf.dependsOn.trim(),
      operator: item.showIf.operator,
      value:
        item.showIf.operator === "is_empty" || item.showIf.operator === "is_not_empty"
          ? null
          : item.showIf.value?.trim() ?? "",
    };
  }

  if (item.fieldType === "IMAGE") {
    config.image = item.imageConfig;
  }

  if (item.fieldType === "READING") {
    config.measurement = item.measurementConfig;
  }

  if (!config.options && !config.showIf && !config.image && !config.measurement) {
    return null;
  }

  return config;
}

function upsertTemplate(templates: ChecklistTemplate[], updatedTemplate: ChecklistTemplate) {
  const exists = templates.some((template) => template.id === updatedTemplate.id);
  const nextTemplates = exists
    ? templates.map((template) => (template.id === updatedTemplate.id ? updatedTemplate : template))
    : [updatedTemplate, ...templates];

  return nextTemplates.sort((left, right) => {
    const assetTypeSort = (left.assetTypeName ?? left.assetType).localeCompare(
      right.assetTypeName ?? right.assetType,
      "en",
      { sensitivity: "base" },
    );

    return assetTypeSort || right.version - left.version;
  });
}

function TemplatesLoading() {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
      <div className="h-10 w-full animate-pulse rounded-md bg-slate-100" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
    </div>
  );
}

interface SortableTemplateItemCardProps {
  item: TemplateFormItem;
  index: number;
  itemCount: number;
  groups: string[];
  onUpdateItem: (itemLocalId: string, changes: Partial<TemplateFormItem>) => void;
  onRemoveItem: (itemLocalId: string) => void;
}

const SortableTemplateItemCard = memo(function SortableTemplateItemCard({
  item,
  index,
  itemCount,
  groups,
  onUpdateItem,
  onRemoveItem,
}: SortableTemplateItemCardProps) {
  const isOnlyItem = itemCount <= 1;
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.localId,
    disabled: isOnlyItem,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`min-w-0 rounded-lg border bg-white p-4 shadow-[var(--shadow-soft)] transition-[border-color,box-shadow,background-color] duration-200 ${
        isDragging
          ? "relative z-10 border-[var(--brand)] shadow-xl ring-2 ring-teal-100"
          : "border-slate-200 hover:border-slate-300 hover:shadow-[var(--shadow-card)]"
      }`}
    >
      {groups.length > 0 ? (
        <label className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">Group</span>
          <select
            value={groups.includes(item.groupTitle) ? item.groupTitle : groups[0]}
            onChange={(event) => onUpdateItem(item.localId, { groupTitle: event.target.value })}
            className="h-9 max-w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-medium text-slate-900 outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-teal-100"
          >
            {groups.map((group, groupIndex) => (
              <option key={`${group}-${groupIndex}`} value={group}>
                {group.trim() || `Group ${groupIndex + 1}`}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="grid grid-cols-12 items-end gap-3">
        <div className="col-span-12 min-w-0 sm:col-span-6 md:col-span-2 xl:col-span-2">
          <span className="text-xs font-semibold text-slate-500">Order</span>
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              ref={setActivatorNodeRef}
              disabled={isOnlyItem}
              className="inline-flex h-10 w-10 shrink-0 cursor-grab touch-none items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:border-[var(--brand)] hover:text-[var(--brand)] active:cursor-grabbing disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              aria-label={`Drag checklist item ${index + 1}`}
              title="Drag to reorder"
              {...attributes}
              {...listeners}
            >
              <GripVertical size={18} />
            </button>
            <span className="inline-flex h-10 min-w-10 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-600">
              {index + 1}
            </span>
          </div>
        </div>

        <label className="col-span-12 block min-w-0 md:col-span-6 xl:col-span-4">
          <span className="text-sm font-semibold text-slate-700">Label</span>
          <input
            type="text"
            value={item.label}
            onChange={(event) => {
              const nextLabel = event.target.value;
              onUpdateItem(item.localId, {
                label: nextLabel,
                ...(item.keyTouched ? {} : { key: itemKeyFromLabel(nextLabel) }),
              });
            }}
            className={`${inputClassName} mt-1.5`}
            maxLength={255}
            required={isFormItemActive(item)}
          />
        </label>

        <label className="col-span-12 block min-w-0">
          <span className="text-sm font-semibold text-slate-700">Hint / expected answer</span>
          <input
            type="text"
            value={item.helperText}
            onChange={(event) => onUpdateItem(item.localId, { helperText: event.target.value })}
            className={`${inputClassName} mt-1.5`}
            maxLength={500}
            placeholder="Shown under this field on the inspector's form — e.g. Measure in metres, e.g. 5.8"
          />
          <span className="mt-1.5 block text-xs text-slate-500">
            Optional guidance for the inspector. Pure hint — doesn't affect PASS/FAIL or the recorded answer.
          </span>
        </label>

        <label className="col-span-12 block min-w-0 sm:col-span-6 md:col-span-3 xl:col-span-3">
          <span className="text-sm font-semibold text-slate-700">Item Key</span>
          <input
            type="text"
            value={item.key}
            onChange={(event) =>
              onUpdateItem(item.localId, {
                key: normalizeEditableItemKey(event.target.value),
                keyTouched: true,
              })
            }
            className={`${inputClassName} mt-1.5 font-mono`}
            maxLength={100}
            required={isFormItemActive(item)}
          />
        </label>

        <label className="col-span-12 block min-w-0 sm:col-span-6 md:col-span-4 xl:col-span-2">
          <span className="text-sm font-semibold text-slate-700">Field Type</span>
          <select
            value={item.fieldType}
            onChange={(event) =>
              onUpdateItem(item.localId, {
                fieldType: event.target.value as ChecklistFieldType,
              })
            }
            className={`${inputClassName} mt-1.5`}
          >
            {FIELD_TYPES.map((fieldType) => (
              <option key={fieldType.value} value={fieldType.value}>
                {fieldType.label}
              </option>
            ))}
          </select>
        </label>

        <div className="col-span-12 grid min-w-0 grid-cols-1 items-end gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:col-span-4 xl:grid-cols-[repeat(3,minmax(8.25rem,1fr))_minmax(7.5rem,auto)]">
          <label className="inline-flex h-10 min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={item.isRequired}
              onChange={(event) => onUpdateItem(item.localId, { isRequired: event.target.checked })}
              className="h-4 w-4 shrink-0 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
            />
            <span className="whitespace-nowrap">Required</span>
          </label>

          <label className="inline-flex h-10 min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={item.isDefectTrigger}
              onChange={(event) =>
                onUpdateItem(item.localId, {
                  isDefectTrigger: event.target.checked,
                  severity: item.severity ?? "MEDIUM",
                })
              }
              className="h-4 w-4 shrink-0 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
            />
            <span className="whitespace-nowrap">Defect Trigger</span>
          </label>

          <label className="inline-flex h-10 min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={isFormItemActive(item)}
              onChange={(event) => onUpdateItem(item.localId, { isActive: event.target.checked })}
              className="h-4 w-4 shrink-0 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
            />
            <span className="whitespace-nowrap">Active</span>
          </label>

          <button
            type="button"
            onClick={() => onRemoveItem(item.localId)}
            className="inline-flex h-10 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition hover:bg-red-50"
          >
            <Trash2 size={14} className="shrink-0" />
            {item.id && isFormItemActive(item) ? "Deactivate" : "Remove"}
          </button>
        </div>
      </div>

      {item.isDefectTrigger ? (
        <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <label className="block min-w-0 sm:max-w-xs">
              <span className="text-sm font-semibold text-slate-700">Severity</span>
              <select
                value={item.severity}
                onChange={(event) =>
                  onUpdateItem(item.localId, {
                    severity: event.target.value as DefectSeverity,
                  })
                }
                className={`${inputClassName} mt-1.5`}
              >
                {DEFECT_SEVERITY_OPTIONS.map((severity) => (
                  <option key={severity.value} value={severity.value}>
                    {severity.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0 sm:max-w-xs">
              <span className="text-sm font-semibold text-slate-700">Work-type</span>
              <select
                value={item.maintenanceCategory ?? ""}
                onChange={(event) =>
                  onUpdateItem(item.localId, {
                    maintenanceCategory:
                      (event.target.value || null) as MaintenanceCategory | null,
                  })
                }
                className={`${inputClassName} mt-1.5`}
              >
                <option value="">Selenggaraan (default)</option>
                <option value="RENTIS">Rentis</option>
                <option value="CAT_TIANG">Cat tiang</option>
              </select>
            </label>
          </div>
          <div className="flex min-h-10 items-center">
            <SeverityBadge severity={item.severity} />
          </div>
        </div>
      ) : null}

      {item.fieldType === "DROPDOWN" || item.fieldType === "MULTI_SELECT" ? (
        <label className="mt-3 block min-w-0">
          <span className="text-sm font-semibold text-slate-700">
            {item.fieldType === "MULTI_SELECT" ? "Multi Select Options" : "Dropdown Options"}
          </span>
          <textarea
            value={item.optionsText}
            onChange={(event) => onUpdateItem(item.localId, { optionsText: event.target.value })}
            className={`${textareaClassName} mt-1.5`}
            placeholder={"A - Super Critical | A | defect | CRITICAL\nB - Critical | B | defect | HIGH\nC - Minor | C | defect | LOW"}
          />
          <span className="mt-1.5 block text-xs text-slate-500">
            One option per line: <code>Label | value | prefix</code>. Append{" "}
            <code>| defect</code> to flag an option as a defect (records FAIL and
            creates a defect when chosen) — works for any language. To set that
            defect&apos;s severity per option, add a level after it —{" "}
            <code>| CRITICAL</code> / <code>HIGH</code> / <code>MEDIUM</code> /{" "}
            <code>LOW</code> (e.g. KUANTAN&apos;s{" "}
            <code>A - Super Critical | A | defect | CRITICAL</code>); without one
            the item&apos;s default severity is used. Prefix is optional.
          </span>
        </label>
      ) : null}

      {item.fieldType === "MULTI_SELECT" ? (
        <label className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={item.allowOther}
            onChange={(event) => onUpdateItem(item.localId, { allowOther: event.target.checked })}
            className="h-4 w-4 shrink-0 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
          />
          <span className="whitespace-nowrap">Allow &quot;Other&quot; (free text)</span>
        </label>
      ) : null}

      {item.fieldType === "IMAGE" ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {(
            [
              ["requiredPhoto", "Required photo"],
              ["allowMultiplePhotos", "Allow multiple photos"],
              ["cameraOnly", "Camera only"],
              ["galleryAllowed", "Gallery allowed"],
              ["timestampOverlayRequired", "Timestamp overlay required"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700"
            >
              <input
                type="checkbox"
                checked={item.imageConfig[key]}
                onChange={(event) =>
                  onUpdateItem(item.localId, {
                    imageConfig: {
                      ...item.imageConfig,
                      [key]: event.target.checked,
                    },
                  })
                }
                className="h-4 w-4 shrink-0 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
              />
              <span className="whitespace-normal leading-snug">{label}</span>
            </label>
          ))}
        </div>
      ) : null}

      {item.fieldType === "READING" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(8rem,0.45fr)_minmax(12rem,0.65fr)_minmax(10rem,0.45fr)]">
          <label className="block min-w-0">
            <span className="text-sm font-semibold text-slate-700">Unit</span>
            <input
              type="text"
              value={item.measurementConfig.unit ?? ""}
              onChange={(event) =>
                onUpdateItem(item.localId, {
                  measurementConfig: {
                    ...item.measurementConfig,
                    unit: event.target.value,
                  },
                })
              }
              className={`${inputClassName} mt-1.5`}
              maxLength={50}
              placeholder="m"
            />
          </label>
          <label className="block min-w-0">
            <span className="text-sm font-semibold text-slate-700">Source</span>
            <select
              value={item.measurementConfig.source}
              onChange={(event) =>
                onUpdateItem(item.localId, {
                  measurementConfig: {
                    ...item.measurementConfig,
                    source: event.target.value as ChecklistMeasurementConfig["source"],
                  },
                })
              }
              className={`${inputClassName} mt-1.5`}
            >
              <option value="manual">Manual</option>
              <option value="photo_ocr_future">Photo OCR future</option>
            </select>
          </label>
          <label className="mt-6 inline-flex h-10 min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 sm:mt-7">
            <input
              type="checkbox"
              checked={item.measurementConfig.requiresImage}
              onChange={(event) =>
                onUpdateItem(item.localId, {
                  measurementConfig: {
                    ...item.measurementConfig,
                    requiresImage: event.target.checked,
                  },
                })
              }
              className="h-4 w-4 shrink-0 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
            />
            <span className="whitespace-nowrap">Requires image</span>
          </label>
        </div>
      ) : null}

      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="grid gap-3 md:grid-cols-[minmax(12rem,1fr)_minmax(11rem,0.75fr)_minmax(12rem,1fr)_auto] md:items-end">
          <label className="block min-w-0">
            <span className="text-sm font-semibold text-slate-700">Show If Depends On</span>
            <input
              type="text"
              value={item.showIf?.dependsOn ?? ""}
              onChange={(event) =>
                onUpdateItem(item.localId, {
                  showIf: {
                    dependsOn: event.target.value,
                    operator: item.showIf?.operator ?? "equals",
                    value: item.showIf?.value ?? "",
                  },
                })
              }
              className={`${inputClassName} mt-1.5`}
              placeholder="tiang_reput_retak"
            />
          </label>
          <label className="block min-w-0">
            <span className="text-sm font-semibold text-slate-700">Operator</span>
            <select
              value={item.showIf?.operator ?? "equals"}
              onChange={(event) =>
                onUpdateItem(item.localId, {
                  showIf: {
                    dependsOn: item.showIf?.dependsOn ?? "",
                    operator: event.target.value as ChecklistShowIfOperator,
                    value:
                      event.target.value === "is_empty" || event.target.value === "is_not_empty"
                        ? null
                        : item.showIf?.value ?? "",
                  },
                })
              }
              className={`${inputClassName} mt-1.5`}
            >
              {SHOW_IF_OPERATORS.map((operator) => (
                <option key={operator.value} value={operator.value}>
                  {operator.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="text-sm font-semibold text-slate-700">Value</span>
            <input
              type="text"
              value={item.showIf?.value ?? ""}
              onChange={(event) =>
                onUpdateItem(item.localId, {
                  showIf: {
                    dependsOn: item.showIf?.dependsOn ?? "",
                    operator: item.showIf?.operator ?? "equals",
                    value: event.target.value,
                  },
                })
              }
              className={`${inputClassName} mt-1.5`}
              disabled={
                item.showIf?.operator === "is_empty" ||
                item.showIf?.operator === "is_not_empty"
              }
              placeholder="YES"
            />
          </label>
          <button
            type="button"
            onClick={() => onUpdateItem(item.localId, { showIf: null })}
            className={`${rowActionButtonClassName} md:mb-0`}
          >
            <X size={14} />
            Clear
          </button>
        </div>
      </div>
    </div>
  );
});

function TemplateFormModal({
  mode,
  values,
  assetTypes,
  capabilities,
  organizations,
  operationalRegions,
  branches,
  mainheads,
  selectedTemplate,
  error,
  isSaving,
  onChange,
  onClose,
  onError,
  onSubmit,
}: {
  mode: ModalMode;
  values: TemplateFormState;
  assetTypes: AssetType[];
  capabilities: EnterpriseOptionRecord[];
  organizations: EnterpriseOptionRecord[];
  operationalRegions: EnterpriseOptionRecord[];
  branches: EnterpriseOptionRecord[];
  mainheads: EnterpriseOptionRecord[];
  selectedTemplate: ChecklistTemplate | null;
  error: string;
  isSaving: boolean;
  onChange: Dispatch<SetStateAction<TemplateFormState>>;
  onClose: () => void;
  onError: Dispatch<SetStateAction<string>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const isCreateMode = mode === "create";
  const selectedStatus = selectedTemplate ? resolveTemplateStatus(selectedTemplate) : "DRAFT";
  const selectedStatusMeta = STATUS_META[selectedStatus];
  const itemIds = useMemo(() => values.items.map((item) => item.localId), [values.items]);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const activeItemCount = useMemo(() => activeFormItemCount(values.items), [values.items]);
  const activeOrganizations = useMemo(
    () => organizations.filter((organization) => organization.isActive !== false),
    [organizations],
  );
  const activeBranches = useMemo(
    () => branches.filter((branch) => branch.isActive !== false),
    [branches],
  );
  const activeOperationalRegions = useMemo(
    () => operationalRegions.filter((region) => region.isActive !== false),
    [operationalRegions],
  );
  const activeMainheads = useMemo(
    () => mainheads.filter((mainhead) => mainhead.isActive !== false),
    [mainheads],
  );
  const clearModalError = useCallback(() => {
    if (error) {
      onError("");
    }
  }, [error, onError]);
  const updateFormValues = useCallback(
    (updater: SetStateAction<TemplateFormState>) => {
      clearModalError();
      onChange(updater);
    },
    [clearModalError, onChange],
  );

  const updateItem = useCallback(
    (itemLocalId: string, changes: Partial<TemplateFormItem>) => {
      const item = values.items.find((entry) => entry.localId === itemLocalId);

      if (
        item &&
        changes.isActive === false &&
        isFormItemActive(item) &&
        activeItemCount <= 1
      ) {
        onError(lastActiveItemError);
        return;
      }

      updateFormValues((currentValues) => ({
        ...currentValues,
        items: currentValues.items.map((item) =>
          item.localId === itemLocalId ? { ...item, ...changes } : item,
        ),
      }));
    },
    [activeItemCount, onError, updateFormValues, values.items],
  );

  const addItem = useCallback(() => {
    updateFormValues((currentValues) => ({
      ...currentValues,
      items: [...currentValues.items, createBlankItem()],
    }));
  }, [updateFormValues]);

  const addGroup = useCallback(() => {
    updateFormValues((currentValues) => {
      // Pick the next unused "Group N" so removing a middle group then adding can't
      // produce a colliding auto-name.
      const existing = new Set(currentValues.groups.map((group) => group.trim()));
      let next = currentValues.groups.length + 1;
      while (existing.has(`Group ${next}`)) {
        next += 1;
      }
      return { ...currentValues, groups: [...currentValues.groups, `Group ${next}`] };
    });
  }, [updateFormValues]);

  const renameGroup = useCallback(
    (index: number, title: string) => {
      updateFormValues((currentValues) => {
        const previous = currentValues.groups[index];
        const groups = currentValues.groups.map((group, groupIndex) =>
          groupIndex === index ? title : group,
        );
        // Keep items pointed at the renamed group.
        const items =
          previous === undefined
            ? currentValues.items
            : currentValues.items.map((item) =>
                item.groupTitle === previous ? { ...item, groupTitle: title } : item,
              );

        return { ...currentValues, groups, items };
      });
    },
    [updateFormValues],
  );

  const removeGroup = useCallback(
    (index: number) => {
      updateFormValues((currentValues) => {
        const removed = currentValues.groups[index];
        const groups = currentValues.groups.filter((_, groupIndex) => groupIndex !== index);
        const fallback = groups[0] ?? "";
        // Items orphaned by the removed group fall back to the first remaining group
        // (or "" when the last group is removed → ungrouped again).
        const items = currentValues.items.map((item) =>
          item.groupTitle === removed ? { ...item, groupTitle: fallback } : item,
        );

        return { ...currentValues, groups, items };
      });
    },
    [updateFormValues],
  );

  const moveGroup = useCallback(
    (index: number, direction: -1 | 1) => {
      updateFormValues((currentValues) => {
        const target = index + direction;

        if (target < 0 || target >= currentValues.groups.length) {
          return currentValues;
        }

        return { ...currentValues, groups: arrayMove(currentValues.groups, index, target) };
      });
    },
    [updateFormValues],
  );

  const removeItem = useCallback(
    (itemLocalId: string) => {
      const item = values.items.find((entry) => entry.localId === itemLocalId);

      if (!item) {
        return;
      }

      if (isFormItemActive(item) && activeItemCount <= 1) {
        onError(lastActiveItemError);
        return;
      }

      updateFormValues((currentValues) => {
        if (item.id && isFormItemActive(item)) {
          return {
            ...currentValues,
            items: currentValues.items.map((entry) =>
              entry.localId === itemLocalId ? { ...entry, isActive: false } : entry,
            ),
          };
        }

        const nextItems = currentValues.items.filter((entry) => entry.localId !== itemLocalId);

        return {
          ...currentValues,
          items: nextItems.length > 0 ? nextItems : [createBlankItem()],
        };
      });
    },
    [activeItemCount, onError, updateFormValues, values.items],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (!over || active.id === over.id) {
        return;
      }

      updateFormValues((currentValues) => {
        const activeId = String(active.id);
        const overId = String(over.id);
        const oldIndex = currentValues.items.findIndex((item) => item.localId === activeId);
        const newIndex = currentValues.items.findIndex((item) => item.localId === overId);

        if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
          return currentValues;
        }

        return {
          ...currentValues,
          items: arrayMove(currentValues.items, oldIndex, newIndex),
        };
      });
    },
    [updateFormValues],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--scrim)] px-4 py-6">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-[var(--shadow-card)]">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-col">
          <div className="sticky top-0 z-20 border-b border-slate-200 bg-white">
            <div className="flex items-start justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold uppercase text-[var(--brand)]">
                    {isCreateMode ? "New Checklist Template" : `Template v${selectedTemplate?.version ?? ""}`}
                  </p>
                  {!isCreateMode && selectedTemplate ? <StatusBadge status={selectedStatus} /> : null}
                </div>
                <h2 className="mt-1 text-lg font-bold text-slate-900">
                  {isCreateMode ? "Create Template Draft" : "Edit Checklist Template"}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
                aria-label="Close checklist template modal"
              >
                <X size={17} />
              </button>
            </div>

            <div className="space-y-4 px-5 pb-5">
              {error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              {!isCreateMode && selectedTemplate ? (
                <div className={`rounded-lg border px-3 py-2 text-sm ${selectedStatusMeta.panelClassName}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={selectedStatus} />
                    <span className="font-semibold">Version {selectedTemplate.version}</span>
                    <span className="text-xs">
                      {selectedTemplate.assetTypeCode ?? selectedTemplate.assetType}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5">{selectedStatusMeta.modalDescription}</p>
                </div>
              ) : null}

              {!isCreateMode && selectedStatus !== "DRAFT" ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Saving structure changes to a used active or archived template creates a new draft version.
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.9fr)_minmax(220px,0.9fr)_minmax(260px,1.1fr)_auto] lg:items-end">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Asset Type</span>
                  <select
                    value={values.assetTypeId}
                    onChange={(event) => {
                      const nextAssetTypeId = event.target.value;
                      const nextAssetType = assetTypes.find(
                        (assetType) => assetType.id === nextAssetTypeId,
                      );

                      updateFormValues((currentValues) => ({
                        ...currentValues,
                        assetTypeId: nextAssetTypeId,
                        capabilityId: nextAssetType?.capabilityId ?? "",
                      }));
                    }}
                    className={`${inputClassName} mt-1.5`}
                    disabled={!isCreateMode}
                    required
                  >
                    <option value="">Choose asset type</option>
                    {assetTypes.map((assetType) => (
                      <option key={assetType.id} value={assetType.id}>
                        {assetType.code} - {assetType.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Capability</span>
                  <select
                    value={values.capabilityId}
                    onChange={(event) =>
                      updateFormValues((currentValues) => ({
                        ...currentValues,
                        capabilityId: event.target.value,
                      }))
                    }
                    className={`${inputClassName} mt-1.5`}
                  >
                    <option value="">Use asset type capability</option>
                    {capabilities.map((capability) => (
                      <option key={capability.id} value={capability.id}>
                        {capability.code ? `${capability.code} - ${capability.name}` : capability.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Template Name</span>
                  <input
                    type="text"
                    value={values.name}
                    onChange={(event) =>
                      updateFormValues((currentValues) => ({
                        ...currentValues,
                        name: event.target.value,
                      }))
                    }
                    className={`${inputClassName} mt-1.5`}
                    required
                    maxLength={255}
                  />
                </label>

                <button
                  type="button"
                  onClick={addItem}
                  className={`${secondaryButtonClassName} w-full lg:w-auto`}
                >
                  <Plus size={16} />
                  Add Item
                </button>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Scope Level</span>
                  <select
                    value={values.scopeLevel}
                    onChange={(event) => {
                      const scopeLevel = event.target.value as ChecklistTemplateScopeLevel;

                      updateFormValues((currentValues) => ({
                        ...currentValues,
                        scopeLevel,
                        organizationId: scopeLevel === "ORGANIZATION" ? currentValues.organizationId : "",
                        operationalRegionId:
                          scopeLevel === "OPERATIONAL_REGION"
                            ? currentValues.operationalRegionId
                            : "",
                        branchId: scopeLevel === "BRANCH" ? currentValues.branchId : "",
                        mainheadId: scopeLevel === "MAINHEAD" ? currentValues.mainheadId : "",
                      }));
                    }}
                    className={`${inputClassName} mt-1.5`}
                  >
                    {SCOPE_LEVEL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                {values.scopeLevel === "ORGANIZATION" ? (
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Organization</span>
                    <select
                      value={values.organizationId}
                      onChange={(event) =>
                        updateFormValues((currentValues) => ({
                          ...currentValues,
                          organizationId: event.target.value,
                        }))
                      }
                      className={`${inputClassName} mt-1.5`}
                      required
                    >
                      <option value="">Choose organization</option>
                      {activeOrganizations.map((organization) => (
                        <option key={organization.id} value={organization.id}>
                          {optionDisplayName(organization)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {values.scopeLevel === "OPERATIONAL_REGION" ? (
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Region</span>
                    <select
                      value={values.operationalRegionId}
                      onChange={(event) =>
                        updateFormValues((currentValues) => ({
                          ...currentValues,
                          operationalRegionId: event.target.value,
                        }))
                      }
                      className={`${inputClassName} mt-1.5`}
                      required
                    >
                      <option value="">Choose region</option>
                      {activeOperationalRegions.map((region) => (
                        <option key={region.id} value={region.id}>
                          {optionDisplayName(region)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {values.scopeLevel === "BRANCH" ? (
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Branch</span>
                    <select
                      value={values.branchId}
                      onChange={(event) =>
                        updateFormValues((currentValues) => ({
                          ...currentValues,
                          branchId: event.target.value,
                        }))
                      }
                      className={`${inputClassName} mt-1.5`}
                      required
                    >
                      <option value="">Choose branch</option>
                      {activeBranches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {optionDisplayName(branch)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {values.scopeLevel === "MAINHEAD" ? (
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">MAINHEAD</span>
                    <select
                      value={values.mainheadId}
                      onChange={(event) =>
                        updateFormValues((currentValues) => ({
                          ...currentValues,
                          mainheadId: event.target.value,
                        }))
                      }
                      className={`${inputClassName} mt-1.5`}
                      required
                    >
                      <option value="">Choose MAINHEAD</option>
                      {activeMainheads.map((mainhead) => (
                        <option key={mainhead.id} value={mainhead.id}>
                          {optionDisplayName(mainhead)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            </div>
          </div>

          <div className="space-y-5 px-5 py-5">
            <section className="min-w-0 rounded-xl border border-slate-200 bg-slate-50">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900">Groups</h3>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    Optional. Split the checklist into named groups — on mobile the crew
                    fills one group at a time. No groups = a single list (as before).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addGroup}
                  className={`${secondaryButtonClassName} w-full sm:w-auto`}
                >
                  <Plus size={16} />
                  Add Group
                </button>
              </div>
              {values.groups.length > 0 ? (
                <div className="space-y-2 p-4">
                  {values.groups.map((group, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="inline-flex h-10 min-w-10 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-xs font-bold text-slate-600">
                        {index + 1}
                      </span>
                      <input
                        type="text"
                        value={group}
                        onChange={(event) => renameGroup(index, event.target.value)}
                        placeholder={`Group ${index + 1}`}
                        className={`${inputClassName} min-w-0 flex-1`}
                      />
                      <button
                        type="button"
                        onClick={() => moveGroup(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move ${group || `group ${index + 1}`} up`}
                        title="Move up"
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300"
                      >
                        <ChevronUp size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveGroup(index, 1)}
                        disabled={index === values.groups.length - 1}
                        aria-label={`Move ${group || `group ${index + 1}`} down`}
                        title="Move down"
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300"
                      >
                        <ChevronDown size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeGroup(index)}
                        aria-label={`Remove ${group || `group ${index + 1}`}`}
                        title="Remove group"
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-4 py-3 text-xs text-[var(--muted)]">
                  No groups yet — the checklist shows as one list. Add a group to organize
                  items into sections, then pick a group on each item below.
                </p>
              )}
            </section>

            <section className="min-w-0 rounded-xl border border-slate-200 bg-slate-50">
              <div className="border-b border-slate-200 bg-white px-4 py-3">
                <h3 className="text-sm font-bold text-slate-900">Checklist Items</h3>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  Active rows are shown to field users when this version is activated.
                </p>
              </div>

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
                  <div className="space-y-3 p-4">
                    {values.items.map((item, index) => (
                      <SortableTemplateItemCard
                        key={item.localId}
                        item={item}
                        index={index}
                        itemCount={values.items.length}
                        groups={values.groups}
                        onUpdateItem={updateItem}
                        onRemoveItem={removeItem}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              <div className="flex border-t border-slate-200 bg-white px-4 py-3">
                <button
                  type="button"
                  onClick={addItem}
                  className={`${secondaryButtonClassName} w-full sm:w-auto`}
                >
                  <Plus size={16} />
                  Add Item
                </button>
              </div>
            </section>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={onClose} className={secondaryButtonClassName}>
                Cancel
              </button>
              <button type="submit" disabled={isSaving} className={primaryButtonClassName}>
                <CheckCircle2 size={16} />
                {isSaving ? "Saving" : isCreateMode ? "Create Draft" : "Save Changes"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function DuplicateTemplateModal({
  template,
  error,
  isDuplicating,
  onClose,
  onConfirm,
}: {
  template: ChecklistTemplate;
  error: string;
  isDuplicating: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const sourceLabel = templateVersionLabel(template);
  const sourceStatus = resolveTemplateStatus(template);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--scrim)] px-4 py-6">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-[var(--shadow-card)]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-[var(--brand)]">
              Duplicate Template
            </p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">
              Create a duplicate draft from {sourceLabel}?
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isDuplicating}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            aria-label="Close duplicate template modal"
          >
            <X size={17} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={sourceStatus} />
              <span className="text-sm font-semibold text-slate-900">{template.name}</span>
            </div>
            <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <div className="text-xs font-semibold uppercase text-slate-500">New status</div>
                <div className="mt-1">
                  <StatusBadge status="DRAFT" />
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-slate-500">Suggested name</div>
                <div className="mt-1 font-semibold text-slate-900">
                  {duplicateTemplateNamePreview(template)}
                </div>
              </div>
            </div>
          </div>

          <p className="text-sm leading-6 text-[var(--muted)]">
            The duplicate will be editable and inactive with the same scope. Existing inspections and active templates stay unchanged.
          </p>

          <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={isDuplicating}
              className={secondaryButtonClassName}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isDuplicating}
              className={primaryButtonClassName}
            >
              <Copy size={16} />
              {isDuplicating ? "Duplicating" : "Create Draft"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChecklistTemplatesContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([]);
  const [capabilities, setCapabilities] = useState<EnterpriseOptionRecord[]>([]);
  const [organizations, setOrganizations] = useState<EnterpriseOptionRecord[]>([]);
  const [operationalRegions, setOperationalRegions] = useState<EnterpriseOptionRecord[]>([]);
  const [branches, setBranches] = useState<EnterpriseOptionRecord[]>([]);
  const [mainheads, setMainheads] = useState<EnterpriseOptionRecord[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [actionTemplateId, setActionTemplateId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [assetTypeFilter, setAssetTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<ChecklistTemplate | null>(null);
  const [duplicateTemplate, setDuplicateTemplate] = useState<ChecklistTemplate | null>(null);
  const [duplicateError, setDuplicateError] = useState("");
  const [highlightedTemplateId, setHighlightedTemplateId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<TemplateFormState>(defaultForm());
  const [modalError, setModalError] = useState("");

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadData = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");

      try {
        const [nextAssetTypes, nextTemplates, options] = await Promise.all([
          fetchAssetTypes(token),
          fetchChecklistTemplates(token),
          fetchEnterpriseOptions(token),
        ]);
        setAssetTypes(nextAssetTypes);
        setTemplates(nextTemplates);
        setCapabilities(options.capabilities.filter((capability) => capability.isActive !== false));
        setOrganizations(options.organizations);
        setOperationalRegions(options.operationalRegions);
        setBranches(options.branches);
        setMainheads(options.mainheads);
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }

        if (loadError instanceof ApiError && loadError.status === 403) {
          setError("ADMIN role is required to manage checklist templates.");
          return;
        }

        setError(requestErrorMessage(loadError, "Unable to load checklist templates."));
      } finally {
        setIsLoading(false);
      }
    },
    [handleLogout],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);

    if (!storedSession?.token) {
      setIsLoading(false);
      return;
    }

    if (storedSession.user && storedSession.user.role !== "ADMIN") {
      setError("ADMIN role is required to manage checklist templates.");
      setIsLoading(false);
      return;
    }

    void loadData(storedSession.token);
  }, [loadData]);

  const filteredTemplates = useMemo(() => {
    const normalizedSearch = normalizeSearchText(search);

    return templates
      .filter((template) => {
        const templateStatus = resolveTemplateStatus(template);
        const matchesAssetType =
          assetTypeFilter === "ALL" || template.assetTypeId === assetTypeFilter;
        const matchesStatus = statusFilter === "ALL" || templateStatus === statusFilter;
        const matchesSearch =
          !normalizedSearch ||
          [
            template.name,
            template.assetType,
            template.assetTypeCode,
            template.assetTypeName,
            template.capability?.name,
            template.capability?.code,
            templateScopeLabel(template),
            templateStatus,
            `v${template.version}`,
          ].some((value) => normalizeSearchText(value).includes(normalizedSearch));

        return matchesAssetType && matchesStatus && matchesSearch;
      })
      .sort((left, right) => {
        const assetTypeSort = (left.assetTypeName ?? left.assetType).localeCompare(
          right.assetTypeName ?? right.assetType,
          "en",
          { sensitivity: "base" },
        );

        return assetTypeSort || right.version - left.version;
      });
  }, [assetTypeFilter, search, statusFilter, templates]);

  const isAdmin = session?.user?.role === "ADMIN";
  const activeCount = templates.filter((template) => resolveTemplateStatus(template) === "ACTIVE").length;
  const draftCount = templates.filter((template) => resolveTemplateStatus(template) === "DRAFT").length;
  const archivedCount = templates.filter((template) => resolveTemplateStatus(template) === "ARCHIVED").length;

  function resetFilters() {
    setSearch("");
    setAssetTypeFilter("ALL");
    setStatusFilter("ALL");
  }

  function openCreateModal() {
    const defaultAssetTypeId = assetTypeFilter !== "ALL" ? assetTypeFilter : assetTypes[0]?.id ?? "";
    const defaultAssetType = assetTypes.find((assetType) => assetType.id === defaultAssetTypeId);

    setSelectedTemplate(null);
    setFormValues(defaultForm(defaultAssetTypeId, defaultAssetType?.capabilityId ?? ""));
    setModalError("");
    setModalMode("create");
  }

  function openEditModal(template: ChecklistTemplate) {
    const items = [...template.items]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map(formItemFromTemplateItem);

    const loadedGroups = [...(template.groups ?? [])]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((group) => group.title);
    // A lone default "Checklist Items" section is the ungrouped case — keep the
    // editor groupless so existing templates look exactly as before.
    const groups =
      loadedGroups.length <= 1 &&
      (loadedGroups[0] ?? DEFAULT_GROUP_TITLE) === DEFAULT_GROUP_TITLE
        ? []
        : loadedGroups;

    setSelectedTemplate(template);
    setFormValues({
      assetTypeId: template.assetTypeId,
      capabilityId: template.capabilityId ?? template.capability?.id ?? "",
      scopeLevel: template.scopeLevel ?? "GLOBAL",
      organizationId: template.organizationId ?? "",
      operationalRegionId: template.operationalRegionId ?? "",
      branchId: template.branchId ?? "",
      mainheadId: template.mainheadId ?? "",
      name: template.name,
      groups,
      items: items.length > 0 ? items : [createBlankItem()],
    });
    setModalError("");
    setModalMode("edit");
  }

  function closeModal() {
    if (isSaving) {
      return;
    }

    setModalMode(null);
    setSelectedTemplate(null);
    setModalError("");
  }

  function openDuplicateModal(template: ChecklistTemplate) {
    if (!isAdmin || actionTemplateId) {
      return;
    }

    setDuplicateTemplate(template);
    setDuplicateError("");
    setError("");
    setNotice("");
  }

  function closeDuplicateModal() {
    if (duplicateTemplate && actionTemplateId === duplicateTemplate.id) {
      return;
    }

    setDuplicateTemplate(null);
    setDuplicateError("");
  }

  async function handleTemplateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.token || !modalMode) {
      return;
    }

    try {
      const trimmedName = formValues.name.trim();

      if (!formValues.assetTypeId) {
        throw new Error("Choose an asset type.");
      }

      if (!trimmedName) {
        throw new Error("Template name cannot be empty.");
      }

      const scopePayload = {
        scopeLevel: formValues.scopeLevel,
        organizationId: null as string | null,
        operationalRegionId: null as string | null,
        branchId: null as string | null,
        mainheadId: null as string | null,
      };

      if (formValues.scopeLevel === "ORGANIZATION") {
        if (!formValues.organizationId) {
          throw new Error("Choose an organization for this scoped template.");
        }

        scopePayload.organizationId = formValues.organizationId;
      }

      if (formValues.scopeLevel === "OPERATIONAL_REGION") {
        if (!formValues.operationalRegionId) {
          throw new Error("Choose a region for this scoped template.");
        }

        scopePayload.operationalRegionId = formValues.operationalRegionId;
      }

      if (formValues.scopeLevel === "BRANCH") {
        if (!formValues.branchId) {
          throw new Error("Choose a branch for this scoped template.");
        }

        scopePayload.branchId = formValues.branchId;
      }

      if (formValues.scopeLevel === "MAINHEAD") {
        if (!formValues.mainheadId) {
          throw new Error("Choose a MAINHEAD for this scoped template.");
        }

        scopePayload.mainheadId = formValues.mainheadId;
      }

      // Groups must be uniquely and non-blank named: a blank title would re-home its
      // items to the first group on save, and a duplicate would silently merge two
      // groups into one section. Block both with a clear message before saving.
      const groupTitles = formValues.groups.map((title) => title.trim());
      if (groupTitles.some((title) => title.length === 0)) {
        throw new Error("Every group needs a name.");
      }
      if (new Set(groupTitles).size !== groupTitles.length) {
        throw new Error("Group names must be unique — two groups share a title.");
      }

      const items = buildPayloadItems(formValues.items, formValues.groups);
      const groups =
        formValues.groups.length > 0
          ? formValues.groups.map((title, index) => ({
              title: title.trim() || `Group ${index + 1}`,
              sortOrder: index + 1,
            }))
          : undefined;
      setIsSaving(true);
      setModalError("");
      setNotice("");

      const savedTemplate =
        modalMode === "create"
          ? await createChecklistTemplate(session.token, {
              assetTypeId: formValues.assetTypeId,
              capabilityId: formValues.capabilityId || null,
              ...scopePayload,
              name: trimmedName,
              isActive: false,
              groups,
              items,
            })
          : selectedTemplate
            ? await updateChecklistTemplate(session.token, selectedTemplate.id, {
              capabilityId: formValues.capabilityId || null,
              ...scopePayload,
              name: trimmedName,
              groups,
              items,
            })
            : null;

      if (savedTemplate) {
        setTemplates((currentTemplates) => upsertTemplate(currentTemplates, savedTemplate));
        setNotice(
          savedTemplate.status === "DRAFT"
            ? "Template draft saved."
            : "Template saved and activated.",
        );
      }

      closeModal();
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 401) {
        handleLogout();
        return;
      }

      setModalError(requestErrorMessage(submitError, "Unable to save checklist template."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDuplicateConfirm() {
    if (!session?.token || !duplicateTemplate || actionTemplateId) {
      return;
    }

    const sourceTemplate = duplicateTemplate;

    setActionTemplateId(sourceTemplate.id);
    setDuplicateError("");
    setError("");
    setNotice("");

    try {
      const duplicatedTemplate = await duplicateChecklistTemplate(session.token, sourceTemplate.id);
      setTemplates((currentTemplates) => upsertTemplate(currentTemplates, duplicatedTemplate));
      setHighlightedTemplateId(duplicatedTemplate.id);
      setAssetTypeFilter(duplicatedTemplate.assetTypeId);
      setStatusFilter("DRAFT");
      setDuplicateTemplate(null);
      openEditModal(duplicatedTemplate);
      setNotice(
        `Draft ${templateVersionLabel(duplicatedTemplate)} created from ${templateVersionLabel(sourceTemplate)}.`,
      );
    } catch (duplicateErrorValue) {
      if (duplicateErrorValue instanceof ApiError && duplicateErrorValue.status === 401) {
        handleLogout();
        return;
      }

      setDuplicateError(requestErrorMessage(duplicateErrorValue, "Unable to duplicate template."));
    } finally {
      setActionTemplateId(null);
    }
  }

  async function handleActivate(template: ChecklistTemplate) {
    if (!session?.token || actionTemplateId) {
      return;
    }

    const confirmed = window.confirm(
      `Activate "${template.name}" v${template.version} for ${templateScopeLabel(template)}? The current active template for the same asset type, capability, and scope will be archived.`,
    );

    if (!confirmed) {
      return;
    }

    setActionTemplateId(template.id);
    setError("");
    setNotice("");

    try {
      const activatedTemplate = await activateChecklistTemplate(session.token, template.id);
      setTemplates((currentTemplates) => {
        const archivedTemplates = currentTemplates.map((entry) =>
          sameTemplateActivationScope(entry, activatedTemplate) && entry.id !== activatedTemplate.id
            ? { ...entry, status: entry.isActive ? "ARCHIVED" as ChecklistTemplateStatus : entry.status, isActive: false }
            : entry,
        );

        return upsertTemplate(archivedTemplates, activatedTemplate);
      });
      setNotice("Template activated.");
    } catch (activateError) {
      if (activateError instanceof ApiError && activateError.status === 401) {
        handleLogout();
        return;
      }

      setError(requestErrorMessage(activateError, "Unable to activate template."));
    } finally {
      setActionTemplateId(null);
    }
  }

  async function handleArchive(template: ChecklistTemplate) {
    if (!session?.token || actionTemplateId) {
      return;
    }

    const confirmed = window.confirm(
      `Archive "${template.name}" v${template.version}? Existing inspections stay linked to this version.`,
    );

    if (!confirmed) {
      return;
    }

    setActionTemplateId(template.id);
    setError("");
    setNotice("");

    try {
      const archivedTemplate = await archiveChecklistTemplate(session.token, template.id);
      setTemplates((currentTemplates) => upsertTemplate(currentTemplates, archivedTemplate));
      setNotice("Template archived.");
    } catch (archiveError) {
      if (archiveError instanceof ApiError && archiveError.status === 401) {
        handleLogout();
        return;
      }

      setError(requestErrorMessage(archiveError, "Unable to archive template."));
    } finally {
      setActionTemplateId(null);
    }
  }

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-[var(--brand)]">
                Dynamic Checklist Builder
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                Checklist Templates
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  <ShieldCheck size={14} />
                  {isAdmin ? "Admin access" : "Restricted"}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  {templates.length} versions
                </span>
                <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 shadow-[var(--shadow-soft)]">
                  {activeCount} ACTIVE
                </span>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-[var(--shadow-soft)]">
                  {draftCount} DRAFT
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-[var(--shadow-soft)]">
                  {archivedCount} ARCHIVED
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => (session?.token ? loadData(session.token) : undefined)}
                disabled={isLoading || !session?.token}
                className={secondaryButtonClassName}
              >
                <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                Refresh
              </button>
              <button
                type="button"
                onClick={openCreateModal}
                disabled={!isAdmin || assetTypes.length === 0}
                className={primaryButtonClassName}
              >
                <Plus size={16} />
                Create Template
              </button>
            </div>
          </div>

          <div className="mt-6">
            {isLoading && templates.length === 0 ? (
              <TemplatesLoading />
            ) : error && templates.length === 0 ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {error}
              </div>
            ) : (
              <section className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
                <div className="border-b border-slate-200 p-5">
                  {error ? (
                    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {error}
                    </div>
                  ) : null}
                  {notice ? (
                    <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                      {notice}
                    </div>
                  ) : null}

                  <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_repeat(2,minmax(160px,auto))_auto]">
                    <label className="relative block">
                      <span className="sr-only">Search templates</span>
                      <Search
                        size={17}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                      />
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search templates"
                        className={searchControlClassName}
                      />
                    </label>

                    <label className="block">
                      <span className="sr-only">Asset Type</span>
                      <select
                        value={assetTypeFilter}
                        onChange={(event) => setAssetTypeFilter(event.target.value)}
                        className={inputClassName}
                      >
                        <option value="ALL">All asset types</option>
                        {assetTypes.map((assetType) => (
                          <option key={assetType.id} value={assetType.id}>
                            {assetType.code} - {assetType.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="sr-only">Status</span>
                      <select
                        value={statusFilter}
                        onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                        className={inputClassName}
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <button type="button" onClick={resetFilters} className={secondaryButtonClassName}>
                      <X size={16} />
                      Reset
                    </button>
                  </div>
                </div>

                <div className="max-w-full overflow-x-auto">
                  <table className="w-full min-w-[1120px] table-fixed text-left text-sm">
                    <colgroup>
                      <col className="w-[20%]" />
                      <col className="w-[10%]" />
                      <col className="w-[9%]" />
                      <col className="w-[10%]" />
                      <col className="w-[10%]" />
                      <col className="w-[4.5%]" />
                      <col className="w-[6.5%]" />
                      <col className="w-[8%]" />
                      <col className="w-[22%]" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                        <th className="px-4 py-3.5 font-semibold">Template</th>
                        <th className="px-3 py-3.5 font-semibold">Asset Type</th>
                        <th className="px-3 py-3.5 font-semibold">Capability</th>
                        <th className="px-3 py-3.5 font-semibold">Scope</th>
                        <th className="px-3 py-3.5 font-semibold">Status</th>
                        <th className="px-2 py-3.5 text-center font-semibold">Items</th>
                        <th className="px-2 py-3.5 text-center font-semibold">Inspections</th>
                        <th className="px-3 py-3.5 font-semibold">Updated</th>
                        <th className="px-2 py-3.5 text-right font-semibold">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredTemplates.map((template) => {
                        const isActionRunning = actionTemplateId === template.id;
                        const isAnyActionRunning = actionTemplateId !== null;
                        const isHighlighted = highlightedTemplateId === template.id;
                        const templateStatus = resolveTemplateStatus(template);
                        const isArchived = templateStatus === "ARCHIVED";

                        return (
                          <tr
                            key={template.id}
                            className={`group transition ${STATUS_META[templateStatus].rowClassName} ${
                              isHighlighted ? "outline outline-2 outline-offset-[-2px] outline-amber-300" : ""
                            }`}
                          >
                            <td className="px-4 py-3.5 align-top">
                              <div className="flex items-start gap-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500">
                                  <ClipboardList size={17} />
                                </div>
                                <div className="min-w-0">
                                  <div
                                    className={`break-words font-semibold leading-snug ${
                                      isArchived ? "text-slate-500" : "text-slate-900"
                                    }`}
                                  >
                                    {template.name}
                                  </div>
                                  <div className="mt-0.5 text-xs text-[var(--muted)]">
                                    Version {template.version}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3.5 align-top text-slate-700">
                              <div className="break-words font-semibold leading-snug text-slate-900">
                                {template.assetTypeCode ?? template.assetType}
                              </div>
                              <div className="mt-0.5 break-words text-xs leading-snug text-[var(--muted)]">
                                {template.assetTypeName ?? "Asset type"}
                              </div>
                            </td>
                            <td className="px-3 py-3.5 align-top text-slate-700">
                              <div className="break-words leading-snug">
                                {template.capability?.name ?? "Not assigned"}
                              </div>
                              {template.capability?.code ? (
                                <div className="mt-0.5 break-words text-xs leading-snug text-[var(--muted)]">
                                  {template.capability.code}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-3.5 align-top text-slate-700">
                              <ScopeBadge template={template} />
                            </td>
                            <td className="px-3 py-3.5 align-top">
                              <StatusBadge status={templateStatus} showDescription />
                            </td>
                            <td className="px-2 py-3.5 text-center align-top font-semibold text-slate-700">
                              {template.itemCount}
                            </td>
                            <td className="px-2 py-3.5 text-center align-top font-semibold text-slate-700">
                              {template.inspectionCount}
                            </td>
                            <td className="px-3 py-3.5 align-top text-xs leading-snug text-slate-600">
                              {formatCompactDate(template.updatedAt)}
                            </td>
                            <td className="px-2 py-3.5 align-top">
                              <div className="flex flex-wrap items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => openDuplicateModal(template)}
                                  disabled={!isAdmin || isAnyActionRunning}
                                  className={compactRowActionButtonClassName}
                                >
                                  <Copy size={12} />
                                  Duplicate
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditModal(template)}
                                  className={compactRowActionButtonClassName}
                                >
                                  <Pencil size={12} />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleActivate(template)}
                                  disabled={!isAdmin || templateStatus === "ACTIVE" || isActionRunning}
                                  className={compactRowActionButtonClassName}
                                >
                                  <CheckCircle2 size={12} />
                                  Activate
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleArchive(template)}
                                  disabled={!isAdmin || templateStatus === "ARCHIVED" || isActionRunning}
                                  className={compactDangerButtonClassName}
                                >
                                  <Trash2 size={12} />
                                  Archive
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {filteredTemplates.length === 0 ? (
                    <div className="border-t border-slate-100 px-5 py-12 text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
                        <ClipboardList size={20} />
                      </div>
                      <p className="mt-4 text-sm font-semibold text-slate-900">
                        No checklist templates found
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="border-t border-slate-200 px-5 py-4 text-sm text-[var(--muted)]">
                  Showing {filteredTemplates.length} of {templates.length}
                </div>
              </section>
            )}
          </div>
        </div>
      </main>

      {modalMode ? (
        <TemplateFormModal
          mode={modalMode}
          values={formValues}
          assetTypes={assetTypes}
          capabilities={capabilities}
          organizations={organizations}
          operationalRegions={operationalRegions}
          branches={branches}
          mainheads={mainheads}
          selectedTemplate={selectedTemplate}
          error={modalError}
          isSaving={isSaving}
          onChange={setFormValues}
          onClose={closeModal}
          onError={setModalError}
          onSubmit={handleTemplateSubmit}
        />
      ) : null}

      {duplicateTemplate ? (
        <DuplicateTemplateModal
          template={duplicateTemplate}
          error={duplicateError}
          isDuplicating={actionTemplateId === duplicateTemplate.id}
          onClose={closeDuplicateModal}
          onConfirm={handleDuplicateConfirm}
        />
      ) : null}
    </AppShell>
  );
}

export function ChecklistTemplatesClient() {
  return (
    <AuthGuard>
      <ChecklistTemplatesContent />
    </AuthGuard>
  );
}
