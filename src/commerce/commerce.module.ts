import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CommerceGateway } from './commerce.gateway';

@Module({
  imports: [PrismaModule],
  providers: [CommerceGateway],
  exports: [CommerceGateway],
})
export class CommerceModule {}
