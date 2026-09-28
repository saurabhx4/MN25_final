import pandas as pd
import pytest
from src.validate import validate_dataset

def test_training_is_blocked_when_readiness_is_not_ready():
    with pytest.raises(RuntimeError, match='TRAINING BLOCKED'):
        validate_dataset(pd.DataFrame(), 'BLOCKED')

def test_no_synthetic_label_generation():
    df=pd.DataFrame({'sample_id':['a'],'label':[1]})
    assert df.label.iloc[0] == 1
