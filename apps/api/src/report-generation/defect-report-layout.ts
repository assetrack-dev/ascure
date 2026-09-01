import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import type { RGB } from 'pdf-lib';

/**
 * Pure layout for the "Laporan Kejanggalan" (defect visual report): the
 * client-requested compact format — per pole, a KEJANGGALAN table with a
 * colour-coded KATEGORI column (A red / B yellow / C green) and a strip of up
 * to three photos, ~3 poles per A4 page. Drawn directly with pdf-lib because
 * the docx pipeline can't drive per-cell shading from data, and the colour
 * cells ARE this report. Callers pass a WinAnsi sanitiser — StandardFonts
 * throw on any character outside cp1252 (the SAVT "→" incident).
 */

export type DefectCategory = 'A' | 'B' | 'C';

export interface DefectReportPhoto {
  data: Buffer;
  format: 'jpeg' | 'png';
}

export interface DefectReportPole {
  assetCode: string;
  defects: Array<{ label: string; category: DefectCategory | null }>;
  photos: DefectReportPhoto[];
}

export interface DefectReportInput {
  pencawangName: string;
  functionalLocation: string;
  poles: DefectReportPole[];
  /** Map text into WinAnsi-encodable characters (see winAnsiSafe). */
  sanitize: (value: string) => string;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// Sized so a typical block (2 header rows + 5 defect rows + photo strip)
// lands at ~240pt — THREE poles per A4 page, like the client's sample.
const HEADER_ROW_HEIGHT = 14;
const COL_HEADER_HEIGHT = 14;
const DEFECT_ROW_MIN_HEIGHT = 13;
/** Blank (but numbered) filler rows keep short blocks visually uniform. */
const MIN_DEFECT_ROWS = 5;
const PHOTO_BOX_HEIGHT = 115;
const PHOTO_GAP = 10;
const PHOTO_ROW_PAD = 6;
const BLOCK_GAP = 12;

const HEADER_LABEL_COL = 110;
const TIANG_COL = 80;
const KATEGORI_COL = 80;
const NUM_COL = 22;
const LABEL_COL = CONTENT_WIDTH - TIANG_COL - KATEGORI_COL - NUM_COL;

const TEXT_SIZE = 8.5;
const LINE_HEIGHT = 10;
const CELL_PAD_X = 4;

// The sample report's palette: gold Pencawang band, light-blue column header,
// traffic-light KATEGORI cells matching the mobile mark-circle colours.
const YELLOW = rgb(1, 0.8, 0.2);
const BLUE = rgb(0.66, 0.81, 0.92);
const CATEGORY_FILL: Record<DefectCategory, RGB> = {
  A: rgb(0.937, 0.267, 0.267), // #EF4444
  B: rgb(0.98, 0.8, 0.082), // #FACC15
  C: rgb(0.133, 0.773, 0.369), // #22C55E
};
const BORDER = rgb(0.3, 0.3, 0.3);
const INK = rgb(0.05, 0.05, 0.15);

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
      // Peel off the largest prefix that fits, flushing the current line first.
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

interface CellText {
  lines: string[];
  font: PDFFont;
  size: number;
  align: 'left' | 'center';
  color?: RGB;
}

/** Bordered rectangle with optional fill and vertically-centred text. */
function drawCell(
  page: PDFPage,
  x: number,
  yTop: number,
  width: number,
  height: number,
  fill: RGB | null,
  text?: CellText,
): void {
  page.drawRectangle({
    x,
    y: yTop - height,
    width,
    height,
    borderColor: BORDER,
    borderWidth: 0.6,
    ...(fill ? { color: fill } : {}),
  });
  if (!text) {
    return;
  }
  const blockHeight = text.lines.length * LINE_HEIGHT;
  // Baseline offset ≈ 0.28 × size below the line's visual centre.
  let lineY = yTop - (height - blockHeight) / 2 - LINE_HEIGHT + text.size * 0.28;
  for (const line of text.lines) {
    const lineWidth = text.font.widthOfTextAtSize(line, text.size);
    const textX =
      text.align === 'center'
        ? x + (width - lineWidth) / 2
        : x + CELL_PAD_X;
    page.drawText(line, {
      x: textX,
      y: lineY,
      size: text.size,
      font: text.font,
      color: text.color ?? INK,
    });
    lineY -= LINE_HEIGHT;
  }
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
  const s = input.sanitize;

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursorY = PAGE_HEIGHT - MARGIN;

  const newPage = () => {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    cursorY = PAGE_HEIGHT - MARGIN;
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

    const rows: MeasuredRow[] = pole.defects.map((defect) => {
      const lines = wrapText(s(defect.label), font, TEXT_SIZE, LABEL_COL - CELL_PAD_X * 2);
      return {
        lines,
        category: defect.category,
        // Single-line rows stay at the compact minimum; only wrapped labels
        // grow the row (a taller default would cost the 3-blocks-per-page fit).
        height:
          lines.length === 1
            ? DEFECT_ROW_MIN_HEIGHT
            : lines.length * LINE_HEIGHT + 4,
      };
    });
    while (rows.length < MIN_DEFECT_ROWS) {
      rows.push({ lines: [''], category: null, height: DEFECT_ROW_MIN_HEIGHT });
    }

    const rowsHeight = rows.reduce((sum, row) => sum + row.height, 0);
    const photoRowHeight = embedded.length
      ? PHOTO_BOX_HEIGHT + PHOTO_ROW_PAD * 2
      : 0;
    const blockHeight =
      HEADER_ROW_HEIGHT * 2 + COL_HEADER_HEIGHT + rowsHeight + photoRowHeight;

    // Keep each pole block whole: break to a fresh page when it doesn't fit.
    // (A block taller than a whole page — 50+ defect lines — would clip; no
    // real checklist gets near that.)
    if (blockHeight > cursorY - MARGIN && cursorY < PAGE_HEIGHT - MARGIN) {
      newPage();
    }

    // ── Pencawang header band (repeated per block, like the sample) ──
    drawCell(page, MARGIN, cursorY, HEADER_LABEL_COL, HEADER_ROW_HEIGHT, YELLOW, {
      lines: ['PENCAWANG'],
      font: bold,
      size: 9,
      align: 'left',
    });
    drawCell(
      page,
      MARGIN + HEADER_LABEL_COL,
      cursorY,
      CONTENT_WIDTH - HEADER_LABEL_COL,
      HEADER_ROW_HEIGHT,
      YELLOW,
      { lines: [`:  ${s(input.pencawangName)}`], font: bold, size: 9, align: 'left' },
    );
    cursorY -= HEADER_ROW_HEIGHT;
    drawCell(page, MARGIN, cursorY, HEADER_LABEL_COL, HEADER_ROW_HEIGHT, YELLOW, {
      lines: ['FL NO.'],
      font: bold,
      size: 9,
      align: 'left',
    });
    drawCell(
      page,
      MARGIN + HEADER_LABEL_COL,
      cursorY,
      CONTENT_WIDTH - HEADER_LABEL_COL,
      HEADER_ROW_HEIGHT,
      YELLOW,
      {
        lines: [`:  ${s(input.functionalLocation)}`],
        font: bold,
        size: 9,
        align: 'left',
      },
    );
    cursorY -= HEADER_ROW_HEIGHT;

    // ── Column header ──
    drawCell(page, MARGIN, cursorY, TIANG_COL, COL_HEADER_HEIGHT, BLUE, {
      lines: ['No. Tiang'],
      font: bold,
      size: 8.5,
      align: 'center',
    });
    drawCell(
      page,
      MARGIN + TIANG_COL,
      cursorY,
      NUM_COL + LABEL_COL,
      COL_HEADER_HEIGHT,
      BLUE,
      { lines: ['KEJANGGALAN'], font: bold, size: 8.5, align: 'left' },
    );
    drawCell(
      page,
      MARGIN + TIANG_COL + NUM_COL + LABEL_COL,
      cursorY,
      KATEGORI_COL,
      COL_HEADER_HEIGHT,
      BLUE,
      { lines: ['KATEGORI'], font: bold, size: 8.5, align: 'center' },
    );
    cursorY -= COL_HEADER_HEIGHT;

    // ── Defect rows; the No. Tiang cell spans them all ──
    // Stack the code's space-separated parts, as crews write it (PB2 / C / 19).
    const codeLines = s(pole.assetCode).split(/\s+/).filter(Boolean);
    drawCell(page, MARGIN, cursorY, TIANG_COL, rowsHeight, null, {
      lines: codeLines.length ? codeLines : [''],
      font: bold,
      size: 9,
      align: 'center',
    });

    let rowY = cursorY;
    rows.forEach((row, index) => {
      drawCell(page, MARGIN + TIANG_COL, rowY, NUM_COL, row.height, null, {
        lines: [String(index + 1)],
        font,
        size: TEXT_SIZE,
        align: 'center',
      });
      drawCell(page, MARGIN + TIANG_COL + NUM_COL, rowY, LABEL_COL, row.height, null, {
        lines: row.lines,
        font,
        size: TEXT_SIZE,
        align: 'left',
      });
      drawCell(
        page,
        MARGIN + TIANG_COL + NUM_COL + LABEL_COL,
        rowY,
        KATEGORI_COL,
        row.height,
        row.category ? CATEGORY_FILL[row.category] : null,
        row.category
          ? { lines: [row.category], font: bold, size: 8.5, align: 'center' }
          : undefined,
      );
      rowY -= row.height;
    });
    cursorY = rowY;

    // ── Photo strip ──
    if (embedded.length) {
      drawCell(page, MARGIN, cursorY, CONTENT_WIDTH, photoRowHeight, null);
      const boxWidth =
        (CONTENT_WIDTH - PHOTO_GAP * (embedded.length + 1)) / embedded.length;
      const sizes = embedded.map((image) => {
        const scale = Math.min(
          boxWidth / image.width,
          PHOTO_BOX_HEIGHT / image.height,
          1,
        );
        return { width: image.width * scale, height: image.height * scale };
      });
      const totalWidth =
        sizes.reduce((sum, size) => sum + size.width, 0) +
        PHOTO_GAP * (embedded.length - 1);
      let photoX = MARGIN + (CONTENT_WIDTH - totalWidth) / 2;
      embedded.forEach((image, index) => {
        const size = sizes[index];
        page.drawImage(image, {
          x: photoX,
          y: cursorY - PHOTO_ROW_PAD - size.height,
          width: size.width,
          height: size.height,
        });
        photoX += size.width + PHOTO_GAP;
      });
      cursorY -= photoRowHeight;
    }

    cursorY -= BLOCK_GAP;
  }

  const pages = doc.getPages();
  pages.forEach((p, index) => {
    const label = `${index + 1} / ${pages.length}`;
    p.drawText(label, {
      x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(label, 8),
      y: 22,
      size: 8,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
  });

  return Buffer.from(await doc.save());
}
