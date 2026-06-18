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
| `{pencawang}` | Pencawang name (falls back to code) |
| `{pencawangCode}` / `{pencawangName}` | Pencawang code / name |
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
`{label}`, `{result}`, `{remark}`, `{severity}`

**Defects** — failed items flagged as defects (`{#defects}` … `{/defects}`):
`{label}`, `{severity}`, `{status}`, `{lifecycle}`, `{dueDate}`, `{remark}`

**Photos — all** — every image (`{#photos}` … `{/photos}`):
`{image}` (the embedded photo — put this tag where the picture should appear),
`{caption}`, `{source}`

**Other photos** — everything NOT tied to a checklist IMAGE item (ad-hoc
captures + defect evidence) (`{#otherPhotos}` … `{/otherPhotos}`): same fields
`{image}`, `{caption}`, `{source}`. Use this for a "remaining photos" gallery so
per-item photos you placed individually (see below) are **not** duplicated.

**Per-item photos — labelled** — one entry per IMAGE checklist item that has a
photo (`{#photoItems}` … `{/photoItems}`): `{label}`, `{key}`, `{tag}`, `{image}`.

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

## Conditionals (show a block only when there is data)

Boolean flags can gate a whole section so empty tables don't render:
`{#hasReadings}` … `{/hasReadings}`, `{#hasChecks}` … `{/hasChecks}`,
`{#hasDefects}` … `{/hasDefects}`, `{#hasPhotos}` … `{/hasPhotos}`,
`{#hasPhotoItems}` … `{/hasPhotoItems}`, `{#hasOtherPhotos}` … `{/hasOtherPhotos}`.

## Notes

- A missing photo file is skipped silently — it never aborts the report.
- Images are scaled to fit a ~340×255 px box, preserving aspect ratio.
- An asset with no submitted inspection, or whose scope has no active template,
  is skipped from the compiled survey report (recorded in the report metadata).
