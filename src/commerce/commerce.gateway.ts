import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import type {
  BidPriceUpdatedPayload,
  LotSoldPayload,
  OfficeBidPayload,
  SaleWonPayload,
} from './commerce-events';

type CommerceActor = {
  type: 'USER' | 'AUCTION_HOUSE';
  id: string;
};

/**
 * Authenticated realtime gateway for auction commerce (RF06-RF10).
 *
 * Rooms are role-scoped so privacy is enforced by delivery, not by client
 * filtering:
 * - `auction:<id>:prices` receives only anonymous price/sold updates.
 * - `auction:<id>:office` receives detailed bids and is joined only by the
 *   auction's owner office.
 * - `user:<id>` receives the private win notification for a single buyer.
 */
@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class CommerceGateway {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  @SubscribeMessage('auction:join')
  async handleAuctionJoin(
    @MessageBody() data: { auctionId?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const auctionId = data?.auctionId;

    if (!auctionId) {
      this.emitError(client, 'Remate inexistente.');
      return;
    }

    try {
      const actor = await this.authenticateSocket(client);
      const auction = await this.prisma.auction.findUnique({
        where: { id: auctionId },
        select: { id: true, auctionHouseId: true },
      });

      if (!auction) {
        this.emitError(client, 'Remate inexistente.');
        return;
      }

      await client.join(this.priceRoom(auctionId));

      if (
        actor.type === 'AUCTION_HOUSE' &&
        actor.id === auction.auctionHouseId
      ) {
        await client.join(this.officeRoom(auctionId));
      }
    } catch (error) {
      this.emitError(client, this.resolveErrorMessage(error));
    }
  }

  @SubscribeMessage('notifications:join')
  async handleNotificationsJoin(@ConnectedSocket() client: Socket) {
    try {
      const actor = await this.authenticateSocket(client);
      await client.join(this.userRoom(actor.id));
    } catch (error) {
      this.emitError(client, this.resolveErrorMessage(error));
    }
  }

  emitBidRecorded(auctionId: string, bid: OfficeBidPayload) {
    const priceUpdate: BidPriceUpdatedPayload = {
      lotId: bid.lotId,
      amount: bid.amount,
      createdAt: bid.createdAt,
    };

    this.server.to(this.priceRoom(auctionId)).emit('bid:price-updated', priceUpdate);
    this.server.to(this.officeRoom(auctionId)).emit('bid:office-recorded', bid);
  }

  emitLotSold(auctionId: string, payload: LotSoldPayload) {
    this.server.to(this.priceRoom(auctionId)).emit('lot:sold', payload);
  }

  emitSaleWon(userId: string, payload: SaleWonPayload) {
    this.server.to(this.userRoom(userId)).emit('sale:won', payload);
  }

  private async authenticateSocket(client: Socket): Promise<CommerceActor> {
    const token = this.extractToken(client);

    if (!token) {
      throw new Error('Token de autenticação ausente.');
    }

    const payload = await this.jwtService.verifyAsync<{
      sub: string;
      actorType?: 'USER' | 'AUCTION_HOUSE';
    }>(token);

    if (payload.actorType === 'AUCTION_HOUSE') {
      const auctionHouse = await this.prisma.auctionHouse.findUnique({
        where: { id: payload.sub },
        select: { id: true },
      });

      if (!auctionHouse) {
        throw new Error('Escritório não encontrado.');
      }

      return { type: 'AUCTION_HOUSE', id: auctionHouse.id };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true },
    });

    if (!user) {
      throw new Error('Usuário não encontrado.');
    }

    return { type: 'USER', id: user.id };
  }

  private extractToken(client: Socket) {
    const authToken = client.handshake.auth?.token;

    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken;
    }

    const authorization = client.handshake.headers.authorization;

    if (typeof authorization !== 'string') {
      return undefined;
    }

    const [type, token] = authorization.split(' ');
    return type === 'Bearer' ? token : undefined;
  }

  private emitError(client: Socket, message: string) {
    client.emit('commerce:error', { message });
  }

  private resolveErrorMessage(error: unknown) {
    if (error && typeof error === 'object' && 'message' in error) {
      const message = String(error.message);
      return message || 'Não foi possível conectar ao remate.';
    }

    return 'Não foi possível conectar ao remate.';
  }

  private priceRoom(auctionId: string) {
    return `auction:${auctionId}:prices`;
  }

  private officeRoom(auctionId: string) {
    return `auction:${auctionId}:office`;
  }

  private userRoom(userId: string) {
    return `user:${userId}`;
  }
}
