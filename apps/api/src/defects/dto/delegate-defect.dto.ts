import { IsUUID } from 'class-validator';

/**
 * Maintenance handoff self-management — delegate a routed defect to one of the
 * routed company's registered subcontractors (a contractor child org). The
 * defect re-routes to that company's pool.
 */
export class DelegateDefectDto {
  @IsUUID()
  organizationId!: string;
}
