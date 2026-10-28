const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEMO_IDS,
  assertDemoDatabaseUrl,
  buildDemoRecords,
  seedDefenseDemo,
} = require('../demo-data');

test('assertDemoDatabaseUrl accepts only the isolated demo database', () => {
  assert.doesNotThrow(() =>
    assertDemoDatabaseUrl(
      'postgresql://postgres:postgres@127.0.0.1:5435/cattle_auction_demo',
    ),
  );
  assert.throws(
    () =>
      assertDemoDatabaseUrl(
        'postgresql://postgres:postgres@127.0.0.1:5434/cattle_auction',
      ),
    /cattle_auction_demo/,
  );
});

test('buildDemoRecords uses stable ids without storing a plain password', () => {
  const records = buildDemoRecords('bcrypt-hash');

  assert.equal(records.auctionHouse.id, DEMO_IDS.auctionHouse);
  assert.equal(records.buyer.id, DEMO_IDS.buyer);
  assert.equal(records.auction.id, DEMO_IDS.auction);
  assert.equal(records.lot.id, DEMO_IDS.lot);
  assert.equal(records.auction.status, 'LIVE');
  assert.equal(records.lot.status, 'IN_AUCTION');
  assert.doesNotMatch(JSON.stringify(records), /senha-temporaria/);
});

test('seedDefenseDemo upserts the complete demo without destructive calls', async () => {
  const calls = [];
  const models = [
    'auctionHouse',
    'user',
    'buyerProfile',
    'buyerRegistration',
    'auction',
    'auctionSettings',
    'stream',
    'lot',
  ];
  const prisma = {
    async $transaction(operation) {
      return operation(this);
    },
  };
  for (const model of models) {
    prisma[model] = {
      async upsert(args) {
        calls.push({ model, args });
        return args.create;
      },
    };
  }

  const summary = await seedDefenseDemo(prisma, 'senha-temporaria', {
    hashPassword: async () => 'bcrypt-hash',
  });

  assert.deepEqual(
    calls.map(({ model }) => model),
    models,
  );
  assert.equal(
    calls.find(({ model }) => model === 'auctionHouse').args.create.status,
    'ACTIVE',
  );
  assert.equal(
    calls.find(({ model }) => model === 'buyerProfile').args.create
      .verificationStatus,
    'APPROVED',
  );
  assert.equal(
    calls.find(({ model }) => model === 'buyerRegistration').args.create
      .status,
    'APPROVED',
  );
  assert.equal(
    calls.find(({ model }) => model === 'stream').args.create.status,
    'WAITING',
  );
  assert.deepEqual(summary, {
    auctionHouseEmail: 'escritorio.demo@tcc.local',
    buyerEmail: 'comprador.demo@tcc.local',
    auctionId: DEMO_IDS.auction,
    lotId: DEMO_IDS.lot,
  });
  assert.doesNotMatch(JSON.stringify(calls), /senha-temporaria/);
  assert.equal(
    calls.some(({ args }) => 'deleteMany' in args),
    false,
  );
});

test('seedDefenseDemo rejects a blank password before touching Prisma', async () => {
  const prisma = {
    $transaction() {
      assert.fail('Prisma must not be called for a blank password');
    },
  };

  await assert.rejects(
    seedDefenseDemo(prisma, '   '),
    /DEMO_PASSWORD/,
  );
});
