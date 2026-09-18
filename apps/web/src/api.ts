const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:3000';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export const api = {
  createResume: (text: string, title?: string) =>
    req<{ resume: { id: string; status: string; analysis: { summary: string } } }>('POST', '/resumes', { text, title }),
  createInterview: (resumeId: string) =>
    req<{ interview: { id: string; status: string } }>('POST', '/interviews', {
      resumeId,
      targetRole: 'Java 后端工程师',
      level: 'mid',
      kind: 'coach',
      durationTier: '30m',
    }),
  analyze: (id: string) => req<{ position: { role: string; seniority: string; focusAreas: string[] } }>('POST', `/interviews/${id}/analyze`),
  directions: (id: string) => req<{ recommendedDirections: { recommendedDirections: { id: string; name: string; weight: number }[]; pendingClarify?: { question: string }[] } }>('POST', `/interviews/${id}/directions`, {}),
  outline: (id: string) => req<{ outline: { summary: string; outline: { topic: string; mainQuestion: string }[] } }>('POST', `/interviews/${id}/outline`),
  start: (id: string) => req<{ interview: { id: string; status: string } }>('POST', `/interviews/${id}/start`),
  newTurn: (id: string) => req<{ turn: { id: string; phase: string; question: string } }>('POST', `/interviews/${id}/turns`, { phase: 'tech' }),
  answer: (
    id: string,
    turnId: string,
    transcript: string,
  ) =>
    req<{
      evaluation: { overall: string; grade: string; score: number; dims: { dim: string; score: number; displayScore?: number }[] };
      next: { shouldAsk: boolean; questions: { text: string }[]; nextStep: string };
    }>('POST', `/interviews/${id}/turns/${turnId}/answer`, { transcript, stage: 'first' }),
  finish: (id: string) =>
    req<{ report: { overview: { avgScore: number; completedAnswers: number; directionCoverage: { covered: number; planned: number } }; actionPlan: { area: string; suggestion: string; priority: string }[] } }>('POST', `/interviews/${id}/finish`),
};