from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT.parent / 'data'
REPORT = DATA / 'reports' / 'ml'
ARTIFACTS = ROOT / 'artifacts'
CODE_VERSION = 'mn25-ml-1.0.0'
RANDOM_SEED = 20260925
REQUIRED = [
    'sample_id','latitude','longitude','geometry','label','label_type','mn_concentration',
    'state','district','geology','formation','elevation','slope','aspect',
    'distance_fault','distance_lineament','distance_occurrence','sentinel_scene_id',
    'acquisition_date','cloud_fraction','B2','B3','B4','B5','B6','B7','B8','B8A','B11','B12',
    'spectral_features','terrain_features','geology_features','structural_features',
    'quality_score','source','source_record_id','spatial_block','dataset_version','feature_version'
]
BASE_FEATURES = [
    'B2','B3','B4','B5','B6','B7','B8','B8A','B11','B12',
    'elevation','slope','aspect','distance_fault','distance_lineament','distance_occurrence'
]
DERIVED_NUMERIC = ['NDVI','NDMI','SWIR_ratio_B11_B12','terrain_ruggedness','curvature','distance_to_contact','structural_density']
