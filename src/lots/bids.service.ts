import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  BidSource,
  BidStatus,
  BuyerRegistrationStatus,
  LotStatus,
} from '../../generated/prisma/enums';
import { CommerceGateway } from '../commerce/commerce.gateway';
import { PrismaService } from '../prisma/prisma.service';

const MAX_BID_TRANSACTION_ATTEMPTS = 3;

export type PlaceBidCommand =
  | {
      source: typeof BidSource.ONLINE;
      lotId: string;
      bidderId: string;
      amount: number;
    }
  | {
      source: typeof BidSource.ON_SITE;
      auctionId: string;
      lotId: string;
      bidderId: string;
      operatorAccessId: string;
      amount: number;
    };

export type PublicBid = {
  id: string;
  lotId: string;
  amount: Prisma.Decimal;
  status: BidStatus;
  createdAt: Date;
};

@Injectable()
export class BidsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceGateway: CommerceGateway,
  ) {}

  async place(command: PlaceBidCommand): Promise<PublicBid> {
    for (
      let attempt = 1;
      attempt <= MAX_BID_TRANSACTION_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const result = await this.prisma.$transaction(
          async (tx) => this.persist(tx, command),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        this.commerceGateway.emitBidRecorded(result.auctionId, {
          bidId: result.bid.id,
          lotId: result.bid.lotId,
          amount: result.bid.amount.toString(),
          createdAt: result.bid.createdAt,
          source: result.bid.source,
          bidder: result.bid.bidder,
        });

        return {
          id: result.bid.id,
          lotId: result.bid.lotId,
          amount: result.bid.amount,
          status: result.bid.status,
          createdAt: result.bid.createdAt,
        };
      } catch (error) {
        if (
          this.isSerializationFailure(error) &&
          attempt < MAX_BID_TRANSACTION_ATTEMPTS
        ) {
          continue;
        }

        throw error;
      }
    }

    throw new BadRequestException(
      'Nao foi possivel registrar o lance. Tente novamente.',
    );
  }

  private async persist(
    tx: Prisma.TransactionClient,
    command: PlaceBidCommand,
  ) {
    const lot = await tx.lot.findUnique({
      where: { id: command.lotId },
      select: {
        id: true,
        status: true,
        initialPrice: true,
        auctionId: true,
        auction: {
          select: {
            auctionHouseId: true,
            settings: { select: { minBidIncrement: true } },
          },
        },
      },
    });

    if (!lot) {
      throw new NotFoundException('Lote nao encontrado');
    }

    if (!lot.auctionId || !lot.auction) {
      throw new ForbiddenException('Lote nao esta vinculado a um remate');
    }

    if (lot.status !== LotStatus.IN_AUCTION) {
      throw new ForbiddenException('Lote nao esta em pista para lances');
    }

    if (
      command.source === BidSource.ON_SITE &&
      command.auctionId !== lot.auctionId
    ) {
      throw new ForbiddenException('Operador nao pertence a este remate');
    }

    const registration = await tx.buyerRegistration.findUnique({
      where: {
        buyerId_auctionHouseId: {
          buyerId: command.bidderId,
          auctionHouseId: lot.auction.auctionHouseId,
        },
      },
      select: {
        status: true,
        buyer: { select: { buyerProfile: true } },
      },
    });

    if (
      registration?.status !== BuyerRegistrationStatus.APPROVED ||
      !registration.buyer.buyerProfile?.ie ||
      !registration.buyer.buyerProfile.ieUf
    ) {
      throw new ForbiddenException(
        'Usuario precisa estar aprovado pelo escritorio deste remate e possuir IE para realizar lances',
      );
    }

    const currentWinningBid = await tx.bid.findFirst({
      where: { lotId: command.lotId, status: BidStatus.WINNING },
      orderBy: { amount: 'desc' },
    });
    const minBidIncrement =
      lot.auction.settings?.minBidIncrement ?? new Prisma.Decimal(0);
    const minimumAmount = currentWinningBid
      ? currentWinningBid.amount.plus(minBidIncrement)
      : (lot.initialPrice ?? new Prisma.Decimal(0));
    const amount = new Prisma.Decimal(command.amount);

    if (amount.lt(minimumAmount)) {
      throw new BadRequestException(
        `Lance minimo para este lote e ${minimumAmount.toString()}`,
      );
    }

    await tx.bid.updateMany({
      where: { lotId: command.lotId, status: BidStatus.WINNING },
      data: { status: BidStatus.OUTBID },
    });

    const bid = await tx.bid.create({
      data: {
        amount,
        status: BidStatus.WINNING,
        source: command.source,
        bidder: { connect: { id: command.bidderId } },
        lot: { connect: { id: command.lotId } },
        operatorAccess:
          command.source === BidSource.ON_SITE
            ? { connect: { id: command.operatorAccessId } }
            : undefined,
      },
      select: {
        id: true,
        lotId: true,
        amount: true,
        status: true,
        source: true,
        createdAt: true,
        bidder: { select: { id: true, name: true } },
      },
    });

    return { auctionId: lot.auctionId, bid };
  }

  private isSerializationFailure(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2034'
    );
  }
}
