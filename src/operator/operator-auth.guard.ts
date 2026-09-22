import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AuctionStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

const CLOSED_AUCTION_STATUSES: AuctionStatus[] = [
  AuctionStatus.FINISHED,
  AuctionStatus.CANCELED,
];

type OperatorJwtPayload = {
  sub: string;
  actorType: 'OPERATOR';
  operatorAccessId: string;
  auctionId: string;
};

export type OperatorSessionActor = {
  type: 'OPERATOR';
  operatorAccess: {
    id: string;
    auctionId: string;
    label: string;
    expiresAt: Date;
  };
};

export type OperatorRequest = Request & {
  operatorActor: OperatorSessionActor;
};

@Injectable()
export class OperatorAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<OperatorRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw this.invalidSession();
    }

    let payload: OperatorJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<OperatorJwtPayload>(token);
    } catch {
      throw this.invalidSession();
    }

    if (
      payload.actorType !== 'OPERATOR' ||
      payload.sub !== payload.operatorAccessId
    ) {
      throw this.invalidSession();
    }

    const access = await this.prisma.operatorAccess.findUnique({
      where: { id: payload.operatorAccessId },
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
      !access?.usedAt ||
      access.revokedAt ||
      access.expiresAt <= new Date() ||
      access.auctionId !== payload.auctionId ||
      CLOSED_AUCTION_STATUSES.includes(access.auction.status)
    ) {
      throw this.invalidSession();
    }

    request.operatorActor = {
      type: 'OPERATOR',
      operatorAccess: {
        id: access.id,
        auctionId: access.auctionId,
        label: access.label,
        expiresAt: access.expiresAt,
      },
    };
    return true;
  }

  private extractToken(request: Request) {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }

  private invalidSession() {
    return new UnauthorizedException('Sessao de operador invalida ou expirada');
  }
}
