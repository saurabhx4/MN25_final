from __future__ import annotations
import json, joblib, numpy as np, pandas as pd
from pathlib import Path
from .features import add_derived_features
from .applicability import score

def predict(artifact_path, rows: pd.DataFrame):
    bundle=joblib.load(artifact_path); model=bundle['model']; cols=bundle['numeric_features']+bundle['categorical_features']
    x=add_derived_features(rows.copy()); p=model.predict_proba(x[cols])[:,1]
    transformed=model.named_steps['pre'].transform(x[cols]); arr=transformed.toarray() if hasattr(transformed,'toarray') else transformed
    dist,app=score(bundle['applicability'],arr)
    # Model uncertainty here is empirical ensemble disagreement when available; otherwise not fabricated.
    mdl=model.named_steps['model']; unc=np.full(len(p),np.nan)
    if hasattr(mdl,'estimators_'):
        probs=np.stack([e.predict_proba(model.named_steps['pre'].transform(x[cols]))[:,1] for e in mdl.estimators_],axis=1)
        unc=np.std(probs,axis=1)
    return pd.DataFrame({'prediction_probability':p,'uncertainty':unc,'applicability':app,'applicability_distance':dist})
