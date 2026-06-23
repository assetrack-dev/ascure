import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../utils/test-app';

/**
 * Phase 2 — auth hardening. helmet sets the security response headers, and CORS
 * is an explicit allow-list (not '*'). Asserted on the public /public/stats route
 * (no auth needed). The test app runs the SAME configureApp() as production, so
 * these prove the real middleware.
 */
describe('Security · response headers (helmet) + CORS allow-list', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('helmet security headers', () => {
    it('sets the core hardening headers and hides the framework fingerprint', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/public/stats');
      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toBeDefined();
      // Relaxed so the admin console (a different origin) can embed /uploads/ images.
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
      // CSP intentionally disabled on the API (it serves cross-origin images).
      expect(res.headers['content-security-policy']).toBeUndefined();
      // helmet's hidePoweredBy removes Express's fingerprint.
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('CORS allow-list', () => {
    it('reflects an allowed admin origin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/public/stats')
        .set('Origin', 'https://admin.ascure.com.my');
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.ascure.com.my');
    });

    it('does NOT echo an unknown origin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/public/stats')
        .set('Origin', 'https://evil.example.com');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
