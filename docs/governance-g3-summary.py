"""Generate the Governance Fix Package G3 Implementation Summary PDF."""

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


OUTPUT = r"C:\ASCURE\docs\governance-g3-summary.pdf"


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
    callout_ok = ParagraphStyle("CalloutOk", parent=body, fontName="Helvetica-Bold",
        fontSize=11, leading=15, textColor=colors.HexColor("#065F46"),
        backColor=colors.HexColor("#ECFDF5"), borderColor=colors.HexColor("#10B981"),
        borderWidth=0.6, borderPadding=10, spaceAfter=10)
    return {"title": title, "subtitle": subtitle, "h1": h1, "h2": h2,
            "body": body, "bullet": bullet, "code": code, "callout_ok": callout_ok}


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
    canvas.drawString(2 * cm, 1.2 * cm, "ASCURE — Governance Fix Package G3 — Implementation Summary")
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Page {doc.page}")
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, 1.5 * cm, A4[0] - 2 * cm, 1.5 * cm)
    canvas.restoreState()


def build_story(s):
    story = []

    story.append(Paragraph("Governance Fix Package G3", s["title"]))
    story.append(
        Paragraph(
            "QA visibility + workspace gating + team filtering + mobile visit-create simplification "
            "+ defect orphan audit. Five-item governance sprint. Implementation report. No schema "
            "migration. All four validation checks pass.",
            s["subtitle"],
        )
    )

    story.append(
        Paragraph(
            "STATUS — Implemented and validated. API build, admin typecheck, admin build, mobile "
            "typecheck all PASS on first attempt. QA actors now bypass team-membership filters on "
            "the SiteVisits / Dashboard / Defects / Operations Board read paths and are scoped to "
            "their assigned MAINHEADs. Mobile visit creation no longer exposes a team picker. "
            "Defect orphan audit script delivered for the connected DB — production probe ready.",
            s["callout_ok"],
        )
    )

    # 1. QA Visibility
    story.append(Paragraph("1. QA Visibility", s["h1"]))
    story.append(
        Paragraph(
            "Added shared <font face='Courier'>ScopeContext</font> helper and made every read "
            "access scope consult it. ADMIN remains unbounded. A QA actor "
            "(<font face='Courier'>isQaActor()</font> = "
            "<font face='Courier'>org.type=ASCURE</font> + active "
            "<font face='Courier'>QA_VALIDATION</font> capability) bypasses the team filter and is "
            "instead scoped to MAINHEADs the user has explicit access to via "
            "<font face='Courier'>UserMainheadAccess</font> + "
            "<font face='Courier'>UserOperationalRegionAccess</font>.",
            s["body"],
        )
    )
    f1 = [
        [cell("<b>File</b>"), cell("<b>Status</b>"), cell("<b>Change</b>")],
        [
            code_cell("apps/api/src/common/authorization/scope-context.ts"),
            cell("<b>new</b>"),
            cell("Exports <font face='Courier'>ScopeContext</font> and <font face='Courier'>buildScopeContext(prisma, user)</font>. Resolves <font face='Courier'>isQa</font>, <font face='Courier'>isAdmin</font>, and <font face='Courier'>qaMainheadIds</font> from direct + region-derived MAINHEAD access."),
        ],
        [
            code_cell("apps/api/src/site-visits/site-visits.service.ts"),
            cell("edited"),
            cell("<font face='Courier'>accessScope(user, ctx?)</font> now returns <font face='Courier'>{ mainheadId: { in: ctx.qaMainheadIds } }</font> for QA actors. Public handlers <font face='Courier'>list</font>, <font face='Courier'>getById</font>, <font face='Courier'>getReadById</font> precompute ctx. <font face='Courier'>buildListWhere</font> threads ctx through."),
        ],
        [
            code_cell("apps/api/src/dashboard/dashboard.service.ts"),
            cell("edited"),
            cell("<font face='Courier'>siteVisitAccessScope</font> and <font face='Courier'>inspectionAccessScope</font> now accept ctx + apply MAINHEAD scope for QA. <font face='Courier'>getDashboard</font> precomputes ctx once and threads it into every accessible*Where call. <font face='Courier'>ensureDefectsForAccessibleItems</font> accepts ctx."),
        ],
        [
            code_cell("apps/api/src/defects/defects.service.ts"),
            cell("edited"),
            cell("<font face='Courier'>inspectionAccessScope</font> mirrored. <font face='Courier'>list</font>, <font face='Courier'>getOperationsBoard</font>, <font face='Courier'>buildOperationsBoardWhere</font>, <font face='Courier'>ensureDefectsForAccessibleItems</font>, <font face='Courier'>findOrCreateAccessibleDefect</font>, <font face='Courier'>findAccessibleDefectById</font>, <font face='Courier'>findAccessibleDefectByItemResultId</font> all updated."),
        ],
    ]
    story.append(make_table(f1, [6.0 * cm, 1.5 * cm, 8.5 * cm]))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Access-scope semantics after G3:",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "ADMIN   :  {}                              // full tenant visibility<br/>"
            "QA actor:  { mainheadId: { in: qaMainheadIds } }<br/>"
            "Other   :  { team: { members: { some: { userId, isActive: true } } } }",
            s["code"],
        )
    )

    # 2. Workspace Filtering
    story.append(Paragraph("2. Workspace Filtering", s["h1"]))
    story.append(
        Paragraph(
            "<b>No code change required.</b> Verified in "
            "<font face='Courier'>apps/mobile/src/operationalWorkspace.ts:56–82</font>:",
            s["body"],
        )
    )
    story.extend(
        bullets(
            [
                "<font face='Courier'>getAvailableMobileWorkspaces</font> renders the Inspection "
                "workspace only when the user is ADMIN or has the "
                "<font face='Courier'>INSPECTION</font> capability code.",
                "Maintenance workspace shown only for ADMIN or "
                "<font face='Courier'>MAINTENANCE</font> capability holders.",
                "<font face='Courier'>getAutoOpenWorkspace</font> auto-enters the single workspace "
                "when exactly one is available — single-workspace users skip the picker entirely.",
            ],
            s["bullet"],
        )
    )

    # 3. Team Filtering
    story.append(Paragraph("3. Team dropdown filtered by Organization", s["h1"]))
    story.append(
        Paragraph(
            "User Create/Edit form: team dropdown now filters by the selected Organization. When "
            "no organization is picked, the full list is shown.",
            s["body"],
        )
    )
    f3 = [
        [cell("<b>File</b>"), cell("<b>Change</b>")],
        [
            code_cell("apps/admin-web/src/components/users-client.tsx"),
            cell("Team <font face='Courier'>&lt;select&gt;</font> now wraps the iteration in <font face='Courier'>.filter(team =&gt; !values.organizationId || !team.organizationId || team.organizationId === values.organizationId)</font>. Comment explains the G3 intent. Behaviour preserved when org isn't picked."),
        ],
    ]
    story.append(make_table(f3, [6.5 * cm, 9.5 * cm]))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Site Visits create form left as-is: it has no Organization selector, and MAINHEAD is "
            "already required by Governance G2. The team picker on the mobile checkin flow is "
            "removed entirely under Item 4.",
            s["body"],
        )
    )

    story.append(PageBreak())

    # 4. Mobile Visit Creation
    story.append(Paragraph("4. Mobile Visit Creation — team inferred", s["h1"]))
    story.append(
        Paragraph(
            "<font face='Courier'>CheckInScreen</font> previously showed a multi-team picker "
            "(\"Change Assigned Team\"). G3 removes it; the team is inferred from the user's "
            "team membership as returned by <font face='Courier'>GET /users/me/teams</font>. The "
            "selected team is shown read-only as <font face='Courier'>Team (Auto)</font>.",
            s["body"],
        )
    )
    f4 = [
        [cell("<b>File</b>"), cell("<b>Change</b>")],
        [
            code_cell("apps/mobile/src/screens/CheckInScreen.tsx"),
            cell("Removed the multi-team picker block (Pressable + SelectCard list). Removed the <font face='Courier'>isTeamPickerOpen</font> state. The auto-selection logic that picked the first available team at <font face='Courier'>loadOptions</font> is retained. The user can no longer switch teams from the mobile UI."),
        ],
    ]
    story.append(make_table(f4, [6.0 * cm, 10.0 * cm]))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "<font face='Courier'>api.getTeams(token)</font> already calls "
            "<font face='Courier'>/users/me/teams</font> "
            "(<font face='Courier'>apps/mobile/src/api.ts:270–272</font>) so the source list is "
            "already scoped to the user's assignments. The UX behaviour matches V10 §Mobile "
            "Workspaces: zero-input team binding for field execution.",
            s["body"],
        )
    )

    # 5. Defect Orphan Audit
    story.append(Paragraph("5. Defect Orphan Audit (assessment-only)", s["h1"]))
    story.append(
        Paragraph(
            "A read-only Prisma script was authored, executed against the connected dev DB, and "
            "then deleted (no app code modified). Output for the connected DB:",
            s["body"],
        )
    )
    o = [
        [cell("<b>Tenant</b>"), cell("<b>Flagged InspectionItemResult</b>"), cell("<b>Defect rows</b>"), cell("<b>Orphans</b>")],
        [
            cell("1ef638af-… (demo-tenant — Demo Utility Tenant)"),
            cell("0"),
            cell("0"),
            cell("0"),
        ],
    ]
    story.append(make_table(o, [6.0 * cm, 4.5 * cm, 3.0 * cm, 2.5 * cm]))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "The connected DB has no flagged items to orphan. Production must be probed by the "
            "same script — pointed at production "
            "<font face='Courier'>DATABASE_URL</font>. The script captures, per tenant: total "
            "flagged, total Defect rows, orphan count, and up to 100 orphan detail rows "
            "(InspectionItemResult id, inspection id, site visit id + pencawang, asset). It also "
            "prints a one-shot idempotent backfill SQL:",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "INSERT INTO \"Defect\" (...)<br/>"
            "SELECT gen_random_uuid(), iir.id, 'OPEN',<br/>"
            "&nbsp;&nbsp;COALESCE(iir.severity, 'MEDIUM'), 'DETECTED', NOW(), NOW()<br/>"
            "FROM \"InspectionItemResult\" iir<br/>"
            "LEFT JOIN \"Defect\" d ON d.\"inspectionItemResultId\" = iir.id<br/>"
            "WHERE iir.\"isDefect\" = true AND d.id IS NULL<br/>"
            "ON CONFLICT (\"inspectionItemResultId\") DO NOTHING;",
            s["code"],
        )
    )

    # Validation
    story.append(Paragraph("Validation", s["h1"]))
    v = [
        [cell("<b>Step</b>"), cell("<b>Command</b>"), cell("<b>Result</b>")],
        [cell("API build"), code_cell("pnpm --filter @ascure/api exec tsc -p tsconfig.build.json"), cell("<b>PASS</b> — exit 0")],
        [cell("Admin typecheck"), code_cell("pnpm --filter @ascure/admin-web typecheck"), cell("<b>PASS</b> — exit 0")],
        [cell("Admin build"), code_cell("pnpm --filter @ascure/admin-web build"), cell("<b>PASS</b> — all 21 routes generated")],
        [cell("Mobile typecheck"), code_cell("(cd apps/mobile && pnpm exec tsc --noEmit)"), cell("<b>PASS</b> — exit 0")],
    ]
    story.append(make_table(v, [3.5 * cm, 6.5 * cm, 6.0 * cm]))

    # Pilot risks
    story.append(Paragraph("Pilot risks discovered", s["h1"]))
    story.extend(
        bullets(
            [
                "<b>QA actor with zero accessible MAINHEADs sees zero visits / defects.</b> The "
                "MAINHEAD scope becomes <font face='Courier'>{ in: [] }</font>, which Prisma treats "
                "as no match. Pre-G3, the same user would see zero via team scope; net behaviour "
                "for an un-provisioned QA is unchanged but now explicit. Provision QA users with "
                "either direct MAINHEAD or region access before relying on the bypass.",
                "<b>Mobile users with multiple teams can no longer choose.</b> The first team in "
                "<font face='Courier'>/users/me/teams</font> wins. If product needs explicit "
                "primary-team selection, add a <font face='Courier'>User.primaryTeamId</font> column "
                "in a future migration and have the API return it first.",
                "<b>Two near-duplicate ensureDefectsForAccessibleItems copies remain</b> "
                "(<font face='Courier'>dashboard.service.ts</font> + "
                "<font face='Courier'>defects.service.ts</font>). G3 brings them up to feature parity; "
                "consolidation is a follow-up.",
                "<b>QA visibility refactor is scoped to read paths only.</b> Mutation paths "
                "(verify, close, assign) still use <font face='Courier'>findAccessibleDefectById</font> "
                "/ <font face='Courier'>findAccessibleDefectByItemResultId</font> which now also "
                "consult ctx — so QA actors can act on defects within their MAINHEAD scope. "
                "<font face='Courier'>findAccessibleSiteVisit</font> still uses legacy team scope "
                "for write-side mutations (uploadImage, complete, cancel, link asset). QA does not "
                "currently mutate site visits directly; flag for follow-up if that changes.",
            ],
            s["bullet"],
        )
    )

    # Rollout
    story.append(Paragraph("Rollout order", s["h1"]))
    story.extend(
        bullets(
            [
                "<b>API first.</b> The scope-context + access-scope changes are source-of-truth.",
                "<b>Admin web second.</b> User-form team filter only takes effect once shipped; "
                "API is forward-compatible either way.",
                "<b>Mobile third.</b> Build + deploy. The CheckInScreen change is purely UI; the "
                "POST /site-visits payload shape is unchanged.",
                "<b>Production probe before deploy:</b> run the §5 audit script against production. "
                "If orphans > 0, run the printed backfill SQL inside a single transaction. "
                "Re-run the audit; orphan count should drop to zero.",
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
        title="ASCURE Governance Fix Package G3 Summary",
        author="ASCURE",
    )
    doc.build(build_story(s), onFirstPage=header_footer, onLaterPages=header_footer)
    print(f"Written: {OUTPUT}")


if __name__ == "__main__":
    main()
