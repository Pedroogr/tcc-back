import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { UpdateAuctionDto } from './dto/update-auction.dto';

@Injectable()
export class AuctionsService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateAuctionDto) {
    return this.prisma.auction.create({
      data: this.toAuctionCreateData(data),
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

  async update(id: string, data: UpdateAuctionDto) {
    await this.findOne(id);

    return this.prisma.auction.update({
      where: { id },
      data: this.toAuctionUpdateData(data),
      include: this.auctionInclude(),
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.auction.delete({
      where: { id },
    });
  }

  private toAuctionCreateData(
    data: CreateAuctionDto,
  ): Prisma.AuctionCreateInput {
    return {
      title: data.title,
      description: data.description,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
      status: data.status,
      mode: data.mode,
      auctionHouse: {
        connect: { id: data.auctionHouseId },
      },
      createdBy: {
        connect: { id: data.createdById },
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
      createdBy: data.createdById
        ? { connect: { id: data.createdById } }
        : undefined,
    };
  }

  private auctionInclude() {
    return {
      auctionHouse: true,
      createdBy: true,
      lots: true,
    } satisfies Prisma.AuctionInclude;
  }
}
