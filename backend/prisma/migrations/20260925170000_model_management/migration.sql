ALTER TYPE "ModelType" ADD VALUE IF NOT EXISTS 'MN_CONCENTRATION';

CREATE TYPE "ModelRegistryStatus" AS ENUM ('DRAFT','VALIDATED','DEPLOYED','RETIRED');

CREATE TABLE "ModelRegistry" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "name" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "type" "ModelType" NOT NULL,
  "status" "ModelRegistryStatus" NOT NULL DEFAULT 'DRAFT',
  "currentVersion" TEXT,
  "trainingDataset" TEXT,
  "trainingDate" TIMESTAMP(3),
  "metrics" JSONB,
  "features" JSONB,
  "deploymentDate" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModelRegistry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ModelRegistry_organizationId_name_key" ON "ModelRegistry"("organizationId","name");
CREATE INDEX "ModelRegistry_organizationId_status_idx" ON "ModelRegistry"("organizationId","status");
ALTER TABLE "ModelRegistry" ADD CONSTRAINT "ModelRegistry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelVersion" ADD COLUMN "modelId" TEXT;
ALTER TABLE "ModelVersion" ADD COLUMN "status" "ModelRegistryStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "ModelVersion" ADD COLUMN "trainingDate" TIMESTAMP(3);
ALTER TABLE "ModelVersion" ADD COLUMN "features" JSONB;
ALTER TABLE "ModelVersion" ADD COLUMN "deploymentDate" TIMESTAMP(3);

INSERT INTO "ModelRegistry" ("id","name","purpose","type","status","currentVersion","trainingDataset","metrics","createdAt","updatedAt")
SELECT md5('mn25-model:' || v."name")::uuid::text,
       v."name",
       CASE v."type" WHEN 'PROSPECTIVITY' THEN 'Manganese prospectivity' WHEN 'MN_CONCENTRATION' THEN 'Mn concentration estimation' WHEN 'PRODUCTION_FORECAST' THEN 'Production forecasting' WHEN 'RISK' THEN 'Operational risk' END,
       v."type", 'DRAFT', v."version", v."trainingDataset", v."metrics", v."releasedAt", CURRENT_TIMESTAMP
FROM (SELECT DISTINCT ON ("name") "name","type","version","trainingDataset","metrics","releasedAt" FROM "ModelVersion" ORDER BY "name","releasedAt" DESC) v;

UPDATE "ModelVersion" mv
SET "modelId" = md5('mn25-model:' || mv."name")::uuid::text;

UPDATE "ModelRegistry" mr
SET "trainingDate" = mv."releasedAt"
FROM "ModelVersion" mv
WHERE mv."modelId" = mr."id" AND mv."version" = mr."currentVersion";

CREATE INDEX "ModelVersion_modelId_status_idx" ON "ModelVersion"("modelId","status");
ALTER TABLE "ModelVersion" ADD CONSTRAINT "ModelVersion_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ModelRegistry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ModelPrediction" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "requestedByUserId" TEXT,
  "modelId" TEXT NOT NULL,
  "modelVersionId" TEXT NOT NULL,
  "inputDatasetVersions" JSONB NOT NULL,
  "geometry" geometry(Geometry,4326),
  "prediction" JSONB NOT NULL,
  "confidence" DOUBLE PRECISION,
  "uncertainty" DOUBLE PRECISION,
  "explanation" JSONB,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModelPrediction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ModelPrediction_organizationId_generatedAt_idx" ON "ModelPrediction"("organizationId","generatedAt");
CREATE INDEX "ModelPrediction_organizationId_modelId_modelVersionId_idx" ON "ModelPrediction"("organizationId","modelId","modelVersionId");
CREATE INDEX "ModelPrediction_geometry_gist_idx" ON "ModelPrediction" USING GIST ("geometry");
ALTER TABLE "ModelPrediction" ADD CONSTRAINT "ModelPrediction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelPrediction" ADD CONSTRAINT "ModelPrediction_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModelPrediction" ADD CONSTRAINT "ModelPrediction_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ModelRegistry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ModelPrediction" ADD CONSTRAINT "ModelPrediction_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
