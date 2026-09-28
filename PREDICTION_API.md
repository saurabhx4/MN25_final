# Prediction API

- `POST /api/ml/train` — queue a training experiment; requires ML training permission and READY dataset.
- `GET /api/ml/models` — list ML model versions and lifecycle state.
- `GET /api/ml/models/:id` — model details.
- `GET /api/ml/experiments` — experiment registry.
- `POST /api/ml/predict` — queue a geospatial prediction using a PRODUCTION model version.
- `GET /api/ml/predictions/:id` — prediction/provenance record.
- `GET /api/ml/predictions/:id/explanation` — explanation payload.
- `GET /api/ml/predictions/:id/uncertainty` — uncertainty/applicability/data-quality payload.
- `GET /api/ml/predictions/:id/map` — prediction geometry/map artifact metadata.

All endpoints are organization-scoped by authenticated session.
