import { ConfigService } from '@nestjs/config';

/**
 * The JWT signing/verification secret — resolved fail-CLOSED.
 *
 * If JWT_SECRET is unset we THROW rather than fall back to a hardcoded value.
 * A public fallback in an open-source repo would let anyone forge tokens
 * (hardening plan E3). Prod sets JWT_SECRET in its .env, so this only ever fires
 * on a genuinely misconfigured environment — where failing to boot loudly is far
 * safer than silently signing/verifying with a known secret. The signer
 * (AuthModule) and verifier (JwtStrategy) both call this, so they can never
 * drift onto different secrets.
 */
export function resolveJwtSecret(configService: ConfigService): string {
  const secret = configService.get<string>('JWT_SECRET')?.trim();

  if (!secret) {
    throw new Error(
      'JWT_SECRET is not set. Refusing to start with an insecure fallback ' +
        'secret — set JWT_SECRET in the environment.',
    );
  }

  return secret;
}
