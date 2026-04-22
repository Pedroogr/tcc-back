import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { UpdateAuctionDto } from './dto/update-auction.dto';

@Injectable()
export class AuctionsService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateAuctionDto) {
    return this.prisma.auction.create({
      data: {
        ...data,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
      },
      include: {
        owner: true,
        lots: true,
      },
    });
  }

  findAll() {
    return this.prisma.auction.findMany({
      include: {
        owner: true,
        lots: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const auction = await this.prisma.auction.findUnique({
      where: { id },
      include: {
        owner: true,
        lots: true,
      },
    });

    if (!auction) {
      throw new NotFoundException('Leilão não encontrado');
    }

    return auction;
  }

  async update(id: string, data: UpdateAuctionDto) {
    await this.findOne(id);

    return this.prisma.auction.update({
      where: { id },
      data: {
        ...data,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
      },
      include: {
        owner: true,
        lots: true,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.auction.delete({
      where: { id },
    });
  }
}