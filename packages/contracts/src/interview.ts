import { z } from 'zod';
export const interviewCreateSchema = z.object({
  resumeId: z.string(),
  position: z.string().min(1).max(100),
  questionCount: z.number().int().min(3).max(10).default(5),
});
export const turnAnswerSchema = z.object({
  answerText: z.string().min(1).max(10_000),
  clientTurnId: z.string().min(1).max(100),
});
export const interviewSchema = z.object({
  id: z.string(),
  status: z.enum(['CREATED', 'IN_PROGRESS', 'COMPLETED', 'ABORTED']),
  currentIndex: z.number().int(),
  question: z.string().optional(),
});
export type InterviewCreate = z.infer<typeof interviewCreateSchema>;
