"""Raster prediction contract. Requires a validated feature stack; never creates one from screenshots or demo values."""
from __future__ import annotations
from pathlib import Path
import numpy as np
import rasterio
from rasterio.shutil import copy as rio_copy

def predict_stack(model_bundle, feature_stack_path: str, output_cog: str):
    src_path=Path(feature_stack_path)
    if not src_path.exists(): raise FileNotFoundError('FEATURE_STACK_UNAVAILABLE')
    with rasterio.open(src_path) as src:
        arr=src.read()
        profile=src.profile.copy(); profile.update(driver='GTiff',tiled=True,compress='deflate',predictor=2,count=3,dtype='float32')
        # The caller must supply a feature-stack whose band order is documented by the feature registry.
        if arr.shape[0] < 1: raise ValueError('FEATURE_STACK_INVALID')
        # Prediction itself is intentionally delegated to the fitted model wrapper in predict.py.
        raise NotImplementedError('Use the production feature extraction adapter to construct model-ready windows before raster inference.')
