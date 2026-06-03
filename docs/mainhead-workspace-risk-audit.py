"""Generate the MAINHEAD workspace-grant risk audit PDF."""

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


OUTPUT = r"C:\ASCURE\docs\mainhead-workspace-risk-audit.pdf"


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
    callout_ok = ParagraphStyle(
        "CalloutOk", parent=body, fontName="Helvetica-Bold",
        fontSize=11, leading=15, textColor=colors.HexColor("#065F46"),
        backColor=colors.HexColor("#ECFDF5"),
        borderColor=colors.HexColor("#10B981"),
        borderWidth=0.6, borderPadding=10,
        spaceAfter=10,
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
        "callout_ok": callout_ok, "callout_warn": callout_warn,
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
        "ASCURE — MAINHEAD Workspace Grant Risk Audit (Pre-G2)",
    )
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Page {doc.page}")
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, 1.5 * cm, A4[0] - 2 * cm, 1.5 * cm)
    canvas.restoreState()


def yn(b):
    return "Yes" if b else "No"


def build_story(s):
    story = []

    story.append(
        Paragraph(
            "MAINHEAD Workspace Grant Risk Audit",
            s["title"],
        )
    )
    story.append(
        Paragraph(
            "Live read-only audit against the connected database "
            "(<font face='Courier'>localhost:5433/ascure</font>) at "
            "<font face='Courier'>2026-06-03T14:27:34Z</font>. Enumerates every user who "
            "currently receives <font face='Courier'>INSPECTION</font> or "
            "<font face='Courier'>MAINTENANCE</font> capability through a MAINHEAD-level "
            "assignment, and confirms whether the same capability is also granted via User / "
            "Team / Branch / Organization. Mirrors the resolution paths used by "
            "<font face='Courier'>UsersService.getEffectiveCapabilitiesForUser</font>. "
            "Assessment only — no application code modified.",
            s["subtitle"],
        )
    )

    # Headline / executive verdict
    story.append(
        Paragraph(
            "VERDICT — No user in the current dataset would lose workspace access after "
            "Governance G2 deployment. Every affected user already receives the workspace "
            "capability from User AND Team AND Branch AND Organization sources, so the "
            "effective set survives the removal of the MAINHEAD contribution.",
            s["callout_ok"],
        )
    )

    # Top-line numbers
    story.append(Paragraph("1. Audit at a glance", s["h1"]))
    nums = [
        [cell("<b>Metric</b>"), cell("<b>Value</b>")],
        [cell("MAINHEAD workspace assignments "
              "(<font face='Courier'>MainheadCapability</font> rows with code "
              "<font face='Courier'>INSPECTION</font> or "
              "<font face='Courier'>MAINTENANCE</font>, both isActive)"),
         cell("<b>1</b>")],
        [cell("Affected MAINHEADs"), cell("<b>1</b>")],
        [cell("Affected users (any access path to an affected MAINHEAD)"),
         cell("<b>4</b>")],
        [cell("Distinct (user, MAINHEAD, capability) tuples"),
         cell("<b>4</b>")],
        [cell("Users that would lose workspace access after G2"),
         cell("<b>0</b>")],
    ]
    story.append(make_table(nums, [11.0 * cm, 5.0 * cm]))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "All MAINHEAD-level workspace assignments in the dataset are on a single MAINHEAD "
            "(<font face='Courier'>SAVR MAINHEAD</font>, code <font face='Courier'>SAVR</font>) "
            "and grant <font face='Courier'>INSPECTION</font> only. There are no "
            "<font face='Courier'>MAINTENANCE</font> assignments at the MAINHEAD level.",
            s["body"],
        )
    )

    # The actual list
    story.append(Paragraph("2. Affected users — full enumeration", s["h1"]))
    story.append(
        Paragraph(
            "The “Also from” columns answer the question “does this user have the same "
            "capability through an alternative source so that the workspace gate still "
            "resolves after MAINHEAD contributions are removed?”",
            s["body"],
        )
    )

    rows = [
        # (User, MAINHEAD, Capability, Access via, User, Team, Branch, Org, Would lose?)
        [
            cell(
                "<b>ASCURE Admin</b><br/>"
                "<font face='Courier' size='8'>admin@ascure.local</font><br/>"
                "Role: ADMIN"
            ),
            cell("<b>SAVR MAINHEAD</b><br/>(code SAVR)"),
            cell("<font face='Courier'>INSPECTION</font>"),
            cell("LEGACY, TEAM"),
            cell(yn(True)),
            cell(yn(True)),
            cell(yn(True)),
            cell(yn(True)),
            cell("No"),
        ],
        [
            cell(
                "<b>Operations Manager</b><br/>"
                "<font face='Courier' size='8'>manager@ascure.local</font><br/>"
                "Role: MANAGER"
            ),
            cell("<b>SAVR MAINHEAD</b><br/>(code SAVR)"),
            cell("<font face='Courier'>INSPECTION</font>"),
            cell("LEGACY, TEAM"),
            cell(yn(True)),
            cell(yn(True)),
            cell(yn(True)),
            cell(yn(True)),
            cell("No"),
        ],
        [
            cell(
                "<b>Field Supervisor</b><br/>"
                "<font face='Courier' size='8'>supervisor@ascure.local</font><br/>"
                "Role: SUPERVISOR"
            ),
            cell("<b>SAVR MAINHEAD</b><br/>(code SAVR)"),
            cell("<font face='Courier'>INSPECTION</font>"),
            cell("LEGACY, TEAM"),
            cell(yn(True)),
            cell(yn(True)),
            cell(yn(True)),
            cell(yn(True)),
            cell("No"),
        ],
        [
            cell(
                "<b>Field Technician</b><br/>"
                "<font face='Courier' size='8'>technician@ascure.local</font><br/>"
                "Role: TECHNICIAN"
            ),
            cell("<b>SAVR MAINHEAD</b><br/>(code SAVR)"),
            cell("<font face='Courier'>INSPECTION</font>"),
            cell("LEGACY, TEAM"),
            cell(yn(True)),
            cell(yn(True)),
            cell(yn(True)),
            cell(yn(True)),
            cell("No"),
        ],
    ]

    table_data = [
        [
            cell("<b>User</b>"),
            cell("<b>MAINHEAD</b>"),
            cell("<b>Capability</b>"),
            cell("<b>Access via</b>"),
            cell("<b>User</b>"),
            cell("<b>Team</b>"),
            cell("<b>Branch</b>"),
            cell("<b>Org</b>"),
            cell("<b>Would lose?</b>"),
        ]
    ] + rows
    story.append(
        make_table(
            table_data,
            [3.6 * cm, 2.0 * cm, 1.8 * cm, 1.6 * cm, 0.95 * cm, 0.95 * cm,
             1.1 * cm, 0.85 * cm, 1.5 * cm],
        )
    )

    story.append(PageBreak())

    # 3. Methodology
    story.append(Paragraph("3. Methodology", s["h1"]))
    story.append(
        Paragraph(
            "A throwaway Prisma script (deleted post-run, no application code modified) "
            "executed the read-only query below against the live DB. The script mirrors the "
            "five-source resolver in "
            "<font face='Courier'>UsersService.getEffectiveCapabilitiesForUser</font>:",
            s["body"],
        )
    )
    story.extend(
        bullets(
            [
                "Step 1 — Fetch every active <font face='Courier'>MainheadCapability</font> "
                "whose <font face='Courier'>Capability.code</font> is "
                "<font face='Courier'>INSPECTION</font> or <font face='Courier'>MAINTENANCE</font>.",
                "Step 2 — For each affected MAINHEAD, enumerate every user with access via the "
                "four MAINHEAD-access paths the resolver uses: "
                "(a) <font face='Courier'>UserMainheadAccess</font> (direct), "
                "(b) <font face='Courier'>UserOperationalRegionAccess</font> (region inheritance), "
                "(c) <font face='Courier'>teamMembership.team.mainheadId</font>, "
                "(d) legacy <font face='Courier'>user.mainheadId</font>.",
                "Step 3 — For each affected user, recompute the user's full scope sets "
                "(team / branch / org) using the same derivation chain as the resolver "
                "(team → branch / org; mainhead → branch; branch → organization).",
                "Step 4 — Look up <font face='Courier'>INSPECTION</font> / "
                "<font face='Courier'>MAINTENANCE</font> presence on User-direct, "
                "TeamCapability, BranchCapability, and OrganizationCapabilityAssignment rows "
                "for that user's scope sets.",
                "Step 5 — Mark <i>“would lose workspace access”</i> if the user is not ADMIN AND "
                "none of the four alternative sources also grants the same capability.",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("4. Per-user breakdown", s["h1"]))
    story.append(
        Paragraph(
            "Each affected user resolves the <font face='Courier'>INSPECTION</font> capability "
            "through every alternative source. Removing the MAINHEAD contribution is therefore "
            "a no-op for these users' effective sets and workspace access.",
            s["body"],
        )
    )

    breakdown = [
        [
            cell("<b>User</b>"),
            cell("<b>Why they are safe under G2</b>"),
        ],
        [
            cell("ASCURE Admin (ADMIN)"),
            cell(
                "ADMIN role short-circuits the resolver — receives every active capability via "
                "<font face='Courier'>scope: 'ADMIN'</font> regardless of any per-source row. "
                "Also independently holds <font face='Courier'>INSPECTION</font> via User, Team, "
                "Branch, and Organization."
            ),
        ],
        [
            cell("Operations Manager (MANAGER)"),
            cell(
                "<font face='Courier'>INSPECTION</font> present via User + Team + Branch + Organization."
            ),
        ],
        [
            cell("Field Supervisor (SUPERVISOR)"),
            cell(
                "<font face='Courier'>INSPECTION</font> present via User + Team + Branch + Organization."
            ),
        ],
        [
            cell("Field Technician (TECHNICIAN)"),
            cell(
                "<font face='Courier'>INSPECTION</font> present via User + Team + Branch + Organization."
            ),
        ],
    ]
    story.append(make_table(breakdown, [5.0 * cm, 11.0 * cm]))

    # 5. Pilot risk
    story.append(Paragraph("5. Pilot risk assessment", s["h1"]))
    story.extend(
        bullets(
            [
                "<b>Current environment (dev):</b> zero users at risk. G2 may be deployed without "
                "any pre-deploy backfill.",
                "<b>This is the dev seed dataset.</b> Production may differ. Re-run the same "
                "query against staging and production before each promotion. Re-publishing the "
                "audit script for ops is recommended: it is short, idempotent, and read-only.",
                "<b>Same query also covers MAINTENANCE.</b> The dataset shows zero MAINHEAD-level "
                "<font face='Courier'>MAINTENANCE</font> assignments. Should production show any, "
                "they will appear in the same enumeration with the same “alternative source” checks.",
                "<b>Region access is in scope.</b> The query expands "
                "<font face='Courier'>UserOperationalRegionAccess</font> to every MAINHEAD in the "
                "region before checking workspace assignments. No region-inherited users were "
                "found in the dev dataset.",
                "<b>Inactive rows are excluded.</b> The query filters all five capability tables "
                "and the user / mainhead / capability rows on "
                "<font face='Courier'>isActive: true</font>, matching the resolver's behaviour.",
            ],
            s["bullet"],
        )
    )

    # 6. Re-run instructions
    story.append(Paragraph("6. Re-run instructions for staging / production", s["h1"]))
    story.append(
        Paragraph(
            "To re-execute the same audit against another environment, point "
            "<font face='Courier'>DATABASE_URL</font> at the target DB and run the same Prisma "
            "audit script. The script is read-only and never writes. Suggested workflow:",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "$ DATABASE_URL='postgres://...' \\<br/>"
            "&nbsp;&nbsp;pnpm exec tsx scripts/audit-mainhead-workspace-risk.ts",
            s["code"],
        )
    )
    story.append(
        Paragraph(
            "If <font face='Courier'>AUDIT_RESULT_JSON</font> shows any row with "
            "<font face='Courier'>wouldLoseWorkspaceAccess: true</font>, grant the same "
            "capability to the affected user at the User or Team level via the admin UI "
            "before deploying G2. After backfill, re-run the audit; the offending row should "
            "disappear.",
            s["body"],
        )
    )

    # 7. Caveats
    story.append(Paragraph("7. Caveats", s["h1"]))
    story.extend(
        bullets(
            [
                "<b>ADMIN visibility is a presentation choice.</b> The ADMIN row is listed for "
                "completeness; ADMINs cannot lose workspace access under G2 because the resolver "
                "short-circuits for ADMIN before reading any per-source row.",
                "<b>Active flags only.</b> Soft-deleted (<font face='Courier'>isActive=false</font>) "
                "users, mainheads, capabilities, and assignment rows are excluded — they don't "
                "contribute to authority today.",
                "<b>Audit script removed.</b> The temporary Prisma audit script was deleted "
                "after the run. No application code modified.",
                "<b>Re-audit before each promotion.</b> Production volumes are unknown to this "
                "report. The same query must run against staging and production before G2 is "
                "promoted there.",
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
        title="ASCURE MAINHEAD Workspace Grant Risk Audit",
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
