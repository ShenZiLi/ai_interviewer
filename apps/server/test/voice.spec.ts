import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { AppModule } from '../src/app.module.js';

/** 语音链路（TTS/ASR，Mock 网关）e2e。 */
describe('语音链路：TTS 出题 + ASR 转写作答 (e2e)', () => {
  let app: NestFastifyApplication;
  let interviewId = '';
  let turnId = '';

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const resume = await request(app.getHttpServer()).post('/resumes').send({ text: '三年 Java 后端。' }).expect(201);
    const created = await request(app.getHttpServer())
      .post('/interviews')
      .send({ resumeId: resume.body.resume.id, targetRole: 'Java 后端', level: 'mid', kind: 'coach' })
      .expect(201);
    interviewId = created.body.interview.id;
    await request(app.getHttpServer()).post(`/interviews/${interviewId}/analyze`).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${interviewId}/directions`).send({}).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${interviewId}/outline`).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${interviewId}/start`).expect(201);
  });
  afterAll(() => app.close());

  it('出题返回 TTS 音频引用', async () => {
    const t = await request(app.getHttpServer()).post(`/interviews/${interviewId}/turns`).send({ phase: 'tech' }).expect(201);
    turnId = t.body.turn.id;
    expect(t.body.turn.ttsRef).toBeTruthy();
  });

  it('提交音频（无转写文本）→ 服务端 ASR 转写后评价', async () => {
    const res = await request(app.getHttpServer())
      .post(`/interviews/${interviewId}/turns/${turnId}/answer`)
      .send({ audioRef: 'file://mock-record', stage: 'first' })
      .expect(201);
    expect(res.body.evaluation).toBeDefined();
    // Mock ASR 返回固定转写文本，断言落库被转写文本填充
    const got = await request(app.getHttpServer()).get(`/interviews/${interviewId}`).expect(200);
    const attempt = got.body.interview.turns.find((x: { id: string }) => x.id === turnId).attempts[0];
    expect(attempt.transcript.length).toBeGreaterThan(0);
  });

  it('无转写也无音频 → 409', async () => {
    const t = await request(app.getHttpServer()).post(`/interviews/${interviewId}/turns`).send({ phase: 'tech' }).expect(201);
    await request(app.getHttpServer())
      .post(`/interviews/${interviewId}/turns/${t.body.turn.id}/answer`)
      .send({})
      .expect(409);
  });
});