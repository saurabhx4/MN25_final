from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from canonical import REQUIRED

def test_canonical_contract_is_explicit():
    assert 'label_type' in REQUIRED
    assert 'source_record_id' in REQUIRED
    assert 'spatial_block' in REQUIRED
    assert 'feature_version' in REQUIRED

def test_no_fake_mn_feature():
    assert 'mn_prospectivity_score' not in REQUIRED
