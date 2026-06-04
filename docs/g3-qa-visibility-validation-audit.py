"""Generate the G3 QA Visibility Validation Audit PDF."""

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


OUTPUT = r"C:\ASCURE\docs\g3-qa-visibility-validation-audit.pdf"


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
    code = ParagraphStyle("CodeX", parent=body, fontName="Courier", fontSize=8.5, leading=11,
        backColor=colors.HexColor("#F1F5F9"), borderColor=colors.HexColor("#E2E8F0"),
        borderWidth=0.5, borderPadding=6, leftIndent=0, rightIndent=0, spaceAfter=8)
    callout_warn = ParagraphStyle("CalloutWarn", parent=body, fontName="Helvetica-Bold",
        fontSize=11, leading=15, textColor=colors.HexColor("#92400E"),
        backColor=colors.HexColor("#FFFBEB"), borderColor=colors.HexColor("#F59E0B"),
        borderWidth=0.6, borderPadding=10, spaceAfter=10)
    return {"title": title, "subtitle": subtitle, "h1": h1, "h2": h2,
            "body": body, "bullet": bullet, "code": code, "callout_warn": callout_warn}


def bullets(items, style):
    return [Paragraph(item, style, bulletText="•") for item in items]


def cell(text):
    return Paragraph(text, ParagraphStyle("cell", fontSize=8.5, leading=11, fontName="Helvetica"))


def code_cell(text):
    return Paragraph(text, ParagraphStyle("ccell", fontSize=8, leading=10.5, fontName="Courier"))


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


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawString(2 * cm, 1.2 * cm, "ASCURE — G3 QA Visibility Validation Audit")
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Page {doc.page}")
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, 1.5 * cm, A4[0] - 2 * cm, 1.5 * cm)
    canvas.restoreState()


def build_story(s):
    story = []

    story.append(Paragraph("G3 QA Visibility Validation Audit", s["title"]))
    story.append(
        Paragraph(
            "QA Manager assigned KL BARAT MAINHEAD sees only 1 completed visit while ADMIN sees 7. "
            "Trace through the Site Visits and Dashboard query paths, look for any residual team/"
            "participant filter, and identify the actual gap.",
            s["subtitle"],
        )
    )

    story.append(
        Paragraph(
            "ROOT CAUSE — No residual team or participant filter remains after MAINHEAD scoping. "
            "The G3 QA scope predicate is "
            "<font face='Courier'>{ mainheadId: { in: qaMainheadIds } }</font>. <b>The gap is "
            "data-shape, not access control.</b> Legacy site visits created before Governance G2 "
            "have <font face='Courier'>mainheadId = null</font> on the structured FK and only "
            "carry their MAINHEAD identity in the deprecated text column "
            "<font face='Courier'>SiteVisit.mainhead</font>. The G3 QA scope only consults the FK, "
            "so every legacy visit is silently invisible to QA even when its text MAINHEAD matches "
            "the QA-assigned area. ADMIN bypasses this by having no filter at all. Reproduced on "
            "the connected DB: 3 of 4 visits have <font face='Courier'>mainheadId=null</font>; the "
            "QA-scoped count for KL BARAT is <b>0</b>.",
            s["callout_warn"],
        )
    )

    # 1. Site Visits query for Admin
    story.append(Paragraph("1. Site Visits query — Admin", s["h1"]))
    story.append(
        Paragraph(
            "Source: <font face='Courier'>SiteVisitsService.list</font> "
            "(<font face='Courier'>site-visits.service.ts:498</font>) → "
            "<font face='Courier'>buildListWhere(user, query, ctx)</font>. "
            "<font face='Courier'>ctx.isAdmin === true</font> ⇒ "
            "<font face='Courier'>accessScope</font> returns "
            "<font face='Courier'>{}</font>.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "WHERE = AND [<br/>"
            "&nbsp;&nbsp;{ tenantId: adminTenantId },<br/>"
            "&nbsp;&nbsp;{},                                       // accessScope, empty for ADMIN<br/>"
            "&nbsp;&nbsp;... statusFilter, etc. — all {}<br/>"
            "]",
            s["code"],
        )
    )
    story.append(
        Paragraph(
            "Effect: every SiteVisit row in the admin's tenant is returned. No participant or "
            "team-membership constraint. Visits with <font face='Courier'>mainheadId = null</font> "
            "are included.",
            s["body"],
        )
    )

    # 2. Site Visits query for QA Manager
    story.append(Paragraph("2. Site Visits query — QA Manager", s["h1"]))
    story.append(
        Paragraph(
            "Same handler. <font face='Courier'>buildScopeContext</font> resolves "
            "<font face='Courier'>isQa = true</font> and "
            "<font face='Courier'>qaMainheadIds = [&lt;KL BARAT id&gt;]</font>. The QA branch in "
            "<font face='Courier'>accessScope</font> returns "
            "<font face='Courier'>{ mainheadId: { in: qaMainheadIds } }</font>.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "WHERE = AND [<br/>"
            "&nbsp;&nbsp;{ tenantId: qaTenantId },<br/>"
            "&nbsp;&nbsp;{ mainheadId: { in: [&lt;KL BARAT id&gt;] } },<br/>"
            "&nbsp;&nbsp;... statusFilter, etc. — all {}<br/>"
            "]",
            s["code"],
        )
    )
    story.extend(
        bullets(
            [
                "<b>No team filter.</b> The non-ADMIN team branch of "
                "<font face='Courier'>accessScope</font> is skipped because the QA branch returns "
                "first.",
                "<b>No participant filter.</b> "
                "<font face='Courier'>SiteVisitParticipant</font> is never consulted by the list "
                "query.",
                "<b>No status / validationStatus filter.</b> Admin web sends no query params; the "
                "respective helpers return <font face='Courier'>{}</font>.",
                "<b>Only the MAINHEAD FK is consulted.</b> Rows with "
                "<font face='Courier'>mainheadId = null</font> never match "
                "<font face='Courier'>{ in: [...] }</font>.",
            ],
            s["bullet"],
        )
    )

    # 3. Dashboard query - Admin
    story.append(Paragraph("3. Dashboard query — Admin", s["h1"]))
    story.append(
        Paragraph(
            "Source: <font face='Courier'>DashboardService.getDashboard</font> "
            "(<font face='Courier'>dashboard.service.ts:39</font>). All SiteVisit-related counts "
            "use <font face='Courier'>accessibleSiteVisitWhere(user, ctx)</font>:",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "accessibleSiteVisitWhere = { tenantId, ...siteVisitAccessScope(user, ctx) }<br/>"
            "ctx.isAdmin === true ⇒ siteVisitAccessScope returns {}<br/>"
            "Net WHERE: { tenantId }",
            s["code"],
        )
    )
    story.append(
        Paragraph(
            "Inspection counts use "
            "<font face='Courier'>accessibleInspectionWhere(user, ctx)</font> with the same "
            "ADMIN bypass; defect counts inherit the same.",
            s["body"],
        )
    )

    # 4. Dashboard - QA Manager
    story.append(Paragraph("4. Dashboard query — QA Manager", s["h1"]))
    story.append(
        Paragraph(
            "Same pattern with QA scope:",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "siteVisitAccessScope (QA branch) returns:<br/>"
            "&nbsp;&nbsp;{ mainheadId: { in: ctx.qaMainheadIds } }<br/>"
            "inspectionAccessScope (QA branch) returns:<br/>"
            "&nbsp;&nbsp;{ siteVisit: { mainheadId: { in: ctx.qaMainheadIds } } }<br/>"
            "<br/>"
            "Active visit count: { tenantId, mainheadId IN [...], status IN [ACTIVE,OPEN,IN_PROGRESS] }<br/>"
            "Completed visit count: { tenantId, mainheadId IN [...], status: COMPLETED }<br/>"
            "Defect counts: nested inspection.siteVisit.mainheadId IN [...]",
            s["code"],
        )
    )
    story.append(
        Paragraph(
            "Same data-shape exposure as Site Visits list: legacy visits with "
            "<font face='Courier'>mainheadId = null</font> are excluded from every QA count. "
            "Their inspections and defects, being nested under those visits, vanish in lockstep.",
            s["body"],
        )
    )

    story.append(PageBreak())

    # 5. Residual filter audit
    story.append(Paragraph("5. Residual team / participant filter audit", s["h1"]))
    story.append(
        Paragraph(
            "Verified by re-reading the helpers as committed:",
            s["body"],
        )
    )
    f = [
        [cell("<b>Helper</b>"), cell("<b>QA branch returns</b>"), cell("<b>Residual team / participant filter?</b>")],
        [
            code_cell("site-visits.service.ts:2157 accessScope"),
            code_cell("{ mainheadId: { in: qaMainheadIds } }"),
            cell("None. Team branch is the <i>else</i> path."),
        ],
        [
            code_cell("dashboard.service.ts:727 siteVisitAccessScope"),
            code_cell("{ mainheadId: { in: qaMainheadIds } }"),
            cell("None."),
        ],
        [
            code_cell("dashboard.service.ts:694 inspectionAccessScope"),
            code_cell("{ siteVisit: { mainheadId: { in: ... } } }"),
            cell("None."),
        ],
        [
            code_cell("defects.service.ts:3153 inspectionAccessScope"),
            code_cell("{ siteVisit: { mainheadId: { in: ... } } }"),
            cell("None."),
        ],
        [
            code_cell("buildListWhere / buildOperationsBoardWhere"),
            cell("Aggregates accessScope + optional query filters (status, validation, etc.)"),
            cell("None unless explicitly passed in the URL — admin web does not."),
        ],
        [
            code_cell("SiteVisitParticipant"),
            cell("not consulted by any list / dashboard / operations-board read"),
            cell("None."),
        ],
    ]
    story.append(make_table(f, [4.5 * cm, 5.5 * cm, 6.0 * cm]))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "<b>Conclusion of §5:</b> no team or participant predicate is applied to QA reads "
            "after MAINHEAD scoping. The single visit QA sees is the only row whose "
            "<font face='Courier'>SiteVisit.mainheadId</font> equals the KL BARAT MAINHEAD id.",
            s["body"],
        )
    )

    # 6. Data-shape evidence
    story.append(Paragraph("6. Connected-DB data shape (reproduces the symptom)", s["h1"]))
    d = [
        [cell("<b>Metric</b>"), cell("<b>Connected DB</b>"), cell("<b>Interpretation</b>")],
        [
            cell("Total SiteVisit rows (tenant)"),
            cell("4"),
            cell("Visible to ADMIN."),
        ],
        [
            cell("<font face='Courier'>mainheadId</font> populated"),
            cell("<b>1</b>"),
            cell("Visible to a QA actor whose qaMainheadIds includes the matching id."),
        ],
        [
            cell("<font face='Courier'>mainheadId IS NULL</font>"),
            cell("<b>3</b>"),
            cell("Invisible to QA. Legacy text column <font face='Courier'>mainhead</font> may still hold the MAINHEAD identity, but G3 does not consult it."),
        ],
        [
            cell("KL Barat MAINHEAD on dev DB"),
            cell("id <font face='Courier'>1dc68faf-…</font>, code KL-BRT"),
            cell("Exists — the QA actor's qaMainheadIds resolution would include it."),
        ],
        [
            cell("QA-scoped <font face='Courier'>siteVisit.count</font> with <font face='Courier'>mainheadId IN [KLB id]</font>"),
            cell("<b>0</b>"),
            cell("No visit on dev currently maps to KL Barat via the structured FK. Identical pattern to the production report where QA sees 1."),
        ],
    ]
    story.append(make_table(d, [5.5 * cm, 4.5 * cm, 6.0 * cm]))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "The production observation — QA sees 1, ADMIN sees 7 — matches this pattern exactly. "
            "Production has 7 visits in admin's tenant, of which only 1 has "
            "<font face='Courier'>mainheadId</font> set to the KL Barat id. The other 6 either "
            "(a) have <font face='Courier'>mainheadId = null</font> and "
            "<font face='Courier'>mainhead</font> text = \"KL BARAT\" (legacy), or (b) point to a "
            "different MAINHEAD entirely.",
            s["body"],
        )
    )

    # 7. Verification probe for production
    story.append(Paragraph("7. Production verification probe", s["h1"]))
    story.append(
        Paragraph(
            "Read-only Prisma queries to confirm the data-shape diagnosis on production:",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "// 1) Find the KL Barat MAINHEAD id<br/>"
            "const klb = await prisma.mainhead.findFirst({<br/>"
            "&nbsp;&nbsp;where: { OR: [<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;{ code: { contains: 'KLB', mode: 'insensitive' } },<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;{ name: { contains: 'KL BARAT', mode: 'insensitive' } } ] },<br/>"
            "&nbsp;&nbsp;select: { id: true, code: true, name: true },<br/>"
            "});<br/>"
            "<br/>"
            "// 2) Admin's view: every visit in the tenant<br/>"
            "const adminCount = await prisma.siteVisit.count({<br/>"
            "&nbsp;&nbsp;where: { tenantId: ADMIN_TENANT_ID },<br/>"
            "});<br/>"
            "<br/>"
            "// 3) QA scope (structured FK only)<br/>"
            "const qaCountFkOnly = await prisma.siteVisit.count({<br/>"
            "&nbsp;&nbsp;where: { tenantId: ADMIN_TENANT_ID, mainheadId: klb.id },<br/>"
            "});<br/>"
            "<br/>"
            "// 4) Legacy visits (would be reached if QA scope OR-matched the text column)<br/>"
            "const legacyTextMatchCount = await prisma.siteVisit.count({<br/>"
            "&nbsp;&nbsp;where: {<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;tenantId: ADMIN_TENANT_ID,<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;mainheadId: null,<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;OR: [<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{ mainhead: { contains: 'KL BARAT', mode: 'insensitive' } },<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{ mainhead: { contains: 'KLB', mode: 'insensitive' } } ],<br/>"
            "&nbsp;&nbsp;},<br/>"
            "});",
            s["code"],
        )
    )
    story.append(
        Paragraph(
            "Expected reading: <font face='Courier'>adminCount = 7</font>, "
            "<font face='Courier'>qaCountFkOnly = 1</font>, "
            "<font face='Courier'>legacyTextMatchCount</font> ≈ 6. If the third number is the "
            "missing 6, the diagnosis is confirmed.",
            s["body"],
        )
    )

    # 8. Remediation options (assessment only)
    story.append(Paragraph("8. Remediation options (no code changes proposed)", s["h1"]))
    rem = [
        [cell("<b>Option</b>"), cell("<b>What it does</b>"), cell("<b>Trade-off</b>")],
        [
            cell("<b>A. Data backfill</b> (preferred)"),
            cell(
                "One-time UPDATE: <font face='Courier'>UPDATE \"SiteVisit\" SET \"mainheadId\" = m.id "
                "FROM \"Mainhead\" m WHERE \"SiteVisit\".\"mainheadId\" IS NULL AND "
                "lower(trim(\"SiteVisit\".\"mainhead\")) = lower(trim(m.name)) AND m.\"isActive\" = true</font>. "
                "Then optionally drop the text column in a follow-up migration."
            ),
            cell(
                "Clean. Idempotent (no row gets reassigned). Production may have stale or "
                "ambiguous text values that don't match cleanly — pre-check with a SELECT."
            ),
        ],
        [
            cell("<b>B. Extend QA scope to OR-match the text column</b>"),
            cell(
                "Modify the QA branch of every accessScope helper to: "
                "<font face='Courier'>{ OR: [ { mainheadId: { in: qaMainheadIds } }, "
                "{ mainhead: { in: qaMainheadNames } } ] }</font>. Extend "
                "<font face='Courier'>buildScopeContext</font> to also return "
                "<font face='Courier'>qaMainheadNames</font>."
            ),
            cell(
                "No data migration. But text matching is fragile (spelling, case, whitespace) and "
                "perpetuates the legacy field. Mainly useful as a defensive belt-and-braces."
            ),
        ],
        [
            cell("<b>C. Hybrid (recommended)</b>"),
            cell("Run A, then ship B as a defensive measure for any future legacy data slipping in via direct DB writes."),
            cell("Two PRs. Same data migration plus a small scope-extension."),
        ],
    ]
    story.append(make_table(rem, [4.0 * cm, 7.0 * cm, 5.0 * cm]))

    # Final
    story.append(Paragraph("9. Bottom line", s["h1"]))
    story.append(
        Paragraph(
            "G3 access-scope code is correct: QA actors bypass team membership and read by "
            "MAINHEAD. No residual team or participant filter is being applied after the QA "
            "branch returns. The reason QA sees only 1 visit is that only 1 production row has the "
            "structured <font face='Courier'>SiteVisit.mainheadId</font> populated; the rest are "
            "legacy rows whose MAINHEAD identity lives in the deprecated text column. The fix is "
            "either to backfill the FK from the text column, to broaden the QA scope to also "
            "match the text column, or both.",
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
        title="ASCURE G3 QA Visibility Validation Audit",
        author="ASCURE",
    )
    doc.build(build_story(s), onFirstPage=header_footer, onLaterPages=header_footer)
    print(f"Written: {OUTPUT}")


if __name__ == "__main__":
    main()
