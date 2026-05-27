import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AuthenticatedActor } from '../auth/actor-jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { UpdateAuctionDto } from './dto/update-auction.dto';

@Injectable()
export class AuctionsService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateAuctionDto, actor: AuthenticatedActor) {
    if (actor.type !== 'AUCTION_HOUSE') {
      throw new ForbiddenException('Apenas escritorios podem criar remates');
    }

    return this.prisma.auction.create({
      data: this.toAuctionCreateData(data, actor.auctionHouse.id),
      include: this.auctionInclude(),
    });
  }

  findAll() {
    return this.prisma.auction.findMany({
      include: this.auctionInclude(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const auction = await this.prisma.auction.findUnique({
      where: { id },
      include: this.auctionInclude(),
    });

    if (!auction) {
      throw new NotFoundException('Leilao nao encontrado');
    }

    return auction;
  }

  async update(id: string, data: UpdateAuctionDto, actor: AuthenticatedActor) {
    await this.assertAuctionHouseOwner(id, actor);

    return this.prisma.auction.update({
      where: { id },
      data: this.toAuctionUpdateData(data),
      include: this.auctionInclude(),
    });
  }

  async remove(id: string, actor: AuthenticatedActor) {
    await this.assertAuctionHouseOwner(id, actor);

    return this.prisma.auction.delete({
      where: { id },
    });
  }

  private toAuctionCreateData(
    data: CreateAuctionDto,
    auctionHouseId: string,
  ): Prisma.AuctionCreateInput {
    return {
      title: data.title,
      description: data.description,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
      status: data.status,
      mode: data.mode,
      auctionHouse: {
        connect: { id: auctionHouseId },
      },
    };
  }

  private toAuctionUpdateData(
    data: UpdateAuctionDto,
  ): Prisma.AuctionUpdateInput {
    return {
      title: data.title,
      description: data.description,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
      status: data.status,
      mode: data.mode,
      auctionHouse: data.auctionHouseId
        ? { connect: { id: data.auctionHouseId } }
        : undefined,
    };
  }

  private auctionInclude() {
    return {
      auctionHouse: true,
      lots: true,
    } satisfies Prisma.AuctionInclude;
  }

  private async assertAuctionHouseOwner(id: string, actor: AuthenticatedActor) {
    if (actor.type !== 'AUCTION_HOUSE') {
      throw new ForbiddenException(
        'Apenas escritorios podem gerenciar remates',
      );
    }

    const auction = await this.prisma.auction.findUnique({
      where: { id },
      select: { id: true, auctionHouseId: true },
    });

    if (!auction) {
      throw new NotFoundException('Leilao nao encontrado');
    }

    if (auction.auctionHouseId !== actor.auctionHouse.id) {
      throw new ForbiddenException(
        'Escritorio nao pode gerenciar remate de outro escritorio',
      );
    }
  }
}
