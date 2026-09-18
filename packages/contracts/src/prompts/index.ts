import { z } from 'zod';

export const promptVersions = {
  P01: 1,
  P02: 1,
  P03: 1,
  P04: 1,
  P05: 1,
  P06: 1,
  P07: 1,
  P08: 1,
  P09: 1,
  P10: 1,
} as const;
export const questionOutputSchema = z.object({
  question: z.string().min(1),
  competency: z.string().min(1),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});
export const evaluationOutputSchema = z.object({
  score: z.number().min(0).max(100),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  feedback: z.string(),
});
export type QuestionOutput = z.infer<typeof questionOutputSchema>;
export type EvaluationOutput = z.infer<typeof evaluationOutputSchema>;

export function promptFor(code: keyof typeof promptVersions, context: string): string {
  return `[${code} v${promptVersions[code]}] 你是严谨的 Java 后端面试官。${context}\n仅输出符合请求 JSON schema 的 JSON，不要 Markdown。`;
}
