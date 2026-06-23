import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../utils/test-app';
import { login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';

/**
 * Phase 3 — upload hardening. Every FileInterceptor now carries a size cap + a
 * MIME/extension allow-list, so a wrong file type is rejected at the interceptor
 * (before the handler) with 415. (The fileFilter runs after the JwtAuthGuard, so
 * the caller is authenticated but the request never reaches the handler.) The
 * size cap → 413 is configured + mapped by MulterExceptionFilter; not exercised
 * here because a >25MB body makes the test slow.
 */
describe('Security · upload type gating (FileInterceptor allow-lists)', () => {
  let app: INestApplication;
  let techA: string;

  beforeAll(async () => {
    app = await createTestApp();
    techA = await login(app, EMAILS.techA);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects a non-image on the inspection image endpoint (415)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/inspections/${IDS.inspection.a}/images`)
      .set('Authorization', `Bearer ${techA}`)
      .attach('file', Buffer.from('not an image'), {
        filename: 'evil.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(415);
  });

  it('rejects a non-docx on the report-template endpoint (415)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/report-templates')
      .set('Authorization', `Bearer ${techA}`)
      .attach('file', Buffer.from('not a docx'), {
        filename: 'evil.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(415);
  });
});
