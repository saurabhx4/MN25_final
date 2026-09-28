from __future__ import annotations
import json
from pathlib import Path
import pandas as pd
from .config import REQUIRED, BASE_FEATURES, DERIVED_NUMERIC

def load_table(path: str | Path) -> pd.DataFrame:
    p=Path(path)
    if not p.exists(): raise FileNotFoundError(f'Canonical dataset not found: {p}')
    if p.suffix.lower() in {'.parquet','.geoparquet'}: return pd.read_parquet(p)
    if p.suffix.lower()=='.csv': return pd.read_csv(p)
    raise ValueError('Canonical dataset must be CSV or Parquet/GeoParquet.')

def validate_dataset(df: pd.DataFrame, readiness: str='READY') -> dict:
    if readiness != 'READY': raise RuntimeError('TRAINING BLOCKED — DATASET INVALID: dataset readiness is not READY.')
    missing=[c for c in REQUIRED if c not in df.columns]
    if missing: raise RuntimeError('TRAINING BLOCKED — DATASET INVALID: missing columns: '+', '.join(missing))
    if df.empty: raise RuntimeError('TRAINING BLOCKED — DATASET INVALID: dataset is empty.')
    dup=int(df['sample_id'].duplicated().sum())
    if dup: raise RuntimeError(f'TRAINING BLOCKED — DATASET INVALID: {dup} duplicate sample_id values.')
    badcoord=(~pd.to_numeric(df.latitude,errors='coerce').between(-90,90)) | (~pd.to_numeric(df.longitude,errors='coerce').between(-180,180))
    if int(badcoord.sum()): raise RuntimeError('TRAINING BLOCKED — DATASET INVALID: invalid coordinates.')
    if not set(df.label.dropna().unique()).issubset({0,1}): raise RuntimeError('TRAINING BLOCKED — DATASET INVALID: label must be binary 0/1.')
    if df.label.isna().any(): raise RuntimeError('TRAINING BLOCKED — DATASET INVALID: missing labels.')
    if df.spatial_block.isna().any(): raise RuntimeError('TRAINING BLOCKED — DATASET INVALID: missing spatial blocks.')
    feature_cols=[c for c in BASE_FEATURES+DERIVED_NUMERIC if c in df.columns]
    missing_frac=float(df[feature_cols].isna().mean().mean())
    if missing_frac>0.20: raise RuntimeError(f'TRAINING BLOCKED — DATASET INVALID: feature missingness {missing_frac:.3f} exceeds 0.20.')
    if df.groupby('spatial_block').label.nunique().eq(2).sum()==0: raise RuntimeError('TRAINING BLOCKED — DATASET INVALID: spatial blocks do not provide both classes.')
    return {'rows':len(df),'positive':int((df.label==1).sum()),'negative':int((df.label==0).sum()),'duplicate_count':dup,'feature_missingness':missing_frac,'blocks':int(df.spatial_block.nunique())}
