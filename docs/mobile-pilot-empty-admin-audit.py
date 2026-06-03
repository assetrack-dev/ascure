"""Generate the Mobile Pilot — Assets Visible, Operational Pages Empty Audit PDF."""

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


OUTPUT = r"C:\ASCURE\docs\mobile-pilot-empty-admin-audit.pdf"


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
        "CodeX", parent=body, fontName="Courier", fontSize=9, leading=12,
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
        ParagraphStyle("cell", fontSize=9, leading=12, fontName="Helvetica"),
    )


def code_cell(text):
    return Paragraph(
        text,
        ParagraphStyle("ccell", fontSize=8, leading=11, fontName="Courier"),
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
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("LEADING", (0, 0), (-1, -1), 12),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("TEXTCOLOR", (0, 1), (-1, -1), colors.HexColor("#1F2937")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
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
        "ASCURE — Mobile Pilot: Assets visible, Operational pages empty — Audit",
    )
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Page {doc.page}")
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, 1.5 * cm, A4[0] - 2 * cm, 1.5 * cm)
    canvas.restoreState()


def build_story(s):
    story = []

    story.append(
        Paragraph(
            "Mobile Pilot — Assets Visible, Operational Pages Empty",
            s["title"],
        )
    )
    story.append(
        Paragraph(
            "Symptoms: mobile workflow runs to completion; admin Assets page shows new assets; "
            "Site Visits, Operations / Sessions, Dashboard, and Operations Board all show zero. "
            "Both ADMIN and QA Manager affected — visibility scope ruled out by the user. "
            "Read-only audit of the create paths, list queries, and live dev DB. No code changes.",
            s["subtitle"],
        )
    )

    story.append(
        Paragraph(
            "ROOT CAUSE — Two independent code facts produce the observed pattern:<br/>"
            "(a) <b>The mobile pilot workflow never creates an OperationalSession row.</b> The "
            "<font face='Courier'>POST /site-visits</font> handler calls "
            "<font face='Courier'>resolveCreateOperationalSession()</font>, which only computes "
            "default values for fields stored on the SiteVisit row itself. It writes nothing to "
            "<font face='Courier'>operationalSession</font>. So the Operations / Sessions page is "
            "expected to remain empty under the mobile-only pilot flow.<br/>"
            "(b) <b>Assets can be saved without a SiteVisit link.</b> The server's create-asset "
            "path treats <font face='Courier'>createdDuringVisitId</font> as optional. If the "
            "mobile create-visit call ever fails or returns a payload mobile can't interpret as a "
            "visit, the AddAsset call can still succeed (asset attaches to the Substation, not the "
            "Visit), which produces visible Assets without a visit/inspection/defect chain.<br/>"
            "The Operations Board, Dashboard, and Site Visits page query the SiteVisit table "
            "(scoped only by tenantId for ADMIN). If those reads return zero in production, the "
            "SiteVisit rows do not exist in admin’s tenant. The dev DB cross-check confirms the "
            "create path produces rows correctly when the call succeeds, so the production "
            "divergence is either a create-time failure in mobile or a tenant mismatch.",
            s["callout_warn"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # Q1 - Mobile creating Site Visit records?
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("1. Is mobile creating Site Visit records?", s["h1"]))
    story.append(
        Paragraph(
            "<b>Code: yes.</b> Mobile’s <font face='Courier'>api.createSiteVisit</font> "
            "(<font face='Courier'>apps/mobile/src/api.ts:351–381</font>) is the only call site for "
            "<font face='Courier'>POST /site-visits</font> in the mobile codebase. The server handler "
            "<font face='Courier'>SiteVisitsService.create</font> "
            "(<font face='Courier'>apps/api/src/site-visits/site-visits.service.ts:375–496</font>) "
            "validates team, substation, MAINHEAD, then calls "
            "<font face='Courier'>prisma.siteVisit.create({...})</font> at line 434. A successful "
            "call writes one <font face='Courier'>SiteVisit</font> row with "
            "<font face='Courier'>status: 'ACTIVE'</font> (default) and "
            "<font face='Courier'>validationStatus: 'PENDING'</font>.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "<b>Live dev DB cross-check.</b> Dev DB currently has 4 SiteVisit rows, all with "
            "<font face='Courier'>status='ACTIVE'</font>, tenant "
            "<font face='Courier'>1ef638af-…</font>. The create path is therefore working in "
            "principle. If production has zero SiteVisit rows for admin’s tenant, the create call "
            "either never fired or failed server-side. Common failure modes after Governance G2:",
            s["body"],
        )
    )
    story.extend(
        bullets(
            [
                "<b>MAINHEAD now required at the DTO level</b> "
                "(<font face='Courier'>create-site-visit.dto.ts:46</font>: "
                "<font face='Courier'>@IsUUID() mainheadId!: string</font>). If mobile’s "
                "<font face='Courier'>selectedMainheadId</font> is empty at submit time, the API "
                "returns 400 and no visit is created.",
                "<b>Team membership.</b> Non-admin users must be active members of "
                "<font face='Courier'>dto.teamId</font>; otherwise the handler throws Forbidden "
                "(<font face='Courier'>site-visits.service.ts:393–411</font>). The mobile UI does "
                "not always make this gate visible.",
                "<b>Substation resolution.</b> "
                "<font face='Courier'>resolveCreateSubstation</font> finds-or-creates a substation; "
                "a code/tenant conflict surfaces as 409 Conflict.",
                "<b>GPS validation for new-Pencawang check-ins.</b> "
                "(<font face='Courier'>site-visits.service.ts:1104</font>) Missing "
                "<font face='Courier'>checkInLatitude</font>/<font face='Courier'>checkInLongitude</font>/"
                "<font face='Courier'>checkInAccuracyMeters</font> for a new pencawang produces 400.",
            ],
            s["bullet"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # Q2 - Operational Session creation
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("2. Is mobile creating Operational Session records?", s["h1"]))
    story.append(
        Paragraph(
            "<b>No — and it never has.</b> The mobile pilot workflow does not call "
            "<font face='Courier'>POST /operational-sessions</font>. The "
            "<font face='Courier'>resolveCreateOperationalSession</font> helper used by the "
            "SiteVisit create handler "
            "(<font face='Courier'>site-visits.service.ts:1032–1060</font>) computes default values "
            "for the operational-session-shaped columns stored on the SiteVisit row itself "
            "(<font face='Courier'>operationMode</font>, <font face='Courier'>operationalScope</font>, "
            "<font face='Courier'>sessionKind</font>, <font face='Courier'>fromPencawangId</font>, "
            "<font face='Courier'>toPencawangId</font>, <font face='Courier'>requiresQAQC</font>, "
            "<font face='Courier'>reportingGroup</font>). It performs no "
            "<font face='Courier'>operationalSession.create()</font>.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "Net effect: the admin <b>Operations / Sessions</b> page lists "
            "<font face='Courier'>OperationalSession</font> rows. These are produced by a separate "
            "module (<font face='Courier'>apps/api/src/operational-sessions/*</font>) not exercised "
            "by the mobile pilot flow. The dev DB contains 7 such rows because they were created "
            "via a different pathway (seed or admin); zero in pilot is expected if no one "
            "calls that endpoint.",
            s["body"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # Q3 - Are assets saved without a Site Visit?
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("3. Are assets being saved without a Site Visit?", s["h1"]))
    story.append(
        Paragraph(
            "<b>Yes, this is possible by design.</b> The server "
            "<font face='Courier'>AssetsService.create</font> "
            "(<font face='Courier'>apps/api/src/assets/assets.service.ts:29–160</font>) treats "
            "<font face='Courier'>createdDuringVisitId</font> as optional. If it is omitted, the "
            "asset is created with the column null and no "
            "<font face='Courier'>SiteVisitAsset</font> link row. The asset still appears on the "
            "admin Assets page because that page walks substations and lists their assets, "
            "independent of any visit.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "Live dev DB confirms this is the dominant case for the current pilot dataset: "
            "of the 2 Asset rows present, both have "
            "<font face='Courier'>createdDuringVisitId: null</font> — even though 4 ACTIVE "
            "SiteVisits exist and 3 SiteVisitAsset link rows exist. So at minimum, some assets in "
            "the dataset bypass the create-time visit linkage. The link rows must have been added "
            "subsequently via <font face='Courier'>linkSiteVisitAsset</font> "
            "(<font face='Courier'>POST /site-visits/:id/assets</font>), or by the implicit-link "
            "materialisation that runs during visit completion "
            "(<font face='Courier'>materializeImplicitVisitAssetLinks</font> at "
            "<font face='Courier'>site-visits.service.ts:722</font>).",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "Important caveat: the mobile AddAssetScreen passes "
            "<font face='Courier'>createdDuringVisitId: siteVisitId</font> at "
            "<font face='Courier'>AddAssetScreen.tsx:476</font>. If "
            "<font face='Courier'>siteVisitId</font> is undefined at that point (because the visit "
            "creation step failed and the navigation arrived at AddAsset by a non-standard route, "
            "or because the visitId was lost from the navigation state), the field is omitted "
            "from the JSON payload and the server treats it as not provided — producing the "
            "no-link case observed in the dev dataset.",
            s["body"],
        )
    )

    story.append(PageBreak())

    # ─────────────────────────────────────────────────────────────
    # Q4 - Inspections linked to Site Visit?
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("4. Are inspections linked to a Site Visit?", s["h1"]))
    story.append(
        Paragraph(
            "<b>By schema, yes.</b> The <font face='Courier'>Inspection</font> model carries an "
            "<font face='Courier'>assetId</font> and is created through the asset → visit chain. "
            "In practice, inspections cannot exist without an asset, and the mobile inspection "
            "flow drills in from a visit context. If the mobile create-visit call fails, the "
            "user cannot reach the inspection form because the VisitDetail screen is the "
            "entry-point.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "In the dev dataset the inspection count (4) matches the SiteVisit count (4) — "
            "consistent with one inspection per visit. If production has zero inspections, that "
            "is consistent with zero visits actually being created in the pilot.",
            s["body"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # Q5 - Dashboard / Operations Board filters
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("5. Are dashboard queries filtering valid records?", s["h1"]))
    story.append(
        Paragraph(
            "<b>No — the dashboard query is permissive for ADMIN.</b> "
            "<font face='Courier'>DashboardService</font> "
            "(<font face='Courier'>apps/api/src/dashboard/dashboard.service.ts:657–662</font>) "
            "scopes all SiteVisit reads through "
            "<font face='Courier'>accessibleSiteVisitWhere</font>:",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "private accessibleSiteVisitWhere(user) {<br/>"
            "&nbsp;&nbsp;return {<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;tenantId: user.tenantId,<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;...this.siteVisitAccessScope(user),<br/>"
            "&nbsp;&nbsp;};<br/>"
            "}<br/>"
            "<br/>"
            "private siteVisitAccessScope(user) {<br/>"
            "&nbsp;&nbsp;if (user.role === 'ADMIN') return {};<br/>"
            "&nbsp;&nbsp;return { team: { members: { some: { userId: user.id, isActive: true } } } };<br/>"
            "}",
            s["code"],
        )
    )
    story.extend(
        bullets(
            [
                "ADMIN user — only <font face='Courier'>tenantId: user.tenantId</font> is applied. "
                "All SiteVisit rows in admin’s tenant are counted.",
                "Non-admin user (including MANAGER, SUPERVISOR, TECHNICIAN, “QA Manager”) — "
                "additionally requires the user to be an active member of the visit’s team. If the "
                "mobile pilot user is NOT a team member of the visit’s team, the dashboard counts "
                "zero. <b>This is the most common cause of QA Manager seeing zero</b>: there is no "
                "<font face='Courier'>QA_VALIDATOR</font> role with cross-team visibility today.",
                "ADMIN and non-admin both seeing zero means: <b>no rows exist in admin’s tenant</b>. "
                "The dashboard isn’t hiding them — they aren’t there.",
                "The Site Visits list page uses the same <font face='Courier'>accessScope</font> "
                "(<font face='Courier'>site-visits.service.ts:2136–2151</font>), and "
                "<font face='Courier'>buildListWhere</font> at lines 1812–1839 also gates on "
                "<font face='Courier'>tenantId</font>. Same conclusion.",
                "The Operations Board reads from defects/inspections, which are downstream of "
                "SiteVisits. Zero visits → zero defects.",
            ],
            s["bullet"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # Q6 - Root cause of Assets visible while operational pages empty
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("6. Root cause", s["h1"]))
    story.append(
        Paragraph(
            "Decomposed by symptom:",
            s["body"],
        )
    )
    rc = [
        [cell("<b>Symptom</b>"), cell("<b>Cause</b>")],
        [
            cell("Admin Assets page shows new assets"),
            cell(
                "Assets are tied to <b>Substation</b>, not to a SiteVisit. The admin Assets page "
                "walks substations and lists their assets, independent of any visit context. "
                "Assets are persisted even when <font face='Courier'>createdDuringVisitId</font> "
                "is null."
            ),
        ],
        [
            cell("Admin Site Visits page shows 0"),
            cell(
                "Either (a) no SiteVisit rows exist in admin’s tenant — which means the mobile "
                "create-visit call did not produce a row (failed validation, returned 4xx, or "
                "never fired); or (b) the rows exist but in a different tenant than admin "
                "(rare — would require cross-tenant setup). The ADMIN list query has no role "
                "filter beyond <font face='Courier'>tenantId</font>."
            ),
        ],
        [
            cell("Admin Operations / Sessions page shows 0"),
            cell(
                "<b>By design.</b> Mobile never creates OperationalSession rows. This page is "
                "expected to remain empty in mobile-only pilots until an admin flow seeds sessions."
            ),
        ],
        [
            cell("Dashboard shows 0 visits"),
            cell(
                "Same query path as Site Visits page. Same conclusion: rows don’t exist in admin’s "
                "tenant."
            ),
        ],
        [
            cell("Operations Board shows 0 defects"),
            cell(
                "Defects are derived from inspections which require an asset link inside a "
                "SiteVisit. Zero visits → zero inspections → zero defects. Downstream of (b)."
            ),
        ],
        [
            cell("QA Manager sees all operational pages blank"),
            cell(
                "If QA Manager has role MANAGER (no special QA role exists today), the team-"
                "membership scope drops every visit they are not a member of. Even if visits do "
                "exist, the QA persona would still see zero on those pages because QA is not in the "
                "execution team. This is a known governance gap noted in the V8 / V10 review — "
                "QA needs a cross-MAINHEAD override that the current code does not provide for "
                "non-ADMIN users."
            ),
        ],
    ]
    story.append(make_table(rc, [4.0 * cm, 12.0 * cm]))

    story.append(PageBreak())

    # 7. Verification steps
    story.append(Paragraph("7. Recommended verification probes on production", s["h1"]))
    story.append(
        Paragraph(
            "Run these read-only Prisma probes against the production DB "
            "(<font face='Courier'>DATABASE_URL</font> pointed at prod). Each is independent.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "// 1. Tenant scoping<br/>"
            "prisma.user.findUnique({ where: { email: 'ADMIN_EMAIL' }, select: { tenantId: true }})<br/>"
            "prisma.siteVisit.groupBy({ by: ['tenantId'], _count: { _all: true } })<br/>"
            "// admin.tenantId should equal at least one SiteVisit tenantId<br/>"
            "<br/>"
            "// 2. Recent SiteVisit rows<br/>"
            "prisma.siteVisit.findMany({<br/>"
            "&nbsp;&nbsp;orderBy: { createdAt: 'desc' }, take: 10,<br/>"
            "&nbsp;&nbsp;select: { id, tenantId, teamId, mainheadId, status, validationStatus,<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;createdByUserId, createdAt, completedAt }<br/>"
            "})<br/>"
            "<br/>"
            "// 3. Recent Assets — note createdDuringVisitId<br/>"
            "prisma.asset.findMany({<br/>"
            "&nbsp;&nbsp;orderBy: { createdAt: 'desc' }, take: 10,<br/>"
            "&nbsp;&nbsp;select: { id, tenantId, substationId, assetCode,<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;createdDuringVisitId, createdAt }<br/>"
            "})<br/>"
            "// If most/all rows have createdDuringVisitId=null, that confirms the visit chain<br/>"
            "// is broken — assets are persisting without their visit linkage.<br/>"
            "<br/>"
            "// 4. Inspections and Defects<br/>"
            "prisma.inspection.count()<br/>"
            "prisma.defect.count()",
            s["code"],
        )
    )
    story.extend(
        bullets(
            [
                "<b>If probe 1 shows mismatched tenants:</b> the mobile pilot user’s tenant differs "
                "from the admin’s tenant. Fix tenant configuration; rows already created remain in "
                "the “wrong” tenant and require a tenant-migration script (or recreation).",
                "<b>If probe 2 returns 0 rows:</b> no visits exist on production. Check the API "
                "<font face='Courier'>access</font>/<font face='Courier'>error</font> logs around "
                "the pilot session for <font face='Courier'>POST /site-visits</font> 4xx responses "
                "(MAINHEAD validation, team membership, GPS) and the mobile’s view of "
                "<font face='Courier'>/users/me/mainheads</font> "
                "(which can be empty if the user has no MAINHEAD access).",
                "<b>If probe 3 shows assets with</b> <font face='Courier'>createdDuringVisitId=null</font>: "
                "mobile is persisting assets through the substation path while the visit chain is "
                "broken. Confirms (a) the symptom (Assets visible) and (b) that no inspection "
                "could have been attached to those assets in a visit context.",
                "<b>If probe 4 returns 0:</b> consistent with the visit chain never producing "
                "inspections or defects. Operations Board emptiness is expected.",
            ],
            s["bullet"],
        )
    )

    # 8. Bottom line
    story.append(Paragraph("8. Bottom line", s["h1"]))
    story.append(
        Paragraph(
            "Two facts together explain everything observed without invoking a code regression:<br/>"
            "1. The mobile pilot workflow never produces OperationalSession rows (it never did).<br/>"
            "2. Assets persist independently of SiteVisits because the create-asset endpoint allows "
            "the visit linkage to be absent, and the admin Assets page reads via Substation.<br/><br/>"
            "If admin sees zero SiteVisits AND zero downstream entities, then no visit was created "
            "in admin’s tenant by the pilot run. The most likely production cause is a "
            "create-visit failure (Governance G2 MAINHEAD requirement, team membership, GPS, "
            "substation conflict) that the mobile UI does not surface clearly enough — followed by "
            "asset creation succeeding because that path does not depend on the visit. "
            "Run probes 1–4 above against production to confirm which sub-case applies.",
            s["body"],
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
        title="ASCURE Mobile Pilot: Empty Admin Audit",
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
