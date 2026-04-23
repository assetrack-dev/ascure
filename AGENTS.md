## Project
Asset inspection platform for utility field operations.

This system supports:
- team-shared substation/pencawang check-in
- multi-asset-type inspection workflows
- template-based dynamic checklists
- image capture linked to visits, assets, and inspections
- future AI validation and report generation

Current primary scope:
- SAVR first
- future support for SAVT, Feeder Pillar, Pencawang inspection, Link Box, and Cable Bridge

---

## Product rules

### Team-shared visit workflow
- One team member can create a site visit/check-in at a substation.
- All active users in the same team can access that same active site visit.
- Team members can add inspections under the shared site visit.
- Non-admin users must only access visits for teams they belong to.

### Inspection workflow
- One inspection belongs to:
  - one site visit
  - one asset
  - one checklist template version
- The checklist loaded for an inspection must come from the active template for that asset type at the time the inspection is created.
- The inspection must store the template ID used.
- Checklist responses are stored dynamically per template item, not as hardcoded columns.
- Cycle 2 / cycle 3 inspections must be stored as new inspection rows, never as extra columns.

### Template workflow
- Each asset type has its own checklist template.
- Templates must support versioning.
- Never directly mutate historical inspection structure.
- If a checklist changes, create a new template version.
- Old inspections must remain linked to the old template version.
- Only one template version should be active per asset type at a time.

### Image workflow
- Images are stored as rows, not fixed fields like gambar_1, gambar_2, etc.
- Images may be linked to:
  - site visit
  - asset
  - inspection
  - inspection result (later if needed)

---

## Tech stack

Preferred stack:
- Monorepo
- Backend: NestJS
- Database: PostgreSQL
- ORM: Prisma
- Mobile: React Native
- Web admin: React + Tailwind
- Auth: JWT-based backend auth
- Storage: S3-compatible storage or equivalent

---

## Monorepo structure

Target structure:

```text
apps/
  api/
  mobile/
  web-admin/

packages/
  shared-types/
  shared-utils/

prisma/
docs/
scripts/