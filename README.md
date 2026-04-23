# ASCURE Phase 1 Backend

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
- one substation
- one SAVR asset type
- one SAVR asset
- one active SAVR checklist template
- one checklist section
- three checklist items

## Current Phase 1 Notes

- Site visits are shared by team membership; duplicate active site visits for the same team and substation are rejected.
- Inspection results are stored dynamically per template item with typed value fields.
- Submission validates required template items before moving an inspection to `SUBMITTED`.
- Image storage is scaffolded at the schema level, but upload endpoints are intentionally deferred.
- Template lifecycle is limited to active-template lookup in this phase; richer version management is planned for later phases.
