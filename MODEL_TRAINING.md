# Model Training

## Classification

Target: `label`, where 1 is verified occurrence evidence and 0 is controlled background. This is prospectivity evidence classification, not laboratory ore confirmation.

Algorithms:

- Random Forest baseline
- XGBoost when installed
- SVM

Features are sourced only from the canonical dataset and its documented feature registry.

Spatial blocks are assigned before splitting. Train/validation/test blocks never overlap.

## Regression

Mn concentration regression is intentionally disabled until verified laboratory/assay measurements exist. Prospectivity is never substituted for concentration.
