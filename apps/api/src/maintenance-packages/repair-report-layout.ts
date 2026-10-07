import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, degrees, rgb } from 'pdf-lib';
import type { RGB } from 'pdf-lib';
import {
  ASCURE_LOGO_PNG_BASE64,
  TNB_LOGO_PNG_BASE64,
} from '../report-generation/defect-report-assets';

/**
 * Pure layout for the "Laporan Pembaikan Kejanggalan" — the per-Pencawang,
 * per-company repair report for the contractor's claim
 * (docs/PLAN-maintenance-flow.md §8 / §16). Same Kad Kerja look as the
 * Laporan Kejanggalan: branded title block on every page, a status summary
 * strip, then one bordered card per Kejanggalan — pole + GPS + work type +
 * A/B/C + status, the Kejanggalan text, who repaired / verified it and when,
 * and its BEFORE / DURING / AFTER photos with captions. Watermarked DRAF until
 * every Kejanggalan is closed. Callers pass a WinAnsi sanitiser (StandardFonts
 * throw outside cp1252).
 */

export type RepairCategory = 'A' | 'B' | 'C';
export type RepairStatus = 'CLOSED' | 'AWAITING' | 'IN_PROGRESS' | 'TODO' | 'CANNOT_REPAIR';
export type RepairStage = 'BEFORE' | 'DURING' | 'AFTER';

export interface RepairReportPhoto {
  data: Buffer;
  format: 'jpeg' | 'png';
  stage: RepairStage;
  /** Pre-formatted capture time (may be empty). */
  takenAt: string;
}

export interface RepairReportItem {
  assetCode: string;
  gps: string;
  workType: string;
  category: RepairCategory;
  status: RepairStatus;
  label: string;
  /** Extra lines under the label: remark, finding note, cannot-repair reason. */
  notes: string[];
  /** Who did / signed off the work, already worded ("Dibaiki: …", "Disahkan: …"). */
  who: string[];
  photos: RepairReportPhoto[];
}

export interface RepairReportSection {
  title: string;
  items: RepairReportItem[];
}

export interface RepairReportInput {
  pencawangName: string;
  functionalLocation: string;
  mainhead: string;
  company: string;
  teams: string;
  scope: string;
  targetDate: string;
  generatedAt: string;
  draft: boolean;
  counts: Record<RepairStatus, number>;
  sections: RepairReportSection[];
  sanitize: (value: string) => string;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 36;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const LOGO_HEIGHT = 34;
const TNB_LOGO_HEIGHT = 26;
const TITLE_SIZE = 12.5;

const CARD_BAND_HEIGHT = 20;
const CARD_PAD = 9;
const PHOTO_BOX_HEIGHT = 112;
const PHOTO_CAPTION_HEIGHT = 11;
const PHOTO_GAP = 7;
const PHOTOS_PER_ROW = 4;
const CARD_GAP = 10;
const FOOTER_SPACE = 22;
const TEXT_SIZE = 9.5;
const NOTE_SIZE = 8.5;
const LINE_HEIGHT = 11;

const NAVY = rgb(0.122, 0.22, 0.392);
const BAND_FILL = rgb(0.957, 0.965, 0.973);
const CHIP_FILL = rgb(0.933, 0.941, 0.953);
const BORDER = rgb(0.796, 0.824, 0.851);
const MUTED = rgb(0.4, 0.44, 0.52);
const FAINT = rgb(0.596, 0.635, 0.702);
const INK = rgb(0.102, 0.125, 0.173);
const WHITE = rgb(1, 1, 1);
const CATEGORY_FILL: Record<RepairCategory, RGB> = {
  A: rgb(0.937, 0.267, 0.267),
  B: rgb(0.98, 0.8, 0.082),
  C: rgb(0.133, 0.773, 0.369),
};
const CATEGORY_TEXT: Record<RepairCategory, RGB> = { A: WHITE, B: INK, C: WHITE };

export const STATUS_LABEL: Record<RepairStatus, string> = {
  CLOSED: 'DITUTUP',
  AWAITING: 'MENUNGGU PENGESAHAN',
  IN_PROGRESS: 'DALAM PEMBAIKAN',
  TODO: 'BELUM DIBAIKI',
  CANNOT_REPAIR: 'TIDAK DAPAT DIBAIKI',
};
const STATUS_FILL: Record<RepairStatus, RGB> = {
  CLOSED: rgb(0.086, 0.639, 0.29),
  AWAITING: rgb(0.145, 0.388, 0.922),
  IN_PROGRESS: rgb(0.851, 0.541, 0.043),
  TODO: rgb(0.863, 0.149, 0.149),
  CANNOT_REPAIR: rgb(0.392, 0.455, 0.545),
};
const STAGE_LABEL: Record<RepairStage, string> = {
  BEFORE: 'SEBELUM',
  DURING: 'SEMASA',
  AFTER: 'SELEPAS',
};
const STATUS_ORDER: RepairStatus[] = ['CLOSED', 'AWAITING', 'IN_PROGRESS', 'TODO', 'CANNOT_REPAIR'];

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  const width = (value: string) => font.widthOfTextAtSize(value, size);
  for (let word of words) {
    while (width(word) > maxWidth && word.length > 1) {
      if (current) {
        lines.push(current);
        current = '';
      }
      let cut = word.length - 1;
      while (cut > 1 && width(word.slice(0, cut)) > maxWidth) cut -= 1;
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const candidate = current ? `${current} ${word}` : word;
    if (width(candidate) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function renderRepairReportPdf(input: RepairReportInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const ascureLogo = await doc.embedPng(Buffer.from(ASCURE_LOGO_PNG_BASE64, 'base64'));
  const tnbLogo = await doc.embedPng(Buffer.from(TNB_LOGO_PNG_BASE64, 'base64'));
  const s = input.sanitize;

  const drawChip = (
    page: PDFPage,
    x: number,
    yTop: number,
    text: string,
    fill: RGB,
    color: RGB,
    size: number,
    height: number,
  ): number => {
    const chipWidth = bold.widthOfTextAtSize(text, size) + 10;
    page.drawRectangle({ x, y: yTop - height, width: chipWidth, height, color: fill });
    page.drawText(text, {
      x: x + 5,
      y: yTop - height + (height - size) / 2 + size * 0.08,
      size,
      font: bold,
      color,
    });
    return chipWidth;
  };

  const drawPageHeader = (page: PDFPage): number => {
    let y = PAGE_HEIGHT - MARGIN;
    const ascureWidth = (ascureLogo.width / ascureLogo.height) * LOGO_HEIGHT;
    page.drawImage(ascureLogo, { x: MARGIN, y: y - LOGO_HEIGHT, width: ascureWidth, height: LOGO_HEIGHT });
    const tnbWidth = (tnbLogo.width / tnbLogo.height) * TNB_LOGO_HEIGHT;
    page.drawImage(tnbLogo, {
      x: PAGE_WIDTH - MARGIN - tnbWidth,
      y: y - LOGO_HEIGHT + (LOGO_HEIGHT - TNB_LOGO_HEIGHT) / 2,
      width: tnbWidth,
      height: TNB_LOGO_HEIGHT,
    });
    const title = 'LAPORAN PEMBAIKAN KEJANGGALAN';
    page.drawText(title, {
      x: (PAGE_WIDTH - bold.widthOfTextAtSize(title, TITLE_SIZE)) / 2,
      y: y - LOGO_HEIGHT / 2 - TITLE_SIZE / 2 + 2,
      size: TITLE_SIZE,
      font: bold,
      color: NAVY,
    });
    y -= LOGO_HEIGHT + 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1.2, color: NAVY });
    y -= 14;

    // Identity: Pencawang + FL left, Mainhead right.
    const name = s(input.pencawangName);
    page.drawText(name, { x: MARGIN, y: y - 4, size: 10, font: bold, color: INK });
    if (input.functionalLocation) {
      page.drawText(s(input.functionalLocation), {
        x: MARGIN + bold.widthOfTextAtSize(name, 10) + 12,
        y: y - 4,
        size: 8.5,
        font,
        color: MUTED,
      });
    }
    if (input.mainhead) {
      const mainhead = s(`Mainhead ${input.mainhead}`);
      page.drawText(mainhead, {
        x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(mainhead, 8),
        y: y - 4,
        size: 8,
        font,
        color: MUTED,
      });
    }
    y -= 15;

    // Company / teams / scope / target.
    const meta = [
      `Syarikat: ${input.company}`,
      input.teams ? `Pasukan: ${input.teams}` : null,
      `Skop: ${input.scope}`,
      input.targetDate ? `Tarikh sasaran: ${input.targetDate}` : null,
    ]
      .filter(Boolean)
      .join('   |   ');
    for (const line of wrapText(s(meta), font, 8.5, CONTENT_WIDTH)) {
      page.drawText(line, { x: MARGIN, y: y - 4, size: 8.5, font, color: INK });
      y -= 11;
    }
    y -= 4;

    // Status summary strip.
    let chipX = MARGIN;
    const total = STATUS_ORDER.reduce((sum, status) => sum + input.counts[status], 0);
    chipX += drawChip(page, chipX, y, `${total} KEJANGGALAN`, CHIP_FILL, INK, 8, 14) + 6;
    for (const status of STATUS_ORDER) {
      if (input.counts[status] > 0) {
        chipX +=
          drawChip(page, chipX, y, `${input.counts[status]} ${STATUS_LABEL[status]}`, STATUS_FILL[status], WHITE, 8, 14) + 6;
      }
    }
    y -= 14;
    return y - 12;
  };

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursorY = drawPageHeader(page);
  const bottomLimit = MARGIN + FOOTER_SPACE;
  const newPage = () => {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    cursorY = drawPageHeader(page);
  };

  const textWidth = CONTENT_WIDTH - CARD_PAD * 2;
  const boxWidth = (CONTENT_WIDTH - CARD_PAD * 2 - PHOTO_GAP * (PHOTOS_PER_ROW - 1)) / PHOTOS_PER_ROW;

  for (const section of input.sections) {
    if (section.items.length === 0) continue;
    // Section heading (kept with at least the start of its first card).
    if (cursorY - bottomLimit < 120) newPage();
    const heading = s(`${section.title} (${section.items.length})`);
    page.drawText(heading, { x: MARGIN, y: cursorY - 10, size: 10.5, font: bold, color: NAVY });
    cursorY -= 18;

    for (const item of section.items) {
      const embedded: Array<{ image: PDFImage; caption: string }> = [];
      for (const photo of item.photos) {
        try {
          const image = photo.format === 'png' ? await doc.embedPng(photo.data) : await doc.embedJpg(photo.data);
          embedded.push({
            image,
            caption: s([STAGE_LABEL[photo.stage], photo.takenAt].filter(Boolean).join('  ')),
          });
        } catch {
          // An undecodable photo never blocks the report.
        }
      }

      const labelLines = wrapText(s(item.label), bold, TEXT_SIZE, textWidth);
      const noteLines = item.notes.flatMap((note) => wrapText(s(note), font, NOTE_SIZE, textWidth));
      const whoText = item.who.length ? wrapText(s(item.who.join('     ')), font, NOTE_SIZE, textWidth) : [];
      const textHeight = (labelLines.length + noteLines.length + whoText.length) * LINE_HEIGHT + 4;
      const photoRows = Math.ceil(embedded.length / PHOTOS_PER_ROW);
      const photoHeight = photoRows * (PHOTO_BOX_HEIGHT + PHOTO_CAPTION_HEIGHT + PHOTO_GAP);
      const emptyPhotoHeight = embedded.length === 0 ? LINE_HEIGHT + 4 : 0;
      const cardHeight = CARD_BAND_HEIGHT + CARD_PAD + textHeight + photoHeight + emptyPhotoHeight + CARD_PAD;

      if (cardHeight > cursorY - bottomLimit && cursorY < PAGE_HEIGHT - MARGIN - 140) newPage();

      // Card frame + band.
      page.drawRectangle({ x: MARGIN, y: cursorY - cardHeight, width: CONTENT_WIDTH, height: cardHeight, borderColor: BORDER, borderWidth: 0.8 });
      page.drawRectangle({
        x: MARGIN,
        y: cursorY - CARD_BAND_HEIGHT,
        width: CONTENT_WIDTH,
        height: CARD_BAND_HEIGHT,
        color: BAND_FILL,
        borderColor: BORDER,
        borderWidth: 0.8,
      });
      const code = s(item.assetCode);
      page.drawText(code, { x: MARGIN + CARD_PAD, y: cursorY - CARD_BAND_HEIGHT + 6, size: 11, font: bold, color: NAVY });
      if (item.gps) {
        page.drawText(s(item.gps), {
          x: MARGIN + CARD_PAD + bold.widthOfTextAtSize(code, 11) + 10,
          y: cursorY - CARD_BAND_HEIGHT + 6.5,
          size: 7.5,
          font: mono,
          color: MUTED,
        });
      }
      // Right of the band: status, category, work type (drawn right → left).
      let rightX = PAGE_WIDTH - MARGIN - CARD_PAD;
      const chipTop = cursorY - (CARD_BAND_HEIGHT - 13) / 2;
      const statusText = STATUS_LABEL[item.status];
      rightX -= bold.widthOfTextAtSize(statusText, 7.5) + 10;
      drawChip(page, rightX, chipTop, statusText, STATUS_FILL[item.status], WHITE, 7.5, 13);
      rightX -= bold.widthOfTextAtSize(item.category, 8) + 10 + 5;
      drawChip(page, rightX, chipTop, item.category, CATEGORY_FILL[item.category], CATEGORY_TEXT[item.category], 8, 13);
      const work = s(item.workType.toUpperCase());
      rightX -= bold.widthOfTextAtSize(work, 7.5) + 10 + 5;
      drawChip(page, rightX, chipTop, work, CHIP_FILL, INK, 7.5, 13);

      // Text.
      let textY = cursorY - CARD_BAND_HEIGHT - CARD_PAD - 8;
      for (const line of labelLines) {
        page.drawText(line, { x: MARGIN + CARD_PAD, y: textY, size: TEXT_SIZE, font: bold, color: INK });
        textY -= LINE_HEIGHT;
      }
      for (const line of noteLines) {
        page.drawText(line, { x: MARGIN + CARD_PAD, y: textY, size: NOTE_SIZE, font, color: MUTED });
        textY -= LINE_HEIGHT;
      }
      for (const line of whoText) {
        page.drawText(line, { x: MARGIN + CARD_PAD, y: textY, size: NOTE_SIZE, font, color: INK });
        textY -= LINE_HEIGHT;
      }

      // Photos.
      let rowTop = cursorY - CARD_BAND_HEIGHT - CARD_PAD - textHeight - 2;
      if (embedded.length === 0) {
        page.drawText('Tiada gambar pembaikan lagi.', {
          x: MARGIN + CARD_PAD,
          y: rowTop - 9,
          size: NOTE_SIZE,
          font,
          color: FAINT,
        });
      }
      for (let start = 0; start < embedded.length; start += PHOTOS_PER_ROW) {
        let photoX = MARGIN + CARD_PAD;
        for (const { image, caption } of embedded.slice(start, start + PHOTOS_PER_ROW)) {
          const scale = Math.min(boxWidth / image.width, PHOTO_BOX_HEIGHT / image.height, 1);
          const width = image.width * scale;
          const height = image.height * scale;
          page.drawImage(image, {
            x: photoX + (boxWidth - width) / 2,
            y: rowTop - PHOTO_BOX_HEIGHT + (PHOTO_BOX_HEIGHT - height) / 2,
            width,
            height,
          });
          page.drawText(caption, {
            x: photoX + Math.max(0, (boxWidth - bold.widthOfTextAtSize(caption, 7)) / 2),
            y: rowTop - PHOTO_BOX_HEIGHT - 8,
            size: 7,
            font: bold,
            color: MUTED,
          });
          photoX += boxWidth + PHOTO_GAP;
        }
        rowTop -= PHOTO_BOX_HEIGHT + PHOTO_CAPTION_HEIGHT + PHOTO_GAP;
      }

      cursorY -= cardHeight + CARD_GAP;
    }
  }

  // Footer + DRAF watermark.
  const pages = doc.getPages();
  const footerText = s(
    `Dijana secara automatik oleh ASCURE pada ${input.generatedAt}` +
      (input.draft ? ' - DRAF: belum semua Kejanggalan ditutup' : ''),
  );
  pages.forEach((p, index) => {
    if (input.draft) {
      const mark = 'DRAF';
      const size = 120;
      p.drawText(mark, {
        x: PAGE_WIDTH / 2 - bold.widthOfTextAtSize(mark, size) / 2 + 40,
        y: PAGE_HEIGHT / 2 - 120,
        size,
        font: bold,
        color: rgb(0.86, 0.15, 0.15),
        opacity: 0.08,
        rotate: degrees(40),
      });
    }
    p.drawLine({ start: { x: MARGIN, y: 34 }, end: { x: PAGE_WIDTH - MARGIN, y: 34 }, thickness: 0.6, color: BORDER });
    p.drawText(footerText, { x: MARGIN, y: 24, size: 7, font, color: FAINT });
    const label = `${index + 1} / ${pages.length}`;
    p.drawText(label, { x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(label, 8), y: 24, size: 8, font, color: MUTED });
  });

  return Buffer.from(await doc.save());
}
