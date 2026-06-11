import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class DeleteAssetsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  ids!: string[];
}
