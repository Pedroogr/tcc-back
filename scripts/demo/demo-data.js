const { hash } = require('bcryptjs');

const DEMO_IDS = Object.freeze({
  auctionHouse: '10000000-0000-4000-8000-000000000001',
  buyer: '10000000-0000-4000-8000-000000000002',
  buyerProfile: '10000000-0000-4000-8000-000000000003',
  buyerRegistration: '10000000-0000-4000-8000-000000000004',
  auction: '10000000-0000-4000-8000-000000000005',
  auctionSettings: '10000000-0000-4000-8000-000000000006',
  stream: '10000000-0000-4000-8000-000000000007',
  lot: '10000000-0000-4000-8000-000000000008',
});

const DEMO_DATE = new Date('2026-10-28T12:00:00.000Z');

function assertDemoDatabaseUrl(connectionString) {
  let databaseUrl;
  try {
    databaseUrl = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL de demonstração inválida.');
  }
  if (databaseUrl.pathname !== '/cattle_auction_demo') {
    throw new Error('DATABASE_URL precisa apontar para cattle_auction_demo.');
  }
}

function buildDemoRecords(passwordHash) {
  return {
    auctionHouse: {
      id: DEMO_IDS.auctionHouse,
      name: 'Leiloeira Demonstração TCC',
      document: 'DEMO-LEILOEIRA',
      email: 'escritorio.demo@tcc.local',
      passwordHash,
      phone: '(51) 99999-0001',
      city: 'Porto Alegre',
      state: 'RS',
      country: 'BR',
      status: 'ACTIVE',
      mustChangePassword: false,
    },
    buyer: {
      id: DEMO_IDS.buyer,
      name: 'Comprador Demonstração',
      email: 'comprador.demo@tcc.local',
      passwordHash,
      phone: '(51) 99999-0002',
      document: 'DEMO-COMPRADOR',
      platformRole: 'USER',
      status: 'ACTIVE',
    },
    buyerProfile: {
      id: DEMO_IDS.buyerProfile,
      userId: DEMO_IDS.buyer,
      verificationStatus: 'APPROVED',
      ie: '224365879',
      ieUf: 'RS',
    },
    buyerRegistration: {
      id: DEMO_IDS.buyerRegistration,
      buyerId: DEMO_IDS.buyer,
      auctionHouseId: DEMO_IDS.auctionHouse,
      status: 'APPROVED',
      notes: 'Cadastro preparado para a defesa do TCC.',
      approvedAt: DEMO_DATE,
    },
    auction: {
      id: DEMO_IDS.auction,
      title: 'Remate Demonstração TCC',
      description: 'Ambiente isolado para apresentação e testes externos.',
      scheduledAt: DEMO_DATE,
      startedAt: DEMO_DATE,
      status: 'LIVE',
      auctionHouseId: DEMO_IDS.auctionHouse,
    },
    auctionSettings: {
      id: DEMO_IDS.auctionSettings,
      auctionId: DEMO_IDS.auction,
      country: 'BR',
      currency: 'BRL',
      language: 'pt-BR',
      commercialUnit: 'PER_HEAD',
      minBidIncrement: '50.00',
      requiresBuyerApproval: true,
    },
    stream: {
      id: DEMO_IDS.stream,
      auctionId: DEMO_IDS.auction,
      status: 'WAITING',
    },
    lot: {
      id: DEMO_IDS.lot,
      code: 'DEMO-001',
      title: 'Lote Demonstração',
      description: 'Lote preparado para demonstrar pista, lances e gestos.',
      breed: 'Angus',
      category: 'Gado de corte',
      sex: 'MACHO',
      ageMonths: 24,
      weightKg: 480,
      quantity: 10,
      initialPrice: '2500.00',
      status: 'IN_AUCTION',
      auctionId: DEMO_IDS.auction,
    },
  };
}

function updateFields(record) {
  const { id: _id, ...fields } = record;
  return fields;
}

async function seedDefenseDemo(
  prisma,
  password,
  { hashPassword = (value) => hash(value, 10) } = {},
) {
  if (!password?.trim()) {
    throw new Error('DEMO_PASSWORD é obrigatória.');
  }
  const records = buildDemoRecords(await hashPassword(password));

  await prisma.$transaction(async (transaction) => {
    await transaction.auctionHouse.upsert({
      where: { email: records.auctionHouse.email },
      create: records.auctionHouse,
      update: updateFields(records.auctionHouse),
    });
    await transaction.user.upsert({
      where: { email: records.buyer.email },
      create: records.buyer,
      update: updateFields(records.buyer),
    });
    await transaction.buyerProfile.upsert({
      where: { userId: records.buyerProfile.userId },
      create: records.buyerProfile,
      update: updateFields(records.buyerProfile),
    });
    await transaction.buyerRegistration.upsert({
      where: {
        buyerId_auctionHouseId: {
          buyerId: records.buyerRegistration.buyerId,
          auctionHouseId: records.buyerRegistration.auctionHouseId,
        },
      },
      create: records.buyerRegistration,
      update: updateFields(records.buyerRegistration),
    });
    await transaction.auction.upsert({
      where: { id: records.auction.id },
      create: records.auction,
      update: updateFields(records.auction),
    });
    await transaction.auctionSettings.upsert({
      where: { auctionId: records.auctionSettings.auctionId },
      create: records.auctionSettings,
      update: updateFields(records.auctionSettings),
    });
    await transaction.stream.upsert({
      where: { auctionId: records.stream.auctionId },
      create: records.stream,
      update: updateFields(records.stream),
    });
    await transaction.lot.upsert({
      where: { id: records.lot.id },
      create: records.lot,
      update: updateFields(records.lot),
    });
  });

  return {
    auctionHouseEmail: records.auctionHouse.email,
    buyerEmail: records.buyer.email,
    auctionId: records.auction.id,
    lotId: records.lot.id,
  };
}

module.exports = {
  DEMO_IDS,
  assertDemoDatabaseUrl,
  buildDemoRecords,
  seedDefenseDemo,
};
