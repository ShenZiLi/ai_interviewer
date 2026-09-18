import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { AppModule } from '../src/app.module.js';

interface Template { id: string; taskCode: string }
interface Version { id: string; versionNo: number }

/** 验证「开场锁定已发布提示词版本、后续发布不影响已开始面试」。 */
describe('配置快照：面试起始锁定提示词版本 (e2e)', () => {
  let app: NestFastifyApplication;
  let p05: Template;
  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(() => app.close());

  async function publish(taskCode: string, content: string): Promise<Version> {
    const tpl = (await request(app.getHttpServer()).get('/admin/templates').expect(200)).body.items.find((t: Template) => t.taskCode === taskCode) as Template;
    p05 = tpl;
    await request(app.getHttpServer()).patch(`/admin/templates/${tpl.id}`).send({ basePrompt: content }).expect(200);
    await request(app.getHttpServer()).post(`/admin/templates/${tpl.id}/versions`).send({ action: 'test' }).expect(201);
    const pub = await request(app.getHttpServer()).post(`/admin/templates/${tpl.id}/versions`).send({ action: 'publish' }).expect(201);
    return pub.body.version as Version;
  }

  it('发布 P05 后开始面试，promptLocks 记录其版本', async () => {
    const v1 = await publish('P05', 'P05 第一版');

    const resume = await request(app.getHttpServer()).post('/resumes').send({ text: '三年 Java 后端。' }).expect(201);
    const created = await request(app.getHttpServer())
      .post('/interviews')
      .send({ resumeId: resume.body.resume.id, targetRole: 'Java 后端', level: 'mid', kind: 'coach' })
      .expect(201);
    const id = created.body.interview.id;
    await request(app.getHttpServer()).post(`/interviews/${id}/analyze`).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${id}/directions`).send({}).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${id}/outline`).expect(201);
    await request(app.getHttpServer()).post(`/interviews/${id}/start`).expect(201);

    const got = await request(app.getHttpServer()).get(`/interviews/${id}`).expect(200);
    const lock = got.body.interview.promptLocks.P05;
    expect(lock).toBeDefined();
    expect(lock.versionNo).toBe(v1.versionNo);
  });

  it('面试开始后再发布新版本，已开始面试的锁定不变', async () => {
    // 取「上一个测试」中创建的面试（列表按 updatedAt 最新在前；锁在详情而非列表摘要）
    const list = (await request(app.getHttpServer()).get('/interviews').expect(200)).body.items;
    const target = list[0];
    const before = await request(app.getHttpServer()).get(`/interviews/${target.id}`).expect(200);
    const locked = before.body.interview.promptLocks.P05.versionNo;

    // 再发布 P05 更高版本
    await request(app.getHttpServer()).patch(`/admin/templates/${p05.id}`).send({ basePrompt: 'P05 第二版' }).expect(200);
    await request(app.getHttpServer()).post(`/admin/templates/${p05.id}/versions`).send({ action: 'test' }).expect(201);
    const pub2 = await request(app.getHttpServer()).post(`/admin/templates/${p05.id}/versions`).send({ action: 'publish' }).expect(201);

    const got = await request(app.getHttpServer()).get(`/interviews/${target.id}`).expect(200);
    expect(pub2.body.version.versionNo).toBeGreaterThan(locked);
    expect(got.body.interview.promptLocks.P05.versionNo).toBe(locked);
  });
});