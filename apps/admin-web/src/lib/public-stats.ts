import { apiRequest } from "@/lib/api";

/** Mirror of the API's PublicStats (apps/api/src/public/public.service.ts). */
export interface PublicStats {
  polesInspected: number;
  inspectionsPerformed: number;
  assetsInRegister: number;
  defectsLogged: number;
  generatedAt: string;
}

function numberOrZero(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
}

/**
 * Fetches the public (unauthenticated) aggregate platform stats. Tolerant of a
 * missing/partial payload so the landing page degrades gracefully to zeros
 * rather than throwing if the API is unreachable.
 */
export async function fetchPublicStats(): Promise<PublicStats> {
  const raw = await apiRequest<Partial<PublicStats>>("/public/stats");

  return {
    polesInspected: numberOrZero(raw?.polesInspected),
    inspectionsPerformed: numberOrZero(raw?.inspectionsPerformed),
    assetsInRegister: numberOrZero(raw?.assetsInRegister),
    defectsLogged: numberOrZero(raw?.defectsLogged),
    generatedAt:
      typeof raw?.generatedAt === "string" ? raw.generatedAt : new Date().toISOString(),
  };
}
