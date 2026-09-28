# MN25 ML Architecture

MN25 ML is a separate Python inference/training engine behind the Node API. React never computes production prospectivity.

```text
MN25 UI
  -> /api/ml
  -> BullMQ ml-jobs
  -> Python ML engine
  -> validated canonical dataset
  -> spatial feature pipeline
  -> model artifact
  -> PostgreSQL/PostGIS prediction registry
  -> object storage for artifacts/COGs/GeoJSON
  -> Explore / AI Analysis / Reports
```

Training is gated by the data-engineering readiness report. Missing authoritative inputs cause a hard BLOCKED state.

The production lifecycle is:

`TRAINED -> VALIDATED -> REVIEW -> APPROVED -> PRODUCTION`

No HTTP request can promote a model based only on training completion.
