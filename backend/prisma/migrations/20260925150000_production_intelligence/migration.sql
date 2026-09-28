-- MN25 Production Intelligence
CREATE TYPE "ProductionForecastStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'UNAVAILABLE');

CREATE TABLE "ProductionRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mineId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "plannedProduction" DOUBLE PRECISION,
  "actualProduction" DOUBLE PRECISION,
  "oreGrade" DOUBLE PRECISION,
  "equipmentAvailability" DOUBLE PRECISION,
  "weather" JSONB,
  "downtime" DOUBLE PRECISION,
  "sourceName" TEXT,
  "sourceDatasetVersion" TEXT,
  "sourceUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductionRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductionRecord_mineId_date_key" ON "ProductionRecord"("mineId", "date");
CREATE INDEX "ProductionRecord_organizationId_mineId_date_idx" ON "ProductionRecord"("organizationId", "mineId", "date");
ALTER TABLE "ProductionRecord" ADD CONSTRAINT "ProductionRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionRecord" ADD CONSTRAINT "ProductionRecord_mineId_fkey" FOREIGN KEY ("mineId") REFERENCES "Mine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProductionForecast" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mineId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "forecastHorizon" INTEGER NOT NULL,
  "modelVersionId" TEXT,
  "modelId" TEXT,
  "modelVersionLabel" TEXT,
  "trainingDataset" TEXT,
  "status" "ProductionForecastStatus" NOT NULL DEFAULT 'QUEUED',
  "forecast" JSONB,
  "target" DOUBLE PRECISION,
  "shortfall" DOUBLE PRECISION,
  "confidence" DOUBLE PRECISION,
  "uncertainty" DOUBLE PRECISION,
  "factors" JSONB,
  "inputSnapshot" JSONB NOT NULL,
  "generatedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductionForecast_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductionForecast_organizationId_mineId_createdAt_idx" ON "ProductionForecast"("organizationId", "mineId", "createdAt");
CREATE INDEX "ProductionForecast_organizationId_status_idx" ON "ProductionForecast"("organizationId", "status");
ALTER TABLE "ProductionForecast" ADD CONSTRAINT "ProductionForecast_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionForecast" ADD CONSTRAINT "ProductionForecast_mineId_fkey" FOREIGN KEY ("mineId") REFERENCES "Mine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionForecast" ADD CONSTRAINT "ProductionForecast_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionForecast" ADD CONSTRAINT "ProductionForecast_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProductionScenario" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mineId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "forecastHorizon" INTEGER NOT NULL,
  "equipmentDowntime" DOUBLE PRECISION NOT NULL,
  "blastingDelay" DOUBLE PRECISION NOT NULL,
  "workingHours" DOUBLE PRECISION NOT NULL,
  "rainfall" TEXT NOT NULL,
  "modelId" TEXT,
  "modelVersion" TEXT,
  "trainingDataset" TEXT,
  "production" DOUBLE PRECISION,
  "shortfall" DOUBLE PRECISION,
  "recoveryOpportunity" DOUBLE PRECISION,
  "risk" DOUBLE PRECISION,
  "confidence" DOUBLE PRECISION,
  "assumptions" JSONB,
  "status" "ProductionForecastStatus" NOT NULL DEFAULT 'COMPLETED',
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductionScenario_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductionScenario_organizationId_mineId_createdAt_idx" ON "ProductionScenario"("organizationId", "mineId", "createdAt");
ALTER TABLE "ProductionScenario" ADD CONSTRAINT "ProductionScenario_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionScenario" ADD CONSTRAINT "ProductionScenario_mineId_fkey" FOREIGN KEY ("mineId") REFERENCES "Mine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionScenario" ADD CONSTRAINT "ProductionScenario_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
