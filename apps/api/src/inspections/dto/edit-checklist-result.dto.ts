import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

const trimOrEmpty = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value == null ? '' : String(value);

/**
 * In-place edit of a recorded checklist value on a submitted inspection, by the
 * managing MANAGER (own teams + subcontractor subtree), a DC/QA actor, or ADMIN.
 * The server targets the checklist item whose normalized label === `columnKey`
 * (the Linked-Assets column key) and coerces `value` to that item's typed
 * column. `value` is free text; an empty string clears the recorded value.
 */
export class EditChecklistResultDto {
  // The Linked-Assets column key = the checklist item's normalized label
  // (uppercased, single-spaced). The server re-normalizes defensively.
  @Transform(trimOrEmpty)
  @IsString()
  @IsNotEmpty()
  columnKey!: string;

  @Transform(trimOrEmpty)
  @IsOptional()
  @IsString()
  value?: string;

  // The visit being viewed. The server rejects an edit whose inspection belongs
  // to a different survey cycle (a re-surveyed pole's latest value).
  @IsOptional()
  @IsUUID()
  siteVisitId?: string;
}
