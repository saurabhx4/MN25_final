from __future__ import annotations
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.svm import SVC
try:
    from xgboost import XGBClassifier
except Exception:
    XGBClassifier=None

def build_models(seed:int):
    models={
      'random_forest':RandomForestClassifier(n_estimators=400,min_samples_leaf=2,class_weight='balanced_subsample',random_state=seed,n_jobs=-1),
      'svm':SVC(C=2.0,kernel='rbf',probability=True,class_weight='balanced',random_state=seed),
    }
    if XGBClassifier is not None:
        models['xgboost']=XGBClassifier(n_estimators=350,max_depth=5,learning_rate=0.04,subsample=0.85,colsample_bytree=0.85,eval_metric='logloss',random_state=seed,n_jobs=-1)
    return models
