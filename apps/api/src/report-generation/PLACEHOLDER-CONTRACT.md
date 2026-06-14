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

**Photos** — inspection + defect-evidence images (`{#photos}` … `{/photos}`):
`{image}` (the embedded photo — put this tag where the picture should appear),
`{caption}`, `{source}`

## Conditionals (show a block only when there is data)

Boolean flags can gate a whole section so empty tables don't render:
`{#hasReadings}` … `{/hasReadings}`, `{#hasChecks}` … `{/hasChecks}`,
`{#hasDefects}` … `{/hasDefects}`, `{#hasPhotos}` … `{/hasPhotos}`.

## Notes

- A missing photo file is skipped silently — it never aborts the report.
- Images are scaled to fit a ~340×255 px box, preserving aspect ratio.
- An asset with no submitted inspection, or whose scope has no active template,
  is skipped from the compiled survey report (recorded in the report metadata).
