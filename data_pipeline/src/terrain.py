"""Deterministic DEM feature generation. Requires a validated DEM raster."""
import numpy as np, rasterio
from rasterio.enums import Resampling

def slope_aspect(dem_path):
    with rasterio.open(dem_path) as src:
        z=src.read(1).astype('float32'); px=abs(src.transform.a); py=abs(src.transform.e)
    dzdy,dzdx=np.gradient(z,py,px)
    slope=np.degrees(np.arctan(np.hypot(dzdx,dzdy)))
    aspect=(np.degrees(np.arctan2(-dzdx,dzdy))+360)%360
    return {'elevation':z,'slope':slope,'aspect':aspect}
