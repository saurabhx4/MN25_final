import { PrismaClient } from '@prisma/client';

// Single shared Prisma client across the process (recommended pattern for
// serverless-unsafe, long-running Node servers).
export const prisma = new PrismaClient();
