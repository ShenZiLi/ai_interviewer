import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  await app.register(import('@fastify/cors'), {
    origin: process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173',
  });
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
bootstrap();
