import { execSync } from 'child_process';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { loadTestEnv } from './test-env';
import { resetDatabase, seedMultiCompany } from '../fixtures/seed-multi-company';

/**
 * Runs once before the whole e2e suite. Syncs the test database's schema to
 * `prisma/schema.prisma` (idempotent `db push`), then resets + seeds the
 * deterministic multi-company fixture. The suite is read-mostly and shares this
 * one seed (jest runs serially — `maxWorkers: 1`).
 */
export default async function globalSetup(): Promise<void> {
  loadTestEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set for the e2e suite. Create apps/api/.env.test ' +
        '(copy .env.test.example) pointing at a LOCAL throwaway Postgres, or set ' +
        'DATABASE_URL in the environment (CI).',
    );
  }

  // Guard the destructive run by the target DB name BEFORE touching it. The DB
  // name must contain "test" (e.g. ascure_test) — never a dev/prod database.
  const dbName = decodeURIComponent((databaseUrl.split('/').pop() || '').split('?')[0]);
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing e2e run: DATABASE_URL points at "${dbName}", which is not a ` +
        `*_test database. Point apps/api/.env.test at a throwaway *_test database.`,
    );
  }

  // repo root: apps/api/test/setup -> ../../../..
  const repoRoot = resolve(__dirname, '../../../..');
  const apiDir = resolve(__dirname, '../..'); // apps/api — has NO .env, so prisma
  const schemaPath = resolve(repoRoot, 'prisma', 'schema.prisma');

  // Make the test DB's schema match schema.prisma without touching migration
  // history (safe for an ephemeral test database). Run from apiDir (which has no
  // .env) so the prisma CLI does NOT auto-load the repo-root .env and clobber our
  // DATABASE_URL with the dev value — it uses the test URL we pass here.
  execSync(
    `pnpm exec prisma db push --schema "${schemaPath}" --skip-generate --accept-data-loss`,
    { cwd: apiDir, env: { ...process.env }, stdio: 'inherit' },
  );

  const prisma = new PrismaClient();
  try {
    await resetDatabase(prisma);
    await seedMultiCompany(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
