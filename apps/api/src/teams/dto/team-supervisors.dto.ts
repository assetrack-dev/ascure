import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

/**
 * Set the supervisors that oversee a team (ADR 0002 §3). The submitted list is
 * the desired full set — links not present are removed, new ones are created.
 * An empty array clears all supervisors for the team.
 */
export class SetTeamSupervisorsDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  supervisorUserIds!: string[];
}
