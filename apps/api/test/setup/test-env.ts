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
  // Auto ground clearance hooks are opt-in per environment (prod switches them
  // on after the one-time backfill); the suite exercises them.
  process.env.AUTO_GROUND_CLEARANCE = process.env.AUTO_GROUND_CLEARANCE || 'true';
  // Web Push stays OFF under test (plan §19, N56) even when a developer's .env
  // carries VAPID keys — a test must never send a real push. Set (empty) here,
  // so the app's ConfigModule (dotenv: never overrides) can't fill them in.
  process.env.VAPID_PUBLIC_KEY = '';
  process.env.VAPID_PRIVATE_KEY = '';
}

loadTestEnv();
