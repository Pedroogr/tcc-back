import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLotDto } from './dto/create-lot.dto';
import { UpdateLotDto } from './dto/update-lot.dto';

@Injectable()
export class LotsService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateLotDto) {
    return this.prisma.lot.create({
      data: this.toLotCreateData(data),
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

  async update(id: string, data: UpdateLotDto) {
    await this.findOne(id);

    return this.prisma.lot.update({
      where: { id },
      data: this.toLotUpdateData(data),
      include: this.lotInclude(),
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.lot.delete({
      where: { id },
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
      status: data.status,
      auction: data.auctionId ? { connect: { id: data.auctionId } } : undefined,
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
      media: true,
      sale: true,
    } satisfies Prisma.LotInclude;
  }
}
