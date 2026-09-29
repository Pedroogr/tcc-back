import { randomUUID } from 'node:crypto';
import { Socket } from 'socket.io-client';
import request from 'supertest';
import { AuctionStatus } from '../generated/prisma/enums';
import { CommerceGateway } from '../src/commerce/commerce.gateway';
import {
  E2E_PASSWORD,
  createAuction,
  createAuctionHouse,
  createBuyer,
} from './support/factories';
import { resetDatabase } from './support/database';
import { E2eContext, createE2eApp } from './support/e2e-app';
import { connectSocket, expectNoEvent, waitForEvent } from './support/socket';

function jpeg(width = 3, height = 2, totalBytes?: number) {
  const header = Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x02,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
    0xff,
    0xd9,
  ]);

  if (!totalBytes || totalBytes <= header.length) {
    return header;
  }
  return Buffer.concat([header, Buffer.alloc(totalBytes - header.length)]);
}

async function login(context: E2eContext, email: string) {
  const response = await request(context.httpServer)
    .post('/auth/login')
    .send({ email, password: E2E_PASSWORD });
  return String(response.body.accessToken);
}

async function activateOperator(
  context: E2eContext,
  officeToken: string,
  auctionId: string,
) {
  const created = await request(context.httpServer)
    .post('/operator/accesses')
    .set('Authorization', `Bearer ${officeToken}`)
    .send({ auctionId, label: 'Pista principal' });
  const activated = await request(context.httpServer)
    .post('/operator/login')
    .send({ code: created.body.code });
  return String(activated.body.accessToken);
}

function gestureRequest(
  context: E2eContext,
  auctionId: string,
  token?: string,
  fields: Partial<{
    eventId: string;
    capturedAt: string;
    personBox: string;
  }> = {},
) {
  const pending = request(context.httpServer)
    .post(`/auctions/${auctionId}/gesture-events`)
    .field('eventId', fields.eventId ?? randomUUID())
    .field('capturedAt', fields.capturedAt ?? new Date().toISOString())
    .field(
      'personBox',
      fields.personBox ??
        JSON.stringify({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }),
    );

  return token ? pending.set('Authorization', `Bearer ${token}`) : pending;
}

async function waitForRoom(
  gateway: CommerceGateway,
  socket: Socket,
  room: string,
) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (
      gateway.server.sockets.adapter.rooms.get(room)?.has(String(socket.id))
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${socket.id} to join ${room}`);
}

describe('gesture event relay E2E', () => {
  let context: E2eContext;
  let gateway: CommerceGateway;
  let sockets: Socket[] = [];

  beforeAll(async () => {
    context = await createE2eApp();
    gateway = context.app.get(CommerceGateway);
  });

  beforeEach(async () => {
    await resetDatabase(context.prisma);
    sockets = [];
  });

  afterEach(() => {
    sockets.forEach((socket) => socket.close());
  });

  afterAll(async () => {
    await context.app.close();
  });

  it('allows only the owner office on a nonterminal auction', async () => {
    const owner = await createAuctionHouse(context.prisma);
    const otherOffice = await createAuctionHouse(context.prisma);
    const buyer = await createBuyer(context.prisma);
    const liveAuction = await createAuction(context.prisma, owner.id, {
      status: AuctionStatus.LIVE,
    });
    const finishedAuction = await createAuction(context.prisma, owner.id, {
      status: AuctionStatus.FINISHED,
    });
    const canceledAuction = await createAuction(context.prisma, owner.id, {
      status: AuctionStatus.CANCELED,
    });
    const ownerToken = await login(context, owner.email);
    const otherToken = await login(context, otherOffice.email);
    const buyerToken = await login(context, buyer.user.email);

    await gestureRequest(context, liveAuction.id)
      .attach('snapshot', jpeg(), {
        filename: 'gesture.jpg',
        contentType: 'image/jpeg',
      })
      .expect(401);
    await gestureRequest(context, liveAuction.id, buyerToken)
      .attach('snapshot', jpeg(), {
        filename: 'gesture.jpg',
        contentType: 'image/jpeg',
      })
      .expect(403);
    await gestureRequest(context, liveAuction.id, otherToken)
      .attach('snapshot', jpeg(), {
        filename: 'gesture.jpg',
        contentType: 'image/jpeg',
      })
      .expect(403);
    await gestureRequest(context, randomUUID(), ownerToken)
      .attach('snapshot', jpeg(), {
        filename: 'gesture.jpg',
        contentType: 'image/jpeg',
      })
      .expect(404);
    await gestureRequest(context, finishedAuction.id, ownerToken)
      .attach('snapshot', jpeg(), {
        filename: 'gesture.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
    await gestureRequest(context, canceledAuction.id, ownerToken)
      .attach('snapshot', jpeg(), {
        filename: 'gesture.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);

    const accepted = await gestureRequest(
      context,
      liveAuction.id,
      ownerToken,
    ).attach('snapshot', jpeg(), {
      filename: 'gesture.jpg',
      contentType: 'image/jpeg',
    });
    expect(accepted.status).toBe(202);
    expect(accepted.body).toEqual({
      eventId: expect.any(String),
      expiresAt: expect.any(String),
    });
  });

  it('rejects malformed metadata and unsafe JPEG uploads before emission', async () => {
    const owner = await createAuctionHouse(context.prisma);
    const auction = await createAuction(context.prisma, owner.id, {
      status: AuctionStatus.LIVE,
    });
    const token = await login(context, owner.email);
    const operatorToken = await activateOperator(context, token, auction.id);
    const operatorSocket = await connectSocket(context.baseUrl, operatorToken);
    sockets.push(operatorSocket);
    operatorSocket.emit('auction:join', { auctionId: auction.id });
    await waitForRoom(
      gateway,
      operatorSocket,
      `auction:${auction.id}:operators`,
    );

    const noEvent = expectNoEvent(
      operatorSocket,
      'gesture:first-hand-detected',
    );
    await gestureRequest(context, auction.id, token, {
      personBox: '{',
    })
      .attach('snapshot', jpeg(), {
        filename: 'gesture.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
    await noEvent;

    await gestureRequest(context, auction.id, token).expect(400);
    await gestureRequest(context, auction.id, token)
      .attach('snapshot', Buffer.from('not-a-jpeg'), {
        filename: 'gesture.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
    await gestureRequest(context, auction.id, token)
      .attach('snapshot', jpeg(), {
        filename: 'gesture.png',
        contentType: 'image/png',
      })
      .expect(400);
    await gestureRequest(context, auction.id, token)
      .attach('snapshot', jpeg(1281, 720), {
        filename: 'gesture.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
    await gestureRequest(context, auction.id, token)
      .attach('snapshot', jpeg(3, 2, 256 * 1024 + 1), {
        filename: 'gesture.jpg',
        contentType: 'image/jpeg',
      })
      .expect(413);
  });

  it('enforces idempotency before the per-auction rate window', async () => {
    const owner = await createAuctionHouse(context.prisma);
    const auction = await createAuction(context.prisma, owner.id, {
      status: AuctionStatus.LIVE,
    });
    const token = await login(context, owner.email);
    const eventId = randomUUID();

    await gestureRequest(context, auction.id, token, { eventId })
      .attach('snapshot', jpeg(), {
        filename: 'gesture.jpg',
        contentType: 'image/jpeg',
      })
      .expect(202);
    await gestureRequest(context, auction.id, token, { eventId })
      .attach('snapshot', jpeg(), {
        filename: 'gesture.jpg',
        contentType: 'image/jpeg',
      })
      .expect(409);
    await gestureRequest(context, auction.id, token)
      .attach('snapshot', jpeg(), {
        filename: 'gesture.jpg',
        contentType: 'image/jpeg',
      })
      .expect(429);
  });

  it('relays exact bytes only to the assigned operator room', async () => {
    const owner = await createAuctionHouse(context.prisma);
    const otherOffice = await createAuctionHouse(context.prisma);
    const buyer = await createBuyer(context.prisma);
    const auction = await createAuction(context.prisma, owner.id, {
      status: AuctionStatus.LIVE,
    });
    const otherAuction = await createAuction(context.prisma, otherOffice.id, {
      status: AuctionStatus.LIVE,
    });
    const ownerToken = await login(context, owner.email);
    const otherOfficeToken = await login(context, otherOffice.email);
    const buyerToken = await login(context, buyer.user.email);
    const operatorToken = await activateOperator(
      context,
      ownerToken,
      auction.id,
    );
    const otherOperatorToken = await activateOperator(
      context,
      otherOfficeToken,
      otherAuction.id,
    );

    const assignedOperator = await connectSocket(
      context.baseUrl,
      operatorToken,
    );
    const otherOperator = await connectSocket(
      context.baseUrl,
      otherOperatorToken,
    );
    const buyerSocket = await connectSocket(context.baseUrl, buyerToken);
    const officeSocket = await connectSocket(context.baseUrl, ownerToken);
    sockets.push(assignedOperator, otherOperator, buyerSocket, officeSocket);

    assignedOperator.emit('auction:join', { auctionId: auction.id });
    otherOperator.emit('auction:join', { auctionId: otherAuction.id });
    buyerSocket.emit('auction:join', { auctionId: auction.id });
    officeSocket.emit('auction:join', { auctionId: auction.id });
    await Promise.all([
      waitForRoom(gateway, assignedOperator, `auction:${auction.id}:operators`),
      waitForRoom(
        gateway,
        otherOperator,
        `auction:${otherAuction.id}:operators`,
      ),
      waitForRoom(gateway, buyerSocket, `auction:${auction.id}:buyers`),
      waitForRoom(gateway, officeSocket, `auction:${auction.id}:office`),
    ]);

    const eventId = randomUUID();
    const snapshot = jpeg(640, 360);
    const received = waitForEvent<{
      eventId: string;
      auctionId: string;
      capturedAt: string;
      expiresAt: string;
      personBox: { x: number; y: number; width: number; height: number };
      snapshotMimeType: string;
      snapshot: Buffer | ArrayBuffer;
    }>(assignedOperator, 'gesture:first-hand-detected');
    const notOtherOperator = expectNoEvent(
      otherOperator,
      'gesture:first-hand-detected',
    );
    const notBuyer = expectNoEvent(buyerSocket, 'gesture:first-hand-detected');
    const notOffice = expectNoEvent(
      officeSocket,
      'gesture:first-hand-detected',
    );
    const startedAt = Date.now();

    const response = await gestureRequest(context, auction.id, ownerToken, {
      eventId,
    }).attach('snapshot', snapshot, {
      filename: 'gesture.jpg',
      contentType: 'image/jpeg',
    });
    const completedAt = Date.now();
    expect(response.status).toBe(202);

    const payload = await received;
    expect(payload).toMatchObject({
      eventId,
      auctionId: auction.id,
      personBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      snapshotMimeType: 'image/jpeg',
    });
    expect(Date.parse(payload.expiresAt)).toBeGreaterThanOrEqual(
      startedAt + 5_000,
    );
    expect(Date.parse(payload.expiresAt)).toBeLessThanOrEqual(
      completedAt + 5_000,
    );
    expect(Buffer.from(payload.snapshot)).toEqual(snapshot);
    await Promise.all([notOtherOperator, notBuyer, notOffice]);
  });
});
