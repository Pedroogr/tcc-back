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
import { CreateLotDto } from './dto/create-lot.dto';
import { UpdateLotDto } from './dto/update-lot.dto';
import { LotsService } from './lots.service';

@Controller('lots')
export class LotsController {
  constructor(private readonly lotsService: LotsService) {}

  @UseGuards(ActorJwtAuthGuard)
  @Post()
  create(
    @Req() request: AuthenticatedActorRequest,
    @Body() body: CreateLotDto,
  ) {
    return this.lotsService.create(body, request.actor);
  }

  @Get()
  findAll() {
    return this.lotsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.lotsService.findOne(id);
  }

  @UseGuards(ActorJwtAuthGuard)
  @Patch(':id')
  update(
    @Req() request: AuthenticatedActorRequest,
    @Param('id') id: string,
    @Body() body: UpdateLotDto,
  ) {
    return this.lotsService.update(id, body, request.actor);
  }

  @UseGuards(ActorJwtAuthGuard)
  @Delete(':id')
  remove(@Req() request: AuthenticatedActorRequest, @Param('id') id: string) {
    return this.lotsService.remove(id, request.actor);
  }
}
