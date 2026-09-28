# MN25 Source Research Notes

## GSI manganese occurrences

The OGD catalog identifies **Location of Manganese Ore Deposits in India and its Salient Features** as a Geological Survey of India / Ministry of Mines dataset. It describes locality, state, toposheet, latitude/longitude, host rock and geological formation attributes. The catalog was published in 2013 and updated in 2014.

Official catalog: https://www.data.gov.in/catalog/location-manganese-ore-deposits-india-and-its-salient-features
Official resource: https://www.data.gov.in/resource/location-manganese-ore-deposits-india-and-its-salient-features
NGDR: https://geodataindia.gov.in/

The OGD catalog exposes a Catalog API entry but the actual API requires an API key/resource identifier. The pipeline therefore refuses to substitute third-party labels when access is unavailable.

## Sentinel-2

Copernicus Data Space provides a STAC catalogue and Sentinel-2 Level-2A collection. The pipeline uses the `sentinel-2-l2a` collection and requires numerical surface-reflectance assets plus the Scene Classification Layer. It does not use screenshots, web map tiles, or JPEG imagery as ML inputs.

STAC: https://stac.dataspace.copernicus.eu/v1/
Sentinel-2 documentation: https://documentation.dataspace.copernicus.eu/Data/SentinelMissions/Sentinel2.html

## Copernicus DEM

Copernicus DEM GLO-30 is a worldwide 30 m product. Access/download eligibility and licensing must be respected; the pipeline records the selected product/version rather than silently substituting another DEM.

Official: https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM

## Methodological reference

Singh et al., *Earth observation approach for targeting stratiform deposit of manganese in central India*, Advances in Space Research (2023), DOI 10.1016/j.asr.2023.03.044. The paper discusses Sentinel-2, ASTER, structural information and geological integration for the Balaghat manganese belt. MN25 uses it only as methodological context and does not copy its model or labels.

https://www.sciencedirect.com/science/article/pii/S0273117723002454

## Important distinction

The GSI occurrence dataset is an occurrence/deposit inventory. An occurrence point is **not** treated as a confirmed ore boundary, nor are neighboring pixels automatically labeled positive. Concentration labels require independent laboratory/field sample records.
