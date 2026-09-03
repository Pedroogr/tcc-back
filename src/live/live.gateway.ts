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
    void client.join(data.room);

    if (data.role === 'viewer') {
      client.to(data.room).emit('viewer-ready', {
        viewerId: client.id,
      });
    }

    if (data.role === 'transmitter') {
      client.to(data.room).emit('transmitter-ready', {
        transmitterId: client.id,
      });
    }
  }

  @SubscribeMessage('offer')
  handleOffer(
    @MessageBody()
    data: {
      targetId: string;
      senderId: string;
      sdp: RTCSessionDescriptionInit;
    },
  ) {
    this.server.to(data.targetId).emit('offer', {
      senderId: data.senderId,
      sdp: data.sdp,
    });
  }

  @SubscribeMessage('answer')
  handleAnswer(
    @MessageBody()
    data: {
      targetId: string;
      senderId: string;
      sdp: RTCSessionDescriptionInit;
    },
  ) {
    this.server.to(data.targetId).emit('answer', {
      senderId: data.senderId,
      sdp: data.sdp,
    });
  }

  @SubscribeMessage('ice-candidate')
  handleIceCandidate(
    @MessageBody()
    data: {
      targetId: string;
      senderId: string;
      candidate: RTCIceCandidateInit;
    },
  ) {
    this.server.to(data.targetId).emit('ice-candidate', {
      senderId: data.senderId,
      candidate: data.candidate,
    });
  }
}
