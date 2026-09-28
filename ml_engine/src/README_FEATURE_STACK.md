# Production feature stack contract

A production prediction requires a validated numerical feature stack derived from the registered DatasetVersion records for the selected geometry.

Required provenance:

- Sentinel-2 scene IDs and acquisition dates
- GSI geology DatasetVersion
- DEM DatasetVersion
- structural DatasetVersion when used
- feature registry version
- CRS/resolution/resampling method
- quality mask

The inference worker fails closed if this stack is unavailable. It does not substitute a dashboard score or an empty raster.
