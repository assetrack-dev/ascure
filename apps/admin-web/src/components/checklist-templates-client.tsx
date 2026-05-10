"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ClipboardList,
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
  fetchAssetTypes,
  fetchChecklistTemplates,
  updateChecklistTemplate,
} from "@/lib/checklist-templates";
import type { AuthSession } from "@/types/auth";
import type {
  AssetType,
  ChecklistFieldType,
  ChecklistTemplate,
  ChecklistTemplateItem,
  ChecklistTemplateItemPayload,
  ChecklistTemplateOption,
  ChecklistTemplateStatus,
} from "@/types/checklist-templates";

type StatusFilter = "ALL" | ChecklistTemplateStatus;
type ModalMode = "create" | "edit";

interface TemplateFormItem {
  localId: string;
  id?: string;
  label: string;
  fieldType: ChecklistFieldType;
  isRequired: boolean;
  isActive: boolean;
  isDefectTrigger: boolean;
  optionsText: string;
}

interface TemplateFormState {
  assetTypeId: string;
  name: string;
  items: TemplateFormItem[];
}

const FIELD_TYPES: Array<{ label: string; value: ChecklistFieldType }> = [
  { label: "Yes / No", value: "YES_NO" },
  { label: "Dropdown", value: "DROPDOWN" },
  { label: "Text", value: "TEXT" },
  { label: "Number", value: "NUMBER" },
  { label: "Date", value: "DATE" },
  { label: "Date & Time", value: "DATETIME" },
];
const STATUS_OPTIONS: Array<{ label: string; value: StatusFilter }> = [
  { label: "All statuses", value: "ALL" },
  { label: "Draft", value: "DRAFT" },
  { label: "Active", value: "ACTIVE" },
  { label: "Archived", value: "ARCHIVED" },
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
  "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-4 text-sm font-semibold text-white shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300";
const dangerButtonClassName =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const rowActionButtonClassName =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

function createLocalId() {
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createBlankItem(): TemplateFormItem {
  return {
    localId: createLocalId(),
    label: "",
    fieldType: "YES_NO",
    isRequired: true,
    isActive: true,
    isDefectTrigger: true,
    optionsText: "",
  };
}

function normalizeFieldType(value: string | undefined): ChecklistFieldType {
  if (value === "BOOLEAN") {
    return "YES_NO";
  }

  if (value === "SELECT") {
    return "DROPDOWN";
  }

  if (
    value === "YES_NO" ||
    value === "DROPDOWN" ||
    value === "TEXT" ||
    value === "NUMBER" ||
    value === "DATE" ||
    value === "DATETIME"
  ) {
    return value;
  }

  return "YES_NO";
}

function optionLines(options: ChecklistTemplateOption[] | undefined) {
  return (options ?? [])
    .map((option) => (option.label === option.value ? option.label : `${option.label} | ${option.value}`))
    .join("\n");
}

function formItemFromTemplateItem(item: ChecklistTemplateItem): TemplateFormItem {
  return {
    localId: item.id,
    id: item.id,
    label: item.label,
    fieldType: normalizeFieldType(item.fieldType ?? item.inputType),
    isRequired: item.isRequired,
    isActive: item.isActive,
    isDefectTrigger: item.isDefectTrigger,
    optionsText: optionLines(item.options),
  };
}

function defaultForm(assetTypeId = ""): TemplateFormState {
  return {
    assetTypeId,
    name: "",
    items: [createBlankItem()],
  };
}

function normalizeSearchText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function requestErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatDate(value: string | undefined) {
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
    year: "numeric",
  }).format(date);
}

function statusBadgeClassName(status: ChecklistTemplateStatus) {
  if (status === "ACTIVE") {
    return "border-green-200 bg-green-50 text-green-700";
  }

  if (status === "DRAFT") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-slate-200 bg-slate-50 text-slate-600";
}

function StatusBadge({ status }: { status: ChecklistTemplateStatus }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClassName(status)}`}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
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

    const [rawLabel, rawValue] = normalizedLine.split("|");
    const label = rawLabel.trim();
    const value = (rawValue ?? rawLabel).trim();

    if (!label || !value) {
      throw new Error("Dropdown options need a label and value.");
    }

    if (seenValues.has(value)) {
      throw new Error(`Dropdown option value "${value}" is duplicated.`);
    }

    options.push({ label, value });
    seenValues.add(value);
  }

  return options;
}

function buildPayloadItems(items: TemplateFormItem[]) {
  const payloadItems: ChecklistTemplateItemPayload[] = [];

  items.forEach((item, index) => {
    const label = item.label.trim();

    if (!label) {
      throw new Error("Every checklist item needs a label.");
    }

    const options = item.fieldType === "DROPDOWN" ? parseOptions(item.optionsText) : [];

    if (item.fieldType === "DROPDOWN" && options.length === 0) {
      throw new Error(`Dropdown item "${label}" needs at least one option.`);
    }

    payloadItems.push({
      id: item.id,
      label,
      fieldType: item.fieldType,
      sortOrder: index + 1,
      isRequired: item.isRequired,
      isActive: item.isActive,
      isDefectTrigger: item.isDefectTrigger,
      options,
    });
  });

  if (!payloadItems.some((item) => item.isActive)) {
    throw new Error("At least one checklist item must remain active.");
  }

  return payloadItems;
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

function TemplateFormModal({
  mode,
  values,
  assetTypes,
  selectedTemplate,
  error,
  isSaving,
  onChange,
  onClose,
  onSubmit,
}: {
  mode: ModalMode;
  values: TemplateFormState;
  assetTypes: AssetType[];
  selectedTemplate: ChecklistTemplate | null;
  error: string;
  isSaving: boolean;
  onChange: (values: TemplateFormState) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const isCreateMode = mode === "create";

  function updateItem(itemLocalId: string, changes: Partial<TemplateFormItem>) {
    onChange({
      ...values,
      items: values.items.map((item) => (item.localId === itemLocalId ? { ...item, ...changes } : item)),
    });
  }

  function moveItem(itemLocalId: string, direction: -1 | 1) {
    const currentIndex = values.items.findIndex((item) => item.localId === itemLocalId);
    const targetIndex = currentIndex + direction;

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= values.items.length) {
      return;
    }

    const nextItems = [...values.items];
    const [item] = nextItems.splice(currentIndex, 1);
    nextItems.splice(targetIndex, 0, item);
    onChange({ ...values, items: nextItems });
  }

  function removeItem(itemLocalId: string) {
    const item = values.items.find((entry) => entry.localId === itemLocalId);

    if (!item) {
      return;
    }

    if (item.id) {
      updateItem(itemLocalId, { isActive: false });
      return;
    }

    const nextItems = values.items.filter((entry) => entry.localId !== itemLocalId);
    onChange({ ...values, items: nextItems.length > 0 ? nextItems : [createBlankItem()] });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/55 px-4 py-6">
      <div className="w-full max-w-6xl rounded-xl border border-slate-200 bg-white shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--brand)]">
              {isCreateMode ? "New Checklist Template" : `Template v${selectedTemplate?.version ?? ""}`}
            </p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">
              {isCreateMode ? "Create Template Draft" : "Edit Checklist Template"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
            aria-label="Close checklist template modal"
          >
            <X size={17} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-5 px-5 py-5">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {!isCreateMode && selectedTemplate?.status !== "DRAFT" ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Saving structure changes to a used active or archived template creates a new draft version.
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-[minmax(220px,0.8fr)_minmax(260px,1fr)]">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Asset Type</span>
              <select
                value={values.assetTypeId}
                onChange={(event) => onChange({ ...values, assetTypeId: event.target.value })}
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
              <span className="text-sm font-semibold text-slate-700">Template Name</span>
              <input
                type="text"
                value={values.name}
                onChange={(event) => onChange({ ...values, name: event.target.value })}
                className={`${inputClassName} mt-1.5`}
                required
                maxLength={255}
              />
            </label>
          </div>

          <section className="min-w-0 rounded-xl border border-slate-200 bg-slate-50">
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Checklist Items</h3>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  Active rows are shown to field users when this version is activated.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onChange({ ...values, items: [...values.items, createBlankItem()] })}
                className={secondaryButtonClassName}
              >
                <Plus size={16} />
                Add Item
              </button>
            </div>

            <div className="space-y-3 p-4">
              {values.items.map((item, index) => (
                <div key={item.localId} className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-[var(--shadow-soft)]">
                  <div className="grid grid-cols-12 items-end gap-3">
                    <div className="col-span-12 min-w-0 sm:col-span-4 md:col-span-3 xl:col-span-1">
                      <span className="text-xs font-semibold text-slate-500">Order</span>
                      <div className="mt-1.5 flex gap-1">
                        <button
                          type="button"
                          onClick={() => moveItem(item.localId, -1)}
                          disabled={index === 0}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                          aria-label="Move item up"
                        >
                          <ArrowUp size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveItem(item.localId, 1)}
                          disabled={index === values.items.length - 1}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                          aria-label="Move item down"
                        >
                          <ArrowDown size={16} />
                        </button>
                      </div>
                    </div>

                    <label className="col-span-12 block min-w-0 md:col-span-6 xl:col-span-4">
                      <span className="text-sm font-semibold text-slate-700">Label</span>
                      <input
                        type="text"
                        value={item.label}
                        onChange={(event) => updateItem(item.localId, { label: event.target.value })}
                        className={`${inputClassName} mt-1.5`}
                        maxLength={255}
                        required={item.isActive}
                      />
                    </label>

                    <label className="col-span-12 block min-w-0 sm:col-span-6 md:col-span-3 xl:col-span-2">
                      <span className="text-sm font-semibold text-slate-700">Field Type</span>
                      <select
                        value={item.fieldType}
                        onChange={(event) =>
                          updateItem(item.localId, {
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

                    <div className="col-span-12 grid min-w-0 grid-cols-1 items-end gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:col-span-5 xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(7.5rem,auto)]">
                      <label className="inline-flex h-10 min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={item.isRequired}
                          onChange={(event) => updateItem(item.localId, { isRequired: event.target.checked })}
                          className="h-4 w-4 shrink-0 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
                        />
                        <span className="truncate">Required</span>
                      </label>

                      <label className="inline-flex h-10 min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={item.isDefectTrigger}
                          onChange={(event) =>
                            updateItem(item.localId, { isDefectTrigger: event.target.checked })
                          }
                          className="h-4 w-4 shrink-0 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
                        />
                        <span className="truncate">Defect</span>
                      </label>

                      <label className="inline-flex h-10 min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={item.isActive}
                          onChange={(event) => updateItem(item.localId, { isActive: event.target.checked })}
                          className="h-4 w-4 shrink-0 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
                        />
                        <span className="truncate">Active</span>
                      </label>

                      <button
                        type="button"
                        onClick={() => removeItem(item.localId)}
                        className="inline-flex h-10 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                      >
                        <Trash2 size={14} className="shrink-0" />
                        {item.id ? "Deactivate" : "Remove"}
                      </button>
                    </div>
                  </div>

                  {item.fieldType === "DROPDOWN" ? (
                    <label className="mt-3 block min-w-0">
                      <span className="text-sm font-semibold text-slate-700">Dropdown Options</span>
                      <textarea
                        value={item.optionsText}
                        onChange={(event) => updateItem(item.localId, { optionsText: event.target.value })}
                        className={`${textareaClassName} mt-1.5`}
                        placeholder="One per line. Use Label | value when the stored value differs."
                      />
                    </label>
                  ) : null}
                </div>
              ))}
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
        </form>
      </div>
    </div>
  );
}

function ChecklistTemplatesContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([]);
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
        const [nextAssetTypes, nextTemplates] = await Promise.all([
          fetchAssetTypes(token),
          fetchChecklistTemplates(token),
        ]);
        setAssetTypes(nextAssetTypes);
        setTemplates(nextTemplates);
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
        const matchesAssetType =
          assetTypeFilter === "ALL" || template.assetTypeId === assetTypeFilter;
        const matchesStatus = statusFilter === "ALL" || template.status === statusFilter;
        const matchesSearch =
          !normalizedSearch ||
          [
            template.name,
            template.assetType,
            template.assetTypeCode,
            template.assetTypeName,
            template.status,
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
  const activeCount = templates.filter((template) => template.status === "ACTIVE").length;
  const draftCount = templates.filter((template) => template.status === "DRAFT").length;

  function resetFilters() {
    setSearch("");
    setAssetTypeFilter("ALL");
    setStatusFilter("ALL");
  }

  function openCreateModal() {
    const defaultAssetTypeId = assetTypeFilter !== "ALL" ? assetTypeFilter : assetTypes[0]?.id ?? "";

    setSelectedTemplate(null);
    setFormValues(defaultForm(defaultAssetTypeId));
    setModalError("");
    setModalMode("create");
  }

  function openEditModal(template: ChecklistTemplate) {
    const items = [...template.items]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map(formItemFromTemplateItem);

    setSelectedTemplate(template);
    setFormValues({
      assetTypeId: template.assetTypeId,
      name: template.name,
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

      const items = buildPayloadItems(formValues.items);
      setIsSaving(true);
      setModalError("");
      setNotice("");

      const savedTemplate =
        modalMode === "create"
          ? await createChecklistTemplate(session.token, {
              assetType: formValues.assetTypeId,
              name: trimmedName,
              isActive: false,
              items,
            })
          : selectedTemplate
            ? await updateChecklistTemplate(session.token, selectedTemplate.id, {
                name: trimmedName,
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

  async function handleActivate(template: ChecklistTemplate) {
    if (!session?.token || actionTemplateId) {
      return;
    }

    const confirmed = window.confirm(
      `Activate "${template.name}" v${template.version}? The current active template for ${template.assetTypeName ?? template.assetType} will be archived.`,
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
          entry.assetTypeId === activatedTemplate.assetTypeId && entry.id !== activatedTemplate.id
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
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  {activeCount} active
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  {draftCount} drafts
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
              <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
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

                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                        <th className="min-w-64 px-5 py-3.5 font-semibold">Template</th>
                        <th className="whitespace-nowrap px-5 py-3.5 font-semibold">Asset Type</th>
                        <th className="whitespace-nowrap px-5 py-3.5 font-semibold">Status</th>
                        <th className="whitespace-nowrap px-5 py-3.5 font-semibold">Items</th>
                        <th className="whitespace-nowrap px-5 py-3.5 font-semibold">Inspections</th>
                        <th className="whitespace-nowrap px-5 py-3.5 font-semibold">Updated</th>
                        <th className="whitespace-nowrap px-5 py-3.5 text-right font-semibold">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredTemplates.map((template) => {
                        const isActionRunning = actionTemplateId === template.id;

                        return (
                          <tr key={template.id} className="transition hover:bg-teal-50/40">
                            <td className="px-5 py-4">
                              <div className="flex items-start gap-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500">
                                  <ClipboardList size={17} />
                                </div>
                                <div className="min-w-0">
                                  <div className="font-semibold text-slate-900">{template.name}</div>
                                  <div className="mt-0.5 text-xs text-[var(--muted)]">
                                    Version {template.version}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                              {template.assetTypeCode ?? template.assetType}
                              <div className="text-xs text-[var(--muted)]">
                                {template.assetTypeName ?? "Asset type"}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-5 py-4">
                              <StatusBadge status={template.status} />
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                              {template.itemCount}
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                              {template.inspectionCount}
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                              {formatDate(template.updatedAt)}
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex flex-wrap justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => openEditModal(template)}
                                  className={rowActionButtonClassName}
                                >
                                  <Pencil size={14} />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleActivate(template)}
                                  disabled={!isAdmin || template.status === "ACTIVE" || isActionRunning}
                                  className={rowActionButtonClassName}
                                >
                                  <CheckCircle2 size={14} />
                                  Activate
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleArchive(template)}
                                  disabled={!isAdmin || template.status === "ARCHIVED" || isActionRunning}
                                  className={dangerButtonClassName}
                                >
                                  <Trash2 size={14} />
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
          selectedTemplate={selectedTemplate}
          error={modalError}
          isSaving={isSaving}
          onChange={setFormValues}
          onClose={closeModal}
          onSubmit={handleTemplateSubmit}
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
