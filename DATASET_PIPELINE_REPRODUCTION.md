# MN25 Dataset Pipeline Reproduction

1. Configure `data_pipeline/config/pipeline.yaml` and review `pilot_aoi.geojson`.
2. Obtain permitted credentials/access for GSI OGD/NGDR and Copernicus Data Space.
3. Run the pipeline with the pinned environment dependencies.
4. Preserve raw source products unchanged under `data/raw/`.
5. Generate deterministic SCL masks, band alignment, spectral features, DEM features and geology/structure features.
6. Import only authoritative manganese occurrence records as positive occurrence labels.
7. Generate controlled background samples only after positives exist; record distance rules.
8. Build the canonical training table only from validated inputs.
9. Assign spatial blocks before any model split; never random-pixel split neighboring pixels.
10. Record checksums, source IDs, acquisition dates, processing version and feature version.
11. Run QC and inspect `DATASET_READINESS_REPORT.md`.
12. Stop if the report is `BLOCKED` or any critical source is `UNAVAILABLE`.

The final ML model must not be trained until the report states the critical baseline datasets are READY.
