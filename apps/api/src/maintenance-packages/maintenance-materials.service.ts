import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MaintenanceCategory, Prisma, UserRole } from '@prisma/client';
import { Workbook, type Worksheet } from 'exceljs';
import { buildScopeContext } from '../common/authorization/scope-context';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { MaintenanceWorkService } from './maintenance-work.service';
import { loadMaterialCatalog, replaceDefectMaterials } from './maintenance-materials.util';

const CATEGORY_LABEL: Record<MaintenanceCategory, string> = {
  RENTIS: 'Rentis',
  CAT_TIANG: 'Cat tiang',
  SELENGGARAAN: 'Selenggaraan',
};
const MYT_MS = 8 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-10-11" → the MYT day's start (UTC instant). */
function mytDayStart(value: string): Date {
  return new Date(Date.parse(`${value}T00:00:00Z`) - MYT_MS);
}

function mytDate(value: Date): string {
  return new Date(value.getTime() + MYT_MS).toISOString().slice(0, 10);
}

/**
 * Materials used per repaired Kejanggalan (TNB feedback #1). Owner rules
 * (2026-10-11): optional; the crew (app) or the contractor office (web) may set
 * or correct them at any time, even after TNB verification. Who may write = who
 * works the Kejanggalan: the crew's team / the company's Manager (a Main
 * Contractor's Manager includes its subcontractors), or an ADMIN.
 */
@Injectable()
export class MaintenanceMaterialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly work: MaintenanceWorkService,
  ) {}

  catalog() {
    return loadMaterialCatalog(this.prisma);
  }

  async setDefectMaterials(
    user: RequestUser,
    defectId: string,
    items: Array<{ materialId: string; quantity: number }>,
  ) {
    const defect = await this.prisma.defect.findFirst({
      where: { id: defectId, inspectionItemResult: { inspection: { tenantId: user.tenantId } } },
      select: { id: true },
    });
    if (!defect) {
      throw new NotFoundException('Kejanggalan not found.');
    }
    if (user.role !== UserRole.ADMIN && !(await this.work.isInWorkScope(user, defectId))) {
      throw new ForbiddenException('Only the company repairing this Kejanggalan can record its materials.');
    }
    const materials = await this.prisma.$transaction((tx) =>
      replaceDefectMaterials(tx, defectId, items, user.id),
    );
    return { defectId, materials };
  }

  /**
   * The contractor's claim summary (owner 2026-10-11: three views): per
   * Pencawang, per-period total per company, and every Kejanggalan's detail.
   * Rows = Kejanggalan repaired (maintainedAt, MYT) in [from, to] that carry
   * materials. Scope: ADMIN all; TNB its Mainheads; a contractor its own company
   * (a Manager: plus its subcontractors).
   */
  async buildSummary(
    user: RequestUser,
    query: { from?: string; to?: string; organizationId?: string },
  ): Promise<{ buffer: Buffer; filename: string }> {
    const today = mytDate(new Date());
    const from = query.from?.trim() || `${today.slice(0, 8)}01`;
    const to = query.to?.trim() || today;
    if (!DATE_ONLY.test(from) || !DATE_ONLY.test(to) || from > to) {
      throw new BadRequestException('Use a date range like from=2026-10-01&to=2026-10-31.');
    }
    const start = mytDayStart(from);
    const end = new Date(mytDayStart(to).getTime() + 24 * 60 * 60 * 1000);

    const scope = await this.summaryScope(user, query.organizationId?.trim() || null);
    const defects = await this.prisma.defect.findMany({
      where: {
        AND: [
          scope,
          { maintainedAt: { gte: start, lt: end } },
          { materials: { some: {} } },
          { inspectionItemResult: { inspection: { tenantId: user.tenantId } } },
        ],
      },
      orderBy: { maintainedAt: 'asc' },
      select: {
        id: true,
        maintenanceCategory: true,
        lifecycleStatus: true,
        status: true,
        maintainedAt: true,
        maintenanceOrganization: { select: { name: true } },
        assignedToTeam: { select: { name: true } },
        assignedTeam: { select: { name: true } },
        materials: {
          select: { quantity: true, material: { select: { catalogueNo: true, description: true, unit: true } } },
        },
        inspectionItemResult: {
          select: {
            label: true,
            inspection: {
              select: {
                asset: { select: { assetCode: true, noTiangLama: true } },
                siteVisit: {
                  select: {
                    pencawangName: true,
                    pencawangCode: true,
                    mainheadRecord: { select: { name: true } },
                    substation: { select: { name: true, code: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    type Line = {
      company: string;
      team: string;
      mainhead: string;
      pencawang: string;
      pole: string;
      lama: string;
      workType: string;
      label: string;
      repairedOn: string;
      status: string;
      catalogueNo: string;
      description: string;
      unit: string;
      quantity: number;
    };
    const lines: Line[] = defects.flatMap((defect) => {
      const inspection = defect.inspectionItemResult.inspection;
      const visit = inspection.siteVisit;
      const closed =
        defect.lifecycleStatus === 'CLOSED' || defect.status === 'CLOSED' || defect.status === 'RESOLVED';
      return defect.materials.map((row) => ({
        company: defect.maintenanceOrganization?.name ?? '—',
        team: defect.assignedToTeam?.name ?? defect.assignedTeam?.name ?? '',
        mainhead: visit.mainheadRecord?.name ?? '',
        pencawang: visit.substation?.name ?? visit.pencawangName ?? visit.pencawangCode ?? '',
        pole: inspection.asset.assetCode,
        lama: inspection.asset.noTiangLama ?? '',
        workType: CATEGORY_LABEL[defect.maintenanceCategory ?? MaintenanceCategory.SELENGGARAAN],
        label: defect.inspectionItemResult.label,
        repairedOn: defect.maintainedAt ? mytDate(defect.maintainedAt) : '',
        status: closed ? 'Ditutup' : 'Menunggu pengesahan',
        catalogueNo: row.material.catalogueNo,
        description: row.material.description,
        unit: row.material.unit,
        quantity: row.quantity.toNumber(),
      }));
    });

    const workbook = new Workbook();
    workbook.creator = 'ASCURE';
    workbook.created = new Date();
    const subtitle = `Tempoh pembaikan: ${from} hingga ${to}   |   Dijana: ${mytDate(new Date())}`;
    const addSheet = (name: string, title: string, headers: Array<{ header: string; width: number }>) => {
      const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 3 }] });
      sheet.columns = headers.map((column) => ({ width: column.width }));
      sheet.getCell('A1').value = title;
      sheet.getCell('A1').font = { bold: true, size: 13 };
      sheet.getCell('A2').value = subtitle;
      sheet.getCell('A2').font = { italic: true, color: { argb: 'FF566373' } };
      const head = sheet.getRow(3);
      headers.forEach((column, index) => {
        const cell = head.getCell(index + 1);
        cell.value = column.header;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
        cell.alignment = { vertical: 'middle', wrapText: true };
      });
      return sheet;
    };
    const quantityFormat = (sheet: Worksheet, column: number) => {
      sheet.getColumn(column).numFmt = '#,##0.###';
    };
    const sum = <K extends string>(rows: Line[], key: (line: Line) => K) => {
      const totals = new Map<K, { line: Line; quantity: number; defects: Set<string> }>();
      rows.forEach((line, index) => {
        const group = key(line);
        const total = totals.get(group) ?? { line, quantity: 0, defects: new Set<string>() };
        total.quantity = Number((total.quantity + line.quantity).toFixed(3));
        total.defects.add(`${line.pole}|${line.label}|${index}`);
        totals.set(group, total);
      });
      return [...totals.values()];
    };

    // 1) Per Pencawang — each Pencawang × each material.
    const perPe = addSheet('Per Pencawang', 'RINGKASAN BAHAN DIGUNAKAN — PER PENCAWANG', [
      { header: 'SYARIKAT', width: 30 },
      { header: 'MAINHEAD', width: 16 },
      { header: 'PENCAWANG', width: 36 },
      { header: 'NO KATALOG', width: 13 },
      { header: 'KETERANGAN', width: 44 },
      { header: 'UNIT', width: 8 },
      { header: 'KUANTITI', width: 11 },
    ]);
    sum(lines, (line) => `${line.company}|${line.pencawang}|${line.catalogueNo}`)
      .sort(
        (left, right) =>
          left.line.company.localeCompare(right.line.company) ||
          left.line.pencawang.localeCompare(right.line.pencawang) ||
          left.line.description.localeCompare(right.line.description),
      )
      .forEach(({ line, quantity }) =>
        perPe.addRow([line.company, line.mainhead, line.pencawang, line.catalogueNo, line.description, line.unit, quantity]),
      );
    quantityFormat(perPe, 7);

    // 2) Per period — each company's total of each material.
    const perPeriod = addSheet('Jumlah Tempoh', 'RINGKASAN BAHAN DIGUNAKAN — JUMLAH TEMPOH', [
      { header: 'SYARIKAT', width: 30 },
      { header: 'NO KATALOG', width: 13 },
      { header: 'KETERANGAN', width: 44 },
      { header: 'UNIT', width: 8 },
      { header: 'KUANTITI', width: 11 },
      { header: 'BIL. KEJANGGALAN', width: 16 },
    ]);
    sum(lines, (line) => `${line.company}|${line.catalogueNo}`)
      .sort(
        (left, right) =>
          left.line.company.localeCompare(right.line.company) ||
          left.line.description.localeCompare(right.line.description),
      )
      .forEach(({ line, quantity, defects: count }) =>
        perPeriod.addRow([line.company, line.catalogueNo, line.description, line.unit, quantity, count.size]),
      );
    quantityFormat(perPeriod, 5);

    // 3) Per Kejanggalan — the full audit list.
    const detail = addSheet('Butiran Kejanggalan', 'BAHAN DIGUNAKAN — BUTIRAN KEJANGGALAN', [
      { header: 'SYARIKAT', width: 28 },
      { header: 'PASUKAN', width: 18 },
      { header: 'MAINHEAD', width: 14 },
      { header: 'PENCAWANG', width: 32 },
      { header: 'NO TIANG', width: 14 },
      { header: 'NO TIANG LAMA', width: 14 },
      { header: 'JENIS KERJA', width: 13 },
      { header: 'KEJANGGALAN', width: 40 },
      { header: 'TARIKH DIBAIKI', width: 13 },
      { header: 'STATUS', width: 18 },
      { header: 'NO KATALOG', width: 13 },
      { header: 'KETERANGAN', width: 40 },
      { header: 'UNIT', width: 8 },
      { header: 'KUANTITI', width: 11 },
    ]);
    for (const line of lines) {
      detail.addRow([
        line.company,
        line.team,
        line.mainhead,
        line.pencawang,
        line.pole,
        line.lama,
        line.workType,
        line.label,
        line.repairedOn,
        line.status,
        line.catalogueNo,
        line.description,
        line.unit,
        line.quantity,
      ]);
    }
    quantityFormat(detail, 14);
    if (lines.length === 0) {
      for (const sheet of [perPe, perPeriod, detail]) {
        sheet.addRow(['Tiada bahan direkodkan untuk Kejanggalan yang dibaiki dalam tempoh ini.']);
      }
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { buffer, filename: `Ringkasan_Bahan_${from}_${to}.xlsx` };
  }

  /** Which Kejanggalan the caller's summary may include. */
  private async summaryScope(user: RequestUser, organizationId: string | null): Promise<Prisma.DefectWhereInput> {
    if (user.role === UserRole.ADMIN) {
      return organizationId ? { maintenanceOrganizationId: organizationId } : { maintenanceOrganizationId: { not: null } };
    }
    const ctx = await buildScopeContext(this.prisma, user);
    if (ctx.isClientViewer) {
      return {
        AND: [
          organizationId ? { maintenanceOrganizationId: organizationId } : { maintenanceOrganizationId: { not: null } },
          { inspectionItemResult: { inspection: { siteVisit: { mainheadId: { in: ctx.clientMainheadIds } } } } },
        ],
      };
    }
    if (
      !user.organizationId ||
      (user.role !== UserRole.MANAGER && user.role !== UserRole.SUPERVISOR)
    ) {
      throw new ForbiddenException('The materials summary is for contractor managers / supervisors, TNB and admins.');
    }
    const own = user.role === UserRole.MANAGER && ctx.maintenanceOrgIds.length > 0 ? ctx.maintenanceOrgIds : [user.organizationId];
    if (organizationId && !own.includes(organizationId)) {
      throw new ForbiddenException('You can only download your own company’s materials.');
    }
    return { maintenanceOrganizationId: { in: organizationId ? [organizationId] : own } };
  }
}
