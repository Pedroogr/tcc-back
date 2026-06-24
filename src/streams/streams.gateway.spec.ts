jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import type { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import type { PrismaService } from '../prisma/prisma.service';
import { StreamsGateway } from './streams.gateway';
import type { StreamsService } from './streams.service';

function createSocket(id: string) {
  const roomEmitter = { emit: jest.fn() };

  return {
    id,
    data: {},
    handshake: {
      auth: { token: 'token' },
      headers: {},
    },
    emit: jest.fn(),
    join: jest.fn().mockResolvedValue(undefined),
    to: jest.fn(() => roomEmitter),
    roomEmitter,
  } as unknown as Socket & { roomEmitter: { emit: jest.Mock } };
}

describe('StreamsGateway', () => {
  let gateway: StreamsGateway;
  let jwtService: { verifyAsync: jest.Mock };
  let prisma: {
    auctionHouse: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let streamsService: {
    assertBroadcasterCanJoin: jest.Mock;
    stopStreamForAuctionHouse: jest.Mock;
    interruptStreamForAuctionHouse: jest.Mock;
  };
  let serverToEmitter: { emit: jest.Mock };
  let server: { to: jest.Mock };

  beforeEach(() => {
    jwtService = {
      verifyAsync: jest.fn().mockResolvedValue({
        sub: 'house-1',
        actorType: 'AUCTION_HOUSE',
      }),
    };
    prisma = {
      auctionHouse: {
        findUnique: jest.fn().mockResolvedValue({ id: 'house-1' }),
      },
      user: {
        findUnique: jest.fn(),
      },
    };
    streamsService = {
      assertBroadcasterCanJoin: jest.fn().mockResolvedValue({
        id: 'auction-1',
        auctionHouseId: 'house-1',
      }),
      stopStreamForAuctionHouse: jest.fn().mockResolvedValue(null),
      interruptStreamForAuctionHouse: jest.fn().mockResolvedValue({
        stream: { status: 'ERROR' },
      }),
    };
    serverToEmitter = { emit: jest.fn() };
    server = {
      to: jest.fn(() => serverToEmitter),
    };

    gateway = new StreamsGateway(
      jwtService as unknown as JwtService,
      prisma as unknown as PrismaService,
      streamsService as unknown as StreamsService,
    );
    gateway.server = server as never;
  });

  it('notifica o transmissor quando um espectador entra na sala', async () => {
    const broadcaster = createSocket('broadcaster-1');
    const viewer = createSocket('viewer-1');

    await gateway.handleBroadcasterJoin(
      { auctionId: 'auction-1' },
      broadcaster,
    );
    await gateway.handleViewerJoin({ auctionId: 'auction-1' }, viewer);

    expect(server.to).toHaveBeenCalledWith('broadcaster-1');
    expect(serverToEmitter.emit).toHaveBeenCalledWith('stream:viewer-join', {
      auctionId: 'auction-1',
      viewerId: 'viewer-1',
    });
  });

  it('impede segundo broadcaster na mesma sala', async () => {
    const firstBroadcaster = createSocket('broadcaster-1');
    const secondBroadcaster = createSocket('broadcaster-2');

    await gateway.handleBroadcasterJoin(
      { auctionId: 'auction-1' },
      firstBroadcaster,
    );
    await gateway.handleBroadcasterJoin(
      { auctionId: 'auction-1' },
      secondBroadcaster,
    );

    expect(secondBroadcaster.emit).toHaveBeenCalledWith('stream:error', {
      message: 'A transmissão já está em andamento.',
    });
  });

  it('marca stream como interrompido e avisa a sala quando o broadcaster desconecta', async () => {
    const broadcaster = createSocket('broadcaster-1');

    await gateway.handleBroadcasterJoin(
      { auctionId: 'auction-1' },
      broadcaster,
    );
    await gateway.handleDisconnect(broadcaster);

    expect(streamsService.interruptStreamForAuctionHouse).toHaveBeenCalledWith(
      'auction-1',
      'house-1',
    );
    expect(server.to).toHaveBeenCalledWith('auction:auction-1');
    expect(serverToEmitter.emit).toHaveBeenCalledWith('stream:interrupted', {
      auctionId: 'auction-1',
      message: 'A transmissão foi interrompida. O escritório pode retomar.',
    });
  });
});
