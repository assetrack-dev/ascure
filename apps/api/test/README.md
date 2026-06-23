# API e2e tests (authorization suite)

Phase 0 + 1 of the [testing & hardening plan](../../../docs/ASCURE-testing-hardening-plan.md):
a jest + supertest harness, a deterministic multi-company seed, and the
authorization regression net (the crown-jewel cross-company isolation tests).

## Run locally

1. Ensure the local Postgres is up (the dev docker container, port 5433).
2. `cp apps/api/.env.test.example apps/api/.env.test` and edit `DATABASE_URL` to
   point at a **throwaway** database (e.g. `ascure_test`). The suite truncates +
   re-seeds it on every run — never aim it at dev/prod data.
3. From `apps/api`: `pnpm test` (alias `pnpm test:e2e`).

`globalSetup` runs `prisma db push` against the test DB, then resets + seeds the
fixture in [`test/fixtures/seed-multi-company.ts`](fixtures/seed-multi-company.ts).
Tests run serially (`maxWorkers: 1`) against that one shared seed.

## Layout

- `fixtures/seed-multi-company.ts` — the graph + fixed UUIDs (`IDS`) + `EMAILS`.
  Tenant T1 holds Company A and Company B (Organizations, same tenant); each has a
  team, a site-visit, a geocoded asset, a SUBMITTED inspection, a failing item
  result, and a VERIFIED defect. Tenant T2 holds one admin (cross-tenant boundary).
- `utils/test-app.ts` — boots the real `AppModule` with the production global
  prefix + ValidationPipe. **Overrides `ThrottlerGuard`** so the login throttle
  (Deploy 47) doesn't trip while minting tokens. A future Phase-2 throttle test
  must not use this helper.
- `utils/http.ts` — `login()` (real POST /auth/login) + a bearer-preset supertest wrapper.
- `authz/cross-company.e2e-spec.ts` — work/findings org isolation + cross-tenant.
- `authz/roles.e2e-spec.ts` — role gates + the Deploy-44 team-org regression lock.

## Open decision (surfaced by this suite)

The physical **asset register is tenant-wide**: `GET /assets/:id` and `GET /assets`
(master-data) return any asset in the tenant regardless of company — only the
`/assets/map` feed, site-visits, inspections, defects, and dashboard are
org/team-scoped. This is defensible (poles are the utility's shared
infrastructure, not contractor-private), but confirm it's intended. It is left as
an `it.todo` in the cross-company spec rather than asserted either way.

The boundary is enforced by `siteVisitAccessWhere` (and the per-service
access-scope helpers that delegate to it). New endpoints that read work/findings
should add a cross-company negative test here.
