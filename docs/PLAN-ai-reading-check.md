# PLAN — AI reading check: compare each typed Kelegaan reading with its meter photo

Status: **DRAFT for owner review, 2026-11-01.** API + admin web only, no APK. Follows the owner's
decision to remove the on-phone OCR (Part C of `docs/PLAN-mobile-offline-capacity-and-sync.md`):
crews type the reading and keep the photo, and the office checks it.

## 1. Goal

For every pole, the server reads the Smart Sensor meter in the **Gambar Kelegaan** photo with an
AI vision model, compares it with the value the crew **typed**, and **flags mismatches for the
DC**. The DC decides; the system never overwrites the crew's value by itself.

It catches what the OCR never could: typos (3.37 for 3.73), readings copied from the wrong pole,
photos with no meter in them, and evidence problems like the LIMA/Gerik case.

## 2. Findings

### How readings and photos are stored (no schema change needed to find them)

- The reading is an `OCR`-type checklist item. **SAVR** (production) combines photo + reading in
  one item, **GAMBAR KELEGAAN 1**; items 2 and 3 exist but were empty on the sample survey.
  **SAVT** uses one "KELEGAAN" item, or splits BACAAN / GAMBAR. All of them resolve through
  `KELEGAAN_LABEL_ALIASES` (`apps/api/src/common/checklist-columns.ts`).
- The value is in `InspectionResult.valueNumber`, or `valueText` for words such as **LO**.
- The photo is an `InspectionImage` row tagged with the **same `templateItemId`**, so the pair is
  exact, with no guessing. Files are on the VPS disk (`buildInspectionImagesDirectory`).
- The DC already has **Correct reading** (`PATCH /inspections/:id/kelegaan-reading`) and **Send
  back for re-inspection** (`POST /inspections/:id/request-reinspection`). Both stay the actions.
- A corrected reading re-runs the automatic ground-clearance grading (`refreshGroundClearance`,
  when `AUTO_GROUND_CLEARANCE=true`), so a wrong reading can create or hide a **TAK PATUH**
  defect. That is why this check matters.

### What the data looks like (prod, PE LEPAR DAGING, 136 poles, read-only)

| Typed value | Poles | Photo? |
|---|---|---|
| A number (0 – 6.45 m; 57 under 5.5 m) | 112 | all 112 have the meter photo |
| `NO ACCESS` | 14 | no |
| `UT` (Umbang Terbang, a flying stay; no Kelegaan photo by design) | 9 | no |
| Blank | 1 | no |

One reading is **0**, which is worth a look on its own. Uploaded photos average **465 KB**.

### Volume

**54,150 poles** inspected so far (48,601 SAVR, 5,549 SAVT); **~17,000 a month** in October
and rising. About **one reading photo per pole** → plan for **15,000–25,000 checks a month**.

### Model and cost (Claude API price list cached 2026-10-06; confirm before go-live)

Each check = one photo resized to ~1,280 px on its long edge (~1,500 image tokens) plus a short
prompt, ~2,000 input tokens and ~300 output tokens.

| Model | Per photo | 20,000 / month | Backfill of 54,000 | With Batch API (−50%) |
|---|---|---|---|---|
| Claude Opus 5.5 (`claude-opus-5-5`, $4 / $20 per M tokens) | ~$0.014 | ~$280 | ~$760 | ~$140 / ~$380 |
| Claude Sonnet 5.5 (`claude-sonnet-5-5`, $2 / $10) | ~$0.007 | ~$140 | ~$380 | ~$70 / ~$190 |
| Claude Haiku 5.5 (`claude-haiku-5-5`, $0.10 / $0.50) | ~$0.0004 | ~$7 | ~$19 | ~$4 / ~$10 |

These are estimates. Step 1 measures real token counts and, more importantly, **accuracy per
model** on real photos before the owner picks one (Q1).

## 3. How it works

### 3.1 The check (API, `apps/api/src/reading-check/`)

1. **Pick work:** submitted inspections whose Kelegaan item has **both** a photo and a typed
   value, and that haven't been checked against this exact photo + value yet. **UT** (Umbang
   Terbang) and **NO ACCESS** have no Kelegaan photo by design and are skipped (Q8). **Only the
   Gambar Kelegaan photo is ever sent**, never any other evidence photo (Q7).
2. **Prepare the photo:** read the file from disk; `sharp` rotates it by EXIF and resizes it to
   1,280 px on the long edge.
3. **Ask the model** with structured JSON output (`output_config.format`), e.g.:
   `{ display: "NUMBER" | "LO" | "NO_METER" | "UNREADABLE", reading: number | null,
   confidence: "high" | "medium" | "low", note: string }`.
   The prompt explains the Smart Sensor: the **big central number is the reading**, the small
   top-right number (~30 °C) is the **temperature**, and `-LO-` means below range. The typed value
   is **not** sent, so the model reads the photo blind and can't just agree with the crew.
4. **Compare** (pure function, unit-tested):
   - **MATCH**: same number within the tolerance (Q2), or both LO.
   - **MISMATCH**: numbers differ beyond the tolerance, or one side is LO and the other isn't.
   - **NO_METER / UNREADABLE**: shown to the DC as *"Photo doesn't show a readable meter"*.
   - Low confidence never counts as MISMATCH; it shows as *"Not sure — please look"*.
   - **IMPOSSIBLE** (no AI needed, runs on every reading, photo or not): a typed number **below
     3 m**. The Smart Sensor can't display under 3 m (it shows `-LO-` instead), so e.g. a typed
     **0** must be a mistake: *"Meter can't show this — check the value"*.
5. **Store** one `ReadingCheck` row (new table, additive migration): inspection, templateItemId,
   image id, typed value, model reading, display, confidence, outcome, model + prompt version,
   tokens used, checkedAt, and the DC's resolution (who, when, which action).
   A later edit of the value or photo makes a new check; old rows stay as history.

**When it runs** (Q3): nightly at 22:00 MYT via the **Batch API** (half price; results within
hours), like the Google Sheet sync, plus a **"Check readings now"** button on a survey for the DC.
A **monthly spend cap** (env) stops the job and logs it when reached.

### 3.2 What the DC sees (admin web)

- **Linked Assets table**: the pinned *Bacaan Kelegaan 1* cell gets a badge.
  - ⚠ **"Photo reads 3.73 · typed 3.37"** → **Use 3.73** (calls the existing Correct reading),
    **Keep 3.37** (marks it reviewed), or **Send back** (existing re-inspection, with the reason
    pre-filled).
  - ❓ "Photo doesn't show a readable meter" → **Keep** or **Send back**.
  - ✓ a small "checked" tick on matches.
- **Survey header** and the **Site Visits list**: "**N readings to review**", and a filter to show
  only flagged poles.
- **Map asset panel**: the same badge on the pole's reading.
- Nothing blocks the DC's normal flow (RONDAAN SELESAI → …). It's advice, not a gate (Q5).

### 3.3 What it doesn't do

- Never changes a value without a DC click; every resolution is recorded.
- Never runs on the phone; no APK needed.
- Doesn't replace the DC's own look at photos. It points them at the poles worth a look.

## 4. Owner decisions needed

| # | Question | Suggested |
|---|---|---|
| Q1 | Which model? | Decide from Step 1's accuracy test: Opus 5.5 is the most capable; Haiku 5.5 is ~40× cheaper if it's accurate enough on these photos |
| Q2 | Mismatch tolerance? | **0.05 m** (the meter shows 2 decimals; 3.73 vs 3.75 is not worth a DC's time) |
| Q3 | When does it run? | Nightly Batch + a "Check readings now" button |
| Q4 | Which surveys first? | Kuantan, then all; backfill of past surveys optional, from ARKIB/LAPORAN SELESAI back |
| Q5 | Advice only, or block RONDAAN SELESAI → next step until flags are resolved? | **Advice only** at first |
| Q6 | Monthly budget cap? | e.g. **USD 100** to start |
| Q7 | Photos are sent to Anthropic's API for reading. OK with TNB? | ✅ **Decided 2026-11-01: OK for Gambar Kelegaan photos only**; no other photo is ever sent |
| Q8 | What do **UT** and a typed **0** mean? | ✅ **Decided 2026-11-01: UT = Umbang Terbang**, which has no Kelegaan photo by design, so it's skipped (like NO ACCESS). A typed number under 3 m (e.g. 0) is impossible on the meter → flagged IMPOSSIBLE |

## 5. Steps

| Step | What | Ships as |
|---|---|---|
| 1 | **Accuracy test, no UI:** a script takes ~200 real Kelegaan photos from DC-reviewed surveys (ARKIB / LAPORAN SELESAI) with their final values, runs each candidate model, and reports agreement %, false-flag %, NO_METER cases and real token cost. Mismatches are reviewed by hand, because sometimes the photo is right and the value wrong. | Script + report; owner picks the model (Q1) |
| 2 | `ReadingCheck` table + compare logic + the nightly Batch job in **shadow mode** (stores results, nobody sees them) on one Mainhead. | Deploy (API + migration) |
| 3 | DC badges on Linked Assets + survey header count + Site Visits filter + map panel. | Deploy (admin + API) |
| 4 | "Check readings now" button, spend cap, monthly usage line on Setup. | Deploy |
| 5 | Widen to all Mainheads; optional backfill. | Config only |

## 6. Testing

- Unit: the compare table (number vs number within/beyond tolerance, LO vs LO, LO vs number,
  low confidence, NO_METER, UT / NO ACCESS skipped, a typed number under 3 m → IMPOSSIBLE); only
  Kelegaan-tagged images are ever selected; "new check only when photo or
  value changed"; spend cap stops the run.
- e2e: only ADMIN / MANAGER / QA actors see and resolve flags, scoped like Correct reading;
  resolving with "Use photo value" goes through the existing endpoint and re-runs ground-clearance
  grading; CANCELLED visits are never touched.
- Step 1's report is the accuracy baseline; re-run it whenever the prompt or model changes.
- Secret handling like the Google Sheet sync: `ANTHROPIC_API_KEY` in the VPS `.env`, never in git.
