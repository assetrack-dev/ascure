"""Generate the Final Legacy Capability Reference Audit PDF."""

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


OUTPUT = r"C:\ASCURE\docs\legacy-capability-reference-audit.pdf"


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
    callout = ParagraphStyle(
        "CalloutX", parent=body, fontName="Helvetica-Bold",
        fontSize=11, leading=15, textColor=colors.HexColor("#065F46"),
        backColor=colors.HexColor("#ECFDF5"),
        borderColor=colors.HexColor("#10B981"),
        borderWidth=0.6, borderPadding=10,
        spaceAfter=10,
    )
    return {
        "title": title, "subtitle": subtitle, "h1": h1, "h2": h2,
        "body": body, "bullet": bullet, "code": code, "callout": callout,
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
        data, colWidths=col_widths, style=TableStyle(style), repeatRows=1,
    )


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawString(
        2 * cm, 1.2 * cm, "ASCURE — Legacy Capability Reference Audit (Final)"
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
        Paragraph("Final Legacy Capability Reference Audit", s["title"])
    )
    story.append(
        Paragraph(
            "Repository-wide audit confirming whether any ASCURE workflow, permission "
            "check, workspace resolver, template resolver, or defect governance logic "
            "still references the seven legacy capability codes: SURVEY, REPAIR, CIVIL, "
            "DISTRIBUTION, THIRTY_THREE_KV, EMERGENCY_RESPONSE, OTHER. "
            "Assessment only — no modifications.",
            s["subtitle"],
        )
    )

    # Verdict
    story.append(
        Paragraph(
            "VERDICT — No active workflow, permission check, workspace resolver, "
            "template resolver, or defect governance logic references any of the "
            "seven legacy capability codes. All remaining references are either "
            "(a) schema / migration definitions, (b) seed-time data writes, "
            "(c) a single legacy-tolerant filter query path with no current caller, "
            "or (d) same-named identifiers belonging to other enums "
            "(<font face='Courier'>OperationalDomain</font>, "
            "<font face='Courier'>OrganizationType</font>) that are unrelated to "
            "capability semantics.",
            s["callout"],
        )
    )

    # 1. Methodology
    story.append(Paragraph("1. Methodology", s["h1"]))
    story.extend(
        bullets(
            [
                "Repository-wide grep for each of the seven codes across "
                "<font face='Courier'>apps/api</font>, "
                "<font face='Courier'>apps/admin-web</font>, "
                "<font face='Courier'>apps/mobile</font>, "
                "<font face='Courier'>prisma</font>, and "
                "<font face='Courier'>packages</font>.",
                "Each hit classified by surrounding identifier (which enum it belongs to) and "
                "by code role (workflow / permission / resolver / governance / data / docs / unrelated).",
                "Capability-related findings cross-checked against the four runtime modules "
                "the brief calls out: <font face='Courier'>apps/api/src/defects</font>, "
                "<font face='Courier'>apps/api/src/inspections</font>, "
                "<font face='Courier'>apps/api/src/operational-sessions</font>, "
                "<font face='Courier'>apps/api/src/templates</font>, "
                "<font face='Courier'>apps/api/src/common/authorization</font>, and "
                "<font face='Courier'>apps/mobile/src/operationalWorkspace.ts</font>.",
                "Same-named identifiers were inspected to distinguish "
                "<font face='Courier'>OrganizationCapabilityType</font> (legacy capability enum) "
                "from <font face='Courier'>OperationalDomain</font> (Site Visit / Project / "
                "Work Package work-type) and <font face='Courier'>OrganizationType</font> "
                "(company classification).",
            ],
            s["bullet"],
        )
    )

    # 2. Per-module result
    story.append(
        Paragraph("2. Per-module result for the runtime surfaces in scope", s["h1"])
    )
    runtime = [
        [cell("<b>Runtime surface</b>"), cell("<b>Legacy capability references?</b>")],
        [
            cell(
                "Mobile workspace resolver "
                "(<font face='Courier'>apps/mobile/src/operationalWorkspace.ts</font>)"
            ),
            cell(
                "<b>None.</b> Resolver gates on only "
                "<font face='Courier'>INSPECTION</font> and "
                "<font face='Courier'>MAINTENANCE</font> capability codes (lines 10–11, 64, 68)."
            ),
        ],
        [
            cell(
                "Template resolver "
                "(<font face='Courier'>apps/api/src/templates/*.ts</font>)"
            ),
            cell(
                "<b>None.</b> Grep returns zero hits for any of the seven codes "
                "in templates.service.ts, checklist-templates.service.ts."
            ),
        ],
        [
            cell(
                "Defect governance "
                "(<font face='Courier'>apps/api/src/defects/*.ts</font>)"
            ),
            cell(
                "<b>None.</b> Single grep match in <font face='Courier'>defects.service.ts:422</font> "
                "is <font face='Courier'>DefectResolutionOutcome.REPAIRED</font> — a defect resolution outcome enum value "
                "(<i>different word</i>: REPAIRED, not REPAIR; and a different enum entirely)."
            ),
        ],
        [
            cell(
                "Inspection workflow "
                "(<font face='Courier'>apps/api/src/inspections/*.ts</font>)"
            ),
            cell("<b>None.</b>"),
        ],
        [
            cell(
                "Operational session workflow "
                "(<font face='Courier'>apps/api/src/operational-sessions/*.ts</font>)"
            ),
            cell("<b>None.</b>"),
        ],
        [
            cell(
                "Authorization / permission checks "
                "(<font face='Courier'>apps/api/src/common/authorization/*.ts</font>)"
            ),
            cell("<b>None.</b>"),
        ],
        [
            cell(
                "Effective-capability resolver "
                "(<font face='Courier'>apps/api/src/users/users.service.ts</font>)"
            ),
            cell(
                "<b>None of the seven legacy codes.</b> The variable named "
                "<font face='Courier'>organizationCapabilities</font> (line 632) reads "
                "<font face='Courier'>OrganizationCapabilityAssignment</font> (new table, "
                "<font face='Courier'>Capability.code</font> string), not the legacy "
                "<font face='Courier'>OrganizationCapability</font> table."
            ),
        ],
    ]
    story.append(make_table(runtime, [6.5 * cm, 9.5 * cm]))

    story.append(PageBreak())

    # 3. References found — classified
    story.append(
        Paragraph(
            "3. References found across the repository — full classification",
            s["h1"],
        )
    )
    story.append(
        Paragraph(
            "Every occurrence of the seven codes anywhere in the repository, with category and verdict.",
            s["body"],
        )
    )

    story.append(Paragraph("3.1 Schema definitions (Prisma)", s["h2"]))
    schema = [
        [cell("<b>Location</b>"), cell("<b>Belongs to</b>"), cell("<b>Verdict</b>")],
        [
            code_cell("prisma/schema.prisma:152–159"),
            cell("<font face='Courier'>OrganizationType</font> enum — has <b>OTHER</b>"),
            cell(
                "Org-classification enum, not capability. <b>Different concept.</b> Excluded from capability audit."
            ),
        ],
        [
            code_cell("prisma/schema.prisma:161–172"),
            cell(
                "<font face='Courier'>OperationalDomain</font> enum — has SURVEY, REPAIR, CIVIL, DISTRIBUTION, THIRTY_THREE_KV, EMERGENCY, OTHER"
            ),
            cell(
                "Site Visit / Project / Work Package work-type. Same string names, different concept. <b>Different concept.</b>"
            ),
        ],
        [
            code_cell("prisma/schema.prisma:215–227"),
            cell(
                "<font face='Courier'>OrganizationCapabilityType</font> enum — defines all seven legacy values"
            ),
            cell(
                "Structural definition. Used only by the legacy "
                "<font face='Courier'>OrganizationCapability</font> table. <b>Schema only — not behaviour.</b>"
            ),
        ],
    ]
    story.append(make_table(schema, [5.0 * cm, 6.0 * cm, 5.0 * cm]))
    story.append(Spacer(1, 6))

    story.append(Paragraph("3.2 Migrations", s["h2"]))
    migs = [
        [cell("<b>Migration</b>"), cell("<b>What it does</b>"), cell("<b>Verdict</b>")],
        [
            code_cell(
                "20260517183519_phase_1a_enterprise_operations_foundation/migration.sql"
            ),
            cell("Defines <font face='Courier'>OrganizationType</font> enum incl. OTHER."),
            cell("Different enum. Structural only."),
        ],
        [
            code_cell(
                "20260519024954_phase_1d_operational_domain_capabilities/migration.sql"
            ),
            cell(
                "Defines <font face='Courier'>OperationalDomain</font> and "
                "<font face='Courier'>OrganizationCapabilityType</font> enums."
            ),
            cell(
                "Structural only. No behaviour. <b>OrganizationCapabilityType is the legacy enum</b> — defined here, still read by exactly one filter (see §3.4)."
            ),
        ],
        [
            code_cell(
                "20260521113000_sprint_g1_operational_configuration_foundation/migration.sql:229–249"
            ),
            cell(
                "Inserts 19 <font face='Courier'>Capability</font> rows; "
                "lines 239 / 241–245 / 248 are the seven legacy rows."
            ),
            cell(
                "<b>Data.</b> Rows physically exist in the table. Excluded from "
                "<font face='Courier'>/enterprise/options</font> by the canonical allow-list. "
                "No workflow / permission code reads them."
            ),
        ],
    ]
    story.append(make_table(migs, [4.5 * cm, 6.0 * cm, 5.5 * cm]))
    story.append(Spacer(1, 6))

    story.append(Paragraph("3.3 Seed", s["h2"]))
    seed = [
        [cell("<b>Location</b>"), cell("<b>Action</b>"), cell("<b>Verdict</b>")],
        [
            code_cell("prisma/seed.ts:7, 20, 252"),
            cell(
                "Calls <font face='Courier'>ensureOrganizationCapability(ascureOrganization.id, OrganizationCapabilityType.SURVEY)</font> — writes one row to the legacy <font face='Courier'>OrganizationCapability</font> table during seed."
            ),
            cell(
                "<b>Active during seed only.</b> Writes one bootstrap row. Read by the legacy filter path in §3.4 if a client ever queries with <font face='Courier'>?capability=SURVEY</font>. No governance or workflow consumes this row."
            ),
        ],
    ]
    story.append(make_table(seed, [4.0 * cm, 6.5 * cm, 5.5 * cm]))
    story.append(Spacer(1, 6))

    story.append(
        Paragraph(
            "3.4 Active API code — single residual filter path", s["h2"]
        )
    )
    filt = [
        [cell("<b>Location</b>"), cell("<b>Behaviour</b>"), cell("<b>Verdict</b>")],
        [
            code_cell(
                "apps/api/src/enterprise/dto/list-enterprise-query.dto.ts:45–58"
            ),
            cell(
                "<font face='Courier'>ListOrganizationsQueryDto.capability?: OrganizationCapabilityType</font>. "
                "Allows a client to filter "
                "<font face='Courier'>GET /enterprise/organizations</font> by a legacy enum value."
            ),
            cell(
                "<b>Active code path.</b> DTO is wired. Not called by current admin-web "
                "(no <font face='Courier'>?capability=</font> emitted) and not called by mobile. "
                "Pure list/search behaviour — <b>not</b> a workflow / permission / resolver / "
                "governance path. Reachable via direct API call."
            ),
        ],
        [
            code_cell(
                "apps/api/src/enterprise/enterprise.service.ts:2189–2217"
            ),
            cell(
                "<font face='Courier'>listOrganizationsWhere</font> consumes "
                "<font face='Courier'>query.capability</font> with an "
                "<font face='Courier'>OR</font> across (a) legacy "
                "<font face='Courier'>capabilities.some.capability</font> and "
                "(b) new <font face='Courier'>capabilityAssignments.some.capability.code</font>."
            ),
            cell(
                "Same as above. Filter behaviour. Reachable but unused by current clients. "
                "Removing the legacy branch would require a follow-up after confirming no third-party caller."
            ),
        ],
    ]
    story.append(make_table(filt, [4.0 * cm, 6.5 * cm, 5.5 * cm]))

    story.append(PageBreak())

    story.append(
        Paragraph(
            "3.5 Same-named identifiers — NOT capability references",
            s["h2"],
        )
    )
    story.append(
        Paragraph(
            "These hits share the string names of the legacy capability codes but belong to "
            "different enums or concepts. They are listed for transparency and explicitly ruled "
            "out as capability references.",
            s["body"],
        )
    )

    other = [
        [cell("<b>Location</b>"), cell("<b>Belongs to</b>"), cell("<b>Verdict</b>")],
        [
            code_cell("apps/admin-web/src/types/site-visits.ts:25–36"),
            cell(
                "<font face='Courier'>OperationalDomain</font> type — Site Visit work-type."
            ),
            cell("Different concept. Not a capability."),
        ],
        [
            code_cell("apps/admin-web/src/lib/site-visits.ts:210–229"),
            cell(
                "<font face='Courier'>normalizeOperationalDomain()</font> — sanitises raw strings to the "
                "<font face='Courier'>OperationalDomain</font> enum."
            ),
            cell("Different concept. Not a capability."),
        ],
        [
            code_cell(
                "apps/admin-web/src/components/site-visits-client.tsx:121–130"
            ),
            cell("Filter dropdown options for Site Visit operational domain."),
            cell("Different concept. Not a capability."),
        ],
        [
            code_cell(
                "apps/admin-web/src/components/enterprise-list-client.tsx:190 / 345 / 363 / 408 / 633"
            ),
            cell(
                "All references to <font face='Courier'>\"OTHER\"</font> as a default for the "
                "Organization form’s <font face='Courier'>type</font> field "
                "(<font face='Courier'>OrganizationType</font>)."
            ),
            cell("Different concept. Not a capability."),
        ],
        [
            code_cell(
                "apps/api/src/enterprise/enterprise.service.ts:523"
            ),
            cell(
                "<font face='Courier'>type: dto.type ?? OrganizationType.OTHER</font> — default Organization type."
            ),
            cell("Different concept. Not a capability."),
        ],
        [
            code_cell("apps/mobile/src/screens/InspectionDetailScreen.tsx:20, 366, 404"),
            cell(
                "<font face='Courier'>IMAGE_GROUPS = ['BEFORE','DURING','AFTER','OTHER']</font> — image categorisation."
            ),
            cell("Unrelated. Not a capability."),
        ],
        [
            code_cell("apps/mobile/src/types.ts:611"),
            cell(
                "<font face='Courier'>'REPAIRED'</font> defect outcome string."
            ),
            cell(
                "Different word (REPAIRED, not REPAIR). Different enum. Not a capability."
            ),
        ],
        [
            code_cell("apps/api/src/defects/defects.service.ts:422"),
            cell(
                "<font face='Courier'>DefectResolutionOutcome.REPAIRED → RESOLVED</font> mapping."
            ),
            cell(
                "Different word and different enum. Not a capability."
            ),
        ],
    ]
    story.append(make_table(other, [5.5 * cm, 5.5 * cm, 5.0 * cm]))
    story.append(Spacer(1, 6))

    story.append(Paragraph("3.6 Documentation comments only", s["h2"]))
    docs = [
        [cell("<b>Location</b>"), cell("<b>Content</b>")],
        [
            code_cell("apps/api/src/common/canonical-capabilities.ts:6"),
            cell(
                "Comment listing the seven legacy codes and stating they remain in the "
                "<font face='Courier'>Capability</font> table but are not assignable. Non-executing."
            ),
        ],
        [
            code_cell("apps/admin-web/src/lib/capability-groups.ts:56–57"),
            cell(
                "Comment documenting the legacy exclusion in the allow-list helper. Non-executing."
            ),
        ],
    ]
    story.append(make_table(docs, [5.5 * cm, 10.5 * cm]))

    story.append(PageBreak())

    # 4. Summary by code
    story.append(Paragraph("4. Summary by code", s["h1"]))
    by_code = [
        [
            cell("<b>Code</b>"),
            cell("<b>Active in workflow/permission/resolver/governance?</b>"),
            cell("<b>Where it still exists</b>"),
            cell("<b>Status</b>"),
        ],
        [
            cell("SURVEY"),
            cell("No"),
            cell(
                "Schema enum (OrganizationCapabilityType, OperationalDomain); Capability row inserted by migration 20260521113000; one legacy <font face='Courier'>OrganizationCapability</font> row written by seed; site-visit operational-domain UI."
            ),
            cell("Dead capability-wise. Different-concept references remain (OperationalDomain)."),
        ],
        [
            cell("REPAIR"),
            cell("No"),
            cell(
                "Schema enum (both); Capability row; OperationalDomain dropdown filter."
            ),
            cell("Dead capability-wise."),
        ],
        [
            cell("CIVIL"),
            cell("No"),
            cell(
                "Schema enum (both); Capability row; OperationalDomain dropdown filter."
            ),
            cell("Dead capability-wise."),
        ],
        [
            cell("DISTRIBUTION"),
            cell("No"),
            cell(
                "Schema enum (both); Capability row; OperationalDomain dropdown filter."
            ),
            cell("Dead capability-wise."),
        ],
        [
            cell("THIRTY_THREE_KV"),
            cell("No"),
            cell(
                "Schema enum (both); Capability row; OperationalDomain dropdown filter."
            ),
            cell("Dead capability-wise."),
        ],
        [
            cell("EMERGENCY_RESPONSE"),
            cell("No"),
            cell(
                "Schema enum (OrganizationCapabilityType only — note <font face='Courier'>OperationalDomain</font> uses <font face='Courier'>EMERGENCY</font> instead); Capability row."
            ),
            cell("Dead capability-wise. No same-named OperationalDomain reference."),
        ],
        [
            cell("OTHER (capability)"),
            cell("No"),
            cell(
                "Schema enum (OrganizationCapabilityType); Capability row. "
                "Same string also used by <font face='Courier'>OrganizationType.OTHER</font> "
                "(org form default), <font face='Courier'>OperationalDomain.OTHER</font> "
                "(site visit), and mobile image-group <font face='Courier'>'OTHER'</font> — none are capability references."
            ),
            cell("Dead capability-wise. Different-concept hits are intentional and unrelated."),
        ],
    ]
    story.append(make_table(by_code, [3.0 * cm, 3.5 * cm, 5.5 * cm, 4.0 * cm]))

    # 5. Recommendations (optional, no code change)
    story.append(Paragraph("5. Optional follow-ups (backlog, not blocking)", s["h1"]))
    story.extend(
        bullets(
            [
                "Retire <font face='Courier'>ListOrganizationsQueryDto.capability</font> "
                "(<font face='Courier'>OrganizationCapabilityType</font>) and the legacy "
                "<font face='Courier'>capabilities.some.capability</font> branch of "
                "<font face='Courier'>listOrganizationsWhere</font>. Replace with a single "
                "<font face='Courier'>?capabilityCode=…</font> string query that targets only the "
                "new <font face='Courier'>OrganizationCapabilityAssignment</font> table. "
                "Confirm no third-party API caller uses the legacy parameter first.",
                "Drop the legacy <font face='Courier'>ensureOrganizationCapability(ascureOrganization.id, SURVEY)</font> seed call. "
                "It writes one row that nothing in current runtime reads (after the filter retirement above).",
                "Optional: drop <font face='Courier'>OrganizationCapability</font> table and "
                "<font face='Courier'>OrganizationCapabilityType</font> enum once the seed and filter retirement above are done. "
                "Schema-level cleanup only. Requires a migration.",
                "Optional: deactivate the seven legacy <font face='Courier'>Capability</font> rows from the catalogue "
                "(<font face='Courier'>isActive=false</font>) so they vanish from the catalogue page as well. "
                "Already invisible in assignment pickers via the canonical allow-list.",
                "None of these change behaviour today; they only remove dead/reachable-but-unused legacy surface.",
            ],
            s["bullet"],
        )
    )

    # Final note
    story.append(Paragraph("6. Bottom line", s["h1"]))
    story.append(
        Paragraph(
            "ASCURE governance is safe to proceed under the pilot. The seven legacy capability "
            "codes are not consulted by any workflow, permission check, workspace resolver, "
            "template resolver, or defect governance path. The only places they still live are "
            "(a) enum definitions in schema and migrations, (b) one bootstrap seed row, "
            "(c) one optional filter parameter that no current client emits, and "
            "(d) same-named identifiers in distinct enums (<font face='Courier'>OperationalDomain</font>, "
            "<font face='Courier'>OrganizationType</font>) and unrelated mobile constants — none of which are capability semantics. "
            "The follow-ups in §5 are tidy-ups, not corrections.",
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
        title="ASCURE Legacy Capability Reference Audit (Final)",
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
