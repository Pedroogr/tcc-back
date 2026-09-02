import request from 'supertest';
import { LotStatus } from '../generated/prisma/enums';
import {
  E2E_PASSWORD,
  createAuction,
  createAuctionHouse,
  createBuyerRegistration,
  createLot,
  createUser,
} from './support/factories';
import { resetDatabase } from './support/database';
import { E2eContext, createE2eApp } from './support/e2e-app';

async function login(context: E2eContext, email: string) {
  const response = await request(context.httpServer)
    .post('/auth/login')
    .send({ email, password: E2E_PASSWORD });

  expect(response.status).toBe(201);
  const token = (response.body as { accessToken?: string }).accessToken;

  if (typeof token !== 'string') {
    throw new Error('Expected an access token from login');
  }

  return token;
}

describe('bidding (e2e)', () => {
  let context: E2eContext;

  beforeAll(async () => {
    context = await createE2eApp();
  });

  beforeEach(async () => {
    await resetDatabase(context.prisma);
  });

  afterAll(async () => {
    await context?.app.close();
  });

  it('records every bid, keeps a single winner and never exposes bidders publicly', async () => {
    const auctionHouse = await createAuctionHouse(context.prisma);
    const auction = await createAuction(context.prisma, auctionHouse.id);
    const lot = await createLot(context.prisma, auction.id, {
      status: LotStatus.IN_AUCTION,
    });

    const firstBuyer = await createUser(context.prisma, {
      name: 'Comprador Um',
    });
    const secondBuyer = await createUser(context.prisma, {
      name: 'Comprador Dois',
    });
    await createBuyerRegistration(
      context.prisma,
      firstBuyer.id,
      auctionHouse.id,
    );
    await createBuyerRegistration(
      context.prisma,
      secondBuyer.id,
      auctionHouse.id,
    );

    const firstToken = await login(context, firstBuyer.email);
    const secondToken = await login(context, secondBuyer.email);

    const firstResponse = await request(context.httpServer)
      .post(`/lots/${lot.id}/bids`)
      .set('Authorization', `Bearer ${firstToken}`)
      .send({ amount: 1000 });

    const secondResponse = await request(context.httpServer)
      .post(`/lots/${lot.id}/bids`)
      .set('Authorization', `Bearer ${secondToken}`)
      .send({ amount: 1100 });

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(secondResponse.body).toEqual(
      expect.objectContaining({
        lotId: lot.id,
        amount: '1100',
        status: 'WINNING',
      }),
    );
    expect(secondResponse.body).not.toHaveProperty('bidderId');
    expect(secondResponse.body).not.toHaveProperty('bidder');

    const stored = await context.prisma.bid.findMany({
      where: { lotId: lot.id },
      orderBy: { amount: 'asc' },
    });
    expect(stored).toHaveLength(2);
    expect(stored.map((bid) => bid.status)).toEqual(['OUTBID', 'WINNING']);

    const publicLot = await request(context.httpServer).get(`/lots/${lot.id}`);
    expect(publicLot.body.currentPrice).toBe('1100');
    expect(publicLot.body).not.toHaveProperty('bids');
    expect(JSON.stringify(publicLot.body)).not.toContain(firstBuyer.email);
    expect(JSON.stringify(publicLot.body)).not.toContain(secondBuyer.email);
  });

  it('rejects bids on a lot that is not in auction', async () => {
    const auctionHouse = await createAuctionHouse(context.prisma);
    const auction = await createAuction(context.prisma, auctionHouse.id);
    const lot = await createLot(context.prisma, auction.id, {
      status: LotStatus.AVAILABLE,
    });
    const buyer = await createUser(context.prisma);
    await createBuyerRegistration(context.prisma, buyer.id, auctionHouse.id);
    const token = await login(context, buyer.email);

    const response = await request(context.httpServer)
      .post(`/lots/${lot.id}/bids`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 1000 });

    expect(response.status).toBe(403);
  });

  it('rejects bids from a buyer who is not approved by the auction house', async () => {
    const auctionHouse = await createAuctionHouse(context.prisma);
    const auction = await createAuction(context.prisma, auctionHouse.id);
    const lot = await createLot(context.prisma, auction.id, {
      status: LotStatus.IN_AUCTION,
    });
    const buyer = await createUser(context.prisma);
    const token = await login(context, buyer.email);

    const response = await request(context.httpServer)
      .post(`/lots/${lot.id}/bids`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 1000 });

    expect(response.status).toBe(403);
  });

  it('hides the bid history from buyers but shows it to the owner office', async () => {
    const auctionHouse = await createAuctionHouse(context.prisma);
    const auction = await createAuction(context.prisma, auctionHouse.id);
    const lot = await createLot(context.prisma, auction.id, {
      status: LotStatus.IN_AUCTION,
    });

    const firstBuyer = await createUser(context.prisma, {
      name: 'Comprador A',
    });
    const secondBuyer = await createUser(context.prisma, {
      name: 'Comprador B',
    });
    await createBuyerRegistration(
      context.prisma,
      firstBuyer.id,
      auctionHouse.id,
    );
    await createBuyerRegistration(
      context.prisma,
      secondBuyer.id,
      auctionHouse.id,
    );
    const firstToken = await login(context, firstBuyer.email);
    const secondToken = await login(context, secondBuyer.email);
    const officeToken = await login(context, auctionHouse.email);

    await request(context.httpServer)
      .post(`/lots/${lot.id}/bids`)
      .set('Authorization', `Bearer ${firstToken}`)
      .send({ amount: 1000 })
      .expect(201);
    await request(context.httpServer)
      .post(`/lots/${lot.id}/bids`)
      .set('Authorization', `Bearer ${secondToken}`)
      .send({ amount: 1100 })
      .expect(201);

    const buyerHistory = await request(context.httpServer)
      .get(`/lots/${lot.id}/bids`)
      .set('Authorization', `Bearer ${firstToken}`);
    expect(buyerHistory.status).toBe(403);

    const officeHistory = await request(context.httpServer)
      .get(`/lots/${lot.id}/bids`)
      .set('Authorization', `Bearer ${officeToken}`);
    expect(officeHistory.status).toBe(200);
    expect(officeHistory.body).toHaveLength(2);
    expect(officeHistory.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: '1100',
          status: 'WINNING',
          bidder: { id: secondBuyer.id, name: 'Comprador B' },
        }),
        expect.objectContaining({
          amount: '1000',
          status: 'OUTBID',
          bidder: { id: firstBuyer.id, name: 'Comprador A' },
        }),
      ]),
    );
  });
});
