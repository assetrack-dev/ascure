"""Generate the Production Data Visibility Path Audit PDF."""

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


OUTPUT = r"C:\ASCURE\docs\production-data-visibility-path-audit.pdf"


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
    callout_ok = ParagraphStyle(
        "CalloutOk", parent=body, fontName="Helvetica-Bold",
        fontSize=11, leading=15, textColor=colors.HexColor("#065F46"),
        backColor=colors.HexColor("#ECFDF5"),
        borderColor=colors.HexColor("#10B981"),
        borderWidth=0.6, borderPadding=10,
        spaceAfter=10,
    )
    return {
        "title": title, "subtitle": subtitle, "h1": h1, "h2": h2,
        "body": body, "bullet": bullet, "code": code,
        "callout_warn": callout_warn, "callout_ok": callout_ok,
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
        "ASCURE — Production Data Visibility Path Audit",
    )
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Page {doc.page}")
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, 1.5 * cm, A4[0] - 2 * cm, 1.5 * cm)
    canvas.restoreState()


def build_story(s):
    story = []

    story.append(
        Paragraph("Production Data Visibility Path Audit", s["title"])
    )
    story.append(
        Paragraph(
            "End-to-end trace of every filter the data passes through, from mobile "
            "<font face='Courier'>POST /site-visits</font> through mobile completion to the "
            "three admin read-paths (Site Visits list, Dashboard, Operations Board). For each "
            "endpoint: Prisma where clause, status filter, validationStatus filter, MAINHEAD "
            "filter, team filter, tenant filter. All findings are source-only; no app code or DB "
            "modified.",
            s["subtitle"],
        )
    )

    # Headline
    story.append(
        Paragraph(
            "HEADLINE — No read-side filter excludes mobile-created SiteVisits. Every "
            "ADMIN-mode read path is scoped only by <font face='Courier'>tenantId</font>; status "
            "and validationStatus filters are no-ops when the admin web does not send them. The "
            "“Assets visible, Site Visits / Dashboard / Operations Board empty” pattern cannot be "
            "produced by a read-side filter. It can only be produced by (a) no SiteVisit row ever "
            "being persisted on production, or (b) tenant mismatch between admin and the row’s "
            "<font face='Courier'>tenantId</font>. The write path has the only filters that can "
            "drop a mobile create call — most notably the post-G2 "
            "<font face='Courier'>@IsUUID() mainheadId!</font> DTO requirement and the team-"
            "membership check.",
            s["callout_warn"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # 1. Mobile Site Visit creation
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("1. Mobile Site Visit creation — POST /site-visits", s["h1"]))
    story.append(
        Paragraph(
            "Server: <font face='Courier'>SiteVisitsService.create</font> "
            "(<font face='Courier'>apps/api/src/site-visits/site-visits.service.ts:375–496</font>). "
            "Mobile call site: <font face='Courier'>apps/mobile/src/api.ts:351–381</font>; "
            "payload assembled at <font face='Courier'>CheckInScreen.tsx:551–564</font>.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "Write filters (validation gates before <font face='Courier'>prisma.siteVisit.create</font>):",
            s["body"],
        )
    )
    f1 = [
        [cell("<b>Filter</b>"), cell("<b>Location</b>"), cell("<b>Behaviour</b>")],
        [
            cell("Tenant"),
            code_cell("site-visits.service.ts:436"),
            cell("Row written with <font face='Courier'>tenantId: user.tenantId</font>. The mobile user’s tenant becomes the SiteVisit’s tenant. Cross-tenant access by admin is impossible without a matching tenant on the admin side."),
        ],
        [
            cell("Team existence"),
            code_cell("site-visits.service.ts:378–391"),
            cell("<font face='Courier'>NotFound</font> if <font face='Courier'>dto.teamId</font> is not an active team within the user’s tenant."),
        ],
        [
            cell("Team membership (non-admin)"),
            code_cell("site-visits.service.ts:393–411"),
            cell("Non-ADMIN users must be active members of the team. Otherwise <font face='Courier'>Forbidden</font>. Mobile pilot users are typically TECHNICIAN — must be team-bound."),
        ],
        [
            cell("MAINHEAD — DTO (G2)"),
            code_cell("create-site-visit.dto.ts:45–46"),
            cell("<b>Post-G2 strict requirement:</b> <font face='Courier'>@IsUUID() mainheadId!: string</font>. Missing or non-UUID → 400. Pre-G1 visits in DB will have <font face='Courier'>mainheadId=null</font>; new pilot creates can no longer save without it."),
        ],
        [
            cell("MAINHEAD — service (G1)"),
            code_cell("site-visits.service.ts:1104"),
            cell("New-pencawang check-in: <font face='Courier'>if (!dto.mainheadId) push missing</font>. The DTO already gates this; this is defense-in-depth."),
        ],
        [
            cell("GPS / pencawang"),
            code_cell("site-visits.service.ts:1100–1121"),
            cell("New-pencawang flow requires Kod / Nama / FunctionalLocation / GPS coordinates / GPS accuracy. Missing fields → 400."),
        ],
        [
            cell("Substation conflict"),
            code_cell("site-visits.service.ts:486–495"),
            cell("Prisma P2002 → 409 “Pencawang with this code already exists.”"),
        ],
    ]
    story.append(make_table(f1, [3.7 * cm, 4.0 * cm, 8.3 * cm]))
    story.append(Spacer(1, 4))

    story.append(Paragraph("Row written (success case):", s["h2"]))
    story.append(
        Paragraph(
            "status&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= normalizeCreateStatus(dto.status) → "
            "<b>ACTIVE</b> by default<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(only OPEN or IN_PROGRESS overrides; mobile never sets it)<br/>"
            "validationStatus = <b>PENDING</b><br/>"
            "completedAt&nbsp;&nbsp;&nbsp;&nbsp;= <b>null</b>&nbsp;&nbsp;(not set at create-time)<br/>"
            "mainheadId&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= dto.mainheadId&nbsp;&nbsp;(G2-required)<br/>"
            "tenantId&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= user.tenantId&nbsp;&nbsp;(mobile user's tenant)<br/>"
            "teamId&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= dto.teamId",
            s["code"],
        )
    )

    story.append(PageBreak())

    # ─────────────────────────────────────────────────────────────
    # 2. Mobile Visit Completion
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("2. Mobile Visit Completion — POST /site-visits/:id/complete", s["h1"]))
    story.append(
        Paragraph(
            "Server: <font face='Courier'>SiteVisitsService.complete</font> "
            "(<font face='Courier'>site-visits.service.ts:716–747</font>).",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "Pre-update filters:",
            s["body"],
        )
    )
    f2 = [
        [cell("<b>Filter</b>"), cell("<b>Location</b>"), cell("<b>Behaviour</b>")],
        [
            cell("Mutate authority"),
            code_cell("site-visits.service.ts:717"),
            cell("ADMIN / MANAGER / SUPERVISOR / TECHNICIAN allowed. VIEWER / CLIENT blocked."),
        ],
        [
            cell("Accessibility"),
            code_cell("findAccessibleSiteVisit (~line 1124)"),
            cell("Same as list <font face='Courier'>accessScope</font>: tenant + (for non-admin) active team membership."),
        ],
        [
            cell("Mutable status"),
            code_cell("assertVisitIsMutable"),
            cell("Throws if visit is in a terminal status (COMPLETED, CANCELLED)."),
        ],
        [
            cell("Asset rollup"),
            code_cell("validateCompletion + materializeImplicitVisitAssetLinks"),
            cell("Synchronises asset linkage and checks the completion rules (assets present, no pending inspections)."),
        ],
    ]
    story.append(make_table(f2, [3.7 * cm, 4.5 * cm, 7.8 * cm]))

    story.append(Paragraph("Row updated on success:", s["h2"]))
    story.append(
        Paragraph(
            "status&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= <b>COMPLETED</b><br/>"
            "completedAt&nbsp;&nbsp;&nbsp;&nbsp;= dto.completedAt ?? new Date()<br/>"
            "endedAt&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= same as completedAt<br/>"
            "validationStatus = <b>PENDING</b>&nbsp;&nbsp;(reset on completion — visit re-enters QA queue)<br/>"
            "completionNotes&nbsp;= dto.completionNotes (if supplied)",
            s["code"],
        )
    )
    story.append(
        Paragraph(
            "Note: completion does NOT delete the row, does NOT change tenant or team, and does "
            "NOT change MAINHEAD. The only fields touched are status, "
            "<font face='Courier'>completedAt</font>, <font face='Courier'>endedAt</font>, "
            "<font face='Courier'>validationStatus</font>, and optional notes.",
            s["body"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # 3. Site Visits list endpoint
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("3. Site Visits list — GET /site-visits", s["h1"]))
    story.append(
        Paragraph(
            "Server: <font face='Courier'>SiteVisitsService.list</font> "
            "(<font face='Courier'>site-visits.service.ts:498–523</font>), "
            "<font face='Courier'>buildListWhere</font> at lines 1812–1839, "
            "<font face='Courier'>accessScope</font> at lines 2136–2151. Admin web call: "
            "<font face='Courier'>apps/admin-web/src/lib/site-visits.ts:497</font> — "
            "<font face='Courier'>GET /site-visits</font> with NO query parameters.",
            s["body"],
        )
    )
    f3 = [
        [cell("<b>Filter</b>"), cell("<b>Behaviour given the admin call</b>")],
        [
            cell("<b>Tenant</b>"),
            cell("Always applied: <font face='Courier'>tenantId: user.tenantId</font>. ADMIN sees only their own tenant’s rows."),
        ],
        [
            cell("<b>Access scope</b>"),
            cell("ADMIN: <font face='Courier'>{}</font> (no extra filter). Non-ADMIN: <font face='Courier'>team.members.some.userId = user.id AND isActive=true</font>."),
        ],
        [
            cell("<b>Status</b>"),
            cell("Admin web sends no <font face='Courier'>status</font> query param → <font face='Courier'>{}</font>. All statuses returned (ACTIVE, OPEN, IN_PROGRESS, COMPLETED, CANCELLED). When <font face='Courier'>status=ACTIVE</font> IS provided (mobile uses this), it expands to <font face='Courier'>status IN [ACTIVE, OPEN, IN_PROGRESS]</font>."),
        ],
        [
            cell("<b>ValidationStatus</b>"),
            cell("Admin web sends none → <font face='Courier'>{}</font>. All validation statuses returned including PENDING."),
        ],
        [
            cell("<b>MAINHEAD</b>"),
            cell("Optional <font face='Courier'>mainhead</font> query param (text search on legacy text column). Admin web does not send it for the list page. → <font face='Courier'>{}</font>"),
        ],
        [
            cell("<b>Team</b>"),
            cell("Optional <font face='Courier'>teamId</font> query param. Admin web does not send it. → <font face='Courier'>{}</font>"),
        ],
        [
            cell("Other optional filters"),
            cell("<font face='Courier'>visitType, operationalDomain, operationMode, operationalScope, sessionKind, userId, pencawang, dateFrom, dateTo, search</font> — all skipped when not provided."),
        ],
    ]
    story.append(make_table(f3, [3.5 * cm, 12.5 * cm]))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Effective ADMIN query: <font face='Courier'>WHERE tenantId = adminTenantId</font>. "
            "Nothing else. <b>If admin sees zero visits, the row count for the admin’s tenant is "
            "zero.</b>",
            s["body"],
        )
    )

    story.append(PageBreak())

    # ─────────────────────────────────────────────────────────────
    # 4. Dashboard endpoint
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("4. Dashboard — GET /dashboard", s["h1"]))
    story.append(
        Paragraph(
            "Server: <font face='Courier'>DashboardService.getDashboard</font> "
            "(<font face='Courier'>apps/api/src/dashboard/dashboard.service.ts:35–</font>). "
            "Builds N parallel queries against SiteVisit, Asset, Inspection, Defect.",
            s["body"],
        )
    )
    f4 = [
        [cell("<b>Sub-query</b>"), cell("<b>Where</b>")],
        [
            cell("Asset count"),
            cell("<font face='Courier'>accessibleAssetWhere = { tenantId: user.tenantId }</font>. <b>No team scope.</b> ADMIN, QA Manager, and TECHNICIAN all see the same asset count for their tenant. This is why assets appear when nothing else does."),
        ],
        [
            cell("Inspection count"),
            cell("<font face='Courier'>{ tenantId, …inspectionAccessScope }</font>. <font face='Courier'>inspectionAccessScope</font> = <font face='Courier'>{}</font> for ADMIN; <font face='Courier'>{ siteVisit: { team: { members: { some: { userId, isActive } } } } }</font> for non-ADMIN."),
        ],
        [
            cell("Defect groupBy status / severity"),
            cell("<font face='Courier'>accessibleDefectWhere = { inspectionItemResult: { isDefect: true, inspection: accessibleInspectionWhere } }</font>. Inherits tenant + non-admin team scope."),
        ],
        [
            cell("Active visit count"),
            cell("<font face='Courier'>{ tenantId, …siteVisitAccessScope, status: { in: [ACTIVE, OPEN, IN_PROGRESS] } }</font>."),
        ],
        [
            cell("Completed visit count"),
            cell("<font face='Courier'>{ tenantId, …siteVisitAccessScope, status: COMPLETED }</font>."),
        ],
        [
            cell("SiteVisit groupBy status / validationStatus / visitType"),
            cell("Same base where: <font face='Courier'>accessibleSiteVisitWhere = { tenantId, …siteVisitAccessScope }</font>. No status pre-filter on the groupBy."),
        ],
        [
            cell("Defect overdue / SLA queries"),
            cell("Inherit <font face='Courier'>accessibleDefectWhere</font> + add <font face='Courier'>status: { in: ACTIVE_SLA_STATUSES }</font> and <font face='Courier'>dueDate &lt; now</font>."),
        ],
    ]
    story.append(make_table(f4, [4.5 * cm, 11.5 * cm]))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "For ADMIN: every SiteVisit-related count is scoped by tenantId only. If admin sees 0 "
            "across all those counts but a positive Asset count, that is fully consistent with "
            "Assets existing on the tenant but no SiteVisit rows existing on the same tenant.",
            s["body"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # 5. Operations Board endpoint
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("5. Operations Board — GET /defects/operations-board", s["h1"]))
    story.append(
        Paragraph(
            "Server: <font face='Courier'>DefectsService.getOperationsBoard</font> "
            "(<font face='Courier'>defects.service.ts:563–</font>); "
            "<font face='Courier'>buildOperationsBoardWhere</font> at lines 1743–1772; "
            "<font face='Courier'>inspectionAccessScope</font> at lines 3144–3161.",
            s["body"],
        )
    )
    f5 = [
        [cell("<b>Filter</b>"), cell("<b>Behaviour</b>")],
        [
            cell("Defect → defectiveness"),
            cell("Always: <font face='Courier'>inspectionItemResult.isDefect = true</font>. Only inspection results flagged as defects appear."),
        ],
        [
            cell("Tenant"),
            cell("Always: <font face='Courier'>inspection.tenantId = user.tenantId</font>."),
        ],
        [
            cell("Access scope"),
            cell("ADMIN: <font face='Courier'>{}</font>. Non-ADMIN: <font face='Courier'>inspection.siteVisit.team.members.some.userId = user.id</font>. <b>This is the QA Manager wall</b> — QA Managers (role=MANAGER) are not team members, so they see zero."),
        ],
        [
            cell("Status"),
            cell("Optional <font face='Courier'>status</font> query → no filter when not provided."),
        ],
        [
            cell("ValidationStatus"),
            cell("Not a defect-side filter. Visit-level validationStatus is not consulted by the Operations Board."),
        ],
        [
            cell("MAINHEAD"),
            cell("Optional <font face='Courier'>mainhead</font> query param. Admin web does not pre-set it. → <font face='Courier'>{}</font>"),
        ],
        [
            cell("Team"),
            cell("No direct team filter from query — the non-ADMIN team-membership requirement is the only team gate. → <font face='Courier'>{}</font>"),
        ],
    ]
    story.append(make_table(f5, [4.0 * cm, 12.0 * cm]))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Operations Board emptiness for ADMIN means there are no defects whose inspection is "
            "in admin’s tenant. Defects only exist if an inspection has been submitted AND an "
            "inspection item was flagged as defective. Zero visits → zero inspections → zero "
            "defects → empty Operations Board (always).",
            s["body"],
        )
    )

    story.append(PageBreak())

    # ─────────────────────────────────────────────────────────────
    # Specific cross-check
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("6. Specific verifications", s["h1"]))

    story.append(Paragraph("6.1 ACTIVE vs OPEN / IN_PROGRESS / COMPLETED compatibility", s["h2"]))
    story.extend(
        bullets(
            [
                "Mobile create writes <font face='Courier'>status=ACTIVE</font> by default. "
                "Mobile completion writes <font face='Courier'>status=COMPLETED</font>. The "
                "ACTIVE_SITE_VISIT_STATUSES helper "
                "(<font face='Courier'>site-visits.service.ts:44–48</font>) treats "
                "<font face='Courier'>{ ACTIVE, OPEN, IN_PROGRESS }</font> as interchangeable "
                "“active” — so an ACTIVE row IS counted by Dashboard’s “active visit count” and "
                "is returned by the list when <font face='Courier'>?status=ACTIVE</font> is "
                "queried.",
                "The admin web Site Visits page does not send any status filter, so all statuses "
                "are returned. A completed ACTIVE-flow visit will still appear (with "
                "<font face='Courier'>status=COMPLETED</font>) after Complete Visit.",
                "<b>No compatibility gap. The ACTIVE / OPEN / IN_PROGRESS family is handled "
                "uniformly by every read path on the admin side.</b>",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("6.2 validationStatus=PENDING visibility", s["h2"]))
    story.extend(
        bullets(
            [
                "<font face='Courier'>PENDING</font> is the create-time default and the post-"
                "completion default. Mobile flow always produces PENDING rows.",
                "Admin web list does not filter by validationStatus by default. PENDING rows are "
                "returned. The list page allows the admin to optionally filter by validation "
                "status, but no such filter is applied at page load.",
                "Dashboard counts PENDING rows in <font face='Courier'>siteVisitValidationCounts</font> "
                "and in all visit totals. PENDING is not excluded.",
                "<b>No PENDING visibility gap on the admin read side.</b>",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("6.3 completedAt requirements", s["h2"]))
    story.extend(
        bullets(
            [
                "Mobile-created (un-completed) visits have <font face='Courier'>completedAt=null</font>. "
                "Admin web list returns them; Dashboard counts them as active.",
                "After mobile completion, <font face='Courier'>completedAt</font> is set to the "
                "supplied or current timestamp. Visit moves to <font face='Courier'>status=COMPLETED</font> "
                "and is counted in “Completed visit count”.",
                "<b>No completedAt-based exclusion anywhere</b>. The dashboard does NOT require "
                "<font face='Courier'>completedAt IS NOT NULL</font>.",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("6.4 MAINHEAD requirements after G1 / G2", s["h2"]))
    story.extend(
        bullets(
            [
                "G2 hardened the CREATE side: <font face='Courier'>create-site-visit.dto.ts:46</font> "
                "now declares <font face='Courier'>mainheadId!: string</font> with "
                "<font face='Courier'>@IsUUID()</font> only — <font face='Courier'>@IsOptional()</font> "
                "removed. A POST that omits or mistypes <font face='Courier'>mainheadId</font> is "
                "rejected with 400.",
                "G2 did NOT add any MAINHEAD filter to the READ side. Site Visits list, Dashboard, "
                "Operations Board all leave <font face='Courier'>mainheadId</font> unconstrained "
                "unless the admin explicitly filters.",
                "Pre-G1 visits already in the DB with <font face='Courier'>mainheadId=null</font> "
                "remain visible — the legacy text column "
                "<font face='Courier'>SiteVisit.mainhead</font> is still rendered by the detail "
                "page with a “Legacy MAINHEAD” badge per the Site Visit cleanup.",
                "<b>MAINHEAD does not exclude rows from any admin read path.</b> The only "
                "MAINHEAD gate in the data path is at create-time, which can prevent rows from "
                "existing in the first place.",
            ],
            s["bullet"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # 7. Conclusions
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("7. Are mobile-created SiteVisits excluded by any filter?", s["h1"]))
    story.append(
        Paragraph(
            "<b>READ side: no.</b> For ADMIN, every read path is <font face='Courier'>tenantId</font>-"
            "only. For non-ADMIN (including QA Manager), the team-membership scope drops every "
            "visit the user is not in — but this is an access decision, not a row-level "
            "exclusion of the data itself.",
            s["callout_ok"],
        )
    )
    story.append(
        Paragraph(
            "<b>WRITE side: yes, several gates can prevent rows from being written at all.</b> "
            "In order of post-pilot likelihood:",
            s["callout_warn"],
        )
    )
    write_gates = [
        [cell("<b>Gate</b>"), cell("<b>Resulting symptom on admin</b>")],
        [
            cell("G2 <font face='Courier'>@IsUUID() mainheadId!</font> on the create DTO — mobile must send a valid MAINHEAD UUID."),
            cell("If mobile’s MAINHEAD list is empty for the pilot user (no MAINHEAD access), the dropdown is empty and submission fails 400. No SiteVisit row → admin sees 0 visits."),
        ],
        [
            cell("Non-ADMIN team-membership check at create time."),
            cell("If pilot user is not in the team they selected, the create call throws Forbidden. No SiteVisit row → admin sees 0 visits."),
        ],
        [
            cell("New-pencawang GPS / Kod / Nama requirements."),
            cell("Missing field → 400. No SiteVisit row."),
        ],
        [
            cell("Tenant-binding to mobile user."),
            cell("Row is written with <font face='Courier'>tenantId = mobile.user.tenantId</font>. If the admin user is in a different tenant, the row exists but is invisible to the admin. Probe 1 in the 8-point pilot-state report distinguishes this."),
        ],
    ]
    story.append(make_table(write_gates, [7.5 * cm, 8.5 * cm]))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "All of these produce the observed pattern (Assets visible because assets attach to "
            "Substations independent of visits; Site Visits empty because no row was persisted "
            "in admin’s tenant; Dashboard and Operations Board empty as downstream effects).",
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
        title="ASCURE Production Data Visibility Path Audit",
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
