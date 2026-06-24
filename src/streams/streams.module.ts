import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StreamsController } from './streams.controller';
import { StreamsGateway } from './streams.gateway';
import { StreamsService } from './streams.service';

@Module({
  imports: [PrismaModule],
  controllers: [StreamsController],
  providers: [StreamsService, StreamsGateway],
  exports: [StreamsService, StreamsGateway],
})
export class StreamsModule {}
