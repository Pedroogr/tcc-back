import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ActorJwtAuthGuard } from '../auth/actor-jwt-auth.guard';
import type { AuthenticatedActorRequest } from '../auth/actor-jwt-auth.guard';
import { AuctionsService } from './auctions.service';
import { CreateBuyerRegistrationDto } from './dto/create-buyer-registration.dto';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { ReviewBuyerRegistrationDto } from './dto/review-buyer-registration.dto';
import { UpdateAuctionDto } from './dto/update-auction.dto';

export type AuctionThumbnailUpload = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

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

  @Get('public')
  findPublic() {
    return this.auctionsService.findPublic();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.auctionsService.findOne(id);
  }

  @UseGuards(ActorJwtAuthGuard)
  @Post(':id/buyer-registrations')
  registerBuyer(
    @Req() request: AuthenticatedActorRequest,
    @Param('id') id: string,
    @Body() body: CreateBuyerRegistrationDto,
  ) {
    return this.auctionsService.registerBuyer(id, body, request.actor);
  }

  @UseGuards(ActorJwtAuthGuard)
  @Get(':id/buyer-registrations')
  findBuyerRegistrations(
    @Req() request: AuthenticatedActorRequest,
    @Param('id') id: string,
  ) {
    return this.auctionsService.findBuyerRegistrations(id, request.actor);
  }

  @UseGuards(ActorJwtAuthGuard)
  @Patch(':id/buyer-registrations/:registrationId')
  reviewBuyerRegistration(
    @Req() request: AuthenticatedActorRequest,
    @Param('id') id: string,
    @Param('registrationId') registrationId: string,
    @Body() body: ReviewBuyerRegistrationDto,
  ) {
    return this.auctionsService.reviewBuyerRegistration(
      id,
      registrationId,
      body,
      request.actor,
    );
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
  @Post(':id/thumbnail')
  @UseInterceptors(FileInterceptor('thumbnail'))
  uploadThumbnail(
    @Req() request: AuthenticatedActorRequest,
    @Param('id') id: string,
    @UploadedFile() file?: AuctionThumbnailUpload,
  ) {
    return this.auctionsService.uploadThumbnail(id, file, request.actor);
  }

  @UseGuards(ActorJwtAuthGuard)
  @Delete(':id/thumbnail')
  removeThumbnail(
    @Req() request: AuthenticatedActorRequest,
    @Param('id') id: string,
  ) {
    return this.auctionsService.removeThumbnail(id, request.actor);
  }

  @UseGuards(ActorJwtAuthGuard)
  @Delete(':id')
  remove(@Req() request: AuthenticatedActorRequest, @Param('id') id: string) {
    return this.auctionsService.remove(id, request.actor);
  }
}
