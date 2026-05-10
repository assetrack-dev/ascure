import { apiRequest } from "@/lib/api";
import type {
  AssetType,
  ChecklistTemplate,
  CreateChecklistTemplatePayload,
  UpdateChecklistTemplatePayload,
} from "@/types/checklist-templates";

export function fetchAssetTypes(token: string) {
  return apiRequest<AssetType[]>("/asset-types", { token });
}

export function fetchChecklistTemplates(token: string) {
  return apiRequest<ChecklistTemplate[]>("/inspection-templates", { token });
}

export function createChecklistTemplate(token: string, payload: CreateChecklistTemplatePayload) {
  return apiRequest<ChecklistTemplate>("/inspection-templates", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export function updateChecklistTemplate(
  token: string,
  templateId: string,
  payload: UpdateChecklistTemplatePayload,
) {
  return apiRequest<ChecklistTemplate>(`/inspection-templates/${encodeURIComponent(templateId)}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(payload),
  });
}

export function activateChecklistTemplate(token: string, templateId: string) {
  return apiRequest<ChecklistTemplate>(
    `/inspection-templates/${encodeURIComponent(templateId)}/activate`,
    {
      method: "POST",
      token,
    },
  );
}

export function archiveChecklistTemplate(token: string, templateId: string) {
  return apiRequest<ChecklistTemplate>(`/inspection-templates/${encodeURIComponent(templateId)}`, {
    method: "DELETE",
    token,
  });
}
