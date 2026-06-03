"""Generate the Pilot UX Cleanup Plan PDF."""

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


OUTPUT = r"C:\ASCURE\docs\pilot-ux-cleanup-plan.pdf"


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


def numbered(items, style):
    return [Paragraph(item, style, bulletText=f"{i+1}.") for i, item in enumerate(items)]


def make_table(data, col_widths, header=True, file_col=None):
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
    if file_col is not None:
        style.append(("FONTNAME", (file_col, 1), (file_col, -1), "Courier"))
        style.append(("FONTSIZE", (file_col, 1), (file_col, -1), 8))
    return Table(
        data,
        colWidths=col_widths,
        style=TableStyle(style),
        repeatRows=1 if header else 0,
    )


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawString(2 * cm, 1.2 * cm, "ASCURE — Pilot UX Cleanup Plan")
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Page {doc.page}")
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, 1.5 * cm, A4[0] - 2 * cm, 1.5 * cm)
    canvas.restoreState()


def cell(text):
    """Wrap cell text so it wraps inside narrow columns."""
    return Paragraph(text, ParagraphStyle("cell", fontSize=9, leading=12, fontName="Helvetica"))


def code_cell(text):
    return Paragraph(text, ParagraphStyle("ccell", fontSize=8, leading=11, fontName="Courier"))


def build_story(s):
    story = []

    # Title
    story.append(Paragraph("ASCURE Pilot UX Cleanup Plan", s["title"]))
    story.append(
        Paragraph(
            "Three scoped changes ahead of pilot: capability picker grouping, Site Visit "
            "MAINHEAD cleanup, and effective MAINHEAD access preview on the User form. "
            "Plan only — no code modified.",
            s["subtitle"],
        )
    )

    # ───────────────────────────────────────────────────────────────────────
    # ITEM 1
    # ───────────────────────────────────────────────────────────────────────
    story.append(Paragraph("Item 1 — Capability picker grouping", s["h1"]))
    story.append(
        Paragraph(
            "Group the existing flat capability checkbox grid into three named fieldsets: "
            "<b>Workspace Access</b>, <b>Governance &amp; Reporting</b>, "
            "<b>Asset Domains</b>. No schema change. Grouping is driven by a "
            "code → group map on the client.",
            s["body"],
        )
    )

    story.append(Paragraph("Screens affected", s["h2"]))
    screens1 = [
        [cell("<b>Screen</b>"), cell("<b>Where the picker shows up</b>"), cell("<b>Behaviour change</b>")],
        [cell("Organizations — Create/Edit modal"), code_cell("CapabilityPicker"), cell("Replace flat 2-col grid with three labelled fieldsets, each in its own card")],
        [cell("Branches — Create/Edit modal"), code_cell("CapabilityPicker"), cell("Same")],
        [cell("MAINHEADs — Create/Edit modal"), code_cell("CapabilityPicker"), cell("Same")],
        [cell("Teams — Create/Edit modal"), code_cell("CapabilityPicker"), cell("Same")],
        [cell("Users — Create/Edit modal"), code_cell("UserCapabilityPicker"), cell("Same")],
    ]
    story.append(make_table(screens1, [4.8 * cm, 4.2 * cm, 7.0 * cm]))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "The same component is shared across the four enterprise kinds "
            "(org/branch/mainhead/team). Users has its own variant. Both need updating.",
            s["body"],
        )
    )

    story.append(Paragraph("Files affected", s["h2"]))
    files1 = [
        [cell("<b>File</b>"), cell("<b>Change</b>")],
        [
            code_cell("apps/admin-web/src/components/enterprise-list-client.tsx"),
            cell("Rework <font face='Courier'>CapabilityPicker</font> (~lines 471–517) to render three grouped fieldsets. Group resolution is a small pure helper."),
        ],
        [
            code_cell("apps/admin-web/src/components/users-client.tsx"),
            cell("Rework <font face='Courier'>UserCapabilityPicker</font> (~lines 230–276) the same way."),
        ],
        [
            code_cell("apps/admin-web/src/lib/capability-groups.ts <i>(new)</i>"),
            cell("Single source of truth: <font face='Courier'>capabilityGroupFor(code) → \"WORKSPACE\" | \"GOVERNANCE\" | \"ASSET_DOMAIN\"</font>. Code-prefix map for the 12 seeded codes; unknown codes fall through to <font face='Courier'>ASSET_DOMAIN</font> so contractor-specific additions still render."),
        ],
        [
            code_cell("apps/admin-web/src/types/enterprise.ts"),
            cell("No type change required (group is derived, not persisted)."),
        ],
    ]
    story.append(make_table(files1, [7.5 * cm, 8.5 * cm]))
    story.append(Spacer(1, 6))

    story.append(Paragraph("Group map (initial — derived from the seed):", s["body"]))
    story.append(
        Paragraph(
            "WORKSPACE&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;INSPECTION, MAINTENANCE<br/>"
            "GOVERNANCE&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;QA_VALIDATION, REPORTING<br/>"
            "ASSET_DOMAIN&nbsp;&nbsp;&nbsp;SAVR, SAVT, PENCAWANG, FEEDER_PILLAR,<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;LINK_BOX, CABLE_BRIDGE, UNDERGROUND_CABLE,<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;THERMAL_INSPECTION",
            s["code"],
        )
    )

    story.append(Paragraph("Each fieldset carries a one-line caption:", s["body"]))
    story.extend(
        bullets(
            [
                "<i>Workspace Access</i> — “Lets users enter this mobile workspace.”",
                "<i>Governance &amp; Reporting</i> — “Cross-MAINHEAD authority and reporting access.”",
                "<i>Asset Domains</i> — “Asset classes this entity is authorised to operate on.”",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("Estimated effort", s["h2"]))
    effort1 = [
        [cell("<b>Task</b>"), cell("<b>Effort</b>")],
        [cell("Create <font face='Courier'>capability-groups.ts</font> helper"), cell("0.25 day")],
        [cell("Rework <font face='Courier'>CapabilityPicker</font> (enterprise)"), cell("0.5 day")],
        [cell("Rework <font face='Courier'>UserCapabilityPicker</font>"), cell("0.25 day")],
        [cell("Visual QA across 5 modal contexts"), cell("0.25 day")],
        [cell("Smoke test pilot ticking scenarios (SAVR+INSPECTION, etc.)"), cell("0.25 day")],
        [cell("<b>Total</b>"), cell("<b>~1.5 days</b>")],
    ]
    story.append(make_table(effort1, [11.0 * cm, 5.0 * cm]))
    story.append(Spacer(1, 6))

    story.append(Paragraph("Migration impact", s["h2"]))
    story.extend(
        bullets(
            [
                "<b>Schema migration:</b> none.",
                "<b>Data migration:</b> none.",
                "<b>API contract:</b> unchanged. Server keeps returning a flat <font face='Courier'>capabilities[]</font>; grouping is purely a client-side render concern.",
                "<b>Rollback:</b> revert the two picker components; no data side-effects.",
            ],
            s["bullet"],
        )
    )

    story.append(PageBreak())

    # ───────────────────────────────────────────────────────────────────────
    # ITEM 2
    # ───────────────────────────────────────────────────────────────────────
    story.append(Paragraph("Item 2 — Site Visit MAINHEAD cleanup", s["h1"]))
    story.append(
        Paragraph(
            "Remove the “Text MAINHEAD only” path from the Site Visit create form. Require a "
            "structured MAINHEAD selection. Preserve legacy text values on existing visits as "
            "read-only.",
            s["body"],
        )
    )

    story.append(Paragraph("Screens affected", s["h2"]))
    screens2 = [
        [cell("<b>Screen</b>"), cell("<b>Behaviour change</b>")],
        [cell("Site Visits — list"), cell("No behaviour change. MAINHEAD column still uses the existing <font face='Courier'>displayMainhead()</font> fallback so legacy rows continue to render.")],
        [cell("Site Visits — Create modal"), cell("Remove the “MAINHEAD Text” free-text input. Drop the dropdown’s empty <font face='Courier'>\"Text MAINHEAD only\"</font> option. MAINHEAD select becomes <b>required</b>. Submit blocked until selected.")],
        [cell("Site Visit — Detail page"), cell("Existing <font face='Courier'>mainheadRecord?.name → mainheadRecord?.code → mainhead → \"Not recorded\"</font> fallback stays. When <font face='Courier'>mainheadRecord</font> is null but <font face='Courier'>mainhead</font> (text) is set, badge it as <b>Legacy MAINHEAD</b> so the QA reader knows it’s a pre-cleanup record. No edit affordance.")],
        [cell("Mobile (Inspection workspace)"), cell("<b>Out of scope</b> for this plan — but flagged: any mobile path that creates Site Visits with <font face='Courier'>mainhead</font> text needs the same gate before this change is promoted. Confirm before rollout.")],
    ]
    story.append(make_table(screens2, [4.5 * cm, 11.5 * cm]))
    story.append(Spacer(1, 6))

    story.append(Paragraph("Files affected", s["h2"]))
    files2 = [
        [cell("<b>File</b>"), cell("<b>Change</b>")],
        [
            code_cell("apps/admin-web/src/components/site-visits-client.tsx"),
            cell("Drop the “MAINHEAD Text” <font face='Courier'>&lt;label&gt;</font> block (~lines 847–855). Replace the dropdown empty-option label <font face='Courier'>\"Text MAINHEAD only\"</font> (~line 807) with <font face='Courier'>\"Select MAINHEAD\"</font> and mark the <font face='Courier'>&lt;select&gt;</font> required. Remove <font face='Courier'>mainhead: createForm.mainhead.trim() || undefined</font> from the payload (~line 1232). Update <font face='Courier'>DEFAULT_SITE_VISIT_CREATE_FORM</font> to drop <font face='Courier'>mainhead</font>."),
        ],
        [
            code_cell("apps/admin-web/src/components/site-visit-detail-client.tsx"),
            cell("Wrap <font face='Courier'>displayMainhead()</font> (~lines 85–92) callers so the “Legacy” badge renders when <font face='Courier'>visit.mainheadRecord == null &amp;&amp; visit.mainhead</font> is present."),
        ],
        [
            code_cell("apps/api/src/site-visits/site-visits.service.ts"),
            cell("At ~line 1104 change the validator from <font face='Courier'>if (!dto.mainhead &amp;&amp; !dto.mainheadId)</font> to <font face='Courier'>if (!dto.mainheadId)</font>. Error message: <i>“MAINHEAD must be selected. The free-text MAINHEAD field is no longer accepted.”</i> Keep the <font face='Courier'>mainhead</font> column populated on read (existing rows). For new creates, the column is left null and only <font face='Courier'>mainheadId</font> is recorded."),
        ],
        [
            code_cell("apps/api/src/site-visits/dto/create-site-visit.dto.ts"),
            cell("Change <font face='Courier'>@IsOptional()</font> to <font face='Courier'>@IsNotEmpty() @IsUUID()</font> on <font face='Courier'>mainheadId</font> (~line 46). Keep <font face='Courier'>mainhead?</font> (~line 107) as <font face='Courier'>@IsOptional()</font> for backward compatibility with any in-flight mobile builds — but the server-side validator above blocks it from satisfying the create requirement on its own. After the mobile build is verified to use <font face='Courier'>mainheadId</font>, drop the <font face='Courier'>mainhead?</font> DTO field entirely (follow-up)."),
        ],
        [
            code_cell("apps/api/src/site-visits/dto/list-site-visits-query.dto.ts"),
            cell("No change. The <font face='Courier'>mainhead</font> query parameter is a search filter, not a create input; keep it for legacy row lookup."),
        ],
    ]
    story.append(make_table(files2, [7.0 * cm, 9.0 * cm]))
    story.append(Spacer(1, 6))

    story.append(Paragraph("Estimated effort", s["h2"]))
    effort2 = [
        [cell("<b>Task</b>"), cell("<b>Effort</b>")],
        [cell("Admin form changes (<font face='Courier'>site-visits-client.tsx</font>)"), cell("0.5 day")],
        [cell("Detail page Legacy badge"), cell("0.25 day")],
        [cell("API DTO + validator change"), cell("0.25 day")],
        [cell("Reconciliation report — list legacy visits with text-only MAINHEAD that didn’t auto-link"), cell("0.5 day (script, not a UI; output goes to ops)")],
        [cell("Smoke test: create new visit, view legacy visit, list filter, mobile create attempt without <font face='Courier'>mainheadId</font>"), cell("0.5 day")],
        [cell("<b>Total</b>"), cell("<b>~2 days</b>")],
    ]
    story.append(make_table(effort2, [11.0 * cm, 5.0 * cm]))
    story.append(Spacer(1, 6))

    story.append(Paragraph("Migration impact", s["h2"]))
    mig2 = [
        [cell("<b>Aspect</b>"), cell("<b>Detail</b>")],
        [cell("Schema"), cell("<b>No structural change required for pilot.</b> <font face='Courier'>SiteVisit.mainhead</font> column stays nullable; new rows leave it null. A follow-up migration to drop the column can wait until all legacy rows are reconciled.")],
        [cell("Data"), cell("Existing rows untouched. <b>One-time backfill recommended</b> but not blocking: case-insensitive match <font face='Courier'>SiteVisit.mainhead</font> text to <font face='Courier'>Mainhead.name</font> / <font face='Courier'>Mainhead.code</font>; set <font face='Courier'>mainheadId</font> when uniquely matched. Unmatched rows: leave as-is, surface in the reconciliation report for ops to fix from the detail page (requires a tiny future edit affordance — out of scope here, flag for backlog).")],
        [cell("API contract"), cell("<font face='Courier'>mainheadId</font> becomes required on <font face='Courier'>POST /site-visits</font>. <font face='Courier'>mainhead</font> body field still parsed but ignored for validation. Breaking change for any mobile build that posted text-only; <b>must confirm mobile uses <font face='Courier'>mainheadId</font> before deploy</b>.")],
        [cell("Mobile coordination"), cell("<b>Required check.</b> Verify the mobile site-visit-create payload includes <font face='Courier'>mainheadId</font>. If it doesn’t, ship the mobile fix first, then the API.")],
        [cell("Rollback"), cell("Revert the validator and DTO to <font face='Courier'>if (!dto.mainhead &amp;&amp; !dto.mainheadId)</font>. Admin form changes can be reverted independently.")],
    ]
    story.append(make_table(mig2, [3.5 * cm, 12.5 * cm]))

    story.append(PageBreak())

    # ───────────────────────────────────────────────────────────────────────
    # ITEM 3
    # ───────────────────────────────────────────────────────────────────────
    story.append(
        Paragraph("Item 3 — Effective MAINHEAD access preview on User form", s["h1"])
    )
    story.append(
        Paragraph(
            "Below the <b>MAINHEAD Access</b> and <b>Region Access</b> multi-selects, render a "
            "computed line showing the resolved set of MAINHEADs the user will actually see. "
            "Uses existing data — no new API needed.",
            s["body"],
        )
    )

    story.append(Paragraph("Screens affected", s["h2"]))
    screens3 = [
        [cell("<b>Screen</b>"), cell("<b>Behaviour change</b>")],
        [cell("Users — Create modal"), cell("New <font face='Courier'>EffectiveMainheadPreview</font> block immediately below the <font face='Courier'>Region Access</font> picker. Updates reactively as the admin toggles checkboxes.")],
        [cell("Users — Edit modal"), cell("Same. On first open, pre-populates from the user’s existing access rows.")],
        [cell("Users — list"), cell("No change.")],
        [cell("User detail (if added later)"), cell("Same component reused. Currently out of scope.")],
    ]
    story.append(make_table(screens3, [4.5 * cm, 11.5 * cm]))
    story.append(Spacer(1, 6))

    story.append(Paragraph("Resolver — client-side", s["h2"]))
    story.append(
        Paragraph(
            "Mirrors steps 1 + 2 of V10’s MAINHEAD Visibility Algorithm:",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "direct&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= picked mainheadIds<br/>"
            "viaRegion&nbsp;&nbsp;= MAINHEADs whose operationalRegionId ∈ picked regionIds<br/>"
            "effective&nbsp;&nbsp;= direct ∪ viaRegion&nbsp;&nbsp;(deduped, sorted by name)",
            s["code"],
        )
    )
    story.append(
        Paragraph(
            "Render as: <font face='Courier'>“Effective MAINHEAD access: KL Timur, KL Barat, "
            "Subang (via Region: Klang Valley) + Bentong (direct)”</font>. Empty state: "
            "<font face='Courier'>“No MAINHEAD access — user will not see any visits.”</font>",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "Why client-side: the <font face='Courier'>mainheads</font> list returned by "
            "<font face='Courier'>/enterprise/options</font> already includes "
            "<font face='Courier'>operationalRegionId</font> (confirmed in "
            "<font face='Courier'>apps/api/src/enterprise/enterprise.service.ts:393</font>), so "
            "the admin form has every input it needs. Doing it server-side would require a new "
            "<font face='Courier'>GET /users/:id/mainheads?simulated=...</font> endpoint — "
            "unnecessary churn for the pilot.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "Steps 3–7 of the visibility algorithm (team/branch inheritance, legacy "
            "<font face='Courier'>user.mainheadId</font>, ADMIN override, QA override) are "
            "deliberately <b>not</b> shown in the preview:",
            s["body"],
        )
    )
    story.extend(
        bullets(
            [
                "Team/branch inheritance is fragile and changes as memberships shift — would mislead at the moment of edit.",
                "ADMIN/QA overrides are blanket; surfacing them would just say “sees everything” for those roles. Show role-based banner instead: <font face='Courier'>“Role: ADMIN — sees all MAINHEADs (override).”</font>",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("Files affected", s["h2"]))
    files3 = [
        [cell("<b>File</b>"), cell("<b>Change</b>")],
        [
            code_cell("apps/admin-web/src/components/users-client.tsx"),
            cell("Add <font face='Courier'>EffectiveMainheadPreview</font> component (small, ~50 LOC). Render it inside <font face='Courier'>UserFormModal</font> after the <font face='Courier'>UserAccessPicker</font> for Region Access (~line 486). Subscribes to <font face='Courier'>values.mainheadAccessIds</font>, <font face='Courier'>values.operationalRegionAccessIds</font>, <font face='Courier'>values.role</font>, and the loaded <font face='Courier'>enterpriseOptions.mainheads</font> + <font face='Courier'>enterpriseOptions.operationalRegions</font>."),
        ],
        [
            code_cell("apps/admin-web/src/lib/mainhead-resolver.ts <i>(new)</i>"),
            cell("Pure helper: <font face='Courier'>resolveEffectiveMainheads({ direct, regionIds, mainheads }) → { direct: Mainhead[], viaRegion: Map&lt;RegionId, Mainhead[]&gt; }</font>. Reused later if we ever surface the same preview on the User detail page or team form."),
        ],
    ]
    story.append(make_table(files3, [7.0 * cm, 9.0 * cm]))
    story.append(Spacer(1, 6))
    story.append(Paragraph("No API change. No type change. No new endpoint.", s["body"]))

    story.append(Paragraph("Estimated effort", s["h2"]))
    effort3 = [
        [cell("<b>Task</b>"), cell("<b>Effort</b>")],
        [cell("<font face='Courier'>mainhead-resolver.ts</font> helper + unit thinking"), cell("0.25 day")],
        [cell("<font face='Courier'>EffectiveMainheadPreview</font> component + role-override banner"), cell("0.5 day")],
        [cell("Wire into <font face='Courier'>UserFormModal</font> (Create + Edit)"), cell("0.25 day")],
        [cell("Visual QA: empty, direct-only, region-only, mixed, ADMIN, QA-like role"), cell("0.25 day")],
        [cell("<b>Total</b>"), cell("<b>~1.25 days</b>")],
    ]
    story.append(make_table(effort3, [11.0 * cm, 5.0 * cm]))
    story.append(Spacer(1, 6))

    story.append(Paragraph("Migration impact", s["h2"]))
    story.extend(
        bullets(
            [
                "<b>Schema migration:</b> none.",
                "<b>Data migration:</b> none.",
                "<b>API contract:</b> unchanged.",
                "<b>Server load:</b> zero — fully client-side.",
                "<b>Rollback:</b> remove the component import; no data side-effects.",
            ],
            s["bullet"],
        )
    )

    story.append(PageBreak())

    # ───────────────────────────────────────────────────────────────────────
    # COMBINED EFFORT
    # ───────────────────────────────────────────────────────────────────────
    story.append(Paragraph("Combined effort", s["h1"]))
    combined = [
        [cell("<b>Item</b>"), cell("<b>Effort</b>")],
        [cell("1. Capability picker grouping"), cell("1.5 days")],
        [cell("2. Site Visit MAINHEAD cleanup"), cell("2.0 days")],
        [cell("3. Effective MAINHEAD access preview"), cell("1.25 days")],
        [cell("Cross-cutting smoke pass + brief admin doc note"), cell("0.75 day")],
        [cell("<b>Total</b>"), cell("<b>~5.5 days</b>")],
    ]
    story.append(make_table(combined, [11.0 * cm, 5.0 * cm]))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Single engineer. No external dependencies beyond mobile confirmation for Item 2.",
            s["body"],
        )
    )

    # ───────────────────────────────────────────────────────────────────────
    # ROLLOUT ORDER
    # ───────────────────────────────────────────────────────────────────────
    story.append(Paragraph("Rollout order", s["h1"]))
    story.append(
        Paragraph(
            "The order is chosen so each step de-risks the next, with the lowest-blast-radius "
            "change first and the only step that touches the API last.",
            s["body"],
        )
    )

    rollout = [
        [cell("<b>Step</b>"), cell("<b>What ships</b>"), cell("<b>Risk</b>"), cell("<b>Why this order</b>")],
        [
            cell("<b>1.</b> Item 1 — Capability picker grouping"),
            cell("Admin web only. Two component files + one helper."),
            cell("Effectively zero. Pure visual reshuffle."),
            cell("Lands the smallest, most reversible change first. Pilot admins immediately benefit when setting up users. Surfaces no API or data concerns, so it can ship to production behind any normal review."),
        ],
        [
            cell("<b>2.</b> Item 3 — Effective MAINHEAD access preview"),
            cell("Admin web only. One new helper + one new sub-component in the user form."),
            cell("Very low. Client-side computation over already-loaded data."),
            cell("Independent of Item 2’s API change. Improves the user-setup workflow that the pilot will hammer on. Doing it before Item 2 means pilot ops staff have a self-service way to spot misconfigured access during onboarding."),
        ],
        [
            cell("<b>3.</b> Item 2 — Site Visit MAINHEAD cleanup"),
            cell("Admin web + API. Requires mobile compatibility check."),
            cell("Medium. Breaks any client that posts text-only MAINHEAD."),
            cell("Ships last because it is the only step that (a) changes server validation and (b) requires mobile coordination. Order of sub-deploy: (i) mobile confirms it sends <font face='Courier'>mainheadId</font>, (ii) deploy API validator change to staging, (iii) deploy admin form change, (iv) run reconciliation script in read-only mode, (v) promote to production. Roll-forward: if the reconciliation report shows &gt;N unresolved legacy text MAINHEADs (operationally chosen threshold), pause and run a manual reconcile session before unblocking new creates."),
        ],
    ]
    story.append(make_table(rollout, [3.5 * cm, 3.5 * cm, 3.0 * cm, 6.0 * cm]))
    story.append(Spacer(1, 8))

    story.append(Paragraph("Per-step exit criteria", s["h2"]))
    story.extend(
        bullets(
            [
                "<b>After Step 1:</b> All five capability-picker contexts render in three groups. No console errors. Existing capability assignments load and save unchanged.",
                "<b>After Step 2:</b> Editing a user with mixed direct + region access shows the correct effective list and matches what <font face='Courier'>GET /users/me/mainheads</font> returns when that user logs in (manual cross-check).",
                "<b>After Step 3:</b> New site visits cannot be created without <font face='Courier'>mainheadId</font>. Legacy visits still display their text MAINHEAD with the Legacy badge. Reconciliation report exists and lists every site visit with <font face='Courier'>mainhead</font> text but null <font face='Courier'>mainheadId</font>. Mobile create flow verified end-to-end against staging.",
            ],
            s["bullet"],
        )
    )

    # ───────────────────────────────────────────────────────────────────────
    # OUT OF SCOPE
    # ───────────────────────────────────────────────────────────────────────
    story.append(
        Paragraph("Out of scope (logged for backlog, not in this plan)", s["h1"])
    )
    story.extend(
        bullets(
            [
                "Adding a <font face='Courier'>Capability.kind</font> enum column (item B in the prior assessment).",
                "Replacing the Organization <font face='Courier'>type</font> placeholder enum with the Blueprint vocabulary.",
                "Adding QA persona roles (<font face='Courier'>QA_SUPERVISOR</font>, <font face='Courier'>QA_INSPECTOR</font>).",
                "Marking MAINHEAD’s “Legacy Branch” block read-only.",
                "Dropping the silent <font face='Courier'>user.mainheadId</font> mirror.",
                "Dropping the <font face='Courier'>SiteVisit.mainhead</font> column entirely (do after all legacy rows reconciled).",
                "Adding a <font face='Courier'>GET /users/:id/mainheads</font> admin endpoint (only if we later want server-side preview parity).",
                "Editing MAINHEAD on existing site visits from the admin detail page (needed to fully resolve unmatched legacy rows).",
            ],
            s["bullet"],
        )
    )
    story.append(
        Paragraph(
            "These can be sequenced after the pilot stabilises. None of them block Items 1–3.",
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
        title="ASCURE Pilot UX Cleanup Plan",
        author="ASCURE",
    )
    doc.build(build_story(s), onFirstPage=header_footer, onLaterPages=header_footer)
    print(f"Written: {OUTPUT}")


if __name__ == "__main__":
    main()
