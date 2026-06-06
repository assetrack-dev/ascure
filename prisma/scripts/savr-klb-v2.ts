/**
 * SAVR KLB v2 — safe, staged template version migration (ASCURE Feature 2 prep).
 *
 * Reproduces the tested ChecklistTemplatesService duplicate + activate semantics
 * as a reviewable, idempotent, DRY-RUN-FIRST data script. It NEVER mutates the
 * active v1 template except the gated archive in the `publish` stage, and it
 * touches NO Inspection / InspectionResult / Defect rows.
 *
 * Stages (run in order; safe to re-run):
 *   tsx prisma/scripts/savr-klb-v2.ts status
 *   tsx prisma/scripts/savr-klb-v2.ts create   [--apply]
 *   tsx prisma/scripts/savr-klb-v2.ts publish  [--apply]
 *
 * Without --apply every stage is a DRY RUN (prints the plan, writes nothing).
 *
 * Item edits applied to v2 (and ONLY v2):
 *   - jumlah_service               : BOOLEAN -> NUMBER
 *   - umbang_terbang_support_pole  : NUMBER  -> TEXT
 *   - jumlah_blackbox              : keep MULTI_SELECT, set encoded options
 *
 * Requires DATABASE_URL to point at the target database.
 */
import {
  InspectionItemInputType,
  InspectionTemplateStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';

const TEMPLATE_NAME = process.env.SAVR_TEMPLATE_NAME ?? 'SAVR KLB';
const APPLY = process.argv.includes('--apply');
const CMD = (process.argv[2] ?? 'status').toLowerCase();

// Canonical MULTI_SELECT optionsJson shape, matching ChecklistTemplatesService
// (normalizeOptionsJson): { version: 2, fieldType, options: [{label, value}] }.
const JUMLAH_BLACKBOX_OPTIONS = ['1160', '2160', '1400', '2400'];

type Edit = {
  inputType: InspectionItemInputType;
  optionsJson: Prisma.InputJsonValue | null;
};

const ITEM_EDITS: Record<string, Edit> = {
  jumlah_service: { inputType: InspectionItemInputType.NUMBER, optionsJson: null },
  umbang_terbang_support_pole: { inputType: InspectionItemInputType.TEXT, optionsJson: null },
  jumlah_blackbox: {
    inputType: InspectionItemInputType.MULTI_SELECT,
    optionsJson: {
      version: 2,
      fieldType: 'MULTI_SELECT',
      options: JUMLAH_BLACKBOX_OPTIONS.map((value) => ({ label: value, value })),
    },
  },
};

const prisma = new PrismaClient();

const templateInclude = {
  sections: {
    include: { items: { orderBy: { sortOrder: 'asc' as const } } },
    orderBy: { sortOrder: 'asc' as const },
  },
  _count: { select: { inspections: true } },
} satisfies Prisma.InspectionTemplateInclude;

type TemplateRecord = Prisma.InspectionTemplateGetPayload<{ include: typeof templateInclude }>;

function scopeWhere(t: TemplateRecord): Prisma.InspectionTemplateWhereInput {
  return {
    tenantId: t.tenantId,
    assetTypeId: t.assetTypeId,
    capabilityId: t.capabilityId,
    scopeLevel: t.scopeLevel,
    organizationId: t.organizationId,
    operationalRegionId: t.operationalRegionId,
    branchId: t.branchId,
    mainheadId: t.mainheadId,
  };
}

function flat(t: TemplateRecord) {
  return t.sections.flatMap((s) => s.items).sort((a, b) => a.sortOrder - b.sortOrder);
}

async function loadByName(): Promise<TemplateRecord[]> {
  return prisma.inspectionTemplate.findMany({
    where: { name: TEMPLATE_NAME },
    include: templateInclude,
    orderBy: { version: 'asc' },
  });
}

function findActive(list: TemplateRecord[]) {
  return list.find((t) => t.isActive && t.status === InspectionTemplateStatus.ACTIVE) ?? null;
}

function summarize(t: TemplateRecord) {
  const items = flat(t);
  const edited = Object.keys(ITEM_EDITS)
    .map((key) => {
      const it = items.find((i) => i.key === key);
      return it ? `${key}=${it.inputType}` : `${key}=MISSING`;
    })
    .join(', ');
  return `"${t.name}" v${t.version} [${t.status}${t.isActive ? ' ACTIVE' : ''}] id=${t.id} items=${items.length} inspections=${t._count.inspections} | ${edited}`;
}

function assertV2Edits(v2: TemplateRecord) {
  const items = flat(v2);
  for (const [key, edit] of Object.entries(ITEM_EDITS)) {
    const it = items.find((i) => i.key === key);
    if (!it) throw new Error(`v2 is missing expected item "${key}".`);
    if (it.inputType !== edit.inputType) {
      throw new Error(`v2 item "${key}" is ${it.inputType}, expected ${edit.inputType}.`);
    }
    if (key === 'jumlah_blackbox') {
      const opts = (it.optionsJson as { options?: { value: string }[] } | null)?.options ?? [];
      const values = opts.map((o) => o.value);
      const missing = JUMLAH_BLACKBOX_OPTIONS.filter((v) => !values.includes(v));
      if (missing.length) throw new Error(`v2 jumlah_blackbox missing options: ${missing.join(', ')}`);
    }
  }
}

async function status() {
  const list = await loadByName();
  if (!list.length) {
    console.log(`No template named "${TEMPLATE_NAME}" found.`);
    return;
  }
  console.log(`Templates named "${TEMPLATE_NAME}":`);
  for (const t of list) console.log('  - ' + summarize(t));
}

async function create() {
  const list = await loadByName();
  const v1 = findActive(list);
  if (!v1) throw new Error(`No ACTIVE template named "${TEMPLATE_NAME}" found — nothing to duplicate.`);

  const existingV2 = list.find((t) => t.version === v1.version + 1);
  if (existingV2) {
    console.log(`v2 already exists (idempotent skip): ${summarize(existingV2)}`);
    return;
  }

  console.log(`Source: ${summarize(v1)}`);
  const items = flat(v1);
  for (const key of Object.keys(ITEM_EDITS)) {
    const it = items.find((i) => i.key === key);
    if (!it) throw new Error(`Expected item "${key}" not found in v1 — aborting (mapping mismatch).`);
    console.log(`  edit ${key}: ${it.inputType} -> ${ITEM_EDITS[key].inputType}`);
  }

  if (!APPLY) {
    console.log(`[DRY-RUN] Would create "${TEMPLATE_NAME}" v${v1.version + 1} (DRAFT, inactive) as a deep copy of v${v1.version} with the 3 edits above. Re-run with --apply to write.`);
    return;
  }

  const v2 = await prisma.$transaction(async (tx) => {
    const created = await tx.inspectionTemplate.create({
      data: {
        tenantId: v1.tenantId,
        assetTypeId: v1.assetTypeId,
        capabilityId: v1.capabilityId,
        scopeLevel: v1.scopeLevel,
        organizationId: v1.organizationId,
        operationalRegionId: v1.operationalRegionId,
        branchId: v1.branchId,
        mainheadId: v1.mainheadId,
        operationalDomain: v1.operationalDomain,
        version: v1.version + 1,
        name: TEMPLATE_NAME,
        status: InspectionTemplateStatus.DRAFT,
        isActive: false,
        publishedAt: null,
      },
    });

    for (const section of v1.sections) {
      const sec = await tx.inspectionTemplateSection.create({
        data: {
          templateId: created.id,
          title: section.title,
          description: section.description,
          sortOrder: section.sortOrder,
        },
      });
      if (!section.items.length) continue;

      await tx.inspectionTemplateItem.createMany({
        data: section.items.map((item) => {
          const edit = ITEM_EDITS[item.key];
          const inputType = edit ? edit.inputType : item.inputType;
          const optionsJson = edit
            ? edit.optionsJson === null
              ? Prisma.DbNull
              : edit.optionsJson
            : item.optionsJson === null
              ? Prisma.DbNull
              : (item.optionsJson as Prisma.InputJsonValue);
          return {
            templateId: created.id,
            sectionId: sec.id,
            key: item.key,
            label: item.label,
            helperText: item.helperText,
            inputType,
            isRequired: item.isRequired,
            isActive: item.isActive,
            isDefectTrigger: item.isDefectTrigger,
            severity: item.severity,
            sortOrder: item.sortOrder,
            optionsJson,
          };
        }),
      });
    }

    return created;
  });

  const reloaded = (await loadByName()).find((t) => t.id === v2.id)!;
  assertV2Edits(reloaded);
  console.log(`Created + verified: ${summarize(reloaded)}`);
  console.log('v1 was not modified. Next: run `publish` (dry-run) then `publish --apply`.');
}

async function publish() {
  const list = await loadByName();
  const drafts = list.filter((t) => t.status === InspectionTemplateStatus.DRAFT);
  const active = findActive(list);

  // Idempotent: already published (active version is our v2, an older one archived).
  if (!drafts.length && active && active.version > 1 && list.some((t) => t.status === InspectionTemplateStatus.ARCHIVED && t.version < active.version)) {
    console.log(`Already published (idempotent): ${summarize(active)}`);
    return;
  }
  if (drafts.length !== 1) {
    throw new Error(`Expected exactly one DRAFT "${TEMPLATE_NAME}" to publish, found ${drafts.length}. Run \`create --apply\` first / resolve ambiguity.`);
  }
  if (!active) throw new Error(`No ACTIVE "${TEMPLATE_NAME}" v1 found to archive.`);

  const v2 = drafts[0];
  const v1 = active;
  assertV2Edits(v2);

  console.log(`Publish plan:`);
  console.log(`  activate -> ${summarize(v2)}`);
  console.log(`  archive  -> ${summarize(v1)}`);
  console.log(`  v1 currently links ${v1._count.inspections} inspection(s); these MUST remain linked to v1 after archive.`);

  if (!APPLY) {
    console.log('[DRY-RUN] Would activate v2 + archive v1 atomically, asserting inspection linkage is unchanged. Re-run with --apply to write.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    const preCount = await tx.inspection.count({ where: { templateId: v1.id } });

    // Archive the prior active template(s) in the SAME scope (i.e. v1) FIRST,
    // then activate v2 — mirrors ChecklistTemplatesService.activate ordering.
    // A partial unique index allows only one isActive template per scope, so the
    // old one must be deactivated before the new one is activated.
    const archived = await tx.inspectionTemplate.updateMany({
      where: {
        ...scopeWhere(v1),
        isActive: true,
        status: InspectionTemplateStatus.ACTIVE,
        id: { not: v2.id },
      },
      data: { status: InspectionTemplateStatus.ARCHIVED, isActive: false },
    });

    await tx.inspectionTemplate.update({
      where: { id: v2.id },
      data: { status: InspectionTemplateStatus.ACTIVE, isActive: true, publishedAt: new Date() },
    });

    // GATE (requirement 6): the archive only commits if existing inspections
    // remain linked to v1. Linkage is by template id, so archive/activate cannot
    // change it — this assertion fails loudly (rollback) if anything ever did.
    const postCount = await tx.inspection.count({ where: { templateId: v1.id } });
    if (postCount !== preCount) {
      throw new Error(`Inspection linkage to v1 changed (${preCount} -> ${postCount}); rolling back publish.`);
    }
    console.log(`  archived ${archived.count} prior-active template(s); v1 inspection linkage intact (${postCount}).`);
  });

  const after = await loadByName();
  console.log('Published. Final state:');
  for (const t of after) console.log('  - ' + summarize(t));
}

async function main() {
  console.log(`# savr-klb-v2 :: cmd=${CMD} apply=${APPLY} template="${TEMPLATE_NAME}" db=${(process.env.DATABASE_URL ?? '').replace(/:[^:@/]*@/, ':****@')}`);
  if (CMD === 'status') await status();
  else if (CMD === 'create') await create();
  else if (CMD === 'publish') await publish();
  else throw new Error(`Unknown command "${CMD}". Use: status | create | publish (add --apply to write).`);
}

main()
  .catch((err) => {
    console.error('ERROR:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
