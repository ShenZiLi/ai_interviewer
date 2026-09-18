import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { AppModule } from '../src/app.module.js';

describe('MVP 面试全流程 (e2e, mock provider)', () => {
  let app: NestFastifyApplication;
  let resumeId = '';
  let interviewId = '';
  let turnId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('AC1: 创建简历并解析 (P01)', async () => {
    const res = await request(app.getHttpServer())
      .post('/resumes')
      .send({ title: '林同学', text: '三年 Java 后端，负责订单与库存扣减。' })
      .expect(201);
    resumeId = res.body.resume.id;
    expect(res.body.resume.status).toBe('parsed');
    expect(res.body.resume.analysis.summary).toBeTruthy();
  });

  it('AC2: 创建面试 + 岗位分析 P02 + 方向 P03 + 大纲 P04', async () => {
    const created = await request(app.getHttpServer())
      .post('/interviews')
      .send({ resumeId, targetRole: 'Java 后端工程师', level: 'mid', kind: 'coach', durationTier: '30m' })
      .expect(201);
    interviewId = created.body.interview.id;

    await request(app.getHttpServer()).post(`/interviews/${interviewId}/analyze`).expect(201);

    const dirs = await request(app.getHttpServer())
      .post(`/interviews/${interviewId}/directions`)
      .send({})
      .expect(201);
    expect(dirs.body.recommendedDirections.recommendedDirections.length).toBeGreaterThanOrEqual(2);

    const outline = await request(app.getHttpServer()).post(`/interviews/${interviewId}/outline`).expect(201);
    expect(outline.body.outline.outline.length).toBeGreaterThanOrEqual(1);
  });

  it('AC3: 开始面试 + 生成主问题 P06', async () => {
    await request(app.getHttpServer()).post(`/interviews/${interviewId}/start`).expect(201);
    const turn = await request(app.getHttpServer())
      .post(`/interviews/${interviewId}/turns`)
      .send({ phase: 'tech' })
      .expect(201);
    turnId = turn.body.turn.id;
    expect(turn.body.turn.question).toBeTruthy();
  });

  it('AC4: 作答 → 陪练返回评价 P07 + 追问 P08', async () => {
    const res = await request(app.getHttpServer())
      .post(`/interviews/${interviewId}/turns/${turnId}/answer`)
      .send({ transcript: '我会考虑使用分布式锁并做好幂等。', stage: 'first' })
      .expect(201);
    expect(res.body.evaluation.score).toBeTypeOf('number');
    expect(res.body.evaluation.dims.length).toBeGreaterThanOrEqual(1);
    expect(res.body.next).toBeDefined();
  });

  it('AC5: 自我介绍后大纲调整（陪练需 confirm）', async () => {
    const res = await request(app.getHttpServer())
      .post(`/interviews/${interviewId}/outline/adjust`)
      .send({ confirm: true })
      .expect(201);
    expect(res.body.adjustment.mode).toBe('auto');
  });

  it('AC6: 整场报告 P10', async () => {
    const res = await request(app.getHttpServer()).post(`/interviews/${interviewId}/finish`).expect(201);
    expect(res.body.report.overview.completedAnswers).toBeGreaterThanOrEqual(0);
    expect(res.body.report.dimensionReport.length).toBeGreaterThanOrEqual(1);
  });

  it('AC7: 状态机防护——结束后作答返回 409', async () => {
    await request(app.getHttpServer())
      .post(`/interviews/${interviewId}/turns/${turnId}/answer`)
      .send({ transcript: 'x' })
      .expect(409);
  });

  it('模式隔离：模拟面试作答仅记录，不返回即时评价', async () => {
    const created = await request(app.getHttpServer())
      .post('/interviews')
      .send({ resumeId, targetRole: 'Java 后端', level: 'mid', kind: 'mock', durationTier: '30m' })
      .expect(201);
    const mid = created.body.interview.id;
    await request(app.getHttpServer()).post(`/interviews/${mid}/analyze`).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${mid}/directions`).send({}).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${mid}/outline`).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${mid}/start`).expect(201);
    const t = await request(app.getHttpServer()).post(`/interviews/${mid}/turns`).send({ phase: 'tech' }).expect(201);
    const res = await request(app.getHttpServer())
      .post(`/interviews/${mid}/turns/${t.body.turn.id}/answer`)
      .send({ transcript: '只记录不反馈。', stage: 'first' })
      .expect(201);
    expect(res.body).toEqual({ recorded: true });
  });
});