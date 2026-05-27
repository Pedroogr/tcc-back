import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LotsController } from './lots.controller';
import { LotsService } from './lots.service';

@Module({
  imports: [AuthModule],
  controllers: [LotsController],
  providers: [LotsService],
})
export class LotsModule {}
