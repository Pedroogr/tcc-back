import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommerceModule } from '../commerce/commerce.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [AuthModule, CommerceModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
