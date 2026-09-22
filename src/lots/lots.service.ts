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
  BidSource,
  BidStatus,
  LotStatus,
  MediaType,
} from '../../generated/prisma/enums';
import { AuthenticatedActor } from '../auth/actor-jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { BidsService } from './bids.service';
import { CreateBidDto } from './dto/create-bid.dto';
import { CreateLotDto } from './dto/create-lot.dto';
import { SetLotStageDto } from './dto/set-lot-stage.dto';
import { UpdateLotDto } from './dto/update-lot.dto';

const MAX_TRANSACTION_ATTEMPTS = 3;

@Injectable()
export class LotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bidsService: BidsService,
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

    if (data.status !== undefined || data.auctionId !== undefined) {
      throw new BadRequestException(
        'Status e remate do lote nao podem ser alterados por esta rota',
      );
    }

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

  async setStage(id: string, data: SetLotStageDto, actor: AuthenticatedActor) {
    if (actor.type !== 'AUCTION_HOUSE') {
      throw new ForbiddenException(
        'Apenas escritorios podem colocar ou retirar lotes da pista',
      );
    }

    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const lot = await tx.lot.findUnique({
              where: { id },
              select: {
                id: true,
                status: true,
                auctionId: true,
                auction: { select: { auctionHouseId: true } },
              },
            });

            if (!lot) {
              throw new NotFoundException('Lote nao encontrado');
            }

            if (lot.auction?.auctionHouseId !== actor.auctionHouse.id) {
              throw new ForbiddenException(
                'Escritorio nao pode gerenciar lote de outro escritorio',
              );
            }

            if (lot.status === data.status) {
              const unchanged = await tx.lot.findUniqueOrThrow({
                where: { id },
                include: this.lotInclude(),
              });

              return this.toPublicLot(unchanged);
            }

            const canEnterStage =
              data.status === LotStatus.IN_AUCTION &&
              [
                LotStatus.DRAFT,
                LotStatus.UNDER_REVIEW,
                LotStatus.APPROVED,
                LotStatus.AVAILABLE,
              ].some((status) => status === lot.status);
            const canLeaveStage =
              data.status === LotStatus.AVAILABLE &&
              lot.status === LotStatus.IN_AUCTION;

            if (!canEnterStage && !canLeaveStage) {
              throw new BadRequestException(
                'Transicao de etapa invalida para este lote',
              );
            }

            if (data.status === LotStatus.IN_AUCTION) {
              const activeLot = await tx.lot.findFirst({
                where: {
                  auctionId: lot.auctionId,
                  status: LotStatus.IN_AUCTION,
                  id: { not: id },
                },
                select: { id: true },
              });

              if (activeLot) {
                throw new BadRequestException(
                  'Ja existe outro lote em pista neste remate',
                );
              }
            }

            const updated = await tx.lot.update({
              where: { id },
              data: { status: data.status },
              include: this.lotInclude(),
            });

            return this.toPublicLot(updated);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          this.isSerializationFailure(error) &&
          attempt < MAX_TRANSACTION_ATTEMPTS
        ) {
          continue;
        }

        throw error;
      }
    }

    throw new BadRequestException(
      'Nao foi possivel atualizar a etapa do lote. Tente novamente.',
    );
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

    return this.bidsService.place({
      source: BidSource.ONLINE,
      lotId: id,
      bidderId: actor.user.id,
      amount: data.amount,
    });
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
        source: true,
        createdAt: true,
        bidder: { select: { id: true, name: true } },
      },
    });
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

  private isSerializationFailure(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2034'
    );
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
