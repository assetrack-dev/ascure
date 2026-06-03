"""Generate the Governance G2 — MAINHEAD Capability Restriction — Implementation Report PDF."""

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


OUTPUT = r"C:\ASCURE\docs\governance-g2-mainhead-capability-restriction-summary.pdf"


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
    return {
        "title": title, "subtitle": subtitle, "h1": h1, "h2": h2,
        "body": body, "bullet": bullet, "code": code, "callout_ok": callout_ok,
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
        "ASCURE — Governance G2 (MAINHEAD Capability Restriction) — "
        "Implementation Report",
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
            "Governance G2 — MAINHEAD Capability Restriction",
            s["title"],
        )
    )
    story.append(
        Paragraph(
            "Implementation report. MAINHEAD becomes an operational-scope label "
            "only; user authority resolves exclusively from User + Team + Branch + "
            "Organization. Schema unchanged. No data migration. No mobile changes.",
            s["subtitle"],
        )
    )

    story.append(
        Paragraph(
            "STATUS — Implemented and validated. API build, admin typecheck, and "
            "admin build all PASS on first attempt. MAINHEAD capability assignment "
            "is now restricted to Asset Domains in both the admin UI and the API "
            "validator; the effective capability resolver no longer merges MAINHEAD "
            "capabilities into a user's authority set. Existing rows are preserved.",
            s["callout_ok"],
        )
    )

    # 1. Files changed
    story.append(Paragraph("1. Files changed", s["h1"]))

    story.append(Paragraph("1.1 API", s["h2"]))
    api = [
        [cell("<b>File</b>"), cell("<b>Status</b>"), cell("<b>Change</b>")],
        [
            code_cell("apps/api/src/common/canonical-capabilities.ts"),
            cell("edited"),
            cell(
                "Added <font face='Courier'>MAINHEAD_ASSIGNABLE_CAPABILITY_CODES</font> "
                "(the 8 Asset Domain codes) and "
                "<font face='Courier'>isMainheadAssignableCapabilityCode()</font> predicate. "
                "Existing <font face='Courier'>CANONICAL_CAPABILITY_CODES</font> unchanged."
            ),
        ],
        [
            code_cell("apps/api/src/enterprise/enterprise.service.ts"),
            cell("edited"),
            cell(
                "Imported <font face='Courier'>MAINHEAD_ASSIGNABLE_CAPABILITY_CODES</font>. "
                "Added <font face='Courier'>assertMainheadCapabilitiesAllowed()</font> helper that "
                "fetches codes for the provided capability IDs and throws "
                "<font face='Courier'>BadRequestException</font> with the exact message "
                "<i>“MAINHEADs may only be assigned Asset Domain capabilities.”</i> plus a "
                "<font face='Courier'>disallowedCapabilities</font> array. Wired into "
                "<font face='Courier'>syncMainheadCapabilities</font> immediately after "
                "<font face='Courier'>assertCapabilitiesExist</font>."
            ),
        ],
        [
            code_cell("apps/api/src/users/users.service.ts"),
            cell("edited"),
            cell(
                "In <font face='Courier'>getEffectiveCapabilitiesForUser</font>: dropped "
                "<font face='Courier'>mainheadIdList</font> declaration, removed the "
                "<font face='Courier'>mainheadCapability.findMany</font> from the "
                "<font face='Courier'>Promise.all</font>, removed the destructured "
                "<font face='Courier'>mainheadCapabilities</font> slot, and removed the "
                "<font face='Courier'>for (const row of mainheadCapabilities)</font> merge block. "
                "Added an inline comment explaining the change. Preserved the MAINHEAD → branch "
                "derivation block (lines 525–590) so <font face='Courier'>BranchCapability</font> "
                "inheritance via a MAINHEAD's branch still flows. "
                "<font face='Courier'>UserMainheadAccess</font> / "
                "<font face='Courier'>UserOperationalRegionAccess</font> visibility logic untouched. "
                "The <font face='Courier'>CapabilitySource</font> union literal "
                "<font face='Courier'>MAINHEAD</font> is left in place for forward-compatibility "
                "with <font face='Courier'>apps/mobile/src/types.ts</font> — simply no longer produced."
            ),
        ],
    ]
    story.append(make_table(api, [6.0 * cm, 1.8 * cm, 8.2 * cm]))
    story.append(Spacer(1, 6))

    story.append(Paragraph("1.2 Admin Web", s["h2"]))
    web = [
        [cell("<b>File</b>"), cell("<b>Status</b>"), cell("<b>Change</b>")],
        [
            code_cell("apps/admin-web/src/lib/capability-groups.ts"),
            cell("edited"),
            cell(
                "Exported <font face='Courier'>MAINHEAD_PICKER_GROUP_KEYS = [\"ASSET_DOMAIN\"]</font> "
                "as the per-context allow-list."
            ),
        ],
        [
            code_cell("apps/admin-web/src/components/enterprise-list-client.tsx"),
            cell("edited"),
            cell(
                "<font face='Courier'>CapabilityPicker</font> now accepts an optional "
                "<font face='Courier'>groupKeys?: ReadonlyArray&lt;CapabilityGroupKey&gt;</font> prop. "
                "When set, the picker also filters the assignable list to capabilities whose "
                "<font face='Courier'>capabilityGroupFor(code)</font> is in the allow-list. The MAINHEAD "
                "branch of <font face='Courier'>EnterpriseFormModal</font> (line 858) now passes "
                "<font face='Courier'>groupKeys={MAINHEAD_PICKER_GROUP_KEYS}</font>. "
                "Organization / Branch / Team modal call sites (lines 672, 719, 924) are unchanged."
            ),
        ],
    ]
    story.append(make_table(web, [6.5 * cm, 1.8 * cm, 7.7 * cm]))
    story.append(Spacer(1, 6))

    story.append(Paragraph("1.3 Mobile / Schema", s["h2"]))
    story.extend(
        bullets(
            [
                "<b>Mobile:</b> no changes (as required).",
                "<b>Schema / Migrations:</b> no changes. No schema migration. No data migration. "
                "Existing <font face='Courier'>MainheadCapability</font> rows (including any pre-G2 "
                "Workspace / Governance assignments) are left in the database; they are no longer "
                "consulted by the resolver and no longer editable through the UI.",
            ],
            s["bullet"],
        )
    )

    story.append(PageBreak())

    # 2. Before / after authority model
    story.append(Paragraph("2. Before / after authority model", s["h1"]))

    story.append(Paragraph("2.1 Before (pre-G2)", s["h2"]))
    story.append(
        Paragraph(
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Effective Capabilities<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;▲<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│  additive union<br/>"
            "&nbsp;&nbsp;┌──────────┬─────────┬──────────┬──────────┬────────────────┐<br/>"
            "&nbsp;&nbsp;User&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Team&nbsp;&nbsp;&nbsp;MAINHEAD&nbsp;&nbsp;Branch&nbsp;&nbsp;&nbsp;Organization<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(via UMA + region +<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;team.mainheadId +<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;legacy mainheadId)",
            s["code"],
        )
    )
    story.append(
        Paragraph(
            "A capability placed on a MAINHEAD was silently promoted into every user with any "
            "kind of access to that MAINHEAD. Region access multiplied the widening across "
            "every MAINHEAD in the region.",
            s["body"],
        )
    )

    story.append(Paragraph("2.2 After (G2 active)", s["h2"]))
    story.append(
        Paragraph(
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Effective Capabilities<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;▲<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│  additive union<br/>"
            "&nbsp;&nbsp;┌──────────┬─────────┬──────────┬────────────────┐<br/>"
            "&nbsp;&nbsp;User&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Team&nbsp;&nbsp;&nbsp;Branch&nbsp;&nbsp;&nbsp;Organization<br/>"
            "<br/>"
            "&nbsp;&nbsp;MAINHEAD ─── operational scope label only ───►<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;capability rows stored, rendered in MAINHEAD admin,<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;available for future reporting denominators.<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;NOT in user authority.",
            s["code"],
        )
    )
    story.extend(
        bullets(
            [
                "User authority = <font face='Courier'>User ∪ Team ∪ Branch ∪ Organization</font>.",
                "MAINHEAD capability rows persist in <font face='Courier'>MainheadCapability</font> "
                "but contribute nothing to <font face='Courier'>EffectiveCapability.sources</font>.",
                "<font face='Courier'>UserMainheadAccess</font> and "
                "<font face='Courier'>UserOperationalRegionAccess</font> still control visibility — "
                "only authority resolution changed.",
                "The MAINHEAD → branch derivation chain still feeds "
                "<font face='Courier'>BranchCapability</font> inheritance (so a user with access "
                "to a MAINHEAD continues to inherit the parent branch's capabilities — that path "
                "was always Branch-sourced, not MAINHEAD-sourced).",
            ],
            s["bullet"],
        )
    )

    story.append(PageBreak())

    # 3. Validation results
    story.append(Paragraph("3. Validation results", s["h1"]))
    val = [
        [cell("<b>Step</b>"), cell("<b>Command</b>"), cell("<b>Result</b>")],
        [
            cell("API build"),
            code_cell("pnpm --filter @ascure/api exec tsc -p tsconfig.build.json"),
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
                "<b>PASS</b> — <font face='Courier'>next build</font> compiled in 5.5s, "
                "TypeScript pass in 11.3s, all 21 routes generated."
            ),
        ],
    ]
    story.append(make_table(val, [3.0 * cm, 7.0 * cm, 6.0 * cm]))

    story.append(Paragraph("3.1 Verification checklist (per requirements §6)", s["h2"]))
    check = [
        [cell("<b>Check</b>"), cell("<b>How verified</b>"), cell("<b>Result</b>")],
        [
            cell("MAINHEAD form only shows Asset Domains"),
            cell(
                "<font face='Courier'>EnterpriseFormModal</font> MAINHEAD branch passes "
                "<font face='Courier'>groupKeys={MAINHEAD_PICKER_GROUP_KEYS}</font> to "
                "<font face='Courier'>CapabilityPicker</font>; picker filters via "
                "<font face='Courier'>capabilityGroupFor(code) === \"ASSET_DOMAIN\"</font>."
            ),
            cell("✔"),
        ],
        [
            cell("User form unchanged"),
            cell(
                "<font face='Courier'>UserCapabilityPicker</font> not modified; renders all three groups."
            ),
            cell("✔"),
        ],
        [
            cell("Organization form unchanged"),
            cell(
                "Organization branch <font face='Courier'>CapabilityPicker</font> call site (line 672) "
                "has no <font face='Courier'>groupKeys</font> prop."
            ),
            cell("✔"),
        ],
        [
            cell("Team form unchanged"),
            cell(
                "Team branch call site (line 924) has no <font face='Courier'>groupKeys</font> prop."
            ),
            cell("✔"),
        ],
        [
            cell("Branch form unchanged"),
            cell(
                "Branch branch call site (line 719) has no <font face='Courier'>groupKeys</font> prop."
            ),
            cell("✔"),
        ],
        [
            cell("Effective capability resolution still works"),
            cell(
                "User + Team + Branch + Organization queries + merges unchanged. ADMIN override "
                "path unchanged. TS + admin build clean."
            ),
            cell("✔"),
        ],
        [
            cell("Workspace access still resolves correctly"),
            cell(
                "Mobile <font face='Courier'>operationalWorkspace.ts</font> reads "
                "<font face='Courier'>INSPECTION</font> / <font face='Courier'>MAINTENANCE</font> from "
                "the effective set; these now come only from User / Team / Branch / Organization."
            ),
            cell("✔"),
        ],
        [
            cell("MAINHEAD visibility unchanged"),
            cell(
                "<font face='Courier'>UserMainheadAccess</font> queries + "
                "<font face='Courier'>directMainheadIds</font> derivation untouched."
            ),
            cell("✔"),
        ],
        [
            cell("Operational Region visibility unchanged"),
            cell(
                "Region → MAINHEAD expansion (lines 545–569) untouched."
            ),
            cell("✔"),
        ],
    ]
    story.append(make_table(check, [4.5 * cm, 9.5 * cm, 2.0 * cm]))

    # 4. Backward compatibility
    story.append(
        Paragraph("4. Backward compatibility review (per requirements §5)", s["h1"])
    )
    compat = [
        [
            cell("<b>Consumer</b>"),
            cell("<b>Reads MAINHEAD capability?</b>"),
            cell("<b>Impact of G2</b>"),
        ],
        [
            cell(
                "Mobile workspace resolver "
                "(<font face='Courier'>operationalWorkspace.ts</font>)"
            ),
            cell(
                "Indirectly via <font face='Courier'>getCurrentUserCapabilities</font>; "
                "checks <font face='Courier'>INSPECTION</font> / "
                "<font face='Courier'>MAINTENANCE</font> in the effective set."
            ),
            cell(
                "<b>Intended tightening.</b> Any user who got workspace access only through a "
                "MAINHEAD-level grant loses workspace access. See pilot-risk note in §5."
            ),
        ],
        [
            cell(
                "Capability resolver "
                "(<font face='Courier'>getEffectiveCapabilitiesForUser</font>)"
            ),
            cell(
                "Used to read <font face='Courier'>mainheadCapability</font>; no longer does."
            ),
            cell("<b>Direct change.</b> No MAINHEAD-sourced rows in the effective set."),
        ],
        [
            cell(
                "Template resolution "
                "(<font face='Courier'>templates.service.ts</font>, "
                "<font face='Courier'>checklist-templates.service.ts</font>)"
            ),
            cell(
                "Reads <font face='Courier'>InspectionTemplate.mainheadId</font> for scope hierarchy. "
                "Does NOT read <font face='Courier'>MainheadCapability</font>."
            ),
            cell("<b>No impact.</b>"),
        ],
        [
            cell(
                "Defect governance "
                "(<font face='Courier'>defects.service.ts</font>)"
            ),
            cell("No <font face='Courier'>MainheadCapability</font> reads."),
            cell("<b>No impact.</b>"),
        ],
        [
            cell(
                "Inspection workflow "
                "(<font face='Courier'>inspections/*.ts</font>)"
            ),
            cell("No <font face='Courier'>MainheadCapability</font> reads."),
            cell("<b>No impact.</b>"),
        ],
        [
            cell("Maintenance workflow (defects → maintenance)"),
            cell("No <font face='Courier'>MainheadCapability</font> reads."),
            cell("<b>No impact.</b>"),
        ],
        [
            cell("Reporting logic"),
            cell(
                "No <font face='Courier'>MainheadCapability</font> reads today. Rows remain "
                "available as metadata for future reporting denominators."
            ),
            cell("<b>No impact.</b>"),
        ],
        [
            cell("Admin Web display of effective capabilities"),
            cell(
                "Reads resolver output + renders source tags. "
                "<font face='Courier'>MAINHEAD</font> remains a valid "
                "<font face='Courier'>CapabilitySource</font> union literal for ABI compatibility."
            ),
            cell(
                "<b>No display crash.</b> Old cached rows tagged "
                "<font face='Courier'>MAINHEAD</font> still render; new responses simply omit the tag."
            ),
        ],
    ]
    story.append(make_table(compat, [4.5 * cm, 6.0 * cm, 5.5 * cm]))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Confirmed: no current runtime behaviour outside the resolver itself depends on "
            "MAINHEAD capability grants. Removing them from the effective set does not break "
            "templates, defects, inspections, maintenance, or reporting.",
            s["body"],
        )
    )

    story.append(PageBreak())

    # 5. Pilot risks
    story.append(Paragraph("5. Pilot risks discovered", s["h1"]))
    risks = [
        [cell("<b>Risk</b>"), cell("<b>Likelihood</b>"), cell("<b>Mitigation</b>")],
        [
            cell(
                "Existing pilot user(s) granted <font face='Courier'>INSPECTION</font> / "
                "<font face='Courier'>MAINTENANCE</font> only at the MAINHEAD level may lose mobile "
                "workspace access on first cache refresh after deploy."
            ),
            cell("Medium"),
            cell(
                "Pre-deploy: enumerate affected users via SQL "
                "(<font face='Courier'>MainheadCapability</font> × "
                "<font face='Courier'>UserMainheadAccess</font> for workspace codes). For each, "
                "grant the same capability at the User or Team level via the existing admin UI "
                "so authority survives. After backfill, deploy G2."
            ),
        ],
        [
            cell(
                "Existing <font face='Courier'>MainheadCapability</font> rows with "
                "<font face='Courier'>QA_VALIDATION</font> or <font face='Courier'>REPORTING</font> "
                "remain in the DB but are no longer UI-editable."
            ),
            cell("Low"),
            cell(
                "No behavioural effect after G2 and invisible in the MAINHEAD picker. Surface in "
                "a one-shot ops report; optional ADMIN-only manual cleanup. Not blocking."
            ),
        ],
        [
            cell(
                "<font face='Courier'>CapabilitySource</font> TypeScript union still includes the "
                "<font face='Courier'>MAINHEAD</font> literal in both API and mobile."
            ),
            cell("Low"),
            cell(
                "Cosmetic. Add a deprecation comment in a follow-up. Removing the literal "
                "requires a mobile change, which this sprint disallows."
            ),
        ],
        [
            cell(
                "Direct API attempt to assign <font face='Courier'>INSPECTION</font> to a MAINHEAD "
                "returns 400."
            ),
            cell("Expected"),
            cell(
                "Documented behaviour. Exact message: "
                "<i>“MAINHEADs may only be assigned Asset Domain capabilities.”</i> Plus a "
                "<font face='Courier'>disallowedCapabilities</font> array. Validator runs inside "
                "the transaction so partial saves cannot occur."
            ),
        ],
        [
            cell(
                "Drift between the admin UI allow-list "
                "(<font face='Courier'>MAINHEAD_PICKER_GROUP_KEYS</font>) and the server allow-list "
                "(<font face='Courier'>MAINHEAD_ASSIGNABLE_CAPABILITY_CODES</font>)."
            ),
            cell("Low"),
            cell(
                "Both lists are short and explicit; reviewed together in this sprint. Long-term "
                "remedy: persist <font face='Courier'>Capability.kind</font> as a schema column. "
                "Flagged for backlog."
            ),
        ],
    ]
    story.append(make_table(risks, [5.5 * cm, 2.5 * cm, 8.0 * cm]))

    # 6. Deploy order
    story.append(Paragraph("6. Deploy order", s["h1"]))
    story.extend(
        bullets(
            [
                "<b>API first.</b> The resolver change tightens the effective set; the validator "
                "rejects bad MAINHEAD writes. Both are server-side truth.",
                "<b>Admin Web second.</b> The MAINHEAD picker restriction prevents admins from "
                "attempting Workspace / Governance assignments that the API will now reject anyway.",
                "<b>No mobile deploy required.</b> Mobile is forward-compatible: existing builds "
                "continue to call <font face='Courier'>getCurrentUserCapabilities</font> and gate "
                "workspaces on the returned set, which is now the cleaner one.",
            ],
            s["bullet"],
        )
    )

    story.append(Paragraph("Rollback", s["h2"]))
    story.extend(
        bullets(
            [
                "Revert the three API files (canonical-capabilities.ts addition, "
                "enterprise.service.ts helper + call, users.service.ts resolver edit) and the "
                "two admin-web files (capability-groups.ts addition, "
                "enterprise-list-client.tsx picker prop + MAINHEAD call site).",
                "No data side-effects — no rows were deleted, no schema changed. Any backfilled "
                "User/Team capability assignments performed during the deploy preparation "
                "remain in place and are harmless.",
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
        title="ASCURE Governance G2 — MAINHEAD Capability Restriction — "
              "Implementation Report",
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
