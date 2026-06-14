import { ForbiddenException, Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { resolveCanReport } from '../common/authorization/reporting-actor';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { UsersService } from '../users/users.service';
import { NetworkService } from '../assets/network.service';

// Same palette as the admin schematic, so the PDF reads like the on-screen view.
const FEEDER_COLORS = [
  '#2DD4BF',
  '#2563EB',
  '#9333EA',
  '#C026D3',
  '#0891B2',
  '#CA8A04',
  '#DC2626',
  '#65A30D',
];
const COL_W = 150;
const ROW_H = 56;

type LayoutPole = { id: string };
type LayoutEdge = { from: string; to: string };
type GpsPole = { id: string; latitude: number | null; longitude: number | null };
type Layout = {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
  locatedCount?: number;
};

/**
 * Tidy left-to-right tree layout from the radial (fed-from) edges — the same
 * algorithm the admin schematic uses: x = depth, y = in-order leaf position with
 * parents centred over their children. Coordinates are unscaled (0-based); the
 * caller scales them to the page.
 */
function computeTreeLayout(poles: LayoutPole[], radial: LayoutEdge[]): Layout {
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const edge of radial) {
    const existing = children.get(edge.from);
    if (existing) {
      existing.push(edge.to);
    } else {
      children.set(edge.from, [edge.to]);
    }
    hasParent.add(edge.to);
  }

  const depth = new Map<string, number>();
  const yPos = new Map<string, number>();
  let leaf = 0;
  const visit = (id: string, d: number) => {
    if (depth.has(id)) {
      return;
    }
    depth.set(id, d);
    const kids = children.get(id) ?? [];
    if (kids.length === 0) {
      yPos.set(id, leaf++);
      return;
    }
    for (const kid of kids) {
      visit(kid, d + 1);
    }
    const ys = kids.map((kid) => yPos.get(kid) ?? 0);
    yPos.set(id, (Math.min(...ys) + Math.max(...ys)) / 2);
  };
  for (const pole of poles) {
    if (!hasParent.has(pole.id)) {
      visit(pole.id, 0);
    }
  }
  for (const pole of poles) {
    if (!depth.has(pole.id)) {
      depth.set(pole.id, 0);
      yPos.set(pole.id, leaf++);
    }
  }

  const positions = new Map(
    poles.map((pole) => [
      pole.id,
      { x: (depth.get(pole.id) ?? 0) * COL_W, y: (yPos.get(pole.id) ?? 0) * ROW_H },
    ]),
  );
  const xs = [...positions.values()].map((p) => p.x);
  const ys = [...positions.values()].map((p) => p.y);
  return {
    positions,
    width: (xs.length ? Math.max(...xs) : 0) + 1,
    height: (ys.length ? Math.max(...ys) : 0) + 1,
  };
}

/**
 * Geographic pole-topology layout: poles plotted at their captured GPS (north
 * up), aspect-ratio preserved (lng compressed by cos(lat)) — the spatial truth,
 * but as a clean line drawing with NO basemap. Poles without coordinates are
 * dropped. Normalised so the caller's scale-to-fit works unchanged.
 */
function computeGpsLayout(poles: GpsPole[]): Layout {
  const located = poles.filter(
    (pole): pole is { id: string; latitude: number; longitude: number } =>
      pole.latitude != null && pole.longitude != null,
  );
  if (located.length === 0) {
    return { positions: new Map(), width: 1, height: 1, locatedCount: 0 };
  }

  const lats = located.map((pole) => pole.latitude);
  const lngs = located.map((pole) => pole.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const kx = Math.cos(midLat); // longitude compression at this latitude

  const raw = located.map((pole) => ({
    id: pole.id,
    x: (pole.longitude - minLng) * kx,
    y: maxLat - pole.latitude, // north up
  }));
  const rawW = Math.max(...raw.map((r) => r.x), 1e-9);
  const rawH = Math.max(...raw.map((r) => r.y), 1e-9);
  const k = 600 / Math.max(rawW, rawH); // normalise the largest span to ~600 units

  return {
    positions: new Map(raw.map((r) => [r.id, { x: r.x * k, y: r.y * k }])),
    width: rawW * k + 1,
    height: rawH * k + 1,
    locatedCount: located.length,
  };
}

function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

/**
 * Phase 3 (north-star §7): the network schematic — and optionally an isolation
 * highlight — as a generated, print-final PDF, drawn server-side as vectors from
 * the persisted graph (no headless browser). Reuses NetworkService for the data.
 */
@Injectable()
export class SchematicPdfService {
  constructor(
    private readonly network: NetworkService,
    private readonly usersService: UsersService,
  ) {}

  async buildSchematicPdf(
    user: RequestUser,
    substationId: string,
    feederId?: string,
    mode: 'tree' | 'gps' = 'tree',
  ): Promise<{ buffer: Buffer; filename: string }> {
    if (!(await resolveCanReport(this.usersService, user))) {
      throw new ForbiddenException(
        'Schematic export requires REPORTING authority (ADMIN or a reporting user).',
      );
    }

    const network = await this.network.getSubstationNetwork(user, substationId);
    const isolation = feederId
      ? await this.network.getFeederIsolation(user, feederId)
      : null;

    const deadIds = new Set(isolation?.deEnergized.map((pole) => pole.id) ?? []);
    const backfeedTieIds = new Set(isolation?.backfeed.map((b) => b.tieEdgeId) ?? []);
    const colorForFeeder = (code: string) => {
      const index = network.feeders.findIndex((feeder) => feeder.code === code);
      return FEEDER_COLORS[(index < 0 ? 0 : index) % FEEDER_COLORS.length];
    };

    const isGps = mode === 'gps';
    const layout = isGps
      ? computeGpsLayout(network.poles)
      : computeTreeLayout(network.poles, network.edges.radial);
    const title = isGps ? 'Pole Topology (geographic)' : 'Network Schematic';

    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 36,
      info: { Title: `${title} — ${network.substation.code}` },
    });
    const done = pdfToBuffer(doc);

    const M = 36;
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const headerH = 84;
    const footerH = 22;
    const areaX = M;
    const areaY = M + headerH;
    const areaW = pageW - 2 * M;
    const areaH = pageH - M - headerH - footerH;

    // --- Header ---
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(16).text(title, M, M);
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor('#334155')
      .text(`${network.substation.code} — ${network.substation.name}`, M, M + 22);
    doc
      .fontSize(8)
      .fillColor('#64748B')
      .text(
        isGps
          ? `Generated by ASCURE · ${layout.locatedCount ?? 0} of ${network.poles.length} poles located by GPS · ${network.edges.tie.length} NOP ties`
          : `Generated by ASCURE · ${network.poles.length} poles · ${network.edges.radial.length} spans · ${network.edges.tie.length} NOP ties`,
        M,
        M + 40,
      );
    if (isolation) {
      doc
        .fontSize(9)
        .fillColor('#B45309')
        .text(
          `Feeder ${isolation.feeder.code} OPEN — ${isolation.deEnergizedCount} pole(s) de-energized · ${isolation.backfeed.length} back-feed option(s) (amber ties)`,
          M,
          M + 53,
        );
    }
    // Feeder legend
    let legendX = M;
    const legendY = M + 67;
    doc.fontSize(8);
    for (const feeder of network.feeders) {
      doc.circle(legendX + 3, legendY + 4, 3).fill(colorForFeeder(feeder.code));
      doc.fillColor('#334155').text(feeder.code, legendX + 10, legendY, { lineBreak: false });
      legendX += 10 + doc.widthOfString(feeder.code) + 14;
    }

    if (layout.positions.size === 0) {
      doc
        .fontSize(11)
        .fillColor('#64748B')
        .text(
          isGps
            ? 'No poles have GPS coordinates for this Pencawang.'
            : 'No poles with graph structure yet for this Pencawang.',
          areaX,
          areaY + 20,
        );
      doc.end();
      const empty = await done;
      return {
        buffer: empty,
        filename: `${isGps ? 'map' : 'schematic'}-${this.safe(network.substation.code)}.pdf`,
      };
    }

    // --- Schematic (scaled to fit) ---
    const scale = Math.min(areaW / layout.width, areaH / layout.height, 1.2);
    const offX = areaX + (areaW - layout.width * scale) / 2;
    const offY = areaY + (areaH - layout.height * scale) / 2;
    const pos = (id: string) => {
      const p = layout.positions.get(id);
      return p ? { x: offX + p.x * scale, y: offY + p.y * scale } : null;
    };

    // Radial spans (solid grey)
    doc.lineWidth(1).strokeColor('#94A3B8');
    for (const edge of network.edges.radial) {
      const a = pos(edge.from);
      const b = pos(edge.to);
      if (!a || !b) continue;
      doc.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke();
    }

    // NOP ties (dashed; amber if a back-feed option under the current isolation)
    doc.dash(3, { space: 3 });
    for (const edge of network.edges.tie) {
      const a = pos(edge.from);
      const b = pos(edge.to);
      if (!a || !b) continue;
      const lit = backfeedTieIds.has(edge.id);
      doc
        .lineWidth(lit ? 1.5 : 1)
        .strokeColor(lit ? '#F59E0B' : '#CBD5E1')
        .moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .stroke();
    }
    doc.undash().lineWidth(1);

    // Poles + RONDAAN labels (red if de-energized)
    doc.font('Helvetica');
    for (const pole of network.poles) {
      const p = pos(pole.id);
      if (!p) continue;
      const dead = deadIds.has(pole.id);
      const fill = dead ? '#DC2626' : colorForFeeder(pole.feeders[0] ?? '');
      doc.circle(p.x, p.y, 4).fillAndStroke(fill, '#FFFFFF');
      doc
        .fontSize(7)
        .fillColor(dead ? '#DC2626' : '#0F172A')
        .text(pole.noTiangRondaan, p.x + 6, p.y - 3.5, { lineBreak: false });
    }

    // Footer
    doc
      .fontSize(7)
      .fillColor('#94A3B8')
      .text(
        `ASCURE · ${isGps ? 'pole topology' : 'network schematic'} · ${network.substation.code}`,
        M,
        pageH - M - 6,
        { lineBreak: false },
      );

    doc.end();
    const buffer = await done;
    const base = isGps ? 'map' : 'schematic';
    const filename = isolation
      ? `${base}-${this.safe(network.substation.code)}-isolate-${this.safe(isolation.feeder.code)}.pdf`
      : `${base}-${this.safe(network.substation.code)}.pdf`;
    return { buffer, filename };
  }

  private safe(value: string) {
    return value.replace(/[^a-zA-Z0-9_-]+/g, '_');
  }
}
