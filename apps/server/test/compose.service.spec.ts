import { describe, expect, it } from 'vitest';
import { ComposeService, ComposeValidationError } from '../src/ai/compose.service.js';
import { ComposeErrorFilter } from '../src/app-exception.filter.js';
import type { Provider } from '../src/ai/provider.interface.js';

function fakeProvider(results: (unknown | Error)[]): Provider & { calls: number } {
  let i = 0;
  return {
    name: 'fake',
    calls: 0,
    async completeTask() {
      this.calls++;
      const r = results[i++];
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

const validP01 = {
  summary: '三年 Java 后端',
  candidateName: '林',
  education: [{ school: 'S', degree: '本科', major: 'CS', period: '2018-2022' }],
  skills: [{ name: 'Java' }],
  confidence: 0.9,
};

describe('ComposeService（校验→重试一次→失败降级）', () => {
  it('合法输出直接返回（调用一次）', async () => {
    const p = fakeProvider([validP01]);
    const svc = new ComposeService(p);
    const out = await svc.compose('P01', {});
    expect(out).toEqual(validP01);
    expect(p.calls).toBe(1);
  });

  it('首次非法、重试一次成功 → 返回成功结果（调用两次）', async () => {
    const p = fakeProvider([{ summary: '' }, validP01]); // P01 summary 为空→非法
    const svc = new ComposeService(p);
    const out = await svc.compose('P01', {});
    expect(out).toEqual(validP01);
    expect(p.calls).toBe(2);
  });

  it('重试后仍非法 → 抛 ComposeValidationError（调用两次）', async () => {
    const p = fakeProvider([{ summary: '' }, { nope: true }]);
    const svc = new ComposeService(p);
    await expect(svc.compose('P01', {})).rejects.toBeInstanceOf(ComposeValidationError);
    expect(p.calls).toBe(2);
  });

  it('Provider 抛异常 → 直接抛 ComposeValidationError（不重试）', async () => {
    const p = fakeProvider([new Error('upstream down')]);
    const svc = new ComposeService(p);
    await expect(svc.compose('P01', {})).rejects.toBeInstanceOf(ComposeValidationError);
    expect(p.calls).toBe(1);
  });
});

describe('ComposeErrorFilter：compose 失败降级为 502 而非裸 500', () => {
  function hostFor(): { res: { statusCode: number; body: unknown; status: (n: number) => { send: (b: unknown) => void } }; host: { switchToHttp: () => { getResponse: () => { status: (n: number) => { send: (b: unknown) => void }; send: (b: unknown) => void } } } } {
    const res = {
      statusCode: 0,
      body: undefined as unknown,
      status(n: number) { this.statusCode = n; return { send: (b: unknown) => { this.body = b; } }; },
      send(b: unknown) { this.body = b; },
    };
    const host = { switchToHttp: () => ({ getResponse: () => res }) };
    return { res, host } as never;
  }

  it('ComposeValidationError → 502 PROMPT_OUTPUT_FAILED', () => {
    const f = new ComposeErrorFilter();
    const { res, host } = hostFor() as unknown as { res: { statusCode: number; body: { error: { code: string; message: string; task: string } } }; host: { switchToHttp: () => { getResponse: () => { status: (n: number) => { send: (b: unknown) => void }; send: (b: unknown) => void } } } };
    f.catch(new ComposeValidationError('P07', { something: 'bad' }), host as never);
    expect(res.statusCode).toBe(502);
    expect(res.body.error.code).toBe('PROMPT_OUTPUT_FAILED');
    expect(res.body.error.task).toBe('P07');
  });
});