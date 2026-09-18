import { describe, expect, it } from 'vitest';
import { ComposeService, ComposeValidationError } from '../src/ai/compose.service.js';
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