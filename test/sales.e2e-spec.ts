import request from 'supertest';
import { LotStatus } from '../generated/prisma/enums';
import {
  E2E_PASSWORD,
  createAuction,
  createAuctionHouse,
  createConsignment,
  createLot,
  createSale,
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

type SaleRecord = { lotId: string } & Record<string, unknown>;

function findByLot(body: unknown, lotId: string): SaleRecord {
  const records = body as SaleRecord[];
  const record = records.find((entry) => entry.lotId === lotId);

  if (!record) {
    throw new Error(`Expected a sale record for lot ${lotId}`);
  }

  return record;
}

describe('post-auction sales (e2e)', () => {
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

  it('exposes role-specific contacts for a confirmed sale', async () => {
    const auctionHouse = await createAuctionHouse(context.prisma);
    const auction = await createAuction(context.prisma, auctionHouse.id);

    const seller = await createUser(context.prisma, {
      name: 'Vendedor Teste',
      phone: '11888888888',
    });
    const buyer = await createUser(context.prisma, {
      name: 'Comprador Vencedor',
      phone: '11999999999',
    });

    const consignment = await createConsignment(
      context.prisma,
      seller.id,
      auctionHouse.id,
    );
    const consignedLot = await createLot(context.prisma, auction.id, {
      status: LotStatus.SOLD,
      consignmentId: consignment.id,
    });
    await createSale(
      context.prisma,
      consignedLot.id,
      buyer.id,
      auctionHouse.id,
      {
        finalPrice: 1250,
      },
    );

    const officeOnlyLot = await createLot(context.prisma, auction.id, {
      status: LotStatus.SOLD,
    });
    await createSale(
      context.prisma,
      officeOnlyLot.id,
      buyer.id,
      auctionHouse.id,
      {
        finalPrice: 800,
      },
    );

    const officeToken = await login(context, auctionHouse.email);
    const buyerToken = await login(context, buyer.email);
    const sellerToken = await login(context, seller.email);

    const officeResponse = await request(context.httpServer)
      .get('/sales')
      .set('Authorization', `Bearer ${officeToken}`);
    expect(officeResponse.status).toBe(200);
    expect(officeResponse.body).toHaveLength(2);
    expect(findByLot(officeResponse.body, consignedLot.id)).toMatchObject({
      buyer: {
        id: buyer.id,
        name: buyer.name,
        email: buyer.email,
        phone: buyer.phone,
      },
      seller: {
        id: seller.id,
        name: seller.name,
        email: seller.email,
        phone: seller.phone,
      },
    });

    const winnerResponse = await request(context.httpServer)
      .get('/sales/me')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(winnerResponse.status).toBe(200);
    expect(winnerResponse.body).toHaveLength(2);
    expect(findByLot(winnerResponse.body, consignedLot.id)).toMatchObject({
      responsible: {
        kind: 'SELLER',
        name: seller.name,
        email: seller.email,
        phone: seller.phone,
      },
    });
    expect(findByLot(winnerResponse.body, officeOnlyLot.id)).toMatchObject({
      responsible: {
        kind: 'AUCTION_HOUSE',
        name: auctionHouse.name,
        email: auctionHouse.email,
      },
    });
    expect(JSON.stringify(winnerResponse.body)).not.toContain(
      'comprador@example.test',
    );

    const sellerResponse = await request(context.httpServer)
      .get('/sales/sold')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(sellerResponse.status).toBe(200);
    expect(sellerResponse.body).toHaveLength(1);
    expect(findByLot(sellerResponse.body, consignedLot.id)).toMatchObject({
      buyer: {
        id: buyer.id,
        name: buyer.name,
        email: buyer.email,
        phone: buyer.phone,
      },
    });
  });

  it('never leaks contacts of sales that belong to other people', async () => {
    const auctionHouse = await createAuctionHouse(context.prisma);
    const auction = await createAuction(context.prisma, auctionHouse.id);
    const seller = await createUser(context.prisma, { name: 'Vendedor' });
    const buyer = await createUser(context.prisma, {
      name: 'Comprador',
      phone: '11999999999',
    });
    const consignment = await createConsignment(
      context.prisma,
      seller.id,
      auctionHouse.id,
    );
    const lot = await createLot(context.prisma, auction.id, {
      status: LotStatus.SOLD,
      consignmentId: consignment.id,
    });
    await createSale(context.prisma, lot.id, buyer.id, auctionHouse.id);

    const stranger = await createUser(context.prisma, { name: 'Estranho' });
    const strangerToken = await login(context, stranger.email);

    const wonResponse = await request(context.httpServer)
      .get('/sales/me')
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(wonResponse.status).toBe(200);
    expect(wonResponse.body).toEqual([]);

    const soldResponse = await request(context.httpServer)
      .get('/sales/sold')
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(soldResponse.status).toBe(200);
    expect(soldResponse.body).toEqual([]);

    expect(JSON.stringify(wonResponse.body)).not.toContain(buyer.email);
    expect(JSON.stringify(soldResponse.body)).not.toContain(seller.email);
  });
});
