"""Generate the 8-point pilot-state probe PDF."""

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


OUTPUT = r"C:\ASCURE\docs\pilot-state-8point-probe.pdf"


def build_styles():
    base = getSampleStyleSheet()
    title = ParagraphStyle(
        "TitleX", parent=base["Title"], fontName="Helvetica-Bold",
        fontSize=20, leading=24, textColor=colors.HexColor("#0F172A"),
        spaceAfter=6,
    )
    subtitle = ParagraphStyle(
        "Subtitle", parent=base["Normal"], fontName="Helvetica",
        fontSize=10, leading=14, textColor=colors.HexColor("#475569"),
        spaceAfter=14,
    )
    h1 = ParagraphStyle(
        "H1X", parent=base["Heading1"], fontName="Helvetica-Bold",
        fontSize=15, leading=19, textColor=colors.HexColor("#0F172A"),
        spaceBefore=14, spaceAfter=6, keepWithNext=1,
    )
    h2 = ParagraphStyle(
        "H2X", parent=base["Heading2"], fontName="Helvetica-Bold",
        fontSize=12, leading=16, textColor=colors.HexColor("#0F172A"),
        spaceBefore=10, spaceAfter=4, keepWithNext=1,
    )
    body = ParagraphStyle(
        "BodyX", parent=base["BodyText"], fontName="Helvetica",
        fontSize=10, leading=14, textColor=colors.HexColor("#1F2937"),
        spaceAfter=6, alignment=TA_LEFT,
    )
    bullet = ParagraphStyle(
        "BulletX", parent=body, leftIndent=14, bulletIndent=2, spaceAfter=3,
    )
    code = ParagraphStyle(
        "CodeX", parent=body, fontName="Courier", fontSize=8.5, leading=11,
        backColor=colors.HexColor("#F1F5F9"),
        borderColor=colors.HexColor("#E2E8F0"),
        borderWidth=0.5, borderPadding=6,
        leftIndent=0, rightIndent=0, spaceAfter=8,
    )
    callout_warn = ParagraphStyle(
        "CalloutWarn", parent=body, fontName="Helvetica-Bold",
        fontSize=11, leading=15, textColor=colors.HexColor("#92400E"),
        backColor=colors.HexColor("#FFFBEB"),
        borderColor=colors.HexColor("#F59E0B"),
        borderWidth=0.6, borderPadding=10,
        spaceAfter=10,
    )
    return {
        "title": title, "subtitle": subtitle, "h1": h1, "h2": h2,
        "body": body, "bullet": bullet, "code": code,
        "callout_warn": callout_warn,
    }


def bullets(items, style):
    return [Paragraph(item, style, bulletText="•") for item in items]


def cell(text):
    return Paragraph(
        text,
        ParagraphStyle("cell", fontSize=8.5, leading=11, fontName="Helvetica"),
    )


def code_cell(text):
    return Paragraph(
        text,
        ParagraphStyle("ccell", fontSize=8, leading=10.5, fontName="Courier"),
    )


def make_table(data, col_widths):
    style = [
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F766E")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        (
            "ROWBACKGROUNDS", (0, 1), (-1, -1),
            [colors.white, colors.HexColor("#F8FAFC")],
        ),
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
    return Table(
        data, colWidths=col_widths, style=TableStyle(style), repeatRows=1,
    )


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawString(
        2 * cm, 1.2 * cm,
        "ASCURE — 8-Point Pilot State Probe (connected DB)",
    )
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Page {doc.page}")
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, 1.5 * cm, A4[0] - 2 * cm, 1.5 * cm)
    canvas.restoreState()


def build_story(s):
    story = []

    story.append(
        Paragraph("8-Point Pilot State Probe", s["title"])
    )
    story.append(
        Paragraph(
            "Read-only investigation requested against the production database and API. "
            "<b>Production credentials are not available to this assessor.</b> All probes below "
            "were run against the only database reachable from the source tree: "
            "<font face='Courier'>localhost:5433/ascure</font> "
            "(<font face='Courier'>.env DATABASE_URL</font>), which contains the "
            "<b>“demo-tenant — Demo Utility Tenant”</b> dataset. The same exact Prisma queries are "
            "included verbatim in §10 so an operator with production access can re-run them and "
            "compare. No code modified.",
            s["subtitle"],
        )
    )

    story.append(
        Paragraph(
            "SCOPE NOTE — Results in §1–§8 reflect the connected DB (dev/demo). They are not a "
            "claim about production. Treat them as the same-shape answers the same code would "
            "return if pointed at production. Where the user’s prior turn established that "
            "production state diverges (the GET /enterprise/options response missing 5 codes), "
            "production may also diverge here. The §10 queries are the way to confirm.",
            s["callout_warn"],
        )
    )

    # 1. SiteVisit count by tenant
    story.append(Paragraph("1. SiteVisit count by tenant", s["h1"]))
    p1 = [
        [cell("<b>tenantId</b>"), cell("<b>Tenant label</b>"), cell("<b>SiteVisit count</b>")],
        [
            code_cell("1ef638af-bf76-472c-9daa-299d6edd5c8a"),
            cell("demo-tenant — Demo Utility Tenant"),
            cell("4"),
        ],
    ]
    story.append(make_table(p1, [6.5 * cm, 6.5 * cm, 3.0 * cm]))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Connected DB has SiteVisits in exactly one tenant.",
            s["body"],
        )
    )

    # 2. Last 20 SiteVisit rows
    story.append(Paragraph("2. Last 20 SiteVisit rows", s["h1"]))
    story.append(
        Paragraph(
            "All 4 rows shown; no more exist. All are <font face='Courier'>status=ACTIVE</font> "
            "and were created by the same TECHNICIAN user "
            "(<font face='Courier'>53ee3bcf-…</font>).",
            s["body"],
        )
    )
    p2 = [
        [
            cell("<b>id (truncated)</b>"),
            cell("<b>status / validation</b>"),
            cell("<b>mainheadId</b>"),
            cell("<b>createdByUserId</b>"),
            cell("<b>startedAt</b>"),
            cell("<b>completedAt</b>"),
        ],
        [
            code_cell("61eaa849-…"),
            cell("ACTIVE / PENDING"),
            code_cell("31518197-…"),
            code_cell("53ee3bcf-…"),
            cell("2026-05-29 10:03:20Z"),
            cell("—"),
        ],
        [
            code_cell("339d5da0-…"),
            cell("ACTIVE / PENDING"),
            code_cell("null"),
            code_cell("53ee3bcf-…"),
            cell("2026-05-29 04:23:12Z"),
            cell("—"),
        ],
        [
            code_cell("6f77fd90-…"),
            cell("ACTIVE / PENDING"),
            code_cell("null"),
            code_cell("53ee3bcf-…"),
            cell("2026-05-29 04:19:32Z"),
            cell("—"),
        ],
        [
            code_cell("7a4e5686-…"),
            cell("ACTIVE / null"),
            code_cell("null"),
            code_cell("53ee3bcf-…"),
            cell("2026-04-23 13:35:41Z"),
            cell("—"),
        ],
    ]
    story.append(make_table(p2, [2.3 * cm, 2.4 * cm, 2.0 * cm, 2.0 * cm, 3.5 * cm, 1.7 * cm]))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Three of the four visits have <font face='Courier'>mainheadId=null</font> — they "
            "were created before the G2 DTO change required <font face='Courier'>mainheadId</font>. "
            "Only the newest one carries a structured MAINHEAD. None are completed.",
            s["body"],
        )
    )

    # 3. Last 20 Assets
    story.append(Paragraph("3. Last 20 Asset rows (showing createdDuringVisitId)", s["h1"]))
    story.append(
        Paragraph(
            "All 2 rows shown; no more exist. <b>Both rows have "
            "<font face='Courier'>createdDuringVisitId: null</font></b> — neither asset was linked "
            "to a SiteVisit at create-time.",
            s["body"],
        )
    )
    p3 = [
        [
            cell("<b>id (truncated)</b>"),
            cell("<b>substationId</b>"),
            cell("<b>assetCode</b>"),
            cell("<b>createdDuringVisitId</b>"),
            cell("<b>createdAt</b>"),
        ],
        [
            code_cell("bd03324c-…"),
            code_cell("da18f394-…"),
            cell("R4E-20260529100318-ASSET-02"),
            code_cell("null"),
            cell("2026-05-29 10:03:19Z"),
        ],
        [
            code_cell("98c3018b-…"),
            code_cell("da18f394-…"),
            cell("SAVR-001"),
            code_cell("null"),
            cell("2026-04-23 13:29:37Z"),
        ],
    ]
    story.append(make_table(p3, [2.3 * cm, 2.4 * cm, 5.0 * cm, 3.0 * cm, 3.3 * cm]))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Summary: <b>with createdDuringVisitId: 0; without: 2</b>. Mobile’s AddAssetScreen "
            "passes <font face='Courier'>createdDuringVisitId: siteVisitId</font>, so either "
            "<font face='Courier'>siteVisitId</font> was undefined at submit time, or the assets "
            "predate the visit-linkage code path. Cross-reference with Probe 4.",
            s["body"],
        )
    )

    # 4. Last 20 SiteVisitAsset link rows
    story.append(Paragraph("4. Last 20 SiteVisitAsset link rows", s["h1"]))
    story.append(
        Paragraph(
            "3 link rows exist. Every link was created with "
            "<font face='Courier'>source='INSPECTION'</font> — meaning these links were "
            "materialised by the inspection submission pathway "
            "(<font face='Courier'>materializeImplicitVisitAssetLinks</font>) and NOT by the "
            "create-asset path. This is consistent with Probe 3: assets persisted without a visit "
            "link, then later got linked when an inspection was submitted against them.",
            s["body"],
        )
    )
    p4 = [
        [
            cell("<b>siteVisitId</b>"),
            cell("<b>assetId</b>"),
            cell("<b>source</b>"),
            cell("<b>addedAt</b>"),
        ],
        [
            code_cell("61eaa849-…"),
            code_cell("bd03324c-…"),
            cell("INSPECTION"),
            cell("2026-05-29 10:03:20Z"),
        ],
        [
            code_cell("61eaa849-…"),
            code_cell("98c3018b-…"),
            cell("INSPECTION"),
            cell("2026-05-29 10:03:20Z"),
        ],
        [
            code_cell("339d5da0-…"),
            code_cell("98c3018b-…"),
            cell("INSPECTION"),
            cell("2026-05-29 04:23:12Z"),
        ],
    ]
    story.append(make_table(p4, [3.5 * cm, 3.5 * cm, 3.0 * cm, 4.5 * cm]))

    story.append(PageBreak())

    # 5. Admin tenantId
    story.append(Paragraph("5. Admin tenantId(s)", s["h1"]))
    p5 = [
        [
            cell("<b>id</b>"),
            cell("<b>email</b>"),
            cell("<b>tenantId</b>"),
            cell("<b>organizationId</b>"),
            cell("<b>isActive</b>"),
        ],
        [
            code_cell("6ca97a0b-…"),
            cell("admin@ascure.local"),
            code_cell("1ef638af-…"),
            code_cell("4bfcfdda-…"),
            cell("true"),
        ],
        [
            code_cell("8d9aea1d-…"),
            cell("g1.admin@ascure.local"),
            code_cell("1ef638af-…"),
            code_cell("4bfcfdda-…"),
            cell("true"),
        ],
    ]
    story.append(make_table(p5, [2.3 * cm, 4.5 * cm, 3.0 * cm, 3.0 * cm, 1.5 * cm]))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Both ADMIN users are in tenant <font face='Courier'>1ef638af-…</font> — same as the "
            "four SiteVisit rows. On the connected DB, an ADMIN list query would return all 4 "
            "visits.",
            s["body"],
        )
    )

    # 6. Pilot user tenantId
    story.append(Paragraph("6. Pilot user tenantId(s)", s["h1"]))
    story.append(
        Paragraph(
            "TECHNICIAN-role users (the canonical pilot-user role):",
            s["body"],
        )
    )
    p6 = [
        [
            cell("<b>email</b>"),
            cell("<b>tenantId</b>"),
            cell("<b>teamId</b>"),
            cell("<b>mainheadId</b>"),
        ],
        [
            cell("g1.user.c@ascure.local"),
            code_cell("1ef638af-…"),
            code_cell("null"),
            code_cell("null"),
        ],
        [
            cell("technician@ascure.local"),
            code_cell("1ef638af-…"),
            code_cell("9d4bea53-…"),
            code_cell("31518197-…"),
        ],
    ]
    story.append(make_table(p6, [5.0 * cm, 3.0 * cm, 3.0 * cm, 3.0 * cm]))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Both TECHNICIANs are in the same tenant as the ADMIN users. The pilot user that "
            "created all 4 SiteVisits is <font face='Courier'>technician@ascure.local</font> "
            "(<font face='Courier'>53ee3bcf-…</font>); the other technician "
            "(<font face='Courier'>g1.user.c</font>) is not linked to a team or MAINHEAD and has "
            "never created a visit on this DB.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "<b>Tenant alignment check: PASS on connected DB.</b> Both ADMIN and pilot users "
            "share tenant <font face='Courier'>1ef638af-…</font>; an ADMIN list query is not gated "
            "out by tenant scoping.",
            s["body"],
        )
    )

    # 7. POST /site-visits — did it succeed in the pilot run?
    story.append(Paragraph("7. Did POST /site-visits succeed during the pilot run?", s["h1"]))
    story.append(
        Paragraph(
            "<b>Cannot be answered definitively from the database alone.</b> The HTTP access log "
            "or API audit log is the source of truth for endpoint outcomes. A reasonable proxy is "
            "“did a SiteVisit row get persisted for this user around the pilot timeframe?”",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "On the connected DB, the answer to the proxy question is <b>yes</b>: every one of "
            "the 4 SiteVisit rows was created by <font face='Courier'>technician@ascure.local</font>. "
            "The most recent is 2026-05-29 10:03:20Z, status ACTIVE, validationStatus PENDING.",
            s["body"],
        )
    )
    story.extend(
        bullets(
            [
                "If production has any SiteVisit row with "
                "<font face='Courier'>createdByUserId = (pilot user id)</font> and "
                "<font face='Courier'>createdAt</font> inside the pilot window, the create call "
                "succeeded at least once.",
                "If production has zero such rows, the create call did not succeed for that user "
                "during that window. Check the API log for "
                "<font face='Courier'>POST /site-visits</font> 4xx responses around the pilot run.",
                "Common 4xx causes after Governance G2: missing "
                "<font face='Courier'>mainheadId</font> (DTO-level required), team-membership "
                "rejection (non-admin user not in dto.teamId), missing GPS for new-Pencawang "
                "check-in.",
            ],
            s["bullet"],
        )
    )

    # 8. SiteVisit rows for the pilot user's tenant
    story.append(Paragraph("8. SiteVisit rows for the pilot user’s tenant", s["h1"]))
    p8 = [
        [
            cell("<b>tenantId</b>"),
            cell("<b>Tenant label</b>"),
            cell("<b>SiteVisit count</b>"),
            cell("<b>Oldest</b>"),
            cell("<b>Newest</b>"),
        ],
        [
            code_cell("1ef638af-…"),
            cell("demo-tenant — Demo Utility Tenant"),
            cell("4"),
            cell("2026-04-23 13:35:41Z"),
            cell("2026-05-29 10:03:20Z"),
        ],
    ]
    story.append(make_table(p8, [2.3 * cm, 4.5 * cm, 2.5 * cm, 3.4 * cm, 3.3 * cm]))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "<b>Answer (connected DB): yes — 4 rows exist for the pilot user’s tenant.</b> "
            "Therefore the “admin sees zero” symptom cannot be reproduced on this DB. If "
            "production shows zero rows for the same tenant, the gap is environmental (the visit "
            "create call never persisted a row on production).",
            s["body"],
        )
    )

    story.append(PageBreak())

    # 9. Cross-checks
    story.append(Paragraph("9. Cross-checks against the symptom", s["h1"]))
    cross = [
        [cell("<b>Symptom (reported)</b>"), cell("<b>Connected DB</b>"), cell("<b>Interpretation</b>")],
        [
            cell("Admin Assets page shows new assets"),
            cell("2 Asset rows visible; both have createdDuringVisitId=null"),
            cell(
                "Consistent. Assets are listed via Substation, not via Visit. Null linkage does "
                "not hide them from the Assets page."
            ),
        ],
        [
            cell("Admin Site Visits page shows 0 visits"),
            cell("4 SiteVisit rows exist; tenant matches Admin"),
            cell(
                "Does NOT reproduce on connected DB. An ADMIN list call would return 4 rows. "
                "Production-only divergence — needs probe via §10."
            ),
        ],
        [
            cell("Operations / Sessions shows 0"),
            cell("7 OperationalSession rows exist on connected DB but mobile pilot does not write them"),
            cell(
                "Always expected for mobile-only pilot flow. The mobile create path does not "
                "produce <font face='Courier'>OperationalSession</font> rows; sessions seen on dev "
                "were created via a separate path."
            ),
        ],
        [
            cell("Dashboard shows 0 visits"),
            cell("Counts use the same accessible-where as the list; would show 4 on connected DB"),
            cell(
                "Same conclusion as Site Visits page — no reproduction here; needs production probe."
            ),
        ],
        [
            cell("Operations Board shows 0 defects"),
            cell(
                "No defects in dataset"
            ),
            cell(
                "Consistent. Defects require inspections; the 4 inspections in the dataset are "
                "PENDING and have not produced defects in this dataset. On production this is "
                "downstream of the visit question."
            ),
        ],
    ]
    story.append(make_table(cross, [5.0 * cm, 5.5 * cm, 5.5 * cm]))

    # 10. Production probes
    story.append(Paragraph("10. Re-run instructions for production", s["h1"]))
    story.append(
        Paragraph(
            "Point <font face='Courier'>DATABASE_URL</font> at the production DB and run the "
            "same script. Read-only; no writes anywhere. Save the output and compare against "
            "the §1–§8 sections of this report.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "// PROBE 1 — SiteVisit count by tenant<br/>"
            "prisma.siteVisit.groupBy({ by: ['tenantId'], _count: { _all: true } })<br/>"
            "<br/>"
            "// PROBE 2 — Last 20 SiteVisit rows<br/>"
            "prisma.siteVisit.findMany({<br/>"
            "&nbsp;&nbsp;orderBy: { createdAt: 'desc' }, take: 20,<br/>"
            "&nbsp;&nbsp;select: { id, tenantId, teamId, substationId, createdByUserId,<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;mainheadId, status, validationStatus, startedAt,<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;completedAt, createdAt }<br/>"
            "})<br/>"
            "<br/>"
            "// PROBE 3 — Last 20 Asset rows<br/>"
            "prisma.asset.findMany({<br/>"
            "&nbsp;&nbsp;orderBy: { createdAt: 'desc' }, take: 20,<br/>"
            "&nbsp;&nbsp;select: { id, tenantId, substationId, assetCode,<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;createdDuringVisitId, createdByUserId, createdAt }<br/>"
            "})<br/>"
            "<br/>"
            "// PROBE 4 — Last 20 SiteVisitAsset link rows<br/>"
            "prisma.siteVisitAsset.findMany({<br/>"
            "&nbsp;&nbsp;orderBy: { addedAt: 'desc' }, take: 20,<br/>"
            "&nbsp;&nbsp;select: { siteVisitId, assetId, addedByUserId, source, addedAt }<br/>"
            "})<br/>"
            "<br/>"
            "// PROBE 5 — Admin users<br/>"
            "prisma.user.findMany({<br/>"
            "&nbsp;&nbsp;where: { role: 'ADMIN' },<br/>"
            "&nbsp;&nbsp;select: { id, email, tenantId, organizationId, isActive },<br/>"
            "})<br/>"
            "<br/>"
            "// PROBE 6 — Pilot users (TECHNICIAN role; substitute pilot email if known)<br/>"
            "prisma.user.findMany({<br/>"
            "&nbsp;&nbsp;where: { role: 'TECHNICIAN' },<br/>"
            "&nbsp;&nbsp;select: { id, email, tenantId, organizationId, teamId,<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;mainheadId, isActive },<br/>"
            "})<br/>"
            "<br/>"
            "// PROBE 7 — SiteVisits authored by pilot user during pilot window<br/>"
            "prisma.siteVisit.findMany({<br/>"
            "&nbsp;&nbsp;where: { createdByUserId: { in: [ /* pilot ids */ ] },<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;createdAt: { gte: new Date('PILOT_START'), lte: new Date('PILOT_END') } },<br/>"
            "&nbsp;&nbsp;orderBy: { createdAt: 'desc' }, take: 20,<br/>"
            "&nbsp;&nbsp;select: { id, tenantId, status, createdAt },<br/>"
            "})<br/>"
            "<br/>"
            "// PROBE 8 — SiteVisit count for the pilot user's tenant<br/>"
            "prisma.siteVisit.count({ where: { tenantId: 'PILOT_TENANT_ID' } })",
            s["code"],
        )
    )

    story.append(
        Paragraph(
            "Decision tree after running on production:",
            s["body"],
        )
    )
    story.extend(
        bullets(
            [
                "<b>Probe 1 / 8 returns 0 for the pilot tenant:</b> no visits were ever persisted. "
                "Inspect API log for "
                "<font face='Courier'>POST /site-visits</font> 4xx responses; the most likely "
                "rejection after G2 is missing/invalid "
                "<font face='Courier'>mainheadId</font> at the DTO level "
                "(<font face='Courier'>create-site-visit.dto.ts:46</font>).",
                "<b>Probe 5 admin.tenantId ≠ Probe 8 pilot tenant with rows:</b> rows exist but in "
                "a different tenant than admin. Fix tenant configuration; existing rows would need "
                "a tenant-migration script before they become visible to admin.",
                "<b>Probe 3 has rows with <font face='Courier'>createdDuringVisitId=null</font>:</b> "
                "<b>matches the dev signature</b>. Mobile is persisting assets through the substation "
                "path without the visit linkage — exactly what we see on dev. Each such asset is "
                "the orphaned tail of a visit-create that did not complete cleanly.",
                "<b>Probe 4 shows rows with <font face='Courier'>source='INSPECTION'</font>:</b> "
                "downstream <font face='Courier'>materializeImplicitVisitAssetLinks</font> is "
                "stitching the asset-visit links at inspection time. Useful but does not retroactively "
                "fix the missing inspection-and-defect chain if the visit never was created.",
            ],
            s["bullet"],
        )
    )

    return story


def main():
    s = build_styles()
    doc = SimpleDocTemplate(
        OUTPUT,
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
        title="ASCURE 8-Point Pilot State Probe",
        author="ASCURE",
    )
    doc.build(
        build_story(s),
        onFirstPage=header_footer,
        onLaterPages=header_footer,
    )
    print(f"Written: {OUTPUT}")


if __name__ == "__main__":
    main()
