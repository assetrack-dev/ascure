import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import type { RGB } from 'pdf-lib';
import {
  ASCURE_LOGO_PNG_BASE64,
  TNB_LOGO_PNG_BASE64,
} from './defect-report-assets';

/**
 * Pure layout for the "Laporan Kejanggalan" (defect visual report), in the
 * owner-picked "Kad Kerja" design: every defect pole is a bordered work card —
 * a grey header band with the pole code, GPS and per-card severity chips, then
 * the defect lines each led by a coloured A/B/C badge, then ALL of the pole's
 * photos in rows of five. Each page carries the branded title block (ASCURE +
 * TNB logos, navy title, Pencawang identity) and a workload summary strip
 * (pole count + defect counts by category + the severity legend). Drawn
 * directly with pdf-lib because the docx pipeline can't drive per-cell
 * shading from data. Callers pass a WinAnsi sanitiser — StandardFonts throw
 * on any character outside cp1252 (the SAVT "→" incident).
 */

export type DefectCategory = 'A' | 'B' | 'C';

export interface DefectReportPhoto {
  data: Buffer;
  format: 'jpeg' | 'png';
}

export interface DefectReportPole {
  assetCode: string;
  /** "3.81452, 103.32541" — empty when the pole has no coordinates. */
  gps: string;
  /** Pre-formatted inspection date (may be empty). */
  inspectedOn: string;
  defects: Array<{ label: string; category: DefectCategory | null }>;
  photos: DefectReportPhoto[];
}

export interface DefectReportInput {
  pencawangName: string;
  functionalLocation: string;
  /** Pre-formatted survey date range for the meta row (may be empty). */
  rondaanRange: string;
  /** Pre-formatted MYT timestamp for the footer's "Dijana … pada" line. */
  generatedAt: string;
  poles: DefectReportPole[];
  /** Map text into WinAnsi-encodable characters (see winAnsiSafe). */
  sanitize: (value: string) => string;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 36;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// ── Per-page title block ──
const LOGO_HEIGHT = 34; // ASCURE (tight-cropped, so it reads large)
const TNB_LOGO_HEIGHT = 26;
const TITLE_SIZE = 13;

// ── Pole cards ──
const CARD_BAND_HEIGHT = 20;
const DEFECT_ROW_MIN_HEIGHT = 15;
const CARD_PAD = 9;
const PHOTO_BOX_HEIGHT = 86;
const PHOTO_GAP = 7;
const PHOTOS_PER_ROW = 5;
const CARD_GAP = 10;
/** Room reserved under the content for the footer rule + line. */
const FOOTER_SPACE = 22;

const BADGE_SIZE = 15;
const TEXT_SIZE = 9.5;
const LINE_HEIGHT = 11;

// SAVR-brand palette + the traffic-light categories (mobile mark colours).
const NAVY = rgb(0.122, 0.22, 0.392); // #1F3864
const BAND_FILL = rgb(0.957, 0.965, 0.973); // #F4F6F8
const CHIP_FILL = rgb(0.933, 0.941, 0.953); // #EEF0F3
const BORDER = rgb(0.796, 0.824, 0.851); // #CBD2D9
const MUTED = rgb(0.4, 0.44, 0.52); // #667085
const FAINT = rgb(0.596, 0.635, 0.702); // #98A2B3
const INK = rgb(0.102, 0.125, 0.173); // #1A202C
const WHITE = rgb(1, 1, 1);
const CATEGORY_FILL: Record<DefectCategory, RGB> = {
  A: rgb(0.937, 0.267, 0.267), // #EF4444
  B: rgb(0.98, 0.8, 0.082), // #FACC15
  C: rgb(0.133, 0.773, 0.369), // #22C55E
};
/** B's yellow needs dark text; A/C carry white. */
const CATEGORY_TEXT: Record<DefectCategory, RGB> = {
  A: WHITE,
  B: INK,
  C: WHITE,
};

const LEGEND_TEXT = 'A Kritikal - segera   B Serius - dirancang   C Minor';

/** Greedy word wrap; hard-splits a single word wider than the column. */
function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [''];
  }
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
      while (cut > 1 && width(word.slice(0, cut)) > maxWidth) {
        cut -= 1;
      }
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
  if (current) {
    lines.push(current);
  }
  return lines;
}

interface MeasuredRow {
  lines: string[];
  category: DefectCategory | null;
  height: number;
}

export async function renderDefectReportPdf(
  input: DefectReportInput,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const ascureLogo = await doc.embedPng(
    Buffer.from(ASCURE_LOGO_PNG_BASE64, 'base64'),
  );
  const tnbLogo = await doc.embedPng(Buffer.from(TNB_LOGO_PNG_BASE64, 'base64'));
  const s = input.sanitize;

  // Defect counts across the whole report, for the summary strip.
  const counts: Record<DefectCategory, number> = { A: 0, B: 0, C: 0 };
  for (const pole of input.poles) {
    for (const defect of pole.defects) {
      if (defect.category) {
        counts[defect.category] += 1;
      }
    }
  }

  /** Filled chip with centred text; returns its width. */
  const drawChip = (
    page: PDFPage,
    x: number,
    yTop: number,
    text: string,
    fill: RGB,
    color: RGB,
    size: number,
    chipFont: PDFFont,
    height: number,
  ): number => {
    const textWidth = chipFont.widthOfTextAtSize(text, size);
    const chipWidth = textWidth + 10;
    page.drawRectangle({ x, y: yTop - height, width: chipWidth, height, color: fill });
    page.drawText(text, {
      x: x + 5,
      y: yTop - height + (height - size) / 2 + size * 0.08,
      size,
      font: chipFont,
      color,
    });
    return chipWidth;
  };

  // ── Per-page title block: logos, title, identity, summary strip ──
  const drawPageHeader = (page: PDFPage): number => {
    let y = PAGE_HEIGHT - MARGIN;

    const ascureWidth = (ascureLogo.width / ascureLogo.height) * LOGO_HEIGHT;
    page.drawImage(ascureLogo, {
      x: MARGIN,
      y: y - LOGO_HEIGHT,
      width: ascureWidth,
      height: LOGO_HEIGHT,
    });
    const tnbWidth = (tnbLogo.width / tnbLogo.height) * TNB_LOGO_HEIGHT;
    page.drawImage(tnbLogo, {
      x: PAGE_WIDTH - MARGIN - tnbWidth,
      y: y - LOGO_HEIGHT + (LOGO_HEIGHT - TNB_LOGO_HEIGHT) / 2,
      width: tnbWidth,
      height: TNB_LOGO_HEIGHT,
    });
    const title = 'LAPORAN KEJANGGALAN';
    const titleWidth = bold.widthOfTextAtSize(title, TITLE_SIZE);
    page.drawText(title, {
      x: (PAGE_WIDTH - titleWidth) / 2,
      y: y - LOGO_HEIGHT / 2 - TITLE_SIZE / 2 + 2,
      size: TITLE_SIZE,
      font: bold,
      color: NAVY,
    });
    y -= LOGO_HEIGHT + 6;

    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 1.2,
      color: NAVY,
    });
    y -= 14;

    // Identity row: Pencawang + FL left, survey date range right.
    page.drawText(s(input.pencawangName), {
      x: MARGIN,
      y: y - 4,
      size: 10,
      font: bold,
      color: INK,
    });
    const nameWidth = bold.widthOfTextAtSize(s(input.pencawangName), 10);
    if (input.functionalLocation) {
      page.drawText(s(input.functionalLocation), {
        x: MARGIN + nameWidth + 12,
        y: y - 4,
        size: 8.5,
        font,
        color: MUTED,
      });
    }
    if (input.rondaanRange) {
      const range = s(`Rondaan ${input.rondaanRange}`);
      page.drawText(range, {
        x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(range, 8),
        y: y - 4,
        size: 8,
        font,
        color: MUTED,
      });
    }
    y -= 18;

    // Summary strip: pole count + per-category defect counts + legend.
    let chipX = MARGIN;
    chipX +=
      drawChip(
        page,
        chipX,
        y,
        `${input.poles.length} TIANG BERKECACATAN`,
        CHIP_FILL,
        INK,
        8.5,
        bold,
        14,
      ) + 6;
    for (const category of ['A', 'B', 'C'] as DefectCategory[]) {
      if (counts[category] > 0) {
        chipX +=
          drawChip(
            page,
            chipX,
            y,
            `${counts[category]} x ${category}`,
            CATEGORY_FILL[category],
            CATEGORY_TEXT[category],
            8.5,
            bold,
            14,
          ) + 6;
      }
    }
    page.drawText(LEGEND_TEXT, {
      x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(LEGEND_TEXT, 7),
      y: y - 14 + (14 - 7) / 2 + 0.5,
      size: 7,
      font,
      color: MUTED,
    });
    y -= 14;

    return y - 12;
  };

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursorY = drawPageHeader(page);
  const newPage = () => {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    cursorY = drawPageHeader(page);
  };

  for (const pole of input.poles) {
    const embedded: PDFImage[] = [];
    for (const photo of pole.photos) {
      try {
        embedded.push(
          photo.format === 'png'
            ? await doc.embedPng(photo.data)
            : await doc.embedJpg(photo.data),
        );
      } catch {
        // An undecodable photo never blocks the report — skip it.
      }
    }

    // Dynamic rows — exactly the defects the pole has, no filler.
    const labelWidth = CONTENT_WIDTH - CARD_PAD * 2 - BADGE_SIZE - 8;
    const rows: MeasuredRow[] = pole.defects.map((defect) => {
      const lines = wrapText(s(defect.label), font, TEXT_SIZE, labelWidth);
      return {
        lines,
        category: defect.category,
        height:
          lines.length === 1
            ? DEFECT_ROW_MIN_HEIGHT
            : lines.length * LINE_HEIGHT + 5,
      };
    });
    const rowsHeight = rows.reduce((sum, row) => sum + row.height, 0);
    const photoRowCount = Math.ceil(embedded.length / PHOTOS_PER_ROW);
    const photoAreaHeight = photoRowCount
      ? photoRowCount * (PHOTO_BOX_HEIGHT + PHOTO_GAP)
      : 0;
    const cardHeight =
      CARD_BAND_HEIGHT + CARD_PAD + rowsHeight + photoAreaHeight + CARD_PAD;

    // Keep each card whole: break to a fresh page when it doesn't fit. (A card
    // taller than a whole page — dozens of photos — would clip; no real pole
    // gets near that.)
    const bottomLimit = MARGIN + FOOTER_SPACE;
    if (cardHeight > cursorY - bottomLimit && cursorY < PAGE_HEIGHT - MARGIN - 80) {
      newPage();
    }

    // ── Card frame + header band ──
    page.drawRectangle({
      x: MARGIN,
      y: cursorY - cardHeight,
      width: CONTENT_WIDTH,
      height: cardHeight,
      borderColor: BORDER,
      borderWidth: 0.8,
    });
    page.drawRectangle({
      x: MARGIN,
      y: cursorY - CARD_BAND_HEIGHT,
      width: CONTENT_WIDTH,
      height: CARD_BAND_HEIGHT,
      color: BAND_FILL,
      borderColor: BORDER,
      borderWidth: 0.8,
    });
    const code = s(pole.assetCode);
    page.drawText(code, {
      x: MARGIN + CARD_PAD,
      y: cursorY - CARD_BAND_HEIGHT + 6,
      size: 11,
      font: bold,
      color: NAVY,
    });
    if (pole.gps) {
      page.drawText(s(pole.gps), {
        x: MARGIN + CARD_PAD + bold.widthOfTextAtSize(code, 11) + 12,
        y: cursorY - CARD_BAND_HEIGHT + 6.5,
        size: 7.5,
        font: mono,
        color: MUTED,
      });
    }
    // Right side of the band: inspection date, then per-card severity chips.
    let rightX = PAGE_WIDTH - MARGIN - CARD_PAD;
    const cardCounts: Record<DefectCategory, number> = { A: 0, B: 0, C: 0 };
    for (const defect of pole.defects) {
      if (defect.category) {
        cardCounts[defect.category] += 1;
      }
    }
    for (const category of ['C', 'B', 'A'] as DefectCategory[]) {
      if (cardCounts[category] > 0) {
        const text = `${cardCounts[category]} ${category}`;
        const chipWidth = bold.widthOfTextAtSize(text, 8) + 10;
        rightX -= chipWidth;
        drawChip(
          page,
          rightX,
          cursorY - (CARD_BAND_HEIGHT - 13) / 2,
          text,
          CATEGORY_FILL[category],
          CATEGORY_TEXT[category],
          8,
          bold,
          13,
        );
        rightX -= 5;
      }
    }
    if (pole.inspectedOn) {
      const inspected = s(`Diperiksa ${pole.inspectedOn}`);
      const inspectedWidth = font.widthOfTextAtSize(inspected, 7.5);
      rightX -= inspectedWidth + 4;
      page.drawText(inspected, {
        x: rightX,
        y: cursorY - CARD_BAND_HEIGHT + 7,
        size: 7.5,
        font,
        color: MUTED,
      });
    }
    let rowY = cursorY - CARD_BAND_HEIGHT - CARD_PAD;

    // ── Defect lines: coloured badge + label ──
    for (const row of rows) {
      if (row.category) {
        page.drawRectangle({
          x: MARGIN + CARD_PAD,
          y: rowY - (row.height + BADGE_SIZE) / 2 + 1,
          width: BADGE_SIZE,
          height: BADGE_SIZE,
          color: CATEGORY_FILL[row.category],
        });
        page.drawText(row.category, {
          x:
            MARGIN +
            CARD_PAD +
            (BADGE_SIZE - bold.widthOfTextAtSize(row.category, 9)) / 2,
          y: rowY - (row.height + BADGE_SIZE) / 2 + 5,
          size: 9,
          font: bold,
          color: CATEGORY_TEXT[row.category],
        });
      }
      let lineY =
        rowY - (row.height - row.lines.length * LINE_HEIGHT) / 2 - LINE_HEIGHT + 3;
      for (const line of row.lines) {
        page.drawText(line, {
          x: MARGIN + CARD_PAD + BADGE_SIZE + 8,
          y: lineY,
          size: TEXT_SIZE,
          font,
          color: INK,
        });
        lineY -= LINE_HEIGHT;
      }
      rowY -= row.height;
    }

    // ── Photos, in rows of five ──
    if (embedded.length) {
      const boxWidth =
        (CONTENT_WIDTH - CARD_PAD * 2 - PHOTO_GAP * (PHOTOS_PER_ROW - 1)) /
        PHOTOS_PER_ROW;
      let rowTop = rowY - PHOTO_GAP;
      for (let start = 0; start < embedded.length; start += PHOTOS_PER_ROW) {
        const rowImages = embedded.slice(start, start + PHOTOS_PER_ROW);
        let photoX = MARGIN + CARD_PAD;
        for (const image of rowImages) {
          const scale = Math.min(
            boxWidth / image.width,
            PHOTO_BOX_HEIGHT / image.height,
            1,
          );
          const width = image.width * scale;
          const height = image.height * scale;
          page.drawImage(image, {
            x: photoX + (boxWidth - width) / 2,
            y: rowTop - PHOTO_BOX_HEIGHT + (PHOTO_BOX_HEIGHT - height) / 2,
            width,
            height,
          });
          photoX += boxWidth + PHOTO_GAP;
        }
        rowTop -= PHOTO_BOX_HEIGHT + PHOTO_GAP;
      }
    }

    cursorY -= cardHeight + CARD_GAP;
  }

  // ── Footer: rule + generation line + page numbers ──
  const pages = doc.getPages();
  const footerText = s(
    `Dijana secara automatik oleh ASCURE pada ${input.generatedAt}`,
  );
  pages.forEach((p, index) => {
    p.drawLine({
      start: { x: MARGIN, y: 34 },
      end: { x: PAGE_WIDTH - MARGIN, y: 34 },
      thickness: 0.6,
      color: BORDER,
    });
    p.drawText(footerText, { x: MARGIN, y: 24, size: 7, font, color: FAINT });
    const label = `${index + 1} / ${pages.length}`;
    p.drawText(label, {
      x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(label, 8),
      y: 24,
      size: 8,
      font,
      color: MUTED,
    });
  });

  return Buffer.from(await doc.save());
}
