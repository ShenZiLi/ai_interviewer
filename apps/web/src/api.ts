const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:3000';

export type InterviewStatus = 'draft' | 'active' | 'finished';

export interface InterviewSummary {
  id: string;
  kind: 'coach' | 'mock';
  level: 'junior' | 'mid' | 'senior';
  status: InterviewStatus;
  targetRole: string;
  durationTier: string;
  updatedAt: string;
  /** 进行中场次的当前环节（最近一轮 phase），供工作台预览。 */
  currentPhase?: 'intro' | 'tech' | 'biz' | 'hr';
  report?: InterviewReport;
}

export interface InterviewReport {
  overview: { avgScore: number; completedAnswers: number; directionCoverage: { covered: number; planned: number }; durationUsedMinutes?: number };
  dimensionReport?: { dim: string; overallScore: number }[];
  actionPlan?: { area: string; suggestion: string; priority: string; practiceSuggestion?: string }[];
  /** P10 高亮：本场最佳作答 / 最需改进（turnRef 指向本场轮次 id）。 */
  highlight?: { bestAnswer: { turnRef: string; why: string }; improvementStart: { turnRef: string; why: string } };
}

export interface InterviewDetail extends InterviewSummary {
  resumeId: string;
  jdText?: string;
  style?: 'professional' | 'coaching' | 'concise';
  directions: string[];
  directionsResult?: { recommendedDirections: { id: string; name: string; weight: number; reason?: string }[] };
  keepAudio?: boolean;
  startedAt?: string;
  promptLocks: Record<string, { versionId: string; versionNo: number }>;
  outline?: { durationPlan?: { tier: string; budgetMinutes: number; phases: { phase: string; minutes: number; questionCount: number; focus: string[] }[] }; outline: { topic: string; mainQuestion: string; difficulty?: string }[] };
  pendingAdjustment?: { changes?: { type: string; after: string }[]; followups?: { phase: string; question: string; reason?: string; kind?: string }[] };
  turns?: { id: string; phase: string; question: string; topic?: string; difficulty?: string; targetAspect?: string; parentTurnId?: string; attempts: { transcript: string; stage?: string; audioRef?: string; evaluation?: { score: number; grade?: string; misconceptions?: { quote: string; clarification: string; kind?: 'knowledge' | 'asr' | 'assumption' }[] } }[] }[];
}

export interface ResumeAnalysis {
  summary: string;
  candidateName?: string;
  skills?: { name: string; level?: string }[];
  experiences?: { company: string; role: string; period: string; bullets: string[] }[];
  projects?: { name: string; role: string; stack: string[]; points: string[] }[];
}

export interface ResumeCreateResponse {
  resume: { id: string; status: string; analysis: ResumeAnalysis };
}

export interface SavedResumeSummary {
  id: string;
  title: string;
  status: string;
  analysis?: ResumeAnalysis;
  createdAt: string;
}

export interface SavedResume extends SavedResumeSummary {
  text: string;
}

export interface ResumeStreamProgress {
  phase: 'requesting' | 'delta' | 'validating' | 'retrying' | 'complete';
  message: string;
}

export interface PlanStreamProgress extends ResumeStreamProgress {
  task: 'P02' | 'P03' | 'P04';
}

export interface AnswerStreamProgress extends ResumeStreamProgress {
  task: 'ASR' | 'P07' | 'P08';
}

export interface PlanStreamResult {
  position?: { role: string; seniority: string; focusAreas: string[] };
  recommendedDirections: { recommendedDirections: { id: string; name: string; weight: number; reason?: string }[] };
  outline?: { summary: string; durationPlan: { tier: string; budgetMinutes: number; phases: { phase: string; minutes: number; questionCount: number; focus: string[] }[] }; outline: { topic: string; mainQuestion: string; difficulty?: string }[] };
}

/** 录音回听地址（保留策略决定音频是否存在，不存在时播放器自然报错）。 */
export const audioSrc = (ref: string): string => `${API_BASE}/files/audio/${ref}`;

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let reason = text;
    try {
      const env = JSON.parse(text) as { error?: { message?: string; code?: string; detail?: string; task?: string; details?: unknown[] } };
      if (env.error?.message) {
        const reasonParts = [env.error.code ? `${env.error.code} · ` : '', env.error.message];
        const extra = env.error.detail ?? (Array.isArray(env.error.details) ? `参数校验失败（${env.error.details.length} 处）` : undefined) ?? env.error.task;
        if (extra) reasonParts.push(`（${String(extra)}）`);
        reason = reasonParts.join('');
      } else {
        reason = text;
      }
    } catch {
      /* 非 JSON 错误体，原样展示 */
    }
    throw new Error(`HTTP ${res.status}: ${reason}`);
  }
  return (await res.json()) as T;
}

/** 读取 POST SSE：模型 token 与校验阶段即时回调，result 事件返回最终简历。 */
async function streamResume(text: string, title: string | undefined, onProgress: (event: ResumeStreamProgress) => void): Promise<ResumeCreateResponse> {
  const res = await fetch(`${API_BASE}/resumes/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ text, title }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text();
    let reason = body || '无法建立流式连接';
    try {
      const envelope = JSON.parse(body) as { error?: { code?: string; message?: string } };
      if (envelope.error?.message) reason = `${envelope.error.code ? `${envelope.error.code} · ` : ''}${envelope.error.message}`;
    } catch {
      /* 非 JSON 错误体，保留原始信息。 */
    }
    throw new Error(`HTTP ${res.status}: ${reason}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: ResumeCreateResponse | undefined;
  const consume = (block: string) => {
    const event = /^event:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? 'message';
    const raw = /^data:\s*(.+)$/m.exec(block)?.[1];
    if (!raw) return;
    const data = JSON.parse(raw) as ResumeStreamProgress | ResumeCreateResponse | { code?: string; message?: string; detail?: string };
    if (event === 'progress') onProgress(data as ResumeStreamProgress);
    if (event === 'result') result = data as ResumeCreateResponse;
    if (event === 'error') {
      const error = data as { code?: string; message?: string; detail?: string };
      throw new Error(`${error.code ? `${error.code} · ` : ''}${error.message ?? error.detail ?? '简历解析失败'}${error.detail && error.message ? `（${error.detail}）` : ''}`);
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';
    blocks.forEach(consume);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  if (!result) throw new Error('流式解析结束，但未收到结构化简历结果');
  return result;
}

/**
 * 通用 POST SSE 读取：`progress` 事件即时回调（模型增量与校验阶段），`result` 事件返回最终结果，`error` 事件抛出。
 * messages 由各调用方传入，使报错文案贴合各自业务（计划生成 / 回答评价）。
 */
async function streamSse<TResult, TProgress extends ResumeStreamProgress>(
  path: string,
  body: unknown,
  onProgress: (event: TProgress) => void,
  messages: { connect: string; missing: string; failed: string },
): Promise<TResult> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { accept: 'text/event-stream', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text || messages.connect}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: TResult | undefined;
  const consume = (block: string) => {
    const event = /^event:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? 'message';
    const raw = /^data:\s*(.+)$/m.exec(block)?.[1];
    if (!raw) return;
    const data = JSON.parse(raw) as TProgress | TResult | { code?: string; message?: string; detail?: string };
    if (event === 'progress') onProgress(data as TProgress);
    if (event === 'result') result = data as TResult;
    if (event === 'error') {
      const error = data as { code?: string; message?: string; detail?: string };
      throw new Error(`${error.code ? `${error.code} · ` : ''}${error.message ?? error.detail ?? messages.failed}${error.detail && error.message ? `（${error.detail}）` : ''}`);
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';
    blocks.forEach(consume);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  if (result === undefined) throw new Error(messages.missing);
  return result;
}

/** 面试计划 SSE：依次推送 P02/P03/P04 的模型增量与契约校验，再交付计划结果。 */
const streamPlan = <T extends PlanStreamResult>(path: string, body: unknown, onProgress: (event: PlanStreamProgress) => void) =>
  streamSse<T, PlanStreamProgress>(path, body, onProgress, {
    connect: '无法建立计划流式连接',
    missing: '计划流式处理结束，但未收到结果',
    failed: '面试计划生成失败',
  });

/** 作答评价 SSE：依次推送 ASR 转写、P07 评价、P08 追问决策的模型增量，再交付作答结果。 */
const streamAnswer = (
  id: string,
  turnId: string,
  payload: { transcript?: string; audioRef?: string; stage?: 'first' | 'after_hint' },
  onProgress: (event: AnswerStreamProgress) => void,
) =>
  streamSse<AnswerResult, AnswerStreamProgress>(
    `/interviews/${id}/turns/${turnId}/answer/stream`,
    { transcript: payload.transcript, audioRef: payload.audioRef, stage: payload.stage ?? 'first' },
    onProgress,
    { connect: '无法建立回答评价流式连接', missing: '回答评价流式处理结束，但未收到结果', failed: '回答评价失败' },
  );

export type AnswerResult =
  | { recorded: true }
  | {
      transcript: string;
      evaluation: { overall: string; grade: string; score: number; dims: { dim: string; score: number; displayScore?: number }[]; strengths?: string[]; weaknesses?: string[]; suggestions?: { title: string; body: string }[]; misconceptions?: { quote: string; clarification: string; kind?: 'knowledge' | 'asr' | 'assumption' }[] };
      next: { shouldAsk: boolean; questions: { text: string }[]; nextStep: string };
    };

export const api = {
  createResume: (text: string, title?: string) =>
    req<ResumeCreateResponse>('POST', '/resumes', { text, title }),
  createResumeStream: (text: string, onProgress: (event: ResumeStreamProgress) => void, title?: string) =>
    streamResume(text, title, onProgress),
  listResumes: () => req<{ items: SavedResumeSummary[] }>('GET', '/resumes'),
  getResume: (id: string) => req<{ resume: SavedResume }>('GET', `/resumes/${id}`),
  renameResume: (id: string, title: string) => req<{ resume: SavedResume }>('PATCH', `/resumes/${id}`, { title }),
  deleteResume: (id: string) => req<{ ok: boolean }>('DELETE', `/resumes/${id}`),
  createPlanStream: (id: string, onProgress: (event: PlanStreamProgress) => void) =>
    streamPlan<PlanStreamResult>(`/interviews/${id}/plan/stream`, undefined, onProgress),
  createOutlineStream: (id: string, selectedDirections: string[] | undefined, extra: string | undefined, onProgress: (event: PlanStreamProgress) => void) =>
    streamPlan<PlanStreamResult>(`/interviews/${id}/outline/stream`, { selectedDirections, extra }, onProgress),
  createInterview: (resumeId: string, opts: { kind?: 'coach' | 'mock'; keepAudio?: boolean; jdText?: string; role?: string; level?: 'junior' | 'mid' | 'senior'; durationTier?: '15m' | '30m' | '45m'; style?: 'professional' | 'coaching' | 'concise' } = {}) =>
    req<{ interview: { id: string; status: string } }>('POST', '/interviews', {
      resumeId,
      targetRole: opts.role ?? 'Java 后端工程师',
      level: opts.level ?? 'mid',
      kind: opts.kind ?? 'coach',
      durationTier: opts.durationTier ?? '30m',
      keepAudio: opts.keepAudio,
      jdText: opts.jdText,
      style: opts.style,
    }),
  analyze: (id: string) => req<{ position: { role: string; seniority: string; focusAreas: string[] } }>('POST', `/interviews/${id}/analyze`),
  directions: (id: string, selected?: string[], extra?: string) => req<{ recommendedDirections: { recommendedDirections: { id: string; name: string; weight: number }[]; pendingClarify?: { question: string }[] } }>('POST', `/interviews/${id}/directions`, { selectedDirections: selected, extra }),
  outline: (id: string) => req<{ outline: { summary: string; durationPlan: { tier: string; budgetMinutes: number; phases: { phase: string; minutes: number; questionCount: number; focus: string[] }[] }; outline: { topic: string; mainQuestion: string; difficulty?: string }[] } }>('POST', `/interviews/${id}/outline`),
  start: (id: string) => req<{ interview: { id: string; status: string; startedAt?: string } }>('POST', `/interviews/${id}/start`),
  newTurn: (id: string, phase?: 'intro' | 'tech' | 'biz' | 'hr', parentTurnId?: string) =>
    req<{ turn: { id: string; phase: string; question: string; topic?: string; difficulty?: string; targetAspect?: string } }>('POST', `/interviews/${id}/turns`, { phase: phase ?? 'tech', parentTurnId }),
  adjustOutline: (id: string, action: 'preview' | 'apply' | 'discard' = 'preview') =>
    req<{ adjustment?: { mode: string; changes?: { type: string; after: string }[]; followups?: { phase: string; question: string; reason?: string; kind?: string }[] } }>('POST', `/interviews/${id}/outline/adjust`, { action }),
  answer: (
    id: string,
    turnId: string,
    payload: { transcript?: string; audioRef?: string; stage?: 'first' | 'after_hint' },
  ) =>
    req<AnswerResult>('POST', `/interviews/${id}/turns/${turnId}/answer`, { transcript: payload.transcript, audioRef: payload.audioRef, stage: payload.stage ?? 'first' }),
  answerStream: (
    id: string,
    turnId: string,
    payload: { transcript?: string; audioRef?: string; stage?: 'first' | 'after_hint' },
    onProgress: (event: AnswerStreamProgress) => void,
  ) =>
    streamAnswer(id, turnId, payload, onProgress),
  coach: (id: string, turnId: string) =>
    req<{ coaching: { modelAnswer: { summary: string; structure: { point: string; explanation: string }[] }; optimization?: { userPoint: string; improved: string; why: string }[]; coachingNote?: string; practicePrompt?: string } }>('POST', `/interviews/${id}/turns/${turnId}/coaching`),
  finish: (id: string) =>
    req<{ report: { overview: { avgScore: number; completedAnswers: number; directionCoverage: { covered: number; planned: number }; durationUsedMinutes?: number }; dimensionReport?: { dim: string; overallScore: number }[]; actionPlan: { area: string; suggestion: string; priority: string; practiceSuggestion?: string }[]; highlight?: { bestAnswer: { turnRef: string; why: string }; improvementStart: { turnRef: string; why: string } } } }>('POST', `/interviews/${id}/finish`),
  listInterviews: () => req<{ items: InterviewSummary[] }>('GET', '/interviews'),
  getInterview: (id: string) => req<{ interview: InterviewDetail }>('GET', `/interviews/${id}`),
  deleteInterview: (id: string) => req<{ ok: boolean }>('DELETE', `/interviews/${id}`),
  /* ---------- 模型供应商设置 ---------- */
  getModelSettings: () =>
    req<{ status: { mode: 'platform' | 'custom' | 'mock'; baseUrl?: string; model?: string }; presets: { id: string; vendor: string; baseUrl: string; model: string }[] }>('GET', '/settings/model'),
  setModelConfig: (cfg: { mode?: 'platform' | 'custom'; baseUrl?: string; model?: string; apiKey?: string }) =>
    req<{ status: { mode: 'platform' | 'custom' | 'mock'; baseUrl?: string; model?: string } }>('POST', '/settings/model', cfg),
  testModel: (cfg?: { mode?: 'platform' | 'custom'; baseUrl?: string; model?: string; apiKey?: string }) =>
    req<{ ok: boolean; latencyMs: number; mode: string; error?: string }>('POST', '/settings/model/test', cfg ?? {}),
  uploadAudio: async (blob: Blob): Promise<{ ref: string; mime: string }> => {
    const data = await blob.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(data)));
    return req<{ ref: string; mime: string }>('POST', '/files/audio', { data: base64, mime: blob.type });
  },
  /* ---------- 管理员提示词 ---------- */
  listTemplates: () => req<{ items: { id: string; taskCode: string; name: string; description: string; basePrompt: string; variables: string[] }[] }>('GET', '/admin/templates'),
  listVersions: (id: string) =>
    req<{ items: { id: string; versionNo: number; status: 'draft' | 'tested' | 'published' | 'rolled_back'; content: string; testResult?: { passed: boolean; note: string }; basedOnId?: string; createdAt: string }[] }>('GET', `/admin/templates/${id}/versions`),
  updateDraft: (id: string, basePrompt: string) =>
    req<{ version: { id: string; status: 'draft' | 'tested' | 'published' | 'rolled_back' } }>('PATCH', `/admin/templates/${id}`, { basePrompt }),
  deleteTemplate: (id: string) => req<{ ok: boolean }>('DELETE', `/admin/templates/${id}`),
  actVersion: (id: string, action: 'test' | 'publish' | 'rollback', targetVersionId?: string) =>
    req<{ version: { id: string; status: string; versionNo: number; basedOnId?: string } }>('POST', `/admin/templates/${id}/versions`, { action, targetVersionId }),
};
