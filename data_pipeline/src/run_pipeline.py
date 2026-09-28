from __future__ import annotations
import argparse, pathlib, traceback
from common import ROOT, DATA, load_yaml
from features import write_feature_registry
from readiness import main as readiness_main

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--config',default=str(ROOT/'data_pipeline/config/pipeline.yaml')); args=ap.parse_args(); cfg=load_yaml(pathlib.Path(args.config))
    write_feature_registry(DATA/'metadata/manifests/feature_registry_v1.json')
    failures=[]
    # Acquisition is fail-closed. Each adapter writes metadata only after a successful authoritative acquisition.
    try:
        from sentinel2 import search_sentinel2
        items=search_sentinel2(cfg)
        print(f'Sentinel-2 metadata scenes discovered: {len(items)}')
    except Exception as e:
        failures.append(('sentinel2',str(e)))
    try:
        from gsi_occurrences import download_gsi
        n=download_gsi(cfg); print(f'GSI occurrence records: {n}')
    except Exception as e:
        failures.append(('gsi_occurrences',str(e)))
    # DEM and geology intentionally remain blocked until official download/access adapters are configured.
    readiness_main()
    if failures:
        print('\nAcquisition blockers:')
        for name,msg in failures: print(f'- {name}: {msg}')

if __name__=='__main__': main()
