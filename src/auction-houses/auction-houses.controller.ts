import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ActorJwtAuthGuard } from '../auth/actor-jwt-auth.guard';
import type { AuthenticatedActorRequest } from '../auth/actor-jwt-auth.guard';
import { CreateBuyerRegistrationDto } from '../auctions/dto/create-buyer-registration.dto';
import { ReviewBuyerRegistrationDto } from '../auctions/dto/review-buyer-registration.dto';
import { AuctionHousesService } from './auction-houses.service';
import { RegisterAuctionHouseInviteDto } from './dto/register-auction-house-invite.dto';

@Controller('auction-houses')
export class AuctionHousesController {
  constructor(private readonly auctionHousesService: AuctionHousesService) {}

  @Get()
  findAll() {
    return this.auctionHousesService.findAll();
  }

  @Get('invites/:token')
  findInvite(@Param('token') token: string) {
    return this.auctionHousesService.findInvite(token);
  }

  @Post('invites/:token/register')
  registerWithInvite(
    @Param('token') token: string,
    @Body() body: RegisterAuctionHouseInviteDto,
  ) {
    return this.auctionHousesService.registerWithInvite(token, body);
  }

  @UseGuards(ActorJwtAuthGuard)
  @Get('me/buyer-registrations')
  findMyBuyerRegistrations(@Req() request: AuthenticatedActorRequest) {
    return this.auctionHousesService.findMyBuyerRegistrations(request.actor);
  }

  @UseGuards(ActorJwtAuthGuard)
  @Get(':id/buyer-registrations/me')
  findMyRegistration(
    @Req() request: AuthenticatedActorRequest,
    @Param('id') id: string,
  ) {
    return this.auctionHousesService.findMyRegistration(id, request.actor);
  }

  @UseGuards(ActorJwtAuthGuard)
  @Patch('me/buyer-registrations/:registrationId')
  reviewMyBuyerRegistration(
    @Req() request: AuthenticatedActorRequest,
    @Param('registrationId') registrationId: string,
    @Body() body: ReviewBuyerRegistrationDto,
  ) {
    return this.auctionHousesService.reviewMyBuyerRegistration(
      registrationId,
      body,
      request.actor,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.auctionHousesService.findOne(id);
  }

  @UseGuards(ActorJwtAuthGuard)
  @Post(':id/buyer-registrations')
  registerBuyer(
    @Req() request: AuthenticatedActorRequest,
    @Param('id') id: string,
    @Body() body: CreateBuyerRegistrationDto,
  ) {
    return this.auctionHousesService.registerBuyer(id, body, request.actor);
  }
}
