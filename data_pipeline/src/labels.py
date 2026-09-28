from __future__ import annotations
import pandas as pd, geopandas as gpd
from shapely.geometry import Point

def controlled_background(positive_path, aoi_path, out_path, min_distance_m=5000, max_distance_m=50000, seed=20260925):
    """Create background points only after authoritative positive labels exist.
    Uses a deterministic grid and distance filter; it never assigns random labels to pixels.
    """
    pos=gpd.read_file(positive_path).to_crs('EPSG:32644')
    aoi=gpd.read_file(aoi_path).to_crs('EPSG:32644')
    if pos.empty: raise RuntimeError('No positive occurrence labels available.')
    grid=aoi.iloc[0].geometry
    minx,miny,maxx,maxy=grid.bounds
    import numpy as np
    pts=[]
    step=1000
    xs=np.arange(minx,maxx+step,step); ys=np.arange(miny,maxy+step,step)
    union=pos.geometry.unary_union
    for x in xs:
      for y in ys:
        p=Point(float(x),float(y))
        if not grid.contains(p): continue
        d=p.distance(union)
        if min_distance_m <= d <= max_distance_m: pts.append((p,d))
    if not pts: raise RuntimeError('No controlled background candidates satisfy distance constraints.')
    pts=pts[::max(1,len(pts)//5000 or 1)]
    out=gpd.GeoDataFrame({'sample_id':[f'bg-{i:06d}' for i in range(len(pts))], 'label':[0]*len(pts), 'label_type':['controlled_background']*len(pts), 'distance_to_positive_m':[d for _,d in pts], 'sampling_method':['deterministic_grid_distance_band']*len(pts)},geometry=[p for p,_ in pts],crs='EPSG:32644').to_crs('EPSG:4326')
    out.to_file(out_path,driver='GeoJSON')
    return len(out)
