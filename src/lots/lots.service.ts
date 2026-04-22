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
      data: {
        ...data,
        minPrice:
          data.minPrice !== undefined
            ? new Prisma.Decimal(data.minPrice)
            : undefined,
      },
      include: {
        auction: true,
      },
    });
  }

  findAll() {
    return this.prisma.lot.findMany({
      include: {
        auction: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const lot = await this.prisma.lot.findUnique({
      where: { id },
      include: {
        auction: true,
      },
    });

    if (!lot) {
      throw new NotFoundException('Lote não encontrado');
    }

    return lot;
  }

  async update(id: string, data: UpdateLotDto) {
    await this.findOne(id);

    return this.prisma.lot.update({
      where: { id },
      data: {
        ...data,
        minPrice:
          data.minPrice !== undefined
            ? new Prisma.Decimal(data.minPrice)
            : undefined,
      },
      include: {
        auction: true,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.lot.delete({
      where: { id },
    });
  }
}