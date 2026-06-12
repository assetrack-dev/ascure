import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangeOwnPasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
