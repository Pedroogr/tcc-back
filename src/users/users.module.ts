import { Module } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SystemAdminGuard } from '../auth/system-admin.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UserAccessService } from './user-access.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, JwtAuthGuard, SystemAdminGuard, UserAccessService],
  exports: [UsersService],
})
export class UsersModule {}
