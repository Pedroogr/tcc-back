require('dotenv/config');

const { PrismaPg } = require('@prisma/adapter-pg');
const { randomBytes } = require('node:crypto');
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

function normalizeFrontendUrl(value) {
  const frontendUrl = value || 'http://localhost:5173';

  try {
    const url = new URL(frontendUrl);

    if (url.hostname === '127.0.0.1' || url.hostname === '0.0.0.0') {
      url.hostname = 'localhost';
    }

    return url.toString().replace(/\/$/, '');
  } catch {
    return frontendUrl
      .replace('127.0.0.1', 'localhost')
      .replace('0.0.0.0', 'localhost')
      .replace(/\/$/, '');
  }
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
  const email = optionalValue('email', 'OFFICE_INVITE_EMAIL');
  const expiresDays = Number(optionalValue('expires-days', 'OFFICE_INVITE_EXPIRES_DAYS') || 7);
  const frontendUrl = normalizeFrontendUrl(
    optionalValue('frontend-url', 'FRONTEND_URL'),
  );
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const invite = await prisma.officeInvite.create({
      data: {
        email: email ? email.trim().toLowerCase() : undefined,
        token,
        expiresAt,
      },
      select: {
        id: true,
        email: true,
        token: true,
        status: true,
        expiresAt: true,
      },
    });

    console.log(JSON.stringify(invite, null, 2));
    console.log(`${frontendUrl}/cadastro-escritorio/${token}`);
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
