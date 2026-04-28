import * as FileSystem from 'expo-file-system/legacy';
import {
  Asset,
  AssetDetailResponse,
  AssetInspectionHistoryItem,
  AssetType,
  CreateAssetInput,
  InspectionImage,
  InspectionImageUploadInput,
  InspectionDetail,
  InspectionFormResponse,
  LoginResponse,
  SaveInspectionResultItemInput,
  SessionUser,
  SiteVisit,
  Team,
  Substation,
  UpdateAssetInput,
} from './types';

const DEFAULT_API_BASE_URL = 'http://10.149.246.224:3000/api/v1';

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
    console.error('[API NETWORK ERROR]', {
      url,
      method,
      error,
    });
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

  getActiveSiteVisits(token: string) {
    return request<SiteVisit[]>('/site-visits?status=ACTIVE', { token });
  },

  createSiteVisit(token: string, input: { teamId: string; substationId: string; notes?: string }) {
    return request<SiteVisit>('/site-visits', {
      method: 'POST',
      token,
      body: input,
    });
  },

  getSiteVisit(token: string, siteVisitId: string) {
    return request<SiteVisit>(`/site-visits/${siteVisitId}`, { token });
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

  createInspection(token: string, input: { siteVisitId: string; assetId: string; inspectionCycle: number }) {
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
    input: { results: SaveInspectionResultItemInput[] },
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

  submitInspection(token: string, inspectionId: string) {
    return request(`/inspections/${inspectionId}/submit`, {
      method: 'POST',
      token,
    });
  },
};

async function uploadInspectionImage(
  token: string,
  inspectionId: string,
  photo: InspectionImageUploadInput,
) {
  const url = `${API_BASE_URL}/inspections/${inspectionId}/images`;
  const uploadFilename = createUploadFilename(photo.timestamp);
  const uploadUri = await createUploadFileUri(photo.uri, uploadFilename);

  console.log('[UPLOAD REQUEST]', {
    url,
    method: 'POST',
    fileUri: uploadUri,
    fieldName: 'file',
    parameters: {
      latitude: String(photo.latitude),
      longitude: String(photo.longitude),
      timestamp: photo.timestamp,
    },
  });

  try {
    const response = await FileSystem.uploadAsync(url, uploadUri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: 'image/jpeg',
      parameters: {
        latitude: String(photo.latitude),
        longitude: String(photo.longitude),
        timestamp: photo.timestamp,
      },
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
    console.error('[UPLOAD ERROR]', {
      url,
      method: 'POST',
      error,
    });

    throw error;
  } finally {
    if (uploadUri !== photo.uri) {
      void FileSystem.deleteAsync(uploadUri, { idempotent: true }).catch(() => undefined);
    }
  }
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
