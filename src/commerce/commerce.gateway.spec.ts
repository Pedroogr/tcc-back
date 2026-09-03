jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import type { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import type { PrismaService } from '../prisma/prisma.service';
import { CommerceGateway } from './commerce.gateway';

function createSocket(id: string) {
  return {
    id,
    data: {},
    handshake: {
      auth: { token: 'token' },
      headers: {},
    },
    emit: jest.fn(),
    join: jest.fn().mockResolvedValue(undefined),
  } as unknown as Socket;
}

describe('CommerceGateway', () => {
  let gateway: CommerceGateway;
  let jwtService: { verifyAsync: jest.Mock };
  let prisma: {
    auctionHouse: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
    auction: { findUnique: jest.Mock };
  };
  let roomEmitters: Map<string, { emit: jest.Mock }>;
  let server: { to: jest.Mock };

  function roomEmitter(name: string) {
    const existing = roomEmitters.get(name);
    if (existing) {
      return existing;
    }
    const created = { emit: jest.fn() };
    roomEmitters.set(name, created);
    return created;
  }

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    prisma = {
      auctionHouse: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      auction: { findUnique: jest.fn() },
    };
    roomEmitters = new Map();
    server = { to: jest.fn((name: string) => roomEmitter(name)) };

    gateway = new CommerceGateway(
      jwtService as unknown as JwtService,
      prisma as unknown as PrismaService,
    );
    gateway.server = server as never;
  });

  it('joins a buyer only to the anonymous price room', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'buyer-1',
      actorType: 'USER',
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'buyer-1' });
    prisma.auction.findUnique.mockResolvedValue({
      id: 'auction-1',
      auctionHouseId: 'house-1',
    });
    const buyerSocket = createSocket('buyer-socket');

    await gateway.handleAuctionJoin({ auctionId: 'auction-1' }, buyerSocket);

    expect(buyerSocket.join).toHaveBeenCalledWith('auction:auction-1:prices');
    expect(buyerSocket.join).not.toHaveBeenCalledWith(
      'auction:auction-1:office',
    );
  });

  it('joins only the owner office to the detailed room', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'house-1',
      actorType: 'AUCTION_HOUSE',
    });
    prisma.auctionHouse.findUnique.mockResolvedValue({ id: 'house-1' });
    prisma.auction.findUnique.mockResolvedValue({
      id: 'auction-1',
      auctionHouseId: 'house-1',
    });
    const officeSocket = createSocket('office-socket');

    await gateway.handleAuctionJoin({ auctionId: 'auction-1' }, officeSocket);

    expect(officeSocket.join).toHaveBeenCalledWith('auction:auction-1:prices');
    expect(officeSocket.join).toHaveBeenCalledWith('auction:auction-1:office');
  });

  it('keeps a non-owner office out of the detailed room', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'house-2',
      actorType: 'AUCTION_HOUSE',
    });
    prisma.auctionHouse.findUnique.mockResolvedValue({ id: 'house-2' });
    prisma.auction.findUnique.mockResolvedValue({
      id: 'auction-1',
      auctionHouseId: 'house-1',
    });
    const officeSocket = createSocket('other-office-socket');

    await gateway.handleAuctionJoin({ auctionId: 'auction-1' }, officeSocket);

    expect(officeSocket.join).toHaveBeenCalledWith('auction:auction-1:prices');
    expect(officeSocket.join).not.toHaveBeenCalledWith(
      'auction:auction-1:office',
    );
  });

  it('derives the notification room from the authenticated token', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'winner-1',
      actorType: 'USER',
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'winner-1' });
    const winnerSocket = createSocket('winner-socket');

    await gateway.handleNotificationsJoin(winnerSocket);

    expect(winnerSocket.join).toHaveBeenCalledWith('user:winner-1');
  });

  it('broadcasts an anonymous price update and a detailed office bid', () => {
    const createdAt = new Date('2026-09-02T12:00:00.000Z');

    gateway.emitBidRecorded('auction-1', {
      bidId: 'bid-1',
      lotId: 'lot-1',
      amount: '1100',
      createdAt,
      bidder: { id: 'buyer-1', name: 'Comprador Sigiloso' },
    });

    expect(roomEmitter('auction:auction-1:prices').emit).toHaveBeenCalledWith(
      'bid:price-updated',
      { lotId: 'lot-1', amount: '1100', createdAt },
    );
    expect(roomEmitter('auction:auction-1:office').emit).toHaveBeenCalledWith(
      'bid:office-recorded',
      {
        bidId: 'bid-1',
        lotId: 'lot-1',
        amount: '1100',
        createdAt,
        bidder: { id: 'buyer-1', name: 'Comprador Sigiloso' },
      },
    );
    const [, pricePayload] = roomEmitter('auction:auction-1:prices').emit.mock
      .calls[0];
    expect(JSON.stringify(pricePayload)).not.toContain('Comprador Sigiloso');
    expect(pricePayload).not.toHaveProperty('bidder');
  });

  it('announces a sold lot to the price room without any identity', () => {
    const soldAt = new Date('2026-09-02T12:30:00.000Z');

    gateway.emitLotSold('auction-1', {
      lotId: 'lot-1',
      finalPrice: '1100',
      soldAt,
    });

    expect(roomEmitter('auction:auction-1:prices').emit).toHaveBeenCalledWith(
      'lot:sold',
      { lotId: 'lot-1', finalPrice: '1100', soldAt },
    );
  });

  it('sends the win notification exclusively to the winner room', () => {
    gateway.emitSaleWon('winner-1', {
      saleId: 'sale-1',
      lotId: 'lot-1',
      lotCode: 'L-01',
      lotTitle: 'Lote Premium',
      auctionId: 'auction-1',
      auctionTitle: 'Remate de Outono',
      finalPrice: '1100',
    });

    expect(server.to).toHaveBeenCalledWith('user:winner-1');
    expect(roomEmitter('user:winner-1').emit).toHaveBeenCalledWith(
      'sale:won',
      expect.objectContaining({ saleId: 'sale-1', lotId: 'lot-1' }),
    );
    expect(server.to).not.toHaveBeenCalledWith('auction:auction-1:prices');
    expect(server.to).not.toHaveBeenCalledWith('auction:auction-1:office');
  });
});
