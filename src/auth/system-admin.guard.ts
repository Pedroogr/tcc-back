import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
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

const authenticatedAdminSelect = {
  id: true,
  name: true,
  email: true,
  platformRole: true,
  status: true,
} satisfies Prisma.UserSelect;

export type AuthenticatedAdmin = Prisma.UserGetPayload<{
  select: typeof authenticatedAdminSelect;
}>;

export type AuthenticatedAdminRequest = Request & {
  user: AuthenticatedAdmin;
};

@Injectable()
export class SystemAdminGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedAdminRequest>();
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

    if (payload.actorType && payload.actorType !== 'USER') {
      throw new UnauthorizedException('Token de usuario invalido');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: authenticatedAdminSelect,
    });

    if (!user) {
      throw new UnauthorizedException('Usuario nao encontrado');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Conta inativa');
    }

    if (user.platformRole !== 'SYSTEM_ADMIN') {
      throw new ForbiddenException(
        'Acesso restrito a administradores do sistema',
      );
    }

    request.user = user;
    return true;
  }

  private extractToken(request: Request) {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
