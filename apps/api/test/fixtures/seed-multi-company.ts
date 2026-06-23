import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

/**
 * Deterministic multi-company fixture for the authorization e2e suite.
 *
 * The graph models the real boundary: "companies" are Organizations inside ONE
 * Tenant, so cross-company isolation is enforced by the org/team scope
 * (siteVisitAccessWhere), NOT by tenant. A second tenant exists for the stronger
 * cross-tenant boundary.
 *
 *   Tenant T1 ─┬─ Company A (MAIN_CONTRACTOR) ── Team A ── techA (+ viewerA) member, supA supervisor, mgrA manager
 *              ├─ Company B (MAIN_CONTRACTOR) ── Team B ── techB member, mgrB manager
 *              ├─ adminT1 (ADMIN, tenant-wide)
 *              └─ Substation S1, AssetType SAVR, one ACTIVE template
 *   Tenant T2 ─── adminT2 (ADMIN) — no work (cross-tenant isolation)
 *
 * Per company A/B: a SiteVisit (team-owned) → Asset (created during it, geocoded)
 * → SUBMITTED Inspection → failing InspectionItemResult (isDefect) → VERIFIED
 * Defect. That chain is exactly what the scope helpers filter on.
 */

export const TEST_PASSWORD = 'Test1234!';

export const IDS = {
  tenant: {
    t1: '11111111-1111-4111-8111-111111111111',
    t2: '22222222-2222-4222-8222-222222222222',
  },
  org: {
    a: '0a000000-0000-4000-8000-000000000001',
    b: '0b000000-0000-4000-8000-000000000001',
    // A maintenance company — the registered maintainer that a defect routes to
    // under RELEASE_ON_REPORT. Not an inspecting company.
    maint: '0c000000-0000-4000-8000-000000000001',
  },
  user: {
    adminT1: '10000000-0000-4000-8000-000000000001',
    mgrA: '10000000-0000-4000-8000-0000000000a1',
    supA: '10000000-0000-4000-8000-0000000000a2',
    techA: '10000000-0000-4000-8000-0000000000a3',
    viewerA: '10000000-0000-4000-8000-0000000000a4',
    mgrB: '10000000-0000-4000-8000-0000000000b1',
    techB: '10000000-0000-4000-8000-0000000000b3',
    adminT2: '10000000-0000-4000-8000-0000000000c2',
    maint: '10000000-0000-4000-8000-0000000000d1',
  },
  team: {
    a: '20000000-0000-4000-8000-00000000000a',
    b: '20000000-0000-4000-8000-00000000000b',
  },
  substation: { s1: '30000000-0000-4000-8000-000000000001' },
  assetType: { savr: '40000000-0000-4000-8000-000000000001' },
  template: {
    tmpl: '50000000-0000-4000-8000-000000000001',
    section: '50000000-0000-4000-8000-000000000002',
    item: '50000000-0000-4000-8000-000000000003',
  },
  visit: {
    a: '60000000-0000-4000-8000-00000000000a',
    b: '60000000-0000-4000-8000-00000000000b',
  },
  asset: {
    a: '70000000-0000-4000-8000-00000000000a',
    b: '70000000-0000-4000-8000-00000000000b',
  },
  inspection: {
    a: '80000000-0000-4000-8000-00000000000a',
    b: '80000000-0000-4000-8000-00000000000b',
  },
  itemResult: {
    a: '90000000-0000-4000-8000-00000000000a',
    b: '90000000-0000-4000-8000-00000000000b',
    routed: '90000000-0000-4000-8000-00000000000c',
  },
  defect: {
    a: 'a0000000-0000-4000-8000-00000000000a',
    b: 'a0000000-0000-4000-8000-00000000000b',
    // A defect on company A's inspection, routed to the maintenance company.
    routed: 'a0000000-0000-4000-8000-00000000000c',
  },
  // OperationalSession uses a DIFFERENT scope (company-assignment + QA-assignment,
  // not team membership): session A is assigned to company A; session B is
  // assigned to company B but names a company-A user (supA) as its QA reviewer,
  // so supA can see B through the QA branch while techA cannot.
  session: {
    a: 'b0000000-0000-4000-8000-00000000000a',
    b: 'b0000000-0000-4000-8000-00000000000b',
  },
} as const;

export const EMAILS = {
  adminT1: 'admin.t1@authz.test',
  mgrA: 'manager.a@authz.test',
  supA: 'supervisor.a@authz.test',
  techA: 'tech.a@authz.test',
  viewerA: 'viewer.a@authz.test',
  mgrB: 'manager.b@authz.test',
  techB: 'tech.b@authz.test',
  adminT2: 'admin.t2@authz.test',
  maintUser: 'maint.user@authz.test',
} as const;

/** Truncate every table in the public schema (fast, deterministic reset). */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  // HARD SAFETY GUARD — check the ACTUALLY-CONNECTED database, not just an env
  // var. The e2e suite is destructive (TRUNCATE … CASCADE); it must only ever
  // run against a throwaway database whose name contains "test". This is the
  // backstop that prevents wiping a dev/prod DB if DATABASE_URL is misresolved.
  const guard = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  const dbName = guard[0]?.db ?? '';
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to reset/seed database "${dbName}": the e2e suite only runs ` +
        `against a database whose name contains "test". Point apps/api/.env.test ` +
        `(DATABASE_URL) at a throwaway *_test database.`,
    );
  }

  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  const tables = rows
    .map((r) => r.tablename)
    .filter((name) => name !== '_prisma_migrations')
    .map((name) => `"public"."${name}"`);
  if (tables.length > 0) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE;`,
    );
  }
}

export async function seedMultiCompany(prisma: PrismaClient): Promise<void> {
  const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
  const submittedAt = new Date('2026-06-01T00:00:00.000Z');

  await prisma.tenant.createMany({
    data: [
      { id: IDS.tenant.t1, name: 'Tenant One', code: 'T1' },
      { id: IDS.tenant.t2, name: 'Tenant Two', code: 'T2' },
    ],
  });

  await prisma.organization.createMany({
    data: [
      { id: IDS.org.a, name: 'Company A', code: 'COA', type: 'MAIN_CONTRACTOR', tenantId: IDS.tenant.t1 },
      { id: IDS.org.b, name: 'Company B', code: 'COB', type: 'MAIN_CONTRACTOR', tenantId: IDS.tenant.t1 },
    ],
  });

  await prisma.user.createMany({
    data: [
      { id: IDS.user.adminT1, tenantId: IDS.tenant.t1, email: EMAILS.adminT1, name: 'Admin T1', passwordHash, role: 'ADMIN' },
      { id: IDS.user.mgrA, tenantId: IDS.tenant.t1, email: EMAILS.mgrA, name: 'Manager A', passwordHash, role: 'MANAGER', organizationId: IDS.org.a },
      { id: IDS.user.supA, tenantId: IDS.tenant.t1, email: EMAILS.supA, name: 'Supervisor A', passwordHash, role: 'SUPERVISOR', organizationId: IDS.org.a },
      { id: IDS.user.techA, tenantId: IDS.tenant.t1, email: EMAILS.techA, name: 'Tech A', passwordHash, role: 'TECHNICIAN', organizationId: IDS.org.a },
      { id: IDS.user.viewerA, tenantId: IDS.tenant.t1, email: EMAILS.viewerA, name: 'Viewer A', passwordHash, role: 'VIEWER', organizationId: IDS.org.a },
      { id: IDS.user.mgrB, tenantId: IDS.tenant.t1, email: EMAILS.mgrB, name: 'Manager B', passwordHash, role: 'MANAGER', organizationId: IDS.org.b },
      { id: IDS.user.techB, tenantId: IDS.tenant.t1, email: EMAILS.techB, name: 'Tech B', passwordHash, role: 'TECHNICIAN', organizationId: IDS.org.b },
      { id: IDS.user.adminT2, tenantId: IDS.tenant.t2, email: EMAILS.adminT2, name: 'Admin T2', passwordHash, role: 'ADMIN' },
    ],
  });

  await prisma.team.createMany({
    data: [
      { id: IDS.team.a, tenantId: IDS.tenant.t1, name: 'Team A', code: 'TA', organizationId: IDS.org.a },
      { id: IDS.team.b, tenantId: IDS.tenant.t1, name: 'Team B', code: 'TB', organizationId: IDS.org.b },
    ],
  });

  await prisma.teamMember.createMany({
    data: [
      { teamId: IDS.team.a, userId: IDS.user.techA },
      { teamId: IDS.team.a, userId: IDS.user.viewerA },
      { teamId: IDS.team.b, userId: IDS.user.techB },
    ],
  });

  await prisma.teamSupervisor.createMany({
    data: [{ teamId: IDS.team.a, supervisorUserId: IDS.user.supA }],
  });

  await prisma.substation.create({
    data: { id: IDS.substation.s1, tenantId: IDS.tenant.t1, name: 'Substation 1', code: 'PMU-1' },
  });

  await prisma.assetType.create({
    data: { id: IDS.assetType.savr, tenantId: IDS.tenant.t1, name: 'SAVR Pole', code: 'SAVR', operationalScope: 'SAVR' },
  });

  await prisma.inspectionTemplate.create({
    data: {
      id: IDS.template.tmpl,
      tenantId: IDS.tenant.t1,
      assetTypeId: IDS.assetType.savr,
      version: 1,
      name: 'SAVR Checklist',
      status: 'ACTIVE',
      isActive: true,
      scopeLevel: 'GLOBAL',
      sections: { create: [{ id: IDS.template.section, title: 'General', sortOrder: 0 }] },
    },
  });

  await prisma.inspectionTemplateItem.create({
    data: {
      id: IDS.template.item,
      templateId: IDS.template.tmpl,
      sectionId: IDS.template.section,
      key: 'pole_condition',
      label: 'Pole condition',
      inputType: 'BOOLEAN',
      isDefectTrigger: true,
      severity: 'MEDIUM',
      sortOrder: 0,
    },
  });

  await prisma.siteVisit.createMany({
    data: [
      { id: IDS.visit.a, tenantId: IDS.tenant.t1, teamId: IDS.team.a, substationId: IDS.substation.s1, createdByUserId: IDS.user.techA, organizationId: IDS.org.a, status: 'ACTIVE', lifecycleStatus: 'DALAM_RONDAAN' },
      { id: IDS.visit.b, tenantId: IDS.tenant.t1, teamId: IDS.team.b, substationId: IDS.substation.s1, createdByUserId: IDS.user.techB, organizationId: IDS.org.b, status: 'ACTIVE', lifecycleStatus: 'DALAM_RONDAAN' },
    ],
  });

  await prisma.asset.createMany({
    data: [
      { id: IDS.asset.a, tenantId: IDS.tenant.t1, substationId: IDS.substation.s1, assetTypeId: IDS.assetType.savr, assetCode: 'A-1', name: 'Pole A-1', latitude: 3.1, longitude: 101.1, createdDuringVisitId: IDS.visit.a, createdByUserId: IDS.user.techA },
      { id: IDS.asset.b, tenantId: IDS.tenant.t1, substationId: IDS.substation.s1, assetTypeId: IDS.assetType.savr, assetCode: 'B-1', name: 'Pole B-1', latitude: 3.2, longitude: 101.2, createdDuringVisitId: IDS.visit.b, createdByUserId: IDS.user.techB },
    ],
  });

  await prisma.inspection.createMany({
    data: [
      { id: IDS.inspection.a, tenantId: IDS.tenant.t1, siteVisitId: IDS.visit.a, assetId: IDS.asset.a, templateId: IDS.template.tmpl, createdByUserId: IDS.user.techA, completionStatus: 'SUBMITTED', submittedAt },
      { id: IDS.inspection.b, tenantId: IDS.tenant.t1, siteVisitId: IDS.visit.b, assetId: IDS.asset.b, templateId: IDS.template.tmpl, createdByUserId: IDS.user.techB, completionStatus: 'SUBMITTED', submittedAt },
    ],
  });

  await prisma.inspectionItemResult.createMany({
    data: [
      { id: IDS.itemResult.a, inspectionId: IDS.inspection.a, label: 'Pole condition', result: 'FAIL', isDefect: true, severity: 'MEDIUM' },
      { id: IDS.itemResult.b, inspectionId: IDS.inspection.b, label: 'Pole condition', result: 'FAIL', isDefect: true, severity: 'MEDIUM' },
    ],
  });

  await prisma.defect.createMany({
    data: [
      { id: IDS.defect.a, inspectionItemResultId: IDS.itemResult.a, status: 'OPEN', severity: 'MEDIUM', lifecycleStatus: 'VERIFIED' },
      { id: IDS.defect.b, inspectionItemResultId: IDS.itemResult.b, status: 'OPEN', severity: 'MEDIUM', lifecycleStatus: 'VERIFIED' },
    ],
  });

  await prisma.operationalSession.createMany({
    data: [
      { id: IDS.session.a, sessionNo: 'OPS-A-1', workspaceId: IDS.tenant.t1, organizationId: IDS.org.a, assignedCompanyId: IDS.org.a, scope: 'SAVR', status: 'ASSIGNED' },
      { id: IDS.session.b, sessionNo: 'OPS-B-1', workspaceId: IDS.tenant.t1, organizationId: IDS.org.b, assignedCompanyId: IDS.org.b, assignedQaUserId: IDS.user.supA, scope: 'SAVR', status: 'ASSIGNED' },
    ],
  });

  // Maintenance-handoff (RELEASE_ON_REPORT) fixture: a maintenance company + a
  // user in it + a defect on company A's SUBMITTED inspection stamped with
  // maintenanceOrganizationId = MaintCo (as if released + routed at LAPORAN
  // SELESAI). The maint-org branch of defectAccessScope should grant MaintCo
  // cross-company visibility of exactly this routed defect — and nothing else.
  await prisma.organization.create({
    data: { id: IDS.org.maint, name: 'Maintenance Co', code: 'MNT', type: 'MAIN_CONTRACTOR', tenantId: IDS.tenant.t1 },
  });
  await prisma.user.create({
    data: { id: IDS.user.maint, tenantId: IDS.tenant.t1, email: EMAILS.maintUser, name: 'Maint User', passwordHash, role: 'TECHNICIAN', organizationId: IDS.org.maint },
  });
  await prisma.inspectionItemResult.create({
    data: { id: IDS.itemResult.routed, inspectionId: IDS.inspection.a, label: 'Routed condition', result: 'FAIL', isDefect: true, severity: 'HIGH' },
  });
  await prisma.defect.create({
    data: { id: IDS.defect.routed, inspectionItemResultId: IDS.itemResult.routed, maintenanceOrganizationId: IDS.org.maint, status: 'OPEN', severity: 'HIGH', lifecycleStatus: 'VERIFIED' },
  });
}
