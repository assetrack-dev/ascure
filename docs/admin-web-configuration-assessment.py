"""Generate the Admin Web Configuration Assessment PDF."""

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
    KeepTogether,
)


OUTPUT = r"C:\ASCURE\docs\admin-web-configuration-assessment.pdf"


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
    note = ParagraphStyle(
        "NoteX",
        parent=body,
        fontSize=9,
        textColor=colors.HexColor("#475569"),
        spaceAfter=10,
    )
    return {
        "title": title,
        "subtitle": subtitle,
        "h1": h1,
        "h2": h2,
        "body": body,
        "bullet": bullet,
        "code": code,
        "note": note,
    }


def bullets(items, style):
    return [Paragraph(item, style, bulletText="•") for item in items]


def numbered(items, style):
    return [
        Paragraph(item, style, bulletText=f"{i+1}.") for i, item in enumerate(items)
    ]


def table(data, col_widths, header=True):
    style = [
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("LEADING", (0, 0), (-1, -1), 12),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#1F2937")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    if header:
        style.extend(
            [
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F766E")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                (
                    "ROWBACKGROUNDS",
                    (0, 1),
                    (-1, -1),
                    [colors.white, colors.HexColor("#F8FAFC")],
                ),
            ]
        )
    return Table(data, colWidths=col_widths, style=TableStyle(style), repeatRows=1 if header else 0)


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawString(2 * cm, 1.2 * cm, "ASCURE — Admin Web Configuration Assessment")
    canvas.drawRightString(
        A4[0] - 2 * cm,
        1.2 * cm,
        f"Page {doc.page}",
    )
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, 1.5 * cm, A4[0] - 2 * cm, 1.5 * cm)
    canvas.restoreState()


def build_story(s):
    story = []

    # Title block
    story.append(Paragraph("ASCURE Admin Web Configuration Experience", s["title"]))
    story.append(
        Paragraph(
            "Assessment of Organizations, Users, MAINHEADs, Operational Regions, "
            "Capabilities, and Site Visits. Read-only review against Blueprint V1–V10. "
            "No code modified.",
            s["subtitle"],
        )
    )

    # 1. Capability catalogue
    story.append(Paragraph("1. Capability catalogue — current state of truth", s["h1"]))
    story.append(
        Paragraph(
            "<b>One flat table, no structure.</b> The <font face='Courier'>Capability</font> "
            "model (<font face='Courier'>prisma/schema.prisma:459</font>) has only "
            "<font face='Courier'>name / code / description / isActive</font>. There is no "
            "<font face='Courier'>kind</font>, <font face='Courier'>category</font>, "
            "<font face='Courier'>scope</font>, or asset-type link column. The DTOs confirm "
            "this: <font face='Courier'>CreateCapabilityDto</font> accepts only those four fields.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "<b>Seeded codes</b> (<font face='Courier'>prisma/seed.ts:267–282</font>) "
            "— all live in the same bag:",
            s["body"],
        )
    )

    cap_data = [
        ["Code", "What it semantically is"],
        ["INSPECTION", "Workspace / operational role"],
        ["MAINTENANCE", "Workspace / operational role"],
        ["QA_VALIDATION", "Governance role"],
        ["REPORTING", "Operational role"],
        ["SAVR", "Asset / inspection domain"],
        ["SAVT", "Asset / inspection domain"],
        ["PENCAWANG", "Asset / inspection domain"],
        ["FEEDER_PILLAR", "Asset / inspection domain"],
        ["LINK_BOX", "Asset / inspection domain"],
        ["CABLE_BRIDGE", "Asset / inspection domain"],
        ["UNDERGROUND_CABLE", "Asset / inspection domain"],
        ["THERMAL_INSPECTION", "Asset / inspection domain"],
    ]
    story.append(table(cap_data, [5 * cm, 10 * cm]))
    story.append(Spacer(1, 6))

    story.append(
        Paragraph(
            "<b>Parallel legacy enum.</b> <font face='Courier'>OrganizationCapabilityType</font> "
            "(<font face='Courier'>schema.prisma:215</font>) is a separate fixed enum "
            "(SURVEY / INSPECTION / MAINTENANCE / REPAIR / CIVIL / DISTRIBUTION / "
            "THIRTY_THREE_KV / EMERGENCY_RESPONSE / QA_VALIDATION / REPORTING / OTHER) "
            "used only by <font face='Courier'>OrganizationCapability</font> — overlapping "
            "but inconsistent vocabulary with the <font face='Courier'>Capability</font> "
            "table the admin UI actually edits.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "<b>Admin UI shape.</b> <font face='Courier'>enterprise-list-client.tsx:480–517</font> "
            "renders capabilities as a single flat checkbox grid (<font face='Courier'>CapabilityPicker</font>), "
            "and <font face='Courier'>users-client.tsx:230–276</font> does the same "
            "(<font face='Courier'>UserCapabilityPicker</font>). No grouping, no separator, no helper text.",
            s["body"],
        )
    )

    story.append(PageBreak())

    # 2. Findings
    story.append(Paragraph("2. Findings — by question", s["h1"]))

    story.append(Paragraph("2.1 Capability clarity", s["h2"]))
    story.extend(
        bullets(
            [
                "The label set mixes nouns from different ontologies (an asset class like SAVR "
                "sits next to a workspace like INSPECTION). An admin reading SAVR + INSPECTION + "
                "REPORTING cannot tell from the UI alone what the user/team will or won't be able to do.",
                "Codes are upper-snake-case and shown verbatim (<font face='Courier'>optionLabel</font> "
                "prefixes the code). Good for engineers, opaque for the operational admins "
                "Blueprint V6/V35 says we should design for.",
                "No <font face='Courier'>description</font> is shown in the picker (it exists "
                "on the model and the create form, but the picker checkbox only renders "
                "<font face='Courier'>code - name</font>). The single column of information "
                "density the admin needs (“what does ticking this turn on?”) is invisible at pick time.",
                "THERMAL_INSPECTION overlaps INSPECTION semantically; MAINTENANCE overlaps the "
                "operational workspace term used in V10 Mobile Workspaces. Same word, two meanings "
                "(catalogue capability vs. mobile workspace) — guaranteed misread.",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("2.2 Capability categorisation", s["h2"]))
    story.extend(
        bullets(
            [
                "There is none. Per Blueprint V4 §34–35, capabilities are envisaged as a system "
                "that gates “operational visibility and assignment” across "
                "Org/Branch/MAINHEAD/Team/User — but no taxonomy is encoded.",
                "Practically, two categories already exist in the codes themselves: "
                "<b>workspace/operational</b> (INSPECTION, MAINTENANCE, QA_VALIDATION, REPORTING) "
                "and <b>domain/asset</b> (SAVR, SAVT, PENCAWANG, FEEDER_PILLAR, LINK_BOX, "
                "CABLE_BRIDGE, UNDERGROUND_CABLE, THERMAL_INSPECTION). The seed file’s "
                "separation of <font face='Courier'>OrganizationCapabilityType</font> (workspace-ish) "
                "from <font face='Courier'>Capability</font> (domain-ish) hints at the intended "
                "split, but the unified <font face='Courier'>Capability</font> table flattens that back.",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("2.3 Workspace capabilities vs operational capabilities", s["h2"]))
    story.extend(
        bullets(
            [
                "The mobile workspaces are exactly two: <b>Inspection</b> and <b>Maintenance</b> "
                "(V10 §Mobile Workspaces; V3 §3–4, §13). Mobile workspace access is "
                "governed by capability presence (commit 965e68d: “Make mobile workspace access "
                "capability-driven”). So INSPECTION and MAINTENANCE capabilities are "
                "<b>workspace gates</b>, not operational scope.",
                "QA_VALIDATION and REPORTING are governance roles per V6/V8 (QA belongs to ASCURA, "
                "cross-region, cross-MAINHEAD). They are <b>role-like capabilities</b>, not workspace "
                "gates and not asset gates.",
                "The asset codes (SAVR…THERMAL_INSPECTION) are <b>scoped to what assets/templates "
                "a workspace can act on</b>. <font face='Courier'>AssetType.capabilityId</font> and "
                "<font face='Courier'>InspectionTemplate.capability</font> already link assets and "
                "templates to a capability — so these codes really do act as "
                "<b>asset-class filters</b>, distinct from the workspace gates.",
                "Today the admin has to know all of this implicitly. Nothing in the UI says "
                "“ticking SAVR makes SAVR asset types visible” vs “ticking INSPECTION "
                "lets this team open the Inspection workspace.”",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("2.4 Organization setup UX", s["h2"]))
    story.extend(
        bullets(
            [
                "Organization modal is just Name / Code / Type / Active + Capabilities checkbox grid.",
                "Type list defaults to a placeholder enum "
                "(ASCURE / TNB / SUBCONTRACTOR / CONSULTANT / CLIENT / OTHER) — diverges from "
                "V4 §4 (GOVERNANCE / UTILITY_OWNER / INSPECTION_CONTRACTOR / "
                "MAINTENANCE_CONTRACTOR / GENERAL). The two type vocabularies don’t agree.",
                "No way to set or visualise hierarchy from create: no branch preview, no MAINHEAD "
                "count, no contractor-vs-utility hint based on type. The form doesn’t encode "
                "the principle from V6 §12 (contractor independence) or V4 §4 "
                "(organization types).",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("2.5 User setup UX", s["h2"]))
    story.extend(
        bullets(
            [
                "User modal is one long monolithic vertical form: Name, Email, Role, Organization, "
                "Branch, Team, MAINHEAD Access (multi), Region Access (multi), Capabilities (multi), Password.",
                "Role list is ADMIN / MANAGER / SUPERVISOR / TECHNICIAN / VIEWER / CLIENT. "
                "The Blueprint V8 §3 personas are richer (QA Supervisor / QA Inspector / "
                "Team Leader / Maintenance Technician). Personas like QA are not selectable as a role "
                "— they currently must be assembled from capabilities + region access + "
                "organization, with no help.",
                "The legacy <font face='Courier'>mainheadId</font> foreign key is silently maintained: "
                "ticking the first item in MAINHEAD Access auto-writes "
                "<font face='Courier'>mainheadId</font>. Hidden coupling; the legacy single-MAINHEAD "
                "field is still there underneath G1.",
                "“Region Access” and “MAINHEAD Access” are independent "
                "multi-selects. Per V10 §MAINHEAD Visibility Algorithm and V8 §13, region "
                "access <b>inherits</b> all of its MAINHEADs — but the UI presents them as "
                "parallel choices with no resolution hint, so an admin can over-grant (region + every "
                "MAINHEAD individually) or under-grant (region only, then unticking a MAINHEAD that "
                "was never explicit).",
                "Password is set in-line on Create only. Reset requires a second modal. Fine, but "
                "no “force reset on next login,” no expiry, no copy-to-clipboard generated password.",
                "Capabilities again rendered as one flat checkbox grid (same "
                "<font face='Courier'>UserCapabilityPicker</font>), no hint that ticking SAVR without "
                "ticking INSPECTION yields a user that can see SAVR assets but can’t enter the "
                "Inspection workspace.",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("2.6 MAINHEAD setup UX", s["h2"]))
    story.extend(
        bullets(
            [
                "MAINHEAD modal leads with Region (Operational Region dropdown) + Legacy Branch "
                "dropdown, then a collapsed <b>“Legacy branch fields”</b> accordion "
                "(Organization / Branch name / Branch code / Region text). All of that legacy slot "
                "is still <b>mutable</b> on the form.",
                "Per V10 (Governance G1 mandatory) and V6 §12 (contractor independence), MAINHEAD "
                "belongs under <font face='Courier'>OperationalRegion</font>. The “Legacy Branch” "
                "select and the legacy-branch accordion are pre-G1 cruft. They are not flagged as "
                "read-only or deprecated.",
                "Capability picker appears here too. There’s no guidance that the MAINHEAD’s "
                "capabilities act as <b>operational scope advertised by the area</b> (capability "
                "resolution surfaces in <font face='Courier'>MainheadCapability</font>, "
                "<font face='Courier'>schema.prisma:628</font>).",
                "No way to preview which Users/Teams have access to this MAINHEAD, nor which "
                "Projects/Work Packages belong to it, from the create/edit modal. Detail page is "
                "referenced (<font face='Courier'>hasDetail: true</font>) but the modal is the "
                "primary configuration surface.",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("2.7 Site Visit setup UX", s["h2"]))
    story.extend(
        bullets(
            [
                "Site Visit create form shows three controls relevant here: a MAINHEAD dropdown "
                "(whose empty option literally reads <b>“Text MAINHEAD only”</b>), a "
                "free-text <b>“MAINHEAD Text”</b> input below it, and a "
                "Project / Work Package row.",
                "The API DTO (<font face='Courier'>create-site-visit.dto.ts:46, 107</font>) accepts "
                "both <font face='Courier'>mainheadId?: string</font> (UUID) and "
                "<font face='Courier'>mainhead?: string</font> (free text). Validation in "
                "<font face='Courier'>site-visits.service.ts:1104</font> requires <b>either</b>:",
            ],
            s["bullet"],
        )
    )
    story.append(
        Paragraph(
            "if (!dto.mainhead &amp;&amp; !dto.mainheadId) missingFields.push(&apos;MAINHEAD&apos;);",
            s["code"],
        )
    )
    story.extend(
        bullets(
            [
                "So today a visit can ship with a free-text MAINHEAD and <b>no</b> structured FK.",
                "The detail view (<font face='Courier'>site-visit-detail-client.tsx:85–92</font>) "
                "falls back: <font face='Courier'>mainheadRecord?.name → mainheadRecord?.code "
                "→ mainhead (text) → \"Not recorded\"</font>.",
            ],
            s["bullet"],
        )
    )

    story.append(PageBreak())

    # 3. Specific question - capability grouping
    story.append(
        Paragraph(
            "3. Should INSPECTION / MAINTENANCE / QA_VALIDATION / REPORTING be "
            "presented differently from SAVR / SAVT / PENCAWANG / FEEDER_PILLAR / "
            "LINK_BOX / CABLE_BRIDGE / UNDERGROUND_CABLE / THERMAL_INSPECTION?",
            s["h1"],
        )
    )
    story.append(
        Paragraph(
            "<b>Yes.</b> They are two different concepts wearing the same checkbox.",
            s["body"],
        )
    )
    group_data = [
        ["Group", "Real role", "Today"],
        [
            "INSPECTION, MAINTENANCE",
            "Mobile workspace gates (V10 Mobile Workspaces, commit 965e68d)",
            "Same flat checkbox",
        ],
        [
            "QA_VALIDATION, REPORTING",
            "Cross-cutting role / authority capabilities (V6 §8, V8 §5–6)",
            "Same flat checkbox",
        ],
        [
            "SAVR, SAVT, PENCAWANG, FEEDER_PILLAR, LINK_BOX, "
            "CABLE_BRIDGE, UNDERGROUND_CABLE, THERMAL_INSPECTION",
            "Asset-class / inspection-domain scope (V10 Asset Model, V1 §6)",
            "Same flat checkbox",
        ],
    ]
    story.append(table(group_data, [5.5 * cm, 7.5 * cm, 3.5 * cm]))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Presenting them in one undifferentiated list pushes admin error onto every "
            "Org / Branch / MAINHEAD / Team / User assignment, and makes the most common "
            "mistake invisible: granting a domain (SAVR) without the workspace (INSPECTION), "
            "or the reverse.",
            s["body"],
        )
    )

    # 4. MAINHEAD text fallback
    story.append(
        Paragraph(
            "4. Is the MAINHEAD text fallback still required after Governance G1?",
            s["h1"],
        )
    )
    story.append(
        Paragraph(
            "<b>No.</b> Governance G1 (V10 §Governance G1, V8 §12, V4 §6–7, "
            "V6 §13) makes <font face='Courier'>Mainhead</font> a first-class entity with FK "
            "references everywhere (UserMainheadAccess, MainheadCapability, "
            "Project.mainheadId, WorkPackage.mainheadId, SiteVisit.mainheadId, "
            "InspectionTemplate.mainheadId, OperationalSession.mainheadId). The text column "
            "on SiteVisit (<font face='Courier'>mainhead String?</font>, "
            "<font face='Courier'>schema.prisma:927</font>) and the parallel admin-side "
            "<font face='Courier'>“MAINHEAD Text”</font> input are pre-G1 fallbacks.",
            s["body"],
        )
    )
    story.append(Paragraph("<b>Concrete harms of keeping it:</b>", s["body"]))
    story.extend(
        numbered(
            [
                "<b>MAINHEAD visibility algorithm bypass</b> — UserMainheadAccess + "
                "UserOperationalRegionAccess (V10 §MAINHEAD Visibility Algorithm) gate by "
                "<font face='Courier'>mainheadId</font>. A visit with text-only MAINHEAD has no "
                "FK to gate against. Whose queue does it land in?",
                "<b>Template resolution bypass</b> — Resolution order MAINHEAD → "
                "REGION → BRANCH → ORG → GLOBAL (V10 §Template Governance) "
                "keys off <font face='Courier'>mainheadId</font>. Text MAINHEAD silently falls "
                "to GLOBAL templates only.",
                "<b>Capability resolution bypass</b> — MainheadCapability rows can’t "
                "apply to a text MAINHEAD; site visits scoped only by string get no asset-class scoping.",
                "<b>Reporting drift</b> — “Klang Utama,” “KLANG_UTAMA,” "
                "“Klang Utama-1” all coexist as text variants and won’t roll up.",
                "<b>Governance audit gap</b> — Per V6 §9 / V8 §25 MAINHEAD is the "
                "operational area entity that change-control is tracked against. A text-only visit "
                "has no entity to audit.",
            ],
            s["bullet"],
        )
    )
    story.append(
        Paragraph(
            "There is no operational scenario in V10 where a MAINHEAD that matters isn’t "
            "already an admin-configurable record. The text fallback should be retired.",
            s["body"],
        )
    )

    story.append(PageBreak())

    # 5. UX concerns
    story.append(Paragraph("5. UX concerns (priority order)", s["h1"]))
    story.extend(
        numbered(
            [
                "<b>Flat capability list mixes workspaces, governance roles, and asset domains.</b> "
                "Same checkbox for INSPECTION and LINK_BOX. Highest-frequency admin error surface.",
                "<b>No descriptions surfaced at pick time.</b> Description exists on the model but "
                "the picker only renders <font face='Courier'>code - name</font>.",
                "<b>“MAINHEAD Text” input + “Text MAINHEAD only” dropdown placeholder</b> "
                "— invites the operations team to bypass G1.",
                "<b>Two parallel capability vocabularies</b> "
                "(<font face='Courier'>Capability</font> table vs <font face='Courier'>OrganizationCapabilityType</font> enum) "
                "with overlapping but mismatched terms.",
                "<b>Two parallel Organization type vocabularies</b> (UI default "
                "ASCURE/TNB/SUBCONTRACTOR/CONSULTANT/CLIENT/OTHER vs Blueprint "
                "GOVERNANCE/UTILITY_OWNER/INSPECTION_CONTRACTOR/MAINTENANCE_CONTRACTOR/GENERAL).",
                "<b>User role list missing QA personas.</b> No QA_SUPERVISOR / QA_INSPECTOR role; "
                "QA must be reconstructed from org + capability + region access.",
                "<b>MAINHEAD form still surfaces editable “Legacy Branch” + accordion</b> "
                "post-G1, with no deprecation hint.",
                "<b>Region Access vs MAINHEAD Access</b> have no resolution hint — admin can’t "
                "tell what the user will actually see.",
                "<b>Silent <font face='Courier'>mainheadId</font> write from MAINHEAD Access[0]</b> "
                "(<font face='Courier'>users-client.tsx:477</font>) hides a load-bearing legacy field.",
                "<b>No preview of impact</b> anywhere (e.g., creating a MAINHEAD doesn’t show "
                "which Region/Branch/users/teams it inherits to).",
            ],
            s["bullet"],
        )
    )

    # 6. Recommended improvements
    story.append(
        Paragraph("6. Recommended improvements (no code changes — design only)", s["h1"])
    )

    story.append(Paragraph("A. Split the capability catalogue into three sections in the picker", s["h2"]))
    story.append(
        Paragraph(
            "Without changing the data model, present capabilities in <b>grouped fieldsets</b> "
            "in the picker. The classification can be code-prefix or a derived map until a "
            "<font face='Courier'>kind</font> column is added:",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "Workspace access<br/>"
            "&nbsp;&nbsp;☐ Inspection&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Lets users enter the Inspection workspace.<br/>"
            "&nbsp;&nbsp;☐ Maintenance&nbsp;&nbsp;&nbsp;&nbsp;Lets users enter the Maintenance workspace.<br/>"
            "<br/>"
            "Governance &amp; reporting<br/>"
            "&nbsp;&nbsp;☐ QA Validation&nbsp;&nbsp;Cross-MAINHEAD verification authority.<br/>"
            "&nbsp;&nbsp;☐ Reporting&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Operational reporting and export.<br/>"
            "<br/>"
            "Asset domains<br/>"
            "&nbsp;&nbsp;☐ SAVR&nbsp;&nbsp;&nbsp;&nbsp;Pole inspections (Sesalur Atas Voltan Rendah)<br/>"
            "&nbsp;&nbsp;☐ SAVT&nbsp;&nbsp;&nbsp;&nbsp;Route inspections<br/>"
            "&nbsp;&nbsp;☐ Pencawang&nbsp;&nbsp;Substation inspections<br/>"
            "&nbsp;&nbsp;☐ Feeder Pillar<br/>"
            "&nbsp;&nbsp;☐ Link Box<br/>"
            "&nbsp;&nbsp;☐ Cable Bridge<br/>"
            "&nbsp;&nbsp;☐ Underground Cable<br/>"
            "&nbsp;&nbsp;☐ Thermal Inspection",
            s["code"],
        )
    )
    story.append(
        Paragraph(
            "Add description text under each checkbox (it’s already on the model). Show a "
            "one-line “what this turns on” caption per group.",
            s["body"],
        )
    )

    story.append(Paragraph("B. Add a real <font face='Courier'>kind</font> column to <font face='Courier'>Capability</font>", s["h2"]))
    story.append(
        Paragraph(
            "Once the grouping above is validated, persist it. Suggested values: WORKSPACE, "
            "GOVERNANCE, ASSET_DOMAIN. Backfill from current codes deterministically.",
            s["body"],
        )
    )

    story.append(Paragraph("C. Retire the MAINHEAD text fallback", s["h2"]))
    story.extend(
        bullets(
            [
                "Make MAINHEAD dropdown <b>required</b> in the Site Visit form. Drop the empty "
                "option labelled “Text MAINHEAD only.”",
                "Hide the MAINHEAD Text input from the create form. Display the read-only legacy "
                "value only on the detail view when <font face='Courier'>mainheadRecord</font> "
                "is null and the visit predates G1, marked as <b>Legacy</b>.",
                "API: change the <font face='Courier'>if (!dto.mainhead &amp;&amp; !dto.mainheadId)</font> "
                "validator to require <font face='Courier'>mainheadId</font>; keep "
                "<font face='Courier'>mainhead</font> as a read-only string the API may return "
                "but not accept on create.",
                "Migration: backfill <font face='Courier'>mainheadId</font> for existing visits by "
                "matching <font face='Courier'>mainhead</font> text (case-insensitive) against "
                "<font face='Courier'>Mainhead.name</font> / <font face='Courier'>Mainhead.code</font>. "
                "Park unmatched visits in a “MAINHEAD reconciliation” queue.",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("D. Organisation type list — adopt blueprint vocabulary", s["h2"]))
    story.append(
        Paragraph(
            "Replace the placeholder enum with GOVERNANCE / UTILITY_OWNER / "
            "INSPECTION_CONTRACTOR / MAINTENANCE_CONTRACTOR / GENERAL. This eliminates one "
            "of two competing vocabularies.",
            s["body"],
        )
    )

    story.append(Paragraph("E. User personas — surface QA roles directly", s["h2"]))
    story.append(
        Paragraph(
            "Add QA_SUPERVISOR and QA_INSPECTOR to the role list (V8 §5–6). Their "
            "selection should pre-fill region access = all and capabilities = "
            "{QA_VALIDATION, REPORTING} as a starting point, leaving the admin free to adjust. "
            "Optional: introduce TEAM_LEADER and MAINTENANCE_TECHNICIAN per V8 §8, §10.",
            s["body"],
        )
    )

    story.append(Paragraph("F. MAINHEAD form — mark legacy fields read-only", s["h2"]))
    story.append(
        Paragraph(
            "Move “Legacy Branch” select and the “Legacy branch fields” "
            "accordion under a read-only “Pre-G1 references” section. Keep the data "
            "visible for historical visits; block edits. Lead with "
            "<font face='Courier'>OperationalRegion</font> + <font face='Courier'>Capabilities</font> "
            "as the canonical fields.",
            s["body"],
        )
    )

    story.append(Paragraph("G. Region vs MAINHEAD access — show what’s resolved", s["h2"]))
    story.append(
        Paragraph(
            "Below the two pickers, render a small computed line: “Effective MAINHEAD access: "
            "KL Timur, KL Barat, Subang (via Region: Klang Valley) + Bentong (direct).” "
            "Uses the same logic as <font face='Courier'>GET /users/me/mainheads</font>. Stops "
            "over-/under-granting.",
            s["body"],
        )
    )

    story.append(Paragraph("H. Drop the silent <font face='Courier'>mainheadId</font> mirror", s["h2"]))
    story.append(
        Paragraph(
            "Stop auto-writing <font face='Courier'>user.mainheadId</font> from the first "
            "MAINHEAD-access checkbox. Either let it remain null for new G1 users or make it "
            "explicit (“Primary MAINHEAD” selector that the user sees).",
            s["body"],
        )
    )

    story.append(PageBreak())

    # 7. Pilot impact
    story.append(Paragraph("7. Pilot impact", s["h1"]))
    story.append(
        Paragraph(
            "The pilot is SAVR-driven (V10 §SAVR Domain, V9). The capability picker today "
            "<b>does not block</b> the pilot — every required capability exists in the seed, "
            "and the admin can tick SAVR + INSPECTION + REPORTING for an inspection contractor "
            "and MAINTENANCE for the repair contractor. But:",
            s["body"],
        )
    )
    story.extend(
        bullets(
            [
                "<b>Workspace gating is fragile.</b> If an admin ticks SAVR without INSPECTION, "
                "the user sees no workspace. If they tick INSPECTION without SAVR, the user can "
                "enter the workspace but sees no SAVR assets. There is no warning. For a pilot "
                "operator setting up dozens of accounts, this is the most likely cause of "
                "“the technician logged in and nothing was there.”",
                "<b>MAINHEAD text fallback is high risk in the pilot.</b> The pilot ramp-up will "
                "create visits at speed. Any admin who skips the MAINHEAD dropdown (the empty "
                "option still works) creates an audit-degraded visit. Visibility, template "
                "resolution, and reporting all silently degrade — these will only surface as "
                "“why isn’t this visit showing up on QA’s board” or "
                "“why is this defect using the wrong template.”",
                "<b>QA persona absence.</b> ASCURA QA users today need ADMIN role to get the "
                "cross-MAINHEAD visibility V8 §15 demands, or rely on the QA override branch "
                "in the visibility algorithm (V10 §MAINHEAD Visibility Algorithm step 7). "
                "Either is fine functionally but requires the pilot admin to know which lever to pull.",
            ],
            s["bullet"],
        )
    )
    story.append(Paragraph("<b>Pilot-grade fix order:</b>", s["body"]))
    story.extend(
        numbered(
            [
                "Hide / require MAINHEAD dropdown on Site Visit create.",
                "Group the capability picker visually (no schema change required).",
                "Document for the pilot admin: which capability combinations produce which workspaces.",
            ],
            s["bullet"],
        )
    )
    story.append(Paragraph("Everything else can wait past the pilot.", s["body"]))

    # 8. Migration impact
    story.append(Paragraph("8. Migration impact", s["h1"]))
    mig_data = [
        ["Change", "Schema migration", "Data migration", "Risk"],
        ["Group capabilities in picker only", "None", "None", "None"],
        [
            "Add Capability.kind enum",
            "Additive column, default ASSET_DOMAIN",
            "One UPDATE to set workspace/governance kinds",
            "Low",
        ],
        ["Retire MAINHEAD text fallback (UI)", "None", "None", "None — UI-only"],
        [
            "Retire MAINHEAD text fallback (API + schema)",
            "Make SiteVisit.mainheadId non-null, drop SiteVisit.mainhead (or keep nullable read-only)",
            "Backfill mainheadId by name/code match; reconcile unmatched visits manually",
            "Medium — production has existing rows; needs reconciliation list + freeze",
        ],
        [
            "Replace org type enum",
            "Migrate OrganizationType enum values; map ASCURE→GOVERNANCE, TNB→UTILITY_OWNER, "
            "SUBCONTRACTOR→INSPECTION/MAINTENANCE_CONTRACTOR (ambiguous), others→GENERAL",
            "Mapping table; SUBCONTRACTOR ambiguous",
            "Medium — needs admin confirmation per row",
        ],
        [
            "Collapse OrganizationCapabilityType into Capability table",
            "Drop or deprecate OrganizationCapability table; migrate live rows to "
            "OrganizationCapabilityAssignment referencing matching capability code",
            "UPDATE / INSERT",
            "Low–Medium — enum→table is straightforward",
        ],
        ["Add QA persona roles", "Additive enum values", "None for existing users", "Low"],
        [
            "Mark MAINHEAD “Legacy Branch” read-only",
            "None (UI), or split into clear-cut legacyBranchId if not already",
            "None",
            "Low",
        ],
    ]
    story.append(table(mig_data, [4.0 * cm, 4.5 * cm, 4.5 * cm, 3.5 * cm]))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "The blockers for pilot are A and C (capability grouping + MAINHEAD text retirement at "
            "the UI layer) — both are UI-only and add zero risk to production data.",
            s["body"],
        )
    )

    # Summary
    story.append(Paragraph("Summary", s["h1"]))
    story.append(
        Paragraph(
            "The configuration surface today works but treats different governance concepts as "
            "the same checkbox, and still ships a pre-G1 free-text MAINHEAD path that quietly "
            "defeats the Governance G1 algorithms the rest of the platform is built around. The "
            "highest-leverage moves are UI-only: split capabilities into "
            "<b>Workspace / Governance / Asset Domain</b> groups in the existing pickers, and "
            "remove the free-text MAINHEAD route from Site Visit creation. Schema cleanups "
            "(kind column, enum reconciliation, text-column retirement) can follow the pilot. "
            "No code was modified in producing this assessment.",
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
        title="ASCURE Admin Web Configuration Assessment",
        author="ASCURE",
    )
    doc.build(build_story(s), onFirstPage=header_footer, onLaterPages=header_footer)
    print(f"Written: {OUTPUT}")


if __name__ == "__main__":
    main()
