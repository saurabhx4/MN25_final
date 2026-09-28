CREATE TYPE "RiskStatus" AS ENUM ('ACTIVE','MONITORING','ACKNOWLEDGED','RESOLVED');
CREATE TYPE "RiskSeverity" AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');

CREATE TABLE "Risk" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mineId" TEXT NOT NULL,
  "ownerId" TEXT,
  "name" TEXT NOT NULL,
  "cause" TEXT NOT NULL,
  "impact" INTEGER NOT NULL,
  "probability" INTEGER NOT NULL,
  "riskScore" INTEGER NOT NULL,
  "severity" "RiskSeverity" NOT NULL,
  "status" "RiskStatus" NOT NULL DEFAULT 'ACTIVE',
  "affectedArea" TEXT,
  "evidence" JSONB NOT NULL,
  "source" JSONB NOT NULL,
  "mitigation" TEXT,
  "notes" TEXT,
  "calculationVersion" TEXT NOT NULL,
  "modelVersionId" TEXT,
  "confidence" DOUBLE PRECISION,
  "uncertainty" DOUBLE PRECISION,
  "inputFactors" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Risk_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "RiskEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "riskId" TEXT NOT NULL,
  "actorId" TEXT,
  "eventType" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RiskEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Risk_organizationId_mineId_severity_status_idx" ON "Risk"("organizationId","mineId","severity","status");
CREATE INDEX "Risk_organizationId_createdAt_idx" ON "Risk"("organizationId","createdAt");
CREATE INDEX "RiskEvent_organizationId_riskId_createdAt_idx" ON "RiskEvent"("organizationId","riskId","createdAt");
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_mineId_fkey" FOREIGN KEY ("mineId") REFERENCES "Mine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
