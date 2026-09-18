import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { AppModule } from '../src/app.module.js';

/** 音频上传 + 上传后以 audioRef 作答的闭环（api-spec 4.2 / 4.1）。 */
describe('音频上传闭环 (e2e)', () => {
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
    const t = await request(app.getHttpServer()).post(`/interviews/${interviewId}/turns`).send({ phase: 'tech' }).expect(201);
    turnId = t.body.turn.id;
  });
  afterAll(() => app.close());

  it('上传音频返回 ref，可回取', async () => {
    const up = await request(app.getHttpServer())
      .post('/files/audio')
      .send({ data: Buffer.from('fake-webm-bytes').toString('base64'), mime: 'audio/webm' })
      .expect(201);
    expect(up.body.ref).toMatch(/^audio:/);
    expect(up.body.bytes).toBeGreaterThan(0);
    const got = await request(app.getHttpServer()).get(`/files/audio/${up.body.ref}`).expect(200);
    expect(got.body.toString()).toBe('fake-webm-bytes');
  });

  it('上传的 audioRef 直接用于作答（ASR 闭环）', async () => {
    const up = await request(app.getHttpServer())
      .post('/files/audio')
      .send({ data: Buffer.from('real-recording').toString('base64'), mime: 'audio/webm' })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post(`/interviews/${interviewId}/turns/${turnId}/answer`)
      .send({ audioRef: up.body.ref, stage: 'first' })
      .expect(201);
    expect(res.body.evaluation).toBeDefined();
  });

  it('空音频 400', async () => {
    await request(app.getHttpServer()).post('/files/audio').send({ data: '' }).expect(400);
  });

  it('不存在的音频 404', async () => {
    await request(app.getHttpServer()).get('/files/audio/audio:nope').expect(404);
  });
});