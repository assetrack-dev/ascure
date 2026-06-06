import { IsUUID } from 'class-validator';

export class PencawangReportParamsDto {
  @IsUUID()
  substationId!: string;
}
