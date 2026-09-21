import type { TaskCode } from '@ai-interviewer/contracts';
import type { Provider } from './provider.interface.js';

type FetchLike = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'json' | 'status' | 'body'>>;

interface HttpProviderConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  fetchImpl?: FetchLike;
}

const TASK_PROMPTS: Record<TaskCode, string> = {
  P01: `你是简历解析助手。把原始简历文本整理为一个 JSON 对象，不要输出 Markdown 或解释。
必须严格使用以下字段：
{
  "summary": "不超过 200 字的中文概述",
  "candidateName": "姓名；未知时可省略",
  "education": [{"school":"学校或未知","degree":"学历或未知","major":"专业或未知","period":"时间或未知"}],
  "experiences": [{"company":"公司","role":"岗位","period":"时间","bullets":["职责或成果"]}],
  "projects": [{"name":"项目","role":"角色","stack":["技术"],"points":["成果或职责"]}],
  "skills": [{"name":"技能","level":"熟练度；未知时可省略"}],
  "gaps": [{"field":"待补充项","note":"原因"}],
  "confidence": 0.0 到 1.0 的数字
}
education、skills、confidence、summary 为必填字段；没有信息时数组必须返回 []，不要省略字段，不要增加其他字段。`,
  P02: '你是岗位分析助手。结合简历与目标岗位输出结构化目标画像 JSON。',
  P03: '你是面试准备助手。输出 2-6 个可多选的考察方向及澄清问题 JSON。',
  P04: '你是面试大纲规划助手。按方向与时长档位输出阶段与主问题计划 JSON，须保证各阶段分钟数总和不超预算。',
  P05: '你是大纲调整助手。依据自我介绍新增内容输出大纲变更 JSON。',
  P06: '你是面试官出题助手。围绕当前方向生成一道主问题 JSON。',
  P07: '你是面试评价助手。用八维量表对一个回答评分，输出评价 JSON（score 须与八维加权一致）。',
  P08: '你是追问决策助手。输出是否追问与追问内容 JSON。',
  P09: '你是面试辅导助手。输出优化答案与练习建议 JSON。',
  P10: '你是面试复盘助手。基于整场转写与各轮评价输出复盘报告 JSON。',
};

/**
 * OpenAI 兼容的文本模型 Provider（GLM / DeepSeek / Qwen 等均兼容 chat/completions）。
 * 输出将被 ComposeService 依 contracts taskSchema 校验；JSON 由模型侧 `json_object` 约束。
 */
export class HttpProvider implements Provider {
  readonly name = 'http';
  private readonly config: { baseUrl: string; apiKey?: string; model: string };
  private readonly fetchImpl: FetchLike;

  constructor(config: HttpProviderConfig) {
    this.config = { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model };
    this.fetchImpl = config.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  async completeTask({ task, context }: { task: TaskCode; context: unknown }): Promise<unknown> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const instruction = (context as { promptTemplate?: string })?.promptTemplate ?? TASK_PROMPTS[task];
    const conversation = `历史/上下文（JSON）：${safeStringify(context)}\n\n请完成以下任务：${instruction}\n只输出 JSON 对象。`;

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: 'user', content: conversation }],
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) throw new Error(`provider http ${res.status}`);
    return parseCompletion(await res.json());
  }

  /** 透传 OpenAI 兼容 SSE 的 content 增量；流结束后再统一解析为 JSON。 */
  async streamTask({ task, context, onDelta }: { task: TaskCode; context: unknown; onDelta: (text: string) => void }): Promise<unknown> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const instruction = (context as { promptTemplate?: string })?.promptTemplate ?? TASK_PROMPTS[task];
    const conversation = `历史/上下文（JSON）：${safeStringify(context)}\n\n请完成以下任务：${instruction}\n只输出 JSON 对象。`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: 'user', content: conversation }],
        response_format: { type: 'json_object' },
        stream: true,
      }),
    });
    // 个别 OpenAI 兼容网关不支持 stream + json_object 组合；保留原有非流式路径而不把能力差异误报为解析失败。
    if (!res.ok) {
      if ([400, 404, 405, 422].includes(res.status)) return this.completeTask({ task, context });
      throw new Error(`provider http ${res.status}`);
    }
    if (!res.body) return parseCompletion(await res.json());

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const accept = (line: string) => {
      const value = line.trim();
      if (!value.startsWith('data:')) return;
      const data = value.slice(5).trim();
      if (!data || data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data) as { choices?: { delta?: { content?: string }; message?: { content?: string } }[] };
        const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
        if (delta) {
          content += delta;
          onDelta(delta);
        }
      } catch {
        // 部分厂商可能推送心跳或非 JSON 辅助事件；不影响后续 completion 解析。
      }
    };
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      lines.forEach(accept);
      if (done) break;
    }
    if (buffer) accept(buffer);
    if (!content) return this.completeTask({ task, context });
    return JSON.parse(stripFences(content)) as unknown;
  }
}

function parseCompletion(data: unknown): unknown {
  const content = (data as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content;
  if (!content) throw new Error('provider empty response');
  return JSON.parse(stripFences(content)) as unknown;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function stripFences(s: string): string {
  const t = s.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```\s*$/.exec(t);
  return fence ? fence[1].trim() : t;
}
