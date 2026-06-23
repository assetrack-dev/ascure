import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.config';

/**
 * Boots the real AppModule for e2e tests, applying the SAME configureApp() as
 * production (security headers, tightened CORS, the global prefix, the static
 * /uploads/ mount, and the global ValidationPipe) so tests exercise the real
 * middleware stack.
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

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}
