import request from 'supertest';
import { verify } from 'jsonwebtoken';
import {
  AuctionStatus,
  BidStatus,
  PlatformRole,
  UserStatus,
} from '../generated/prisma/client';
import {
  E2E_PASSWORD,
  createAuction,
  createAuctionHouse,
  createBid,
  createBuyer,
  createLot,
  createUser,
} from './support/factories';
import { resetDatabase } from './support/database';
import { E2eContext, createE2eApp } from './support/e2e-app';

function bodyOf(response: { body: unknown }): Record<string, unknown> {
  if (
    typeof response.body !== 'object' ||
    response.body === null ||
    Array.isArray(response.body)
  ) {
    throw new Error('Expected an object response body');
  }
  return response.body as Record<string, unknown>;
}

async function login(context: E2eContext, email: string) {
  const response = await request(context.httpServer)
    .post('/auth/login')
    .send({ email, password: E2E_PASSWORD });
  expect(response.status).toBe(201);
  const body = bodyOf(response);
  expect(typeof body.accessToken).toBe('string');
  return body.accessToken as string;
}

describe('users and access control (e2e)', () => {
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

  it('returns the authenticated user and never exposes its password hash', async () => {
    const user = await createUser(context.prisma, { phone: '11988881234' });
    const token = await login(context, user.email);

    const response = await request(context.httpServer)
      .get('/users/me')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(bodyOf(response)).toMatchObject({
      id: user.id,
      email: user.email,
      platformRole: 'USER',
      status: 'ACTIVE',
    });
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('creates and updates a seller profile and keeps buyer profile creation idempotent', async () => {
    const user = await createUser(context.prisma);
    const token = await login(context, user.email);

    const seller = await request(context.httpServer)
      .post('/users/me/seller-profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ farmName: 'Fazenda E2E', city: 'Ribeirao Preto', state: 'SP' });
    expect(seller.status).toBe(201);
    expect(bodyOf(seller)).toMatchObject({
      sellerProfile: { farmName: 'Fazenda E2E', city: 'Ribeirao Preto' },
    });

    const updated = await request(context.httpServer)
      .post('/users/me/seller-profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ farmName: 'Fazenda Atualizada', country: 'BR' });
    expect(updated.status).toBe(201);
    expect(bodyOf(updated)).toMatchObject({
      sellerProfile: { farmName: 'Fazenda Atualizada', country: 'BR' },
    });

    const firstBuyer = await request(context.httpServer)
      .post('/users/me/buyer-profile')
      .set('Authorization', `Bearer ${token}`);
    const secondBuyer = await request(context.httpServer)
      .post('/users/me/buyer-profile')
      .set('Authorization', `Bearer ${token}`);
    expect(firstBuyer.status).toBe(201);
    expect(secondBuyer.status).toBe(201);
    expect(bodyOf(firstBuyer).buyerProfile).toMatchObject({ userId: user.id });
    expect(bodyOf(secondBuyer).buyerProfile).toMatchObject({ userId: user.id });
    expect(
      await context.prisma.buyerProfile.count({ where: { userId: user.id } }),
    ).toBe(1);
  });

  it('rehashes a password through self-update and can log in with the new password', async () => {
    const user = await createUser(context.prisma);
    const token = await login(context, user.email);

    const update = await request(context.httpServer)
      .patch(`/users/${user.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'new-password' });
    expect(update.status).toBe(200);
    expect(JSON.stringify(update.body)).not.toContain('passwordHash');

    const oldLogin = await request(context.httpServer)
      .post('/auth/login')
      .send({ email: user.email, password: E2E_PASSWORD });
    const newLogin = await request(context.httpServer)
      .post('/auth/login')
      .send({ email: user.email, password: 'new-password' });
    expect(oldLogin.status).toBe(401);
    expect(newLogin.status).toBe(201);
  });

  it.each([
    [
      'missing seller profile field type',
      '/users/me/seller-profile',
      { farmName: 42 },
    ],
    [
      'unknown seller profile field',
      '/users/me/seller-profile',
      { unexpected: true },
    ],
  ])('rejects invalid self-service DTO: %s', async (_name, path, payload) => {
    const user = await createUser(context.prisma);
    const token = await login(context, user.email);
    const response = await request(context.httpServer)
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    expect(response.status).toBe(400);
  });

  it('requires authentication and rejects inactive users on protected routes', async () => {
    const user = await createUser(context.prisma, {
      status: UserStatus.BLOCKED,
    });
    const token = await login(context, user.email).catch(() => undefined);
    expect(token).toBeUndefined();
    expect((await request(context.httpServer).get('/users/me')).status).toBe(
      401,
    );
  });

  it('allows only system admins to list users and self or admins to access a target', async () => {
    const self = await createUser(context.prisma);
    const other = await createUser(context.prisma);
    const admin = await createUser(context.prisma, {
      platformRole: PlatformRole.SYSTEM_ADMIN,
    });
    const selfToken = await login(context, self.email);
    const otherToken = await login(context, other.email);
    const adminToken = await login(context, admin.email);

    expect(
      (
        await request(context.httpServer)
          .get('/users')
          .set('Authorization', `Bearer ${selfToken}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(context.httpServer)
          .get('/users')
          .set('Authorization', `Bearer ${adminToken}`)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(context.httpServer)
          .get(`/users/${self.id}`)
          .set('Authorization', `Bearer ${selfToken}`)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(context.httpServer)
          .get(`/users/${self.id}`)
          .set('Authorization', `Bearer ${otherToken}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(context.httpServer)
          .get(`/users/${self.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
      ).status,
    ).toBe(200);
  });

  it('protects self update and delete from other users and anonymous callers', async () => {
    const self = await createUser(context.prisma);
    const other = await createUser(context.prisma);
    const selfToken = await login(context, self.email);
    const otherToken = await login(context, other.email);

    expect(
      (
        await request(context.httpServer)
          .patch(`/users/${self.id}`)
          .send({ name: 'Nope' })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(context.httpServer)
          .patch(`/users/${self.id}`)
          .set('Authorization', `Bearer ${otherToken}`)
          .send({ name: 'Nope' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(context.httpServer)
          .patch(`/users/${self.id}`)
          .set('Authorization', `Bearer ${selfToken}`)
          .send({ name: 'Updated' })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(context.httpServer)
          .delete(`/users/${self.id}`)
          .set('Authorization', `Bearer ${otherToken}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(context.httpServer)
          .delete(`/users/${self.id}`)
          .set('Authorization', `Bearer ${selfToken}`)
      ).status,
    ).toBe(200);
  });

  it('returns a verifiable JWT with role claims for a system administrator', async () => {
    const admin = await createUser(context.prisma, {
      platformRole: PlatformRole.SYSTEM_ADMIN,
    });
    const token = await login(context, admin.email);
    expect(verify(token, process.env.JWT_SECRET as string)).toMatchObject({
      sub: admin.id,
      platformRole: 'SYSTEM_ADMIN',
    });
  });

  it('cascades profiles, registrations and bids when deleting a user', async () => {
    const house = await createAuctionHouse(context.prisma);
    const auction = await createAuction(context.prisma, house.id, {
      status: AuctionStatus.LIVE,
    });
    const lot = await createLot(context.prisma, auction.id);
    const buyer = await createBuyer(context.prisma);
    await context.prisma.buyerRegistration.create({
      data: { buyerId: buyer.userId, auctionHouseId: house.id },
    });
    await createBid(context.prisma, lot.id, buyer.userId, {
      status: BidStatus.WINNING,
    });
    const token = await login(context, buyer.user.email);

    const response = await request(context.httpServer)
      .delete(`/users/${buyer.userId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(
      await context.prisma.user.findUnique({ where: { id: buyer.userId } }),
    ).toBeNull();
    expect(
      await context.prisma.buyerProfile.count({
        where: { userId: buyer.userId },
      }),
    ).toBe(0);
    expect(
      await context.prisma.buyerRegistration.count({
        where: { buyerId: buyer.userId },
      }),
    ).toBe(0);
    expect(
      await context.prisma.bid.count({ where: { bidderId: buyer.userId } }),
    ).toBe(0);
  });

  it.each(['sale', 'consignment'])(
    'rejects deletion when a user has a protected %s relation',
    async (relation) => {
      const user = await createUser(context.prisma);
      const house = await createAuctionHouse(context.prisma);
      if (relation === 'consignment') {
        await context.prisma.consignment.create({
          data: { sellerId: user.id, auctionHouseId: house.id },
        });
      } else {
        const auction = await createAuction(context.prisma, house.id);
        const lot = await createLot(context.prisma, auction.id);
        await context.prisma.sale.create({
          data: {
            lotId: lot.id,
            buyerId: user.id,
            saleRecordedByAuctionHouseId: house.id,
            finalPrice: 100,
          },
        });
      }
      const token = await login(context, user.email);
      const response = await request(context.httpServer)
        .delete(`/users/${user.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(409);
      expect(bodyOf(response).message).toBe(
        'Usuario possui vendas ou consignacoes vinculadas',
      );
    },
  );

  it('rejects a non-self request before looking up a missing target', async () => {
    const user = await createUser(context.prisma);
    const token = await login(context, user.email);
    expect(
      (
        await request(context.httpServer)
          .get('/users/00000000-0000-0000-0000-000000000000')
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(403);
  });
});
