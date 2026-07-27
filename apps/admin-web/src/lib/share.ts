import { apiRequest } from "@/lib/api";
import type { EvidenceLikeImage } from "@/components/inspection-evidence-grid";

/**
 * Tokenized public "share this pole" links. Creating one is an authenticated
 * admin-web action; resolving one is unauthenticated — the token in the URL is
 * the credential, and the API returns a read-only live view of that ONE pole.
 */

export interface AssetShareLink {
  token: string;
  expiresAt: string;
}

export interface SharedPoleItem {
  id: string;
  label: string;
  result: string | null;
  remark: string | null;
  isDefect: boolean;
  severity: string | null;
}

export interface SharedPole {
  assetCode: string;
  noTiangRondaan: string | null;
  name: string | null;
  assetType: string | null;
  status: string | null;
  latitude: number | null;
  longitude: number | null;
  location: string | null;
  pencawangName: string | null;
  shareExpiresAt: string;
  latestInspection: {
    status: string | null;
    cycleNumber: number | null;
    submittedAt: string | null;
    remarks: string | null;
    totalDefects: number;
    items: SharedPoleItem[];
    images: EvidenceLikeImage[];
  } | null;
}

/** Mint a share link for one pole (ADMIN / manager / DC; API re-enforces). */
export async function createAssetShareLink(
  token: string,
  assetId: string,
  expiresInDays: number,
): Promise<AssetShareLink> {
  return apiRequest<AssetShareLink>(
    `/share/asset/${encodeURIComponent(assetId)}`,
    { method: "POST", token, body: JSON.stringify({ expiresInDays }) },
  );
}

/** Resolve a share token — public, no session. 404 = invalid or expired. */
export async function fetchSharedPole(shareToken: string): Promise<SharedPole> {
  return apiRequest<SharedPole>(
    `/share/pole/${encodeURIComponent(shareToken)}`,
  );
}

/** The public URL a recipient opens — served by this same admin-web app. */
export function buildShareUrl(token: string): string {
  return `${window.location.origin}/s/${encodeURIComponent(token)}`;
}
