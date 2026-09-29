import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuctionStatus } from '../../generated/prisma/enums';
import type { AuthenticatedActor } from '../auth/actor-jwt-auth.guard';
import { CommerceGateway } from '../commerce/commerce.gateway';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateGestureEventDto } from './dto/create-gesture-event.dto';
import {
  GESTURE_EVENT_DISPLAY_MS,
  GestureEventPolicy,
  type GestureSnapshotUpload,
} from './gesture-event-policy';

const CLOSED_AUCTION_STATUSES: AuctionStatus[] = [
  AuctionStatus.FINISHED,
  AuctionStatus.CANCELED,
];

@Injectable()
export class GestureEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: GestureEventPolicy,
    private readonly commerceGateway: CommerceGateway,
  ) {}

  async relay(
    auctionId: string,
    fields: CreateGestureEventDto,
    snapshot: GestureSnapshotUpload | undefined,
    actor: AuthenticatedActor,
    now = new Date(),
  ) {
    if (actor.type !== 'AUCTION_HOUSE') {
      throw new ForbiddenException(
        'Apenas escritorios podem enviar eventos de gesto.',
      );
    }

    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      select: { id: true, auctionHouseId: true, status: true },
    });
    if (!auction) {
      throw new NotFoundException('Leilao nao encontrado');
    }
    if (auction.auctionHouseId !== actor.auctionHouse.id) {
      throw new ForbiddenException(
        'Escritorio nao pode enviar gestos para outro remate.',
      );
    }
    if (CLOSED_AUCTION_STATUSES.includes(auction.status)) {
      throw new BadRequestException(
        'Nao e possivel enviar gestos para um remate encerrado.',
      );
    }

    const acceptedAt = now.getTime();
    const event = this.policy.validate({ ...fields, snapshot }, acceptedAt);
    this.policy.reserve(auctionId, event.eventId, acceptedAt);
    const expiresAt = new Date(acceptedAt + GESTURE_EVENT_DISPLAY_MS);

    this.commerceGateway.emitGestureFirstHandDetected(auctionId, {
      eventId: event.eventId,
      auctionId,
      capturedAt: event.capturedAt,
      expiresAt,
      personBox: event.personBox,
      snapshotMimeType: 'image/jpeg',
      snapshot: event.snapshot,
    });

    return { eventId: event.eventId, expiresAt };
  }
}
