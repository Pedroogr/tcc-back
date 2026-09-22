import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuctionStatus } from '../../generated/prisma/enums';
import { AuthenticatedActor } from '../auth/actor-jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOperatorAccessDto } from './dto/create-operator-access.dto';
import { generateOperatorCode, hashOperatorCode } from './operator-code';
import { OperatorLoginRateLimiter } from './operator-login-rate-limiter';

const ACCESS_LIFETIME_MS = 24 * 60 * 60 * 1000;
const CLOSED_AUCTION_STATUSES: AuctionStatus[] = [
  AuctionStatus.FINISHED,
  AuctionStatus.CANCELED,
];

@Injectable()
export class OperatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly loginRateLimiter: OperatorLoginRateLimiter,
  ) {}

  async createAccess(data: CreateOperatorAccessDto, actor: AuthenticatedActor) {
    const officeId = this.officeId(actor);
    const auction = await this.prisma.auction.findUnique({
      where: { id: data.auctionId },
      select: { id: true, auctionHouseId: true, status: true },
    });

    if (!auction) {
      throw new NotFoundException('Remate nao encontrado');
    }
    if (auction.auctionHouseId !== officeId) {
      throw new ForbiddenException(
        'Escritorio nao pode gerenciar acessos de outro remate',
      );
    }
    if (CLOSED_AUCTION_STATUSES.includes(auction.status)) {
      throw new BadRequestException(
        'Nao e possivel criar acesso para um remate encerrado',
      );
    }

    const code = generateOperatorCode();
    const access = await this.prisma.operatorAccess.create({
      data: {
        auctionId: auction.id,
        label: data.label.trim(),
        codeHash: hashOperatorCode(code),
        expiresAt: new Date(Date.now() + ACCESS_LIFETIME_MS),
      },
      select: this.accessSummarySelect(),
    });

    return { ...access, code };
  }

  async listAccesses(auctionId: string | undefined, actor: AuthenticatedActor) {
    const officeId = this.officeId(actor);

    if (auctionId) {
      await this.assertAuctionOwner(auctionId, officeId);
    }

    return this.prisma.operatorAccess.findMany({
      where: {
        auctionId,
        auction: { auctionHouseId: officeId },
      },
      select: this.accessSummarySelect(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeAccess(id: string, actor: AuthenticatedActor) {
    const officeId = this.officeId(actor);
    const access = await this.prisma.operatorAccess.findUnique({
      where: { id },
      select: {
        id: true,
        auction: { select: { auctionHouseId: true } },
      },
    });

    if (!access) {
      throw new NotFoundException('Acesso de operador nao encontrado');
    }
    if (access.auction.auctionHouseId !== officeId) {
      throw new ForbiddenException(
        'Escritorio nao pode revogar acesso de outro remate',
      );
    }

    return this.prisma.operatorAccess.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: this.accessSummarySelect(),
    });
  }

  async login(code: string, ip: string) {
    this.loginRateLimiter.assertAllowed(ip);

    try {
      const now = new Date();
      const access = await this.prisma.$transaction(async (tx) => {
        const found = await tx.operatorAccess.findUnique({
          where: { codeHash: hashOperatorCode(code) },
          select: {
            id: true,
            auctionId: true,
            label: true,
            expiresAt: true,
            usedAt: true,
            revokedAt: true,
            auction: { select: { status: true } },
          },
        });

        if (
          !found ||
          found.usedAt ||
          found.revokedAt ||
          found.expiresAt <= now ||
          CLOSED_AUCTION_STATUSES.includes(found.auction.status)
        ) {
          throw this.invalidCode();
        }

        const claimed = await tx.operatorAccess.updateMany({
          where: { id: found.id, usedAt: null, revokedAt: null },
          data: { usedAt: now },
        });

        if (claimed.count !== 1) {
          throw this.invalidCode();
        }

        return found;
      });

      const expiresIn = Math.max(
        1,
        Math.floor((access.expiresAt.getTime() - Date.now()) / 1000),
      );
      const accessToken = await this.jwtService.signAsync(
        {
          sub: access.id,
          actorType: 'OPERATOR',
          operatorAccessId: access.id,
          auctionId: access.auctionId,
        },
        { expiresIn },
      );

      this.loginRateLimiter.clear(ip);
      return {
        accessToken,
        actorType: 'OPERATOR',
        operatorAccess: {
          id: access.id,
          auctionId: access.auctionId,
          label: access.label,
          expiresAt: access.expiresAt,
        },
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        this.loginRateLimiter.recordFailure(ip);
      }
      throw error;
    }
  }

  private officeId(actor: AuthenticatedActor) {
    if (actor.type !== 'AUCTION_HOUSE') {
      throw new ForbiddenException(
        'Apenas escritorios podem gerenciar acessos de operador',
      );
    }
    return actor.auctionHouse.id;
  }

  private async assertAuctionOwner(auctionId: string, officeId: string) {
    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      select: { auctionHouseId: true },
    });

    if (!auction) {
      throw new NotFoundException('Remate nao encontrado');
    }
    if (auction.auctionHouseId !== officeId) {
      throw new ForbiddenException(
        'Escritorio nao pode gerenciar acessos de outro remate',
      );
    }
  }

  private accessSummarySelect() {
    return {
      id: true,
      auctionId: true,
      label: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      createdAt: true,
    } as const;
  }

  private invalidCode() {
    return new UnauthorizedException('Codigo de operador invalido ou expirado');
  }
}
