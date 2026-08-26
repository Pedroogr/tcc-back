import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { Server } from 'node:http';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

export type E2eContext = {
  app: INestApplication;
  prisma: PrismaService;
  httpServer: Server;
  baseUrl: string;
};

export async function createE2eApp(): Promise<E2eContext> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  });
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(0, '127.0.0.1');

  const httpServer = app.getHttpServer();
  const address = httpServer.address();

  if (!address || typeof address === 'string') {
    await app.close();
    throw new Error('E2E HTTP server did not bind to a TCP port');
  }

  return {
    app,
    prisma: app.get(PrismaService),
    httpServer,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}
