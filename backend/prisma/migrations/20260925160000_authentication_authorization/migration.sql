-- MN25 Authentication + Authorization
CREATE TYPE "UserRole_new" AS ENUM ('RESEARCHER','OPERATOR','MANAGER','ADMIN');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole_new" USING (
  CASE "role"::text
    WHEN 'ORG_ADMIN' THEN 'ADMIN'::"UserRole_new"
    WHEN 'MANAGER' THEN 'MANAGER'::"UserRole_new"
    WHEN 'ANALYST' THEN 'RESEARCHER'::"UserRole_new"
    WHEN 'EMPLOYEE' THEN 'OPERATOR'::"UserRole_new"
    WHEN 'VIEWER' THEN 'RESEARCHER'::"UserRole_new"
    ELSE 'OPERATOR'::"UserRole_new"
  END
);
DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'OPERATOR';

CREATE TYPE "UserEnvironment" AS ENUM ('ORGANIZATION','EMPLOYEE');
ALTER TABLE "User" ADD COLUMN "environment" "UserEnvironment" NOT NULL DEFAULT 'EMPLOYEE';
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "AuthSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");
CREATE INDEX "AuthSession_userId_revokedAt_idx" ON "AuthSession"("userId","revokedAt");
CREATE INDEX "AuthSession_organizationId_idx" ON "AuthSession"("organizationId");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "UserMine" (
  "userId" TEXT NOT NULL,
  "mineId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserMine_pkey" PRIMARY KEY ("userId","mineId")
);
CREATE INDEX "UserMine_mineId_idx" ON "UserMine"("mineId");
ALTER TABLE "UserMine" ADD CONSTRAINT "UserMine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserMine" ADD CONSTRAINT "UserMine_mineId_fkey" FOREIGN KEY ("mineId") REFERENCES "Mine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditLog" ALTER COLUMN "organizationId" DROP NOT NULL;
ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_organizationId_fkey";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
