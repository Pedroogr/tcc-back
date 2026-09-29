import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ActorJwtAuthGuard,
  type AuthenticatedActorRequest,
} from '../auth/actor-jwt-auth.guard';
import { CreateGestureEventDto } from './dto/create-gesture-event.dto';
import {
  GESTURE_SNAPSHOT_MAX_BYTES,
  type GestureSnapshotUpload,
} from './gesture-event-policy';
import { GestureEventsService } from './gesture-events.service';

@Controller('auctions')
export class GestureEventsController {
  constructor(private readonly gestureEventsService: GestureEventsService) {}

  @UseGuards(ActorJwtAuthGuard)
  @Post(':auctionId/gesture-events')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor('snapshot', {
      limits: { fileSize: GESTURE_SNAPSHOT_MAX_BYTES, files: 1 },
    }),
  )
  relay(
    @Req() request: AuthenticatedActorRequest,
    @Param('auctionId') auctionId: string,
    @Body() fields: CreateGestureEventDto,
    @UploadedFile() snapshot?: GestureSnapshotUpload,
  ) {
    return this.gestureEventsService.relay(
      auctionId,
      fields,
      snapshot,
      request.actor,
    );
  }
}
