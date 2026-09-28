from __future__ import annotations
import json, pathlib, numpy as np, pandas as pd

def spectral_registry():
    return [
      {'feature_name':'B2','formula':'raw reflectance','source_bands':['B2'],'description':'Blue surface reflectance','version':'spectral-v1'},
      {'feature_name':'B3','formula':'raw reflectance','source_bands':['B3'],'description':'Green surface reflectance','version':'spectral-v1'},
      {'feature_name':'B4','formula':'raw reflectance','source_bands':['B4'],'description':'Red surface reflectance','version':'spectral-v1'},
      {'feature_name':'B5','formula':'raw reflectance','source_bands':['B5'],'description':'Red-edge 1','version':'spectral-v1'},
      {'feature_name':'B6','formula':'raw reflectance','source_bands':['B6'],'description':'Red-edge 2','version':'spectral-v1'},
      {'feature_name':'B7','formula':'raw reflectance','source_bands':['B7'],'description':'Red-edge 3','version':'spectral-v1'},
      {'feature_name':'B8','formula':'raw reflectance','source_bands':['B8'],'description':'NIR','version':'spectral-v1'},
      {'feature_name':'B8A','formula':'raw reflectance','source_bands':['B8A'],'description':'Narrow NIR','version':'spectral-v1'},
      {'feature_name':'B11','formula':'raw reflectance','source_bands':['B11'],'description':'SWIR 1','version':'spectral-v1'},
      {'feature_name':'B12','formula':'raw reflectance','source_bands':['B12'],'description':'SWIR 2','version':'spectral-v1'},
      {'feature_name':'NDVI','formula':'(B8-B4)/(B8+B4)','source_bands':['B8','B4'],'description':'Normalized Difference Vegetation Index; contextual, not a manganese label','version':'spectral-v1'},
      {'feature_name':'NDMI','formula':'(B8-B11)/(B8+B11)','source_bands':['B8','B11'],'description':'Normalized Difference Moisture Index','version':'spectral-v1'},
      {'feature_name':'SWIR_ratio_B11_B12','formula':'B11/B12','source_bands':['B11','B12'],'description':'SWIR ratio','version':'spectral-v1'},
    ]

def write_feature_registry(path):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps({'feature_registry_version':'spectral-v1','features':spectral_registry()},indent=2)+'\n')
