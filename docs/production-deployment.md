# ASCURE Production Deployment

This deployment profile is for Phase 1: one Ubuntu VPS, Docker Compose, PostgreSQL, NestJS API, Next.js admin web, Nginx, Certbot SSL, and a persistent local uploads folder.

## Recommended VPS Folder Layout

```text
/opt/ascure/
  repo/
  env/
    api.env
    admin-web.env
    postgres.env
  data/
    postgres/
    uploads/
    backups/
  nginx/
    conf.d/
    certbot/
```

Mount `/opt/ascure/data/uploads` into the API container at `/app/uploads`.

Create the persistent folders before first boot:

```bash
sudo mkdir -p /opt/ascure/{repo,env,data/postgres,data/uploads,data/backups,nginx/conf.d,nginx/certbot}
sudo chown -R 1000:1000 /opt/ascure/data/uploads
```

## Build Flow

From the repository root on the VPS:

```bash
docker compose -f docker-compose.prod.yml build api admin-web
```

Optional pre-Docker sanity check when Node.js is installed on the VPS or CI runner:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @ascure/api build
pnpm --filter @ascure/admin-web build
```

For a same-origin Nginx setup where the browser reaches the API through `/api/v1`, build the admin image with:

```bash
docker compose -f docker-compose.prod.yml build \
  --build-arg NEXT_PUBLIC_API_URL=/api/v1 \
  admin-web
```

If the API is on a separate hostname, use the public API origin instead:

```bash
docker compose -f docker-compose.prod.yml build \
  --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
  admin-web
```

Manual Docker build/run commands, useful for debugging outside Compose:

```bash
docker build -f apps/api/Dockerfile -t ascure-api:prod .
docker run --rm --env-file /opt/ascure/env/api.env \
  -v /opt/ascure/data/uploads:/app/uploads \
  -p 3000:3000 ascure-api:prod

docker build -f apps/admin-web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=/api/v1 \
  -t ascure-admin-web:prod .
docker run --rm -p 3001:3001 ascure-admin-web:prod
```

## Prisma Production Migration Flow

Run migrations before replacing the running API container:

```bash
docker compose -f docker-compose.prod.yml build api
docker compose -f docker-compose.prod.yml run --rm api \
  pnpm --dir apps/api exec prisma migrate deploy --schema=../../prisma/schema.prisma
docker compose -f docker-compose.prod.yml up -d api admin-web nginx
```

For a dedicated one-off migration image:

```bash
docker build -f apps/api/Dockerfile --target migration -t ascure-api-migration:latest .
docker run --rm --env-file /opt/ascure/env/api.env --network ascure_default \
  ascure-api-migration:latest
```

Use the actual Docker Compose network name from `docker network ls`.

## Production Start And Update Flow

```bash
cd /opt/ascure/repo
git pull
docker compose -f docker-compose.prod.yml build api admin-web
docker compose -f docker-compose.prod.yml run --rm api \
  pnpm --dir apps/api exec prisma migrate deploy --schema=../../prisma/schema.prisma
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api admin-web
```

## Backup Recommendations

Back up PostgreSQL and uploads together so database image rows still match files on disk.

```bash
mkdir -p /opt/ascure/data/backups
docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -lc 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > /opt/ascure/data/backups/ascure_$(date +%Y%m%d_%H%M%S).sql

tar -czf /opt/ascure/data/backups/uploads_$(date +%Y%m%d_%H%M%S).tar.gz \
  -C /opt/ascure/data uploads
```

Recommended retention:

- Daily backups for 14 days
- Weekly backups for 8 weeks
- Monthly backups for 12 months
- Test restore at least once before go-live

## Go-Live Checklist

- DNS points to the VPS.
- Nginx routes `/api/v1` and `/uploads` to the API container.
- Nginx routes admin web traffic to the admin web container.
- Certbot certificate is issued and auto-renewal is tested.
- `DATABASE_URL`, `JWT_SECRET`, and admin web API URL are production values.
- PostgreSQL volume is persistent.
- API uploads volume maps to `/app/uploads`.
- `pnpm-lock.yaml` is committed.
- `prisma migrate deploy` succeeds.
- Admin login works through the public HTTPS URL.
- Image upload works and survives `docker compose down` / `up -d`.
- A database backup and uploads backup can be restored.

## Cloudflare R2 Migration Note

The current container keeps uploads on a mounted local folder through `UPLOADS_DIR=/app/uploads`. When moving to Cloudflare R2 later, keep image rows and URL/path fields stable, add S3-compatible storage configuration through environment variables, then swap the storage implementation behind the upload service. The Docker volume can stay in place during the migration window as a rollback source.
