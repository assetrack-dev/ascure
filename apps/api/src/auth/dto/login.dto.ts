import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  // Calling app. 'mobile' opts into a single-device, 30-day ("always logged
  // in") session; omitted or 'web' (admin console) keeps the standard 8h,
  // multi-session token. Whitelisted here so the global ValidationPipe
  // (forbidNonWhitelisted) accepts it from the mobile client.
  @IsOptional()
  @IsIn(['mobile', 'web'])
  client?: 'mobile' | 'web';
}

