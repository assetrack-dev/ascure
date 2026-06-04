"""Generate the Production MAINHEAD Backfill Operator Runbook PDF.

Runbook only — documents connection, pre-checks, the backfill transaction,
post-checks, rollback, and Go/No-Go gates. No database changes are performed
by this file, and the SQL/shell payloads are rendered verbatim, never executed.
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


OUTPUT = r"C:\ASCURE\docs\g3-mainhead-backfill-runbook.pdf"


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
        fontSize=11.5, leading=15, textColor=colors.HexColor("#0F766E"),
        spaceBefore=9, spaceAfter=3, keepWithNext=1)
    body = ParagraphStyle("BodyX", parent=base["BodyText"], fontName="Helvetica",
        fontSize=10, leading=14, textColor=colors.HexColor("#1F2937"),
        spaceAfter=6, alignment=TA_LEFT)
    bullet = ParagraphStyle("BulletX", parent=body, leftIndent=14, bulletIndent=2, spaceAfter=3)
    code = ParagraphStyle("CodeX", parent=body, fontName="Courier", fontSize=7.2, leading=9.7,
        textColor=colors.HexColor("#0F172A"),
        backColor=colors.HexColor("#F1F5F9"), borderColor=colors.HexColor("#E2E8F0"),
        borderWidth=0.5, borderPadding=6, leftIndent=0, rightIndent=0, spaceAfter=8)
    shell = ParagraphStyle("ShellX", parent=code,
        backColor=colors.HexColor("#0F172A"), textColor=colors.HexColor("#E2E8F0"),
        borderColor=colors.HexColor("#0F172A"))
    callout_warn = ParagraphStyle("CalloutWarn", parent=body, fontName="Helvetica-Bold",
        fontSize=11, leading=15, textColor=colors.HexColor("#92400E"),
        backColor=colors.HexColor("#FFFBEB"), borderColor=colors.HexColor("#F59E0B"),
        borderWidth=0.6, borderPadding=10, spaceAfter=10)
    callout_info = ParagraphStyle("CalloutInfo", parent=body, fontName="Helvetica",
        fontSize=10, leading=14, textColor=colors.HexColor("#0F3D3A"),
        backColor=colors.HexColor("#F0FDFA"), borderColor=colors.HexColor("#0F766E"),
        borderWidth=0.6, borderPadding=10, spaceAfter=10)
    callout_go = ParagraphStyle("CalloutGo", parent=body, fontName="Helvetica",
        fontSize=10, leading=14, textColor=colors.HexColor("#14532D"),
        backColor=colors.HexColor("#F0FDF4"), borderColor=colors.HexColor("#16A34A"),
        borderWidth=0.7, borderPadding=10, spaceAfter=8)
    callout_nogo = ParagraphStyle("CalloutNoGo", parent=body, fontName="Helvetica",
        fontSize=10, leading=14, textColor=colors.HexColor("#7F1D1D"),
        backColor=colors.HexColor("#FEF2F2"), borderColor=colors.HexColor("#DC2626"),
        borderWidth=0.7, borderPadding=10, spaceAfter=8)
    go_head = ParagraphStyle("GoHead", parent=body, fontName="Helvetica-Bold",
        fontSize=10.5, leading=14, textColor=colors.HexColor("#14532D"), spaceAfter=3)
    nogo_head = ParagraphStyle("NoGoHead", parent=body, fontName="Helvetica-Bold",
        fontSize=10.5, leading=14, textColor=colors.HexColor("#7F1D1D"), spaceAfter=3)
    return {"title": title, "subtitle": subtitle, "h1": h1, "h2": h2, "body": body,
            "bullet": bullet, "code": code, "shell": shell,
            "callout_warn": callout_warn, "callout_info": callout_info,
            "callout_go": callout_go, "callout_nogo": callout_nogo,
            "go_head": go_head, "nogo_head": nogo_head}


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
    """Render literal code (SQL/shell) safely inside a Paragraph: escape XML,
    keep indentation via nbsp, keep line breaks via <br/>."""
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
    canvas.drawString(2 * cm, 1.2 * cm, "ASCURE — Production MAINHEAD Backfill Operator Runbook")
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Page {doc.page}")
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, 1.5 * cm, A4[0] - 2 * cm, 1.5 * cm)
    canvas.restoreState()


# --------------------------------------------------------------------------- #
#  Verbatim payloads (rendered as-is; never executed by this generator)
# --------------------------------------------------------------------------- #

SH_CONNECT = r"""
# 1a. Confirm the database container is the expected one
docker ps --filter "name=ascure-postgres" \
  --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
#   Expect: ascure-postgres   postgres:16-alpine   Up ...

# 1b. Open an interactive psql session (port 5432 is NOT host-published)
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U ascure -d ascure
#   Fallback: docker exec -it ascure-postgres psql -U ascure -d ascure
"""

SQL_CONNECT = r"""
\set ON_ERROR_STOP on
\timing on
\conninfo                          -- confirm: database "ascure" as user "ascure"
SELECT current_database(), inet_server_addr(), version();

-- Identity sanity check: ADMIN-visible total must match production (7).
SELECT count(*) AS admin_total_visits FROM "SiteVisit";
--   STOP if this is not 7 (or your expected total) -- you are on the wrong DB.
"""

SQL_RO_GUARD = r"""
SET default_transaction_read_only = on;    -- hard guard for all of section 2
\set qa_email 'qa.manager@ascure.local'    -- <- set to the QA Manager's real email
"""

SH_DUMP = r"""
docker exec ascure-postgres \
  pg_dump -U ascure -d ascure -t '"SiteVisit"' --data-only \
  -f /tmp/SiteVisit_pre_backfill_20260604.sql
docker cp ascure-postgres:/tmp/SiteVisit_pre_backfill_20260604.sql \
  ./SiteVisit_pre_backfill_20260604.sql
"""

SQL_B1 = r"""
-- B1: NULL-FK volume (record all three numbers)
SELECT
  count(*)                                          AS total_visits,
  count(*) FILTER (WHERE "mainheadId" IS NULL)      AS null_fk_visits,
  count(*) FILTER (WHERE "mainheadId" IS NOT NULL)  AS populated_fk_visits
FROM "SiteVisit";
"""

SQL_B2 = r"""
-- B2: planned coverage (drives the Go/No-Go)
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
"""

SQL_D2 = r"""
-- D2: distinct legacy-text -> Mainhead with decision (review EVERY row by eye)
WITH legacy AS (
  SELECT sv."mainhead" AS legacy_text,
         lower(btrim(regexp_replace(sv."mainhead",'\s+',' ','g'))) AS norm_text
  FROM "SiteVisit" sv
  WHERE sv."mainheadId" IS NULL AND sv."mainhead" IS NOT NULL AND btrim(sv."mainhead") <> ''
),
distinct_text AS (
  SELECT legacy_text, norm_text, count(*) AS affected_rows
  FROM legacy GROUP BY legacy_text, norm_text
),
matched AS (
  SELECT d.legacy_text, m.id AS mainhead_id, m.code, m.name
  FROM distinct_text d
  JOIN "Mainhead" m ON m."isActive" AND (
       lower(btrim(regexp_replace(m.name,'\s+',' ','g')))                             = d.norm_text
    OR lower(btrim(regexp_replace(coalesce(m.code,''),'\s+',' ','g')))                = d.norm_text
    OR lower(btrim(regexp_replace(coalesce(m.code,'')||' - '||m.name,'\s+',' ','g'))) = d.norm_text)
)
SELECT
  d.legacy_text, d.affected_rows,
  count(DISTINCT m.mainhead_id) AS distinct_matches,
  string_agg(DISTINCT m.code || ' / ' || m.name, '; ') AS matched_mainheads,
  CASE WHEN count(DISTINCT m.mainhead_id)=1 THEN 'WILL_BACKFILL'
       WHEN count(DISTINCT m.mainhead_id)>1 THEN 'AMBIGUOUS_SKIP'
       ELSE 'UNMATCHED_SKIP' END AS decision
FROM distinct_text d
LEFT JOIN matched m ON m.legacy_text = d.legacy_text
GROUP BY d.legacy_text, d.affected_rows
ORDER BY decision, d.affected_rows DESC;
"""

SQL_B3 = r"""
-- B3: what the QA Manager sees today (mirrors buildScopeContext)
WITH qa_user AS (SELECT id FROM "User" WHERE email = :'qa_email'),
qa_mainheads AS (
  SELECT uma."mainheadId" AS id
  FROM "UserMainheadAccess" uma JOIN "Mainhead" m ON m.id=uma."mainheadId" AND m."isActive"
  WHERE uma."userId" IN (SELECT id FROM qa_user)
  UNION
  SELECT m.id
  FROM "UserOperationalRegionAccess" ura
  JOIN "OperationalRegion" r ON r.id=ura."operationalRegionId" AND r."isActive"
  JOIN "Mainhead" m ON m."operationalRegionId"=ura."operationalRegionId" AND m."isActive"
  WHERE ura."userId" IN (SELECT id FROM qa_user)
)
SELECT
  (SELECT count(*) FROM qa_mainheads) AS qa_mainhead_count,
  (SELECT count(*) FROM "SiteVisit"
     WHERE "mainheadId" IN (SELECT id FROM qa_mainheads)) AS qa_visible_before;

RESET default_transaction_read_only;   -- end the read-only session before section 4
"""

SQL_TX = r"""
\set ON_ERROR_STOP on
BEGIN;

-- 3a. Backup / audit table (forward record + rollback source). Survives the transaction.
CREATE TABLE IF NOT EXISTS "_backfill_SiteVisit_mainhead_20260604" (
  site_visit_id        uuid PRIMARY KEY,
  previous_mainhead_id uuid,                 -- always NULL for these rows; captured for audit
  legacy_mainhead_text text,
  assigned_mainhead_id uuid NOT NULL,
  backfilled_at        timestamptz NOT NULL DEFAULT now()
);

-- 3b. Resolve the unique-match set (only 1-distinct-candidate rows qualify).
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
ON CONFLICT (site_visit_id) DO NOTHING;        -- re-run safe

-- 3c. Apply the backfill ONLY to captured rows, ONLY while still NULL.
--     updatedAt is intentionally NOT modified (preserves last-activity / staleness signals).
UPDATE "SiteVisit" sv
SET "mainheadId" = b.assigned_mainhead_id
FROM "_backfill_SiteVisit_mainhead_20260604" b
WHERE sv.id = b.site_visit_id
  AND sv."mainheadId" IS NULL;                 -- idempotency guard

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
"""

SQL_AFTER = r"""
-- A1: rows actually changed (must equal B2.will_backfill)
SELECT count(*) AS rows_backfilled FROM "_backfill_SiteVisit_mainhead_20260604";

-- A2: NULL volume after (must equal B1.null_fk_visits - A1.rows_backfilled)
SELECT count(*) FILTER (WHERE "mainheadId" IS NULL) AS null_fk_after FROM "SiteVisit";

-- A3: referential + activity integrity (must be 0)
SELECT count(*) AS broken_or_inactive
FROM "SiteVisit" sv
LEFT JOIN "Mainhead" m ON m.id = sv."mainheadId"
WHERE sv."mainheadId" IS NOT NULL AND (m.id IS NULL OR m."isActive" = FALSE);

-- A4: every backfilled row matches its plan exactly (must be 0)
SELECT count(*) AS diverged
FROM "_backfill_SiteVisit_mainhead_20260604" b
JOIN "SiteVisit" sv ON sv.id = b.site_visit_id
WHERE sv."mainheadId" <> b.assigned_mainhead_id;

-- A5: QA visibility now (re-resolves QA mainheads; compare to B3.qa_visible_before)
WITH qa_user AS (SELECT id FROM "User" WHERE email = :'qa_email'),
qa_mainheads AS (
  SELECT uma."mainheadId" AS id
  FROM "UserMainheadAccess" uma JOIN "Mainhead" m ON m.id=uma."mainheadId" AND m."isActive"
  WHERE uma."userId" IN (SELECT id FROM qa_user)
  UNION
  SELECT m.id
  FROM "UserOperationalRegionAccess" ura
  JOIN "OperationalRegion" r ON r.id=ura."operationalRegionId" AND r."isActive"
  JOIN "Mainhead" m ON m."operationalRegionId"=ura."operationalRegionId" AND m."isActive"
  WHERE ura."userId" IN (SELECT id FROM qa_user)
)
SELECT count(*) AS qa_visible_after
FROM "SiteVisit" WHERE "mainheadId" IN (SELECT id FROM qa_mainheads);
"""

SQL_ROLLBACK = r"""
\set ON_ERROR_STOP on
BEGIN;
UPDATE "SiteVisit" sv
SET "mainheadId" = b.previous_mainhead_id          -- NULL
FROM "_backfill_SiteVisit_mainhead_20260604" b
WHERE sv.id = b.site_visit_id
  AND sv."mainheadId" = b.assigned_mainhead_id;    -- guard: only undo our own writes
COMMIT;

-- Verify: should return rows_backfilled again, all now NULL
SELECT count(*) AS reverted_to_null
FROM "_backfill_SiteVisit_mainhead_20260604" b
JOIN "SiteVisit" sv ON sv.id = b.site_visit_id
WHERE sv."mainheadId" IS NULL;

-- Cleanup (post-stabilization only -- keep through the observation window):
-- DROP TABLE "_backfill_SiteVisit_mainhead_20260604";
"""


def build_story(s):
    story = []

    story.append(Paragraph("Production MAINHEAD Backfill — Operator Runbook", s["title"]))
    story.append(
        Paragraph(
            "Step-by-step operator procedure to populate "
            "<font face='Courier'>SiteVisit.mainheadId</font> from the legacy "
            "<font face='Courier'>SiteVisit.mainhead</font> text column, restoring QA visibility "
            "under Governance G3. <b>Runbook only — do not execute. Run in an approved maintenance "
            "window.</b>",
            s["subtitle"],
        )
    )

    story.append(
        Paragraph(
            "Change ID: <font face='Courier'>governance-g3-backfill-sitevisit-mainhead-20260604</font>"
            " &nbsp;|&nbsp; Target DB: <font face='Courier'>ascure</font> (container "
            "<font face='Courier'>ascure-postgres</font>, PostgreSQL 16) &nbsp;|&nbsp; Properties: "
            "idempotent, ambiguity-guarded, reversible.",
            s["callout_info"],
        )
    )
    story.append(
        Paragraph(
            "GOLDEN RULE — Do not run Section 4 until BOTH Section 3 (safe values) and Section 7 "
            "(Go/No-Go) are satisfied. The Section 2 pre-checks are read-only and must run inside a "
            "read-only session.",
            s["callout_warn"],
        )
    )

    # 1. Connect
    story.append(Paragraph("1. Connect to production PostgreSQL", s["h1"]))
    story.append(
        Paragraph(
            "Run from the production host (where <font face='Courier'>docker-compose.prod.yml</font> "
            "lives). Port 5432 is not published to the host, so connect inside the container.",
            s["body"],
        )
    )
    story.append(code_block(SH_CONNECT, s["shell"]))
    story.append(
        Paragraph("Inside psql, pin safety flags and confirm you are on production:", s["body"])
    )
    story.append(code_block(SQL_CONNECT, s["code"]))

    # 2. Before
    story.append(Paragraph("2. Queries to run BEFORE backfill (read-only)", s["h1"]))
    story.append(
        Paragraph("Make the pre-check session physically unable to write:", s["body"])
    )
    story.append(code_block(SQL_RO_GUARD, s["code"]))

    story.append(Paragraph("2a. Optional physical safety net — table snapshot (host shell)", s["h2"]))
    story.append(code_block(SH_DUMP, s["shell"]))

    story.append(Paragraph("2b. NULL-FK volume", s["h2"]))
    story.append(code_block(SQL_B1, s["code"]))

    story.append(Paragraph("2c. Planned coverage", s["h2"]))
    story.append(code_block(SQL_B2, s["code"]))

    story.append(Paragraph("2d. The mapping — review every line", s["h2"]))
    story.append(code_block(SQL_D2, s["code"]))

    story.append(Paragraph("2e. QA baseline (self-resolving — no UUID copy-paste)", s["h2"]))
    story.append(code_block(SQL_B3, s["code"]))

    story.append(PageBreak())

    # 3. Safe values
    story.append(Paragraph("3. What output values are SAFE to proceed", s["h1"]))
    story.append(
        Paragraph("Record each value from Section 2 and confirm its safe condition:", s["body"])
    )
    sv = [
        [cell("<b>Value (source)</b>"), cell("<b>Safe-to-proceed condition</b>")],
        [cell("<font face='Courier'>admin_total_visits</font> (1)"),
         cell("Equals the known production total (<b>7</b>). If not, wrong DB -> <b>abort</b>.")],
        [cell("<font face='Courier'>null_fk_visits</font> (B1)"),
         cell("<font face='Courier'>&gt; 0</font>. If 0, nothing to backfill -> stop.")],
        [cell("<font face='Courier'>will_backfill</font> (B2)"),
         cell("<font face='Courier'>&gt;= 1</font> and equals the number of rows you intend to fix.")],
        [cell("<font face='Courier'>ambiguous_skip</font> (B2/D2)"),
         cell("Reviewed. Each ambiguous text is accepted-as-skipped or resolved manually first. "
              "Never run blind over rows you actually need.")],
        [cell("<font face='Courier'>unmatched_skip</font> (B2/D2)"),
         cell("Reviewed and accepted (these stay NULL; need data cleanup, not this backfill).")],
        [cell("D2 every <font face='Courier'>WILL_BACKFILL</font> row"),
         cell("Maps to the <b>intended</b> Mainhead on inspection (esp. KL BARAT -> KLB / KL BARAT).")],
        [cell("<font face='Courier'>qa_mainhead_count</font> (B3)"),
         cell("<font face='Courier'>&gt;= 1</font> (QA Manager actually has MAINHEAD access).")],
        [cell("<font face='Courier'>qa_visible_before</font> (B3)"),
         cell("Recorded (expected <b>1</b>) — the post-run comparison anchor.")],
        [cell("Snapshot + window"),
         cell("Physical snapshot (2a) captured; maintenance window + change approval active.")],
    ]
    story.append(make_table(sv, [5.2 * cm, 11.8 * cm]))
    story.append(Spacer(1, 2))
    story.append(
        Paragraph(
            "<b>Proceed only if every row above is in its safe state.</b> Otherwise -> No-Go "
            "(Section 7).",
            s["body"],
        )
    )

    # 4. Transaction
    story.append(Paragraph("4. The exact backfill transaction", s["h1"]))
    story.append(
        Paragraph(
            "Open a <b>fresh write session</b>, set "
            "<font face='Courier'>\\set ON_ERROR_STOP on</font>, and paste the whole block as one "
            "unit. It self-aborts on any integrity failure (3d) — if you see "
            "<font face='Courier'>COMMIT</font>, it succeeded.",
            s["body"],
        )
    )
    story.append(code_block(SQL_TX, s["code"]))
    story.append(
        Paragraph(
            "If anything other than <font face='Courier'>COMMIT</font> appears (e.g. the "
            "<font face='Courier'>RAISE EXCEPTION</font>), the transaction has already rolled itself "
            "back. <b>Stop, do not retry blindly</b> — return to Section 2, re-diagnose, then re-run "
            "Sections 3/7.",
            s["body"],
        )
    )

    story.append(PageBreak())

    # 5. After
    story.append(Paragraph("5. Queries to run AFTER backfill (read-only)", s["h1"]))
    story.append(
        Paragraph("Re-use the same <font face='Courier'>\\set qa_email</font> value from Section 2.",
                  s["body"])
    )
    story.append(code_block(SQL_AFTER, s["code"]))
    story.append(
        Paragraph(
            "Then confirm in the live app: log in as the QA Manager and verify the Site Visits list "
            "and Dashboard counts increased as expected.",
            s["body"],
        )
    )

    # 6. Rollback
    story.append(Paragraph("6. Rollback command", s["h1"]))
    story.append(
        Paragraph(
            "Exact reversal — touches only rows this backfill set, and only if they still hold the "
            "assigned value (never clobbers a later legitimate edit).",
            s["body"],
        )
    )
    story.append(code_block(SQL_ROLLBACK, s["code"]))
    story.append(
        Paragraph(
            "Physical fallback (last resort, if the audit table is unusable): restore "
            "<font face='Courier'>./SiteVisit_pre_backfill_20260604.sql</font> from step 2a per your "
            "DR procedure.",
            s["body"],
        )
    )

    story.append(PageBreak())

    # 7. Go / No-Go
    story.append(Paragraph("7. Go / No-Go criteria", s["h1"]))

    story.append(Paragraph("GO — proceed to Section 4 only if ALL are true", s["go_head"]))
    story.append(
        Paragraph(
            "&bull;&nbsp; Section 1 identity confirmed: "
            "<font face='Courier'>current_database() = ascure</font> and "
            "<font face='Courier'>admin_total_visits</font> = expected (7).<br/>"
            "&bull;&nbsp; <font face='Courier'>null_fk_visits &gt; 0</font>.<br/>"
            "&bull;&nbsp; <font face='Courier'>will_backfill &gt;= 1</font> and equals the count you "
            "intend to fix.<br/>"
            "&bull;&nbsp; Every D2 <font face='Courier'>WILL_BACKFILL</font> row maps to the "
            "intended Mainhead.<br/>"
            "&bull;&nbsp; <font face='Courier'>ambiguous_skip</font> and "
            "<font face='Courier'>unmatched_skip</font> each reviewed and explicitly accepted "
            "(or pre-resolved).<br/>"
            "&bull;&nbsp; <font face='Courier'>qa_mainhead_count &gt;= 1</font>; "
            "<font face='Courier'>qa_visible_before</font> recorded.<br/>"
            "&bull;&nbsp; Physical snapshot (2a) captured; window + approval active.",
            s["callout_go"],
        )
    )

    story.append(Paragraph("NO-GO — do not run Section 4 if ANY is true", s["nogo_head"]))
    story.append(
        Paragraph(
            "&bull;&nbsp; Wrong/uncertain database, or "
            "<font face='Courier'>admin_total_visits</font> not equal to expected.<br/>"
            "&bull;&nbsp; <font face='Courier'>will_backfill = 0</font> (investigate text shape; do "
            "not force).<br/>"
            "&bull;&nbsp; Any <font face='Courier'>WILL_BACKFILL</font> mapping looks wrong, or a "
            "needed row sits in <font face='Courier'>AMBIGUOUS_SKIP</font> unresolved.<br/>"
            "&bull;&nbsp; Pre-existing integrity problems surface (resolve first).<br/>"
            "&bull;&nbsp; No snapshot, no rollback path, or no approval/window.",
            s["callout_nogo"],
        )
    )

    story.append(Paragraph("POST-RUN verdict — decide immediately after Section 5", s["go_head"]))
    story.append(
        Paragraph(
            "<b>SUCCESS — keep the change</b> if all hold:<br/>"
            "&bull;&nbsp; <font face='Courier'>rows_backfilled == will_backfill</font><br/>"
            "&bull;&nbsp; <font face='Courier'>null_fk_after == null_fk_visits - rows_backfilled</font><br/>"
            "&bull;&nbsp; <font face='Courier'>broken_or_inactive == 0</font><br/>"
            "&bull;&nbsp; <font face='Courier'>diverged == 0</font><br/>"
            "&bull;&nbsp; <font face='Courier'>qa_visible_after</font> = "
            "<font face='Courier'>qa_visible_before</font> + (backfilled rows resolving to "
            "QA-accessible mainheads), and the QA Manager's app view reflects it.",
            s["callout_go"],
        )
    )
    story.append(
        Paragraph(
            "<b>FAIL — execute Section 6 rollback now</b> if any after-check fails, the "
            "<font face='Courier'>COMMIT</font> did not print, or live QA visibility is wrong. Then "
            "re-diagnose before any retry.",
            s["callout_nogo"],
        )
    )

    return story


def main():
    s = build_styles()
    doc = SimpleDocTemplate(
        OUTPUT, pagesize=A4,
        leftMargin=2 * cm, rightMargin=2 * cm,
        topMargin=2 * cm, bottomMargin=2 * cm,
        title="ASCURE Production MAINHEAD Backfill Operator Runbook",
        author="ASCURE",
    )
    doc.build(build_story(s), onFirstPage=header_footer, onLaterPages=header_footer)
    print(f"Written: {OUTPUT}")


if __name__ == "__main__":
    main()
