import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'bcryptjs';
import { Prisma } from '../../generated/prisma/client';
import {
  AuctionHouseStatus,
  BuyerRegistrationStatus,
  OfficeInviteStatus,
} from '../../generated/prisma/enums';
import { AuthenticatedActor } from '../auth/actor-jwt-auth.guard';
import { normalizeBrazilianPhone, normalizeCnpj } from '../common/br-fields';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBuyerRegistrationDto } from '../auctions/dto/create-buyer-registration.dto';
import { ReviewBuyerRegistrationDto } from '../auctions/dto/review-buyer-registration.dto';
import { RegisterAuctionHouseInviteDto } from './dto/register-auction-house-invite.dto';

@Injectable()
export class AuctionHousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  findAll() {
    return this.prisma.auctionHouse.findMany({
      where: { status: AuctionHouseStatus.ACTIVE },
      select: this.safeAuctionHouseSelect(),
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const auctionHouse = await this.prisma.auctionHouse.findFirst({
      where: { id, status: AuctionHouseStatus.ACTIVE },
      select: this.safeAuctionHouseSelect(),
    });

    if (!auctionHouse) {
      throw new NotFoundException('Escritorio nao encontrado');
    }

    return auctionHouse;
  }

  async findInvite(token: string) {
    const invite = await this.getValidInvite(token);

    return {
      email: invite.email,
      expiresAt: invite.expiresAt,
      status: invite.status,
    };
  }

  async registerWithInvite(token: string, data: RegisterAuctionHouseInviteDto) {
    const invite = await this.getValidInvite(token);

    if (
      invite.email &&
      invite.email.toLowerCase() !== data.email.trim().toLowerCase()
    ) {
      throw new BadRequestException(
        'E-mail informado nao corresponde ao convite',
      );
    }

    const auctionHouse = await this.createAuctionHouseFromInvite(token, data);

    return {
      accessToken: await this.jwtService.signAsync({
        sub: auctionHouse.id,
        email: auctionHouse.email,
        actorType: 'AUCTION_HOUSE',
      }),
      actorType: 'AUCTION_HOUSE',
      auctionHouse,
    };
  }

  private async createAuctionHouseFromInvite(
    token: string,
    data: RegisterAuctionHouseInviteDto,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const claimedInvite = await tx.officeInvite.updateMany({
          where: {
            token,
            status: OfficeInviteStatus.PENDING,
            expiresAt: { gt: new Date() },
          },
          data: {
            status: OfficeInviteStatus.USED,
            usedAt: new Date(),
          },
        });

        if (claimedInvite.count !== 1) {
          throw new BadRequestException('Convite invalido ou expirado');
        }

        const createdAuctionHouse = await tx.auctionHouse.create({
          data: {
            name: data.name.trim(),
            email: data.email.trim().toLowerCase(),
            passwordHash: await hash(data.password, 10),
            document: normalizeCnpj(data.document),
            phone: normalizeBrazilianPhone(data.phone),
            city: data.city?.trim() || undefined,
            state: data.state?.trim() || undefined,
            country: data.country?.trim() || 'BR',
            status: AuctionHouseStatus.ACTIVE,
            mustChangePassword: false,
          },
          select: this.safeAuctionHouseSelect(),
        });

        await tx.officeInvite.update({
          where: { token },
          data: {
            auctionHouse: { connect: { id: createdAuctionHouse.id } },
          },
        });

        return createdAuctionHouse;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('E-mail ou CNPJ ja cadastrado');
      }

      throw error;
    }
  }

  async registerBuyer(
    auctionHouseId: string,
    data: CreateBuyerRegistrationDto,
    actor: AuthenticatedActor,
  ) {
    if (actor.type !== 'USER') {
      throw new ForbiddenException(
        'Apenas usuarios comuns podem solicitar liberacao para lances',
      );
    }

    await this.findOne(auctionHouseId);

    const existingRegistration = await this.prisma.buyerRegistration.findUnique(
      {
        where: {
          buyerId_auctionHouseId: {
            buyerId: actor.user.id,
            auctionHouseId,
          },
        },
      },
    );

    if (existingRegistration?.status === BuyerRegistrationStatus.BLOCKED) {
      throw new ForbiddenException(
        'Usuario bloqueado para lances neste escritorio',
      );
    }

    if (existingRegistration?.status === BuyerRegistrationStatus.APPROVED) {
      return existingRegistration;
    }

    return this.prisma.buyerRegistration.upsert({
      where: {
        buyerId_auctionHouseId: {
          buyerId: actor.user.id,
          auctionHouseId,
        },
      },
      create: {
        buyer: { connect: { id: actor.user.id } },
        auctionHouse: { connect: { id: auctionHouseId } },
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

  findMyBuyerRegistrations(actor: AuthenticatedActor) {
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

  async findMyRegistration(auctionHouseId: string, actor: AuthenticatedActor) {
    if (actor.type !== 'USER') {
      throw new ForbiddenException(
        'Apenas usuarios comuns possuem cadastro de comprador',
      );
    }

    return this.prisma.buyerRegistration.findUnique({
      where: {
        buyerId_auctionHouseId: {
          buyerId: actor.user.id,
          auctionHouseId,
        },
      },
    });
  }

  async reviewMyBuyerRegistration(
    registrationId: string,
    data: ReviewBuyerRegistrationDto,
    actor: AuthenticatedActor,
  ) {
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
      createdAt: true,
      updatedAt: true,
    } satisfies Prisma.AuctionHouseSelect;
  }

  private async getValidInvite(token: string) {
    const invite = await this.prisma.officeInvite.findUnique({
      where: { token },
    });

    if (!invite) {
      throw new NotFoundException('Convite nao encontrado');
    }

    if (invite.status !== OfficeInviteStatus.PENDING) {
      throw new BadRequestException('Convite invalido ou ja utilizado');
    }

    if (invite.expiresAt <= new Date()) {
      await this.prisma.officeInvite.update({
        where: { token },
        data: { status: OfficeInviteStatus.EXPIRED },
      });
      throw new BadRequestException('Convite expirado');
    }

    return invite;
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
}
