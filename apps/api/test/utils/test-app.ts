import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from '../../src/app.module';

/**
 * Boots the real AppModule for e2e tests, replicating the production bootstrap
 * (global `api/v1` prefix + the same global ValidationPipe as `main.ts`).
 *
 * The login rate-limiter (ThrottlerGuard, shipped Deploy 47) is overridden to a
 * no-op here: the authz suite mints many tokens and would otherwise trip the
 * 10/min/IP login throttle. A dedicated throttle test (Phase 2) must NOT use
 * this helper.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();
  return app;
}
