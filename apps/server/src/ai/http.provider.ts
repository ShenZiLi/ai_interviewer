import { taskOutputSchemaHint, type TaskCode } from '@ai-interviewer/contracts';
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
  P02: `你是岗位分析助手。结合简历与目标岗位输出 JSON，不要输出 Markdown 或解释。
必须且只能使用：
{"role":"岗位名","seniority":"junior|mid|senior","requiredSkills":["至少 1 项"],"preferredSkills":["可选技能"],"focusAreas":["至少 1 项考察重点"],"jdRisk":{"missing":["可为空"],"conflict":["可为空"]},"summary":"不超过 200 字","confidence":0.0 到 1.0}
role、seniority、requiredSkills、focusAreas、summary、confidence 必填；无可选信息时返回 []，不要省略必填字段，不要增加字段。`,
  P03: `你是面试准备助手。根据岗位画像输出 JSON，不要输出 Markdown 或解释。
必须且只能使用：
{"recommendedDirections":[{"id":"英文小写-连字符标识","name":"方向名称","weight":0.0001 到 1 的数字,"reason":"推荐原因","questions":[{"q":"澄清问题","why":"原因"}]}],"pendingClarify":[{"question":"可选澄清问题","options":["选项"],"why":"原因"}],"confidence":0.0 到 1.0}
recommendedDirections 与 confidence 必填；方向数量必须为 2 到 6 个；每个方向必须有 id、name、weight；没有澄清项时返回 []，不要增加字段。`,
  P04: `你是面试大纲规划助手。根据已选方向和时长输出 JSON，不要输出 Markdown 或解释。
必须且只能使用：
{"summary":"不超过 200 字","durationPlan":{"tier":"15m|30m|45m","budgetMinutes":正整数,"phases":[{"phase":"intro|tech|biz|hr","minutes":非负整数,"questionCount":非负整数,"focus":["方向"]}]},"outline":[{"topic":"主题","mainQuestion":"主问题","difficulty":"begin|mid|deep","followUpPlan":{"depth":1 到 5 的整数,"branches":["追问分支"]}}],"coveredDirections":["方向 id"],"confidence":0.0 到 1.0}
summary、durationPlan、outline、confidence 必填；outline 至少 1 题；phases 的 minutes 总和不得超过 budgetMinutes；没有可选信息时返回 []，不要增加字段。`,
  P05: `你是面试大纲调整与追问策划助手。自我介绍(followups 生成)后，分析自我介绍内容，从中提炼「要点(值得深挖的经历/技能)」「可追问点(含糊、兴趣点)」「矛盾点(与简历/目标岗位冲突或存疑处)」，再据此决定是否扩展后续环节的追问，输出 JSON，不要输出 Markdown 或解释。
必须且只能使用：
{"changes":[{"type":"add|modify|remove|reorder","ref":"大纲条目引用(可为空)","after":"修改或新增的大纲文本","reason":"原因"}],"newlyNoted":[{"fact":"自我介绍透露的新信息","appliedTo":"intro|tech|biz|hr"}],"followups":[{"phase":"tech|biz|hr","question":"延伸追问或深问的具体问题","reason":"依据哪个要点/矛盾点的简短说明","kind":"keypoint|deepen|contradiction"}],"mode":"auto|needsConfirm","confidence":0.0 到 1.0}
要点：changes/newlyNoted/followups 均可为空数组(未发现值得调整或追问时返回空，不要强行生成)；followups 按「有值得追问的点才生成」，每个 phase 至多 2 条，总共至多 6 条；不要求每个环节都生成，只对真正值得延伸的 tech/biz/hr 出题。明确要求：矛盾处应优先追问以澄清。`,
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
    const repair = (context as { repairInstruction?: string })?.repairInstruction;
    const conversation = `历史/上下文（JSON）：${safeStringify(context)}\n\n请完成以下任务：${instruction}${repair ? `\n\n额外校验要求：${repair}` : ''}\n\n最终输出必须严格符合以下 JSON Schema（不得添加字段）：${taskOutputSchemaHint(task)}\n只输出 JSON 对象。`;

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
    const repair = (context as { repairInstruction?: string })?.repairInstruction;
    const conversation = `历史/上下文（JSON）：${safeStringify(context)}\n\n请完成以下任务：${instruction}${repair ? `\n\n额外校验要求：${repair}` : ''}\n\n最终输出必须严格符合以下 JSON Schema（不得添加字段）：${taskOutputSchemaHint(task)}\n只输出 JSON 对象。`;
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
