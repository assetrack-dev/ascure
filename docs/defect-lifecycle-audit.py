"""Generate the Defect Lifecycle Audit PDF."""

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


OUTPUT = r"C:\ASCURE\docs\defect-lifecycle-audit.pdf"


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
        "ASCURE — Defect Lifecycle Audit (Inspection → ItemResult → Defect)",
    )
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Page {doc.page}")
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, 1.5 * cm, A4[0] - 2 * cm, 1.5 * cm)
    canvas.restoreState()


def build_story(s):
    story = []

    story.append(Paragraph("ASCURE Defect Lifecycle Audit", s["title"]))
    story.append(
        Paragraph(
            "Inspection submission → "
            "<font face='Courier'>InspectionItemResult.isDefect=true</font> → "
            "<font face='Courier'>Defect</font> creation. Two creation pathways coexist: eager "
            "at submission time, and lazy on Dashboard / Operations Board reads. This audit "
            "establishes which one is canonical, why the other exists, and what governance "
            "consequences follow. Assessment only — no code changes.",
            s["subtitle"],
        )
    )

    story.append(
        Paragraph(
            "HEADLINE — There are TWO mechanisms that create "
            "<font face='Courier'>Defect</font> rows: an EAGER transactional path at inspection "
            "submission (<font face='Courier'>InspectionsService.submit</font>, added "
            "2026-05-13), and a LAZY backfill path "
            "(<font face='Courier'>ensureDefectsForAccessibleItems</font>, added 2026-04-28 when "
            "the <font face='Courier'>Defect</font> table was first introduced). The lazy path "
            "was originally a transition aid; it is now a backstop for legacy "
            "<font face='Courier'>InspectionItemResult.isDefect=true</font> rows that pre-date "
            "the eager path. Because the lazy backstop is scoped to the CURRENT VIEWER, "
            "non-ADMIN users (incl. QA Manager) never materialise legacy items they can’t see, "
            "and the Operations Board can stay empty even when flagged inspection results exist.",
            s["callout_warn"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # Lifecycle trace
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("1. End-to-end lifecycle trace", s["h1"]))

    story.append(Paragraph("1.1 Inspection submission — the EAGER path", s["h2"]))
    story.append(
        Paragraph(
            "<font face='Courier'>InspectionsService.submit</font> "
            "(<font face='Courier'>apps/api/src/inspections/inspections.service.ts:~440–488</font>) "
            "performs the transition <font face='Courier'>completionStatus → SUBMITTED</font> in a "
            "Prisma transaction that <b>also</b> creates one <font face='Courier'>Defect</font> "
            "row per <font face='Courier'>InspectionItemResult</font> with "
            "<font face='Courier'>isDefect=true</font>:",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "const defectCreateData = this.buildDefectCreateData(inspection.itemResults);<br/>"
            "const submitInspection = this.prisma.inspection.update({ ... SUBMITTED ... });<br/>"
            "if (defectCreateData.length === 0) return submitInspection;<br/>"
            "const [submittedInspection] = await this.prisma.$transaction([<br/>"
            "&nbsp;&nbsp;submitInspection,<br/>"
            "&nbsp;&nbsp;this.prisma.defect.createMany({ data: defectCreateData, skipDuplicates: true }),<br/>"
            "]);",
            s["code"],
        )
    )
    story.append(
        Paragraph(
            "Source helper: <font face='Courier'>buildDefectCreateData</font> "
            "(<font face='Courier'>inspections.service.ts:~1417–1437</font>) maps every flagged "
            "result to a new <font face='Courier'>Defect</font> with "
            "<font face='Courier'>status=OPEN</font>, "
            "<font face='Courier'>severity=item.severity ?? MEDIUM</font>, "
            "<font face='Courier'>lifecycleStatus=DETECTED</font>. The schema enforces "
            "<font face='Courier'>Defect.inspectionItemResultId @unique</font> "
            "(<font face='Courier'>schema.prisma:1203</font>), so <font face='Courier'>skipDuplicates</font> "
            "guarantees idempotency.",
            s["body"],
        )
    )

    story.append(Paragraph("1.2 Lazy backstop — the BACKFILL path", s["h2"]))
    story.append(
        Paragraph(
            "Two near-duplicate implementations of "
            "<font face='Courier'>ensureDefectsForAccessibleItems</font> exist:",
            s["body"],
        )
    )
    paths = [
        [cell("<b>Location</b>"), cell("<b>Filter on InspectionItemResult</b>"), cell("<b>Access scope applied</b>")],
        [
            code_cell("dashboard.service.ts:560–589"),
            cell("<font face='Courier'>isDefect=true AND defect IS NULL AND inspection MATCHES accessible scope</font>"),
            cell("<font face='Courier'>accessibleInspectionWhere</font> = tenant + (non-ADMIN) team membership"),
        ],
        [
            code_cell("defects.service.ts:1426–1459"),
            cell("<font face='Courier'>isDefect=true AND inspection MATCHES accessible scope</font>. Relies on <font face='Courier'>createMany({skipDuplicates:true})</font> to skip already-materialised rows."),
            cell("<font face='Courier'>inspectionAccessScope</font> = tenant + (non-ADMIN) team membership (via siteVisit.team)"),
        ],
    ]
    story.append(make_table(paths, [4.0 * cm, 7.0 * cm, 5.0 * cm]))
    story.append(Spacer(1, 4))

    story.append(Paragraph("1.3 Call sites of the lazy backstop", s["h2"]))
    sites = [
        [cell("<b>Endpoint</b>"), cell("<b>Code path</b>")],
        [cell("GET /dashboard"), code_cell("dashboard.service.ts:36 — at top of getDashboard")],
        [cell("GET /defects (list)"), code_cell("defects.service.ts:435 — at top of list()")],
        [cell("GET /defects/operations-board"), code_cell("defects.service.ts:567 — at top of getOperationsBoard")],
    ]
    story.append(make_table(sites, [6.0 * cm, 10.0 * cm]))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "<font face='Courier'>InspectionsService.submit</font> never calls the lazy backstop "
            "— it creates the row eagerly in the same transaction. The Site Visits list "
            "(<font face='Courier'>SiteVisitsService.getRollups</font>) also never calls the lazy "
            "backstop and reads from <font face='Courier'>InspectionItemResult</font> directly.",
            s["body"],
        )
    )

    story.append(PageBreak())

    # ─────────────────────────────────────────────────────────────
    # 2. Why lazy? Was it intentional?
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("2. Why lazy? Was the behaviour intentional?", s["h1"]))
    story.append(
        Paragraph(
            "Git history reconstructs the design intent:",
            s["body"],
        )
    )
    timeline = [
        [cell("<b>Date</b>"), cell("<b>Commit</b>"), cell("<b>What it added</b>"), cell("<b>Defect creation pathway</b>")],
        [
            cell("2026-04-28"),
            code_cell("c757e17"),
            cell("Add structured checklist results with defect flag"),
            cell("<font face='Courier'>InspectionItemResult.isDefect</font> column. No <font face='Courier'>Defect</font> table yet."),
        ],
        [
            cell("2026-04-28"),
            code_cell("76b2789"),
            cell("Add persistent defect status workflow"),
            cell("<font face='Courier'>Defect</font> table introduced. <b>Lazy backfill</b> <font face='Courier'>ensureDefectsForAccessibleItems</font> added to bridge from pre-existing flagged items."),
        ],
        [
            cell("2026-04-29"),
            code_cell("964af42"),
            cell("Add dashboard and map workflow"),
            cell("Dashboard module added. It contains its own near-duplicate copy of the lazy materialiser."),
        ],
        [
            cell("2026-05-13"),
            code_cell("77f95d9"),
            cell("Add configurable defect severity system"),
            cell("<b>EAGER path</b> introduced: <font face='Courier'>buildDefectCreateData</font> + transactional <font face='Courier'>defect.createMany</font> inside <font face='Courier'>submit()</font>. From this commit forward, new submissions create the Defect row directly."),
        ],
        [
            cell("2026-05-20"),
            code_cell("6a54dcb"),
            cell("Add defect governance accountability and operations board"),
            cell("Operations Board added. Uses the lazy materialiser as a top-of-handler call."),
        ],
    ]
    story.append(make_table(timeline, [2.0 * cm, 1.7 * cm, 6.0 * cm, 6.3 * cm]))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "<b>Reconstructed intent:</b> the lazy materialiser was added as a transition aid "
            "when the <font face='Courier'>Defect</font> table didn’t yet exist as a writer in the "
            "submission flow. It was useful — for two weeks — to keep the Dashboard / Defect list "
            "showing flagged items while the eager pathway was being designed. After the eager "
            "pathway shipped on May 13, the lazy backstop became dead weight for any "
            "<i>new</i> inspection but remained necessary for already-submitted "
            "<font face='Courier'>InspectionItemResult</font> rows that lacked a "
            "<font face='Courier'>Defect</font>.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "<b>So: was it intentional?</b> The original lazy mechanism was intentional. Its "
            "<i>continued existence in three call sites today</i> looks like organic accumulation "
            "rather than designed steady state. The two near-duplicate copies (in "
            "<font face='Courier'>dashboard.service.ts</font> and "
            "<font face='Courier'>defects.service.ts</font>) are a tell.",
            s["body"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # 3. Operations Board dependency on Dashboard?
    # ─────────────────────────────────────────────────────────────
    story.append(
        Paragraph(
            "3. Does Operations Board depend on Dashboard access to materialise defects?",
            s["h1"],
        )
    )
    story.append(
        Paragraph(
            "<b>No, not directly.</b> "
            "<font face='Courier'>DefectsService.getOperationsBoard</font> "
            "(<font face='Courier'>defects.service.ts:563–580</font>) calls "
            "<font face='Courier'>this.ensureDefectsForAccessibleItems(user)</font> itself at "
            "line 567 before reading. So Operations Board does not need Dashboard to have run "
            "first.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "<b>But:</b> the materialiser is scoped to the CURRENT VIEWER. If a non-ADMIN with "
            "no team membership opens Operations Board, "
            "<font face='Courier'>ensureDefectsForAccessibleItems</font> finds 0 accessible "
            "<font face='Courier'>InspectionItemResult</font> rows and creates 0 Defects — even "
            "though flagged results exist in the database for that tenant. After that call, the "
            "outer <font face='Courier'>defect.findMany</font> returns 0 because the Defect row "
            "was never created (and even if it had been, the team-scope would drop it).",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "<b>Therefore Operations Board effectively depends on an ADMIN (or a future QA-actor "
            "with cross-team read access) having visited it at least once.</b> That dependency is "
            "implicit, not declared. It is the most fragile part of the current model.",
            s["callout_warn"],
        )
    )

    story.append(PageBreak())

    # ─────────────────────────────────────────────────────────────
    # 4. Can flagged result exist indefinitely without a Defect row?
    # ─────────────────────────────────────────────────────────────
    story.append(
        Paragraph(
            "4. Can a flagged inspection result exist indefinitely without a Defect row?",
            s["h1"],
        )
    )
    story.append(
        Paragraph(
            "<b>Yes.</b> Conditions under which a flagged "
            "<font face='Courier'>InspectionItemResult</font> remains orphaned:",
            s["body"],
        )
    )
    story.extend(
        bullets(
            [
                "Inspection was submitted by a code path that does not call "
                "<font face='Courier'>InspectionsService.submit</font> (e.g., direct "
                "<font face='Courier'>prisma.inspection.update</font> in a migration, "
                "Studio, or a future endpoint). No eager createMany runs.",
                "Inspection was submitted before commit <font face='Courier'>77f95d9</font> "
                "(2026-05-13). Eager path didn’t exist then; the lazy backstop is the only path.",
                "After submission, only non-ADMIN, non-team-member users (e.g., QA Manager with "
                "role=MANAGER and no membership in the inspection’s team) ever open Dashboard / "
                "Operations Board / Defect list. The lazy backstop’s viewer-scoped filter returns "
                "0 accessible items and creates nothing.",
                "The eager transaction at submission throws for some unrelated reason before the "
                "<font face='Courier'>createMany</font> step. Because both writes are in the same "
                "Prisma transaction, the inspection update would roll back too — so submission "
                "fails atomically. <i>This particular case is safe</i> — but the inspection would "
                "remain in DRAFT, not show up as submitted at all.",
            ],
            s["bullet"],
        )
    )

    story.append(
        Paragraph(
            "<b>Consequence of orphaned flagged items:</b>",
            s["body"],
        )
    )
    cons = [
        [cell("<b>Surface</b>"), cell("<b>Behaviour</b>")],
        [
            cell("Site Visits list — defectsFound column"),
            cell("Counts the orphaned <font face='Courier'>InspectionItemResult</font> row. Shows ≥1."),
        ],
        [
            cell("Dashboard defect totals"),
            cell("Counts only <font face='Courier'>Defect</font> rows. Shows 0 until ADMIN visits."),
        ],
        [
            cell("Operations Board"),
            cell("Counts only <font face='Courier'>Defect</font> rows + nested team scope. Shows 0 for non-ADMIN even after materialisation; shows ≥1 for ADMIN after first ADMIN visit."),
        ],
        [
            cell("QA verify / close authority"),
            cell("<font face='Courier'>assertCanGovernQa</font> requires an actor capable of acting on a Defect row. Without the row, QA cannot perform verify / close. <b>The defect is invisible to governance.</b>"),
        ],
    ]
    story.append(make_table(cons, [4.5 * cm, 11.5 * cm]))

    # ─────────────────────────────────────────────────────────────
    # 5. Recommended operational model
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("5. Recommended operational model for ASCURE pilot governance", s["h1"]))
    story.append(
        Paragraph(
            "Two principles drive the recommendation:",
            s["body"],
        )
    )
    story.extend(
        bullets(
            [
                "<b>Single source of truth.</b> Defect creation belongs in exactly one path — "
                "inspection submission. The current two-path model produces the JK6B-style "
                "mismatch where the Site Visits page and the Operations Board disagree.",
                "<b>Defects are governance artifacts.</b> The point at which an inspection is "
                "submitted is the point at which a governance event exists. From that moment, the "
                "defect must be addressable by QA — regardless of who visits a UI page.",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("5.1 Eager-only model", s["h2"]))
    story.extend(
        bullets(
            [
                "<font face='Courier'>InspectionsService.submit</font> remains the only writer of "
                "<font face='Courier'>Defect</font> rows. No other endpoint creates them.",
                "Eager createMany runs unconditionally in the submission transaction. Idempotent "
                "via <font face='Courier'>@unique inspectionItemResultId</font>.",
                "Remove the three call sites of <font face='Courier'>ensureDefectsForAccessibleItems</font>; "
                "remove both copies of the method. Operations Board and Dashboard read pure "
                "<font face='Courier'>Defect</font> rows.",
                "Run a one-time backfill migration at deploy: "
                "<font face='Courier'>INSERT INTO Defect ... SELECT ... FROM InspectionItemResult "
                "WHERE isDefect = true AND id NOT IN (SELECT inspectionItemResultId FROM Defect)</font>. "
                "Documented, idempotent, runs once. After the backfill, the lazy path is provably "
                "unnecessary.",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("5.2 Unify the count source", s["h2"]))
    story.extend(
        bullets(
            [
                "<font face='Courier'>SiteVisitsService.getRollups</font> currently counts "
                "<font face='Courier'>InspectionItemResult</font> with "
                "<font face='Courier'>isDefect=true</font>. Switch it to count "
                "<font face='Courier'>Defect</font> rows (or join via "
                "<font face='Courier'>inspectionItemResult.isDefect=true</font>) so the same "
                "denominator is shown across every surface.",
                "Acceptable interim: leave the Site Visits rollup using "
                "<font face='Courier'>InspectionItemResult</font> but require backfill on deploy "
                "so the two tables always agree.",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("5.3 Decouple access scope from data materialisation", s["h2"]))
    story.extend(
        bullets(
            [
                "Materialisation should NEVER be viewer-scoped. The current pattern means a "
                "non-ADMIN viewer can never materialise items they can’t see, leaving them "
                "invisible to everyone except a later ADMIN visit. This is a governance defect in "
                "itself: it makes the visibility of defects depend on who happens to log in.",
                "If a lazy path is retained at all, it must use a tenant-wide scope (not the "
                "viewer’s scope). Then access control is layered on the read side only — where it "
                "belongs.",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("5.4 Pilot-grade implementation order (no code changes proposed here)", s["h2"]))
    story.extend(
        bullets(
            [
                "Step 1 — run a one-time backfill SQL/Prisma script against production: every "
                "<font face='Courier'>InspectionItemResult.isDefect=true</font> without a "
                "<font face='Courier'>Defect</font> gets a <font face='Courier'>Defect</font> row. "
                "Backfill is identical to the eager createMany shape. Idempotent.",
                "Step 2 — switch <font face='Courier'>SiteVisitsService.getRollups</font> to read "
                "from the <font face='Courier'>Defect</font> table. Every surface now agrees on a "
                "single denominator.",
                "Step 3 — remove the three call sites of "
                "<font face='Courier'>ensureDefectsForAccessibleItems</font> and both helper "
                "method copies. Verify that production has zero orphaned flagged items via the "
                "backfill report before deploying.",
                "Step 4 — separately (out of scope here), fix QA visibility: make the four access "
                "scopes consult <font face='Courier'>isQaActor</font> so QA Managers with the "
                "<font face='Courier'>QA_VALIDATION</font> capability bypass the team-membership "
                "filter on read paths.",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("6. Bottom line", s["h1"]))
    story.append(
        Paragraph(
            "The lazy <font face='Courier'>ensureDefectsForAccessibleItems</font> path is a "
            "transition relic that became a backstop. With the eager path in place since 2026-05-13, "
            "the lazy path’s only job is to clean up legacy flagged items — and it does that "
            "imperfectly because it runs in the current viewer’s scope rather than the tenant’s. "
            "A flagged inspection result CAN exist indefinitely without a "
            "<font face='Courier'>Defect</font> row, and when that happens, governance becomes "
            "operationally blind to it. The pilot-correct model is eager-only, with a one-time "
            "backfill on deploy and the lazy backstop retired.",
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
        title="ASCURE Defect Lifecycle Audit",
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
