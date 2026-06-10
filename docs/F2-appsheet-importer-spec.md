# ASCURE F2 — AppSheet Masterlist Importer Specification

Status: **DRAFT for review** (no code yet). Target: SAVR pole-patrol (RONDAAN) masterlists exported from AppSheet, imported against the **active SAVR KLB v2** checklist template.

## 0. Scope, inputs, surface

**Inputs**
- An `.xlsx` AppSheet export (sheet `RAW`); 1 row = 1 pole inspection. Reference file: `PE KG BAHAGIA.xlsx` (106 poles, Pencawang `IPH00207`).
- The **active `SAVR KLB` v2** template (48 items). The importer targets this template **explicitly** (by `name='SAVR KLB' AND isActive AND status=ACTIVE`, or an explicit `templateId`) — it does **not** per-row resolve by mainhead, because the row MAINHEAD (`SG SIPUT`) differs from the template scope (`KLB`).
- The established column → item mapping (A–L metadata, M–AJ defects → items 1–24, AK–BJ data → items 25–48).

**Out of scope (v1 of importer):** columns BK–BZ (`ASET`, `UPDATE`, `JENIS ASET`, `GAMBAR*` photos, `BACAAN KELEGAAN*` clearance readings, `STATUS`). Photos and clearance readings have no SAVR KLB item; deferred to a later extension (`GAMBAR*` → `InspectionImage`, `BACAAN KELEGAAN*` → a future reading item).

**API surface** (NestJS, tenant-scoped, gated by `ADMIN` or a new `IMPORT` capability; reuse `multer`/`FileInterceptor`):
- `POST /api/v1/imports/savr-klb/validate` (multipart `file`) → **dry-run**, writes nothing, returns the plan (§4).
- `POST /api/v1/imports/savr-klb/commit` (multipart `file` + `batchId` + `resolutions`) → **commit** (§5).

**Hard rules**
- `tenantId` is always the authenticated user's tenant — never read from the sheet.
- Two-phase: validate (dry-run) must pass before commit; commit re-validates.
- Idempotent on a caller-supplied `batchId` (§6).
- Targets v2 only; does not modify any template.

---

## 1. Entity creation order

Resolved as lookups first, then created in dependency order. Per Pencawang (the file groups under one Pencawang; a multi-Pencawang file loops this block per distinct `KOD PENCAWANG`).

| # | Entity | Action | Key / source |
|---|---|---|---|
| 0a | Tenant | resolve (auth) | `user.tenantId` |
| 0b | SAVR KLB v2 template + 48-item key map | resolve + assert | active `SAVR KLB`; assert all 48 keys present |
| 0c | AssetType `SAVR` | resolve | `[tenantId, code='SAVR']` |
| 0d | Mainhead | resolve (optional) | from `C` (`SG SIPUT`); unresolved → null + keep legacy text |
| 0e | Team | resolve / fallback | from `D` (`MIKE`) |
| 0f | Inspector `User` | resolve / fallback | from `B` email (§7) |
| 1 | **Substation** (Pencawang) | **upsert** | `[tenantId, code=H]`; name=`G`, location from `F` |
| 2 | **SiteVisit** (one per Pencawang+batch) | **upsert** | `[substationId, reportingGroup='APPSHEET:<batchId>']` |
| 3 | **Asset** (pole) | **upsert** | `[tenantId, substationId, assetCode=I]` |
| 4 | **SiteVisitAsset** (link) | upsert | `[siteVisitId, assetId]`, `source='appsheet_import'` |
| 5 | **Inspection** (one per pole) | **upsert** | `[siteVisitId, assetId, templateId]` |
| 6 | **InspectionResult** (items 25–48) | upsert | unique `[inspectionId, templateItemId]` |
| 7 | **InspectionItemResult** (items 1–24) | replace | `[inspectionId, checklistItemId]` |
| 8 | **Defect** (on FAIL) | create-if-absent | `inspectionItemResultId` (unique) |

Children (6–8) are written/replaced **within a per-pole transaction**; parents (1–2) once per Pencawang.

---

## 2. Column-by-column mapping

### 2a. Metadata A–L → ASCURE entities

| Col | Header | Target | Transform |
|---|---|---|---|
| A | UNIQUEID | provenance | store on `Asset.metadata.appsheet.uniqueId` (+ per-inspection ext ref, §6) |
| B | USER EMAIL | `Inspection.createdByUserId`, `SiteVisit.createdByUserId` | resolve user by email (§7) |
| C | MAINHEAD | `SiteVisit.mainheadId` (+ legacy `SiteVisit.mainhead`) | resolve Mainhead; unresolved → null, keep text |
| D | TEAM | `SiteVisit.teamId` | resolve Team (§7) |
| E | FUNCTIONAL LOCATION | `SiteVisit.functionalLocation` | trim text |
| F | LOCATION | `Asset.latitude/longitude`, `SiteVisit.checkInLatitude/Longitude` | split `"lat, long"` → 2 floats; validate ranges |
| G | NAMA PENCAWANG | `Substation.name`, `SiteVisit.pencawangName` | trim text |
| H | KOD PENCAWANG | `Substation.code` (upsert key), `SiteVisit.pencawangCode` | trim/upper; **required** |
| I | No Tiang RONDAAN | `Asset.assetCode` (upsert key) | trim; **required** |
| J | No Tiang LAMA | `Asset.name` and/or `Asset.metadata.appsheet.noTiangLama` | trim (`TNT` = placeholder → ignore as name) |
| K | DATE | `Inspection.submittedAt` / `SiteVisit.startedAt` | Excel serial → date (epoch 1899-12-30) or ISO parse |
| L | DATE / TIME | `Inspection.createdAt` source | mixed: Excel serial **or** ISO; normalize to UTC |

### 2b. Defects M–AJ → items 1–24 → `InspectionItemResult` (+`Defect`)

All 24 are SAVR KLB v2 **BOOLEAN, `isDefectTrigger=true`, `MEDIUM`**. Truthy marker = **`"1"`** (non-empty).

- `"1"` → `InspectionItemResult { checklistItemId: <v2 item id>, label: <v2 item label>, result: FAIL, isDefect: true, severity: <item.severity = MEDIUM> }` → triggers `Defect { status: OPEN, severity: MEDIUM }`.
- blank → `result: PASS, isDefect: false`, no defect. *(Config `passRows`: default `true` = write PASS rows for a complete checklist; `false` = defects-only.)*

Keys 1–24 (column order M→AJ): `tiang_reput_retak, tiang_condong, tiang_nombor_pudar, pengalir_mid_span_joint, pengalir_kawasan_perlu_rentis, pengalir_rendah, umbang_kendur, umbang_ulan_creepers, umbang_tiada_stay_insulator_rosak, umbang_terbongkar, ipc_kesan_bakar, ipc_tidak_cukup, blackbox_kesan_bakar, jumper_tiada_uv_sleeve, jumper_kesan_bakar, penangkap_kilat_rosak, service_talian_berada_atas_bumbung_tidak_selamat, service_wonpiece_tanggal, pembumian_kejanggalan (⚠ source header "PENGEBUMIAN"), nop_papan_tanda_tiada_pudar, sesalur_kaki_lima_wayar_tanggal, sesalur_kaki_lima_dalam_rumah_renovation, sesalur_kaki_lima_junction_box_ipc, sesalur_kaki_lima_junction_box_tanggal_kesan_bakar`.
- **Match by an explicit column→key map (position), NOT header text** (PENGEBUMIAN≠`pembumian`; `" - "` spacing varies).

### 2c. Data capture AK–BJ → items 25–48 → `InspectionResult` (typed value)

All `isDefectTrigger=false` → typed value only, no PASS/FAIL/defect. Storage: `BOOLEAN→valueBoolean`, `NUMBER→valueNumber`, `TEXT→valueText`, `SELECT→valueText`, `MULTI_SELECT→valueJson` (array).

| Col(s) | → key (type) | Transform |
|---|---|---|
| AK·AL·AM | `saiz_tiang` (SELECT) | **one-hot → single value** "7.5/9/10 Meter"; validate exactly one set |
| AN | `jenis_tiang` (SELECT) | value→option; empty→null (empty in sample) |
| AO–AW | `cable_*` (NUMBER ×9) | parse int (count 1–5); blank→null |
| AX | `jumlah_umbang` (NUMBER) | parse int; blank→null |
| AY | `jumlah_blackbox` (MULTI_SELECT) | rating → `valueJson:["1400"]`; each ∈ v2 options {1160,2160,1400,2400,…} |
| AZ | `lvpt` (NUMBER) | parse int |
| BA | `jumlah_service` (NUMBER, v2) | parse int (count 1–6) |
| BB | `umbang_terbang_support_pole` (TEXT, v2) | raw text → valueText |
| BC | `catatan_cable` (TEXT) | trim text |
| BD·BE·BF | `keadaan_di_tapak_*` (BOOLEAN) | **`/` → true**, blank→false |
| BG·BH·BI | `kawasan_*` (BOOLEAN) | **`/` → true**, blank→false |
| BJ | `kawasan_lain_lain_sila_nyatakan` (TEXT) | text→valueText; bare `/` → treat as empty (drop tick) |

> **Two truthy markers:** defects use `"1"`; site conditions use `"/"`. Truthy is defined per-column in the column map, not globally.

---

## 3. Validation rules

Severity: **ERROR** (blocks the row; or the file if structural) vs **WARNING** (coerces + proceeds, surfaced in report).

**File / structure (ERROR → abort whole file):**
- Sheet `RAW` present; header row matches the expected column map (all of A–L + M–AJ + AK–BJ resolvable). Unknown/missing mapped columns → ERROR with the offending headers.
- Active `SAVR KLB` v2 resolved and contains all 48 expected item keys; else ERROR (run the v2 migration first).
- File size / row count within limits (configurable cap).

**Row (ERROR → skip row, report):**
- `H KOD PENCAWANG` non-empty; `I No Tiang RONDAAN` non-empty (the two upsert keys).
- `F LOCATION` parses to valid lat∈[-90,90], long∈[-180,180] when present (else WARNING + null coords).
- `K/L DATE` parses (Excel serial or ISO); unparseable → WARNING + fallback to import timestamp.

**Value (WARNING → coerce):**
- Defect cols ∈ {blank, `1`}; any other non-empty → treat as truthy + WARNING.
- Site cols ∈ {blank, `/`}; other non-empty → truthy + WARNING.
- Cable / jumlah_* numeric cols parse to integer; non-numeric → WARNING + null.
- `saiz_tiang`: exactly one of AK/AL/AM set; zero or >1 set → WARNING (null / first-wins).
- `jumlah_blackbox` values ∈ v2 option set; unknown rating → WARNING + dropped (or quarantined) — never silently invents an option.
- Codes preserved as **text** (leading zeros) — never numeric-coerced.

**Referential / cross-field:**
- `tenantId` forced from auth (any tenant-like column ignored).
- Mainhead/Team/User resolution outcomes reported (unresolved = WARNING, handled per §7).
- Duplicate `A UNIQUEID` within the file → WARNING (last-wins) + report.
- Re-import guard: if a target Inspection already has **QA-progressed** defects (status≠OPEN or timeline beyond CREATED), its children are **not** clobbered → WARNING (§6/§8).

---

## 4. Dry-run response structure

`POST …/validate` returns (writes nothing):

```jsonc
{
  "batchId": "PE_KG_BAHAGIA-2026-06-06",      // echoed/derived; used for commit
  "ok": true,                                  // false if any blocking ERROR
  "template": { "id": "…", "name": "SAVR KLB", "version": 2, "itemCount": 48, "missingKeys": [] },
  "file": { "sheet": "RAW", "dataRows": 106, "mappedColumns": 62, "unmappedColumns": ["ASET","STATUS", …] },
  "summary": {
    "pencawang":        { "create": 1, "update": 0 },
    "siteVisits":       { "create": 1, "update": 0 },
    "assets":           { "create": 90, "update": 16 },
    "inspections":      { "create": 106, "update": 0 },
    "inspectionResults":{ "create": 1632 },     // items 25–48 with values
    "itemResults":      { "create": 2544 },      // items 1–24 (passRows=true)
    "defects":          { "create": 70 },        // FAIL count
    "errors": 0, "warnings": 12, "rowsSkipped": 0
  },
  "resolution": {
    "users":     [{ "email": "ahyau360@gmail.com", "status": "RESOLVED", "userId": "…" },
                  { "email": "x@y.com", "status": "FALLBACK", "fallbackUserId": "…" }],
    "teams":     [{ "name": "MIKE", "status": "RESOLVED", "teamId": "…" }],
    "mainheads": [{ "name": "SG SIPUT", "status": "UNRESOLVED" }]
  },
  "rows": [
    { "row": 2, "uniqueId": "80afb907", "pencawangCode": "IPH00207", "assetCode": "A 1",
      "asset": "create", "inspection": "create", "defects": 1,
      "warnings": [{ "column": "BD", "code": "TRUTHY_MARKER", "message": "expected '/' got 'X'" }],
      "errors": [] }
    // … one entry per data row
  ],
  "blocking": []   // file/structure ERRORs that aborted (empty when ok)
}
```

The same shape is returned by `commit` with `applied` counts instead of projected ones.

---

## 5. Commit flow

1. **Auth + gate** (ADMIN / IMPORT capability), tenant from token.
2. **Parse + re-validate** the uploaded file (identical to dry-run). If any blocking ERROR → 422 with the dry-run report; nothing written.
3. **Resolve** template (v2), AssetType, Mainhead, Team, inspector users (apply caller `resolutions` overrides).
4. **Per-Pencawang transaction** (one `$transaction` per distinct `KOD PENCAWANG`; for the sample, one):
   a. upsert Substation `[tenantId, code]`.
   b. upsert SiteVisit `[substationId, reportingGroup='APPSHEET:<batchId>']` (status COMPLETED, visitType AUDIT, scope SAVR, dates from K/L range).
   c. for each pole row, in a nested unit:
      - upsert Asset `[tenantId, substationId, assetCode]` (assetTypeId=SAVR, coords, metadata provenance).
      - upsert SiteVisitAsset `[siteVisitId, assetId]` (`source='appsheet_import'`).
      - upsert Inspection `[siteVisitId, assetId, templateId]` (createdByUserId, submittedAt, completionStatus=SUBMITTED, scope SAVR).
      - **replace children** for that inspection (idempotent, §6): upsert InspectionResults (25–48); delete+recreate InspectionItemResults (1–24) and their Defects — **skipping** any defect that is QA-progressed (guard).
5. **Response**: the §4 structure with `applied` counts + per-row outcomes; HTTP 200.
6. **Failure policy**: a per-Pencawang transaction is all-or-nothing; a failure in one Pencawang rolls back only that Pencawang and is reported; other Pencawangs still commit (configurable to strict all-or-nothing).
7. **Volume**: chunk row processing (e.g., 200 poles/tx) to bound transaction size; the sample fits one.

---

## 6. Idempotency strategy

**Anchor = caller-supplied `batchId`** (default derived from filename + content hash). Same `batchId` re-run = update-in-place; a new `batchId` = a new inspection cycle (legitimate re-inspection).

Natural keys (no duplicates on re-run):
- Substation: `[tenantId, code]` (DB unique).
- Asset: `[tenantId, substationId, assetCode]` (DB unique).
- SiteVisit: `[substationId, reportingGroup='APPSHEET:<batchId>']` (app-level key; one visit per Pencawang per batch).
- Inspection: `[siteVisitId, assetId, templateId]` (app-level; one per pole per batch).
- InspectionResult: `[inspectionId, templateItemId]` (DB unique → true upsert).
- InspectionItemResult: no DB unique → **delete-by-`inspectionId` then recreate** within the tx (clean replace).

**Provenance** (audit + re-match): `Asset.metadata.appsheet = { uniqueId, noTiangLama, lastBatchId }`; `SiteVisitAsset.source='appsheet_import'`; `SiteVisit.reportingGroup='APPSHEET:<batchId>'`.

**Recommended (optional) additive schema** for bulletproof per-inspection idempotency/audit: add `Inspection.externalRef String?` (e.g. `appsheet:<uniqueId>`) with an index, so re-import matches the exact AppSheet row even if asset keys change. **Fallback without migration:** the `[siteVisit(batch), asset, template]` key above is sufficient; UNIQUEID is kept in `Asset.metadata`.

**QA-protection:** never overwrite a Defect that has advanced past import state (status≠OPEN, or `DefectTimelineEntry` beyond `CREATED`, or evidence images). Such inspections are reported as `skipped:qa-locked` rather than re-written.

---

## 7. User / Team / Mainhead resolution strategy

**Inspector (`B USER EMAIL`)** → `User` by `email` (case-insensitive, `tenantId`, `isActive`):
- **RESOLVED** → use `user.id` for `createdByUserId`.
- **UNRESOLVED** → assign a configured **import service user** (e.g. `appsheet-import@ascure.local`, ADMIN-seeded once) and keep the original email in `Asset.metadata.appsheet.inspectorEmail`. Reported as `FALLBACK`.
- Caller may pass `resolutions.users: [{ email, userId }]` overrides (from the dry-run's unresolved list) before commit.

**Team (`D TEAM`)** → `Team` by `code`/`name` (`tenantId`, active); unresolved → configured fallback import team (or `resolutions.teams` override). `SiteVisit.teamId` is required, so a fallback team must exist.

**Mainhead (`C MAINHEAD`)** → `Mainhead` by `name`/`code`; unresolved → `SiteVisit.mainheadId=null` + keep `SiteVisit.mainhead='<text>'` (legacy field). Never blocks. Note the known mismatch: row mainhead (`SG SIPUT`) ≠ template scope (`KLB`); the template is chosen explicitly, so this is recorded, not enforced.

**Substation/Asset are never "resolved to a user" — they're upserted** (created if absent), since the masterlist is the source of truth for inventory.

---

## 8. Error handling strategy

**Taxonomy**
- `STRUCTURE` (file/template) → **abort**, 422, nothing written, `blocking[]` populated.
- `ROW` (missing keys, unparseable required fields) → **skip row**, continue, recorded in `rows[].errors`.
- `VALUE` (bad marker, non-numeric, unknown option) → **coerce + WARNING**, recorded in `rows[].warnings`.
- `RESOLUTION` (unresolved user/team/mainhead) → WARNING + fallback (§7).
- `CONFLICT` (QA-locked defect on re-import) → **skip child rewrite**, WARNING.

**Transactions & partial failure**
- Each Pencawang commits in its own `$transaction`; a runtime failure rolls back that Pencawang only and is reported (`pencawang[].status='failed'`), others proceed. A `--strict` mode wraps the whole file in one transaction (all-or-nothing).
- Commit re-runs full validation first; it never writes a partially-validated file.

**Excel robustness**
- Read all cells as text first (preserve leading zeros / codes); coerce per column. Handle Excel date serials, empty/merged cells, trailing blank rows, BOM.

**Observability & recovery**
- Every commit returns per-row outcomes; persist a compact import log (batchId, counts, warnings) — provenance lives in `Asset.metadata` / `SiteVisit.reportingGroup`.
- Re-runnable: a failed/partial commit can be retried with the same `batchId` (idempotent upserts).
- Rollback of a whole batch (manual): identifiable by `SiteVisit.reportingGroup='APPSHEET:<batchId>'` + `SiteVisitAsset.source` + `Asset.metadata.appsheet.lastBatchId`.

---

## 9. Open decisions (defaults chosen; flip via config)

| Decision | Default | Alt |
|---|---|---|
| blank defect cell | PASS (no defect) | NA |
| PASS item-results | written (full checklist) | defects-only (lighter) |
| SiteVisit grouping | one per Pencawang per batch | per date / per pole |
| Inspection status | `SUBMITTED` (historical) | `DRAFT` |
| Per-inspection idempotency | `[siteVisit(batch), asset, template]` | add `Inspection.externalRef` (recommended) |
| Unresolved inspector | import service user + email kept | block row |
| Commit failure scope | per-Pencawang | strict whole-file |
| Import gate | new `IMPORT` capability | interim `ADMIN` |

## 10. Prerequisites before build
1. SAVR KLB **v2 published** on prod (the `savr-klb-v2.ts` step).
2. Confirm full `jumlah_blackbox` option set on v2 (extend if more ratings exist).
3. Seed the **import service user** + **fallback import team** (for unresolved rows).
4. Decide the §9 defaults.
