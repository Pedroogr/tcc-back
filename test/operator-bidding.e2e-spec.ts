import request from 'supertest';
import {
  AuctionStatus,
  BuyerRegistrationStatus,
  LotStatus,
} from '../generated/prisma/enums';
import {
  E2E_PASSWORD,
  createAuction,
  createAuctionHouse,
  createBuyer,
  createBuyerRegistration,
  createLot,
} from './support/factories';
import { resetDatabase } from './support/database';
import { E2eContext, createE2eApp } from './support/e2e-app';

function bodyOf(response: { body: unknown }): Record<string, any> {
  return response.body as Record<string, any>;
}

async function loginOffice(context: E2eContext, email: string) {
  const response = await request(context.httpServer)
    .post('/auth/login')
    .send({ email, password: E2E_PASSWORD });
  return String(bodyOf(response).accessToken);
}

async function activateOperator(
  context: E2eContext,
  officeToken: string,
  auctionId: string,
  label = 'Pista principal',
) {
  const created = await request(context.httpServer)
    .post('/operator/accesses')
    .set('Authorization', `Bearer ${officeToken}`)
    .send({ auctionId, label });
  const activated = await request(context.httpServer)
    .post('/operator/login')
    .send({ code: bodyOf(created).code });

  return {
    accessId: String(bodyOf(created).id),
    token: String(bodyOf(activated).accessToken),
  };
}

describe('operator bidding E2E', () => {
  let context: E2eContext;

  beforeAll(async () => {
    context = await createE2eApp();
  });

  beforeEach(async () => {
    await resetDatabase(context.prisma);
  });

  afterAll(async () => {
    await context.app.close();
  });

  it('searches only eligible buyers and returns a privacy-safe projection', async () => {
    const house = await createAuctionHouse(context.prisma);
    const otherHouse = await createAuctionHouse(context.prisma);
    const auction = await createAuction(context.prisma, house.id, {
      status: AuctionStatus.LIVE,
    });
    const officeToken = await loginOffice(context, house.email);
    const operator = await activateOperator(context, officeToken, auction.id);
    const eligible = await createBuyer(
      context.prisma,
      {},
      {
        name: 'Maria da Pista',
        document: '12345678901',
        phone: '51999999999',
      },
    );
    const pending = await createBuyer(
      context.prisma,
      {},
      { name: 'Maria Pendente' },
    );
    const rejected = await createBuyer(
      context.prisma,
      {},
      { name: 'Maria Rejeitada' },
    );
    const otherOffice = await createBuyer(
      context.prisma,
      {},
      { name: 'Maria Outro Escritorio' },
    );
    const withoutIe = await createBuyer(
      context.prisma,
      { ie: null, ieUf: null },
      { name: 'Maria Sem IE' },
    );
    await createBuyerRegistration(context.prisma, eligible.userId, house.id);
    await createBuyerRegistration(context.prisma, pending.userId, house.id, {
      status: BuyerRegistrationStatus.PENDING,
    });
    await createBuyerRegistration(context.prisma, rejected.userId, house.id, {
      status: BuyerRegistrationStatus.REJECTED,
    });
    await createBuyerRegistration(
      context.prisma,
      otherOffice.userId,
      otherHouse.id,
    );
    await createBuyerRegistration(context.prisma, withoutIe.userId, house.id);

    const byName = await request(context.httpServer)
      .get('/operator/buyers')
      .query({ query: 'maria' })
      .set('Authorization', `Bearer ${operator.token}`);
    expect(byName.status).toBe(200);
    expect(byName.body).toEqual([
      {
        id: eligible.userId,
        name: 'Maria da Pista',
        documentLast4: '8901',
      },
    ]);
    expect(JSON.stringify(byName.body)).not.toMatch(
      /email|phone|document"|buyerProfile|\bie\b/i,
    );

    const byDocument = await request(context.httpServer)
      .get('/operator/buyers')
      .query({ query: '8901' })
      .set('Authorization', `Bearer ${operator.token}`);
    expect(byDocument.body).toEqual(byName.body);

    const blank = await request(context.httpServer)
      .get('/operator/buyers')
      .query({ query: '   ' })
      .set('Authorization', `Bearer ${operator.token}`);
    expect(blank.status).toBe(200);
    expect(blank.body.length).toBeLessThanOrEqual(20);

    const tooLong = await request(context.httpServer)
      .get('/operator/buyers')
      .query({ query: 'x'.repeat(81) })
      .set('Authorization', `Bearer ${operator.token}`);
    expect(tooLong.status).toBe(400);
  });

  it('records an on-site bid with operator audit and enforces the minimum', async () => {
    const house = await createAuctionHouse(context.prisma);
    const auction = await createAuction(context.prisma, house.id, {
      status: AuctionStatus.LIVE,
    });
    await context.prisma.auctionSettings.create({
      data: { auctionId: auction.id, minBidIncrement: 100 },
    });
    const lot = await createLot(context.prisma, auction.id, {
      status: LotStatus.IN_AUCTION,
      initialPrice: 1000,
    });
    const buyer = await createBuyer(context.prisma);
    await createBuyerRegistration(context.prisma, buyer.userId, house.id);
    const officeToken = await loginOffice(context, house.email);
    const operator = await activateOperator(context, officeToken, auction.id);

    const session = await request(context.httpServer)
      .get('/operator/session')
      .set('Authorization', `Bearer ${operator.token}`);
    expect(bodyOf(session).currentLot).toMatchObject({
      id: lot.id,
      code: lot.code,
      status: 'IN_AUCTION',
      currentPrice: '1000',
      nextMinimumBid: '1100',
    });

    const placed = await request(context.httpServer)
      .post('/operator/bids')
      .set('Authorization', `Bearer ${operator.token}`)
      .send({ expectedLotId: lot.id, buyerId: buyer.userId, amount: 1000 });
    expect(placed.status).toBe(201);
    expect(bodyOf(placed)).not.toHaveProperty('operatorAccessId');
    expect(bodyOf(placed)).not.toHaveProperty('source');
    expect(
      await context.prisma.bid.findFirstOrThrow({ where: { lotId: lot.id } }),
    ).toMatchObject({
      source: 'ON_SITE',
      operatorAccessId: operator.accessId,
      bidderId: buyer.userId,
    });

    const belowMinimum = await request(context.httpServer)
      .post('/operator/bids')
      .set('Authorization', `Bearer ${operator.token}`)
      .send({ expectedLotId: lot.id, buyerId: buyer.userId, amount: 1050 });
    expect(belowMinimum.status).toBe(400);
  });

  it('rechecks buyer approval and IE when the bid is written', async () => {
    const house = await createAuctionHouse(context.prisma);
    const auction = await createAuction(context.prisma, house.id, {
      status: AuctionStatus.LIVE,
    });
    const lot = await createLot(context.prisma, auction.id, {
      status: LotStatus.IN_AUCTION,
    });
    const approved = await createBuyer(context.prisma);
    const pending = await createBuyer(context.prisma);
    await createBuyerRegistration(context.prisma, approved.userId, house.id);
    await createBuyerRegistration(context.prisma, pending.userId, house.id, {
      status: BuyerRegistrationStatus.PENDING,
    });
    const officeToken = await loginOffice(context, house.email);
    const operator = await activateOperator(context, officeToken, auction.id);

    const pendingBid = await request(context.httpServer)
      .post('/operator/bids')
      .set('Authorization', `Bearer ${operator.token}`)
      .send({ expectedLotId: lot.id, buyerId: pending.userId, amount: 1000 });
    expect(pendingBid.status).toBe(403);

    const search = await request(context.httpServer)
      .get('/operator/buyers')
      .query({ query: approved.user.name })
      .set('Authorization', `Bearer ${operator.token}`);
    expect(search.body).toHaveLength(1);
    await context.prisma.buyerProfile.update({
      where: { userId: approved.userId },
      data: { ie: null },
    });
    const missingIeBid = await request(context.httpServer)
      .post('/operator/bids')
      .set('Authorization', `Bearer ${operator.token}`)
      .send({ expectedLotId: lot.id, buyerId: approved.userId, amount: 1000 });
    expect(missingIeBid.status).toBe(403);
    expect(await context.prisma.bid.count()).toBe(0);
  });

  it('rejects revoked access, no active lot, wrong auction, and a stale lot', async () => {
    const house = await createAuctionHouse(context.prisma);
    const auction = await createAuction(context.prisma, house.id, {
      status: AuctionStatus.LIVE,
    });
    const otherAuction = await createAuction(context.prisma, house.id, {
      status: AuctionStatus.LIVE,
    });
    const lotA = await createLot(context.prisma, auction.id, {
      status: LotStatus.IN_AUCTION,
    });
    const lotB = await createLot(context.prisma, auction.id, {
      status: LotStatus.AVAILABLE,
    });
    const otherLot = await createLot(context.prisma, otherAuction.id, {
      status: LotStatus.IN_AUCTION,
    });
    const buyer = await createBuyer(context.prisma);
    await createBuyerRegistration(context.prisma, buyer.userId, house.id);
    const officeToken = await loginOffice(context, house.email);
    const revoked = await activateOperator(
      context,
      officeToken,
      auction.id,
      'Revogado',
    );
    await request(context.httpServer)
      .delete(`/operator/accesses/${revoked.accessId}`)
      .set('Authorization', `Bearer ${officeToken}`);
    expect(
      (
        await request(context.httpServer)
          .post('/operator/bids')
          .set('Authorization', `Bearer ${revoked.token}`)
          .send({ expectedLotId: lotA.id, buyerId: buyer.userId, amount: 1000 })
      ).status,
    ).toBe(401);

    const operator = await activateOperator(context, officeToken, auction.id);
    const wrongAuction = await request(context.httpServer)
      .post('/operator/bids')
      .set('Authorization', `Bearer ${operator.token}`)
      .send({
        expectedLotId: otherLot.id,
        buyerId: buyer.userId,
        amount: 1000,
      });
    expect(wrongAuction.status).toBe(409);

    await context.prisma.$transaction([
      context.prisma.lot.update({
        where: { id: lotA.id },
        data: { status: LotStatus.AVAILABLE },
      }),
      context.prisma.lot.update({
        where: { id: lotB.id },
        data: { status: LotStatus.IN_AUCTION },
      }),
    ]);
    const stale = await request(context.httpServer)
      .post('/operator/bids')
      .set('Authorization', `Bearer ${operator.token}`)
      .send({ expectedLotId: lotA.id, buyerId: buyer.userId, amount: 1000 });
    expect(stale.status).toBe(409);
    expect(await context.prisma.bid.count({ where: { lotId: lotA.id } })).toBe(
      0,
    );
    expect(await context.prisma.bid.count({ where: { lotId: lotB.id } })).toBe(
      0,
    );

    await context.prisma.lot.update({
      where: { id: lotB.id },
      data: { status: LotStatus.AVAILABLE },
    });
    const noActiveLot = await request(context.httpServer)
      .post('/operator/bids')
      .set('Authorization', `Bearer ${operator.token}`)
      .send({ expectedLotId: lotB.id, buyerId: buyer.userId, amount: 1000 });
    expect(noActiveLot.status).toBe(409);
  });

  it('keeps exactly one winning bid when two operators bid concurrently', async () => {
    const house = await createAuctionHouse(context.prisma);
    const auction = await createAuction(context.prisma, house.id, {
      status: AuctionStatus.LIVE,
    });
    const lot = await createLot(context.prisma, auction.id, {
      status: LotStatus.IN_AUCTION,
      initialPrice: 1000,
    });
    const firstBuyer = await createBuyer(context.prisma);
    const secondBuyer = await createBuyer(context.prisma);
    await createBuyerRegistration(context.prisma, firstBuyer.userId, house.id);
    await createBuyerRegistration(context.prisma, secondBuyer.userId, house.id);
    const officeToken = await loginOffice(context, house.email);
    const firstOperator = await activateOperator(
      context,
      officeToken,
      auction.id,
      'Pista 1',
    );
    const secondOperator = await activateOperator(
      context,
      officeToken,
      auction.id,
      'Pista 2',
    );

    const responses = await Promise.all([
      request(context.httpServer)
        .post('/operator/bids')
        .set('Authorization', `Bearer ${firstOperator.token}`)
        .send({
          expectedLotId: lot.id,
          buyerId: firstBuyer.userId,
          amount: 1000,
        }),
      request(context.httpServer)
        .post('/operator/bids')
        .set('Authorization', `Bearer ${secondOperator.token}`)
        .send({
          expectedLotId: lot.id,
          buyerId: secondBuyer.userId,
          amount: 1000,
        }),
    ]);

    expect(responses.every(({ status }) => status === 201)).toBe(true);
    expect(
      await context.prisma.bid.count({
        where: { lotId: lot.id, status: 'WINNING' },
      }),
    ).toBe(1);
    expect(await context.prisma.bid.count({ where: { lotId: lot.id } })).toBe(
      2,
    );
  });
});
