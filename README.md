# ASCURE Backend

Production-oriented backend foundation for the ASCURE asset inspection platform, focused on utility field inspections at substations/pencawang.

Phase 1 implements:

- NestJS API scaffold in `apps/api`
- Prisma + PostgreSQL schema and initial migration in `prisma`
- development seed data
- JWT auth
- current-user and team context endpoints
- master-data endpoints for substations, asset types, and assets
- shared site-visit endpoints
- active checklist template lookup
- dynamic inspection create/load/save/submit flow

Phase 2 extends the backend with admin-facing template builder APIs for draft management, section/item CRUD, cloning, and publishing.

The `apps/mobile`, `apps/web-admin`, and `packages/*` folders are intentionally minimal placeholders for later phases.

## Repository Structure

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
```

## Prerequisites

- Node.js 20+ with `npm`
- PostgreSQL 15+ accessible locally

## Environment Variables

Copy `.env.example` to `.env` and update values as needed.

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ascure?schema=public"
JWT_SECRET="change-me-for-local-development"
PORT=3000
```

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Generate the Prisma client:

```bash
npm run prisma:generate
```

3. Create the database if it does not already exist.

Example:

```sql
CREATE DATABASE ascure;
```

4. Apply the committed migration:

```bash
npm run prisma:migrate:deploy
```

For local iterative schema work, you can use:

```bash
npm run prisma:migrate:dev -- --name your_change_name
```

5. Seed development data:

```bash
npm run prisma:seed
```

6. Start the API:

```bash
npm run start:dev
```

Build the API:

```bash
npm run build
```

## Seeded Development Credentials

- Admin: `admin@ascure.local` / `Admin123!`
- Manager: `manager@ascure.local` / `Manager123!`
- Supervisor: `supervisor@ascure.local` / `Supervisor123!`
- Technician: `technician@ascure.local` / `Tech123!`

## Implemented Endpoints

### Auth

- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`

### User Context

- `GET /api/v1/users/me/teams`

### Master Data

- `GET /api/v1/substations`
- `GET /api/v1/asset-types`
- `GET /api/v1/assets?substation_id=<uuid>`

### Site Visits

- `POST /api/v1/site-visits`
- `GET /api/v1/site-visits?status=ACTIVE`
- `GET /api/v1/site-visits/:id`

### Templates

- `GET /api/v1/asset-types/:assetTypeId/active-template`
- `GET /api/v1/templates`
- `GET /api/v1/templates/:id`
- `POST /api/v1/templates`
- `POST /api/v1/templates/:id/sections`
- `PATCH /api/v1/templates/:id/sections/:sectionId`
- `DELETE /api/v1/templates/:id/sections/:sectionId`
- `POST /api/v1/templates/:id/items`
- `PATCH /api/v1/templates/:id/items/:itemId`
- `DELETE /api/v1/templates/:id/items/:itemId`
- `POST /api/v1/templates/:id/clone`
- `POST /api/v1/templates/:id/publish`
- `GET /api/v1/asset-types/:assetTypeId/templates`

### Inspections

- `POST /api/v1/inspections`
- `GET /api/v1/inspections/:id/form`
- `PUT /api/v1/inspections/:id/results`
- `POST /api/v1/inspections/:id/submit`

## Seeded Domain Data

The seed creates:

- one tenant
- one department
- one team
- one admin user
- one technician user
- both users assigned to the team for easier end-to-end testing
- one manager user
- one supervisor user
- one substation
- one SAVR asset type
- one SAVR asset
- one active SAVR checklist template
- one checklist section
- three checklist items

## Template Builder Notes

- Template management endpoints are restricted to `ADMIN`, `MANAGER`, and `SUPERVISOR`.
- `TECHNICIAN` users remain blocked from template management routes.
- Draft templates are the only editable templates.
- Active templates must be cloned into a new draft before changes are made.
- Archived templates are read-only.
- If `POST /api/v1/templates` omits `version`, the backend assigns the next available version for that asset type.
- Publishing a draft archives the previous active template for the same asset type and activates the published draft.
- A database-level partial unique index enforces one active template per asset type.
- Historical inspections remain compatible because inspections keep their original `templateId`.
- Section deletion is intentionally conservative in this phase: draft sections cannot be deleted until their items are removed first.
- Supported builder input types in this phase are `TEXT`, `BOOLEAN`, `NUMBER`, `DATE`, `DATETIME`, and `SELECT`.
- `SELECT` options are stored as normalized option objects with `label` and `value`.

## Current Backend Notes

- Site visits are shared by team membership; duplicate active site visits for the same team and substation are rejected.
- Inspection results are stored dynamically per template item with typed value fields.
- Submission validates required template items before moving an inspection to `SUBMITTED`.
- Inspection result saving now supports `SELECT` template items and validates the submitted option against the template's configured options.
- Image storage is scaffolded at the schema level, but upload endpoints are intentionally deferred.
- Template lifecycle now supports draft creation, draft editing, cloning, publishing, and archived history while preserving older inspection records.
