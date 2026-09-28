from __future__ import annotations
import argparse, json, os
from pathlib import Path
import joblib, pandas as pd, numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.calibration import CalibratedClassifierCV
from .config import REPORT,ARTIFACTS,CODE_VERSION,RANDOM_SEED
from .validate import load_table,validate_dataset
from .features import add_derived_features,feature_columns
from .splits import deterministic_block_split,spatial_split
from .models import build_models
from .evaluate import classification_metrics,calibration_summary
from .applicability import fit as fit_applicability

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--dataset',required=True); ap.add_argument('--readiness',required=True); ap.add_argument('--dataset-version',required=True); ap.add_argument('--feature-version',required=True); ap.add_argument('--output',default=str(ARTIFACTS)); args=ap.parse_args()
    readiness=Path(args.readiness).read_text(encoding='utf-8')
    if 'Overall status: **READY**' not in readiness: raise SystemExit('TRAINING BLOCKED — DATASET INVALID')
    df=load_table(args.dataset); summary=validate_dataset(df,'READY'); df=add_derived_features(df)
    train_blocks,val_blocks,test_blocks=deterministic_block_split(df,RANDOM_SEED)
    tr,va,te=spatial_split(df,train_blocks,val_blocks,test_blocks)
    if min(len(tr),len(va),len(te))==0: raise RuntimeError('TRAINING BLOCKED — DATASET INVALID: empty spatial split.')
    numeric,categorical=feature_columns(df)
    pre=ColumnTransformer([('num',Pipeline([('impute',SimpleImputer(strategy='median')),('scale',StandardScaler())]),numeric),('cat',Pipeline([('impute',SimpleImputer(strategy='most_frequent')),('onehot',OneHotEncoder(handle_unknown='ignore'))]),categorical)])
    models=build_models(RANDOM_SEED); results={}; fitted={}
    for name,model in models.items():
        pipe=Pipeline([('pre',pre),('model',model)])
        pipe.fit(tr[numeric+categorical],tr.label)
        p=pipe.predict_proba(va[numeric+categorical])[:,1]
        results[name]={'validation':classification_metrics(va.label,p),'calibration':calibration_summary(va.label,p)}
        # Refit on train+validation after model comparison, preserving test holdout.
        final=Pipeline([('pre',pre),('model',model)])
        final.fit(pd.concat([tr,va])[numeric+categorical],pd.concat([tr,va]).label)
        pt=final.predict_proba(te[numeric+categorical])[:,1]
        results[name]['test']=classification_metrics(te.label,pt)
        results[name]['test_calibration']=calibration_summary(te.label,pt)
        fitted[name]=final
    # No automatic production selection: comparison is recorded and human promotion is required.
    REPORT.mkdir(parents=True,exist_ok=True); ARTIFACTS.mkdir(parents=True,exist_ok=True)
    manifest={'code_version':CODE_VERSION,'dataset_version':args.dataset_version,'feature_version':args.feature_version,'random_seed':RANDOM_SEED,'training_blocks':train_blocks,'validation_blocks':val_blocks,'test_blocks':test_blocks,'dataset_summary':summary,'models':results}
    (REPORT/'MODEL_COMPARISON.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    for name,m in fitted.items():
        joblib.dump({'model':m,'numeric_features':numeric,'categorical_features':categorical,'applicability':fit_applicability(m.named_steps['pre'].transform(pd.concat([tr,va])[numeric+categorical]).toarray() if hasattr(m.named_steps['pre'].transform(pd.concat([tr,va])[numeric+categorical]),'toarray') else m.named_steps['pre'].transform(pd.concat([tr,va])[numeric+categorical]))},ARTIFACTS/f'{name}.joblib')
    (REPORT/'ML_TRAINING_READY.md').write_text('# ML training completed\n\nModels were trained with spatial train/validation/test blocks. No model was automatically promoted to production.\n',encoding='utf-8')
if __name__=='__main__': main()
