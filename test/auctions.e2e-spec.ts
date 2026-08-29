/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import request from 'supertest';
import {
  AuctionStatus,
  BuyerRegistrationStatus,
} from '../generated/prisma/enums';
import {
  E2E_PASSWORD,
  createAuction,
  createAuctionHouse,
  createUser,
} from './support/factories';
import { resetDatabase } from './support/database';
import { E2eContext, createE2eApp } from './support/e2e-app';

function bodyOf(response: { body: unknown }): Record<string, any> {
  return response.body as Record<string, any>;
}
async function login(context: E2eContext, email: string) {
  const response = await request(context.httpServer)
    .post('/auth/login')
    .send({ email, password: E2E_PASSWORD });
  return String(bodyOf(response).accessToken);
}

describe('auctions E2E', () => {
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

  it('creates auctions only for the owning auction house and exposes public statuses', async () => {
    const house = await createAuctionHouse(context.prisma);
    const other = await createAuctionHouse(context.prisma);
    const token = await login(context, house.email);
    const created = await request(context.httpServer)
      .post('/auctions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: '  Spring sale  ',
        description: 'Animals',
        status: AuctionStatus.SCHEDULED,
        scheduledAt: '2030-01-01T12:00:00.000Z',
      });
    expect(created.status).toBe(201);
    expect(bodyOf(created)).toMatchObject({
      title: '  Spring sale  ',
      auctionHouseId: house.id,
      status: 'SCHEDULED',
    });
    const hidden = await createAuction(context.prisma, house.id, {
      status: AuctionStatus.DRAFT,
    });
    const publicAuction = await createAuction(context.prisma, house.id, {
      status: AuctionStatus.SCHEDULED,
    });
    await createAuction(context.prisma, other.id, {
      status: AuctionStatus.CANCELED,
    });
    const publicIds = (
      await request(context.httpServer).get('/auctions/public')
    ).body.map((a: any) => a.id);
    expect(publicIds).toEqual(
      expect.arrayContaining([publicAuction.id, created.body.id]),
    );
    expect(publicIds).not.toContain(hidden.id);
  });

  it('supports owner updates, deletion, and rejects another office', async () => {
    const house = await createAuctionHouse(context.prisma);
    const other = await createAuctionHouse(context.prisma);
    const auction = await createAuction(context.prisma, house.id);
    const token = await login(context, house.email);
    const otherToken = await login(context, other.email);
    expect(
      (
        await request(context.httpServer)
          .patch(`/auctions/${auction.id}`)
          .set('Authorization', `Bearer ${otherToken}`)
          .send({ title: 'x' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(context.httpServer)
          .patch(`/auctions/${auction.id}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ title: 'Updated', status: AuctionStatus.SCHEDULED })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(context.httpServer)
          .delete(`/auctions/${auction.id}`)
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(200);
    expect(
      (await request(context.httpServer).get(`/auctions/${auction.id}`)).status,
    ).toBe(404);
  });

  it('handles thumbnail upload validation and removal', async () => {
    const house = await createAuctionHouse(context.prisma);
    const auction = await createAuction(context.prisma, house.id);
    const token = await login(context, house.email);
    expect(
      (
        await request(context.httpServer)
          .post(`/auctions/${auction.id}/thumbnail`)
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(400);
    const uploaded = await request(context.httpServer)
      .post(`/auctions/${auction.id}/thumbnail`)
      .set('Authorization', `Bearer ${token}`)
      .attach('thumbnail', Buffer.from('fake-png'), {
        filename: 'cover.png',
        contentType: 'image/png',
      });
    expect(uploaded.status).toBe(201);
    expect(String(bodyOf(uploaded).thumbnailUrl)).toContain(
      '/uploads/auctions/',
    );
    expect(
      (
        await request(context.httpServer)
          .delete(`/auctions/${auction.id}/thumbnail`)
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(200);
  });

  it('registers buyers and lets the owning office review registrations', async () => {
    const house = await createAuctionHouse(context.prisma);
    const auction = await createAuction(context.prisma, house.id);
    const user = await createUser(context.prisma);
    const userToken = await login(context, user.email);
    const houseToken = await login(context, house.email);
    const registration = await request(context.httpServer)
      .post(`/auctions/${auction.id}/buyer-registrations`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ notes: 'ready' });
    expect(registration.status).toBe(201);
    expect(bodyOf(registration).status).toBe('PENDING');
    const listed = await request(context.httpServer)
      .get(`/auctions/${auction.id}/buyer-registrations`)
      .set('Authorization', `Bearer ${houseToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body[0].buyer.id).toBe(user.id);
    const reviewed = await request(context.httpServer)
      .patch(
        `/auctions/${auction.id}/buyer-registrations/${bodyOf(registration).id}`,
      )
      .set('Authorization', `Bearer ${houseToken}`)
      .send({ status: BuyerRegistrationStatus.APPROVED });
    expect(reviewed.status).toBe(200);
    expect(bodyOf(reviewed).approvedAt).toEqual(expect.any(String));
  });
});
