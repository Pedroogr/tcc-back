import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { Prisma } from '../../generated/prisma/client';
import {
  BidStatus,
  BuyerRegistrationStatus,
  LotStatus,
  MediaType,
} from '../../generated/prisma/enums';
import { AuthenticatedActor } from '../auth/actor-jwt-auth.guard';
import { CommerceGateway } from '../commerce/commerce.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBidDto } from './dto/create-bid.dto';
import { CreateLotDto } from './dto/create-lot.dto';
import { UpdateLotDto } from './dto/update-lot.dto';

const MAX_BID_TRANSACTION_ATTEMPTS = 3;

@Injectable()
export class LotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceGateway: CommerceGateway,
  ) {}

  async create(data: CreateLotDto, actor: AuthenticatedActor) {
    const auction = await this.prisma.auction.findUnique({
      where: { id: data.auctionId },
      select: { id: true, auctionHouseId: true },
    });

    if (!auction) {
      throw new NotFoundException('Remate nao encontrado');
    }

    if (actor.type !== 'AUCTION_HOUSE') {
      throw new ForbiddenException(
        'Apenas escritorios podem cadastrar lotes em remates',
      );
    }

    if (actor.auctionHouse.id !== auction.auctionHouseId) {
      throw new ForbiddenException(
        'Escritorio nao pode cadastrar lotes em remate de outro escritorio',
      );
    }

    const imageMedia = await this.saveLotImages(data.images);

    const created = await this.prisma.lot.create({
      data: {
        ...this.toLotCreateData(data),
        media: imageMedia.length ? { create: imageMedia } : undefined,
      },
      include: this.lotInclude(),
    });

    return this.toPublicLot(created);
  }

  async findAll() {
    const lots = await this.prisma.lot.findMany({
      include: this.lotInclude(),
      orderBy: { createdAt: 'desc' },
    });

    return lots.map((lot) => this.toPublicLot(lot));
  }

  async findOne(id: string) {
    const lot = await this.prisma.lot.findUnique({
      where: { id },
      include: this.lotInclude(),
    });

    if (!lot) {
      throw new NotFoundException('Lote nao encontrado');
    }

    return this.toPublicLot(lot);
  }

  async update(id: string, data: UpdateLotDto, actor: AuthenticatedActor) {
    await this.assertLotManager(id, actor);
    const imageMedia = await this.saveLotImages(data.images);

    const updated = await this.prisma.lot.update({
      where: { id },
      data: {
        ...this.toLotUpdateData(data),
        media: imageMedia.length ? { create: imageMedia } : undefined,
      },
      include: this.lotInclude(),
    });

    return this.toPublicLot(updated);
  }

  async remove(id: string, actor: AuthenticatedActor) {
    await this.assertLotManager(id, actor);

    return this.prisma.lot.delete({
      where: { id },
    });
  }

  async createBid(id: string, data: CreateBidDto, actor: AuthenticatedActor) {
    if (actor.type !== 'USER') {
      throw new ForbiddenException(
        'Apenas usuarios comuns podem realizar lances',
      );
    }

    const lot = await this.prisma.lot.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        initialPrice: true,
        auctionId: true,
        auction: {
          select: {
            auctionHouseId: true,
            id: true,
            settings: {
              select: {
                minBidIncrement: true,
              },
            },
          },
        },
      },
    });

    if (!lot) {
      throw new NotFoundException('Lote nao encontrado');
    }

    const auctionId = lot.auctionId;

    if (!auctionId || !lot.auction) {
      throw new ForbiddenException('Lote nao esta vinculado a um remate');
    }

    if (lot.status !== LotStatus.IN_AUCTION) {
      throw new ForbiddenException('Lote nao esta em pista para lances');
    }

    const registration = await this.prisma.buyerRegistration.findUnique({
      where: {
        buyerId_auctionHouseId: {
          buyerId: actor.user.id,
          auctionHouseId: lot.auction.auctionHouseId,
        },
      },
      select: { status: true },
    });

    if (registration?.status !== BuyerRegistrationStatus.APPROVED) {
      throw new ForbiddenException(
        'Usuario precisa estar aprovado pelo escritorio deste remate para realizar lances',
      );
    }

    const created = await this.persistBid(id, actor.user.id, data, {
      initialPrice: lot.initialPrice,
      minBidIncrement:
        lot.auction.settings?.minBidIncrement ?? new Prisma.Decimal(0),
    });

    this.commerceGateway.emitBidRecorded(auctionId, {
      bidId: created.id,
      lotId: created.lotId,
      amount: created.amount.toString(),
      createdAt: created.createdAt,
      bidder: created.bidder,
    });

    return {
      id: created.id,
      lotId: created.lotId,
      amount: created.amount,
      status: created.status,
      createdAt: created.createdAt,
    };
  }

  async findBidHistory(id: string, actor: AuthenticatedActor) {
    const lot = await this.prisma.lot.findUnique({
      where: { id },
      select: {
        id: true,
        auction: { select: { auctionHouseId: true } },
        consignment: { select: { auctionHouseId: true } },
      },
    });

    if (!lot) {
      throw new NotFoundException('Lote nao encontrado');
    }

    if (actor.type !== 'AUCTION_HOUSE') {
      throw new ForbiddenException(
        'Apenas o escritorio responsavel pode ver o historico de lances',
      );
    }

    const ownerAuctionHouseId =
      lot.auction?.auctionHouseId ?? lot.consignment?.auctionHouseId;

    if (ownerAuctionHouseId !== actor.auctionHouse.id) {
      throw new ForbiddenException(
        'Escritorio nao pode ver o historico de lances de outro escritorio',
      );
    }

    return this.prisma.bid.findMany({
      where: { lotId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        lotId: true,
        amount: true,
        status: true,
        createdAt: true,
        bidder: { select: { id: true, name: true } },
      },
    });
  }

  private async persistBid(
    lotId: string,
    bidderId: string,
    data: CreateBidDto,
    pricing: {
      initialPrice: Prisma.Decimal | null;
      minBidIncrement: Prisma.Decimal;
    },
  ) {
    for (
      let attempt = 1;
      attempt <= MAX_BID_TRANSACTION_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const currentWinningBid = await tx.bid.findFirst({
              where: { lotId, status: BidStatus.WINNING },
              orderBy: { amount: 'desc' },
            });

            const minimumAmount = currentWinningBid
              ? currentWinningBid.amount.plus(pricing.minBidIncrement)
              : (pricing.initialPrice ?? new Prisma.Decimal(0));
            const amount = new Prisma.Decimal(data.amount);

            if (amount.lt(minimumAmount)) {
              throw new BadRequestException(
                `Lance minimo para este lote e ${minimumAmount.toString()}`,
              );
            }

            await tx.bid.updateMany({
              where: { lotId, status: BidStatus.WINNING },
              data: { status: BidStatus.OUTBID },
            });

            return tx.bid.create({
              data: {
                amount,
                status: BidStatus.WINNING,
                bidder: { connect: { id: bidderId } },
                lot: { connect: { id: lotId } },
              },
              select: {
                id: true,
                lotId: true,
                amount: true,
                status: true,
                createdAt: true,
                bidder: { select: { id: true, name: true } },
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
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

  private isSerializationFailure(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2034'
    );
  }

  private toLotCreateData(data: CreateLotDto): Prisma.LotCreateInput {
    return {
      code: data.code,
      title: data.title,
      description: data.description,
      breed: data.breed,
      category: data.category,
      sex: data.sex,
      ageMonths: data.ageMonths,
      weightKg: data.weightKg,
      quantity: data.quantity,
      initialPrice:
        data.initialPrice !== undefined
          ? new Prisma.Decimal(data.initialPrice)
          : undefined,
      status: LotStatus.UNDER_REVIEW,
      auction: { connect: { id: data.auctionId } },
      consignment: data.consignmentId
        ? { connect: { id: data.consignmentId } }
        : undefined,
    };
  }

  private toLotUpdateData(data: UpdateLotDto): Prisma.LotUpdateInput {
    return {
      code: data.code,
      title: data.title,
      description: data.description,
      breed: data.breed,
      category: data.category,
      sex: data.sex,
      ageMonths: data.ageMonths,
      weightKg: data.weightKg,
      quantity: data.quantity,
      initialPrice:
        data.initialPrice !== undefined
          ? new Prisma.Decimal(data.initialPrice)
          : undefined,
      status: data.status,
      auction: data.auctionId ? { connect: { id: data.auctionId } } : undefined,
      consignment: data.consignmentId
        ? { connect: { id: data.consignmentId } }
        : undefined,
    };
  }

  private lotInclude() {
    return {
      auction: true,
      consignment: true,
      media: { orderBy: { sortOrder: 'asc' } },
      sale: { select: { status: true, finalPrice: true, soldAt: true } },
      bids: {
        where: { status: BidStatus.WINNING },
        orderBy: { amount: 'desc' },
        take: 1,
        select: { amount: true },
      },
    } satisfies Prisma.LotInclude;
  }

  // Public projection: derives an anonymous `currentPrice` from the winning bid
  // and never exposes the bid history or any bidder identity (RF06 privacy).
  private toPublicLot<
    T extends {
      bids: Array<{ amount: Prisma.Decimal }>;
      initialPrice?: Prisma.Decimal | null;
    },
  >(lot: T) {
    const { bids, ...safeLot } = lot;

    return {
      ...safeLot,
      currentPrice: bids[0]?.amount ?? safeLot.initialPrice ?? null,
    };
  }

  private async saveLotImages(images?: CreateLotDto['images']) {
    if (!images?.length) {
      return [];
    }

    const uploadDir = join(process.cwd(), 'public', 'uploads', 'lots');
    await mkdir(uploadDir, { recursive: true });

    return Promise.all(
      images.map(async (image, index) => {
        const savedImage = await this.saveLotImageFile(
          image.dataUrl,
          uploadDir,
        );

        return {
          type: MediaType.IMAGE,
          url: savedImage.url,
          description: image.description || image.fileName,
          sortOrder: index,
        };
      }),
    );
  }

  private async saveLotImageFile(dataUrl: string, uploadDir: string) {
    const match =
      /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(
        dataUrl,
      );

    if (!match) {
      throw new BadRequestException(
        'Imagem invalida. Envie PNG, JPG, WEBP ou GIF.',
      );
    }

    const [, mimeType, base64] = match;
    const buffer = Buffer.from(base64, 'base64');

    if (buffer.byteLength > 5 * 1024 * 1024) {
      throw new BadRequestException('Cada imagem deve ter no maximo 5MB.');
    }

    const extensionByMimeType: Record<string, string> = {
      'image/gif': 'gif',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const extension = extensionByMimeType[mimeType];
    const fileName = `${randomUUID()}.${extension}`;

    await writeFile(join(uploadDir, fileName), buffer);

    return { url: `/uploads/lots/${fileName}` };
  }

  private async assertLotManager(id: string, actor: AuthenticatedActor) {
    const lot = await this.prisma.lot.findUnique({
      where: { id },
      select: {
        id: true,
        auction: { select: { auctionHouseId: true } },
        consignment: { select: { sellerId: true, auctionHouseId: true } },
      },
    });

    if (!lot) {
      throw new NotFoundException('Lote nao encontrado');
    }

    if (actor.type === 'AUCTION_HOUSE') {
      const auctionHouseId =
        lot.auction?.auctionHouseId ?? lot.consignment?.auctionHouseId;

      if (auctionHouseId === actor.auctionHouse.id) {
        return;
      }

      throw new ForbiddenException(
        'Escritorio nao pode gerenciar lote de outro escritorio',
      );
    }

    if (lot.consignment?.sellerId === actor.user.id) {
      return;
    }

    throw new ForbiddenException('Usuario nao pode gerenciar este lote');
  }
}
