import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { AppModule } from '../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health → ok', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /grade?score=90 → A+', async () => {
    const res = await request(app.getHttpServer()).get('/grade?score=90').expect(200);
    expect(res.body).toEqual({ score: 90, grade: 'A+' });
  });

  it('GET /grade?score=abc → 400', async () => {
    await request(app.getHttpServer()).get('/grade').expect(400);
  });
});