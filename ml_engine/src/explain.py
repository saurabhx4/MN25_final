from __future__ import annotations
import numpy as np

def explain_tree_model(model_pipeline, rows, top_k=10):
    model=model_pipeline.named_steps['model']; pre=model_pipeline.named_steps['pre']; x=pre.transform(rows)
    if hasattr(x,'toarray'): x=x.toarray()
    feature_names=pre.get_feature_names_out().tolist()
    try:
        import shap
        explainer=shap.TreeExplainer(model)
        vals=explainer.shap_values(x)
        if isinstance(vals,list): vals=vals[-1]
        vals=np.asarray(vals)
        mean=np.mean(vals,axis=0)
        idx=np.argsort(np.abs(mean))[::-1][:top_k]
        return [{'feature':feature_names[i],'contribution':float(mean[i])} for i in idx]
    except Exception:
        # Explainability is explicitly unavailable rather than fabricated if SHAP cannot run.
        return []
