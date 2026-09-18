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
  report?: InterviewReport;
}

export interface InterviewReport {
  overview: { avgScore: number; completedAnswers: number; directionCoverage: { covered: number; planned: number } };
  dimensionReport?: { dim: string; overallScore: number }[];
  actionPlan?: { area: string; suggestion: string; priority: string }[];
}

export interface InterviewDetail extends InterviewSummary {
  directions: string[];
  keepAudio?: boolean;
  startedAt?: string;
  promptLocks: Record<string, { versionId: string; versionNo: number }>;
  turns?: { phase: string; question: string; attempts: { transcript: string; stage?: string; evaluation?: { score: number; grade?: string } }[] }[];
}

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
      const env = JSON.parse(text) as { error?: { message?: string; code?: string } };
      reason = env.error?.message ? `${env.error.code ? `${env.error.code} · ` : ''}${env.error.message}` : text;
    } catch {
      /* 非 JSON 错误体，原样展示 */
    }
    throw new Error(`HTTP ${res.status}: ${reason}`);
  }
  return (await res.json()) as T;
}

export type AnswerResult =
  | { recorded: true }
  | {
      transcript: string;
      evaluation: { overall: string; grade: string; score: number; dims: { dim: string; score: number; displayScore?: number }[]; strengths?: string[]; weaknesses?: string[]; suggestions?: { title: string; body: string }[] };
      next: { shouldAsk: boolean; questions: { text: string }[]; nextStep: string };
    };

export const api = {
  createResume: (text: string, title?: string) =>
    req<{ resume: { id: string; status: string; analysis: { summary: string } } }>('POST', '/resumes', { text, title }),
  createInterview: (resumeId: string, kind: 'coach' | 'mock' = 'coach', keepAudio = false) =>
    req<{ interview: { id: string; status: string } }>('POST', '/interviews', {
      resumeId,
      targetRole: 'Java 后端工程师',
      level: 'mid',
      kind,
      durationTier: '30m',
      keepAudio,
    }),
  analyze: (id: string) => req<{ position: { role: string; seniority: string; focusAreas: string[] } }>('POST', `/interviews/${id}/analyze`),
  directions: (id: string, selected?: string[]) => req<{ recommendedDirections: { recommendedDirections: { id: string; name: string; weight: number }[]; pendingClarify?: { question: string }[] } }>('POST', `/interviews/${id}/directions`, { selectedDirections: selected }),
  outline: (id: string) => req<{ outline: { summary: string; outline: { topic: string; mainQuestion: string }[] } }>('POST', `/interviews/${id}/outline`),
  start: (id: string) => req<{ interview: { id: string; status: string; startedAt?: string } }>('POST', `/interviews/${id}/start`),
  newTurn: (id: string, phase?: 'intro' | 'tech' | 'biz' | 'hr', parentTurnId?: string) =>
    req<{ turn: { id: string; phase: string; question: string } }>('POST', `/interviews/${id}/turns`, { phase: phase ?? 'tech', parentTurnId }),
  adjustOutline: (id: string, confirm?: boolean) =>
    req<{ adjustment: { mode: string; changes?: { type: string; after: string }[] } }>('POST', `/interviews/${id}/outline/adjust`, { confirm }),
  answer: (
    id: string,
    turnId: string,
    payload: { transcript?: string; audioRef?: string; stage?: 'first' | 'after_hint' },
  ) =>
    req<AnswerResult>('POST', `/interviews/${id}/turns/${turnId}/answer`, { transcript: payload.transcript, audioRef: payload.audioRef, stage: payload.stage ?? 'first' }),
  coach: (id: string, turnId: string) =>
    req<{ coaching: { modelAnswer: { summary: string; structure: { point: string; explanation: string }[] }; optimization?: { userPoint: string; improved: string; why: string }[]; coachingNote?: string; practicePrompt?: string } }>('POST', `/interviews/${id}/turns/${turnId}/coaching`),
  finish: (id: string) =>
    req<{ report: { overview: { avgScore: number; completedAnswers: number; directionCoverage: { covered: number; planned: number } }; dimensionReport?: { dim: string; overallScore: number }[]; actionPlan: { area: string; suggestion: string; priority: string }[] } }>('POST', `/interviews/${id}/finish`),
  listInterviews: () => req<{ items: InterviewSummary[] }>('GET', '/interviews'),
  getInterview: (id: string) => req<{ interview: InterviewDetail }>('GET', `/interviews/${id}`),
  /* ---------- 模型供应商设置 ---------- */
  getModelSettings: () =>
    req<{ status: { mode: 'platform' | 'custom' | 'mock'; baseUrl?: string; model?: string }; presets: { id: string; vendor: string; baseUrl: string; model: string }[] }>('GET', '/settings/model'),
  setModelConfig: (cfg: { mode?: 'platform' | 'custom'; baseUrl?: string; model?: string; apiKey?: string }) =>
    req<{ status: { mode: 'platform' | 'custom' | 'mock'; baseUrl?: string; model?: string } }>('POST', '/settings/model', cfg),
  uploadAudio: async (blob: Blob): Promise<{ ref: string; mime: string }> => {
    const data = await blob.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(data)));
    return req<{ ref: string; mime: string }>('POST', '/files/audio', { data: base64, mime: blob.type });
  },
  /* ---------- 管理员提示词 ---------- */
  listTemplates: () => req<{ items: { id: string; taskCode: string; name: string; description: string; basePrompt: string }[] }>('GET', '/admin/templates'),
  listVersions: (id: string) =>
    req<{ items: { id: string; versionNo: number; status: 'draft' | 'tested' | 'published' | 'rolled_back'; content: string; basedOnId?: string; createdAt: string }[] }>('GET', `/admin/templates/${id}/versions`),
  updateDraft: (id: string, basePrompt: string) =>
    req<{ version: { id: string; status: 'draft' | 'tested' | 'published' | 'rolled_back' } }>('PATCH', `/admin/templates/${id}`, { basePrompt }),
  actVersion: (id: string, action: 'test' | 'publish' | 'rollback', targetVersionId?: string) =>
    req<{ version: { id: string; status: string; versionNo: number; basedOnId?: string } }>('POST', `/admin/templates/${id}/versions`, { action, targetVersionId }),
};