"""Generate the MAINHEAD Backfill Assessment (Production-Safe) PDF.

Assessment only — documents the read-only diagnostics, mapping, backfill
script, rollback, and validation for populating SiteVisit.mainheadId from the
legacy `mainhead` text column. No database changes are performed by this file.
"""

import html

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    PageBreak,
    Table,
    TableStyle,
)


OUTPUT = r"C:\ASCURE\docs\g3-mainhead-backfill-assessment.pdf"


def build_styles():
    base = getSampleStyleSheet()
    title = ParagraphStyle("TitleX", parent=base["Title"], fontName="Helvetica-Bold",
        fontSize=20, leading=24, textColor=colors.HexColor("#0F172A"), spaceAfter=6)
    subtitle = ParagraphStyle("Subtitle", parent=base["Normal"], fontName="Helvetica",
        fontSize=10, leading=14, textColor=colors.HexColor("#475569"), spaceAfter=14)
    h1 = ParagraphStyle("H1X", parent=base["Heading1"], fontName="Helvetica-Bold",
        fontSize=15, leading=19, textColor=colors.HexColor("#0F172A"),
        spaceBefore=14, spaceAfter=6, keepWithNext=1)
    h2 = ParagraphStyle("H2X", parent=base["Heading2"], fontName="Helvetica-Bold",
        fontSize=12, leading=16, textColor=colors.HexColor("#0F172A"),
        spaceBefore=10, spaceAfter=4, keepWithNext=1)
    body = ParagraphStyle("BodyX", parent=base["BodyText"], fontName="Helvetica",
        fontSize=10, leading=14, textColor=colors.HexColor("#1F2937"),
        spaceAfter=6, alignment=TA_LEFT)
    bullet = ParagraphStyle("BulletX", parent=body, leftIndent=14, bulletIndent=2, spaceAfter=3)
    code = ParagraphStyle("CodeX", parent=body, fontName="Courier", fontSize=7.2, leading=9.7,
        textColor=colors.HexColor("#0F172A"),
        backColor=colors.HexColor("#F1F5F9"), borderColor=colors.HexColor("#E2E8F0"),
        borderWidth=0.5, borderPadding=6, leftIndent=0, rightIndent=0, spaceAfter=8)
    callout_warn = ParagraphStyle("CalloutWarn", parent=body, fontName="Helvetica-Bold",
        fontSize=11, leading=15, textColor=colors.HexColor("#92400E"),
        backColor=colors.HexColor("#FFFBEB"), borderColor=colors.HexColor("#F59E0B"),
        borderWidth=0.6, borderPadding=10, spaceAfter=10)
    callout_info = ParagraphStyle("CalloutInfo", parent=body, fontName="Helvetica",
        fontSize=10.5, leading=15, textColor=colors.HexColor("#0F3D3A"),
        backColor=colors.HexColor("#F0FDFA"), borderColor=colors.HexColor("#0F766E"),
        borderWidth=0.6, borderPadding=10, spaceAfter=10)
    return {"title": title, "subtitle": subtitle, "h1": h1, "h2": h2,
            "body": body, "bullet": bullet, "code": code,
            "callout_warn": callout_warn, "callout_info": callout_info}


def bullets(items, style):
    return [Paragraph(item, style, bulletText="•") for item in items]


def cell(text):
    return Paragraph(text, ParagraphStyle("cell", fontSize=8.5, leading=11, fontName="Helvetica"))


def make_table(data, col_widths):
    style = [
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F766E")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("LEADING", (0, 0), (-1, -1), 11),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("TEXTCOLOR", (0, 1), (-1, -1), colors.HexColor("#1F2937")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    return Table(data, colWidths=col_widths, style=TableStyle(style), repeatRows=1)


def code_block(raw, style):
    """Render literal code (SQL) safely inside a Paragraph: escape XML, keep
    indentation via nbsp, keep line breaks via <br/>."""
    escaped = html.escape(raw.strip("\n"), quote=False)
    out_lines = []
    for line in escaped.split("\n"):
        stripped = line.lstrip(" ")
        indent = len(line) - len(stripped)
        out_lines.append("&nbsp;" * indent + stripped)
    return Paragraph("<br/>".join(out_lines), style)


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawString(2 * cm, 1.2 * cm, "ASCURE — MAINHEAD Backfill Assessment (Production-Safe)")
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Page {doc.page}")
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, 1.5 * cm, A4[0] - 2 * cm, 1.5 * cm)
    canvas.restoreState()


# --------------------------------------------------------------------------- #
#  SQL payloads (rendered verbatim; never executed by this generator)
# --------------------------------------------------------------------------- #

SQL_D1 = r"""
-- D1: Exact NULL-FK rows, with legacy text and candidate resolution preview
WITH legacy AS (
  SELECT
    sv.id,
    sv."tenantId",
    sv."mainhead"                                                AS legacy_text,
    lower(btrim(regexp_replace(sv."mainhead", '\s+', ' ', 'g'))) AS norm_text,
    sv.status,
    sv."startedAt"
  FROM "SiteVisit" sv
  WHERE sv."mainheadId" IS NULL
),
candidate AS (
  SELECT l.id, m.id AS candidate_mainhead_id, m.code AS candidate_code, m.name AS candidate_name
  FROM legacy l
  JOIN "Mainhead" m
    ON m."isActive" = TRUE
   AND l.norm_text IS NOT NULL AND l.norm_text <> ''
   AND (
        lower(btrim(regexp_replace(m.name, '\s+', ' ', 'g')))                                 = l.norm_text
     OR lower(btrim(regexp_replace(coalesce(m.code, ''), '\s+', ' ', 'g')))                   = l.norm_text
     OR lower(btrim(regexp_replace(coalesce(m.code,'') || ' - ' || m.name, '\s+', ' ', 'g'))) = l.norm_text
   )
)
SELECT
  l.id                                       AS site_visit_id,
  l."tenantId"                               AS tenant_id,
  l.legacy_text,
  l.status,
  l."startedAt",
  count(c.candidate_mainhead_id)             AS candidate_count,
  min(c.candidate_code)                      AS sample_candidate_code,
  min(c.candidate_name)                      AS sample_candidate_name,
  CASE
    WHEN count(DISTINCT c.candidate_mainhead_id) = 1 THEN 'MATCH_UNIQUE'
    WHEN count(DISTINCT c.candidate_mainhead_id) > 1 THEN 'AMBIGUOUS'
    WHEN l.legacy_text IS NULL OR btrim(l.legacy_text) = '' THEN 'NO_LEGACY_TEXT'
    ELSE 'UNMATCHED'
  END                                        AS resolution
FROM legacy l
LEFT JOIN candidate c ON c.id = l.id
GROUP BY l.id, l."tenantId", l.legacy_text, l.status, l."startedAt"
ORDER BY resolution, l."startedAt";
"""

SQL_D2 = r"""
-- D2: Distinct legacy-text -> Mainhead mapping with ambiguity classification
WITH legacy AS (
  SELECT
    sv."mainhead"                                                AS legacy_text,
    lower(btrim(regexp_replace(sv."mainhead", '\s+', ' ', 'g'))) AS norm_text
  FROM "SiteVisit" sv
  WHERE sv."mainheadId" IS NULL
    AND sv."mainhead" IS NOT NULL AND btrim(sv."mainhead") <> ''
),
distinct_text AS (
  SELECT legacy_text, norm_text, count(*) AS affected_rows
  FROM legacy GROUP BY legacy_text, norm_text
),
matched AS (
  SELECT
    d.legacy_text, d.affected_rows,
    m.id AS mainhead_id, m.code AS mainhead_code, m.name AS mainhead_name,
    CASE
      WHEN lower(btrim(regexp_replace(m.name,'\s+',' ','g')))                             = d.norm_text THEN 'name'
      WHEN lower(btrim(regexp_replace(coalesce(m.code,''),'\s+',' ','g')))                = d.norm_text THEN 'code'
      WHEN lower(btrim(regexp_replace(coalesce(m.code,'')||' - '||m.name,'\s+',' ','g'))) = d.norm_text THEN 'label'
    END AS matched_on
  FROM distinct_text d
  JOIN "Mainhead" m
    ON m."isActive" = TRUE
   AND (
        lower(btrim(regexp_replace(m.name,'\s+',' ','g')))                             = d.norm_text
     OR lower(btrim(regexp_replace(coalesce(m.code,''),'\s+',' ','g')))                = d.norm_text
     OR lower(btrim(regexp_replace(coalesce(m.code,'')||' - '||m.name,'\s+',' ','g'))) = d.norm_text
   )
)
SELECT
  d.legacy_text,
  d.affected_rows,
  count(DISTINCT m.mainhead_id) AS distinct_mainhead_matches,
  string_agg(DISTINCT m.mainhead_code || ' / ' || m.mainhead_name || ' (' || m.matched_on || ')', '; ') AS matched_mainheads,
  CASE
    WHEN count(DISTINCT m.mainhead_id) = 1 THEN 'WILL_BACKFILL'
    WHEN count(DISTINCT m.mainhead_id) > 1 THEN 'AMBIGUOUS_SKIP'
    ELSE 'UNMATCHED_SKIP'
  END AS decision
FROM distinct_text d
LEFT JOIN matched m ON m.legacy_text = d.legacy_text
GROUP BY d.legacy_text, d.affected_rows
ORDER BY decision, d.affected_rows DESC;
"""

SQL_D3 = r"""
-- D3: Production-safe MAINHEAD backfill for SiteVisit
-- Idempotent | ambiguity-guarded | self-documenting backup table | single transaction
BEGIN;

-- 3a. Backup / audit table (forward record + rollback source). Survives the transaction.
CREATE TABLE IF NOT EXISTS "_backfill_SiteVisit_mainhead_20260604" (
  site_visit_id        uuid PRIMARY KEY,
  previous_mainhead_id uuid,                 -- always NULL for these rows; captured for audit
  legacy_mainhead_text text,
  assigned_mainhead_id uuid NOT NULL,
  backfilled_at        timestamptz NOT NULL DEFAULT now()
);

-- 3b. Resolve the unique-match set (same logic as D2; only 1-distinct-candidate rows qualify).
WITH legacy AS (
  SELECT sv.id, sv."mainhead" AS legacy_text,
         lower(btrim(regexp_replace(sv."mainhead", '\s+', ' ', 'g'))) AS norm_text
  FROM "SiteVisit" sv
  WHERE sv."mainheadId" IS NULL
    AND sv."mainhead" IS NOT NULL AND btrim(sv."mainhead") <> ''
),
candidate AS (
  SELECT l.id, l.legacy_text, m.id AS mainhead_id
  FROM legacy l
  JOIN "Mainhead" m
    ON m."isActive" = TRUE
   AND (
        lower(btrim(regexp_replace(m.name,'\s+',' ','g')))                             = l.norm_text
     OR lower(btrim(regexp_replace(coalesce(m.code,''),'\s+',' ','g')))                = l.norm_text
     OR lower(btrim(regexp_replace(coalesce(m.code,'')||' - '||m.name,'\s+',' ','g'))) = l.norm_text
   )
),
resolved AS (
  SELECT id, legacy_text,
         count(DISTINCT mainhead_id) AS match_count,
         min(mainhead_id)            AS mainhead_id   -- meaningful only when match_count = 1
  FROM candidate GROUP BY id, legacy_text
)
INSERT INTO "_backfill_SiteVisit_mainhead_20260604"
       (site_visit_id, previous_mainhead_id, legacy_mainhead_text, assigned_mainhead_id)
SELECT r.id, NULL::uuid, r.legacy_text, r.mainhead_id
FROM resolved r
WHERE r.match_count = 1
ON CONFLICT (site_visit_id) DO NOTHING;       -- re-run safe

-- 3c. Apply the backfill ONLY to captured rows, ONLY while still NULL.
--     NOTE: updatedAt is intentionally NOT modified (preserves last-activity / staleness signals).
UPDATE "SiteVisit" sv
SET "mainheadId" = b.assigned_mainhead_id
FROM "_backfill_SiteVisit_mainhead_20260604" b
WHERE sv.id = b.site_visit_id
  AND sv."mainheadId" IS NULL;                -- idempotency guard

-- 3d. In-transaction sanity check: every touched row points to an ACTIVE Mainhead.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM "_backfill_SiteVisit_mainhead_20260604" b
  JOIN "SiteVisit" sv ON sv.id = b.site_visit_id
  LEFT JOIN "Mainhead" m ON m.id = sv."mainheadId" AND m."isActive" = TRUE
  WHERE sv."mainheadId" <> b.assigned_mainhead_id   -- diverged from plan
     OR m.id IS NULL;                                -- missing/inactive Mainhead
  IF bad > 0 THEN
    RAISE EXCEPTION 'Backfill integrity check failed for % row(s); rolling back', bad;
  END IF;
END $$;

COMMIT;
-- Keep the backup table until post-deploy validation passes, then archive/drop.
"""

SQL_D4 = r"""
-- D4a: Exact reversal from the backup table (preferred).
-- Reverts ONLY rows the backfill set, and ONLY if they still hold the assigned value.
BEGIN;
UPDATE "SiteVisit" sv
SET "mainheadId" = b.previous_mainhead_id          -- NULL
FROM "_backfill_SiteVisit_mainhead_20260604" b
WHERE sv.id = b.site_visit_id
  AND sv."mainheadId" = b.assigned_mainhead_id;    -- guard: only undo our own writes
COMMIT;
-- Optional, once confirmed reverted:
-- DROP TABLE "_backfill_SiteVisit_mainhead_20260604";
"""

SQL_B = r"""
-- B1: NULL-FK volume and tenant total
SELECT
  count(*)                                          AS total_visits,
  count(*) FILTER (WHERE "mainheadId" IS NULL)      AS null_fk_visits,
  count(*) FILTER (WHERE "mainheadId" IS NOT NULL)  AS populated_fk_visits
FROM "SiteVisit";

-- B2: planned coverage (must equal the WILL_BACKFILL totals from D2)
WITH legacy AS (
  SELECT sv.id, lower(btrim(regexp_replace(sv."mainhead",'\s+',' ','g'))) AS norm_text
  FROM "SiteVisit" sv
  WHERE sv."mainheadId" IS NULL AND sv."mainhead" IS NOT NULL AND btrim(sv."mainhead") <> ''
),
cand AS (
  SELECT l.id, count(DISTINCT m.id) AS mc
  FROM legacy l
  LEFT JOIN "Mainhead" m ON m."isActive" AND (
       lower(btrim(regexp_replace(m.name,'\s+',' ','g')))                             = l.norm_text
    OR lower(btrim(regexp_replace(coalesce(m.code,''),'\s+',' ','g')))                = l.norm_text
    OR lower(btrim(regexp_replace(coalesce(m.code,'')||' - '||m.name,'\s+',' ','g'))) = l.norm_text)
  GROUP BY l.id
)
SELECT
  count(*) FILTER (WHERE mc = 1) AS will_backfill,
  count(*) FILTER (WHERE mc > 1) AS ambiguous_skip,
  count(*) FILTER (WHERE mc = 0) AS unmatched_skip
FROM cand;

-- B3: QA baseline. Replace the id list with the qaMainheadIds the app resolves for
--     the QA Manager (UserMainheadAccess + region inheritance).
SELECT count(*) AS qa_visible_before
FROM "SiteVisit"
WHERE "mainheadId" IN ('<KLB_MAINHEAD_ID>');   -- expected: 1, per audit
"""

SQL_A = r"""
-- A1: rows actually changed equals the plan
SELECT count(*) AS rows_backfilled FROM "_backfill_SiteVisit_mainhead_20260604";
-- equals B2.will_backfill

-- A2: NULL volume dropped by exactly rows_backfilled (others remain by design)
SELECT count(*) FILTER (WHERE "mainheadId" IS NULL) AS null_fk_after FROM "SiteVisit";
-- null_fk_after = B1.null_fk_visits - A1.rows_backfilled

-- A3: referential + activity integrity -- must return 0
SELECT count(*) AS broken_or_inactive
FROM "SiteVisit" sv
LEFT JOIN "Mainhead" m ON m.id = sv."mainheadId"
WHERE sv."mainheadId" IS NOT NULL AND (m.id IS NULL OR m."isActive" = FALSE);

-- A4: every backfilled row matches its plan exactly -- must return 0
SELECT count(*) AS diverged
FROM "_backfill_SiteVisit_mainhead_20260604" b
JOIN "SiteVisit" sv ON sv.id = b.site_visit_id
WHERE sv."mainheadId" <> b.assigned_mainhead_id;

-- A5: QA visibility now reflects the data -- re-run B3 with the same id list
SELECT count(*) AS qa_visible_after
FROM "SiteVisit"
WHERE "mainheadId" IN ('<KLB_MAINHEAD_ID>');
-- qa_visible_after = 1 (original) + (# backfilled rows whose text resolved to KLB)
"""


def build_story(s):
    story = []

    story.append(Paragraph("MAINHEAD Backfill Assessment", s["title"]))
    story.append(
        Paragraph(
            "Production-safe assessment for populating the structured "
            "<font face='Courier'>SiteVisit.mainheadId</font> foreign key from the deprecated "
            "<font face='Courier'>SiteVisit.mainhead</font> text column, so that legacy visits "
            "become visible to QA actors under the Governance G3 scope. "
            "<b>Assessment only — no database changes are executed.</b>",
            s["subtitle"],
        )
    )

    story.append(
        Paragraph(
            "CONTEXT — The G3 QA scope predicate is "
            "<font face='Courier'>{ mainheadId: { in: qaMainheadIds } }</font> "
            "(site-visits.service.ts:2165) and consults the structured FK only. Authorization is "
            "correct; the remaining gap is data shape: legacy rows carry "
            "<font face='Courier'>mainheadId = NULL</font> and hold their MAINHEAD identity only in "
            "the text column. This backfill closes that gap.",
            s["callout_info"],
        )
    )

    story.append(
        Paragraph(
            "SAFETY POSTURE — The backfill is idempotent (fills "
            "<font face='Courier'>NULL</font> only, never reassigns), ambiguity-guarded (a legacy "
            "text is applied only when exactly one active Mainhead matches), reversible (exact "
            "rollback from a backup table), and leaves "
            "<font face='Courier'>updatedAt</font> untouched so last-activity and operational-health "
            "staleness signals are not perturbed.",
            s["callout_warn"],
        )
    )

    # 0. Grounding facts
    story.append(Paragraph("0. Grounding facts (verified against the repo)", s["h1"]))
    g = [
        [cell("<b>Object</b>"), cell("<b>Physical name</b>"), cell("<b>Notes</b>")],
        [
            cell("Structured FK"),
            cell("<font face='Courier'>\"SiteVisit\".\"mainheadId\"</font> UUID NULL"),
            cell("FK <font face='Courier'>SiteVisit_mainheadId_fkey</font> to "
                 "<font face='Courier'>\"Mainhead\"(\"id\")</font>, ON DELETE SET NULL."),
        ],
        [
            cell("Legacy text"),
            cell("<font face='Courier'>\"SiteVisit\".\"mainhead\"</font> TEXT NULL"),
            cell("Deprecated. May hold a name, a code, a label, or free text from mobile."),
        ],
        [
            cell("Tenant anchor"),
            cell("<font face='Courier'>\"SiteVisit\".\"tenantId\"</font> UUID NOT NULL"),
            cell("Present on the row directly."),
        ],
        [
            cell("Target"),
            cell("<font face='Courier'>\"Mainhead\"</font>: id, code (nullable), name, isActive"),
            cell("<b>No unique constraint on code or name</b> — ambiguity is possible and is guarded."),
        ],
    ]
    story.append(make_table(g, [3.2 * cm, 6.3 * cm, 7.5 * cm]))
    story.append(Spacer(1, 2))
    story.append(
        Paragraph(
            "Legacy text origin (site-visits.service.ts:460): "
            "<font face='Courier'>mainhead = normalize(dto.mainhead) ?? (Mainhead.name ?? "
            "Mainhead.code ?? workPackage.mainhead)</font>. Matching is therefore case-insensitive, "
            "whitespace-normalized, and tested against name, code, and the "
            "<font face='Courier'>code - name</font> label. Note: neither "
            "<font face='Courier'>Mainhead</font> nor <font face='Courier'>Organization</font> "
            "carries a <font face='Courier'>tenantId</font>; the pilot is single-tenant, so text "
            "matching is safe. The multi-tenant guard is documented in §6.",
            s["body"],
        )
    )

    # 1. Exact NULL rows
    story.append(Paragraph("1. Exact rows with SiteVisit.mainheadId = NULL", s["h1"]))
    story.append(
        Paragraph(
            "Read-only enumeration of every NULL-FK row with its legacy text and the candidate it "
            "would resolve to. Each row is classified "
            "<font face='Courier'>MATCH_UNIQUE</font> (safe), "
            "<font face='Courier'>AMBIGUOUS</font> (never auto-assigned), "
            "<font face='Courier'>UNMATCHED</font>, or "
            "<font face='Courier'>NO_LEGACY_TEXT</font>.",
            s["body"],
        )
    )
    story.append(code_block(SQL_D1, s["code"]))

    # 2. Mapping
    story.append(Paragraph("2. Mapping: legacy text to Mainhead records", s["h1"]))
    story.append(
        Paragraph(
            "Distinct mapping table for human review <b>before</b> anything runs — this is the "
            "production-safety gate. Only rows with "
            "<font face='Courier'>decision = WILL_BACKFILL</font> are touched; "
            "<font face='Courier'>AMBIGUOUS_SKIP</font> and "
            "<font face='Courier'>UNMATCHED_SKIP</font> are reported and left for a human decision.",
            s["body"],
        )
    )
    story.append(code_block(SQL_D2, s["code"]))

    story.append(PageBreak())

    # 3. Backfill script
    story.append(Paragraph("3. Exact SQL migration / backfill script", s["h1"]))
    story.append(
        Paragraph(
            "Transactional, idempotent, ambiguity-guarded, with a backup table for exact rollback. "
            "Run inside a maintenance window after §1/§2 have been reviewed. The in-transaction "
            "check (3d) auto-rolls-back on any integrity failure before commit.",
            s["body"],
        )
    )
    story.append(code_block(SQL_D3, s["code"]))
    story.append(
        Paragraph(
            "To ship as a Prisma migration, save 3b–3c (without the backup table) under "
            "<font face='Courier'>prisma/migrations/&lt;ts&gt;_governance_g3_backfill_sitevisit_"
            "mainhead/migration.sql</font>. Prisma migrations are forward-only and cannot hold the "
            "rollback table, so the reviewed manual transaction above is the recommended production "
            "path.",
            s["body"],
        )
    )

    # 4. Rollback
    story.append(Paragraph("4. Rollback strategy", s["h1"]))
    story.append(
        Paragraph(
            "<b>Primary — exact reversal from the backup table.</b> Reverts only rows the backfill "
            "set, and only if they still hold the assigned value, so it never clobbers a later "
            "legitimate edit.",
            s["body"],
        )
    )
    story.append(code_block(SQL_D4, s["code"]))
    story.append(
        Paragraph(
            "<b>Fallback (no backup table, Prisma-migration path).</b> Every targeted row's prior "
            "value was provably <font face='Courier'>NULL</font>, so reversal is \"set back to NULL "
            "where the FK now matches a legacy-text resolution\" — less precise than the primary "
            "path, which is preferred. <b>Blast radius:</b> the FK is ON DELETE SET NULL and "
            "rollback only writes <font face='Courier'>NULL</font>, so there is no cascade, no row "
            "deletion, and no dependent-record impact; inspections and defects change only in "
            "<i>visibility</i>, not structure.",
            s["body"],
        )
    )

    story.append(PageBreak())

    # 5. Validation
    story.append(Paragraph("5. Validation queries — before and after", s["h1"]))
    story.append(Paragraph("Before (baseline)", s["h2"]))
    story.append(code_block(SQL_B, s["code"]))
    story.append(Paragraph("After", s["h2"]))
    story.append(code_block(SQL_A, s["code"]))
    story.append(
        Paragraph(
            "<b>Expected reading</b> (anchored to the audit numbers): Admin total stays 7; "
            "<font face='Courier'>will_backfill</font> accounts for the legacy NULL rows that "
            "resolve cleanly; QA's KL BARAT count rises from 1 to "
            "<font face='Courier'>1 + (KLB-resolved legacy rows)</font>. Any residual NULL after "
            "backfill is fully explained by "
            "<font face='Courier'>ambiguous_skip + unmatched_skip + no_legacy_text</font> — nothing "
            "disappears silently.",
            s["body"],
        )
    )

    # 6. Notes
    story.append(Paragraph("6. Notes, assumptions & scope boundary", s["h1"]))
    story.extend(
        bullets(
            [
                "<b>Single-tenant assumption.</b> <font face='Courier'>Mainhead</font> / "
                "<font face='Courier'>Organization</font> carry no "
                "<font face='Courier'>tenantId</font>; the only tenant anchor is "
                "<font face='Courier'>operationalRegion.tenantId</font> (nullable). For multi-tenant "
                "safety add to the join: "
                "<font face='Courier'>AND m.\"operationalRegionId\" IN (SELECT id FROM "
                "\"OperationalRegion\" WHERE \"tenantId\" = sv.\"tenantId\")</font> — for Mainheads "
                "that have a region; region-less Mainheads need a branch-path policy decision.",
                "<b>updatedAt deliberately untouched</b> to avoid resetting last-activity / "
                "operational-health staleness clocks (getLastActivityByVisitId, "
                "site-visits.service.ts:1360).",
                "<b>Ambiguity is never auto-resolved.</b> With no code/name uniqueness at the DB "
                "level, the script hard-requires exactly one distinct candidate Mainhead; everything "
                "else is surfaced for a human.",
                "<b>Positive blast radius.</b> Dashboard counts and defect visibility for QA also "
                "scope through <font face='Courier'>siteVisit.mainheadId</font>, so this single "
                "backfill restores QA visibility across visits, dashboard, and defects at once.",
                "<b>Out of scope (intentionally).</b> "
                "<font face='Courier'>Project.mainheadId</font> and "
                "<font face='Courier'>WorkPackage.mainheadId</font> also have parallel legacy text "
                "columns, but the QA scope never reads them, so they are not required for QA "
                "visibility.",
            ],
            s["bullet"],
        )
    )

    # 7. Bottom line
    story.append(Paragraph("7. Bottom line", s["h1"]))
    story.append(
        Paragraph(
            "The G3 access-control code is correct and unchanged by this work. The backfill is a "
            "data correction that populates <font face='Courier'>SiteVisit.mainheadId</font> from "
            "the legacy text column for rows that resolve to exactly one active Mainhead. It is "
            "idempotent, reversible, and ambiguity-safe; ambiguous and unmatched rows are reported, "
            "never guessed. Review the §1 and §2 outputs first, run §3 in a maintenance window, then "
            "confirm with the §5 after-queries before archiving the backup table.",
            s["body"],
        )
    )

    return story


def main():
    s = build_styles()
    doc = SimpleDocTemplate(
        OUTPUT, pagesize=A4,
        leftMargin=2 * cm, rightMargin=2 * cm,
        topMargin=2 * cm, bottomMargin=2 * cm,
        title="ASCURE MAINHEAD Backfill Assessment (Production-Safe)",
        author="ASCURE",
    )
    doc.build(build_story(s), onFirstPage=header_footer, onLaterPages=header_footer)
    print(f"Written: {OUTPUT}")


if __name__ == "__main__":
    main()
