import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuctionsModule } from './auctions/auctions.module';
import { AuthModule } from './auth/auth.module';
import { LotsModule } from './lots/lots.module';
import { LiveModule } from './live/live.module';
import { AuctionHousesModule } from './auction-houses/auction-houses.module';
import { StreamsModule } from './streams/streams.module';
import { AdminModule } from './admin/admin.module';
import { CommerceModule } from './commerce/commerce.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    AuctionsModule,
    AuctionHousesModule,
    LotsModule,
    LiveModule,
    StreamsModule,
    AdminModule,
    CommerceModule,
  ],
})
export class AppModule {}
