import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ActorJwtAuthGuard } from '../auth/actor-jwt-auth.guard';
import type { AuthenticatedActorRequest } from '../auth/actor-jwt-auth.guard';
import { StreamsGateway } from './streams.gateway';
import { StreamsService } from './streams.service';

@UseGuards(ActorJwtAuthGuard)
@Controller('auctions/:auctionId/stream')
export class StreamsController {
  constructor(
    private readonly streamsService: StreamsService,
    private readonly streamsGateway: StreamsGateway,
  ) {}

  @Get()
  findOne(
    @Param('auctionId') auctionId: string,
    @Req() request: AuthenticatedActorRequest,
  ) {
    return this.streamsService.getAuctionStream(auctionId, request.actor);
  }

  @Post('start')
  start(
    @Param('auctionId') auctionId: string,
    @Req() request: AuthenticatedActorRequest,
  ) {
    return this.streamsService.startStream(auctionId, request.actor);
  }

  @Post('stop')
  async stop(
    @Param('auctionId') auctionId: string,
    @Req() request: AuthenticatedActorRequest,
  ) {
    const stream = await this.streamsService.stopStream(
      auctionId,
      request.actor,
    );
    this.streamsGateway.emitStreamEnded(auctionId);
    return stream;
  }
}
