from pathlib import Path
p=Path('/mnt/data/mn25_ml_work/backend/prisma/schema.prisma')
s=p.read_text()
s=s.replace('  predictions         Prediction[]\n}', '  predictions         Prediction[]\n  mlExperiments       MLExperiment[]\n  mlTrainingRuns      MLTrainingRun[]\n  mlPredictionRuns    MLPredictionRun[]\n}')
s=s.replace('  canonicalAnalyses Analysis[]\n}', '  canonicalAnalyses Analysis[]\n  mlExperimentsCreated MLExperiment[] @relation("MLExperimentCreatedBy")\n  mlPredictionRuns MLPredictionRun[] @relation("MLPredictionRunRequestedBy")\n}')
s=s.replace('  canonicalPredictions Prediction[]\n  canonicalAnalyses Analysis[]\n}', '  canonicalPredictions Prediction[]\n  canonicalAnalyses Analysis[]\n  mlExperimentsCreated MLExperiment[] @relation("MLExperimentCreatedBy")\n  mlPredictionRuns MLPredictionRun[] @relation("MLPredictionRunRequestedBy")\n}')
# Avoid duplicate if replacement hit wrong section; we'll normalize below.
s=s.replace('  canonicalPredictions Prediction[]\n  canonicalAnalyses Analysis[]\n  mlExperimentsCreated MLExperiment[] @relation("MLExperimentCreatedBy")\n  mlPredictionRuns MLPredictionRun[] @relation("MLPredictionRunRequestedBy")\n}', '  canonicalPredictions Prediction[]\n  canonicalAnalyses Analysis[]\n  mlExperimentsCreated MLExperiment[] @relation("MLExperimentCreatedBy")\n  mlPredictionRuns MLPredictionRun[] @relation("MLPredictionRunRequestedBy")\n}')
# Add ML status enum before ModelVersion
needle='model ModelVersion {\n'
enum='''enum MLModelStatus {\n  DRAFT\n  TRAINED\n  VALIDATED\n  REVIEW\n  APPROVED\n  PRODUCTION\n  RETIRED\n}\n\n'''
s=s.replace(needle, enum+needle, 1)
# Extend ModelVersion fields after releasedAt
old='  releasedAt  DateTime  @default(now())\n\n  predictions'
new='''  releasedAt  DateTime  @default(now())\n  algorithm String?\n  hyperparameters Json?\n  datasetVersion String?\n  featureVersion String?\n  artifactLocation String?\n  codeVersion String?\n  calibration Json?\n  uncertaintyMethod String?\n  applicabilityMethod String?\n  mlStatus MLModelStatus @default(DRAFT)\n\n  predictions'''
s=s.replace(old,new,1)
# Add relations before end of ModelVersion
old='  canonicalAnalyses Analysis[]\n\n  @@unique([name, version])'
new='''  canonicalAnalyses Analysis[]\n  mlExperiments MLExperiment[]\n  mlTrainingRuns MLTrainingRun[]\n  mlPredictionRuns MLPredictionRun[]\n\n  @@unique([name, version])'''
s=s.replace(old,new,1)
# Extend Prediction fields
old='  explainability        Json?\n  generatedAt           DateTime     @default(now())\n\n  datasetVersions'
new='''  explainability        Json?\n  applicability         String?\n  dataQuality           Float?\n  featureVersion        String?\n  sourceSceneIds        Json?\n  status                String       @default("COMPLETED")\n  generatedAt           DateTime     @default(now())\n\n  datasetVersions'''
s=s.replace(old,new,1)
# Add ML models before DataSourceType enum
needle='enum DataSourceType {'
ml='''enum MLJobStatus {\n  QUEUED\n  RUNNING\n  COMPLETED\n  FAILED\n  BLOCKED\n}\n\nmodel MLExperiment {\n  id String @id @default(uuid())\n  organizationId String\n  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)\n  createdByUserId String\n  createdBy User @relation("MLExperimentCreatedBy", fields: [createdByUserId], references: [id], onDelete: Restrict)\n  name String\n  datasetVersion String\n  featureVersion String\n  modelType String\n  hyperparameters Json\n  randomSeed Int\n  trainingBlocks Json\n  validationBlocks Json\n  testBlocks Json\n  metrics Json?\n  regionalMetrics Json?\n  calibration Json?\n  status MLJobStatus @default(QUEUED)\n  codeVersion String\n  createdAt DateTime @default(now())\n  startedAt DateTime?\n  completedAt DateTime?\n  errorMessage String?\n  trainingRuns MLTrainingRun[]\n\n  @@index([organizationId, createdAt])\n  @@index([organizationId, status])\n}\n\nmodel MLTrainingRun {\n  id String @id @default(uuid())\n  organizationId String\n  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)\n  experimentId String\n  experiment MLExperiment @relation(fields: [experimentId], references: [id], onDelete: Cascade)\n  modelVersionId String?\n  modelVersion ModelVersion? @relation(fields: [modelVersionId], references: [id], onDelete: SetNull)\n  status MLJobStatus @default(QUEUED)\n  algorithm String\n  artifactLocation String?\n  metrics Json?\n  regionalMetrics Json?\n  calibration Json?\n  uncertainty Json?\n  applicability Json?\n  startedAt DateTime?\n  completedAt DateTime?\n  errorMessage String?\n  createdAt DateTime @default(now())\n\n  @@index([organizationId, createdAt])\n  @@index([experimentId])\n}\n\nmodel MLPredictionRun {\n  id String @id @default(uuid())\n  organizationId String\n  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)\n  requestedByUserId String\n  requestedBy User @relation("MLPredictionRunRequestedBy", fields: [requestedByUserId], references: [id], onDelete: Restrict)\n  modelVersionId String\n  modelVersion ModelVersion @relation(fields: [modelVersionId], references: [id], onDelete: Restrict)\n  datasetVersion String\n  featureVersion String\n  geometry Json\n  status MLJobStatus @default(QUEUED)\n  artifactLocation String?\n  predictionCount Int?\n  sourceSceneIds Json?\n  startedAt DateTime?\n  completedAt DateTime?\n  errorMessage String?\n  createdAt DateTime @default(now())\n\n  @@index([organizationId, createdAt])\n  @@index([organizationId, modelVersionId])\n}\n\n'''
s=s.replace(needle,ml+needle,1)
p.write_text(s)
