# MN25 Dataset Readiness Report

Generated: 2026-09-25T10:28:49Z

## Overall status: **BLOCKED**

The baseline is **not ready for ML training**. No missing source has been replaced with fabricated data. Acquire and validate every critical dataset before training.

| dataset | source | status | recommended use |
|---|---|---|---|
| manganese_occurrences_gsi | Geological Survey of India / OGD India | UNAVAILABLE | Do not use for ML |
| sentinel2_l2a | Copernicus Data Space | UNAVAILABLE | Do not use for ML |
| dem_copernicus_glo30 | Copernicus Data Space | UNAVAILABLE | Do not use for ML |
| geology_gsi_ngdr | GSI/NGDR | UNAVAILABLE | Do not use for ML |
| controlled_background | Derived from authoritative positives + configured distance rules | UNAVAILABLE | Do not use for ML |

## Critical blockers

- **manganese_occurrences_gsi**: unavailable in this execution environment; see acquisition configuration and provenance requirements.
- **sentinel2_l2a**: unavailable in this execution environment; see acquisition configuration and provenance requirements.
- **dem_copernicus_glo30**: unavailable in this execution environment; see acquisition configuration and provenance requirements.
- **geology_gsi_ngdr**: unavailable in this execution environment; see acquisition configuration and provenance requirements.

## Scientific safeguards
- No deterministic MN25 prospectivity score is used as a label.
- Occurrence points remain occurrence labels; no blanket pixel expansion is performed.
- Background sampling is distance-controlled and deterministic.
- Spatial blocks are assigned before any future ML split.
- Sentinel-2 processing uses numerical L2A reflectance, not screenshots or map tiles.
- Every derived feature must reference source bands and feature-engineering version.
- Restricted raw data are never committed; only manifests and checksums are intended for version control.
