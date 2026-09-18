import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { AppModule } from '../src/app.module.js';

describe('管理员提示词管理 (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(() => app.close());

  it('默认注入 P01—P10 十个模板', async () => {
    const res = await request(app.getHttpServer()).get('/admin/templates').expect(200);
    expect(res.body.items.length).toBe(10);
    expect(res.body.items.map((t: { taskCode: string }) => t.taskCode)).toContain('P07');
  });

  it('模板带任务对应的上下文变量（供管理员查看）', async () => {
    const items = (await request(app.getHttpServer()).get('/admin/templates').expect(200)).body.items as { taskCode: string; variables: string[] }[];
    const by = (code: string) => items.find((t) => t.taskCode === code)!.variables;
    expect(by('P01')).toContain('text');
    expect(by('P07')).toEqual(expect.arrayContaining(['it', 'turn', 'transcript']));
    expect(by('P10')).toContain('it');
  });

  it('任务编码唯一性冲突返回 409', async () => {
    const some = (await request(app.getHttpServer()).get('/admin/templates').expect(200)).body.items[0];
    await request(app.getHttpServer())
      .post('/admin/templates')
      .send({ taskCode: some.taskCode, name: 'duplicate', basePrompt: 'x' })
      .expect(409);
  });

  it('草稿→测试→发布，发布后版本为 published', async () => {
    const tpl = (await request(app.getHttpServer()).get('/admin/templates').expect(200)).body.items[0];
    const id = tpl.id;

    // 编辑草稿
    const upd = await request(app.getHttpServer())
      .patch(`/admin/templates/${id}`)
      .send({ basePrompt: '草稿内容 v1' })
      .expect(200);
    expect(upd.body.version.status).toBe('draft');

    // 未测试直接发布 → 409
    await request(app.getHttpServer()).post(`/admin/templates/${id}/versions`).send({ action: 'publish' }).expect(409);

    // 测试 → tested
    const tested = await request(app.getHttpServer()).post(`/admin/templates/${id}/versions`).send({ action: 'test' }).expect(201);
    expect(tested.body.version.status).toBe('tested');

    // 发布 → published
    const pub = await request(app.getHttpServer()).post(`/admin/templates/${id}/versions`).send({ action: 'publish' }).expect(201);
    expect(pub.body.version.status).toBe('published');
    expect(pub.body.version.versionNo).toBe(2);
  });

  it('发布后再次编辑草稿 → 回到 draft（需重测）', async () => {
    const tpl = (await request(app.getHttpServer()).get('/admin/templates').expect(200)).body.items[0];
    const id = tpl.id;
    const upd = await request(app.getHttpServer())
      .patch(`/admin/templates/${id}`)
      .send({ basePrompt: '草稿内容 v2（改动）' })
      .expect(200);
    expect(upd.body.version.status).toBe('draft');
    expect(upd.body.version.testResult).toBeUndefined();
  });

  it('回滚基于目标版本创建新版本并记录 basedOnId', async () => {
    const tpl = (await request(app.getHttpServer()).get('/admin/templates').expect(200)).body.items[0];
    const id = tpl.id;
    const versions = (await request(app.getHttpServer()).get(`/admin/templates/${id}/versions`).expect(200)).body.items;
    const target = versions.find((v: { status: string; versionNo: number }) => v.status === 'published' && v.versionNo === 2) ?? versions[0];
    const rb = await request(app.getHttpServer())
      .post(`/admin/templates/${id}/versions`)
      .send({ action: 'rollback', targetVersionId: target.id })
      .expect(201);
    expect(rb.body.version.status).toBe('published');
    expect(rb.body.version.basedOnId).toBe(target.id);
  });
});