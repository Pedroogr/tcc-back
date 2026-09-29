import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommerceModule } from '../commerce/commerce.module';
import { GestureEventPolicy } from './gesture-event-policy';
import { GestureEventsController } from './gesture-events.controller';
import { GestureEventsService } from './gesture-events.service';

@Module({
  imports: [AuthModule, CommerceModule],
  controllers: [GestureEventsController],
  providers: [GestureEventPolicy, GestureEventsService],
})
export class GestureModule {}
