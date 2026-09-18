import { describe, expect, it } from 'vitest';
import { HttpProvider } from '../src/ai/http.provider.js';
import type { TaskCode } from '@ai-interviewer/contracts';

function stub(fn: () => unknown): HttpProvider {
  return new HttpProvider({
    baseUrl: 'http://x',
    apiKey: 'k',
    model: 'm',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => fn() }) as never,
  });
}

describe('HttpProvider (OpenAI 兼容)', () => {
  it('解析纯 JSON 输出', async () => {
    const p = stub(() => ({ choices: [{ message: { content: '{"summary":"ok"}' } }] }));
    const out = await p.completeTask({ task: 'P01', context: {} });
    expect(out).toEqual({ summary: 'ok' });
  });

  it('剥掉 markdown fence 后解析', async () => {
    const p = stub(() => ({ choices: [{ message: { content: '```json\n{"summary":"ok"}\n```' } }] }));
    const out = await p.completeTask({ task: 'P02' as unknown as TaskCode, context: {} });
    expect(out).toEqual({ summary: 'ok' });
  });

  it('上游非 2xx 抛错', async () => {
    const p = new HttpProvider({
      baseUrl: 'http://x',
      model: 'm',
      fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) as never,
    });
    await expect(p.completeTask({ task: 'P01', context: {} })).rejects.toThrow('http 500');
  });

  it('非法 JSON 抛错', async () => {
    const p = stub(() => ({ choices: [{ message: { content: 'not-json' } }] }));
    await expect(p.completeTask({ task: 'P01', context: {} })).rejects.toThrow();
  });
});