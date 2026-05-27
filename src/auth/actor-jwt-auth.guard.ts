import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type JwtPayload = {
  sub: string;
  email: string;
  actorType?: 'USER' | 'AUCTION_HOUSE';
};

const authenticatedUserSelect = {
  id: true,
  email: true,
  sellerProfile: true,
} satisfies Prisma.UserSelect;

const authenticatedAuctionHouseSelect = {
  id: true,
  name: true,
  email: true,
  status: true,
  mustChangePassword: true,
} satisfies Prisma.AuctionHouseSelect;

export type AuthenticatedUserActor = {
  type: 'USER';
  user: Prisma.UserGetPayload<{ select: typeof authenticatedUserSelect }>;
};

export type AuthenticatedAuctionHouseActor = {
  type: 'AUCTION_HOUSE';
  auctionHouse: Prisma.AuctionHouseGetPayload<{
    select: typeof authenticatedAuctionHouseSelect;
  }>;
};

export type AuthenticatedActor =
  | AuthenticatedUserActor
  | AuthenticatedAuctionHouseActor;

export type AuthenticatedActorRequest = Request & {
  actor: AuthenticatedActor;
};

@Injectable()
export class ActorJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedActorRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Token de autenticacao ausente');
    }

    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Token de autenticacao invalido');
    }

    if (payload.actorType === 'AUCTION_HOUSE') {
      const auctionHouse = await this.prisma.auctionHouse.findUnique({
        where: { id: payload.sub },
        select: authenticatedAuctionHouseSelect,
      });

      if (!auctionHouse) {
        throw new UnauthorizedException('Escritorio nao encontrado');
      }

      request.actor = { type: 'AUCTION_HOUSE', auctionHouse };
      return true;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: authenticatedUserSelect,
    });

    if (!user) {
      throw new UnauthorizedException('Usuario nao encontrado');
    }

    request.actor = { type: 'USER', user };
    return true;
  }

  private extractToken(request: Request) {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
