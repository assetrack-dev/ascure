import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateDefectCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  comment!: string;
}
