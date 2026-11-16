import { INestApplication } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { getTestPrisma } from '../utils/prisma';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';

/**
 * SAVT span distances (TNB ask 2026-11-16) + the route-key fix. Seeds TWO SAVT
 * lines that share one KOD TIANG ("UT 98") but start at different From
 * Pencawang — the prod situation (TK, KC, PBA, PUL, FLS1) — so each export must
 * keep them apart, and each line's spans come from its own poles only.
 *
 * Line A (from s1): poles 1, 2, 3, 5 at 0 / 25 / 55 / 85 m north
 *   → spans 1→2 25 m, 2→3 30 m, 3→5 30 m flagged GAP (No. Tiang 4 missing).
 * Line B (from S2): poles 1, 2 30 m apart, ~1 km away.
 */
describe('SAVT span distances + route key', () => {
  let app: INestApplication;
  let admin: string;
  let mgrB: string;

  const CODE = 'UT 98';
  const S2 = 'a5000000-0000-4000-8000-0000000000c2';
  const VISIT_A = 'a5000000-0000-4000-8000-0000000000a1';
  const VISIT_B = 'a5000000-0000-4000-8000-0000000000b1';
  const FEEDER_A = 'a5000000-0000-4000-8000-0000000000fa';
  const FEEDER_B = 'a5000000-0000-4000-8000-0000000000fb';
  const M = 1 / 111_195; // ~1 m of latitude

  // [id, line, No. Tiang, metres north, parent]
  const POLES: [string, 'A' | 'B', number, number, string | null][] = [
    ['a5000000-0000-4000-8000-0000000001a1', 'A', 1, 0, null],
    ['a5000000-0000-4000-8000-0000000001a2', 'A', 2, 25, 'a5000000-0000-4000-8000-0000000001a1'],
    ['a5000000-0000-4000-8000-0000000001a3', 'A', 3, 55, 'a5000000-0000-4000-8000-0000000001a2'],
    ['a5000000-0000-4000-8000-0000000001a5', 'A', 5, 85, 'a5000000-0000-4000-8000-0000000001a3'],
    ['a5000000-0000-4000-8000-0000000001b1', 'B', 1, 1000, null],
    ['a5000000-0000-4000-8000-0000000001b2', 'B', 2, 1030, 'a5000000-0000-4000-8000-0000000001b1'],
  ];
  const poleIds = POLES.map(([id]) => id);
  const inspectionId = (poleId: string) => poleId.replace(/1(a|b)(\d)$/, '2$1$2');

  beforeAll(async () => {
    app = await createTestApp();
    admin = await login(app, EMAILS.adminT1);
    mgrB = await login(app, EMAILS.mgrB);

    const prisma = getTestPrisma();
    await prisma.substation.create({
      data: { id: S2, tenantId: IDS.tenant.t1, name: 'Substation Span 2', code: 'PMU-S2' },
    });
    const visit = (id: string, owner: string) => ({
      id,
      tenantId: IDS.tenant.t1,
      teamId: IDS.team.a,
      substationId: owner,
      createdByUserId: IDS.user.techA,
      organizationId: IDS.org.a,
      status: 'ACTIVE' as const,
      lifecycleStatus: 'DALAM_RONDAAN' as const,
      operationalScope: 'SAVT' as const,
      routeCode: CODE,
      fromPencawangId: owner,
    });
    await prisma.siteVisit.createMany({
      data: [visit(VISIT_A, IDS.substation.s1), visit(VISIT_B, S2)],
    });
    await prisma.feeder.createMany({
      data: [
        { id: FEEDER_A, tenantId: IDS.tenant.t1, substationId: IDS.substation.s1, code: CODE, kind: 'SAVT' },
        { id: FEEDER_B, tenantId: IDS.tenant.t1, substationId: S2, code: CODE, kind: 'SAVT' },
      ],
    });
    await prisma.asset.createMany({
      data: POLES.map(([id, line, no, north]) => ({
        id,
        tenantId: IDS.tenant.t1,
        substationId: line === 'A' ? IDS.substation.s1 : S2,
        assetTypeId: IDS.assetType.savr,
        assetCode: `${CODE} ${line}${no}`,
        name: `Span pole ${line}${no}`,
        latitude: 3 + north * M,
        longitude: 103,
        createdDuringVisitId: line === 'A' ? VISIT_A : VISIT_B,
        createdByUserId: IDS.user.techA,
      })),
    });
    await prisma.poleFeederMembership.createMany({
      data: POLES.map(([id, line, no, , parent]) => ({
        assetId: id,
        feederId: line === 'A' ? FEEDER_A : FEEDER_B,
        sequenceIndex: no,
        branchSuffix: '',
        fedFromAssetId: parent,
      })),
    });
    await prisma.inspection.createMany({
      data: POLES.map(([id, line]) => ({
        id: inspectionId(id),
        tenantId: IDS.tenant.t1,
        siteVisitId: line === 'A' ? VISIT_A : VISIT_B,
        assetId: id,
        templateId: IDS.template.tmpl,
        createdByUserId: IDS.user.techA,
        completionStatus: 'SUBMITTED' as const,
        submittedAt: new Date(),
      })),
    });
  });

  afterAll(async () => {
    const prisma = getTestPrisma();
    await prisma.inspection.deleteMany({ where: { id: { in: poleIds.map(inspectionId) } } });
    await prisma.poleFeederMembership.deleteMany({ where: { assetId: { in: poleIds } } });
    await prisma.asset.deleteMany({ where: { id: { in: poleIds } } });
    await prisma.feeder.deleteMany({ where: { id: { in: [FEEDER_A, FEEDER_B] } } });
    await prisma.siteVisit.deleteMany({ where: { id: { in: [VISIT_A, VISIT_B] } } });
    await prisma.substation.deleteMany({ where: { id: S2 } });
    await app?.close();
  });

  async function sheetRows(path: string, sheetName: string): Promise<string[][]> {
    const res = await http(app, admin).get(path).expect(200).responseType('blob');
    const workbook = new Workbook();
    await workbook.xlsx.load(res.body as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet(sheetName);
    expect(sheet).toBeDefined();
    const rows: string[][] = [];
    sheet!.eachRow((row) => {
      rows.push((row.values as unknown[]).slice(1).map((cell) => String(cell ?? '')));
    });
    return rows;
  }

  it('visit spans: per-route parent distances, GAP flagged and kept out of the length', async () => {
    const res = await http(app, admin)
      .get(`/api/v1/site-visits/${VISIT_A}/savt-spans`)
      .expect(200);
    expect(res.body.feederId).toBe(FEEDER_A);
    expect(res.body.poles.map((p: { noTiang: string }) => p.noTiang)).toEqual(['1', '2', '3', '5']);
    expect(
      res.body.spans.map((s: { fromNoTiang: string; toNoTiang: string; metres: number; flag: string | null }) => [
        s.fromNoTiang,
        s.toNoTiang,
        Math.round(s.metres),
        s.flag,
      ]),
    ).toEqual([
      ['1', '2', 25, null],
      ['2', '3', 30, null],
      ['3', '5', 30, 'GAP'],
    ]);
    expect(res.body.spans[2].missing).toEqual([4, 4]);
    expect(res.body.summary).toMatchObject({ poleCount: 4, spanCount: 2, gapCount: 1, flaggedCount: 1 });
    expect(Math.round(res.body.summary.measuredLength)).toBe(55);
    expect(res.body.thresholds).toEqual({ shortMetres: 5, longMinMetres: 60, longMedianFactor: 2.5 });
  });

  it('visit spans: the other line with the same code only sees its own poles', async () => {
    const res = await http(app, admin)
      .get(`/api/v1/site-visits/${VISIT_B}/savt-spans`)
      .expect(200);
    expect(res.body.feederId).toBe(FEEDER_B);
    expect(res.body.spans).toHaveLength(1);
    expect(Math.round(res.body.spans[0].metres)).toBe(30);
  });

  it('visit spans: 400 for a non-SAVT visit, 404 outside scope', async () => {
    await http(app, admin).get(`/api/v1/site-visits/${IDS.visit.a}/savt-spans`).expect(400);
    await http(app, mgrB).get(`/api/v1/site-visits/${VISIT_A}/savt-spans`).expect(404);
  });

  it('route selector lists the two lines separately, each with its span totals', async () => {
    const res = await http(app, admin).get('/api/v1/reports/savt-routes').expect(200);
    const lines = (res.body as { routeKey: string; routeCode: string; poleCount: number; spanSummary: { measuredLength: number; gapCount: number } | null }[])
      .filter((route) => route.routeCode === CODE);
    expect(lines.map((route) => route.routeKey).sort()).toEqual(
      [`${IDS.substation.s1}:${CODE}`, `${S2}:${CODE}`].sort(),
    );
    const a = lines.find((route) => route.routeKey.startsWith(IDS.substation.s1))!;
    const b = lines.find((route) => route.routeKey.startsWith(S2))!;
    expect(a.poleCount).toBe(4);
    expect(b.poleCount).toBe(2);
    expect(Math.round(a.spanSummary!.measuredLength)).toBe(55);
    expect(a.spanSummary!.gapCount).toBe(1);
    expect(Math.round(b.spanSummary!.measuredLength)).toBe(30);
  });

  it('per-route checklist: one line only, with JARAK SPAN + SEMAKAN SPAN', async () => {
    const key = encodeURIComponent(`${IDS.substation.s1}:${CODE}`);
    const rows = await sheetRows(`/api/v1/reports/savt-route/checklist.xlsx?routeKey=${key}`, 'CHECKLIST');
    const header = rows.find((row) => row.includes('JARAK SPAN (m)'))!;
    expect(header).toBeDefined();
    const noCol = header.indexOf('No. Tiang');
    const spanCol = header.indexOf('JARAK SPAN (m)');
    expect(header[spanCol + 1]).toBe('SEMAKAN SPAN');
    expect(header[spanCol - 1]).toBe('NO TIANG LAMA'); // end of the meta block
    const data = rows.filter((row) => row.includes(CODE));
    expect(data.map((row) => [row[noCol], row[spanCol] === '' ? '' : String(Math.round(Number(row[spanCol]))), row[spanCol + 1]])).toEqual([
      ['1', '', ''],
      ['2', '25', ''],
      ['3', '30', ''],
      ['5', '30', 'GAP - No. Tiang 4 not recorded'],
    ]);
  });

  it('per-route checklist: a bare code (old links) still returns every pole with that code', async () => {
    const rows = await sheetRows(
      `/api/v1/reports/savt-route/checklist.xlsx?routeCode=${encodeURIComponent(CODE)}`,
      'CHECKLIST',
    );
    expect(rows.filter((row) => row.includes(CODE))).toHaveLength(6);
  });

  it('route list export: selection by route key + span total columns', async () => {
    const rows = await sheetRows(
      `/api/v1/reports/savt-route-list.xlsx?ids=${encodeURIComponent(`${S2}:${CODE}`)}`,
      'SAVT ROUTES',
    );
    expect(rows).toHaveLength(2);
    const header = rows[0];
    expect(header.slice(10)).toEqual([
      'JUMLAH PANJANG (m)',
      'BIL SPAN',
      'SPAN TERPANJANG (m)',
      'SPAN DITANDA',
      'JURANG No. Tiang (m)',
    ]);
    const row = rows[1];
    expect(row[1]).toBe(CODE);
    expect(row[2]).toBe('Substation Span 2');
    expect(Math.round(Number(row[10]))).toBe(30);
    expect(row[11]).toBe('1');
    expect(row[13]).toBe('0');
    expect(row[14]).toBe('');
  });

  it('bulk checklist: selected route keys narrow to that line', async () => {
    const rows = await sheetRows(
      `/api/v1/reports/bulk-checklist.xlsx?scope=SAVT&ids=${encodeURIComponent(`${IDS.substation.s1}:${CODE}`)}`,
      'CHECKLIST',
    );
    expect(rows.filter((row) => row.includes(CODE))).toHaveLength(4);
  });
});
