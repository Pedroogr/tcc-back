import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ActorJwtAuthGuard } from '../auth/actor-jwt-auth.guard';
import type { AuthenticatedActorRequest } from '../auth/actor-jwt-auth.guard';
import { CreateSaleDto } from './dto/create-sale.dto';
import { SalesService } from './sales.service';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @UseGuards(ActorJwtAuthGuard)
  @Post()
  create(
    @Req() request: AuthenticatedActorRequest,
    @Body() body: CreateSaleDto,
  ) {
    return this.salesService.create(body, request.actor);
  }

  @UseGuards(ActorJwtAuthGuard)
  @Get()
  findForAuctionHouse(@Req() request: AuthenticatedActorRequest) {
    return this.salesService.findForAuctionHouse(request.actor);
  }

  @UseGuards(ActorJwtAuthGuard)
  @Get('me')
  findMyWins(@Req() request: AuthenticatedActorRequest) {
    return this.salesService.findWonByUser(request.actor);
  }

  @UseGuards(ActorJwtAuthGuard)
  @Get('sold')
  findMySales(@Req() request: AuthenticatedActorRequest) {
    return this.salesService.findSoldBySeller(request.actor);
  }
}
