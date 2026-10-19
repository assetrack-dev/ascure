import type { TaskStatus } from "@/types/maintenance-tasks";

/** Plan §21 (R5) — GET /teams/mine: the field crew's read-only "My team". */
export interface MyTeam {
  teams: Array<{
    id: string;
    name: string;
    code: string;
    company: string | null;
    members: Array<{ id: string; name: string; role: string; isMe: boolean }>;
    supervisors: string[];
  }>;
  inspected: {
    today: { team: number; mine: number };
    week: { team: number; mine: number };
  };
  openSurveys: Array<{
    id: string;
    teamId: string;
    pencawang: string | null;
    lifecycleStatus: string | null;
    startedAt: string;
    poles: number;
    amendment: { remark: string | null; at: string | null } | null;
  }>;
  /** A technician's routed Kejanggalan by status; null when there are none (or a viewer). */
  maintenance: { total: number; counts: Record<TaskStatus, number> } | null;
}
