import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { AppModule } from '../src/app.module.js';

describe('模型供应商设置 (e2e)', () => {
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

  it('GET 返回当前 status 与厂商预设', async () => {
    const res = await request(app.getHttpServer()).get('/settings/model').expect(200);
    expect(res.body.status.mode).toBe('mock'); // 测试环境无 AI_* env
    expect(res.body.presets.some((p: { vendor: string }) => p.vendor.includes('GLM'))).toBe(true);
  });

  it('POST 切到自定义 API 生效，缺参数返回 400', async () => {
    const ok = await request(app.getHttpServer())
      .post('/settings/model')
      .send({ mode: 'custom', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', apiKey: 'k' })
      .expect(201);
    expect(ok.body.status).toMatchObject({ mode: 'custom', model: 'glm-4-flash' });

    await request(app.getHttpServer()).post('/settings/model').send({ mode: 'custom', model: 'm' }).expect(400);

    const back = await request(app.getHttpServer()).post('/settings/model').send({ mode: 'platform' }).expect(201);
    expect(back.body.status.mode).toBe('mock');
  });

  it('POST /test：mock 模式连通性恒通过', async () => {
    await request(app.getHttpServer()).post('/settings/model').send({ mode: 'platform' }).expect(201);
    const res = await request(app.getHttpServer()).post('/settings/model/test').send({}).expect(201);
    expect(res.body).toMatchObject({ ok: true, mode: 'mock' });
    expect(typeof res.body.latencyMs).toBe('number');
  });

  it('POST /test：传入自定义候选，非法 URL 报不连通且不改运行态', async () => {
    const before = (await request(app.getHttpServer()).get('/settings/model').expect(200)).body.status.mode;
    const res = await request(app.getHttpServer())
      .post('/settings/model/test')
      .send({ mode: 'custom', baseUrl: 'not-a-valid-url', model: 'm' })
      .expect(201);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBeTruthy();
    // 运行态未被测试改动
    const after = (await request(app.getHttpServer()).get('/settings/model').expect(200)).body.status.mode;
    expect(after).toBe(before);
  });

  it('POST /test：自定义候选缺 baseUrl/model 返回 400', async () => {
    await request(app.getHttpServer()).post('/settings/model/test').send({ mode: 'custom', model: 'm' }).expect(400);
  });
});