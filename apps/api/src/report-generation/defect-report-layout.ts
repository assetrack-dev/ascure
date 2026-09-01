import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import type { RGB } from 'pdf-lib';
import {
  ASCURE_LOGO_PNG_BASE64,
  TNB_LOGO_PNG_BASE64,
} from './defect-report-assets';

/**
 * Pure layout for the "Laporan Kejanggalan" (defect visual report): per pole,
 * a KEJANGGALAN table with a colour-coded KATEGORI column (A red / B yellow /
 * C green) and the pole's photos in rows of three, ~3 poles per A4 page.
 * Styled after the SAVR visual-report template (owner's direction): ASCURE +
 * TNB logos in a per-page title block, Arial-like type, the navy #1F3864
 * title colour, #EDEDED label cells and the grey "Dijana secara automatik"
 * footer. Drawn directly with pdf-lib because the docx pipeline can't drive
 * per-cell shading from data, and the colour cells ARE this report. Callers
 * pass a WinAnsi sanitiser — StandardFonts throw on any character outside
 * cp1252 (the SAVT "→" incident).
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
  /** Pre-formatted MYT timestamp for the footer's "Dijana … pada" line. */
  generatedAt: string;
  poles: DefectReportPole[];
  /** Map text into WinAnsi-encodable characters (see winAnsiSafe). */
  sanitize: (value: string) => string;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// ── Per-page title block ──
const LOGO_HEIGHT = 30;
const TITLE_SIZE = 13;
const INFO_ROW_HEIGHT = 15;
const INFO_LABEL_COL = 150;
const HEADER_GAP = 10;

// ── Pole blocks — sized so a typical block (5 defect rows + one photo row)
// lands at ~220pt: THREE poles per page under the title block. ──
const COL_HEADER_HEIGHT = 14;
const DEFECT_ROW_MIN_HEIGHT = 13;
/** Blank (but numbered) filler rows keep short blocks visually uniform. */
const MIN_DEFECT_ROWS = 5;
const PHOTO_BOX_HEIGHT = 115;
const PHOTO_GAP = 10;
const PHOTO_ROW_PAD = 6;
const PHOTOS_PER_ROW = 3;
const BLOCK_GAP = 12;
/** Room reserved under the content for the footer line. */
const FOOTER_SPACE = 16;

const TIANG_COL = 80;
const KATEGORI_COL = 80;
const NUM_COL = 22;
const LABEL_COL = CONTENT_WIDTH - TIANG_COL - KATEGORI_COL - NUM_COL;

const TEXT_SIZE = 8.5;
const LINE_HEIGHT = 10;
const CELL_PAD_X = 4;

// The SAVR template's palette: navy titles, grey label cells, muted footer.
const NAVY = rgb(0.122, 0.22, 0.392); // #1F3864
const GRAY_FILL = rgb(0.929, 0.929, 0.929); // #EDEDED
const MUTED = rgb(0.467, 0.467, 0.467); // #777777
const WHITE = rgb(1, 1, 1);
// Traffic-light KATEGORI cells, matching the mobile mark-circle colours.
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
  const ascureLogo = await doc.embedPng(
    Buffer.from(ASCURE_LOGO_PNG_BASE64, 'base64'),
  );
  const tnbLogo = await doc.embedPng(Buffer.from(TNB_LOGO_PNG_BASE64, 'base64'));
  const s = input.sanitize;

  // ── Per-page title block: logos, title, Pencawang identity ──
  const drawPageHeader = (target: PDFPage): number => {
    let y = PAGE_HEIGHT - MARGIN;

    const ascureScale = LOGO_HEIGHT / ascureLogo.height;
    target.drawImage(ascureLogo, {
      x: MARGIN,
      y: y - LOGO_HEIGHT,
      width: ascureLogo.width * ascureScale,
      height: LOGO_HEIGHT,
    });
    const tnbScale = LOGO_HEIGHT / tnbLogo.height;
    const tnbWidth = tnbLogo.width * tnbScale;
    target.drawImage(tnbLogo, {
      x: PAGE_WIDTH - MARGIN - tnbWidth,
      y: y - LOGO_HEIGHT,
      width: tnbWidth,
      height: LOGO_HEIGHT,
    });

    const title = 'LAPORAN KEJANGGALAN';
    const titleWidth = bold.widthOfTextAtSize(title, TITLE_SIZE);
    target.drawText(title, {
      x: (PAGE_WIDTH - titleWidth) / 2,
      y: y - LOGO_HEIGHT / 2 - TITLE_SIZE / 2 + 2,
      size: TITLE_SIZE,
      font: bold,
      color: NAVY,
    });
    y -= LOGO_HEIGHT + 6;

    target.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 1,
      color: NAVY,
    });
    y -= HEADER_GAP;

    const infoRows: Array<[string, string]> = [
      ['NAMA PENCAWANG', s(input.pencawangName)],
      ['FUNCTIONAL LOCATION', s(input.functionalLocation)],
    ];
    for (const [label, value] of infoRows) {
      drawCell(target, MARGIN, y, INFO_LABEL_COL, INFO_ROW_HEIGHT, GRAY_FILL, {
        lines: [label],
        font: bold,
        size: 8,
        align: 'left',
      });
      drawCell(
        target,
        MARGIN + INFO_LABEL_COL,
        y,
        CONTENT_WIDTH - INFO_LABEL_COL,
        INFO_ROW_HEIGHT,
        null,
        { lines: [value], font, size: 8.5, align: 'left' },
      );
      y -= INFO_ROW_HEIGHT;
    }

    return y - HEADER_GAP;
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
    const photoRowCount = Math.ceil(embedded.length / PHOTOS_PER_ROW);
    const photoAreaHeight = photoRowCount
      ? photoRowCount * (PHOTO_BOX_HEIGHT + PHOTO_ROW_PAD) + PHOTO_ROW_PAD
      : 0;
    const blockHeight = COL_HEADER_HEIGHT + rowsHeight + photoAreaHeight;

    // Keep each pole block whole: break to a fresh page when it doesn't fit.
    // (A block taller than a whole page — dozens of photos — would clip; no
    // real pole gets near that.)
    const bottomLimit = MARGIN + FOOTER_SPACE;
    if (blockHeight > cursorY - bottomLimit && cursorY < PAGE_HEIGHT - MARGIN - 60) {
      newPage();
    }

    // ── Column header ──
    drawCell(page, MARGIN, cursorY, TIANG_COL, COL_HEADER_HEIGHT, NAVY, {
      lines: ['No. Tiang'],
      font: bold,
      size: 8.5,
      align: 'center',
      color: WHITE,
    });
    drawCell(
      page,
      MARGIN + TIANG_COL,
      cursorY,
      NUM_COL + LABEL_COL,
      COL_HEADER_HEIGHT,
      NAVY,
      { lines: ['KEJANGGALAN'], font: bold, size: 8.5, align: 'left', color: WHITE },
    );
    drawCell(
      page,
      MARGIN + TIANG_COL + NUM_COL + LABEL_COL,
      cursorY,
      KATEGORI_COL,
      COL_HEADER_HEIGHT,
      NAVY,
      { lines: ['KATEGORI'], font: bold, size: 8.5, align: 'center', color: WHITE },
    );
    cursorY -= COL_HEADER_HEIGHT;

    // ── Defect rows; the No. Tiang cell spans them all ──
    // Stack the code's space-separated parts, as crews write it (PB2 / C / 19)
    // — but a long shared-pole code ("D 1 & E 1 & H 1") stacks taller than the
    // cell, so fall back to width-wrapping when the stack doesn't fit.
    const code = s(pole.assetCode);
    let codeLines = code.split(/\s+/).filter(Boolean);
    if (codeLines.length * LINE_HEIGHT > rowsHeight - 2) {
      codeLines = wrapText(code, bold, 9, TIANG_COL - CELL_PAD_X * 2);
    }
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

    // ── Photos, in rows of three ──
    if (embedded.length) {
      drawCell(page, MARGIN, cursorY, CONTENT_WIDTH, photoAreaHeight, null);
      const boxWidth = (CONTENT_WIDTH - PHOTO_GAP * (PHOTOS_PER_ROW + 1)) / PHOTOS_PER_ROW;
      let rowTop = cursorY - PHOTO_ROW_PAD;
      for (let start = 0; start < embedded.length; start += PHOTOS_PER_ROW) {
        const rowImages = embedded.slice(start, start + PHOTOS_PER_ROW);
        const sizes = rowImages.map((image) => {
          const scale = Math.min(
            boxWidth / image.width,
            PHOTO_BOX_HEIGHT / image.height,
            1,
          );
          return { width: image.width * scale, height: image.height * scale };
        });
        const totalWidth =
          sizes.reduce((sum, size) => sum + size.width, 0) +
          PHOTO_GAP * (rowImages.length - 1);
        let photoX = MARGIN + (CONTENT_WIDTH - totalWidth) / 2;
        rowImages.forEach((image, index) => {
          const size = sizes[index];
          page.drawImage(image, {
            x: photoX,
            y: rowTop - size.height,
            width: size.width,
            height: size.height,
          });
          photoX += size.width + PHOTO_GAP;
        });
        rowTop -= PHOTO_BOX_HEIGHT + PHOTO_ROW_PAD;
      }
      cursorY -= photoAreaHeight;
    }

    cursorY -= BLOCK_GAP;
  }

  // ── Footer: generation line (SAVR-template style) + page numbers ──
  const pages = doc.getPages();
  const footerText = s(`Dijana secara automatik oleh ASCURE pada ${input.generatedAt}`);
  pages.forEach((p, index) => {
    p.drawText(footerText, {
      x: MARGIN,
      y: 24,
      size: 7,
      font,
      color: MUTED,
    });
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
