from __future__ import annotations
import os, pathlib, zipfile, io, requests, pandas as pd, geopandas as gpd
from shapely.geometry import Point
from common import DATA, ROOT, write_json, utcnow

GSI_RESOURCE = "https://www.data.gov.in/resource/location-manganese-ore-deposits-india-and-its-salient-features"

def download_gsi(config):
    out = DATA / "raw/manganese_occurrences"
    out.mkdir(parents=True, exist_ok=True)
    api_id = config.get('gsi_occurrences',{}).get('api_resource_id','')
    key_env = config.get('gsi_occurrences',{}).get('api_key_env','DATA_GOV_IN_API_KEY')
    key = os.getenv(key_env)
    if not api_id or not key:
        raise RuntimeError("GSI occurrence data is UNAVAILABLE for automated download: provide DATA_GOV_IN_API_KEY and the API resource UUID from the OGD catalog. No substitute labels are generated.")
    url = f"https://api.data.gov.in/resource/{api_id}"
    params = {'api-key': key, 'format':'json','limit':10000}
    r=requests.get(url,params=params,timeout=60)
    r.raise_for_status()
    payload=r.json()
    records=payload.get('records',[])
    if not records:
        raise RuntimeError('GSI OGD API returned zero records; dataset remains unavailable.')
    raw=out/'gsi_manganese_occurrences_raw.json'
    raw.write_text(r.text,encoding='utf-8')
    rows=[]
    for i,x in enumerate(records):
        # Do not assume field names: normalize only recognized aliases.
        def pick(*names):
            for n in names:
                if n in x and x[n] not in (None,''):
                    return x[n]
            return None
        lat=pick('latitude','Latitude','LATITUDE','lat')
        lon=pick('longitude','Longitude','LONGITUDE','lon')
        if lat is None or lon is None: continue
        try: lat=float(str(lat).replace('°','').strip()); lon=float(str(lon).replace('°','').strip())
        except ValueError: continue
        rows.append({
            'label_id': f"gsi-{i:06d}",
            'latitude':lat,'longitude':lon,
            'deposit_name':pick('locality','Locality','deposit','Deposit'),
            'locality':pick('locality','Locality'),'district':pick('district','District'),
            'state':pick('state','State'),'commodity':'manganese',
            'host_rock':pick('host_rock','Host Rock','host rock'),
            'geological_formation':pick('formation','Formation','stratigraphic position'),
            'source':'Geological Survey of India / OGD India',
            'source_url':GSI_RESOURCE,'source_record_id':pick('id','ID','record_id') or f'gsi-{i:06d}',
            'verification_status':'authoritative_source_record'
        })
    if not rows: raise RuntimeError('GSI records were present but no valid coordinates were found.')
    df=pd.DataFrame(rows)
    df.to_csv(out/'gsi_manganese_occurrences_v1.csv',index=False)
    gdf=gpd.GeoDataFrame(df,geometry=[Point(x,y) for x,y in zip(df.longitude,df.latitude)],crs='EPSG:4326')
    gdf.to_file(out/'gsi_manganese_occurrences_v1.geojson',driver='GeoJSON')
    write_json(out/'manifest.json',{
      'dataset_id':'manganese_occurrences_gsi','version':'v1','source':'Geological Survey of India / OGD India',
      'source_url':GSI_RESOURCE,'license':'Government Open Data License - India (verify current terms)',
      'ingestion_date':utcnow(),'record_count':len(df),'coordinate_crs':'EPSG:4326',
      'notes':'Occurrence/deposit records are labels for known occurrences only; no pixel expansion is performed.'})
    return len(df)
