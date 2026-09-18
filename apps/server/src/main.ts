import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  // 本地原型：前端 dev 端口（5173）与 API（3000）跨域，放开 CORS 反射请求源。
  app.enableCors({ origin: true });
  await app.listen(3000, '0.0.0.0');
}

void bootstrap();