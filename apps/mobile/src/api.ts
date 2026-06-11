import * as FileSystem from 'expo-file-system/legacy';
import {
  Asset,
  AssetDetailResponse,
  AssetInspectionHistoryItem,
  AssetType,
  ChecklistTemplate,
  CreateChecklistTemplateInput,
  CreateAssetInput,
  DashboardData,
  DefectDetail,
  DefectEvidenceImage,
  DefectEvidenceImageUploadInput,
  DefectResolutionOutcome,
  DefectListItem,
  DefectStatus,
  EffectiveCapability,
  InspectionImage,
  InspectionImageUploadInput,
  InspectionDetail,
  InspectionFormResponse,
  LoginResponse,
  Mainhead,
  OperationMode,
  OperationalSession,
  OperationalSessionAssignedAsset,
  OperationalSessionFilters,
  OperationalScope,
  SaveInspectionItemResultInput,
  SaveInspectionResultItemInput,
  SessionKind,
  SessionUser,
  SiteVisit,
  SiteVisitImage,
  SiteVisitImageUploadInput,
  SiteVisitAssetLink,
  Team,
  Substation,
  UpdateChecklistTemplateInput,
  UpdateAssetInput,
} from './types';

const DEFAULT_API_BASE_URL = 'http://10.149.246.224:3000/api/v1';
const NETWORK_ERROR_LOG_THROTTLE_MS = 30000;

const networkErrorLogTimes = new Map<string, number>();

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  token?: string;
  body?: unknown;
};

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export function isEndpointUnavailableError(error: unknown) {
  return error instanceof ApiError && (error.status === 404 || error.status === 405);
}

async function request<T>(path: string, options: RequestOptions = {}) {
  const method = options.method ?? 'GET';
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  console.log('[API REQUEST]', { url, method });

  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    logNetworkError({ url, method, error });
    throw error;
  }

  const rawText = await response.text();
  const payload = tryParsePayload(rawText);

  console.log('[API RESPONSE]', {
    url,
    method,
    status: response.status,
    payload,
  });

  if (!response.ok) {
    throw new ApiError(extractErrorMessage(payload, response.status), response.status, payload);
  }

  return payload as T;
}

function logNetworkError({
  url,
  method,
  error,
}: {
  url: string;
  method: string;
  error: unknown;
}) {
  const key = `${method} ${url}`;
  const now = Date.now();
  const previousLogTime = networkErrorLogTimes.get(key) ?? 0;

  if (now - previousLogTime < NETWORK_ERROR_LOG_THROTTLE_MS) {
    return;
  }

  networkErrorLogTimes.set(key, now);
  console.warn('[API NETWORK ERROR]', {
    url,
    method,
    error,
  });
}

function tryParsePayload(rawText: string) {
  if (!rawText) {
    return null;
  }

  try {
    return JSON.parse(rawText);
  } catch {
    return rawText;
  }
}

function extractErrorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string' && payload.trim()) {
    return payload;
  }

  if (Array.isArray(payload)) {
    const items = payload
      .map((entry) => (typeof entry === 'string' ? entry : ''))
      .filter(Boolean);

    if (items.length > 0) {
      return items.join('\n');
    }
  }

  if (payload && typeof payload === 'object') {
    const message = 'message' in payload ? (payload as { message?: unknown }).message : undefined;
    const error = 'error' in payload ? (payload as { error?: unknown }).error : undefined;
    const missingItems =
      'missingItems' in payload ? (payload as { missingItems?: unknown }).missingItems : undefined;

    if (typeof message === 'string' && message.trim()) {
      return appendMissingItems(message, missingItems);
    }

    if (Array.isArray(message)) {
      const collected = message
        .map((entry) => (typeof entry === 'string' ? entry : ''))
        .filter(Boolean)
        .join('\n');

      if (collected) {
        return collected;
      }
    }

    if (message && typeof message === 'object') {
      return extractErrorMessage(message, status);
    }

    if (typeof error === 'string' && error.trim()) {
      return appendMissingItems(error, missingItems);
    }
  }

  if (status === 401) {
    return 'Authentication failed. Please sign in again.';
  }

  return `Request failed with status ${status}.`;
}

function appendMissingItems(baseMessage: string, missingItems: unknown) {
  if (!Array.isArray(missingItems) || missingItems.length === 0) {
    return baseMessage;
  }

  const labels = missingItems
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      const label = 'label' in item ? item.label : undefined;
      const key = 'key' in item ? item.key : undefined;

      if (typeof label === 'string' && label.trim()) {
        return label.trim();
      }

      if (typeof key === 'string' && key.trim()) {
        return key.trim();
      }

      return '';
    })
    .filter(Boolean);

  if (labels.length === 0) {
    return baseMessage;
  }

  return `${baseMessage}\nMissing: ${labels.join(', ')}`;
}

function buildQueryString(
  params: Partial<Record<keyof OperationalSessionFilters, string | undefined | null>>,
) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      query.set(key, value);
    }
  });

  const serialized = query.toString();

  return serialized ? `?${serialized}` : '';
}

export const api = {
  login(email: string, password: string) {
    return request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
  },

  getMe(token: string) {
    return request<SessionUser>('/auth/me', { token });
  },

  getTeams(token: string) {
    return request<Team[]>('/users/me/teams', { token });
  },

  getSubstations(token: string) {
    return request<Substation[]>('/substations', { token });
  },

  async getMainheads(token: string) {
    try {
      return await request<Mainhead[]>('/users/me/mainheads', { token });
    } catch (error) {
      if (isEndpointUnavailableError(error)) {
        return request<Mainhead[]>('/enterprise/mainheads?isActive=true', { token });
      }

      throw error;
    }
  },

  async getMyCapabilities(token: string): Promise<EffectiveCapability[]> {
    try {
      return await request<EffectiveCapability[]>('/users/me/capabilities', { token });
    } catch (error) {
      if (isEndpointUnavailableError(error)) {
        return [];
      }

      throw error;
    }
  },

  getActiveSiteVisits(token: string) {
    return request<SiteVisit[]>('/site-visits?status=ACTIVE', { token });
  },

  getCompletedSiteVisits(token: string) {
    return request<SiteVisit[]>('/site-visits?status=COMPLETED', { token });
  },

  getOperationalSessions(token: string, filters: OperationalSessionFilters = {}) {
    return request<OperationalSession[]>(
      `/operational-sessions${buildQueryString(filters)}`,
      { token },
    );
  },

  getOperationalSession(token: string, sessionId: string) {
    return request<OperationalSession>(
      `/operational-sessions/${encodeURIComponent(sessionId)}`,
      { token },
    );
  },

  getSessionAssets(token: string, sessionId: string) {
    return request<OperationalSessionAssignedAsset[]>(
      `/operational-sessions/${encodeURIComponent(sessionId)}/assets`,
      { token },
    );
  },

  startOperationalSession(token: string, sessionId: string) {
    return request<OperationalSession>(
      `/operational-sessions/${encodeURIComponent(sessionId)}/start`,
      {
        method: 'POST',
        token,
      },
    );
  },

  submitOperationalSession(token: string, sessionId: string) {
    return request<OperationalSession>(
      `/operational-sessions/${encodeURIComponent(sessionId)}/submit`,
      {
        method: 'POST',
        token,
      },
    );
  },

  createSiteVisit(
    token: string,
    input: {
      teamId: string;
      substationId?: string;
      notes?: string;
      visitType?: SiteVisit['visitType'];
      operationMode?: OperationMode;
      operationalScope?: OperationalScope;
      sessionKind?: SessionKind;
      fromPencawangId?: string;
      toPencawangId?: string;
      requiresQAQC?: boolean;
      reportingGroup?: string;
      mainheadId?: string;
      mainhead?: string;
      pencawangCode?: string;
      pencawangName?: string;
      functionalLocation?: string;
      checkInLatitude?: number;
      checkInLongitude?: number;
      checkInAccuracyMeters?: number;
      checkInCapturedAt?: string;
    },
  ) {
    return request<SiteVisit>('/site-visits', {
      method: 'POST',
      token,
      body: input,
    });
  },

  getSiteVisit(token: string, siteVisitId: string) {
    return request<SiteVisit>(`/site-visits/${siteVisitId}`, { token });
  },

  async joinSiteVisit(token: string, siteVisitId: string) {
    return request<SiteVisit>(`/site-visits/${siteVisitId}/join`, {
      method: 'POST',
      token,
    });
  },

  async reassignSiteVisit(
    token: string,
    siteVisitId: string,
    toTeamId: string,
    reason: string,
  ) {
    return request<SiteVisit>(`/site-visits/${siteVisitId}/reassign`, {
      method: 'POST',
      token,
      body: { toTeamId, reason },
    });
  },

  async getAllTeams(token: string) {
    return request<
      Array<{
        id: string;
        name?: string | null;
        code?: string | null;
        organizationId?: string | null;
      }>
    >('/teams', { token });
  },

  async getSiteVisitAssets(token: string, siteVisitId: string) {
    const response = await request<Array<SiteVisitAssetLink | Asset>>(
      `/site-visits/${siteVisitId}/assets`,
      { token },
    );

    return normalizeSiteVisitAssets(response);
  },

  async getAssetsForVisit(token: string, siteVisitId: string, substationId: string) {
    try {
      return await this.getSiteVisitAssets(token, siteVisitId);
    } catch (error) {
      if (isEndpointUnavailableError(error)) {
        return this.getAssets(token, substationId);
      }

      throw error;
    }
  },

  linkSiteVisitAsset(token: string, siteVisitId: string, assetId: string) {
    return request<SiteVisitAssetLink>(`/site-visits/${siteVisitId}/assets`, {
      method: 'POST',
      token,
      body: {
        assetId,
        source: 'MOBILE_VISIT_LIST',
      },
    });
  },

  completeSiteVisit(
    token: string,
    siteVisitId: string,
    input: { completedAt?: string; completionNotes?: string },
  ) {
    return request<SiteVisit>(`/site-visits/${siteVisitId}/complete`, {
      method: 'POST',
      token,
      body: input,
    });
  },

  getAssets(token: string, substationId: string) {
    const query = encodeURIComponent(substationId);

    return request<Asset[]>(`/assets?substation_id=${query}`, { token });
  },

  getAssetDetail(token: string, assetId: string) {
    return request<AssetDetailResponse>(`/assets/${assetId}`, { token });
  },

  getAssetInspections(token: string, assetId: string) {
    return request<AssetInspectionHistoryItem[]>(`/assets/${assetId}/inspections`, { token });
  },

  getAssetTypes(token: string) {
    return request<AssetType[]>('/asset-types', { token });
  },

  getChecklistTemplates(token: string) {
    return request<ChecklistTemplate[]>('/checklist-templates', { token });
  },

  getDashboard(token: string) {
    return request<DashboardData>('/dashboard', { token });
  },

  getChecklistTemplateByAssetType(token: string, assetType: string) {
    return request<ChecklistTemplate>(
      `/checklist-templates/asset-type/${encodeURIComponent(assetType)}`,
      { token },
    );
  },

  resolveInspectionTemplate(
    token: string,
    input: {
      assetId?: string;
      assetTypeId?: string;
      assetType?: string;
      capabilityId?: string | null;
      siteVisitId?: string;
      operationalSessionId?: string | null;
      organizationId?: string | null;
      branchId?: string | null;
      mainheadId?: string | null;
    },
  ) {
    const query = new URLSearchParams();

    if (input.assetId) {
      query.set('assetId', input.assetId);
    }

    if (input.assetTypeId) {
      query.set('assetTypeId', input.assetTypeId);
    } else if (input.assetType) {
      query.set('assetType', input.assetType);
    }

    if (input.capabilityId) {
      query.set('capabilityId', input.capabilityId);
    }

    if (input.siteVisitId) {
      query.set('siteVisitId', input.siteVisitId);
    }

    if (input.operationalSessionId) {
      query.set('operationalSessionId', input.operationalSessionId);
    }

    if (input.organizationId) {
      query.set('organizationId', input.organizationId);
    }

    if (input.branchId) {
      query.set('branchId', input.branchId);
    }

    if (input.mainheadId) {
      query.set('mainheadId', input.mainheadId);
    }

    return request<ChecklistTemplate>(`/inspection-templates/resolve?${query.toString()}`, {
      token,
    });
  },

  createChecklistTemplate(token: string, input: CreateChecklistTemplateInput) {
    return request<ChecklistTemplate>('/checklist-templates', {
      method: 'POST',
      token,
      body: input,
    });
  },

  updateChecklistTemplate(token: string, templateId: string, input: UpdateChecklistTemplateInput) {
    return request<ChecklistTemplate>(`/checklist-templates/${templateId}`, {
      method: 'PATCH',
      token,
      body: input,
    });
  },

  getDefects(token: string) {
    return request<DefectListItem[]>('/defects', { token });
  },

  getDefectDetail(token: string, defectId: string) {
    return request<DefectDetail>(`/defects/${defectId}`, { token });
  },

  updateDefectStatus(
    token: string,
    defectId: string,
    status: DefectStatus,
    actionRemark?: string | null,
  ) {
    const body: {
      status: DefectStatus;
      actionRemark?: string | null;
    } = { status };

    if (actionRemark !== undefined) {
      body.actionRemark = actionRemark;
    }

    return request<DefectDetail>(`/defects/${defectId}/status`, {
      method: 'PATCH',
      token,
      body,
    });
  },

  completeDefectMaintenance(
    token: string,
    defectId: string,
    input: {
      resolutionOutcome: DefectResolutionOutcome;
      maintenanceNotes?: string | null;
    },
  ) {
    return request<DefectDetail>(`/defects/${defectId}/maintenance-completion`, {
      method: 'PATCH',
      token,
      body: {
        resolutionOutcome: input.resolutionOutcome,
        maintenanceNotes: input.maintenanceNotes ?? null,
        completionRemarks: input.maintenanceNotes ?? null,
      },
    });
  },

  uploadDefectEvidenceImage(
    token: string,
    defectId: string,
    photo: DefectEvidenceImageUploadInput,
  ) {
    return uploadDefectEvidenceImage(token, defectId, photo);
  },

  createAsset(token: string, input: CreateAssetInput) {
    return request<Asset>('/assets', {
      method: 'POST',
      token,
      body: input,
    });
  },

  updateAsset(token: string, assetId: string, input: UpdateAssetInput) {
    return request<Asset>(`/assets/${assetId}`, {
      method: 'PUT',
      token,
      body: input,
    });
  },

  updateAssetStatus(token: string, assetId: string, input: { status: Asset['status'] }) {
    return request<Asset>(`/assets/${assetId}/status`, {
      method: 'PATCH',
      token,
      body: input,
    });
  },

  createInspection(
    token: string,
    input: {
      siteVisitId: string;
      assetId: string;
      operationalSessionId?: string | null;
      inspectionCycle: number;
      operationMode?: OperationMode;
      operationalScope?: OperationalScope;
      requiresQAQC?: boolean;
      reportingGroup?: string;
    },
  ) {
    return request<{ id: string }>('/inspections', {
      method: 'POST',
      token,
      body: input,
    });
  },

  getInspectionForm(token: string, inspectionId: string) {
    return request<InspectionFormResponse>(`/inspections/${inspectionId}/form`, { token });
  },

  getInspectionDetail(token: string, inspectionId: string) {
    return request<InspectionDetail>(`/inspections/${inspectionId}`, { token });
  },

  saveInspectionResults(
    token: string,
    inspectionId: string,
    input: {
      items?: SaveInspectionItemResultInput[];
      results?: SaveInspectionResultItemInput[];
    },
  ) {
    return request<InspectionFormResponse>(`/inspections/${inspectionId}/results`, {
      method: 'PUT',
      token,
      body: input,
    });
  },

  uploadInspectionImage(token: string, inspectionId: string, photo: InspectionImageUploadInput) {
    return uploadInspectionImage(token, inspectionId, photo);
  },

  uploadSiteVisitImage(token: string, siteVisitId: string, photo: SiteVisitImageUploadInput) {
    return uploadSiteVisitImage(token, siteVisitId, photo);
  },

  submitInspection(token: string, inspectionId: string) {
    return request(`/inspections/${inspectionId}/submit`, {
      method: 'POST',
      token,
    });
  },
};

function normalizeSiteVisitAssets(entries: Array<SiteVisitAssetLink | Asset>) {
  return entries
    .map((entry) => {
      if (entry && typeof entry === 'object' && 'asset' in entry) {
        return entry.asset;
      }

      return entry as Asset;
    })
    .filter(Boolean);
}

async function uploadInspectionImage(
  token: string,
  inspectionId: string,
  photo: InspectionImageUploadInput,
) {
  const url = `${API_BASE_URL}/inspections/${inspectionId}/images`;
  const uploadFilename = createUploadFilename(photo.timestamp);
  const uploadUri = await createUploadFileUri(photo.uri, uploadFilename);
  const parameters = createUploadParameters(photo);

  console.log('[UPLOAD REQUEST]', {
    url,
    method: 'POST',
    fileUri: uploadUri,
    fieldName: 'file',
    parameters,
  });

  try {
    const response = await FileSystem.uploadAsync(url, uploadUri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: 'image/jpeg',
      parameters,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const payload = tryParsePayload(response.body);

    console.log('[UPLOAD RESPONSE]', {
      url,
      method: 'POST',
      status: response.status,
      payload,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ApiError(extractErrorMessage(payload, response.status), response.status, payload);
    }

    return payload as InspectionImage;
  } catch (error) {
    logNetworkError({ url, method: 'POST upload', error });

    throw error;
  } finally {
    if (uploadUri !== photo.uri) {
      void FileSystem.deleteAsync(uploadUri, { idempotent: true }).catch(() => undefined);
    }
  }
}

async function uploadSiteVisitImage(
  token: string,
  siteVisitId: string,
  photo: SiteVisitImageUploadInput,
) {
  const url = `${API_BASE_URL}/site-visits/${siteVisitId}/images`;
  const uploadFilename = createUploadFilename(photo.timestamp ?? new Date().toISOString());
  const uploadUri = await createUploadFileUri(photo.uri, uploadFilename);

  console.log('[UPLOAD REQUEST]', {
    url,
    method: 'POST',
    fileUri: uploadUri,
    fieldName: 'file',
  });

  try {
    const response = await FileSystem.uploadAsync(url, uploadUri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: 'image/jpeg',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const payload = tryParsePayload(response.body);

    console.log('[UPLOAD RESPONSE]', {
      url,
      method: 'POST',
      status: response.status,
      payload,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ApiError(extractErrorMessage(payload, response.status), response.status, payload);
    }

    return payload as SiteVisitImage;
  } catch (error) {
    logNetworkError({ url, method: 'POST upload', error });

    throw error;
  } finally {
    if (uploadUri !== photo.uri) {
      void FileSystem.deleteAsync(uploadUri, { idempotent: true }).catch(() => undefined);
    }
  }
}

async function uploadDefectEvidenceImage(
  token: string,
  defectId: string,
  photo: DefectEvidenceImageUploadInput,
) {
  const url = `${API_BASE_URL}/defects/${defectId}/evidence-images`;
  const uploadFilename = createUploadFilename(photo.timestamp ?? new Date().toISOString());
  const uploadUri = await createUploadFileUri(photo.uri, uploadFilename);
  const parameters = createDefectEvidenceUploadParameters(photo);

  console.log('[UPLOAD REQUEST]', {
    url,
    method: 'POST',
    fileUri: uploadUri,
    fieldName: 'file',
    parameters,
  });

  try {
    const response = await FileSystem.uploadAsync(url, uploadUri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: 'image/jpeg',
      parameters,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const payload = tryParsePayload(response.body);

    console.log('[UPLOAD RESPONSE]', {
      url,
      method: 'POST',
      status: response.status,
      payload,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ApiError(extractErrorMessage(payload, response.status), response.status, payload);
    }

    return payload as DefectEvidenceImage;
  } catch (error) {
    logNetworkError({ url, method: 'POST upload', error });

    throw error;
  } finally {
    if (uploadUri !== photo.uri) {
      void FileSystem.deleteAsync(uploadUri, { idempotent: true }).catch(() => undefined);
    }
  }
}

function createUploadParameters(photo: InspectionImageUploadInput) {
  const parameters: Record<string, string> = {};

  if (typeof photo.latitude === 'number' && Number.isFinite(photo.latitude)) {
    parameters.latitude = String(photo.latitude);
  }

  if (typeof photo.longitude === 'number' && Number.isFinite(photo.longitude)) {
    parameters.longitude = String(photo.longitude);
  }

  if (photo.timestamp) {
    parameters.timestamp = photo.timestamp;
  }

  const type = photo.type?.trim();

  if (type) {
    parameters.type = type;
  }

  return parameters;
}

function createDefectEvidenceUploadParameters(photo: DefectEvidenceImageUploadInput) {
  const parameters: Record<string, string> = {
    evidenceType: 'MAINTENANCE_PROOF',
  };

  if (typeof photo.latitude === 'number' && Number.isFinite(photo.latitude)) {
    parameters.latitude = String(photo.latitude);
  }

  if (typeof photo.longitude === 'number' && Number.isFinite(photo.longitude)) {
    parameters.longitude = String(photo.longitude);
  }

  if (photo.timestamp) {
    parameters.timestamp = photo.timestamp;
  }

  if (photo.note?.trim()) {
    parameters.note = photo.note.trim();
  }

  return parameters;
}

async function createUploadFileUri(sourceUri: string, filename: string) {
  if (!FileSystem.cacheDirectory) {
    return sourceUri;
  }

  const targetUri = `${FileSystem.cacheDirectory}${filename}`;

  try {
    await FileSystem.copyAsync({
      from: sourceUri,
      to: targetUri,
    });

    return targetUri;
  } catch {
    return sourceUri;
  }
}

function createUploadFilename(timestamp: string) {
  const sanitizedTimestamp = timestamp.replace(/[^0-9A-Za-z_-]/g, '-');
  const filenameSuffix = sanitizedTimestamp || String(Date.now());

  return `photo_${filenameSuffix}.jpg`;
}
