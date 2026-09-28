# MN25 ML Implementation Status

## Current gate

**TRAINING BLOCKED — DATASET INVALID**

The data-engineering package currently reports the authoritative pilot dataset as `BLOCKED`. The ML system therefore refuses to train and has produced no model artifacts, predictions, GeoTIFF, or GeoJSON.

## Implemented

- canonical dataset validation gate
- spatial block train/validation/test splitting
- Random Forest baseline
- XGBoost comparison adapter
- SVM comparison adapter
- ROC-AUC / PR-AUC / precision / recall / F1 / specificity / sensitivity / Brier metrics
- calibration reporting
- ensemble uncertainty when supported
- feature-space applicability/domain scoring
- SHAP explainability adapter
- experiment registry
- training-run registry
- immutable model-version metadata
- explicit model promotion lifecycle
- prediction registry API
- prediction provenance API
- async BullMQ ML queue
- object-storage artifact integration
- AI Analysis integration gate
- Explore prospectivity filtering to production ML models
- fail-safe unavailable states
- no concentration regression without assays

## Not produced because the gate is blocked

- trained baseline model files
- model comparison results from real data
- spatial validation metrics from real data
- calibrated production model
- prediction GeoTIFF
- prediction GeoJSON
- production prediction records

These outputs must not be fabricated.
