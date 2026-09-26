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

/** 便捷：走完一个可作答/可结束的面试（自选是否保留录音、模式），返回 interviewId 与首个阶段 turnId。 */
async function setupInterview(app: NestFastifyApplication, keepAudio?: boolean, kind: 'coach' | 'mock' = 'coach') {
  const resume = await request(app.getHttpServer()).post('/resumes').send({ text: '三年 Java 后端。' }).expect(201);
  const created = await request(app.getHttpServer())
    .post('/interviews')
    .send({ resumeId: resume.body.resume.id, targetRole: 'Java 后端', level: 'mid', kind, keepAudio })
    .expect(201);
  const interviewId = created.body.interview.id;
  await request(app.getHttpServer()).post(`/interviews/${interviewId}/analyze`).expect(201);
  await request(app.getHttpServer()).post(`/interviews/${interviewId}/directions`).send({}).expect(201);
  await request(app.getHttpServer()).post(`/interviews/${interviewId}/outline`).expect(201);
  await request(app.getHttpServer()).post(`/interviews/${interviewId}/start`).expect(201);
  const t = await request(app.getHttpServer()).post(`/interviews/${interviewId}/turns`).send({ phase: 'tech' }).expect(201);
  return { interviewId, turnId: t.body.turn.id as string };
}

/** 录音保留策略：默认 session 即删，显式 keepAudio 才保留（api-spec 4.4）。 */
describe('录音保留策略 (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(() => app.close());

  const uploadAudio = (name: string) =>
    request(app.getHttpServer()).post('/files/audio').send({ data: Buffer.from(name).toString('base64'), mime: 'audio/webm' });

  it('默认在会话结束时删除本场录音', async () => {
    const { interviewId, turnId } = await setupInterview(app);
    const up = await uploadAudio('default-discard').expect(201);
    await request(app.getHttpServer()).post(`/interviews/${interviewId}/turns/${turnId}/answer`).send({ audioRef: up.body.ref }).expect(201);
    // 结束前可回取
    await request(app.getHttpServer()).get(`/files/audio/${up.body.ref}`).expect(200);
    await request(app.getHttpServer()).post(`/interviews/${interviewId}/finish`).expect(201);
    // 结束后默认删除 → 404
    await request(app.getHttpServer()).get(`/files/audio/${up.body.ref}`).expect(404);
  });

  it('显式 keepAudio 时会话结束保留录音', async () => {
    const { interviewId, turnId } = await setupInterview(app, true);
    const up = await uploadAudio('keep-retain').expect(201);
    await request(app.getHttpServer()).post(`/interviews/${interviewId}/turns/${turnId}/answer`).send({ audioRef: up.body.ref }).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${interviewId}/finish`).expect(201);
    // 结束后仍可回取
    await request(app.getHttpServer()).get(`/files/audio/${up.body.ref}`).expect(200);
  });

  it('模拟模式默认也会话结束删除录音', async () => {
    const { interviewId, turnId } = await setupInterview(app, false, 'mock');
    const up = await uploadAudio('mock-discard').expect(201);
    await request(app.getHttpServer()).post(`/interviews/${interviewId}/turns/${turnId}/answer`).send({ audioRef: up.body.ref }).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${interviewId}/finish`).expect(201);
    await request(app.getHttpServer()).get(`/files/audio/${up.body.ref}`).expect(404);
  });

  it('删除面试时一并清理未保留的录音', async () => {
    const { interviewId, turnId } = await setupInterview(app);
    const up = await uploadAudio('delete-cleanup').expect(201);
    await request(app.getHttpServer()).post(`/interviews/${interviewId}/turns/${turnId}/answer`).send({ audioRef: up.body.ref }).expect(201);
    await request(app.getHttpServer()).delete(`/interviews/${interviewId}`).expect(200);
    await request(app.getHttpServer()).get(`/files/audio/${up.body.ref}`).expect(404);
  });

  it('删除面试时即使 keepAudio 也清理录音（删除即弃，避免无主音频泄漏）', async () => {
    const { interviewId, turnId } = await setupInterview(app, true);
    const up = await uploadAudio('delete-even-kept').expect(201);
    await request(app.getHttpServer()).post(`/interviews/${interviewId}/turns/${turnId}/answer`).send({ audioRef: up.body.ref }).expect(201);
    // 保留偏好下结束本可回取
    await request(app.getHttpServer()).get(`/files/audio/${up.body.ref}`).expect(200);
    await request(app.getHttpServer()).delete(`/interviews/${interviewId}`).expect(200);
    // 记录删除后音频一并清理
    await request(app.getHttpServer()).get(`/files/audio/${up.body.ref}`).expect(404);
  });

  it('孤立录音（上传后未作答）在新面试创建时被清扫', async () => {
    const up = await uploadAudio('orphan-sweep').expect(201);
    await request(app.getHttpServer()).get(`/files/audio/${up.body.ref}`).expect(200);
    // 创建一个新面试触发清扫 → 未附着的孤立音频被回收
    const resume = await request(app.getHttpServer()).post('/resumes').send({ text: '三年 Java 后端。' }).expect(201);
    await request(app.getHttpServer())
      .post('/interviews')
      .send({ resumeId: resume.body.resume.id, targetRole: 'Java 后端', level: 'mid', kind: 'coach' })
      .expect(201);
    await request(app.getHttpServer()).get(`/files/audio/${up.body.ref}`).expect(404);
  });

  it('已附着到作答的录音不会被清扫（仍在进行的场次）', async () => {
    const { interviewId, turnId } = await setupInterview(app);
    const up = await uploadAudio('attached-kept').expect(201);
    await request(app.getHttpServer()).post(`/interviews/${interviewId}/turns/${turnId}/answer`).send({ audioRef: up.body.ref }).expect(201);
    // 再建一个新面试触发清扫 → 已附着的不受影响
    const resume = await request(app.getHttpServer()).post('/resumes').send({ text: '三年 Java 后端。' }).expect(201);
    await request(app.getHttpServer())
      .post('/interviews')
      .send({ resumeId: resume.body.resume.id, targetRole: 'Java 后端', level: 'mid', kind: 'coach' })
      .expect(201);
    await request(app.getHttpServer()).get(`/files/audio/${up.body.ref}`).expect(200);
  });
});