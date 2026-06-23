import { PrismaClient } from '@prisma/client';

/**
 * A standalone PrismaClient for tests to assert directly on DB state (e.g. that
 * a clamp left a row's organizationId unchanged). Points at the same test DB as
 * the app via DATABASE_URL. Separate from the app's PrismaService.
 */
let client: PrismaClient | undefined;

export function getTestPrisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient();
  }
  return client;
}

export async function disconnectTestPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}
