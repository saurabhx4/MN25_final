-- MN25 Settings service
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MANAGER';

CREATE TABLE "OrganizationSettings" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "forecastHorizon" INTEGER NOT NULL DEFAULT 30,
  "riskThreshold" DOUBLE PRECISION NOT NULL DEFAULT 70,
  "prospectivityThreshold" DOUBLE PRECISION NOT NULL DEFAULT 75,
  "defaultModel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrganizationSettings_organizationId_key" ON "OrganizationSettings"("organizationId");
ALTER TABLE "OrganizationSettings" ADD CONSTRAINT "OrganizationSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "UserSettings" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "selectedMineId" TEXT,
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "units" TEXT NOT NULL DEFAULT 'metric',
  "notificationPreferences" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");
CREATE INDEX "UserSettings_selectedMineId_idx" ON "UserSettings"("selectedMineId");
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_selectedMineId_fkey" FOREIGN KEY ("selectedMineId") REFERENCES "Mine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SystemComponentStatus" ADD COLUMN "version" TEXT;
