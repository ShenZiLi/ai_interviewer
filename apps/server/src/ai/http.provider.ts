import type { TaskCode } from '@ai-interviewer/contracts';
import type { Provider } from './provider.interface.js';

type FetchLike = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'json' | 'status'>>;

interface HttpProviderConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  fetchImpl?: FetchLike;
}

const TASK_PROMPTS: Record<TaskCode, string> = {
  P01: '你是简历解析助手。把原始简历文本整理为结构化 JSON，输出必须为合法 JSON。',
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
    const instruction = TASK_PROMPTS[task];
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

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('provider empty response');
    return JSON.parse(stripFences(content)) as unknown;
  }
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