import request from 'supertest';
import { verify } from 'jsonwebtoken';
import { AuctionHouseStatus, UserStatus } from '../generated/prisma/enums';
import {
  E2E_PASSWORD,
  createAuctionHouse,
  createUser,
} from './support/factories';
import { resetDatabase } from './support/database';
import { E2eContext, createE2eApp } from './support/e2e-app';

let registrationSequence = 0;

function nextRegistrationEmail() {
  registrationSequence += 1;
  return `registration-${registrationSequence}@example.test`;
}

function generateValidCpf() {
  const base = '123456789';
  const firstDigit = cpfCheckDigit(base);
  const secondDigit = cpfCheckDigit(`${base}${firstDigit}`);

  return `${base}${firstDigit}${secondDigit}`;
}

function formatCpf(document: string) {
  return `${document.slice(0, 3)}.${document.slice(3, 6)}.${document.slice(6, 9)}-${document.slice(9)}`;
}

function cpfCheckDigit(base: string) {
  const rest =
    (base
      .split('')
      .reduce(
        (total, digit, index) =>
          total + Number(digit) * (base.length + 1 - index),
        0,
      ) *
      10) %
    11;

  return rest === 10 ? 0 : rest;
}

function generateValidCnpj() {
  const base = '123456780001';
  const firstDigit = cnpjCheckDigit(base);
  const secondDigit = cnpjCheckDigit(`${base}${firstDigit}`);

  return `${base}${firstDigit}${secondDigit}`;
}

function formatCnpj(document: string) {
  return `${document.slice(0, 2)}.${document.slice(2, 5)}.${document.slice(5, 8)}/${document.slice(8, 12)}-${document.slice(12)}`;
}

function cnpjCheckDigit(base: string) {
  const weights =
    base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const rest =
    base
      .split('')
      .reduce(
        (total, digit, index) => total + Number(digit) * weights[index],
        0,
      ) % 11;

  return rest < 2 ? 0 : 11 - rest;
}

function readObjectBody(response: { body: unknown }): Record<string, unknown> {
  const { body } = response;

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Expected an object HTTP response body');
  }

  return body as Record<string, unknown>;
}

describe('authentication (e2e)', () => {
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

  it('registers a buyer with normalized contact data and no password hash', async () => {
    const document = generateValidCpf();
    const response = await request(context.httpServer)
      .post('/auth/register')
      .send({
        name: 'Buyer E2E',
        email: nextRegistrationEmail(),
        password: 'buyer-password',
        phone: '(11) 98888-1234',
        document: formatCpf(document),
        accountType: 'BUYER',
      });

    expect(response.status).toBe(201);
    const body = readObjectBody(response);
    expect(body).toMatchObject({
      name: 'Buyer E2E',
      phone: '11988881234',
      document: '12345678909',
      buyerProfile: { verificationStatus: 'PENDING' },
      sellerProfile: null,
    });
    expect(JSON.stringify(body)).not.toContain('passwordHash');
  });

  it('registers a seller with its nested farm profile and normalized CNPJ', async () => {
    const document = generateValidCnpj();
    const response = await request(context.httpServer)
      .post('/auth/register')
      .send({
        name: 'Seller E2E',
        email: nextRegistrationEmail(),
        password: 'seller-password',
        phone: '(11) 98888-1234',
        document: formatCnpj(document),
        accountType: 'SELLER',
        sellerProfile: {
          farmName: 'Fazenda E2E',
          ruralRegistration: 'RURAL-123',
          stateRegistration: 'STATE-456',
          city: 'Ribeirao Preto',
          state: 'SP',
          country: 'BR',
        },
      });

    expect(response.status).toBe(201);
    const body = readObjectBody(response);
    expect(body).toMatchObject({
      name: 'Seller E2E',
      phone: '11988881234',
      document: '12345678000195',
      buyerProfile: null,
      sellerProfile: {
        farmName: 'Fazenda E2E',
        ruralRegistration: 'RURAL-123',
        stateRegistration: 'STATE-456',
        city: 'Ribeirao Preto',
        state: 'SP',
        country: 'BR',
        verificationStatus: 'PENDING',
      },
    });
    expect(JSON.stringify(body)).not.toContain('passwordHash');
  });

  it('registers a user without a profile when account type is omitted', async () => {
    const response = await request(context.httpServer)
      .post('/auth/register')
      .send({
        name: 'Unprofiled E2E',
        email: nextRegistrationEmail(),
        password: 'plain-password',
      });

    expect(response.status).toBe(201);
    const body = readObjectBody(response);
    expect(body).toMatchObject({
      name: 'Unprofiled E2E',
      buyerProfile: null,
      sellerProfile: null,
    });
    expect(JSON.stringify(body)).not.toContain('passwordHash');
  });

  it.each([
    [
      'an invalid e-mail',
      {
        name: 'Invalid E2E',
        email: 'not-an-email',
        password: 'valid-password',
      },
    ],
    [
      'a phone without a valid Brazilian length',
      {
        name: 'Invalid E2E',
        email: nextRegistrationEmail(),
        password: 'valid-password',
        phone: '1198888',
      },
    ],
    [
      'an invalid document',
      {
        name: 'Invalid E2E',
        email: nextRegistrationEmail(),
        password: 'valid-password',
        document: '111.111.111-11',
      },
    ],
    [
      'a password shorter than six characters',
      {
        name: 'Invalid E2E',
        email: nextRegistrationEmail(),
        password: '12345',
      },
    ],
    [
      'an extra field',
      {
        name: 'Invalid E2E',
        email: nextRegistrationEmail(),
        password: 'valid-password',
        unexpected: true,
      },
    ],
  ])('rejects registration with %s', async (_caseName, payload) => {
    const response = await request(context.httpServer)
      .post('/auth/register')
      .send(payload);

    expect(response.status).toBe(400);
  });

  it('rejects registration with an e-mail that is already registered', async () => {
    const email = nextRegistrationEmail();
    const payload = {
      name: 'Duplicate E2E',
      email,
      password: 'valid-password',
      document: generateValidCpf(),
    };

    await request(context.httpServer)
      .post('/auth/register')
      .send(payload)
      .expect(201);

    const response = await request(context.httpServer)
      .post('/auth/register')
      .send(payload);

    expect(response.status).toBe(409);
  });

  it('accepts a CPF generated with the Brazilian checksum algorithm', async () => {
    const document = generateValidCpf();
    const response = await request(context.httpServer)
      .post('/auth/register')
      .send({
        name: 'CPF E2E',
        email: nextRegistrationEmail(),
        password: 'valid-password',
        document,
      });

    expect(response.status).toBe(201);
    expect(readObjectBody(response).document).toBe(document);
  });

  it('accepts a CNPJ generated with the Brazilian checksum algorithm', async () => {
    const document = generateValidCnpj();
    const response = await request(context.httpServer)
      .post('/auth/register')
      .send({
        name: 'CNPJ E2E',
        email: nextRegistrationEmail(),
        password: 'valid-password',
        document,
      });

    expect(response.status).toBe(201);
    expect(readObjectBody(response).document).toBe(document);
  });

  it('logs in a user with a JWT whose subject and actor type match the user', async () => {
    const user = await createUser(context.prisma);

    const response = await request(context.httpServer)
      .post('/auth/login')
      .send({
        email: user.email,
        password: E2E_PASSWORD,
      });

    expect(response.status).toBe(201);
    const body = readObjectBody(response);
    expect(body.actorType).toBe('USER');
    expect(body.user).toMatchObject({
      id: user.id,
      email: user.email,
    });
    expect(JSON.stringify(body)).not.toContain('passwordHash');
    const accessToken = body.accessToken;
    expect(typeof accessToken).toBe('string');

    if (typeof accessToken !== 'string') {
      throw new Error('Expected a JWT access token');
    }

    expect(verify(accessToken, process.env.JWT_SECRET as string)).toMatchObject(
      {
        sub: user.id,
        email: user.email,
        actorType: 'USER',
      },
    );
  });

  it('logs in an auction house with a JWT whose subject and actor type match the office', async () => {
    const auctionHouse = await createAuctionHouse(context.prisma);

    const response = await request(context.httpServer)
      .post('/auth/login')
      .send({
        email: auctionHouse.email,
        password: E2E_PASSWORD,
      });

    expect(response.status).toBe(201);
    const body = readObjectBody(response);
    expect(body.actorType).toBe('AUCTION_HOUSE');
    expect(body.auctionHouse).toMatchObject({
      id: auctionHouse.id,
      email: auctionHouse.email,
    });
    expect(JSON.stringify(body)).not.toContain('passwordHash');
    const accessToken = body.accessToken;
    expect(typeof accessToken).toBe('string');

    if (typeof accessToken !== 'string') {
      throw new Error('Expected a JWT access token');
    }

    expect(verify(accessToken, process.env.JWT_SECRET as string)).toMatchObject(
      {
        sub: auctionHouse.id,
        email: auctionHouse.email,
        actorType: 'AUCTION_HOUSE',
      },
    );
  });

  it('rejects bad login credentials', async () => {
    const user = await createUser(context.prisma);

    const response = await request(context.httpServer)
      .post('/auth/login')
      .send({
        email: user.email,
        password: 'wrong-password',
      });

    expect(response.status).toBe(401);
  });

  it.each([UserStatus.BLOCKED, UserStatus.PENDING])(
    'rejects login for a %s user account',
    async (status) => {
      const user = await createUser(context.prisma, { status });

      const response = await request(context.httpServer)
        .post('/auth/login')
        .send({
          email: user.email,
          password: E2E_PASSWORD,
        });

      expect(response.status).toBe(401);
      expect(readObjectBody(response).message).toBe('Conta inativa');
    },
  );

  it.each([AuctionHouseStatus.BLOCKED, AuctionHouseStatus.PENDING])(
    'rejects login for a %s auction house account',
    async (status) => {
      const auctionHouse = await createAuctionHouse(context.prisma, { status });

      const response = await request(context.httpServer)
        .post('/auth/login')
        .send({
          email: auctionHouse.email,
          password: E2E_PASSWORD,
        });

      expect(response.status).toBe(401);
      expect(readObjectBody(response).message).toBe('Conta inativa');
    },
  );
});
