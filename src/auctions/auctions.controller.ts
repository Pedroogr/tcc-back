import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ActorJwtAuthGuard } from '../auth/actor-jwt-auth.guard';
import type { AuthenticatedActorRequest } from '../auth/actor-jwt-auth.guard';
import { AuctionsService } from './auctions.service';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { UpdateAuctionDto } from './dto/update-auction.dto';

@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctionsService: AuctionsService) {}

  @UseGuards(ActorJwtAuthGuard)
  @Post()
  create(
    @Req() request: AuthenticatedActorRequest,
    @Body() body: CreateAuctionDto,
  ) {
    return this.auctionsService.create(body, request.actor);
  }

  @Get()
  findAll() {
    return this.auctionsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.auctionsService.findOne(id);
  }

  @UseGuards(ActorJwtAuthGuard)
  @Patch(':id')
  update(
    @Req() request: AuthenticatedActorRequest,
    @Param('id') id: string,
    @Body() body: UpdateAuctionDto,
  ) {
    return this.auctionsService.update(id, body, request.actor);
  }

  @UseGuards(ActorJwtAuthGuard)
  @Delete(':id')
  remove(@Req() request: AuthenticatedActorRequest, @Param('id') id: string) {
    return this.auctionsService.remove(id, request.actor);
  }
}
