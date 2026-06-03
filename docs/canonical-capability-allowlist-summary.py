"""Generate the Canonical Capability Allow-list Implementation Summary PDF."""

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


OUTPUT = r"C:\ASCURE\docs\canonical-capability-allowlist-summary.pdf"


def build_styles():
    base = getSampleStyleSheet()

    title = ParagraphStyle(
        "TitleX",
        parent=base["Title"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        textColor=colors.HexColor("#0F172A"),
        spaceAfter=6,
    )
    subtitle = ParagraphStyle(
        "Subtitle",
        parent=base["Normal"],
        fontName="Helvetica",
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#475569"),
        spaceAfter=14,
    )
    h1 = ParagraphStyle(
        "H1X",
        parent=base["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=15,
        leading=19,
        textColor=colors.HexColor("#0F172A"),
        spaceBefore=14,
        spaceAfter=6,
        keepWithNext=1,
    )
    h2 = ParagraphStyle(
        "H2X",
        parent=base["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=16,
        textColor=colors.HexColor("#0F172A"),
        spaceBefore=10,
        spaceAfter=4,
        keepWithNext=1,
    )
    body = ParagraphStyle(
        "BodyX",
        parent=base["BodyText"],
        fontName="Helvetica",
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#1F2937"),
        spaceAfter=6,
        alignment=TA_LEFT,
    )
    bullet = ParagraphStyle(
        "BulletX",
        parent=body,
        leftIndent=14,
        bulletIndent=2,
        spaceAfter=3,
    )
    code = ParagraphStyle(
        "CodeX",
        parent=body,
        fontName="Courier",
        fontSize=9,
        leading=12,
        backColor=colors.HexColor("#F1F5F9"),
        borderColor=colors.HexColor("#E2E8F0"),
        borderWidth=0.5,
        borderPadding=6,
        leftIndent=0,
        rightIndent=0,
        spaceAfter=8,
    )
    return {
        "title": title,
        "subtitle": subtitle,
        "h1": h1,
        "h2": h2,
        "body": body,
        "bullet": bullet,
        "code": code,
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
            "ROWBACKGROUNDS",
            (0, 1),
            (-1, -1),
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
        data,
        colWidths=col_widths,
        style=TableStyle(style),
        repeatRows=1,
    )


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawString(
        2 * cm,
        1.2 * cm,
        "ASCURE — Canonical Capability Allow-list (Pilot Execution Sprint)",
    )
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Page {doc.page}")
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, 1.5 * cm, A4[0] - 2 * cm, 1.5 * cm)
    canvas.restoreState()


def build_story(s):
    story = []

    # Title block
    story.append(
        Paragraph(
            "Canonical Capability Allow-list — Implementation Summary",
            s["title"],
        )
    )
    story.append(
        Paragraph(
            "Pilot Execution Sprint. Restricts assignment pickers to the 12 canonical "
            "capability codes while preserving the catalogue page and any existing "
            "legacy assignment rows. No schema migration. No mobile changes.",
            s["subtitle"],
        )
    )

    # 1. Origin
    story.append(Paragraph("1. Origin of the legacy capabilities", s["h1"]))
    origin = [
        [cell("<b>Source</b>"), cell("<b>Verdict</b>")],
        [
            cell("<font face='Courier'>Capability</font> table"),
            cell(
                "<b>Yes — they live here.</b> Inserted at migration time, not at runtime."
            ),
        ],
        [
            cell("Seed data (<font face='Courier'>prisma/seed.ts</font>)"),
            cell("<b>No.</b> Seed only inserts the 12 canonical codes."),
        ],
        [
            cell(
                "Prisma migration <font face='Courier'>20260521113000_sprint_g1_operational_configuration_foundation/migration.sql</font>"
            ),
            cell(
                "<b>Yes — root cause.</b> Lines 229–249 insert 19 <font face='Courier'>Capability</font> rows under "
                "<font face='Courier'>ON CONFLICT (code) DO NOTHING</font>, of which seven are legacy: "
                "<font face='Courier'>SURVEY</font> (line 239), <font face='Courier'>REPAIR</font> (241), "
                "<font face='Courier'>CIVIL</font> (242), <font face='Courier'>DISTRIBUTION</font> (243), "
                "<font face='Courier'>THIRTY_THREE_KV</font> (244), <font face='Courier'>EMERGENCY_RESPONSE</font> (245), "
                "<font face='Courier'>OTHER</font> (248). The earlier migration "
                "<font face='Courier'>20260519024954</font> only defined the "
                "<font face='Courier'>OrganizationCapabilityType</font> and "
                "<font face='Courier'>OperationalDomain</font> enums — unrelated to the Capability table contents."
            ),
        ],
        [
            cell("API response"),
            cell(
                "Returned from <font face='Courier'>/enterprise/options.capabilities</font> "
                "(<font face='Courier'>enterprise.service.ts:getOptions</font>), which is what the assignment pickers consume."
            ),
        ],
        [cell("Other"), cell("None.")],
    ]
    story.append(make_table(origin, [5.0 * cm, 11.0 * cm]))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "These rows were applied to every environment that has run the Sprint G1 migration, "
            "so legacy codes appear in production. Removing them at the DB level would violate "
            "the “do not delete legacy records” requirement.",
            s["body"],
        )
    )

    # 2. Allow-list design
    story.append(Paragraph("2. Allow-list — design", s["h1"]))
    story.append(
        Paragraph(
            "Two layers, both gated by the same allow-list of 12 canonical codes "
            "(Workspace × 2 + Governance × 2 + Asset Domains × 8):",
            s["body"],
        )
    )

    story.append(Paragraph("Server side — primary filter", s["h2"]))
    story.append(
        Paragraph(
            "<font face='Courier'>/enterprise/options.capabilities</font> now returns only "
            "canonical + active rows:",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "this.prisma.capability.findMany({<br/>"
            "&nbsp;&nbsp;where: {<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;isActive: true,<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;code: { in: Array.from(CANONICAL_CAPABILITY_CODES) },<br/>"
            "&nbsp;&nbsp;},<br/>"
            "&nbsp;&nbsp;...<br/>"
            "})",
            s["code"],
        )
    )
    story.append(
        Paragraph(
            "The catalogue endpoint <font face='Courier'>/enterprise/capabilities</font> "
            "(used by the <font face='Courier'>/capabilities</font> admin page) is "
            "<b>unchanged</b> — it continues to return every row so legacy capabilities remain "
            "visible, editable, and deactivatable in the catalogue UI.",
            s["body"],
        )
    )

    story.append(Paragraph("Client side — defense-in-depth", s["h2"]))
    story.append(
        Paragraph(
            "Both pickers filter <font face='Courier'>options.capabilities</font> through "
            "<font face='Courier'>isAssignableCapability</font> before calling "
            "<font face='Courier'>groupCapabilities</font>. If a future build of the server "
            "forgets the filter, the picker still keeps legacy codes out.",
            s["body"],
        )
    )

    # 3. Preservation
    story.append(Paragraph("3. Preservation of existing data", s["h1"]))
    story.extend(
        bullets(
            [
                "No DELETE statements anywhere. Legacy <font face='Courier'>Capability</font> rows remain in the table.",
                "No mutation of existing <font face='Courier'>*Capability</font> assignment rows.",
                "Existing entities that already have legacy assignments: their form state loader "
                "(<font face='Courier'>readUserCapabilityIds</font>, "
                "<font face='Courier'>readCapabilityIds</font>) still reads all assignments including "
                "legacy IDs. The toggle handler only adds or removes the specific ID it owns — "
                "legacy IDs in <font face='Courier'>values</font> are never touched because no "
                "checkbox exists for them. On save, the form sends back the original legacy IDs "
                "alongside any new canonical selections. Legacy assignments persist silently.",
                "New entities start with empty <font face='Courier'>capabilityIds</font>; the picker "
                "only allows canonical selection.",
            ],
            s["bullet"],
        )
    )

    story.append(PageBreak())

    # 4. Files changed
    story.append(Paragraph("4. Files changed", s["h1"]))
    files = [
        [cell("<b>File</b>"), cell("<b>Status</b>"), cell("<b>Change</b>")],
        [
            code_cell("apps/api/src/common/canonical-capabilities.ts"),
            cell("<b>new</b>"),
            cell(
                "Exports <font face='Courier'>CANONICAL_CAPABILITY_CODES</font> set + "
                "<font face='Courier'>isCanonicalCapabilityCode()</font> predicate."
            ),
        ],
        [
            code_cell("apps/api/src/enterprise/enterprise.service.ts"),
            cell("edited"),
            cell(
                "Imported the constant; added "
                "<font face='Courier'>where: { isActive: true, code: { in: ... } }</font> to the "
                "<font face='Courier'>prisma.capability.findMany</font> call inside "
                "<font face='Courier'>getOptions()</font>. <font face='Courier'>listCapabilities</font> "
                "(catalogue endpoint) unchanged."
            ),
        ],
        [
            code_cell("apps/admin-web/src/lib/capability-groups.ts"),
            cell("edited"),
            cell(
                "Added explicit <font face='Courier'>ASSET_DOMAIN_CODES</font> set, derived "
                "<font face='Courier'>CANONICAL_CAPABILITY_CODES</font> from the union of the three group sets, "
                "exported <font face='Courier'>isCanonicalCapabilityCode()</font> and "
                "<font face='Courier'>isAssignableCapability()</font> (codes-canonical AND "
                "<font face='Courier'>isActive !== false</font>)."
            ),
        ],
        [
            code_cell("apps/admin-web/src/components/enterprise-list-client.tsx"),
            cell("edited"),
            cell(
                "<font face='Courier'>CapabilityPicker</font> now calls "
                "<font face='Courier'>options.capabilities.filter(isAssignableCapability)</font> "
                "before grouping. Returns <font face='Courier'>null</font> if no assignable "
                "capabilities remain. Used by Organizations / Branches / MAINHEADs / Teams modals."
            ),
        ],
        [
            code_cell("apps/admin-web/src/components/users-client.tsx"),
            cell("edited"),
            cell(
                "<font face='Courier'>UserCapabilityPicker</font> applies the same filter. "
                "Used by Create User and Edit User."
            ),
        ],
    ]
    story.append(make_table(files, [6.5 * cm, 1.8 * cm, 7.7 * cm]))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "No schema changes. No data migrations. No mobile changes "
            "(mobile does not call <font face='Courier'>/enterprise/options</font>).",
            s["body"],
        )
    )

    # 5. Validation
    story.append(Paragraph("5. Validation results", s["h1"]))
    val = [
        [cell("<b>Step</b>"), cell("<b>Command</b>"), cell("<b>Result</b>")],
        [
            cell("API build"),
            code_cell(
                "pnpm --filter @ascure/api exec tsc -p tsconfig.build.json"
            ),
            cell("<b>PASS</b> — exit 0, no diagnostics."),
        ],
        [
            cell("Admin typecheck"),
            code_cell("pnpm --filter @ascure/admin-web typecheck"),
            cell("<b>PASS</b> — exit 0, no diagnostics."),
        ],
        [
            cell("Admin build"),
            code_cell("pnpm --filter @ascure/admin-web build"),
            cell(
                "<b>PASS</b> — <font face='Courier'>next build</font> compiled successfully, "
                "all 21 routes generated."
            ),
        ],
    ]
    story.append(make_table(val, [3.0 * cm, 7.0 * cm, 6.0 * cm]))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph("All three ran clean on first attempt.", s["body"])
    )

    # 6. Behavior matrix
    story.append(Paragraph("6. Behavior matrix after deploy", s["h1"]))
    matrix = [
        [
            cell("<b>Scenario</b>"),
            cell("<b>Picker shows</b>"),
            cell("<b>Save payload</b>"),
            cell("<b>Stored assignments</b>"),
        ],
        [
            cell("Create new Organization → tick SAVR + INSPECTION"),
            cell("SAVR, INSPECTION (and other canonical)"),
            code_cell("[SAVR_id, INSPECTION_id]"),
            cell("SAVR, INSPECTION"),
        ],
        [
            cell(
                "Edit Organization that has INSPECTION + CIVIL → tick MAINTENANCE"
            ),
            cell(
                "INSPECTION ticked; CIVIL not shown; MAINTENANCE available"
            ),
            code_cell(
                "[INSPECTION_id, CIVIL_id, MAINTENANCE_id]"
            ),
            cell(
                "INSPECTION, CIVIL, MAINTENANCE (CIVIL preserved)"
            ),
        ],
        [
            cell(
                "Edit Team that has only OTHER + REPAIR → save with no change"
            ),
            cell("Empty picker (no canonical assigned)"),
            code_cell("[OTHER_id, REPAIR_id]"),
            cell("OTHER, REPAIR (preserved)"),
        ],
        [
            cell("Catalogue page <font face='Courier'>/capabilities</font>"),
            cell("All 19 capability rows"),
            cell("n/a"),
            cell("n/a"),
        ],
        [
            cell(
                "Set legacy capability <font face='Courier'>isActive=false</font> via catalogue page"
            ),
            cell(
                "Picker already excludes (active filter + canonical filter)"
            ),
            cell("n/a"),
            cell("n/a"),
        ],
    ]
    story.append(
        make_table(matrix, [5.0 * cm, 4.0 * cm, 3.5 * cm, 3.5 * cm])
    )

    # 7. Rollout
    story.append(Paragraph("7. Rollout notes", s["h1"]))
    story.extend(
        bullets(
            [
                "<b>Deploy API first, admin web second.</b> Filtering the API response is the source "
                "of truth; the admin picker filter is belt-and-braces.",
                "<b>No mobile coordination needed.</b> Mobile does not consume "
                "<font face='Courier'>/enterprise/options</font> for capabilities.",
                "<b>No DB migration.</b> The seven legacy rows remain in "
                "<font face='Courier'>Capability</font> with their existing "
                "<font face='Courier'>isActive=true</font> status; the application-level filter "
                "excludes them. If product later decides to formally retire them, deactivating via "
                "the catalogue page (<font face='Courier'>isActive=false</font>) is sufficient and "
                "reversible. A real <font face='Courier'>DELETE</font> is still not recommended "
                "because of any historical assignment FKs.",
                "<b>Catalogue page visibility unchanged.</b> Per the brief, all 19 capabilities remain "
                "visible and editable from <font face='Courier'>/capabilities</font>. If a stricter "
                "posture is desired later, the catalogue endpoint can also be filtered or a "
                "“Legacy” section can be introduced.",
                "<b>Rollback.</b> Revert the three application files. No data side-effects. Filter "
                "helpers and constants remain harmless if reverted partially.",
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
        title="ASCURE Canonical Capability Allow-list Summary",
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
