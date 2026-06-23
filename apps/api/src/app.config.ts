import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { MulterExceptionFilter } from './common/filters/multer-exception.filter';
import { UPLOADS_DIRECTORY } from './common/uploads.constants';

/**
 * The known browser origins allowed to call the API cross-origin: the admin
 * console + the marketing site (which reads /public/stats), plus localhost for
 * dev. Override per-environment with CORS_ALLOWED_ORIGINS (comma-separated).
 * Mobile is NOT a browser and ignores CORS entirely, so tightening this never
 * affects the field app.
 */
function resolveCorsOrigins(): string[] {
  const fromEnv = process.env.CORS_ALLOWED_ORIGINS;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
  return [
    'https://admin.ascure.com.my',
    'https://www.ascure.com.my',
    'https://ascure.com.my',
    'http://localhost:3001',
    'http://localhost:3000',
  ];
}

/**
 * Shared production bootstrap config, applied by BOTH main.ts and the e2e test
 * app so the two can never drift: trust-proxy, security headers, the global
 * `api/v1` prefix, the static `/uploads/` mount, tightened CORS, and the global
 * ValidationPipe.
 */
export function configureApp(app: NestExpressApplication): void {
  // Behind nginx (one hop): trust X-Forwarded-For so the login rate-limiter keys
  // on the real client IP rather than the proxy address.
  app.set('trust proxy', 1);

  // Security headers (helmet). CSP is disabled — this is a JSON API that also
  // serves cross-origin /uploads/ images, so a content policy belongs on the
  // admin web's HTML, not here — and CORP is relaxed to cross-origin so the admin
  // console (a different origin) can embed those images. The rest of helmet's
  // defaults apply: HSTS, X-Content-Type-Options, frameguard, referrer-policy,
  // hide X-Powered-By, etc.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.setGlobalPrefix('api/v1');
  app.useStaticAssets(UPLOADS_DIRECTORY, { prefix: '/uploads/' });

  // Tightened CORS: an explicit allow-list instead of '*'. Auth is a bearer token
  // in the Authorization header (no cookies), so no credentials mode is needed.
  app.enableCors({
    origin: resolveCorsOrigins(),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Map multer upload errors (oversize → 413, other → 400) to clean responses
  // instead of a 500.
  app.useGlobalFilters(new MulterExceptionFilter());
}
