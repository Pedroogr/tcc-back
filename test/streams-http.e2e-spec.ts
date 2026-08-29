/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import { AuctionStatus } from '../generated/prisma/enums';
import {
  E2E_PASSWORD,
  createAuction,
  createAuctionHouse,
  createUser,
} from './support/factories';
import { resetDatabase } from './support/database';
import { E2eContext, createE2eApp } from './support/e2e-app';

const b = (r: { body: unknown }) => r.body as Record<string, any>;
async function login(c: E2eContext, email: string) {
  return String(
    b(
      await request(c.httpServer)
        .post('/auth/login')
        .send({ email, password: E2E_PASSWORD }),
    ).accessToken,
  );
}

describe('streams HTTP E2E', () => {
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

  it('starts and stops a stream for its owning office', async () => {
    const house = await createAuctionHouse(c.prisma);
    const auction = await createAuction(c.prisma, house.id, {
      status: AuctionStatus.SCHEDULED,
    });
    const token = await login(c, house.email);
    const started = await request(c.httpServer)
      .post(`/auctions/${auction.id}/stream/start`)
      .set('Authorization', `Bearer ${token}`);
    expect(started.status).toBe(201);
    expect(b(started)).toMatchObject({
      auctionId: auction.id,
      canBroadcast: true,
      stream: { status: 'LIVE', protocol: 'WEBRTC' },
    });
    const stopped = await request(c.httpServer)
      .post(`/auctions/${auction.id}/stream/stop`)
      .set('Authorization', `Bearer ${token}`);
    expect(stopped.status).toBe(201);
    expect(b(stopped).stream.status).toBe('ENDED');
  });

  it('allows read access but not broadcast controls to regular users', async () => {
    const house = await createAuctionHouse(c.prisma);
    const auction = await createAuction(c.prisma, house.id, {
      status: AuctionStatus.SCHEDULED,
    });
    const token = await login(c, (await createUser(c.prisma)).email);
    const read = await request(c.httpServer)
      .get(`/auctions/${auction.id}/stream`)
      .set('Authorization', `Bearer ${token}`);
    expect(read.status).toBe(200);
    expect(b(read)).toMatchObject({
      canBroadcast: false,
      room: `auction:${auction.id}`,
    });
    expect(
      (
        await request(c.httpServer)
          .post(`/auctions/${auction.id}/stream/start`)
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(403);
  });

  it('rejects wrong owners, invalid auction states, and missing auth', async () => {
    const house = await createAuctionHouse(c.prisma);
    const other = await createAuctionHouse(c.prisma);
    const auction = await createAuction(c.prisma, house.id, {
      status: AuctionStatus.DRAFT,
    });
    const otherToken = await login(c, other.email);
    expect(
      (await request(c.httpServer).get(`/auctions/${auction.id}/stream`))
        .status,
    ).toBe(401);
    expect(
      (
        await request(c.httpServer)
          .post(`/auctions/${auction.id}/stream/start`)
          .set('Authorization', `Bearer ${otherToken}`)
      ).status,
    ).toBe(403);
    const token = await login(c, house.email);
    expect(
      (
        await request(c.httpServer)
          .post(`/auctions/${auction.id}/stream/start`)
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(400);
    expect(
      (
        await request(c.httpServer)
          .get('/auctions/00000000-0000-0000-0000-000000000000/stream')
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(404);
  });
});
