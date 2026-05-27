import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  register(data: CreateUserDto) {
    return this.usersService.create(data);
  }

  async login(data: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: data.email },
      select: {
        ...this.safeUserSelect(),
        passwordHash: true,
      },
    });

    if (!user) {
      return this.loginAuctionHouse(data);
    }

    const passwordMatches = await compare(data.password, user.passwordHash);

    if (!passwordMatches) {
      throw new UnauthorizedException('E-mail ou senha invalidos');
    }

    return {
      accessToken: await this.jwtService.signAsync({
        sub: user.id,
        email: user.email,
        actorType: 'USER',
        platformRole: user.platformRole,
      }),
      actorType: 'USER',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        document: user.document,
        platformRole: user.platformRole,
        status: user.status,
        buyerProfile: user.buyerProfile,
        sellerProfile: user.sellerProfile,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  }

  async loginAuctionHouse(data: LoginDto) {
    const auctionHouse = await this.prisma.auctionHouse.findUnique({
      where: { email: data.email },
      select: {
        ...this.safeAuctionHouseSelect(),
        passwordHash: true,
      },
    });

    if (!auctionHouse) {
      throw new UnauthorizedException('E-mail ou senha invalidos');
    }

    const passwordMatches = await compare(
      data.password,
      auctionHouse.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('E-mail ou senha invalidos');
    }

    return {
      accessToken: await this.jwtService.signAsync({
        sub: auctionHouse.id,
        email: auctionHouse.email,
        actorType: 'AUCTION_HOUSE',
      }),
      actorType: 'AUCTION_HOUSE',
      auctionHouse: {
        id: auctionHouse.id,
        name: auctionHouse.name,
        document: auctionHouse.document,
        email: auctionHouse.email,
        phone: auctionHouse.phone,
        city: auctionHouse.city,
        state: auctionHouse.state,
        country: auctionHouse.country,
        logoUrl: auctionHouse.logoUrl,
        status: auctionHouse.status,
        mustChangePassword: auctionHouse.mustChangePassword,
        createdAt: auctionHouse.createdAt,
        updatedAt: auctionHouse.updatedAt,
      },
    };
  }

  private safeUserSelect() {
    return {
      id: true,
      name: true,
      email: true,
      phone: true,
      document: true,
      platformRole: true,
      status: true,
      buyerProfile: true,
      sellerProfile: true,
      createdAt: true,
      updatedAt: true,
    } satisfies Prisma.UserSelect;
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
}
