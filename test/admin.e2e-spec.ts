import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AuctionHouseStatus, UserStatus } from '../generated/prisma/client';
import {
  E2E_PASSWORD,
  createAuctionHouse,
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
  return bodyOf(response).accessToken as string;
}

describe('admin office invites (e2e)', () => {
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

  it('creates a normalized invite with a seven-day expiry and registration URL', async () => {
    const admin = await createUser(context.prisma, {
      platformRole: 'SYSTEM_ADMIN',
    });
    const token = await login(context, admin.email);
    const before = Date.now();

    const response = await request(context.httpServer)
      .post('/admin/office-invites')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'OFFICE@Example.TEST' });

    expect(response.status).toBe(201);
    const body = bodyOf(response);
    expect(body).toMatchObject({
      email: 'office@example.test',
      status: 'PENDING',
    });
    expect(body.registrationUrl).toBe(
      `http://localhost:5173/cadastro-escritorio/${String(body.token)}`,
    );
    expect(new Date(String(body.expiresAt)).getTime()).toBeGreaterThanOrEqual(
      before + 6 * 24 * 60 * 60 * 1000,
    );
    expect(new Date(String(body.expiresAt)).getTime()).toBeLessThanOrEqual(
      Date.now() + 7 * 24 * 60 * 60 * 1000 + 1000,
    );
  });

  it('accepts a custom expiry and lists newest invites first', async () => {
    const admin = await createUser(context.prisma, {
      platformRole: 'SYSTEM_ADMIN',
    });
    const token = await login(context, admin.email);
    const first = await request(context.httpServer)
      .post('/admin/office-invites')
      .set('Authorization', `Bearer ${token}`)
      .send({ expiresInDays: 2 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await request(context.httpServer)
      .post('/admin/office-invites')
      .set('Authorization', `Bearer ${token}`)
      .send({ expiresInDays: 14 });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstExpiry = new Date(String(bodyOf(first).expiresAt)).getTime();
    const secondExpiry = new Date(String(bodyOf(second).expiresAt)).getTime();
    expect(secondExpiry - firstExpiry).toBeGreaterThan(
      11 * 24 * 60 * 60 * 1000,
    );

    const listed = await request(context.httpServer)
      .get('/admin/office-invites')
      .set('Authorization', `Bearer ${token}`);
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body)).toBe(true);
    expect((listed.body as Array<{ id: string }>)[0].id).toBe(
      bodyOf(second).id,
    );
  });

  it('marks expired pending invites while listing and revokes only pending invites', async () => {
    const admin = await createUser(context.prisma, {
      platformRole: 'SYSTEM_ADMIN',
    });
    const token = await login(context, admin.email);
    const expired = await context.prisma.officeInvite.create({
      data: { token: 'expired-token', expiresAt: new Date(Date.now() - 1_000) },
    });
    const pending = await request(context.httpServer)
      .post('/admin/office-invites')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    const listed = await request(context.httpServer)
      .get('/admin/office-invites')
      .set('Authorization', `Bearer ${token}`);
    expect(listed.status).toBe(200);
    expect(
      (listed.body as Array<{ id: string; status: string }>).find(
        (invite) => invite.id === expired.id,
      )?.status,
    ).toBe('EXPIRED');

    const revoke = await request(context.httpServer)
      .delete(`/admin/office-invites/${String(bodyOf(pending).id)}`)
      .set('Authorization', `Bearer ${token}`);
    expect(revoke.status).toBe(200);
    expect(bodyOf(revoke).status).toBe('EXPIRED');
    expect(
      (
        await request(context.httpServer)
          .delete(`/admin/office-invites/${String(bodyOf(pending).id)}`)
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(400);
    expect(
      (
        await request(context.httpServer)
          .delete('/admin/office-invites/00000000-0000-0000-0000-000000000000')
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(404);
  });

  it.each([
    [{ email: 'not-an-email' }],
    [{ expiresInDays: 0 }],
    [{ expiresInDays: 1.5 }],
    [{ unexpected: true }],
  ])('rejects invalid invite payload %j', async (payload) => {
    const admin = await createUser(context.prisma, {
      platformRole: 'SYSTEM_ADMIN',
    });
    const token = await login(context, admin.email);
    expect(
      (
        await request(context.httpServer)
          .post('/admin/office-invites')
          .set('Authorization', `Bearer ${token}`)
          .send(payload)
      ).status,
    ).toBe(400);
  });

  it('allows only active system administrators to manage invites', async () => {
    const admin = await createUser(context.prisma, {
      platformRole: 'SYSTEM_ADMIN',
    });
    const user = await createUser(context.prisma);
    const house = await createAuctionHouse(context.prisma);
    const adminToken = await login(context, admin.email);
    const userToken = await login(context, user.email);
    const houseToken = await login(context, house.email);
    const path = '/admin/office-invites';

    expect((await request(context.httpServer).get(path)).status).toBe(401);
    expect(
      (
        await request(context.httpServer)
          .get(path)
          .set('Authorization', `Bearer ${userToken}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(context.httpServer)
          .get(path)
          .set('Authorization', `Bearer ${houseToken}`)
      ).status,
    ).toBe(401);
    expect(
      (
        await request(context.httpServer)
          .get(path)
          .set('Authorization', `Bearer ${adminToken}`)
      ).status,
    ).toBe(200);
  });

  it('rejects a valid token for an inactive system administrator', async () => {
    const blocked = await createUser(context.prisma, {
      platformRole: 'SYSTEM_ADMIN',
      status: UserStatus.BLOCKED,
    });
    const jwt = context.app.get(JwtService);
    const token = await jwt.signAsync({
      sub: blocked.id,
      email: blocked.email,
      actorType: 'USER',
      platformRole: 'SYSTEM_ADMIN',
    });
    const response = await request(context.httpServer)
      .get('/admin/office-invites')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(401);
    expect(bodyOf(response).message).toBe('Conta inativa');
  });

  it('includes the linked auction house in the invite listing', async () => {
    const admin = await createUser(context.prisma, {
      platformRole: 'SYSTEM_ADMIN',
    });
    const house = await createAuctionHouse(context.prisma, {
      status: AuctionHouseStatus.ACTIVE,
    });
    const invite = await context.prisma.officeInvite.create({
      data: {
        token: 'linked-token',
        expiresAt: new Date(Date.now() + 86_400_000),
        auctionHouseId: house.id,
      },
    });
    const token = await login(context, admin.email);
    const response = await request(context.httpServer)
      .get('/admin/office-invites')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(
      (
        response.body as Array<{ id: string; auctionHouse: { id: string } }>
      ).find((item) => item.id === invite.id)?.auctionHouse.id,
    ).toBe(house.id);
  });
});
