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

  it('context.promptTemplate 会进入 LLM 请求体（锁定版本内容流入）', async () => {
    let sentBody = '';
    const p = new HttpProvider({
      baseUrl: 'http://x',
      model: 'm',
      fetchImpl: async (_url, init) => {
        sentBody = String(init.body);
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"summary":"ok"}' } }] }) } as never;
      },
    });
    await p.completeTask({ task: 'P06', context: { promptTemplate: '【管理员 P06 模板】给出深度追问' } });
    expect(sentBody).toContain('【管理员 P06 模板】给出深度追问');
  });

  it('无 promptTemplate 时使用默认任务指令', async () => {
    let sentBody = '';
    const p = new HttpProvider({
      baseUrl: 'http://x',
      model: 'm',
      fetchImpl: async (_url, init) => {
        sentBody = String(init.body);
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"summary":"ok"}' } }] }) } as never;
      },
    });
    await p.completeTask({ task: 'P06', context: {} });
    expect(sentBody).toContain('主问题');
  });

  it('透传 SSE delta 并在流结束后解析 JSON', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"{\\"summary\\":\\"ok\\"}"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const p = new HttpProvider({
      baseUrl: 'http://x', model: 'm',
      fetchImpl: async () => ({ ok: true, status: 200, body, json: async () => ({}) }) as never,
    });
    const deltas: string[] = [];
    const out = await p.streamTask({ task: 'P01', context: {}, onDelta: (text) => deltas.push(text) });
    expect(out).toEqual({ summary: 'ok' });
    expect(deltas).toEqual(['{"summary":"ok"}']);
  });
});
