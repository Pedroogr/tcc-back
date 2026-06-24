import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { AuctionStatus, StreamStatus } from '../../generated/prisma/enums';
import type { AuthenticatedActor } from '../auth/actor-jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import type { AuctionStreamResponseDto } from './dto/stream-response.dto';

const safeStreamSelect = {
  id: true,
  status: true,
  streamUrl: true,
  protocol: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StreamSelect;

const streamAuctionSelect = {
  id: true,
  status: true,
  auctionHouseId: true,
  stream: {
    select: safeStreamSelect,
  },
} satisfies Prisma.AuctionSelect;

type StreamAuction = Prisma.AuctionGetPayload<{
  select: typeof streamAuctionSelect;
}>;

@Injectable()
export class StreamsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAuctionStream(
    auctionId: string,
    actor: AuthenticatedActor,
  ): Promise<AuctionStreamResponseDto> {
    const auction = await this.findStreamAuction(auctionId);

    return this.toResponse(auction, this.canActorBroadcast(auction, actor));
  }

  async startStream(
    auctionId: string,
    actor: AuthenticatedActor,
  ): Promise<AuctionStreamResponseDto> {
    const auction = await this.findStreamAuction(auctionId);
    this.assertOwner(auction, actor, 'start');
    this.assertAuctionCanStartStream(auction);
    this.assertStreamCanStart(auction);

    // Start é idempotente para o escritório dono: se o stream ainda consta
    // LIVE (ex.: após um refresh que matou o broadcaster), permitimos retomar
    // a transmissão em vez de bloquear o dono.

    const now = new Date();

    const [updatedAuction] = await this.prisma.$transaction([
      this.prisma.auction.update({
        where: { id: auctionId },
        data: {
          status: AuctionStatus.LIVE,
          startedAt: auction.status === AuctionStatus.LIVE ? undefined : now,
          stream: {
            upsert: {
              create: {
                status: StreamStatus.LIVE,
                protocol: 'WEBRTC',
                startedAt: now,
                endedAt: null,
              },
              update: {
                status: StreamStatus.LIVE,
                protocol: 'WEBRTC',
                startedAt: now,
                endedAt: null,
              },
            },
          },
        },
        select: streamAuctionSelect,
      }),
    ]);

    return this.toResponse(updatedAuction, true);
  }

  async stopStream(
    auctionId: string,
    actor: AuthenticatedActor,
  ): Promise<AuctionStreamResponseDto> {
    const auction = await this.findStreamAuction(auctionId);
    this.assertOwner(auction, actor, 'stop');

    const updatedAuction = await this.markStreamEnded(auctionId);

    return this.toResponse(updatedAuction, true);
  }

  async stopStreamForAuctionHouse(
    auctionId: string,
    auctionHouseId: string,
  ): Promise<AuctionStreamResponseDto | null> {
    const auction = await this.findStreamAuction(auctionId);

    if (auction.auctionHouseId !== auctionHouseId) {
      return null;
    }

    if (auction.stream?.status !== StreamStatus.LIVE) {
      return this.toResponse(auction, true);
    }

    const updatedAuction = await this.markStreamEnded(auctionId);
    return this.toResponse(updatedAuction, true);
  }

  async interruptStreamForAuctionHouse(
    auctionId: string,
    auctionHouseId: string,
  ): Promise<AuctionStreamResponseDto | null> {
    const auction = await this.findStreamAuction(auctionId);

    if (auction.auctionHouseId !== auctionHouseId) {
      return null;
    }

    if (auction.stream?.status !== StreamStatus.LIVE) {
      return this.toResponse(auction, true);
    }

    const updatedAuction = await this.markStreamInterrupted(auctionId);
    return this.toResponse(updatedAuction, true);
  }

  async assertBroadcasterCanJoin(auctionId: string, auctionHouseId: string) {
    const auction = await this.findStreamAuction(auctionId);

    if (auction.auctionHouseId !== auctionHouseId) {
      throw new ForbiddenException(
        'Apenas o escritório responsável por este remate pode iniciar a transmissão.',
      );
    }

    if (auction.stream?.status !== StreamStatus.LIVE) {
      throw new BadRequestException(
        'Inicie a transmissão antes de entrar como transmissor.',
      );
    }

    return auction;
  }

  private async markStreamEnded(auctionId: string) {
    const now = new Date();

    return this.prisma.auction.update({
      where: { id: auctionId },
      data: {
        stream: {
          upsert: {
            create: {
              status: StreamStatus.ENDED,
              protocol: 'WEBRTC',
              endedAt: now,
            },
            update: {
              status: StreamStatus.ENDED,
              endedAt: now,
            },
          },
        },
      },
      select: streamAuctionSelect,
    });
  }

  private async markStreamInterrupted(auctionId: string) {
    const now = new Date();

    return this.prisma.auction.update({
      where: { id: auctionId },
      data: {
        stream: {
          upsert: {
            create: {
              status: StreamStatus.ERROR,
              protocol: 'WEBRTC',
              endedAt: now,
            },
            update: {
              status: StreamStatus.ERROR,
              endedAt: now,
            },
          },
        },
      },
      select: streamAuctionSelect,
    });
  }

  private async findStreamAuction(auctionId: string) {
    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      select: streamAuctionSelect,
    });

    if (!auction) {
      throw new NotFoundException('Remate inexistente.');
    }

    return auction;
  }

  private assertOwner(
    auction: StreamAuction,
    actor: AuthenticatedActor,
    action: 'start' | 'stop',
  ) {
    if (actor.type !== 'AUCTION_HOUSE') {
      throw new ForbiddenException(
        action === 'start'
          ? 'Apenas o escritório responsável por este remate pode iniciar a transmissão.'
          : 'Apenas o escritório responsável por este remate pode encerrar a transmissão.',
      );
    }

    if (auction.auctionHouseId !== actor.auctionHouse.id) {
      throw new ForbiddenException(
        action === 'start'
          ? 'Apenas o escritório responsável por este remate pode iniciar a transmissão.'
          : 'Apenas o escritório responsável por este remate pode encerrar a transmissão.',
      );
    }
  }

  private assertAuctionCanStartStream(auction: StreamAuction) {
    if (
      auction.status === AuctionStatus.CANCELED ||
      auction.status === AuctionStatus.FINISHED
    ) {
      throw new BadRequestException(
        'Remates cancelados ou finalizados não podem iniciar transmissão.',
      );
    }

    if (
      auction.status !== AuctionStatus.SCHEDULED &&
      auction.status !== AuctionStatus.LIVE
    ) {
      throw new BadRequestException(
        'Este remate ainda não pode iniciar transmissão.',
      );
    }
  }

  private assertStreamCanStart(auction: StreamAuction) {
    if (auction.stream?.status === StreamStatus.ENDED) {
      throw new BadRequestException(
        'A transmissÃ£o deste remate foi encerrada pelo escritÃ³rio.',
      );
    }
  }

  private canActorBroadcast(auction: StreamAuction, actor: AuthenticatedActor) {
    return (
      actor.type === 'AUCTION_HOUSE' &&
      auction.auctionHouseId === actor.auctionHouse.id
    );
  }

  private toResponse(
    auction: StreamAuction,
    canBroadcast: boolean,
  ): AuctionStreamResponseDto {
    return {
      auctionId: auction.id,
      room: `auction:${auction.id}`,
      canBroadcast,
      auction: {
        id: auction.id,
        status: auction.status,
        auctionHouseId: auction.auctionHouseId,
      },
      stream: auction.stream,
    };
  }
}
