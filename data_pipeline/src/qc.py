from __future__ import annotations
import pandas as pd, geopandas as gpd, json, numpy as np

def qc_table(path):
    df=pd.read_csv(path)
    report={'records':len(df),'columns':len(df.columns),'missingness':{},'duplicate_records':int(df.duplicated().sum()),'status':'PASS'}
    for c in df.columns:
        miss=float(df[c].isna().mean())
        if miss: report['missingness'][c]=miss
    if report['duplicate_records']>0: report['status']='REQUIRES_REVIEW'
    return report

def write_qc(report,path):
    path.parent.mkdir(parents=True,exist_ok=True); path.write_text(json.dumps(report,indent=2)+'\n')
