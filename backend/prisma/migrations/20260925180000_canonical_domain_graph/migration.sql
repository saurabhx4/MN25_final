-- MN25 canonical domain graph. Existing specialized tables remain intact;
-- canonical records provide one traceable graph across services while legacy
-- APIs continue to work during the migration period.

CREATE TABLE "SystemStatus" (
  "id" TEXT NOT NULL,
  "component" TEXT NOT NULL,
  "status" "ComponentStatus" NOT NULL DEFAULT 'UNKNOWN',
  "latencyMs" INTEGER,
  "message" TEXT,
  "version" TEXT,
  "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SystemStatus_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SystemStatus_component_key" ON "SystemStatus"("component");

CREATE TABLE "Region" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mineId" TEXT,
  "name" TEXT NOT NULL,
  "geometry" geometry(MultiPolygon,4326),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Region_organizationId_name_idx" ON "Region"("organizationId","name");
ALTER TABLE "Region" ADD CONSTRAINT "Region_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Region" ADD CONSTRAINT "Region_mineId_fkey" FOREIGN KEY ("mineId") REFERENCES "Mine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MiningArea" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mineId" TEXT NOT NULL,
  "legacyZoneId" TEXT,
  "name" TEXT NOT NULL,
  "geometry" geometry(Polygon,4326),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MiningArea_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MiningArea_legacyZoneId_key" ON "MiningArea"("legacyZoneId");
CREATE INDEX "MiningArea_organizationId_mineId_idx" ON "MiningArea"("organizationId","mineId");
ALTER TABLE "MiningArea" ADD CONSTRAINT "MiningArea_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MiningArea" ADD CONSTRAINT "MiningArea_mineId_fkey" FOREIGN KEY ("mineId") REFERENCES "Mine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SatelliteScene" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "datasetVersionId" TEXT,
  "provider" TEXT NOT NULL,
  "sceneId" TEXT NOT NULL,
  "acquisitionDate" TIMESTAMP(3) NOT NULL,
  "geometry" geometry(Polygon,4326),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SatelliteScene_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SatelliteScene_organizationId_provider_sceneId_key" ON "SatelliteScene"("organizationId","provider","sceneId");
CREATE INDEX "SatelliteScene_organizationId_acquisitionDate_idx" ON "SatelliteScene"("organizationId","acquisitionDate");
ALTER TABLE "SatelliteScene" ADD CONSTRAINT "SatelliteScene_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SatelliteScene" ADD CONSTRAINT "SatelliteScene_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Model" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "name" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "type" "ModelType" NOT NULL,
  "status" "ModelRegistryStatus" NOT NULL DEFAULT 'DRAFT',
  "currentVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Model_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Model_organizationId_name_key" ON "Model"("organizationId","name");
CREATE INDEX "Model_organizationId_status_idx" ON "Model"("organizationId","status");
ALTER TABLE "Model" ADD CONSTRAINT "Model_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Prediction" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "modelVersionId" TEXT NOT NULL,
  "analysisId" TEXT,
  "geometry" geometry(Geometry,4326),
  "prediction" JSONB NOT NULL,
  "confidence" DOUBLE PRECISION,
  "uncertainty" DOUBLE PRECISION,
  "inputDatasetVersions" JSONB NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "explainability" JSONB,
  CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Prediction_organizationId_generatedAt_idx" ON "Prediction"("organizationId","generatedAt");
CREATE INDEX "Prediction_organizationId_modelVersionId_idx" ON "Prediction"("organizationId","modelVersionId");
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PredictionDatasetVersion" (
  "id" TEXT NOT NULL,
  "predictionId" TEXT NOT NULL,
  "datasetVersionId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PredictionDatasetVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PredictionDatasetVersion_predictionId_datasetVersionId_role_key" ON "PredictionDatasetVersion"("predictionId","datasetVersionId","role");
ALTER TABLE "PredictionDatasetVersion" ADD CONSTRAINT "PredictionDatasetVersion_predictionId_fkey" FOREIGN KEY ("predictionId") REFERENCES "Prediction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PredictionDatasetVersion" ADD CONSTRAINT "PredictionDatasetVersion_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Analysis" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legacyAnalysisId" TEXT,
  "mineId" TEXT,
  "regionId" TEXT,
  "requestedByUserId" TEXT NOT NULL,
  "analysisType" "AnalysisType" NOT NULL,
  "status" "AnalysisStatus" NOT NULL DEFAULT 'QUEUED',
  "modelVersionId" TEXT,
  "geometry" JSONB,
  "inputSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Analysis_legacyAnalysisId_key" ON "Analysis"("legacyAnalysisId");
CREATE INDEX "Analysis_organizationId_createdAt_idx" ON "Analysis"("organizationId","createdAt");
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_mineId_fkey" FOREIGN KEY ("mineId") REFERENCES "Mine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AnalysisResult" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "analysisId" TEXT NOT NULL,
  "predictionId" TEXT,
  "resultType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "explainability" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalysisResult_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnalysisResult_organizationId_analysisId_createdAt_idx" ON "AnalysisResult"("organizationId","analysisId","createdAt");
ALTER TABLE "AnalysisResult" ADD CONSTRAINT "AnalysisResult_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalysisResult" ADD CONSTRAINT "AnalysisResult_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalysisResult" ADD CONSTRAINT "AnalysisResult_predictionId_fkey" FOREIGN KEY ("predictionId") REFERENCES "Prediction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ModelVersion" ADD COLUMN "canonicalModelId" TEXT;
CREATE INDEX "ModelVersion_canonicalModelId_idx" ON "ModelVersion"("canonicalModelId");
ALTER TABLE "ModelVersion" ADD CONSTRAINT "ModelVersion_canonicalModelId_fkey" FOREIGN KEY ("canonicalModelId") REFERENCES "Model"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AnalysisJob" ADD COLUMN "canonicalAnalysisId" TEXT;
CREATE UNIQUE INDEX "AnalysisJob_canonicalAnalysisId_key" ON "AnalysisJob"("canonicalAnalysisId");
ALTER TABLE "AnalysisJob" ADD CONSTRAINT "AnalysisJob_canonicalAnalysisId_fkey" FOREIGN KEY ("canonicalAnalysisId") REFERENCES "Analysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill the canonical graph with stable IDs from existing specialized records.
INSERT INTO "Model" ("id","organizationId","name","purpose","type","status","currentVersion","createdAt","updatedAt")
SELECT "id","organizationId","name","purpose","type","status","currentVersion","createdAt","updatedAt"
FROM "ModelRegistry"
ON CONFLICT ("id") DO NOTHING;

UPDATE "ModelVersion" mv
SET "canonicalModelId" = mr."id"
FROM "ModelRegistry" mr
WHERE mv."modelId" = mr."id";

INSERT INTO "Analysis" ("id","organizationId","legacyAnalysisId","mineId","requestedByUserId","analysisType","status","modelVersionId","geometry","inputSnapshot","createdAt","completedAt")
SELECT "id","organizationId","id","mineId","requestedByUserId","analysisType","status","modelVersionId","regionGeometry",
       jsonb_build_object('inputPayload',"inputPayload",'requestedLayers',"requestedLayers",'regionAreaKm2',"regionAreaKm2",'currentStage',"currentStage"),
       "createdAt","completedAt"
FROM "AnalysisJob"
ON CONFLICT ("id") DO NOTHING;

UPDATE "AnalysisJob" aj SET "canonicalAnalysisId" = aj."id" WHERE "canonicalAnalysisId" IS NULL;

INSERT INTO "Prediction" ("id","organizationId","modelId","modelVersionId","geometry","prediction","confidence","uncertainty","inputDatasetVersions","generatedAt","explainability")
SELECT mp."id", mp."organizationId", mr."id", mp."modelVersionId", mp."geometry", mp."prediction", mp."confidence", mp."uncertainty", mp."inputDatasetVersions", mp."generatedAt", mp."explanation"
FROM "ModelPrediction" mp
JOIN "ModelRegistry" mr ON mr."id" = mp."modelId"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "PredictionDatasetVersion" ("id","predictionId","datasetVersionId","role","createdAt")
SELECT md5(mp."id" || '-' || elem->>'datasetVersionId' || '-' || COALESCE(elem->>'role','input')),
       mp."id",
       elem->>'datasetVersionId',
       COALESCE(elem->>'role','input'),
       mp."generatedAt"
FROM "ModelPrediction" mp
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(mp."inputDatasetVersions") = 'array' THEN mp."inputDatasetVersions" ELSE '[]'::jsonb END) elem
JOIN "DatasetVersion" dv ON dv."id" = elem->>'datasetVersionId'
ON CONFLICT ("predictionId","datasetVersionId","role") DO NOTHING;

INSERT INTO "AnalysisResult" ("id","organizationId","analysisId","predictionId","resultType","payload","createdAt")
SELECT md5(aj."id" || '-result'), aj."organizationId", aj."id", mp."id", 'prospectivity', mp."prediction", mp."generatedAt"
FROM "AnalysisJob" aj
JOIN "ModelPrediction" mp ON mp."id" = aj."resultPredictionId"
ON CONFLICT ("id") DO NOTHING;
