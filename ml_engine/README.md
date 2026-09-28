# MN25 ML Engine

This is the production ML layer for manganese prospectivity. It consumes the canonical dataset from `../data_pipeline` and refuses to train when `DATASET_READINESS_REPORT.md` is not READY.

It does not generate labels, substitute demo prospectivity scores, or infer Mn concentration from prospectivity.

## Training

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python -m src.train --dataset ../data/training/classification/canonical_training.parquet --readiness ../data/reports/dataset_readiness/DATASET_READINESS_REPORT.md --dataset-version manganese-pilot-v1 --feature-version spectral-v1
```

Training uses spatial blocks, compares Random Forest, XGBoost (when installed), and SVM, records calibration and regional/block metrics, and never auto-promotes a model.
