/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import {
  AuctionHouseStatus,
  BuyerRegistrationStatus,
  OfficeInviteStatus,
} from '../generated/prisma/enums';
import {
  E2E_PASSWORD,
  createAuctionHouse,
  createUser,
} from './support/factories';
import { resetDatabase } from './support/database';
import { E2eContext, createE2eApp } from './support/e2e-app';

const inviteData = {
  name: 'Registered Office',
  email: 'office-register@example.test',
  password: E2E_PASSWORD,
  document: '11.444.777/0001-61',
  phone: '(11) 99999-1111',
  city: 'Sao Paulo',
  state: 'SP',
};

function bodyOf(response: { body: unknown }): Record<string, any> {
  if (
    !response.body ||
    typeof response.body !== 'object' ||
    Array.isArray(response.body)
  ) {
    throw new Error('Expected an object response body');
  }
  return response.body;
}

async function login(context: E2eContext, email: string) {
  const response = await request(context.httpServer)
    .post('/auth/login')
    .send({ email, password: E2E_PASSWORD });
  return String(bodyOf(response).accessToken);
}

async function createInvite(context: E2eContext, email = inviteData.email) {
  return context.prisma.officeInvite.create({
    data: {
      token: `invite-${Date.now()}-${Math.random()}`,
      email,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
}

describe('auction houses E2E', () => {
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

  it('lists only active offices without exposing credentials', async () => {
    const active = await createAuctionHouse(context.prisma, {
      name: 'Active Office',
    });
    await createAuctionHouse(context.prisma, {
      status: AuctionHouseStatus.BLOCKED,
    });
    const response = await request(context.httpServer).get('/auction-houses');
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(bodyOf({ body: response.body[0] })).toMatchObject({
      id: active.id,
      name: 'Active Office',
      status: 'ACTIVE',
    });
    expect(response.body[0]).not.toHaveProperty('passwordHash');
  });

  it('returns an active office and rejects blocked or missing ids', async () => {
    const active = await createAuctionHouse(context.prisma);
    const blocked = await createAuctionHouse(context.prisma, {
      status: AuctionHouseStatus.BLOCKED,
    });
    expect(
      (await request(context.httpServer).get(`/auction-houses/${active.id}`))
        .status,
    ).toBe(200);
    expect(
      (await request(context.httpServer).get(`/auction-houses/${blocked.id}`))
        .status,
    ).toBe(404);
    expect(
      (
        await request(context.httpServer).get(
          '/auction-houses/00000000-0000-0000-0000-000000000000',
        )
      ).status,
    ).toBe(404);
  });

  it('previews and consumes an office invite with normalized registration data', async () => {
    const invite = await createInvite(context);
    const preview = await request(context.httpServer).get(
      `/auction-houses/invites/${invite.token}`,
    );
    expect(preview.status).toBe(200);
    expect(bodyOf(preview)).toMatchObject({
      email: inviteData.email,
      status: 'PENDING',
    });
    const registered = await request(context.httpServer)
      .post(`/auction-houses/invites/${invite.token}/register`)
      .send({
        ...inviteData,
        name: '  Registered Office  ',
        email: inviteData.email.toUpperCase(),
        phone: '11999991111',
      });
    expect(registered.status).toBe(201);
    expect(bodyOf(registered)).toHaveProperty('accessToken');
    expect(bodyOf(registered).auctionHouse).toMatchObject({
      name: 'Registered Office',
      email: inviteData.email,
      phone: '11999991111',
      document: '11444777000161',
    });
    expect(
      (
        await context.prisma.officeInvite.findUnique({
          where: { id: invite.id },
        })
      )?.status,
    ).toBe(OfficeInviteStatus.USED);
    expect(
      (
        await request(context.httpServer).get(
          `/auction-houses/invites/${invite.token}`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(context.httpServer)
          .post(`/auction-houses/invites/${invite.token}/register`)
          .send(inviteData)
      ).status,
    ).toBe(400);
  });

  it('rejects missing, expired, and mismatched invites', async () => {
    expect(
      (
        await request(context.httpServer).get(
          '/auction-houses/invites/missing-token',
        )
      ).status,
    ).toBe(404);
    const expired = await context.prisma.officeInvite.create({
      data: {
        token: 'expired',
        email: inviteData.email,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    expect(
      (
        await request(context.httpServer).get(
          `/auction-houses/invites/${expired.token}`,
        )
      ).status,
    ).toBe(400);
    const fresh = await createInvite(context);
    expect(
      (
        await request(context.httpServer)
          .post(`/auction-houses/invites/${fresh.token}/register`)
          .send({ ...inviteData, email: 'other@example.test' })
      ).status,
    ).toBe(400);
  });

  it('supports buyer registration, idempotency, approval, and blocking', async () => {
    const house = await createAuctionHouse(context.prisma);
    const user = await createUser(context.prisma);
    const userToken = await login(context, user.email);
    const first = await request(context.httpServer)
      .post(`/auction-houses/${house.id}/buyer-registrations`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ notes: 'first' });
    expect(first.status).toBe(201);
    expect(bodyOf(first)).toMatchObject({
      buyerId: user.id,
      auctionHouseId: house.id,
      status: 'PENDING',
      notes: 'first',
    });
    expect(
      (
        await request(context.httpServer)
          .get(`/auction-houses/${house.id}/buyer-registrations/me`)
          .set('Authorization', `Bearer ${userToken}`)
      ).body.id,
    ).toBe(bodyOf(first).id);
    const houseToken = await login(context, house.email);
    const listed = await request(context.httpServer)
      .get('/auction-houses/me/buyer-registrations')
      .set('Authorization', `Bearer ${houseToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body[0].buyer.id).toBe(user.id);
    const approved = await request(context.httpServer)
      .patch(`/auction-houses/me/buyer-registrations/${bodyOf(first).id}`)
      .set('Authorization', `Bearer ${houseToken}`)
      .send({ status: BuyerRegistrationStatus.APPROVED });
    expect(approved.status).toBe(200);
    expect(bodyOf(approved)).toMatchObject({
      status: 'APPROVED',
      approvedAt: expect.any(String),
    });
    const repeat = await request(context.httpServer)
      .post(`/auction-houses/${house.id}/buyer-registrations`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ notes: 'ignored' });
    expect(repeat.status).toBe(201);
    expect(bodyOf(repeat).status).toBe('APPROVED');
    await context.prisma.buyerRegistration.update({
      where: { id: bodyOf(first).id },
      data: { status: BuyerRegistrationStatus.BLOCKED },
    });
    expect(
      (
        await request(context.httpServer)
          .post(`/auction-houses/${house.id}/buyer-registrations`)
          .set('Authorization', `Bearer ${userToken}`)
          .send({})
      ).status,
    ).toBe(403);
  });

  it('enforces actor types and office ownership for registration endpoints', async () => {
    const house = await createAuctionHouse(context.prisma);
    const otherHouse = await createAuctionHouse(context.prisma);
    const user = await createUser(context.prisma);
    const userToken = await login(context, user.email);
    const houseToken = await login(context, house.email);
    expect(
      (
        await request(context.httpServer)
          .get('/auction-houses/me/buyer-registrations')
          .set('Authorization', `Bearer ${userToken}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(context.httpServer)
          .post(`/auction-houses/${house.id}/buyer-registrations`)
          .set('Authorization', `Bearer ${houseToken}`)
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await request(context.httpServer)
          .get(`/auction-houses/${house.id}/buyer-registrations/me`)
          .set('Authorization', `Bearer ${houseToken}`)
      ).status,
    ).toBe(403);
    const registration = await context.prisma.buyerRegistration.create({
      data: { buyerId: user.id, auctionHouseId: house.id },
    });
    const otherToken = await login(context, otherHouse.email);
    expect(
      (
        await request(context.httpServer)
          .patch(`/auction-houses/me/buyer-registrations/${registration.id}`)
          .set('Authorization', `Bearer ${otherToken}`)
          .send({ status: BuyerRegistrationStatus.REJECTED })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(context.httpServer)
          .patch(`/auction-houses/me/buyer-registrations/${registration.id}`)
          .set('Authorization', `Bearer ${userToken}`)
          .send({ status: BuyerRegistrationStatus.REJECTED })
      ).status,
    ).toBe(403);
  });
});
