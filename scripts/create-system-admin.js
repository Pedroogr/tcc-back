require('dotenv/config');

const { PrismaPg } = require('@prisma/adapter-pg');
const { hash } = require('bcryptjs');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const { PrismaClient } = require('../dist/generated/prisma/client.js');

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith('--')) {
      continue;
    }

    const key = arg.slice(2);
    const value = argv[index + 1];

    if (!value || value.startsWith('--')) {
      args[key] = 'true';
      continue;
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
const rl = readline.createInterface({ input, output });

function optionalValue(argName, envName) {
  return args[argName]?.trim() || process.env[envName]?.trim() || '';
}

async function requiredValue(argName, envName, label) {
  const value = optionalValue(argName, envName);

  if (value) {
    return value;
  }

  if (!input.isTTY) {
    throw new Error(`Informe ${label}`);
  }

  const answer = await rl.question(`${label}: `);

  if (!answer.trim()) {
    throw new Error(`Informe ${label}`);
  }

  return answer.trim();
}

async function main() {
  const connectionString = await requiredValue(
    'database-url',
    'DATABASE_URL',
    'DATABASE_URL',
  );
  const email = (
    await requiredValue('email', 'ADMIN_EMAIL', 'E-mail do administrador')
  )
    .trim()
    .toLowerCase();
  const password = await requiredValue(
    'password',
    'ADMIN_PASSWORD',
    'Senha do administrador',
  );
  const name = optionalValue('name', 'ADMIN_NAME') || 'Administrador';

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const admin = await prisma.user.upsert({
      where: { email },
      create: {
        name,
        email,
        passwordHash: await hash(password, 10),
        platformRole: 'SYSTEM_ADMIN',
      },
      update: {
        name,
        passwordHash: await hash(password, 10),
        platformRole: 'SYSTEM_ADMIN',
      },
      select: { id: true, name: true, email: true, platformRole: true },
    });

    console.log(JSON.stringify(admin, null, 2));
  } finally {
    await prisma.$disconnect();
    rl.close();
  }
}

main().catch((error) => {
  rl.close();
  console.error(error.message);
  process.exit(1);
});
