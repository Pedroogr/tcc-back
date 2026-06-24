jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { AuctionStatus, StreamStatus } from '../../generated/prisma/enums';
import type { AuthenticatedActor } from '../auth/actor-jwt-auth.guard';
import type { PrismaService } from '../prisma/prisma.service';
import { StreamsService } from './streams.service';

const ownerActor = {
  type: 'AUCTION_HOUSE',
  auctionHouse: {
    id: 'house-1',
    name: 'Casa Dona',
    email: 'dona@example.com',
    status: 'ACTIVE',
    mustChangePassword: false,
  },
} as AuthenticatedActor;

const otherHouseActor = {
  type: 'AUCTION_HOUSE',
  auctionHouse: {
    id: 'house-2',
    name: 'Casa Outra',
    email: 'outra@example.com',
    status: 'ACTIVE',
    mustChangePassword: false,
  },
} as AuthenticatedActor;

const userActor = {
  type: 'USER',
  user: {
    id: 'user-1',
    email: 'comprador@example.com',
    buyerProfile: null,
    sellerProfile: null,
  },
} as AuthenticatedActor;

function createAuction(status = AuctionStatus.SCHEDULED) {
  return {
    id: 'auction-1',
    status,
    auctionHouseId: 'house-1',
    stream: null,
  };
}

function createLiveStreamAuction(status = AuctionStatus.LIVE) {
  return {
    id: 'auction-1',
    status,
    auctionHouseId: 'house-1',
    stream: {
      id: 'stream-1',
      status: StreamStatus.LIVE,
      streamUrl: null,
      protocol: 'WEBRTC',
      startedAt: new Date('2026-06-17T13:00:00.000Z'),
      endedAt: null,
      createdAt: new Date('2026-06-17T13:00:00.000Z'),
      updatedAt: new Date('2026-06-17T13:00:00.000Z'),
    },
  };
}

function createEndedStreamAuction() {
  return {
    id: 'auction-1',
    status: AuctionStatus.LIVE,
    auctionHouseId: 'house-1',
    stream: {
      id: 'stream-1',
      status: StreamStatus.ENDED,
      streamUrl: null,
      protocol: 'WEBRTC',
      startedAt: new Date('2026-06-17T13:00:00.000Z'),
      endedAt: new Date('2026-06-17T14:00:00.000Z'),
      createdAt: new Date('2026-06-17T13:00:00.000Z'),
      updatedAt: new Date('2026-06-17T14:00:00.000Z'),
    },
  };
}

function createInterruptedStreamAuction() {
  return {
    id: 'auction-1',
    status: AuctionStatus.LIVE,
    auctionHouseId: 'house-1',
    stream: {
      id: 'stream-1',
      status: StreamStatus.ERROR,
      streamUrl: null,
      protocol: 'WEBRTC',
      startedAt: new Date('2026-06-17T13:00:00.000Z'),
      endedAt: new Date('2026-06-17T13:30:00.000Z'),
      createdAt: new Date('2026-06-17T13:00:00.000Z'),
      updatedAt: new Date('2026-06-17T13:30:00.000Z'),
    },
  };
}

describe('StreamsService', () => {
  let prisma: {
    auction: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let service: StreamsService;

  beforeEach(() => {
    prisma = {
      auction: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
      ),
    };
    service = new StreamsService(prisma as unknown as PrismaService);
  });

  it('permite que o escritório proprietário inicie a transmissão', async () => {
    prisma.auction.findUnique.mockResolvedValue(createAuction());
    prisma.auction.update.mockResolvedValue(createLiveStreamAuction());

    const response = await service.startStream('auction-1', ownerActor);

    expect(response.canBroadcast).toBe(true);
    expect(response.stream?.status).toBe(StreamStatus.LIVE);
  });

  it('retorna 403 quando outro escritório tenta iniciar', async () => {
    prisma.auction.findUnique.mockResolvedValue(createAuction());

    await expect(
      service.startStream('auction-1', otherHouseActor),
    ).rejects.toThrow(ForbiddenException);
  });

  it('retorna 403 quando usuário comum tenta iniciar', async () => {
    prisma.auction.findUnique.mockResolvedValue(createAuction());

    await expect(service.startStream('auction-1', userActor)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('muda o Stream para LIVE ao iniciar', async () => {
    prisma.auction.findUnique.mockResolvedValue(createAuction());
    prisma.auction.update.mockResolvedValue(createLiveStreamAuction());

    await service.startStream('auction-1', ownerActor);

    expect(prisma.auction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stream: expect.objectContaining({
            upsert: expect.objectContaining({
              create: expect.objectContaining({
                status: StreamStatus.LIVE,
                protocol: 'WEBRTC',
              }),
              update: expect.objectContaining({
                status: StreamStatus.LIVE,
                protocol: 'WEBRTC',
              }),
            }),
          }),
        }),
      }),
    );
  });

  it('muda o Auction para LIVE ao iniciar', async () => {
    prisma.auction.findUnique.mockResolvedValue(createAuction());
    prisma.auction.update.mockResolvedValue(createLiveStreamAuction());

    await service.startStream('auction-1', ownerActor);

    expect(prisma.auction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AuctionStatus.LIVE,
        }),
      }),
    );
  });

  it('permite retomar transmissão que ainda consta como ao vivo', async () => {
    prisma.auction.findUnique.mockResolvedValue(createLiveStreamAuction());
    prisma.auction.update.mockResolvedValue(createLiveStreamAuction());

    const response = await service.startStream('auction-1', ownerActor);

    expect(response.stream?.status).toBe(StreamStatus.LIVE);
  });

  it('impede retomar transmissão encerrada pelo escritório', async () => {
    prisma.auction.findUnique.mockResolvedValue(createEndedStreamAuction());

    await expect(service.startStream('auction-1', ownerActor)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('impede iniciar transmissão em remate cancelado ou finalizado', async () => {
    prisma.auction.findUnique.mockResolvedValue(
      createAuction(AuctionStatus.CANCELED),
    );

    await expect(service.startStream('auction-1', ownerActor)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('permite que o proprietário encerre a transmissão', async () => {
    prisma.auction.findUnique.mockResolvedValue(createLiveStreamAuction());
    prisma.auction.update.mockResolvedValue(createEndedStreamAuction());

    const response = await service.stopStream('auction-1', ownerActor);

    expect(response.stream?.status).toBe(StreamStatus.ENDED);
  });

  it('muda o Stream para ENDED ao encerrar', async () => {
    prisma.auction.findUnique.mockResolvedValue(createLiveStreamAuction());
    prisma.auction.update.mockResolvedValue(createEndedStreamAuction());

    await service.stopStream('auction-1', ownerActor);

    expect(prisma.auction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stream: expect.objectContaining({
            upsert: expect.objectContaining({
              create: expect.objectContaining({ status: StreamStatus.ENDED }),
              update: expect.objectContaining({ status: StreamStatus.ENDED }),
            }),
          }),
        }),
      }),
    );
  });

  it('não finaliza automaticamente o remate ao encerrar a transmissão', async () => {
    prisma.auction.findUnique.mockResolvedValue(createLiveStreamAuction());
    prisma.auction.update.mockResolvedValue(createEndedStreamAuction());

    const response = await service.stopStream('auction-1', ownerActor);

    expect(response.auction.status).toBe(AuctionStatus.LIVE);
    expect(prisma.auction.update).toHaveBeenCalledWith(
      expect.not.objectContaining({
        data: expect.objectContaining({
          status: AuctionStatus.FINISHED,
        }),
      }),
    );
  });

  it('marca queda tecnica como ERROR sem encerrar definitivamente', async () => {
    prisma.auction.findUnique.mockResolvedValue(createLiveStreamAuction());
    prisma.auction.update.mockResolvedValue(createInterruptedStreamAuction());

    const response = await service.interruptStreamForAuctionHouse(
      'auction-1',
      'house-1',
    );

    expect(response?.stream?.status).toBe(StreamStatus.ERROR);
    expect(prisma.auction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stream: expect.objectContaining({
            upsert: expect.objectContaining({
              create: expect.objectContaining({ status: StreamStatus.ERROR }),
              update: expect.objectContaining({ status: StreamStatus.ERROR }),
            }),
          }),
        }),
      }),
    );
  });
});
