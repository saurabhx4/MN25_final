from __future__ import annotations
import numpy as np

def fit(train_x):
    mu=np.nanmean(train_x,axis=0); sd=np.nanstd(train_x,axis=0); sd=np.where(sd<1e-9,1.0,sd)
    return {'mean':mu.tolist(),'std':sd.tolist()}

def score(state,x):
    z=(np.asarray(x)-np.asarray(state['mean']))/np.asarray(state['std'])
    d=np.sqrt(np.nanmean(z*z,axis=1))
    # Thresholds are an applicability heuristic, not a probability.
    level=np.where(d<=1.5,'HIGH_APPLICABILITY',np.where(d<=2.5,'MEDIUM_APPLICABILITY','LOW_APPLICABILITY'))
    return d,level
