# MN25 Unified Backend

This archive consolidates the existing MN25 services behind a canonical, organization-scoped domain graph while preserving existing frontend API contracts.

## Canonical entities

Organization → User / Mine / Dataset / Analysis / Report / Action
Mine → MiningArea / Production / Risk / Analysis / Forecast
Analysis → Region geometry / DatasetVersions / ModelVersion / Prediction / AnalysisResult / explainability
Prediction → Model / ModelVersion / DatasetVersions / geometry / confidence / uncertainty
Report → immutable ReportVersions

Legacy specialized records remain during migration, but new analysis/model/prediction flows synchronize into the canonical graph.

## Provenance

- `GET /api/domain/analyses/:id/provenance`
- `GET /api/domain/predictions/:id/provenance`
- `GET /api/domain/organizations/me/graph`

A prediction provenance response identifies the exact model version, dataset versions/checksums, geometry, timestamp, confidence, uncertainty and explainability output when available.

## Security

- HTTP-only authenticated sessions
- organization derived from session
- explicit role/permission checks
- organization-scoped database queries
- audit logging for security-sensitive operations
- no authentication token in localStorage

## Data integrity

- Dataset versions are immutable
- processing is asynchronous through BullMQ/Redis
- PostGIS geometry is used for stored spatial data
- unavailable data is returned explicitly rather than fabricated
- production predictions require deployed model versions

## Storage

Dataset files use the `ObjectStorage` abstraction. Local object storage is used by default; deployments can replace the adapter with S3/R2/MinIO without changing domain services.

## API documentation

`GET /api/openapi.json`

## Migration

Apply the new migration after the previous MN25 migrations:

`20260925180000_canonical_domain_graph`

Then:

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
npm test
```

For local development:

```bash
npm run dev
npm run worker
```

The environment must provide PostgreSQL/PostGIS, Redis and the configured external inference/geospatial providers for real AI results. The backend never creates synthetic production predictions merely to satisfy a request.
