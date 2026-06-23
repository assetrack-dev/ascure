import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Load the e2e test environment.
 *
 * Reads `apps/api/.env.test` (gitignored — points at a LOCAL throwaway Postgres)
 * but NEVER overrides a variable already present in the environment, so CI can
 * inject `DATABASE_URL` via the workflow and it wins. Runs as a jest `setupFiles`
 * entry (per worker, before AppModule is imported) and is also called explicitly
 * from `global-setup.ts` (which runs in the main jest process).
 */
export function loadTestEnv(): void {
  const envPath = resolve(__dirname, '../../.env.test');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const key = match[1];
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      // .env.test WINS over any ambient value (e.g. a dev DATABASE_URL already
      // in the shell). This is the local safety mechanism: it guarantees the
      // suite targets the throwaway *_test DB and never an inherited dev URL.
      // CI has no .env.test, so its injected DATABASE_URL is used instead.
      process.env[key] = value;
    }
  }

  // Hard fallbacks so the app boots under test even without a .env.test
  // (resolveJwtSecret() now throws on a missing secret — fail closed).
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-jwt-secret-not-for-production';
  }
}

loadTestEnv();
