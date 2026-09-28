from __future__ import annotations
import argparse, pathlib, json, os
from common import ROOT, DATA, load_yaml, utcnow, write_json

def status_for(path): return 'READY' if path.exists() and any(path.iterdir()) else 'UNAVAILABLE'

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--config',default=str(ROOT/'data_pipeline/config/pipeline.yaml')); a=ap.parse_args(); cfg=load_yaml(pathlib.Path(a.config))
    sources=[
      ('manganese_occurrences_gsi',DATA/'raw/manganese_occurrences','Geological Survey of India / OGD India',cfg['gsi_occurrences']['catalog_url'],'GSI occurrence/deposit records'),
      ('sentinel2_l2a',DATA/'raw/sentinel2','Copernicus Data Space','https://documentation.dataspace.copernicus.eu/Data/SentinelMissions/Sentinel2.html','Surface reflectance + SCL'),
      ('dem_copernicus_glo30',DATA/'raw/dem','Copernicus Data Space','https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM','30 m DSM'),
      ('geology_gsi_ngdr',DATA/'raw/geology','GSI/NGDR','https://geodataindia.gov.in/','Lithology/formation/contacts'),
      ('controlled_background',DATA/'labels/background','Derived from authoritative positives + configured distance rules','', 'Negative/background samples'),
    ]
    rows=[]
    for name,path,source,url,desc in sources:
      st=status_for(path); rows.append({'dataset':name,'source':source,'URL':url,'coverage':'Central Indian pilot AOI' if st=='READY' else 'UNAVAILABLE','resolution':'see manifest' if st=='READY' else 'UNAVAILABLE','number_of_records':None,'temporal_coverage':'see manifest' if st=='READY' else 'UNAVAILABLE','spatial_coverage':'see manifest' if st=='READY' else 'UNAVAILABLE','missingness':'not evaluated' if st=='UNAVAILABLE' else 'see QC','quality':'not evaluated' if st=='UNAVAILABLE' else 'see QC','label_count':None,'positive_count':None,'negative_count':None,'limitations':'Acquisition/validation not completed' if st=='UNAVAILABLE' else 'see QC','recommended_use':'Do not use for ML' if st=='UNAVAILABLE' else 'eligible subject to QC','status':st})
    critical=[r for r in rows if r['dataset'] in {'manganese_occurrences_gsi','sentinel2_l2a','dem_copernicus_glo30','geology_gsi_ngdr'}]
    overall='READY' if all(r['status']=='READY' for r in critical) else 'BLOCKED'
    out=DATA/'reports/dataset_readiness/DATASET_READINESS_REPORT.md'; out.parent.mkdir(parents=True,exist_ok=True)
    md=['# MN25 Dataset Readiness Report','',f'Generated: {utcnow()}','',f'## Overall status: **{overall}**','']
    if overall=='BLOCKED': md+=['The baseline is **not ready for ML training**. No missing source has been replaced with fabricated data. Acquire and validate every critical dataset before training.','']
    md+=['| dataset | source | status | recommended use |','|---|---|---|---|']
    for r in rows: md.append(f"| {r['dataset']} | {r['source']} | {r['status']} | {r['recommended_use']} |")
    md+=['','## Critical blockers','']
    for r in critical:
      if r['status']!='READY': md.append(f"- **{r['dataset']}**: unavailable in this execution environment; see acquisition configuration and provenance requirements.")
    md+=['','## Scientific safeguards','- No deterministic MN25 prospectivity score is used as a label.','- Occurrence points remain occurrence labels; no blanket pixel expansion is performed.','- Background sampling is distance-controlled and deterministic.','- Spatial blocks are assigned before any future ML split.','- Sentinel-2 processing uses numerical L2A reflectance, not screenshots or map tiles.','- Every derived feature must reference source bands and feature-engineering version.','- Restricted raw data are never committed; only manifests and checksums are intended for version control.','']
    out.write_text('\n'.join(md),encoding='utf-8')
    write_json(DATA/'metadata/quality/readiness.json',{'generated_at':utcnow(),'overall_status':overall,'datasets':rows})
    print(out)

if __name__=='__main__': main()
