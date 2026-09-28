from __future__ import annotations
import pandas as pd
import hashlib

def spatial_split(df: pd.DataFrame, train_blocks, validation_blocks, test_blocks):
    required=set(train_blocks)|set(validation_blocks)|set(test_blocks)
    actual=set(df.spatial_block.astype(str))
    if not required.issubset(actual): raise ValueError('Requested split contains spatial blocks absent from dataset.')
    if (set(train_blocks)&set(validation_blocks)) or (set(train_blocks)&set(test_blocks)) or (set(validation_blocks)&set(test_blocks)):
        raise ValueError('Spatial split block sets overlap.')
    return df[df.spatial_block.astype(str).isin(train_blocks)].copy(), df[df.spatial_block.astype(str).isin(validation_blocks)].copy(), df[df.spatial_block.astype(str).isin(test_blocks)].copy()

def deterministic_block_split(df: pd.DataFrame, seed: int=20260925):
    blocks=sorted(df.spatial_block.astype(str).unique())
    if len(blocks)<3: raise RuntimeError('At least 3 spatial blocks are required for train/validation/test.')
    # Deterministic hash-like ordering; no random pixel split.
    ordered=sorted(blocks, key=lambda b: hashlib.sha256(f'{seed}:{b}'.encode()).hexdigest())
    n=len(ordered); ntr=max(1,int(n*0.6)); nva=max(1,int(n*0.2));
    return ordered[:ntr], ordered[ntr:ntr+nva], ordered[ntr+nva:]
