import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * Thin HTTP client for Gotenberg (https://gotenberg.dev) — an open-source
 * Docker service wrapping LibreOffice for office-doc → PDF conversion. Runs as
 * an internal container bound to 127.0.0.1 (never public); see GOTENBERG_URL.
 *
 *   docker run -d --name ascure-gotenberg -p 127.0.0.1:3002:3000 gotenberg/gotenberg:8
 *
 * We only use the LibreOffice route (`/forms/libreoffice/convert`) to turn the
 * filled `.docx` into a PDF. HTML→PDF (Chromium route) is available for later.
 */
@Injectable()
export class GotenbergService {
  private readonly logger = new Logger(GotenbergService.name);

  private get baseUrl(): string {
    return (process.env.GOTENBERG_URL ?? 'http://127.0.0.1:3002').replace(
      /\/+$/,
      '',
    );
  }

  /** True if the Gotenberg container answers its health probe. */
  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Convert a `.docx` buffer to a PDF buffer via the LibreOffice route.
   * Gotenberg keys the conversion off the upload's file extension, so the part
   * name must end in `.docx`.
   */
  async convertDocxToPdf(
    docxBuffer: Buffer,
    fileName = 'document.docx',
  ): Promise<Buffer> {
    const form = new FormData();
    const safeName = fileName.toLowerCase().endsWith('.docx')
      ? fileName
      : `${fileName}.docx`;
    form.append(
      'files',
      new Blob([new Uint8Array(docxBuffer)], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      safeName,
    );

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/forms/libreoffice/convert`, {
        method: 'POST',
        body: form,
      });
    } catch (error) {
      this.logger.error(
        `Gotenberg unreachable at ${this.baseUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ServiceUnavailableException(
        'The document conversion service (Gotenberg) is unavailable. ' +
          'Ensure the ascure-gotenberg container is running.',
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.error(
        `Gotenberg conversion failed (HTTP ${res.status}): ${detail.slice(0, 500)}`,
      );
      throw new ServiceUnavailableException(
        `Document conversion failed (Gotenberg HTTP ${res.status}).`,
      );
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
