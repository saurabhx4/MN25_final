# MN25 Backend — Dashboard module

Implements the backend for the MN25 Dashboard page: `/api/dashboard/*`,
`/api/locations/:id/summary`, the Dashboard quick actions
(`/api/analyses`, `/api/samples/upload`, `/api/reports`,
`/api/analyses/comparison`), and `/api/system/status`.

## Stack
- Node.js + TypeScript + Express
- PostgreSQL + PostGIS (via Prisma; geometry columns are `Unsupported` in the
  schema and set/read with raw SQL)
- BullMQ (Redis) for async analysis/report jobs
- Redis-backed cache (falls back to in-memory) for the read-heavy dashboard endpoints
- JWT auth, org-scoped on every query
- Pino structured logging + an `AuditLog` table for every state-changing action

## Setup

```bash
cp .env.example .env        # fill in DATABASE_URL / REDIS_URL / JWT_SECRET
npm install
npx prisma migrate dev --name init   # requires Postgres with the postgis extension available
npx ts-node prisma/seed.ts           # demo org + zone shells, NO fabricated predictions
npm run dev                          # API on :4000
npm run worker                       # separate process: analysis job consumer
```

`AI_ENGINE_URL`, `GEOSPATIAL_ENGINE_URL`, `SATELLITE_PIPELINE_URL`,
`FORECASTING_ENGINE_URL`, `REPORT_SERVICE_URL` are optional env vars pointing
at the real inference/geospatial/report microservices. Until they're
configured, `/api/system/status` correctly reports those components as
`UNKNOWN` and any analysis job that needs them fails explicitly rather than
inventing a result — see `src/workers/analysisWorker.ts`.

## Why some endpoints return `"status": "unavailable"`

Per the platform's data-quality rule, nothing here invents geological,
spectral, satellite, or AI values. The seed script creates real geographic
reference points (matching the zones already shown in the frontend
prototype) but deliberately inserts **no** `ProspectivityPrediction` or
`ManganeseObservation` rows. Until a real analysis job runs against a
configured inference service, the Dashboard's prediction-derived fields
correctly render "unavailable" instead of a placeholder number.

## Tests

```bash
npm test
```

Route-level tests mock Prisma and assert: auth is enforced, org-scoping is
applied to every query, and the "unavailable" contract is honored instead of
fabricated defaults. They don't require a live database.

## Modules

| Path | Responsibility |
|---|---|
| `src/modules/auth` | login/signup, JWT issuance |
| `src/modules/dashboard` | summary, top-zones, manganese-distribution, recent-analyses |
| `src/modules/locations` | `/api/locations/:id/summary`, also sets the user's "selected location" |
| `src/modules/analyses` | New Analysis + Compare Regions quick actions, job polling |
| `src/modules/samples` | Upload Samples quick action |
| `src/modules/reports` | Generate Report quick action |
| `src/modules/system` | Live status, backed by `src/workers/systemHealthWorker.ts` probes |
| `src/modules/audit` | `recordAudit()`, used by every mutating route |
| `src/workers` | BullMQ consumer for analysis jobs; a cron-able health-probe script |

## Not included in this pass

The other MN25 pages (AI Analysis workspace, Projects/Risk, Reports
workspace, Settings) still need their own route modules (`/spectral`,
`/production`, `/risk`, `/actions`, `/data-sources`, `/models`) — scoped out
of this task, which covered the Dashboard and Explore pages only.

## Explore page backend (`/api/geospatial`, `/api/mining`, `/api/prospectivity`, `/api/satellite`, `/api/map-configurations`)

Everything below is org-scoped behind `requireAuth`, just like the Dashboard
module, and follows the same "never fabricate" contract.

| Path | Responsibility |
|---|---|
| `src/lib/geocoding` | `GeocoderProvider` abstraction; default implementation calls Nominatim (OpenStreetMap), a real public geocoder — no bespoke geocoder was built |
| `src/lib/satellite` | `SatelliteProvider` abstraction over any STAC-compliant catalog (Copernicus Data Space, Element84 Earth Search, ...) |
| `src/lib/geo/geometry.ts` | GeoJSON polygon validation, geodesic area (spherical-excess formula), centroid, bbox parsing — used to validate user-drawn analysis regions |
| `src/modules/geospatial` | `GET /search` (place search: local documented records + geocoder + literal `"lat,lng"` support), `GET /layers` (availability reflects actual configuration, never hardcoded true) |
| `src/modules/mining` | `GET /nearby` (PostGIS `ST_DWithin`/`ST_Distance`, parameterized raw SQL, spatially indexed), `GET /areas`, `GET /areas/:id`. Documented mines/occurrences only — **never** returns an AI-predicted zone in the same shape |
| `src/modules/prospectivity` | `GET /hotspots`, `GET /zones/:id` — reads the new `ProspectivityZone` model. `featureContributions` is `null`, never invented, when the model didn't supply explainability output |
| `src/modules/satellite` | `GET /scenes` — proxies a configured STAC catalog; returns an explicit `"unavailable"` payload (not demo scenes) if `SATELLITE_STAC_URL` isn't set |
| `src/modules/map-configurations` | Save/list/delete named layer-toggle configurations. Layer visibility itself is UI state and is never auto-persisted |
| `src/modules/analyses` (extended) | `POST /region` (validates the drawn polygon + area limit, queues a `REGION_SCAN` job), `GET /:id/status`, `GET /:id/result` |
| `src/workers/analysisWorker.ts` (extended) | Handles the `run-region-analysis` job: calls `GEOSPATIAL_ENGINE_URL`, persists a `ProspectivityZone` + `resultPayload` (spectral/geology/terrain indicators). Fails the job explicitly, with no fabricated result, if that service isn't configured |

### Why `ProspectivityZone` is a separate model from `Zone`

The task spec requires that documented mines/occurrences and AI-predicted
areas "must never be represented as the same data type." `Zone` (documented,
via `/api/mining/*`) and `ProspectivityZone` (AI prediction, via
`/api/prospectivity/*`) are different Prisma models with different response
shapes — there is no code path that can accidentally merge them.

### New environment variables

See `.env.example` for the full list (`NOMINATIM_*`, `SATELLITE_STAC_URL`,
`GEOSPATIAL_ENGINE_URL`, the optional per-layer source URLs, and
`MAX_REGION_ANALYSIS_AREA_KM2`). All satellite/geology/elevation/spectral/
historical layers report `"unavailable"` from `GET /api/geospatial/layers`
until their corresponding URL is set — nothing is turned on by default.

### Database migration

This pass only edits `prisma/schema.prisma` — it does not include a
hand-written SQL migration, because generating one correctly requires the
Prisma engine binaries (blocked in the sandbox this was built in). Run the
normal flow against a real Postgres+PostGIS instance:

```bash
npx prisma migrate dev --name explore_geospatial_backend
npx ts-node prisma/seed.ts   # optional — reseeds demo zones with the new provenance fields
```

## Projects / AI Action Center (`/api/actions`)

The Projects page is backed by persistent, org-scoped action plans,
recommendations, decision factors and actions. The AI/decision engine is an
external dependency configured with `AI_ENGINE_URL`; the backend never invents
production, weather, risk, prospectivity or operational values.

| Endpoint | Responsibility |
|---|---|
| `POST /api/actions/action-plans/generate` | Persist a sourced action-plan request and enqueue asynchronous generation |
| `GET /api/actions/action-plans/:id` | Read plan status, recommendations, factors and linked actions |
| `GET /api/actions/action-plans/:id/factors` | Read the actual contributing decision factors |
| `GET /api/actions/recommendations` | List persisted recommendations with org scoping and filters |
| `GET /api/actions` | List persistent action queue items |
| `POST /api/actions/:id/approve` | Human approval; audited |
| `POST /api/actions/:id/reject` | Human rejection; audited |
| `POST /api/actions/:id/schedule` | Schedule an approved/pending action; audited |
| `POST /api/actions/:id/complete` | Record completion/execution result; audited |

Every supplied context object must contain a `source` field. The worker sends
those contexts to `AI_ENGINE_URL/v1/action-plans/generate` and validates the
response before persisting it. The response must include model version,
confidence, supporting evidence, decision factors and recommendations. If the
engine is unavailable or returns invalid data, the Action Plan is marked
`FAILED` and no recommendations/actions are created.

Run the worker alongside the API:

```bash
npm run worker
```

Before using the new schema in a real database, run:

```bash
npx prisma migrate dev --name projects_action_center
npx prisma generate
```

## Reports backend

Reports are persisted in PostgreSQL and generated asynchronously through the `report-jobs` BullMQ queue. Each generated version stores immutable analysis/model/data/content snapshots plus a SHA-256 checksum. PDFs are written to `REPORT_STORAGE_DIR` by the included storage adapter; the adapter can be replaced with S3/object storage without changing the report API.

Run the API and worker separately:

```bash
npm run dev
npm run worker
```

After changing `prisma/schema.prisma`, run `npx prisma generate` and `npx prisma migrate dev` against PostgreSQL/PostGIS.

## Settings service

- `GET /api/settings` returns organization and user settings plus write permissions.
- `PATCH /api/settings` validates forecast horizon (30/60/90), thresholds (0-100), mine ownership, units, timezone, notification preferences and default model permissions.
- `GET /api/mines`, `GET /api/mines/:id` are readable by authenticated users; mine create/update is `ADMIN` only.
- `GET /api/system/status` returns real probe state for database, AI engine, geospatial engine, satellite pipeline, forecasting, report generation and storage. Missing probes are never presented as operational.
- Setting changes are audited with old/new values and optional reason.
- The prospectivity threshold is used by dashboard high-prospectivity counts/top zones and hotspot queries. Action-plan generation receives the current risk/prospectivity thresholds and forecast horizon as backend configuration context.

## Production Intelligence

Production intelligence is served by `/api/production` and uses persisted `ProductionRecord` data. The frontend no longer uses its former `scenario()` calculation as a production source of truth.

Endpoints:
- `GET /api/production/history?mineId=...&startDate=...&endDate=...&granularity=daily`
- `POST /api/production/history?mineId=...` (ADMIN/MANAGER ingestion; provenance is required)
- `POST /api/production/forecast`
- `GET /api/production/forecast/:id`
- `POST /api/production/scenario`
- `POST /api/production/forecast/:id/report`

Forecast generation is asynchronous through the `production-forecast-jobs` worker. The built-in forecasting baseline is a transparent backend statistical model using observed production history; it does not invent missing operational data. A forecast requires at least 7 observed production records. If planned production is unavailable, target/shortfall are returned as unavailable rather than fabricated.

## Authentication & Authorization

MN25 now uses persistent, revocable HTTP-only session cookies rather than browser-stored authentication tokens.

Endpoints:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/refresh`
- `GET /api/auth/me`

The authenticated organization is derived exclusively from the server-side `AuthSession`. Client-supplied `organizationId` values are never used to establish tenancy.

Roles and permissions:

- `RESEARCHER`: `exploration.read`, `analysis.run`, `reports.generate`
- `OPERATOR`: `operational.read`, `production.read`, `risk.read`
- `MANAGER`: operator permissions plus `actions.approve`, `actions.schedule`, `operational.analytics`
- `ADMIN`: all permissions plus `users.manage`, `settings.manage`, `organization.manage`, `data.upload`, `audit.read`

Admin user management is exposed under `/api/users`. Role and mine-membership changes create audit events. Deactivating a user revokes their active sessions.

Every non-authenticated API request is rejected by the application-level session middleware; sensitive operations additionally enforce explicit permissions/roles in their module routes. Cookie-authenticated state changes validate the request origin, and login failures are rate-limited per email/IP pair.

Authentication audit events include registration, login, logout, failed login, permission changes, setting changes, action approvals, report downloads, analysis execution, and data uploads. Passwords and session tokens are never written to audit metadata.

## Data ingestion pipeline

Dataset APIs are tenant-scoped and require an authenticated session. Dataset creation/validation/processing requires the `data.upload` permission.

```text
POST /api/datasets
GET  /api/datasets
GET  /api/datasets/:id
POST /api/datasets/:id/validate
POST /api/datasets/:id/process
GET  /api/datasets/:id/provenance
GET  /api/datasets/:id/spatial
```

`POST /api/datasets` accepts `multipart/form-data` with an optional `file` plus metadata. `sourceUrl` must identify the authoritative provider/source. Uploaded files are checksummed with SHA-256 and stored under `DATASET_STORAGE_DIR`; production deployments should mount this path to durable object-backed storage.

Dataset processing runs through the BullMQ `dataset-ingestion-jobs` worker. GeoJSON FeatureCollections/Features are materialized into PostGIS `DatasetGeometry` rows with a GiST index. CSV/JSON records receive schema, coordinate, duplicate, missing-value, range, and geometry checks. A dataset is only marked `ready` after successful validation and processing; metadata-only source URLs cannot be marked ready without ingested content.

Every analysis job is linked to immutable `DatasetVersion` rows. If an analysis request omits explicit dataset IDs, the backend selects the latest READY dataset for each available dataset type in the authenticated organization. If no authoritative READY dataset exists, the analysis is rejected rather than running against seed/fabricated data.

## MN25 ML prospectivity

The production ML service is exposed under `/api/ml` and is backed by the Python `../ml_engine` package. Training is hard-gated on `DATASET_READINESS_REPORT.md` reporting `READY`. No frontend prospectivity formula is accepted as a training label or production model.

Lifecycle: `TRAINED -> VALIDATED -> REVIEW -> APPROVED -> PRODUCTION`.

## Demo login

For local/demo deployments, provision the requested demo account with:

```bash
npm run prisma:seed-demo
```

Credentials:
- Email: `example@gmail.com`
- Password: `12345678`
- Organisation: `kmclu`

The account is created/updated as an `ADMIN` in the `ORGANIZATION` environment. The organization value is provisioned in the database; the current login API authenticates by email/password and scopes the resulting session to that organization. Do not use these credentials in a public or production deployment.
