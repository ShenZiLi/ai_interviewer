import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { DIMS, PHASES, TASK_CODES, type TaskCode } from './types.js';
import { DIM_MAX, toDisplay } from './scale.js';

/* ---------- 共享叶子 ---------- */

/** 单选维度评分：0–5，0.5 步进。 */
export const dimScoreSchema = z
  .number()
  .refine((n) => n >= 0 && n <= DIM_MAX && (n * 2) % 1 === 0, {
    message: '维度分须在 0–5 且为 0.5 步进',
  });

export const gradeSchema = z.enum(['A+', 'A', 'B+', 'B', 'C']);
export const confidenceSchema = z.number().min(0).max(1);

/* ---------- P01 简历理解 ---------- */

export const resumeSchema = z.object({
  summary: z.string().min(1).max(200),
  candidateName: z.string().max(50).optional(),
  education: z
    .array(z.object({ school: z.string(), degree: z.string(), major: z.string(), period: z.string() }))
    .max(30),
  experiences: z
    .array(z.object({ company: z.string(), role: z.string(), period: z.string(), bullets: z.array(z.string()).max(20) }))
    .max(30)
    .optional(),
  projects: z
    .array(z.object({ name: z.string(), role: z.string(), stack: z.array(z.string()).max(20), points: z.array(z.string()).max(20) }))
    .max(30)
    .optional(),
  skills: z.array(z.object({ name: z.string(), level: z.string().optional() })).max(30),
  gaps: z.array(z.object({ field: z.string(), note: z.string() })).max(20).optional(),
  confidence: confidenceSchema,
});
export type ResumeUnderstanding = z.infer<typeof resumeSchema>;

/* ---------- P02 目标岗位分析 ---------- */

export const positionSchema = z.object({
  role: z.string().min(1).max(50),
  seniority: z.enum(['junior', 'mid', 'senior']),
  requiredSkills: z.array(z.string().min(1).max(30)).min(1).max(15),
  preferredSkills: z.array(z.string().max(30)).max(10).optional(),
  focusAreas: z.array(z.string().min(1).max(40)).min(1).max(10),
  jdRisk: z.object({ missing: z.array(z.string()).max(20).optional(), conflict: z.array(z.string()).max(20).optional() }).optional(),
  summary: z.string().min(1).max(200),
  confidence: confidenceSchema,
});
export type PositionAnalysis = z.infer<typeof positionSchema>;

/* ---------- P03 需求澄清与方向推荐 ---------- */

export const directionSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(40),
  weight: z.number().min(0.0001).max(1),
  reason: z.string().min(1).max(200).optional(),
  questions: z.array(z.object({ q: z.string(), why: z.string() })).max(10).optional(),
});
export const directionsSchema = z.object({
  recommendedDirections: z.array(directionSchema).min(2).max(6),
  pendingClarify: z
    .array(z.object({ question: z.string(), options: z.array(z.string()).max(8).optional(), why: z.string().optional() }))
    .max(6)
    .optional(),
  confidence: confidenceSchema,
});
export type Directions = z.infer<typeof directionsSchema>;

/* ---------- P04 面试大纲规划 ---------- */

export const outlineSchema = z.object({
  summary: z.string().min(1).max(200),
  durationPlan: z.object({
    tier: z.enum(['15m', '30m', '45m']),
    budgetMinutes: z.number().int().positive(),
    phases: z.array(
      z.object({
        phase: z.enum(PHASES),
        minutes: z.number().int().nonnegative(),
        questionCount: z.number().int().nonnegative(),
        focus: z.array(z.string()).max(10).optional(),
      }),
    ),
  }),
  outline: z
    .array(
      z.object({
        topic: z.string().min(1).max(50),
        mainQuestion: z.string().min(1).max(500),
        difficulty: z.enum(['begin', 'mid', 'deep']),
        followUpPlan: z.object({ depth: z.number().int().min(1).max(5), branches: z.array(z.string()).max(10).optional() }),
      }),
    )
    .min(1)
    .max(15),
  coveredDirections: z.array(z.string()).max(10).optional(),
  confidence: confidenceSchema,
});
export type InterviewOutline = z.infer<typeof outlineSchema>;

/* ---------- P05 自我介绍后大纲调整 ---------- */

export const outlineAdjustSchema = z.object({
  changes: z
    .array(
      z.object({
        type: z.enum(['add', 'modify', 'remove', 'reorder']),
        ref: z.string().optional(),
        before: z.string().nullable().optional(),
        after: z.string().min(1).max(300),
        reason: z.string().max(200).optional(),
      }),
    )
    .max(20)
    .optional(),
  newlyNoted: z.array(z.object({ fact: z.string(), appliedTo: z.enum(PHASES) })).max(20).optional(),
  mode: z.enum(['auto', 'needsConfirm']),
  confidence: confidenceSchema,
});
export type OutlineAdjustment = z.infer<typeof outlineAdjustSchema>;

/* ---------- P06 当前主问题生成 ---------- */

export const mainQuestionSchema = z.object({
  questionText: z.string().min(1).max(500),
  topic: z.string().min(1).max(50),
  difficulty: z.enum(['begin', 'mid', 'deep']),
  targetAspect: z.string().min(1).max(50).optional(),
  probePoints: z.array(z.object({ purpose: z.string(), hint: z.string().optional() })).max(4).optional(),
  biasToDirections: z.array(z.string()).max(10).optional(),
  contextUsed: z.array(z.string()).max(10).optional(),
  avoidDuplicatesWith: z.array(z.string()).max(20).optional(),
  confidence: confidenceSchema,
});
export type MainQuestion = z.infer<typeof mainQuestionSchema>;

/* ---------- P07 回答评价 ---------- */

export const evaluationDimensionSchema = z.object({
  dim: z.enum(DIMS),
  score: dimScoreSchema,
  weight: z.number().min(0).max(1).optional(),
  displayScore: z.number().min(0).max(100).optional(),
  reason: z.string().min(1).max(300).optional(),
  gap: z.string().min(1).max(200).optional(),
  evidence: z.array(z.string().min(1).max(200)).max(6).optional(),
});

export const evaluationSchema = z.object({
  taskCode: z.literal('P07'),
  overall: z.string().min(1).max(200),
  grade: gradeSchema,
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
  followUpHint: z.object({ recommended: z.boolean(), reason: z.string().max(200).optional() }).optional(),
  confidence: confidenceSchema,
  flags: z.array(z.string().max(50)).default([]),
});
export type Evaluation = z.infer<typeof evaluationSchema>;
export type EvaluationDimension = z.infer<typeof evaluationDimensionSchema>;

/* ---------- P08 追问决策与生成 ---------- */

export const followUpSchema = z.object({
  taskCode: z.literal('P08').optional(),
  shouldAsk: z.boolean(),
  decidedBy: z.enum(['depth', 'coverage', 'answer']),
  questions: z.array(z.object({ text: z.string().min(1).max(500), purpose: z.string(), difficulty: z.enum(['begin', 'mid', 'deep']), relationToPrev: z.string().optional() })).max(3),
  maxDepthReached: z.boolean(),
  nextStep: z.enum(['followup', 'next_topic', 'coaching', 'wrapup']),
  confidence: confidenceSchema,
});
export type FollowUpDecision = z.infer<typeof followUpSchema>;

/* ---------- P09 辅导与答案优化 ---------- */

export const coachingSchema = z.object({
  taskCode: z.literal('P09').optional(),
  modelAnswer: z.object({ summary: z.string().min(1).max(200), structure: z.array(z.object({ point: z.string(), explanation: z.string() })).min(1).max(10) }),
  optimization: z.array(z.object({ userPoint: z.string(), improved: z.string(), why: z.string() })).max(10).optional(),
  coachingNote: z.string().max(200).optional(),
  practicePrompt: z.string().max(200).optional(),
  confidence: confidenceSchema,
});
export type Coaching = z.infer<typeof coachingSchema>;

/* ---------- P10 整场复盘报告 ---------- */

export const reportSchema = z.object({
  taskCode: z.literal('P10').optional(),
  overview: z.object({
    mode: z.enum(['coach', 'mock']),
    directionCoverage: z.object({ covered: z.number().int().nonnegative(), planned: z.number().int().nonnegative() }),
    durationUsedMinutes: z.number().int().nonnegative(),
    completedAnswers: z.number().int().nonnegative(),
    avgScore: z.number().min(0).max(100),
  }),
  dimensionReport: z
    .array(
      z.object({
        dim: z.enum(DIMS),
        overallScore: dimScoreSchema,
        trend: z.enum(['up', 'flat', 'down']),
        topStrengths: z.array(z.string()).max(10).optional(),
        topGaps: z.array(z.string()).max(10).optional(),
        evidenceRefs: z.array(z.string()).max(20).optional(),
      }),
    )
    .min(1)
    .max(DIMS.length),
  highlight: z.object({
    bestAnswer: z.object({ turnRef: z.string(), why: z.string() }),
    improvementStart: z.object({ turnRef: z.string(), why: z.string() }),
  }),
  actionPlan: z
    .array(z.object({ area: z.string(), suggestion: z.string(), practiceSuggestion: z.string().optional(), priority: z.enum(['high', 'mid', 'low']) }))
    .max(10),
  confidence: confidenceSchema,
});
export type SessionReport = z.infer<typeof reportSchema>;

/* ---------- 注册表 ---------- */

/** 任务输出 schema 注册表（契约），供 compose 输出校验。 */
export const taskSchemas: Record<TaskCode, z.ZodTypeAny> = {
  P01: resumeSchema,
  P02: positionSchema,
  P03: directionsSchema,
  P04: outlineSchema,
  P05: outlineAdjustSchema,
  P06: mainQuestionSchema,
  P07: evaluationSchema,
  P08: followUpSchema,
  P09: coachingSchema,
  P10: reportSchema,
};

export function taskSchema(code: TaskCode): z.ZodTypeAny {
  if (!TASK_CODES.includes(code)) throw new Error(`未知任务编码: ${code}`);
  return taskSchemas[code];
}

/**
 * 将运行时校验契约原样提供给模型，避免提示词与 Zod schema 演化后发生漂移。
 * 缓存序列化结果，所有调用方共享同一份任务输出约束。
 */
const taskOutputSchemaCache = new Map<TaskCode, string>();
export function taskOutputSchemaHint(task: TaskCode): string {
  const cached = taskOutputSchemaCache.get(task);
  if (cached) return cached;
  const json = zodToJsonSchema(taskSchemas[task], { name: `${task}Output`, $refStrategy: 'none' });
  const serialized = JSON.stringify(json);
  taskOutputSchemaCache.set(task, serialized);
  return serialized;
}

/** 便捷：按八维分（DIMS 序，0–5）构造 P07 dims 条目。 */
export function buildDims(
  scores: number[],
): { dim: (typeof DIMS)[number]; score: number; displayScore: number }[] {
  if (scores.length !== DIMS.length) throw new RangeError('dims 长度必须为 8');
  return DIMS.map((dim, i) => ({ dim, score: scores[i], displayScore: toDisplay(scores[i]) }));
}
