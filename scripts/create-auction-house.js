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

function optionalValue(argName, envName) {
  const value = args[argName]?.trim() || process.env[envName]?.trim();
  return value ? value.replace(/\^/g, '') : undefined;
}

function canPrompt() {
  return input.isTTY;
}

async function promptValue(label, fallback, required = false) {
  if (fallback) {
    return fallback;
  }

  if (!canPrompt()) {
    if (required) {
      throw new Error(`Informe ${label}`);
    }

    return '';
  }

  const answer = await rl.question(`${label}: `);
  return answer.trim();
}

async function requiredValue(name, label) {
  const argName = name
    .replace('AUCTION_HOUSE_', '')
    .toLowerCase()
    .replaceAll('_', '-');
  const value = optionalValue(argName, name);

  const answer = await promptValue(label, value, true);

  if (!answer) {
    throw new Error(`Informe ${label}`);
  }

  return answer;
}

const rl = readline.createInterface({ input, output });

async function main() {
  const connectionString = await requiredValue('DATABASE_URL', 'DATABASE_URL');
  const name = await requiredValue('AUCTION_HOUSE_NAME', 'Nome do escritorio');
  const email = await requiredValue('AUCTION_HOUSE_EMAIL', 'E-mail do escritorio');
  const password = await requiredValue('AUCTION_HOUSE_PASSWORD', 'Senha inicial');
  const document = await promptValue(
    'Documento/CNPJ (opcional)',
    optionalValue('document', 'AUCTION_HOUSE_DOCUMENT'),
  );
  const phone = await promptValue(
    'Telefone (opcional)',
    optionalValue('phone', 'AUCTION_HOUSE_PHONE'),
  );
  const city = await promptValue(
    'Cidade (opcional)',
    optionalValue('city', 'AUCTION_HOUSE_CITY'),
  );
  const state = await promptValue(
    'Estado (opcional)',
    optionalValue('state', 'AUCTION_HOUSE_STATE'),
  );
  const country = await promptValue(
    'Pais',
    optionalValue('country', 'AUCTION_HOUSE_COUNTRY') || 'BR',
  );

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const auctionHouse = await prisma.auctionHouse.create({
      data: {
        name,
        email,
        passwordHash: await hash(password, 10),
        document: document || undefined,
        phone: phone || undefined,
        city: city || undefined,
        state: state || undefined,
        country: country || 'BR',
        mustChangePassword: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        document: true,
        status: true,
        mustChangePassword: true,
      },
    });

    console.log(JSON.stringify(auctionHouse, null, 2));
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
