import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';

/**
 * Tenant configuration (organizations, branches, MAINHEADs, checklist templates,
 * and user administration) is ADMIN-only — enforced by `@Roles(ADMIN)` +
 * RolesGuard, which runs BEFORE the body pipe, so a non-admin is rejected with a
 * clean 403 regardless of payload. This locks the boundary that a contractor's
 * MANAGER (or any lower role) cannot escalate to reconfigure the tenant or
 * administer users outside the narrow, org-scoped paths they DO own (which are
 * covered in roles.e2e-spec.ts).
 */
type Method = 'post' | 'patch' | 'del';

const ADMIN_ONLY: Array<{ name: string; method: Method; path: string }> = [
  { name: 'create an organization', method: 'post', path: '/api/v1/enterprise/organizations' },
  { name: 'create a branch', method: 'post', path: '/api/v1/enterprise/branches' },
  { name: 'create a MAINHEAD', method: 'post', path: '/api/v1/enterprise/mainheads' },
  { name: 'create a checklist template', method: 'post', path: '/api/v1/checklist-templates' },
  { name: 'activate a checklist template', method: 'post', path: `/api/v1/checklist-templates/${IDS.template.tmpl}/activate` },
  { name: 'archive a checklist template', method: 'del', path: `/api/v1/checklist-templates/${IDS.template.tmpl}` },
  { name: 'update another user', method: 'patch', path: `/api/v1/users/${IDS.user.techA}` },
  { name: 'change another user\'s status', method: 'patch', path: `/api/v1/users/${IDS.user.techA}/status` },
];

describe('Authz · tenant configuration is ADMIN-only', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};

  beforeAll(async () => {
    app = await createTestApp();
    token.mgrA = await login(app, EMAILS.mgrA);
    token.techA = await login(app, EMAILS.techA);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe.each([
    ['manager', 'mgrA'],
    ['technician', 'techA'],
  ])('a %s cannot', (_label, key) => {
    it.each(ADMIN_ONLY)('$name (403)', async ({ method, path }) => {
      const res = await http(app, token[key])[method](path).send({});
      expect(res.status).toBe(403);
    });
  });
});
