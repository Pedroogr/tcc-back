import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommerceModule } from '../commerce/commerce.module';
import { LotsController } from './lots.controller';
import { LotsService } from './lots.service';
import { BidsService } from './bids.service';

@Module({
  imports: [AuthModule, CommerceModule],
  controllers: [LotsController],
  providers: [LotsService, BidsService],
  exports: [BidsService],
})
export class LotsModule {}
