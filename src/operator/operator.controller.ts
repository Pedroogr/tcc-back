import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ActorJwtAuthGuard } from '../auth/actor-jwt-auth.guard';
import type { AuthenticatedActorRequest } from '../auth/actor-jwt-auth.guard';
import { CreateOperatorAccessDto } from './dto/create-operator-access.dto';
import { CreateOperatorBidDto } from './dto/create-operator-bid.dto';
import { OperatorLoginDto } from './dto/operator-login.dto';
import { SearchOperatorBuyersDto } from './dto/search-operator-buyers.dto';
import { OperatorAuthGuard } from './operator-auth.guard';
import type { OperatorRequest } from './operator-auth.guard';
import { OperatorService } from './operator.service';

@Controller('operator')
export class OperatorController {
  constructor(private readonly operatorService: OperatorService) {}

  @UseGuards(ActorJwtAuthGuard)
  @Post('accesses')
  createAccess(
    @Req() request: AuthenticatedActorRequest,
    @Body() body: CreateOperatorAccessDto,
  ) {
    return this.operatorService.createAccess(body, request.actor);
  }

  @UseGuards(ActorJwtAuthGuard)
  @Get('accesses')
  listAccesses(
    @Req() request: AuthenticatedActorRequest,
    @Query('auctionId') auctionId?: string,
  ) {
    return this.operatorService.listAccesses(auctionId, request.actor);
  }

  @UseGuards(ActorJwtAuthGuard)
  @Delete('accesses/:id')
  revokeAccess(
    @Req() request: AuthenticatedActorRequest,
    @Param('id') id: string,
  ) {
    return this.operatorService.revokeAccess(id, request.actor);
  }

  @Post('login')
  login(@Body() body: OperatorLoginDto, @Req() request: Request) {
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    return this.operatorService.login(body.code, ip);
  }

  @UseGuards(OperatorAuthGuard)
  @Get('session')
  session(@Req() request: OperatorRequest) {
    return this.operatorService.getSession(request.operatorActor);
  }

  @UseGuards(OperatorAuthGuard)
  @Get('buyers')
  searchBuyers(
    @Req() request: OperatorRequest,
    @Query() query: SearchOperatorBuyersDto,
  ) {
    return this.operatorService.searchBuyers(request.operatorActor, query);
  }

  @UseGuards(OperatorAuthGuard)
  @Post('bids')
  createBid(
    @Req() request: OperatorRequest,
    @Body() body: CreateOperatorBidDto,
  ) {
    return this.operatorService.createBid(request.operatorActor, body);
  }
}
