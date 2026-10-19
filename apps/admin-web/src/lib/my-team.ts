import { apiRequest } from "@/lib/api";
import type { MyTeam } from "@/types/my-team";

/** Plan §21 (R5): own teams, open surveys, poles inspected — read-only. */
export function fetchMyTeam(token: string) {
  return apiRequest<MyTeam>("/teams/mine", { token });
}
