import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EMAILS, TEST_PASSWORD } from '../fixtures/seed-multi-company';

/**
 * Mint a real JWT by hitting POST /auth/login (exercises the real login path).
 * Returns the bearer token string. Throws with the response body on failure so
 * a misconfigured fixture surfaces clearly.
 */
export async function login(
  app: INestApplication,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password });
  if (res.status !== 201 || !res.body?.access_token) {
    throw new Error(
      `login failed for ${email}: status=${res.status} body=${JSON.stringify(res.body)}`,
    );
  }
  return res.body.access_token as string;
}

/** A thin supertest wrapper that presets the Authorization header. */
export function http(app: INestApplication, token?: string) {
  const server = app.getHttpServer();
  const withAuth = (req: request.Test): request.Test =>
    token ? req.set('Authorization', `Bearer ${token}`) : req;
  return {
    get: (path: string) => withAuth(request(server).get(path)),
    post: (path: string) => withAuth(request(server).post(path)),
    patch: (path: string) => withAuth(request(server).patch(path)),
    put: (path: string) => withAuth(request(server).put(path)),
    del: (path: string) => withAuth(request(server).delete(path)),
  };
}

export { EMAILS };
