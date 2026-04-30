# ASCURE Admin Web

Phase 1 admin web app for ASCURE.

## Local Development

```bash
pnpm --filter @ascure/admin-web dev
```

The app runs on `http://localhost:3001` so the NestJS API can keep using `http://localhost:3000`.

Create a local env file from `.env.example` when needed:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3000
```

The API helper appends `/api/v1` to this origin for existing NestJS routes.
