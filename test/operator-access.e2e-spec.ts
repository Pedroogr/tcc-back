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
import { OperatorLoginRateLimiter } from '../src/operator/operator-login-rate-limiter';

function bodyOf(response: { body: unknown }): Record<string, any> {
  return response.body as Record<string, any>;
}

async function login(context: E2eContext, email: string) {
  const response = await request(context.httpServer)
    .post('/auth/login')
    .send({ email, password: E2E_PASSWORD });
  return String(bodyOf(response).accessToken);
}

async function createAccess(
  context: E2eContext,
  token: string,
  auctionId: string,
  label = 'Pista principal',
) {
  return request(context.httpServer)
    .post('/operator/accesses')
    .set('Authorization', `Bearer ${token}`)
    .send({ auctionId, label });
}

describe('operator access E2E', () => {
  let context: E2eContext;

  beforeAll(async () => {
    context = await createE2eApp();
  });

  beforeEach(async () => {
    context.app.get(OperatorLoginRateLimiter).clearAll();
    await resetDatabase(context.prisma);
  });

  afterAll(async () => {
    await context.app.close();
  });

  it('lets only the owning office create and list redacted accesses', async () => {
    const house = await createAuctionHouse(context.prisma);
    const foreignHouse = await createAuctionHouse(context.prisma);
    const user = await createUser(context.prisma);
    const auction = await createAuction(context.prisma, house.id, {
      status: AuctionStatus.SCHEDULED,
    });
    const houseToken = await login(context, house.email);
    const foreignToken = await login(context, foreignHouse.email);
    const userToken = await login(context, user.email);

    expect((await createAccess(context, foreignToken, auction.id)).status).toBe(
      403,
    );
    expect((await createAccess(context, userToken, auction.id)).status).toBe(
      403,
    );

    const first = await createAccess(context, houseToken, auction.id);
    const second = await createAccess(
      context,
      houseToken,
      auction.id,
      'Pista lateral',
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(bodyOf(first).code).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
    expect(
      new Date(String(bodyOf(first).expiresAt)).getTime(),
    ).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000);

    const listed = await request(context.httpServer)
      .get('/operator/accesses')
      .query({ auctionId: auction.id })
      .set('Authorization', `Bearer ${houseToken}`);

    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(2);
    expect(JSON.stringify(listed.body)).not.toContain('codeHash');
    expect(JSON.stringify(listed.body)).not.toContain('"code"');
  });

  it('rejects access creation for finished and canceled auctions', async () => {
    const house = await createAuctionHouse(context.prisma);
    const token = await login(context, house.email);
    const finished = await createAuction(context.prisma, house.id, {
      status: AuctionStatus.FINISHED,
    });
    const canceled = await createAuction(context.prisma, house.id, {
      status: AuctionStatus.CANCELED,
    });

    expect((await createAccess(context, token, finished.id)).status).toBe(400);
    expect((await createAccess(context, token, canceled.id)).status).toBe(400);
  });

  it('atomically activates a code only once and creates an operator session', async () => {
    const house = await createAuctionHouse(context.prisma);
    const auction = await createAuction(context.prisma, house.id, {
      status: AuctionStatus.LIVE,
    });
    const officeToken = await login(context, house.email);
    const created = await createAccess(context, officeToken, auction.id);
    const code = String(bodyOf(created).code);

    const [first, second] = await Promise.all([
      request(context.httpServer).post('/operator/login').send({ code }),
      request(context.httpServer).post('/operator/login').send({ code }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 401]);

    const successful = first.status === 201 ? first : second;
    expect(bodyOf(successful)).toMatchObject({ actorType: 'OPERATOR' });
    const session = await request(context.httpServer)
      .get('/operator/session')
      .set('Authorization', `Bearer ${String(bodyOf(successful).accessToken)}`);
    expect(session.status).toBe(200);
    expect(bodyOf(session)).toMatchObject({
      type: 'OPERATOR',
      operatorAccess: {
        auctionId: auction.id,
        label: 'Pista principal',
      },
    });
  });

  it('revokes an issued token immediately', async () => {
    const house = await createAuctionHouse(context.prisma);
    const auction = await createAuction(context.prisma, house.id, {
      status: AuctionStatus.LIVE,
    });
    const officeToken = await login(context, house.email);
    const created = await createAccess(context, officeToken, auction.id);
    const accessId = String(bodyOf(created).id);
    const operatorLogin = await request(context.httpServer)
      .post('/operator/login')
      .send({ code: bodyOf(created).code });
    const operatorToken = String(bodyOf(operatorLogin).accessToken);

    const revoked = await request(context.httpServer)
      .delete(`/operator/accesses/${accessId}`)
      .set('Authorization', `Bearer ${officeToken}`);
    expect(revoked.status).toBe(200);

    const session = await request(context.httpServer)
      .get('/operator/session')
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(session.status).toBe(401);
  });

  it('rejects expired codes and tokens and codes for finished auctions', async () => {
    const house = await createAuctionHouse(context.prisma);
    const officeToken = await login(context, house.email);
    const auction = await createAuction(context.prisma, house.id, {
      status: AuctionStatus.LIVE,
    });
    const expired = await createAccess(context, officeToken, auction.id);
    await context.prisma.operatorAccess.update({
      where: { id: String(bodyOf(expired).id) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      (
        await request(context.httpServer)
          .post('/operator/login')
          .send({ code: bodyOf(expired).code })
      ).status,
    ).toBe(401);

    const active = await createAccess(context, officeToken, auction.id);
    const activated = await request(context.httpServer)
      .post('/operator/login')
      .send({ code: bodyOf(active).code });
    await context.prisma.operatorAccess.update({
      where: { id: String(bodyOf(active).id) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      (
        await request(context.httpServer)
          .get('/operator/session')
          .set(
            'Authorization',
            `Bearer ${String(bodyOf(activated).accessToken)}`,
          )
      ).status,
    ).toBe(401);

    const finished = await createAccess(context, officeToken, auction.id);
    await context.prisma.auction.update({
      where: { id: auction.id },
      data: { status: AuctionStatus.FINISHED },
    });
    expect(
      (
        await request(context.httpServer)
          .post('/operator/login')
          .send({ code: bodyOf(finished).code })
      ).status,
    ).toBe(401);
  });

  it('uses the same response for invalid, used, revoked, and expired codes', async () => {
    const house = await createAuctionHouse(context.prisma);
    const officeToken = await login(context, house.email);
    const auction = await createAuction(context.prisma, house.id, {
      status: AuctionStatus.LIVE,
    });

    const used = await createAccess(context, officeToken, auction.id, 'Used');
    await request(context.httpServer)
      .post('/operator/login')
      .set('X-Forwarded-For', '10.0.0.1')
      .send({ code: bodyOf(used).code });

    const revoked = await createAccess(
      context,
      officeToken,
      auction.id,
      'Revoked',
    );
    await request(context.httpServer)
      .delete(`/operator/accesses/${String(bodyOf(revoked).id)}`)
      .set('Authorization', `Bearer ${officeToken}`);

    const expired = await createAccess(
      context,
      officeToken,
      auction.id,
      'Expired',
    );
    await context.prisma.operatorAccess.update({
      where: { id: String(bodyOf(expired).id) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const attempts = await Promise.all([
      request(context.httpServer)
        .post('/operator/login')
        .set('X-Forwarded-For', '10.0.0.2')
        .send({ code: '0000-0000-0000' }),
      request(context.httpServer)
        .post('/operator/login')
        .set('X-Forwarded-For', '10.0.0.3')
        .send({ code: bodyOf(used).code }),
      request(context.httpServer)
        .post('/operator/login')
        .set('X-Forwarded-For', '10.0.0.4')
        .send({ code: bodyOf(revoked).code }),
      request(context.httpServer)
        .post('/operator/login')
        .set('X-Forwarded-For', '10.0.0.5')
        .send({ code: bodyOf(expired).code }),
    ]);

    expect(attempts.map((response) => response.status)).toEqual([
      401, 401, 401, 401,
    ]);
    expect(
      new Set(attempts.map((response) => String(bodyOf(response).message)))
        .size,
    ).toBe(1);
  });

  it('rate limits the sixth failed login for one IP', async () => {
    const makeAttempt = () =>
      request(context.httpServer)
        .post('/operator/login')
        .set('X-Forwarded-For', '192.0.2.44')
        .send({ code: 'FFFF-FFFF-FFFF' });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await makeAttempt()).status).toBe(401);
    }
    expect((await makeAttempt()).status).toBe(429);
  });
});
