"""Generate the Production Capability Divergence Audit PDF."""

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


OUTPUT = r"C:\ASCURE\docs\production-capability-divergence-audit.pdf"


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
        "ASCURE — Production /enterprise/options Capability Divergence Audit",
    )
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Page {doc.page}")
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, 1.5 * cm, A4[0] - 2 * cm, 1.5 * cm)
    canvas.restoreState()


def build_story(s):
    story = []

    # Title
    story.append(
        Paragraph(
            "Production Capability List Divergence Audit",
            s["title"],
        )
    )
    story.append(
        Paragraph(
            "Production <font face='Courier'>GET /enterprise/options</font> returns 7 capability "
            "codes; the canonical allow-list defines 12. Five codes are missing on production. "
            "This report determines why, by reviewing every filter the code applies and "
            "cross-checking the live dev DB. No code modified.",
            s["subtitle"],
        )
    )

    # Headline / root cause
    story.append(
        Paragraph(
            "ROOT CAUSE — The code is deterministic and behaves identically across environments. "
            "Dev returns all 12 canonical codes; production returns 7. The only filter capable of "
            "excluding the 5 missing codes is the <font face='Courier'>isActive: true</font> "
            "clause in <font face='Courier'>getOptions()</font>’s "
            "<font face='Courier'>prisma.capability.findMany</font>. The missing rows are "
            "therefore either inactive (<font face='Courier'>isActive=false</font>) or absent on "
            "production. The catalogue page "
            "(<font face='Courier'>/capabilities</font>) supports row deactivation but not "
            "deletion, so the most probable cause is an admin deactivation. Confirmation requires "
            "a direct probe of production (the connected dev DB has the same code path and "
            "returns all 12, so the divergence is data, not code).",
            s["callout_warn"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # Q1 - Root cause
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("1. Root cause", s["h1"]))
    story.append(
        Paragraph(
            "The committed code path — <font face='Courier'>canonical-capabilities.ts</font>, "
            "<font face='Courier'>enterprise.service.ts.getOptions()</font>, "
            "<font face='Courier'>capability-groups.ts</font> — is deterministic. Same inputs "
            "produce the same output. Given:",
            s["body"],
        )
    )
    story.extend(
        bullets(
            [
                "<font face='Courier'>CANONICAL_CAPABILITY_CODES</font> at "
                "<font face='Courier'>canonical-capabilities.ts:14–30</font> includes all 12 codes "
                "(INSPECTION, MAINTENANCE, QA_VALIDATION, REPORTING, SAVR, SAVT, PENCAWANG, "
                "FEEDER_PILLAR, LINK_BOX, CABLE_BRIDGE, UNDERGROUND_CABLE, THERMAL_INSPECTION). "
                "Verified by re-read.",
                "The only server-side filter on the capabilities list is the "
                "<font face='Courier'>where</font> clause at "
                "<font face='Courier'>enterprise.service.ts:437–440</font>: "
                "<font face='Courier'>{ isActive: true, code: { in: Array.from(CANONICAL_CAPABILITY_CODES) } }</font>. "
                "No tenant filter, no role filter, no environment-specific filter.",
                "<font face='Courier'>capability-groups.ts</font> is client-side and cannot expand "
                "the API response; it only further filters / groups what the API returned.",
                "The connected dev DB returns 12 codes through this exact query (verified at "
                "2026-06-03 by replicating the query). Production returns 7 through the same code. "
                "Therefore the divergence is in the data the query reads, not in the code.",
                "A canonical-list capability row is dropped from the response if and only if its "
                "<font face='Courier'>Capability.isActive</font> is false, OR the row does not exist. "
                "There is no third exclusion path.",
            ],
            s["bullet"],
        )
    )
    story.append(
        Paragraph(
            "On production, the five missing codes — INSPECTION, MAINTENANCE, REPORTING, "
            "THERMAL_INSPECTION, UNDERGROUND_CABLE — must therefore satisfy one of those two "
            "conditions. Most probably <font face='Courier'>isActive=false</font>, because the "
            "deployed admin endpoints offer a deactivation toggle on the catalogue page but no "
            "delete endpoint (<font face='Courier'>PATCH /enterprise/capabilities/:id/status</font> "
            "exists; <font face='Courier'>DELETE</font> does not).",
            s["body"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # Q2 / Q3
    # ─────────────────────────────────────────────────────────────
    story.append(
        Paragraph("2. Do the missing capabilities exist in the database? 3. Are they inactive?", s["h1"])
    )
    story.append(
        Paragraph(
            "Cannot be determined from the source repository alone — these are runtime data "
            "questions and require a probe against production. On the connected dev DB:",
            s["body"],
        )
    )
    dev = [
        [
            cell("<b>Code</b>"),
            cell("<b>Dev: exists?</b>"),
            cell("<b>Dev: isActive</b>"),
            cell("<b>Dev: assignments (org/branch/mh/team/user, active only)</b>"),
        ],
        [
            cell("INSPECTION"),
            cell("Yes (id …011)"),
            cell("true"),
            cell("2 / 1 / 1 / 1 / 4"),
        ],
        [
            cell("MAINTENANCE"),
            cell("Yes (id …009)"),
            cell("true"),
            cell("1 / 1 / 0 / 0 / 1"),
        ],
        [
            cell("REPORTING"),
            cell("Yes (id …018)"),
            cell("true"),
            cell("2 / 0 / 0 / 0 / 1"),
        ],
        [
            cell("THERMAL_INSPECTION"),
            cell("Yes (id …008)"),
            cell("true"),
            cell("0 / 0 / 0 / 0 / 0"),
        ],
        [
            cell("UNDERGROUND_CABLE"),
            cell("Yes (id …007)"),
            cell("true"),
            cell("0 / 0 / 0 / 0 / 0"),
        ],
    ]
    story.append(make_table(dev, [4.0 * cm, 3.5 * cm, 2.5 * cm, 6.0 * cm]))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "All five rows exist on dev with stable migration-seeded IDs (allocated in the Sprint G1 "
            "migration <font face='Courier'>20260521113000</font>, lines 236, 237, 238, 240, 247) "
            "and are <font face='Courier'>isActive=true</font>. On dev, the production-observed "
            "response of 7 codes is impossible to reproduce through this code.",
            s["body"],
        )
    )
    story.append(Paragraph("To determine the production state", s["h2"]))
    story.append(
        Paragraph(
            "Run the following Prisma probe against production "
            "(<font face='Courier'>DATABASE_URL</font> pointed at prod). "
            "Read-only; no writes:",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "prisma.capability.findMany({<br/>"
            "&nbsp;&nbsp;where: { code: { in: ['INSPECTION','MAINTENANCE','REPORTING',<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;'THERMAL_INSPECTION','UNDERGROUND_CABLE'] } },<br/>"
            "&nbsp;&nbsp;select: { id: true, code: true, name: true, isActive: true,<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;createdAt: true, updatedAt: true },<br/>"
            "&nbsp;&nbsp;orderBy: { code: 'asc' },<br/>"
            "})",
            s["code"],
        )
    )
    story.extend(
        bullets(
            [
                "If the result has 5 rows, all <font face='Courier'>isActive=false</font>: rows "
                "exist but were deactivated. <b>This is the most probable case</b> given the "
                "absence of a delete endpoint in the catalogue UI.",
                "If the result has fewer than 5 rows: those rows were deleted post-migration "
                "(only possible via direct SQL — no app endpoint deletes capabilities) or the "
                "production database never received the Sprint G1 migration that seeded them.",
                "If <font face='Courier'>updatedAt</font> on the inactive rows is later than "
                "<font face='Courier'>createdAt</font>, the deactivation event is recoverable from "
                "the audit log around that timestamp.",
            ],
            s["bullet"],
        )
    )

    story.append(PageBreak())

    # ─────────────────────────────────────────────────────────────
    # Q4 - Filtering logic excluding them?
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("4. Is filtering logic excluding them?", s["h1"]))
    story.append(
        Paragraph(
            "<b>Yes — specifically the <font face='Courier'>isActive: true</font> clause</b> in "
            "<font face='Courier'>getOptions()</font>. The <font face='Courier'>code IN (...)</font> "
            "clause does NOT exclude them — all five missing codes are members of "
            "<font face='Courier'>CANONICAL_CAPABILITY_CODES</font>. The "
            "<font face='Courier'>isActive: true</font> clause is the only gate that can drop a row "
            "that is otherwise canonical.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "Filter audit, top-to-bottom:",
            s["body"],
        )
    )
    filt = [
        [
            cell("<b>Filter</b>"),
            cell("<b>Where</b>"),
            cell("<b>Drops the 5 missing codes?</b>"),
        ],
        [
            cell("<font face='Courier'>code: { in: [...CANONICAL_CAPABILITY_CODES] }</font>"),
            code_cell("enterprise.service.ts:439"),
            cell("No. All five codes are in the canonical set."),
        ],
        [
            cell("<font face='Courier'>isActive: true</font>"),
            code_cell("enterprise.service.ts:438"),
            cell(
                "<b>Yes — if those rows are inactive.</b> This is the only gate that can "
                "exclude a canonical row."
            ),
        ],
        [
            cell("Client-side <font face='Courier'>isAssignableCapability</font>"),
            code_cell("capability-groups.ts:83–91"),
            cell(
                "No. Cannot drop rows the API did not return. It accepts canonical + active and "
                "would happily render the missing codes if the API returned them."
            ),
        ],
        [
            cell("Client-side <font face='Courier'>groupCapabilities</font>"),
            code_cell("capability-groups.ts:152–186"),
            cell(
                "Indirect. It drops empty group buckets — so if the API returns zero workspace "
                "codes, the entire Workspace Access fieldset is suppressed. This is what the User "
                "form is currently doing, but it’s a downstream effect, not the cause."
            ),
        ],
        [
            cell("Server-side <font face='Courier'>MAINHEAD_PICKER_GROUP_KEYS</font>"),
            code_cell("capability-groups.ts:143"),
            cell(
                "Not applicable. Used only by the MAINHEAD modal "
                "(<font face='Courier'>enterprise-list-client.tsx:858</font>), not by the User form "
                "and not by the API."
            ),
        ],
    ]
    story.append(make_table(filt, [5.0 * cm, 4.0 * cm, 7.0 * cm]))

    # ─────────────────────────────────────────────────────────────
    # Q5 - Exact file and code path
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("5. Exact file and code path responsible", s["h1"]))
    story.append(
        Paragraph(
            "<b>File:</b> <font face='Courier'>apps/api/src/enterprise/enterprise.service.ts</font><br/>"
            "<b>Function:</b> <font face='Courier'>EnterpriseService.getOptions()</font><br/>"
            "<b>Lines:</b> 436–449",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "this.prisma.capability.findMany({<br/>"
            "&nbsp;&nbsp;where: {<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;isActive: true,&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;// ← <b>the gate that excludes inactive canonical rows</b><br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;code: { in: Array.from(CANONICAL_CAPABILITY_CODES) },<br/>"
            "&nbsp;&nbsp;},<br/>"
            "&nbsp;&nbsp;orderBy: [<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;{ isActive: 'desc' },<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;{ name: 'asc' },<br/>"
            "&nbsp;&nbsp;],<br/>"
            "&nbsp;&nbsp;select: { id, name, code, description, isActive },<br/>"
            "})",
            s["code"],
        )
    )
    story.append(
        Paragraph(
            "The clause <font face='Courier'>code: { in: Array.from(CANONICAL_CAPABILITY_CODES) }</font> "
            "is sourced from <font face='Courier'>apps/api/src/common/canonical-capabilities.ts:14–30</font>. "
            "That constant is correct and unchanged across all environments built from this commit. "
            "<font face='Courier'>capability-groups.ts</font> is purely client-side and cannot "
            "affect the API response shape. <font face='Courier'>getOptions()</font> has no other "
            "filter on the capabilities array.",
            s["body"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # Cross-check: how the response was generated
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("6. Sanity check on the production response", s["h1"]))
    story.append(
        Paragraph(
            "The production response (7 codes, alphabetised) is consistent with the committed "
            "query — same ordering "
            "(<font face='Courier'>{ isActive: 'desc' }, { name: 'asc' }</font>):",
            s["body"],
        )
    )
    sanity = [
        [cell("<b>Code</b>"), cell("<b>Display name</b>"), cell("<b>In canonical set?</b>")],
        [cell("CABLE_BRIDGE"), cell("Cable Bridge"), cell("Yes (Asset Domain)")],
        [cell("FEEDER_PILLAR"), cell("Feeder Pillar"), cell("Yes (Asset Domain)")],
        [cell("LINK_BOX"), cell("Link Box"), cell("Yes (Asset Domain)")],
        [cell("PENCAWANG"), cell("Pencawang"), cell("Yes (Asset Domain)")],
        [cell("QA_VALIDATION"), cell("QA Validation"), cell("Yes (Governance &amp; Reporting)")],
        [cell("SAVR"), cell("SAVR"), cell("Yes (Asset Domain)")],
        [cell("SAVT"), cell("SAVT"), cell("Yes (Asset Domain)")],
    ]
    story.append(make_table(sanity, [4.5 * cm, 4.5 * cm, 7.0 * cm]))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "All seven codes are canonical. None of the seven legacy codes (SURVEY / REPAIR / "
            "CIVIL / DISTRIBUTION / THIRTY_THREE_KV / EMERGENCY_RESPONSE / OTHER) appear, which "
            "confirms the canonical filter <b>is</b> being applied — ruling out the possibility "
            "that production is running a pre-allow-list build of the API.",
            s["body"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # Why the User form lost the Workspace Access fieldset
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("7. Why the User form lost the Workspace Access fieldset", s["h1"]))
    story.append(
        Paragraph(
            "<font face='Courier'>groupCapabilities()</font> "
            "(<font face='Courier'>capability-groups.ts:170–185</font>) drops empty group buckets. "
            "With both <font face='Courier'>INSPECTION</font> and "
            "<font face='Courier'>MAINTENANCE</font> absent from the API response, the WORKSPACE "
            "bucket contains zero capabilities, the helper returns no group entry, and the "
            "fieldset's <font face='Courier'>&lt;legend&gt;</font> never renders. The same "
            "mechanism would silently drop the Governance &amp; Reporting fieldset if "
            "<font face='Courier'>REPORTING</font> and <font face='Courier'>QA_VALIDATION</font> "
            "both disappeared; today only <font face='Courier'>REPORTING</font> is missing, so the "
            "Governance group still has one item and remains visible.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "This is consistent with the symptom the user reported: Workspace Access not shown; "
            "Governance &amp; Reporting still shown (only QA Validation visible there); Asset "
            "Domains still shown (with the 6 present Asset Domain codes, minus "
            "<font face='Courier'>UNDERGROUND_CABLE</font> and "
            "<font face='Courier'>THERMAL_INSPECTION</font>).",
            s["body"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # Recommended next checks (no code action)
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("8. Recommended next checks on production", s["h1"]))
    story.extend(
        bullets(
            [
                "Run the read-only Prisma probe in §3 against production. Determines, per row, "
                "whether the missing codes are inactive or absent.",
                "If inactive: check audit logs around each row's "
                "<font face='Courier'>updatedAt</font> timestamp to identify who toggled the row "
                "off. <font face='Courier'>PATCH /enterprise/capabilities/:id/status</font> is the "
                "only app endpoint that flips this flag.",
                "If absent: confirm the Sprint G1 migration "
                "(<font face='Courier'>20260521113000</font>) was applied to the production DB. "
                "<font face='Courier'>SELECT * FROM \"_prisma_migrations\" WHERE \"migration_name\" "
                "LIKE '%sprint_g1%';</font> The migration includes the "
                "<font face='Courier'>ON CONFLICT (\"code\") DO NOTHING</font> clause, so it can "
                "be re-run safely against a partial state.",
                "After the cause is established, reactivation is a single "
                "<font face='Courier'>PATCH /enterprise/capabilities/:id/status</font> per row "
                "(via the existing Capabilities admin page). Any pre-existing inactive "
                "<font face='Courier'>*Capability</font> assignment rows will become active again "
                "because the resolver's "
                "<font face='Courier'>capability: { isActive: true }</font> nested filter is "
                "satisfied once the row is reactivated. No data restoration required if the "
                "rows still exist.",
                "If the rows are absent, re-seeding via the migration's "
                "<font face='Courier'>INSERT … ON CONFLICT DO NOTHING</font> recreates them with "
                "the fixed UUIDs (<font face='Courier'>10000000-0000-4000-8000-…007/…008/…009/…011/…018</font>). "
                "Existing assignment rows that reference those UUIDs would also revive.",
            ],
            s["bullet"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # Bottom line
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("9. Bottom line", s["h1"]))
    story.append(
        Paragraph(
            "The code is correct and consistent with the canonical allow-list. The production "
            "divergence is a data condition: five canonical capability rows are either inactive "
            "or absent on the production database. The "
            "<font face='Courier'>isActive: true</font> clause at "
            "<font face='Courier'>enterprise.service.ts:438</font> is what filters them out of the "
            "<font face='Courier'>/enterprise/options</font> response, and the empty-bucket "
            "elision in <font face='Courier'>groupCapabilities()</font> at "
            "<font face='Courier'>capability-groups.ts:170–185</font> is what makes the Workspace "
            "Access fieldset vanish from the User form. Reactivation via the Capabilities admin "
            "page restores the expected behaviour without any code change.",
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
        title="ASCURE Production Capability Divergence Audit",
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
