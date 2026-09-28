from __future__ import annotations
import os, requests, json, pathlib
from common import DATA, write_json, utcnow

STAC='https://stac.dataspace.copernicus.eu/v1/search'

def search_sentinel2(config):
    aoi=json.loads((DATA.parent/'data_pipeline/config/pilot_aoi.geojson').read_text())
    geom=aoi['features'][0]['geometry']
    s=config['sentinel2']
    body={'collections':['sentinel-2-l2a'],'intersects':geom,'datetime':f"{s['date_start']}/{s['date_end']}",'query':{'eo:cloud_cover':{'lte':s['max_cloud_cover']}},'limit':100}
    r=requests.post(STAC,json=body,timeout=60); r.raise_for_status(); payload=r.json()
    items=payload.get('features',[])
    out=DATA/'raw/sentinel2'; out.mkdir(parents=True,exist_ok=True)
    write_json(out/'stac_search_v1.json',{'source':STAC,'query':body,'retrieved_at':utcnow(),'item_count':len(items),'items':items})
    if not items: raise RuntimeError('No Sentinel-2 L2A scenes matched the pilot AOI/date/cloud filters.')
    return items

def download_assets(items, config):
    # CDSE assets can require authenticated download. Never silently fall back to screenshots/tiles.
    cid=os.getenv('CDSE_CLIENT_ID'); secret=os.getenv('CDSE_CLIENT_SECRET')
    if not cid or not secret:
        raise RuntimeError('Sentinel-2 asset download is UNAVAILABLE until CDSE_CLIENT_ID/CDSE_CLIENT_SECRET are configured for permitted downloads. STAC metadata has been retained.')
    raise RuntimeError('CDSE authenticated asset downloader is intentionally a separate step; configure the official CDSE download adapter before acquiring raw scenes.')
