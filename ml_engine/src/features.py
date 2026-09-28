from __future__ import annotations
import numpy as np
import pandas as pd
from .config import BASE_FEATURES

def add_derived_features(df: pd.DataFrame) -> pd.DataFrame:
    out=df.copy()
    def ratio(a,b):
        den=out[a]+out[b]
        return np.where(np.abs(den)>1e-12,(out[a]-out[b])/den,np.nan)
    out['NDVI']=ratio('B8','B4')
    out['NDMI']=ratio('B8','B11')
    out['SWIR_ratio_B11_B12']=np.where(np.abs(out['B12'])>1e-12,out['B11']/out['B12'],np.nan)
    # Optional derived terrain/structure fields are only used when supplied by the validated dataset.
    for c in ['terrain_ruggedness','curvature','distance_to_contact','structural_density']:
        if c not in out: out[c]=np.nan
    return out

def feature_columns(df):
    derived=['NDVI','NDMI','SWIR_ratio_B11_B12','terrain_ruggedness','curvature','distance_to_contact','structural_density']
    numeric=[c for c in BASE_FEATURES+derived if c in df.columns]
    categorical=[c for c in ['geology','formation','state','district'] if c in df.columns]
    return numeric,categorical
