import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LotsModule } from '../lots/lots.module';
import { OperatorAuthGuard } from './operator-auth.guard';
import { OperatorController } from './operator.controller';
import { OperatorLoginRateLimiter } from './operator-login-rate-limiter';
import { OperatorService } from './operator.service';

@Module({
  imports: [AuthModule, LotsModule],
  controllers: [OperatorController],
  providers: [OperatorService, OperatorAuthGuard, OperatorLoginRateLimiter],
  exports: [OperatorAuthGuard, OperatorService],
})
export class OperatorModule {}
