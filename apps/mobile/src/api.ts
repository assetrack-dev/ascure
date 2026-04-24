import { Platform } from 'react-native';
import {
  Asset,
  InspectionFormResponse,
  LoginResponse,
  SaveInspectionResultItemInput,
  SessionUser,
  SiteVisit,
  Team,
  Substation,
} from './types';

const DEFAULT_API_BASE_URL =
  Platform.OS === 'android'
    ? 'http://10.0.2.2:3000/api/v1'
    : 'http://localhost:3000/api/v1';

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT';
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
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const rawText = await response.text();
  const payload = tryParsePayload(rawText);

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

  submitInspection(token: string, inspectionId: string) {
    return request(`/inspections/${inspectionId}/submit`, {
      method: 'POST',
      token,
    });
  },
};
