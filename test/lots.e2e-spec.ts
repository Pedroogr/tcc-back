/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
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
  createLot,
  createUser,
} from './support/factories';
import { resetDatabase } from './support/database';
import { E2eContext, createE2eApp } from './support/e2e-app';

const body = (r: { body: unknown }) => r.body as Record<string, any>;
async function login(c: E2eContext, email: string) {
  return String(
    body(
      await request(c.httpServer)
        .post('/auth/login')
        .send({ email, password: E2E_PASSWORD }),
    ).accessToken,
  );
}

describe('lots E2E', () => {
  let c: E2eContext;
  beforeAll(async () => {
    c = await createE2eApp();
  });
  beforeEach(async () => {
    await resetDatabase(c.prisma);
  });
  afterAll(async () => {
    await c.app.close();
  });

  it('creates, lists, updates, and deletes lots for the owning office', async () => {
    const house = await createAuctionHouse(c.prisma);
    const other = await createAuctionHouse(c.prisma);
    const auction = await createAuction(c.prisma, house.id);
    const token = await login(c, house.email);
    const otherToken = await login(c, other.email);
    const created = await request(c.httpServer)
      .post('/lots')
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'L-1',
        title: 'Bull',
        auctionId: auction.id,
        initialPrice: 100,
      });
    expect(created.status).toBe(201);
    expect(body(created)).toMatchObject({
      code: 'L-1',
      status: 'UNDER_REVIEW',
      auctionId: auction.id,
    });
    expect(
      (
        await request(c.httpServer)
          .patch(`/lots/${body(created).id}`)
          .set('Authorization', `Bearer ${otherToken}`)
          .send({ title: 'x' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(c.httpServer)
          .patch(`/lots/${body(created).id}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ title: 'Updated', status: LotStatus.AVAILABLE })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(c.httpServer)
          .delete(`/lots/${body(created).id}`)
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(200);
  });

  it('requires an approved buyer and enforces minimum winning bids', async () => {
    const house = await createAuctionHouse(c.prisma);
    const auction = await createAuction(c.prisma, house.id, {
      status: AuctionStatus.LIVE,
    });
    const lot = await createLot(c.prisma, auction.id, {
      status: LotStatus.AVAILABLE,
      initialPrice: 100,
    });
    const buyer = await createUser(c.prisma);
    const token = await login(c, buyer.email);
    expect(
      (
        await request(c.httpServer)
          .post(`/lots/${lot.id}/bids`)
          .set('Authorization', `Bearer ${token}`)
          .send({ amount: 100 })
      ).status,
    ).toBe(403);
    await c.prisma.buyerRegistration.create({
      data: {
        buyerId: buyer.id,
        auctionHouseId: house.id,
        status: BuyerRegistrationStatus.APPROVED,
      },
    });
    const first = await request(c.httpServer)
      .post(`/lots/${lot.id}/bids`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 100 });
    expect(first.status).toBe(201);
    expect(body(first).status).toBe('WINNING');
    expect(
      (
        await request(c.httpServer)
          .post(`/lots/${lot.id}/bids`)
          .set('Authorization', `Bearer ${token}`)
          .send({ amount: 99 })
      ).status,
    ).toBe(400);
    const second = await request(c.httpServer)
      .post(`/lots/${lot.id}/bids`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 101 });
    expect(second.status).toBe(201);
    expect(
      (await c.prisma.bid.findUnique({ where: { id: body(first).id } }))
        ?.status,
    ).toBe('OUTBID');
  });

  it('saves valid lot images and rejects malformed image data', async () => {
    const house = await createAuctionHouse(c.prisma);
    const auction = await createAuction(c.prisma, house.id);
    const token = await login(c, house.email);
    const created = await request(c.httpServer)
      .post('/lots')
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'IMG',
        title: 'Image lot',
        auctionId: auction.id,
        images: [
          {
            fileName: 'x.png',
            dataUrl: 'data:image/png;base64,ZmFrZQ==',
            description: 'front',
          },
        ],
      });
    expect(created.status).toBe(201);
    expect(body(created).media[0].url).toContain('/uploads/lots/');
    expect(
      (
        await request(c.httpServer)
          .post('/lots')
          .set('Authorization', `Bearer ${token}`)
          .send({
            code: 'BAD',
            title: 'Bad',
            auctionId: auction.id,
            images: [{ fileName: 'x', dataUrl: 'not-an-image' }],
          })
      ).status,
    ).toBe(400);
  });
});
