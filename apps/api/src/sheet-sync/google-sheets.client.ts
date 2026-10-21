import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Minimal Google Sheets v4 client for a service account — signs its own
 * RS256 JWT with node:crypto instead of pulling in googleapis (~100 MB).
 * The key file path comes from SHEET_SYNC_KEY_FILE and never leaves the VPS.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

type ServiceAccountKey = { client_email: string; private_key: string };

export type SheetCellUpdate = {
  row: number; // 0-based
  col: number; // 0-based
  /** Sheets date serial (days since 1899-12-30), or null to clear the cell. */
  dateSerial: number | null;
};

const base64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

export class GoogleSheetsClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly key: ServiceAccountKey) {}

  static fromKeyFile(path: string) {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ServiceAccountKey>;
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('The Google key file has no client_email / private_key.');
    }
    return new GoogleSheetsClient({ client_email: parsed.client_email, private_key: parsed.private_key });
  }

  get serviceAccountEmail() {
    return this.key.client_email;
  }

  private async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.value;
    }
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({ iss: this.key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
    );
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const assertion = `${header}.${claims}.${base64url(signer.sign(this.key.private_key))}`;
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    const body = (await response.json()) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!response.ok || !body.access_token) {
      throw new Error(`Google sign-in failed: ${body.error_description ?? response.status}`);
    }
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${SHEETS_URL}/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
    });
    const text = await response.text();
    if (!response.ok) {
      let message = text.slice(0, 300);
      try {
        message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
      } catch {
        // keep the raw text
      }
      throw new Error(`Google Sheets ${response.status}: ${message}`);
    }
    return JSON.parse(text) as T;
  }

  /** The tab's numeric sheetId + row count, by title. */
  async findSheet(spreadsheetId: string, title: string) {
    const meta = await this.call<{
      properties?: { title?: string };
      sheets?: Array<{ properties: { sheetId: number; title: string; gridProperties?: { rowCount?: number } } }>;
    }>(`${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties(sheetId,title,gridProperties.rowCount)`);
    const sheet = meta.sheets?.find((entry) => entry.properties.title === title);
    if (!sheet) {
      throw new Error(`Tab "${title}" not found in "${meta.properties?.title ?? spreadsheetId}".`);
    }
    return {
      spreadsheetTitle: meta.properties?.title ?? '',
      sheetId: sheet.properties.sheetId,
      rowCount: sheet.properties.gridProperties?.rowCount ?? 0,
    };
  }

  /** Displayed (formatted) values of a whole tab — filters/hidden rows included. */
  async readFormatted(spreadsheetId: string, title: string) {
    const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'`);
    const body = await this.call<{ values?: string[][] }>(
      `${encodeURIComponent(spreadsheetId)}/values/${range}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`,
    );
    return body.values ?? [];
  }

  /**
   * Writes dates as real date values shown dd/mm/yyyy (the sheet's locale is
   * en_US, so a typed "05/10/2026" would become 10 May). Only the value and
   * number format change — borders/colours stay. Chunked to stay far under
   * the 60-writes-per-minute quota (one batchUpdate = one write).
   */
  async writeDates(spreadsheetId: string, sheetId: number, updates: SheetCellUpdate[]) {
    for (let start = 0; start < updates.length; start += 500) {
      const requests = updates.slice(start, start + 500).map((update) => ({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: update.row,
            endRowIndex: update.row + 1,
            startColumnIndex: update.col,
            endColumnIndex: update.col + 1,
          },
          rows: [
            {
              values: [
                update.dateSerial === null
                  ? {}
                  : {
                      userEnteredValue: { numberValue: update.dateSerial },
                      userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } },
                    },
              ],
            },
          ],
          fields: update.dateSerial === null ? 'userEnteredValue' : 'userEnteredValue,userEnteredFormat.numberFormat',
        },
      }));
      await this.call(`${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests }),
      });
    }
  }
}
