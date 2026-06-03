"""Generate the MAINHEAD Capability Ownership Review PDF."""

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


OUTPUT = r"C:\ASCURE\docs\mainhead-capability-ownership-review.pdf"


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
        2 * cm, 1.2 * cm, "ASCURE — MAINHEAD Capability Ownership Review"
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
            "MAINHEAD Capability Ownership Review",
            s["title"],
        )
    )
    story.append(
        Paragraph(
            "Does assigning capabilities to a MAINHEAD provide real operational value "
            "in the current resolver? Assessment only — no code changes.",
            s["subtitle"],
        )
    )

    # Headline verdict — drawn early so reviewers see it first
    story.append(
        Paragraph(
            "HEADLINE — MAINHEAD capability assignment is currently a <b>grant</b>, "
            "not a <b>filter</b>. Capabilities placed on a MAINHEAD are silently "
            "promoted into the effective capability set of every user with access to that MAINHEAD, "
            "via the additive union in the resolver "
            "(<font face='Courier'>users.service.ts:627–741</font>). "
            "This creates governance widening that conflicts with the workspace-gate semantics "
            "of the pilot. Recommendation: <b>Restrict</b> — keep MAINHEAD capability assignment "
            "for Asset Domains as a scope label, drop it from Workspace and Governance categories, "
            "and stop the resolver from promoting MAINHEAD capabilities to user authority. "
            "Full reasoning in §4.",
            s["callout_warn"],
        )
    )

    # 1. Current inheritance chain
    story.append(Paragraph("1. Current inheritance chain — what the resolver actually does", s["h1"]))
    story.append(
        Paragraph(
            "“Inheritance” is the operative word in the brief, but the implementation is not "
            "inheritance — it is an <b>additive union</b> across five capability tables. "
            "Source: <font face='Courier'>UsersService.getEffectiveCapabilitiesForUser</font> "
            "(<font face='Courier'>apps/api/src/users/users.service.ts</font>, lines 485–804).",
            s["body"],
        )
    )

    story.append(Paragraph("1.1 Step 1 — Collect scope IDs", s["h2"]))
    story.append(
        Paragraph(
            "For the target user the resolver builds four sets:",
            s["body"],
        )
    )
    story.extend(
        bullets(
            [
                "<b>teamIds</b> — every team the user is a member of "
                "(<font face='Courier'>userData.teamMemberships</font>).",
                "<b>directMainheadIds</b> — every MAINHEAD the user has access to, via the union "
                "of: (a) <font face='Courier'>UserMainheadAccess</font>, "
                "(b) MAINHEADs derived from each team's "
                "<font face='Courier'>team.mainheadId</font>, "
                "(c) MAINHEADs derived from "
                "<font face='Courier'>UserOperationalRegionAccess</font> "
                "(every MAINHEAD whose <font face='Courier'>operationalRegionId</font> is one of the "
                "user's region IDs), "
                "(d) the legacy <font face='Courier'>userData.mainheadId</font> column.",
                "<b>branchIds</b> — direct <font face='Courier'>userData.branchId</font>, plus "
                "branches derived from each team's <font face='Courier'>team.branchId</font>, plus "
                "branches derived from each MAINHEAD's <font face='Courier'>branchId</font>.",
                "<b>organizationIds</b> — direct <font face='Courier'>userData.organizationId</font>, "
                "plus orgs from <font face='Courier'>organizationMemberships</font>, plus orgs "
                "derived from each branch's <font face='Courier'>organizationId</font>, plus team "
                "<font face='Courier'>team.organizationId</font>.",
            ],
            s["bullet"],
        )
    )
    story.append(
        Paragraph(
            "ADMIN role short-circuits: an ADMIN user's effective set is every active "
            "<font face='Courier'>Capability</font> row, tagged "
            "<font face='Courier'>scope: 'ADMIN'</font>.",
            s["body"],
        )
    )

    story.append(Paragraph("1.2 Step 2 — Fetch five capability sets in parallel", s["h2"]))
    story.append(
        Paragraph(
            "Five concurrent Prisma queries:",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "userCapability.findMany&nbsp;&nbsp;&nbsp;&nbsp;where userId, active<br/>"
            "teamCapability.findMany&nbsp;&nbsp;&nbsp;&nbsp;where teamId in teamIds, active<br/>"
            "mainheadCapability.findMany&nbsp;where mainheadId in directMainheadIds, active<br/>"
            "branchCapability.findMany&nbsp;&nbsp;where branchId in branchIds, active<br/>"
            "organizationCapabilityAssignment.findMany<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;where organizationId in organizationIds, active",
            s["code"],
        )
    )
    story.append(
        Paragraph(
            "Each row carries a capability reference and a scope label.",
            s["body"],
        )
    )

    story.append(Paragraph("1.3 Step 3 — Merge into one set, additively", s["h2"]))
    story.append(
        Paragraph(
            "All five result sets are flattened into a single "
            "<font face='Courier'>Map&lt;capabilityId, EffectiveCapability&gt;</font>. "
            "Each contribution appends its source onto the existing entry; no contribution can "
            "<b>remove</b> a capability another source granted. "
            "There is no intersection step, no precedence rule, and no filter step.",
            s["body"],
        )
    )

    story.append(Paragraph("1.4 Step 4 — Consumers", s["h2"]))
    cons = [
        [cell("<b>Consumer</b>"), cell("<b>What it does with the set</b>")],
        [
            cell("Mobile workspace resolver "
                 "(<font face='Courier'>apps/mobile/src/operationalWorkspace.ts</font>)"),
            cell(
                "Gates Inspection and Maintenance workspaces by presence of "
                "<font face='Courier'>INSPECTION</font> / <font face='Courier'>MAINTENANCE</font> "
                "in the effective set. ADMIN users see both."
            ),
        ],
        [
            cell("<font face='Courier'>GET /users/me/capabilities</font> + "
                 "<font face='Courier'>GET /users/:id/capabilities</font>"),
            cell(
                "Displayed as-is for admin transparency. Sources are returned so the admin can "
                "see <i>why</i> a user has each capability."
            ),
        ],
        [
            cell("Templates / Defects / Inspections / QA / Asset Types"),
            cell(
                "<b>None.</b> Confirmed by grep — no template resolver, defect governance, "
                "inspection workflow, or asset-type filter reads any of the five "
                "<font face='Courier'>*Capability</font> tables."
            ),
        ],
    ]
    story.append(make_table(cons, [6.0 * cm, 10.0 * cm]))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Net effect: the only operational behaviour that depends on MAINHEAD capability "
            "assignments today is mobile workspace gating, mediated through additive merging.",
            s["body"],
        )
    )

    story.append(PageBreak())

    # 2. Examples where MAINHEAD capabilities are useful
    story.append(Paragraph("2. Where MAINHEAD capabilities provide real value", s["h1"]))
    use = [
        [cell("<b>Scenario</b>"), cell("<b>Why it works</b>")],
        [
            cell(
                "“KL Timur performs SAVR and PENCAWANG; KL Barat additionally performs "
                "CABLE_BRIDGE.”"
            ),
            cell(
                "Treats MAINHEAD as an <b>operational-area label</b>. Capabilities here describe "
                "what kinds of asset work happen in that geography, which matches the V10 "
                "definition of MAINHEAD as the operational area."
            ),
        ],
        [
            cell(
                "Contractor team is reassigned from KL Barat to KL Timur partway through pilot."
            ),
            cell(
                "If the team had no per-team capability set, MAINHEAD capabilities provide "
                "“local scope” — the team automatically picks up the work types relevant to the "
                "new area. Avoids hand-editing team capabilities each rotation."
            ),
        ],
        [
            cell(
                "Operations management asks: “what work types is each MAINHEAD authorised to perform?”"
            ),
            cell(
                "MAINHEAD capability assignments make this answerable in one place, instead of "
                "aggregating across all teams that touch the area."
            ),
        ],
        [
            cell(
                "Reporting: defect rates by asset domain per MAINHEAD."
            ),
            cell(
                "MAINHEAD capabilities act as a denominator filter (“areas authorised for FEEDER_PILLAR”) "
                "for area-level KPIs. Useful for the future Reporting Engine in V10 §50."
            ),
        ],
        [
            cell(
                "Pilot setup: define a single MAINHEAD with SAVR; technicians inherit the scope."
            ),
            cell(
                "Reduces admin steps during pilot ramp-up. One MAINHEAD edit replaces N team edits."
            ),
        ],
    ]
    story.append(make_table(use, [5.5 * cm, 10.5 * cm]))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "These scenarios all share one property: the capability is <b>describing what happens "
            "at the area</b>, not <b>granting individuals authority</b>. The model serves them well "
            "only when used as a label.",
            s["body"],
        )
    )

    # 3. Examples where MAINHEAD capabilities create governance confusion
    story.append(Paragraph("3. Where MAINHEAD capabilities create governance confusion", s["h1"]))
    conf = [
        [cell("<b>Scenario</b>"), cell("<b>What goes wrong</b>")],
        [
            cell(
                "SAVR-only technician has access to KL Timur, which also lists CABLE_BRIDGE."
            ),
            cell(
                "The resolver adds <font face='Courier'>CABLE_BRIDGE</font> to the technician's "
                "effective set. Workspace gating only checks "
                "<font face='Courier'>INSPECTION</font>/<font face='Courier'>MAINTENANCE</font>, "
                "but any future asset-type or template filter that reads effective capabilities "
                "would surface CABLE_BRIDGE assets to a SAVR-only technician. <b>Silent privilege widening.</b>"
            ),
        ],
        [
            cell(
                "User has Region access to Klang Valley. Klang Valley has 6 MAINHEADs. One of "
                "them is assigned <font face='Courier'>MAINTENANCE</font>."
            ),
            cell(
                "Resolver promotes all 6 MAINHEADs' capabilities into the user's effective set. "
                "Mobile workspace resolver now opens the Maintenance workspace for the user even "
                "though they are an inspection technician. <b>Multi-MAINHEAD union compounds the widening.</b>"
            ),
        ],
        [
            cell(
                "Admin assigns <font face='Courier'>QA_VALIDATION</font> to a MAINHEAD by mistake."
            ),
            cell(
                "Per V8 §15, QA authority is cross-MAINHEAD and ASCURA-owned. MAINHEAD-level "
                "QA_VALIDATION has no defined semantics. Today the assignment is accepted, gets "
                "merged into every user's effective set for that area, and produces a "
                "<font face='Courier'>QA_VALIDATION</font> tag on technicians who should never have it. "
                "<b>No validation, no error.</b>"
            ),
        ],
        [
            cell(
                "Workspace gates were just established by the pilot "
                "(<font face='Courier'>INSPECTION</font>, <font face='Courier'>MAINTENANCE</font>)."
            ),
            cell(
                "Granting <font face='Courier'>INSPECTION</font> to a MAINHEAD gives every "
                "user-with-access the Inspection workspace. That's a user-authority grant pretending "
                "to be area metadata. <b>Workspace gates are bypassable via MAINHEAD assignment.</b>"
            ),
        ],
        [
            cell(
                "Auditor asks: “why does user X have FEEDER_PILLAR?”"
            ),
            cell(
                "The <font face='Courier'>sources</font> array tags one row as "
                "<font face='Courier'>scope: 'MAINHEAD'</font>, but you must walk back through "
                "<font face='Courier'>UserMainheadAccess</font> + region inheritance + team's "
                "<font face='Courier'>team.mainheadId</font> + legacy <font face='Courier'>mainheadId</font> "
                "to know which path put it there. <b>Audit cost.</b>"
            ),
        ],
        [
            cell(
                "Per V6 §12: contractors must remain decoupled from MAINHEAD ownership."
            ),
            cell(
                "When you place a capability on a MAINHEAD, you're encoding “this area performs X kind of work” — "
                "which is contractor-shaped behaviour, on an area entity that's supposed to be "
                "contractor-neutral. <b>Conflicts with the contractor-independence principle.</b>"
            ),
        ],
        [
            cell(
                "Removing a MAINHEAD capability does not remove user authority."
            ),
            cell(
                "Because the resolver is purely additive, the same capability often also flows from "
                "Team or Org. Untoggling the MAINHEAD row produces no observable change in the "
                "effective set if any other source contributes the same capability. <b>Cleanup is unreliable.</b>"
            ),
        ],
    ]
    story.append(make_table(conf, [5.5 * cm, 10.5 * cm]))

    story.append(PageBreak())

    # 4. Recommendation
    story.append(Paragraph("4. Recommendation", s["h1"]))
    story.append(
        Paragraph(
            "<b>Restrict</b> MAINHEAD capability assignment. Do not keep as-is. Do not remove outright.",
            s["callout_ok"],
        )
    )

    story.append(Paragraph("4.1 Why not Keep", s["h2"]))
    story.extend(
        bullets(
            [
                "Today's additive resolver makes MAINHEAD capability a grant, not a filter. "
                "Combined with multi-MAINHEAD union and region inheritance, that produces unbounded "
                "privilege widening (§3).",
                "Workspace gates established by the pilot can be bypassed by any admin who ticks "
                "<font face='Courier'>INSPECTION</font> or <font face='Courier'>MAINTENANCE</font> on a MAINHEAD.",
                "Mis-assignment of governance codes "
                "(<font face='Courier'>QA_VALIDATION</font>, <font face='Courier'>REPORTING</font>) "
                "at the MAINHEAD level is silently accepted today.",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("4.2 Why not Remove (yet)", s["h2"]))
    story.extend(
        bullets(
            [
                "Asset-domain scoping at the area level is a <b>genuine</b> use case "
                "(§2 row 1, row 4). Removing the table loses that signal entirely.",
                "Removal requires a Prisma migration on a live pilot DB, plus deletion of "
                "<font face='Courier'>MainheadCapability</font> writes/reads across "
                "<font face='Courier'>enterprise.service.ts</font>, "
                "<font face='Courier'>users.service.ts</font>, and the MAINHEAD admin form. "
                "Larger blast radius than the pilot needs right now.",
                "The capabilities catalogue and the Capability Picker (Items 1 and 4 of the "
                "Pilot UX Cleanup) just stabilised. A bigger structural change would invalidate "
                "the rollout we just signed off.",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("4.3 What Restrict means concretely", s["h2"]))
    story.extend(
        bullets(
            [
                "<b>UI restriction.</b> In the MAINHEAD admin modal "
                "(<font face='Courier'>enterprise-list-client.tsx</font>, MAINHEAD branch of "
                "the form), hide the Workspace Access and Governance &amp; Reporting fieldsets. "
                "Show only the Asset Domains fieldset. The "
                "<font face='Courier'>capability-groups.ts</font> helper already returns groups "
                "by key, so a per-context allow-list is trivial.",
                "<b>Server-side validation.</b> In "
                "<font face='Courier'>syncMainheadCapabilities</font> "
                "(<font face='Courier'>enterprise.service.ts:1969</font>), reject any "
                "<font face='Courier'>capabilityId</font> whose code is not in "
                "<font face='Courier'>ASSET_DOMAIN_CODES</font>. Returns 400 with a clear error. "
                "Stops API consumers from bypassing the UI.",
                "<b>Resolver change.</b> In "
                "<font face='Courier'>getEffectiveCapabilitiesForUser</font>, exclude "
                "<font face='Courier'>mainheadCapabilities</font> from the merged effective set "
                "used for workspace gating, OR scope it so its contributions only flow when the "
                "user already has a matching User/Team grant. Keep the source tag for transparency "
                "(\"MAINHEAD KL Timur performs SAVR\"), but stop the silent authority promotion.",
                "<b>Backfill / cleanup.</b> Run a one-shot script to identify any existing "
                "<font face='Courier'>MainheadCapability</font> rows whose code is not in the "
                "Asset Domains allow-list, and surface them in a report for ops to review. "
                "Do not delete automatically. Mirrors the legacy-capability handling pattern.",
                "<b>No mobile change.</b> Mobile reads the resolver output. If the resolver stops "
                "promoting MAINHEAD-sourced workspace capabilities, mobile behaviour tightens "
                "automatically — and matches the workspace-gate semantics the pilot just shipped.",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("4.4 Effect after Restrict", s["h2"]))
    eff = [
        [cell("<b>Concern</b>"), cell("<b>Before</b>"), cell("<b>After Restrict</b>")],
        [
            cell(
                "<font face='Courier'>INSPECTION</font>/<font face='Courier'>MAINTENANCE</font> assignable on MAINHEAD"
            ),
            cell("Yes — silently grants workspace"),
            cell("No — hidden in UI + rejected by server"),
        ],
        [
            cell(
                "<font face='Courier'>QA_VALIDATION</font>/<font face='Courier'>REPORTING</font> assignable on MAINHEAD"
            ),
            cell("Yes — no effect except misleading audit"),
            cell("No — hidden in UI + rejected by server"),
        ],
        [
            cell("Asset-domain scope on MAINHEAD"),
            cell("Yes — but contributes to user authority"),
            cell("Yes — but does not contribute to user authority. Acts as label only."),
        ],
        [
            cell("Cross-MAINHEAD privilege widening via region access"),
            cell(
                "Yes — region access pulls in every MAINHEAD's capabilities"
            ),
            cell(
                "No — region access still grants area visibility, but not capability grants from each area"
            ),
        ],
        [
            cell("Audit clarity"),
            cell(
                "Five-way union with overlapping sources; hard to remove a single source"
            ),
            cell(
                "User authority comes from User + Team + Org/Branch only. MAINHEAD remains a labelling layer."
            ),
        ],
    ]
    story.append(make_table(eff, [4.5 * cm, 5.5 * cm, 6.0 * cm]))

    story.append(Paragraph("4.5 Out of scope for this assessment", s["h2"]))
    story.extend(
        bullets(
            [
                "The same additive-union concern applies to "
                "<b>Organization</b> and <b>Branch</b> capability assignment, though with smaller "
                "blast radius (Org/Branch don't have the region-inheritance multiplier). "
                "Flag for a future review after the MAINHEAD restriction settles.",
                "<font face='Courier'>UserOperationalRegionAccess</font> currently inflates "
                "<font face='Courier'>directMainheadIds</font> with every MAINHEAD in the region. "
                "Restriction here does not change that, but combined with the Effective MAINHEAD "
                "Access preview shipped in the Pilot UX Cleanup, admins can at least see the "
                "expansion before saving.",
                "Long-term: introduce an explicit <font face='Courier'>Capability.kind</font> "
                "column (WORKSPACE / GOVERNANCE / ASSET_DOMAIN) so server-side validators don't "
                "depend on the client-side allow-list constant.",
            ],
            s["bullet"],
        )
    )

    # 5. Bottom line
    story.append(Paragraph("5. Bottom line", s["h1"]))
    story.append(
        Paragraph(
            "MAINHEAD capability assignment has a real and useful semantic — describing what kinds "
            "of asset work happen in a given operational area. It also has, under the current resolver, "
            "an unintended semantic: every capability placed there is silently promoted into every "
            "accessing user's authority set, including workspace gates and governance roles. Restricting "
            "the assignable scope to Asset Domains, plus stopping the resolver from promoting MAINHEAD-sourced "
            "rows into user authority, keeps the useful signal and eliminates the governance leak. Remove is "
            "premature; Keep is unsafe; <b>Restrict</b> is the pilot-grade path.",
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
        title="ASCURE MAINHEAD Capability Ownership Review",
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
