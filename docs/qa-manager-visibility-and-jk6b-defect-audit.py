"""Generate the QA Manager Visibility and JK6B Defect Chain Audit PDF."""

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


OUTPUT = r"C:\ASCURE\docs\qa-manager-visibility-and-jk6b-defect-audit.pdf"


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
        "ASCURE — QA Manager Visibility + JK6B Defect Chain Audit",
    )
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Page {doc.page}")
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, 1.5 * cm, A4[0] - 2 * cm, 1.5 * cm)
    canvas.restoreState()


def build_story(s):
    story = []

    story.append(
        Paragraph("QA Manager Visibility + JK6B Defect Chain", s["title"])
    )
    story.append(
        Paragraph(
            "Two governance audits in one read-only sweep. "
            "Q1: why does ADMIN see 7 Site Visits while QA Manager sees 0? "
            "Q2: for visit JK6B (PE JALAN KINRARA 6B) showing “1 defect”, was a "
            "Defect row actually created, and why does Operations Board return 0 matching defects?",
            s["subtitle"],
        )
    )

    story.append(
        Paragraph(
            "HEADLINE — (1) The QA Manager visibility gap is real and code-level. "
            "<font face='Courier'>UserRole</font> has no QA persona; QA Manager has role MANAGER. "
            "All four read access scopes drop non-ADMIN to team-membership only. The QA-actor "
            "concept (<font face='Courier'>isQaActor</font>) exists but is consulted only by "
            "<font face='Courier'>assertCanGovernQa</font> for verify/close authority — not by any "
            "read path. (2) The Site Visits “defectsFound” count is sourced from "
            "<font face='Courier'>InspectionItemResult</font> rows with "
            "<font face='Courier'>isDefect=true</font>, NOT from "
            "<font face='Courier'>Defect</font> rows. A flagged result can exist without a Defect "
            "row, because Defect rows are materialised lazily by Dashboard/Operations Board calls "
            "scoped to the viewer.",
            s["callout_warn"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # Q1
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("1. Why does ADMIN see 7 Site Visits while QA Manager sees 0?", s["h1"]))

    story.append(Paragraph("1.1 The role enum", s["h2"]))
    story.append(
        Paragraph(
            "<font face='Courier'>UserRole</font> "
            "(<font face='Courier'>prisma/schema.prisma:10–17</font>) is "
            "<font face='Courier'>ADMIN | MANAGER | SUPERVISOR | TECHNICIAN | VIEWER | CLIENT</font>. "
            "There is no <font face='Courier'>QA_VALIDATOR</font>, "
            "<font face='Courier'>QA_SUPERVISOR</font>, or “QA Manager” role. A user described as "
            "“QA Manager” in product language is, in code terms, a "
            "<font face='Courier'>MANAGER</font> with optional "
            "<font face='Courier'>QA_VALIDATION</font> capability and ASCURE-organization "
            "membership — the same shape "
            "<font face='Courier'>isQaActor</font> tests.",
            s["body"],
        )
    )

    story.append(Paragraph("1.2 The four access scopes", s["h2"]))
    scopes = [
        [cell("<b>Endpoint</b>"), cell("<b>Helper</b>"), cell("<b>ADMIN behaviour</b>"), cell("<b>Non-ADMIN behaviour</b>")],
        [
            cell("GET /site-visits (list)"),
            code_cell("site-visits.service.ts:2136–2151\naccessScope"),
            cell("returns <font face='Courier'>{}</font> — no extra filter"),
            cell("returns <font face='Courier'>{ team: { members: { some: { userId: user.id, isActive: true } } } }</font>"),
        ],
        [
            cell("GET /dashboard"),
            code_cell("dashboard.service.ts:683–696\nsiteVisitAccessScope"),
            cell("returns <font face='Courier'>{}</font>"),
            cell("returns the same team-membership filter"),
        ],
        [
            cell("GET /dashboard (inspection / defect counts)"),
            code_cell("dashboard.service.ts:664–681\ninspectionAccessScope"),
            cell("returns <font face='Courier'>{}</font>"),
            cell("returns <font face='Courier'>{ siteVisit: { team: { members: { some: …user.id… } } } }</font>"),
        ],
        [
            cell("GET /defects/operations-board"),
            code_cell("defects.service.ts:3144–3161\ninspectionAccessScope"),
            cell("returns <font face='Courier'>{}</font>"),
            cell("returns the same nested team-membership filter on inspection.siteVisit"),
        ],
    ]
    story.append(make_table(scopes, [3.5 * cm, 3.5 * cm, 3.5 * cm, 5.5 * cm]))

    story.append(Paragraph("1.3 Where the QA-actor concept lives — and where it doesn’t", s["h2"]))
    story.append(
        Paragraph(
            "<font face='Courier'>apps/api/src/common/authorization/qa-actor.ts</font> defines two "
            "helpers:",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "export function hasQaActorShape(user) { ... }<br/>"
            "&nbsp;&nbsp;// user.organization.type === ASCURE &amp;&amp;<br/>"
            "&nbsp;&nbsp;// user.organization.isActive === true &amp;&amp;<br/>"
            "&nbsp;&nbsp;// user.capabilityAssignments.length &gt; 0 (active QA_VALIDATION)<br/>"
            "<br/>"
            "export async function isQaActor(prisma, user) { ... }",
            s["code"],
        )
    )
    story.append(
        Paragraph(
            "Repo-wide grep for callers of these helpers returns <b>one and only one</b>: "
            "<font face='Courier'>defects.service.ts:3174</font> inside "
            "<font face='Courier'>assertCanGovernQa</font>. That method gates "
            "<b>verify / close authority for defects</b>. None of the four read scopes above "
            "consults <font face='Courier'>isQaActor</font>.",
            s["body"],
        )
    )

    story.append(Paragraph("1.4 Is QA Manager incorrectly restricted to team membership?", s["h2"]))
    story.append(
        Paragraph(
            "<b>Yes.</b> The pilot governance (V10 §MAINHEAD Visibility Algorithm step 7; V8 §15) "
            "requires QA to have cross-MAINHEAD, cross-team read visibility. The implementation "
            "today only honours that contract by giving QA users the <font face='Courier'>ADMIN</font> "
            "role — which is over-privileged — or by adding them as a team member to every "
            "operational team — which is operationally impractical. With role <font face='Courier'>MANAGER</font> "
            "(the typical pilot setup), QA sees only visits whose team they belong to. For visits "
            "executed by inspection contractors, that count is zero.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "The minimal correct contract would be: each read access scope checks "
            "<font face='Courier'>isQaActor(user)</font> in addition to the ADMIN check, and "
            "returns <font face='Courier'>{}</font> (or a region-scoped equivalent) for QA actors. "
            "No code change is being proposed here — assessment only.",
            s["body"],
        )
    )

    story.append(PageBreak())

    # ─────────────────────────────────────────────────────────────
    # Q2 — JK6B
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("2. JK6B — “1 defect” chain", s["h1"]))

    story.append(Paragraph("2.1 Where the “1 defect” count comes from", s["h2"]))
    story.append(
        Paragraph(
            "Source: <font face='Courier'>SiteVisitsService.getRollups</font> "
            "(<font face='Courier'>site-visits.service.ts:1156–1286</font>). The Site Visits list "
            "page computes the <font face='Courier'>defectsFound</font> column by counting "
            "<font face='Courier'>InspectionItemResult</font> rows with "
            "<font face='Courier'>isDefect=true</font> belonging to inspections of the visit. It "
            "does NOT count <font face='Courier'>Defect</font> rows.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "prisma.inspectionItemResult.findMany({<br/>"
            "&nbsp;&nbsp;where: { isDefect: true, inspection: { siteVisitId: { in: siteVisitIds } } },<br/>"
            "&nbsp;&nbsp;select: { inspection: { select: { siteVisitId: true } } },<br/>"
            "})<br/>"
            "// then: defectsByVisitId.set(siteVisitId, (count) + 1) for each row",
            s["code"],
        )
    )

    story.append(Paragraph("2.2 Where Defect rows come from (lazy materialisation)", s["h2"]))
    story.append(
        Paragraph(
            "<font face='Courier'>DefectsService.ensureDefectsForAccessibleItems</font> "
            "(<font face='Courier'>defects.service.ts:1426–1459</font>) is called <b>only</b> by "
            "the Dashboard (line 36) and Operations Board (line 567). It scans "
            "<font face='Courier'>InspectionItemResult</font> rows with "
            "<font face='Courier'>isDefect=true</font> belonging to inspections the CURRENT VIEWER "
            "can access (i.e., filtered by <font face='Courier'>inspectionAccessScope(user)</font>) "
            "and inserts a <font face='Courier'>Defect</font> row for each via "
            "<font face='Courier'>createMany({ skipDuplicates: true })</font>.",
            s["body"],
        )
    )
    story.extend(
        bullets(
            [
                "Defect rows are <b>not</b> created at inspection-submission time.",
                "Defect rows are <b>not</b> created by viewing the Site Visits list.",
                "Defect rows materialise on-demand the first time an ADMIN (or, in production, "
                "a future QA actor with the same access) opens the Dashboard or Operations Board.",
                "If a QA Manager (role=MANAGER, no team membership) opens Operations Board first, "
                "<font face='Courier'>ensureDefectsForAccessibleItems</font> runs with their "
                "scope — which is empty (no accessible inspections) — and creates <b>no</b> Defect "
                "rows. The visit’s “1 defect” count on the Site Visits page persists because that "
                "rollup counts <font face='Courier'>InspectionItemResult</font>, not "
                "<font face='Courier'>Defect</font>.",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("2.3 The two-table mismatch — table by table", s["h2"]))
    mismatch = [
        [cell("<b>Surface</b>"), cell("<b>Source table</b>"), cell("<b>Filter</b>")],
        [
            cell("Site Visits list — defectsFound column"),
            code_cell("InspectionItemResult"),
            cell("<font face='Courier'>isDefect=true AND inspection.siteVisitId IN (visit ids)</font>. No tenant or access filter here because the outer list query has already filtered visits by access scope."),
        ],
        [
            cell("Dashboard — defect groupBy counts"),
            code_cell("Defect"),
            cell("<font face='Courier'>inspectionItemResult.isDefect=true AND inspection.tenantId=user.tenantId AND inspection.siteVisit.team.members.some.userId=user.id (non-ADMIN only)</font>"),
        ],
        [
            cell("Operations Board — items"),
            code_cell("Defect"),
            cell("Same as above. Plus optional query filters (mainhead, severity, status, etc.)."),
        ],
    ]
    story.append(make_table(mismatch, [4.5 * cm, 3.0 * cm, 8.5 * cm]))

    story.append(Paragraph("2.4 Determination — Defect row for JK6B", s["h2"]))
    story.append(
        Paragraph(
            "<b>The connected DB does not contain JK6B.</b> "
            "Probe across <font face='Courier'>pencawangCode</font>, "
            "<font face='Courier'>pencawangName</font>, substation code/name, and the legacy "
            "<font face='Courier'>SiteVisit.mainhead</font> text column returned 0 matches. "
            "Production access is not available to this assessor. The deterministic answer "
            "therefore comes from code analysis plus the two-table mismatch above:",
            s["body"],
        )
    )
    cases = [
        [cell("<b>Production state</b>"), cell("<b>What the user sees</b>"), cell("<b>Why</b>")],
        [
            cell("Defect row <b>does not</b> exist for JK6B InspectionItemResult"),
            cell("Site Visits list shows “1 defect”. Operations Board returns 0 matching defects."),
            cell(
                "The Site Visits rollup counts the InspectionItemResult row. The Operations Board "
                "<font face='Courier'>defect.findMany</font> returns 0 because no Defect row "
                "exists yet. <font face='Courier'>ensureDefectsForAccessibleItems</font> has not "
                "materialised one — most likely because the only person who opened Operations "
                "Board was a non-team-member viewer (QA Manager) whose access scope returned 0 "
                "accessible items."
            ),
        ],
        [
            cell("Defect row <b>does</b> exist for JK6B"),
            cell("Site Visits list shows “1 defect”. Operations Board:"),
            cell(""),
        ],
        [
            cell("&nbsp;&nbsp;ADMIN view"),
            cell("Should show 1 (in JK6B’s MAINHEAD column)"),
            cell(
                "ADMIN access scope is empty; no row-level filter drops the defect. If admin "
                "still sees 0, an optional query filter is restricting the page (mainhead, severity, "
                "status) — check the URL."
            ),
        ],
        [
            cell("&nbsp;&nbsp;QA Manager view"),
            cell("Returns 0"),
            cell(
                "Non-ADMIN team-membership scope drops the defect because QA Manager is not a "
                "member of JK6B’s site-visit team. Same root cause as Q1."
            ),
        ],
    ]
    story.append(make_table(cases, [4.0 * cm, 4.5 * cm, 7.5 * cm]))

    story.append(PageBreak())

    # ─────────────────────────────────────────────────────────────
    # Production probe to disambiguate
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("3. Production probe to determine which case applies", s["h1"]))
    story.append(
        Paragraph(
            "Run this read-only probe with <font face='Courier'>DATABASE_URL</font> pointed at "
            "production. The output answers Q2 unambiguously.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "// 1) Locate the JK6B visit<br/>"
            "const visit = await prisma.siteVisit.findFirst({<br/>"
            "&nbsp;&nbsp;where: {<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;OR: [<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{ pencawangCode: { contains: 'JK6B', mode: 'insensitive' } },<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{ pencawangName: { contains: 'KINRARA', mode: 'insensitive' } },<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{ substation: { code: { contains: 'JK6B', mode: 'insensitive' } } },<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;],<br/>"
            "&nbsp;&nbsp;},<br/>"
            "&nbsp;&nbsp;select: { id: true, tenantId: true, teamId: true, status: true,<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;substation: { select: { code: true, name: true } } },<br/>"
            "});<br/>"
            "<br/>"
            "// 2) Walk the chain: Inspection -&gt; InspectionItemResult -&gt; Defect<br/>"
            "const inspections = await prisma.inspection.findMany({<br/>"
            "&nbsp;&nbsp;where: { siteVisitId: visit.id },<br/>"
            "&nbsp;&nbsp;select: {<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;id: true, completionStatus: true, submittedAt: true,<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;itemResults: {<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;select: { id: true, label: true, isDefect: true, severity: true,<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;defect: { select: { id: true, status: true, lifecycleStatus: true } } },<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;},<br/>"
            "&nbsp;&nbsp;},<br/>"
            "});<br/>"
            "<br/>"
            "// 3) Count Defect rows linked to that visit<br/>"
            "const defectCount = await prisma.defect.count({<br/>"
            "&nbsp;&nbsp;where: { inspectionItemResult: { inspection: { siteVisitId: visit.id } } },<br/>"
            "});",
            s["code"],
        )
    )
    story.extend(
        bullets(
            [
                "If <font face='Courier'>itemResults.some(r =&gt; r.isDefect)</font> is true and "
                "<font face='Courier'>defectCount === 0</font>, this matches Case A in §2.4: the "
                "flagged result exists but the Defect row was never materialised. Have an ADMIN "
                "open Operations Board once — the next "
                "<font face='Courier'>ensureDefectsForAccessibleItems</font> call creates the row.",
                "If both counts are positive but Operations Board for ADMIN still returns 0, "
                "check the admin web URL for a "
                "<font face='Courier'>?mainhead=</font> / "
                "<font face='Courier'>?severity=</font> / "
                "<font face='Courier'>?status=</font> query parameter that may be filtering it out.",
                "If the flagged item itself does not exist on the inspection (no itemResult with "
                "<font face='Courier'>isDefect=true</font>), then the Site Visits list rollup "
                "should not show “1 defect” — that would point to a stale cached page or a "
                "data-drift between count and display.",
            ],
            s["bullet"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # Bottom line
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("4. Bottom line", s["h1"]))
    story.extend(
        bullets(
            [
                "<b>Q1 answer:</b> ADMIN sees 7 visits, QA Manager sees 0, because every read "
                "access scope (<font face='Courier'>accessScope</font>, "
                "<font face='Courier'>siteVisitAccessScope</font>, "
                "<font face='Courier'>inspectionAccessScope</font>) returns "
                "<font face='Courier'>{}</font> for ADMIN and a team-membership filter for every "
                "other role. The QA-actor concept exists in code but is consulted only for "
                "verify/close authority — not for read visibility. Yes, QA Manager is incorrectly "
                "restricted to team membership. This is a governance gap, not a configuration "
                "error.",
                "<b>Q2 answer:</b> The “1 defect” count on the Site Visits list is sourced from "
                "<font face='Courier'>InspectionItemResult</font> rows where "
                "<font face='Courier'>isDefect=true</font>, NOT from "
                "<font face='Courier'>Defect</font> rows. A flagged result can exist without a "
                "<font face='Courier'>Defect</font> row because materialisation is lazy and "
                "scoped to the viewer. The Operations Board returns 0 either because the Defect "
                "row was never created (no ADMIN viewer triggered "
                "<font face='Courier'>ensureDefectsForAccessibleItems</font>) or because the "
                "current viewer is non-ADMIN and the team-scope drops it. Run the §3 probe to "
                "confirm which.",
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
        title="ASCURE QA Manager Visibility + JK6B Defect Chain Audit",
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
