"""Generate the User Form Workspace Access Visibility Audit PDF."""

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


OUTPUT = r"C:\ASCURE\docs\user-form-workspace-visibility-audit.pdf"


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
        "ASCURE — User Form Workspace Access Visibility Audit",
    )
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Page {doc.page}")
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, 1.5 * cm, A4[0] - 2 * cm, 1.5 * cm)
    canvas.restoreState()


def build_story(s):
    story = []

    story.append(
        Paragraph("User Form — Workspace Access Visibility Audit", s["title"])
    )
    story.append(
        Paragraph(
            "Investigating the report that the User Create/Edit form no longer shows the "
            "Workspace Access capability group after Governance G2. Read-only audit against "
            "the committed source on branch <font face='Courier'>feature/mobile-ui-pass-1</font>, "
            "tip <font face='Courier'>16d93c3</font>, plus a live query against the connected "
            "database. No code modifications.",
            s["subtitle"],
        )
    )

    # Headline
    story.append(
        Paragraph(
            "HEADLINE — In the committed code path, the User form’s "
            "<font face='Courier'>UserCapabilityPicker</font> WILL render Workspace Access. "
            "The component does not pass <font face='Courier'>groupKeys</font>, the server "
            "returns <font face='Courier'>INSPECTION</font> and "
            "<font face='Courier'>MAINTENANCE</font>, the <font face='Courier'>isAssignableCapability</font> "
            "predicate accepts both, and <font face='Courier'>groupCapabilities()</font> places "
            "them in the Workspace Access bucket. If the deployed UI is missing the group, the "
            "cause is operational (stale bundle, wrong form, viewport), not source-level. "
            "Verification steps in §6.",
            s["callout_ok"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # 1. Is Workspace Access intentionally hidden?
    # ─────────────────────────────────────────────────────────────
    story.append(
        Paragraph("1. Is Workspace Access intentionally hidden on the User form?", s["h1"])
    )
    story.append(
        Paragraph(
            "<b>No.</b> No code path in the User Create/Edit flow hides the Workspace Access "
            "fieldset. The only per-context allow-list in the admin web today is "
            "<font face='Courier'>MAINHEAD_PICKER_GROUP_KEYS = [\"ASSET_DOMAIN\"]</font>, applied "
            "exclusively in the MAINHEAD branch of "
            "<font face='Courier'>EnterpriseFormModal</font> "
            "(<font face='Courier'>enterprise-list-client.tsx:858</font>). It is not imported, "
            "referenced, or applied anywhere in <font face='Courier'>users-client.tsx</font>.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "Grep across <font face='Courier'>users-client.tsx</font> for "
            "<font face='Courier'>INSPECTION</font>, <font face='Courier'>MAINTENANCE</font>, "
            "<font face='Courier'>WORKSPACE</font>, <font face='Courier'>workspace</font>, "
            "and <font face='Courier'>groupKeys</font> returns <b>zero matches</b>. There is no "
            "string literal or branch in the User form that suppresses workspace codes.",
            s["body"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # 2. Accidentally removed during G2?
    # ─────────────────────────────────────────────────────────────
    story.append(
        Paragraph("2. Was Workspace Access accidentally removed during Governance G2?", s["h1"])
    )
    story.append(
        Paragraph(
            "<b>No.</b> Governance G2 (commit <font face='Courier'>16d93c3</font> — "
            "<i>“Implement Governance G2 MAINHEAD capability restriction”</i>) did not modify "
            "<font face='Courier'>users-client.tsx</font>. Verified by "
            "<font face='Courier'>git show --stat 16d93c3</font> — the change set lists "
            "<font face='Courier'>enterprise-list-client.tsx</font>, "
            "<font face='Courier'>site-visit-detail-client.tsx</font>, "
            "<font face='Courier'>site-visits-client.tsx</font>, "
            "<font face='Courier'>capability-groups.ts</font>, "
            "<font face='Courier'>canonical-capabilities.ts</font>, "
            "<font face='Courier'>enterprise.service.ts</font>, "
            "<font face='Courier'>users.service.ts</font>, two site-visit DTO/service files, "
            "but does <b>not</b> list <font face='Courier'>users-client.tsx</font>.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "G2 changes that touched the resolver-side and MAINHEAD picker were intentional and "
            "scoped. The User capability picker was left as-is, by design: per the original G2 "
            "requirements (§1 of the brief), the User form must remain unchanged.",
            s["body"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # 3. Can users still be assigned INSPECTION/MAINTENANCE through the UI?
    # ─────────────────────────────────────────────────────────────
    story.append(
        Paragraph(
            "3. Can users still be assigned INSPECTION or MAINTENANCE through the UI?",
            s["h1"],
        )
    )
    story.append(
        Paragraph(
            "<b>Yes — in the source as committed.</b> The User Create/Edit form mounts "
            "<font face='Courier'>UserCapabilityPicker</font> "
            "(<font face='Courier'>users-client.tsx:589</font>). The picker:",
            s["body"],
        )
    )
    story.extend(
        bullets(
            [
                "Calls <font face='Courier'>options.capabilities.filter(isAssignableCapability)</font>. "
                "<font face='Courier'>isAssignableCapability</font> drops rows that are explicitly "
                "<font face='Courier'>isActive=false</font> or whose <font face='Courier'>code</font> "
                "is outside the canonical allow-list. <font face='Courier'>INSPECTION</font> "
                "and <font face='Courier'>MAINTENANCE</font> are both in "
                "<font face='Courier'>CANONICAL_CAPABILITY_CODES</font> and pass.",
                "Calls <font face='Courier'>groupCapabilities(assignable)</font> — buckets each "
                "capability by <font face='Courier'>capabilityGroupFor(code)</font>. "
                "<font face='Courier'>INSPECTION</font> and <font face='Courier'>MAINTENANCE</font> "
                "both bucket to <font face='Courier'>WORKSPACE</font>, populating the Workspace "
                "Access group.",
                "Does <b>not</b> pass <font face='Courier'>groupKeys</font>. The optional per-context "
                "filter exists only on <font face='Courier'>CapabilityPicker</font> in "
                "<font face='Courier'>enterprise-list-client.tsx</font>; the User form uses a "
                "separate component (<font face='Courier'>UserCapabilityPicker</font>) that has "
                "no analogous prop.",
                "Renders all three groups in canonical order: Workspace Access, Governance &amp; "
                "Reporting, Asset Domains.",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("Server-side cross-check (live DB)", s["h2"]))
    story.append(
        Paragraph(
            "Ran the exact same query the API uses for "
            "<font face='Courier'>GET /enterprise/options.capabilities</font> against the "
            "connected DB:",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "prisma.capability.findMany({<br/>"
            "&nbsp;&nbsp;where: { isActive: true, code: { in: [...CANONICAL_CAPABILITY_CODES] } },<br/>"
            "&nbsp;&nbsp;orderBy: [{ isActive: 'desc' }, { name: 'asc' }],<br/>"
            "&nbsp;&nbsp;select: { id, name, code, description, isActive },<br/>"
            "})<br/>"
            "&nbsp;&nbsp;→ count: 12, includes INSPECTION (id …011) and MAINTENANCE (id …009),<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;both isActive=true.",
            s["code"],
        )
    )
    story.append(
        Paragraph(
            "The server is returning both workspace codes today.",
            s["body"],
        )
    )

    story.append(PageBreak())

    # ─────────────────────────────────────────────────────────────
    # 4. Could new users lose workspace visibility?
    # ─────────────────────────────────────────────────────────────
    story.append(
        Paragraph(
            "4. Could new users created today lose workspace visibility because Workspace "
            "Access cannot be assigned?",
            s["h1"],
        )
    )
    story.append(
        Paragraph(
            "<b>Per the source as committed: No.</b> Admins creating new users via the User form "
            "can tick <font face='Courier'>INSPECTION</font> or <font face='Courier'>MAINTENANCE</font> "
            "under Workspace Access; the form posts those capability IDs to the API; the User-direct "
            "<font face='Courier'>UserCapability</font> rows are written; the effective capability "
            "resolver continues to include User-sourced rows. Mobile workspace gating then opens "
            "the Inspection or Maintenance workspace as before.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "<b>If the deployed UI in fact hides Workspace Access</b> (a real but unverifiable "
            "claim from the source repo alone), the operational impact would be:",
            s["callout_warn"],
        )
    )
    story.extend(
        bullets(
            [
                "<b>New users created via the User form would not receive workspace "
                "capabilities at the User level.</b> No checkbox to grant "
                "<font face='Courier'>INSPECTION</font> or "
                "<font face='Courier'>MAINTENANCE</font> in the form.",
                "<b>Per Governance G2, MAINHEAD capabilities no longer grant authority.</b> So "
                "the only remaining grant paths are Team / Branch / Organization — all of which "
                "require additional admin steps outside the User Create/Edit flow.",
                "<b>Result:</b> a new user with no Team / Branch / Organization workspace "
                "assignment would log into mobile and see no workspaces. The mobile workspace "
                "resolver gates on <font face='Courier'>INSPECTION</font> / "
                "<font face='Courier'>MAINTENANCE</font> in the effective set "
                "(<font face='Courier'>operationalWorkspace.ts:10–11, 64, 68</font>); without any "
                "of those four sources, the user can't enter either workspace.",
                "ADMIN users would still see both workspaces via the resolver short-circuit "
                "(<font face='Courier'>users.service.ts:488–505</font>), so the issue is "
                "invisible to admins testing with their own accounts.",
            ],
            s["bullet"],
        )
    )

    # ─────────────────────────────────────────────────────────────
    # 5. Component + filtering logic
    # ─────────────────────────────────────────────────────────────
    story.append(Paragraph("5. Component and filtering logic responsible", s["h1"]))

    layers = [
        [cell("<b>Layer</b>"), cell("<b>Location</b>"), cell("<b>What it does</b>")],
        [
            cell("Component"),
            code_cell(
                "apps/admin-web/src/components/users-client.tsx<br/>"
                "lines 236–298 — UserCapabilityPicker<br/>"
                "line 589 — render site inside UserFormModal"
            ),
            cell(
                "Renders capability checkboxes for the User Create/Edit modal. Independent of "
                "the enterprise-list-client picker."
            ),
        ],
        [
            cell("Server filter"),
            code_cell(
                "apps/api/src/enterprise/enterprise.service.ts<br/>"
                "lines 428–447 — capability.findMany inside getOptions"
            ),
            cell(
                "Server-side allow-list applied to "
                "<font face='Courier'>/enterprise/options</font>. Returns only canonical + active. "
                "INSPECTION + MAINTENANCE both included today."
            ),
        ],
        [
            cell("Client allow-list"),
            code_cell(
                "apps/admin-web/src/lib/capability-groups.ts<br/>"
                "lines 60–91 — CANONICAL_CAPABILITY_CODES + isAssignableCapability"
            ),
            cell(
                "Defense-in-depth filter. Drops rows that are explicitly inactive or whose code "
                "is outside the canonical set. Accepts INSPECTION + MAINTENANCE."
            ),
        ],
        [
            cell("Group bucketing"),
            code_cell(
                "apps/admin-web/src/lib/capability-groups.ts<br/>"
                "lines 30–33, 107–121, 152–186 — WORKSPACE_CODES, capabilityGroupFor, groupCapabilities"
            ),
            cell(
                "Maps codes to one of three buckets and returns groups in canonical order "
                "(Workspace Access → Governance &amp; Reporting → Asset Domains). Empty buckets "
                "are dropped — but with INSPECTION + MAINTENANCE present, the WORKSPACE bucket "
                "is non-empty and renders."
            ),
        ],
        [
            cell("Per-context restriction"),
            code_cell(
                "apps/admin-web/src/lib/capability-groups.ts<br/>"
                "lines 137–145 — MAINHEAD_PICKER_GROUP_KEYS"
            ),
            cell(
                "<b>Defined and exported.</b> Imported and used <b>only</b> by "
                "<font face='Courier'>enterprise-list-client.tsx:858</font> "
                "(the MAINHEAD branch of EnterpriseFormModal). Not imported by "
                "<font face='Courier'>users-client.tsx</font>. <b>This is the only </b>"
                "<b>per-group restriction in the codebase.</b>"
            ),
        ],
    ]
    story.append(make_table(layers, [3.3 * cm, 6.5 * cm, 6.2 * cm]))

    # ─────────────────────────────────────────────────────────────
    # 6. Verification steps
    # ─────────────────────────────────────────────────────────────
    story.append(
        Paragraph(
            "6. Operational verification steps (recommended before any code action)",
            s["h1"],
        )
    )
    story.append(
        Paragraph(
            "Because the source as committed should render Workspace Access on the User form, "
            "the report of its absence is most likely an operational artefact. Recommend these "
            "checks before treating it as a source-level bug:",
            s["body"],
        )
    )
    story.extend(
        bullets(
            [
                "<b>Hard refresh of the admin browser tab</b> (Ctrl/Cmd+Shift+R). Next.js + "
                "Turbopack chunk hashes can drift between deploys; a cached chunk loaded before "
                "the last admin-web rebuild may render an older version of the picker.",
                "<b>Confirm the deployed build matches the commit.</b> "
                "<font face='Courier'>git rev-parse HEAD</font> on the build host should equal "
                "<font face='Courier'>16d93c3</font> (or a descendant). If a stale dev server is "
                "running, restart it.",
                "<b>Confirm the modal under inspection is the User modal</b>, not the MAINHEAD "
                "modal. The MAINHEAD modal correctly shows only Asset Domains; visual layout is "
                "similar (header says MAINHEAD vs User; only the User modal contains the Email "
                "field and the role dropdown).",
                "<b>Network tab</b>: open browser devtools, open the User Create modal, observe "
                "the <font face='Courier'>GET /enterprise/options</font> response payload, and "
                "verify <font face='Courier'>capabilities</font> includes objects with "
                "<font face='Courier'>code: \"INSPECTION\"</font> and "
                "<font face='Courier'>code: \"MAINTENANCE\"</font>. The dev DB confirms the server "
                "returns them; if the response on staging differs, that points to a different "
                "DB or a different deployed API.",
                "<b>Inspect the rendered DOM.</b> Search for the legend text "
                "<font face='Courier'>“Workspace Access”</font>. If the legend is present but "
                "the checkboxes are missing, the issue is the capability list (server response); "
                "if the legend itself is missing, the issue is "
                "<font face='Courier'>groupCapabilities()</font> dropping an empty bucket — "
                "which only happens when no INSPECTION / MAINTENANCE rows survive the filters.",
                "<b>Check the live capability rows.</b> If <font face='Courier'>INSPECTION</font> "
                "or <font face='Courier'>MAINTENANCE</font> were deactivated in the catalogue page "
                "(<font face='Courier'>/capabilities</font>) by an ops action — "
                "<font face='Courier'>isActive=false</font> — the server-side filter "
                "<font face='Courier'>isActive: true</font> would exclude them and the WORKSPACE "
                "bucket would be empty, so <font face='Courier'>groupCapabilities()</font> would "
                "drop the Workspace Access legend entirely. <b>The most likely real-world cause "
                "if the deployment is current.</b>",
            ],
            s["bullet"],
        )
    )

    story.append(PageBreak())

    # 7. Bottom line + recommended next steps
    story.append(Paragraph("7. Bottom line", s["h1"]))
    story.extend(
        bullets(
            [
                "<b>Source verdict:</b> Workspace Access is not hidden on the User form; G2 did "
                "not remove it; the picker continues to support assigning INSPECTION / "
                "MAINTENANCE; new users created via the form can receive workspace authority via "
                "the User direct grant path.",
                "<b>Most likely operational cause for the observed UI:</b> either a stale "
                "client bundle, or one of the two workspace capability rows was deactivated in "
                "the catalogue page (which causes <font face='Courier'>groupCapabilities()</font> "
                "to drop the empty Workspace Access bucket entirely).",
                "<b>No action required in source.</b> The per-context allow-list infrastructure "
                "in <font face='Courier'>capability-groups.ts</font> is correctly scoped to the "
                "MAINHEAD picker only. If after the verification steps the issue persists, the "
                "next step is to look at the <font face='Courier'>capabilities</font> array in "
                "the actual <font face='Courier'>GET /enterprise/options</font> response on the "
                "affected environment, not the client code.",
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
        title="ASCURE User Form Workspace Access Visibility Audit",
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
