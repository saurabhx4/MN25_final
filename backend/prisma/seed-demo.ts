import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Creates/updates the explicit MN25 demo account requested for local/demo use.
 * This account is intentionally not a production credential.
 */
async function main() {
  const email = 'example@gmail.com';
  const password = '12345678';
  const organizationName = 'kmclu';
  const passwordHash = await bcrypt.hash(password, 12);

  const organization = await prisma.organization.upsert({
    where: { id: 'demo-kmclu' },
    update: { name: organizationName },
    create: { id: 'demo-kmclu', name: organizationName },
  });

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      organizationId: organization.id,
      name: 'MN25 Demo User',
      role: 'ADMIN',
      environment: 'ORGANIZATION',
      isActive: true,
      passwordHash,
    },
    create: {
      organizationId: organization.id,
      email,
      name: 'MN25 Demo User',
      role: 'ADMIN',
      environment: 'ORGANIZATION',
      passwordHash,
    },
  });

  console.log('MN25 demo account ready');
  console.log(`Email: ${email}`);
  console.log(`Password: ${password}`);
  console.log(`Organisation: ${organization.name}`);
  console.log(`User ID: ${user.id}`);
  console.log('Role: ADMIN (demo only)');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
