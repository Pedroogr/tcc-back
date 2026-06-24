import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import type {
  BroadcasterJoinPayload,
  StreamAnswerPayload,
  StreamIceCandidatePayload,
  StreamOfferPayload,
  ViewerJoinPayload,
} from './dto/stream-signaling.dto';
import { StreamsService } from './streams.service';

type SocketActor = {
  type: 'AUCTION_HOUSE' | 'USER';
  id: string;
};

type StreamSocketData = {
  auctionId?: string;
  auctionHouseId?: string;
  role?: 'broadcaster' | 'viewer';
};

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class StreamsGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly broadcasters = new Map<string, string>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly streamsService: StreamsService,
  ) {}

  @SubscribeMessage('stream:broadcaster-join')
  async handleBroadcasterJoin(
    @MessageBody() data: BroadcasterJoinPayload,
    @ConnectedSocket() client: Socket,
  ) {
    const auctionId = data?.auctionId;

    if (!auctionId) {
      this.emitError(client, 'Remate inexistente.');
      return;
    }

    try {
      const actor = await this.authenticateSocket(client);

      if (actor.type !== 'AUCTION_HOUSE') {
        this.emitError(
          client,
          'Apenas o escritório responsável por este remate pode iniciar a transmissão.',
        );
        return;
      }

      await this.streamsService.assertBroadcasterCanJoin(auctionId, actor.id);

      const currentBroadcasterId = this.broadcasters.get(auctionId);

      if (currentBroadcasterId && currentBroadcasterId !== client.id) {
        this.emitError(client, 'A transmissão já está em andamento.');
        return;
      }

      this.broadcasters.set(auctionId, client.id);
      client.data = {
        ...(client.data as StreamSocketData),
        auctionId,
        auctionHouseId: actor.id,
        role: 'broadcaster',
      };
      await client.join(this.roomName(auctionId));

      client.emit('stream:broadcaster-join', {
        auctionId,
        broadcasterId: client.id,
      });
      client.to(this.roomName(auctionId)).emit('stream:broadcaster-join', {
        auctionId,
        broadcasterId: client.id,
      });
    } catch (error) {
      this.emitError(client, this.resolveErrorMessage(error));
    }
  }

  @SubscribeMessage('stream:viewer-join')
  async handleViewerJoin(
    @MessageBody() data: ViewerJoinPayload,
    @ConnectedSocket() client: Socket,
  ) {
    const auctionId = data?.auctionId;

    if (!auctionId) {
      this.emitError(client, 'Remate inexistente.');
      return;
    }

    client.data = {
      ...(client.data as StreamSocketData),
      auctionId,
      role: 'viewer',
    };
    await client.join(this.roomName(auctionId));

    const broadcasterId = this.broadcasters.get(auctionId);

    if (broadcasterId) {
      this.server.to(broadcasterId).emit('stream:viewer-join', {
        auctionId,
        viewerId: client.id,
      });
    }
  }

  @SubscribeMessage('stream:offer')
  handleOffer(
    @MessageBody() data: StreamOfferPayload,
    @ConnectedSocket() client: Socket,
  ) {
    if (!this.isBroadcasterForAuction(client, data?.auctionId)) {
      this.emitError(client, 'Apenas o transmissor pode enviar oferta.');
      return;
    }

    this.server.to(data.targetId).emit('stream:offer', {
      auctionId: data.auctionId,
      broadcasterId: client.id,
      sdp: data.sdp,
    });
  }

  @SubscribeMessage('stream:answer')
  handleAnswer(
    @MessageBody() data: StreamAnswerPayload,
    @ConnectedSocket() client: Socket,
  ) {
    if (!this.isViewerForAuction(client, data?.auctionId)) {
      this.emitError(
        client,
        'Espectador não está conectado a esta transmissão.',
      );
      return;
    }

    const broadcasterId = this.broadcasters.get(data.auctionId);

    if (!broadcasterId || broadcasterId !== data.targetId) {
      this.emitError(client, 'Transmissor indisponível.');
      return;
    }

    this.server.to(broadcasterId).emit('stream:answer', {
      auctionId: data.auctionId,
      viewerId: client.id,
      sdp: data.sdp,
    });
  }

  @SubscribeMessage('stream:ice-candidate')
  handleIceCandidate(
    @MessageBody() data: StreamIceCandidatePayload,
    @ConnectedSocket() client: Socket,
  ) {
    const socketData = client.data as StreamSocketData;

    if (!data?.auctionId || socketData.auctionId !== data.auctionId) {
      this.emitError(client, 'Conexão de transmissão inválida.');
      return;
    }

    this.server.to(data.targetId).emit('stream:ice-candidate', {
      auctionId: data.auctionId,
      senderId: client.id,
      candidate: data.candidate,
    });
  }

  @SubscribeMessage('stream:ended')
  async handleStreamEnded(
    @MessageBody() data: { auctionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!this.isBroadcasterForAuction(client, data?.auctionId)) {
      this.emitError(
        client,
        'Apenas o transmissor pode encerrar a transmissão.',
      );
      return;
    }

    const socketData = client.data as StreamSocketData;

    if (socketData.auctionHouseId) {
      await this.streamsService.stopStreamForAuctionHouse(
        data.auctionId,
        socketData.auctionHouseId,
      );
    }

    this.clearBroadcaster(data.auctionId, client.id);
    this.emitStreamEnded(data.auctionId);
  }

  async handleDisconnect(client: Socket) {
    const socketData = client.data as StreamSocketData;

    if (
      socketData.role !== 'broadcaster' ||
      !socketData.auctionId ||
      !socketData.auctionHouseId
    ) {
      return;
    }

    this.clearBroadcaster(socketData.auctionId, client.id);
    const streamState = await this.streamsService
      .interruptStreamForAuctionHouse(
        socketData.auctionId,
        socketData.auctionHouseId,
      )
      .catch(() => null);

    if (streamState?.stream?.status === 'ERROR') {
      this.emitStreamInterrupted(socketData.auctionId);
    }
  }

  emitStreamEnded(auctionId: string) {
    this.server.to(this.roomName(auctionId)).emit('stream:ended', {
      auctionId,
      message: 'A transmissão foi encerrada pelo escritório.',
    });
  }

  emitStreamInterrupted(auctionId: string) {
    this.server.to(this.roomName(auctionId)).emit('stream:interrupted', {
      auctionId,
      message: 'A transmissão foi interrompida. O escritório pode retomar.',
    });
  }

  private clearBroadcaster(auctionId: string, socketId: string) {
    if (this.broadcasters.get(auctionId) === socketId) {
      this.broadcasters.delete(auctionId);
    }
  }

  private isBroadcasterForAuction(client: Socket, auctionId?: string) {
    return Boolean(
      auctionId &&
      (client.data as StreamSocketData).role === 'broadcaster' &&
      (client.data as StreamSocketData).auctionId === auctionId &&
      this.broadcasters.get(auctionId) === client.id,
    );
  }

  private isViewerForAuction(client: Socket, auctionId?: string) {
    return Boolean(
      auctionId &&
      (client.data as StreamSocketData).role === 'viewer' &&
      (client.data as StreamSocketData).auctionId === auctionId,
    );
  }

  private async authenticateSocket(client: Socket): Promise<SocketActor> {
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
    client.emit('stream:error', { message });
  }

  private resolveErrorMessage(error: unknown) {
    if (error && typeof error === 'object' && 'message' in error) {
      const message = String(error.message);
      return message || 'Não foi possível conectar à transmissão.';
    }

    return 'Não foi possível conectar à transmissão.';
  }

  private roomName(auctionId: string) {
    return `auction:${auctionId}`;
  }
}
