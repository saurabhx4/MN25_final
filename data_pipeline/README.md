# MN25 Real Geospatial Dataset Pipeline

This package builds the reproducible, non-fabricated Central Indian manganese prospectivity dataset foundation. It does **not** train the final ML model.

## Design

`raw -> interim -> features/labels -> canonical training table -> spatial splits -> QC -> readiness report`

The pipeline fails closed: unavailable or unauthorized sources are recorded as `UNAVAILABLE` instead of being replaced with invented values.

## Pilot

The default pilot is a configurable Central Indian Sausar-belt AOI covering Balaghat/Bhandara/Nagpur and surrounding context. The default bounding box is stored in `data_pipeline/config/pilot_aoi.geojson`; it is configuration, not an architectural constant.

## Authoritative sources

- GSI/OGD manganese occurrences: https://www.data.gov.in/resource/location-manganese-ore-deposits-india-and-its-salient-features
- NGDR: https://geodataindia.gov.in/
- Copernicus Sentinel-2 L2A: https://documentation.dataspace.copernicus.eu/Data/SentinelMissions/Sentinel2.html
- Copernicus STAC: https://stac.dataspace.copernicus.eu/v1/
- Copernicus DEM GLO-30: https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM
- USGS Spectral Library: https://www.usgs.gov/labs/spectroscopy-lab/usgs-spectral-library

## Required environment

For Copernicus downloads, set `CDSE_CLIENT_ID` and `CDSE_CLIENT_SECRET` for an account permitted to download the selected products. For GSI OGD, set an API key and the resource UUID supplied by the OGD catalog; do not hard-code credentials.

## Commands

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r data_pipeline/requirements.txt
python data_pipeline/src/run_pipeline.py --config data_pipeline/config/pipeline.yaml
```

For an environment without source access, run:

```bash
python data_pipeline/src/readiness.py --config data_pipeline/config/pipeline.yaml
```

It produces `data/reports/dataset_readiness/DATASET_READINESS_REPORT.md` and never fabricates missing datasets.
