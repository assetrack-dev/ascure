# PLAN — Google Sheet repair-date sync (Kuantan, Tier 1)

Status: **APPROVED by owner 2026-10-21.** Step 1 (Google access) in progress.

## 1. Goal

Each night, ASCURE writes the **repair date** of every repair that **TNB has verified** into the
matching "Tarikh Pembaikan" cell of TNB Kuantan's Google Sheet, so nobody re-types it.

- Sheet: `17uY1d9NIVu01SvBCjRTALpx_aHj-t2YfnEu3SnpJxDw`, tab **QR03** (gid 1254480106) = **Tier 1**.
- Tier 2 (475 PEs, a separate sheet) comes later. The design takes a list of sheets.

## 2. Owner decisions

| # | Decision |
|---|---|
| D1 | Google Sheets; Kuantan only; the owner pastes QR03 (from QR AUTO) into the sheet. |
| D2 | Tier 1 = 200 PEs, **all already pasted**. Maintenance works Tier 1 first. |
| D3 | The value written = the **repair date** (crew Mark done, `Defect.maintainedAt`), as a Malaysia-time date. |
| D4 | Written **only once TNB has verified** it (`Defect.closureVerifiedAt` set). |
| D5 | A group's date = the **first** verified repair in that group on that pole. |
| D6 | "Cannot repair" outcomes (EXTERNAL_CONSTRAINT / ESCALATED / DEFERRED) → leave blank. |
| D7 | REPAIRED BY and NO STAFF @ NAMA KKB → **left to TNB**. |
| D8 | Sync **once a day at 22:00 Malaysia time** (TNB verifies after working hours) + an Admin "Sync now". |
| D9 | Every Tier 1 pole was surveyed in ASCURE, and the maintenance records come from those surveys. |

## 3. What the Tier 1 sheet looks like (read-only check, 2026-10-21, CSV export, filter ignored)

- **20,152 rows, 200 Pencawang** (FL codes), Bil 1–20152. Header on row 8, data from row 9.
- **16 "Tarikh Pembaikan" columns**, one per group: Tiang, Pembumian, Nombor Tiang, Sambungan UG-OH,
  Talian, Rentis, Umbang, IPC, Aksesori, Black Box, Penangkap Kilat, Servis, Papan Tanda,
  Sesalur Kaki Lima, Lampu Jalan, Lain-lain.
- **COORDINATE TIANG** is on every row and always parses ("lat, lng"). Most rows have 6 decimals,
  but **192 rows have only 2–4 decimals** (accurate to ~10–1,000 m), so GPS alone isn't enough.
- **399 date cells are already filled** (365 rows; 288 of them in PE HP PATOD PALAS 2), typed
  as dd/mm/yyyy. ASCURE must never overwrite these.
- **3 Pencawang were pasted twice** (167 duplicate pole rows):
  LKPP SG ULAR (107, the second copy is named "PE LKKP SG ULAR"), PE 11KV KUALA KENAU (39, also
  "PE 11 KUALA KENAU"), PE BALAI POLIS CHERATING (21).
- 2,226 rows are shared poles written "A 1 & B 1".
- The sheet's own timestamp shows US format (m/d/yyyy), while the typed dates are dd/mm/yyyy.
  Step 1 must check how a written date is stored, so the DATA/summary formulas still count it.

## 4. How a row is matched to an ASCURE pole

1. **Main key:** FL Pencawang + Lokasi Kejanggalan (No Tiang RONDAAN), normalised for case and
   spaces.
2. **Check:** the ASCURE pole's GPS is within **15 m** of COORDINATE TIANG. The radius is loose
   because of the low-precision rows.
3. **Both agree → match.** If only one agrees, or nothing is found, the row is **not written** and
   goes on the check list.
4. **Duplicate rows** (same PE + No Tiang twice): the same date is written to both, and they are
   listed. Better: the owner deletes the extra copies of the 3 PEs.
5. Matching is re-done on every run, so it doesn't depend on row numbers. Sorting, filtering or
   inserting rows is safe.

Tier 2+: QR AUTO adds a hidden **ASCURE ID** column, which gives an exact match without needing step 1–2.

## 5. Which cell gets which date

- Each Kejanggalan's checklist item maps to one QR03 group. The mapping is ported from
  `docs/qr_auto/Kuantan/run_kuantan.py` (`write_qr03_staff`, which builds this exact layout).
- Columns are found by **header text**: group name on row 7, then "Tarikh Pembaikan".
- For each pole × group: take the defects with `closureVerifiedAt` set and an outcome not in D6,
  then write the **earliest `maintainedAt`**, as a Malaysia date (UTC+8).
- A Kejanggalan that maintenance added itself ("Lain-lain" finding, no checklist item) has no
  column, so it's listed and not written.

## 6. Never overwrite TNB

- ASCURE stores every cell it wrote (sheet, PE + No Tiang, group, value, time).
- It writes only if the cell is **empty** or **still holds ASCURE's own last value**.
- If someone typed something different, ASCURE leaves it and lists it as a **clash**.
- If TNB later sends a verified repair back (it's no longer verified), ASCURE clears its own date
  only if the cell still holds that date.
- ASCURE never touches grades, REPAIRED BY, NO STAFF, Catitan, or the DATA / summary tabs.

## 7. Build steps

| Step | What | Who |
|---|---|---|
| 1 | **Access:** create a Google Cloud project + service account, download its key (JSON) to the VPS, share the Tier 1 sheet with the service account email as **Editor**. Claude guides; the owner clicks. | owner + Claude |
| 2 | **API:** a sheet-sync module (Google Sheets REST + `google-auth-library`), a nightly 22:00 MYT job, the matching + writing above. **1 additive migration**: `SheetSyncCell` (what ASCURE wrote) + `SheetSyncRun` (log). | Claude |
| 3 | **Admin (ADMIN only):** Setup → Google Sheet sync, showing each run (written / already correct / clash / not matched / no column / duplicates), the check list as Excel, a **Dry run** and a **Sync now** button. | Claude |
| 4 | **Dry run on prod** (reads, writes nothing). The owner reviews the match report. | owner |
| 5 | Switch writing on → the first real run fills every repair verified so far → nightly from then. | owner |
| 6 | Later: Tier 2 sheet + the ASCURE ID column in QR AUTO. | Claude |

No APK change. API + admin only.

## 8. Open points

- ~~O1~~ Owner 2026-10-21: **write both copies** of the 3 PEs pasted twice (for now) and list them.
- O2: If TNB verifies after 22:00, the date goes in the next night (or use Sync now). Is that OK?

## 9. Build notes (2026-10-21)

- **API** `apps/api/src/sheet-sync/`: `google-sheets.client.ts` signs its own service-account JWT
  with node:crypto (**no new npm dependency**); `sheet-sync.logic.ts` (layout by header text,
  item → group, pole key, MYT dates) + unit tests; `sheet-sync.service.ts` (nightly 14:00 UTC =
  22:00 MYT, a dry run while writing is off); ADMIN endpoints under `/sheet-sync`.
- **Migration** `20261021120000_sheet_sync` (additive): `SheetSyncTarget`, `SheetSyncCell`, `SheetSyncRun`.
- **Admin** Setup → **Google Sheet sync** (`/sheet-sync`): add a sheet, dry run, Sync now, writing
  on/off (off by default), runs with counts, check list (Excel).
- **Env:** `SHEET_SYNC_KEY_FILE` (path to the key JSON; unset = off), optional `SHEET_SYNC_NIGHTLY=false`.
- **Dates:** the sheet's locale is en_US, so a typed "05/10/2026" is stored as 10 May. ASCURE writes
  real date values with the cell format `dd/mm/yyyy`, and compares the **displayed** text. The
  DATA / summary formulas only test `<>""`, so a written date counts as repaired.
- **Tested 2026-10-21** against the test copy (`1iNv4Yuj…`, 20,152 rows), with 6 local fixture
  poles: dry run = 6 to write, 1 clash, 1 GPS 100 m off refused, cannot-repair and unverified
  skipped, "Ulan" → Rentis, first of two Tiang repairs. Write → cells read back as true dates shown
  dd/mm/yyyy, TNB's cell untouched. Re-run: 6 already correct, 0 written. Send-back: 1 cleared.
  A date typed over ASCURE's → clash, kept. ~3 s per run. Test cells cleared afterwards.
- ⚠ Seen in TNB's sheet (not ours to fix): DATA only covers QR03 rows up to ~14,006 and summary
  reads B9:B13008, so poles in rows beyond ~13,000 aren't counted in TNB's summary totals.
