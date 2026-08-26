# Visual Report — `.docx` template placeholder contract

Templates are authored in **Microsoft Word** and uploaded per asset
**Operational Scope** (PENCAWANG / FEEDER_PILLAR / SAVR / SAVT / LINK_BOX /
CABLE_BRIDGE) under **Report Templates** in the admin app. The system fills the
placeholders with each asset's latest **submitted** inspection
([easy-template-x](https://github.com/alonrbar/easy-template-x)), converts the
result to PDF (Gotenberg / LibreOffice), and — at **LAPORAN SELESAI** — merges
every asset's report behind a cover page into one frozen PDF.

Delimiters are curly braces: `{tagName}`. Whitespace inside braces is allowed.

## Fixed tags (single values)

| Tag | Meaning |
| --- | --- |
| `{assetCode}` | Asset code (No. Tiang Rondaan) |
| `{assetName}` | Asset name |
| `{assetType}` | Asset type name |
| `{operationalScope}` | Operational scope (e.g. PENCAWANG) |
| `{status}` | Asset status |
| `{noTiangLama}` | Previous pole number |
| `{latitude}` / `{longitude}` / `{gps}` | GPS coordinates (`gps` = "lat, lng") |
| `{pencawang}` | Pencawang name — the LIVE entity name (visit snapshot as fallback) |
| `{pencawangCode}` / `{pencawangName}` | Pencawang code / name (live entity first) |
| `{functionalLocation}` | Functional location / operational alamat (from the visit) |
| `{mainhead}` | MAINHEAD — the linked MAINHEAD record's name (visit free-text as fallback) |
| `{routeCode}` | SAVT route code (KOD TIANG); blank on non-route surveys |
| `{fromPencawang}` / `{toPencawang}` | SAVT route endpoints (names; code as fallback) |
| `{route}` | Ready-made "FROM → TO" (blank on non-route surveys) |
| `{inspector}` / `{inspectorEmail}` | Inspector who submitted |
| `{inspectionDate}` | Inspection created date-time (MYT) |
| `{submittedDate}` | Submission date-time (MYT) |
| `{visitType}` | Site visit type |
| `{cycle}` | Inspection cycle number |
| `{generatedAt}` | When the report was generated (MYT) |
| `{readingCount}` / `{checkCount}` / `{defectCount}` / `{photoCount}` | Counts |

## Loops (repeating rows / blocks)

Wrap repeating content between `{#name}` and `{/name}`. Inside a loop, reference
the item fields by their bare names. Place the open/close tags in the first/last
cell of a table row to repeat the row.

**Readings** — typed checklist values (`{#readings}` … `{/readings}`):
`{key}`, `{label}`, `{type}`, `{value}`

**Checks** — PASS/FAIL/NA outcomes (`{#checks}` … `{/checks}`):
`{label}`, `{result}`, `{remark}`, `{severity}`. The `{remark}` is the LIVE
recorded value (reflects office checklist edits); an item whose value the
office CLEARED renders with blank result/remark/severity — the verdict follows
the value, exactly like the screens.

**Defects** — failed items flagged as defects (`{#defects}` … `{/defects}`):
`{label}`, `{severity}`, `{status}`, `{lifecycle}`, `{dueDate}`, `{remark}`.
An item whose value was cleared by the office is excluded.

**Photos — all** — every image (`{#photos}` … `{/photos}`):
`{image}` (the embedded photo — put this tag where the picture should appear),
`{caption}`, `{source}`

**Other photos** — everything NOT tied to a checklist IMAGE item (ad-hoc
captures + defect evidence) (`{#otherPhotos}` … `{/otherPhotos}`): same fields
`{image}`, `{caption}`, `{source}`. Use this for a "remaining photos" gallery so
per-item photos you placed individually (see below) are **not** duplicated.

**Per-item photos — labelled** — one entry per IMAGE checklist item that has a
photo (`{#photoItems}` … `{/photoItems}`): `{label}`, `{key}`, `{tag}`, `{image}`.

**Per-item photos — two-up grid** — the same labelled photos paired two per loop
entry for a 2-column layout (`{#photoItemRows}` … `{/photoItemRows}`):
`{label1}`, `{image1}`, `{label2}`, `{image2}`. Put the open tag in the first
cell of a label row and the close tag in the last cell of the image row below it
— the two-row range repeats per pair. An odd photo count leaves the second
column of the last pair blank.

## Place a specific item's photo — `{img_<KEY>}`

Every IMAGE-type checklist item's photo is also exposed as a **flat tag**, so you
can drop a specific photo exactly where you want it (independent of the loops).
The tag is `img_` + the item's **key**, uppercased with each run of
non-alphanumeric characters collapsed to `_`:

| Checklist item key | Tag |
| --- | --- |
| `GAMBAR PENUH TIANG` | `{img_GAMBAR_PENUH_TIANG}` |
| `GAMBAR SPAN` | `{img_GAMBAR_SPAN}` |

Place `{img_GAMBAR_PENUH_TIANG}` where the picture belongs, then use
`{#otherPhotos}` … `{/otherPhotos}` for the rest — it excludes the per-item
photos, so nothing duplicates. (Tip: drop a `{#photoItems}` loop printing `{tag}`
into a draft to discover the exact tag for each IMAGE item in your template.)

### An item with MORE than one photo — numbered tags

When the crew captures several photos against the SAME item, each photo gets its
own flat tag: the first keeps the plain tag, the rest are numbered:

| Photo | Tag |
| --- | --- |
| 1st | `{img_GAMBAR_ASET_TIANG}` |
| 2nd | `{img_GAMBAR_ASET_TIANG_2}` |
| 3rd | `{img_GAMBAR_ASET_TIANG_3}` |

Lay the numbered tags in adjacent grid cells; a tag whose photo doesn't exist
renders blank (the cell simply stays empty), so it is safe to pre-place
`_2`/`_3` cells for fields that only sometimes get extra photos.

Alternatively, loop EVERY photo of one item with `{#imgs_<KEY>}` …
`{/imgs_<KEY>}` (same `<KEY>` spelling as the `img_` tag) — fields inside:
`{image}`, `{caption}` (the item label), `{index}` ("1", "2", …). Put the
open/close tags in one table row to get one row per photo. Note a loop repeats
whole rows — it cannot wrap photos across a multi-column grid; use the numbered
flat tags for grid layouts.

## Conditionals (show a block only when there is data)

Boolean flags can gate a whole section so empty tables don't render:
`{#hasReadings}` … `{/hasReadings}`, `{#hasChecks}` … `{/hasChecks}`,
`{#hasDefects}` … `{/hasDefects}`, `{#hasPhotos}` … `{/hasPhotos}`,
`{#hasPhotoItems}` … `{/hasPhotoItems}`, `{#hasOtherPhotos}` … `{/hasOtherPhotos}`.

## Notes

- A missing photo file is skipped silently — it never aborts the report.
- Images are scaled to fit a ~130×175 px box, preserving aspect ratio. The box
  is deliberately small so a photo fits inside a narrow multi-up image cell:
  a docx cell narrower than the rendered image does not shrink it — LibreOffice
  clips the right/bottom edge (which was cropping the GPS/timestamp watermark).
  For larger photos, widen the template's image cells AND raise the box
  (`MAX_IMAGE_WIDTH`/`MAX_IMAGE_HEIGHT` in `report-image.util.ts`) together.
- An asset with no submitted inspection, or whose scope has no active template,
  is skipped from the compiled survey report (recorded in the report metadata).
