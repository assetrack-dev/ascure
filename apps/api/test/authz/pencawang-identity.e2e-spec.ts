import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';

/**
 * A survey's Kod / Nama Pencawang / Functional Location are a COPY of its
 * Pencawang's. They change on the Pencawang page (which carries a rename onto
 * every visit) — never on the survey, or the survey and the Pencawang list /
 * checklist / QR exports drift apart (2026-10: visit "PE KG BUDAYA" vs Pencawang
 * "KGBU KG BUDAYA").
 *
 *  - check-in at an existing Pencawang copies the record, ignoring typed values,
 *  - a survey edit that really changes those fields is refused (400),
 *  - the values a v2.0.20 phone sends back unchanged (the visit's copy or the
 *    record's, any case/spacing) are a no-op, so the rest of the edit saves.
 */
describe('Authz · survey Pencawang identity follows the Pencawang', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};

  const SUB = '30000000-0000-4000-8000-00000000f001';
  const DRIFTED_VISIT = '40000000-0000-4000-8000-00000000f001';
  const RECORD = { code: 'PMU-IDENT-A', name: 'PENCAWANG IDENTITY', location: 'CKTN/PCE/J09999' };
  // A second Pencawang for the check-in test (no active visit there yet).
  const CHECKIN_SUB = '30000000-0000-4000-8000-00000000f002';
  const CHECKIN_RECORD = { code: 'PMU-IDENT-B', name: 'PENCAWANG IDENTITY CHECKIN', location: 'CKTN/PCE/J09998' };
  const MAINHEAD = 'e0000000-0000-4000-8000-0000000000f1';
  const createdVisitIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    token.techA = await login(app, EMAILS.techA);
    token.admin = await login(app, EMAILS.adminT1);

    await prisma.mainhead.upsert({
      where: { id: MAINHEAD },
      create: { id: MAINHEAD, name: 'MH IDENTITY TEST' },
      update: {},
    });
    await prisma.substation.upsert({
      where: { id: SUB },
      create: { id: SUB, tenantId: IDS.tenant.t1, ...RECORD },
      update: RECORD,
    });
    await prisma.substation.upsert({
      where: { id: CHECKIN_SUB },
      create: { id: CHECKIN_SUB, tenantId: IDS.tenant.t1, ...CHECKIN_RECORD },
      update: CHECKIN_RECORD,
    });
    // A visit whose copy already drifted (the pre-fix state in prod).
    await prisma.siteVisit.upsert({
      where: { id: DRIFTED_VISIT },
      create: {
        id: DRIFTED_VISIT,
        tenantId: IDS.tenant.t1,
        teamId: IDS.team.a,
        substationId: SUB,
        createdByUserId: IDS.user.techA,
        organizationId: IDS.org.a,
        status: 'ACTIVE',
        lifecycleStatus: 'DALAM_RONDAAN',
        pencawangCode: RECORD.code,
        pencawangName: 'PE IDENTITY DRIFTED',
        functionalLocation: null,
        users: { create: [{ userId: IDS.user.techA }] },
      },
      update: { pencawangName: 'PE IDENTITY DRIFTED', functionalLocation: null, notes: null },
    });
  });

  afterAll(async () => {
    const ids = [DRIFTED_VISIT, ...createdVisitIds];
    await prisma.siteVisit.deleteMany({ where: { id: { in: ids } } });
    await prisma.substation.deleteMany({ where: { id: { in: [SUB, CHECKIN_SUB] } } });
    await prisma.mainhead.deleteMany({ where: { id: MAINHEAD } });
    await app?.close();
  });

  it('check-in at an existing Pencawang copies the record, not the typed values', async () => {
    const res = await http(app, token.techA)
      .post('/api/v1/site-visits')
      .send({
        teamId: IDS.team.a,
        mainheadId: MAINHEAD,
        substationId: CHECKIN_SUB,
        pencawangCode: 'TYPED-CODE',
        pencawangName: 'PE TYPED BY CREW',
        functionalLocation: 'TYPED FL',
      });
    expect(res.status === 201 ? 201 : res.body).toBe(201); // body shown on failure
    createdVisitIds.push(res.body.id);
    expect(res.body.pencawangCode).toBe(CHECKIN_RECORD.code);
    expect(res.body.pencawangName).toBe(CHECKIN_RECORD.name);
    expect(res.body.functionalLocation).toBe(CHECKIN_RECORD.location);
  });

  it('a survey edit that renames the Pencawang is refused and changes nothing', async () => {
    const res = await http(app, token.techA)
      .patch(`/api/v1/site-visits/${DRIFTED_VISIT}`)
      .send({ pencawangName: 'PE SOMETHING ELSE', notes: 'should not save' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Nama Pencawang/);
    expect(res.body.message).toMatch(/halaman Pencawang/);

    const visit = await prisma.siteVisit.findUniqueOrThrow({ where: { id: DRIFTED_VISIT } });
    expect(visit.pencawangName).toBe('PE IDENTITY DRIFTED');
    expect(visit.notes).toBeNull();
  });

  it('a changed Kod or Functional Location is refused too', async () => {
    await http(app, token.techA)
      .patch(`/api/v1/site-visits/${DRIFTED_VISIT}`)
      .send({ pencawangCode: 'PMU-OTHER' })
      .expect(400);
    await http(app, token.techA)
      .patch(`/api/v1/site-visits/${DRIFTED_VISIT}`)
      .send({ functionalLocation: 'SOMEWHERE ELSE' })
      .expect(400);
  });

  it('the unchanged values a v2.0.20 phone sends back are a no-op — the rest saves', async () => {
    // The visit's own (drifted) copy, odd case/spacing, and a blank FL for a null one.
    await http(app, token.techA)
      .patch(`/api/v1/site-visits/${DRIFTED_VISIT}`)
      .send({
        pencawangName: '  pe identity   drifted ',
        functionalLocation: '',
        mainhead: 'MH IDENT',
        notes: 'notes saved',
      })
      .expect(200);

    let visit = await prisma.siteVisit.findUniqueOrThrow({ where: { id: DRIFTED_VISIT } });
    expect(visit.pencawangName).toBe('PE IDENTITY DRIFTED');
    expect(visit.functionalLocation).toBeNull();
    expect(visit.notes).toBe('notes saved');
    expect(visit.mainhead).toBe('MH IDENT');

    // The record's own values are accepted as well (and still change nothing).
    await http(app, token.techA)
      .patch(`/api/v1/site-visits/${DRIFTED_VISIT}`)
      .send({ pencawangName: RECORD.name, functionalLocation: RECORD.location, notes: 'again' })
      .expect(200);
    visit = await prisma.siteVisit.findUniqueOrThrow({ where: { id: DRIFTED_VISIT } });
    expect(visit.pencawangName).toBe('PE IDENTITY DRIFTED');
    expect(visit.notes).toBe('again');
  });

  // Runs last: it repairs the drifted copy the tests above rely on.
  it('saving the Pencawang page with its unchanged name repairs a drifted survey copy', async () => {
    await http(app, token.admin)
      .patch(`/api/v1/substations/${SUB}`)
      .send({ code: RECORD.code, name: RECORD.name })
      .expect(200);
    const visit = await prisma.siteVisit.findUniqueOrThrow({ where: { id: DRIFTED_VISIT } });
    expect(visit.pencawangName).toBe(RECORD.name);
    expect(visit.pencawangCode).toBe(RECORD.code);
  });
});
