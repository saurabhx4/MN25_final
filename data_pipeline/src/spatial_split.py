from __future__ import annotations
import geopandas as gpd, numpy as np

def make_spatial_splits(training_geojson, out_csv, block_size_m=10000, seed=20260925):
    gdf=gpd.read_file(training_geojson).to_crs('EPSG:32644')
    if gdf.empty: raise RuntimeError('Training table is empty.')
    cent=gdf.geometry.centroid
    gdf['block_x']=np.floor(cent.x/block_size_m).astype(int)
    gdf['block_y']=np.floor(cent.y/block_size_m).astype(int)
    gdf['spatial_block_id']=gdf.block_x.astype(str)+'_'+gdf.block_y.astype(str)
    blocks=np.array(sorted(gdf.spatial_block_id.unique()))
    rng=np.random.default_rng(seed); rng.shuffle(blocks)
    n=len(blocks); a=max(1,int(n*.6)); b=max(a+1,int(n*.8)) if n>=3 else n
    mapping={blk:('train' if i<a else 'validation' if i<b else 'test') for i,blk in enumerate(blocks)}
    gdf['split_id']=gdf.spatial_block_id.map(mapping); gdf['split_type']=gdf.split_id
    gdf.drop(columns=['geometry','block_x','block_y']).to_csv(out_csv,index=False)
    return {'blocks':len(blocks),'records':len(gdf),'splits':gdf.split_type.value_counts().to_dict()}
