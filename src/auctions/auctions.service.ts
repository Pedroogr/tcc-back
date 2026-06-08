import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  AuctionStatus,
  BuyerRegistrationStatus,
} from '../../generated/prisma/enums';
import { AuthenticatedActor } from '../auth/actor-jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBuyerRegistrationDto } from './dto/create-buyer-registration.dto';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { ReviewBuyerRegistrationDto } from './dto/review-buyer-registration.dto';
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

  findPublic() {
    return this.prisma.auction.findMany({
      where: {
        status: {
          notIn: [AuctionStatus.DRAFT, AuctionStatus.CANCELED],
        },
      },
      select: {
        id: true,
        title: true,
        description: true,
        scheduledAt: true,
        startedAt: true,
        finishedAt: true,
        status: true,
        mode: true,
        auctionHouseId: true,
        auctionHouse: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            lots: true,
          },
        },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
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

  async registerBuyer(
    id: string,
    data: CreateBuyerRegistrationDto,
    actor: AuthenticatedActor,
  ) {
    if (actor.type !== 'USER') {
      throw new ForbiddenException(
        'Apenas usuarios comuns podem solicitar liberacao para lances',
      );
    }

    const auction = await this.prisma.auction.findUnique({
      where: { id },
      select: { id: true, auctionHouseId: true },
    });

    if (!auction) {
      throw new NotFoundException('Leilao nao encontrado');
    }

    const existingRegistration = await this.prisma.buyerRegistration.findUnique(
      {
        where: {
          buyerId_auctionHouseId: {
            buyerId: actor.user.id,
            auctionHouseId: auction.auctionHouseId,
          },
        },
      },
    );

    if (existingRegistration?.status === BuyerRegistrationStatus.BLOCKED) {
      throw new ForbiddenException(
        'Comprador bloqueado para este remate pelo escritorio responsavel',
      );
    }

    if (existingRegistration?.status === BuyerRegistrationStatus.APPROVED) {
      return existingRegistration;
    }

    return this.prisma.buyerRegistration.upsert({
      where: {
        buyerId_auctionHouseId: {
          buyerId: actor.user.id,
          auctionHouseId: auction.auctionHouseId,
        },
      },
      create: {
        buyer: { connect: { id: actor.user.id } },
        auctionHouse: { connect: { id: auction.auctionHouseId } },
        notes: data.notes,
      },
      update: {
        status: BuyerRegistrationStatus.PENDING,
        notes: data.notes,
        approvedAt: null,
        rejectedAt: null,
      },
    });
  }

  async findBuyerRegistrations(id: string, actor: AuthenticatedActor) {
    await this.assertAuctionHouseOwner(id, actor);

    if (actor.type !== 'AUCTION_HOUSE') {
      throw new ForbiddenException(
        'Apenas escritorios podem visualizar solicitacoes',
      );
    }

    return this.prisma.buyerRegistration.findMany({
      where: { auctionHouseId: actor.auctionHouse.id },
      include: { buyer: { select: this.registrationBuyerSelect() } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async reviewBuyerRegistration(
    auctionId: string,
    registrationId: string,
    data: ReviewBuyerRegistrationDto,
    actor: AuthenticatedActor,
  ) {
    await this.assertAuctionHouseOwner(auctionId, actor);

    if (actor.type !== 'AUCTION_HOUSE') {
      throw new ForbiddenException(
        'Apenas escritorios podem revisar solicitacoes',
      );
    }

    const registration = await this.prisma.buyerRegistration.findUnique({
      where: { id: registrationId },
      select: { id: true, auctionHouseId: true },
    });

    if (
      !registration ||
      registration.auctionHouseId !== actor.auctionHouse.id
    ) {
      throw new NotFoundException('Solicitacao de comprador nao encontrada');
    }

    return this.prisma.buyerRegistration.update({
      where: { id: registrationId },
      data: {
        status: data.status,
        notes: data.notes,
        approvedAt:
          data.status === BuyerRegistrationStatus.APPROVED ? new Date() : null,
        rejectedAt:
          data.status === BuyerRegistrationStatus.REJECTED ? new Date() : null,
      },
      include: { buyer: { select: this.registrationBuyerSelect() } },
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

  private registrationBuyerSelect() {
    return {
      id: true,
      name: true,
      email: true,
      phone: true,
      document: true,
      buyerProfile: true,
    } satisfies Prisma.UserSelect;
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
