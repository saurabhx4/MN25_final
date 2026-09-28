CREATE TYPE "MLModelStatus" AS ENUM ('DRAFT','TRAINED','VALIDATED','REVIEW','APPROVED','PRODUCTION','RETIRED');
CREATE TYPE "MLJobStatus" AS ENUM ('QUEUED','RUNNING','COMPLETED','FAILED','BLOCKED');

ALTER TABLE "ModelVersion"
  ADD COLUMN "algorithm" TEXT,
  ADD COLUMN "hyperparameters" JSONB,
  ADD COLUMN "datasetVersion" TEXT,
  ADD COLUMN "featureVersion" TEXT,
  ADD COLUMN "artifactLocation" TEXT,
  ADD COLUMN "codeVersion" TEXT,
  ADD COLUMN "calibration" JSONB,
  ADD COLUMN "uncertaintyMethod" TEXT,
  ADD COLUMN "applicabilityMethod" TEXT,
  ADD COLUMN "mlStatus" "MLModelStatus" NOT NULL DEFAULT 'DRAFT';

ALTER TABLE "Prediction"
  ADD COLUMN "applicability" TEXT,
  ADD COLUMN "dataQuality" DOUBLE PRECISION,
  ADD COLUMN "featureVersion" TEXT,
  ADD COLUMN "sourceSceneIds" JSONB,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'COMPLETED';

CREATE TABLE "MLExperiment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "datasetVersion" TEXT NOT NULL,
  "featureVersion" TEXT NOT NULL,
  "modelType" TEXT NOT NULL,
  "hyperparameters" JSONB NOT NULL,
  "randomSeed" INTEGER NOT NULL,
  "trainingBlocks" JSONB NOT NULL,
  "validationBlocks" JSONB NOT NULL,
  "testBlocks" JSONB NOT NULL,
  "metrics" JSONB,
  "regionalMetrics" JSONB,
  "calibration" JSONB,
  "status" "MLJobStatus" NOT NULL DEFAULT 'QUEUED',
  "codeVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  CONSTRAINT "MLExperiment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MLTrainingRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "experimentId" TEXT NOT NULL,
  "modelVersionId" TEXT,
  "status" "MLJobStatus" NOT NULL DEFAULT 'QUEUED',
  "algorithm" TEXT NOT NULL,
  "artifactLocation" TEXT,
  "metrics" JSONB,
  "regionalMetrics" JSONB,
  "calibration" JSONB,
  "uncertainty" JSONB,
  "applicability" JSONB,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MLTrainingRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MLPredictionRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "modelVersionId" TEXT NOT NULL,
  "datasetVersion" TEXT NOT NULL,
  "featureVersion" TEXT NOT NULL,
  "geometry" JSONB NOT NULL,
  "status" "MLJobStatus" NOT NULL DEFAULT 'QUEUED',
  "artifactLocation" TEXT,
  "predictionCount" INTEGER,
  "sourceSceneIds" JSONB,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MLPredictionRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MLExperiment_organizationId_createdAt_idx" ON "MLExperiment"("organizationId","createdAt");
CREATE INDEX "MLExperiment_organizationId_status_idx" ON "MLExperiment"("organizationId","status");
CREATE INDEX "MLTrainingRun_organizationId_createdAt_idx" ON "MLTrainingRun"("organizationId","createdAt");
CREATE INDEX "MLTrainingRun_experimentId_idx" ON "MLTrainingRun"("experimentId");
CREATE INDEX "MLPredictionRun_organizationId_createdAt_idx" ON "MLPredictionRun"("organizationId","createdAt");
CREATE INDEX "MLPredictionRun_organizationId_modelVersionId_idx" ON "MLPredictionRun"("organizationId","modelVersionId");

ALTER TABLE "MLExperiment" ADD CONSTRAINT "MLExperiment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MLExperiment" ADD CONSTRAINT "MLExperiment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MLTrainingRun" ADD CONSTRAINT "MLTrainingRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MLTrainingRun" ADD CONSTRAINT "MLTrainingRun_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "MLExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MLTrainingRun" ADD CONSTRAINT "MLTrainingRun_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MLPredictionRun" ADD CONSTRAINT "MLPredictionRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MLPredictionRun" ADD CONSTRAINT "MLPredictionRun_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MLPredictionRun" ADD CONSTRAINT "MLPredictionRun_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MLPredictionRun" ADD COLUMN "analysisJobId" TEXT;
CREATE UNIQUE INDEX "MLPredictionRun_analysisJobId_key" ON "MLPredictionRun"("analysisJobId");
ALTER TABLE "MLPredictionRun" ADD CONSTRAINT "MLPredictionRun_analysisJobId_fkey" FOREIGN KEY ("analysisJobId") REFERENCES "AnalysisJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
