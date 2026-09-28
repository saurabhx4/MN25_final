"""Sentinel-2 L2A SCL quality mask. No-data remains no-data; it is never replaced by zero."""
import numpy as np

def scl_valid_mask(scl):
    # SCL: 0 no-data, 1 saturated/defective, 3 cloud shadow, 8/9/10 clouds/cirrus, 11 snow/ice.
    invalid=np.isin(scl,[0,1,3,8,9,10,11])
    return ~invalid
