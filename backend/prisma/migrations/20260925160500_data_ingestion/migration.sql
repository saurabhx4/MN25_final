CREATE TYPE "DatasetType" AS ENUM ('SATELLITE','GEOLOGY','MINING','PRODUCTION','WEATHER','SPECTRAL','SAMPLES','TERRAIN','HISTORICAL_OCCURRENCES');
CREATE TYPE "DatasetProcessingStatus" AS ENUM ('UPLOADED','VALIDATING','PROCESSING','READY','FAILED');
CREATE TYPE "DataQualityRunStatus" AS ENUM ('RUNNING','COMPLETED','FAILED');

CREATE TABLE "Dataset" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mineId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "DatasetType" NOT NULL,
  "provider" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "coverage" JSONB,
  "acquisitionDate" TIMESTAMP(3),
  "ingestionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingStatus" "DatasetProcessingStatus" NOT NULL DEFAULT 'UPLOADED',
  "qualityScore" DOUBLE PRECISION,
  "license" TEXT,
  "checksum" TEXT NOT NULL,
  "format" TEXT,
  "contentType" TEXT,
  "sizeBytes" BIGINT,
  "storagePath" TEXT,
  "validationReport" JSONB,
  "processingError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Dataset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Dataset_organizationId_name_type_key" ON "Dataset"("organizationId","name","type");
CREATE INDEX "Dataset_organizationId_type_processingStatus_idx" ON "Dataset"("organizationId","type","processingStatus");
CREATE INDEX "Dataset_organizationId_createdAt_idx" ON "Dataset"("organizationId","createdAt");
CREATE INDEX "Dataset_organizationId_checksum_idx" ON "Dataset"("organizationId","checksum");

CREATE TABLE "DatasetVersion" (
  "id" TEXT NOT NULL,
  "datasetId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "coverage" JSONB,
  "acquisitionDate" TIMESTAMP(3),
  "ingestionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingStatus" "DatasetProcessingStatus" NOT NULL DEFAULT 'UPLOADED',
  "qualityScore" DOUBLE PRECISION,
  "license" TEXT,
  "checksum" TEXT NOT NULL,
  "format" TEXT,
  "contentType" TEXT,
  "sizeBytes" BIGINT,
  "storagePath" TEXT,
  "validationReport" JSONB,
  "processingError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DatasetVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DatasetVersion_datasetId_version_key" ON "DatasetVersion"("datasetId","version");
CREATE INDEX "DatasetVersion_organizationId_datasetId_createdAt_idx" ON "DatasetVersion"("organizationId","datasetId","createdAt");
CREATE INDEX "DatasetVersion_organizationId_checksum_idx" ON "DatasetVersion"("organizationId","checksum");

CREATE TABLE "AnalysisDatasetLink" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "analysisJobId" TEXT NOT NULL,
  "datasetId" TEXT NOT NULL,
  "datasetVersionId" TEXT,
  "role" TEXT NOT NULL DEFAULT 'input',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalysisDatasetLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AnalysisDatasetLink_analysisJobId_datasetId_datasetVersionId_key" ON "AnalysisDatasetLink"("analysisJobId","datasetId","datasetVersionId");
CREATE INDEX "AnalysisDatasetLink_organizationId_datasetId_idx" ON "AnalysisDatasetLink"("organizationId","datasetId");
CREATE INDEX "AnalysisDatasetLink_analysisJobId_idx" ON "AnalysisDatasetLink"("analysisJobId");

CREATE TABLE "DatasetGeometry" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "datasetId" TEXT NOT NULL,
  "datasetVersionId" TEXT,
  "featureIndex" INTEGER NOT NULL,
  "properties" JSONB,
  "geometry" geometry(Geometry,4326) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DatasetGeometry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DatasetGeometry_datasetVersionId_featureIndex_key" ON "DatasetGeometry"("datasetVersionId","featureIndex");
CREATE INDEX "DatasetGeometry_organizationId_datasetId_idx" ON "DatasetGeometry"("organizationId","datasetId");
CREATE INDEX "DatasetGeometry_geometry_gist_idx" ON "DatasetGeometry" USING GIST ("geometry");

CREATE TABLE "DataQualityRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "datasetId" TEXT NOT NULL,
  "datasetVersionId" TEXT,
  "requestedByUserId" TEXT NOT NULL,
  "status" "DataQualityRunStatus" NOT NULL DEFAULT 'RUNNING',
  "schemaValid" BOOLEAN,
  "coordinateValid" BOOLEAN,
  "duplicates" INTEGER NOT NULL DEFAULT 0,
  "missingValues" INTEGER NOT NULL DEFAULT 0,
  "rangeViolations" INTEGER NOT NULL DEFAULT 0,
  "geometryValid" BOOLEAN,
  "qualityScore" DOUBLE PRECISION,
  "report" JSONB,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "DataQualityRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DataQualityRun_organizationId_datasetId_createdAt_idx" ON "DataQualityRun"("organizationId","datasetId","createdAt");

ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_mineId_fkey" FOREIGN KEY ("mineId") REFERENCES "Mine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON UPDATE CASCADE;
ALTER TABLE "DatasetVersion" ADD CONSTRAINT "DatasetVersion_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DatasetVersion" ADD CONSTRAINT "DatasetVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DatasetVersion" ADD CONSTRAINT "DatasetVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON UPDATE CASCADE;
ALTER TABLE "AnalysisDatasetLink" ADD CONSTRAINT "AnalysisDatasetLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalysisDatasetLink" ADD CONSTRAINT "AnalysisDatasetLink_analysisJobId_fkey" FOREIGN KEY ("analysisJobId") REFERENCES "AnalysisJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalysisDatasetLink" ADD CONSTRAINT "AnalysisDatasetLink_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalysisDatasetLink" ADD CONSTRAINT "AnalysisDatasetLink_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DatasetGeometry" ADD CONSTRAINT "DatasetGeometry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DatasetGeometry" ADD CONSTRAINT "DatasetGeometry_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DatasetGeometry" ADD CONSTRAINT "DatasetGeometry_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DataQualityRun" ADD CONSTRAINT "DataQualityRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataQualityRun" ADD CONSTRAINT "DataQualityRun_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataQualityRun" ADD CONSTRAINT "DataQualityRun_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DataQualityRun" ADD CONSTRAINT "DataQualityRun_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON UPDATE CASCADE;
