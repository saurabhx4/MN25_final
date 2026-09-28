# MN25 ML Training Readiness Report

Generated: 2026-09-25

## Status

**TRAINING BLOCKED — DATASET INVALID**

The authoritative data-engineering readiness report currently reports `BLOCKED`. The ML engine therefore did not train, serialize, or promote any model.

## Required baseline

- GSI/NGDR manganese occurrences: unavailable
- Sentinel-2 L2A: unavailable
- Copernicus DEM GLO-30: unavailable
- GSI/NGDR geology: unavailable
- Controlled background labels: unavailable because authoritative positives are unavailable

## Safeguard

No frontend deterministic prospectivity score, synthetic satellite value, synthetic geological value, random label, or copied prediction was used.

## Next execution gate

Training becomes eligible only when the data-engineering report contains:

`Overall status: **READY**`

and the canonical training table passes schema, geometry, duplicate, label, feature-missingness, and spatial-block validation.
