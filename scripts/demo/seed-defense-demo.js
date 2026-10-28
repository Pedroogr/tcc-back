require('dotenv/config');

const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../../dist/generated/prisma/client.js');
const {
  assertDemoDatabaseUrl,
  seedDefenseDemo,
} = require('./demo-data');

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim() || '';
  const password = process.env.DEMO_PASSWORD?.trim() || '';
  assertDemoDatabaseUrl(connectionString);
  if (!password) throw new Error('DEMO_PASSWORD é obrigatória.');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    const summary = await seedDefenseDemo(prisma, password);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
