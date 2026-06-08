import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuctionHousesController } from './auction-houses.controller';
import { AuctionHousesService } from './auction-houses.service';

@Module({
  imports: [AuthModule],
  controllers: [AuctionHousesController],
  providers: [AuctionHousesService],
})
export class AuctionHousesModule {}
