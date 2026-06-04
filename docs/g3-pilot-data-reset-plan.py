"""Generate the ASCURE Pilot Data Reset Plan PDF.

Assessment and reset script only — documents the keep/delete map, deletion
dependency order, the tenant-scoped reset transaction, backup, rollback,
validation, and what to recreate. No database changes are performed by this
file; all SQL/shell payloads are rendered verbatim, never executed.
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


OUTPUT = r"C:\ASCURE\docs\g3-pilot-data-reset-plan.pdf"


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
    code = ParagraphStyle("CodeX", parent=body, fontName="Courier", fontSize=7.0, leading=9.4,
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
    callout_danger = ParagraphStyle("CalloutDanger", parent=body, fontName="Helvetica-Bold",
        fontSize=10.5, leading=15, textColor=colors.HexColor("#7F1D1D"),
        backColor=colors.HexColor("#FEF2F2"), borderColor=colors.HexColor("#DC2626"),
        borderWidth=0.7, borderPadding=10, spaceAfter=10)
    return {"title": title, "subtitle": subtitle, "h1": h1, "h2": h2, "body": body,
            "bullet": bullet, "code": code, "shell": shell,
            "callout_warn": callout_warn, "callout_info": callout_info,
            "callout_danger": callout_danger}


def bullets(items, style):
    return [Paragraph(item, style, bulletText="•") for item in items]


def cell(text, size=8.3):
    return Paragraph(text, ParagraphStyle("cell", fontSize=size, leading=size + 2.3,
                                          fontName="Helvetica"))


def ccell(text, size=7.6):
    return Paragraph(text, ParagraphStyle("ccell", fontSize=size, leading=size + 2,
                                          fontName="Courier"))


def make_table(data, col_widths):
    style = [
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F766E")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.3),
        ("LEADING", (0, 0), (-1, -1), 10.6),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("TEXTCOLOR", (0, 1), (-1, -1), colors.HexColor("#1F2937")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
    ]
    return Table(data, colWidths=col_widths, style=TableStyle(style), repeatRows=1)


def code_block(raw, style):
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
    canvas.drawString(2 * cm, 1.2 * cm, "ASCURE — Pilot Data Reset Plan (Assessment & Script)")
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Page {doc.page}")
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, 1.5 * cm, A4[0] - 2 * cm, 1.5 * cm)
    canvas.restoreState()


# --------------------------------------------------------------------------- #
#  Verbatim payloads (rendered as-is; never executed by this generator)
# --------------------------------------------------------------------------- #

SQL_RESET = r"""
\set ON_ERROR_STOP on
\timing on
\set tenant_code 'ASCURE'          -- <- set to the pilot Tenant.code

-- Resolve the tenant id into a psql variable; errors out if 0 or many rows.
SELECT id AS tenant_id FROM "Tenant" WHERE code = :'tenant_code' \gset
\echo '>> Resetting operational data for tenant_id =' :tenant_id

BEGIN;

-- 1-2. Defect media + timeline (children of Defect)
DELETE FROM "DefectEvidenceImage" e
  USING "Defect" d, "InspectionItemResult" iir, "Inspection" i
  WHERE e."defectId" = d.id AND d."inspectionItemResultId" = iir.id
    AND iir."inspectionId" = i.id AND i."tenantId" = :'tenant_id';
DELETE FROM "DefectTimelineEntry" t
  USING "Defect" d, "InspectionItemResult" iir, "Inspection" i
  WHERE t."defectId" = d.id AND d."inspectionItemResultId" = iir.id
    AND iir."inspectionId" = i.id AND i."tenantId" = :'tenant_id';

-- 3. Defects
DELETE FROM "Defect" d
  USING "InspectionItemResult" iir, "Inspection" i
  WHERE d."inspectionItemResultId" = iir.id AND iir."inspectionId" = i.id
    AND i."tenantId" = :'tenant_id';

-- 4-6. Inspection result rows + images (children of Inspection)
DELETE FROM "InspectionItemResult" iir
  USING "Inspection" i WHERE iir."inspectionId" = i.id AND i."tenantId" = :'tenant_id';
DELETE FROM "InspectionResult" ir            -- before InspectionTemplateItem (RESTRICT)
  USING "Inspection" i WHERE ir."inspectionId" = i.id AND i."tenantId" = :'tenant_id';
DELETE FROM "InspectionImage" ii
  USING "Inspection" i WHERE ii."inspectionId" = i.id AND i."tenantId" = :'tenant_id';

-- 7. All images for the tenant
DELETE FROM "Image" WHERE "tenantId" = :'tenant_id';

-- 8-9. Asset link tables (RESTRICT -> Asset)
DELETE FROM "SiteVisitAsset" sva
  USING "SiteVisit" sv WHERE sva."siteVisitId" = sv.id AND sv."tenantId" = :'tenant_id';
DELETE FROM "OperationalSessionAsset" osa
  USING "OperationalSession" os
  WHERE osa."operationalSessionId" = os.id AND os."workspaceId" = :'tenant_id';

-- 10-11. Site visit membership (children of SiteVisit)
DELETE FROM "SiteVisitParticipant" p
  USING "SiteVisit" sv WHERE p."siteVisitId" = sv.id AND sv."tenantId" = :'tenant_id';
DELETE FROM "SiteVisitUser" u
  USING "SiteVisit" sv WHERE u."siteVisitId" = sv.id AND sv."tenantId" = :'tenant_id';

-- 12. Inspections (RESTRICT -> SiteVisit/Asset/Template; children already gone)
DELETE FROM "Inspection" WHERE "tenantId" = :'tenant_id';

-- 13. Assets (all RESTRICT refs cleared above)
DELETE FROM "Asset" WHERE "tenantId" = :'tenant_id';

-- 14. Site visits (Inspection RESTRICT + cascade children cleared)
DELETE FROM "SiteVisit" WHERE "tenantId" = :'tenant_id';

-- 15. Operational sessions (children cleared)
DELETE FROM "OperationalSession" WHERE "workspaceId" = :'tenant_id';

-- 16-18. Templates: items -> sections -> templates
DELETE FROM "InspectionTemplateItem" it
  USING "InspectionTemplate" t WHERE it."templateId" = t.id AND t."tenantId" = :'tenant_id';
DELETE FROM "InspectionTemplateSection" s
  USING "InspectionTemplate" t WHERE s."templateId" = t.id AND t."tenantId" = :'tenant_id';
DELETE FROM "InspectionTemplate" WHERE "tenantId" = :'tenant_id';

-- >>> STOP. Run the Section 5 validation queries here (still inside the transaction).
-- >>> If everything is correct:  COMMIT;
-- >>> If anything looks wrong:   ROLLBACK;
"""

SQL_TRUNCATE = r"""
-- Optional single-tenant-only fast path (blunter; no tenant scoping, no per-table counts).
-- Safe here only because no KEEP table references these tables (no surprise CASCADE).
TRUNCATE
  "Defect","DefectEvidenceImage","DefectTimelineEntry",
  "InspectionItemResult","InspectionResult","InspectionImage","Image",
  "SiteVisitAsset","OperationalSessionAsset","SiteVisitParticipant","SiteVisitUser",
  "Inspection","Asset","SiteVisit","OperationalSession",
  "InspectionTemplateItem","InspectionTemplateSection","InspectionTemplate"
RESTART IDENTITY;
"""

SH_BACKUP = r"""
# Whole-DB safety net (recommended)
docker exec ascure-postgres \
  pg_dump -U ascure -d ascure -Fc -f /tmp/ascure_pre_reset_20260604.dump
docker cp ascure-postgres:/tmp/ascure_pre_reset_20260604.dump ./ascure_pre_reset_20260604.dump

# Optional: targeted plain-SQL data dump of just the DELETE set (faster selective restore)
docker exec ascure-postgres bash -lc "pg_dump -U ascure -d ascure --data-only \
  -t '\"DefectEvidenceImage\"' -t '\"DefectTimelineEntry\"' -t '\"Defect\"' \
  -t '\"InspectionItemResult\"' -t '\"InspectionResult\"' -t '\"InspectionImage\"' \
  -t '\"Image\"' -t '\"SiteVisitAsset\"' -t '\"OperationalSessionAsset\"' \
  -t '\"SiteVisitParticipant\"' -t '\"SiteVisitUser\"' -t '\"Inspection\"' \
  -t '\"Asset\"' -t '\"SiteVisit\"' -t '\"OperationalSession\"' \
  -t '\"InspectionTemplateItem\"' -t '\"InspectionTemplateSection\"' -t '\"InspectionTemplate\"' \
  -f /tmp/ascure_delete_set_20260604.sql"
docker cp ascure-postgres:/tmp/ascure_delete_set_20260604.sql ./ascure_delete_set_20260604.sql

# Verify the dump before running the reset
pg_restore -l ./ascure_pre_reset_20260604.dump | head
"""

SH_ROLLBACK = r"""
# Post-commit, targeted restore into a scratch DB, then re-insert in reverse dependency order.
docker exec ascure-postgres psql -U ascure -c 'CREATE DATABASE ascure_restore;'
docker exec ascure-postgres pg_restore -U ascure -d ascure_restore ./ascure_pre_reset_20260604.dump
# Re-insert parents first:
#   InspectionTemplate -> Section -> Item -> OperationalSession -> SiteVisit -> Asset ->
#   Inspection -> (SiteVisitUser/Participant/Asset, OperationalSessionAsset,
#   InspectionImage/Result/ItemResult) -> Defect -> timeline/evidence -> Image
"""

SQL_VAL_DELETE = r"""
SELECT
  (SELECT count(*) FROM "SiteVisit" WHERE "tenantId"=:'tenant_id')   AS site_visits,
  (SELECT count(*) FROM "Inspection" WHERE "tenantId"=:'tenant_id')  AS inspections,
  (SELECT count(*) FROM "Asset" WHERE "tenantId"=:'tenant_id')       AS assets,
  (SELECT count(*) FROM "Image" WHERE "tenantId"=:'tenant_id')       AS images,
  (SELECT count(*) FROM "InspectionTemplate" WHERE "tenantId"=:'tenant_id')      AS templates,
  (SELECT count(*) FROM "OperationalSession" WHERE "workspaceId"=:'tenant_id')   AS sessions,
  (SELECT count(*) FROM "Defect" d
     JOIN "InspectionItemResult" iir ON iir.id=d."inspectionItemResultId"
     JOIN "Inspection" i ON i.id=iir."inspectionId"
     WHERE i."tenantId"=:'tenant_id')                                AS defects,
  (SELECT count(*) FROM "SiteVisitAsset" sva
     JOIN "SiteVisit" sv ON sv.id=sva."siteVisitId"
     WHERE sv."tenantId"=:'tenant_id')                               AS sv_assets,
  (SELECT count(*) FROM "OperationalSessionAsset" osa
     JOIN "OperationalSession" os ON os.id=osa."operationalSessionId"
     WHERE os."workspaceId"=:'tenant_id')                            AS session_assets;
-- All columns must be 0.
"""

SQL_VAL_KEEP = r"""
SELECT 'Organization' t, count(*) n FROM "Organization"
UNION ALL SELECT 'Branch', count(*) FROM "Branch"
UNION ALL SELECT 'OperationalRegion', count(*) FROM "OperationalRegion" WHERE "tenantId"=:'tenant_id'
UNION ALL SELECT 'Mainhead', count(*) FROM "Mainhead"
UNION ALL SELECT 'Project', count(*) FROM "Project"
UNION ALL SELECT 'WorkPackage', count(*) FROM "WorkPackage"
UNION ALL SELECT 'Team', count(*) FROM "Team" WHERE "tenantId"=:'tenant_id'
UNION ALL SELECT 'TeamMember', count(*) FROM "TeamMember"
UNION ALL SELECT 'User', count(*) FROM "User" WHERE "tenantId"=:'tenant_id'
UNION ALL SELECT 'UserMainheadAccess', count(*) FROM "UserMainheadAccess"
UNION ALL SELECT 'Capability', count(*) FROM "Capability"
UNION ALL SELECT 'AssetType', count(*) FROM "AssetType" WHERE "tenantId"=:'tenant_id'
UNION ALL SELECT 'Substation', count(*) FROM "Substation" WHERE "tenantId"=:'tenant_id'
ORDER BY t;
-- Compare to the pre-reset run of the same query: every row identical.
"""

SQL_VAL_INTEGRITY = r"""
SELECT
  (SELECT count(*) FROM "Inspection")                          AS inspections_total,
  (SELECT count(*) FROM "Project" p
     LEFT JOIN "Mainhead" m ON m.id=p."mainheadId"
     WHERE p."mainheadId" IS NOT NULL AND m.id IS NULL)        AS projects_bad_mainhead,
  (SELECT count(*) FROM "Substation" s
     WHERE NOT EXISTS (SELECT 1 FROM "Asset" a WHERE a."substationId"=s.id))
                                                               AS substations_without_assets;
-- inspections_total = 0; projects_bad_mainhead = 0;
-- substations_without_assets is informational (see decision points).
"""


def build_story(s):
    story = []

    story.append(Paragraph("ASCURE Pilot Data Reset Plan", s["title"]))
    story.append(
        Paragraph(
            "Remove all old pilot operational data and templates to start a clean pilot after "
            "Governance G3, while preserving tenant, org structure, MAINHEADs, teams, users, "
            "assignments, capabilities, and asset types. "
            "<b>Assessment and reset script only — do not execute.</b>",
            s["subtitle"],
        )
    )

    story.append(
        Paragraph(
            "Change ID: <font face='Courier'>pilot-data-reset-20260604</font> &nbsp;|&nbsp; "
            "Target DB: <font face='Courier'>ascure</font> (container "
            "<font face='Courier'>ascure-postgres</font>, PostgreSQL 16) &nbsp;|&nbsp; 18 tables "
            "deleted, 24 kept. Verified: no KEEP table has a foreign key into any DELETE table, so "
            "the wipe cannot orphan or block kept data.",
            s["callout_info"],
        )
    )
    story.append(
        Paragraph(
            "DESTRUCTIVE CHANGE — Take the Section 3 backup first. Run the Section 2 deletes inside "
            "the open transaction, verify with Section 5, and COMMIT only if correct; otherwise "
            "ROLLBACK. No separate checklist table exists: checklist templates ARE "
            "InspectionTemplate rows and are removed by the template deletes.",
            s["callout_danger"],
        )
    )

    # Keep / Delete map
    story.append(Paragraph("Keep / Delete map (physical tables)", s["h1"]))
    story.append(
        Paragraph(
            "<b>KEEP (24):</b> Tenant, Department, Organization, OrganizationCapability, "
            "OrganizationCapabilityAssignment, OrganizationMembership, Branch, BranchCapability, "
            "OperationalRegion, Mainhead, UserMainheadAccess, UserOperationalRegionAccess, "
            "MainheadCapability, TeamCapability, UserCapability, Capability, Team, TeamMember, "
            "User, Project, ProjectMembership, WorkPackage, WorkPackageAssignment, AssetType, "
            "Substation (master data — see decision points).",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "<b>DELETE (18):</b> DefectEvidenceImage, DefectTimelineEntry, Defect, "
            "InspectionItemResult, InspectionResult, InspectionImage, Image, SiteVisitAsset, "
            "OperationalSessionAsset, SiteVisitParticipant, SiteVisitUser, Inspection, Asset, "
            "SiteVisit, OperationalSession, InspectionTemplateItem, InspectionTemplateSection, "
            "InspectionTemplate.",
            s["body"],
        )
    )

    # 1. Dependency order
    story.append(Paragraph("1. Exact table dependency (deletion) order", s["h1"]))
    story.append(
        Paragraph(
            "Children to parents. \"Why\" cites the constraint that forces the position; CASCADE "
            "rows could be auto-removed by their parent but are deleted explicitly for auditable "
            "counts.",
            s["body"],
        )
    )
    rows = [
        [cell("<b>#</b>"), cell("<b>Table</b>"), cell("<b>Scope filter</b>"), cell("<b>Why this position</b>")],
        ["1", ccell("DefectEvidenceImage"), cell("defectId in tenant defects"), cell("child of Defect (CASCADE)")],
        ["2", ccell("DefectTimelineEntry"), cell("defectId in tenant defects"), cell("child of Defect (CASCADE); includes COMMENT events")],
        ["3", ccell("Defect"), cell("via tenant IIR"), cell("child of InspectionItemResult (CASCADE)")],
        ["4", ccell("InspectionItemResult"), cell("inspectionId in tenant inspections"), cell("child of Inspection (CASCADE)")],
        ["5", ccell("InspectionResult"), cell("inspectionId in tenant inspections"), cell("<b>must precede InspectionTemplateItem (RESTRICT)</b>")],
        ["6", ccell("InspectionImage"), cell("inspectionId in tenant inspections"), cell("child of Inspection (CASCADE)")],
        ["7", ccell("Image"), cell("tenantId = TENANT"), cell("independent; SET NULL refs — clear all media first")],
        ["8", ccell("SiteVisitAsset"), cell("siteVisitId in tenant visits"), cell("<b>must precede Asset (RESTRICT)</b>")],
        ["9", ccell("OperationalSessionAsset"), cell("sessionId in tenant sessions"), cell("<b>must precede Asset (RESTRICT)</b>")],
        ["10", ccell("SiteVisitParticipant"), cell("siteVisitId in tenant visits"), cell("child of SiteVisit (CASCADE)")],
        ["11", ccell("SiteVisitUser"), cell("siteVisitId in tenant visits"), cell("child of SiteVisit (CASCADE)")],
        ["12", ccell("Inspection"), cell("tenantId = TENANT"), cell("<b>must precede SiteVisit / Asset / Template (RESTRICT)</b>")],
        ["13", ccell("Asset"), cell("tenantId = TENANT"), cell("after RESTRICT refs (8, 9, 12) cleared")],
        ["14", ccell("SiteVisit"), cell("tenantId = TENANT"), cell("after Inspection (RESTRICT) + cascade children")],
        ["15", ccell("OperationalSession"), cell("workspaceId = TENANT"), cell("after OperationalSessionAsset + inspections")],
        ["16", ccell("InspectionTemplateItem"), cell("templateId in tenant templates"), cell("after InspectionResult (RESTRICT) cleared")],
        ["17", ccell("InspectionTemplateSection"), cell("templateId in tenant templates"), cell("child of InspectionTemplate (CASCADE)")],
        ["18", ccell("InspectionTemplate"), cell("tenantId = TENANT"), cell("after Inspection (RESTRICT) + sections/items")],
    ]
    story.append(make_table(rows, [0.8 * cm, 4.3 * cm, 4.6 * cm, 7.3 * cm]))

    story.append(PageBreak())

    # 2. Reset script
    story.append(Paragraph("2. Full production-safe SQL reset script", s["h1"]))
    story.append(
        Paragraph(
            "Tenant-scoped, single transaction, explicit ordering, one row count per statement. "
            "Run the deletes, inspect the printed counts and the Section 5 validation, then COMMIT "
            "(or ROLLBACK).",
            s["body"],
        )
    )
    story.append(code_block(SQL_RESET, s["code"]))
    story.append(Paragraph("Optional fast path (single-tenant only)", s["h2"]))
    story.append(code_block(SQL_TRUNCATE, s["code"]))
    story.append(
        Paragraph(
            "Prefer the ordered DELETE script for auditability and tenant safety; use TRUNCATE only "
            "when wiping the entire single-tenant database is intended.",
            s["body"],
        )
    )

    story.append(PageBreak())

    # 3. Backup
    story.append(Paragraph("3. Backup command before reset", s["h1"]))
    story.append(
        Paragraph(
            "Full logical backup (custom format, restorable selectively), taken from the host:",
            s["body"],
        )
    )
    story.append(code_block(SH_BACKUP, s["shell"]))

    # 4. Rollback
    story.append(Paragraph("4. Rollback strategy", s["h1"]))
    story.extend(
        bullets(
            [
                "<b>Primary (in-transaction).</b> The whole reset is one transaction. Run Section 5 "
                "before committing; if counts are wrong -> <font face='Courier'>ROLLBACK;</font> and "
                "nothing changed. This is the real safety net — prefer it.",
                "<b>Post-commit, targeted restore.</b> Restore the dump into a scratch DB and "
                "re-insert the deleted tables in reverse dependency order (see below).",
                "<b>Post-commit, full restore.</b> Only if the reset just happened and nothing else "
                "changed: restore the whole dump over the database per your DR procedure (reverts "
                "kept-table changes too).",
            ],
            s["bullet"],
        )
    )
    story.append(code_block(SH_ROLLBACK, s["shell"]))

    story.append(PageBreak())

    # 5. Validation
    story.append(Paragraph("5. Validation queries after reset", s["h1"]))
    story.append(Paragraph("5a. Delete set must all be 0 (tenant-scoped)", s["h2"]))
    story.append(code_block(SQL_VAL_DELETE, s["code"]))
    story.append(Paragraph("5b. Keep set must be unchanged (snapshot before, compare after)", s["h2"]))
    story.append(code_block(SQL_VAL_KEEP, s["code"]))
    story.append(Paragraph("5c. Integrity sanity (should be 0 by construction)", s["h2"]))
    story.append(code_block(SQL_VAL_INTEGRITY, s["code"]))

    # 6. Recreate
    story.append(Paragraph("6. What data must be recreated after reset", s["h1"]))
    rec = [
        [cell("<b>Item</b>"), cell("<b>Why</b>"), cell("<b>How</b>")],
        [cell("Inspection Templates + sections + items (incl. checklist templates)"),
         cell("Fully deleted"),
         cell("Rebuild via Checklist Builder, or run the seed to recreate the baseline SAVR "
              "template + capability mappings (idempotent upserts — review seed first). Re-publish "
              "(ACTIVE/isActive) and re-map to AssetTypes/scope.")],
        [cell("Asset master inventory"),
         cell("All Asset rows deleted"),
         cell("Re-import the asset register if pre-existing assets are needed; otherwise assets are "
              "created during visits.")],
        [cell("Operational Sessions"),
         cell("All deleted"),
         cell("Recreated through the normal field workflow.")],
        [cell("Pencawang / Substations"),
         cell("Kept by default"),
         cell("None needed unless you also prune them (decision points).")],
        [cell("Dashboards / Defect board / QA queues"),
         cell("Derived from deleted data"),
         cell("Repopulate automatically as the new pilot generates visits, inspections, defects.")],
        [cell("Projects / Work Packages"),
         cell("Kept"),
         cell("Verify mainheadId/links are the intended ones for the new pilot; legacy mainhead "
              "text columns persist.")],
    ]
    story.append(make_table(rec, [4.2 * cm, 3.6 * cm, 9.2 * cm]))

    # Decision points
    story.append(Paragraph("Decision points to confirm before running", s["h1"]))
    story.extend(
        bullets(
            [
                "<b>Pencawang / Substations</b> — not in the delete list, kept by default. The "
                "\"New Pencawang\" check-in flow can create them, so some may be pilot-created. To "
                "remove them too, prune after the reset using "
                "<font face='Courier'>5c.substations_without_assets</font> as the candidate set.",
                "<b>Projects / Work Packages</b> — spec says \"if safe.\" They ARE safe to keep "
                "(no FK dependency on deleted data). Default = keep; confirm if you would rather "
                "wipe them too.",
                "<b>Templates via seed</b> — running the seed to restore the baseline template also "
                "upserts org/branch/mainhead/admin/capability rows. Confirm whether to use seed or "
                "rebuild templates manually.",
            ],
            s["bullet"],
        )
    )

    return story


def main():
    s = build_styles()
    doc = SimpleDocTemplate(
        OUTPUT, pagesize=A4,
        leftMargin=2 * cm, rightMargin=2 * cm,
        topMargin=2 * cm, bottomMargin=2 * cm,
        title="ASCURE Pilot Data Reset Plan (Assessment & Script)",
        author="ASCURE",
    )
    doc.build(build_story(s), onFirstPage=header_footer, onLaterPages=header_footer)
    print(f"Written: {OUTPUT}")


if __name__ == "__main__":
    main()
