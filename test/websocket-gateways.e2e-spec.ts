import { Socket } from 'socket.io-client';
import request from 'supertest';
import { AuctionStatus, LotStatus } from '../generated/prisma/enums';
import {
  E2E_PASSWORD,
  createAuction,
  createAuctionHouse,
  createLot,
} from './support/factories';
import { resetDatabase } from './support/database';
import { E2eContext, createE2eApp } from './support/e2e-app';
import { connectSocket, waitForEvent } from './support/socket';

async function login(c: E2eContext, email: string) {
  const response = await request(c.httpServer)
    .post('/auth/login')
    .send({ email, password: E2E_PASSWORD });
  return String(response.body.accessToken);
}

async function activateOperator(
  c: E2eContext,
  officeToken: string,
  auctionId: string,
) {
  const created = await request(c.httpServer)
    .post('/operator/accesses')
    .set('Authorization', `Bearer ${officeToken}`)
    .send({ auctionId, label: 'Pista principal' });
  const activated = await request(c.httpServer)
    .post('/operator/login')
    .send({ code: created.body.code });
  return String(activated.body.accessToken);
}

describe('WebSocket gateways E2E', () => {
  let c: E2eContext;
  let sockets: Socket[] = [];
  beforeAll(async () => {
    c = await createE2eApp();
  });
  beforeEach(async () => {
    await resetDatabase(c.prisma);
    sockets = [];
  });
  afterEach(() => {
    sockets.forEach((socket) => socket.close());
  });
  afterAll(async () => {
    await c.app.close();
  });

  it('relays LiveGateway room readiness and signaling events', async () => {
    const viewer = await connectSocket(c.baseUrl);
    const transmitter = await connectSocket(c.baseUrl);
    sockets.push(viewer, transmitter);
    transmitter.emit('join-room', { room: 'room-1', role: 'transmitter' });
    const ready = waitForEvent<{ viewerId: string }>(
      transmitter,
      'viewer-ready',
    );
    viewer.emit('join-room', { room: 'room-1', role: 'viewer' });
    expect((await ready).viewerId).toBe(viewer.id);
    const offer = waitForEvent<{ senderId: string }>(viewer, 'offer');
    transmitter.emit('offer', {
      targetId: viewer.id,
      senderId: transmitter.id,
      sdp: { type: 'offer', sdp: 'x' },
    });
    expect((await offer).senderId).toBe(transmitter.id);
  });

  it('coordinates authenticated stream broadcaster and viewer signaling', async () => {
    const house = await createAuctionHouse(c.prisma);
    const auction = await createAuction(c.prisma, house.id, {
      status: AuctionStatus.SCHEDULED,
    });
    const token = await login(c, house.email);
    await request(c.httpServer)
      .post(`/auctions/${auction.id}/stream/start`)
      .set('Authorization', `Bearer ${token}`);
    const broadcaster = await connectSocket(c.baseUrl, token);
    const viewer = await connectSocket(c.baseUrl);
    sockets.push(broadcaster, viewer);
    viewer.emit('stream:viewer-join', { auctionId: auction.id });
    const joined = waitForEvent<{ broadcasterId: string }>(
      viewer,
      'stream:broadcaster-join',
    );
    broadcaster.emit('stream:broadcaster-join', { auctionId: auction.id });
    expect((await joined).broadcasterId).toBe(broadcaster.id);
    expect(viewer.id).toBeDefined();
    const ended = waitForEvent<{ auctionId: string }>(viewer, 'stream:ended');
    broadcaster.emit('stream:ended', { auctionId: auction.id });
    expect((await ended).auctionId).toBe(auction.id);
  });

  it('reports stream errors for unauthenticated broadcasters and invalid messages', async () => {
    const socket = await connectSocket(c.baseUrl);
    sockets.push(socket);
    const error = waitForEvent<{ message: string }>(socket, 'stream:error');
    socket.emit('stream:broadcaster-join', { auctionId: 'missing' });
    expect((await error).message).toContain('Token');
    const invalid = waitForEvent<{ message: string }>(socket, 'stream:error');
    socket.emit('stream:broadcaster-join', {});
    expect((await invalid).message).toContain('Remate');
  });

  it('limits an operator socket to its assigned auction and receives stage changes', async () => {
    const house = await createAuctionHouse(c.prisma);
    const auction = await createAuction(c.prisma, house.id, {
      status: AuctionStatus.LIVE,
    });
    const otherAuction = await createAuction(c.prisma, house.id, {
      status: AuctionStatus.LIVE,
    });
    const lot = await createLot(c.prisma, auction.id, {
      code: '2',
      title: 'Lote 2',
      status: LotStatus.AVAILABLE,
      initialPrice: 1000,
    });
    await c.prisma.auctionSettings.create({
      data: { auctionId: auction.id, minBidIncrement: 100 },
    });
    const officeToken = await login(c, house.email);
    const operatorToken = await activateOperator(c, officeToken, auction.id);
    const operatorSocket = await connectSocket(c.baseUrl, operatorToken);
    sockets.push(operatorSocket);

    const denied = waitForEvent<{ message: string }>(
      operatorSocket,
      'commerce:error',
    );
    operatorSocket.emit('auction:join', { auctionId: otherAuction.id });
    expect((await denied).message).toContain('remate');

    operatorSocket.emit('auction:join', { auctionId: auction.id });
    const stageChanged = waitForEvent<{
      auctionId: string;
      lot: { id: string; code: string; nextMinimumBid: string };
    }>(operatorSocket, 'lot:stage-changed');
    await request(c.httpServer)
      .patch(`/lots/${lot.id}/stage`)
      .set('Authorization', `Bearer ${officeToken}`)
      .send({ status: LotStatus.IN_AUCTION })
      .expect(200);

    expect(await stageChanged).toEqual({
      auctionId: auction.id,
      lot: expect.objectContaining({
        id: lot.id,
        code: '2',
        nextMinimumBid: '1100',
      }),
    });
  });
});
