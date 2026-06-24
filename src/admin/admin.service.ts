import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { OfficeInviteStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOfficeInviteDto } from './dto/create-office-invite.dto';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async createOfficeInvite(data: CreateOfficeInviteDto) {
    const token = randomBytes(32).toString('hex');
    const expiresInDays = data.expiresInDays ?? 7;
    const expiresAt = new Date(
      Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
    );

    const invite = await this.prisma.officeInvite.create({
      data: {
        email: data.email ? data.email.trim().toLowerCase() : undefined,
        token,
        expiresAt,
      },
    });

    return {
      ...invite,
      registrationUrl: `${this.frontendUrl()}/cadastro-escritorio/${token}`,
    };
  }

  async listOfficeInvites() {
    await this.prisma.officeInvite.updateMany({
      where: {
        status: OfficeInviteStatus.PENDING,
        expiresAt: { lte: new Date() },
      },
      data: { status: OfficeInviteStatus.EXPIRED },
    });

    return this.prisma.officeInvite.findMany({
      include: { auctionHouse: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeOfficeInvite(id: string) {
    const invite = await this.prisma.officeInvite.findUnique({
      where: { id },
    });

    if (!invite) {
      throw new NotFoundException('Convite nao encontrado');
    }

    if (invite.status !== OfficeInviteStatus.PENDING) {
      throw new BadRequestException(
        'Apenas convites pendentes podem ser revogados',
      );
    }

    return this.prisma.officeInvite.update({
      where: { id },
      data: { status: OfficeInviteStatus.EXPIRED },
    });
  }

  private frontendUrl() {
    const frontendUrl =
      process.env.FRONTEND_URL?.trim() || 'http://localhost:5173';
    return frontendUrl.replace(/\/$/, '');
  }
}
