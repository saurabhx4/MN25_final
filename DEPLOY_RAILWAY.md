# Deploying MN25 on Railway

This repo is a monorepo, so create **separate services**, each with its own Root Directory.

## 1. Databases
- **Postgres with PostGIS** – use the Railway "PostGIS" template, not the default Postgres
  (the schema uses `geometry` columns and the `postgis` extension).
- **Redis** – required by BullMQ queues.

## 2. Backend service (Root Directory = `backend`)
Variables:
| Name | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `JWT_SECRET` | long random string |
| `NODE_ENV` | `production` |
| `WEB_ORIGIN` | frontend URL, exact, no trailing slash |
| `COOKIE_SAMESITE` | `none` |

`backend/railway.json` builds with `prisma generate && tsc` and starts with
`prisma db push && node dist/server.js` (see note below). Health check: `/health`.

## 3. Worker service (optional, Root Directory = `backend`)
Same variables as the backend; set the start command to `npm run worker:prod`.

## 4. Frontend service (Root Directory = `frontend`)
Set **before the first build** (NEXT_PUBLIC_* values are baked in at build time):
- `NEXT_PUBLIC_API_BASE=https://<backend>.up.railway.app`
- `NEXT_PUBLIC_ENABLE_DEMO_FALLBACK=false`

## Note on migrations
`backend/prisma/migrations` has no baseline migration (23 core tables such as `User`,
`Organization`, `Mine` are never created), so `prisma migrate deploy` fails on an empty
database. The start command uses `prisma db push`, which builds the database from
`schema.prisma`. Create a proper baseline migration before relying on `migrate deploy`.
