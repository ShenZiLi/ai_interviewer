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

  it('重答：after_hint 独立记录，与首次并列', async () => {
    const created = await request(app.getHttpServer())
      .post('/interviews')
      .send({ resumeId, targetRole: 'Java 后端', level: 'mid', kind: 'coach', durationTier: '30m' })
      .expect(201);
    const mid = created.body.interview.id;
    await request(app.getHttpServer()).post(`/interviews/${mid}/analyze`).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${mid}/directions`).send({}).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${mid}/outline`).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${mid}/start`).expect(201);
    const t = await request(app.getHttpServer()).post(`/interviews/${mid}/turns`).send({ phase: 'tech' }).expect(201);

    await request(app.getHttpServer())
      .post(`/interviews/${mid}/turns/${t.body.turn.id}/answer`)
      .send({ transcript: '首次回答', stage: 'first' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/interviews/${mid}/turns/${t.body.turn.id}/answer`)
      .send({ transcript: '重答（得到提示后）', stage: 'after_hint' })
      .expect(201);

    const got = await request(app.getHttpServer()).get(`/interviews/${mid}`).expect(200);
    const attempts = got.body.interview.turns.find((x: { id: string }) => x.id === t.body.turn.id).attempts;
    expect(attempts.length).toBe(2);
    expect(attempts.map((a: { stage: string }) => a.stage)).toEqual(['first', 'after_hint']);
  });

  it('单轮辅导优化（P09）基于末次作答返回示范', async () => {
    const created = await request(app.getHttpServer()).post('/interviews').send({ resumeId, targetRole: 'Java 后端', level: 'mid', kind: 'coach' }).expect(201);
    const id = created.body.interview.id;
    await request(app.getHttpServer()).post(`/interviews/${id}/analyze`).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${id}/directions`).send({}).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${id}/outline`).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${id}/start`).expect(201);
    const t = await request(app.getHttpServer()).post(`/interviews/${id}/turns`).send({ phase: 'tech' }).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${id}/turns/${t.body.turn.id}/answer`).send({ transcript: '先讲结论再讲约束。', stage: 'first' }).expect(201);
    const c = await request(app.getHttpServer()).post(`/interviews/${id}/turns/${t.body.turn.id}/coaching`).expect(201);
    expect(c.body.coaching.modelAnswer.summary).toBeTruthy();
    expect(c.body.coaching.modelAnswer.structure.length).toBeGreaterThanOrEqual(1);
  });

  it('开考时间戳 startedAt 在 start 时记录（时长预算起点），重复 start 幂等', async () => {
    const created = await request(app.getHttpServer()).post('/interviews').send({ resumeId, targetRole: 'Java 后端', level: 'mid', kind: 'coach' }).expect(201);
    const id = created.body.interview.id;
    await request(app.getHttpServer()).post(`/interviews/${id}/analyze`).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${id}/directions`).send({}).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${id}/outline`).expect(201);
    const st = await request(app.getHttpServer()).post(`/interviews/${id}/start`).expect(201);
    expect(st.body.interview.startedAt).toBeTruthy();
    const st2 = await request(app.getHttpServer()).post(`/interviews/${id}/start`).expect(201);
    expect(st2.body.interview.startedAt).toBe(st.body.interview.startedAt);
  });

  it('大纲调整模式隔离：模拟自动应用，陪练未确认不应用', async () => {
    // 陪练未确认 → 不静默应用
    const coach = await request(app.getHttpServer()).post('/interviews').send({ resumeId, targetRole: 'Java 后端', level: 'mid', kind: 'coach' }).expect(201);
    const cid = coach.body.interview.id;
    await request(app.getHttpServer()).post(`/interviews/${cid}/analyze`).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${cid}/directions`).send({}).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${cid}/outline`).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${cid}/start`).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${cid}/outline/adjust`).send({}).expect(201);
    let got = await request(app.getHttpServer()).get(`/interviews/${cid}`).expect(200);
    expect(got.body.interview.outlineAdjustedAt).toBeUndefined();

    // 模拟未确认 → 自动应用
    const mock = await request(app.getHttpServer()).post('/interviews').send({ resumeId, targetRole: 'Java 后端', level: 'mid', kind: 'mock' }).expect(201);
    const mid = mock.body.interview.id;
    await request(app.getHttpServer()).post(`/interviews/${mid}/analyze`).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${mid}/directions`).send({}).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${mid}/outline`).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${mid}/start`).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${mid}/outline/adjust`).send({}).expect(201);
    got = await request(app.getHttpServer()).get(`/interviews/${mid}`).expect(200);
    expect(got.body.interview.outlineAdjustedAt).toBeTruthy();

    // 陪练确认后 → 应用
    await request(app.getHttpServer()).post(`/interviews/${cid}/outline/adjust`).send({ confirm: true }).expect(201);
    got = await request(app.getHttpServer()).get(`/interviews/${cid}`).expect(200);
    expect(got.body.interview.outlineAdjustedAt).toBeTruthy();
  });

  it('保留录音偏好持久化到面试详情', async () => {
    const created = await request(app.getHttpServer())
      .post('/interviews')
      .send({ resumeId, targetRole: 'Java 后端', level: 'mid', kind: 'coach', durationTier: '30m', keepAudio: true })
      .expect(201);
    const got = await request(app.getHttpServer()).get(`/interviews/${created.body.interview.id}`).expect(200);
    expect(got.body.interview.keepAudio).toBe(true);
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

  it('模拟模式：静默评估存档，整场复盘基于真实作答而非固定样本', async () => {
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

    // 作答：不返回评价，但内部应已存档 P07 实测
    const res = await request(app.getHttpServer())
      .post(`/interviews/${mid}/turns/${t.body.turn.id}/answer`)
      .send({ transcript: '只记录不反馈。', stage: 'first' })
      .expect(201);
    expect(res.body).toEqual({ recorded: true });
    const got = await request(app.getHttpServer()).get(`/interviews/${mid}`).expect(200);
    const stored = got.body.interview.turns.find((x: { id: string }) => x.id === t.body.turn.id).attempts[0];
    expect(stored.transcript).toBe('只记录不反馈。');
    expect(stored.evaluation).toBeTruthy();

    // 整场报告应反映实测作答（维度条完整），而非固定样本兜底
    const fin = await request(app.getHttpServer()).post(`/interviews/${mid}/finish`).expect(201);
    expect(fin.body.report.overview.completedAnswers).toBe(1);
    expect(fin.body.report.dimensionReport.length).toBeGreaterThanOrEqual(1);
  });

  it('追问链：以父轮 P08 追问文本生成追问轮', async () => {
    const created = await request(app.getHttpServer())
      .post('/interviews')
      .send({ resumeId, targetRole: 'Java 后端', level: 'mid', kind: 'coach' })
      .expect(201);
    const mid = created.body.interview.id;
    await request(app.getHttpServer()).post(`/interviews/${mid}/analyze`).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${mid}/directions`).send({}).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${mid}/outline`).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${mid}/start`).expect(201);
    const main = await request(app.getHttpServer()).post(`/interviews/${mid}/turns`).send({ phase: 'tech' }).expect(201);
    const ans = await request(app.getHttpServer())
      .post(`/interviews/${mid}/turns/${main.body.turn.id}/answer`)
      .send({ transcript: '先给结论，再给约束。', stage: 'first' })
      .expect(201);
    const followText = ans.body.next.questions[0].text;

    const fu = await request(app.getHttpServer())
      .post(`/interviews/${mid}/turns`)
      .send({ phase: 'tech', parentTurnId: main.body.turn.id })
      .expect(201);
    expect(fu.body.turn.parentTurnId).toBe(main.body.turn.id);
    expect(fu.body.turn.question).toBe(followText);
  });

  it('未生成大纲直接开始 → 409', async () => {
    const created = await request(app.getHttpServer())
      .post('/interviews')
      .send({ resumeId, targetRole: 'Java 后端', level: 'mid', kind: 'coach' })
      .expect(201);
    await request(app.getHttpServer()).post(`/interviews/${created.body.interview.id}/start`).expect(409);
  });
});