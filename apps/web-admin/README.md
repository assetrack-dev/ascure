# ASCURE Web Admin

Phase 3 starter admin UI for inspection templates.

## What is included

- Login page using the existing NestJS JWT auth endpoint
- JWT token persistence in `localStorage`
- Template dashboard backed by `GET /api/v1/templates`
- Responsive table/cards layout with clear loading and error states
- Placeholder `View`, `Clone`, and `Publish` buttons for the next phase

## Run the app

From the ASCURE repo root:

```bash
pnpm --filter web-admin dev
```

Or from this folder:

```bash
pnpm dev
```

The Vite dev server proxies `/api/*` requests to `http://localhost:3000`, so local development works without backend CORS changes.

## Seeded login

- Email: `admin@ascure.local`
- Password: `Admin123!`

The login form is prefilled with these credentials for quick testing.

## API base URL

Default:

```bash
VITE_API_BASE_URL=/api/v1
```

Optional override:

```bash
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

Use a full URL override only when the backend already allows browser access from the frontend origin.
