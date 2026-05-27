import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ActorJwtAuthGuard } from './actor-jwt-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
      signOptions: {
        expiresIn: '7d',
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, ActorJwtAuthGuard, JwtAuthGuard],
  exports: [ActorJwtAuthGuard, JwtAuthGuard],
})
export class AuthModule {}
