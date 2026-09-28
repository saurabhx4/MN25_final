# Model Registry

The registry stores immutable model versions. A version progresses through:

`DRAFT -> TRAINED -> VALIDATED -> REVIEW -> APPROVED -> PRODUCTION`

Production inference requires `mlStatus=PRODUCTION` and the existing backend deployment guard.

No newest-model auto-deployment is implemented.
