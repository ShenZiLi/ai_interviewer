import { z } from 'zod';
import { DIMS, TASK_CODES, type TaskCode } from './types.js';
import { DIM_MAX, toDisplay } from './scale.js';

/** 单选维度评分：0–5，0.5 步进。 */
export const dimScoreSchema = z
  .number()
  .refine((n) => n >= 0 && n <= DIM_MAX && (n * 2) % 1 === 0, {
    message: '维度分须在 0–5 且为 0.5 步进',
  });

/** P07 回答评价：一条维度的评分。 */
export const evaluationDimensionSchema = z.object({
  dim: z.enum(DIMS),
  score: dimScoreSchema,
  weight: z.number().min(0).max(1).optional(),
  displayScore: z.number().min(0).max(100).optional(),
  reason: z.string().min(1).max(300).optional(),
  gap: z.string().min(1).max(200).optional(),
  evidence: z.array(z.string().min(1).max(200)).max(6).optional(),
});

/** P07 回答评价（陪练每轮即时反馈的落库契约）。 */
export const evaluationSchema = z.object({
  taskCode: z.literal('P07'),
  overall: z.string().min(1).max(200),
  grade: z.enum(['A+', 'A', 'B+', 'B', 'C']),
  score: z.number().min(0).max(100),
  dims: z.array(evaluationDimensionSchema).min(1).max(DIMS.length),
  strengths: z.array(z.string().max(200)).optional(),
  weaknesses: z.array(z.string().max(200)).optional(),
  suggestions: z.array(z.object({ title: z.string().min(1).max(100), body: z.string().max(300) })).optional(),
  misconceptions: z
    .array(
      z.object({
        quote: z.string().max(200),
        clarification: z.string().max(300),
        kind: z.enum(['knowledge', 'asr', 'assumption']),
      }),
    )
    .optional(),
  followUpHint: z
    .object({ recommended: z.boolean(), reason: z.string().max(200).optional() })
    .optional(),
  confidence: z.number().min(0).max(1),
  flags: z.array(z.string().max(50)).default([]),
});

export type Evaluation = z.infer<typeof evaluationSchema>;
export type EvaluationDimension = z.infer<typeof evaluationDimensionSchema>;

/**
 * 任务输出 schema 注册表（契约），供 compose 输出校验。
 * P07 已落库化；其余任务依 docs/output-schemas.md 逐步补充语义字段，
 * 现阶段以宽松校验保证可运行，后续逐个收紧。
 */
export const taskSchemas: Record<TaskCode, z.ZodTypeAny> = {
  P01: z.object({}).passthrough(), // TODO: 依 output-schemas.md P01 收紧
  P02: z.object({}).passthrough(),
  P03: z.object({}).passthrough(),
  P04: z.object({}).passthrough(),
  P05: z.object({}).passthrough(),
  P06: z.object({}).passthrough(),
  P07: evaluationSchema,
  P08: z.object({}).passthrough(),
  P09: z.object({}).passthrough(),
  P10: z.object({}).passthrough(),
};

export function taskSchema(code: TaskCode): z.ZodTypeAny {
  if (!TASK_CODES.includes(code)) throw new Error(`未知任务编码: ${code}`);
  return taskSchemas[code];
}

/** 便捷：按八维分（DIMS 序，0–5）构造 P07 dims 条目。 */
export function buildDims(
  scores: number[],
): { dim: (typeof DIMS)[number]; score: number; displayScore: number }[] {
  if (scores.length !== DIMS.length) throw new RangeError('dims 长度必须为 8');
  return DIMS.map((dim, i) => ({ dim, score: scores[i], displayScore: toDisplay(scores[i]) }));
}