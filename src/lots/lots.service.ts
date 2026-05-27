import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { LotStatus } from '../../generated/prisma/enums';
import { AuthenticatedActor } from '../auth/actor-jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLotDto } from './dto/create-lot.dto';
import { UpdateLotDto } from './dto/update-lot.dto';

@Injectable()
export class LotsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateLotDto, actor: AuthenticatedActor) {
    const auction = await this.prisma.auction.findUnique({
      where: { id: data.auctionId },
      select: { id: true, auctionHouseId: true },
    });

    if (!auction) {
      throw new NotFoundException('Remate nao encontrado');
    }

    const isAuctionHouseActor =
      actor.type === 'AUCTION_HOUSE' &&
      actor.auctionHouse.id === auction.auctionHouseId;

    if (
      actor.type === 'AUCTION_HOUSE' &&
      actor.auctionHouse.id !== auction.auctionHouseId
    ) {
      throw new ForbiddenException(
        'Escritorio nao pode cadastrar lotes em remate de outro escritorio',
      );
    }

    if (actor.type === 'USER' && !actor.user.sellerProfile) {
      throw new ForbiddenException(
        'Apenas vendedores ou o escritorio responsavel podem cadastrar lotes neste remate',
      );
    }

    return this.prisma.lot.create({
      data: this.toLotCreateData(data, actor, auction, isAuctionHouseActor),
      include: this.lotInclude(),
    });
  }

  findAll() {
    return this.prisma.lot.findMany({
      include: this.lotInclude(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const lot = await this.prisma.lot.findUnique({
      where: { id },
      include: this.lotInclude(),
    });

    if (!lot) {
      throw new NotFoundException('Lote nao encontrado');
    }

    return lot;
  }

  async update(id: string, data: UpdateLotDto, actor: AuthenticatedActor) {
    await this.assertLotManager(id, actor);

    return this.prisma.lot.update({
      where: { id },
      data: this.toLotUpdateData(data),
      include: this.lotInclude(),
    });
  }

  async remove(id: string, actor: AuthenticatedActor) {
    await this.assertLotManager(id, actor);

    return this.prisma.lot.delete({
      where: { id },
    });
  }

  private toLotCreateData(
    data: CreateLotDto,
    actor: AuthenticatedActor,
    auction: { id: string; auctionHouseId: string },
    isAuctionHouseActor: boolean,
  ): Prisma.LotCreateInput {
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
      consignment:
        actor.type === 'USER' &&
        actor.user.sellerProfile &&
        !isAuctionHouseActor
          ? {
              create: {
                seller: { connect: { id: actor.user.id } },
                auctionHouse: { connect: { id: auction.auctionHouseId } },
              },
            }
          : data.consignmentId
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
      media: true,
      sale: true,
    } satisfies Prisma.LotInclude;
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
