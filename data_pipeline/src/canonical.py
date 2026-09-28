"""Canonical training-table contract. This module only combines validated sources; it never fabricates values."""
REQUIRED=[
'sample_id','latitude','longitude','geometry','label','label_type','mn_concentration','state','district','geology','formation',
'elevation','slope','aspect','distance_fault','distance_lineament','distance_occurrence','sentinel_scene_id','acquisition_date','cloud_fraction',
'B2','B3','B4','B5','B6','B7','B8','B8A','B11','B12','spectral_features','terrain_features','geology_features','structural_features',
'quality_score','source','source_record_id','spatial_block','dataset_version','feature_version']

def validate_columns(df):
    missing=[c for c in REQUIRED if c not in df.columns]
    if missing: raise ValueError('Canonical training table missing required columns: '+', '.join(missing))
    return True
