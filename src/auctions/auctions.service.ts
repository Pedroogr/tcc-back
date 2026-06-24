import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
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
import type { AuctionThumbnailUpload } from './auctions.controller';

const auctionThumbnailMaxSize = 5 * 1024 * 1024;
const auctionThumbnailMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const auctionThumbnailExtensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

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
        thumbnailUrl: true,
        scheduledAt: true,
        startedAt: true,
        finishedAt: true,
        status: true,
        auctionHouseId: true,
        auctionHouse: {
          select: {
            id: true,
            name: true,
          },
        },
        stream: {
          select: this.safeStreamSelect(),
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

  async uploadThumbnail(
    id: string,
    file: AuctionThumbnailUpload | undefined,
    actor: AuthenticatedActor,
  ) {
    const auction = await this.assertAuctionHouseOwner(id, actor);
    this.assertValidThumbnail(file);

    const uploadDir = join(process.cwd(), 'public', 'uploads', 'auctions');
    await mkdir(uploadDir, { recursive: true });

    const extension = auctionThumbnailExtensions[file.mimetype];
    const fileName = `${id}-${randomUUID()}.${extension}`;
    const filePath = join(uploadDir, fileName);
    const thumbnailUrl = `/uploads/auctions/${fileName}`;

    await writeFile(filePath, file.buffer);

    try {
      const updatedAuction = await this.prisma.auction.update({
        where: { id },
        data: { thumbnailUrl },
        include: this.auctionInclude(),
      });

      await this.removeStoredThumbnail(auction.thumbnailUrl);
      return updatedAuction;
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
  }

  async removeThumbnail(id: string, actor: AuthenticatedActor) {
    const auction = await this.assertAuctionHouseOwner(id, actor);

    const updatedAuction = await this.prisma.auction.update({
      where: { id },
      data: { thumbnailUrl: null },
      include: this.auctionInclude(),
    });

    await this.removeStoredThumbnail(auction.thumbnailUrl);

    return updatedAuction;
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
      auctionHouse: data.auctionHouseId
        ? { connect: { id: data.auctionHouseId } }
        : undefined,
    };
  }

  private auctionInclude() {
    return {
      auctionHouse: {
        select: this.safeAuctionHouseSelect(),
      },
      lots: true,
      stream: {
        select: this.safeStreamSelect(),
      },
    } satisfies Prisma.AuctionInclude;
  }

  private safeAuctionHouseSelect() {
    return {
      id: true,
      name: true,
      document: true,
      email: true,
      phone: true,
      city: true,
      state: true,
      country: true,
      logoUrl: true,
      status: true,
      mustChangePassword: true,
      createdAt: true,
      updatedAt: true,
    } satisfies Prisma.AuctionHouseSelect;
  }

  private safeStreamSelect() {
    return {
      id: true,
      status: true,
      streamUrl: true,
      protocol: true,
      startedAt: true,
      endedAt: true,
      createdAt: true,
      updatedAt: true,
    } satisfies Prisma.StreamSelect;
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
      select: { id: true, auctionHouseId: true, thumbnailUrl: true },
    });

    if (!auction) {
      throw new NotFoundException('Leilao nao encontrado');
    }

    if (auction.auctionHouseId !== actor.auctionHouse.id) {
      throw new ForbiddenException(
        'Escritorio nao pode gerenciar remate de outro escritorio',
      );
    }

    return auction;
  }

  private assertValidThumbnail(
    file: AuctionThumbnailUpload | undefined,
  ): asserts file is AuctionThumbnailUpload {
    if (!file) {
      throw new BadRequestException('Selecione uma imagem de capa do remate.');
    }

    if (!auctionThumbnailMimeTypes.has(file.mimetype)) {
      throw new BadRequestException('Imagem invalida. Envie JPG, PNG ou WEBP.');
    }

    if (file.size > auctionThumbnailMaxSize) {
      throw new BadRequestException('A imagem de capa deve ter no maximo 5MB.');
    }
  }

  private async removeStoredThumbnail(thumbnailUrl?: string | null) {
    if (!thumbnailUrl?.startsWith('/uploads/auctions/')) {
      return;
    }

    const fileName = thumbnailUrl.replace('/uploads/auctions/', '');

    await unlink(
      join(process.cwd(), 'public', 'uploads', 'auctions', fileName),
    ).catch(() => undefined);
  }
}
