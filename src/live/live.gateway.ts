import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class LiveGateway {
  @WebSocketServer()
  server!: Server;

  @SubscribeMessage('join-room')
  handleJoinRoom(
    @MessageBody() data: { room: string; role: 'transmitter' | 'viewer' },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(data.room);

    if (data.role === 'viewer') {
      client.to(data.room).emit('viewer-ready');
    }

    if (data.role === 'transmitter') {
      client.to(data.room).emit('transmitter-ready');
    }
  }

  @SubscribeMessage('offer')
  handleOffer(
    @MessageBody() data: { room: string; sdp: RTCSessionDescriptionInit },
    @ConnectedSocket() client: Socket,
  ) {
    client.to(data.room).emit('offer', data.sdp);
  }

  @SubscribeMessage('answer')
  handleAnswer(
    @MessageBody() data: { room: string; sdp: RTCSessionDescriptionInit },
    @ConnectedSocket() client: Socket,
  ) {
    client.to(data.room).emit('answer', data.sdp);
  }

  @SubscribeMessage('ice-candidate')
  handleIceCandidate(
    @MessageBody() data: { room: string; candidate: RTCIceCandidateInit },
    @ConnectedSocket() client: Socket,
  ) {
    client.to(data.room).emit('ice-candidate', data.candidate);
  }
}