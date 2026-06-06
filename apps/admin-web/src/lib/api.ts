import type { LoginResponse } from "@/types/auth";

const DEFAULT_API_ORIGIN = "http://localhost:3000";

export const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_ORIGIN).replace(
  /\/$/,
  "",
);

export const API_BASE_URL = API_ORIGIN.endsWith("/api/v1")
  ? API_ORIGIN
  : `${API_ORIGIN}/api/v1`;

type ApiRequestOptions = RequestInit & {
  token?: string;
};

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

async function readBody(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(payload: unknown, fallback: string) {
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message;

    if (Array.isArray(message) && message.length > 0) {
      return message.join(", ");
    }

    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return fallback;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);

  headers.set("Accept", "application/json");

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new ApiError(
      `Unable to reach the ASCURE API at ${API_BASE_URL}. Make sure the backend is running.`,
      0,
    );
  }

  const payload = await readBody(response);

  if (!response.ok) {
    throw new ApiError(errorMessage(payload, "Request failed."), response.status, payload);
  }

  return payload as T;
}

export function login(email: string, password: string) {
  return apiRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
    }),
  });
}

export interface BlobResponse {
  blob: Blob;
  filename: string | null;
}

/**
 * Like {@link apiRequest} but for binary endpoints (e.g. Excel downloads).
 * Attaches the bearer token, surfaces API errors as {@link ApiError}, and
 * returns the response Blob plus the server-suggested filename (parsed from the
 * Content-Disposition header when exposed).
 */
export async function apiRequestBlob(
  path: string,
  options: ApiRequestOptions = {},
): Promise<BlobResponse> {
  const headers = new Headers(options.headers);

  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new ApiError(
      `Unable to reach the ASCURE API at ${API_BASE_URL}. Make sure the backend is running.`,
      0,
    );
  }

  if (!response.ok) {
    const payload = await readBody(response);
    throw new ApiError(errorMessage(payload, "Request failed."), response.status, payload);
  }

  return {
    blob: await response.blob(),
    filename: parseContentDispositionFilename(response.headers.get("Content-Disposition")),
  };
}

function parseContentDispositionFilename(headerValue: string | null): string | null {
  if (!headerValue) {
    return null;
  }

  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(headerValue);

  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
