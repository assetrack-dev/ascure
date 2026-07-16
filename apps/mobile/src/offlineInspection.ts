import type {
  Asset,
  AssetDetailResponse,
  ChecklistTemplate,
  InspectionFormResponse,
  SessionUser,
  SiteVisit,
} from './types';

// Re-group the resolved template's flat items back into their named groups so an
// offline-started inspection shows the same group cards (and per-group flow) as
// an online one. An ungrouped template collapses to a single section titled after
// the template — exactly as before. Item ids are the real server template-item
// ids (so the queued submission's templateItemIds are valid once reconciled).
function buildOfflineTemplateSections(
  template: ChecklistTemplate,
): InspectionFormResponse['template']['sections'] {
  const sortedItems = [...template.items].sort((a, b) => a.sortOrder - b.sortOrder);
  const groupTitleFor = (item: ChecklistTemplate['items'][number]) =>
    item.groupTitle?.trim() || template.name;

  const orderedTitles: string[] = [];
  const seen = new Set<string>();
  for (const item of sortedItems) {
    const title = groupTitleFor(item);
    if (!seen.has(title)) {
      seen.add(title);
      orderedTitles.push(title);
    }
  }

  return orderedTitles.map((title, index) => ({
    id: `offline-section-${template.id}-${index}`,
    title,
    description: null,
    sortOrder: index,
    items: sortedItems
      .filter((item) => groupTitleFor(item) === title)
      .map((item) => ({
        id: item.id,
        key: item.key ?? item.id,
        label: item.label,
        helperText: null,
        inputType: item.inputType ?? 'TEXT',
        isRequired: item.isRequired,
        isDefectTrigger: item.isDefectTrigger,
        severity: item.severity ?? null,
        sortOrder: item.sortOrder,
        optionsJson: item.optionsJson ?? null,
        value: null,
      })),
  }));
}

// Builds an InspectionFormResponse on-device for an inspection STARTED offline,
// so the checklist renders, validates and submits exactly as a server-issued
// form would. The shape mirrors the API serializer
// (inspections.service.ts serializeInspectionForm). Values start empty (fresh draft).
export function buildOfflineInspectionForm(params: {
  inspectionId: string;
  assetId: string;
  detail: AssetDetailResponse;
  snapshot: Asset | null;
  template: ChecklistTemplate;
  visit: SiteVisit | null;
  // The route's visit id (temp or real). Used as the siteVisitId fallback when
  // the visit cache entry is missing, so the queued submission's summary always
  // carries the correct visit id — an empty '' would break the completion-block
  // match and could drop the inspection against a completed visit.
  visitId: string;
  inspectionCycle: number;
  operationalSessionId: string | null;
  user: SessionUser;
  nowIso: string;
}): InspectionFormResponse {
  const {
    inspectionId,
    assetId,
    detail,
    snapshot,
    template,
    visit,
    visitId,
    inspectionCycle,
    operationalSessionId,
    user,
    nowIso,
  } = params;

  const resolvedVisitId = visit?.id ?? visitId;

  const assetType =
    snapshot?.assetType ??
    ({
      id: detail.assetTypeId ?? template.assetTypeId,
      code: detail.assetTypeCode ?? template.assetTypeCode ?? '',
      name: detail.assetTypeName ?? detail.assetType ?? template.assetTypeName ?? '',
    } as unknown as Asset['assetType']);

  const substation =
    snapshot?.substation ??
    (detail.substation
      ? { id: detail.substation.id, code: detail.substation.code, name: detail.substation.name }
      : { id: '', code: '', name: detail.location ?? '' });

  const team = visit?.team
    ? { id: visit.team.id, code: visit.team.code, name: visit.team.name }
    : { id: '', code: '', name: '' };

  return {
    inspection: {
      id: inspectionId,
      tenantId: user.tenantId ?? '',
      siteVisitId: resolvedVisitId,
      assetId,
      templateId: template.id,
      operationalSessionId,
      inspectionCycle,
      completionStatus: 'DRAFT',
      operationMode: visit?.operationMode ?? null,
      operationalScope: template.operationalScope ?? visit?.operationalScope ?? null,
      requiresQAQC: template.requiresQAQC ?? visit?.requiresQAQC ?? null,
      reportingGroup: visit?.reportingGroup ?? null,
      submittedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      siteVisit: {
        id: resolvedVisitId,
        status: visit?.status ?? 'ACTIVE',
        operationMode: visit?.operationMode ?? null,
        operationalScope: visit?.operationalScope ?? null,
        sessionKind: visit?.sessionKind ?? null,
        requiresQAQC: visit?.requiresQAQC ?? null,
        reportingGroup: visit?.reportingGroup ?? null,
        startedAt: visit?.startedAt ?? nowIso,
        team,
        substation: { id: substation.id, code: substation.code, name: substation.name },
      },
      asset: {
        id: assetId,
        assetCode: detail.assetCode,
        name: detail.name ?? null,
        assetType,
        substation: { id: substation.id, code: substation.code, name: substation.name },
      },
      createdBy: { id: user.id, email: user.email, name: user.name, role: user.role },
    },
    template: {
      id: template.id,
      name: template.name,
      version: template.version,
      assetTypeId: template.assetTypeId,
      capabilityId: template.capabilityId ?? null,
      scopeLevel: template.scopeLevel,
      organizationId: template.organizationId ?? null,
      branchId: template.branchId ?? null,
      mainheadId: template.mainheadId ?? null,
      operationalScope: template.operationalScope ?? null,
      requiresQAQC: template.requiresQAQC ?? null,
      sections: buildOfflineTemplateSections(template),
    },
    results: [],
    items: [],
  };
}
