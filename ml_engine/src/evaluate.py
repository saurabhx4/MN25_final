from __future__ import annotations
import numpy as np
from sklearn.metrics import roc_auc_score, average_precision_score, precision_score, recall_score, f1_score, confusion_matrix, brier_score_loss
from sklearn.calibration import calibration_curve

def classification_metrics(y,p):
    pred=(p>=0.5).astype(int)
    tn,fp,fn,tp=confusion_matrix(y,pred,labels=[0,1]).ravel()
    return {'roc_auc':float(roc_auc_score(y,p)) if len(np.unique(y))>1 else None,'pr_auc':float(average_precision_score(y,p)),'precision':float(precision_score(y,pred,zero_division=0)),'recall':float(recall_score(y,pred,zero_division=0)),'f1':float(f1_score(y,pred,zero_division=0)),'specificity':float(tn/(tn+fp)) if tn+fp else None,'sensitivity':float(tp/(tp+fn)) if tp+fn else None,'confusion_matrix':{'tn':int(tn),'fp':int(fp),'fn':int(fn),'tp':int(tp)},'brier_score':float(brier_score_loss(y,p))}

def calibration_summary(y,p,bins=10):
    frac,mean=calibration_curve(y,p,n_bins=bins,strategy='quantile')
    return {'mean_predicted':mean.tolist(),'fraction_positive':frac.tolist(),'bins':len(mean)}
