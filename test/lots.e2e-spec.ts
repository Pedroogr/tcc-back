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
  createConsignment,
  createLot,
  createUser,
} from './support/factories';
import { resetDatabase } from './support/database';
import { E2eContext, createE2eApp } from './support/e2e-app';
import { CommerceGateway } from '../src/commerce/commerce.gateway';

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
          .send({ title: 'Updated' })
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
      status: LotStatus.IN_AUCTION,
      initialPrice: 100,
    });
    const buyer = await createBuyer(c.prisma);
    const token = await login(c, buyer.user.email);
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
        buyerId: buyer.userId,
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
          .send({ amount: 95 })
      ).status,
    ).toBe(400);
    const second = await request(c.httpServer)
      .post(`/lots/${lot.id}/bids`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 105 });
    expect(second.status).toBe(201);
    expect(
      (await c.prisma.bid.findUnique({ where: { id: body(first).id } }))
        ?.status,
    ).toBe('OUTBID');
  });

  it('restricts stage transitions to the owning office and valid states', async () => {
    const house = await createAuctionHouse(c.prisma);
    const auction = await createAuction(c.prisma, house.id);
    const otherHouse = await createAuctionHouse(c.prisma);
    const otherAuction = await createAuction(c.prisma, otherHouse.id);
    const seller = await createUser(c.prisma);
    const consignment = await createConsignment(c.prisma, seller.id, house.id);
    const lot = await createLot(c.prisma, auction.id, {
      status: LotStatus.UNDER_REVIEW,
      consignmentId: consignment.id,
    });
    const officeToken = await login(c, house.email);
    const sellerToken = await login(c, seller.email);

    await request(c.httpServer)
      .patch(`/lots/${lot.id}/stage`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ status: LotStatus.IN_AUCTION })
      .expect(403);
    await request(c.httpServer)
      .patch(`/lots/${lot.id}`)
      .set('Authorization', `Bearer ${officeToken}`)
      .send({ status: LotStatus.IN_AUCTION })
      .expect(400);
    await request(c.httpServer)
      .patch(`/lots/${lot.id}`)
      .set('Authorization', `Bearer ${officeToken}`)
      .send({ auctionId: otherAuction.id })
      .expect(400);
    expect(
      await c.prisma.lot.findUnique({
        where: { id: lot.id },
        select: { auctionId: true },
      }),
    ).toEqual({ auctionId: auction.id });

    const inAuction = await request(c.httpServer)
      .patch(`/lots/${lot.id}/stage`)
      .set('Authorization', `Bearer ${officeToken}`)
      .send({ status: LotStatus.IN_AUCTION });
    expect(inAuction.status).toBe(200);
    expect(body(inAuction).status).toBe(LotStatus.IN_AUCTION);

    const available = await request(c.httpServer)
      .patch(`/lots/${lot.id}/stage`)
      .set('Authorization', `Bearer ${officeToken}`)
      .send({ status: LotStatus.AVAILABLE });
    expect(available.status).toBe(200);
    expect(body(available).status).toBe(LotStatus.AVAILABLE);

    await c.prisma.lot.update({
      where: { id: lot.id },
      data: { status: LotStatus.SOLD },
    });
    await request(c.httpServer)
      .patch(`/lots/${lot.id}/stage`)
      .set('Authorization', `Bearer ${officeToken}`)
      .send({ status: LotStatus.IN_AUCTION })
      .expect(400);
  });

  it('rejects a second lot in auction at the same time', async () => {
    const house = await createAuctionHouse(c.prisma);
    const auction = await createAuction(c.prisma, house.id);
    await createLot(c.prisma, auction.id, {
      status: LotStatus.IN_AUCTION,
    });
    const waitingLot = await createLot(c.prisma, auction.id, {
      status: LotStatus.AVAILABLE,
    });
    const token = await login(c, house.email);
    const emitStage = jest
      .spyOn(c.app.get(CommerceGateway), 'emitLotStageChanged')
      .mockImplementation(() => undefined);

    await request(c.httpServer)
      .patch(`/lots/${waitingLot.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: LotStatus.IN_AUCTION })
      .expect(400);
    expect(emitStage).not.toHaveBeenCalled();

    expect(
      await c.prisma.lot.count({
        where: { auctionId: auction.id, status: LotStatus.IN_AUCTION },
      }),
    ).toBe(1);
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
